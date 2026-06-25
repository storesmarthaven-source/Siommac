// ============================================================================
// Settings & Preferences — governance guard (Spec §16)
// ============================================================================
// The real security layer for setting writes. Enforces: required manage
// permission, scope-override allowance, user-scope ownership + class limits,
// critical elevation, and the no-reduce-strictness rule. Throws SettingsError.
// Uses our async userCan model via a `can(key)` predicate.
// ============================================================================

import { forbidden } from './errors';

export interface GovernanceCatalogRow {
  setting_key: string;
  module_key: string;
  setting_class: string;
  requires_permission: string | null;
  minimum_manage_permission: string | null;

  user_override_allowed: boolean;
  role_override_allowed: boolean;
  site_override_allowed: boolean;
  department_override_allowed: boolean;
  module_override_allowed: boolean;

  can_reduce_strictness: boolean;
  can_suppress_required_delivery: boolean;

  is_critical: boolean;
  default_value: unknown;
}

export interface SettingUpdateRequest {
  settingKey: string;
  scopeType: 'global' | 'module' | 'site' | 'department' | 'role' | 'user';
  scopeId?: string | null;
  value: unknown;
}

export interface GovernanceParams {
  actorId: string;
  isSuperAdmin: boolean;
  can: (permission: string) => boolean | Promise<boolean>;
  catalog: GovernanceCatalogRow;
  request: SettingUpdateRequest;
  currentEffectiveValue?: unknown;
}

export async function assertCanUpdateSetting(params: GovernanceParams): Promise<true> {
  const { isSuperAdmin, catalog, request } = params;
  const can = async (key: string) => isSuperAdmin || (await params.can(key));

  const requiredPermission =
    catalog.minimum_manage_permission ?? catalog.requires_permission ?? 'settings.manage';

  if (!(await can(requiredPermission))) {
    throw forbidden('You do not have permission to manage this setting.');
  }

  assertScopeAllowed(catalog, request);

  if (request.scopeType === 'user') {
    if (request.scopeId !== params.actorId && !(await can('settings.user_preferences.manage'))) {
      throw forbidden('You can only update your own personal preferences.');
    }
    if (catalog.setting_class !== 'personal_preference' && catalog.setting_class !== 'ui_preference') {
      throw forbidden('Only personal preferences can be changed at user level.');
    }
  }

  if (catalog.is_critical && !(await can('settings.critical.manage'))) {
    throw forbidden('Critical settings require elevated permission.');
  }

  if (!catalog.can_reduce_strictness) {
    assertDoesNotReduceStrictness(params.currentEffectiveValue ?? catalog.default_value, request.value);
  }

  return true;
}

function assertScopeAllowed(catalog: GovernanceCatalogRow, request: SettingUpdateRequest): void {
  if (request.scopeType === 'user' && !catalog.user_override_allowed) {
    throw forbidden('This setting cannot be changed at user level.');
  }
  if (request.scopeType === 'role' && !catalog.role_override_allowed) {
    throw forbidden('This setting cannot be changed at role level.');
  }
  if (request.scopeType === 'site' && !catalog.site_override_allowed) {
    throw forbidden('This setting cannot be changed at site level.');
  }
  if (request.scopeType === 'department' && !catalog.department_override_allowed) {
    throw forbidden('This setting cannot be changed at department level.');
  }
  if (request.scopeType === 'module' && !catalog.module_override_allowed) {
    throw forbidden('This setting cannot be changed at module level.');
  }
}

function assertDoesNotReduceStrictness(oldValue: unknown, newValue: unknown): void {
  if (typeof oldValue === 'boolean' && typeof newValue === 'boolean') {
    if (oldValue === true && newValue === false) {
      throw forbidden('This setting cannot be weakened without critical override permission.');
    }
  }
}
