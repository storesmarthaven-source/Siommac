/**
 * netlify/functions/lib/calendarRecurrence.ts
 *
 * Server-side recurrence expansion for calendar_entries masters (RRULE via
 * `rrule`). We expand ONLY within a requested date window — never unboundedly,
 * never persisting every occurrence — and merge per-occurrence exceptions
 * (cancel / modify) from calendar_recurrence_exceptions.
 *
 * The UTC-shift gotcha: rrule is timezone-naive. If DTSTART is built with
 * `Date.UTC(...)`, `.between()` returns Date objects whose UTC fields ARE the
 * occurrence's naive wall-clock. So we read local date keys off the UTC fields
 * (getUTCFullYear/Month/Date) — never `.toISOString().slice(0,10)` on a local
 * Date, which would drift a day near midnight.
 *
 * Semantics (v1): a recurring item repeats its WALL-CLOCK time. For all-day
 * items each occurrence is an all-day item on the occurrence date; for timed
 * items each occurrence keeps the master's time-of-day + offset (we swap only
 * the calendar date, preserving the `T…` suffix), so "every Monday 14:00" stays
 * 14:00 across the series.
 */

import { RRule, rrulestr } from 'rrule';

export interface RecurrenceMaster {
  id:                 string;
  allDay:             boolean;
  startsOn:           string | null;   // 'YYYY-MM-DD'
  endsOn:             string | null;
  startsAt:           string | null;   // ISO
  endsAt:             string | null;
  recurrenceRule:     string;          // RRULE (no leading DTSTART)
  recurrenceSeriesId: string | null;
}

export interface OccurrenceException {
  occurrenceDate:      string;         // 'YYYY-MM-DD'
  exceptionType:       'cancelled' | 'modified';
  replacementTitle?:   string | null;
  replacementNotes?:   string | null;
  replacementAllDay?:  boolean | null;
  replacementStartsOn?: string | null;
  replacementEndsOn?:  string | null;
  replacementStartsAt?: string | null;
  replacementEndsAt?:  string | null;
  replacementStatus?:  string | null;
}

/** One concrete occurrence produced by expansion (already exception-merged). */
export interface ExpandedOccurrence {
  occurrenceDate: string;              // 'YYYY-MM-DD' — the series slot
  allDay:         boolean;
  startsOn:       string | null;
  endsOn:         string | null;
  startsAt:       string | null;
  endsAt:         string | null;
  modified:       boolean;             // came from a 'modified' exception
  overrideTitle?: string | null;
  overrideNotes?: string | null;
  overrideStatus?: string | null;
}

// ── local-date helpers (naive; no tz) ───────────────────────────────────────

/** 'YYYY-MM-DD' → {y,m,d} (1-based month). */
function parseDateKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** A UTC Date whose UTC fields hold the given naive local Y/M/D[/H/M]. */
function naiveUtc(y: number, m: number, d: number, hh = 0, mi = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mi, 0, 0));
}

/** Local date key from a naive-UTC Date (reads UTC fields, not local). */
function dateKeyFromNaiveUtc(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The date portion ('YYYY-MM-DD') of the master's start, for DTSTART. */
function masterStartKey(master: RecurrenceMaster): string | null {
  if (master.allDay) return master.startsOn;
  return master.startsAt ? isoDatePart(master.startsAt) : null;
}

/** 'YYYY-MM-DD' out of an ISO timestamp string (the stored date part). */
function isoDatePart(iso: string): string {
  return iso.slice(0, 10);
}

/** The 'T…' time+offset suffix of an ISO timestamp ('T14:00:00+00:00'). */
function isoTimeSuffix(iso: string): string {
  const t = iso.indexOf('T');
  return t >= 0 ? iso.slice(t) : 'T00:00:00';
}

/** Swap the date of an ISO timestamp to `dateKey`, preserving time+offset. */
function withDate(iso: string, dateKey: string): string {
  return `${dateKey}${isoTimeSuffix(iso)}`;
}

/** Whole-day span (in days) between two date keys, for preserving duration. */
function dayDelta(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  const ms = naiveUtc(b.y, b.m, b.d).getTime() - naiveUtc(a.y, a.m, a.d).getTime();
  return Math.round(ms / 86_400_000);
}

/** Add N days to a date key. */
function addDaysKey(key: string, n: number): string {
  const { y, m, d } = parseDateKey(key);
  return dateKeyFromNaiveUtc(new Date(naiveUtc(y, m, d).getTime() + n * 86_400_000));
}

// ── expansion ───────────────────────────────────────────────────────────────

/**
 * Expand a recurrence master within [fromKey, toKey] (inclusive local date
 * keys), applying exceptions. Returns concrete occurrences, cancelled ones
 * dropped, modified ones overlaid.
 */
export function expandRecurrence(
  master:     RecurrenceMaster,
  fromKey:    string,
  toKey:      string,
  exceptions: OccurrenceException[],
): ExpandedOccurrence[] {
  const startKey = masterStartKey(master);
  if (!startKey) return [];

  // Build a DTSTART-anchored rule in naive-UTC space.
  const s = parseDateKey(startKey);
  const dtstart = naiveUtc(s.y, s.m, s.d);
  let rule: RRule;
  try {
    const parsed = rrulestr(
      master.recurrenceRule.startsWith('RRULE:') ? master.recurrenceRule : `RRULE:${master.recurrenceRule}`,
      { dtstart },
    );
    rule = parsed instanceof RRule ? parsed : new RRule({ ...RRule.parseString(master.recurrenceRule), dtstart });
  } catch {
    return [];
  }

  const from = parseDateKey(fromKey);
  const to   = parseDateKey(toKey);
  const after  = naiveUtc(from.y, from.m, from.d, 0, 0);
  const before = naiveUtc(to.y, to.m, to.d, 23, 59);

  const exByDate = new Map(exceptions.map(e => [e.occurrenceDate, e]));

  // Duration to preserve across occurrences.
  const spanDays = master.allDay && master.startsOn && master.endsOn
    ? dayDelta(master.startsOn, master.endsOn)
    : 0;

  const out: ExpandedOccurrence[] = [];
  for (const dt of rule.between(after, before, true)) {
    const occKey = dateKeyFromNaiveUtc(dt);
    const ex = exByDate.get(occKey);

    if (ex?.exceptionType === 'cancelled') continue;

    if (ex?.exceptionType === 'modified') {
      const allDay = ex.replacementAllDay ?? master.allDay;
      out.push({
        occurrenceDate: occKey,
        allDay,
        startsOn: allDay ? (ex.replacementStartsOn ?? occKey) : null,
        endsOn:   allDay ? (ex.replacementEndsOn   ?? (spanDays ? addDaysKey(occKey, spanDays) : occKey)) : null,
        startsAt: !allDay ? (ex.replacementStartsAt ?? (master.startsAt ? withDate(master.startsAt, occKey) : null)) : null,
        endsAt:   !allDay ? (ex.replacementEndsAt   ?? (master.endsAt   ? withDate(master.endsAt,   occKey) : null)) : null,
        modified: true,
        overrideTitle:  ex.replacementTitle ?? null,
        overrideNotes:  ex.replacementNotes ?? null,
        overrideStatus: ex.replacementStatus ?? null,
      });
      continue;
    }

    out.push({
      occurrenceDate: occKey,
      allDay: master.allDay,
      startsOn: master.allDay ? occKey : null,
      endsOn:   master.allDay ? (spanDays ? addDaysKey(occKey, spanDays) : occKey) : null,
      startsAt: !master.allDay && master.startsAt ? withDate(master.startsAt, occKey) : null,
      endsAt:   !master.allDay && master.endsAt   ? withDate(master.endsAt,   occKey) : null,
      modified: false,
    });
  }
  return out;
}

/** Validate an RRULE string (used on create/update). Returns null if valid, else a message. */
export function validateRrule(rule: string): string | null {
  try {
    rrulestr(rule.startsWith('RRULE:') ? rule : `RRULE:${rule}`, { dtstart: naiveUtc(2000, 1, 1) });
    return null;
  } catch {
    return 'Invalid recurrence rule.';
  }
}
