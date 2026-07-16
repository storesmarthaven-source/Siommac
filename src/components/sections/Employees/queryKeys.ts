/**
 * src/components/sections/Employees/queryKeys.ts
 *
 * Centralised TanStack Query key factory for the Employees domain.
 *
 * Using a factory means:
 *   - Keys are type-safe and consistent across all components
 *   - Invalidation is scoped correctly (e.g. invalidate all employee queries
 *     by calling queryClient.invalidateQueries({ queryKey: employeeKeys.all }))
 *   - Refactoring key shapes only requires changes here
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

export const employeeKeys = {
  all:          ['employees']                          as const,
  lists:        () => [...employeeKeys.all, 'list']    as const,
  list:         () => [...employeeKeys.lists()]        as const,
  details:      () => [...employeeKeys.all, 'detail']  as const,
  detail:       (username: string) => [...employeeKeys.details(), username] as const,
} as const;

export const departmentKeys = {
  all:    ['departments']                              as const,
  lists:  () => [...departmentKeys.all, 'list']        as const,
  list:   () => [...departmentKeys.lists()]            as const,
  managers: () => [...departmentKeys.all, 'managers']  as const,
} as const;

// leaveKeys REMOVED — legacy leave query keys retired with the legacy leave system.
// Use 'hr-leave-my', 'hr-leave-all', 'hr-leave-stats' (from @api/hr/leave) instead.

export const historyKeys = {
  all:   ['history']                                   as const,
  mine:  (days: number) => [...historyKeys.all, 'mine', days] as const,
} as const;

// payslipKeys REMOVED — the legacy ESS payslips query is retired; the canonical
// Finance my-payslips query owns its own key (['finance','payroll','payslips','my']).

export const dashboardKeys = {
  adminStats:       ['dashboard', 'admin-stats']       as const,
  recentAttendance: ['dashboard', 'recent-attendance'] as const,
  deptStats:        (username: string) => ['dashboard', 'dept-stats', username]       as const,
  deptEmployees:    (username: string) => ['dashboard', 'dept-employees', username]   as const,
} as const;
