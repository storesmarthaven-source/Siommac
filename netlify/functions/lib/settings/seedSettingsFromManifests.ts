// ============================================================================
// Settings & Preferences — catalog sync from manifests (Spec §10)
// ============================================================================
// Manifests are the source of truth. This validates every registered manifest,
// then upserts the module_settings_manifests record + each setting into
// app_setting_catalog. Idempotent (upsert on the unique keys). Returns a summary.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModuleSettingsManifest, SettingCatalogEntry } from './types';
import { validateModuleSettingsManifest } from './validateManifest';
import { moduleSettingsManifests } from './manifests';

function catalogRow(entry: SettingCatalogEntry) {
  return {
    setting_key: entry.settingKey,
    module_key: entry.moduleKey,
    label: entry.label,
    description: entry.description,
    data_type: entry.dataType,
    default_value: entry.defaultValue,
    allowed_values: entry.allowedValues ?? null,
    min_value: entry.minValue ?? null,
    max_value: entry.maxValue ?? null,
    setting_class: entry.settingClass,
    scope: entry.scope,
    user_override_allowed: entry.userOverrideAllowed ?? false,
    role_override_allowed: entry.roleOverrideAllowed ?? false,
    site_override_allowed: entry.siteOverrideAllowed ?? false,
    department_override_allowed: entry.departmentOverrideAllowed ?? false,
    module_override_allowed: entry.moduleOverrideAllowed ?? false,
    can_reduce_strictness: entry.canReduceStrictness ?? false,
    can_suppress_required_delivery: entry.canSuppressRequiredDelivery ?? false,
    is_critical: entry.isCritical ?? false,
    is_sensitive: entry.isSensitive ?? false,
    is_audited: entry.isAudited ?? true,
    is_active: true,
    requires_permission: entry.requiresPermission,
    minimum_manage_permission: entry.minimumManagePermission ?? null,
    updated_at: new Date().toISOString(),
  };
}

const PREF_CLASSES = new Set(['personal_preference', 'ui_preference']);

async function syncManifest(client: SupabaseClient, manifest: ModuleSettingsManifest) {
  validateModuleSettingsManifest(manifest);

  const criticalCount = manifest.settings.filter(s => s.isCritical).length;
  const prefCount = manifest.settings.filter(s => PREF_CLASSES.has(s.settingClass)).length;

  await client.from('module_settings_manifests').upsert({
    module_key: manifest.moduleKey,
    module_label: manifest.moduleLabel,
    has_settings: manifest.hasSettings,
    reason_no_settings: manifest.reasonNoSettings ?? null,
    module_category: manifest.moduleCategory,
    requires_compliance_review: manifest.requiresComplianceReview ?? false,
    requires_hse_review: manifest.requiresHseReview ?? false,
    requires_security_review: manifest.requiresSecurityReview ?? false,
    settings_count: manifest.settings.length,
    critical_settings_count: criticalCount,
    user_preferences_count: prefCount,
  }, { onConflict: 'module_key' });

  if (manifest.settings.length > 0) {
    const rows = manifest.settings.map(catalogRow);
    const { error } = await client.from('app_setting_catalog').upsert(rows, { onConflict: 'setting_key' });
    if (error) throw new Error(`catalog upsert failed for ${manifest.moduleKey}: ${error.message}`);
  }

  return { moduleKey: manifest.moduleKey, settings: manifest.settings.length, critical: criticalCount, preferences: prefCount };
}

export async function seedSettingsFromManifests(client: SupabaseClient) {
  const results = [];
  for (const manifest of moduleSettingsManifests) {
    results.push(await syncManifest(client, manifest));
  }
  return {
    modules: results.length,
    totalSettings: results.reduce((n, r) => n + r.settings, 0),
    detail: results,
  };
}
