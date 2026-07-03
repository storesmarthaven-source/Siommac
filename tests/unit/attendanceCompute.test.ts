/**
 * tests/unit/attendanceCompute.test.ts
 *
 * Unit tests for the PURE attendance compute engine (computeDay / computePeriod).
 * No DB, no side effects — the brief requires these to be recomputed, not
 * hand-maintained, so their correctness is pinned here.
 *
 * Shift times are UTC (see shiftStartForDate), so all punch timestamps use `Z`.
 * 2026-06-15 is a Monday (workday); 2026-06-14 is a Sunday (non-workday).
 */

import { computeDay, computePeriod } from '../../netlify/functions/lib/hr/timekeepingCompute';
import type { AttendancePolicy } from '../../types/hrAttendance';

const POLICY: AttendancePolicy = {
  enabled: true,
  shiftStart: '08:00',
  graceMinutes: 5,
  standardDayMinutes: 480,
  overtimeThresholdMinutes: 480,
  roundingMinutes: 0,
  workweek: [1, 2, 3, 4, 5],
  geofenceRadiusM: 100,
  payPeriod: 'biweekly',
};

const WORKDAY = '2026-06-15';  // Monday
const WEEKEND = '2026-06-14';  // Sunday

const day = (punchInAt: string | null, punchOutAt: string | null, workDate = WORKDAY, leave = false) =>
  computeDay({ record: { workDate, punchInAt, punchOutAt }, policy: POLICY, approvedLeave: leave ? { isOnLeave: true } : null });

describe('computeDay', () => {
  it('approved leave → on_leave, zero minutes, no exceptions', () => {
    const r = day(null, null, WORKDAY, true);
    expect(r.status).toBe('on_leave');
    expect(r.workedMinutes).toBe(0);
    expect(r.exceptions).toHaveLength(0);
  });

  it('non-workday with no punch → holiday (no absent exception)', () => {
    const r = day(null, null, WEEKEND);
    expect(r.status).toBe('holiday');
    expect(r.exceptions).toHaveLength(0);
  });

  it('workday with no punch → absent + absent exception', () => {
    const r = day(null, null, WORKDAY);
    expect(r.status).toBe('absent');
    expect(r.exceptions).toEqual([{ exceptionType: 'absent', minutes: null }]);
  });

  it('punch in but no punch out → missing_punch', () => {
    const r = day(`${WORKDAY}T08:00:00Z`, null);
    expect(r.status).toBe('missing_punch');
    expect(r.exceptions).toEqual([{ exceptionType: 'missing_punch', minutes: null }]);
  });

  it('on-time full day → present, no exceptions, worked = 480', () => {
    const r = day(`${WORKDAY}T08:00:00Z`, `${WORKDAY}T16:00:00Z`);
    expect(r.status).toBe('present');
    expect(r.workedMinutes).toBe(480);
    expect(r.lateMinutes).toBe(0);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.exceptions).toHaveLength(0);
  });

  it('arrival within grace (08:05, grace 5) → present, not late', () => {
    const r = day(`${WORKDAY}T08:05:00Z`, `${WORKDAY}T16:05:00Z`);
    expect(r.status).toBe('present');
    expect(r.lateMinutes).toBe(0);
  });

  it('late arrival (08:30, grace 5) → late + late_arrival exception, lateMinutes = 25', () => {
    const r = day(`${WORKDAY}T08:30:00Z`, `${WORKDAY}T16:30:00Z`);
    expect(r.status).toBe('late');
    expect(r.lateMinutes).toBe(25);
    expect(r.exceptions).toEqual([{ exceptionType: 'late_arrival', minutes: 25 }]);
  });

  it('short day (6h, ≥ half) → short_hours + short_hours exception', () => {
    const r = day(`${WORKDAY}T08:00:00Z`, `${WORKDAY}T14:00:00Z`); // 360 min
    expect(r.status).toBe('short_hours');
    expect(r.workedMinutes).toBe(360);
    expect(r.exceptions).toEqual([{ exceptionType: 'short_hours', minutes: 120 }]);
  });

  it('very short day (< half standard) → half_day', () => {
    const r = day(`${WORKDAY}T08:00:00Z`, `${WORKDAY}T11:00:00Z`); // 180 min < 240
    expect(r.status).toBe('half_day');
    expect(r.exceptions).toEqual([{ exceptionType: 'short_hours', minutes: 300 }]);
  });

  it('overtime (9h) → over_hours + over_hours exception, overtimeMinutes = 60', () => {
    const r = day(`${WORKDAY}T08:00:00Z`, `${WORKDAY}T17:00:00Z`); // 540 min
    expect(r.status).toBe('over_hours');
    expect(r.overtimeMinutes).toBe(60);
    expect(r.exceptions).toEqual([{ exceptionType: 'over_hours', minutes: 60 }]);
  });

  it('rounding applies to worked minutes', () => {
    const rounded = computeDay({
      record: { workDate: WORKDAY, punchInAt: `${WORKDAY}T08:00:00Z`, punchOutAt: `${WORKDAY}T16:08:00Z` }, // 488 min
      policy: { ...POLICY, roundingMinutes: 10 },
      approvedLeave: null,
    });
    expect(rounded.workedMinutes).toBe(490); // round(488/10)*10
  });
});

describe('computePeriod', () => {
  it('sums minutes and counts present / absent / on-leave days', () => {
    const rollup = computePeriod([
      { status: 'present',   workedMinutes: 480, lateMinutes: 0,  overtimeMinutes: 0 },
      { status: 'late',      workedMinutes: 480, lateMinutes: 25, overtimeMinutes: 0 },
      { status: 'over_hours',workedMinutes: 540, lateMinutes: 0,  overtimeMinutes: 60 },
      { status: 'absent',    workedMinutes: 0,   lateMinutes: 0,  overtimeMinutes: 0 },
      { status: 'on_leave',  workedMinutes: 0,   lateMinutes: 0,  overtimeMinutes: 0 },
      { status: 'holiday',   workedMinutes: 0,   lateMinutes: 0,  overtimeMinutes: 0 },
      { status: 'missing_punch', workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0 },
    ]);
    expect(rollup.totalWorkedMinutes).toBe(1500);
    expect(rollup.totalLateMinutes).toBe(25);
    expect(rollup.totalOvertimeMinutes).toBe(60);
    expect(rollup.daysPresent).toBe(3);   // present + late + over_hours
    expect(rollup.daysAbsent).toBe(1);
    expect(rollup.daysOnLeave).toBe(2);   // on_leave + holiday
  });

  it('empty period → all zeros', () => {
    const rollup = computePeriod([]);
    expect(rollup).toEqual({
      totalWorkedMinutes: 0, totalLateMinutes: 0, totalOvertimeMinutes: 0,
      daysPresent: 0, daysAbsent: 0, daysOnLeave: 0,
    });
  });
});
