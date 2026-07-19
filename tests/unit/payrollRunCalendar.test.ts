/**
 * tests/unit/payrollRunCalendar.test.ts
 *
 * Unit tests for the PURE calendar-instance computation in runCalendar.ts.
 * No DB access — exercises computeScheduledInstances directly.
 *
 * Coverage:
 *   monthly:       correct period boundaries, pay-day clamping to month length
 *   semi_monthly:  two periods per month, fixed pay dates
 *   weekly:        all target weekdays in window; period = 7 days ending on pay date
 *   fortnightly:   every 14 days anchored on reference, correct period length
 *   cutoff:        offset > 0 → cutoffAt set; offset = 0 → null
 *   window bounds: instances outside window excluded; max window 186 days (validated at route layer)
 *   empty:         no groups in empty window
 */

import {
  computeScheduledInstances,
  type PayGroupSchedule,
} from '../../netlify/functions/lib/finance/payroll/runCalendar';

// Helper: parse YYYY-MM-DD into UTC Date
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// ── monthly ───────────────────────────────────────────────────────────────────

describe('computeScheduledInstances — monthly', () => {
  const group: PayGroupSchedule = {
    id: 'grp-monthly',
    name: 'Monthly Staff',
    frequency: 'monthly',
    default_pay_day: 25,
    default_cutoff_offset_days: 0,
  };

  it('returns one instance per month in a 3-month window', () => {
    const instances = computeScheduledInstances(group, d('2026-01-01'), d('2026-03-31'));
    expect(instances).toHaveLength(3);
    expect(instances[0]!.payDate.toISOString().slice(0, 10)).toBe('2026-01-25');
    expect(instances[1]!.payDate.toISOString().slice(0, 10)).toBe('2026-02-25');
    expect(instances[2]!.payDate.toISOString().slice(0, 10)).toBe('2026-03-25');
  });

  it('period_start is 1st and period_end is last day of month', () => {
    const [inst] = computeScheduledInstances(group, d('2026-02-01'), d('2026-02-28'));
    expect(inst!.periodStart.toISOString().slice(0, 10)).toBe('2026-02-01');
    expect(inst!.periodEnd.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('clamps pay_day=31 to last day of short month (February 2026)', () => {
    const shortMonthGroup: PayGroupSchedule = { ...group, default_pay_day: 31 };
    const [inst] = computeScheduledInstances(shortMonthGroup, d('2026-02-01'), d('2026-02-28'));
    expect(inst!.payDate.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('clamps pay_day=30 to Feb 28 (non-leap year 2026)', () => {
    const g: PayGroupSchedule = { ...group, default_pay_day: 30 };
    const [inst] = computeScheduledInstances(g, d('2026-02-01'), d('2026-02-28'));
    expect(inst!.payDate.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('clamps pay_day=29 to Feb 29 in a leap year (2028)', () => {
    const g: PayGroupSchedule = { ...group, default_pay_day: 29 };
    const [inst] = computeScheduledInstances(g, d('2028-02-01'), d('2028-02-29'));
    expect(inst!.payDate.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('excludes months whose pay_date falls outside the window', () => {
    // Window is Feb only; default_pay_day=25 → only Feb instance
    const instances = computeScheduledInstances(group, d('2026-02-01'), d('2026-02-28'));
    expect(instances).toHaveLength(1);
    expect(instances[0]!.payDate.toISOString().slice(0, 10)).toBe('2026-02-25');
  });

  it('returns no instances for a window too early for any pay date', () => {
    // Window ends Jan 24, pay day is 25 → no instance
    const instances = computeScheduledInstances(group, d('2026-01-01'), d('2026-01-24'));
    expect(instances).toHaveLength(0);
  });

  it('cutoff is null when default_cutoff_offset_days = 0', () => {
    const [inst] = computeScheduledInstances(group, d('2026-01-01'), d('2026-01-31'));
    expect(inst!.cutoffAt).toBeNull();
  });

  it('cutoff is pay_date minus offset when offset > 0', () => {
    const g: PayGroupSchedule = { ...group, default_cutoff_offset_days: 5 };
    const [inst] = computeScheduledInstances(g, d('2026-01-01'), d('2026-01-31'));
    // pay_date = Jan 25, cutoff = Jan 20
    expect(inst!.cutoffAt!.toISOString().slice(0, 10)).toBe('2026-01-20');
  });

  it('produces a stable key: payGroupId:periodStart:periodEnd', () => {
    const [inst] = computeScheduledInstances(group, d('2026-01-01'), d('2026-01-31'));
    expect(inst!.key).toBe('grp-monthly:2026-01-01:2026-01-31');
  });
});

// ── semi_monthly ──────────────────────────────────────────────────────────────

describe('computeScheduledInstances — semi_monthly', () => {
  const group: PayGroupSchedule = {
    id: 'grp-semi',
    name: 'Semi-Monthly',
    frequency: 'semi_monthly',
    default_pay_day: null, // not used for semi_monthly
    default_cutoff_offset_days: 3,
  };

  it('returns two instances per month', () => {
    const instances = computeScheduledInstances(group, d('2026-01-01'), d('2026-01-31'));
    expect(instances).toHaveLength(2);
  });

  it('first half: period 1–15, pay date 15th', () => {
    const instances = computeScheduledInstances(group, d('2026-03-01'), d('2026-03-31'));
    const first = instances[0]!;
    expect(first.periodStart.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(first.periodEnd.toISOString().slice(0, 10)).toBe('2026-03-15');
    expect(first.payDate.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('second half: period 16–EOM, pay date last day of month', () => {
    const instances = computeScheduledInstances(group, d('2026-03-01'), d('2026-03-31'));
    const second = instances[1]!;
    expect(second.periodStart.toISOString().slice(0, 10)).toBe('2026-03-16');
    expect(second.periodEnd.toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(second.payDate.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('second half of February: pay date = 28th (non-leap)', () => {
    const instances = computeScheduledInstances(group, d('2026-02-01'), d('2026-02-28'));
    const second = instances[1]!;
    expect(second.payDate.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(second.periodEnd.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('returns 4 instances across 2 months', () => {
    const instances = computeScheduledInstances(group, d('2026-01-01'), d('2026-02-28'));
    expect(instances).toHaveLength(4);
  });

  it('cutoff offset applied correctly (3 days before pay date)', () => {
    const instances = computeScheduledInstances(group, d('2026-01-01'), d('2026-01-31'));
    // First half: pay 15th, cutoff 12th
    expect(instances[0]!.cutoffAt!.toISOString().slice(0, 10)).toBe('2026-01-12');
    // Second half: pay 31st, cutoff 28th
    expect(instances[1]!.cutoffAt!.toISOString().slice(0, 10)).toBe('2026-01-28');
  });
});

// ── weekly ────────────────────────────────────────────────────────────────────

describe('computeScheduledInstances — weekly', () => {
  // default_pay_day = 5 (Friday)
  const group: PayGroupSchedule = {
    id: 'grp-weekly',
    name: 'Weekly',
    frequency: 'weekly',
    default_pay_day: 5,
    default_cutoff_offset_days: 2,
  };

  it('finds all Fridays in a 4-week window', () => {
    // 2026-01-05 is a Monday, so 2026-01-09 is the first Friday
    const instances = computeScheduledInstances(group, d('2026-01-05'), d('2026-02-01'));
    const payDates = instances.map(i => i.payDate.toISOString().slice(0, 10));
    expect(payDates).toContain('2026-01-09');
    expect(payDates).toContain('2026-01-16');
    expect(payDates).toContain('2026-01-23');
    expect(payDates).toContain('2026-01-30');
  });

  it('period is exactly 7 days ending on pay date', () => {
    const [inst] = computeScheduledInstances(group, d('2026-01-09'), d('2026-01-09'));
    expect(inst!.payDate.toISOString().slice(0, 10)).toBe('2026-01-09');
    expect(inst!.periodEnd.toISOString().slice(0, 10)).toBe('2026-01-09');
    expect(inst!.periodStart.toISOString().slice(0, 10)).toBe('2026-01-03');
  });

  it('cutoff = pay_date − 2 days', () => {
    const [inst] = computeScheduledInstances(group, d('2026-01-09'), d('2026-01-09'));
    expect(inst!.cutoffAt!.toISOString().slice(0, 10)).toBe('2026-01-07');
  });

  it('returns 0 instances for a window with no matching weekday', () => {
    // A 1-day window that is not a Friday (2026-01-05 = Monday)
    const instances = computeScheduledInstances(group, d('2026-01-05'), d('2026-01-05'));
    expect(instances).toHaveLength(0);
  });

  it('includes exactly the Fridays that fall on or within the window', () => {
    // Window starts on a Friday and ends before the next
    const instances = computeScheduledInstances(group, d('2026-01-09'), d('2026-01-15'));
    expect(instances).toHaveLength(1);
    expect(instances[0]!.payDate.toISOString().slice(0, 10)).toBe('2026-01-09');
  });
});

// ── fortnightly ───────────────────────────────────────────────────────────────

describe('computeScheduledInstances — fortnightly', () => {
  // default_pay_day = 5 (Friday). Anchor 2020-01-06 (Mon) → first Friday on/after = 2020-01-10.
  const group: PayGroupSchedule = {
    id: 'grp-ftn',
    name: 'Fortnightly',
    frequency: 'fortnightly',
    default_pay_day: 5,
    default_cutoff_offset_days: 4,
  };

  it('produces pay dates exactly 14 days apart', () => {
    const instances = computeScheduledInstances(group, d('2026-01-01'), d('2026-03-31'));
    for (let i = 1; i < instances.length; i++) {
      const diffMs = instances[i]!.payDate.getTime() - instances[i - 1]!.payDate.getTime();
      expect(diffMs).toBe(14 * 86_400_000);
    }
  });

  it('period is exactly 14 days ending on pay date', () => {
    const [inst] = computeScheduledInstances(group, d('2026-01-01'), d('2026-01-31'));
    if (inst) {
      const diffMs = inst.periodEnd.getTime() - inst.periodStart.getTime();
      expect(diffMs).toBe(13 * 86_400_000); // period_start = pay_date - 13 days
    }
  });

  it('all pay dates are on the target weekday (Friday = 5)', () => {
    const instances = computeScheduledInstances(group, d('2026-01-01'), d('2026-06-30'));
    for (const inst of instances) {
      expect(inst.payDate.getUTCDay()).toBe(5); // 5 = Friday
    }
  });

  it('cutoff = pay_date − 4 days', () => {
    const instances = computeScheduledInstances(group, d('2026-01-01'), d('2026-01-31'));
    for (const inst of instances) {
      const expectedCutoff = new Date(inst.payDate);
      expectedCutoff.setUTCDate(expectedCutoff.getUTCDate() - 4);
      expect(inst.cutoffAt!.toISOString().slice(0, 10))
        .toBe(expectedCutoff.toISOString().slice(0, 10));
    }
  });
});

// ── General / edge cases ──────────────────────────────────────────────────────

describe('computeScheduledInstances — edge cases', () => {
  it('returns empty array when window has no matching dates', () => {
    const group: PayGroupSchedule = {
      id: 'g', name: 'X', frequency: 'weekly',
      default_pay_day: 5, default_cutoff_offset_days: 0,
    };
    // Monday-only window with Friday pay day
    const instances = computeScheduledInstances(group, d('2026-01-05'), d('2026-01-05'));
    expect(instances).toHaveLength(0);
  });

  it('handles a single-day window matching the pay date', () => {
    const group: PayGroupSchedule = {
      id: 'g', name: 'Monthly', frequency: 'monthly',
      default_pay_day: 15, default_cutoff_offset_days: 0,
    };
    const instances = computeScheduledInstances(group, d('2026-03-15'), d('2026-03-15'));
    expect(instances).toHaveLength(1);
    expect(instances[0]!.payDate.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('key is unique for different (payGroupId, period) pairs', () => {
    const g1: PayGroupSchedule = { id: 'a', name: 'A', frequency: 'monthly', default_pay_day: 25, default_cutoff_offset_days: 0 };
    const g2: PayGroupSchedule = { id: 'b', name: 'B', frequency: 'monthly', default_pay_day: 25, default_cutoff_offset_days: 0 };
    const i1 = computeScheduledInstances(g1, d('2026-01-01'), d('2026-01-31'));
    const i2 = computeScheduledInstances(g2, d('2026-01-01'), d('2026-01-31'));
    expect(i1[0]!.key).not.toBe(i2[0]!.key);
  });
});
