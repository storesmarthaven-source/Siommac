/**
 * Unit coverage for the SHARED UI-preference contract — the registry the
 * `/api/ui-preferences/{get,save}` routes validate against.
 *
 * These exist because the saved-view outage was a contract split, not a bug in
 * either half: the frontend saved under `hr.employee-register.views` while the
 * endpoint's allow-list knew only `hr.employee-register.columns`, so every save
 * was rejected and no view ever loaded. The first test below is the one that
 * would have caught it — it asserts that every key the client can name is a key
 * the registry accepts.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMPLOYEE_REGISTER_COLUMNS,
  EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY,
  EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_VERSION,
  EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY,
  EMPLOYEE_REGISTER_VIEWS_PREFERENCE_VERSION,
  EMPLOYEE_REGISTER_VIEW_LIMITS,
  UI_PREFERENCES,
  isKnownUiPreferenceKey,
  sanitizeEmployeeRegisterViews,
  sanitizeUiPreference,
  uiPreferenceDefinition,
} from '../../types/uiPreferences';

const view = (over: Record<string, unknown> = {}) => ({
  id: 'view-1',
  name: 'Ops contractors',
  filters: { query: 'ari', status: ['active'], department: ['dept-1'], employmentType: ['contract'], training: ['expired'] },
  sortBy: 'employee_number',
  sortDir: 'desc',
  pageSize: 50,
  columns: ['employee', 'department', 'employmentType', 'actions'],
  ...over,
});

describe('UI preference registry', () => {
  it('declares BOTH employee-register keys — the split that broke saved views', () => {
    expect(isKnownUiPreferenceKey(EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY)).toBe(true);
    expect(isKnownUiPreferenceKey(EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY)).toBe(true);
  });

  it('rejects any key it does not declare, rather than storing arbitrary JSON', () => {
    for (const key of ['', 'hr.employee-register', 'hr.employee-register.viewss', 'anything.at.all', '__proto__']) {
      expect(isKnownUiPreferenceKey(key), key).toBe(false);
      expect(sanitizeUiPreference(key, []), key).toBeNull();
    }
  });

  it('gives every declared key its own sanitizer and a version', () => {
    expect(UI_PREFERENCES.length).toBeGreaterThan(0);
    for (const definition of UI_PREFERENCES) {
      expect(typeof definition.sanitize, definition.key).toBe('function');
      expect(definition.version, definition.key).toBeGreaterThanOrEqual(1);
      expect(uiPreferenceDefinition(definition.key)).toBe(definition);
    }
    // Each key validates with ITS OWN sanitizer: a column payload is not a valid
    // view payload, and vice versa.
    expect(sanitizeUiPreference(EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY, [view()])).toBeNull();
    expect(sanitizeUiPreference(EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY, ['employee', 'actions'])).toBeNull();
  });
});

describe('columns preference', () => {
  const key = EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY;

  it('accepts a valid column set and stamps the contract version', () => {
    const result = sanitizeUiPreference(key, ['status', 'employee', 'actions']);
    expect(result?.version).toBe(EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_VERSION);
    // Normalised into contract order, with the required columns present.
    expect(result?.value).toEqual(['employee', 'status', 'actions']);
  });

  it('re-adds the required columns rather than storing a set the register cannot render', () => {
    expect(sanitizeUiPreference(key, ['status'])?.value).toEqual(['employee', 'status', 'actions']);
  });

  it('rejects malformed values instead of coercing them', () => {
    for (const bad of [null, undefined, 'employee', 42, {}, { 0: 'employee' }, ['employee', 7], ['nope'], [['employee']]]) {
      expect(sanitizeUiPreference(key, bad), JSON.stringify(bad) ?? 'undefined').toBeNull();
    }
  });

  it('rejects a payload longer than the contract', () => {
    expect(sanitizeUiPreference(key, new Array(12).fill('employee'))).toBeNull();
  });
});

describe('saved-views preference', () => {
  const key = EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY;

  it('accepts a valid view and stamps the contract version', () => {
    const result = sanitizeUiPreference(key, [view()]);
    expect(result?.version).toBe(EMPLOYEE_REGISTER_VIEWS_PREFERENCE_VERSION);
    expect(result?.value).toEqual([{
      id: 'view-1',
      name: 'Ops contractors',
      filters: { query: 'ari', status: ['active'], department: ['dept-1'], employmentType: ['contract'], training: ['expired'] },
      sortBy: 'employee_number',
      sortDir: 'desc',
      pageSize: 50,
      columns: ['employee', 'department', 'employmentType', 'actions'],
    }]);
  });

  it('accepts an empty list — that is a user clearing their views, not a bad payload', () => {
    expect(sanitizeUiPreference(key, [])).toEqual({ version: EMPLOYEE_REGISTER_VIEWS_PREFERENCE_VERSION, value: [] });
  });

  it('rejects a non-empty payload in which nothing is usable', () => {
    // Silently storing `[]` here would delete the views the user actually had.
    expect(sanitizeUiPreference(key, [null, { id: '', name: '' }, 'nope'])).toBeNull();
  });

  it('rejects a non-array and an over-long list', () => {
    for (const bad of [null, undefined, {}, 'views', 7]) {
      expect(sanitizeUiPreference(key, bad)).toBeNull();
    }
    const tooMany = Array.from({ length: EMPLOYEE_REGISTER_VIEW_LIMITS.maxViews + 1 }, (_, i) => view({ id: `v${i}` }));
    expect(sanitizeUiPreference(key, tooMany)).toBeNull();
  });

  it('normalises an unsafe view instead of trusting it', () => {
    const [cleaned] = sanitizeEmployeeRegisterViews([view({
      name: `  ${'n'.repeat(80)}  `,
      sortBy: 'not_a_column',
      sortDir: 'sideways',
      pageSize: 999,
      filters: { query: 'q'.repeat(400), status: ['active', 'active', 7], department: 'nope' },
    })]);
    expect(cleaned?.name).toHaveLength(EMPLOYEE_REGISTER_VIEW_LIMITS.maxNameLength);
    expect(cleaned?.sortBy).toBe('full_name');
    expect(cleaned?.sortDir).toBe('asc');
    expect(cleaned?.pageSize).toBe(25);
    expect(cleaned?.filters.query).toHaveLength(EMPLOYEE_REGISTER_VIEW_LIMITS.maxQueryLength);
    expect(cleaned?.filters.status).toEqual(['active']);
    expect(cleaned?.filters.department).toEqual([]);
  });

  it('drops entries with no usable identity, and duplicates', () => {
    const cleaned = sanitizeEmployeeRegisterViews([
      null, view({ id: 'a', name: 'One' }), view({ id: 'a', name: 'Two' }), view({ id: '', name: 'Bad' }),
      view({ id: 'b', name: '   ' }),
    ]);
    expect(cleaned.map(v => v.id)).toEqual(['a']);
  });

  it('falls back to the default columns for a view that predates the column contract', () => {
    const [cleaned] = sanitizeEmployeeRegisterViews([{ id: 'legacy', name: 'Legacy' }]);
    expect(cleaned?.columns).toEqual([...DEFAULT_EMPLOYEE_REGISTER_COLUMNS]);
  });

  it('rejects a stored column key that no longer exists, per view', () => {
    const [cleaned] = sanitizeEmployeeRegisterViews([view({ columns: ['employee', 'retiredColumn', 'actions'] })]);
    // The unknown key is dropped; the required ones survive.
    expect(cleaned?.columns).toEqual(['employee', 'actions']);
  });

  it('caps the number of views it will return', () => {
    const many = Array.from({ length: EMPLOYEE_REGISTER_VIEW_LIMITS.maxViews + 5 }, (_, i) => view({ id: `v${i}` }));
    expect(sanitizeEmployeeRegisterViews(many)).toHaveLength(EMPLOYEE_REGISTER_VIEW_LIMITS.maxViews);
  });
});
