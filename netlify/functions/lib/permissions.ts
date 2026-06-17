/**
 * netlify/functions/lib/permissions.ts
 *
 * Server-side RBAC: the authoritative permission catalogue + resolver.
 *
 * This MIRRORS the frontend catalogue in `src/lib/permissions.ts`. The frontend
 * copy gates UI affordances; THIS copy is the security boundary — it decides
 * whether a mutating request is allowed, regardless of what the client shows.
 *
 * Resolution order (first match wins):
 *   1. Per-user DB override (user_permissions.granted true/false)
 *   2. Role default (ROLE_PERMISSIONS)
 *   3. Deny
 *
 * The two catalogues are kept in sync by `tests/unit/permissions.sync.test.ts`,
 * which fails if the key sets or role defaults diverge.
 *
 * @see src/lib/permissions.ts
 * @see docs/SECURITY.md §3-RBAC
 */

import type { UserRole } from '../../../types/db';

// ── Permission key catalogue (format: resource.action) ────────────────────────
export const PERMISSION_KEYS = [
  'employees.view', 'employees.view_detail', 'employees.add', 'employees.edit',
  'employees.delete', 'employees.view_pay',
  'departments.view', 'departments.add', 'departments.edit', 'departments.delete',
  'attendance.view_own', 'attendance.view_all', 'attendance.edit', 'attendance.export',
  'leaves.view_own', 'leaves.submit', 'leaves.view_all', 'leaves.approve', 'leaves.delete',
  'payroll.view_own', 'payroll.view_all', 'payroll.run', 'payroll.approve', 'payroll.export',
  'hourly_rates.view', 'hourly_rates.edit',
  'sites.view', 'sites.add', 'sites.edit', 'sites.delete', 'sites.assign_employees',
  'map.view',
  'dashboard.view', 'reports.export',
  'settings.view', 'settings.edit', 'settings.statutory_rates',
  'permissions.manage',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

// ── Role defaults ─────────────────────────────────────────────────────────────
const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<PermissionKey>> = {
  employee: new Set<PermissionKey>([
    'attendance.view_own', 'leaves.view_own', 'leaves.submit', 'payroll.view_own',
    'dashboard.view',
  ]),
  manager: new Set<PermissionKey>([
    'attendance.view_own', 'attendance.view_all', 'attendance.export',
    'leaves.view_own', 'leaves.submit', 'leaves.view_all', 'leaves.approve',
    'payroll.view_own', 'employees.view', 'employees.view_detail',
    'departments.view', 'sites.view', 'map.view', 'dashboard.view', 'reports.export',
  ]),
  admin: new Set<PermissionKey>([
    'attendance.view_own', 'attendance.view_all', 'attendance.edit', 'attendance.export',
    'leaves.view_own', 'leaves.submit', 'leaves.view_all', 'leaves.approve', 'leaves.delete',
    'payroll.view_own', 'payroll.view_all', 'payroll.run', 'payroll.approve', 'payroll.export',
    'hourly_rates.view', 'hourly_rates.edit',
    'employees.view', 'employees.view_detail', 'employees.add', 'employees.edit',
    'employees.delete', 'employees.view_pay',
    'departments.view', 'departments.add', 'departments.edit', 'departments.delete',
    'sites.view', 'sites.add', 'sites.edit', 'sites.delete', 'sites.assign_employees',
    'map.view', 'dashboard.view', 'reports.export',
    'settings.view', 'settings.edit', 'settings.statutory_rates',
  ]),
  superadmin: new Set<PermissionKey>(PERMISSION_KEYS),  // everything, by definition
};

// ── Per-user override row (mirrors PermissionOverrideSchema) ──────────────────
export interface PermissionOverrideRow {
  permission: string;
  granted:    boolean;
}

/**
 * Resolve whether a permission is granted for a role + that user's overrides.
 *   1. user override (true → allow, false → deny)
 *   2. role default
 *   3. deny
 */
export function resolvePermission(
  key: string,
  role: UserRole,
  overrides: PermissionOverrideRow[],
): boolean {
  const override = overrides.find(o => o.permission === key);
  if (override !== undefined) return override.granted;
  return ROLE_PERMISSIONS[role]?.has(key as PermissionKey) ?? false;
}
