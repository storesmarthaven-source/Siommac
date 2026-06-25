// Command Center — settings manifest (Spec §28/§29)
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, uiPreference } from '../catalogHelpers';

const M = 'command_center';

export const commandCenterManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Command Center',
  hasSettings: true,
  moduleCategory: 'standard',
  reviewedBy: ['product_owner', 'engineering', 'super_admin'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'personal_preferences', applies: true },
  ],
  settings: [
    modulePolicy(M, 'command_center.refresh_interval_seconds', {
      label: 'Refresh Interval (seconds)', description: 'How often the command center auto-refreshes.',
      dataType: 'number', defaultValue: 30, minValue: 10, maxValue: 600, scope: ['global'],
    }),
    modulePolicy(M, 'command_center.show_cross_module_alerts', {
      label: 'Show Cross-Module Alerts', description: 'Surface alerts aggregated across modules.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'command_center.show_pending_approvals', {
      label: 'Show Pending Approvals', description: 'Show the pending-approvals widget.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'command_center.show_overdue_items', {
      label: 'Show Overdue Items', description: 'Show the overdue-items widget.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    modulePolicy(M, 'command_center.allow_admin_locked_widgets', {
      label: 'Allow Admin-Locked Widgets', description: 'Allow admins to lock required widgets in place.',
      dataType: 'boolean', defaultValue: true, scope: ['global'],
    }),
    uiPreference(M, 'command_center.user_custom_layout', {
      label: 'Custom Layout (mine)', description: 'Let me rearrange my own command-center widgets.',
      dataType: 'boolean', defaultValue: true, scope: ['user'],
    }),
    uiPreference(M, 'command_center.default_date_range', {
      label: 'Default Date Range (mine)', description: 'Default date range for command-center trend charts.',
      dataType: 'select', defaultValue: '30 days', allowedValues: ['7 days', '30 days', '90 days'], scope: ['user'],
    }),
  ],
};
