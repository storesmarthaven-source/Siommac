/**
 * types/uiPreferences.ts — the ONE authoritative contract for per-user UI
 * preferences, shared verbatim by the backend (`netlify/functions/routes/uiPrefs.ts`)
 * and the frontend (`src/api/uiPreferences.ts` and its consumers).
 *
 * Every stored preference is declared here as a KEY + VERSION + its own typed
 * sanitizer, and the route validates through `sanitizeUiPreference` below. There
 * is deliberately no generic "accept any JSON under any key" store: that would
 * turn an authenticated endpoint into arbitrary per-user storage, and it is what
 * let the saved-view key drift out of the contract in the first place — the
 * frontend wrote `hr.employee-register.views` while the backend only knew
 * `hr.employee-register.columns`, so every saved view silently failed to load
 * with "Unknown UI preference key".
 *
 * ADDING A PREFERENCE: declare its key, version and sanitizer, then register it
 * in `UI_PREFERENCES`. A sanitizer returns `null` for a value it cannot make
 * safe — never a partially-trusted object, and never a silent default that would
 * overwrite what the user actually stored.
 */

import { CALENDAR_TITLE_ICON_TYPES, type CalendarTitleIconType } from './calendar';

// ── Employee register: visible columns ──────────────────────────────────────

export const EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY = 'hr.employee-register.columns';
export const EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_VERSION = 1;

export const EMPLOYEE_REGISTER_COLUMN_KEYS = [
  'employee',
  'employeeNumber',
  'position',
  'department',
  'site',
  'supervisor',
  'employmentType',
  'status',
  'readiness',
  'trainingStatus',
  'actions',
] as const;

export type EmployeeRegisterColumnKey = typeof EMPLOYEE_REGISTER_COLUMN_KEYS[number];

export const REQUIRED_EMPLOYEE_REGISTER_COLUMN_KEYS: readonly EmployeeRegisterColumnKey[] = [
  'employee',
  'actions',
];

/**
 * The recommended default set.
 *
 * Part of the CONTRACT, not of presentation, because a saved view that records
 * no column choice is stored against this list. A user's persisted choice always
 * wins — sanitisation falls back here only when there is nothing saved — so
 * changing it never overwrites anyone.
 */
export const DEFAULT_EMPLOYEE_REGISTER_COLUMNS: readonly EmployeeRegisterColumnKey[] = [
  'employee',
  'employeeNumber',
  'position',
  'department',
  'site',
  'supervisor',
  'status',
  'readiness',
  'actions',
];

export function sanitizeEmployeeRegisterColumnKeys(value: unknown): EmployeeRegisterColumnKey[] | null {
  if (!Array.isArray(value)) return null;
  const validKeys = new Set<string>(EMPLOYEE_REGISTER_COLUMN_KEYS);
  const requested = new Set(value.filter((key): key is string => typeof key === 'string' && validKeys.has(key)));
  for (const key of REQUIRED_EMPLOYEE_REGISTER_COLUMN_KEYS) requested.add(key);
  return EMPLOYEE_REGISTER_COLUMN_KEYS.filter(key => requested.has(key));
}

// ── Employee register: saved views ──────────────────────────────────────────

export const EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY = 'hr.employee-register.views';
export const EMPLOYEE_REGISTER_VIEWS_PREFERENCE_VERSION = 1;

/**
 * Columns the register can sort on.
 *
 * Declared here rather than in the API client because a saved view PERSISTS a
 * sort column: it is part of the stored contract, and a value that is no longer
 * sortable has to be rejected on read, not trusted because it was valid once.
 */
export const EMPLOYEE_REGISTER_SORT_COLUMNS = [
  'full_name', 'employee_number', 'status', 'employment_type', 'start_date', 'department_id',
] as const;

export type EmployeeRegisterSortColumn = typeof EMPLOYEE_REGISTER_SORT_COLUMNS[number];

export const EMPLOYEE_REGISTER_PAGE_SIZES = [25, 50, 100] as const;

/** Caps. A saved view is user-authored, so every bound is enforced on write AND read. */
export const EMPLOYEE_REGISTER_VIEW_LIMITS = {
  maxViews: 20,
  maxIdLength: 80,
  maxNameLength: 48,
  maxQueryLength: 200,
  maxFilterValues: 50,
  maxFilterValueLength: 120,
} as const;

export interface EmployeeRegisterViewFilters {
  query: string;
  status: string[];
  department: string[];
  employmentType: string[];
  training: string[];
}

export interface EmployeeRegisterView {
  id: string;
  name: string;
  filters: EmployeeRegisterViewFilters;
  sortBy: EmployeeRegisterSortColumn;
  sortDir: 'asc' | 'desc';
  pageSize: number;
  columns: EmployeeRegisterColumnKey[];
}

function filterValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set(value.filter(
    (item): item is string => typeof item === 'string' && item.length <= EMPLOYEE_REGISTER_VIEW_LIMITS.maxFilterValueLength,
  ));
  return Array.from(unique).slice(0, EMPLOYEE_REGISTER_VIEW_LIMITS.maxFilterValues);
}

/**
 * Reconcile a persisted saved-view list with the current contract.
 *
 * Returns the views it could make safe, DROPPING any entry that has no usable
 * identity (no id, no name, or a duplicate id) rather than repairing it into
 * something the user never saved. Always returns an array — an unusable payload
 * yields `[]`, which the caller renders as "no saved views" rather than an error.
 */
export function sanitizeEmployeeRegisterViews(value: unknown): EmployeeRegisterView[] {
  if (!Array.isArray(value)) return [];
  const sortColumns = new Set<string>(EMPLOYEE_REGISTER_SORT_COLUMNS);
  const pageSizes = new Set<number>(EMPLOYEE_REGISTER_PAGE_SIZES);
  const seen = new Set<string>();
  const views: EmployeeRegisterView[] = [];

  for (const candidate of value.slice(0, EMPLOYEE_REGISTER_VIEW_LIMITS.maxViews)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.slice(0, EMPLOYEE_REGISTER_VIEW_LIMITS.maxIdLength) : '';
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, EMPLOYEE_REGISTER_VIEW_LIMITS.maxNameLength) : '';
    if (!id || !name || seen.has(id)) continue;

    const rawFilters = row.filters && typeof row.filters === 'object' && !Array.isArray(row.filters)
      ? row.filters as Record<string, unknown>
      : {};
    const pageSize = Number(row.pageSize);
    seen.add(id);
    views.push({
      id,
      name,
      filters: {
        query: typeof rawFilters.query === 'string'
          ? rawFilters.query.slice(0, EMPLOYEE_REGISTER_VIEW_LIMITS.maxQueryLength)
          : '',
        status: filterValues(rawFilters.status),
        department: filterValues(rawFilters.department),
        employmentType: filterValues(rawFilters.employmentType),
        training: filterValues(rawFilters.training),
      },
      sortBy: sortColumns.has(row.sortBy as string) ? row.sortBy as EmployeeRegisterSortColumn : 'full_name',
      sortDir: row.sortDir === 'desc' ? 'desc' : 'asc',
      pageSize: pageSizes.has(pageSize) ? pageSize : 25,
      // A saved view carries its own column set; an absent or unusable one falls
      // back to the default set rather than dropping the whole view.
      columns: sanitizeEmployeeRegisterColumnKeys(row.columns)
        ?? [...DEFAULT_EMPLOYEE_REGISTER_COLUMNS],
    });
  }
  return views;
}

// ── Onboarding work queue: saved views ─────────────────────────────────────

export const ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_KEY = 'hr.onboarding.work-queue.views';
export const ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_VERSION = 1;
export const ONBOARDING_WORK_QUEUE_PAGE_SIZES = [25, 50, 100] as const;
export const ONBOARDING_WORK_QUEUE_VIEW_LIMITS = {
  maxViews: 20,
  maxIdLength: 80,
  maxNameLength: 48,
  maxQueryLength: 200,
  maxFilterValues: 50,
  maxFilterValueLength: 120,
} as const;

const ONBOARDING_WORK_QUEUE_SCOPES = ['my', 'team', 'all'] as const;
const ONBOARDING_WORK_QUEUE_SOURCES = ['task', 'handoff', 'blocker', 'evidence'] as const;
const ONBOARDING_WORK_QUEUE_LIFECYCLES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
const ONBOARDING_WORK_QUEUE_DUE_STATES = ['all', 'overdue', 'due_today', 'due_this_week', 'unscheduled'] as const;
const ONBOARDING_WORK_QUEUE_SORT_FIELDS = [
  'due_at', 'title', 'employee_name', 'case_no', 'source_type', 'status', 'created_at',
] as const;

export interface OnboardingWorkQueueView {
  id: string;
  name: string;
  scope: typeof ONBOARDING_WORK_QUEUE_SCOPES[number];
  filters: {
    query: string;
    sourceTypes: typeof ONBOARDING_WORK_QUEUE_SOURCES[number][];
    lifecycles: typeof ONBOARDING_WORK_QUEUE_LIFECYCLES[number][];
    dueState: typeof ONBOARDING_WORK_QUEUE_DUE_STATES[number];
    departmentIds: string[];
    queues: string[];
    accountableIds: string[];
    unassigned: boolean;
  };
  sortBy: typeof ONBOARDING_WORK_QUEUE_SORT_FIELDS[number];
  sortDir: 'asc' | 'desc';
  pageSize: number;
}

function enumValues<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set<string>(allowed);
  return Array.from(new Set(value.filter((item): item is T => typeof item === 'string' && valid.has(item))))
    .slice(0, ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxFilterValues);
}

function boundedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string =>
    typeof item === 'string' && item.length <= ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxFilterValueLength,
  ))).slice(0, ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxFilterValues);
}

export function sanitizeOnboardingWorkQueueViews(value: unknown): OnboardingWorkQueueView[] {
  if (!Array.isArray(value)) return [];
  const scopes = new Set<string>(ONBOARDING_WORK_QUEUE_SCOPES);
  const dueStates = new Set<string>(ONBOARDING_WORK_QUEUE_DUE_STATES);
  const sortFields = new Set<string>(ONBOARDING_WORK_QUEUE_SORT_FIELDS);
  const pageSizes = new Set<number>(ONBOARDING_WORK_QUEUE_PAGE_SIZES);
  const seen = new Set<string>();
  const result: OnboardingWorkQueueView[] = [];

  for (const candidate of value.slice(0, ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxViews)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.slice(0, ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxIdLength) : '';
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxNameLength) : '';
    if (!id || !name || seen.has(id)) continue;
    const raw = row.filters && typeof row.filters === 'object' && !Array.isArray(row.filters)
      ? row.filters as Record<string, unknown>
      : {};
    const pageSize = Number(row.pageSize);
    seen.add(id);
    result.push({
      id,
      name,
      scope: scopes.has(row.scope as string) ? row.scope as OnboardingWorkQueueView['scope'] : 'my',
      filters: {
        query: typeof raw.query === 'string' ? raw.query.slice(0, ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxQueryLength) : '',
        sourceTypes: enumValues(raw.sourceTypes, ONBOARDING_WORK_QUEUE_SOURCES),
        lifecycles: enumValues(raw.lifecycles, ONBOARDING_WORK_QUEUE_LIFECYCLES),
        dueState: dueStates.has(raw.dueState as string) ? raw.dueState as OnboardingWorkQueueView['filters']['dueState'] : 'all',
        departmentIds: boundedStrings(raw.departmentIds),
        queues: boundedStrings(raw.queues),
        accountableIds: boundedStrings(raw.accountableIds),
        unassigned: raw.unassigned === true,
      },
      sortBy: sortFields.has(row.sortBy as string) ? row.sortBy as OnboardingWorkQueueView['sortBy'] : 'due_at',
      sortDir: row.sortDir === 'desc' ? 'desc' : 'asc',
      pageSize: pageSizes.has(pageSize) ? pageSize : ONBOARDING_WORK_QUEUE_PAGE_SIZES[0],
    });
  }
  return result;
}

// ── Application navigation ──────────────────────────────────────────────────

export const NAVIGATION_PREFERENCE_KEY = 'system.navigation';
export const NAVIGATION_PREFERENCE_VERSION = 1;

export type NavigationDensityPreference = 'compact' | 'comfortable';

export interface NavigationVisibilityPreference {
  namespace: string;
  id: string;
  visible: boolean;
}

export interface NavigationOrderPreference {
  namespace: string;
  ids: string[];
}

export interface NavigationPreference {
  visibility: NavigationVisibilityPreference[];
  order: NavigationOrderPreference[];
  density: NavigationDensityPreference;
  showChildIcons: boolean;
}

const NAVIGATION_PREFERENCE_LIMITS = {
  maxNamespaces: 80,
  maxItems: 500,
  maxIdsPerNamespace: 120,
  maxIdLength: 96,
} as const;

const NAVIGATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/;

function safeNavigationId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > NAVIGATION_PREFERENCE_LIMITS.maxIdLength || !NAVIGATION_ID.test(value)) return null;
  return value;
}

export function sanitizeNavigationPreference(value: unknown): NavigationPreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.visibility) || !Array.isArray(raw.order)) return null;
  if (raw.visibility.length > NAVIGATION_PREFERENCE_LIMITS.maxItems || raw.order.length > NAVIGATION_PREFERENCE_LIMITS.maxNamespaces) return null;
  if (raw.density !== 'compact' && raw.density !== 'comfortable') return null;
  if (typeof raw.showChildIcons !== 'boolean') return null;

  const visibility: NavigationVisibilityPreference[] = [];
  const seenVisibility = new Set<string>();
  for (const candidate of raw.visibility) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    const namespace = safeNavigationId(row.namespace);
    const id = safeNavigationId(row.id);
    if (!namespace || !id || typeof row.visible !== 'boolean') return null;
    const key = `${namespace}\u0000${id}`;
    if (seenVisibility.has(key)) continue;
    seenVisibility.add(key);
    visibility.push({ namespace, id, visible: row.visible });
  }

  const order: NavigationOrderPreference[] = [];
  const seenNamespaces = new Set<string>();
  for (const candidate of raw.order) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    const namespace = safeNavigationId(row.namespace);
    if (!namespace || seenNamespaces.has(namespace) || !Array.isArray(row.ids) || row.ids.length > NAVIGATION_PREFERENCE_LIMITS.maxIdsPerNamespace) return null;
    const ids = row.ids.map(safeNavigationId);
    if (ids.some(id => id === null)) return null;
    seenNamespaces.add(namespace);
    order.push({ namespace, ids: [...new Set(ids as string[])] });
  }

  return { visibility, order, density: raw.density, showChildIcons: raw.showChildIcons };
}

// ── In-app toast notifications ─────────────────────────────────────────────

export const TOAST_PREFERENCE_KEY = 'system.toast';
export const TOAST_PREFERENCE_VERSION = 2;

export const TOAST_POSITIONS = [
  'top-right',
  'bottom-right',
  'bottom-center',
] as const;

export type ToastPosition = typeof TOAST_POSITIONS[number];

export const TOAST_DURATION_MODES = ['standard', 'extended', 'persistent'] as const;
export type ToastDurationMode = typeof TOAST_DURATION_MODES[number];

export interface ToastPreference {
  durationMode: ToastDurationMode;
  showPreviews: boolean;
  playSound: boolean;
  expandActionToasts: boolean;
  position: ToastPosition;
}

export const DEFAULT_TOAST_PREFERENCE: ToastPreference = {
  durationMode: 'standard',
  showPreviews: true,
  playSound: false,
  expandActionToasts: false,
  position: 'top-right',
};

export function sanitizeToastPreference(value: unknown): ToastPreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const allowedKeys = new Set(['durationMode', 'showPreviews', 'playSound', 'expandActionToasts', 'position']);
  if (
    Object.keys(raw).some(key => !allowedKeys.has(key))
    || typeof raw.showPreviews !== 'boolean'
    || typeof raw.playSound !== 'boolean'
    || typeof raw.expandActionToasts !== 'boolean'
    || !TOAST_DURATION_MODES.includes(raw.durationMode as ToastDurationMode)
    || !TOAST_POSITIONS.includes(raw.position as ToastPosition)
  ) return null;

  return {
    durationMode: raw.durationMode as ToastDurationMode,
    showPreviews: raw.showPreviews,
    playSound: raw.playSound,
    expandActionToasts: raw.expandActionToasts,
    position: raw.position as ToastPosition,
  };
}

// ── Calendar navigator ─────────────────────────────────────────────────────

export const CALENDAR_NAVIGATOR_PREFERENCE_KEY = 'calendar.navigator';
export const CALENDAR_NAVIGATOR_PREFERENCE_VERSION = 8;

export const CALENDAR_NAVIGATOR_VIEWS = ['day', 'week', 'month', 'agenda', 'tasks'] as const;
export const CALENDAR_NAVIGATOR_SCOPES = ['all', 'mine', 'shared', 'public', 'archived'] as const;
export const CALENDAR_NAVIGATOR_SECTIONS = ['navigator'] as const;
export const CALENDAR_WEATHER_LOCATIONS = ['port-of-spain', 'san-fernando', 'scarborough'] as const;

export type CalendarNavigatorView = typeof CALENDAR_NAVIGATOR_VIEWS[number];
export type CalendarNavigatorScope = typeof CALENDAR_NAVIGATOR_SCOPES[number];
export type CalendarNavigatorCategory = string;
export type CalendarNavigatorSection = typeof CALENDAR_NAVIGATOR_SECTIONS[number];
export type CalendarWeatherLocation = typeof CALENDAR_WEATHER_LOCATIONS[number];

export interface CalendarNavigatorPreference {
  view: CalendarNavigatorView;
  scope: CalendarNavigatorScope;
  zoom: number;
  showAllDay: boolean;
  showWeather: boolean;
  showHolidays: boolean;
  weatherLocation: CalendarWeatherLocation;
  titleIconType: CalendarTitleIconType;
  hiddenSources: string[];
  hiddenCategories: CalendarNavigatorCategory[];
  hiddenCalendarIds: string[];
  expandedSections: CalendarNavigatorSection[];
}

const CALENDAR_SOURCE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function exactEnumArray<T extends string>(value: unknown, allowed: readonly T[], limit: number): T[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const accepted = new Set<string>(allowed);
  if (value.some(item => typeof item !== 'string' || !accepted.has(item))) return null;
  return [...new Set(value as T[])];
}

export function sanitizeCalendarNavigatorPreference(value: unknown): CalendarNavigatorPreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const allowedKeys = new Set(['view', 'scope', 'zoom', 'showAllDay', 'showWeather', 'showHolidays', 'weatherLocation', 'titleIconType', 'hiddenSources', 'hiddenCategories', 'hiddenCalendarIds', 'expandedSections']);
  if (Object.keys(raw).some(key => !allowedKeys.has(key))) return null;
  if (!CALENDAR_NAVIGATOR_VIEWS.includes(raw.view as CalendarNavigatorView)) return null;
  if (!CALENDAR_NAVIGATOR_SCOPES.includes(raw.scope as CalendarNavigatorScope)) return null;
  if (typeof raw.zoom !== 'number' || !Number.isFinite(raw.zoom) || raw.zoom < .75 || raw.zoom > 1.4) return null;
  if (typeof raw.showAllDay !== 'boolean') return null;
  const showWeather = raw.showWeather ?? true;
  const showHolidays = raw.showHolidays ?? false;
  const weatherLocation = raw.weatherLocation ?? 'port-of-spain';
  const titleIconType = raw.titleIconType ?? 'emoji';
  if (typeof showWeather !== 'boolean' || typeof showHolidays !== 'boolean') return null;
  if (!CALENDAR_WEATHER_LOCATIONS.includes(weatherLocation as CalendarWeatherLocation)) return null;
  if (!CALENDAR_TITLE_ICON_TYPES.includes(titleIconType as CalendarTitleIconType)) return null;
  if (!Array.isArray(raw.hiddenSources) || raw.hiddenSources.length > 80) return null;
  if (raw.hiddenSources.some(source => typeof source !== 'string' || source.length > 96 || !CALENDAR_SOURCE_KEY.test(source))) return null;
  const hiddenCalendarIds = raw.hiddenCalendarIds ?? [];
  if (!Array.isArray(hiddenCalendarIds) || hiddenCalendarIds.length > 100) return null;
  if (hiddenCalendarIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return null;

  const hiddenCategories = raw.hiddenCategories;
  const expandedSections = exactEnumArray(raw.expandedSections, CALENDAR_NAVIGATOR_SECTIONS, CALENDAR_NAVIGATOR_SECTIONS.length);
  if (!Array.isArray(hiddenCategories) || hiddenCategories.length > 100) return null;
  if (hiddenCategories.some(category => typeof category !== 'string' || category.length > 96 || !CALENDAR_SOURCE_KEY.test(category))) return null;
  if (!expandedSections) return null;

  return {
    view: raw.view as CalendarNavigatorView,
    scope: raw.scope as CalendarNavigatorScope,
    zoom: raw.zoom,
    showAllDay: raw.showAllDay,
    showWeather,
    showHolidays,
    weatherLocation: weatherLocation as CalendarWeatherLocation,
    titleIconType: titleIconType as CalendarTitleIconType,
    hiddenSources: [...new Set(raw.hiddenSources as string[])],
    hiddenCategories: [...new Set(hiddenCategories as string[])],
    hiddenCalendarIds: [...new Set(hiddenCalendarIds as string[])],
    expandedSections,
  };
}

// ── The registry the endpoint validates against ─────────────────────────────

/**
 * One preference: the version stamped on every write, and the sanitizer that
 * decides whether a submitted value may be stored at all.
 *
 * `sanitize` returns `null` to REJECT. It must not "fix up" a value it cannot
 * validate — rejecting is what keeps this endpoint a typed preference store
 * rather than arbitrary per-user JSON storage.
 */
export interface UiPreferenceDefinition {
  key: string;
  version: number;
  sanitize: (value: unknown) => unknown | null;
}

export const UI_PREFERENCES: readonly UiPreferenceDefinition[] = [
  {
    key: CALENDAR_NAVIGATOR_PREFERENCE_KEY,
    version: CALENDAR_NAVIGATOR_PREFERENCE_VERSION,
    sanitize: sanitizeCalendarNavigatorPreference,
  },
  {
    key: TOAST_PREFERENCE_KEY,
    version: TOAST_PREFERENCE_VERSION,
    sanitize: sanitizeToastPreference,
  },
  {
    key: NAVIGATION_PREFERENCE_KEY,
    version: NAVIGATION_PREFERENCE_VERSION,
    sanitize: sanitizeNavigationPreference,
  },
  {
    key: EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_KEY,
    version: EMPLOYEE_REGISTER_COLUMNS_PREFERENCE_VERSION,
    // Rejects outright when the payload is not an array, is longer than the
    // contract, or names a column that does not exist — a stored preference must
    // never contain a key the register cannot render.
    sanitize: value => {
      if (!Array.isArray(value) || value.length > EMPLOYEE_REGISTER_COLUMN_KEYS.length) return null;
      const allowed = new Set<string>(EMPLOYEE_REGISTER_COLUMN_KEYS);
      if (value.some(item => typeof item !== 'string' || !allowed.has(item))) return null;
      return sanitizeEmployeeRegisterColumnKeys(value);
    },
  },
  {
    key: EMPLOYEE_REGISTER_VIEWS_PREFERENCE_KEY,
    version: EMPLOYEE_REGISTER_VIEWS_PREFERENCE_VERSION,
    // Must be an array, and must survive sanitisation with at least as much as
    // it claimed: a payload of 3 views where every one is unusable is a malformed
    // submission, not an empty view list, so it is rejected rather than silently
    // clearing what the user had saved.
    sanitize: value => {
      if (!Array.isArray(value)) return null;
      if (value.length > EMPLOYEE_REGISTER_VIEW_LIMITS.maxViews) return null;
      const views = sanitizeEmployeeRegisterViews(value);
      if (value.length > 0 && views.length === 0) return null;
      return views;
    },
  },
  {
    key: ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_KEY,
    version: ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_VERSION,
    sanitize: value => {
      if (!Array.isArray(value) || value.length > ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxViews) return null;
      const views = sanitizeOnboardingWorkQueueViews(value);
      if (value.length > 0 && views.length === 0) return null;
      return views;
    },
  },
];

const UI_PREFERENCE_BY_KEY = new Map(UI_PREFERENCES.map(definition => [definition.key, definition]));

/** Is this a key the contract actually declares? */
export function isKnownUiPreferenceKey(key: string): boolean {
  return UI_PREFERENCE_BY_KEY.has(key);
}

export function uiPreferenceDefinition(key: string): UiPreferenceDefinition | null {
  return UI_PREFERENCE_BY_KEY.get(key) ?? null;
}

/**
 * Validate a submitted value against the sanitizer belonging to ITS key.
 *
 * Returns `null` for an unknown key or a value that key's sanitizer refuses —
 * the caller reports the two cases separately so an operator can tell a typo
 * from a bad payload.
 */
export function sanitizeUiPreference(key: string, value: unknown): { version: number; value: unknown } | null {
  const definition = UI_PREFERENCE_BY_KEY.get(key);
  if (!definition) return null;
  const cleaned = definition.sanitize(value);
  return cleaned === null ? null : { version: definition.version, value: cleaned };
}
