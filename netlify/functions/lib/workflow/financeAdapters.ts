// ============================================================================
// Finance module workflow adapters (Phase 1)
// ============================================================================
// Adapter for the `finance_statutory_approval` workflow (Phase 1).
// The workflow adapter drives the statutory version lifecycle on engine events:
//   onWorkflowStarted   → keep status pending_approval (already set at submit)
//   onWorkflowCompleted → call applyApprovedStatutoryVersion (which enforces SoD)
//   onWorkflowReturned  → roll back to draft for corrections
//   onWorkflowRejected  → roll back to draft (no separate rejected status)
//   onWorkflowCancelled → roll back to draft
//
// No second approval authority — the engine owns the lifecycle.
// NO collaboration-rail (deferred per §0.2).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
import { applyApprovedStatutoryVersion, applyRejectedStatutoryVersion } from '../finance/statutoryConfig';
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

/** Roll back a statutory version to draft (on return/reject/cancel). */
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
    eventType: 'finance.statutory.version.' + action.split('.').pop(),
    sourceModule: 'finance_statutory', sourceEntityType: 'statutory_version',
    sourceEntityId: recordId, actorUserId: actorId ?? 'workflow',
    severity: 'warning', payload: { reason: reason ?? null },
  });
}

const financeStatutoryAdapter: ModuleWorkflowAdapter = {
  moduleKey: 'finance_statutory',

  async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    // Context is built at the call site (submitStatutoryVersion), not via the adapter.
    throw new Error('finance_statutory: workflow context is built at the call site, not via the adapter.');
  },

  onWorkflowStarted: async () => {
    // Status already set to pending_approval at submit time — nothing to do here.
  },

  onWorkflowStepCompleted: async () => {},

  onWorkflowCompleted: async ({ workflowId, sourceRecordId }) => {
    const actor = await decidedBy(workflowId);
    // applyApprovedStatutoryVersion enforces SoD (creator ≠ approver) and writes audit + event.
    await applyApprovedStatutoryVersion(sourceRecordId, actor ?? 'workflow');
  },

  onWorkflowReturned: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    await rollBackToDraft(sourceRecordId, actor, 'statutory_version.returned', comment);
  },

  onWorkflowRejected: async ({ workflowId, sourceRecordId, comment }) => {
    const actor = await decidedBy(workflowId);
    // Full reject contract (status→draft + audit statutory_version.rejected +
    // finance.statutory.version.rejected event + creator notification + config
    // thread) — same §2 parity as onWorkflowCompleted → applyApproved.
    await applyRejectedStatutoryVersion(sourceRecordId, actor ?? 'workflow', comment ?? undefined);
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason }) => {
    await rollBackToDraft(sourceRecordId, null, 'statutory_version.workflow_cancelled', reason);
  },
};

export function registerFinanceWorkflowAdapters(): void {
  registerWorkflowAdapter(financeStatutoryAdapter);
}
