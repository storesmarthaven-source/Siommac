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

  // Terminal decision outcomes commit through the transactional, receipt-guarded
  // finance_payroll_workflow_transition_tx RPC (dispatched by the workflow outbox
  // worker) — status + SoD + audit + event + payroll_locking handoff in ONE
  // exactly-once transaction. These callbacks are intentionally LOUD dead-ends so
  // any stray caller surfaces immediately instead of silently forking a second,
  // non-atomic commit path (no dual system).
  onWorkflowCompleted: async () => {
    throw new Error('finance_payroll: workflow completion commits via finance_payroll_workflow_transition_tx (outbox worker), not the adapter.');
  },

  onWorkflowReturned: async () => {
    throw new Error('finance_payroll: workflow return commits via finance_payroll_workflow_transition_tx (outbox worker), not the adapter.');
  },

  onWorkflowRejected: async () => {
    throw new Error('finance_payroll: workflow rejection commits via finance_payroll_workflow_transition_tx (outbox worker), not the adapter.');
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason, actorId }) => {
    await setRunStatus(sourceRecordId, 'cancelled', null);

    // Real canceller (threaded from cancelWorkflow) or null system actor -- never
    // the literal 'workflow' (not an app_users row; FK-violates hr_audit_log).
    await writeHrAudit({
      submoduleKey: 'finance_payroll',
      recordId:     sourceRecordId,
      actorId:      actorId ?? null,
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
