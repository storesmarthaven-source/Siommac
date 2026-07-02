// HR Leave -- settings manifest

import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, workflowRule } from '../catalogHelpers';

const M = 'hr_leave';
const MANAGE = 'hr.settings.manage';

export const hrLeaveManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'HR Leave & Absence',
  hasSettings: true,
  moduleCategory: 'hr',
  reviewedBy: ['product_owner', 'engineering', 'super_admin', 'module_owner'],
  sections: [
    { sectionKey: 'general',    applies: true },
    { sectionKey: 'workflow',   applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'automation', applies: true },
    { sectionKey: 'audit_retention', applies: true },
  ],
  settings: [
    modulePolicy(M, 'hr_leave.enabled', {
      label: 'Leave Module Enabled',
      description: 'Master switch for the HR leave module (submitting new requests).',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_leave.accrual_cadence', {
      label: 'Default Accrual Cadence',
      description: 'Default accrual cadence when a leave type does not override it.',
      dataType: 'select', defaultValue: 'annual', allowedValues: ['none', 'monthly', 'annual'],
      scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_leave.default_carryover_cap', {
      label: 'Default Carryover Cap (days)',
      description: 'Maximum days that carry over to the next year when a leave type does not override it.',
      dataType: 'number', defaultValue: 10, minValue: 0, maxValue: 365,
      scope: ['global'], requiresPermission: MANAGE,
    }),
    workflowRule(M, 'hr_leave.min_notice_days', {
      label: 'Minimum Notice (days)',
      description: 'Minimum calendar days of advance notice required when submitting a leave request. Set to 0 to disable.',
      dataType: 'number', defaultValue: 1, minValue: 0, maxValue: 90,
      scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_leave.allow_negative_balance', {
      label: 'Allow Negative Balance',
      description: 'Allow employees to submit leave requests that would put their balance below zero.',
      dataType: 'boolean', defaultValue: false, scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_leave.blackout_dates', {
      label: 'Blackout Dates',
      description: 'Comma-separated date ranges (YYYY-MM-DD:YYYY-MM-DD) during which leave requests are blocked.',
      dataType: 'string', defaultValue: '', scope: ['global'], requiresPermission: MANAGE,
    }),
  ],
};
