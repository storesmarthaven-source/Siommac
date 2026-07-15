// ============================================================================
// Finance — Pay-Component Catalogue (Maker-Checker, Phase 2)
// ============================================================================
// All mutating operations (create / update / retire) open a
// `finance_pay_component_change_requests` envelope record and start the central
// approval workflow. The change is applied to `finance_pay_components` ONLY when
// a DIFFERENT finance_manager approves it (segregation of duties enforced via
// `assertDifferentApprover`).
//
// Read operations (list, get) still hit finance_pay_components directly.
//
// Permissions:
//   finance.payroll.components.view   — list, get
//   finance.payroll.components.manage — create/update/retire (opens a CR)
//   finance.payroll.components.approve — approve/reject a CR (SoD enforced)
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { startWorkflowForRecord } from '../workflow/service';
import { assertDifferentApprover } from './statutoryConfig';
import type { ModuleWorkflowContext } from '../workflow/definitionTypes';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface PayComponentRow {
  id: string;
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  isStatutory: boolean;
  isTaxable: boolean;
  reducesChargeable: boolean;
  glAccountCode: string | null;
  costAllocationRequired: boolean;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayComponentChangeRequest {
  id: string;
  changeType: 'create' | 'update' | 'retire';
  componentId: string | null;
  payload: Record<string, unknown>;
  status: 'pending_approval' | 'approved' | 'rejected';
  createdBy: string | null;
  approvedBy: string | null;
  workflowId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface DbComponentRow {
  id: string; code: string; name: string; kind: string;
  is_statutory: boolean; is_taxable: boolean; reduces_chargeable: boolean;
  gl_account_code: string | null; cost_allocation_required: boolean; is_active: boolean;
  created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
}

interface DbCrRow {
  id: string;
  change_type: 'create' | 'update' | 'retire';
  component_id: string | null;
  payload: Record<string, unknown>;
  status: 'pending_approval' | 'approved' | 'rejected';
  created_by: string | null;
  approved_by: string | null;
  workflow_id: string | null;
  created_at: string;
  updated_at: string | null;
}

function toDto(r: DbComponentRow): PayComponentRow {
  return {
    id: r.id, code: r.code, name: r.name, kind: r.kind as 'earning' | 'deduction',
    isStatutory: r.is_statutory, isTaxable: r.is_taxable, reducesChargeable: r.reduces_chargeable,
    glAccountCode: r.gl_account_code, costAllocationRequired: r.cost_allocation_required,
    isActive: r.is_active, createdBy: r.created_by, updatedBy: r.updated_by,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toCrDto(r: DbCrRow): PayComponentChangeRequest {
  return {
    id: r.id,
    changeType: r.change_type,
    componentId: r.component_id,
    payload: r.payload,
    status: r.status,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    workflowId: r.workflow_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── List components (read-only; unchanged from Phase 1) ───────────────────────

export async function listPayComponents(opts: {
  activeOnly?: boolean;
  kind?: 'earning' | 'deduction';
  isStatutory?: boolean;
} = {}): Promise<PayComponentRow[]> {
  let q = sb.from('finance_pay_components').select('*').order('kind').order('name');
  if (opts.activeOnly !== false) q = q.eq('is_active', true);
  if (opts.kind) q = q.eq('kind', opts.kind);
  if (opts.isStatutory !== undefined) q = q.eq('is_statutory', opts.isStatutory);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listPayComponents: ' + error.message), { status: 500 });
  return ((data ?? []) as DbComponentRow[]).map(toDto);
}

// ── Get single component ──────────────────────────────────────────────────────

export async function getPayComponent(id: string): Promise<PayComponentRow | null> {
  const { data, error } = await sb.from('finance_pay_components').select('*').eq('id', id).maybeSingle<DbComponentRow>();
  if (error) throw Object.assign(new Error('getPayComponent: ' + error.message), { status: 500 });
  return data ? toDto(data) : null;
}

// ── List change requests ──────────────────────────────────────────────────────

export async function listPayComponentChangeRequests(opts: {
  status?: 'pending_approval' | 'approved' | 'rejected';
  componentId?: string;
} = {}): Promise<PayComponentChangeRequest[]> {
  let q = sb.from('finance_pay_component_change_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.componentId) q = q.eq('component_id', opts.componentId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listPayComponentChangeRequests: ' + error.message), { status: 500 });
  return ((data ?? []) as DbCrRow[]).map(toCrDto);
}

// ── Internal: open a change request + emit backbone + start workflow ──────────

async function openChangeRequest(opts: {
  changeType: 'create' | 'update' | 'retire';
  componentId: string | null;
  payload: Record<string, unknown>;
  actorId: string;
  ref: string;
  recordData: Record<string, unknown>;
}): Promise<PayComponentChangeRequest> {
  const { data, error } = await sb
    .from('finance_pay_component_change_requests')
    .insert({
      change_type:  opts.changeType,
      component_id: opts.componentId,
      payload:      opts.payload,
      status:       'pending_approval',
      created_by:   opts.actorId,
    })
    .select()
    .single<DbCrRow>();
  if (error) {
    // The partial-unique index (20260919000260) closes the pending-create TOCTOU race: the
    // loser of two concurrent identical submissions hits 23505 here. Map it to the same 409
    // the precheck returns, instead of a 500.
    if ((error as { code?: string }).code === '23505') {
      throw Object.assign(new Error('A create request for this pay component code is already pending approval.'), { status: 409 });
    }
    throw Object.assign(new Error('openChangeRequest: ' + error.message), { status: 500 });
  }

  const cr = toCrDto(data);

  // Start central workflow (non-fatal: log but don't block CR creation).
  const ctx: ModuleWorkflowContext = {
    moduleKey:       'finance_pay_components',
    workflowType:    'finance_pay_component_approval',
    triggerEvent:    'finance.payroll.component.change_submitted',
    sourceRecordId:  cr.id,
    sourceRecordRef: opts.ref,
    requestedBy:     opts.actorId,
    priority:        'normal',
    recordData:      opts.recordData,
  };
  try {
    const wf = await startWorkflowForRecord({ context: ctx, actor: { id: opts.actorId } });
    if (wf?.id) {
      await sb.from('finance_pay_component_change_requests')
        .update({ workflow_id: wf.id })
        .eq('id', cr.id);
      cr.workflowId = wf.id;
    }
  } catch (wfErr) {
    // Workflow engine failure: compensating rollback deletes the CR so the user can retry.
    try { await sb.from('finance_pay_component_change_requests').delete().eq('id', cr.id); } catch (_) { /* best-effort */ }
    throw Object.assign(
      new Error('Workflow start failed — change request rolled back: ' + String(wfErr)),
      { status: 500 },
    );
  }

  // Backbone: audit + event. On failure, compensating rollback deletes the CR.
  const resolveApproverIds = async (): Promise<string[]> => {
    const { data: users } = await sb.from('app_users')
      .select('id').in('role', ['finance_manager', 'admin']).eq('status', 'active');
    return ((users ?? []) as Array<{ id: string }>)
      .map(u => u.id).filter(uid => uid !== opts.actorId);
  };

  const approverIds = await resolveApproverIds();
  try {
    await writeHrAudit({
      submoduleKey: 'finance_payroll_components',
      recordId:     cr.id,
      actorId:      opts.actorId,
      action:       `pay_component_cr.${opts.changeType}_submitted`,
      previousState: null,
      newState:     { changeType: opts.changeType, componentId: opts.componentId, payload: opts.payload },
    });
    void emitAppEvent({
      eventType:        'finance.payroll.component.change_submitted',
      sourceModule:     'finance_payroll_components',
      sourceEntityType: 'pay_component_cr',
      sourceEntityId:   cr.id,
      actorUserId:      opts.actorId,
      severity:         'info',
      payload:          { changeType: opts.changeType, componentId: opts.componentId, ref: opts.ref,
                          recipientUserIds: approverIds.length ? approverIds : undefined },
    });
  } catch (bbErr) {
    try { await sb.from('finance_pay_component_change_requests').delete().eq('id', cr.id); } catch (_) { /* best-effort */ }
    throw bbErr;
  }

  return cr;
}

// ── Create (opens a change request, no direct mutation) ───────────────────────

export interface CreatePayComponentInput {
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  isStatutory?: boolean;
  isTaxable?: boolean;
  reducesChargeable?: boolean;
  glAccountCode?: string | null;
  costAllocationRequired?: boolean;
  actorId: string;
}

export async function createPayComponent(
  input: CreatePayComponentInput,
): Promise<PayComponentChangeRequest> {
  const code = input.code.toUpperCase().trim();
  const name = input.name.trim();

  // Optimistic duplicate check (the adapter enforces the real constraint).
  const { data: existing } = await sb
    .from('finance_pay_components')
    .select('id')
    .eq('code', code)
    .maybeSingle<{ id: string }>();
  if (existing) {
    throw Object.assign(new Error(`Pay component code "${code}" already exists.`), { status: 409 });
  }

  // Also reject when a CREATE change-request for this code is already pending: the
  // component row doesn't exist until approval, so the check above can't see a
  // second submission made before the first is approved.
  const { data: pendingCr } = await sb
    .from('finance_pay_component_change_requests')
    .select('id')
    .eq('change_type', 'create')
    .eq('status', 'pending_approval')
    .eq('payload->>code', code)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (pendingCr) {
    throw Object.assign(new Error(`A create request for pay component code "${code}" is already pending approval.`), { status: 409 });
  }

  return openChangeRequest({
    changeType:  'create',
    componentId: null,
    payload: {
      code,
      name,
      kind:                    input.kind,
      is_statutory:            input.isStatutory ?? false,
      is_taxable:              input.isTaxable ?? true,
      reduces_chargeable:      input.reducesChargeable ?? false,
      gl_account_code:         input.glAccountCode ?? null,
      cost_allocation_required: input.costAllocationRequired ?? false,
    },
    actorId:    input.actorId,
    ref:        `PC-${code}`,
    recordData: { code, name, kind: input.kind },
  });
}

// ── Update (opens a change request, no direct mutation) ───────────────────────

export interface UpdatePayComponentInput {
  id: string;
  name?: string;
  isStatutory?: boolean;
  isTaxable?: boolean;
  reducesChargeable?: boolean;
  glAccountCode?: string | null;
  costAllocationRequired?: boolean;
  actorId: string;
}

export async function updatePayComponent(
  input: UpdatePayComponentInput,
): Promise<PayComponentChangeRequest> {
  const existing = await getPayComponent(input.id);
  if (!existing) throw Object.assign(new Error('Pay component not found.'), { status: 404 });
  if (!existing.isActive) throw Object.assign(new Error('Cannot update a retired pay component.'), { status: 422 });

  const payload: Record<string, unknown> = {};
  if (input.name !== undefined)                 payload['name']                    = input.name.trim();
  if (input.isStatutory !== undefined)          payload['is_statutory']            = input.isStatutory;
  if (input.isTaxable !== undefined)            payload['is_taxable']              = input.isTaxable;
  if (input.reducesChargeable !== undefined)    payload['reduces_chargeable']      = input.reducesChargeable;
  if (input.glAccountCode !== undefined)        payload['gl_account_code']         = input.glAccountCode;
  if (input.costAllocationRequired !== undefined) payload['cost_allocation_required'] = input.costAllocationRequired;

  if (Object.keys(payload).length === 0) {
    throw Object.assign(new Error('No changes to submit.'), { status: 422 });
  }

  return openChangeRequest({
    changeType:  'update',
    componentId: input.id,
    payload,
    actorId:     input.actorId,
    ref:         `PC-${existing.code}`,
    recordData:  { code: existing.code, name: existing.name, kind: existing.kind },
  });
}

// ── Retire (opens a change request, no direct mutation) ───────────────────────

export async function retirePayComponent(
  id: string,
  actorId: string,
): Promise<PayComponentChangeRequest> {
  const existing = await getPayComponent(id);
  if (!existing) throw Object.assign(new Error('Pay component not found.'), { status: 404 });
  if (!existing.isActive) throw Object.assign(new Error('Pay component is already retired.'), { status: 422 });

  return openChangeRequest({
    changeType:  'retire',
    componentId: id,
    payload:     {},
    actorId,
    ref:         `PC-${existing.code}`,
    recordData:  { code: existing.code, name: existing.name },
  });
}

// ── Approve a change request ──────────────────────────────────────────────────
// Segregation of duties: the actor must not be the CR's creator.
// The adapter (financePayComponentAdapter.ts → onWorkflowCompleted) applies the
// actual change to finance_pay_components when the WORKFLOW is completed via the
// engine. This direct-approve path is used by the explicit /approve route (which
// also drives tests) — it calls the adapter's apply logic directly.

export async function approvePayComponentChangeRequest(
  id: string,
  actorId: string,
): Promise<PayComponentChangeRequest> {
  const { data: crData, error: getErr } = await sb
    .from('finance_pay_component_change_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle<DbCrRow>();
  if (getErr) throw Object.assign(new Error('approvePayComponentChangeRequest: ' + getErr.message), { status: 500 });
  if (!crData) throw Object.assign(new Error('Change request not found.'), { status: 404 });
  if (crData.status !== 'pending_approval') {
    throw Object.assign(new Error('Only pending change requests can be approved.'), { status: 422 });
  }

  // Segregation of duties: creator cannot approve their own request.
  assertDifferentApprover({ actorId, createdBy: crData.created_by, action: 'approve a change request they submitted' });

  // Apply the change to finance_pay_components (mirrors the adapter logic).
  // We import and call the adapter's applyChangeRequest via the approach below.
  // Rather than duplicate the logic, delegate to the adapter's apply path by marking
  // the CR approved and calling the workflow-complete handler directly.
  // For correctness without a live workflow, we inline the same operations here
  // (the adapter handles engine-driven approvals; this handles route-driven approvals).

  // 1. Apply the change (inline, mirrors adapter applyChangeRequest).
  const cr = toCrDto(crData);
  await applyChangeDirect(crData, actorId);

  // 2. Mark approved.
  const { data: updated, error: updErr } = await sb
    .from('finance_pay_component_change_requests')
    .update({ status: 'approved', approved_by: actorId })
    .eq('id', id)
    .select()
    .single<DbCrRow>();
  if (updErr) throw Object.assign(new Error('approvePayComponentChangeRequest(mark): ' + updErr.message), { status: 500 });

  return toCrDto(updated);
}

// ── applyChangeDirect: inline apply logic (mirrors adapter, avoids circular dep) ─

async function applyChangeDirect(cr: DbCrRow, actorId: string): Promise<void> {
  const now = new Date().toISOString();

  if (cr.change_type === 'create') {
    const p = cr.payload as {
      code: string; name: string; kind: string;
      is_statutory?: boolean; is_taxable?: boolean;
      reduces_chargeable?: boolean; gl_account_code?: string | null;
      cost_allocation_required?: boolean;
    };
    const { data, error } = await sb
      .from('finance_pay_components')
      .insert({
        code: p.code, name: p.name, kind: p.kind,
        is_statutory:            p.is_statutory ?? false,
        is_taxable:              p.is_taxable ?? true,
        reduces_chargeable:      p.reduces_chargeable ?? false,
        gl_account_code:         p.gl_account_code ?? null,
        cost_allocation_required: p.cost_allocation_required ?? false,
        is_active:               true,
        created_by:              cr.created_by ?? actorId,
        updated_by:              actorId,
      })
      .select('id, code, name, kind')
      .single<{ id: string; code: string; name: string; kind: string }>();
    if (error) {
      if (error.code === '23505') throw Object.assign(new Error(`Pay component code "${p.code}" already exists.`), { status: 409 });
      throw Object.assign(new Error('applyChangeDirect(create): ' + error.message), { status: 500 });
    }
    try {
      await writeHrAudit({
        submoduleKey: 'finance_payroll_components', recordId: data.id, actorId,
        action: 'pay_component.created',
        previousState: null, newState: { code: data.code, name: data.name, kind: data.kind, approvedBy: actorId },
      });
      void emitAppEvent({
        eventType: 'finance.payroll.component.created', sourceModule: 'finance_payroll_components',
        sourceEntityType: 'pay_component', sourceEntityId: data.id,
        actorUserId: actorId, severity: 'info',
        payload: { code: data.code, name: data.name, kind: data.kind },
      });
    } catch (bbErr) {
      try { await sb.from('finance_pay_components').delete().eq('id', data.id); } catch (_) { /* best-effort */ }
      throw bbErr;
    }

  } else if (cr.change_type === 'update') {
    if (!cr.component_id) throw Object.assign(new Error('CR has no component_id for update.'), { status: 422 });
    const { data: existing, error: getErr } = await sb
      .from('finance_pay_components').select('*').eq('id', cr.component_id)
      .maybeSingle<DbComponentRow>();
    if (getErr) throw Object.assign(new Error('applyChangeDirect(update/get): ' + getErr.message), { status: 500 });
    if (!existing) throw Object.assign(new Error('Pay component not found.'), { status: 404 });
    if (!existing.is_active) throw Object.assign(new Error('Cannot update a retired pay component.'), { status: 422 });

    const p = cr.payload as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_by: actorId, updated_at: now, ...p };
    const { error: updErr } = await sb.from('finance_pay_components').update(patch).eq('id', cr.component_id);
    if (updErr) throw Object.assign(new Error('applyChangeDirect(update): ' + updErr.message), { status: 500 });

    try {
      await writeHrAudit({
        submoduleKey: 'finance_payroll_components', recordId: cr.component_id, actorId,
        action: 'pay_component.updated',
        previousState: existing, newState: { ...patch, approvedBy: actorId },
      });
      void emitAppEvent({
        eventType: 'finance.payroll.component.updated', sourceModule: 'finance_payroll_components',
        sourceEntityType: 'pay_component', sourceEntityId: cr.component_id,
        actorUserId: actorId, severity: 'info',
        payload: { code: existing.code, changeRequestId: cr.id },
      });
    } catch (bbErr) {
      try {
        await sb.from('finance_pay_components').update({
          name: existing.name, is_statutory: existing.is_statutory, is_taxable: existing.is_taxable,
          reduces_chargeable: existing.reduces_chargeable, gl_account_code: existing.gl_account_code,
          cost_allocation_required: existing.cost_allocation_required,
        }).eq('id', cr.component_id);
      } catch (_) { /* best-effort rollback */ }
      throw bbErr;
    }

  } else if (cr.change_type === 'retire') {
    if (!cr.component_id) throw Object.assign(new Error('CR has no component_id for retire.'), { status: 422 });
    const { data: existing, error: getErr } = await sb
      .from('finance_pay_components').select('id, code, is_active').eq('id', cr.component_id)
      .maybeSingle<{ id: string; code: string; is_active: boolean }>();
    if (getErr) throw Object.assign(new Error('applyChangeDirect(retire/get): ' + getErr.message), { status: 500 });
    if (!existing) throw Object.assign(new Error('Pay component not found.'), { status: 404 });
    if (!existing.is_active) throw Object.assign(new Error('Pay component is already retired.'), { status: 422 });

    const { error: retErr } = await sb.from('finance_pay_components')
      .update({ is_active: false, updated_by: actorId, updated_at: now })
      .eq('id', cr.component_id);
    if (retErr) throw Object.assign(new Error('applyChangeDirect(retire): ' + retErr.message), { status: 500 });

    try {
      await writeHrAudit({
        submoduleKey: 'finance_payroll_components', recordId: cr.component_id, actorId,
        action: 'pay_component.retired',
        previousState: { isActive: true }, newState: { isActive: false, approvedBy: actorId },
      });
      void emitAppEvent({
        eventType: 'finance.payroll.component.retired', sourceModule: 'finance_payroll_components',
        sourceEntityType: 'pay_component', sourceEntityId: cr.component_id,
        actorUserId: actorId, severity: 'info',
        payload: { code: existing.code, changeRequestId: cr.id },
      });
    } catch (bbErr) {
      try { await sb.from('finance_pay_components').update({ is_active: true, updated_by: actorId }).eq('id', cr.component_id); } catch (_) { /* best-effort */ }
      throw bbErr;
    }
  } else {
    throw Object.assign(new Error(`Unknown change_type "${cr.change_type as string}".`), { status: 422 });
  }
}

// ── Reject a change request ───────────────────────────────────────────────────

export async function rejectPayComponentChangeRequest(
  id: string,
  actorId: string,
  reason?: string,
): Promise<PayComponentChangeRequest> {
  const { data: crData, error: getErr } = await sb
    .from('finance_pay_component_change_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle<DbCrRow>();
  if (getErr) throw Object.assign(new Error('rejectPayComponentChangeRequest: ' + getErr.message), { status: 500 });
  if (!crData) throw Object.assign(new Error('Change request not found.'), { status: 404 });
  if (crData.status !== 'pending_approval') {
    throw Object.assign(new Error('Only pending change requests can be rejected.'), { status: 422 });
  }

  assertDifferentApprover({ actorId, createdBy: crData.created_by, action: 'reject a change request they submitted' });

  const { data: updated, error: updErr } = await sb
    .from('finance_pay_component_change_requests')
    .update({ status: 'rejected', approved_by: actorId })
    .eq('id', id)
    .select()
    .single<DbCrRow>();
  if (updErr) throw Object.assign(new Error('rejectPayComponentChangeRequest: ' + updErr.message), { status: 500 });

  await writeHrAudit({
    submoduleKey: 'finance_payroll_components', recordId: id, actorId,
    action: 'pay_component_cr.rejected',
    previousState: { status: 'pending_approval' }, newState: { status: 'rejected' },
    reason: reason ?? null,
  });
  void emitAppEvent({
    eventType: 'finance.payroll.component.change_rejected', sourceModule: 'finance_payroll_components',
    sourceEntityType: 'pay_component_cr', sourceEntityId: id,
    actorUserId: actorId, severity: 'warning',
    payload: { changeType: crData.change_type, componentId: crData.component_id, reason: reason ?? null,
               recipientUserIds: crData.created_by && crData.created_by !== actorId ? [crData.created_by] : undefined },
  });

  return toCrDto(updated);
}
