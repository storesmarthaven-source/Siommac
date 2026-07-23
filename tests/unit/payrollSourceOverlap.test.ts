/**
 * P1-9 (payroll certification WP-5) — boundary tests for the canonical
 * source-period overlap resolver shared by input readiness and lock
 * preparation. Doc-required cases: exact start/end boundaries, spanning rows,
 * adjacent non-overlap, overnight/short periods, and month/year (day-boundary)
 * string-comparison correctness for the TZ-less YYYY-MM-DD domain format.
 */
import {
  sourcePeriodOverlaps,
  filterSourcePeriodOverlap,
} from '../../netlify/functions/lib/finance/payroll/sourceOverlap';

const P_START = '2026-07-01';
const P_END   = '2026-07-31';

describe('sourcePeriodOverlaps (canonical overlap semantics)', () => {
  it('includes a source fully inside the payroll period', () => {
    expect(sourcePeriodOverlaps('2026-07-06', '2026-07-12', P_START, P_END)).toBe(true);
  });

  it('includes a SPANNING source that starts before the period but overlaps it (the P1-9 defect case)', () => {
    expect(sourcePeriodOverlaps('2026-06-29', '2026-07-05', P_START, P_END)).toBe(true);
  });

  it('includes a source that starts inside and ends after the period', () => {
    expect(sourcePeriodOverlaps('2026-07-27', '2026-08-02', P_START, P_END)).toBe(true);
  });

  it('includes a source that fully encloses the payroll period', () => {
    expect(sourcePeriodOverlaps('2026-06-01', '2026-08-31', P_START, P_END)).toBe(true);
  });

  it('exact END boundary: a source ending ON period start is in scope (inclusive)', () => {
    expect(sourcePeriodOverlaps('2026-06-22', '2026-07-01', P_START, P_END)).toBe(true);
  });

  it('exact START boundary: a source starting ON period end is in scope (inclusive)', () => {
    expect(sourcePeriodOverlaps('2026-07-31', '2026-08-06', P_START, P_END)).toBe(true);
  });

  it('adjacent BEFORE (ends the day before period start) does NOT overlap', () => {
    expect(sourcePeriodOverlaps('2026-06-22', '2026-06-30', P_START, P_END)).toBe(false);
  });

  it('adjacent AFTER (starts the day after period end) does NOT overlap', () => {
    expect(sourcePeriodOverlaps('2026-08-01', '2026-08-07', P_START, P_END)).toBe(false);
  });

  it('overnight/single-day source on the boundary is in scope', () => {
    expect(sourcePeriodOverlaps('2026-07-01', '2026-07-01', P_START, P_END)).toBe(true);
    expect(sourcePeriodOverlaps('2026-06-30', '2026-06-30', P_START, P_END)).toBe(false);
  });

  it('month and year day-boundaries compare correctly as YYYY-MM-DD strings', () => {
    // Dec → Jan year boundary
    expect(sourcePeriodOverlaps('2025-12-29', '2026-01-04', '2026-01-01', '2026-01-31')).toBe(true);
    expect(sourcePeriodOverlaps('2025-12-01', '2025-12-31', '2026-01-01', '2026-01-31')).toBe(false);
    // 28/29-day February boundary
    expect(sourcePeriodOverlaps('2026-02-23', '2026-03-01', '2026-03-01', '2026-03-31')).toBe(true);
  });
});

describe('filterSourcePeriodOverlap (query construction)', () => {
  it('builds EXACTLY the canonical condition: start<=periodEnd AND end>=periodStart', () => {
    const calls: [string, string, string][] = [];
    interface FakeQ { lte(c: string, v: string): FakeQ; gte(c: string, v: string): FakeQ }
    const fake: FakeQ = {
      lte(c, v) { calls.push(['lte', c, v]); return this; },
      gte(c, v) { calls.push(['gte', c, v]); return this; },
    };
    const out = filterSourcePeriodOverlap(fake, 'period_start', 'period_end', P_START, P_END);
    expect(out).toBe(fake);
    expect(calls).toEqual([
      ['lte', 'period_start', P_END],
      ['gte', 'period_end', P_START],
    ]);
  });
});
