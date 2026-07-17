// ============================================================================
// Finance Pay Components — workflow adapter
// ============================================================================
// Adapter for the `finance_pay_component_approval` workflow.
// Module key:     finance_pay_components
// Workflow type:  finance_pay_component_approval
// Trigger event:  finance.payroll.component.change_submitted
//
// Lifecycle (mirrors the sourceStatusMap in the workflow binding migration):
//   onWorkflowStarted   → change request stays pending_approval
//   onWorkflowCompleted → APPLY the change request to finance_pay_components
//                         (insert / update / is_active=false), write audit_logs +
//                         app_events with compensating rollback; close CR as approved.
//   onWorkflowReturned  → CR stays pending_approval (finance manager returned for
//                         revision — submitter should re-submit a corrected CR)
//   onWorkflowRejected  → close CR as rejected; finance_pay_components unchanged.
//   onWorkflowCancelled → close CR as rejected; finance_pay_components unchanged.
//
// SoD (assertDifferentApprover) is enforced in approvePayComponentChangeRequest()
// in payrollComponents.ts BEFORE the workflow adapter is called. The adapter
// itself does not re-check SoD to avoid double-blocking the workflow engine's
// own callbacks (which may be called by the system actor).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
import { emitFinanceMutationBackbone } from '../finance/backbone';
import { writeHrAudit } from '../hr/employeeCore';

// ── DB row shapes ──────────────────────────────────────────────────────────────

interface CrRow {
  id: string;
  change_type: 'create' | 'update' | 'retire';
  component_id: string | null;
  payload: Record<string, unknown>;
  created_by: string | null;
}

interface ComponentRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  is_statutory: boolean;
  is_taxable: boolean;
  reduces_chargeable: boolean;
  gl_account_code: string | null;
  cost_allocation_required: boolean;
  is_active: boolean;
}

// ── Helper: resolve the actor from the most recent workflow decision ────────────

async function decidedBy(workflowId: string): Promise<string | null> {
  const { data } = await sb
    .from('workflow_decisions')
    .select('actor_id')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ actor_id: string | null }>();
  return data?.actor_id ?? null;
}

// ── Apply a CR to the live components table ────────────────────────────────────
//
// This is the ONLY path that mutates finance_pay_components for non-list
// operations. Called when the workflow is completed (approved).

async function applyChangeRequest(cr: CrRow, actorId: string): Promise<void> {
  const now = new Date().toISOString();

  if (cr.change_type === 'create') {
    // Build the insert row from the payload.
    const p = cr.payload as {
      code: string; name: string; kind: string;
      is_statutory?: boolean; is_taxable?: boolean;
      reduces_chargeable?: boolean; gl_account_code?: string | null;
      cost_allocation_required?: boolean;
    };
    const insertRow = {
      code:                    p.code,
      name:                    p.name,
      kind:                    p.kind,
      is_statutory:            p.is_statutory ?? false,
      is_taxable:              p.is_taxable ?? true,
      reduces_chargeable:      p.reduces_chargeable ?? false,
      gl_account_code:         p.gl_account_code ?? null,
      cost_allocation_required: p.cost_allocation_required ?? false,
      is_active:               true,
      created_by:              cr.created_by ?? actorId,
      updated_by:              actorId,
    };

    const { data, error } = await sb
      .from('finance_pay_components')
      .insert(insertRow)
      .select('id, code, name, kind')
      .single<{ id: string; code: string; name: string; kind: string }>();
    if (error) {
      if (error.code === '23505') throw Object.assign(new Error(`Pay component code "${p.code}" already exists — the change request cannot be applied.`), { status: 409 });
      throw Object.assign(new Error('financePayComponentAdapter.apply(create): ' + error.message), { status: 500 });
    }

    // Backbone: audit + event. On failure, compensating rollback deletes the inserted row.
    try {
      await emitFinanceMutationBackbone({
        actorUserId:   actorId,
        module:        'finance_payroll_components',
        entityType:    'pay_component',
        entityId:      data.id,
        eventType:     'finance.payroll.component.created',
        auditAction:   'pay_component.created',
        previousState: null,
        newState:      { code: data.code, name: data.name, kind: data.kind },
        severity:      'info',
        metadata:      { changeRequestId: cr.id, approvedBy: actorId },
      });
    } catch (bbErr) {
      try { await sb.from('finance_pay_components').delete().eq('id', data.id); } catch (_) { /* best-effort rollback */ }
      throw bbErr;
    }

  } else if (cr.change_type === 'update') {
    if (!cr.component_id) throw Object.assign(new Error('Change request has no component_id for an update.'), { status: 422 });

    // Fetch the current component snapshot for the audit trail + compensating rollback.
    const { data: existing, error: getErr } = await sb
      .from('finance_pay_components')
      .select('*')
      .eq('id', cr.component_id)
      .maybeSingle<ComponentRow>();
    if (getErr) throw Object.assign(new Error('financePayComponentAdapter.apply(update): ' + getErr.message), { status: 500 });
    if (!existing) throw Object.assign(new Error('Pay component not found — the change request cannot be applied.'), { status: 404 });
    if (!existing.is_active) throw Object.assign(new Error('Pay component is retired — the change request cannot be applied.'), { status: 422 });

    // Build the patch from the payload delta.
    const p = cr.payload as Partial<{
      name: string; is_statutory: boolean; is_taxable: boolean;
      reduces_chargeable: boolean; gl_account_code: string | null;
      cost_allocation_required: boolean;
    }>;
    const patch: Record<string, unknown> = { updated_by: actorId, updated_at: now };
    if (p.name !== undefined)                 patch.name                    = p.name;
    if (p.is_statutory !== undefined)         patch.is_statutory            = p.is_statutory;
    if (p.is_taxable !== undefined)           patch.is_taxable              = p.is_taxable;
    if (p.reduces_chargeable !== undefined)   patch.reduces_chargeable      = p.reduces_chargeable;
    if (p.gl_account_code !== undefined)      patch.gl_account_code         = p.gl_account_code;
    if (p.cost_allocation_required !== undefined) patch.cost_allocation_required = p.cost_allocation_required;

    const { error: updErr } = await sb
      .from('finance_pay_components')
      .update(patch)
      .eq('id', cr.component_id);
    if (updErr) throw Object.assign(new Error('financePayComponentAdapter.apply(update): ' + updErr.message), { status: 500 });

    // Backbone: audit + event. On failure, compensating rollback reverts the update.
    try {
      await emitFinanceMutationBackbone({
        actorUserId:   actorId,
        module:        'finance_payroll_components',
        entityType:    'pay_component',
        entityId:      cr.component_id,
        eventType:     'finance.payroll.component.updated',
        auditAction:   'pay_component.updated',
        previousState: { name: existing.name, is_statutory: existing.is_statutory, is_taxable: existing.is_taxable },
        newState:      { ...patch },
        severity:      'info',
        metadata:      { changeRequestId: cr.id, approvedBy: actorId },
      });
    } catch (bbErr) {
      // Compensating rollback: revert to the pre-update snapshot.
      try {
        await sb.from('finance_pay_components').update({
          name:                    existing.name,
          is_statutory:            existing.is_statutory,
          is_taxable:              existing.is_taxable,
          reduces_chargeable:      existing.reduces_chargeable,
          gl_account_code:         existing.gl_account_code,
          cost_allocation_required: existing.cost_allocation_required,
          updated_by:              existing.id, // restore original (best-effort)
        }).eq('id', cr.component_id);
      } catch (_) { /* best-effort rollback */ }
      throw bbErr;
    }

  } else { // change_type === 'retire' — the union's only remaining member
    if (!cr.component_id) throw Object.assign(new Error('Change request has no component_id for a retire.'), { status: 422 });

    const { data: existing, error: getErr } = await sb
      .from('finance_pay_components')
      .select('id, code, is_active')
      .eq('id', cr.component_id)
      .maybeSingle<{ id: string; code: string; is_active: boolean }>();
    if (getErr) throw Object.assign(new Error('financePayComponentAdapter.apply(retire): ' + getErr.message), { status: 500 });
    if (!existing) throw Object.assign(new Error('Pay component not found — the retire request cannot be applied.'), { status: 404 });
    if (!existing.is_active) throw Object.assign(new Error('Pay component is already retired.'), { status: 422 });

    const { error: retErr } = await sb
      .from('finance_pay_components')
      .update({ is_active: false, updated_by: actorId, updated_at: now })
      .eq('id', cr.component_id);
    if (retErr) throw Object.assign(new Error('financePayComponentAdapter.apply(retire): ' + retErr.message), { status: 500 });

    // Backbone: audit + event. On failure, compensating rollback re-activates the component.
    try {
      await emitFinanceMutationBackbone({
        actorUserId:   actorId,
        module:        'finance_payroll_components',
        entityType:    'pay_component',
        entityId:      cr.component_id,
        eventType:     'finance.payroll.component.retired',
        auditAction:   'pay_component.retired',
        previousState: { isActive: true },
        newState:      { isActive: false },
        severity:      'info',
        metadata:      { code: existing.code, changeRequestId: cr.id, approvedBy: actorId },
      });
    } catch (bbErr) {
      try { await sb.from('finance_pay_components').update({ is_active: true, updated_by: actorId }).eq('id', cr.component_id); } catch (_) { /* best-effort rollback */ }
      throw bbErr;
    }

  }
  // No unknown-change_type fallback needed: the type union AND the DB CHECK
  // (mig 20260917000200) both pin change_type to create|update|retire.
}

// ── Adapter ───────────────────────────────────────────────────────────────────

const financePayComponentAdapter: ModuleWorkflowAdapter = {
  moduleKey:    'finance_pay_components',
  workflowType: 'finance_pay_component_approval',

  buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    // Context is built at the call site (submitPayComponentChangeRequest), not via the adapter.
    throw new Error('finance_pay_components: workflow context is built at the call site, not via the adapter.');
  },

  // CR stays at pending_approval — no status change at start.
  onWorkflowStarted: () => Promise.resolve(),

  onWorkflowStepCompleted: () => Promise.resolve(),

  onWorkflowCompleted: async ({ workflowId, sourceRecordId }) => {
    const actorId = (await decidedBy(workflowId)) ?? 'workflow';

    // Fetch the change request.
    const { data: crData, error: crErr } = await sb
      .from('finance_pay_component_change_requests')
      .select('id, change_type, component_id, payload, created_by')
      .eq('id', sourceRecordId)
      .maybeSingle<CrRow>();
    if (crErr || !crData) {
      // Log and bail — can't apply what we can't find.
      await writeHrAudit({
        submoduleKey:  'finance_payroll_components',
        recordId:      sourceRecordId,
        actorId,
        action:        'pay_component_cr.apply_failed',
        previousState: null,
        newState:      { error: crErr?.message ?? 'CR not found', workflowId },
      });
      return;
    }

    try {
      await applyChangeRequest(crData, actorId);
    } catch (applyErr) {
      // Application failed — mark the CR rejected so it doesn't remain in limbo.
      await sb.from('finance_pay_component_change_requests')
        .update({ status: 'rejected', approved_by: actorId })
        .eq('id', sourceRecordId);
      await writeHrAudit({
        submoduleKey:  'finance_payroll_components',
        recordId:      sourceRecordId,
        actorId,
        action:        'pay_component_cr.apply_failed',
        previousState: { status: 'pending_approval' },
        newState:      { status: 'rejected', error: (applyErr as Error).message },
      });
      return;
    }

    // Mark CR approved.
    await sb.from('finance_pay_component_change_requests')
      .update({ status: 'approved', approved_by: actorId })
      .eq('id', sourceRecordId);
  },

  onWorkflowReturned: async ({ workflowId, sourceRecordId, comment }) => {
    const actorId = (await decidedBy(workflowId)) ?? 'workflow';
    // CR stays pending_approval — the submitter should submit a corrected request.
    await writeHrAudit({
      submoduleKey:  'finance_payroll_components',
      recordId:      sourceRecordId,
      actorId,
      action:        'pay_component_cr.workflow_returned',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'pending_approval' },
      reason:        comment,
    });
  },

  onWorkflowRejected: async ({ workflowId, sourceRecordId, comment }) => {
    const actorId = (await decidedBy(workflowId)) ?? 'workflow';
    await sb.from('finance_pay_component_change_requests')
      .update({ status: 'rejected', approved_by: actorId })
      .eq('id', sourceRecordId);
    await writeHrAudit({
      submoduleKey:  'finance_payroll_components',
      recordId:      sourceRecordId,
      actorId,
      action:        'pay_component_cr.rejected',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'rejected' },
      reason:        comment,
    });
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason, actorId }) => {
    await sb.from('finance_pay_component_change_requests')
      .update({ status: 'rejected' })
      .eq('id', sourceRecordId);
    await writeHrAudit({
      submoduleKey:  'finance_payroll_components',
      recordId:      sourceRecordId,
      actorId:       actorId ?? null,
      action:        'pay_component_cr.cancelled',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'rejected' },
      reason,
    });
  },
};

export function registerFinancePayComponentAdapter(): void {
  registerWorkflowAdapter(financePayComponentAdapter);
}
