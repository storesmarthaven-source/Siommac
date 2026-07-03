// ============================================================================
// HR Compensation Mutations — write-side for hr_employee_pay_items
// ============================================================================
// Rules:
//   • HR can only use ACTIVE finance_pay_components (enforced here).
//   • Amount XOR percent must be set (DB constraint + pre-validation here).
//   • Pay items require approval via the central workflow engine.
//   • Effective-dated. Retire-never-delete.
//   • Items in active/pending_approval status cannot be deleted; retire instead.
//   • assertDifferentApprover (SoD) enforced on approve.
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { startWorkflowForRecord } from '../workflow/service';
import { assertDifferentApprover } from '../finance/statutoryConfig';
import { getPayItem, type PayItemDto, type DbPayItemRow } from './compensationQueries';
import { toPayItemDto } from './compensationCore';
import type { ModuleWorkflowContext } from '../workflow/definitionTypes';

export { getPayItem };

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreatePayItemInput {
  employeeId: string;
  componentId: string;
  amount?: number | null;
  percent?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string | null;
  actorId: string;
}

export async function createPayItem(input: CreatePayItemInput): Promise<PayItemDto> {
  // Validate amount XOR percent
  const hasAmount = input.amount !== null && input.amount !== undefined;
  const hasPct = input.percent !== null && input.percent !== undefined;
  if (hasAmount === hasPct) {
    throw Object.assign(new Error('Exactly one of amount or percent must be set.'), { status: 422 });
  }

  // Enforce: only active finance_pay_components may be used
  const { data: comp, error: compErr } = await sb.from('finance_pay_components')
    .select('id, is_active').eq('id', input.componentId).maybeSingle<{ id: string; is_active: boolean }>();
  if (compErr) throw Object.assign(new Error('createPayItem: component lookup failed: ' + compErr.message), { status: 500 });
  if (!comp) throw Object.assign(new Error('Pay component not found.'), { status: 404 });
  if (!comp.is_active) throw Object.assign(new Error('Only active pay components can be assigned to employees.'), { status: 422 });

  const { data, error } = await sb.from('hr_employee_pay_items').insert({
    employee_id: input.employeeId,
    component_id: input.componentId,
    amount: input.amount ?? null,
    percent: input.percent ?? null,
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo ?? null,
    note: input.note ?? null,
    status: 'draft',
    is_active: false,
    created_by: input.actorId,
  }).select().single<DbPayItemRow>();
  if (error) throw Object.assign(new Error('createPayItem: ' + error.message), { status: 500 });

  const row = toPayItemDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_compensation', recordId: row.id, actorId: input.actorId,
    action: 'pay_item.created',
    previousState: null, newState: { status: 'draft', employeeId: row.employeeId, componentId: row.componentId },
  });
  void emitAppEvent({
    eventType: 'hr.compensation.item.created',
    sourceModule: 'hr_compensation', sourceEntityType: 'pay_item', sourceEntityId: row.id,
    actorUserId: input.actorId, severity: 'info',
    payload: { employeeId: row.employeeId, componentId: row.componentId },
  });

  return row;
}

// ── Submit (draft → pending_approval, starts workflow) ────────────────────────

export async function submitPayItem(id: string, actorId: string): Promise<PayItemDto> {
  const existing = await getPayItem(id);
  if (!existing) throw Object.assign(new Error('Pay item not found.'), { status: 404 });
  if (existing.status !== 'draft') {
    throw Object.assign(new Error('Only draft pay items can be submitted for approval.'), { status: 422 });
  }

  const { data, error } = await sb.from('hr_employee_pay_items')
    .update({ status: 'pending_approval' })
    .eq('id', id).select().single<DbPayItemRow>();
  if (error) throw Object.assign(new Error('submitPayItem: ' + error.message), { status: 500 });
  const row = toPayItemDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_compensation', recordId: id, actorId,
    action: 'pay_item.submitted',
    previousState: { status: 'draft' }, newState: { status: 'pending_approval' },
  });

  const ctx: ModuleWorkflowContext = {
    moduleKey: 'hr_compensation',
    workflowType: 'hr_compensation_change_approval',
    triggerEvent: 'hr.compensation.item.submitted',
    sourceRecordId: id,
    sourceRecordRef: existing.itemNo ?? `PIT-${id.slice(0, 8).toUpperCase()}`,
    requestedBy: actorId,
    priority: 'normal',
    recordData: { employeeId: existing.employeeId, componentId: existing.componentId, effectiveFrom: existing.effectiveFrom },
  };

  try {
    const wf = await startWorkflowForRecord({ context: ctx, actor: { id: actorId } });
    if (wf?.id) {
      await sb.from('hr_employee_pay_items').update({ workflow_id: wf.id }).eq('id', id);
    }
  } catch (wfErr) {
    // Compensating rollback — roll back to draft so the user can retry
    await sb.from('hr_employee_pay_items').update({ status: 'draft' }).eq('id', id);
    throw Object.assign(
      new Error('Workflow start failed — pay item rolled back to draft: ' + String(wfErr)),
      { status: 500 },
    );
  }

  void emitAppEvent({
    eventType: 'hr.compensation.item.submitted',
    sourceModule: 'hr_compensation', sourceEntityType: 'pay_item', sourceEntityId: id,
    actorUserId: actorId, severity: 'info',
    payload: { employeeId: existing.employeeId, componentId: existing.componentId },
  });

  return row;
}

// ── Approve (workflow adapter calls this) ─────────────────────────────────────

export async function approvePayItem(id: string, actorId: string): Promise<PayItemDto> {
  const existing = await getPayItem(id);
  if (!existing) throw Object.assign(new Error('Pay item not found.'), { status: 404 });
  if (existing.status !== 'pending_approval') {
    throw Object.assign(new Error('Only pending_approval pay items can be approved.'), { status: 422 });
  }

  assertDifferentApprover({ actorId, createdBy: existing.createdBy, action: 'approve a pay item they created' });

  const now = new Date().toISOString();
  const { data, error } = await sb.from('hr_employee_pay_items')
    .update({ status: 'active', is_active: true, approved_by: actorId, approved_at: now })
    .eq('id', id).select().single<DbPayItemRow>();
  if (error) throw Object.assign(new Error('approvePayItem: ' + error.message), { status: 500 });
  const row = toPayItemDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_compensation', recordId: id, actorId,
    action: 'pay_item.approved',
    previousState: { status: 'pending_approval' }, newState: { status: 'active', isActive: true },
  });
  void emitAppEvent({
    eventType: 'hr.compensation.item.approved',
    sourceModule: 'hr_compensation', sourceEntityType: 'pay_item', sourceEntityId: id,
    actorUserId: actorId, severity: 'success', payload: {},
  });

  return row;
}

// ── Reject (workflow adapter calls this) ──────────────────────────────────────

export async function rejectPayItem(id: string, actorId: string, reason?: string): Promise<PayItemDto> {
  const existing = await getPayItem(id);
  if (!existing) throw Object.assign(new Error('Pay item not found.'), { status: 404 });
  if (existing.status !== 'pending_approval') {
    throw Object.assign(new Error('Only pending_approval pay items can be rejected.'), { status: 422 });
  }

  assertDifferentApprover({ actorId, createdBy: existing.createdBy, action: 'reject a pay item they created' });

  const { data, error } = await sb.from('hr_employee_pay_items')
    .update({ status: 'rejected' })
    .eq('id', id).select().single<DbPayItemRow>();
  if (error) throw Object.assign(new Error('rejectPayItem: ' + error.message), { status: 500 });
  const row = toPayItemDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_compensation', recordId: id, actorId,
    action: 'pay_item.rejected',
    previousState: { status: 'pending_approval' }, newState: { status: 'rejected' },
    reason: reason ?? null,
  });
  void emitAppEvent({
    eventType: 'hr.compensation.item.rejected',
    sourceModule: 'hr_compensation', sourceEntityType: 'pay_item', sourceEntityId: id,
    actorUserId: actorId, severity: 'warning', payload: { reason: reason ?? null },
  });

  return row;
}

// ── Retire (active → retired; never hard-delete) ──────────────────────────────

export async function retirePayItem(id: string, actorId: string): Promise<PayItemDto> {
  const existing = await getPayItem(id);
  if (!existing) throw Object.assign(new Error('Pay item not found.'), { status: 404 });
  if (existing.status !== 'active') {
    throw Object.assign(new Error('Only active pay items can be retired.'), { status: 422 });
  }

  const now = new Date().toISOString();
  const { data, error } = await sb.from('hr_employee_pay_items')
    .update({ status: 'retired', is_active: false, retired_by: actorId, retired_at: now })
    .eq('id', id).select().single<DbPayItemRow>();
  if (error) throw Object.assign(new Error('retirePayItem: ' + error.message), { status: 500 });
  const row = toPayItemDto(data);

  await writeHrAudit({
    submoduleKey: 'hr_compensation', recordId: id, actorId,
    action: 'pay_item.retired',
    previousState: { status: 'active', isActive: true }, newState: { status: 'retired', isActive: false },
  });
  void emitAppEvent({
    eventType: 'hr.compensation.item.retired',
    sourceModule: 'hr_compensation', sourceEntityType: 'pay_item', sourceEntityId: id,
    actorUserId: actorId, severity: 'info', payload: {},
  });

  return row;
}

// ── Set status (workflow adapter helper) ──────────────────────────────────────

export async function setPayItemStatus(
  id: string,
  status: string,
  actorId: string | null,
  opts?: { reason?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'active') { patch['is_active'] = true; patch['approved_by'] = actorId; patch['approved_at'] = new Date().toISOString(); }
  if (status !== 'active') patch['is_active'] = false;
  const { error } = await sb.from('hr_employee_pay_items').update(patch).eq('id', id);
  if (error) throw new Error('setPayItemStatus failed: ' + error.message);

  await writeHrAudit({
    submoduleKey: 'hr_compensation', recordId: id, actorId: actorId ?? 'workflow',
    action: `pay_item.status_set.${status}`,
    previousState: null, newState: { status },
    reason: opts?.reason ?? null,
  });
}
