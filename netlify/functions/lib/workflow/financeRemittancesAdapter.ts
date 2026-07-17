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
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
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
    eventType:        'finance.remittance.' + (action.split('.').pop() ?? action),
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

  buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    // Context is built at the call site (submitRemittance), not via the adapter.
    throw new Error('finance_remittances: workflow context is built at the call site.');
  },

  // Status already set to 'submitted' at submit time — nothing to do.
  onWorkflowStarted: () => Promise.resolve(),

  onWorkflowStepCompleted: () => Promise.resolve(),

  // Terminal decision outcomes (approve/return/reject) commit through the
  // transactional finance_remittances_workflow_transition_tx receipt RPC via the
  // workflow outbox worker (exactly-once). Loud dead-ends so a stray caller can't
  // silently fork a second, non-atomic commit path.
  onWorkflowCompleted: () => {
    throw new Error('finance_remittances: completion commits via finance_remittances_workflow_transition_tx (outbox worker), not the adapter.');
  },
  onWorkflowReturned: () => {
    throw new Error('finance_remittances: return commits via finance_remittances_workflow_transition_tx (outbox worker), not the adapter.');
  },
  onWorkflowRejected: () => {
    throw new Error('finance_remittances: rejection commits via finance_remittances_workflow_transition_tx (outbox worker), not the adapter.');
  },

  // Legacy fallback; the registered receipt handler owns normal outbox cancels.
  onWorkflowCancelled: async ({ sourceRecordId, reason, actorId }) => {
    await rollBackToDraft(sourceRecordId, actorId ?? null, 'remittance.workflow_cancelled', reason);
  },
};

export function registerFinanceRemittancesAdapter(): void {
  registerWorkflowAdapter(financeRemittancesAdapter);
}
