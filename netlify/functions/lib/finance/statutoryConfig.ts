// ============================================================================
// Finance — Statutory Configuration (Phase 1)
// ============================================================================
// Manages finance_statutory_versions + finance_nis_classes.
//
// Lifecycle: draft → pending_approval → approved → active → retired
//   - Only finance_manager (or admin) can manage and approve.
//   - CREATOR ≠ FINAL APPROVER (assertDifferentApprover enforced on approve).
//   - Only ONE active version per jurisdiction at a time (activating retires the
//     prior active). Rates NEVER hardcoded in TS — always read from the DB.
//   - Versions used by payroll runs cannot be retired (handled in later Phase).
//
// Permissions: finance.statutory.{view,manage,approve}
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { startWorkflowForRecord } from '../workflow/service';
import type { ModuleWorkflowContext } from '../workflow/definitionTypes';

// ── Segregation of duties helper ─────────────────────────────────────────────

export function assertDifferentApprover({
  actorId,
  createdBy,
  action,
}: { actorId: string; createdBy?: string | null; action: string }): void {
  if (createdBy && actorId === createdBy) {
    throw Object.assign(
      new Error(`Segregation of duties violation: creator cannot ${action}.`),
      { status: 422 },
    );
  }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface StatutoryVersionDto {
  id: string;
  effectiveFrom: string;
  label: string;
  jurisdiction: string;
  currency: string;
  payePersonalAllowance: number;
  payeBand1Ceiling: number;
  payeBand1Rate: number;
  payeBand2Rate: number;
  hsMonthlyThreshold: number;
  hsWeeklyHigh: number;
  hsWeeklyLow: number;
  nisMonthyCeiling: number | null;
  status: 'draft' | 'pending_approval' | 'approved' | 'active' | 'retired';
  workflowId: string | null;
  isActive: boolean;
  createdBy: string | null;
  approvedBy: string | null;
  activatedBy: string | null;
  activatedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NisClassRow {
  id: string;
  statutoryVersionId: string;
  classNo: number;
  weeklyMin: number;
  weeklyMax: number | null;
  employeeWeekly: number;
  employerWeekly: number;
  createdAt: string;
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface DbVersionRow {
  id: string; effective_from: string; label: string; jurisdiction: string; currency: string;
  paye_personal_allowance: number; paye_band1_ceiling: number;
  paye_band1_rate: number; paye_band2_rate: number;
  hs_monthly_threshold: number; hs_weekly_high: number; hs_weekly_low: number;
  nis_monthly_ceiling: number | null;
  status: string; workflow_id: string | null; is_active: boolean;
  created_by: string | null; approved_by: string | null;
  activated_by: string | null; activated_at: string | null;
  retired_by: string | null; retired_at: string | null;
  created_at: string; updated_at: string;
}

interface DbNisRow {
  id: string; statutory_version_id: string; class_no: number;
  weekly_min: number; weekly_max: number | null;
  employee_weekly: number; employer_weekly: number; created_at: string;
}

function toVersionDto(r: DbVersionRow): StatutoryVersionDto {
  return {
    id: r.id, effectiveFrom: r.effective_from, label: r.label,
    jurisdiction: r.jurisdiction, currency: r.currency,
    payePersonalAllowance: Number(r.paye_personal_allowance),
    payeBand1Ceiling: Number(r.paye_band1_ceiling),
    payeBand1Rate: Number(r.paye_band1_rate), payeBand2Rate: Number(r.paye_band2_rate),
    hsMonthlyThreshold: Number(r.hs_monthly_threshold),
    hsWeeklyHigh: Number(r.hs_weekly_high), hsWeeklyLow: Number(r.hs_weekly_low),
    nisMonthyCeiling: r.nis_monthly_ceiling !== null ? Number(r.nis_monthly_ceiling) : null,
    status: r.status as StatutoryVersionDto['status'],
    workflowId: r.workflow_id, isActive: r.is_active,
    createdBy: r.created_by, approvedBy: r.approved_by,
    activatedBy: r.activated_by, activatedAt: r.activated_at,
    retiredBy: r.retired_by, retiredAt: r.retired_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toNisDto(r: DbNisRow): NisClassRow {
  return {
    id: r.id, statutoryVersionId: r.statutory_version_id, classNo: r.class_no,
    weeklyMin: Number(r.weekly_min), weeklyMax: r.weekly_max !== null ? Number(r.weekly_max) : null,
    employeeWeekly: Number(r.employee_weekly), employerWeekly: Number(r.employer_weekly),
    createdAt: r.created_at,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listStatutoryVersions(opts: {
  jurisdiction?: string;
  status?: string;
  activeOnly?: boolean;
} = {}): Promise<StatutoryVersionDto[]> {
  let q = sb.from('finance_statutory_versions').select('*')
    .order('effective_from', { ascending: false });
  if (opts.jurisdiction) q = q.eq('jurisdiction', opts.jurisdiction);
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listStatutoryVersions: ' + error.message), { status: 500 });
  return ((data ?? []) as DbVersionRow[]).map(toVersionDto);
}

// ── Get single ────────────────────────────────────────────────────────────────

export async function getStatutoryVersion(id: string): Promise<StatutoryVersionDto | null> {
  const { data, error } = await sb.from('finance_statutory_versions')
    .select('*').eq('id', id).maybeSingle<DbVersionRow>();
  if (error) throw Object.assign(new Error('getStatutoryVersion: ' + error.message), { status: 500 });
  return data ? toVersionDto(data) : null;
}

/** Load the currently active version for a jurisdiction. */
export async function getActiveStatutoryVersion(jurisdiction = 'TT'): Promise<StatutoryVersionDto | null> {
  const { data } = await sb.from('finance_statutory_versions')
    .select('*').eq('jurisdiction', jurisdiction).eq('is_active', true)
    .maybeSingle<DbVersionRow>();
  return data ? toVersionDto(data) : null;
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateStatutoryVersionInput {
  effectiveFrom: string;
  label: string;
  jurisdiction?: string;
  currency?: string;
  payePersonalAllowance: number;
  payeBand1Ceiling: number;
  payeBand1Rate: number;
  payeBand2Rate: number;
  hsMonthlyThreshold: number;
  hsWeeklyHigh: number;
  hsWeeklyLow: number;
  nisMonthyCeiling?: number | null;
  actorId: string;
}

export async function createStatutoryVersion(
  input: CreateStatutoryVersionInput,
): Promise<StatutoryVersionDto> {
  const patch = {
    effective_from: input.effectiveFrom,
    label: input.label,
    jurisdiction: input.jurisdiction ?? 'TT',
    currency: input.currency ?? 'TTD',
    paye_personal_allowance: input.payePersonalAllowance,
    paye_band1_ceiling: input.payeBand1Ceiling,
    paye_band1_rate: input.payeBand1Rate,
    paye_band2_rate: input.payeBand2Rate,
    hs_monthly_threshold: input.hsMonthlyThreshold,
    hs_weekly_high: input.hsWeeklyHigh,
    hs_weekly_low: input.hsWeeklyLow,
    nis_monthly_ceiling: input.nisMonthyCeiling ?? null,
    status: 'draft' as const,
    is_active: false,
    created_by: input.actorId,
  };

  const { data, error } = await sb.from('finance_statutory_versions').insert(patch).select().single<DbVersionRow>();
  if (error) {
    if (error.code === '23505') throw Object.assign(new Error('A statutory version with this effective date and jurisdiction already exists.'), { status: 409 });
    throw Object.assign(new Error('createStatutoryVersion: ' + error.message), { status: 500 });
  }
  const row = toVersionDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_statutory', recordId: row.id, actorId: input.actorId,
    action: 'statutory_version.created',
    previousState: null, newState: { status: 'draft', effectiveFrom: row.effectiveFrom },
  });
  void emitAppEvent({
    eventType: 'finance.statutory.version.created',
    sourceModule: 'finance_statutory', sourceEntityType: 'statutory_version', sourceEntityId: row.id,
    actorUserId: input.actorId, severity: 'info',
    payload: { effectiveFrom: row.effectiveFrom, jurisdiction: row.jurisdiction },
  });

  return row;
}

// ── Update (draft only) ───────────────────────────────────────────────────────

export interface UpdateStatutoryVersionInput {
  id: string;
  label?: string;
  payePersonalAllowance?: number;
  payeBand1Ceiling?: number;
  payeBand1Rate?: number;
  payeBand2Rate?: number;
  hsMonthlyThreshold?: number;
  hsWeeklyHigh?: number;
  hsWeeklyLow?: number;
  nisMonthyCeiling?: number | null;
  actorId: string;
}

export async function updateStatutoryVersion(
  input: UpdateStatutoryVersionInput,
): Promise<StatutoryVersionDto> {
  const existing = await getStatutoryVersion(input.id);
  if (!existing) throw Object.assign(new Error('Statutory version not found.'), { status: 404 });
  if (existing.status !== 'draft') {
    throw Object.assign(new Error('Only draft statutory versions can be updated.'), { status: 422 });
  }

  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) patch['label'] = input.label;
  if (input.payePersonalAllowance !== undefined) patch['paye_personal_allowance'] = input.payePersonalAllowance;
  if (input.payeBand1Ceiling !== undefined) patch['paye_band1_ceiling'] = input.payeBand1Ceiling;
  if (input.payeBand1Rate !== undefined) patch['paye_band1_rate'] = input.payeBand1Rate;
  if (input.payeBand2Rate !== undefined) patch['paye_band2_rate'] = input.payeBand2Rate;
  if (input.hsMonthlyThreshold !== undefined) patch['hs_monthly_threshold'] = input.hsMonthlyThreshold;
  if (input.hsWeeklyHigh !== undefined) patch['hs_weekly_high'] = input.hsWeeklyHigh;
  if (input.hsWeeklyLow !== undefined) patch['hs_weekly_low'] = input.hsWeeklyLow;
  if (input.nisMonthyCeiling !== undefined) patch['nis_monthly_ceiling'] = input.nisMonthyCeiling;

  const { data, error } = await sb.from('finance_statutory_versions').update(patch).eq('id', input.id).select().single<DbVersionRow>();
  if (error) throw Object.assign(new Error('updateStatutoryVersion: ' + error.message), { status: 500 });
  const row = toVersionDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_statutory', recordId: row.id, actorId: input.actorId,
    action: 'statutory_version.updated',
    previousState: existing, newState: row,
  });

  return row;
}

// ── Submit (draft → pending_approval, starts workflow) ────────────────────────

export async function submitStatutoryVersion(
  id: string,
  actorId: string,
): Promise<StatutoryVersionDto> {
  const existing = await getStatutoryVersion(id);
  if (!existing) throw Object.assign(new Error('Statutory version not found.'), { status: 404 });
  if (existing.status !== 'draft') {
    throw Object.assign(new Error('Only draft statutory versions can be submitted for approval.'), { status: 422 });
  }

  // Update to pending_approval
  const { data, error } = await sb.from('finance_statutory_versions')
    .update({ status: 'pending_approval' })
    .eq('id', id).select().single<DbVersionRow>();
  if (error) throw Object.assign(new Error('submitStatutoryVersion: ' + error.message), { status: 500 });
  const row = toVersionDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_statutory', recordId: id, actorId,
    action: 'statutory_version.submitted',
    previousState: { status: 'draft' }, newState: { status: 'pending_approval' },
  });

  // Start workflow via central engine
  const ctx: ModuleWorkflowContext = {
    moduleKey: 'finance_statutory',
    workflowType: 'finance_statutory_approval',
    triggerEvent: 'finance.statutory.version.submitted',
    sourceRecordId: id,
    sourceRecordRef: `SV-${id.slice(0, 8).toUpperCase()}`,
    requestedBy: actorId,
    priority: 'normal',
    recordData: { effectiveFrom: existing.effectiveFrom, jurisdiction: existing.jurisdiction, label: existing.label },
  };

  try {
    const wf = await startWorkflowForRecord({ context: ctx, actor: { id: actorId } });
    if (wf?.id) {
      await sb.from('finance_statutory_versions').update({ workflow_id: wf.id }).eq('id', id);
    }
  } catch (wfErr) {
    // Workflow engine failure rolls back to draft so the user can retry
    await sb.from('finance_statutory_versions').update({ status: 'draft' }).eq('id', id);
    throw Object.assign(
      new Error('Workflow start failed — version rolled back to draft: ' + String(wfErr)),
      { status: 500 },
    );
  }

  void emitAppEvent({
    eventType: 'finance.statutory.version.submitted',
    sourceModule: 'finance_statutory', sourceEntityType: 'statutory_version', sourceEntityId: id,
    actorUserId: actorId, severity: 'info',
    payload: { effectiveFrom: existing.effectiveFrom, jurisdiction: existing.jurisdiction },
  });

  return row;
}

// ── Approve (workflow adapter calls this; also direct route for tests) ────────
// The workflow adapter (financeStatutoryAdapter.ts) calls approveStatutoryVersion
// after the central engine makes the decision. Route-level approve just delegates.

export async function approveStatutoryVersion(
  id: string,
  actorId: string,
): Promise<StatutoryVersionDto> {
  const existing = await getStatutoryVersion(id);
  if (!existing) throw Object.assign(new Error('Statutory version not found.'), { status: 404 });
  if (existing.status !== 'pending_approval') {
    throw Object.assign(new Error('Only pending_approval statutory versions can be approved.'), { status: 422 });
  }

  // Segregation of duties: creator cannot approve
  assertDifferentApprover({ actorId, createdBy: existing.createdBy, action: 'approve a statutory version they created' });

  const { data, error } = await sb.from('finance_statutory_versions')
    .update({ status: 'approved', approved_by: actorId })
    .eq('id', id).select().single<DbVersionRow>();
  if (error) throw Object.assign(new Error('approveStatutoryVersion: ' + error.message), { status: 500 });
  const row = toVersionDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_statutory', recordId: id, actorId,
    action: 'statutory_version.approved',
    previousState: { status: 'pending_approval' }, newState: { status: 'approved' },
  });
  void emitAppEvent({
    eventType: 'finance.statutory.version.approved',
    sourceModule: 'finance_statutory', sourceEntityType: 'statutory_version', sourceEntityId: id,
    actorUserId: actorId, severity: 'success',
    payload: { effectiveFrom: existing.effectiveFrom },
  });

  return row;
}

// ── Reject ────────────────────────────────────────────────────────────────────

export async function rejectStatutoryVersion(
  id: string,
  actorId: string,
  reason?: string,
): Promise<StatutoryVersionDto> {
  const existing = await getStatutoryVersion(id);
  if (!existing) throw Object.assign(new Error('Statutory version not found.'), { status: 404 });
  if (existing.status !== 'pending_approval') {
    throw Object.assign(new Error('Only pending_approval statutory versions can be rejected.'), { status: 422 });
  }

  assertDifferentApprover({ actorId, createdBy: existing.createdBy, action: 'reject a statutory version they created' });

  const { data, error } = await sb.from('finance_statutory_versions')
    .update({ status: 'draft' })
    .eq('id', id).select().single<DbVersionRow>();
  if (error) throw Object.assign(new Error('rejectStatutoryVersion: ' + error.message), { status: 500 });
  const row = toVersionDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_statutory', recordId: id, actorId,
    action: 'statutory_version.rejected',
    previousState: { status: 'pending_approval' }, newState: { status: 'draft' },
    reason: reason ?? null,
  });
  void emitAppEvent({
    eventType: 'finance.statutory.version.rejected',
    sourceModule: 'finance_statutory', sourceEntityType: 'statutory_version', sourceEntityId: id,
    actorUserId: actorId, severity: 'warning',
    payload: { reason: reason ?? null },
  });

  return row;
}

// ── Activate (approved → active; retires prior active for same jurisdiction) ──

export async function activateStatutoryVersion(
  id: string,
  actorId: string,
): Promise<StatutoryVersionDto> {
  const existing = await getStatutoryVersion(id);
  if (!existing) throw Object.assign(new Error('Statutory version not found.'), { status: 404 });
  if (existing.status !== 'approved') {
    throw Object.assign(new Error('Only approved statutory versions can be activated.'), { status: 422 });
  }

  // Segregation of duties: creator cannot activate
  assertDifferentApprover({ actorId, createdBy: existing.createdBy, action: 'activate a statutory version they created' });

  const now = new Date().toISOString();

  // Retire any current active version for this jurisdiction (one-active-per-jurisdiction)
  const { data: priorActive } = await sb.from('finance_statutory_versions')
    .select('id').eq('jurisdiction', existing.jurisdiction).eq('is_active', true)
    .neq('id', id);
  if (priorActive && priorActive.length > 0) {
    const priorIds = (priorActive as { id: string }[]).map(r => r.id);
    await sb.from('finance_statutory_versions').update({
      is_active: false, status: 'retired', retired_by: actorId, retired_at: now,
    }).in('id', priorIds);
    for (const priorId of priorIds) {
      await writeHrAudit({
        submoduleKey: 'finance_statutory', recordId: priorId, actorId,
        action: 'statutory_version.retired_by_activation',
        previousState: { status: 'active', isActive: true }, newState: { status: 'retired', isActive: false },
      });
    }
  }

  // Activate this version
  const { data, error } = await sb.from('finance_statutory_versions')
    .update({ status: 'active', is_active: true, activated_by: actorId, activated_at: now })
    .eq('id', id).select().single<DbVersionRow>();
  if (error) throw Object.assign(new Error('activateStatutoryVersion: ' + error.message), { status: 500 });
  const row = toVersionDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_statutory', recordId: id, actorId,
    action: 'statutory_version.activated',
    previousState: { status: 'approved', isActive: false }, newState: { status: 'active', isActive: true },
  });
  void emitAppEvent({
    eventType: 'finance.statutory.version.activated',
    sourceModule: 'finance_statutory', sourceEntityType: 'statutory_version', sourceEntityId: id,
    actorUserId: actorId, severity: 'success',
    payload: { effectiveFrom: existing.effectiveFrom, jurisdiction: existing.jurisdiction },
  });

  return row;
}

// ── Retire (active → retired, manual) ────────────────────────────────────────

export async function retireStatutoryVersion(
  id: string,
  actorId: string,
): Promise<StatutoryVersionDto> {
  const existing = await getStatutoryVersion(id);
  if (!existing) throw Object.assign(new Error('Statutory version not found.'), { status: 404 });
  if (existing.status !== 'active') {
    throw Object.assign(new Error('Only active statutory versions can be manually retired.'), { status: 422 });
  }

  const now = new Date().toISOString();
  const { data, error } = await sb.from('finance_statutory_versions')
    .update({ status: 'retired', is_active: false, retired_by: actorId, retired_at: now })
    .eq('id', id).select().single<DbVersionRow>();
  if (error) throw Object.assign(new Error('retireStatutoryVersion: ' + error.message), { status: 500 });
  const row = toVersionDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_statutory', recordId: id, actorId,
    action: 'statutory_version.retired',
    previousState: { status: 'active', isActive: true }, newState: { status: 'retired', isActive: false },
  });
  void emitAppEvent({
    eventType: 'finance.statutory.version.retired',
    sourceModule: 'finance_statutory', sourceEntityType: 'statutory_version', sourceEntityId: id,
    actorUserId: actorId, severity: 'info',
    payload: {},
  });

  return row;
}

// ── NIS Classes ───────────────────────────────────────────────────────────────

export async function listNisClasses(statutoryVersionId: string): Promise<NisClassRow[]> {
  const { data, error } = await sb.from('finance_nis_classes')
    .select('*').eq('statutory_version_id', statutoryVersionId)
    .order('class_no');
  if (error) throw Object.assign(new Error('listNisClasses: ' + error.message), { status: 500 });
  return ((data ?? []) as DbNisRow[]).map(toNisDto);
}

export interface UpsertNisClassInput {
  classNo: number;
  weeklyMin: number;
  weeklyMax?: number | null;
  employeeWeekly: number;
  employerWeekly: number;
}

export async function upsertNisClasses(
  statutoryVersionId: string,
  classes: UpsertNisClassInput[],
  actorId: string,
): Promise<NisClassRow[]> {
  // Ensure the version exists and is still editable (draft/approved, not active/retired)
  const version = await getStatutoryVersion(statutoryVersionId);
  if (!version) throw Object.assign(new Error('Statutory version not found.'), { status: 404 });
  if (!['draft', 'approved'].includes(version.status)) {
    throw Object.assign(new Error('NIS classes can only be updated on draft or approved statutory versions.'), { status: 422 });
  }

  const rows = classes.map(c => ({
    statutory_version_id: statutoryVersionId,
    class_no: c.classNo,
    weekly_min: c.weeklyMin,
    weekly_max: c.weeklyMax ?? null,
    employee_weekly: c.employeeWeekly,
    employer_weekly: c.employerWeekly,
  }));

  const { data, error } = await sb.from('finance_nis_classes')
    .upsert(rows, { onConflict: 'statutory_version_id,class_no' })
    .select();
  if (error) throw Object.assign(new Error('upsertNisClasses: ' + error.message), { status: 500 });

  await writeHrAudit({
    submoduleKey: 'finance_statutory', recordId: statutoryVersionId, actorId,
    action: 'statutory_version.nis_classes_updated',
    previousState: null, newState: { count: classes.length },
  });

  return ((data ?? []) as DbNisRow[]).map(toNisDto);
}

// ── Reports: list (minimal — full reports are Phase 3) ────────────────────────

export interface StatutoryReportRow {
  id: string;
  label: string;
  effectiveFrom: string;
  jurisdiction: string;
  status: string;
  isActive: boolean;
  createdAt: string;
}

export async function listStatutoryReport(opts: { jurisdiction?: string } = {}): Promise<StatutoryReportRow[]> {
  let q = sb.from('finance_statutory_versions')
    .select('id, label, effective_from, jurisdiction, status, is_active, created_at')
    .order('effective_from', { ascending: false });
  if (opts.jurisdiction) q = q.eq('jurisdiction', opts.jurisdiction);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listStatutoryReport: ' + error.message), { status: 500 });
  return ((data ?? []) as { id: string; label: string; effective_from: string; jurisdiction: string; status: string; is_active: boolean; created_at: string }[]).map(r => ({
    id: r.id, label: r.label, effectiveFrom: r.effective_from,
    jurisdiction: r.jurisdiction, status: r.status, isActive: r.is_active, createdAt: r.created_at,
  }));
}
