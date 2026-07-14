/**
 * src/lib/superadminApi.ts
 *
 * Typed API calls for the superadmin console: per-user permission overrides, per-role
 * permission grants, sessions, audit, and approvals. Module access is governed by the
 * permission catalogue — there is no module-matrix API any more.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { apiFetch } from '@lib/api';

// ── Permissions: per-user RBAC grant matrix ───────────────────────────────────

/** A user shown in the permission matrix (non-superadmin). */
export interface ConsoleUser {
  id:            string;
  username:      string;
  fullName:      string;
  role:          string;
  email:         string;
  /** Job title / position (shown under the name). */
  position:      string;
  /** Department name ('' if unassigned). */
  department:    string;
  active:        boolean;
  /** Derived access label: 'Role default' | 'Extended' | 'Restricted'. */
  access:        string;
  /** Number of explicit per-user permission overrides. */
  overrideCount: number;
  /** Signed profile-photo URL ('' if none). */
  profileImage:  string;
}

/** An explicit per-user override row. */
export interface UserPermissionRow {
  permission: string;
  granted:    boolean;
}

/** List all non-superadmin active users for the permission matrix. */
export async function listUsersApi(): Promise<{
  success: boolean;
  users?:  ConsoleUser[];
  message?: string;
}> {
  return apiFetch('superadmin/listUsers', { method: 'POST', body: { args: {} } });
}

/** Get a user's explicit permission overrides. */
export async function getUserPermissionsApi(userId: string): Promise<{
  success:      boolean;
  permissions?: UserPermissionRow[];
  message?:     string;
}> {
  return apiFetch('superadmin/getUserPermissions', { method: 'POST', body: { args: { userId } } });
}

/** Set (upsert) an explicit grant (true) or deny (false) for one user + permission. */
export async function setUserPermissionApi(
  userId: string, permission: string, granted: boolean,
): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/setUserPermission', {
    method: 'POST',
    body:   { args: { userId, permission, granted } },
  });
}

/** Remove an override for one user + permission (revert to role default). */
export async function clearUserPermissionApi(
  userId: string, permission: string,
): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/clearUserPermission', {
    method: 'POST',
    body:   { args: { userId, permission } },
  });
}

// ── Active sessions ───────────────────────────────────────────────────────────

/** An active session shown in the Sessions tab. */
export interface ActiveSession {
  userId:     string;
  username:   string;
  fullName:   string;
  role:       string;
  userAgent:  string;
  ipAddress:  string;
  lastSeenAt: string;
  createdAt:  string;
}

/** List every active session with its device context. */
export async function getActiveSessionsApi(): Promise<{
  success:   boolean;
  sessions?: ActiveSession[];
  message?:  string;
}> {
  return apiFetch('superadmin/getActiveSessions', { method: 'POST', body: { args: {} } });
}

/** Force-logout a user — their tokens are invalidated; they must log in again (fresh 2FA). */
export async function revokeSessionApi(userId: string): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/revokeSession', { method: 'POST', body: { args: { userId } } });
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id:         string;
  created_at: string;
  user_id:    string;
  username:   string;
  action:     string;
  entity:     string;
  entity_id:  string;
  details:    string;
  ip_address: string | null;
  user_agent: string | null;
  /** Actor display fields resolved server-side from app_users (all users, incl. superadmins). */
  actorName?:  string;
  actorTitle?: string;
  actorPhoto?: string;
}

export interface AuditLogFilters {
  search?:    string;
  action?:    string;
  /** Whitelist — only return these actions (e.g. only real access changes). */
  includeActions?: string[];
  /** Exclude these actions (e.g. routine `tokenRefresh` noise). */
  excludeActions?: string[];
  entity?:    string;
  /** Exact match on entity_id — use to fetch history for one specific record or user. */
  entity_id?: string;
  username?:  string;
  from?:      string;
  to?:        string;
  limit?:     number;
  offset?:    number;
}

/** Fetch filtered, paginated audit records (+ filter option lists on page 1). */
export async function getAuditLogsApi(filters: AuditLogFilters = {}): Promise<{
  success:   boolean;
  logs?:     AuditLogRow[];
  total?:    number;
  actions?:  string[];
  entities?: string[];
  message?:  string;
}> {
  return apiFetch('superadmin/getAuditLogs', { method: 'POST', body: { args: filters } });
}

// ── Roles (roles-as-data) ─────────────────────────────────────────────────────

/** Organizational tier a role belongs to (orthogonal to isSystem = Source).
 *  A MANAGED taxonomy (role_categories table) — any slug, not a fixed enum. */
export type RoleCategory = string;

/** A tier row from the managed role_categories table. */
export interface RoleCategoryRow {
  key:       string;
  label:     string;
  sortOrder: number;
  isSystem:  boolean;   // seeded tiers: renameable but not deletable
  roleCount: number;
}

export interface RoleRow {
  name:        string;
  label:       string;
  description: string;
  isSystem:    boolean;
  protected:   boolean;
  sortOrder:   number;
  /** Tier. `null` = not yet classified (existing custom roles → "Needs Categorization"). */
  category:    RoleCategory | null;
  userCount:   number;
}

/** List all roles (system + custom) with their user counts. */
export async function listRolesApi(): Promise<{ success: boolean; roles?: RoleRow[]; message?: string }> {
  return apiFetch('superadmin/listRoles', { method: 'POST', body: { args: {} } });
}

/** Get a role's default permission set. */
export async function getRolePermissionsApi(roleName: string): Promise<{
  success: boolean; permissions?: string[]; message?: string;
}> {
  return apiFetch('superadmin/getRolePermissions', { method: 'POST', body: { args: { roleName } } });
}

/** Create a new custom role. Category (tier) is required. */
export async function createRoleApi(role: { name: string; label: string; description?: string; category: RoleCategory }): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/createRole', { method: 'POST', body: { args: role } });
}

/** Update a role's label/description/protected flag or reassign its category (tier). */
export async function updateRoleApi(roleName: string, patch: { label?: string; description?: string; protected?: boolean; category?: RoleCategory }): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/updateRole', { method: 'POST', body: { args: { roleName, ...patch } } });
}

/** Delete a custom role (blocked for system/protected roles or roles in use). */
export async function deleteRoleApi(roleName: string): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/deleteRole', { method: 'POST', body: { args: { roleName } } });
}

// ── Role categories (managed tiers) ───────────────────────────────────────────
export async function listRoleCategoriesApi(): Promise<{ success: boolean; categories?: RoleCategoryRow[]; message?: string }> {
  return apiFetch('superadmin/listRoleCategories', { method: 'POST', body: { args: {} } });
}
export async function createRoleCategoryApi(label: string): Promise<{ success: boolean; key?: string; message?: string }> {
  return apiFetch('superadmin/createRoleCategory', { method: 'POST', body: { args: { label } } });
}
export async function updateRoleCategoryApi(key: string, patch: { label?: string; sortOrder?: number }): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/updateRoleCategory', { method: 'POST', body: { args: { key, ...patch } } });
}
export async function deleteRoleCategoryApi(key: string): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/deleteRoleCategory', { method: 'POST', body: { args: { key } } });
}

/** Grant or revoke a single permission in a role's default set. */
export async function setRolePermissionApi(roleName: string, permission: string, granted: boolean): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/setRolePermission', { method: 'POST', body: { args: { roleName, permission, granted } } });
}

// ── Permission-grant approvals (maker-checker) ────────────────────────────────

export interface PermissionApproval {
  id:              string;
  requestType:     'role_permission' | 'user_override';
  targetRole:      string | null;
  targetUserId:    string | null;
  permissionKey:   string;
  effect:          string;
  reason:          string;
  status:          string;
  requestedBy:     string;
  requestedByName: string;
  requestedAt:     string;
  decidedBy:       string | null;
  decidedByName:   string | null;
  decidedAt:       string | null;
  decisionReason:  string | null;
  appliedAt:       string | null;
  expiresAt:       string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** List permission-grant approval requests. Defaults to pending. */
export async function listApprovalsApi(status?: ApprovalStatus): Promise<{
  success:    boolean;
  approvals?: PermissionApproval[];
  message?:   string;
}> {
  return apiFetch('admin/approvals/list', { method: 'POST', body: { args: status ? { status } : {} } });
}

/** Approve a pending critical-grant request (step-up required, maker ≠ checker). */
export async function approveGrantApi(approvalId: string): Promise<{
  success: boolean;
  code?:   string;
  message?: string;
}> {
  return apiFetch('admin/approvals/approve', { method: 'POST', body: { args: { approvalId } } });
}

/** Reject a pending critical-grant request (maker ≠ checker enforced). */
export async function rejectGrantApi(approvalId: string, reason?: string): Promise<{
  success:  boolean;
  code?:    string;
  message?: string;
}> {
  return apiFetch('admin/approvals/reject', { method: 'POST', body: { args: { approvalId, reason } } });
}

/** Cancel your own pending critical-grant request. */
export async function cancelGrantApi(approvalId: string): Promise<{
  success:  boolean;
  message?: string;
}> {
  return apiFetch('admin/approvals/cancel', { method: 'POST', body: { args: { approvalId } } });
}

/**
 * Grant with reason — used for critical permission keys that require maker-checker.
 * May return { pending: true, approvalId } instead of immediately applying.
 */
export async function setUserPermissionWithReasonApi(
  userId: string, permission: string, granted: boolean, reason?: string,
): Promise<{ success: boolean; pending?: boolean; approvalId?: string; message?: string; code?: string }> {
  return apiFetch('superadmin/setUserPermission', {
    method: 'POST',
    body:   { args: { userId, permission, granted, reason } },
  });
}

export async function setRolePermissionWithReasonApi(
  roleName: string, permission: string, granted: boolean, reason?: string,
): Promise<{ success: boolean; pending?: boolean; approvalId?: string; message?: string; code?: string }> {
  return apiFetch('superadmin/setRolePermission', {
    method: 'POST',
    body:   { args: { roleName, permission, granted, reason } },
  });
}
