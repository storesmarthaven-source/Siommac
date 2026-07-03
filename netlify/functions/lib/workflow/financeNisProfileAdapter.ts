// ============================================================================
// Finance NIS Profile Verification — workflow adapter (Phase 2.5)
// ============================================================================
// Adapter for the `finance_nis_profile_verification` workflow.
// Module key: finance_payroll
// Trigger:    finance.nis.profile.submitted
//
// The central engine drives the NIS profile verification lifecycle:
//   onWorkflowStarted   → no status change (profile stays pending_verification)
//   onWorkflowCompleted → set nis_status='verified' + verified_by/at (Finance)
//   onWorkflowReturned  → stay at pending_verification (Finance Staff returned
//                         for HR correction — nis_status unchanged)
//   onWorkflowRejected  → set nis_status='not_available' (Finance cannot verify)
//   onWorkflowCancelled → stay at pending_verification
//
// HR CANNOT set nis_status='verified' — only this adapter (triggered on
// workflow completion) does so. The permission check is in the route layer.
//
// No second approval authority. No collaboration-rail (deferred §0.2).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext } from './definitionTypes';
import { setNisProfileStatus } from '../finance/nisProfileVerification';
import { writeHrAudit } from '../hr/employeeCore';
import { emitAppEvent } from '../appEvents';

/** Resolve the actor from the most recent workflow decision. */
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

const financeNisProfileAdapter: ModuleWorkflowAdapter = {
  moduleKey:    'finance_payroll',
  workflowType: 'finance_nis_profile_verification',

  async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
    // Context is built at the call site (submitStatutoryProfile), not via the adapter.
    throw new Error('finance_payroll/nis: workflow context is built at the call site, not via the adapter.');
  },

  onWorkflowStarted: async () => {
    // Profile remains in pending_verification — no status change at start.
  },

  onWorkflowStepCompleted: async () => {},

  onWorkflowCompleted: async ({ workflowId, sourceRecordId }) => {
    // Finance Manager has verified — set nis_status='verified'.
    const actor = await decidedBy(workflowId);
    await setNisProfileStatus(sourceRecordId, 'verified', actor, {
      verifiedBy: actor,
      note: null,
    });
    void emitAppEvent({
      eventType:       'finance.nis.profile.verified',
      sourceModule:    'finance_payroll',
      sourceEntityType: 'statutory_profile',
      sourceEntityId:  sourceRecordId,
      actorUserId:     actor ?? 'workflow',
      severity:        'success',
      payload:         { verifiedByWorkflow: true },
    });
  },

  onWorkflowReturned: async ({ workflowId, sourceRecordId, comment }) => {
    // Finance Staff returned to HR for correction — profile stays pending_verification.
    const actor = await decidedBy(workflowId);
    await writeHrAudit({
      submoduleKey: 'finance_payroll_nis',
      recordId:     sourceRecordId,
      actorId:      actor ?? 'workflow',
      action:       'nis_profile.workflow_returned',
      previousState: { nisStatus: 'pending_verification' },
      newState:      { nisStatus: 'pending_verification' },
      reason:        comment ?? null,
    });
    void emitAppEvent({
      eventType:       'finance.nis.profile.returned',
      sourceModule:    'finance_payroll',
      sourceEntityType: 'statutory_profile',
      sourceEntityId:  sourceRecordId,
      actorUserId:     actor ?? 'workflow',
      severity:        'warning',
      payload:         { reason: comment ?? null },
    });
  },

  onWorkflowRejected: async ({ workflowId, sourceRecordId, comment }) => {
    // Finance cannot verify — set to not_available so HR knows to correct + re-submit.
    const actor = await decidedBy(workflowId);
    await setNisProfileStatus(sourceRecordId, 'not_available', actor, { note: comment });
    void emitAppEvent({
      eventType:       'finance.nis.profile.rejected',
      sourceModule:    'finance_payroll',
      sourceEntityType: 'statutory_profile',
      sourceEntityId:  sourceRecordId,
      actorUserId:     actor ?? 'workflow',
      severity:        'warning',
      payload:         { reason: comment ?? null },
    });
  },

  onWorkflowCancelled: async ({ sourceRecordId, reason }) => {
    // Profile stays at pending_verification — HR may re-submit.
    await writeHrAudit({
      submoduleKey: 'finance_payroll_nis',
      recordId:     sourceRecordId,
      actorId:      'workflow',
      action:       'nis_profile.workflow_cancelled',
      previousState: null,
      newState:      { nisStatus: 'pending_verification' },
      reason:        reason ?? null,
    });
  },
};

export function registerFinanceNisProfileAdapter(): void {
  registerWorkflowAdapter(financeNisProfileAdapter);
}
