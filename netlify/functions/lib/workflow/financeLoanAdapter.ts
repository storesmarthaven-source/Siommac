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
import { emitAppEvent } from '../appEvents';
import { getLoan, emitLoanActivatedSideEffects } from '../finance/loans';

async function decidedBy(workflowId: string): Promise<string | null> {
  const { data } = await sb.from('workflow_decisions')
    .select('actor_id').eq('workflow_id', workflowId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle<{ actor_id: string | null }>();
  return data?.actor_id ?? null;
}

async function setLoanStatus(loanId: string, status: string, patch: Record<string, unknown> = {}): Promise<void> {
  const { error } = await sb.from('finance_employee_loans').update({ status, ...patch }).eq('id', loanId);
  if (error) throw new Error('financeLoanAdapter setLoanStatus: ' + error.message);
}

const financeLoanAdapter: ModuleWorkflowAdapter = {
  moduleKey:    'finance_loan',
  workflowType: 'finance_loan_approval',

  async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    throw new Error('finance_loan: workflow context is built at the call site (submitLoan), not via the adapter.');
  },

  onWorkflowStarted: async () => { /* status already pending_approval at submit time */ },
  onWorkflowStepCompleted: async () => {},

  onWorkflowCompleted: async ({ workflowId, sourceRecordId }) => {
    const actor = await decidedBy(workflowId);
    const loan = await getLoan(sourceRecordId);
    if (!loan) return;

    // SoD: the loan's creator cannot approve their own loan.
    if (actor && loan.createdBy && actor === loan.createdBy) {
      throw Object.assign(new Error('Segregation of duties violation: creator cannot approve their own loan.'), { status: 422 });
    }

    await setLoanStatus(sourceRecordId, 'active', { approved_by: actor, approved_at: new Date().toISOString() });

    await writeHrAudit({
      submoduleKey: 'finance_loan', recordId: sourceRecordId, actorId: actor ?? 'workflow',
      action: 'loan.approved', previousState: { status: 'pending_approval' }, newState: { status: 'active', approvedBy: actor },
    });

    const activated = await getLoan(sourceRecordId);
    if (activated) await emitLoanActivatedSideEffects(activated, actor);
  },

  onWorkflowReturned: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    await setLoanStatus(sourceRecordId, 'draft');
    await writeHrAudit({
      submoduleKey: 'finance_loan', recordId: sourceRecordId, actorId: actor ?? 'workflow',
      action: 'loan.returned', previousState: { status: 'pending_approval' }, newState: { status: 'draft' }, reason: comment ?? null,
    });
    void emitAppEvent({
      eventType: 'finance.loan.returned', sourceModule: 'finance_loan',
      sourceEntityType: 'employee_loan', sourceEntityId: sourceRecordId, actorUserId: actor ?? 'workflow', severity: 'warning',
      payload: { reason: comment ?? null },
    });
  },

  onWorkflowRejected: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    await setLoanStatus(sourceRecordId, 'rejected');
    await writeHrAudit({
      submoduleKey: 'finance_loan', recordId: sourceRecordId, actorId: actor ?? 'workflow',
      action: 'loan.rejected', previousState: { status: 'pending_approval' }, newState: { status: 'rejected' }, reason: comment ?? null,
    });
    void emitAppEvent({
      eventType: 'finance.loan.rejected', sourceModule: 'finance_loan',
      sourceEntityType: 'employee_loan', sourceEntityId: sourceRecordId, actorUserId: actor ?? 'workflow', severity: 'warning',
      payload: { reason: comment ?? null },
    });
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason, actorId }) => {
    await setLoanStatus(sourceRecordId, 'cancelled');
    // Use the real canceller (threaded from cancelWorkflow); null is a valid
    // system actor (hr_audit_log.actor_id is nullable) -- never the literal
    // 'workflow', which isn't an app_users row and FK-violates.
    await writeHrAudit({
      submoduleKey: 'finance_loan', recordId: sourceRecordId, actorId: actorId ?? null,
      action: 'loan.workflow_cancelled', previousState: { status: 'pending_approval' }, newState: { status: 'cancelled' }, reason: reason ?? null,
    });
  },
};

export function registerFinanceLoanAdapter(): void {
  registerWorkflowAdapter(financeLoanAdapter);
}
