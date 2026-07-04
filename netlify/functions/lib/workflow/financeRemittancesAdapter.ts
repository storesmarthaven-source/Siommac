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
import { approveRemittance } from '../finance/remittances';
import { writeHrAudit } from '../hr/employeeCore';
import { emitAppEvent } from '../appEvents';

/** Resolve the most recent decision actor from workflow_decisions. */
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

/** Roll back a remittance to draft (on return/reject/cancel). */
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

  onWorkflowCompleted: async ({ workflowId, sourceRecordId }) => {
    const actor = await decidedBy(workflowId);
    // approveRemittance enforces SoD (creator ≠ approver) and writes audit + event.
    await approveRemittance(sourceRecordId, actor ?? 'workflow');
  },

  onWorkflowReturned: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    await rollBackToDraft(sourceRecordId, actor, 'remittance.returned', comment);
  },

  onWorkflowRejected: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    await rollBackToDraft(sourceRecordId, actor, 'remittance.rejected_by_workflow', comment);
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason }) => {
    await rollBackToDraft(sourceRecordId, null, 'remittance.workflow_cancelled', reason);
  },
};

export function registerFinanceRemittancesAdapter(): void {
  registerWorkflowAdapter(financeRemittancesAdapter);
}
