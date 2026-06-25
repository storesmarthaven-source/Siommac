// ============================================================================
// Settings & Preferences — module manifest validator (Spec §13)
// ============================================================================
// Enforces the governance contract on a module's settings manifest: required
// reviewers, section coverage with reasons, per-setting permission + override +
// critical-governance rules. Throws with all errors joined; returns true if ok.
// ============================================================================

import type { ModuleSettingsManifest } from './types';

export function validateModuleSettingsManifest(manifest: ModuleSettingsManifest): true {
  const errors: string[] = [];

  if (!manifest.moduleKey) errors.push('moduleKey is required.');
  if (!manifest.moduleLabel) errors.push('moduleLabel is required.');

  if (manifest.hasSettings === false && !manifest.reasonNoSettings) {
    errors.push('reasonNoSettings is required when hasSettings is false.');
  }

  if (manifest.hasSettings === true && manifest.settings.length === 0) {
    errors.push('settings cannot be empty when hasSettings is true.');
  }

  if (!manifest.reviewedBy.includes('product_owner')) errors.push('Product Owner review is required.');
  if (!manifest.reviewedBy.includes('engineering')) errors.push('Engineering review is required.');
  if (!manifest.reviewedBy.includes('super_admin')) errors.push('Super Admin review is required.');

  if (
    (manifest.moduleCategory === 'hse' || manifest.moduleCategory === 'safety_critical' || manifest.requiresHseReview) &&
    !manifest.reviewedBy.includes('hse')
  ) {
    errors.push('HSE review is required for HSE or safety-critical modules.');
  }

  if (
    (manifest.moduleCategory === 'compliance' || manifest.requiresComplianceReview) &&
    !manifest.reviewedBy.includes('compliance')
  ) {
    errors.push('Compliance review is required for compliance modules.');
  }

  if (
    (manifest.moduleCategory === 'admin' || manifest.moduleCategory === 'system' || manifest.requiresSecurityReview) &&
    !manifest.reviewedBy.includes('security')
  ) {
    errors.push('Security review is required for admin/system/security modules.');
  }

  for (const section of manifest.sections) {
    if (!section.applies && !section.reasonNotApplicable) {
      errors.push(`${manifest.moduleKey}.${section.sectionKey}: reasonNotApplicable is required when section does not apply.`);
    }
  }

  for (const setting of manifest.settings) {
    if (setting.moduleKey !== manifest.moduleKey) {
      errors.push(`${setting.settingKey}: moduleKey does not match manifest moduleKey.`);
    }

    if (!setting.requiresPermission) {
      errors.push(`${setting.settingKey}: requiresPermission is required.`);
    }

    if (
      setting.settingClass !== 'personal_preference' &&
      setting.settingClass !== 'ui_preference' &&
      setting.userOverrideAllowed
    ) {
      errors.push(`${setting.settingKey}: only personal_preference or ui_preference settings can allow user overrides.`);
    }

    if (
      setting.settingClass === 'safety_rule' ||
      setting.settingClass === 'system_security' ||
      setting.settingClass === 'audit_policy'
    ) {
      if (!setting.isCritical) errors.push(`${setting.settingKey}: critical governance flag is required.`);
      if (setting.canReduceStrictness) errors.push(`${setting.settingKey}: critical settings cannot reduce strictness.`);
    }

    if (setting.settingClass === 'notification_rule' || setting.settingClass === 'message_policy') {
      if (setting.canSuppressRequiredDelivery) {
        errors.push(`${setting.settingKey}: cannot suppress required delivery.`);
      }
    }
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return true;
}
