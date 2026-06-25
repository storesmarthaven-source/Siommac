// Incidents · Investigations — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, safetyRule, workflowRule, notificationRule } from '../catalogHelpers';

const M = 'incidents';

export const incidentsManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Incidents · Investigations',
  hasSettings: true,
  moduleCategory: 'hse',
  requiresHseReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'hse'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'workflow', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    modulePolicy(M, 'incidents.auto_number_prefix', {
      label: 'Incident Number Prefix', description: 'Prefix used for generated incident numbers.',
      dataType: 'string', defaultValue: 'INC', scope: ['global'],
    }),
    modulePolicy(M, 'incidents.allow_employee_reporting', {
      label: 'Allow Employee Reporting', description: 'Allow normal employees to report incidents.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    modulePolicy(M, 'incidents.allow_anonymous_reporting', {
      label: 'Allow Anonymous Reporting', description: 'Allow incidents to be reported anonymously.',
      dataType: 'boolean', defaultValue: false, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    modulePolicy(M, 'incidents.require_evidence_for_high_severity', {
      label: 'Evidence for High Severity', description: 'Require evidence for high-severity incidents.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'incidents.require_witnesses_for_high_severity', {
      label: 'Witnesses for High Severity', description: 'Require witness capture for high-severity incidents.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    workflowRule(M, 'incidents.auto_create_investigation_for_severity', {
      label: 'Auto-Create Investigation At', description: 'Severity level that auto-starts an investigation.',
      dataType: 'select', defaultValue: 'high', allowedValues: ['low', 'medium', 'high', 'critical'], scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    workflowRule(M, 'incidents.investigation_due_days', {
      label: 'Investigation Due (days)', description: 'Default days to complete an investigation.',
      dataType: 'number', defaultValue: 7, minValue: 1, maxValue: 90, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    workflowRule(M, 'incidents.require_closeout_approval', {
      label: 'Require Closeout Approval', description: 'Require approval before an incident can be closed.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    notificationRule(M, 'incidents.notify_management_high_severity', {
      label: 'Notify Management (High Severity)', description: 'Immediately notify management for high-severity incidents.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    safetyRule(M, 'incidents.reportable_rules_locked', {
      label: 'Reportable Rules Locked', description: 'Lock reportable-incident rules from non-superadmin change.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
  ],
};
