/**
 * tests/unit/workflowEngine.resolvers.test.ts
 * Binding resolver (§6) + assignee resolver (§11) — pure selection logic.
 */
import { pickBinding, scopeRank, scopeMatches, type WorkflowBindingRow } from '../../netlify/functions/lib/workflow/bindingResolver';
import { resolveStepAssignee } from '../../netlify/functions/lib/workflow/assigneeResolver';
import type { ModuleWorkflowContext, WorkflowStepDefinition } from '../../netlify/functions/lib/workflow/definitionTypes';

const ctx: ModuleWorkflowContext = {
  moduleKey: 'ptw', workflowType: 'permit_approval', triggerEvent: 'ptw.submitted',
  sourceRecordId: 'PTW-1', requestedBy: 'u1', siteId: 'site-pl', departmentId: 'dept-maint',
  actorRoleIds: ['supervisor'], ownerId: 'owner-9',
  recordData: { permitType: 'hot_work', supervisorId: 'sup-3', areaOwnerId: 'area-5' },
};

function binding(p: Partial<WorkflowBindingRow>): WorkflowBindingRow {
  return {
    id: p.id ?? 'b', module_key: 'ptw', workflow_type: 'permit_approval', trigger_event: 'ptw.submitted',
    template_id: p.template_id ?? 't', template_version_id: null, scope_type: p.scope_type ?? 'global',
    scope_id: p.scope_id ?? null, priority: p.priority ?? 100, conditions: p.conditions ?? null, is_active: p.is_active ?? true,
  };
}

describe('binding resolver (§6)', () => {
  it('ranks scope site < department < role < global', () => {
    expect(scopeRank('site')).toBeLessThan(scopeRank('department'));
    expect(scopeRank('department')).toBeLessThan(scopeRank('role'));
    expect(scopeRank('role')).toBeLessThan(scopeRank('global'));
  });

  it('scopeMatches by scope type', () => {
    expect(scopeMatches(binding({ scope_type: 'global' }), ctx)).toBe(true);
    expect(scopeMatches(binding({ scope_type: 'site', scope_id: 'site-pl' }), ctx)).toBe(true);
    expect(scopeMatches(binding({ scope_type: 'site', scope_id: 'other' }), ctx)).toBe(false);
    expect(scopeMatches(binding({ scope_type: 'role', scope_id: 'supervisor' }), ctx)).toBe(true);
  });

  it('most-specific scope wins over global', () => {
    const chosen = pickBinding([
      binding({ id: 'global', scope_type: 'global', priority: 1 }),
      binding({ id: 'site', scope_type: 'site', scope_id: 'site-pl', priority: 100 }),
    ], ctx);
    expect(chosen?.id).toBe('site');
  });

  it('lowest priority wins within a scope; conditions + active filter', () => {
    const chosen = pickBinding([
      binding({ id: 'p100', scope_type: 'global', priority: 100 }),
      binding({ id: 'p10', scope_type: 'global', priority: 10 }),
      binding({ id: 'inactive', scope_type: 'global', priority: 1, is_active: false }),
    ], ctx);
    expect(chosen?.id).toBe('p10');
  });

  it('condition mismatch excludes a binding', () => {
    const chosen = pickBinding([
      binding({ id: 'hot', scope_type: 'global', priority: 10, conditions: { conditions: [{ field: 'recordData.permitType', operator: 'equals', value: 'cold_work' }] } }),
    ], ctx);
    expect(chosen).toBeNull();
  });
});

describe('assignee resolver (§11)', () => {
  const step = (type: WorkflowStepDefinition['assignment']['type'], value?: string, dynamicField?: string): WorkflowStepDefinition => ({
    stepKey: 's', stepName: 'S', stepType: 'approval', sequenceNo: 1, assignment: { type, value, dynamicField }, required: true,
    decisionRules: { canApprove: true, canReturn: true, canReject: true, canDelegate: false, requireCommentOnApprove: false, requireCommentOnReturn: true, requireCommentOnReject: true, requireAttachment: false },
  });

  it('resolves fixed_user / role / supervisor / record_owner / permit_area_owner', () => {
    expect(resolveStepAssignee(step('fixed_user', 'u-fixed'), ctx)).toEqual({ userId: 'u-fixed' });
    expect(resolveStepAssignee(step('role', 'hse_manager'), ctx)).toEqual({ roleKey: 'hse_manager' });
    expect(resolveStepAssignee(step('supervisor'), ctx)).toEqual({ userId: 'sup-3' });
    expect(resolveStepAssignee(step('record_owner'), ctx)).toEqual({ userId: 'owner-9' });
    expect(resolveStepAssignee(step('permit_area_owner'), ctx)).toEqual({ userId: 'area-5' });
  });

  it('dynamic_field reads a context path', () => {
    expect(resolveStepAssignee(step('dynamic_field', undefined, 'recordData.supervisorId'), ctx)).toEqual({ userId: 'sup-3' });
  });
});
