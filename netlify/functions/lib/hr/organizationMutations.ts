// lib/hr/organizationMutations.ts — writes for the Organization Structure module.
//
// Creates apply directly (a new entity has no dependents). Update/move/archive/delete/
// retire run through gateOrApply: compute impact → classify risk → LOW/MEDIUM apply
// directly, HIGH/CRITICAL route to the central workflow engine (unless the actor holds
// hr.organization.override_approval, or no approval binding is configured — then apply
// directly, audited). The raw writes live in organizationApply.ts (shared with the
// approval adapter). Hierarchy invariants + optimistic concurrency enforced here.

import { sb }           from '../db';
import { emitAppEvent } from '../appEvents';
import { userCan }      from '../auth';
import { writeHrAudit } from './employeeCore';
import {
  httpError, normalizeCode, assertExpectedUpdatedAt, assertNoOrgCycle, assertNoPositionCycle, changedFields,
} from './organizationCore';
import { previewOrgChangeImpact } from './organizationImpact';
import { classifyOrgChangeRisk, requiresApproval } from './organizationRiskPolicy';
import { submitOrgChangeForApproval } from './organizationChangeRequests';
import { applyOrgUnitChange, applyOrgUnitDelete, applyPositionChange, applyCostCenterChange, assertUnitDeletable } from './organizationApply';
import type {
  CreateOrgUnitArgs, UpdateOrgUnitArgs, MoveOrgUnitArgs, ArchiveOrgUnitArgs, DeleteOrgUnitArgs,
  CreatePositionArgs, UpdatePositionArgs, RetirePositionArgs,
  CreateCostCenterArgs, UpdateCostCenterArgs, RetireCostCenterArgs,
  OrgMutationResult, OrgEntityType, OrgChangeAction, OrgChangeImpactSummary,
} from '../../../../types/hrOrganization';

export interface OrgActor { id: string; role?: string | null }
type State = Record<string, unknown>;

function isUniqueViolation(e: unknown): boolean { return !!e && typeof e === 'object' && (e as { code?: string }).code === '23505'; }
function isFkViolation(e: unknown): boolean { return !!e && typeof e === 'object' && (e as { code?: string }).code === '23503'; }
function pgError(e: { message?: string } | null): Error { return httpError(500, e?.message ?? 'Database error.'); }
function nowISO(): string { return new Date().toISOString(); }

/** LOW/MEDIUM → apply directly; HIGH/CRITICAL → approval workflow (unless override / no binding). */
async function gateOrApply(
  actor: OrgActor,
  p: { entityType: OrgEntityType; entityId: string; action: OrgChangeAction; oldState: State; newState: State; impact: OrgChangeImpactSummary; effectiveFrom?: string | null; reason?: string | null; idempotencyKey?: string },
  applyFn: () => Promise<void>,
): Promise<OrgMutationResult> {
  const risk = classifyOrgChangeRisk({ entityType: p.entityType, action: p.action, changedFields: changedFields(p.oldState, p.newState), impact: p.impact });
  if (requiresApproval(risk)) {
    const canOverride = await userCan({ id: actor.id, role: actor.role ?? null }, 'hr.organization.override_approval');
    if (!canOverride) {
      const pending = await submitOrgChangeForApproval(actor.id, {
        entityType: p.entityType, entityId: p.entityId, action: p.action, riskLevel: risk,
        oldState: p.oldState, newState: p.newState, impactSummary: p.impact, effectiveFrom: p.effectiveFrom, reason: p.reason,
        idempotencyKey: p.idempotencyKey,
      });
      if (pending) return pending;                     // workflow started → held for approval
      // no binding configured → fall through to a direct (audited) apply
    }
  }
  await applyFn();
  return { mode: 'applied', entityType: p.entityType, entityId: p.entityId };
}

// ── Org units ──────────────────────────────────────────────────────────────────

export async function createOrgUnit(actor: OrgActor, args: CreateOrgUnitArgs): Promise<{ id: string }> {
  const row = {
    name: args.name.trim(), code: normalizeCode(args.code), description: args.description?.trim() || null,
    parent_id: args.parentId ?? null, org_unit_type: args.orgUnitType ?? 'department',
    site_id: args.siteId ?? null, manager_id: args.managerId ?? null, cost_center_id: args.costCenterId ?? null,
    sort_order: args.sortOrder ?? 0,
  };
  const { data, error } = await sb.from('departments').insert(row).select('id').single<{ id: string }>();
  if (error) {
    if (isUniqueViolation(error)) throw httpError(409, 'An org unit with this name or code already exists.');
    if (isFkViolation(error)) throw httpError(400, 'Referenced parent, site, manager or cost centre does not exist.');
    throw pgError(error);
  }
  void emitAppEvent({ eventType: 'org.unit.created', sourceModule: 'hr', sourceEntityType: 'org_unit', sourceEntityId: data.id, actorUserId: actor.id, severity: 'info', payload: { name: row.name, orgUnitType: row.org_unit_type, parentId: row.parent_id } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: data.id, actorId: actor.id, action: 'hr.org_unit.created', newState: row });
  return { id: data.id };
}

async function loadUnit(unitId: string): Promise<{ parent_id: string | null; name: string; code: string | null; description: string | null; org_unit_type: string; site_id: string | null; manager_id: string | null; cost_center_id: string | null; is_active: boolean; sort_order: number | null; updated_at: string | null }> {
  const { data } = await sb.from('departments')
    .select('parent_id, name, code, description, org_unit_type, site_id, manager_id, cost_center_id, is_active, sort_order, updated_at')
    .eq('id', unitId).maybeSingle();
  if (!data) throw httpError(404, 'Org unit not found.');
  return data as never;
}

export async function updateOrgUnit(actor: OrgActor, args: UpdateOrgUnitArgs): Promise<OrgMutationResult> {
  const current = await loadUnit(args.unitId);
  assertExpectedUpdatedAt(current.updated_at, args.expectedUpdatedAt);
  const newState: State = {}, oldState: State = {};
  const set = (k: string, provided: unknown, isSet: boolean, old: unknown): void => { if (isSet) { newState[k] = provided; oldState[k] = old; } };
  set('name', args.name?.trim(), args.name !== undefined, current.name);
  set('code', args.code === undefined ? undefined : normalizeCode(args.code), args.code !== undefined, current.code);
  set('orgUnitType', args.orgUnitType, args.orgUnitType !== undefined, current.org_unit_type);
  set('siteId', args.siteId ?? null, args.siteId !== undefined, current.site_id);
  set('managerId', args.managerId ?? null, args.managerId !== undefined, current.manager_id);
  set('costCenterId', args.costCenterId ?? null, args.costCenterId !== undefined, current.cost_center_id);
  set('description', args.description?.trim() || null, args.description !== undefined, current.description);
  set('isActive', args.isActive, args.isActive !== undefined, current.is_active);
  set('sortOrder', args.sortOrder, args.sortOrder !== undefined, current.sort_order);

  const impact = await previewOrgChangeImpact({ entityType: 'org_unit', entityId: args.unitId, action: 'update' });
  return gateOrApply(actor, { entityType: 'org_unit', entityId: args.unitId, action: 'update', oldState, newState, impact, effectiveFrom: args.effectiveFrom, reason: args.reason, idempotencyKey: args.idempotencyKey },
    () => applyOrgUnitChange(actor.id, args.unitId, 'update', newState, oldState));
}

export async function moveOrgUnit(actor: OrgActor, args: MoveOrgUnitArgs): Promise<OrgMutationResult> {
  const current = await loadUnit(args.unitId);
  assertExpectedUpdatedAt(current.updated_at, args.expectedUpdatedAt);
  const { data: units } = await sb.from('departments').select('id, parent_id');
  assertNoOrgCycle(((units ?? []) as { id: string; parent_id: string | null }[]).map(u => ({ id: u.id, parentId: u.parent_id })), args.unitId, args.newParentId);

  const newState: State = { parentId: args.newParentId }, oldState: State = { parentId: current.parent_id };
  const impact = await previewOrgChangeImpact({ entityType: 'org_unit', entityId: args.unitId, action: 'move', newParentId: args.newParentId });
  return gateOrApply(actor, { entityType: 'org_unit', entityId: args.unitId, action: 'move', oldState, newState, impact, effectiveFrom: args.effectiveFrom, reason: args.reason, idempotencyKey: args.idempotencyKey },
    () => applyOrgUnitChange(actor.id, args.unitId, 'move', newState, oldState));
}

export async function archiveOrgUnit(actor: OrgActor, args: ArchiveOrgUnitArgs): Promise<OrgMutationResult> {
  const current = await loadUnit(args.unitId);
  const newState: State = { isActive: false }, oldState: State = { isActive: current.is_active };
  const impact = await previewOrgChangeImpact({ entityType: 'org_unit', entityId: args.unitId, action: 'archive' });
  return gateOrApply(actor, { entityType: 'org_unit', entityId: args.unitId, action: 'archive', oldState, newState, impact, effectiveFrom: args.effectiveFrom, reason: args.reason, idempotencyKey: args.idempotencyKey },
    () => applyOrgUnitChange(actor.id, args.unitId, 'archive', newState, oldState));
}

export async function deleteOrgUnit(actor: OrgActor, args: DeleteOrgUnitArgs): Promise<OrgMutationResult> {
  const current = await loadUnit(args.unitId);
  await assertUnitDeletable(args.unitId);

  const oldState: State = { name: current.name, code: current.code, parentId: current.parent_id, orgUnitType: current.org_unit_type };
  const impact = await previewOrgChangeImpact({ entityType: 'org_unit', entityId: args.unitId, action: 'delete' });
  return gateOrApply(actor, { entityType: 'org_unit', entityId: args.unitId, action: 'delete', oldState, newState: {}, impact, effectiveFrom: args.effectiveFrom, reason: args.reason, idempotencyKey: args.idempotencyKey },
    () => applyOrgUnitDelete(actor.id, args.unitId, oldState));
}

// ── Positions ──────────────────────────────────────────────────────────────────

export async function createPosition(actor: OrgActor, args: CreatePositionArgs): Promise<{ id: string }> {
  const row = {
    position_key: args.positionKey.trim(), title: args.title.trim(), grade: args.grade?.trim() || null,
    department_id: args.departmentId ?? null, site_id: args.siteId ?? null,
    default_supervisor_id: args.defaultSupervisorId ?? null, reports_to_position_id: args.reportsToPositionId ?? null,
    is_safety_critical: args.isSafetyCritical ?? false, headcount_budget: args.headcountBudget ?? null, created_by: actor.id,
  };
  const { data, error } = await sb.from('hr_positions').insert(row).select('id').single<{ id: string }>();
  if (error) {
    if (isUniqueViolation(error)) throw httpError(409, 'A position with this key already exists.');
    if (isFkViolation(error)) throw httpError(400, 'Referenced supervisor or reports-to position does not exist.');
    throw pgError(error);
  }
  void emitAppEvent({ eventType: 'org.position.created', sourceModule: 'hr', sourceEntityType: 'position', sourceEntityId: data.id, actorUserId: actor.id, severity: 'info', payload: { positionKey: row.position_key, title: row.title } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: data.id, actorId: actor.id, action: 'hr.position.created', newState: row });
  return { id: data.id };
}

async function loadPosition(positionId: string): Promise<{ title: string; grade: string | null; department_id: string | null; site_id: string | null; default_supervisor_id: string | null; reports_to_position_id: string | null; is_safety_critical: boolean; headcount_budget: number | null; is_active: boolean; updated_at: string | null }> {
  const { data } = await sb.from('hr_positions')
    .select('title, grade, department_id, site_id, default_supervisor_id, reports_to_position_id, is_safety_critical, headcount_budget, is_active, updated_at')
    .eq('id', positionId).maybeSingle();
  if (!data) throw httpError(404, 'Position not found.');
  return data as never;
}

/**
 * Reports-to cycle check that also accounts for IN-FLIGHT (gated, not-yet-applied)
 * position change requests. A high-risk reports-to change routes to approval and sits
 * as a pending CR, so the committed hr_positions graph alone cannot see a cycle that two
 * in-flight changes would jointly form. Overlay each pending/approved/scheduled position
 * 'update' CR's proposed reportsToPositionId onto the graph, then run the pure assertion.
 * Conservative by design: a submission that would close a cycle against an in-flight
 * change is rejected up front (409). applyPositionChange re-checks committed state as the
 * apply-time backstop for sequential approvals.
 */
async function assertNoPositionReportsToCycle(positionId: string, reportsToPositionId: string): Promise<void> {
  const [posRes, crRes] = await Promise.all([
    sb.from('hr_positions').select('id, reports_to_position_id'),
    sb.from('hr_org_change_requests').select('entity_id, new_state')
      .eq('entity_type', 'position').eq('action', 'update')
      .in('status', ['pending_approval', 'approved', 'scheduled']),
  ]);
  if (posRes.error) throw pgError(posRes.error);
  if (crRes.error) throw pgError(crRes.error);
  const effective = new Map<string, string | null>();
  for (const p of (posRes.data ?? []) as { id: string; reports_to_position_id: string | null }[]) {
    effective.set(p.id, p.reports_to_position_id);
  }
  for (const cr of (crRes.data ?? []) as { entity_id: string; new_state: Record<string, unknown> | null }[]) {
    if (cr.new_state && Object.prototype.hasOwnProperty.call(cr.new_state, 'reportsToPositionId')) {
      effective.set(cr.entity_id, (cr.new_state['reportsToPositionId'] as string | null) ?? null);
    }
  }
  const graph = Array.from(effective, ([id, reportsTo]) => ({ id, reportsToPositionId: reportsTo }));
  assertNoPositionCycle(graph, positionId, reportsToPositionId);
}

export async function updatePosition(actor: OrgActor, args: UpdatePositionArgs): Promise<OrgMutationResult> {
  const current = await loadPosition(args.positionId);
  assertExpectedUpdatedAt(current.updated_at, args.expectedUpdatedAt);
  if (args.reportsToPositionId !== undefined && args.reportsToPositionId) {
    await assertNoPositionReportsToCycle(args.positionId, args.reportsToPositionId);
  }
  const newState: State = {}, oldState: State = {};
  const set = (k: string, provided: unknown, isSet: boolean, old: unknown): void => { if (isSet) { newState[k] = provided; oldState[k] = old; } };
  set('title', args.title?.trim(), args.title !== undefined, current.title);
  set('grade', args.grade?.trim() || null, args.grade !== undefined, current.grade);
  set('departmentId', args.departmentId ?? null, args.departmentId !== undefined, current.department_id);
  set('siteId', args.siteId ?? null, args.siteId !== undefined, current.site_id);
  set('defaultSupervisorId', args.defaultSupervisorId ?? null, args.defaultSupervisorId !== undefined, current.default_supervisor_id);
  set('reportsToPositionId', args.reportsToPositionId ?? null, args.reportsToPositionId !== undefined, current.reports_to_position_id);
  set('isSafetyCritical', args.isSafetyCritical, args.isSafetyCritical !== undefined, current.is_safety_critical);
  set('headcountBudget', args.headcountBudget ?? null, args.headcountBudget !== undefined, current.headcount_budget);
  set('isActive', args.isActive, args.isActive !== undefined, current.is_active);

  const impact = await previewOrgChangeImpact({ entityType: 'position', entityId: args.positionId, action: 'update' });
  return gateOrApply(actor, { entityType: 'position', entityId: args.positionId, action: 'update', oldState, newState, impact, effectiveFrom: args.effectiveFrom, reason: args.reason, idempotencyKey: args.idempotencyKey },
    () => applyPositionChange(actor.id, args.positionId, 'update', newState, oldState));
}

export async function retirePosition(actor: OrgActor, args: RetirePositionArgs): Promise<OrgMutationResult> {
  const current = await loadPosition(args.positionId);
  const newState: State = { isActive: false }, oldState: State = { isActive: current.is_active };
  const impact = await previewOrgChangeImpact({ entityType: 'position', entityId: args.positionId, action: 'retire' });
  return gateOrApply(actor, { entityType: 'position', entityId: args.positionId, action: 'retire', oldState, newState, impact, effectiveFrom: args.effectiveFrom, reason: args.reason, idempotencyKey: args.idempotencyKey },
    () => applyPositionChange(actor.id, args.positionId, 'retire', newState, oldState));
}

// ── Cost centres (shared finance_cost_centers registry) ─────────────────────────

export async function createCostCenter(actor: OrgActor, args: CreateCostCenterArgs): Promise<{ id: string }> {
  const row = {
    code: normalizeCode(args.code), name: args.name.trim(), currency: args.currency?.trim() || 'TTD',
    annual_budget: args.annualBudget ?? null, department_id: args.departmentId ?? null,
    manager_id: args.managerId ?? null, is_active: true, created_by: actor.id, updated_at: nowISO(),
  };
  const { data, error } = await sb.from('finance_cost_centers').insert(row).select('id').single<{ id: string }>();
  if (error) {
    if (isUniqueViolation(error)) throw httpError(409, 'A cost centre with this code already exists.');
    if (isFkViolation(error)) throw httpError(400, 'Referenced manager does not exist.');
    throw pgError(error);
  }
  void emitAppEvent({ eventType: 'org.cost_center.created', sourceModule: 'hr', sourceEntityType: 'cost_center', sourceEntityId: data.id, actorUserId: actor.id, severity: 'info', payload: { code: row.code, name: row.name } });
  await writeHrAudit({ submoduleKey: 'organization', recordId: data.id, actorId: actor.id, action: 'hr.cost_center.created', newState: row });
  return { id: data.id };
}

async function loadCostCenter(id: string): Promise<{ code: string | null; name: string; currency: string | null; annual_budget: number | null; department_id: string | null; manager_id: string | null; is_active: boolean; updated_at: string | null }> {
  const { data } = await sb.from('finance_cost_centers')
    .select('code, name, currency, annual_budget, department_id, manager_id, is_active, updated_at')
    .eq('id', id).maybeSingle();
  if (!data) throw httpError(404, 'Cost centre not found.');
  return data as never;
}

export async function updateCostCenter(actor: OrgActor, args: UpdateCostCenterArgs): Promise<OrgMutationResult> {
  const current = await loadCostCenter(args.costCenterId);
  assertExpectedUpdatedAt(current.updated_at, args.expectedUpdatedAt);
  const newState: State = {}, oldState: State = {};
  const set = (k: string, provided: unknown, isSet: boolean, old: unknown): void => { if (isSet) { newState[k] = provided; oldState[k] = old; } };
  set('code', args.code === undefined ? undefined : normalizeCode(args.code), args.code !== undefined, current.code);
  set('name', args.name?.trim(), args.name !== undefined, current.name);
  set('currency', args.currency?.trim() || 'TTD', args.currency !== undefined, current.currency);
  set('annualBudget', args.annualBudget ?? null, args.annualBudget !== undefined, current.annual_budget);
  set('departmentId', args.departmentId ?? null, args.departmentId !== undefined, current.department_id);
  set('managerId', args.managerId ?? null, args.managerId !== undefined, current.manager_id);
  set('isActive', args.isActive, args.isActive !== undefined, current.is_active);

  const impact = await previewOrgChangeImpact({ entityType: 'cost_center', entityId: args.costCenterId, action: 'update' });
  return gateOrApply(actor, { entityType: 'cost_center', entityId: args.costCenterId, action: 'update', oldState, newState, impact, effectiveFrom: args.effectiveFrom, reason: args.reason, idempotencyKey: args.idempotencyKey },
    () => applyCostCenterChange(actor.id, args.costCenterId, 'update', newState, oldState));
}

export async function retireCostCenter(actor: OrgActor, args: RetireCostCenterArgs): Promise<OrgMutationResult> {
  const current = await loadCostCenter(args.costCenterId);
  const newState: State = { isActive: false }, oldState: State = { isActive: current.is_active };
  const impact = await previewOrgChangeImpact({ entityType: 'cost_center', entityId: args.costCenterId, action: 'retire' });
  return gateOrApply(actor, { entityType: 'cost_center', entityId: args.costCenterId, action: 'retire', oldState, newState, impact, effectiveFrom: args.effectiveFrom, reason: args.reason, idempotencyKey: args.idempotencyKey },
    () => applyCostCenterChange(actor.id, args.costCenterId, 'retire', newState, oldState));
}
