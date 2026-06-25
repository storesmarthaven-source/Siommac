// Permit to Work — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, safetyRule, workflowRule, auditPolicy } from '../catalogHelpers';

const M = 'ptw';

export const ptwManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Permit to Work',
  hasSettings: true,
  moduleCategory: 'safety_critical',
  requiresHseReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'hse'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'numbering', applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'workflow', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    modulePolicy(M, 'ptw.auto_number_prefix', {
      label: 'Permit Number Prefix', description: 'Prefix used for generated permit numbers.',
      dataType: 'string', defaultValue: 'PTW', scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    modulePolicy(M, 'ptw.max_permit_duration_hours', {
      label: 'Max Permit Duration (hours)', description: 'Maximum permit duration in hours.',
      dataType: 'number', defaultValue: 12, minValue: 1, maxValue: 168, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    safetyRule(M, 'ptw.require_approved_jsa', {
      label: 'Require Approved JSA', description: 'Require an approved JSA before permit submission.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    safetyRule(M, 'ptw.hot_work_requires_gas_test', {
      label: 'Hot Work Requires Gas Test', description: 'Hot Work permits require a valid gas test before activation.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    modulePolicy(M, 'ptw.hot_work_gas_test_valid_minutes', {
      label: 'Gas Test Validity (minutes)', description: 'How long a gas test remains valid for a hot work permit.',
      dataType: 'number', defaultValue: 120, minValue: 15, maxValue: 720, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    safetyRule(M, 'ptw.confined_space_requires_atmospheric_test', {
      label: 'Confined Space Requires Atmospheric Test', description: 'Confined-space permits require atmospheric testing.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    safetyRule(M, 'ptw.training_blocks_unqualified_workers', {
      label: 'Training Blocks Unqualified Workers', description: 'Workers without required training cannot be assigned to a permit.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site', 'role'], siteOverrideAllowed: true, roleOverrideAllowed: true,
    }),
    workflowRule(M, 'ptw.require_area_owner_approval', {
      label: 'Require Area Owner Approval', description: 'Require area-owner approval before activation.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    workflowRule(M, 'ptw.allow_extension', {
      label: 'Allow Extensions', description: 'Allow permit extension requests.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'ptw.require_closeout_evidence', {
      label: 'Require Closeout Evidence', description: 'Require evidence before a permit can be closed out.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    workflowRule(M, 'ptw.expired_permit_auto_suspend', {
      label: 'Auto-Suspend Expired Permits', description: 'Automatically suspend permits when they expire.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    auditPolicy(M, 'ptw.override_requires_reason', {
      label: 'Emergency Override Requires Reason', description: 'Require a reason for emergency permit overrides.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
  ],
};
