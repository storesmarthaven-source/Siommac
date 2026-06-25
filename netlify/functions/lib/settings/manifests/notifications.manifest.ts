// Notifications (delivery) — settings manifest (Spec §28/§29, §21)
import type { ModuleSettingsManifest } from '../types';
import { notificationRule, personalPreference } from '../catalogHelpers';

const M = 'notifications';

export const notificationsManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Notifications Delivery',
  hasSettings: true,
  moduleCategory: 'communications',
  reviewedBy: ['product_owner', 'engineering', 'super_admin'],
  sections: [
    { sectionKey: 'notifications', applies: true },
    { sectionKey: 'escalation', applies: true },
    { sectionKey: 'personal_preferences', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    notificationRule(M, 'notifications.realtime_enabled', {
      label: 'Realtime Enabled', description: 'Enable realtime notification delivery.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    notificationRule(M, 'notifications.email_enabled', {
      label: 'Email Enabled', description: 'Allow email delivery for notifications.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    notificationRule(M, 'notifications.digest_frequency', {
      label: 'Digest Frequency', description: 'Default notification digest frequency.',
      dataType: 'select', defaultValue: 'daily', allowedValues: ['off', 'daily', 'weekly'], scope: ['global'],
    }),
    notificationRule(M, 'notifications.escalation_delay_hours', {
      label: 'Escalation Delay (hours)', description: 'Hours before overdue notifications escalate.',
      dataType: 'number', defaultValue: 24, minValue: 1, maxValue: 168, scope: ['global', 'site'], siteOverrideAllowed: true,
    }),
    notificationRule(M, 'notifications.module_muting_allowed', {
      label: 'Module Muting Allowed', description: 'Allow users to mute non-critical module notifications.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    notificationRule(M, 'notifications.required_delivery_locked', {
      label: 'Required Delivery Locked', description: 'Workflow / safety / compliance notifications cannot be muted by users.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], isCritical: true,
      requiresPermission: 'notifications.required_delivery.manage', minimumManagePermission: 'notifications.required_delivery.manage',
    }),
    personalPreference(M, 'notifications.quiet_hours_enabled', {
      label: 'Quiet Hours (mine)', description: 'Delay non-critical notifications during your quiet hours.',
      dataType: 'boolean', defaultValue: false, scope: ['user'],
    }),
    personalPreference(M, 'notifications.sound_enabled', {
      label: 'Notification Sound (mine)', description: 'Play a sound for your non-critical notifications.',
      dataType: 'boolean', defaultValue: true, scope: ['user'],
    }),
  ],
};
