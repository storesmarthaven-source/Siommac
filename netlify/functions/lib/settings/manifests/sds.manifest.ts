// SDS / Chemicals — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, safetyRule, notificationRule, auditPolicy } from '../catalogHelpers';

const M = 'sds';

export const sdsManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'SDS / Chemicals',
  hasSettings: true,
  moduleCategory: 'safety_critical',
  requiresHseReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'hse'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'notifications', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    modulePolicy(M, 'sds.auto_number_prefix', {
      label: 'SDS Number Prefix', description: 'Prefix used for generated SDS references.',
      dataType: 'string', defaultValue: 'SDS', scope: ['global'],
    }),
    modulePolicy(M, 'sds.default_review_interval_months', {
      label: 'Review Interval (months)', description: 'Default SDS review interval in months.',
      dataType: 'number', defaultValue: 36, minValue: 1, maxValue: 120, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    safetyRule(M, 'sds.expired_blocks_use', {
      label: 'Expired SDS Blocks Use', description: 'Block chemical use when its SDS is expired.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    safetyRule(M, 'sds.missing_sds_blocks_use', {
      label: 'Missing SDS Blocks Use', description: 'Block chemical use when no SDS is registered.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    modulePolicy(M, 'sds.require_ghs_pictograms', {
      label: 'Require GHS Pictograms', description: 'Require GHS pictograms for SDS approval.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'sds.require_hazard_class', {
      label: 'Require Hazard Class', description: 'Require a hazard classification on each SDS.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'sds.require_cas_number', {
      label: 'Require CAS Number', description: 'Require a CAS number for each chemical.',
      dataType: 'boolean', defaultValue: false, scope: ['global'],
    }),
    notificationRule(M, 'sds.notify_before_expiry_days', {
      label: 'Notify Before Expiry (days)', description: 'Days before SDS expiry to notify owners.',
      dataType: 'number', defaultValue: 60, minValue: 1, maxValue: 365, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    notificationRule(M, 'sds.notify_hse_manager', {
      label: 'Notify HSE Manager', description: 'Notify the HSE manager on SDS expiry events.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    safetyRule(M, 'sds.restricted_chemical_requires_override', {
      label: 'Restricted Chemical Requires Override', description: 'Restricted chemicals require an explicit override to use.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    auditPolicy(M, 'sds.override_requires_reason', {
      label: 'Restricted Override Audited', description: 'Audit all restricted-chemical overrides with a reason.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
  ],
};
