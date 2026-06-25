// ============================================================================
// Central Workflow Engine — step transition logic (Spec §13) — pure & testable
// ============================================================================
// Decides the first step(s) and the next step(s) after a decision. Honors
// explicit definition.transitions; falls back to sequence order for a linear
// flow when no transition matches an approval.
// ============================================================================

import type { WorkflowTemplateDefinition, WorkflowStepDefinition } from './definitionTypes';
import { evaluateWorkflowConditions } from './conditionEvaluator';

/** The runnable first step(s) — all steps sharing the lowest sequenceNo (parallel). */
export function firstSteps(def: WorkflowTemplateDefinition): WorkflowStepDefinition[] {
  if (!def.steps?.length) return [];
  const min = Math.min(...def.steps.map((s) => s.sequenceNo));
  return def.steps.filter((s) => s.sequenceNo === min);
}

export interface NextResolution { nextSteps: WorkflowStepDefinition[]; complete: boolean }

export function resolveNext(
  def: WorkflowTemplateDefinition,
  currentStepKey: string,
  decision: 'approved' | 'returned' | 'rejected',
  context: Record<string, unknown>,
): NextResolution {
  const byKey = new Map(def.steps.map((s) => [s.stepKey, s]));

  const explicit = (def.transitions ?? []).filter(
    (t) => t.fromStep === currentStepKey && t.onDecision === decision &&
      evaluateWorkflowConditions(t.conditions ?? [], context),
  );
  if (explicit.some((t) => t.completeWorkflow)) return { nextSteps: [], complete: true };

  const explicitNext: WorkflowStepDefinition[] = [];
  for (const t of explicit) {
    if (t.toStep) { const s = byKey.get(t.toStep); if (s) explicitNext.push(s); }
  }
  if (explicitNext.length > 0) return { nextSteps: explicitNext, complete: false };

  // No explicit transition. Approval falls through to the next sequence step.
  if (decision === 'approved') {
    const cur = byKey.get(currentStepKey);
    if (cur) {
      const higher = def.steps.filter((s) => s.sequenceNo > cur.sequenceNo).sort((a, b) => a.sequenceNo - b.sequenceNo);
      if (higher.length > 0) {
        const nextSeq = higher[0]!.sequenceNo;
        return { nextSteps: higher.filter((s) => s.sequenceNo === nextSeq), complete: false };
      }
    }
    return { nextSteps: [], complete: true };
  }
  return { nextSteps: [], complete: false };
}
