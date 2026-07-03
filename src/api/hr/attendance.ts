/**
 * src/api/hr/attendance.ts
 *
 * Typed client + TanStack hooks for the HR Attendance & Timekeeping backend
 * (routes/hrAttendance.ts — POST `hr/attendance/*`, camelCase `body.args`).
 * `call<T>` throws on `success:false`. Query keys are namespaced under
 * `['hr','attendance', …]`; mutations invalidate that root.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  AttendanceRecord, Timesheet, AttendanceException, AttendanceStats, AttendancePolicy,
  PunchInArgs, PunchOutArgs, ApplyCorrectionArgs, BuildTimesheetArgs, SubmitTimesheetArgs,
} from '../../../types/hrAttendance';

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

// ── Query keys ──────────────────────────────────────────────────────────────
export const hrAttendanceKeys = {
  root:       ['hr', 'attendance'] as const,
  records:    (f?: unknown) => ['hr', 'attendance', 'records', f ?? {}] as const,
  timesheets: (f?: unknown) => ['hr', 'attendance', 'timesheets', f ?? {}] as const,
  exceptions: (f?: unknown) => ['hr', 'attendance', 'exceptions', f ?? {}] as const,
  stats:      (d?: string)  => ['hr', 'attendance', 'stats', d ?? 'today'] as const,
  policy:     ()            => ['hr', 'attendance', 'policy'] as const,
};

// ── Filters ─────────────────────────────────────────────────────────────────
export interface RecordFilter    { employeeId?: string; fromDate?: string; toDate?: string; timesheetId?: string; limit?: number; offset?: number }
export interface TimesheetFilter { employeeId?: string; status?: string; fromPeriod?: string; toPeriod?: string; limit?: number; offset?: number }
export interface ExceptionFilter { employeeId?: string; status?: string; timesheetId?: string; fromDate?: string; toDate?: string; limit?: number; offset?: number }

type RecordsResult    = { records: AttendanceRecord[]; total: number };
type TimesheetsResult = { timesheets: Timesheet[]; total: number };
type ExceptionsResult = { exceptions: AttendanceException[]; total: number };

// ── Reads ───────────────────────────────────────────────────────────────────
export function useAttendanceRecords(filter: RecordFilter = {}) {
  return useQuery({
    queryKey: hrAttendanceKeys.records(filter),
    queryFn:  () => call<RecordsResult>('hr/attendance/records/list', filter),
    placeholderData: (prev) => prev,
  });
}

export function useTimesheets(filter: TimesheetFilter = {}) {
  return useQuery({
    queryKey: hrAttendanceKeys.timesheets(filter),
    queryFn:  () => call<TimesheetsResult>('hr/attendance/timesheets/list', filter),
    placeholderData: (prev) => prev,
  });
}

export function useAttendanceExceptions(filter: ExceptionFilter = {}) {
  return useQuery({
    queryKey: hrAttendanceKeys.exceptions(filter),
    queryFn:  () => call<ExceptionsResult>('hr/attendance/exceptions/list', filter),
    placeholderData: (prev) => prev,
  });
}

export function useAttendanceStats(date?: string) {
  return useQuery({
    queryKey: hrAttendanceKeys.stats(date),
    queryFn:  () => call<AttendanceStats>('hr/attendance/stats', date ? { date } : {}),
    placeholderData: (prev) => prev,
  });
}

export function useAttendancePolicy() {
  return useQuery({
    queryKey: hrAttendanceKeys.policy(),
    queryFn:  () => call<AttendancePolicy>('hr/attendance/policy/get', {}),
  });
}

// ── Mutations (all invalidate the attendance root) ────────────────────────────
function useAttendanceMutation<TArgs, TData>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => call<TData>(path, args as object),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: hrAttendanceKeys.root }); },
  });
}

export const usePunchIn        = () => useAttendanceMutation<PunchInArgs, AttendanceRecord>('hr/attendance/punch/in');
export const usePunchOut       = () => useAttendanceMutation<PunchOutArgs, AttendanceRecord>('hr/attendance/punch/out');
export const useCorrectRecord  = () => useAttendanceMutation<ApplyCorrectionArgs, AttendanceRecord | null>('hr/attendance/records/correct');
export const useComputeRecord  = () => useAttendanceMutation<{ recordId: string }, AttendanceRecord | null>('hr/attendance/compute/run');
export const useWaiveException = () => useAttendanceMutation<{ exceptionId: string; waiveReason: string }, null>('hr/attendance/exceptions/waive');
export const useResolveException = () => useAttendanceMutation<{ exceptionId: string; resolveNote: string }, null>('hr/attendance/exceptions/resolve');
export const useBuildTimesheet   = () => useAttendanceMutation<BuildTimesheetArgs, Timesheet>('hr/attendance/timesheets/build');
export const useSubmitTimesheet  = () => useAttendanceMutation<SubmitTimesheetArgs, Timesheet>('hr/attendance/timesheets/submit');
export const useReopenTimesheet  = () => useAttendanceMutation<{ timesheetId: string }, null>('hr/attendance/timesheets/reopen');

/** minutes → "Hh Mm" */
export function fmtMinutes(m: number | null | undefined): string {
  if (!m) return '0h';
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}
