// System — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { systemPolicy, auditPolicy, uiPreference } from '../catalogHelpers';

const M = 'system';

export const systemManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'System',
  hasSettings: true,
  moduleCategory: 'system',
  requiresSecurityReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'security'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'audit_retention', applies: true },
    { sectionKey: 'personal_preferences', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    systemPolicy(M, 'system.default_timezone', {
      label: 'Default Timezone',
      description: 'Organisation default timezone.',
      dataType: 'string', defaultValue: 'America/Port_of_Spain', scope: ['global', 'site'],
      siteOverrideAllowed: true, requiresPermission: 'settings.global.manage',
    }),
    systemPolicy(M, 'system.default_date_format', {
      label: 'Default Date Format',
      description: 'Organisation default date display format.',
      dataType: 'select', defaultValue: 'YYYY-MM-DD',
      allowedValues: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
      scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    systemPolicy(M, 'system.allow_user_timezone_override', {
      label: 'Allow User Timezone Override',
      description: 'Permit users to choose their own timezone.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: 'settings.global.manage',
    }),
    auditPolicy(M, 'system.audit_all_admin_actions', {
      label: 'Audit All Admin Actions',
      description: 'Write an audit record for every administrative action.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    uiPreference(M, 'system.user_timezone', {
      label: 'My Timezone',
      description: 'Your preferred timezone for date/time display.',
      dataType: 'string', defaultValue: 'America/Port_of_Spain', scope: ['user'],
    }),
    uiPreference(M, 'system.user_date_format', {
      label: 'My Date Format',
      description: 'Your preferred date display format.',
      dataType: 'select', defaultValue: 'YYYY-MM-DD',
      allowedValues: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'], scope: ['user'],
    }),
    uiPreference(M, 'system.user_theme', {
      label: 'Appearance',
      description: 'Your preferred colour theme.',
      dataType: 'select', defaultValue: 'system', allowedValues: ['light', 'dark', 'system'], scope: ['user'],
    }),
  ],
};
