// ============================================================================
// HR Overtime workflow adapter
// ============================================================================
// Adapter for the `hr_overtime_approval` workflow.
// The central engine drives the overtime entry lifecycle:
//   onWorkflowStarted   → status already 'submitted' at entry creation
//   onWorkflowCompleted → approveOvertimeEntry (writes audit + event)
//   onWorkflowReturned  → keep 'submitted' (return is not meaningful here)
//   onWorkflowRejected  → set status to rejected
//   onWorkflowCancelled → set status to cancelled
//
// No SoD check for OT: employee submits, manager approves (different people
// by design — employee cannot be manager approver of own OT).
// No collaboration-rail (deferred §0.2).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
import { approveOvertimeEntry, setOvertimeStatus } from '../hr/overtimeMutations';
import { emitAppEvent } from '../appEvents';

async function decidedBy(workflowId: string): Promise<string | null> {
  const { data } = await sb.from('workflow_decisions')
    .select('actor_id').eq('workflow_id', workflowId)
    .order('created_at', { ascending: false }).limit(1)
    .maybeSingle<{ actor_id: string | null }>();
  return data?.actor_id ?? null;
}

const hrOvertimeAdapter: ModuleWorkflowAdapter = {
  moduleKey: 'hr_overtime',

  async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    throw new Error('hr_overtime: workflow context is built at the call site, not via the adapter.');
  },

  onWorkflowStarted: async () => {
    // Status already 'submitted' when the entry was created — nothing to do.
  },

  onWorkflowStepCompleted: async () => {},

  onWorkflowCompleted: async ({ workflowId, sourceRecordId }) => {
    const actor = await decidedBy(workflowId);
    await approveOvertimeEntry(sourceRecordId, actor ?? 'workflow');
  },

  onWorkflowReturned: async ({ workflowId, sourceRecordId, comment }) => {
    // OT does not have a 'draft' state; keep 'submitted' on return so manager
    // can re-decide or employee can cancel and resubmit.
    const actor = await decidedBy(workflowId);
    void emitAppEvent({
      eventType: 'hr.overtime.review_returned',
      sourceModule: 'hr_overtime', sourceEntityType: 'overtime_entry',
      sourceEntityId: sourceRecordId, actorUserId: actor ?? 'workflow',
      severity: 'info', payload: { comment: comment ?? null },
    });
  },

  onWorkflowRejected: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    await setOvertimeStatus(sourceRecordId, 'rejected', actor, { reason: comment });
    void emitAppEvent({
      eventType: 'hr.overtime.rejected',
      sourceModule: 'hr_overtime', sourceEntityType: 'overtime_entry',
      sourceEntityId: sourceRecordId, actorUserId: actor ?? 'workflow',
      severity: 'warning', payload: { reason: comment ?? null },
    });
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason }) => {
    await setOvertimeStatus(sourceRecordId, 'cancelled', null, { reason });
    void emitAppEvent({
      eventType: 'hr.overtime.cancelled',
      sourceModule: 'hr_overtime', sourceEntityType: 'overtime_entry',
      sourceEntityId: sourceRecordId, actorUserId: 'workflow',
      severity: 'info', payload: { reason: reason ?? null },
    });
  },
};

export function registerHrOvertimeAdapter(): void {
  registerWorkflowAdapter(hrOvertimeAdapter);
}
