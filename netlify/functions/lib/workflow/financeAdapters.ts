// ============================================================================
// Finance module workflow adapters (Phase 1)
// ============================================================================
// Adapter for the `finance_statutory_approval` workflow (Phase 1).
// The workflow adapter drives the statutory version lifecycle on engine events:
//   onWorkflowStarted   → keep status pending_approval (already set at submit)
//   onWorkflowCompleted/Returned/Rejected → THROW (receipt RPC owns them, audit F3:
//     finance_statutory_workflow_transition_tx via the outbox worker)
//   onWorkflowCancelled → legacy fallback; receipt-backed modules use the outbox worker
//
// No second approval authority — the engine owns the lifecycle.
// NO collaboration-rail (deferred per §0.2).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
import { writeHrAudit } from '../hr/employeeCore';
import { emitAppEvent } from '../appEvents';

/** Roll back a statutory version to draft (on cancel — the only adapter-driven path). */
async function rollBackToDraft(
  recordId: string,
  actorId: string | null,
  action: string,
  reason?: string | null,
): Promise<void> {
  const { error } = await sb.from('finance_statutory_versions')
    .update({ status: 'draft' })
    .eq('id', recordId);
  if (error) throw new Error('financeStatutoryAdapter rollBackToDraft: ' + error.message);

  await writeHrAudit({
    submoduleKey: 'finance_statutory', recordId,
    actorId: actorId ?? 'workflow', action,
    previousState: { status: 'pending_approval' }, newState: { status: 'draft' },
    reason: reason ?? null,
  });
  void emitAppEvent({
    eventType: 'finance.statutory.version.' + (action.split('.').pop() ?? action),
    sourceModule: 'finance_statutory', sourceEntityType: 'statutory_version',
    sourceEntityId: recordId, actorUserId: actorId ?? 'workflow',
    severity: 'warning', payload: { reason: reason ?? null },
  });
}

const financeStatutoryAdapter: ModuleWorkflowAdapter = {
  moduleKey: 'finance_statutory',

  buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    // Context is built at the call site (submitStatutoryVersion), not via the adapter.
    throw new Error('finance_statutory: workflow context is built at the call site, not via the adapter.');
  },

  // Status already set to pending_approval at submit time — nothing to do here.
  onWorkflowStarted: () => Promise.resolve(),

  onWorkflowStepCompleted: () => Promise.resolve(),

  onWorkflowCompleted: () => {
    // Audit F3: statutory completion commits via finance_statutory_workflow_transition_tx
    // (receipt RPC in the outbox worker) — never the adapter (retry-safety).
    throw new Error('finance_statutory: workflow completion commits via finance_statutory_workflow_transition_tx (outbox worker), not the adapter.');
  },

  onWorkflowReturned: () => {
    throw new Error('finance_statutory: workflow return commits via finance_statutory_workflow_transition_tx (outbox worker), not the adapter.');
  },

  onWorkflowRejected: () => {
    throw new Error('finance_statutory: workflow rejection commits via finance_statutory_workflow_transition_tx (outbox worker), not the adapter.');
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason, actorId }) => {
    await rollBackToDraft(sourceRecordId, actorId ?? null, 'statutory_version.workflow_cancelled', reason);
  },
};

export function registerFinanceWorkflowAdapters(): void {
  registerWorkflowAdapter(financeStatutoryAdapter);
}
