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
import { writeHrAudit } from '../hr/employeeCore';
import { startWorkflowForRecord } from '../workflow/service';
import { emitFinanceMutationBackbone } from './backbone';
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
  /** Number of payroll runs that reference this version. Populated by listStatutoryVersions. */
  linkedPayrollRunCount?: number;
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

export interface ApprovalTimelineEntry {
  id: string;
  action: string;
  actorId: string;
  reason: string | null;
  previousState: unknown;
  newState: unknown;
  createdAt: string;
}

export interface StatutoryVersionDetail extends StatutoryVersionDto {
  nisClasses: NisClassRow[];
  approvalTimeline: ApprovalTimelineEntry[];
  linkedPayrollRunCount: number;
}

export interface NisClassImportRow {
  classNo: number;
  weeklyMin: number;
  weeklyMax?: number | null;
  employeeWeekly: number;
  employerWeekly: number;
}

export interface NisClassImportResult {
  imported: number;
  errors: Array<{ row: number; message: string }>;
}

export interface StatutoryReportResult {
  report: string;
  generatedAt: string;
  rows: Record<string, unknown>[];
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

  // Batch-load payroll run counts alongside the version list (§11 register column).
  const [versionsResult, runsResult] = await Promise.all([
    q,
    sb.from('finance_payroll_runs').select('statutory_version_id'),
  ]);
  if (versionsResult.error) throw Object.assign(new Error('listStatutoryVersions: ' + versionsResult.error.message), { status: 500 });

  // Build run-count map. Silently fall back to zero if the table doesn't exist yet.
  const runCountMap = new Map<string, number>();
  if (!runsResult.error) {
    for (const run of (runsResult.data ?? []) as { statutory_version_id: string }[]) {
      runCountMap.set(run.statutory_version_id, (runCountMap.get(run.statutory_version_id) ?? 0) + 1);
    }
  }

  return ((versionsResult.data ?? []) as DbVersionRow[]).map(r => ({
    ...toVersionDto(r),
    linkedPayrollRunCount: runCountMap.get(r.id) ?? 0,
  }));
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

  // Backbone: audit (mandatory). createStatutoryVersion is a draft create — no notification/thread needed yet.
  // Compensating rollback: delete the version row if backbone throws.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: input.actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: row.id,
      eventType: 'finance.statutory.version.created',
      auditAction: 'statutory_version.created',
      previousState: null,
      newState: { status: 'draft', effectiveFrom: row.effectiveFrom },
      severity: 'info',
      metadata: { effectiveFrom: row.effectiveFrom, jurisdiction: row.jurisdiction },
    });
  } catch (backboneErr) {
    try { await sb.from('finance_statutory_versions').delete().eq('id', row.id); } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }

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

  // Backbone: audit (mandatory) + app_event. On failure, compensating rollback reverts
  // the update to the pre-update state so the DB is never left updated-without-audit.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: input.actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: row.id,
      eventType: 'finance.statutory.version.updated',
      auditAction: 'statutory_version.updated',
      previousState: {
        label: existing.label,
        payePersonalAllowance: existing.payePersonalAllowance,
        payeBand1Rate: existing.payeBand1Rate,
        payeBand2Rate: existing.payeBand2Rate,
      },
      newState: {
        label: row.label,
        payePersonalAllowance: row.payePersonalAllowance,
        payeBand1Rate: row.payeBand1Rate,
        payeBand2Rate: row.payeBand2Rate,
      },
      severity: 'info',
      metadata: { effectiveFrom: row.effectiveFrom, jurisdiction: row.jurisdiction },
    });
  } catch (backboneErr) {
    // Compensating rollback: revert all patched fields to the pre-update state.
    try {
      await sb.from('finance_statutory_versions').update({
        label: existing.label,
        paye_personal_allowance: existing.payePersonalAllowance,
        paye_band1_ceiling: existing.payeBand1Ceiling,
        paye_band1_rate: existing.payeBand1Rate,
        paye_band2_rate: existing.payeBand2Rate,
        hs_monthly_threshold: existing.hsMonthlyThreshold,
        hs_weekly_high: existing.hsWeeklyHigh,
        hs_weekly_low: existing.hsWeeklyLow,
        nis_monthly_ceiling: existing.nisMonthyCeiling,
      }).eq('id', input.id);
    } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }

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

  // Backbone: audit (mandatory) + notification to approvers that a version needs review.
  // Compensating rollback: revert status to draft if backbone throws.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: id,
      eventType: 'finance.statutory.version.submitted',
      auditAction: 'statutory_version.submitted',
      previousState: { status: 'draft' },
      newState: { status: 'pending_approval' },
      severity: 'info',
      metadata: { effectiveFrom: existing.effectiveFrom, jurisdiction: existing.jurisdiction },
      notification: {
        title: `Statutory version "${existing.label}" submitted for approval`,
        body: `Effective from ${existing.effectiveFrom}. A finance manager must review and approve.`,
        actionRoute: '/finance/statutory',
        type: 'finance.statutory.version.submitted',
        severity: 'info',
      },
    });
  } catch (backboneErr) {
    try { await sb.from('finance_statutory_versions').update({ status: 'draft' }).eq('id', id); } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }

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

  // Backbone: audit (mandatory) + notification + config thread per §8.1.
  // On failure, compensating rollback resets to pending_approval.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: id,
      eventType: 'finance.statutory.version.approved',
      auditAction: 'statutory_version.approved',
      previousState: { status: 'pending_approval' },
      newState: { status: 'approved' },
      severity: 'success',
      notification: {
        title: `Statutory version "${row.label}" approved`,
        body: `Effective from ${row.effectiveFrom}. Payroll administrators should review configuration before the next pay run.`,
        actionRoute: '/finance/statutory',
        type: 'finance.statutory.version.approved',
        severity: 'success',
      },
      messageThread: {
        subject: `Statutory config update: ${row.label}`,
        participantUserIds: [
          actorId,
          ...(existing.createdBy && existing.createdBy !== actorId ? [existing.createdBy] : []),
        ],
        body: `Statutory version "${row.label}" (effective ${row.effectiveFrom}, jurisdiction ${row.jurisdiction}) has been approved. Payroll administrators should review the new rate structure before the next pay run.`,
      },
      // §8.1 matrix: 'Statutory version approved' → payroll config update handoff.
      // CRITICAL — throws on failure; compensating rollback above reverts the approval.
      handoff: {
        targetModule: 'finance_payroll',
        targetEntityType: 'statutory_version',
        payload: {
          action: 'statutory_version_approved',
          statutoryVersionId: id,
          label: row.label,
          effectiveFrom: row.effectiveFrom,
          jurisdiction: row.jurisdiction,
          approvedBy: actorId,
        },
      },
    });
  } catch (backboneErr) {
    // Compensating rollback: revert to pending_approval.
    try {
      await sb.from('finance_statutory_versions')
        .update({ status: 'pending_approval', approved_by: null })
        .eq('id', id);
    } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }

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

  // Backbone: audit (mandatory) + notification to the creator that their submission was rejected.
  // Compensating rollback: revert status to pending_approval if backbone throws.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: id,
      eventType: 'finance.statutory.version.rejected',
      auditAction: 'statutory_version.rejected',
      previousState: { status: 'pending_approval' },
      newState: { status: 'draft' },
      reason: reason ?? null,
      severity: 'warning',
      notification: {
        title: `Statutory version "${row.label}" returned to draft`,
        body: reason ? `Reason: ${reason}` : 'The approving manager has returned this version to draft for revision.',
        actionRoute: '/finance/statutory',
        type: 'finance.statutory.version.rejected',
        severity: 'warning',
        ...(existing.createdBy ? { recipientUserIds: [existing.createdBy] } : {}),
      },
      messageThread: {
        subject: `Statutory version "${row.label}" rejected`,
        participantUserIds: [
          actorId,
          ...(existing.createdBy && existing.createdBy !== actorId ? [existing.createdBy] : []),
        ],
        body: `Statutory version "${row.label}" (effective ${row.effectiveFrom}) was returned to draft by the approver.${reason ? `\n\nReason: ${reason}` : ''}`,
      },
    });
  } catch (backboneErr) {
    try { await sb.from('finance_statutory_versions').update({ status: 'pending_approval' }).eq('id', id); } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }

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

  // Backbone: audit (mandatory) + notification (payroll should know the active version changed).
  // Compensating rollback: revert this version to approved if backbone throws.
  // NOTE: prior active versions already retired above cannot be automatically restored here
  // without a transactional RPC. That is acceptable per the compensating-rollback rule.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: id,
      eventType: 'finance.statutory.version.activated',
      auditAction: 'statutory_version.activated',
      previousState: { status: 'approved', isActive: false },
      newState: { status: 'active', isActive: true },
      severity: 'success',
      metadata: { effectiveFrom: existing.effectiveFrom, jurisdiction: existing.jurisdiction },
      notification: {
        title: `Statutory version "${row.label}" is now active`,
        body: `Effective from ${row.effectiveFrom}. All new payroll runs for ${row.jurisdiction} will use these rates.`,
        actionRoute: '/finance/statutory',
        type: 'finance.statutory.version.activated',
        severity: 'success',
      },
    });
  } catch (backboneErr) {
    try {
      await sb.from('finance_statutory_versions')
        .update({ status: 'approved', is_active: false, activated_by: null, activated_at: null })
        .eq('id', id);
    } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }

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

  // Backbone: audit (mandatory) + notification that the active version has been retired.
  // Compensating rollback: revert to active if backbone throws.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: id,
      eventType: 'finance.statutory.version.retired',
      auditAction: 'statutory_version.retired',
      previousState: { status: 'active', isActive: true },
      newState: { status: 'retired', isActive: false },
      severity: 'info',
      notification: {
        title: `Statutory version "${row.label}" has been retired`,
        body: 'No version is now active for this jurisdiction. A new version must be activated before payroll runs.',
        actionRoute: '/finance/statutory',
        type: 'finance.statutory.version.retired',
        severity: 'warning',
      },
    });
  } catch (backboneErr) {
    try {
      await sb.from('finance_statutory_versions')
        .update({ status: 'active', is_active: true, retired_by: null, retired_at: null })
        .eq('id', id);
    } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }

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

  const classNos = classes.map(c => c.classNo);

  // Capture pre-existing rows for those class numbers (compensating rollback snapshot).
  const { data: preExisting } = await sb
    .from('finance_nis_classes')
    .select('id, statutory_version_id, class_no, weekly_min, weekly_max, employee_weekly, employer_weekly')
    .eq('statutory_version_id', statutoryVersionId)
    .in('class_no', classNos);

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

  // Backbone: audit (mandatory). On failure, compensating rollback undoes the upsert.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: statutoryVersionId,
      eventType: 'finance.statutory.nis_classes.updated',
      auditAction: 'statutory_version.nis_classes_updated',
      newState: { count: classes.length },
    });
  } catch (backboneErr) {
    // Compensating rollback: delete the upserted rows, restore pre-existing ones.
    try {
      await sb.from('finance_nis_classes')
        .delete()
        .eq('statutory_version_id', statutoryVersionId)
        .in('class_no', classNos);
      if ((preExisting ?? []).length > 0) {
        await sb.from('finance_nis_classes').insert(preExisting!);
      }
    } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }

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

// ── Typed report runner (Wave 2B) ─────────────────────────────────────────────

export async function runStatutoryReport(
  report: 'statutory_version_summary' | 'nis_class_summary' | 'pay_component_map' | 'statutory_approval_history',
  opts: { jurisdiction?: string; versionId?: string } = {},
): Promise<StatutoryReportResult> {
  const now = new Date().toISOString();

  if (report === 'statutory_version_summary') {
    let q = sb
      .from('finance_statutory_versions')
      .select('id, label, effective_from, jurisdiction, status, is_active, approved_by, activated_by, created_by, created_at')
      .order('effective_from', { ascending: false });
    if (opts.jurisdiction) q = q.eq('jurisdiction', opts.jurisdiction);
    const { data, error } = await q;
    if (error) throw Object.assign(new Error('runStatutoryReport: ' + error.message), { status: 500 });
    return {
      report, generatedAt: now,
      rows: ((data ?? []) as Record<string, unknown>[]).map(r => ({
        id: r['id'], label: r['label'], effectiveFrom: r['effective_from'],
        jurisdiction: r['jurisdiction'], status: r['status'], isActive: r['is_active'],
        approvedBy: r['approved_by'], activatedBy: r['activated_by'],
        createdBy: r['created_by'], createdAt: r['created_at'],
      })),
    };
  }

  if (report === 'nis_class_summary') {
    let q = sb
      .from('finance_nis_classes')
      .select('id, statutory_version_id, class_no, weekly_min, weekly_max, employee_weekly, employer_weekly, created_at')
      .order('class_no');
    if (opts.versionId) q = q.eq('statutory_version_id', opts.versionId);
    const { data, error } = await q;
    if (error) throw Object.assign(new Error('runStatutoryReport (nis_class_summary): ' + error.message), { status: 500 });
    return {
      report, generatedAt: now,
      rows: ((data ?? []) as Record<string, unknown>[]).map(r => ({
        id: r['id'], versionId: r['statutory_version_id'], classNo: r['class_no'],
        weeklyMin: r['weekly_min'], weeklyMax: r['weekly_max'],
        employeeWeekly: r['employee_weekly'], employerWeekly: r['employer_weekly'],
        createdAt: r['created_at'],
      })),
    };
  }

  if (report === 'pay_component_map') {
    const { data, error } = await sb
      .from('finance_pay_components')
      .select('id, code, name, kind, is_statutory, is_taxable, reduces_chargeable, is_active, created_at')
      .order('kind').order('name');
    if (error) throw Object.assign(new Error('runStatutoryReport (pay_component_map): ' + error.message), { status: 500 });
    return {
      report, generatedAt: now,
      rows: ((data ?? []) as Record<string, unknown>[]).map(r => ({
        id: r['id'], code: r['code'], name: r['name'], kind: r['kind'],
        isStatutory: r['is_statutory'], isTaxable: r['is_taxable'],
        reducesChargeable: r['reduces_chargeable'], isActive: r['is_active'],
        createdAt: r['created_at'],
      })),
    };
  }

  // statutory_approval_history
  let q2 = sb
    .from('hr_audit_log')
    .select('id, action, actor_id, record_id, reason, created_at')
    .eq('submodule_key', 'finance_statutory')
    .order('created_at', { ascending: false })
    .limit(500);
  if (opts.versionId) q2 = q2.eq('record_id', opts.versionId);
  const { data: auditData, error: auditErr } = await q2;
  if (auditErr) throw Object.assign(new Error('runStatutoryReport (approval_history): ' + auditErr.message), { status: 500 });
  return {
    report, generatedAt: now,
    rows: ((auditData ?? []) as Record<string, unknown>[]).map(r => ({
      id: r['id'], action: r['action'], actorId: r['actor_id'],
      versionId: r['record_id'], reason: r['reason'], createdAt: r['created_at'],
    })),
  };
}

// ── Delete NIS class (draft versions only) — Wave 2B ──────────────────────────

export async function deleteNisClass(id: string, actorId: string): Promise<void> {
  // Fetch the full row up-front so we have data for the compensating re-insert if backbone fails.
  const { data: cls, error: getErr } = await sb
    .from('finance_nis_classes')
    .select('id, class_no, statutory_version_id, weekly_min, weekly_max, employee_weekly, employer_weekly')
    .eq('id', id)
    .maybeSingle<{
      id: string; class_no: number; statutory_version_id: string;
      weekly_min: number; weekly_max: number | null;
      employee_weekly: number; employer_weekly: number;
    }>();
  if (getErr) throw Object.assign(new Error('deleteNisClass: ' + getErr.message), { status: 500 });
  if (!cls) throw Object.assign(new Error('NIS class not found.'), { status: 404 });

  const version = await getStatutoryVersion(cls.statutory_version_id);
  if (!version) throw Object.assign(new Error('Statutory version not found.'), { status: 404 });
  if (version.status !== 'draft') {
    throw Object.assign(new Error('NIS classes can only be deleted from draft statutory versions.'), { status: 422 });
  }

  const { error } = await sb.from('finance_nis_classes').delete().eq('id', id);
  if (error) throw Object.assign(new Error('deleteNisClass: ' + error.message), { status: 500 });

  // Backbone: audit (mandatory). On failure, compensating rollback re-inserts the deleted row.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: cls.statutory_version_id,
      eventType: 'finance.statutory.nis_class.deleted',
      auditAction: 'nis_class.deleted',
      newState: { classNo: cls.class_no, deletedId: id },
    });
  } catch (backboneErr) {
    // Compensating rollback: restore the deleted row so state is consistent.
    try {
      await sb.from('finance_nis_classes').insert({
        id: cls.id,
        statutory_version_id: cls.statutory_version_id,
        class_no: cls.class_no,
        weekly_min: cls.weekly_min,
        weekly_max: cls.weekly_max,
        employee_weekly: cls.employee_weekly,
        employer_weekly: cls.employer_weekly,
      });
    } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }
}

// ── Bulk-import NIS classes (draft versions only) — Wave 2B ──────────────────

export async function importNisClasses(
  statutoryVersionId: string,
  rows: NisClassImportRow[],
  actorId: string,
): Promise<NisClassImportResult> {
  const version = await getStatutoryVersion(statutoryVersionId);
  if (!version) throw Object.assign(new Error('Statutory version not found.'), { status: 404 });
  if (version.status !== 'draft') {
    throw Object.assign(new Error('NIS classes can only be imported into draft statutory versions.'), { status: 422 });
  }

  const errors: Array<{ row: number; message: string }> = [];
  const seenClassNos = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const rowIdx = i + 1;
    if (!Number.isFinite(r.classNo) || r.classNo < 1 || !Number.isInteger(r.classNo)) {
      errors.push({ row: rowIdx, message: `Row ${rowIdx}: classNo must be a positive integer` });
      continue;
    }
    if (seenClassNos.has(r.classNo)) {
      errors.push({ row: rowIdx, message: `Row ${rowIdx}: duplicate classNo ${r.classNo}` });
      continue;
    }
    seenClassNos.add(r.classNo);
    if (!Number.isFinite(r.weeklyMin) || r.weeklyMin < 0) {
      errors.push({ row: rowIdx, message: `Row ${rowIdx}: weeklyMin must be ≥ 0` });
    }
    if (r.weeklyMax != null && (!Number.isFinite(r.weeklyMax) || r.weeklyMax < r.weeklyMin)) {
      errors.push({ row: rowIdx, message: `Row ${rowIdx}: weeklyMax must be ≥ weeklyMin` });
    }
    if (!Number.isFinite(r.employeeWeekly) || r.employeeWeekly < 0) {
      errors.push({ row: rowIdx, message: `Row ${rowIdx}: employeeWeekly must be ≥ 0` });
    }
    if (!Number.isFinite(r.employerWeekly) || r.employerWeekly < 0) {
      errors.push({ row: rowIdx, message: `Row ${rowIdx}: employerWeekly must be ≥ 0` });
    }
  }

  if (errors.length > 0) return { imported: 0, errors };

  // Capture pre-existing rows for those class numbers (compensating rollback snapshot).
  const importClassNos = rows.map(r => r.classNo);
  const { data: preExisting } = await sb
    .from('finance_nis_classes')
    .select('id, statutory_version_id, class_no, weekly_min, weekly_max, employee_weekly, employer_weekly')
    .eq('statutory_version_id', statutoryVersionId)
    .in('class_no', importClassNos);

  const dbRows = rows.map(r => ({
    statutory_version_id: statutoryVersionId,
    class_no: r.classNo,
    weekly_min: r.weeklyMin,
    weekly_max: r.weeklyMax ?? null,
    employee_weekly: r.employeeWeekly,
    employer_weekly: r.employerWeekly,
  }));

  const { error } = await sb
    .from('finance_nis_classes')
    .upsert(dbRows, { onConflict: 'statutory_version_id,class_no' });
  if (error) throw Object.assign(new Error('importNisClasses: ' + error.message), { status: 500 });

  // Backbone: audit (mandatory). On failure, compensating rollback undoes the import.
  try {
    await emitFinanceMutationBackbone({
      actorUserId: actorId,
      module: 'finance_statutory',
      entityType: 'statutory_version',
      entityId: statutoryVersionId,
      eventType: 'finance.statutory.nis_classes.imported',
      auditAction: 'nis_classes.imported',
      newState: { count: rows.length },
    });
  } catch (backboneErr) {
    // Compensating rollback: delete the imported rows, restore pre-existing ones.
    try {
      await sb.from('finance_nis_classes')
        .delete()
        .eq('statutory_version_id', statutoryVersionId)
        .in('class_no', importClassNos);
      if ((preExisting ?? []).length > 0) {
        await sb.from('finance_nis_classes').insert(preExisting!);
      }
    } catch (_) { /* best-effort rollback */ }
    throw backboneErr;
  }

  return { imported: rows.length, errors: [] };
}

// ── Approval / lifecycle timeline — Wave 2B ────────────────────────────────────

export async function getApprovalTimeline(versionId: string): Promise<ApprovalTimelineEntry[]> {
  const { data, error } = await sb
    .from('hr_audit_log')
    .select('id, action, actor_id, reason, previous_state, new_state, created_at')
    .eq('submodule_key', 'finance_statutory')
    .eq('record_id', versionId)
    .order('created_at', { ascending: true });
  if (error) throw Object.assign(new Error('getApprovalTimeline: ' + error.message), { status: 500 });
  return ((data ?? []) as {
    id: string; action: string; actor_id: string; reason: string | null;
    previous_state: unknown; new_state: unknown; created_at: string;
  }[]).map(r => ({
    id: r.id, action: r.action, actorId: r.actor_id, reason: r.reason,
    previousState: r.previous_state, newState: r.new_state, createdAt: r.created_at,
  }));
}

// ── Rate version detail — Wave 2B ──────────────────────────────────────────────

export async function getRateVersionDetail(id: string): Promise<StatutoryVersionDetail | null> {
  const version = await getStatutoryVersion(id);
  if (!version) return null;

  const [nisClasses, approvalTimeline, linkedRunsResult] = await Promise.all([
    listNisClasses(id),
    getApprovalTimeline(id),
    sb
      .from('finance_payroll_runs')
      .select('id', { count: 'exact', head: true })
      .eq('statutory_version_id', id),
  ]);

  return {
    ...version,
    nisClasses,
    approvalTimeline,
    linkedPayrollRunCount: linkedRunsResult.count ?? 0,
  };
}
