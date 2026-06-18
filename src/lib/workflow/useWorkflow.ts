/**
 * src/lib/workflow/useWorkflow.ts
 *
 * Thin reactive Preact binding over the framework-agnostic workflow store. Holds
 * no logic — it subscribes to the store and re-renders on commit, then exposes
 * the current state plus the bound actions. Any module's components use this to
 * read workflow/approval/audit/handoff slices and drive decisions.
 */

import { useSyncExternalStore } from 'preact/compat';
import { useMemo } from 'preact/hooks';
import {
  getWorkflowState, subscribeWorkflow, submitWorkflow, decide, toggleEvidence,
  emitHandoff, addAudit, clearNotifications, resetWorkflow,
} from './store';
import type { ActorContext, WorkflowState, Decision } from './types';

/** Default actor for the mock until wired to the real session role. */
const DEMO_ACTOR: ActorContext = { actor: 'Sarah Chen', role: 'HSE Manager' };

export interface UseWorkflow {
  readonly state: WorkflowState;
  /** Open (non-closed) workflow count — handy for KPIs. */
  readonly openCount: number;
  readonly blockedCount: number;
  readonly pendingApprovals: WorkflowState['approvals'];
  readonly submit:   (input: Parameters<typeof submitWorkflow>[1]) => void;
  readonly decide:   (approvalId: string, decision: Decision, comment?: string) => void;
  readonly toggleEvidence: typeof toggleEvidence;
  readonly emitHandoff: (h: Parameters<typeof emitHandoff>[1]) => void;
  readonly audit:    (module: Parameters<typeof addAudit>[1], event: string, impact: string) => void;
  readonly clearNotifications: typeof clearNotifications;
  readonly reset:    typeof resetWorkflow;
}

export function useWorkflow(ctx: ActorContext = DEMO_ACTOR): UseWorkflow {
  const state = useSyncExternalStore(subscribeWorkflow, getWorkflowState);

  return useMemo<UseWorkflow>(() => ({
    state,
    openCount:    state.workflows.filter(w => !/closed|rejected/.test(w.status)).length,
    blockedCount: state.workflows.filter(w => /blocked|critical/.test(w.status) || w.priority === 'critical').length,
    pendingApprovals: state.approvals.filter(a => /pending|in_review|returned/.test(a.status)),
    submit:   input => submitWorkflow(ctx, input),
    decide:   (id, decision, comment) => decide(ctx, id, decision, comment),
    toggleEvidence,
    emitHandoff: h => emitHandoff(ctx, h),
    audit:    (module, event, impact) => addAudit(ctx, module, event, impact),
    clearNotifications,
    reset:    resetWorkflow,
  }), [state, ctx]);
}
