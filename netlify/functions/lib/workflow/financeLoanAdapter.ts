// ============================================================================
// Finance — employee-loan approval workflow adapter (Wave 5)
// ============================================================================
// Adapter for the `finance_loan_approval` workflow.
//   Module key: finance_loan   Trigger: finance.loan.submitted
//   onWorkflowCompleted → loan status='active' + approved_by (SoD enforced here)
//   onWorkflowReturned  → 'draft'      onWorkflowRejected → 'rejected'
//   onWorkflowCancelled → 'cancelled'
// SoD: creator (created_by) ≠ approver, enforced before activation.
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
import { writeHrAudit } from '../hr/employeeCore';

async function setLoanStatus(loanId: string, status: string, patch: Record<string, unknown> = {}): Promise<void> {
  const { error } = await sb.from('finance_employee_loans').update({ status, ...patch }).eq('id', loanId);
  if (error) throw new Error('financeLoanAdapter setLoanStatus: ' + error.message);
}

const financeLoanAdapter: ModuleWorkflowAdapter = {
  moduleKey:    'finance_loan',
  workflowType: 'finance_loan_approval',

  buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    throw new Error('finance_loan: workflow context is built at the call site (submitLoan), not via the adapter.');
  },

  onWorkflowStarted: () => Promise.resolve(), // status already pending_approval at submit time
  onWorkflowStepCompleted: () => Promise.resolve(),

  // Terminal decision outcomes (approve/return/reject) commit through the
  // transactional finance_loan_workflow_transition_tx receipt RPC via the workflow
  // outbox worker (exactly-once). Loud dead-ends so a stray caller can't silently
  // fork a second, non-atomic commit path.
  onWorkflowCompleted: () => {
    throw new Error('finance_loan: completion commits via finance_loan_workflow_transition_tx (outbox worker), not the adapter.');
  },
  onWorkflowReturned: () => {
    throw new Error('finance_loan: return commits via finance_loan_workflow_transition_tx (outbox worker), not the adapter.');
  },
  onWorkflowRejected: () => {
    throw new Error('finance_loan: rejection commits via finance_loan_workflow_transition_tx (outbox worker), not the adapter.');
  },

  // Legacy fallback; the registered receipt handler owns normal outbox cancels.
  onWorkflowCancelled: async ({ sourceRecordId, reason, actorId }) => {
    await setLoanStatus(sourceRecordId, 'cancelled');
    // Use the real canceller (threaded from cancelWorkflow); null is a valid
    // system actor (hr_audit_log.actor_id is nullable) -- never the literal
    // 'workflow', which isn't an app_users row and FK-violates.
    await writeHrAudit({
      submoduleKey: 'finance_loan', recordId: sourceRecordId, actorId: actorId ?? null,
      action: 'loan.workflow_cancelled', previousState: { status: 'pending_approval' }, newState: { status: 'cancelled' }, reason,
    });
  },
};

export function registerFinanceLoanAdapter(): void {
  registerWorkflowAdapter(financeLoanAdapter);
}
