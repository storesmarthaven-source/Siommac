// lib/hr/timekeepingCompute.ts
// Pure compute engine for HR Attendance & Timekeeping.
// No side effects: computeDay and computePeriod read inputs, return results.
// Unit-tested in tests/unit/timekeepingCompute.test.ts.

import type {
  AttendancePolicy, DayComputeResult, PeriodComputeResult,
  AttendanceStatus, ExceptionType,
} from '../../../../types/hrAttendance';

// ─ Helpers ───────────────────────────────────────────────────────────────────

/** Round minutes to nearest N. When N<=1 no rounding applied. */
export function roundMinutes(minutes: number, roundTo: number): number {
  if (roundTo <= 1) return minutes;
  return Math.round(minutes / roundTo) * roundTo;
}

/** Parse 'HH:MM' into total minutes from midnight. */
export function shiftStartMinutes(shiftStart: string): number {
  const parts = shiftStart.split(':');
  const hh = parseInt(parts[0] ?? '8', 10);
  const mm = parseInt(parts[1] ?? '0', 10);
  return hh * 60 + mm;
}

/**
 * Return shift-start as an absolute UTC Date for comparison with timestamptz values.
 * Treats workDate as a calendar date (YYYY-MM-DD) and shiftStart as wall-clock minutes
 * from midnight, converting to UTC midnight + offset.
 */
export function shiftStartForDate(workDate: string, shiftStart: string): Date {
  const [year, month, day] = workDate.split('-').map(Number);
  const shiftMins = shiftStartMinutes(shiftStart);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, shiftMins, 0, 0));
}

// ─ computeDay ────────────────────────────────────────────────────────────────

export interface ComputeDayInput {
  record: {
    workDate: string;
    punchInAt: string | null;
    punchOutAt: string | null;
    geofenceViolation?: boolean;
  };
  policy: AttendancePolicy;
  approvedLeave: { isOnLeave: boolean } | null;
}

/**
 * Compute a single day result from raw punch data + policy + leave status.
 * Pure function: no DB calls, no side effects.
 */
export function computeDay(input: ComputeDayInput): DayComputeResult {
  const { record, policy, approvedLeave } = input;
  const exceptions: Array<{ exceptionType: ExceptionType; minutes: number | null }> = [];

  const date = new Date(record.workDate + 'T00:00:00Z');
  const dayOfWeek = date.getUTCDay();
  const isWorkday = policy.workweek.includes(dayOfWeek);

  if (approvedLeave?.isOnLeave) {
    return { status: 'on_leave', workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, exceptions };
  }

  if (!isWorkday && !record.punchInAt) {
    return { status: 'holiday', workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, exceptions };
  }

  const hasPunchIn  = !!record.punchInAt;
  const hasPunchOut = !!record.punchOutAt;

  if (hasPunchIn && !hasPunchOut) {
    exceptions.push({ exceptionType: 'missing_punch', minutes: null });
    return { status: 'missing_punch', workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, exceptions };
  }

  if (!hasPunchIn && !hasPunchOut) {
    if (isWorkday) {
      exceptions.push({ exceptionType: 'absent', minutes: null });
      return { status: 'absent', workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, exceptions };
    }
    return { status: 'holiday', workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, exceptions };
  }

  const inTs  = new Date(record.punchInAt!).getTime();
  const outTs = new Date(record.punchOutAt!).getTime();
  const rawWorkedMins = Math.max(0, Math.floor((outTs - inTs) / 60000));
  const workedMinutes = roundMinutes(rawWorkedMins, policy.roundingMinutes);

  const shiftStartTs = shiftStartForDate(record.workDate, policy.shiftStart).getTime();
  const minsAfterShift = Math.floor((inTs - shiftStartTs) / 60000);
  const lateMinutes = Math.max(0, minsAfterShift - policy.graceMinutes);

  const overtimeMinutes = Math.max(0, workedMinutes - policy.overtimeThresholdMinutes);

  let status: AttendanceStatus;
  if (lateMinutes > 0) {
    status = 'late';
    exceptions.push({ exceptionType: 'late_arrival', minutes: lateMinutes });
  } else if (workedMinutes < policy.standardDayMinutes / 2) {
    status = 'half_day';
    exceptions.push({ exceptionType: 'short_hours', minutes: policy.standardDayMinutes - workedMinutes });
  } else if (workedMinutes < policy.standardDayMinutes) {
    status = 'short_hours';
    exceptions.push({ exceptionType: 'short_hours', minutes: policy.standardDayMinutes - workedMinutes });
  } else if (overtimeMinutes > 0) {
    status = 'over_hours';
    exceptions.push({ exceptionType: 'over_hours', minutes: overtimeMinutes });
  } else {
    status = 'present';
  }

  if (record.geofenceViolation) {
    exceptions.push({ exceptionType: 'geofence_violation', minutes: null });
  }

  return { status, workedMinutes, lateMinutes, overtimeMinutes, exceptions };
}

// ─ computePeriod ─────────────────────────────────────────────────────────────

export interface ComputePeriodRecord {
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

/**
 * Roll up daily records into period totals.
 * Pure function: no DB calls, no side effects.
 */
export function computePeriod(records: ComputePeriodRecord[]): PeriodComputeResult {
  let totalWorkedMinutes   = 0;
  let totalLateMinutes     = 0;
  let totalOvertimeMinutes = 0;
  let daysPresent          = 0;
  let daysAbsent           = 0;
  let daysOnLeave          = 0;

  for (const r of records) {
    totalWorkedMinutes   += r.workedMinutes;
    totalLateMinutes     += r.lateMinutes;
    totalOvertimeMinutes += r.overtimeMinutes;
    if (r.status === 'absent')   daysAbsent++;
    else if (r.status === 'on_leave' || r.status === 'holiday') daysOnLeave++;
    else if (r.status !== 'missing_punch') daysPresent++;
  }

  return { totalWorkedMinutes, totalLateMinutes, totalOvertimeMinutes, daysPresent, daysAbsent, daysOnLeave };
}
