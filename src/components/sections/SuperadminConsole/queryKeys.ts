/**
 * src/components/sections/SuperadminConsole/queryKeys.ts
 *
 * Query-key factories for the superadmin console domain. Centralising keys here
 * keeps cache invalidation correct and discoverable.
 *
 * @see src/components/sections/Employees/queryKeys.ts (pattern reference)
 */

export const consoleKeys = {
  all:        ['superadmin'] as const,

  modules:    () => [...consoleKeys.all, 'modules'] as const,
  managers:   () => [...consoleKeys.all, 'managers'] as const,

  users:      () => [...consoleKeys.all, 'users'] as const,
  userPerms:  (userId: string) => [...consoleKeys.all, 'userPerms', userId] as const,

  sessions:   () => [...consoleKeys.all, 'sessions'] as const,
  audit:      (filters: unknown) => [...consoleKeys.all, 'audit', filters] as const,

  roles:      () => [...consoleKeys.all, 'roles'] as const,
  rolePerms:  (roleName: string) => [...consoleKeys.all, 'rolePerms', roleName] as const,

  approvals:  (status?: string) => [...consoleKeys.all, 'approvals', status ?? 'pending'] as const,
};
