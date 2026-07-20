// Pure validation/shaping rules for the Work Calendar admin UI. Mirrors real backend constraints;
// these are the courtesy inline gates the modal buttons enforce (contract §13, UT-CAL-U2/U3).
import { describe, it, expect } from 'vitest';
import {
  emptyHolidayForm, holidayFieldErrors, holidayFormValid, toHolidayInput,
  emptyPatternForm, patternFieldErrors, patternFormValid, buildWeekdayFractions, sortedWeekdays,
  periodError, effectiveError, assignmentWindowError, friendlyError, FRIENDLY_ERROR, type HolidayFormState,
} from './workCalendarRules';

const fullHoliday = (): HolidayFormState => ({
  holidayDate: '2026-01-01', observedDate: '', dayFraction: '',
  nameStatutory: 'New Year’s Day', nameCommon: 'New Year', holidayType: 'statutory',
  sourceReference: 'Public Holidays Act', sourcePublishedDate: '2025-12-01', provenanceNote: 'Statutory annual holiday.',
});

describe('holiday provenance rules (UT-CAL-U2)', () => {
  it('an empty form is invalid and flags every required provenance field', () => {
    const e = holidayFieldErrors(emptyHolidayForm());
    for (const k of ['holidayDate', 'nameStatutory', 'nameCommon', 'holidayType', 'sourceReference', 'sourcePublishedDate', 'provenanceNote'] as const) {
      expect(e[k]).toBeTruthy();
    }
    expect(holidayFormValid(emptyHolidayForm())).toBe(false);
  });

  it('a complete provenance form is valid', () => {
    expect(holidayFormValid(fullHoliday())).toBe(true);
    expect(holidayFieldErrors(fullHoliday())).toEqual({});
  });

  it('rejects a day fraction outside (0, 1]', () => {
    expect(holidayFieldErrors({ ...fullHoliday(), dayFraction: '0' }).dayFraction).toBeTruthy();
    expect(holidayFieldErrors({ ...fullHoliday(), dayFraction: '1.5' }).dayFraction).toBeTruthy();
    expect(holidayFieldErrors({ ...fullHoliday(), dayFraction: '0.5' }).dayFraction).toBeUndefined();
  });

  it('rejects a holiday date outside the version’s effective window', () => {
    const w = { from: '2026-01-01', to: '2026-12-31' };
    expect(holidayFieldErrors({ ...fullHoliday(), holidayDate: '2025-12-31' }, w).holidayDate).toBeTruthy();
    expect(holidayFieldErrors({ ...fullHoliday(), holidayDate: '2027-01-01' }, w).holidayDate).toBeTruthy();
    expect(holidayFieldErrors({ ...fullHoliday(), holidayDate: '2026-06-15' }, w).holidayDate).toBeUndefined();
  });

  it('shapes only the supplied optional fields into the command payload', () => {
    expect(toHolidayInput(fullHoliday())).toEqual({
      holidayDate: '2026-01-01', nameStatutory: 'New Year’s Day', nameCommon: 'New Year',
      holidayType: 'statutory', sourceReference: 'Public Holidays Act', sourcePublishedDate: '2025-12-01',
      provenanceNote: 'Statutory annual holiday.',
    });
    const withOpt = toHolidayInput({ ...fullHoliday(), observedDate: '2026-01-02', dayFraction: '0.5' });
    expect(withOpt.observedDate).toBe('2026-01-02');
    expect(withOpt.dayFraction).toBe(0.5);
  });
});

describe('work-calendar pattern rules (UT-CAL-U3)', () => {
  it('starts with NO selected weekdays and is therefore invalid', () => {
    const p = emptyPatternForm();
    expect(p.weekdays).toEqual([]);
    expect(patternFieldErrors(p).weekdays).toBeTruthy();
    expect(patternFormValid(p)).toBe(false);
  });

  it('is valid with at least one weekday (holiday link required only when asked)', () => {
    expect(patternFormValid({ weekdays: [1, 2, 3, 4, 5], fractions: {}, holidayCalendarVersionId: '' })).toBe(true);
    expect(patternFormValid({ weekdays: [1, 2, 3, 4, 5], fractions: {}, holidayCalendarVersionId: '' }, { requireHoliday: true })).toBe(false);
    expect(patternFormValid({ weekdays: [1, 2, 3, 4, 5], fractions: {}, holidayCalendarVersionId: 'hv1' }, { requireHoliday: true })).toBe(true);
  });

  it('rejects partial-day fractions that are not strictly between 0 and 1', () => {
    expect(patternFieldErrors({ weekdays: [6], fractions: { '6': '0' }, holidayCalendarVersionId: '' }).fractions).toBeTruthy();
    expect(patternFieldErrors({ weekdays: [6], fractions: { '6': '1' }, holidayCalendarVersionId: '' }).fractions).toBeTruthy();
    expect(patternFieldErrors({ weekdays: [6], fractions: { '6': '0.5' }, holidayCalendarVersionId: '' }).fractions).toBeUndefined();
  });

  it('builds the weekday_fractions map from only valid partials on selected weekdays', () => {
    expect(buildWeekdayFractions({ weekdays: [1, 2, 6], fractions: { '6': '0.5', '2': '', '1': '2' }, holidayCalendarVersionId: '' })).toEqual({ '6': 0.5 });
  });

  it('sorts + dedupes weekdays', () => {
    expect(sortedWeekdays([5, 1, 1, 3])).toEqual([1, 3, 5]);
  });
});

describe('period / effective-window rules', () => {
  it('flags start-after-end and missing dates', () => {
    expect(periodError('', '2026-01-31')).toBeTruthy();
    expect(periodError('2026-02-01', '2026-01-01')).toBeTruthy();
    expect(periodError('2026-01-01', '2026-01-31')).toBeNull();
  });
  it('flags effective-to before effective-from', () => {
    expect(effectiveError('', '')).toBeTruthy();
    expect(effectiveError('2026-01-01', '2025-12-31')).toBeTruthy();
    expect(effectiveError('2026-01-01', '')).toBeNull();
    expect(effectiveError('2026-01-01', '2026-12-31')).toBeNull();
  });
});

describe('assignment window rule (UT-CAL-U5 inline window errors)', () => {
  const w = { from: '2026-01-01', to: '2026-12-31' };
  it('flags an assignment that starts before or ends after the version window', () => {
    expect(assignmentWindowError('2025-12-31', '2026-06-30', w)).toBeTruthy();
    expect(assignmentWindowError('2026-01-01', '2027-01-01', w)).toBeTruthy();
    expect(assignmentWindowError('2026-02-01', '2026-11-30', w)).toBeNull();
  });
  it('requires an assignment end when the version itself ends', () => {
    expect(assignmentWindowError('2026-02-01', '', w)).toBeTruthy();
  });
  it('allows an open assignment against an open (never-ending) version, and no window', () => {
    expect(assignmentWindowError('2026-02-01', '', { from: '2026-01-01', to: null })).toBeNull();
    expect(assignmentWindowError('2026-01-01', '2026-12-31', null)).toBeNull();
  });
});

describe('typed backend failure → friendly copy (UT-CAL-U5 inline conflicts)', () => {
  it('maps known codes to actionable copy and passes unknowns through', () => {
    expect(friendlyError('calendar.assignment_overlap')).toBe(FRIENDLY_ERROR['calendar.assignment_overlap']);
    expect(friendlyError('calendar.split_period')).toContain('fails closed');
    expect(friendlyError('stale_lock_version')).toContain('changed since');
    expect(friendlyError('something.unmapped')).toBe('something.unmapped');
    expect(friendlyError(null)).toBeTruthy();
  });
});
