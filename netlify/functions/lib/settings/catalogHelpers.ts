// ============================================================================
// Settings & Preferences — catalog helper functions (Spec §11)
// ============================================================================
// Reduce repetition in manifests while still producing full SettingCatalogEntry
// metadata with the correct governance flags per setting class.
// ============================================================================

import type { SettingCatalogEntry } from './types';

type PartialSetting = Omit<
  SettingCatalogEntry,
  'moduleKey' | 'settingKey' | 'settingClass' | 'requiresPermission'
> & {
  requiresPermission?: string;
};

export function modulePolicy(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'module_policy',
    isCritical: input.isCritical ?? false,
    isAudited: input.isAudited ?? true,
    canReduceStrictness: input.canReduceStrictness ?? true,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? `settings.${moduleKey}.manage`,
  };
}

export function safetyRule(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'safety_rule',
    isCritical: true,
    isAudited: true,
    canReduceStrictness: false,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? `settings.${moduleKey}.manage`,
    minimumManagePermission: input.minimumManagePermission ?? 'settings.safety_rules.manage',
  };
}

export function workflowRule(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'workflow_rule',
    isCritical: input.isCritical ?? false,
    isAudited: true,
    canReduceStrictness: input.canReduceStrictness ?? true,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? `settings.${moduleKey}.manage`,
  };
}

export function notificationRule(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'notification_rule',
    isCritical: input.isCritical ?? false,
    isAudited: true,
    canReduceStrictness: input.canReduceStrictness ?? true,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? `settings.${moduleKey}.manage`,
  };
}

export function messagePolicy(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'message_policy',
    isCritical: input.isCritical ?? true,
    isAudited: true,
    canReduceStrictness: false,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? 'settings.message_policy.manage',
  };
}

export function filePolicy(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'file_policy',
    isCritical: input.isCritical ?? false,
    isAudited: true,
    canReduceStrictness: input.canReduceStrictness ?? false,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? 'settings.file_policy.manage',
  };
}

export function auditPolicy(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'audit_policy',
    isCritical: true,
    isAudited: true,
    canReduceStrictness: false,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? 'settings.audit_policy.manage',
    minimumManagePermission: input.minimumManagePermission ?? 'settings.audit_policy.manage',
  };
}

export function personalPreference(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'personal_preference',
    scope: ['user'],
    userOverrideAllowed: true,
    roleOverrideAllowed: false,
    siteOverrideAllowed: false,
    departmentOverrideAllowed: false,
    moduleOverrideAllowed: false,
    isCritical: false,
    isAudited: input.isAudited ?? true,
    canReduceStrictness: true,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? 'settings.own_preferences.manage',
  };
}

export function uiPreference(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'ui_preference',
    scope: ['user'],
    userOverrideAllowed: true,
    isCritical: false,
    isAudited: input.isAudited ?? true,
    canReduceStrictness: true,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? 'settings.own_preferences.manage',
  };
}

/** systemPolicy — global behaviour that affects all modules. */
export function systemPolicy(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'system_policy',
    isCritical: input.isCritical ?? false,
    isAudited: input.isAudited ?? true,
    canReduceStrictness: input.canReduceStrictness ?? true,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? 'settings.system.manage',
  };
}

/** systemSecurity — auth / MFA / session / security controls. */
export function systemSecurity(moduleKey: string, settingKey: string, input: PartialSetting): SettingCatalogEntry {
  return {
    ...input,
    moduleKey,
    settingKey,
    settingClass: 'system_security',
    isCritical: true,
    isAudited: true,
    canReduceStrictness: false,
    canSuppressRequiredDelivery: false,
    requiresPermission: input.requiresPermission ?? 'settings.security.manage',
    minimumManagePermission: input.minimumManagePermission ?? 'settings.security.manage',
  };
}
