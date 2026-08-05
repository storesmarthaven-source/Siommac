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

// ── Onboarding Work Queue: saved views ──────────────────────────────────────
//
// Declared HERE, in the contract both halves import, for the reason recorded at the top of
// employeeRegisterViews.ts: when a view key lives only on the frontend, the endpoint's
// allow-list never learns it and every save is rejected as "Unknown UI preference key"
// while the UI reports success. One declaration, both sides.

export const ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_KEY = 'hr.onboarding.work-queue.views';
export const ONBOARDING_WORK_QUEUE_VIEWS_PREFERENCE_VERSION = 1;

/**
 * The sortable fields, mirroring the hr_onboarding_work_queue RPC's p_sort enum.
 *
 * A saved view PERSISTS a sort field, so a value that is no longer sortable has to be
 * rejected on read rather than trusted because it was valid when saved. If this list and
 * the RPC's enum ever diverge, the RPC is authoritative and the view falls back.
 */
export const ONBOARDING_WORK_QUEUE_SORT_FIELDS = [
  'due_at', 'title', 'employee_name', 'case_no', 'source_type', 'status', 'created_at',
] as const;
export type OnboardingWorkQueueSortField = typeof ONBOARDING_WORK_QUEUE_SORT_FIELDS[number];

export const ONBOARDING_WORK_QUEUE_SOURCE_TYPES = ['task', 'handoff', 'blocker', 'evidence'] as const;
export const ONBOARDING_WORK_QUEUE_LIFECYCLES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export const ONBOARDING_WORK_QUEUE_DUE_STATES = ['all', 'overdue', 'due_today', 'due_this_week', 'unscheduled'] as const;
export const ONBOARDING_WORK_QUEUE_SCOPES = ['my', 'team', 'all'] as const;
export const ONBOARDING_WORK_QUEUE_PAGE_SIZES = [25, 50, 100] as const;

export const ONBOARDING_WORK_QUEUE_VIEW_LIMITS = {
  maxViews: 20,
  maxIdLength: 80,
  maxNameLength: 48,
  maxQueryLength: 200,
  maxFilterValues: 50,
  maxFilterValueLength: 120,
} as const;

export interface OnboardingWorkQueueViewFilters {
  query: string;
  sourceTypes: string[];
  lifecycles: string[];
  dueState: string;
  departmentIds: string[];
  queues: string[];
  accountableIds: string[];
  unassigned: boolean;
}

export interface OnboardingWorkQueueView {
  id: string;
  name: string;
  /**
   * The scope the view was saved at. Persisting it is NOT an authorization decision —
   * the server re-resolves scope on every request and 403s an unauthorised one, so a view
   * saved at 'all' by a manager simply fails to widen for a user who lacks the key.
   */
  scope: string;
  filters: OnboardingWorkQueueViewFilters;
  sortBy: OnboardingWorkQueueSortField;
  sortDir: 'asc' | 'desc';
  pageSize: number;
}

/** Same drop-don't-repair rule as the register: an entry without usable identity is discarded. */
export function sanitizeOnboardingWorkQueueViews(value: unknown): OnboardingWorkQueueView[] {
  if (!Array.isArray(value)) return [];
  const L = ONBOARDING_WORK_QUEUE_VIEW_LIMITS;
  const sortFields = new Set<string>(ONBOARDING_WORK_QUEUE_SORT_FIELDS);
  const dueStates = new Set<string>(ONBOARDING_WORK_QUEUE_DUE_STATES);
  const scopes = new Set<string>(ONBOARDING_WORK_QUEUE_SCOPES);
  const pageSizes = new Set<number>(ONBOARDING_WORK_QUEUE_PAGE_SIZES);
  const seen = new Set<string>();
  const views: OnboardingWorkQueueView[] = [];

  const bounded = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    const unique = new Set(v.filter(
      (item): item is string => typeof item === 'string' && item.length <= L.maxFilterValueLength,
    ));
    return Array.from(unique).slice(0, L.maxFilterValues);
  };
  /** Enum-valued facets are membership-checked, not just length-checked. */
  const enumerated = (v: unknown, allowed: readonly string[]): string[] => {
    const set = new Set<string>(allowed);
    return bounded(v).filter(item => set.has(item));
  };

  for (const candidate of value.slice(0, L.maxViews)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.slice(0, L.maxIdLength) : '';
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, L.maxNameLength) : '';
    if (!id || !name || seen.has(id)) continue;

    const raw = row.filters && typeof row.filters === 'object' && !Array.isArray(row.filters)
      ? row.filters as Record<string, unknown>
      : {};
    const pageSize = Number(row.pageSize);
    seen.add(id);
    views.push({
      id,
      name,
      scope: scopes.has(row.scope as string) ? row.scope as string : 'my',
      filters: {
        query: typeof raw.query === 'string' ? raw.query.slice(0, L.maxQueryLength) : '',
        sourceTypes: enumerated(raw.sourceTypes, ONBOARDING_WORK_QUEUE_SOURCE_TYPES),
        lifecycles: enumerated(raw.lifecycles, ONBOARDING_WORK_QUEUE_LIFECYCLES),
        dueState: dueStates.has(raw.dueState as string) ? raw.dueState as string : 'all',
        departmentIds: bounded(raw.departmentIds),
        queues: bounded(raw.queues),
        accountableIds: bounded(raw.accountableIds),
        unassigned: raw.unassigned === true,
      },
      sortBy: sortFields.has(row.sortBy as string) ? row.sortBy as OnboardingWorkQueueSortField : 'due_at',
      sortDir: row.sortDir === 'desc' ? 'desc' : 'asc',
      pageSize: pageSizes.has(pageSize) ? pageSize : 25,
    });
  }
  return views;
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
    // Same rule as the register's views: a non-empty payload that sanitises to nothing is
    // a malformed submission, not an instruction to clear the user's saved views.
    sanitize: value => {
      if (!Array.isArray(value)) return null;
      if (value.length > ONBOARDING_WORK_QUEUE_VIEW_LIMITS.maxViews) return null;
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
