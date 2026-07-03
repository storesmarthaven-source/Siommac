// ============================================================================
// Settings & Preferences — shared types (Spec §10, §12)
// ============================================================================
// Catalog entry + module manifest types. Authored once, consumed by the catalog
// helpers, the manifest validator, the seed, and the API routes.
// ============================================================================

export type SettingDataType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'text'
  | 'select'
  | 'multi_select'
  | 'json'
  | 'duration'
  | 'time'
  | 'array';

export type SettingClass =
  | 'system_security'
  | 'system_policy'
  | 'module_policy'
  | 'safety_rule'
  | 'workflow_rule'
  | 'notification_rule'
  | 'message_policy'
  | 'file_policy'
  | 'audit_policy'
  | 'personal_preference'
  | 'ui_preference';

export type SettingScopeType =
  | 'global'
  | 'module'
  | 'site'
  | 'department'
  | 'role'
  | 'user';

export interface SettingCatalogEntry {
  settingKey: string;
  moduleKey: string;

  label: string;
  description: string;

  dataType: SettingDataType;
  defaultValue: unknown;
  allowedValues?: unknown[];

  minValue?: number;
  maxValue?: number;

  settingClass: SettingClass;

  scope: SettingScopeType[];

  userOverrideAllowed?: boolean;
  roleOverrideAllowed?: boolean;
  siteOverrideAllowed?: boolean;
  departmentOverrideAllowed?: boolean;
  moduleOverrideAllowed?: boolean;

  canReduceStrictness?: boolean;
  canSuppressRequiredDelivery?: boolean;

  isCritical?: boolean;
  isSensitive?: boolean;
  isAudited?: boolean;

  requiresPermission: string;
  minimumManagePermission?: string;
}

// ── Manifest types (Spec §12) ────────────────────────────────────────────────

export type ModuleSettingsReviewer =
  | 'product_owner'
  | 'module_owner'
  | 'engineering'
  | 'super_admin'
  | 'compliance'
  | 'hse'
  | 'security';

export type ModuleSettingSection =
  | 'general'
  | 'numbering'
  | 'validation'
  | 'workflow'
  | 'notifications'
  | 'messages'
  | 'files'
  | 'permissions'
  | 'assignment'
  | 'automation'
  | 'escalation'
  | 'handoffs'
  | 'audit_retention'
  | 'personal_preferences'
  | 'critical_governance';

export type ModuleCategory =
  | 'standard'
  | 'hse'
  | 'safety_critical'
  | 'compliance'
  | 'finance'
  | 'hr'
  | 'communications'
  | 'admin'
  | 'system';

export interface ModuleSettingSectionReview {
  sectionKey: ModuleSettingSection;
  applies: boolean;
  reasonNotApplicable?: string;
}

export interface ModuleSettingsManifest {
  moduleKey: string;
  moduleLabel: string;

  hasSettings: boolean;
  reasonNoSettings?: string;

  moduleCategory: ModuleCategory;

  requiresComplianceReview?: boolean;
  requiresHseReview?: boolean;
  requiresSecurityReview?: boolean;

  reviewedBy: ModuleSettingsReviewer[];

  sections: ModuleSettingSectionReview[];

  settings: SettingCatalogEntry[];

  notes?: string;
}

// ── Resolver types (Spec §14) ────────────────────────────────────────────────

export interface SettingScope {
  moduleKey: string;
  userId?: string | null;
  roleIds?: string[];
  departmentId?: string | null;
  siteId?: string | null;
}

export type SettingSource =
  | 'user'
  | 'role'
  | 'department'
  | 'site'
  | 'module'
  | 'global'
  | 'default';

export interface ResolvedSetting<T = unknown> {
  settingKey: string;
  value: T;
  source: SettingSource;
  scopeId?: string | null;
}
