/**
 * src/components/sections/Attendance/utils.ts
 *
 * Pure utility functions for the Attendance section.
 * No side-effects, no imports from Preact.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import type { AttendanceRow, ConsistencyRow, DateRange } from './types';

// ── Date / time formatting ────────────────────────────────────────────────────

/**
 * Format an ISO datetime string (or null) to "9:30 AM" style.
 * Returns '—' if the value is null, undefined, or empty.
 */
export function fmtLocalTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return '—';
  }
}

/**
 * Format a YYYY-MM-DD string to "Jan 15" style.
 */
export function fmtDate(iso: string): string {
  try {
    // Parse as local date to avoid UTC-offset day shifts
    const [year, month, day] = iso.split('-').map(Number);
    const d = new Date(year!, (month ?? 1) - 1, day ?? 1);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// ── Month / year helpers ──────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Convert a 0-indexed month number to its full English name.
 */
export function getMonthName(monthIndex: number): string {
  return MONTH_NAMES[monthIndex] ?? 'January';
}

/**
 * Returns the current year and 4 prior years, descending.
 */
export function getYearOptions(): number[] {
  const cur = new Date().getFullYear();
  return [cur, cur - 1, cur - 2, cur - 3, cur - 4];
}

/**
 * 0-indexed current month (0 = January).
 */
export function currentMonth(): number {
  return new Date().getMonth();
}

/**
 * Current calendar year.
 */
export function currentYear(): number {
  return new Date().getFullYear();
}

// ── Status colour helpers ─────────────────────────────────────────────────────

const STATUS_COLOR: Record<'Present' | 'Late' | 'Absent', string> = {
  Present: '#2E7D32',
  Late:    '#FFB712',
  Absent:  '#E40C0C',
};

const STATUS_BG_COLOR: Record<'Present' | 'Late' | 'Absent', string> = {
  Present: '#E8F5E9',
  Late:    '#FFF8E1',
  Absent:  '#FFEBEE',
};

/**
 * Foreground hex colour for a status value.
 */
export function statusColor(status: 'Present' | 'Late' | 'Absent'): string {
  return STATUS_COLOR[status];
}

/**
 * Light background hex colour for a status value.
 */
export function statusBgColor(status: 'Present' | 'Late' | 'Absent'): string {
  return STATUS_BG_COLOR[status];
}

/**
 * Colour for an attendance rate percentage.
 * Green ≥80, amber ≥50, red <50.
 */
export function rateColor(rate: number): string {
  if (rate >= 80) return '#2E7D32';
  if (rate >= 50) return '#F59E0B';
  return '#E40C0C';
}

// ── Per-employee consistency computation ──────────────────────────────────────

/**
 * Build per-employee ConsistencyRow objects from raw attendance rows.
 * Mirrors the logic in the legacy _openAttEmpPanel helper.
 *
 * @param rows      - Full set of attendance rows for the period
 * @param dateRange - Optional date range; used to compute total working days
 */
export function buildConsistencyFromRows(
  rows: AttendanceRow[],
  dateRange: DateRange | null,
): ConsistencyRow[] {
  // Group rows by username
  const byUser = new Map<string, AttendanceRow[]>();
  for (const row of rows) {
    const existing = byUser.get(row.username);
    if (existing) {
      existing.push(row);
    } else {
      byUser.set(row.username, [row]);
    }
  }

  const totalDays = dateRange?.days ?? 0;

  const result: ConsistencyRow[] = [];

  for (const [username, userRows] of byUser) {
    const firstRow = userRows[0];
    if (!firstRow) continue;

    let presentDays = 0;
    let lateDays    = 0;
    let absentDays  = 0;
    let totalHours  = 0;

    for (const row of userRows) {
      if (row.status === 'Present') presentDays++;
      else if (row.status === 'Late') lateDays++;
      else absentDays++;

      totalHours += row.hours;
    }

    // Working days denominator: use dateRange.days if available, else count unique dates
    const workingDays = totalDays > 0
      ? totalDays
      : new Set(userRows.map((r) => r.date)).size;

    const attendedDays    = presentDays + lateDays;
    const attendanceRate  = workingDays > 0
      ? Math.round((attendedDays / workingDays) * 100)
      : 0;

    const avgHours = attendedDays > 0
      ? Math.round((totalHours / attendedDays) * 10) / 10
      : 0;

    result.push({
      username,
      name:           firstRow.name,
      department:     firstRow.department,
      presentDays,
      lateDays,
      absentDays,
      attendanceRate,
      avgHours,
    });
  }

  // Sort by name ascending
  result.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}
