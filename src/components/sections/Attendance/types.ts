/**
 * src/components/sections/Attendance/types.ts
 *
 * Domain types for the Attendance section.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

// ── Core row ──────────────────────────────────────────────────────────────────

export interface AttendanceRow {
  username:    string;
  name:        string;
  department:  string;
  date:        string;
  checkIn:     string | null;
  checkOut:    string | null;
  hours:       number;
  status:      'Present' | 'Late' | 'Absent';
}

// ── Aggregate stats ───────────────────────────────────────────────────────────

export interface AttendanceStats {
  present: number;
  late:    number;
  absent:  number;
  rate:    number;
}

// ── Chart data ────────────────────────────────────────────────────────────────

export interface DailyTrend {
  date:    string;
  present: number;
  late:    number;
  absent:  number;
}

// ── Date range ────────────────────────────────────────────────────────────────

export interface DateRange {
  start: string;
  end:   string;
  days:  number;
}

// ── Top-level response payload ────────────────────────────────────────────────

export interface AttendanceData {
  rows:        AttendanceRow[];
  stats:       AttendanceStats | null;
  dailyTrend:  DailyTrend[];
  dateRange:   DateRange | null;
}

// ── Per-employee consistency summary ─────────────────────────────────────────

export interface ConsistencyRow {
  username:        string;
  name:            string;
  department:      string;
  presentDays:     number;
  lateDays:        number;
  absentDays:      number;
  attendanceRate:  number;
  avgHours:        number;
}

// ── Filter mode ───────────────────────────────────────────────────────────────

export type FilterMode = 'month' | 'range';

export interface MonthFilter {
  month: number;
  year:  number;
}

export interface RangeFilter {
  dateFrom: string;
  dateTo:   string;
}
