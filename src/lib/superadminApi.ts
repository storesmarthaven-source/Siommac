/**
 * src/lib/superadminApi.ts
 *
 * Typed API calls for the superadmin module permissions system.
 *
 * Two-layer model:
 *   • Role-level  — getModulesApi / setModuleApi / resetModulesApi  (admin role)
 *   • User-level  — getManagersApi / setManagerModuleApi / resetManagerModulesApi
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { apiFetch } from '@lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModuleKey  = 'dashboard' | 'employees' | 'payroll' | 'live_map' | 'attendance';
export type ModuleRole = 'admin' | 'manager';

/** Full role-level matrix returned by getModules */
export type ModuleMatrix = Record<ModuleKey, { admin: boolean; manager: boolean }>;

/** Per-user module map returned for managers at login */
export type UserModuleMap = Record<ModuleKey, boolean>;

/** Manager entry returned by getManagers */
export interface ManagerEntry {
  id:       string;
  username: string;
  fullName: string;
  modules:  UserModuleMap;
}

// ── Role-level API ────────────────────────────────────────────────────────────

/**
 * Fetch the module permission matrix.
 * Called at login time for all authenticated users to filter the sidebar.
 * Managers also receive `userModules` — their personal module set.
 */
export async function getModulesApi(): Promise<{
  success:      boolean;
  modules?:     ModuleMatrix;
  userModules?: UserModuleMap;
}> {
  return apiFetch('superadmin/getModules', {
    method: 'POST',
    body:   { args: {} },
  });
}

/**
 * Enable or disable a module for the admin role globally.
 * Superadmin only.
 */
export async function setModuleApi(
  module:  ModuleKey,
  role:    ModuleRole,
  enabled: boolean,
): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/setModule', {
    method: 'POST',
    body:   { args: { module, role, enabled } },
  });
}

/**
 * Reset role-level module permissions to system defaults.
 * Superadmin only.
 */
export async function resetModulesApi(): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/resetModules', {
    method: 'POST',
    body:   { args: {} },
  });
}

// ── Per-manager API ───────────────────────────────────────────────────────────

/**
 * Fetch all managers with their effective module access.
 * Superadmin only.
 */
export async function getManagersApi(): Promise<{
  success:   boolean;
  managers?: ManagerEntry[];
  message?:  string;
}> {
  return apiFetch('superadmin/getManagers', {
    method: 'POST',
    body:   { args: {} },
  });
}

/**
 * Toggle one module for one specific manager (user-level override).
 * Superadmin only.
 */
export async function setManagerModuleApi(
  userId:  string,
  module:  ModuleKey,
  enabled: boolean,
): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/setManagerModule', {
    method: 'POST',
    body:   { args: { userId, module, enabled } },
  });
}

/**
 * Remove all personal module overrides for a manager — reverts to role defaults.
 * Superadmin only.
 */
export async function resetManagerModulesApi(
  userId: string,
): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/resetManagerModules', {
    method: 'POST',
    body:   { args: { userId } },
  });
}

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
}

export interface AuditLogFilters {
  search?:   string;
  action?:   string;
  entity?:   string;
  username?: string;
  from?:     string;
  to?:       string;
  limit?:    number;
  offset?:   number;
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

export interface RoleRow {
  name:        string;
  label:       string;
  description: string;
  isSystem:    boolean;
  protected:   boolean;
  sortOrder:   number;
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

/** Create a new custom role. */
export async function createRoleApi(role: { name: string; label: string; description?: string }): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/createRole', { method: 'POST', body: { args: role } });
}

/** Update a role's label/description/protected flag. */
export async function updateRoleApi(roleName: string, patch: { label?: string; description?: string; protected?: boolean }): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/updateRole', { method: 'POST', body: { args: { roleName, ...patch } } });
}

/** Delete a custom role (blocked for system/protected roles or roles in use). */
export async function deleteRoleApi(roleName: string): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/deleteRole', { method: 'POST', body: { args: { roleName } } });
}

/** Grant or revoke a single permission in a role's default set. */
export async function setRolePermissionApi(roleName: string, permission: string, granted: boolean): Promise<{ success: boolean; message?: string }> {
  return apiFetch('superadmin/setRolePermission', { method: 'POST', body: { args: { roleName, permission, granted } } });
}
