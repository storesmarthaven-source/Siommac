function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid payroll period date: ${dateText}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function endOfMonth(dateText) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid payroll period date: ${dateText}`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

export function payrollPeriodEnd(periodStart, payFrequency = 'monthly') {
  if (payFrequency === 'weekly') return addDays(periodStart, 6);
  if (payFrequency === 'fortnightly') return addDays(periodStart, 13);
  if (payFrequency === 'semi_monthly') {
    const day = Number(periodStart.slice(8, 10));
    if (day <= 15) return `${periodStart.slice(0, 8)}15`;
  }
  return endOfMonth(periodStart);
}

function monthStart(dateText) {
  return `${dateText.slice(0, 7)}-01`;
}

export function payrollContributionWeeks(periodStart, periodEnd) {
  const startDate = new Date(`${periodStart}T00:00:00.000Z`);
  const endDate = new Date(`${periodEnd}T00:00:00.000Z`);
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf()) || endDate < startDate) {
    throw new Error(`Invalid payroll contribution period: ${periodStart} to ${periodEnd}`);
  }

  const weeksByMonth = new Map();
  for (
    const cursor = new Date(startDate);
    cursor <= endDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    if (cursor.getUTCDay() !== 1) continue;
    const month = monthStart(cursor.toISOString().slice(0, 10));
    weeksByMonth.set(month, (weeksByMonth.get(month) ?? 0) + 1);
  }

  if (weeksByMonth.size === 0) {
    const contributionMonday = new Date(endDate);
    contributionMonday.setUTCDate(
      contributionMonday.getUTCDate() - ((contributionMonday.getUTCDay() + 6) % 7),
    );
    weeksByMonth.set(monthStart(contributionMonday.toISOString().slice(0, 10)), 1);
  }

  return [...weeksByMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, weeks]) => ({ periodMonth: month, weeks }));
}

export function nisContributionPeriods({
  periodStart,
  periodEnd,
  employeeWeekly,
  employerWeekly,
}) {
  if (!Number.isFinite(employeeWeekly) || employeeWeekly < 0) {
    throw new Error('nisContributionPeriods requires a non-negative employeeWeekly amount');
  }
  if (!Number.isFinite(employerWeekly) || employerWeekly < 0) {
    throw new Error('nisContributionPeriods requires a non-negative employerWeekly amount');
  }

  return payrollContributionWeeks(periodStart, periodEnd).map(({ periodMonth: month, weeks }) => ({
    periodMonth: month,
    weeks,
    employeeAmount: Math.round(employeeWeekly * weeks * 100) / 100,
    employerAmount: Math.round(employerWeekly * weeks * 100) / 100,
  }));
}

export function payrollRunCommand({
  idempotencyKey,
  periodStart,
  periodEnd,
  runType = 'scheduled',
  payFrequency = 'monthly',
  ...optional
}) {
  if (!idempotencyKey) throw new Error('payrollRunCommand requires idempotencyKey');
  if (!periodStart) throw new Error('payrollRunCommand requires periodStart');
  return {
    idempotencyKey,
    runType,
    periodStart,
    periodEnd: periodEnd ?? payrollPeriodEnd(periodStart, payFrequency),
    payFrequency,
    ...optional,
  };
}

export function payrollCalculationCommand(id, idempotencyKey) {
  if (!id) throw new Error('payrollCalculationCommand requires a run id');
  if (!idempotencyKey) throw new Error('payrollCalculationCommand requires idempotencyKey');
  return { id, idempotencyKey };
}

export function payrollLockCommand(id, idempotencyKey) {
  if (!id) throw new Error('payrollLockCommand requires a run id');
  if (!idempotencyKey) throw new Error('payrollLockCommand requires idempotencyKey');
  return { id, idempotencyKey };
}

export function payrollCertificationCommand(runId, idempotencyKey, note) {
  if (!runId) throw new Error('payrollCertificationCommand requires a run id');
  if (!idempotencyKey) {
    throw new Error('payrollCertificationCommand requires idempotencyKey');
  }
  return {
    runId,
    idempotencyKey,
    attestations: {
      populationReconciled: true,
      inputsReviewed: true,
      statutoryReviewed: true,
      variancesReviewed: true,
      paymentReadinessReviewed: true,
      glReadinessReviewed: true,
    },
    ...(note ? { note } : {}),
  };
}

export function payrollFundingCommand({
  runId,
  idempotencyKey,
  confirmedAmount,
  confirmationReference,
  accountReference,
  note,
}) {
  if (!runId) throw new Error('payrollFundingCommand requires a run id');
  if (!idempotencyKey) {
    throw new Error('payrollFundingCommand requires idempotencyKey');
  }
  if (!Number.isFinite(confirmedAmount) || confirmedAmount < 0) {
    throw new Error('payrollFundingCommand requires a non-negative confirmedAmount');
  }
  if (!confirmationReference?.trim()) {
    throw new Error('payrollFundingCommand requires confirmationReference');
  }
  return {
    runId,
    idempotencyKey,
    confirmedAmount,
    confirmationReference,
    ...(accountReference ? { accountReference } : {}),
    ...(note ? { note } : {}),
  };
}

export function payrollReleaseCommand(runId, idempotencyKey) {
  if (!runId) throw new Error('payrollReleaseCommand requires a run id');
  if (!idempotencyKey) {
    throw new Error('payrollReleaseCommand requires idempotencyKey');
  }
  return { runId, idempotencyKey };
}

export function payrollExportCommand(id, idempotencyKey, format = 'csv') {
  if (!id) throw new Error('payrollExportCommand requires a run id');
  if (!idempotencyKey) {
    throw new Error('payrollExportCommand requires idempotencyKey');
  }
  if (format !== 'csv' && format !== 'json') {
    throw new Error(`payrollExportCommand does not support format '${format}'`);
  }
  return { id, idempotencyKey, format };
}

export function payrollReopenCommand(id, reason, idempotencyKey) {
  if (!id) throw new Error('payrollReopenCommand requires a run id');
  if (!reason?.trim()) throw new Error('payrollReopenCommand requires a reason');
  if (!idempotencyKey) throw new Error('payrollReopenCommand requires idempotencyKey');
  return { id, reason, idempotencyKey };
}

// ═══════════════════════════════════════════════════════════════════════════
// CENTRAL PAYROLL-RUN PERIOD ALLOCATOR — the single source of run identity.
// ═══════════════════════════════════════════════════════════════════════════
// Every suite in one `run.mjs` invocation shares a single harness TAG, and a
// payroll run's identity is (pay group, period_start, period_end, run_type)
// under migration 420's partial unique indexes. Two null-pay-group scheduled
// runs that resolve to the same period_start therefore collide at seed time
// (cleanup only runs after ALL suites). This file is the ONE place run periods
// are allocated, across TWO disjoint spaces:
//
//   • SALT space  — `payrollPeriod(suite, key, tag)` → a date derived from a
//     claimed salt. Salt N maps into the disjoint day window
//     [N*1000, N*1000+999] after 1970-01-01, so distinct salts never share a
//     date regardless of TAG. Used by suites that just need "some" period.
//
//   • YEAR space  — `payrollPeriodYear(suite, tag)` → a year drawn from the
//     suite's registered band. Used by suites that need a business year
//     (statutory tax year, sequential retro months, adjacent-pair variance).
//
// The two spaces are provably disjoint: `assertPayrollPeriodAllocatorDisjoint`
// runs at import (and in the contract gate) and throws unless every salt is
// unique, every year band is mutually disjoint, and NO salt's year-window
// overlaps ANY year band. So no two allocations can ever produce the same
// (period_start, period_end). Non-period seed dates (e.g. a statutory
// version's `effective_from`) are a different identity space and stay local.

// 2027-01-01 base (day 20819 from 1970-01-01). Salt periods stay in a sane
// near-future window well below the finance_remittances `period_year <= 2100`
// CHECK (a released run creates period-stamped remittances), while each salt
// owns a disjoint 30-day sub-window so distinct salts never share a date.
const SALT_DATE_BASE_DAYS = 20819;
const SALT_WINDOW_DAYS = 30;
export function seedDateFromTag(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const day = SALT_DATE_BASE_DAYS + salt * SALT_WINDOW_DAYS + (n % SALT_WINDOW_DAYS);
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export const PAYROLL_PERIOD_SALTS = Object.freeze({
  financeRemittances:       Object.freeze({ approvedRun: 11, draftRun: 12, atomicRun: 24 }),
  financeDisbursements:     Object.freeze({ mainRun: 13, draftRun: 14, staffRun: 16, cancelRun: 17 }),
  financePayslipsEss:       Object.freeze({ run: 15 }),
  financeLookups:           Object.freeze({ run: 23 }),
  payrollControlCenter:     Object.freeze({ run: 26 }),
  // gl/overrides were salts 25/44, whose year-windows (~2040 / ~2091) overlapped
  // payrollStatutoryForms' year band [2040,2099]. Moved into the low cluster
  // (~2019/2022, well below any year band). The disjointness assertion enforces this.
  payrollGl:                Object.freeze({ run: 18 }),
  payrollOverrides:         Object.freeze({ run: 19 }),
  payrollPayGroups:         Object.freeze({ weeklyRun: 20 }),
  financePayroll:           Object.freeze({
    lifecycle: 51, denyCreate: 52, denySubmit: 53,
    atom60: 60, atom61: 61, atom62: 62, atom63: 63, atom64: 64, atom65: 65,
  }),
  payrollOvertimeRules:     Object.freeze({ run: 55 }),
  payrollStatutorySnapshot: Object.freeze({ run: 66 }),
  payslipRender:            Object.freeze({ run: 71 }),
  payrollExceptions:        Object.freeze({ runA: 21, runB: 22 }),
});

// [minYear, maxYear] inclusive. Bands are mutually disjoint AND disjoint from
// every salt year-window (asserted below). statutoryForms sits in the salt gap
// (~2038 low cluster → ~2109 high cluster); the rest are above the salt ceiling.
export const PAYROLL_PERIOD_YEAR_BANDS = Object.freeze({
  payrollStatutoryForms:   Object.freeze([2040, 2099]),
  payslipTemplateApproval: Object.freeze([2200, 2349]),
  payrollScale:            Object.freeze([2350, 2499]),
  payrollBackPay:          Object.freeze([2500, 2899]),
  payrollVarianceReports:  Object.freeze([2900, 2989]),
});

function yearOfDayOffset(dayOffset) {
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.getUTCFullYear();
}

/** Year window a salt can produce, from the same base/window seedDateFromTag uses. */
export function saltYearWindow(salt) {
  return [
    yearOfDayOffset(SALT_DATE_BASE_DAYS + salt * SALT_WINDOW_DAYS),
    yearOfDayOffset(SALT_DATE_BASE_DAYS + salt * SALT_WINDOW_DAYS + (SALT_WINDOW_DAYS - 1)),
  ];
}

/**
 * Throws unless the whole allocator is collision-free: unique salts, mutually
 * disjoint year bands, and no salt year-window overlapping any year band.
 * Returns the flat list of (salt → owner) for reuse by the contract gate.
 */
export function assertPayrollPeriodAllocatorDisjoint() {
  const overlaps = (a0, a1, b0, b1) => a0 <= b1 && b0 <= a1;

  const claimed = new Map();
  for (const [suite, keys] of Object.entries(PAYROLL_PERIOD_SALTS)) {
    for (const [key, salt] of Object.entries(keys)) {
      const prev = claimed.get(salt);
      if (prev) {
        throw new Error(
          `PAYROLL_PERIOD_SALTS: salt ${salt} is claimed by both ${prev} and ${suite}.${key} — ` +
          'same TAG + same salt = same period_start = scheduled-run identity collision',
        );
      }
      claimed.set(salt, `${suite}.${key}`);
    }
  }

  const bands = Object.entries(PAYROLL_PERIOD_YEAR_BANDS);
  for (let i = 0; i < bands.length; i++) {
    const [sa, [a0, a1]] = bands[i];
    if (a0 > a1) throw new Error(`PAYROLL_PERIOD_YEAR_BANDS: ${sa} band [${a0},${a1}] is inverted`);
    for (let j = i + 1; j < bands.length; j++) {
      const [sb, [b0, b1]] = bands[j];
      if (overlaps(a0, a1, b0, b1)) {
        throw new Error(
          `PAYROLL_PERIOD_YEAR_BANDS: ${sa} [${a0},${a1}] overlaps ${sb} [${b0},${b1}]`,
        );
      }
    }
  }

  for (const [salt, owner] of claimed) {
    const [s0, s1] = saltYearWindow(salt);
    for (const [suite, [b0, b1]] of bands) {
      if (overlaps(s0, s1, b0, b1)) {
        throw new Error(
          `payroll allocator: salt ${salt} (${owner}) year-window [${s0},${s1}] overlaps ` +
          `year band ${suite} [${b0},${b1}] — a salt-derived run could match a year-derived run`,
        );
      }
    }
  }

  return claimed;
}

assertPayrollPeriodAllocatorDisjoint();

export function payrollPeriod(suite, key, tag) {
  const salt = PAYROLL_PERIOD_SALTS[suite]?.[key];
  if (salt === undefined) {
    throw new Error(
      `payrollPeriod: no registered salt for ${suite}.${key} — claim one in PAYROLL_PERIOD_SALTS`,
    );
  }
  return seedDateFromTag(tag, salt);
}

/** Deterministic year in the suite's registered band. */
export function payrollPeriodYear(suite, tag) {
  const band = PAYROLL_PERIOD_YEAR_BANDS[suite];
  if (!band) {
    throw new Error(
      `payrollPeriodYear: no registered year band for ${suite} — add one to PAYROLL_PERIOD_YEAR_BANDS`,
    );
  }
  const [lo, hi] = band;
  let n = 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  return lo + (n % (hi - lo + 1));
}

export function payrollRunSeed({
  periodStart,
  periodEnd,
  periodMonth,
  runType = 'scheduled',
  payFrequency = 'monthly',
  sequenceNo = 1,
  ...row
}) {
  const start = periodStart ?? periodMonth;
  if (!start) throw new Error('payrollRunSeed requires periodStart or periodMonth');
  const end = periodEnd ?? payrollPeriodEnd(start, payFrequency);
  const payDate = row.pay_date ?? end;
  const contributionWeeks = payrollContributionWeeks(start, end)
    .reduce((sum, contributionPeriod) => sum + contributionPeriod.weeks, 0);
  return {
    period_month: monthStart(payDate),
    run_type: runType,
    period_start: start,
    period_end: end,
    sequence_no: sequenceNo,
    pay_frequency: payFrequency,
    pay_date: payDate,
    weeks_in_period: contributionWeeks,
    ...row,
  };
}
