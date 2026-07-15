// lib/hr/organizationApply.ts — raw "apply the change" writes for Org Structure.
//
// The single place that mutates departments / hr_positions / finance_cost_centers
// and emits the event + audit. Dependency-free (no risk policy, no change-requests)
// so BOTH paths can call it without a cycle:
//   • direct path      — organizationMutations.gateOrApply (low/medium risk)
//   • approval path     — organizationChangeRequests.applyApprovedOrgChange (adapter)
// newState/previousState are camelCase snapshots (the change-request stores them).

import { sb }           from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { httpError, normalizeCode } from './organizationCore';

function nowISO(): string { return new Date().toISOString(); }
function fail(e: { message?: string } | null): Error { return httpError(500, e?.message ?? 'Database error.'); }

type State = Record<string, unknown>;
type UnitAction = 'update' | 'move' | 'archive';
type PosAction = 'update' | 'retire';
type CcAction = 'update' | 'retire';

const UNIT_COLS: Record<string, string> = {
  name: 'name', code: 'code', orgUnitType: 'org_unit_type', siteId: 'site_id', managerId: 'manager_id',
  costCenterId: 'cost_center_id', description: 'description', isActive: 'is_active', sortOrder: 'sort_order', parentId: 'parent_id',
};
const POS_COLS: Record<string, string> = {
  title: 'title', grade: 'grade', departmentId: 'department_id', siteId: 'site_id', defaultSupervisorId: 'default_supervisor_id',
  reportsToPositionId: 'reports_to_position_id', isSafetyCritical: 'is_safety_critical', headcountBudget: 'headcount_budget', isActive: 'is_active',
};
const CC_COLS: Record<string, string> = {
  code: 'code', name: 'name', currency: 'currency', annualBudget: 'annual_budget', departmentId: 'department_id', managerId: 'manager_id', isActive: 'is_active',
};

function toPatch(newState: State, map: Record<string, string>): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_at: nowISO() };
  for (const [k, col] of Object.entries(map)) {
    if (k in newState) patch[col] = k === 'code' ? normalizeCode(newState[k] as string | null) : newState[k];
  }
  return patch;
}

const UNIT_EVENT: Record<UnitAction, string> = { update: 'org.unit.updated', move: 'org.unit.moved', archive: 'org.unit.archived' };
const UNIT_AUDIT: Record<UnitAction, string> = { update: 'hr.org_unit.updated', move: 'hr.org_unit.moved', archive: 'hr.org_unit.archived' };

export async function applyOrgUnitChange(actorId: string, unitId: string, action: UnitAction, newState: State, previousState: State, changeRequestId?: string | null): Promise<void> {
  const { error } = await sb.from('departments').update(toPatch(newState, UNIT_COLS)).eq('id', unitId);
  if (error) throw fail(error);
  void emitAppEvent({ eventType: UNIT_EVENT[action], sourceModule: 'hr', sourceEntityType: 'org_unit', sourceEntityId: unitId, actorUserId: actorId, severity: 'info', payload: { ...newState, changeRequestId: changeRequestId ?? null } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: unitId, actorId, action: UNIT_AUDIT[action], previousState, newState });
}

/**
 * Guard shared by submission (deleteOrgUnit) and apply time (applyOrgUnitDelete): a unit
 * may be hard-deleted only when nothing live depends on it. ACTIVE child units, assigned
 * employees, or linked positions each block. ARCHIVED (is_active=false) child units are
 * logically removed and do NOT block — the departments.parent_id FK (on delete set null)
 * reparents them to top level on delete, so blocking on them would trap otherwise-empty
 * parents forever. Count errors are surfaced, never swallowed as 0 (a silent 0 would
 * bypass the guard entirely — the exact failure mode that let a bad build slip through).
 */
export async function assertUnitDeletable(unitId: string): Promise<void> {
  const [childRes, empRes, posRes] = await Promise.all([
    sb.from('departments').select('id', { count: 'exact', head: true }).eq('parent_id', unitId).eq('is_active', true),
    sb.from('app_users').select('id', { count: 'exact', head: true }).eq('department_id', unitId),
    sb.from('hr_positions').select('id', { count: 'exact', head: true }).eq('department_id', unitId),
  ]);
  for (const r of [childRes, empRes, posRes]) if (r.error) throw fail(r.error);
  if ((childRes.count ?? 0) > 0) throw httpError(409, `Cannot delete: ${childRes.count} active child unit(s) exist. Move, delete or deactivate them first, or deactivate this unit instead.`);
  if ((empRes.count ?? 0) > 0)   throw httpError(409, `Cannot delete: ${empRes.count} employee(s) are assigned. Reassign them first, or deactivate this unit instead.`);
  if ((posRes.count ?? 0) > 0)   throw httpError(409, `Cannot delete: ${posRes.count} position(s) are linked. Reassign them first, or deactivate this unit instead.`);
}

export async function applyOrgUnitDelete(actorId: string, unitId: string, previousState: State, changeRequestId?: string | null): Promise<void> {
  // Re-check the guard at apply time (state may have changed since the request was raised).
  await assertUnitDeletable(unitId);
  const { error } = await sb.from('departments').delete().eq('id', unitId);
  if (error) throw fail(error);
  void emitAppEvent({ eventType: 'org.unit.deleted', sourceModule: 'hr', sourceEntityType: 'org_unit', sourceEntityId: unitId, actorUserId: actorId, severity: 'warning', payload: { changeRequestId: changeRequestId ?? null } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: unitId, actorId, action: 'hr.org_unit.deleted', previousState });
}

export async function applyPositionChange(actorId: string, positionId: string, action: PosAction, newState: State, previousState: State, changeRequestId?: string | null): Promise<void> {
  const patch = toPatch(newState, POS_COLS);
  // A reports-to change goes through a SERIALIZED, cycle-safe RPC: an advisory lock inside
  // the transaction makes the cycle check + write atomic, so two concurrent hierarchy
  // approvals cannot both pass their check before either write lands (a TS check + a separate
  // UPDATE cannot serialize across PostgREST calls). Other fields don't touch the hierarchy
  // invariant and are written normally alongside.
  if (action === 'update' && 'reportsToPositionId' in newState) {
    const { error: rpcErr } = await sb.rpc('hr_position_apply_reports_to_tx', {
      p_position_id: positionId,
      p_reports_to:  (newState['reportsToPositionId'] as string | null) ?? null,
    });
    if (rpcErr) {
      const code = (rpcErr as { code?: string }).code;
      if (code === 'HR409') throw httpError(409, rpcErr.message);
      if (code === 'HR404') throw httpError(404, 'Position not found.');
      throw fail(rpcErr);
    }
    delete patch['reports_to_position_id'];   // already written atomically by the RPC
  }
  if (Object.keys(patch).some(k => k !== 'updated_at')) {
    const { error } = await sb.from('hr_positions').update(patch).eq('id', positionId);
    if (error) throw fail(error);
  }
  void emitAppEvent({ eventType: action === 'retire' ? 'org.position.retired' : 'org.position.updated', sourceModule: 'hr', sourceEntityType: 'position', sourceEntityId: positionId, actorUserId: actorId, severity: 'info', payload: { ...newState, changeRequestId: changeRequestId ?? null } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: positionId, actorId, action: action === 'retire' ? 'hr.position.retired' : 'hr.position.updated', previousState, newState });
}

export async function applyCostCenterChange(actorId: string, ccId: string, action: CcAction, newState: State, previousState: State, changeRequestId?: string | null): Promise<void> {
  const { error } = await sb.from('finance_cost_centers').update(toPatch(newState, CC_COLS)).eq('id', ccId);
  if (error) throw fail(error);
  void emitAppEvent({ eventType: action === 'retire' ? 'org.cost_center.retired' : 'org.cost_center.updated', sourceModule: 'hr', sourceEntityType: 'cost_center', sourceEntityId: ccId, actorUserId: actorId, severity: 'info', payload: { ...newState, changeRequestId: changeRequestId ?? null } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: ccId, actorId, action: action === 'retire' ? 'hr.cost_center.retired' : 'hr.cost_center.updated', previousState, newState });
}
