// Attendance Rules — settings manifest (Spec §28/§29; replaces the legacy
// Settings → Attendance Rules panel). Keys/defaults mirror the legacy flat
// `settings` rows (latePenaltyPerDay, leaveFinePerDay, lateThresholdHHMM,
// maxDistanceM, workHours) so wiring consumers to resolveSetting() is behaviour-
// preserving. See attendance.ts / payroll.ts / auto-checkout.ts. Attendance sits
// under the General group, so settings are gated by settings.global.manage.
import type { ModuleSettingsManifest } from '../types';
import { modulePolicy, workflowRule } from '../catalogHelpers';

const M = 'attendance';
const G = 'settings.global.manage';

export const attendanceManifest: ModuleSettingsManifest = {
  moduleKey: M,
  moduleLabel: 'Attendance Rules',
  hasSettings: true,
  moduleCategory: 'standard',
  reviewedBy: ['product_owner', 'engineering', 'super_admin'],
  sections: [
    { sectionKey: 'general', applies: true },
    { sectionKey: 'validation', applies: true },
    { sectionKey: 'workflow', applies: true },
  ],
  settings: [
    modulePolicy(M, 'attendance.late_threshold_time', {
      label: 'Late Check-In Time', description: 'Check-ins after this time are flagged late.',
      dataType: 'time', defaultValue: '09:00', scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: G,
    }),
    modulePolicy(M, 'attendance.late_penalty_per_day', {
      label: 'Late Penalty (per late day)', description: 'Amount deducted for each late check-in during payroll.',
      dataType: 'number', defaultValue: 0, minValue: 0, maxValue: 100000, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: G,
    }),
    modulePolicy(M, 'attendance.leave_fine_per_day', {
      label: 'Absent / Leave Fine (per day)', description: 'Amount deducted for each absent day in the period.',
      dataType: 'number', defaultValue: 0, minValue: 0, maxValue: 100000, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: G,
    }),
    modulePolicy(M, 'attendance.max_geofence_distance_m', {
      label: 'Max Geofence Distance (m)', description: 'Maximum metres from a site to allow check-in.',
      dataType: 'number', defaultValue: 200, minValue: 0, maxValue: 100000, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: G,
    }),
    modulePolicy(M, 'attendance.work_hours_start', {
      label: 'Work Start Time', description: 'Earliest allowed check-in time.',
      dataType: 'time', defaultValue: '08:00', scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: G,
    }),
    modulePolicy(M, 'attendance.work_hours_end', {
      label: 'Work End Time', description: 'Employees are auto signed-out at this time.',
      dataType: 'time', defaultValue: '17:00', scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: G,
    }),
    modulePolicy(M, 'attendance.location_required', {
      label: 'Location Required', description: 'Require location verification for clock-in and clock-out.',
      dataType: 'boolean', defaultValue: true, scope: ['global', 'site'], siteOverrideAllowed: true, requiresPermission: G,
    }),
    workflowRule(M, 'attendance.overtime_approval_required', {
      label: 'Overtime Approval Required', description: 'Require workflow approval before overtime is accepted.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: G,
    }),
    workflowRule(M, 'attendance.manual_correction_allowed', {
      label: 'Manual Correction Allowed', description: 'Allow supervisors to request manual attendance corrections.',
      dataType: 'boolean', defaultValue: true, scope: ['global'], requiresPermission: G,
    }),
  ],
};
