/**
 * tests/unit/workflowEngine.core.test.ts
 * Central Workflow Engine pure logic — condition evaluator + definition validator.
 */
import { evaluateWorkflowConditions, getPathValue } from '../../netlify/functions/lib/workflow/conditionEvaluator';
import { validateWorkflowDefinition } from '../../netlify/functions/lib/workflow/validateDefinition';
import type { WorkflowTemplateDefinition } from '../../netlify/functions/lib/workflow/definitionTypes';

describe('condition evaluator (§5)', () => {
  const ctx = { recordData: { permitType: 'hot_work', riskLevel: 'high', amount: 15000, tags: ['a', 'b'] } };

  it('evaluates equals / in / numeric / contains', () => {
    expect(evaluateWorkflowConditions([{ field: 'recordData.permitType', operator: 'equals', value: 'hot_work' }], ctx)).toBe(true);
    expect(evaluateWorkflowConditions([{ field: 'recordData.riskLevel', operator: 'in', value: ['high', 'critical'] }], ctx)).toBe(true);
    expect(evaluateWorkflowConditions([{ field: 'recordData.amount', operator: 'greater_than', value: 10000 }], ctx)).toBe(true);
    expect(evaluateWorkflowConditions([{ field: 'recordData.tags', operator: 'contains', value: 'a' }], ctx)).toBe(true);
  });

  it('ANDs all conditions and fails when one is false', () => {
    expect(evaluateWorkflowConditions([
      { field: 'recordData.permitType', operator: 'equals', value: 'hot_work' },
      { field: 'recordData.amount', operator: 'less_than', value: 10000 },
    ], ctx)).toBe(false);
  });

  it('empty conditions pass (no constraints)', () => {
    expect(evaluateWorkflowConditions([], ctx)).toBe(true);
  });

  it('getPathValue walks nested paths safely', () => {
    expect(getPathValue(ctx, 'recordData.permitType')).toBe('hot_work');
    expect(getPathValue(ctx, 'recordData.missing.deep')).toBeUndefined();
  });
});

describe('definition validator (§10)', () => {
  const base: WorkflowTemplateDefinition = {
    schemaVersion: 1,
    steps: [{
      stepKey: 'review', stepName: 'Supervisor Review', stepType: 'approval', sequenceNo: 1,
      assignment: { type: 'supervisor' }, required: true,
      decisionRules: { canApprove: true, canReturn: true, canReject: true, canDelegate: false, requireCommentOnApprove: false, requireCommentOnReturn: true, requireCommentOnReject: true, requireAttachment: false },
    }],
    transitions: [{ fromStep: 'review', onDecision: 'approved', completeWorkflow: true }],
    notifications: [{ event: 'task.assigned', recipients: ['current_assignee'], criticality: 'workflow_required', canBeMuted: false }],
    handoffs: [],
    sourceStatusMap: { onStarted: 'pending_approval', onCompleted: 'approved' },
    settings: { allowReturn: true, allowReject: true, allowDelegate: false, allowAdminOverride: true, requireAuditAllTransitions: true },
  };

  it('accepts a valid definition', () => {
    expect(validateWorkflowDefinition(base)).toBe(true);
  });

  it('rejects duplicate step keys', () => {
    const bad = { ...base, steps: [base.steps[0]!, base.steps[0]!] };
    expect(() => validateWorkflowDefinition(bad)).toThrow(/Duplicate stepKey/);
  });

  it('rejects a transition to an unknown step', () => {
    const bad = { ...base, transitions: [{ fromStep: 'review', onDecision: 'approved' as const, toStep: 'ghost' }] };
    expect(() => validateWorkflowDefinition(bad)).toThrow(/not a defined step/);
  });

  it('rejects a mutable required-delivery notification', () => {
    const bad = { ...base, notifications: [{ event: 'task.assigned' as const, recipients: ['current_assignee' as const], criticality: 'safety_critical' as const, canBeMuted: true }] };
    expect(() => validateWorkflowDefinition(bad)).toThrow(/cannot be mutable/);
  });
});
