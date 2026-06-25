// Messages (delivery) — settings manifest (Spec §28/§29, §22)
import type { ModuleSettingsManifest } from '../types';
import { messagePolicy, filePolicy, auditPolicy, personalPreference } from '../catalogHelpers';

const M = 'messages';

export const messagesManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Messages Delivery',
  hasSettings: true,
  moduleCategory: 'communications',
  reviewedBy: ['product_owner', 'engineering', 'super_admin'],
  sections: [
    { sectionKey: 'messages', applies: true },
    { sectionKey: 'files', applies: true },
    { sectionKey: 'audit_retention', applies: true },
    { sectionKey: 'personal_preferences', applies: true },
    { sectionKey: 'critical_governance', applies: true },
  ],
  settings: [
    messagePolicy(M, 'messages.allow_employee_direct_messages', {
      label: 'Direct Messages Enabled', description: 'Allow employee direct messaging.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    messagePolicy(M, 'messages.allow_module_context_threads', {
      label: 'Module Threads Enabled', description: 'Create module-context message threads tied to records.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    messagePolicy(M, 'messages.required_participants_locked', {
      label: 'Required Participants Locked', description: 'Prevent users from removing module-locked required participants.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], isCritical: true,
      requiresPermission: 'communications.participants.remove_required', minimumManagePermission: 'communications.participants.remove_required',
    }),
    messagePolicy(M, 'messages.read_receipts_enabled', {
      label: 'Read Receipts Enabled', description: 'Show read receipts in message threads.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    messagePolicy(M, 'messages.allow_message_edit', {
      label: 'Allow Message Edit', description: 'Allow editing of sent messages within a window.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    messagePolicy(M, 'messages.edit_window_minutes', {
      label: 'Edit Window (minutes)', description: 'Minutes a message can be edited after sending.',
      dataType: 'number', defaultValue: 15, minValue: 0, maxValue: 1440, scope: ['global'],
    }),
    filePolicy(M, 'messages.max_attachment_size_mb', {
      label: 'Max Attachment Size (MB)', description: 'Maximum message attachment size.',
      dataType: 'number', defaultValue: 25, minValue: 1, maxValue: 200, scope: ['global'],
    }),
    auditPolicy(M, 'messages.message_retention_days', {
      label: 'Message Retention (days)', description: 'Days to retain message records.',
      dataType: 'number', defaultValue: 2555, minValue: 30, maxValue: 3650, scope: ['global'],
    }),
    personalPreference(M, 'messages.user_mute_personal_threads', {
      label: 'Mute Personal Threads (mine)', description: 'Mute notifications for your casual personal threads.',
      dataType: 'boolean', defaultValue: false, scope: ['user'],
    }),
  ],
};
