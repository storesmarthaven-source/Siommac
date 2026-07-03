// ============================================================================
// Finance Payroll — workflow adapter (Phase 3 Stage 3)
// ============================================================================
// Adapter for the `finance_payroll_approval` workflow.
// Module key: finance_payroll
// Trigger:    finance.payroll.run.submitted
//
// The central engine drives the payroll run approval lifecycle:
//   onWorkflowStarted   → no status change (run already at pending_approval)
//   onWorkflowCompleted → set run status='approved' + approved_by (enforcing SoD)
//   onWorkflowReturned  → set run status='returned' (Finance returned for correction)
//   onWorkflowRejected  → set run status='returned' (spec: returned, not cancelled)
//   onWorkflowCancelled → set run status='cancelled'
//
// SoD: creator ≠ approver is enforced here (assertDifferentApprover).
// No second approval authority. No collaboration-rail (deferred §0.2).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
import { writeHrAudit } from '../hr/employeeCore';
import { emitAppEvent } from '../appEvents';

/** Resolve the actor from the most recent workflow decision. */
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

/** Load a run's created_by for SoD check. */
async function getRunCreatedBy(runId: string): Promise<string | null> {
  const { data } = await sb
    .from('finance_payroll_runs')
    .select('created_by')
    .eq('id', runId)
    .maybeSingle<{ created_by: string | null }>();
  return data?.created_by ?? null;
}

/** Set the run status and optionally stamp approved_by/at. */
async function setRunStatus(
  runId: string,
  status: string,
  actorId: string | null,
  approvedBy?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (approvedBy) {
    patch['approved_by'] = approvedBy;
  }
  const { error } = await sb.from('finance_payroll_runs').update(patch).eq('id', runId);
  if (error) {
    throw new Error('financePayrollAdapter setRunStatus: ' + error.message);
  }
}

const financePayrollAdapter: ModuleWorkflowAdapter = {
  moduleKey:    'finance_payroll',
  workflowType: 'finance_payroll_approval',

  async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    // Context is built at the call site (submitRun), not via the adapter.
    throw new Error('finance_payroll: workflow context is built at the call site (submitRun), not via the adapter.');
  },

  onWorkflowStarted: async () => {
    // Status is already set to pending_approval at submitRun time — nothing to do here.
  },

  onWorkflowStepCompleted: async () => {},

  onWorkflowCompleted: async ({ workflowId, sourceRecordId }) => {
    const actor = await decidedBy(workflowId);
    const createdBy = await getRunCreatedBy(sourceRecordId);

    // SoD: creator cannot approve their own payroll run.
    if (actor && createdBy && actor === createdBy) {
      throw Object.assign(
        new Error('Segregation of duties violation: creator cannot approve.'),
        { status: 422 },
      );
    }

    await setRunStatus(sourceRecordId, 'approved', actor, actor);

    await writeHrAudit({
      submoduleKey: 'finance_payroll',
      recordId:     sourceRecordId,
      actorId:      actor ?? 'workflow',
      action:       'payroll_run.approved',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'approved', approvedBy: actor },
    });

    void emitAppEvent({
      eventType:        'finance.payroll.run.approved',
      sourceModule:     'finance_payroll',
      sourceEntityType: 'payroll_run',
      sourceEntityId:   sourceRecordId,
      actorUserId:      actor ?? 'workflow',
      severity:         'success',
      payload:          { approvedBy: actor },
    });
  },

  onWorkflowReturned: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    await setRunStatus(sourceRecordId, 'returned', actor);

    await writeHrAudit({
      submoduleKey: 'finance_payroll',
      recordId:     sourceRecordId,
      actorId:      actor ?? 'workflow',
      action:       'payroll_run.returned',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'returned' },
      reason:        comment ?? null,
    });

    void emitAppEvent({
      eventType:        'finance.payroll.run.returned',
      sourceModule:     'finance_payroll',
      sourceEntityType: 'payroll_run',
      sourceEntityId:   sourceRecordId,
      actorUserId:      actor ?? 'workflow',
      severity:         'warning',
      payload:          { reason: comment ?? null },
    });
  },

  onWorkflowRejected: async ({ workflowId, sourceRecordId, comment }) => {
    // Per spec sourceStatusMap: onRejected → 'returned' (not a separate rejected state)
    const actor = await decidedBy(workflowId);
    await setRunStatus(sourceRecordId, 'returned', actor);

    await writeHrAudit({
      submoduleKey: 'finance_payroll',
      recordId:     sourceRecordId,
      actorId:      actor ?? 'workflow',
      action:       'payroll_run.rejected_by_workflow',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'returned' },
      reason:        comment ?? null,
    });

    void emitAppEvent({
      eventType:        'finance.payroll.run.rejected',
      sourceModule:     'finance_payroll',
      sourceEntityType: 'payroll_run',
      sourceEntityId:   sourceRecordId,
      actorUserId:      actor ?? 'workflow',
      severity:         'warning',
      payload:          { reason: comment ?? null },
    });
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason }) => {
    await setRunStatus(sourceRecordId, 'cancelled', null);

    await writeHrAudit({
      submoduleKey: 'finance_payroll',
      recordId:     sourceRecordId,
      actorId:      'workflow',
      action:       'payroll_run.workflow_cancelled',
      previousState: { status: 'pending_approval' },
      newState:      { status: 'cancelled' },
      reason:        reason ?? null,
    });
  },
};

export function registerFinancePayrollAdapter(): void {
  registerWorkflowAdapter(financePayrollAdapter);
}
