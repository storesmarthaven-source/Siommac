// HR Attendance & Timekeeping -- settings manifest

import type { ModuleSettingsManifest } from '../types';
import { modulePolicy } from '../catalogHelpers';

const M = 'hr_attendance';
const MANAGE = 'hr.attendance.policy.manage';

export const hrAttendanceManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'HR Attendance & Timekeeping',
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
    modulePolicy(M, 'hr_attendance.enabled', {
      label: 'Attendance Module Enabled',
      description: 'Master switch for the HR Attendance & Timekeeping module.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_attendance.shift_start', {
      label: 'Default Shift Start Time',
      description: 'Default shift start in HH:MM (24-hour). Used to compute lateness.',
      dataType: 'string', defaultValue: '08:00', scope: ['global', 'site'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_attendance.grace_minutes', {
      label: 'Grace Period (minutes)',
      description: 'Minutes after shift start within which a punch-in is not flagged as late.',
      dataType: 'number', defaultValue: 5, minValue: 0, maxValue: 60,
      scope: ['global', 'site'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_attendance.standard_day_minutes', {
      label: 'Standard Day (minutes)',
      description: 'Full-day worked minutes threshold. Records below this flag short_hours.',
      dataType: 'number', defaultValue: 480, minValue: 60, maxValue: 1440,
      scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_attendance.overtime_threshold_minutes', {
      label: 'Overtime Threshold (minutes)',
      description: 'Worked minutes above which time is counted as overtime.',
      dataType: 'number', defaultValue: 480, minValue: 60, maxValue: 1440,
      scope: ['global', 'site'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_attendance.rounding_minutes', {
      label: 'Punch Rounding (minutes)',
      description: 'Round punch times to the nearest N minutes. Set to 0 to disable.',
      dataType: 'number', defaultValue: 0, minValue: 0, maxValue: 30,
      scope: ['global'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_attendance.workweek', {
      label: 'Workweek Days',
      description: 'JSON array of workday numbers (0=Sun, 1=Mon, ..., 6=Sat). Default: [1,2,3,4,5].',
      dataType: 'string', defaultValue: '[1,2,3,4,5]',
      scope: ['global', 'site'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_attendance.geofence_radius_m', {
      label: 'Geofence Radius (metres)',
      description: 'Max distance from site centre for a valid geofenced punch.',
      dataType: 'number', defaultValue: 100, minValue: 10, maxValue: 5000,
      scope: ['global', 'site'], requiresPermission: MANAGE,
    }),
    modulePolicy(M, 'hr_attendance.pay_period', {
      label: 'Pay Period',
      description: 'Timesheet roll-up period: weekly, biweekly, or monthly.',
      dataType: 'select', defaultValue: 'biweekly', allowedValues: ['weekly', 'biweekly', 'monthly'],
      scope: ['global'], requiresPermission: MANAGE,
    }),
  ],
};
