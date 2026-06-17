/**
 * src/lib/permissions.ts
 *
 * Role-Based Access Control (RBAC) with per-user permission overrides.
 *
 * DESIGN (per docs/ARCHITECTURE.md §9-Authentication-&-Session):
 *   Resolution order (first match wins):
 *     1. Per-user DB override (granted: true/false)  ← highest priority
 *     2. Role defaults defined in ROLE_PERMISSIONS below
 *     3. Deny (false)                                 ← safe default
 *
 *   This means a superadmin can grant an employee access to a specific
 *   capability without changing their role, or revoke a capability from a
 *   manager without demoting them.
 *
 * PERMISSION KEY FORMAT: `resource.action`
 *   e.g. `employees.view`, `employees.add`, `leaves.approve`, `payroll.export`
 *   All valid keys are listed in the PERMISSION_KEYS constant below.
 *   Using an unregistered key logs a warning and returns false.
 *
 * USAGE:
 *   import { can } from '@lib/permissions';
 *
 *   // In a component (reads from store):
 *   if (can('employees.add')) { ... }
 *
 *   // With explicit role + overrides (e.g. tests):
 *   can('leaves.approve', { role: 'manager', overrides: [] })
 *
 * PERFORMANCE:
 *   The overrides array is loaded once at login and cached in the session store.
 *   `can()` is synchronous and O(n) on the overrides array — negligible at scale
 *   since a user will rarely have more than ~20 overrides.
 *
 * @see docs/ARCHITECTURE.md §9-Authentication-&-Session
 * @see docs/CODING_STANDARDS.md §7-State-Management-Rules
 * @see docs/SECURITY.md §3-RBAC
 * @see docs/PHASE_PLAN.md §Phase-2b
 */

import { logger } from '@lib/logger';
import { useSessionStore } from '@store/session';
import type { UserRole, PermissionOverride } from '@api/schemas/auth';

// ── Permission key catalogue ──────────────────────────────────────────────────

/**
 * All valid permission keys. Format: `resource.action`.
 *
 * Adding a new permission:
 *   1. Add the key string here.
 *   2. Add the appropriate role defaults to ROLE_PERMISSIONS.
 *   3. Update docs/SECURITY.md §RBAC with the description.
 */
export const PERMISSION_KEYS = [
  // ── Employees ───────────────────────────────────────────────────────────────
  'employees.view',         // see the employee list
  'employees.view_detail',  // see an individual employee's full profile
  'employees.add',          // create a new employee
  'employees.edit',         // edit employee details
  'employees.delete',       // deactivate an employee
  'employees.view_pay',     // see pay rates / payroll info

  // ── Departments ─────────────────────────────────────────────────────────────
  'departments.view',
  'departments.add',
  'departments.edit',
  'departments.delete',

  // ── Attendance ──────────────────────────────────────────────────────────────
  'attendance.view_own',    // see own attendance history
  'attendance.view_all',    // see all employees' attendance
  'attendance.edit',        // correct an attendance record
  'attendance.export',      // download CSV/PDF

  // ── Leave ───────────────────────────────────────────────────────────────────
  'leaves.view_own',        // see own leave requests
  'leaves.submit',          // submit a leave request
  'leaves.view_all',        // see all leave requests
  'leaves.approve',         // approve / reject a request
  'leaves.delete',          // hard-delete a request (admin only)

  // ── Payroll ─────────────────────────────────────────────────────────────────
  'payroll.view_own',       // see own payslips
  'payroll.view_all',       // see all payroll runs
  'payroll.run',            // create a payroll run
  'payroll.approve',        // approve a payroll run
  'payroll.export',         // download payroll reports

  // ── Hourly Rates ────────────────────────────────────────────────────────────
  'hourly_rates.view',
  'hourly_rates.edit',

  // ── Project Sites ────────────────────────────────────────────────────────────
  'sites.view',
  'sites.add',
  'sites.edit',
  'sites.delete',
  'sites.assign_employees',

  // ── Live Map ─────────────────────────────────────────────────────────────────
  'map.view',               // see the live employee map

  // ── Reports / Dashboard ──────────────────────────────────────────────────────
  'dashboard.view',
  'reports.export',

  // ── Settings ─────────────────────────────────────────────────────────────────
  'settings.view',
  'settings.edit',
  'settings.statutory_rates', // edit NIS / PAYE statutory constants

  // ── User management (superadmin) ─────────────────────────────────────────────
  'permissions.manage',     // grant / revoke per-user overrides
  'sessions.manage',        // view active sessions and force-revoke them
  'audit.view',             // view the audit log
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

// ── Role defaults ─────────────────────────────────────────────────────────────

/**
 * Default permissions for each role.
 * A role listed here grants ALL keys in its set by default.
 * Roles are additive downward — superadmin includes everything admin has, etc.
 *
 * Convention: list what the role CAN do, not what it cannot.
 */
export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<PermissionKey>> = {

  employee: new Set<PermissionKey>([
    'attendance.view_own',
    'leaves.view_own',
    'leaves.submit',
    'payroll.view_own',
    'dashboard.view',
  ]),

  manager: new Set<PermissionKey>([
    // Everything employee can do
    'attendance.view_own',
    'attendance.view_all',
    'attendance.export',
    'leaves.view_own',
    'leaves.submit',
    'leaves.view_all',
    'leaves.approve',
    'payroll.view_own',
    'employees.view',
    'employees.view_detail',
    'departments.view',
    'sites.view',
    'map.view',
    'dashboard.view',
    'reports.export',
  ]),

  admin: new Set<PermissionKey>([
    // Everything manager can do, plus:
    'attendance.view_own',
    'attendance.view_all',
    'attendance.edit',
    'attendance.export',
    'leaves.view_own',
    'leaves.submit',
    'leaves.view_all',
    'leaves.approve',
    'leaves.delete',
    'payroll.view_own',
    'payroll.view_all',
    'payroll.run',
    'payroll.approve',
    'payroll.export',
    'hourly_rates.view',
    'hourly_rates.edit',
    'employees.view',
    'employees.view_detail',
    'employees.add',
    'employees.edit',
    'employees.delete',
    'employees.view_pay',
    'departments.view',
    'departments.add',
    'departments.edit',
    'departments.delete',
    'sites.view',
    'sites.add',
    'sites.edit',
    'sites.delete',
    'sites.assign_employees',
    'map.view',
    'dashboard.view',
    'reports.export',
    'settings.view',
    'settings.edit',
    'settings.statutory_rates',
  ]),

  superadmin: new Set<PermissionKey>([
    // Everything — explicit list ensures PERMISSION_KEYS stays in sync
    'attendance.view_own',
    'attendance.view_all',
    'attendance.edit',
    'attendance.export',
    'leaves.view_own',
    'leaves.submit',
    'leaves.view_all',
    'leaves.approve',
    'leaves.delete',
    'payroll.view_own',
    'payroll.view_all',
    'payroll.run',
    'payroll.approve',
    'payroll.export',
    'hourly_rates.view',
    'hourly_rates.edit',
    'employees.view',
    'employees.view_detail',
    'employees.add',
    'employees.edit',
    'employees.delete',
    'employees.view_pay',
    'departments.view',
    'departments.add',
    'departments.edit',
    'departments.delete',
    'sites.view',
    'sites.add',
    'sites.edit',
    'sites.delete',
    'sites.assign_employees',
    'map.view',
    'dashboard.view',
    'reports.export',
    'settings.view',
    'settings.edit',
    'settings.statutory_rates',
    'permissions.manage',
    'sessions.manage',
    'audit.view',
  ]),
};

// ── Context type ──────────────────────────────────────────────────────────────

export interface PermissionContext {
  role:      UserRole;
  overrides: PermissionOverride[];
}

// ── Core resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve whether a permission is granted for a given context.
 *
 * Resolution order (first match wins):
 *   1. DB override (granted: true → allow, granted: false → deny)
 *   2. Role default
 *   3. Deny
 */
export function resolvePermission(
  key: string,
  ctx: PermissionContext,
): boolean {
  // Warn on unknown keys — catches typos at dev time (P4: fail loudly in dev)
  if (import.meta.env.DEV && !(PERMISSION_KEYS as readonly string[]).includes(key)) {
    logger.warn(`[permissions] Unknown permission key: "${key}"`, { key, role: ctx.role });
  }

  // 1. Check per-user overrides first (highest priority)
  const override = ctx.overrides.find((o) => o.permission === key);
  if (override !== undefined) {
    return override.granted;
  }

  // 2. Check role defaults
  const roleSet = ROLE_PERMISSIONS[ctx.role];
  return roleSet?.has(key as PermissionKey) ?? false;
}

/** Whether a role grants a permission by default (ignoring per-user overrides). */
export function roleDefaultGranted(role: UserRole, key: string): boolean {
  return ROLE_PERMISSIONS[role]?.has(key as PermissionKey) ?? false;
}

/** Tri-state source of a permission for the grant-matrix UI. */
export type PermissionState = 'default' | 'grant' | 'deny';

/**
 * Classify a permission for one user as default (no override), explicit grant,
 * or explicit deny — used by the superadmin permission matrix.
 */
export function permissionState(
  key: string,
  overrides: PermissionOverride[],
): PermissionState {
  const override = overrides.find(o => o.permission === key);
  if (override === undefined) return 'default';
  return override.granted ? 'grant' : 'deny';
}

/** Permission keys grouped by their `resource` prefix, in catalogue order. */
export function permissionGroups(): { resource: string; keys: PermissionKey[] }[] {
  const groups: { resource: string; keys: PermissionKey[] }[] = [];
  for (const key of PERMISSION_KEYS) {
    const resource = key.split('.')[0] ?? key;
    let group = groups.find(g => g.resource === resource);
    if (!group) { group = { resource, keys: [] }; groups.push(group); }
    group.keys.push(key);
  }
  return groups;
}

// ── Store-integrated shorthand ────────────────────────────────────────────────

/**
 * Check a permission using the current session store state.
 *
 * This is the preferred API for components:
 *   import { can } from '@lib/permissions';
 *   if (can('employees.add')) { ... }
 */
export function can(key: string): boolean {
  const state = useSessionStore.getState();
  if (!state.role) return false;
  return resolvePermission(key, {
    role:      state.role,
    overrides: state.permissionOverrides,
  });
}

/**
 * React/Preact hook variant — subscribes to store changes.
 * Use this inside components so they re-render when permissions change.
 *
 *   const canApprove = useCan('leaves.approve');
 */
export function useCan(key: string): boolean {
  return useSessionStore((s) => {
    if (!s.role) return false;
    return resolvePermission(key, { role: s.role, overrides: s.permissionOverrides });
  });
}
