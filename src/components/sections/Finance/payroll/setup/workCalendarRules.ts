// Pure, DOM-free validation + shaping logic for the Work Calendar (F-CAL) admin UI. Kept separate
// from the component so it is unit-testable in isolation (mirrors payPolicyRules.ts). Every rule
// here mirrors a real backend constraint — it is a courtesy inline check, never the sole gate.
import type { HolidayType } from '../../../../../../types/workCalendars';

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_LABEL: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
export const WEEKDAY_FULL: Record<number, string> = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };
export const HOLIDAY_TYPES: readonly HolidayType[] = ['statutory', 'proclaimed', 'movable'];
export const DEFAULT_TZ = 'America/Port_of_Spain';

const isoDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export interface VersionWindow { from: string; to: string | null }
const inWindow = (d: string, w?: VersionWindow): boolean => {
  if (!w || !isoDate(d)) return true;
  if (d < w.from) return false;
  if (w.to && d > w.to) return false;
  return true;
};

// ── Holiday provenance form (contract §4.2 / §9.1 — all fields required) ───────
export interface HolidayFormState {
  holidayDate: string; observedDate: string; dayFraction: string;
  nameStatutory: string; nameCommon: string; holidayType: HolidayType | '';
  sourceReference: string; sourcePublishedDate: string; provenanceNote: string;
}
export const emptyHolidayForm = (): HolidayFormState => ({
  holidayDate: '', observedDate: '', dayFraction: '', nameStatutory: '', nameCommon: '',
  holidayType: '', sourceReference: '', sourcePublishedDate: '', provenanceNote: '',
});

export function holidayFieldErrors(f: HolidayFormState, window?: VersionWindow): Partial<Record<keyof HolidayFormState, string>> {
  const e: Partial<Record<keyof HolidayFormState, string>> = {};
  if (!f.holidayDate) e.holidayDate = 'Holiday date is required.';
  else if (!isoDate(f.holidayDate)) e.holidayDate = 'Enter a valid date (YYYY-MM-DD).';
  else if (!inWindow(f.holidayDate, window)) e.holidayDate = 'Date is outside the version’s effective window.';
  if (f.observedDate) {
    if (!isoDate(f.observedDate)) e.observedDate = 'Enter a valid date (YYYY-MM-DD).';
    else if (!inWindow(f.observedDate, window)) e.observedDate = 'Observed date is outside the version’s effective window.';
  }
  if (f.dayFraction) {
    const n = Number(f.dayFraction);
    if (!Number.isFinite(n) || n <= 0 || n > 1) e.dayFraction = 'Day fraction must be greater than 0 and at most 1.';
  }
  if (!f.nameStatutory.trim()) e.nameStatutory = 'Statutory name is required.';
  if (!f.nameCommon.trim()) e.nameCommon = 'Common name is required.';
  if (!f.holidayType) e.holidayType = 'Select a holiday type.';
  if (!f.sourceReference.trim()) e.sourceReference = 'Source reference is required.';
  if (!f.sourcePublishedDate) e.sourcePublishedDate = 'Source publication date is required.';
  else if (!isoDate(f.sourcePublishedDate)) e.sourcePublishedDate = 'Enter a valid date (YYYY-MM-DD).';
  if (!f.provenanceNote.trim()) e.provenanceNote = 'A provenance note is required.';
  return e;
}
export const holidayFormValid = (f: HolidayFormState, window?: VersionWindow): boolean =>
  Object.keys(holidayFieldErrors(f, window)).length === 0;

// Shape a valid provenance form into the HolidayInput the command expects.
export function toHolidayInput(f: HolidayFormState): {
  holidayDate: string; observedDate?: string; dayFraction?: number;
  nameStatutory: string; nameCommon: string; holidayType: HolidayType;
  sourceReference: string; sourcePublishedDate: string; provenanceNote: string;
} {
  return {
    holidayDate: f.holidayDate,
    ...(f.observedDate ? { observedDate: f.observedDate } : {}),
    ...(f.dayFraction ? { dayFraction: Number(f.dayFraction) } : {}),
    nameStatutory: f.nameStatutory.trim(), nameCommon: f.nameCommon.trim(),
    holidayType: f.holidayType as HolidayType,
    sourceReference: f.sourceReference.trim(), sourcePublishedDate: f.sourcePublishedDate,
    provenanceNote: f.provenanceNote.trim(),
  };
}

// ── Work-calendar pattern form (contract §4.3 — no preselected weekdays) ───────
export interface PatternFormState {
  weekdays: number[];                    // ISO 1..7, chosen explicitly — starts empty
  fractions: Record<string, string>;     // ISO-weekday key -> partial-day text (blank = full day)
  holidayCalendarVersionId: string;
}
export const emptyPatternForm = (): PatternFormState => ({ weekdays: [], fractions: {}, holidayCalendarVersionId: '' });

export interface PatternErrors { weekdays?: string; fractions?: string; holiday?: string }
export function patternFieldErrors(p: PatternFormState, opts: { requireHoliday?: boolean } = {}): PatternErrors {
  const e: PatternErrors = {};
  if (!p.weekdays.length) e.weekdays = 'Select at least one working weekday.';
  for (const iso of p.weekdays) {
    const raw = p.fractions[String(iso)];
    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n >= 1) {
        e.fractions = 'Partial-day fractions must be greater than 0 and less than 1 (leave blank for a full day).';
        break;
      }
    }
  }
  if (opts.requireHoliday && !p.holidayCalendarVersionId) e.holiday = 'Select a published holiday set version.';
  return e;
}
export const patternFormValid = (p: PatternFormState, opts: { requireHoliday?: boolean } = {}): boolean =>
  Object.keys(patternFieldErrors(p, opts)).length === 0;

// Build the weekday_fractions map the command expects — only explicit valid partials (0<f<1) for
// selected weekdays are included; a blank fraction means a full working day and is omitted.
export function buildWeekdayFractions(p: PatternFormState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const iso of p.weekdays) {
    const raw = p.fractions[String(iso)];
    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && n < 1) out[String(iso)] = n;
    }
  }
  return out;
}
export const sortedWeekdays = (w: number[]): number[] => [...new Set(w)].sort((a, b) => a - b);

// ── Period / resolve input ────────────────────────────────────────────────────
export function periodError(start: string, end: string): string | null {
  if (!start || !end) return 'Both period dates are required.';
  if (!isoDate(start) || !isoDate(end)) return 'Enter valid dates (YYYY-MM-DD).';
  if (start > end) return 'The start date must be on or before the end date.';
  return null;
}

// An assignment window must fall entirely within the referenced version's effective window
// (mirrors the DB containment check → calendar.assignment_window_uncovered). Returns inline copy.
export function assignmentWindowError(from: string, to: string, window: VersionWindow | null): string | null {
  if (!window) return null;
  if (from && from < window.from) return 'The assignment must start on or after the version’s effective-from date.';
  if (window.to) {
    if (!to) return 'This version ends, so the assignment needs an effective-to date within its window.';
    if (to > window.to) return 'The assignment must end on or before the version’s effective-to date.';
  }
  return null;
}

// ── Effective-window form (create/copy a version) ─────────────────────────────
export function effectiveError(from: string, to: string): string | null {
  if (!from) return 'Effective-from date is required.';
  if (!isoDate(from)) return 'Enter a valid effective-from date (YYYY-MM-DD).';
  if (to) {
    if (!isoDate(to)) return 'Enter a valid effective-to date (YYYY-MM-DD).';
    if (to < from) return 'Effective-to cannot be before effective-from.';
  }
  return null;
}

// ── Typed backend failure codes → friendly, actionable inline copy ────────────
export const FRIENDLY_ERROR: Record<string, string> = {
  'calendar.assignment_overlap': 'This overlaps an existing active assignment for the same scope. End or cancel the current one first, or choose a non-overlapping window.',
  'calendar.assignment_window_uncovered': 'The assignment window extends beyond the selected version’s effective window. Narrow the dates or pick a version that covers them.',
  'calendar.version_unpublished': 'Only a published work-calendar version can be assigned.',
  'calendar.holiday_exists': 'A holiday with the same actual or observed date already exists in this version.',
  'calendar.version_immutable': 'This version is published and can no longer be edited. Copy it to a new draft to make changes.',
  'calendar.holiday_set_empty': 'Add at least one holiday before publishing this version.',
  'calendar.holiday_set_unpublished': 'Publish the referenced holiday set version before publishing this work calendar.',
  'calendar.jurisdiction_mismatch': 'The holiday set’s jurisdiction does not match the pay group’s statutory country.',
  'calendar.jurisdiction_frozen': 'The jurisdiction cannot change once a version has been published.',
  'calendar.split_period': 'No single assignment covers the whole period — a higher-priority assignment intersects only part of it, so resolution fails closed rather than falling back.',
  'calendar.unresolved': 'No active assignment covers this period for the selected pay group.',
  'calendar.version_period_uncovered': 'The resolved version does not cover the entire requested period.',
  'calendar.invalid_period': 'The start date must be on or before the end date.',
  'calendar.invalid_pattern': 'The weekday pattern or fractional-day map is invalid.',
  'calendar.invalid_holiday': 'The holiday day-fraction or type is invalid.',
  'calendar.assignment_not_active': 'This assignment is already ended or cancelled.',
  'stale_lock_version': 'This record changed since you loaded it. Refresh and try again.',
  'command.payload_conflict': 'A different request already used this idempotency key. Retry to generate a fresh one.',
};
export const friendlyError = (msg: string | null | undefined): string =>
  (msg && FRIENDLY_ERROR[msg]) || msg || 'The request could not be completed.';
