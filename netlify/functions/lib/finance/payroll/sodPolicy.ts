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

import {
  SOD_LEVELS, CHAIN_SEATS, DISTINCT_SEATS,
  separationFor, maxDistinctAssignment, computeFeasibility,
  type SodLevel, type SodSeatKey, type SodLevelFeasibility,
} from './sodRules';

const SUBMODULE = 'finance_payroll_sod_policy';

// The rules themselves live in ./sodRules (pure, unit-tested). This module owns
// the data: who holds which seat, and the governed lifecycle of the policy row.
export { SOD_LEVELS };
export type { SodLevel, SodLevelFeasibility };

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

/** One seat in the payroll chain, with the people who can actually fill it. */
export interface SodChainStep {
  key: SodSeatKey;
  label: string;
  detail: string;
  permission: string;
  /** Roles granted this capability (from role_permissions), for display. */
  roles: string[];
  /** Active users who hold it — capped for display; holderCount is the true total. */
  holderIds: string[];
  holderCount: number;
  /** Earlier seats this one must be a DIFFERENT person from, at the active level. */
  mustDifferFrom: SodSeatKey[];
}

export interface SodPolicyOverview {
  active: SodPolicyRow | null;
  pending: SodPolicyRow | null;
  history: SodPolicyRow[];
  /** Levels the UI may offer. The floor is 2 — SoD cannot be switched off. */
  levels: readonly number[];
  /** The lifecycle chain under the ACTIVE level (drives the flow diagram). */
  chain: SodChainStep[];
  /** How many DISTINCT people the active level needs end to end. */
  distinctPeopleRequired: number;
  /** Per-level staffing feasibility — drives the guided change flow. */
  feasibility: SodLevelFeasibility[];
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

const HOLDER_DISPLAY_CAP = 8;

interface SeatStaffing {
  roles: Map<SodChainStep['key'], string[]>;
  /** FULL holder lists (uncapped) — the matching needs every candidate. */
  holders: Map<SodChainStep['key'], string[]>;
}

/**
 * Who can fill each seat. Holders come from role_permissions (the real authority)
 * plus superadmin, which is allow-all in memory and therefore holds every seat.
 * Read ONCE and shared by the chain and the feasibility maths.
 */
async function resolveSeatStaffing(): Promise<SeatStaffing> {
  const permissions = CHAIN_SEATS.map(s => s.permission);
  const { data: grants, error: gErr } = await sb
    .from('role_permissions').select('role_name, permission').in('permission', permissions);
  if (gErr) throw err('sodPolicy.chain: ' + gErr.message);

  const rolesByPermission = new Map<string, string[]>();
  for (const g of grants ?? []) {
    const list = rolesByPermission.get(g.permission) ?? [];
    if (!list.includes(g.role_name)) list.push(g.role_name);
    rolesByPermission.set(g.permission, list);
  }

  const everyRole = [...new Set([...(grants ?? []).map(g => g.role_name), 'superadmin'])];
  const { data: users, error: uErr } = await sb
    .from('app_users').select('id, role').in('role', everyRole).eq('status', 'active');
  if (uErr) throw err('sodPolicy.chain users: ' + uErr.message);

  const roles = new Map<SodChainStep['key'], string[]>();
  const holders = new Map<SodChainStep['key'], string[]>();
  for (const seat of CHAIN_SEATS) {
    // superadmin can fill any seat even without an explicit grant row.
    const seatRoles = [...new Set([...(rolesByPermission.get(seat.permission) ?? []), 'superadmin'])].sort();
    roles.set(seat.key, seatRoles);
    holders.set(seat.key, (users ?? []).filter(u => seatRoles.includes(u.role)).map(u => u.id));
  }
  return { roles, holders };
}

function buildChain(level: SodLevel, staffing: SeatStaffing): SodChainStep[] {
  return CHAIN_SEATS.map(seat => {
    const holders = staffing.holders.get(seat.key) ?? [];
    return {
      key: seat.key,
      label: seat.label,
      detail: seat.detail,
      permission: seat.permission,
      roles: staffing.roles.get(seat.key) ?? [],
      holderIds: holders.slice(0, HOLDER_DISPLAY_CAP),
      holderCount: holders.length,
      mustDifferFrom: separationFor(seat.key, level),
    };
  });
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
  const active = rows.find(r => r.status === 'active') ?? null;
  const level = (active?.sodLevel ?? 3) as SodLevel;
  const staffing = await resolveSeatStaffing();
  return {
    active,
    pending: rows.find(r => r.status === 'pending_approval') ?? null,
    history: rows.filter(r => r.status === 'superseded'),
    levels:  SOD_LEVELS,
    chain:   buildChain(level, staffing),
    distinctPeopleRequired: level,
    feasibility: computeFeasibility(staffing.holders),
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

  // Staffing gate. A level the org cannot fill would strand every future run at
  // funding with PR403 — the exact deadlock this feature removes — so refuse it
  // here rather than let someone approve an outage. Enforced server-side: the UI
  // greys the option, but a direct API call must fail too.
  const staffing = await resolveSeatStaffing();
  const fit = computeFeasibility(staffing.holders).find(f => f.level === level);
  if (fit && !fit.feasible) {
    const short = fit.shortfallSeats
      .map(k => CHAIN_SEATS.find(s => s.key === k)?.label ?? k).join(', ');
    throw err(
      `Level ${level} needs ${fit.required} different people, but only ${fit.available} can be found ` +
      `(no one is left to ${short.toLowerCase()}). Grant the missing capability to another active ` +
      'user first, or choose a lower level.',
      422, 'sod_policy.not_staffable',
    );
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
