/**
 * tests/unit/workflowEngine.transitions.test.ts
 * Step transition logic (§13) — first steps + next-step resolution.
 */
import { firstSteps, resolveNext } from '../../netlify/functions/lib/workflow/transitions';
import type { WorkflowTemplateDefinition, WorkflowStepDefinition } from '../../netlify/functions/lib/workflow/definitionTypes';

const mkStep = (key: string, seq: number): WorkflowStepDefinition => ({
  stepKey: key, stepName: key, stepType: 'approval', sequenceNo: seq, assignment: { type: 'supervisor' }, required: true,
  decisionRules: { canApprove: true, canReturn: true, canReject: true, canDelegate: false, requireCommentOnApprove: false, requireCommentOnReturn: true, requireCommentOnReject: true, requireAttachment: false },
});

const linear: WorkflowTemplateDefinition = {
  schemaVersion: 1,
  steps: [mkStep('a', 1), mkStep('b', 2), mkStep('c', 3)],
  transitions: [],
  notifications: [], handoffs: [], sourceStatusMap: {},
  settings: { allowReturn: true, allowReject: true, allowDelegate: false, allowAdminOverride: true, requireAuditAllTransitions: true },
};

describe('transitions (§13)', () => {
  it('firstSteps returns the lowest-sequence step(s)', () => {
    expect(firstSteps(linear).map((s) => s.stepKey)).toEqual(['a']);
    const parallel = { ...linear, steps: [mkStep('a', 1), mkStep('a2', 1), mkStep('b', 2)] };
    expect(firstSteps(parallel).map((s) => s.stepKey).sort()).toEqual(['a', 'a2']);
  });

  it('linear approval advances by sequence, then completes', () => {
    expect(resolveNext(linear, 'a', 'approved', {})).toMatchObject({ complete: false });
    expect(resolveNext(linear, 'a', 'approved', {}).nextSteps.map((s) => s.stepKey)).toEqual(['b']);
    expect(resolveNext(linear, 'c', 'approved', {})).toMatchObject({ complete: true });
  });

  it('explicit completeWorkflow transition ends the workflow', () => {
    const def = { ...linear, transitions: [{ fromStep: 'a', onDecision: 'approved' as const, completeWorkflow: true }] };
    expect(resolveNext(def, 'a', 'approved', {})).toMatchObject({ complete: true });
  });

  it('explicit toStep transition jumps to the target', () => {
    const def = { ...linear, transitions: [{ fromStep: 'a', onDecision: 'approved' as const, toStep: 'c' }] };
    expect(resolveNext(def, 'a', 'approved', {}).nextSteps.map((s) => s.stepKey)).toEqual(['c']);
  });

  it('conditional transition only fires when conditions pass', () => {
    const def = { ...linear, transitions: [{ fromStep: 'a', onDecision: 'approved' as const, toStep: 'c', conditions: [{ field: 'recordData.riskLevel', operator: 'equals' as const, value: 'high' }] }] };
    expect(resolveNext(def, 'a', 'approved', { recordData: { riskLevel: 'low' } }).nextSteps.map((s) => s.stepKey)).toEqual(['b']); // falls through to sequence
    expect(resolveNext(def, 'a', 'approved', { recordData: { riskLevel: 'high' } }).nextSteps.map((s) => s.stepKey)).toEqual(['c']);
  });

  it('return does not advance', () => {
    expect(resolveNext(linear, 'b', 'returned', {})).toEqual({ nextSteps: [], complete: false });
  });
});
