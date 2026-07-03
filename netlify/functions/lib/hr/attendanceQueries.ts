// lib/hr/attendanceQueries.ts
// Read-only DB queries for Attendance records, timesheets, exceptions.
import { sb } from '../db';
import { resolveSettingValue } from '../settings/resolveSetting';
import type { AttendancePolicy, AttendanceStats, AttendanceStatus } from '../../../../types/hrAttendance';

const sScope = { moduleKey: 'hr_attendance' };

const DEFAULTS: AttendancePolicy = {
  enabled: true, shiftStart: '08:00', graceMinutes: 5, standardDayMinutes: 480,
  overtimeThresholdMinutes: 480, roundingMinutes: 0, workweek: [1, 2, 3, 4, 5],
  geofenceRadiusM: 100, payPeriod: 'biweekly',
};

export async function loadAttendancePolicy(siteId?: string | null): Promise<AttendancePolicy> {
  const [enabled, shiftStart, graceMinutes, standardDayMinutes, overtimeThresholdMinutes,
    roundingMinutes, workweek, geofenceRadiusM, payPeriod] = await Promise.all([
    resolveSettingValue<boolean>(sb, 'hr_attendance.enabled', sScope, DEFAULTS.enabled),
    resolveSettingValue<string>(sb, 'hr_attendance.shift_start', { ...sScope, siteId: siteId ?? undefined }, DEFAULTS.shiftStart),
    resolveSettingValue<number>(sb, 'hr_attendance.grace_minutes', { ...sScope, siteId: siteId ?? undefined }, DEFAULTS.graceMinutes),
    resolveSettingValue<number>(sb, 'hr_attendance.standard_day_minutes', sScope, DEFAULTS.standardDayMinutes),
    resolveSettingValue<number>(sb, 'hr_attendance.overtime_threshold_minutes', { ...sScope, siteId: siteId ?? undefined }, DEFAULTS.overtimeThresholdMinutes),
    resolveSettingValue<number>(sb, 'hr_attendance.rounding_minutes', sScope, DEFAULTS.roundingMinutes),
    resolveSettingValue<string>(sb, 'hr_attendance.workweek', { ...sScope, siteId: siteId ?? undefined }, JSON.stringify(DEFAULTS.workweek)),
    resolveSettingValue<number>(sb, 'hr_attendance.geofence_radius_m', { ...sScope, siteId: siteId ?? undefined }, DEFAULTS.geofenceRadiusM),
    resolveSettingValue<string>(sb, 'hr_attendance.pay_period', sScope, DEFAULTS.payPeriod),
  ]);

  let parsedWorkweek: number[] = DEFAULTS.workweek;
  try {
    const ww = typeof workweek === 'string' ? JSON.parse(workweek) : workweek;
    if (Array.isArray(ww)) parsedWorkweek = ww as number[];
  } catch { /* use default */ }

  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULTS.enabled,
    shiftStart: typeof shiftStart === 'string' ? shiftStart : DEFAULTS.shiftStart,
    graceMinutes: Number(graceMinutes) || DEFAULTS.graceMinutes,
    standardDayMinutes: Number(standardDayMinutes) || DEFAULTS.standardDayMinutes,
    overtimeThresholdMinutes: Number(overtimeThresholdMinutes) || DEFAULTS.overtimeThresholdMinutes,
    roundingMinutes: Number(roundingMinutes) || DEFAULTS.roundingMinutes,
    workweek: parsedWorkweek,
    geofenceRadiusM: Number(geofenceRadiusM) || DEFAULTS.geofenceRadiusM,
    payPeriod: (typeof payPeriod === 'string' ? payPeriod : DEFAULTS.payPeriod) as AttendancePolicy['payPeriod'],
  };
}
/**
 * Defensive read of hr_leave_requests. Returns { isOnLeave: false } on any error
 * so Attendance degrades gracefully if Leave tables change.
 */
export async function findApprovedLeaveForDate(
  employeeId: string,
  workDate: string,
): Promise<{ isOnLeave: boolean }> {
  try {
    const { data, error } = await sb
      .from('hr_leave_requests')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .lte('from_date', workDate)
      .gte('to_date', workDate)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (error) return { isOnLeave: false };
    return { isOnLeave: !!data };
  } catch {
    return { isOnLeave: false };
  }
}

interface RecordRow {
  id: string; record_no: string; employee_id: string; work_date: string;
  punch_in_at: string | null; punch_out_at: string | null;
  punch_in_site: string | null; punch_out_site: string | null;
  punch_in_lat: number | null; punch_in_lng: number | null;
  punch_out_lat: number | null; punch_out_lng: number | null;
  geofence_violation: boolean; photo_in_path: string | null; photo_out_path: string | null;
  status: string; worked_minutes: number; late_minutes: number; overtime_minutes: number;
  timesheet_id: string | null; notes: string | null; source: string;
  created_at: string; updated_at: string | null;
}

export function mapRecord(r: RecordRow) {
  return {
    id: r.id, recordNo: r.record_no, employeeId: r.employee_id, workDate: r.work_date,
    punchInAt: r.punch_in_at, punchOutAt: r.punch_out_at,
    punchInSite: r.punch_in_site, punchOutSite: r.punch_out_site,
    punchInLat: r.punch_in_lat, punchInLng: r.punch_in_lng,
    punchOutLat: r.punch_out_lat, punchOutLng: r.punch_out_lng,
    geofenceViolation: r.geofence_violation,
    photoInPath: r.photo_in_path, photoOutPath: r.photo_out_path,
    status: r.status as AttendanceStatus, workedMinutes: r.worked_minutes, lateMinutes: r.late_minutes,
    overtimeMinutes: r.overtime_minutes, timesheetId: r.timesheet_id,
    notes: r.notes, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
export async function getAttendanceRecord(id: string) {
  const { data, error } = await sb.from('hr_attendance_records').select('*').eq('id', id).single<RecordRow>();
  if (error || !data) return null;
  return mapRecord(data);
}

export async function getAttendanceRecordForDate(employeeId: string, workDate: string) {
  const { data, error } = await sb.from('hr_attendance_records').select('*')
    .eq('employee_id', employeeId).eq('work_date', workDate).maybeSingle<RecordRow>();
  if (error || !data) return null;
  return mapRecord(data);
}

export async function listAttendanceRecords(params: {
  employeeId?: string; fromDate?: string; toDate?: string;
  timesheetId?: string; limit?: number; offset?: number;
}) {
  let q = sb.from('hr_attendance_records').select('*', { count: 'exact' });
  if (params.employeeId)  q = q.eq('employee_id', params.employeeId);
  if (params.fromDate)    q = q.gte('work_date', params.fromDate);
  if (params.toDate)      q = q.lte('work_date', params.toDate);
  if (params.timesheetId) q = q.eq('timesheet_id', params.timesheetId);
  q = q.order('work_date', { ascending: false })
       .range(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 50) - 1);
  const { data, error, count } = await q;
  if (error) throw new Error('Failed to list attendance records: ' + error.message);
  return { records: (data ?? []).map(r => mapRecord(r as RecordRow)), total: count ?? 0 };
}

interface TimesheetRow {
  id: string; timesheet_no: string; employee_id: string; period_start: string; period_end: string;
  total_worked_minutes: number; total_late_minutes: number; total_overtime_minutes: number;
  days_present: number; days_absent: number; days_on_leave: number;
  status: string; submitted_at: string | null; submitted_by: string | null;
  approved_by: string | null; approved_at: string | null; rejection_note: string | null;
  workflow_id: string | null; open_exception_count: number; notes: string | null;
  created_at: string; updated_at: string | null;
}

export function mapTimesheet(r: TimesheetRow) {
  return {
    id: r.id, timesheetNo: r.timesheet_no, employeeId: r.employee_id,
    periodStart: r.period_start, periodEnd: r.period_end,
    totalWorkedMinutes: r.total_worked_minutes, totalLateMinutes: r.total_late_minutes,
    totalOvertimeMinutes: r.total_overtime_minutes,
    daysPresent: r.days_present, daysAbsent: r.days_absent, daysOnLeave: r.days_on_leave,
    status: r.status, submittedAt: r.submitted_at, submittedBy: r.submitted_by,
    approvedBy: r.approved_by, approvedAt: r.approved_at, rejectionNote: r.rejection_note,
    workflowId: r.workflow_id, openExceptionCount: r.open_exception_count,
    notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
export async function getTimesheet(id: string) {
  const { data, error } = await sb.from('hr_timesheets').select('*').eq('id', id).single<TimesheetRow>();
  if (error || !data) return null;
  return mapTimesheet(data);
}

export async function listTimesheets(params: {
  employeeId?: string; status?: string; fromPeriod?: string; toPeriod?: string;
  limit?: number; offset?: number;
}) {
  let q = sb.from('hr_timesheets').select('*', { count: 'exact' });
  if (params.employeeId) q = q.eq('employee_id', params.employeeId);
  if (params.status)     q = q.eq('status', params.status);
  if (params.fromPeriod) q = q.gte('period_start', params.fromPeriod);
  if (params.toPeriod)   q = q.lte('period_end', params.toPeriod);
  q = q.order('period_start', { ascending: false })
       .range(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 50) - 1);
  const { data, error, count } = await q;
  if (error) throw new Error('Failed to list timesheets: ' + error.message);
  return { timesheets: (data ?? []).map(r => mapTimesheet(r as TimesheetRow)), total: count ?? 0 };
}

interface ExceptionRow {
  id: string; record_id: string; employee_id: string; work_date: string; exception_type: string;
  minutes: number | null; status: string; waived_by: string | null; waived_at: string | null;
  waive_reason: string | null; resolved_by: string | null; resolved_at: string | null;
  resolve_note: string | null; timesheet_id: string | null; created_at: string; updated_at: string | null;
}

export function mapException(r: ExceptionRow) {
  return {
    id: r.id, recordId: r.record_id, employeeId: r.employee_id, workDate: r.work_date,
    exceptionType: r.exception_type, minutes: r.minutes, status: r.status,
    waivedBy: r.waived_by, waivedAt: r.waived_at, waiveReason: r.waive_reason,
    resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, resolveNote: r.resolve_note,
    timesheetId: r.timesheet_id, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function listExceptions(params: {
  employeeId?: string; status?: string; timesheetId?: string;
  fromDate?: string; toDate?: string; limit?: number; offset?: number;
}) {
  let q = sb.from('hr_attendance_exceptions').select('*', { count: 'exact' });
  if (params.employeeId)  q = q.eq('employee_id', params.employeeId);
  if (params.status)      q = q.eq('status', params.status);
  if (params.timesheetId) q = q.eq('timesheet_id', params.timesheetId);
  if (params.fromDate)    q = q.gte('work_date', params.fromDate);
  if (params.toDate)      q = q.lte('work_date', params.toDate);
  q = q.order('work_date', { ascending: false })
       .range(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 100) - 1);
  const { data, error, count } = await q;
  if (error) throw new Error('Failed to list exceptions: ' + error.message);
  return { exceptions: (data ?? []).map(r => mapException(r as ExceptionRow)), total: count ?? 0 };
}

export async function getAttendanceStats(today: string): Promise<AttendanceStats> {
  const [empR, todayR, exceptR, tsR] = await Promise.all([
    sb.from('app_users').select('id', { count: 'exact' }).eq('status', 'active'),
    sb.from('hr_attendance_records').select('status', { count: 'exact' }).eq('work_date', today),
    sb.from('hr_attendance_exceptions').select('id', { count: 'exact' }).eq('status', 'open'),
    sb.from('hr_timesheets').select('id', { count: 'exact' }).in('status', ['submitted', 'in_review']),
  ]);
  const todayRows = (todayR.data ?? []) as { status: string }[];
  return {
    totalEmployees:    empR.count ?? 0,
    presentToday:      todayRows.filter(r => ['present','late','over_hours','short_hours','half_day'].includes(r.status)).length,
    absentToday:       todayRows.filter(r => r.status === 'absent').length,
    lateToday:         todayRows.filter(r => r.status === 'late').length,
    openExceptions:    exceptR.count ?? 0,
    pendingTimesheets: tsR.count ?? 0,
  };
}