// lib/finance/payroll/runCalendar.ts
// Payroll run calendar — derives scheduled pay-period instances from pay-group schedule
// definitions and links each instance to an existing run if one exists.
//
// Authority: docs/module-contracts/PAYROLL_RUNS_REGISTER_SLICE.md §Decisions 3
//
// Key design principle: instances come from the pay group's SCHEDULE (frequency, default_pay_day,
// default_cutoff_offset_days), NOT by scanning run rows. Runs only LINK to computed instances.
// This means the calendar shows ALL expected pay events, including ones with no run yet created.
//
// ── FREQUENCY CONVENTIONS (review-decision — isolated here for easy change) ──
//
//  monthly:
//    One period per calendar month: period = [1st, last day of month].
//    Pay date = default_pay_day (day-of-month, 1–31) clamped to the month's actual last day.
//    Example: default_pay_day=31, February → pay_date = Feb 28 (or 29 in a leap year).
//
//  semi_monthly:
//    Two periods per calendar month:
//      First  half: period = [1st, 15th],  pay_date = 15th of the month.
//      Second half: period = [16th, EOM],  pay_date = last day of the month.
//    The default_pay_day column is not used for semi_monthly (the dates are fixed by convention).
//
//  weekly:
//    One period per week, every 7 days.
//    default_pay_day is the weekday (JS convention: 0=Sun, 1=Mon, …, 6=Sat).
//    Period = the 7 days ending ON the pay date (i.e., period_start = pay_date − 6 days).
//    All occurrences of that weekday within the window are instances.
//
//  fortnightly:
//    One period per two weeks, every 14 days.
//    Same weekday convention as weekly.
//    Anchor: 2020-01-06 (Monday). The fortnightly schedule anchors off the first occurrence
//    of the group's default_pay_day on or after the anchor date.  All dates 14 days apart
//    from that anchor occurrence that fall within the window are instances.
//    Period = the 14 days ending ON the pay date.
//
// ── CUTOFF CONVENTION ──
//    cutoff_at = pay_date − default_cutoff_offset_days (null if offset is 0 or unset).
//    A cutoff of 0 offset means no cutoff — we return null for cutoffAt in that case.
//
// ── WINDOW CONSTRAINT ──
//    Server caps the window at 186 days (≈ 6 months). Wider requests → 400.

import { sb } from '../../db';
import type {
  PayrollRunCalendarRequest,
  PayrollRunCalendarResult,
  PayrollRunCalendarInstance,
  PayrollRunState,
} from '../../../../../types/payrollRuns';

// ── Date utilities ────────────────────────────────────────────────────────────

/** Parses a YYYY-MM-DD string into a UTC Date with no timezone drift risk. */
function parseDate(iso: string): Date {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw Object.assign(new Error(`Invalid date: "${iso}"`), { status: 400 });
  return d;
}

/** Formats a UTC Date as YYYY-MM-DD. */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Adds `n` days to a UTC Date (returns a new Date). */
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** Returns the last day of the UTC month containing `d`. */
function lastDayOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/**
 * Returns the first occurrence of `weekday` (0=Sun … 6=Sat) on or after `from`.
 * The JS weekday convention matches the schema comment on default_pay_day.
 */
function firstWeekdayOnOrAfter(from: Date, weekday: number): Date {
  const d = new Date(from);
  const diff = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

// ── Max window (server cap) ───────────────────────────────────────────────────

const MAX_WINDOW_DAYS = 186;

// ── Pure: compute scheduled instances for one pay group ──────────────────────

export interface PayGroupSchedule {
  id: string;
  name: string;
  frequency: 'weekly' | 'fortnightly' | 'semi_monthly' | 'monthly';
  default_pay_day: number | null;
  default_cutoff_offset_days: number;
}

export interface ScheduledInstance {
  key:        string;  // `${payGroupId}:${periodStart}:${periodEnd}`
  payGroupId: string;
  periodStart: Date;
  periodEnd:   Date;
  payDate:     Date;
  cutoffAt:    Date | null;
}

/**
 * Derive the expected pay-period instances for ONE pay group across [windowFrom, windowTo].
 * PURE: no DB access. Instances are derived solely from the schedule definition.
 * The windowFrom/windowTo dates are inclusive boundaries (UTC midnight).
 *
 * Convention is documented at the top of this file. This is the REVIEW DECISION isolated
 * here so the whole convention can be changed by modifying this one function.
 */
export function computeScheduledInstances(
  group: PayGroupSchedule,
  windowFrom: Date,
  windowTo: Date,
): ScheduledInstance[] {
  const instances: ScheduledInstance[] = [];
  const { id: payGroupId, frequency, default_pay_day: payDayField, default_cutoff_offset_days: cutoffOffset } = group;

  function makeInstance(periodStart: Date, periodEnd: Date, payDate: Date): ScheduledInstance {
    const cutoffAt = cutoffOffset > 0 ? addDays(payDate, -cutoffOffset) : null;
    return {
      key: `${payGroupId}:${fmtDate(periodStart)}:${fmtDate(periodEnd)}`,
      payGroupId,
      periodStart,
      periodEnd,
      payDate,
      cutoffAt,
    };
  }

  // An instance is "in window" if its payDate falls within [windowFrom, windowTo].
  // (We use payDate, not period, to match the register's window semantics.)
  function inWindow(payDate: Date): boolean {
    return payDate >= windowFrom && payDate <= windowTo;
  }

  switch (frequency) {

    case 'monthly': {
      // Enumerate calendar months that overlap [windowFrom, windowTo] by a reasonable margin.
      // Start from the month containing windowFrom, extend to the month containing windowTo.
      const startMonth = new Date(Date.UTC(windowFrom.getUTCFullYear(), windowFrom.getUTCMonth(), 1));
      const endMonth   = new Date(Date.UTC(windowTo.getUTCFullYear(), windowTo.getUTCMonth(), 1));

      for (let m = new Date(startMonth); m <= endMonth; m.setUTCMonth(m.getUTCMonth() + 1)) {
        const monthStart = new Date(m);
        const monthEnd   = lastDayOfMonth(monthStart);
        // Pay date = clamp default_pay_day to the month's actual length.
        const dayOfMonth = Math.max(1, Math.min(payDayField ?? 28, monthEnd.getUTCDate()));
        const payDate    = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), dayOfMonth));
        if (inWindow(payDate)) {
          instances.push(makeInstance(new Date(monthStart), new Date(monthEnd), payDate));
        }
      }
      break;
    }

    case 'semi_monthly': {
      // Two fixed periods per month: [1–15] pay 15th; [16–EOM] pay last day.
      const startMonth = new Date(Date.UTC(windowFrom.getUTCFullYear(), windowFrom.getUTCMonth(), 1));
      const endMonth   = new Date(Date.UTC(windowTo.getUTCFullYear(), windowTo.getUTCMonth(), 1));

      for (let m = new Date(startMonth); m <= endMonth; m.setUTCMonth(m.getUTCMonth() + 1)) {
        const year  = m.getUTCFullYear();
        const month = m.getUTCMonth();

        // First half: 1st – 15th, pay on 15th.
        const fhStart  = new Date(Date.UTC(year, month, 1));
        const fhEnd    = new Date(Date.UTC(year, month, 15));
        const fhPay    = new Date(Date.UTC(year, month, 15));
        if (inWindow(fhPay)) instances.push(makeInstance(fhStart, fhEnd, fhPay));

        // Second half: 16th – EOM, pay on last day of month.
        const shStart  = new Date(Date.UTC(year, month, 16));
        const shEnd    = lastDayOfMonth(shStart);
        const shPay    = new Date(shEnd);
        if (inWindow(shPay)) instances.push(makeInstance(shStart, new Date(shEnd), shPay));
      }
      break;
    }

    case 'weekly': {
      // All occurrences of `default_pay_day` weekday in [windowFrom, windowTo].
      // Period = 7 days ending ON pay date (period_start = pay_date − 6 days).
      const weekday = payDayField ?? 5; // default Friday if not configured
      let payDate = firstWeekdayOnOrAfter(windowFrom, weekday);
      while (payDate <= windowTo) {
        const periodStart = addDays(payDate, -6);
        const periodEnd   = new Date(payDate);
        instances.push(makeInstance(periodStart, periodEnd, new Date(payDate)));
        payDate = addDays(payDate, 7);
      }
      break;
    }

    case 'fortnightly': {
      // Every 14 days. Weekday = default_pay_day. Anchor = 2020-01-06 (Monday).
      // Find the first occurrence of the target weekday on or after the anchor, then
      // enumerate every 14 days. Period = 14 days ending ON pay date.
      const ANCHOR = new Date(Date.UTC(2020, 0, 6)); // 2020-01-06 (Monday)
      const weekday = payDayField ?? 5; // default Friday
      // First fortnightly pay date of this weekday on or after the anchor.
      const anchoredStart = firstWeekdayOnOrAfter(ANCHOR, weekday);
      // Advance until we reach or pass windowFrom.
      let payDate = new Date(anchoredStart);
      while (payDate < windowFrom) {
        payDate = addDays(payDate, 14);
      }
      // Now enumerate forward until past windowTo.
      while (payDate <= windowTo) {
        const periodStart = addDays(payDate, -13);
        const periodEnd   = new Date(payDate);
        instances.push(makeInstance(periodStart, periodEnd, new Date(payDate)));
        payDate = addDays(payDate, 14);
      }
      break;
    }
  }

  return instances;
}

// ── DB types ──────────────────────────────────────────────────────────────────

interface PayGroupRow {
  id: string;
  name: string;
  frequency: string;
  default_pay_day: number | null;
  default_cutoff_offset_days: number;
}

interface RunRow {
  id: string;
  run_no: string;
  status: string;
  pay_group_id: string | null;
  period_start: string;
  period_end: string;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Returns calendar instances derived from active pay groups' schedules, each
 * linked to an existing run for that (pay_group_id, period_start, period_end,
 * run_type='scheduled') if one exists (excluding cancelled runs).
 *
 * Window is capped at 186 days → 400 if wider.
 */
export async function getPayrollRunCalendar(
  req: PayrollRunCalendarRequest,
): Promise<PayrollRunCalendarResult> {
  const asOf = new Date().toISOString();

  // ── Validate window ────────────────────────────────────────────────────────
  const windowFrom = parseDate(req.from);
  const windowTo   = parseDate(req.to);
  if (windowTo < windowFrom) {
    throw Object.assign(new Error('Calendar window "to" must be on or after "from".'), { status: 400 });
  }
  const spanDays = Math.round((windowTo.getTime() - windowFrom.getTime()) / 86_400_000);
  if (spanDays > MAX_WINDOW_DAYS) {
    throw Object.assign(
      new Error(`Calendar window may not exceed ${MAX_WINDOW_DAYS} days (requested ${spanDays} days).`),
      { status: 400 },
    );
  }

  // ── Fetch active pay groups ───────────────────────────────────────────────
  let pgQuery = sb
    .from('finance_pay_groups')
    .select('id,name,frequency,default_pay_day,default_cutoff_offset_days')
    .eq('active', true);

  if (req.payGroupIds && req.payGroupIds.length > 0) {
    pgQuery = pgQuery.in('id', req.payGroupIds);
  }

  const { data: pgRows, error: pgErr } = await pgQuery;
  if (pgErr) throw Object.assign(new Error('getPayrollRunCalendar/pay-groups: ' + pgErr.message), { status: 500 });
  const payGroups = (pgRows ?? []) as PayGroupRow[];

  // ── Compute instances for each group ──────────────────────────────────────
  const rawInstances: ScheduledInstance[] = [];
  for (const pg of payGroups) {
    // Only supported frequencies proceed; unknown frequencies yield no instances.
    if (!['weekly', 'fortnightly', 'semi_monthly', 'monthly'].includes(pg.frequency)) continue;
    const schedule: PayGroupSchedule = {
      id:                          pg.id,
      name:                        pg.name,
      frequency:                   pg.frequency as PayGroupSchedule['frequency'],
      default_pay_day:             pg.default_pay_day,
      default_cutoff_offset_days:  pg.default_cutoff_offset_days,
    };
    rawInstances.push(...computeScheduledInstances(schedule, windowFrom, windowTo));
  }

  // ── Link existing scheduled runs to instances ─────────────────────────────
  // One query: fetch all scheduled (non-cancelled) runs for the relevant pay groups
  // that overlap the window. Match to instances by (pay_group_id, period_start, period_end).
  const pgIds = payGroups.map(p => p.id);
  const matchedRuns: RunRow[] = [];
  if (pgIds.length > 0) {
    const { data: runRows, error: runErr } = await sb
      .from('finance_payroll_runs')
      .select('id,run_no,status,pay_group_id,period_start,period_end')
      .in('pay_group_id', pgIds)
      .eq('run_type', 'scheduled')
      .neq('status', 'cancelled')
      .gte('period_end',   req.from) // period overlaps window
      .lte('period_start', req.to);
    if (runErr) throw Object.assign(new Error('getPayrollRunCalendar/runs: ' + runErr.message), { status: 500 });
    matchedRuns.push(...((runRows ?? []) as RunRow[]));
  }

  // Build index: `${payGroupId}:${periodStart}:${periodEnd}` → run
  const runByKey = new Map<string, RunRow>();
  for (const run of matchedRuns) {
    const key = `${run.pay_group_id ?? ''}:${run.period_start}:${run.period_end}`;
    runByKey.set(key, run);
  }

  // Build pay group name map
  const pgNameMap = new Map(payGroups.map(pg => [pg.id, { name: pg.name, frequency: pg.frequency }]));

  // ── Map to PayrollRunCalendarInstance ─────────────────────────────────────
  const instances: PayrollRunCalendarInstance[] = rawInstances.map(inst => {
    const linkedRun = runByKey.get(inst.key);
    const pgInfo    = pgNameMap.get(inst.payGroupId);
    return {
      key:      inst.key,
      payGroup: {
        id:        inst.payGroupId,
        name:      pgInfo?.name ?? '',
        frequency: pgInfo?.frequency ?? '',
      },
      period: {
        startsOn: fmtDate(inst.periodStart),
        endsOn:   fmtDate(inst.periodEnd),
      },
      payDate:  fmtDate(inst.payDate),
      cutoffAt: inst.cutoffAt ? fmtDate(inst.cutoffAt) : null,
      run: linkedRun
        ? { id: linkedRun.id, reference: linkedRun.run_no, state: linkedRun.status as PayrollRunState }
        : null,
    };
  });

  // Sort instances by pay date ascending for a natural calendar order.
  instances.sort((a, b) => {
    if (a.payDate < b.payDate) return -1;
    if (a.payDate > b.payDate) return 1;
    return a.payGroup.id.localeCompare(b.payGroup.id);
  });

  return {
    window: { from: req.from, to: req.to },
    instances,
    asOf,
  };
}
