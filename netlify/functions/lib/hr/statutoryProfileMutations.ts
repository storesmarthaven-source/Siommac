// ============================================================================
// HR — Employee Statutory Profile Mutations (Phase 2.5)
// ============================================================================
// HR can:
//   • capture/upsert (create or update) a statutory profile for an employee
//   • submit the profile for Finance verification (starts workflow)
//
// HR CANNOT:
//   • set nis_status='verified' — that is Finance-only (finance.payroll.nis.verify)
//   • change verified_by / verified_at / verification_note
//
// Compensating rollback pattern: if startWorkflowForRecord throws, we roll back
// nis_status to 'pending_verification' (the only safe state for HR). No silent
// error swallowing — the caller always gets a thrown error.
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { startWorkflowForRecord } from '../workflow/service';
import {
  getStatutoryProfileByEmployee,
  getStatutoryProfileById,
  toStatutoryProfileDto,
  type StatutoryProfileDto,
  type DbStatutoryProfileRow,
} from './statutoryProfileCore';
import type { ModuleWorkflowContext } from '../workflow/definitionTypes';

export { getStatutoryProfileByEmployee, getStatutoryProfileById };

// ── Capture / Upsert (HR creates or updates) ─────────────────────────────────

export interface CaptureStatutoryProfileInput {
  employeeId: string;
  jurisdiction?: string;
  currency?: string;
  nisNumber?: string | null;
  nisApplicable?: boolean;
  previousEmployerName?: string | null;
  previousEmployerEndDate?: string | null;
  openingYtdInsurableEarnings?: number;
  openingYtdNisEmployee?: number;
  openingYtdNisEmployer?: number;
  openingBalanceAsOf?: string | null;
  actorId: string;
}

export async function captureStatutoryProfile(
  input: CaptureStatutoryProfileInput,
): Promise<StatutoryProfileDto> {
  const jurisdiction = input.jurisdiction ?? 'TT';

  // Load existing to record previousState for audit
  const existing = await getStatutoryProfileByEmployee(input.employeeId, jurisdiction);

  const patch: Record<string, unknown> = {
    employee_id:   input.employeeId,
    jurisdiction,
    currency:      input.currency ?? 'TTD',
    updated_by:    input.actorId,
  };

  // Only set fields that are explicitly provided (preserve verified fields on update)
  if (input.nisNumber !== undefined)                  patch['nis_number'] = input.nisNumber;
  if (input.nisApplicable !== undefined)              patch['nis_applicable'] = input.nisApplicable;
  if (input.previousEmployerName !== undefined)       patch['previous_employer_name'] = input.previousEmployerName;
  if (input.previousEmployerEndDate !== undefined)    patch['previous_employer_end_date'] = input.previousEmployerEndDate;
  if (input.openingYtdInsurableEarnings !== undefined) patch['opening_ytd_insurable_earnings'] = input.openingYtdInsurableEarnings;
  if (input.openingYtdNisEmployee !== undefined)      patch['opening_ytd_nis_employee'] = input.openingYtdNisEmployee;
  if (input.openingYtdNisEmployer !== undefined)      patch['opening_ytd_nis_employer'] = input.openingYtdNisEmployer;
  if (input.openingBalanceAsOf !== undefined)         patch['opening_balance_as_of'] = input.openingBalanceAsOf;

  let row: StatutoryProfileDto;

  if (!existing) {
    // INSERT — set created_by and initial nis_status
    patch['created_by']  = input.actorId;
    patch['nis_status']  = 'pending_verification';

    const { data, error } = await sb
      .from('hr_employee_statutory_profiles')
      .insert(patch)
      .select()
      .single<DbStatutoryProfileRow>();
    if (error) {
      if (error.code === '23505') {
        throw Object.assign(new Error('A statutory profile for this employee and jurisdiction already exists.'), { status: 409 });
      }
      throw Object.assign(new Error('captureStatutoryProfile insert: ' + error.message), { status: 500 });
    }
    row = toStatutoryProfileDto(data);
  } else {
    // HR cannot re-open a verified profile (Finance owns that state)
    if (existing.nisStatus === 'verified') {
      throw Object.assign(
        new Error('This statutory profile has been verified by Finance. Contact Finance to request a correction.'),
        { status: 422 },
      );
    }

    const { data, error } = await sb
      .from('hr_employee_statutory_profiles')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single<DbStatutoryProfileRow>();
    if (error) throw Object.assign(new Error('captureStatutoryProfile update: ' + error.message), { status: 500 });
    row = toStatutoryProfileDto(data);
  }

  await writeHrAudit({
    submoduleKey: 'hr_statutory',
    recordId:     row.id,
    actorId:      input.actorId,
    action:       existing ? 'statutory_profile.updated' : 'statutory_profile.created',
    previousState: existing ?? null,
    newState: {
      nisNumber:    row.nisNumber,
      nisApplicable: row.nisApplicable,
      nisStatus:    row.nisStatus,
    },
  });

  void emitAppEvent({
    eventType:       existing ? 'hr.statutory_profile.updated' : 'hr.statutory_profile.created',
    sourceModule:    'hr_statutory',
    sourceEntityType: 'statutory_profile',
    sourceEntityId:  row.id,
    actorUserId:     input.actorId,
    severity:        'info',
    payload: { employeeId: row.employeeId, jurisdiction: row.jurisdiction },
  });

  return row;
}

// ── Submit (HR submits → starts Finance verification workflow) ────────────────

export async function submitStatutoryProfile(
  id: string,
  actorId: string,
): Promise<StatutoryProfileDto> {
  const existing = await getStatutoryProfileById(id);
  if (!existing) throw Object.assign(new Error('Statutory profile not found.'), { status: 404 });

  if (!['pending_verification', 'not_available'].includes(existing.nisStatus)) {
    throw Object.assign(
      new Error('Only pending_verification or not_available profiles can be submitted for Finance review.'),
      { status: 422 },
    );
  }

  // Build workflow context
  const ctx: ModuleWorkflowContext = {
    moduleKey:       'finance_payroll',
    workflowType:    'finance_nis_profile_verification',
    triggerEvent:    'finance.nis.profile.submitted',
    sourceRecordId:  id,
    sourceRecordRef: `NIS-${id.slice(0, 8).toUpperCase()}`,
    requestedBy:     actorId,
    priority:        'normal',
    recordData: {
      employeeId:   existing.employeeId,
      jurisdiction: existing.jurisdiction,
      nisNumber:    existing.nisNumber,
      nisApplicable: existing.nisApplicable,
    },
  };

  let wf: { id?: string } | null = null;

  try {
    wf = await startWorkflowForRecord({ context: ctx, actor: { id: actorId } });
  } catch (wfErr) {
    // Compensating rollback: profile stays in its current state (no status change was done)
    throw Object.assign(
      new Error('Workflow start failed — profile not submitted: ' + String(wfErr)),
      { status: 500 },
    );
  }

  // Update workflow_id link if the engine returned an instance id
  const { data, error } = await sb
    .from('hr_employee_statutory_profiles')
    .update({ workflow_id: wf?.id ?? null, updated_by: actorId })
    .eq('id', id)
    .select()
    .single<DbStatutoryProfileRow>();
  if (error) throw Object.assign(new Error('submitStatutoryProfile update: ' + error.message), { status: 500 });
  const row = toStatutoryProfileDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_statutory',
    recordId:     id,
    actorId,
    action:       'statutory_profile.submitted',
    previousState: { nisStatus: existing.nisStatus },
    newState: { nisStatus: row.nisStatus, workflowId: row.workflowId },
  });

  void emitAppEvent({
    eventType:       'finance.nis.profile.submitted',
    sourceModule:    'finance_payroll',
    sourceEntityType: 'statutory_profile',
    sourceEntityId:  id,
    actorUserId:     actorId,
    severity:        'info',
    payload: { employeeId: existing.employeeId, jurisdiction: existing.jurisdiction },
  });

  return row;
}
