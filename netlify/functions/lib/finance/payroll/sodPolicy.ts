// ============================================================================
// Finance — Payroll Segregation-of-Duties (SoD) Policy
// ============================================================================
// The payroll release chain used to hardcode a 4-way SoD. The level is now a
// governed, versioned policy:
//
//   level 2 -> funder/releaser must differ from the preparer
//   level 3 -> ... and from the approver              (default)
//   level 4 -> ... and from the certifier             (previous behaviour)
//
// The level is SNAPSHOTTED onto each run at creation
// (finance_payroll_runs.sod_level, via a column default), so changing the policy
// never switches the rules on an in-flight run. Enforcement itself lives in the
// funding/release RPCs — this module only governs the policy value.
//
// Changing the level is maker-checker + workflow governed: propose -> a DIFFERENT
// authorised approver approves -> the new level activates for future runs. The
// supersede+activate step commits inside ONE database transaction
// (finance_payroll_sod_policy_approve_tx) because supabase-js cannot make two
// PostgREST calls atomic.
//
// Permissions:
//   finance.payroll.sod_policy.view         — read active policy + history
//   finance.payroll.sod_policy.propose      — open a proposal
//   finance.payroll.sod_policy.approve      — approve someone else's proposal
//   finance.payroll.sod_policy.manage_roles — SUPERADMIN-ONLY: edit eligible roles
// ============================================================================

import { sb } from '../../db';
import { emitAppEvent } from '../../appEvents';
import { writeHrAudit } from '../../hr/employeeCore';
import { startWorkflowForRecord } from '../../workflow/service';
import type { ModuleWorkflowContext } from '../../workflow/definitionTypes';

const SUBMODULE = 'finance_payroll_sod_policy';

/** The only levels the database CHECK constraint accepts. */
export const SOD_LEVELS = [2, 3, 4] as const;
export type SodLevel = (typeof SOD_LEVELS)[number];

export interface SodPolicyRow {
  id: string;
  sodLevel: SodLevel;
  status: 'draft' | 'pending_approval' | 'active' | 'superseded';
  eligibleRoles: string[];
  reason: string | null;
  proposedBy: string | null;
  approvedBy: string | null;
  workflowId: string | null;
  supersedesId: string | null;
  effectiveAt: string | null;
  createdAt: string;
}

export interface SodPolicyOverview {
  active: SodPolicyRow | null;
  pending: SodPolicyRow | null;
  history: SodPolicyRow[];
  /** Levels the UI may offer. The floor is 2 — SoD cannot be switched off. */
  levels: readonly number[];
}

interface DbRow {
  id: string;
  sod_level: number;
  status: string;
  eligible_roles: string[] | null;
  reason: string | null;
  proposed_by: string | null;
  approved_by: string | null;
  workflow_id: string | null;
  supersedes_id: string | null;
  effective_at: string | null;
  created_at: string;
}

function err(message: string, status = 500, code?: string): Error & { status: number; code?: string } {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function toRow(r: DbRow): SodPolicyRow {
  return {
    id: r.id,
    sodLevel: r.sod_level as SodLevel,
    status: r.status as SodPolicyRow['status'],
    eligibleRoles: r.eligible_roles ?? [],
    reason: r.reason,
    proposedBy: r.proposed_by,
    approvedBy: r.approved_by,
    workflowId: r.workflow_id,
    supersedesId: r.supersedes_id,
    effectiveAt: r.effective_at,
    createdAt: r.created_at,
  };
}

const SELECT = 'id, sod_level, status, eligible_roles, reason, proposed_by, approved_by, workflow_id, supersedes_id, effective_at, created_at';

/** The active policy row (the one new runs snapshot their level from). */
async function activePolicy(): Promise<SodPolicyRow | null> {
  const { data, error } = await sb
    .from('finance_payroll_sod_policy')
    .select(SELECT)
    .eq('status', 'active')
    .maybeSingle<DbRow>();
  if (error) throw err('sodPolicy.active: ' + error.message);
  return data ? toRow(data) : null;
}

/**
 * Whether `role` may propose/approve an SoD change. Superadmin is ALWAYS
 * eligible (the set_roles RPC also guarantees it can never be removed), so the
 * control can never be locked out of itself.
 */
function assertEligible(policy: SodPolicyRow | null, role: string, action: string): void {
  if (role === 'superadmin') return;
  const eligible = policy?.eligibleRoles ?? ['superadmin', 'finance_manager'];
  if (!eligible.includes(role)) {
    throw err(
      `Your role (${role}) is not authorised to ${action} the payroll segregation-of-duties policy.`,
      403, 'sod_policy.role_not_eligible',
    );
  }
}

/** Active policy + open proposal + recent history. */
export async function getSodPolicy(): Promise<SodPolicyOverview> {
  const { data, error } = await sb
    .from('finance_payroll_sod_policy')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw err('sodPolicy.get: ' + error.message);
  const rows = (data ?? []).map(toRow);
  return {
    active:  rows.find(r => r.status === 'active') ?? null,
    pending: rows.find(r => r.status === 'pending_approval') ?? null,
    history: rows.filter(r => r.status === 'superseded'),
    levels:  SOD_LEVELS,
  };
}

/**
 * Open a proposal to change the SoD level. The change does NOT take effect here
 * — a different authorised approver must approve it. One open proposal at a time.
 */
export async function proposeSodChange(input: {
  sodLevel: number;
  reason: string;
  actorId: string;
  actorRole: string;
}): Promise<SodPolicyRow> {
  const level = input.sodLevel;
  if (!SOD_LEVELS.includes(level as SodLevel)) {
    throw err('The segregation-of-duties level must be 2, 3 or 4.', 422, 'sod_policy.invalid_level');
  }
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw err('A reason of at least 10 characters is required for an SoD change.', 422, 'sod_policy.reason_required');
  }

  const current = await activePolicy();
  assertEligible(current, input.actorRole, 'propose a change to');
  if (current && current.sodLevel === level) {
    throw err(`The active policy is already level ${level}.`, 422, 'sod_policy.unchanged');
  }

  const { data: open } = await sb
    .from('finance_payroll_sod_policy')
    .select('id')
    .eq('status', 'pending_approval')
    .maybeSingle<{ id: string }>();
  if (open) {
    throw err('An SoD change is already awaiting approval — decide it before proposing another.',
      409, 'sod_policy.proposal_open');
  }

  const { data, error } = await sb
    .from('finance_payroll_sod_policy')
    .insert({
      sod_level:      level,
      status:         'pending_approval',
      // A level change never alters who may govern the policy.
      eligible_roles: current?.eligibleRoles ?? ['superadmin', 'finance_manager'],
      reason,
      proposed_by:    input.actorId,
    })
    .select(SELECT)
    .single<DbRow>();
  if (error) throw err('sodPolicy.propose: ' + error.message);
  const row = toRow(data);

  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: row.id, actorId: input.actorId,
    action: 'sod_policy.change_proposed',
    previousState: current ? { sodLevel: current.sodLevel } : null,
    newState: { sodLevel: row.sodLevel, reason },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.sod_policy.change_proposed', sourceModule: SUBMODULE,
    sourceEntityType: 'sod_policy', sourceEntityId: row.id,
    actorUserId: input.actorId, severity: 'warning',
    payload: { fromLevel: current?.sodLevel ?? null, toLevel: row.sodLevel, reason },
  });

  // Route the approval through the central workflow engine. If no binding is
  // configured the engine returns null and the proposal still requires an
  // explicit maker-checker approval (enforced in the approve RPC).
  const ctx: ModuleWorkflowContext = {
    moduleKey: 'finance_payroll', workflowType: 'finance_payroll_sod_policy_change',
    triggerEvent: 'finance.payroll.sod_policy.change_proposed',
    sourceRecordId: row.id, sourceRecordRef: `SOD-L${row.sodLevel}`,
    requestedBy: input.actorId, priority: 'high',
    recordData: { fromLevel: current?.sodLevel ?? null, toLevel: row.sodLevel, reason },
  };
  try {
    const wf = await startWorkflowForRecord({ context: ctx, actor: { id: input.actorId } });
    if (wf?.id) {
      await sb.from('finance_payroll_sod_policy').update({ workflow_id: wf.id }).eq('id', row.id);
      row.workflowId = wf.id;
    }
  } catch (wfErr) {
    // Compensating rollback — never leave an un-routed proposal blocking the queue.
    await sb.from('finance_payroll_sod_policy').delete().eq('id', row.id);
    throw err('Workflow start failed — the SoD proposal was rolled back: ' + String(wfErr), 502);
  }
  return row;
}

/**
 * Approve an open proposal: supersede the active policy and activate the
 * proposal, atomically. Maker-checker (proposer != approver) and the status
 * guard are enforced inside the RPC, so a direct API call cannot bypass them.
 */
export async function approveSodChange(input: {
  policyId: string;
  actorId: string;
  actorRole: string;
}): Promise<SodPolicyRow> {
  const current = await activePolicy();
  assertEligible(current, input.actorRole, 'approve a change to');

  const { data, error } = await sb.rpc('finance_payroll_sod_policy_approve_tx', {
    p_policy_id: input.policyId,
    p_actor_id:  input.actorId,
  });
  if (error) {
    const msg = error.message || 'SoD approval failed.';
    const status = /PR403|cannot approve/i.test(msg) ? 403
      : /PR404|not found/i.test(msg) ? 404
      : /PR422|only pending_approval/i.test(msg) ? 422 : 500;
    throw err(msg.replace(/^.*finance_payroll_sod_policy:\s*/, ''), status, 'sod_policy.approve_failed');
  }
  const row = toRow(data as DbRow);

  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: row.id, actorId: input.actorId,
    action: 'sod_policy.change_approved',
    previousState: current ? { sodLevel: current.sodLevel } : null,
    newState: { sodLevel: row.sodLevel, approvedBy: input.actorId },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.sod_policy.change_approved', sourceModule: SUBMODULE,
    sourceEntityType: 'sod_policy', sourceEntityId: row.id,
    actorUserId: input.actorId, severity: 'warning',
    payload: {
      fromLevel: current?.sodLevel ?? null, toLevel: row.sodLevel,
      proposedBy: row.proposedBy, note: 'Applies to runs created after this change; in-flight runs keep their snapshot.',
    },
  });
  return row;
}

/**
 * Replace the list of roles allowed to propose/approve SoD changes.
 * SUPERADMIN-ONLY (route-gated by finance.payroll.sod_policy.manage_roles):
 * a finance_manager must not be able to make itself the sole approver and defeat
 * maker-checker. The RPC additionally guarantees 'superadmin' is always retained.
 */
export async function setSodEligibleRoles(input: {
  roles: string[];
  actorId: string;
}): Promise<SodPolicyRow> {
  const roles = [...new Set(input.roles.map(r => r.trim()).filter(Boolean))];
  if (roles.length === 0) {
    throw err('At least one eligible role is required.', 422, 'sod_policy.roles_required');
  }
  const current = await activePolicy();

  const { data, error } = await sb.rpc('finance_payroll_sod_policy_set_roles_tx', {
    p_roles:    roles,
    p_actor_id: input.actorId,
  });
  if (error) throw err(error.message.replace(/^.*finance_payroll_sod_policy:\s*/, ''), 422, 'sod_policy.set_roles_failed');
  const row = toRow(data as DbRow);

  await writeHrAudit({
    submoduleKey: SUBMODULE, recordId: row.id, actorId: input.actorId,
    action: 'sod_policy.eligible_roles_updated',
    previousState: current ? { eligibleRoles: current.eligibleRoles } : null,
    newState: { eligibleRoles: row.eligibleRoles },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.sod_policy.eligible_roles_updated', sourceModule: SUBMODULE,
    sourceEntityType: 'sod_policy', sourceEntityId: row.id,
    actorUserId: input.actorId, severity: 'warning',
    payload: { eligibleRoles: row.eligibleRoles },
  });
  return row;
}
