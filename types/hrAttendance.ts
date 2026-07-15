// types/hrAttendance.ts
// Shared camelCase DTOs for HR Attendance & Timekeeping.
// Imported by both backend (netlify/functions/..) and frontend (src/..).

export type AttendanceStatus =
  | 'present' | 'absent' | 'late' | 'half_day' | 'on_leave'
  | 'holiday' | 'missing_punch' | 'short_hours' | 'over_hours';

export type TimesheetStatus =
  | 'draft' | 'submitted' | 'in_review' | 'approved' | 'rejected' | 'reopened';

export type ExceptionType =
  | 'late_arrival' | 'early_departure' | 'absent' | 'missing_punch'
  | 'short_hours' | 'over_hours' | 'geofence_violation' | 'unapproved_overtime';

export type ExceptionStatus = 'open' | 'waived' | 'resolved';

export type AttendanceSource = 'manual' | 'kiosk' | 'mobile' | 'import';

export interface AttendanceRecord {
  id: string;
  recordNo: string;
  employeeId: string;
  workDate: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  punchInSite: string | null;
  punchOutSite: string | null;
  punchInLat: number | null;
  punchInLng: number | null;
  punchOutLat: number | null;
  punchOutLng: number | null;
  geofenceViolation: boolean;
  photoInPath: string | null;
  photoOutPath: string | null;
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  timesheetId: string | null;
  notes: string | null;
  source: AttendanceSource;
  createdAt: string;
  updatedAt: string | null;
}

export interface Timesheet {
  id: string;
  timesheetNo: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  totalWorkedMinutes: number;
  totalLateMinutes: number;
  totalOvertimeMinutes: number;
  daysPresent: number;
  daysAbsent: number;
  daysOnLeave: number;
  status: TimesheetStatus;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionNote: string | null;
  workflowId: string | null;
  openExceptionCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface AttendanceException {
  id: string;
  recordId: string;
  employeeId: string;
  workDate: string;
  exceptionType: ExceptionType;
  minutes: number | null;
  status: ExceptionStatus;
  waivedBy: string | null;
  waivedAt: string | null;
  waiveReason: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolveNote: string | null;
  timesheetId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface AttendanceCorrection {
  id: string;
  recordId: string;
  employeeId: string;
  workDate: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  correctedBy: string;
  createdAt: string;
}

export interface DayComputeResult {
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  exceptions: Array<{ exceptionType: ExceptionType; minutes: number | null }>;
}

export interface PeriodComputeResult {
  totalWorkedMinutes: number;
  totalLateMinutes: number;
  totalOvertimeMinutes: number;
  daysPresent: number;
  daysAbsent: number;
  daysOnLeave: number;
}

export interface AttendancePolicy {
  enabled: boolean;
  shiftStart: string;
  graceMinutes: number;
  standardDayMinutes: number;
  overtimeThresholdMinutes: number;
  roundingMinutes: number;
  workweek: number[];
  geofenceRadiusM: number;
  payPeriod: 'weekly' | 'biweekly' | 'monthly';
}

export interface AttendanceStats {
  totalEmployees: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  openExceptions: number;
  pendingTimesheets: number;
}

export interface PunchInArgs {
  workDate: string;
  lat?: number | null;
  lng?: number | null;
  siteId?: string | null;
  photoPath?: string | null;
  source?: AttendanceSource;
  notes?: string | null;
}

export interface PunchOutArgs {
  recordId?: string;
  lat?: number | null;
  lng?: number | null;
  siteId?: string | null;
  photoPath?: string | null;
}

export interface ApplyCorrectionArgs {
  recordId: string;
  fieldName: string;
  newValue: string;
  reason: string;
}

export interface BuildTimesheetArgs {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
}

export interface SubmitTimesheetArgs {
  timesheetId: string;
  notes?: string | null;
  idempotencyKey: string;
}

export interface WaiveExceptionArgs {
  exceptionId: string;
  waiveReason: string;
}

export interface ResolveExceptionArgs {
  exceptionId: string;
  resolveNote: string;
}
