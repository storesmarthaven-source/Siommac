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
import { sb } from './db';

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
  'sessions.manage',
  'audit.view',
  'roles.manage',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

// ── Role defaults ─────────────────────────────────────────────────────────────
// Source of truth for role→permissions is now the `role_permissions` table
// (phase 12). This constant is the SEED + a safe fallback used only if the DB
// is unreachable or a role has no rows yet. The sync test asserts it still
// mirrors the frontend catalogue.
const ROLE_PERMISSIONS: Record<string, ReadonlySet<PermissionKey>> = {
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
 * Resolve a permission against a PRE-LOADED role permission set + user overrides.
 *   1. user override (true → allow, false → deny)
 *   2. role default (the loaded set)
 *   3. deny
 * Pure + synchronous — the role set is loaded once (loadRolePermissions) by the
 * caller, so this can also be unit-tested without a DB.
 */
export function resolveWithSet(
  key: string,
  roleSet: ReadonlySet<string>,
  overrides: PermissionOverrideRow[],
): boolean {
  const override = overrides.find(o => o.permission === key);
  if (override !== undefined) return override.granted;
  return roleSet.has(key);
}

/**
 * @deprecated Use loadRolePermissions + resolveWithSet. Kept for the hardcoded
 * fallback path and existing tests. Resolves against ROLE_PERMISSIONS_FALLBACK.
 */
export function resolvePermission(
  key: string,
  role: UserRole,
  overrides: PermissionOverrideRow[],
): boolean {
  const set = ROLE_PERMISSIONS[role] ?? new Set<PermissionKey>();
  return resolveWithSet(key, set as ReadonlySet<string>, overrides);
}

// ── Role permission set: DB-backed with a short cache ─────────────────────────
const ROLE_CACHE_TTL_MS = 30_000;
const _roleCache = new Map<string, { set: Set<string>; at: number }>();

/** Invalidate the cached permission set for a role (call after edits). */
export function invalidateRolePermissions(roleName?: string): void {
  if (roleName) _roleCache.delete(roleName);
  else _roleCache.clear();
}

/**
 * Load a role's effective default permission set from `role_permissions`.
 * superadmin is allow-all by definition. Falls back to the hardcoded seed if
 * the table is empty/unreachable for a built-in role, so the app degrades
 * safely rather than locking everyone out.
 */
export async function loadRolePermissions(roleName: string): Promise<Set<string>> {
  if (roleName === 'superadmin') return new Set<string>(PERMISSION_KEYS);

  const cached = _roleCache.get(roleName);
  if (cached && Date.now() - cached.at < ROLE_CACHE_TTL_MS) return cached.set;

  let set: Set<string>;
  try {
    const { data, error } = await sb
      .from('role_permissions')
      .select('permission')
      .eq('role_name', roleName);
    if (error) throw error;
    if (data && data.length > 0) {
      set = new Set(data.map(r => r.permission as string));
    } else {
      // No rows — fall back to the seed for built-ins; empty for unknown custom.
      set = new Set<string>(ROLE_PERMISSIONS[roleName] ?? []);
    }
  } catch {
    set = new Set<string>(ROLE_PERMISSIONS[roleName] ?? []);
  }
  _roleCache.set(roleName, { set, at: Date.now() });
  return set;
}
