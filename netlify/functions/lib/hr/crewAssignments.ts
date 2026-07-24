// Crew assignments (CP4, spec §14.6/§14.8) — effective offshore/marine crew assignment
// commands over hr_crew_assignments. Canonical dimension FKs (client→finance_ar_customers,
// contract→hr_contracts, asset→ops_assets, work order→ops_work_orders); site is derived from
// ops_assets.site_id (no column here). Every mutation emits app_events + audit_logs via
// emitAppEvent. Contract: docs/module-contracts/CREW_PAYROLL_DELIVERY_CONTRACT.md.

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';

const fail = (msg: string, status = 400): Error => Object.assign(new Error(msg), { status });
const OPEN = '9999-12-31';

export type CrewAssignmentStatus = 'draft' | 'active' | 'ended' | 'cancelled';

export interface CrewAssignmentDto {
  id: string;
  assignmentNo: string;
  employeeId: string;
  payGroupId: string;
  policyAssignmentId: string | null;
  role: string | null;
  clientId: string | null;
  contractId: string | null;
  assetId: string | null;
  workOrderId: string | null;
  costCenter: string | null;
  contractRateReference: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: CrewAssignmentStatus;
  approvalState: 'pending' | 'approved' | 'rejected';
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
}

type Row = Record<string, unknown>;
function mapRow(r: Row): CrewAssignmentDto {
  return {
    id: r['id'] as string, assignmentNo: r['assignment_no'] as string,
    employeeId: r['employee_id'] as string, payGroupId: r['pay_group_id'] as string,
    policyAssignmentId: (r['policy_assignment_id'] as string) ?? null,
    role: (r['role'] as string) ?? null,
    clientId: (r['client_id'] as string) ?? null, contractId: (r['contract_id'] as string) ?? null,
    assetId: (r['asset_id'] as string) ?? null, workOrderId: (r['work_order_id'] as string) ?? null,
    costCenter: (r['cost_center'] as string) ?? null,
    contractRateReference: (r['contract_rate_reference'] as string) ?? null,
    effectiveFrom: r['effective_from'] as string, effectiveTo: (r['effective_to'] as string) ?? null,
    status: r['status'] as CrewAssignmentStatus,
    approvalState: r['approval_state'] as CrewAssignmentDto['approvalState'],
    approvedBy: (r['approved_by'] as string) ?? null, approvedAt: (r['approved_at'] as string) ?? null,
    createdBy: r['created_by'] as string, createdAt: r['created_at'] as string,
    updatedAt: (r['updated_at'] as string) ?? null,
  };
}

export interface CrewAssignmentFilter {
  employeeId?: string; payGroupId?: string; assetId?: string; status?: CrewAssignmentStatus;
}
export async function listCrewAssignments(f: CrewAssignmentFilter): Promise<CrewAssignmentDto[]> {
  let q = sb.from('hr_crew_assignments').select('*').order('effective_from', { ascending: false }).limit(500);
  if (f.employeeId) q = q.eq('employee_id', f.employeeId);
  if (f.payGroupId) q = q.eq('pay_group_id', f.payGroupId);
  if (f.assetId) q = q.eq('asset_id', f.assetId);
  if (f.status) q = q.eq('status', f.status);
  const { data, error } = await q;
  if (error) throw fail('listCrewAssignments: ' + error.message, 500);
  return (data ?? []).map(mapRow);
}

// Default policy: block overlapping ACTIVE crew assignments for the same employee (the
// mockup's "overlapping asset assignments" blocker). The DB exclusion constraint is a
// backstop for same-asset overlap; this covers cross-asset simultaneity too. A future
// policy-capability flag can relax this where simultaneous asset allocation is permitted.
async function assertNoActiveOverlap(employeeId: string, from: string, to: string | null, excludeId?: string): Promise<void> {
  const { data, error } = await sb.from('hr_crew_assignments')
    .select('id, effective_from, effective_to').eq('employee_id', employeeId).eq('status', 'active');
  if (error) throw fail('crew overlap check: ' + error.message, 500);
  const newTo = to ?? OPEN;
  for (const r of (data ?? []) as Row[]) {
    if (excludeId && r['id'] === excludeId) continue;
    const rFrom = r['effective_from'] as string; const rTo = (r['effective_to'] as string) ?? OPEN;
    if (from <= rTo && rFrom <= newTo) {
      throw fail('crew.assignment_overlap: the employee already has an active crew assignment overlapping this period.', 422);
    }
  }
}

function overlapErr(msg: string): Error {
  if (/no_same_asset_overlap|exclusion|conflicting key|overlap/i.test(msg)) {
    return fail('crew.assignment_overlap: overlapping active assignment to the same asset for this employee.', 422);
  }
  return fail('crewAssignment: ' + msg, 500);
}

export interface CreateCrewAssignmentInput {
  employeeId: string; payGroupId: string; policyAssignmentId?: string | null; role?: string | null;
  clientId?: string | null; contractId?: string | null; assetId?: string | null; workOrderId?: string | null;
  costCenter?: string | null; contractRateReference?: string | null;
  effectiveFrom: string; effectiveTo?: string | null; status?: 'draft' | 'active';
}
export async function createCrewAssignment(actorId: string, input: CreateCrewAssignmentInput): Promise<CrewAssignmentDto> {
  if ((input.effectiveTo ?? null) && (input.effectiveTo as string) < input.effectiveFrom) {
    throw fail('effectiveTo cannot be before effectiveFrom.', 422);
  }
  const status = input.status ?? 'draft';
  if (status === 'active') await assertNoActiveOverlap(input.employeeId, input.effectiveFrom, input.effectiveTo ?? null);
  const assignmentNo = await nextRef('CRWA');
  const { data, error } = await sb.from('hr_crew_assignments').insert({
    assignment_no: assignmentNo, employee_id: input.employeeId, pay_group_id: input.payGroupId,
    policy_assignment_id: input.policyAssignmentId ?? null, role: input.role ?? null,
    client_id: input.clientId ?? null, contract_id: input.contractId ?? null,
    asset_id: input.assetId ?? null, work_order_id: input.workOrderId ?? null,
    cost_center: input.costCenter ?? null, contract_rate_reference: input.contractRateReference ?? null,
    effective_from: input.effectiveFrom, effective_to: input.effectiveTo ?? null,
    status, created_by: actorId,
  }).select('*').single();
  if (error) throw overlapErr(error.message);
  const dto = mapRow(data);
  await emitAppEvent({
    eventType: 'hr.crew.assignment.created', sourceModule: 'hr', sourceEntityType: 'crew_assignment',
    sourceEntityId: dto.id, actorUserId: actorId, severity: 'info',
    payload: { assignmentNo, employeeId: dto.employeeId, payGroupId: dto.payGroupId, assetId: dto.assetId, status },
  });
  return dto;
}

export interface UpdateCrewAssignmentInput {
  id: string; role?: string | null; clientId?: string | null; contractId?: string | null;
  assetId?: string | null; workOrderId?: string | null; costCenter?: string | null;
  contractRateReference?: string | null; effectiveFrom?: string; effectiveTo?: string | null;
  status?: CrewAssignmentStatus;
}
export async function updateCrewAssignment(actorId: string, input: UpdateCrewAssignmentInput): Promise<CrewAssignmentDto> {
  const { data: existing, error: e0 } = await sb.from('hr_crew_assignments').select('*').eq('id', input.id).maybeSingle();
  if (e0) throw fail('updateCrewAssignment/read: ' + e0.message, 500);
  if (!existing) throw fail('Crew assignment not found.', 404);
  const ex = existing as Row;
  const nextStatus = (input.status ?? ex['status']) as CrewAssignmentStatus;
  const effFrom = input.effectiveFrom ?? (ex['effective_from'] as string);
  const effTo = input.effectiveTo !== undefined ? input.effectiveTo : ((ex['effective_to'] as string) ?? null);
  if ((effTo ?? null) && (effTo as string) < effFrom) throw fail('effectiveTo cannot be before effectiveFrom.', 422);
  if (nextStatus === 'active') await assertNoActiveOverlap(ex['employee_id'] as string, effFrom, effTo, input.id);

  const patch: Row = {};
  const set = (k: string, v: unknown): void => { if (v !== undefined) patch[k] = v; };
  set('role', input.role); set('client_id', input.clientId); set('contract_id', input.contractId);
  set('asset_id', input.assetId); set('work_order_id', input.workOrderId); set('cost_center', input.costCenter);
  set('contract_rate_reference', input.contractRateReference);
  set('effective_from', input.effectiveFrom); set('effective_to', input.effectiveTo); set('status', input.status);
  if (Object.keys(patch).length === 0) return mapRow(ex);

  const { data, error } = await sb.from('hr_crew_assignments').update(patch).eq('id', input.id).select('*').single();
  if (error) throw overlapErr(error.message);
  const dto = mapRow(data);
  await emitAppEvent({
    eventType: 'hr.crew.assignment.updated', sourceModule: 'hr', sourceEntityType: 'crew_assignment',
    sourceEntityId: dto.id, actorUserId: actorId, severity: 'info',
    payload: { assignmentNo: dto.assignmentNo, changed: Object.keys(patch), status: dto.status },
  });
  return dto;
}

export async function endCrewAssignment(actorId: string, input: { id: string; effectiveTo: string; reason?: string }): Promise<CrewAssignmentDto> {
  const { data: existing } = await sb.from('hr_crew_assignments').select('effective_from, status').eq('id', input.id).maybeSingle();
  if (!existing) throw fail('Crew assignment not found.', 404);
  if ((existing as Row)['effective_from'] as string > input.effectiveTo) throw fail('effectiveTo cannot be before the assignment start.', 422);
  const { data, error } = await sb.from('hr_crew_assignments')
    .update({ status: 'ended', effective_to: input.effectiveTo }).eq('id', input.id).select('*').single();
  if (error) throw fail('endCrewAssignment: ' + error.message, 500);
  const dto = mapRow(data);
  await emitAppEvent({
    eventType: 'hr.crew.assignment.ended', sourceModule: 'hr', sourceEntityType: 'crew_assignment',
    sourceEntityId: dto.id, actorUserId: actorId, severity: 'info',
    payload: { assignmentNo: dto.assignmentNo, effectiveTo: input.effectiveTo, reason: input.reason ?? null },
  });
  return dto;
}
