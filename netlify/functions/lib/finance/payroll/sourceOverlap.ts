/**
 * P1-9 (payroll certification WP-5) — the ONE canonical source-period overlap
 * resolver, shared by input READINESS and LOCK preparation so they can never
 * diverge. Overlap semantics (doc §4 P1-9):
 *
 *     source.period_start <= payroll.period_end
 *     AND source.period_end >= payroll.period_start
 *
 * An approved source row that starts before the payroll period but overlaps it
 * (e.g. a spanning timesheet) is IN SCOPE; adjacent non-overlapping rows are not.
 * All values are calendar-date strings (YYYY-MM-DD) in the payroll operating
 * timezone (America/Port_of_Spain; dates carry no TZ) — lexicographic comparison
 * is exact for this format, including month/year boundaries.
 *
 * Pure module: no imports, so boundary behavior is unit-testable without env.
 */

/** True when [sourceStart, sourceEnd] overlaps [payrollStart, payrollEnd] (inclusive). */
export function sourcePeriodOverlaps(
  sourceStart: string,
  sourceEnd: string,
  payrollStart: string,
  payrollEnd: string,
): boolean {
  return sourceStart <= payrollEnd && sourceEnd >= payrollStart;
}

/** Minimal structural slice of a PostgREST filter builder. */
interface OverlapFilterable<T> {
  lte(column: string, value: string): T;
  gte(column: string, value: string): T;
}

/**
 * Apply the canonical overlap filter to a PostgREST query. Readiness and lock
 * MUST both build their period condition through this function (never inline
 * gte/lte on the start column alone).
 */
export function filterSourcePeriodOverlap<T extends OverlapFilterable<T>>(
  q: T,
  startColumn: string,
  endColumn: string,
  payrollStart: string,
  payrollEnd: string,
): T {
  return q.lte(startColumn, payrollEnd).gte(endColumn, payrollStart);
}
