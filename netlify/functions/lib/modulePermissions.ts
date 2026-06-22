/**
 * netlify/functions/lib/modulePermissions.ts
 *
 * Static permission gate for module adapter layer.
 * Complements the DB-backed requirePermission() in lib/auth.ts — routes still
 * call the auth version first; this version is for programmatic checks within
 * adapter code (receivers, conditions, etc.) where there is no Hono context.
 */

export type PermissionKey =
  | 'hse.incidents.create'
  | 'hse.incidents.read'
  | 'hse.investigations.manage'
  | 'hse.capa.manage'
  | 'workflow.approve'
  | 'tickets.create'
  | 'tickets.manage'
  | 'messages.use'
  | 'reports.export'
  | 'audit.read'
  | 'hr.cases.manage'
  | 'payroll.runs.manage'
  | 'finance.costs.manage'
  | 'operations.workorders.manage';

type UserRole =
  | 'employee' | 'hse_staff' | 'hse_manager' | 'manager' | 'admin'
  | 'payroll_staff' | 'finance_staff' | 'operations_staff' | 'hr_staff';

const ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  employee: [
    'tickets.create', 'messages.use',
  ],
  hse_staff: [
    'hse.incidents.create', 'hse.incidents.read',
    'hse.investigations.manage', 'hse.capa.manage',
    'tickets.create', 'messages.use',
  ],
  hse_manager: [
    'hse.incidents.create', 'hse.incidents.read',
    'hse.investigations.manage', 'hse.capa.manage',
    'workflow.approve', 'tickets.create', 'messages.use', 'reports.export',
  ],
  manager: [
    'hse.incidents.read', 'workflow.approve',
    'tickets.create', 'messages.use', 'reports.export',
  ],
  admin: [
    'hse.incidents.create', 'hse.incidents.read',
    'hse.investigations.manage', 'hse.capa.manage',
    'workflow.approve', 'tickets.manage', 'messages.use',
    'reports.export', 'audit.read',
    'hr.cases.manage', 'payroll.runs.manage',
    'finance.costs.manage', 'operations.workorders.manage',
  ],
  payroll_staff:    ['payroll.runs.manage', 'tickets.create', 'messages.use'],
  finance_staff:    ['finance.costs.manage', 'tickets.create', 'messages.use', 'reports.export'],
  operations_staff: ['operations.workorders.manage', 'tickets.create', 'messages.use'],
  hr_staff:         ['hr.cases.manage', 'tickets.create', 'messages.use'],
};

export function hasModulePermission(roles: string[] | undefined, permission: PermissionKey): boolean {
  if (!roles?.length) return false;
  return roles.some(role => ROLE_PERMISSIONS[role as UserRole]?.includes(permission) ?? false);
}

export function assertModulePermission(roles: string[] | undefined, permission: PermissionKey): void {
  if (!hasModulePermission(roles, permission)) {
    const err = new Error(`Missing permission: ${permission}`);
    err.name = 'PermissionError';
    throw err;
  }
}
