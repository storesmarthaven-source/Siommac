// ============================================================================
// Finance Remittances — workflow adapter
// ============================================================================
// Adapter for the `finance_remittance_approval` workflow.
// Drives the remittance lifecycle on engine events:
//   onWorkflowStarted   → status already set to submitted; nothing to do
//   onWorkflowCompleted → call approveRemittance (enforces SoD)
//   onWorkflowReturned  → roll back to draft
//   onWorkflowRejected  → roll back to draft
//   onWorkflowCancelled → roll back to draft
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter } from './definitionTypes';
import { writeHrAudit } from '../hr/employeeCore';
import { emitAppEvent } from '../appEvents';

/** Roll back a remittance to draft (on cancel). */
async function rollBackToDraft(
  recordId: string,
  actorId: string | null,
  action: string,
  reason?: string | null,
): Promise<void> {
  const { error } = await sb.from('finance_remittances')
    .update({ status: 'draft' })
    .eq('id', recordId);
  if (error) throw new Error('financeRemittancesAdapter rollBackToDraft: ' + error.message);

  await writeHrAudit({
    submoduleKey: 'finance_remittances', recordId,
    actorId:      actorId ?? 'workflow', action,
    previousState: { status: 'submitted' }, newState: { status: 'draft' },
    reason: reason ?? null,
  });
  void emitAppEvent({
    eventType:        'finance.remittance.' + action.split('.').pop(),
    sourceModule:     'finance_remittances',
    sourceEntityType: 'remittance',
    sourceEntityId:   recordId,
    actorUserId:      actorId ?? 'workflow',
    severity:         'warning',
    payload: { reason: reason ?? null },
  });
}

const financeRemittancesAdapter: ModuleWorkflowAdapter = {
  moduleKey: 'finance_remittances',

  async buildWorkflowContext() {
    // Context is built at the call site (submitRemittance), not via the adapter.
    throw new Error('finance_remittances: workflow context is built at the call site.');
  },

  onWorkflowStarted: async () => {
    // Status already set to 'submitted' at submit time — nothing to do.
  },

  onWorkflowStepCompleted: async () => {},

  // Terminal decision outcomes (approve/return/reject) commit through the
  // transactional finance_remittances_workflow_transition_tx receipt RPC via the
  // workflow outbox worker (exactly-once). Loud dead-ends so a stray caller can't
  // silently fork a second, non-atomic commit path.
  onWorkflowCompleted: async () => {
    throw new Error('finance_remittances: completion commits via finance_remittances_workflow_transition_tx (outbox worker), not the adapter.');
  },
  onWorkflowReturned: async () => {
    throw new Error('finance_remittances: return commits via finance_remittances_workflow_transition_tx (outbox worker), not the adapter.');
  },
  onWorkflowRejected: async () => {
    throw new Error('finance_remittances: rejection commits via finance_remittances_workflow_transition_tx (outbox worker), not the adapter.');
  },

  // Cancel still routes through cancelWorkflow() → this callback (not the worker),
  // so it keeps its rollback-to-draft logic.
  onWorkflowCancelled: async ({ sourceRecordId, reason }) => {
    await rollBackToDraft(sourceRecordId, null, 'remittance.workflow_cancelled', reason);
  },
};

export function registerFinanceRemittancesAdapter(): void {
  registerWorkflowAdapter(financeRemittancesAdapter);
}
