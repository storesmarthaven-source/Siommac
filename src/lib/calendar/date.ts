/**
 * src/lib/calendar/date.ts
 *
 * Local-date helpers for the Calendar. The golden rule: a calendar day is a LOCAL
 * wall-clock day. Never build a date with `new Date('YYYY-MM-DD')` (parsed as UTC
 * midnight → shifts a day behind in western timezones) and never derive a date key
 * with `.toISOString().slice(0,10)` (UTC again). Use these helpers instead.
 */

export type DateKey = string;   // 'YYYY-MM-DD'

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → a Date at LOCAL midnight (no UTC shift). */
export function parseLocalDate(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/** A Date → its LOCAL 'YYYY-MM-DD' key (reads local fields, not UTC). */
export function toLocalDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The date part of an ISO timestamp string, kept as-is ('2026-01-05T…' → '2026-01-05'). */
export function isoDateKey(iso: string): DateKey {
  return iso.slice(0, 10);
}

/** The local date key an item falls on (all-day → startsOn; timed → local date of startsAt). */
export function itemDateKey(item: { allDay: boolean; startsOn: string | null; startsAt: string | null; occurrenceDate?: string | null }): DateKey | null {
  if (item.occurrenceDate) return item.occurrenceDate;
  if (item.allDay) return item.startsOn;
  if (item.startsAt) return toLocalDateKey(new Date(item.startsAt));
  return null;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(d: Date): boolean { return sameDay(d, new Date()); }

/**
 * The 6×7 grid of days for a month view (weeks start Sunday), including the
 * trailing/leading days of the adjacent months so the grid is always full.
 */
export function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const start = addDays(first, -first.getDay());   // back to the Sunday on/before the 1st
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The 7 days of the week (Sunday-start) containing `d`. */
export function weekDays(d: Date): Date[] {
  const start = addDays(d, -d.getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// ── Formatting ────────────────────────────────────────────────────────────────

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(d: Date): string { return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`; }
export function weekdayShort(d: Date): string { return WEEKDAYS_SHORT[d.getDay()]!; }

/** 'Thursday, 8 May 2025' */
export function longDayLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** '10:00 AM' from an ISO timestamp. */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Duration in minutes between two ISO timestamps, or null. */
export function durationMinutes(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

/** Is a dated item overdue? (task, past its day, not done/cancelled). Derived, never stored. */
export function isOverdue(item: { type: string; status: string | null; allDay: boolean; startsOn: string | null; startsAt: string | null; occurrenceDate?: string | null }): boolean {
  if (item.type !== 'task' && item.type !== 'deadline') return false;
  if (item.status === 'done' || item.status === 'cancelled') return false;
  const key = itemDateKey(item);
  if (!key) return false;
  return parseLocalDate(key) < parseLocalDate(toLocalDateKey(new Date()));
}
