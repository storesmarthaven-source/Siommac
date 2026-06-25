// Training & Competency — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, safetyRule, notificationRule } from '../catalogHelpers';

const M = 'training';

export const trainingManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Training & Competency',
  hasSettings: true,
  moduleCategory: 'hse',
  requiresHseReview: true,
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'hse'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'workflow', applies: true },
    { sectionKey: 'notifications', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    modulePolicy(M, 'training.default_renewal_window_days', {
      label: 'Default Renewal Window (days)',
      description: 'Days before expiry that a certificate is treated as due-soon, for competencies that do not set their own window. Default matches the legacy fallback (90).',
      dataType: 'number', defaultValue: 90, minValue: 1, maxValue: 365,
      scope: ['global', 'site', 'role'],
      siteOverrideAllowed: true, roleOverrideAllowed: true,
    }),
    modulePolicy(M, 'training.default_reminder_days_before_expiry', {
      label: 'Reminder Lead Time (days)',
      description: 'Days before expiry to start sending renewal reminders.',
      dataType: 'number', defaultValue: 14, minValue: 1, maxValue: 180,
      scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    modulePolicy(M, 'training.require_certificate_verification', {
      label: 'Require Certificate Verification',
      description: 'Uploaded certificates must be verified by a competent person before counting.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    modulePolicy(M, 'training.allow_self_upload_certificate', {
      label: 'Allow Self-Upload of Certificates',
      description: 'Workers may upload their own certificates (still requires verification).',
      dataType: 'boolean', defaultValue: false, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    modulePolicy(M, 'training.override_requires_reason', {
      label: 'Override Requires Reason',
      description: 'A reason is mandatory when overriding a competency or expiry.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], canReduceStrictness: false,
    }),
    safetyRule(M, 'training.expired_blocks_permit_assignment', {
      label: 'Expired Training Blocks Permit Assignment',
      description: 'A worker with expired required training cannot be assigned to a permit.',
      dataType: 'boolean', defaultValue: true,
      scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    safetyRule(M, 'training.missing_required_competency_blocks_work', {
      label: 'Missing Competency Blocks Work',
      description: 'Missing a required competency blocks assignment to the related work.',
      dataType: 'boolean', defaultValue: true,
      scope: ['global', 'site', 'role'], siteOverrideAllowed: true, roleOverrideAllowed: true,
    }),
    notificationRule(M, 'training.notify_supervisor', {
      label: 'Notify Supervisor',
      description: 'Notify the supervisor when a report has expiring/expired training.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    notificationRule(M, 'training.notify_hse_manager', {
      label: 'Notify HSE Manager',
      description: 'Notify the HSE manager on training expiry events.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
  ],
};
