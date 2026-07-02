// HR Documents — settings manifest (reminder windows, retention, defaults).
//
// moduleKey 'hr_documents'. Reuses existing 'hr.settings.manage' permission.
// block_activation_until_required_complete is catalog-only (safe at default false);
// it is NOT wired to any behaviour yet — wiring deferred to a future phase when
// the Onboarding activation gate is extended to consult this module.

import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, auditPolicy } from '../catalogHelpers';

const M = 'hr_documents';
const MANAGE = 'hr.settings.manage';

export const hrDocumentsManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'HR Documents',
  hasSettings: true,
  moduleCategory: 'hr',
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'module_owner'],
  sections: [
    { sectionKey: 'general',         applies: true },
    { sectionKey: 'notifications',   applies: true },
    { sectionKey: 'audit_retention', applies: true },
  ],
  settings: [
    // ── General ──────────────────────────────────────────────────────────────────
    modulePolicy(M, 'hr_documents.enabled', {
      label: 'HR Documents Enabled',
      description: 'Master switch for the HR Documents module.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),

    modulePolicy(M, 'hr_documents.default_confidentiality', {
      label: 'Default Confidentiality',
      description: 'Default confidentiality tier applied to newly uploaded HR documents.',
      dataType: 'select', defaultValue: 'internal',
      allowedValues: ['internal', 'confidential', 'restricted_hr', 'legal', 'medical'],
      scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Expiry reminders ─────────────────────────────────────────────────────────
    modulePolicy(M, 'hr_documents.expiry_reminder_days', {
      label: 'Expiry Reminder Windows (days)',
      description: 'Comma-separated day thresholds before expiry that trigger reminder notifications (e.g. 30,7,0).',
      dataType: 'string', defaultValue: '30,7,0', scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Future gate (catalog-only; behaviour NOT wired) ───────────────────────────
    modulePolicy(M, 'hr_documents.block_activation_until_required_complete', {
      label: 'Gate: Block Activation Until Required Docs Complete',
      description: 'Block onboarding activation/ready until all required documents are present and verified. (Not yet wired to activation logic — safe at default false.)',
      dataType: 'boolean', defaultValue: false, scope: ['global'], requiresPermission: MANAGE,
    }),

    // ── Audit / retention ────────────────────────────────────────────────────────
    auditPolicy(M, 'hr_documents.retention_years', {
      label: 'Document Retention (years)',
      description: 'How long HR employee document records are retained after archiving.',
      dataType: 'number', defaultValue: 7, minValue: 1, maxValue: 25, scope: ['global'], requiresPermission: MANAGE,
    }),
  ],
};
