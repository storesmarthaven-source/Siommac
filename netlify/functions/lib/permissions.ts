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
  // ── HSE module ──────────────────────────────────────────────────────────────
  'hse.incidents.view',    'hse.incidents.manage',
  'hse.incidents.create',  // submit a new incident report (distinct from manage)
  'hse.investigations.manage', // manage investigation records
  'hse.risk.view',         'hse.risk.manage',
  'hse.risk.approve',      // approve risk assessments
  'hse.risk.library.manage',
  // ── PTW (Permit-to-Work) ───────────────────────────────────────────────────
  'hse.ptw.view',          // view permits in the register
  'hse.ptw.create',        // create / draft a new permit
  'hse.ptw.approve',       // approve a submitted permit
  'hse.ptw.activate',      // activate an approved permit (on-site gate)
  'hse.ptw.manage',        // admin actions: extend, close, cancel, void
  // ── CAPA ──────────────────────────────────────────────────────────────────
  'hse.capa.view',         // see CAPAs (own actions for non-managers; all for manager+)
  'hse.capa.manage',       // manage corrective/preventive actions
  'hse.inspections.view',  'hse.inspections.manage', 'hse.inspections.create', 'hse.inspections.review',
  'hse.training.view',     'hse.training.manage', 'hse.training.verify',
  'hse.toolbox.view',      'hse.toolbox.manage',
  'hse.documents.view',    'hse.documents.manage',
  'hse.contractors.view',  'hse.contractors.manage',
  'hse.legal.view',        'hse.legal.manage',
  'hse.emergency.view',    'hse.emergency.manage',
  'hse.environmental.view','hse.environmental.manage',
  'hse.ppe.view',          'hse.ppe.manage',
  'hse.dashboard.view',
  'hse.workflows.view',    'hse.workflows.manage',
  // ── Platform workflow ────────────────────────────────────────────────────────
  'workflow.submit', 'workflow.approve', 'workflow.audit',
  'workflow.view',         // view workflow tasks and status
  // ── Communications / Messaging (participant-default; NO broad read-all key) ────
  'communications.view',
  'communications.thread_create',
  'communications.thread_manage_own',
  'communications.record_thread_read',
  'communications.moderate',
  'communications.admin',
  'communications.compliance_read',
  'communications.compliance_export',
  // Granular message/participant capabilities (rich Message Center add-on)
  'communications.messages.post',
  'communications.messages.attach',
  'communications.messages.download_attachment',
  'communications.messages.delete_own_attachment',
  'communications.messages.pin_own',
  'communications.messages.pin_thread',
  'communications.messages.unpin_own',
  'communications.messages.unpin_any',
  'communications.participants.add',
  'communications.participants.remove',
  'communications.participants.change_role',
  // ── Tickets ────────────────────────────────────────────────────────────────
  'tickets.manage',        // create, assign, resolve, and close support/work tickets
  // ── Account Security (admin cross-user management) ──────────────────────────
  'auth.security.view',          // view another user's security status (MFA, passkeys, trusted devices)
  'auth.security.manage_policy', // update the organisation-wide security policy
  'auth.passkeys.admin_revoke',  // revoke all passkeys for another user (admin action)
  'auth.trusted_devices.admin_revoke', // revoke all trusted devices for another user (admin action)
  // ── HR (people backbone) ─────────────────────────────────────────────────────
  'hr.view',
  'hr.dashboard.view',
  'hr.audit.view',
  'hr.settings.view',
  'hr.settings.manage',
  'hr.employees.view',
  'hr.employees.create',
  'hr.employees.update',
  'hr.employees.status_change',
  'hr.employees.transfer',
  'hr.employees.role_change',
  'hr.employees.supervisor_change',
  'hr.employees.sensitive_view',
  'hr.employees.statutory.view',
  'hr.employees.statutory.update',
  'hr.employees.payroll_readiness.view',
  'hr.employees.restricted_contact.update',
  'hr.employees.import',
  'hr.employees.import.upload',
  'hr.employees.import.map',
  'hr.employees.import.validate',
  'hr.employees.import.commit',
  'hr.employees.import.report.download',
  'hr.onboarding.view',
  'hr.onboarding.start',
  'hr.onboarding.task.manage',
  'hr.onboarding.cancel',
  'hr.onboarding.case.manage',
  'hr.onboarding.complete',
  'hr.onboarding.audit.view',
  'hr.onboarding.custom_actions.view',
  'hr.onboarding.custom_actions.create',
  'hr.onboarding.custom_actions.update',
  'hr.onboarding.custom_actions.retire',
  'hr.onboarding.custom_actions.case_add',
  'hr.onboarding.custom_actions.case_update',
  'hr.onboarding.custom_actions.case_complete',
  'hr.onboarding.custom_actions.case_cancel',
  'hr.onboarding.provision_account',
  'hr.organization.view',
  'hr.organization.manage',
  'hr.positions.view',
  'hr.positions.manage',
  'hr.employee_documents.view',
  'hr.employee_documents.upload',
  'hr.employee_documents.verify',
  'hr.employee_documents.archive',
  'hr.employee_documents.download',
  'hr.employee_documents.sensitive_view',
  // ── Settings & Preferences (Spec §8) ─────────────────────────────────────────
  'settings.manage',
  'settings.own_preferences.view',
  'settings.own_preferences.manage',
  'settings.user_preferences.view',
  'settings.user_preferences.manage',
  'settings.global.view',
  'settings.global.manage',
  'settings.system.view',
  'settings.system.manage',
  'settings.critical.view',
  'settings.critical.manage',
  'settings.security.view',
  'settings.security.manage',
  'settings.notification_policy.view',
  'settings.notification_policy.manage',
  'settings.message_policy.view',
  'settings.message_policy.manage',
  'settings.workflow.view',
  'settings.workflow.manage',
  'settings.file_policy.view',
  'settings.file_policy.manage',
  'settings.audit_policy.view',
  'settings.audit_policy.manage',
  'settings.safety_rules.view',
  'settings.safety_rules.manage',
  'settings.notifications.view',
  'settings.notifications.manage',
  'settings.messages.view',
  'settings.messages.manage',
  'settings.files.view',
  'settings.files.manage',
  'settings.employees.view',
  'settings.employees.manage',
  'settings.incidents.view',
  'settings.incidents.manage',
  'settings.investigations.view',
  'settings.investigations.manage',
  'settings.capa.view',
  'settings.capa.manage',
  'settings.jsa.view',
  'settings.jsa.manage',
  'settings.ptw.view',
  'settings.ptw.manage',
  'settings.inspections.view',
  'settings.inspections.manage',
  'settings.training.view',
  'settings.training.manage',
  'settings.documents.view',
  'settings.documents.manage',
  'settings.sds.view',
  'settings.sds.manage',
  'settings.ppe.view',
  'settings.ppe.manage',
  'settings.command_center.view',
  'settings.command_center.manage',
  'settings.admin.view',
  'settings.admin.manage',
  'settings.manifests.view',
  'settings.manifests.create',
  'settings.manifests.update',
  'settings.manifests.submit',
  'settings.manifests.review',
  'settings.manifests.approve',
  'settings.manifests.return',
  'settings.manifests.deprecate',
  'settings.manifests.review.product',
  'settings.manifests.review.module_owner',
  'settings.manifests.review.engineering',
  'settings.manifests.review.super_admin',
  'settings.manifests.review.compliance',
  'settings.manifests.review.hse',
  'settings.manifests.review.security',
  'communications.participants.remove_required',
  'notifications.required_delivery.manage',
  // ── Central Workflow Engine (Spec §22) ───────────────────────────────────────
  'workflow.dashboard.view',
  'workflow.my_tasks.view',
  'workflow.register.view',
  'workflow.tasks.approve',
  'workflow.tasks.return',
  'workflow.tasks.reject',
  'workflow.tasks.delegate',
  'workflow.instances.view',
  'workflow.instances.reassign',
  'workflow.instances.escalate',
  'workflow.instances.cancel',
  'workflow.instances.admin_override',
  'workflow.instances.migrate',
  'workflow.templates.view',
  'workflow.templates.create',
  'workflow.templates.update',
  'workflow.templates.publish',
  'workflow.templates.clone',
  'workflow.templates.deprecate',
  'workflow.bindings.view',
  'workflow.bindings.create',
  'workflow.bindings.update',
  'workflow.bindings.activate',
  'workflow.bindings.deactivate',
  'workflow.handoffs.view',
  'workflow.handoffs.retry',
  'workflow.handoffs.cancel',
  'workflow.audit.view',
  'workflow.audit.export',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

// ── Critical-grant keys (require dual superadmin approval) ──────────────────
/**
 * Permission keys that are so sensitive that granting them (effect=allow) to any
 * role or user requires a SECOND superadmin to approve before they take effect.
 * Revokes and deny-overrides are never intercepted — only grants are gated.
 */
export const CRITICAL_GRANT_KEYS = new Set<string>([
  'communications.compliance_read',
  'communications.compliance_export',
  'auth.security.manage_policy',
  'auth.passkeys.admin_revoke',
  'auth.trusted_devices.admin_revoke',
  'permissions.manage',
  'roles.manage',
  'communications.admin',
]);

/** Returns true when granting this permission key requires dual-superadmin approval. */
export function isCriticalGrant(key: string): boolean {
  return CRITICAL_GRANT_KEYS.has(key);
}

// ── Role defaults ─────────────────────────────────────────────────────────────
// Source of truth for role→permissions is now the `role_permissions` table
// (phase 12). This constant is the SEED + a safe fallback used only if the DB
// is unreachable or a role has no rows yet. The sync test asserts it still
// mirrors the frontend catalogue.
const ROLE_PERMISSIONS: Record<string, ReadonlySet<PermissionKey>> = {
  employee: new Set<PermissionKey>([
    'attendance.view_own', 'leaves.view_own', 'leaves.submit', 'payroll.view_own',
    'dashboard.view',
    'hse.incidents.view', 'hse.capa.view', 'hse.risk.view', 'hse.ptw.view', 'hse.inspections.view',
    'hse.training.view',  'hse.toolbox.view', 'hse.documents.view', 'hse.contractors.view',
    'hse.legal.view',     'hse.emergency.view', 'hse.environmental.view', 'hse.ppe.view',
    'hse.dashboard.view', 'hse.workflows.view',
    'workflow.submit', 'workflow.view',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.unpin_own',
    'communications.participants.add', 'communications.participants.remove',
  ]),
  manager: new Set<PermissionKey>([
    'attendance.view_own', 'attendance.view_all', 'attendance.export',
    'leaves.view_own', 'leaves.submit', 'leaves.view_all', 'leaves.approve',
    'payroll.view_own', 'employees.view', 'employees.view_detail',
    'sites.view', 'map.view', 'dashboard.view', 'reports.export',
    'hse.incidents.view', 'hse.incidents.manage', 'hse.incidents.create',
    'hse.investigations.manage',
    'hse.risk.view',      'hse.risk.manage', 'hse.risk.approve',
    'hse.risk.library.manage',
    'hse.ptw.view',       'hse.ptw.create', 'hse.ptw.approve', 'hse.ptw.activate', 'hse.ptw.manage',
    'hse.capa.view',
    'hse.capa.manage',
    'hse.inspections.view','hse.inspections.manage',
    'hse.training.view',  'hse.training.manage',
    'hse.toolbox.view',   'hse.toolbox.manage',
    'hse.documents.view', 'hse.documents.manage',
    'hse.contractors.view','hse.contractors.manage',
    'hse.legal.view',     'hse.emergency.view',   'hse.emergency.manage',
    'hse.environmental.view','hse.environmental.manage',
    'hse.ppe.view',       'hse.ppe.manage',
    'hse.dashboard.view', 'hse.workflows.view', 'hse.workflows.manage',
    'workflow.submit', 'workflow.approve', 'workflow.audit', 'workflow.view',
    'tickets.manage',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.record_thread_read',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.pin_thread',
    'communications.messages.unpin_own', 'communications.messages.unpin_any',
    'communications.participants.add', 'communications.participants.remove',
    'communications.participants.change_role',
    'auth.security.view',
  ]),
  admin: new Set<PermissionKey>([
    'attendance.view_own', 'attendance.view_all', 'attendance.edit', 'attendance.export',
    'leaves.view_own', 'leaves.submit', 'leaves.view_all', 'leaves.approve', 'leaves.delete',
    'payroll.view_own', 'payroll.view_all', 'payroll.run', 'payroll.approve', 'payroll.export',
    'hourly_rates.view', 'hourly_rates.edit',
    'employees.view', 'employees.view_detail', 'employees.add', 'employees.edit',
    'employees.delete', 'employees.view_pay',
    // departments.* are superadmin-only — no admin/manager department access.
    'sites.view', 'sites.add', 'sites.edit', 'sites.delete', 'sites.assign_employees',
    'map.view', 'dashboard.view', 'reports.export',
    'settings.view', 'settings.edit', 'settings.statutory_rates',
    'hse.incidents.view', 'hse.incidents.manage', 'hse.incidents.create',
    'hse.investigations.manage',
    'hse.risk.view',      'hse.risk.manage', 'hse.risk.approve',
    'hse.risk.library.manage',
    'hse.ptw.view',       'hse.ptw.create', 'hse.ptw.approve', 'hse.ptw.activate', 'hse.ptw.manage',
    'hse.capa.view',
    'hse.capa.manage',
    'hse.inspections.view','hse.inspections.manage',
    'hse.training.view',  'hse.training.manage',
    'hse.toolbox.view',   'hse.toolbox.manage',
    'hse.documents.view', 'hse.documents.manage',
    'hse.contractors.view','hse.contractors.manage',
    'hse.legal.view',     'hse.legal.manage',
    'hse.emergency.view', 'hse.emergency.manage',
    'hse.environmental.view','hse.environmental.manage',
    'hse.ppe.view',       'hse.ppe.manage',
    'hse.dashboard.view', 'hse.workflows.view', 'hse.workflows.manage',
    'workflow.submit', 'workflow.approve', 'workflow.audit', 'workflow.view',
    'tickets.manage',
    'communications.view', 'communications.thread_create', 'communications.thread_manage_own',
    'communications.record_thread_read', 'communications.moderate', 'communications.admin',
    'communications.messages.post', 'communications.messages.attach',
    'communications.messages.download_attachment', 'communications.messages.delete_own_attachment',
    'communications.messages.pin_own', 'communications.messages.pin_thread',
    'communications.messages.unpin_own', 'communications.messages.unpin_any',
    'communications.participants.add', 'communications.participants.remove',
    'communications.participants.change_role',
    'auth.security.view', 'auth.security.manage_policy',
    'auth.passkeys.admin_revoke', 'auth.trusted_devices.admin_revoke',
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

/**
 * Whether a role is a "clocking employee" (gets the self-service Personal
 * sections). superadmin is never an employee. Defaults true if the row is
 * missing, so existing users keep their self-service.
 */
export async function loadRoleIsEmployee(roleName: string): Promise<boolean> {
  if (roleName === 'superadmin') return false;
  try {
    const { data } = await sb.from('roles').select('is_employee').eq('name', roleName).maybeSingle<{ is_employee: boolean }>();
    return data ? data.is_employee : true;
  } catch {
    return true;
  }
}

// ── Department data-scoping (phase 13) ────────────────────────────────────────

export type RoleScope = 'own' | 'all';
const _scopeCache = new Map<string, { scope: RoleScope; at: number }>();

/** Invalidate a role's cached scope (call after editing it). */
export function invalidateRoleScope(roleName?: string): void {
  if (roleName) _scopeCache.delete(roleName);
  else _scopeCache.clear();
}

/**
 * A role's data scope: 'all' (org-wide) or 'own' (own department only).
 * superadmin/admin default to 'all'; everything else defaults to 'own' — the
 * safe default if the column/row is missing.
 */
export async function loadRoleScope(roleName: string): Promise<RoleScope> {
  if (roleName === 'superadmin' || roleName === 'admin') return 'all';
  const cached = _scopeCache.get(roleName);
  if (cached && Date.now() - cached.at < ROLE_CACHE_TTL_MS) return cached.scope;
  let scope: RoleScope = 'own';
  try {
    const { data } = await sb.from('roles').select('scope').eq('name', roleName).maybeSingle<{ scope: string }>();
    scope = data?.scope === 'all' ? 'all' : 'own';
  } catch { /* default own */ }
  _scopeCache.set(roleName, { scope, at: Date.now() });
  return scope;
}

export type DeptScope = { all: true } | { all: false; departmentId: string };

/**
 * Resolve the caller's department scope for a request. The single source of
 * truth for "whose records can this user see". Org-wide roles → { all: true };
 * department-bound roles → { all: false, departmentId }. A scoped user with no
 * department is restricted to an impossible id (sees nothing but their own).
 */
export async function deptScopeFilter(actor: { role: string; department_id?: string | null }): Promise<DeptScope> {
  const scope = await loadRoleScope(actor.role);
  if (scope === 'all') return { all: true };
  return { all: false, departmentId: actor.department_id ?? '__none__' };
}

/**
 * Throw 403 if a scoped caller tries to act on a record outside their
 * department. Org-wide callers always pass. A null target dept (unassigned)
 * is treated as in-scope for everyone (e.g. unassigned project sites).
 */
export async function assertInScope(
  actor: { role: string; department_id?: string | null },
  targetDepartmentId: string | null | undefined,
): Promise<void> {
  const s = await deptScopeFilter(actor);
  if (s.all) return;
  if (targetDepartmentId == null) return;            // unassigned → visible to all
  if (targetDepartmentId !== s.departmentId) {
    throw Object.assign(new Error('Forbidden: outside your department'), { status: 403 });
  }
}
