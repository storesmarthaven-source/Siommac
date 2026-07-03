// ============================================================================
// HR Compensation workflow adapter
// ============================================================================
// Adapter for the `hr_compensation_change_approval` workflow.
// The central engine drives the pay-item lifecycle:
//   onWorkflowStarted   → status already pending_approval at submit time
//   onWorkflowCompleted → approvePayItem (enforces SoD, writes audit + event)
//   onWorkflowReturned  → roll back to draft for corrections
//   onWorkflowRejected  → set status to rejected
//   onWorkflowCancelled → roll back to draft
//
// No second approval authority. No collaboration-rail (deferred §0.2).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
import { approvePayItem, setPayItemStatus } from '../hr/compensationMutations';
import { writeHrAudit } from '../hr/employeeCore';
import { emitAppEvent } from '../appEvents';

async function decidedBy(workflowId: string): Promise<string | null> {
  const { data } = await sb.from('workflow_decisions')
    .select('actor_id').eq('workflow_id', workflowId)
    .order('created_at', { ascending: false }).limit(1)
    .maybeSingle<{ actor_id: string | null }>();
  return data?.actor_id ?? null;
}

async function rollPayItemToDraft(
  recordId: string,
  actorId: string | null,
  action: string,
  reason?: string | null,
): Promise<void> {
  await setPayItemStatus(recordId, 'draft', actorId, { reason });
  await writeHrAudit({
    submoduleKey: 'hr_compensation', recordId, actorId: actorId ?? 'workflow', action,
    previousState: { status: 'pending_approval' }, newState: { status: 'draft' },
    reason: reason ?? null,
  });
  void emitAppEvent({
    eventType: 'hr.compensation.item.' + action.split('.').pop(),
    sourceModule: 'hr_compensation', sourceEntityType: 'pay_item',
    sourceEntityId: recordId, actorUserId: actorId ?? 'workflow',
    severity: 'warning', payload: { reason: reason ?? null },
  });
}

const hrCompensationAdapter: ModuleWorkflowAdapter = {
  moduleKey: 'hr_compensation',

  async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    throw new Error('hr_compensation: workflow context is built at the call site, not via the adapter.');
  },

  onWorkflowStarted: async () => {
    // Status already set to pending_approval at submit time — nothing to do.
  },

  onWorkflowStepCompleted: async () => {},

  onWorkflowCompleted: async ({ workflowId, sourceRecordId }) => {
    const actor = await decidedBy(workflowId);
    // approvePayItem enforces SoD (creator ≠ approver) and writes audit + event.
    await approvePayItem(sourceRecordId, actor ?? 'workflow');
  },

  onWorkflowReturned: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    await rollPayItemToDraft(sourceRecordId, actor, 'pay_item.returned', comment);
  },

  onWorkflowRejected: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    // Rejected status is a terminal state (not draft)
    await setPayItemStatus(sourceRecordId, 'rejected', actor, { reason: comment });
    void emitAppEvent({
      eventType: 'hr.compensation.item.rejected',
      sourceModule: 'hr_compensation', sourceEntityType: 'pay_item',
      sourceEntityId: sourceRecordId, actorUserId: actor ?? 'workflow',
      severity: 'warning', payload: { reason: comment ?? null },
    });
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason }) => {
    await rollPayItemToDraft(sourceRecordId, null, 'pay_item.workflow_cancelled', reason);
  },
};

export function registerHrCompensationAdapter(): void {
  registerWorkflowAdapter(hrCompensationAdapter);
}
