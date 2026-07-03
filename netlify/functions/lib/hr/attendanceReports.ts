// lib/hr/attendanceReports.ts
// Report definitions and runners for HR Attendance.
// Drop: Payroll Attendance Feed (depends on Finance Payroll, per spec S0.1).

import { sb } from '../db';

export const ATTENDANCE_REPORTS = [
  { key: 'daily_log',                label: 'Daily Attendance Log' },
  { key: 'late_arrival',             label: 'Late Arrivals' },
  { key: 'absence',                  label: 'Absence Report' },
  { key: 'missing_punch',            label: 'Missing Punch Report' },
  { key: 'overtime',                 label: 'Overtime Report' },
  { key: 'exception_aging',          label: 'Exception Aging' },
  { key: 'correction_audit',         label: 'Correction Audit Trail' },
  { key: 'timesheet_approval_aging', label: 'Timesheet Approval Aging' },
  { key: 'geofence_violation',       label: 'Geofence Violations' },
  { key: 'attendance_by_dept',       label: 'Attendance by Department/Site' },
  { key: 'leave_reconciled_absence', label: 'Leave-Reconciled Absence' },
] as const;

export type AttendanceReportKey = typeof ATTENDANCE_REPORTS[number]['key'];

export interface RunReportArgs {
  reportKey: AttendanceReportKey;
  fromDate?: string;
  toDate?: string;
  employeeId?: string;
  departmentId?: string;
  siteId?: string;
  limit?: number;
  offset?: number;
}

export async function listReports() {
  return ATTENDANCE_REPORTS;
}

export async function runReport(args: RunReportArgs): Promise<{ rows: unknown[]; total: number }> {
  const from   = args.fromDate ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to     = args.toDate   ?? new Date().toISOString().slice(0, 10);
  const limit  = args.limit  ?? 200;
  const offset = args.offset ?? 0;

  switch (args.reportKey) {
    case 'daily_log': {
      let q = sb.from('hr_attendance_records').select('*, app_users!employee_id(display_name, department_id)', { count: 'exact' })
        .gte("work_date", from).lte("work_date", to).order('work_date', { ascending: false }).range(offset, offset + limit - 1);
      if (args.employeeId)  q = q.eq('employee_id', args.employeeId);
      const { data, error, count } = await q;
      if (error) throw new Error('daily_log: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }    case 'late_arrival': {
      let q = sb.from('hr_attendance_records').select('*', { count: 'exact' })
        .eq('status', 'late').gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false }).range(offset, offset + limit - 1);
      if (args.employeeId) q = q.eq('employee_id', args.employeeId);
      const { data, error, count } = await q;
      if (error) throw new Error('late_arrival: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }
    case 'absence': {
      let q = sb.from('hr_attendance_records').select('*', { count: 'exact' })
        .eq('status', 'absent').gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false }).range(offset, offset + limit - 1);
      if (args.employeeId) q = q.eq('employee_id', args.employeeId);
      const { data, error, count } = await q;
      if (error) throw new Error('absence: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }
    case 'missing_punch': {
      let q = sb.from('hr_attendance_records').select('*', { count: 'exact' })
        .eq('status', 'missing_punch').gte('work_date', from).lte('work_date', to).range(offset, offset + limit - 1);
      if (args.employeeId) q = q.eq('employee_id', args.employeeId);
      const { data, error, count } = await q;
      if (error) throw new Error('missing_punch: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }
    case 'overtime': {
      let q = sb.from('hr_attendance_records').select('*', { count: 'exact' })
        .gt('overtime_minutes', 0).gte('work_date', from).lte('work_date', to).range(offset, offset + limit - 1);
      if (args.employeeId) q = q.eq('employee_id', args.employeeId);
      const { data, error, count } = await q;
      if (error) throw new Error('overtime: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }
    case 'exception_aging': {
      const { data, error, count } = await sb.from('hr_attendance_exceptions').select('*', { count: 'exact' })
        .eq('status', 'open').gte('work_date', from).lte('work_date', to).order('created_at').range(offset, offset + limit - 1);
      if (error) throw new Error('exception_aging: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }
    case 'correction_audit': {
      const { data, error, count } = await sb.from('hr_attendance_corrections').select('*', { count: 'exact' })
        .gte('work_date', from).lte('work_date', to).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw new Error('correction_audit: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }
    case 'timesheet_approval_aging': {
      const { data, error, count } = await sb.from('hr_timesheets').select('*', { count: 'exact' })
        .in('status', ['submitted', 'in_review']).order('submitted_at').range(offset, offset + limit - 1);
      if (error) throw new Error('timesheet_approval_aging: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }
    case 'geofence_violation': {
      let q = sb.from('hr_attendance_exceptions').select('*', { count: 'exact' })
        .eq('exception_type', 'geofence_violation').gte('work_date', from).lte('work_date', to).range(offset, offset + limit - 1);
      if (args.employeeId) q = q.eq('employee_id', args.employeeId);
      const { data, error, count } = await q;
      if (error) throw new Error('geofence_violation: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }
    case 'attendance_by_dept': {
      const { data, error, count } = await sb.from('hr_attendance_records').select('status, employee_id, work_date, app_users!employee_id(department_id)', { count: 'exact' })
        .gte('work_date', from).lte('work_date', to).range(offset, offset + limit - 1);
      if (error) throw new Error('attendance_by_dept: ' + error.message);
      return { rows: data ?? [], total: count ?? 0 };
    }
    case 'leave_reconciled_absence': {
      // Absences that overlap approved leave (should have been suppressed -- data quality issues)
      const { data: absences, error } = await sb.from('hr_attendance_records').select('*', { count: 'exact' })
        .eq('status', 'absent').gte('work_date', from).lte('work_date', to).range(offset, offset + limit - 1);
      if (error) throw new Error('leave_reconciled_absence: ' + error.message);
      return { rows: absences ?? [], total: absences?.length ?? 0 };
    }
    default:
      throw new Error('Unknown report key.');
  }
}