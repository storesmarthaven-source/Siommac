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
import { rpcHttpError } from '../workflow/service';
import { selectWorkflowBinding } from '../workflow/bindingResolver';
import { notifyUsersByRole } from '../finance/financeEvents';
import {
  getStatutoryProfileByEmployee,
  getStatutoryProfileById,
  toStatutoryProfileDto,
  type StatutoryProfileDto,
  type DbStatutoryProfileRow,
} from './statutoryProfileCore';

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
  idempotencyKey: string,
): Promise<StatutoryProfileDto> {
  // ATOMIC (finding #3): the workflow start + workflow_id link + business event +
  // hr_audit_log commit in ONE transaction via workflow_submit_for_record_tx
  // (hr_employee_statutory_profiles branch), with request-key idempotency. This is a
  // submit-on-existing record (the profile is created separately by captureStatutoryProfile);
  // nis_status is unchanged — the workflow_id link IS the "submitted for verification" marker.
  const requestKey = idempotencyKey?.trim();
  if (!requestKey) throw Object.assign(new Error('An idempotency key is required to submit a statutory profile.'), { status: 400 });

  const existing = await getStatutoryProfileById(id);
  if (!existing) throw Object.assign(new Error('Statutory profile not found.'), { status: 404 });
  if (!['pending_verification', 'not_available'].includes(existing.nisStatus)) {
    throw Object.assign(
      new Error('Only pending_verification or not_available profiles can be submitted for Finance review.'),
      { status: 422 },
    );
  }

  const binding = await selectWorkflowBinding(sb, {
    moduleKey: 'finance_payroll', workflowType: 'finance_nis_profile_verification',
    triggerEvent: 'finance.nis.profile.submitted', sourceRecordId: id, requestedBy: actorId, recordData: {},
  });
  // Statutory (NIS) verification is compliance-mandatory — a profile cannot be submitted
  // for review without an active verification workflow (no silent approval bypass).
  if (!binding) throw Object.assign(new Error('No active NIS verification workflow is configured.'), { status: 422 });

  const { data, error } = await sb.rpc('workflow_submit_for_record_tx', {
    p_source_table: 'hr_employee_statutory_profiles', p_source_id: id, p_actor_id: actorId,
    p_binding_id: binding.id, p_request_key: requestKey, p_business: {},
  });
  if (error) throw rpcHttpError(error as { code?: string | null; message: string });
  const result = (data ?? {}) as { firstTasks?: Array<{ assignedTo?: string | null }> };

  // The first step routes to the finance_staff role — notify them post-commit so the
  // verification task is actioned (preserving the fan-out startWorkflowForRecord did).
  void notifyUsersByRole('finance_staff', {
    type: 'finance.nis.profile.submitted',
    title: `NIS profile NIS-${id.slice(0, 8).toUpperCase()} awaiting verification`,
    body: 'A statutory (NIS) profile has been submitted for Finance verification.',
    module: 'finance_payroll', severity: 'warning', sourceType: 'statutory_profile',
    sourceId: id, actionRequired: true, dedupeKey: `finance.nis.profile.submitted.${id}`,
  });

  const row = await getStatutoryProfileById(id);
  if (!row) throw Object.assign(new Error('Statutory profile not found after submit.'), { status: 503 });
  return row;
}
