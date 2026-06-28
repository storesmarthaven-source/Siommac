// ============================================================================
// Settings & Preferences — resolver (Spec §14)
// ============================================================================
// Returns the effective value of a setting for a given scope. Most-specific
// override wins, but ONLY if the catalog entry permits that override level:
//   user → role → department → site → module → global → catalog default
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResolvedSetting, SettingScope } from './types';

interface CatalogRow {
  setting_key: string;
  default_value: unknown;
  is_active: boolean;
  user_override_allowed: boolean;
  role_override_allowed: boolean;
  site_override_allowed: boolean;
  department_override_allowed: boolean;
  module_override_allowed: boolean;
}

async function getScopedSetting<T>(
  client: SupabaseClient,
  settingKey: string,
  scopeType: string,
  scopeId: string | null,
): Promise<{ found: boolean; value: T }> {
  let query = client
    .from('app_setting_values')
    .select('value')
    .eq('setting_key', settingKey)
    .eq('scope_type', scopeType);

  query = scopeId === null ? query.is('scope_id', null) : query.eq('scope_id', scopeId);

  const { data, error } = await query.maybeSingle<{ value: T }>();
  if (error || !data) return { found: false, value: undefined as T };
  return { found: true, value: data.value };
}

export async function resolveSetting<T = unknown>(
  client: SupabaseClient,
  settingKey: string,
  scope: SettingScope,
): Promise<ResolvedSetting<T>> {
  const { data: catalog, error: catalogError } = await client
    .from('app_setting_catalog')
    .select('setting_key, default_value, is_active, user_override_allowed, role_override_allowed, site_override_allowed, department_override_allowed, module_override_allowed')
    .eq('setting_key', settingKey)
    .eq('is_active', true)
    .single<CatalogRow>();

  if (catalogError || !catalog) {
    throw new Error(`Unknown setting: ${settingKey}`);
  }

  if (scope.userId && catalog.user_override_allowed) {
    const r = await getScopedSetting<T>(client, settingKey, 'user', scope.userId);
    if (r.found) return { settingKey, value: r.value, source: 'user', scopeId: scope.userId };
  }

  if (catalog.role_override_allowed) {
    for (const roleId of scope.roleIds ?? []) {
      const r = await getScopedSetting<T>(client, settingKey, 'role', roleId);
      if (r.found) return { settingKey, value: r.value, source: 'role', scopeId: roleId };
    }
  }

  if (scope.departmentId && catalog.department_override_allowed) {
    const r = await getScopedSetting<T>(client, settingKey, 'department', scope.departmentId);
    if (r.found) return { settingKey, value: r.value, source: 'department', scopeId: scope.departmentId };
  }

  if (scope.siteId && catalog.site_override_allowed) {
    const r = await getScopedSetting<T>(client, settingKey, 'site', scope.siteId);
    if (r.found) return { settingKey, value: r.value, source: 'site', scopeId: scope.siteId };
  }

  if (catalog.module_override_allowed) {
    const r = await getScopedSetting<T>(client, settingKey, 'module', scope.moduleKey);
    if (r.found) return { settingKey, value: r.value, source: 'module', scopeId: scope.moduleKey };
  }

  const globalSetting = await getScopedSetting<T>(client, settingKey, 'global', null);
  if (globalSetting.found) return { settingKey, value: globalSetting.value, source: 'global', scopeId: null };

  return { settingKey, value: catalog.default_value as T, source: 'default', scopeId: null };
}

interface BatchCatalogRow {
  setting_key: string;
  module_key: string;
  default_value: unknown;
  user_override_allowed?: boolean;
  role_override_allowed?: boolean;
  site_override_allowed?: boolean;
  department_override_allowed?: boolean;
  module_override_allowed?: boolean;
}

/**
 * Resolve MANY settings at once with the same most-specific-wins logic as
 * resolveSetting, but in TWO queries total (catalog rows are passed in; all
 * override rows for those keys are fetched in one `IN (...)` query and matched
 * in memory) — instead of ~7 sequential queries PER setting. This is the hot
 * path for the /effective, /my-preferences and /critical endpoints.
 *
 * The module-scope override is matched against each row's own `module_key`, so a
 * single call can span multiple modules (My Preferences / Critical governance).
 */
export async function resolveSettingsBatch(
  client: SupabaseClient,
  catalogRows: readonly BatchCatalogRow[],
  scope: SettingScope,
): Promise<Map<string, ResolvedSetting>> {
  const out = new Map<string, ResolvedSetting>();
  if (catalogRows.length === 0) return out;

  const keys = catalogRows.map(r => r.setting_key);
  const { data: values } = await client
    .from('app_setting_values')
    .select('setting_key, scope_type, scope_id, value')
    .in('setting_key', keys);

  const byKey = new Map<string, { scope_type: string; scope_id: string | null; value: unknown }[]>();
  for (const v of (values ?? []) as { setting_key: string; scope_type: string; scope_id: string | null; value: unknown }[]) {
    (byKey.get(v.setting_key) ?? byKey.set(v.setting_key, []).get(v.setting_key)!).push(v);
  }

  for (const c of catalogRows) {
    const ovs = byKey.get(c.setting_key) ?? [];
    const pick = (scopeType: string, scopeId: string | null) =>
      ovs.find(o => o.scope_type === scopeType && (scopeId === null ? o.scope_id === null : o.scope_id === scopeId));

    let resolved: ResolvedSetting | null = null;
    if (scope.userId && c.user_override_allowed) {
      const o = pick('user', scope.userId);
      if (o) resolved = { settingKey: c.setting_key, value: o.value, source: 'user', scopeId: scope.userId };
    }
    if (!resolved && c.role_override_allowed) {
      for (const roleId of scope.roleIds ?? []) {
        const o = pick('role', roleId);
        if (o) { resolved = { settingKey: c.setting_key, value: o.value, source: 'role', scopeId: roleId }; break; }
      }
    }
    if (!resolved && scope.departmentId && c.department_override_allowed) {
      const o = pick('department', scope.departmentId);
      if (o) resolved = { settingKey: c.setting_key, value: o.value, source: 'department', scopeId: scope.departmentId };
    }
    if (!resolved && scope.siteId && c.site_override_allowed) {
      const o = pick('site', scope.siteId);
      if (o) resolved = { settingKey: c.setting_key, value: o.value, source: 'site', scopeId: scope.siteId };
    }
    if (!resolved && c.module_override_allowed) {
      const o = pick('module', c.module_key);
      if (o) resolved = { settingKey: c.setting_key, value: o.value, source: 'module', scopeId: c.module_key };
    }
    if (!resolved) {
      const o = pick('global', null);
      if (o) resolved = { settingKey: c.setting_key, value: o.value, source: 'global', scopeId: null };
    }
    out.set(c.setting_key, resolved ?? { settingKey: c.setting_key, value: c.default_value, source: 'default', scopeId: null });
  }
  return out;
}

/**
 * Resolve a setting to its effective value (override or catalog default),
 * returning `fallback` if the setting is unknown / the catalog isn't synced yet.
 * Use to make a hardcoded constant configurable while preserving behaviour — set
 * the catalog default to match the old constant and pass the same value as fallback.
 */
export async function resolveSettingValue<T = unknown>(
  client: SupabaseClient,
  settingKey: string,
  scope: SettingScope,
  fallback: T,
): Promise<T> {
  try {
    const r = await resolveSetting<T>(client, settingKey, scope);
    return r.value as T;
  } catch {
    return fallback;
  }
}

/**
 * Returns an EXPLICIT override value (site/role/dept/module/global/user) for a
 * setting, or null when only the catalog default applies / the setting is
 * unknown. Use when folding a legacy value: keep the legacy baseline unless an
 * admin has explicitly overridden the setting in the new Settings UI.
 */
export async function resolveOverride<T = unknown>(
  client: SupabaseClient,
  settingKey: string,
  scope: SettingScope,
): Promise<T | null> {
  try {
    const r = await resolveSetting<T>(client, settingKey, scope);
    return r.source === 'default' ? null : r.value;
  } catch {
    return null;
  }
}
