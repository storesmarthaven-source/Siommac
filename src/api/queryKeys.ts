/**
 * src/api/queryKeys.ts
 *
 * Global TanStack Query key registry.
 *
 * WHY CENTRALISED:
 *   Having per-domain key files (Employees/queryKeys.ts, Attendance/queryKeys.ts…)
 *   is fine for isolation, but cross-domain invalidations (e.g. a leave approval
 *   invalidates both leaves AND the dashboard stats) require both modules to be
 *   imported. A global registry lets the Realtime event handler invalidate any
 *   domain with a single import.
 *
 * NAMING CONVENTION:
 *   <domain>Keys — e.g. attendanceKeys, employeeKeys
 *   Each factory follows the TanStack recommended hierarchy:
 *     all       — ['domain']                   ← invalidates everything in domain
 *     lists()   — ['domain', 'list']
 *     list(f)   — ['domain', 'list', filter]   ← scoped to specific filter
 *     details() — ['domain', 'detail']
 *     detail(id)— ['domain', 'detail', id]
 *
 * Re-exports the per-domain keys from section queryKeys files so callers can
 * import from a single location.
 *
 * @see docs/ARCHITECTURE.md §TanStack-Query
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

// ── Employees ─────────────────────────────────────────────────────────────────

export const employeeKeys = {
  all:      ['employees']                                  as const,
  lists:    () => [...employeeKeys.all,    'list']         as const,
  list:     () => [...employeeKeys.lists()]                as const,
  details:  () => [...employeeKeys.all,    'detail']       as const,
  detail:   (id: string) => [...employeeKeys.details(), id] as const,
} as const;

// ── Departments ───────────────────────────────────────────────────────────────

export const departmentKeys = {
  all:      ['departments']                                as const,
  lists:    () => [...departmentKeys.all, 'list']          as const,
  list:     () => [...departmentKeys.lists()]              as const,
  managers: () => [...departmentKeys.all, 'managers']      as const,
} as const;

// ── Attendance ────────────────────────────────────────────────────────────────

export const attendanceKeys = {
  all:      ['attendance']                                 as const,
  lists:    () => [...attendanceKeys.all, 'list']          as const,
  /** Monthly log — filter: { month, year } or { dateFrom, dateTo } */
  list:     (filter: Record<string, unknown>) => [...attendanceKeys.lists(), filter] as const,
  daily:    () => [...attendanceKeys.all, 'daily']         as const,
  /** Today's check-in status for the current user */
  today:    (username: string) => [...attendanceKeys.daily(), username] as const,
  live:     () => [...attendanceKeys.all, 'live']          as const,
} as const;

// ── Leave ─────────────────────────────────────────────────────────────────────

export const leaveKeys = {
  all:     ['leaves']                                      as const,
  mine:    () => [...leaveKeys.all,    'mine']             as const,
  manager: (username: string) => [...leaveKeys.all, 'manager', username] as const,
  admin:   () => [...leaveKeys.all,    'admin']            as const,
} as const;

// ── Payroll ───────────────────────────────────────────────────────────────────

export const payrollKeys = {
  all:     ['payroll']                                     as const,
  runs:    () => [...payrollKeys.all,  'runs']             as const,
  run:     (id: string) => [...payrollKeys.runs(), id]     as const,
  mine:    () => [...payrollKeys.all,  'mine']             as const,
} as const;

// ── Payslips ──────────────────────────────────────────────────────────────────

export const payslipKeys = {
  all:    ['payslips']                                     as const,
  mine:   () => [...payslipKeys.all,  'mine']              as const,
} as const;

// ── Hourly Rates ──────────────────────────────────────────────────────────────

export const hourlyRateKeys = {
  all:    ['hourly-rates']                                 as const,
  lists:  () => [...hourlyRateKeys.all, 'list']            as const,
  list:   () => [...hourlyRateKeys.lists()]                as const,
  user:   (username: string) => [...hourlyRateKeys.all, 'user', username] as const,
} as const;

// ── Project Sites ─────────────────────────────────────────────────────────────

export const siteKeys = {
  all:     ['sites']                                       as const,
  lists:   () => [...siteKeys.all, 'list']                 as const,
  list:    () => [...siteKeys.lists()]                     as const,
  detail:  (id: string) => [...siteKeys.all, 'detail', id] as const,
  members: (id: string) => [...siteKeys.all, 'members', id] as const,
  live:    () => [...siteKeys.all, 'live']                 as const,
} as const;

// ── Profile ───────────────────────────────────────────────────────────────────

export const profileKeys = {
  all:    ['profile']                                      as const,
  mine:   () => [...profileKeys.all, 'mine']               as const,
} as const;

// ── Settings ──────────────────────────────────────────────────────────────────

export const settingsKeys = {
  all:    ['settings']                                     as const,
  map:    () => [...settingsKeys.all, 'map']               as const,
} as const;

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const dashboardKeys = {
  all:              ['dashboard']                          as const,
  adminStats:       ['dashboard', 'admin-stats']           as const,
  recentAttendance: ['dashboard', 'recent-attendance']     as const,
  deptStats:        (username: string) => ['dashboard', 'dept-stats',      username] as const,
  deptEmployees:    (username: string) => ['dashboard', 'dept-employees',  username] as const,
} as const;

// ── History ───────────────────────────────────────────────────────────────────

export const historyKeys = {
  all:    ['history']                                      as const,
  mine:   (days: number) => [...historyKeys.all, 'mine', days] as const,
} as const;

// ── Notifications ─────────────────────────────────────────────────────────────

export const notificationKeys = {
  all:         ['notifications']                                       as const,
  mine:        (filters?: unknown) =>
    (filters === undefined
      ? [...notificationKeys.all, 'mine'] as const
      : [...notificationKeys.all, 'mine', filters] as const),
  unread:      () => [...notificationKeys.all, 'unread']               as const,
  preferences: () => [...notificationKeys.all, 'preferences']         as const,
} as const;

// ── Messages ──────────────────────────────────────────────────────────────────

export const messageKeys = {
  all:        ['messages']                                                         as const,
  /** All thread lists — invalidates both inbox and sent (used for broad invalidation). */
  threads:    (filters?: Record<string, unknown>) =>
    (filters === undefined
      ? [...messageKeys.all, 'threads'] as const
      : [...messageKeys.all, 'threads', filters] as const),
  thread:     (id: string) => [...messageKeys.all, 'thread', id]                  as const,
  posts:      (threadId: string) => [...messageKeys.all, 'posts', threadId]       as const,
  recipients: (query?: string) => [...messageKeys.all, 'recipients', query ?? ''] as const,
  search:     (query: string) => [...messageKeys.all, 'search', query]            as const,
  /** Legacy compat — some older hooks used these; keep until messages.test.ts is updated. */
  inbox:      () => [...messageKeys.all, 'threads']                               as const,
  sent:       () => [...messageKeys.all, 'threads', { tab: 'sent' }]             as const,
  unread:     () => [...messageKeys.all, 'threads', { tab: 'unread' }]           as const,
} as const;

// ── Tickets ───────────────────────────────────────────────────────────────────

export const ticketKeys = {
  all:      ['tickets']                                    as const,
  mine:     () => [...ticketKeys.all, 'mine']              as const,
  admin:    () => [...ticketKeys.all, 'admin']             as const,
  detail:   (id: string) => [...ticketKeys.all, 'detail', id] as const,
} as const;

// ── Communications ────────────────────────────────────────────────────────────

export const communicationKeys = {
  all:     ['communications']                  as const,
  summary: () => ['communications', 'summary'] as const,
} as const;

// ── Workflows ─────────────────────────────────────────────────────────────────

export const workflowKeys = {
  all:    ['workflows']                                              as const,
  lists:  () => [...workflowKeys.all, 'list']                       as const,
  list:   (f: Record<string, unknown>) => [...workflowKeys.lists(), f] as const,
  detail: (id: string) => [...workflowKeys.all, 'detail', id]       as const,
  tasks:  () => [...workflowKeys.all, 'tasks']                      as const,
} as const;

// ── Handoffs ──────────────────────────────────────────────────────────────────

export const handoffKeys = {
  all:  ['handoffs']                                                 as const,
  list: (f: Record<string, unknown>) => ['handoffs', 'list', f]     as const,
} as const;

// ── HSE — Incidents / Investigations / CAPA ───────────────────────────────────

// ── HSE — Permits to Work (PTW) ───────────────────────────────────────────────

export const ptwKeys = {
  all:       ['hse-ptw']                                                            as const,
  lists:     () => [...ptwKeys.all, 'list']                                         as const,
  list:      (f: Record<string, unknown>) => [...ptwKeys.lists(), f]                as const,
  details:   () => [...ptwKeys.all, 'detail']                                       as const,
  detail:    (id: string) => [...ptwKeys.details(), id]                             as const,
  stats:     () => [...ptwKeys.all, 'stats']                                        as const,
  types:     () => [...ptwKeys.all, 'types']                                        as const,
  templates: (f?: Record<string, unknown>) =>
    (f === undefined
      ? [...ptwKeys.all, 'templates'] as const
      : [...ptwKeys.all, 'templates', f] as const),
} as const;

// ── HSE — Incidents / Investigations / CAPA ───────────────────────────────────

export const hseIncidentKeys = {
  all:          ['hse-incidents']                                                         as const,
  lists:        () => [...hseIncidentKeys.all, 'list']                                    as const,
  list:         (f: Record<string, unknown>) => [...hseIncidentKeys.lists(), f]           as const,
  details:      () => [...hseIncidentKeys.all, 'detail']                                  as const,
  detail:       (id: string) => [...hseIncidentKeys.details(), id]                        as const,
  fullDetails:  () => [...hseIncidentKeys.all, 'full-detail']                             as const,
  fullDetail:   (id: string) => [...hseIncidentKeys.fullDetails(), id]                    as const,
  investigations: (incidentId: string) => [...hseIncidentKeys.all, 'inv', incidentId]    as const,
  capaLists:    () => [...hseIncidentKeys.all, 'capa']                                    as const,
  capaList:     (f: Record<string, unknown>) => [...hseIncidentKeys.capaLists(), f]       as const,
  kpis:         () => ['hse-kpis']                                                        as const,
} as const;
