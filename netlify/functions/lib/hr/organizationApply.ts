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

export async function applyOrgUnitDelete(actorId: string, unitId: string, previousState: State, changeRequestId?: string | null): Promise<void> {
  // Re-check the guard at apply time (state may have changed since the request was raised).
  const [{ count: children }, { count: employees }, { count: positions }] = await Promise.all([
    sb.from('departments').select('id', { count: 'exact', head: true }).eq('parent_id', unitId),
    sb.from('app_users').select('id', { count: 'exact', head: true }).eq('department_id', unitId),
    sb.from('hr_positions').select('id', { count: 'exact', head: true }).eq('department_id', unitId),
  ]);
  if ((children ?? 0) > 0)  throw httpError(409, `Cannot delete: ${children} child unit(s) exist.`);
  if ((employees ?? 0) > 0) throw httpError(409, `Cannot delete: ${employees} employee(s) are assigned.`);
  if ((positions ?? 0) > 0) throw httpError(409, `Cannot delete: ${positions} position(s) are linked.`);
  const { error } = await sb.from('departments').delete().eq('id', unitId);
  if (error) throw fail(error);
  void emitAppEvent({ eventType: 'org.unit.deleted', sourceModule: 'hr', sourceEntityType: 'org_unit', sourceEntityId: unitId, actorUserId: actorId, severity: 'warning', payload: { changeRequestId: changeRequestId ?? null } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: unitId, actorId, action: 'hr.org_unit.deleted', previousState });
}

export async function applyPositionChange(actorId: string, positionId: string, action: PosAction, newState: State, previousState: State, changeRequestId?: string | null): Promise<void> {
  const { error } = await sb.from('hr_positions').update(toPatch(newState, POS_COLS)).eq('id', positionId);
  if (error) throw fail(error);
  void emitAppEvent({ eventType: action === 'retire' ? 'org.position.retired' : 'org.position.updated', sourceModule: 'hr', sourceEntityType: 'position', sourceEntityId: positionId, actorUserId: actorId, severity: 'info', payload: { ...newState, changeRequestId: changeRequestId ?? null } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: positionId, actorId, action: action === 'retire' ? 'hr.position.retired' : 'hr.position.updated', previousState, newState });
}

export async function applyCostCenterChange(actorId: string, ccId: string, action: CcAction, newState: State, previousState: State, changeRequestId?: string | null): Promise<void> {
  const { error } = await sb.from('finance_cost_centers').update(toPatch(newState, CC_COLS)).eq('id', ccId);
  if (error) throw fail(error);
  void emitAppEvent({ eventType: action === 'retire' ? 'org.cost_center.retired' : 'org.cost_center.updated', sourceModule: 'hr', sourceEntityType: 'cost_center', sourceEntityId: ccId, actorUserId: actorId, severity: 'info', payload: { ...newState, changeRequestId: changeRequestId ?? null } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: ccId, actorId, action: action === 'retire' ? 'hr.cost_center.retired' : 'hr.cost_center.updated', previousState, newState });
}
