// Workflow — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { workflowRule, auditPolicy } from '../catalogHelpers';

const M = 'workflow';

export const workflowManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Workflow',
  hasSettings: true,
  moduleCategory: 'system',
  requiresSecurityReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'security'],
  sections: [
    { sectionKey: 'workflow', applies: true },
    { sectionKey: 'escalation', applies: true },
    { sectionKey: 'audit_retention', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    workflowRule(M, 'workflow.allow_parallel_approvals', {
      label: 'Parallel Approvals', description: 'Allow workflow steps to run in parallel where the template permits.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    workflowRule(M, 'workflow.allow_delegate_approval', {
      label: 'Delegate Approvals Allowed', description: 'Allow approvers to delegate assigned approvals.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    workflowRule(M, 'workflow.require_comment_on_reject', {
      label: 'Comment Required on Reject', description: 'Require a comment when rejecting a workflow.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    workflowRule(M, 'workflow.require_comment_on_return', {
      label: 'Comment Required on Return', description: 'Require a comment when returning for changes.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    workflowRule(M, 'workflow.default_due_days', {
      label: 'Default Due (days)', description: 'Default days to complete a workflow task.',
      dataType: 'number', defaultValue: 3, minValue: 1, maxValue: 90, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    workflowRule(M, 'workflow.overdue_escalation_days', {
      label: 'Overdue Escalation (days)', description: 'Days overdue before a workflow task escalates.',
      dataType: 'number', defaultValue: 2, minValue: 1, maxValue: 60, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    workflowRule(M, 'workflow.allow_admin_override', {
      label: 'Admin Override Allowed', description: 'Allow elevated users to override workflow routing (with reason).',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    auditPolicy(M, 'workflow.audit_all_transitions', {
      label: 'Audit All Transitions', description: 'Audit every workflow transition.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
  ],
};
