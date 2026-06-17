/**
 * routes/superadmin.ts
 *
 * Superadmin-only routes for module permission management.
 *
 * Two-layer permission model:
 *   • Role-level  (module_permissions table)           — applies to 'admin' role globally
 *   • User-level  (manager_module_permissions table)   — per-manager overrides
 *
 * At login the client receives:
 *   - For admins:   the role-level matrix (admin column)
 *   - For managers: their personal module set (user-level rows, falling back to
 *                   role-level defaults where no personal row exists)
 *   - For superadmin: everything enabled (hardcoded, not in DB)
 *
 * Routes:
 *   POST /superadmin/getModules          — all authenticated users (login sidebar)
 *   POST /superadmin/setModule           — superadmin only; role-level (admin)
 *   POST /superadmin/resetModules        — superadmin only; role-level reset
 *   POST /superadmin/getManagers         — superadmin only; list managers + their modules
 *   POST /superadmin/setManagerModule    — superadmin only; toggle one module for one manager
 *   POST /superadmin/resetManagerModules — superadmin only; reset one manager to role defaults
 */

import { Hono }                           from 'hono';
import { sb }                             from '../lib/db';
import { requireUser, requireRole, requirePermission, revokeUserSessions, log_ } from '../lib/auth';
import { PERMISSION_KEYS } from '../lib/permissions';
import { z, zv }                          from '../lib/validate';
import type { HonoVariables }             from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModuleKey  = 'dashboard' | 'employees' | 'payroll' | 'live_map' | 'attendance';
export type ModuleRole = 'admin' | 'manager';

/** Role-level matrix: module → { admin: bool, manager: bool } */
export interface ModuleMatrix {
  [module: string]: {
    admin:   boolean;
    manager: boolean;
  };
}

/** Per-user module set: module → enabled */
export type UserModuleMap = Record<ModuleKey, boolean>;

/** Manager summary returned to the Modules panel */
export interface ManagerEntry {
  id:       string;   // app_users.id
  username: string;
  fullName: string;
  modules:  UserModuleMap;
}

const ALL_MODULES: ModuleKey[] = ['dashboard', 'employees', 'payroll', 'live_map', 'attendance'];

// ── Role-level cache (admin matrix only, 30 s TTL) ────────────────────────────
const CACHE_TTL_MS = 30_000;
let _roleCache:      ModuleMatrix | null = null;
let _roleCachedAt    = 0;

export function invalidateModuleCache(): void {
  _roleCache    = null;
  _roleCachedAt = 0;
}

async function loadRoleMatrix(): Promise<ModuleMatrix> {
  const now = Date.now();
  if (_roleCache && now - _roleCachedAt < CACHE_TTL_MS) return _roleCache;

  const { data, error } = await sb
    .from('module_permissions')
    .select('module, role, enabled');
  if (error) throw error;

  const matrix: ModuleMatrix = {};
  for (const m of ALL_MODULES) matrix[m] = { admin: true, manager: true };

  for (const row of (data ?? []) as { module: string; role: string; enabled: boolean }[]) {
    if (matrix[row.module]) {
      (matrix[row.module] as Record<string, boolean>)[row.role] = row.enabled;
    }
  }

  _roleCache    = matrix;
  _roleCachedAt = Date.now();
  return matrix;
}

/**
 * Build the effective module map for a single manager.
 * Personal rows override role defaults. Missing modules fall back to role defaults.
 */
async function loadManagerModules(userId: string, roleMatrix: ModuleMatrix): Promise<UserModuleMap> {
  const { data } = await sb
    .from('manager_module_permissions')
    .select('module, enabled')
    .eq('user_id', userId);

  const personal = new Map<string, boolean>(
    ((data ?? []) as { module: string; enabled: boolean }[]).map(r => [r.module, r.enabled]),
  );

  const result = {} as UserModuleMap;
  for (const m of ALL_MODULES) {
    result[m] = personal.has(m) ? personal.get(m)! : (roleMatrix[m]?.manager ?? true);
  }
  return result;
}

// ── POST /superadmin/getModules ───────────────────────────────────────────────
// All authenticated users — called at login time to filter the sidebar.
// Returns:
//   { success, modules, userModules? }
//   • modules     = full role matrix (admin column + manager defaults)
//   • userModules = personal map for this manager (only present if role=manager)

router.post('/getModules', async c => {
  const u           = await requireUser(c);
  const roleMatrix  = await loadRoleMatrix();

  if (u.role === 'manager') {
    const userModules = await loadManagerModules(u.id, roleMatrix);
    return c.json({ success: true, modules: roleMatrix, userModules });
  }

  return c.json({ success: true, modules: roleMatrix });
});

// ── POST /superadmin/setModule ────────────────────────────────────────────────
// Superadmin only. Toggles a single module/role cell in the role-level matrix.

const SetModuleSchema = z.object({
  module:  z.enum(['dashboard', 'employees', 'payroll', 'live_map', 'attendance']),
  role:    z.enum(['admin', 'manager']),
  enabled: z.boolean(),
});

router.post('/setModule', async c => {
  const actor = await requireRole(c, ['superadmin']);
  const v = zv(c, SetModuleSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const { module, role, enabled } = v.data;

  if (module === 'dashboard' && !enabled) {
    return c.json({ success: false, message: 'Dashboard cannot be disabled.' }, 400);
  }

  const { error } = await sb
    .from('module_permissions')
    .upsert(
      { module, role, enabled, updated_by: actor.username, updated_at: new Date().toISOString() },
      { onConflict: 'module,role' },
    );

  if (error) {
    console.error('[superadmin/setModule] upsert error:', error.message);
    return c.json({ success: false, message: 'Failed to update module permission.' }, 500);
  }

  invalidateModuleCache();
  await log_(actor, 'module_permission_change', 'system', actor.id,
    `role:${role} ${module} set to ${enabled ? 'enabled' : 'disabled'}`);

  return c.json({ success: true });
});

// ── POST /superadmin/resetModules ─────────────────────────────────────────────
// Superadmin only. Resets role-level admin matrix to defaults.

const ROLE_DEFAULTS: Array<{ module: ModuleKey; role: ModuleRole; enabled: boolean }> = [
  { module: 'dashboard',  role: 'admin',   enabled: true  },
  { module: 'employees',  role: 'admin',   enabled: true  },
  { module: 'payroll',    role: 'admin',   enabled: true  },
  { module: 'live_map',   role: 'admin',   enabled: true  },
  { module: 'attendance', role: 'admin',   enabled: true  },
  { module: 'dashboard',  role: 'manager', enabled: true  },
  { module: 'employees',  role: 'manager', enabled: true  },
  { module: 'payroll',    role: 'manager', enabled: false },
  { module: 'live_map',   role: 'manager', enabled: true  },
  { module: 'attendance', role: 'manager', enabled: true  },
];

router.post('/resetModules', async c => {
  const actor = await requireRole(c, ['superadmin']);

  const rows = ROLE_DEFAULTS.map(d => ({
    ...d,
    updated_by: actor.username,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await sb
    .from('module_permissions')
    .upsert(rows, { onConflict: 'module,role' });

  if (error) {
    console.error('[superadmin/resetModules] error:', error.message);
    return c.json({ success: false, message: 'Failed to reset modules.' }, 500);
  }

  invalidateModuleCache();
  await log_(actor, 'module_permissions_reset', 'system', actor.id, 'admin role modules reset to defaults');

  return c.json({ success: true });
});

// ── POST /superadmin/getManagers ──────────────────────────────────────────────
// Superadmin only. Returns all managers with their effective module access.

router.post('/getManagers', async c => {
  await requireRole(c, ['superadmin']);

  const roleMatrix = await loadRoleMatrix();

  // Fetch all active managers
  const { data: managers, error: mgErr } = await sb
    .from('app_users')
    .select('id, username, full_name')
    .eq('role', 'manager')
    .eq('status', 'active')
    .order('full_name');

  if (mgErr) {
    console.error('[superadmin/getManagers] error:', mgErr.message);
    return c.json({ success: false, message: 'Failed to load managers.' }, 500);
  }

  if (!managers || managers.length === 0) {
    return c.json({ success: true, managers: [] });
  }

  // Fetch all personal overrides in one query
  const managerIds = (managers as { id: string }[]).map(m => m.id);
  const { data: personal } = await sb
    .from('manager_module_permissions')
    .select('user_id, module, enabled')
    .in('user_id', managerIds);

  // Group personal rows by user_id
  const personalByUser = new Map<string, Map<string, boolean>>();
  for (const row of (personal ?? []) as { user_id: string; module: string; enabled: boolean }[]) {
    if (!personalByUser.has(row.user_id)) personalByUser.set(row.user_id, new Map());
    personalByUser.get(row.user_id)!.set(row.module, row.enabled);
  }

  // Build the result
  const result: ManagerEntry[] = (managers as { id: string; username: string; full_name: string }[]).map(m => {
    const perMap = personalByUser.get(m.id) ?? new Map<string, boolean>();
    const modules = {} as UserModuleMap;
    for (const mod of ALL_MODULES) {
      modules[mod] = perMap.has(mod) ? perMap.get(mod)! : (roleMatrix[mod]?.manager ?? true);
    }
    return { id: m.id, username: m.username, fullName: m.full_name, modules };
  });

  return c.json({ success: true, managers: result });
});

// ── POST /superadmin/setManagerModule ─────────────────────────────────────────
// Superadmin only. Toggle one module for one specific manager (user-level).

const SetManagerModuleSchema = z.object({
  userId:  z.string().min(1),
  module:  z.enum(['dashboard', 'employees', 'payroll', 'live_map', 'attendance']),
  enabled: z.boolean(),
});

router.post('/setManagerModule', async c => {
  const actor = await requireRole(c, ['superadmin']);
  const v = zv(c, SetManagerModuleSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const { userId, module, enabled } = v.data;

  if (module === 'dashboard' && !enabled) {
    return c.json({ success: false, message: 'Dashboard cannot be disabled.' }, 400);
  }

  // Verify the target user is actually a manager
  const { data: target } = await sb
    .from('app_users')
    .select('id, username, role')
    .eq('id', userId)
    .maybeSingle<{ id: string; username: string; role: string }>();

  if (!target || target.role !== 'manager') {
    return c.json({ success: false, message: 'User not found or not a manager.' }, 400);
  }

  const { error } = await sb
    .from('manager_module_permissions')
    .upsert(
      { user_id: userId, module, enabled, updated_by: actor.username, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,module' },
    );

  if (error) {
    console.error('[superadmin/setManagerModule] upsert error:', error.message);
    return c.json({ success: false, message: 'Failed to update manager module.' }, 500);
  }

  await log_(actor, 'manager_module_change', 'user', userId,
    `manager:${target.username} ${module} set to ${enabled ? 'enabled' : 'disabled'}`);

  return c.json({ success: true });
});

// ── POST /superadmin/resetManagerModules ──────────────────────────────────────
// Superadmin only. Delete all personal overrides for a manager → fall back to role defaults.

const ResetManagerModulesSchema = z.object({
  userId: z.string().min(1),
});

router.post('/resetManagerModules', async c => {
  const actor = await requireRole(c, ['superadmin']);
  const v = zv(c, ResetManagerModulesSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const { userId } = v.data;

  const { error } = await sb
    .from('manager_module_permissions')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('[superadmin/resetManagerModules] error:', error.message);
    return c.json({ success: false, message: 'Failed to reset manager modules.' }, 500);
  }

  await log_(actor, 'manager_module_reset', 'user', userId,
    `manager ${userId} modules reset to role defaults`);

  return c.json({ success: true });
});

// ── Permissions: per-user RBAC grant matrix ───────────────────────────────────
// All gated by the 'permissions.manage' capability (superadmin by default).

const PERMISSION_KEY_SET = new Set<string>(PERMISSION_KEYS);

const GetUserPermsSchema = z.object({ userId: z.string().min(1) });
const SetUserPermSchema  = z.object({
  userId:     z.string().min(1),
  permission: z.string().refine(p => PERMISSION_KEY_SET.has(p), 'Unknown permission key'),
  granted:    z.boolean(),
});
const ClearUserPermSchema = z.object({
  userId:     z.string().min(1),
  permission: z.string().min(1),
});

// POST /superadmin/listUsers — all non-superadmin active users (for the matrix).
router.post('/listUsers', async c => {
  await requirePermission(c, 'permissions.manage');
  const { data, error } = await sb
    .from('app_users')
    .select('id, username, full_name, role')
    .neq('role', 'superadmin')
    .eq('status', 'active')
    .order('role')
    .order('full_name');
  if (error) {
    console.error('[superadmin/listUsers] error:', error.message);
    return c.json({ success: false, message: 'Failed to load users.' }, 500);
  }
  const users = (data ?? []).map(u => ({
    id:       u.id,
    username: u.username,
    fullName: u.full_name,
    role:     u.role,
  }));
  return c.json({ success: true, users });
});

// POST /superadmin/getUserPermissions — override rows for one user.
router.post('/getUserPermissions', async c => {
  await requirePermission(c, 'permissions.manage');
  const v = zv(c, GetUserPermsSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { data, error } = await sb
    .from('user_permissions')
    .select('permission, granted')
    .eq('user_id', v.data.userId);
  if (error) {
    console.error('[superadmin/getUserPermissions] error:', error.message);
    return c.json({ success: false, message: 'Failed to load permissions.' }, 500);
  }
  return c.json({ success: true, permissions: data ?? [] });
});

// POST /superadmin/setUserPermission — upsert an explicit grant/deny override.
router.post('/setUserPermission', async c => {
  const actor = await requirePermission(c, 'permissions.manage');
  const v = zv(c, SetUserPermSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { userId, permission, granted } = v.data;

  const { error } = await sb
    .from('user_permissions')
    .upsert(
      { user_id: userId, permission, granted, set_by: actor.username, set_at: new Date().toISOString() },
      { onConflict: 'user_id,permission' },
    );
  if (error) {
    console.error('[superadmin/setUserPermission] error:', error.message);
    return c.json({ success: false, message: 'Failed to set permission.' }, 500);
  }
  await log_(actor, granted ? 'permission_grant' : 'permission_deny', 'user', userId,
    `${permission} ${granted ? 'granted to' : 'denied for'} user ${userId}`);
  return c.json({ success: true });
});

// POST /superadmin/clearUserPermission — remove an override (revert to role default).
router.post('/clearUserPermission', async c => {
  const actor = await requirePermission(c, 'permissions.manage');
  const v = zv(c, ClearUserPermSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { userId, permission } = v.data;

  const { error } = await sb
    .from('user_permissions')
    .delete()
    .eq('user_id', userId)
    .eq('permission', permission);
  if (error) {
    console.error('[superadmin/clearUserPermission] error:', error.message);
    return c.json({ success: false, message: 'Failed to clear permission.' }, 500);
  }
  await log_(actor, 'permission_clear', 'user', userId,
    `${permission} override removed for user ${userId} (reverted to role default)`);
  return c.json({ success: true });
});

// ── Active sessions: visibility + remote revoke ───────────────────────────────
// Gated by 'sessions.manage' (superadmin by default).

const RevokeSessionSchema = z.object({ userId: z.string().min(1) });

// POST /superadmin/getActiveSessions — every active session with device context.
router.post('/getActiveSessions', async c => {
  await requirePermission(c, 'sessions.manage');

  const { data: tokens, error } = await sb
    .from('refresh_tokens')
    .select('user_id, user_agent, ip_address, last_seen_at, created_at, expires_at')
    .order('last_seen_at', { ascending: false });
  if (error) {
    console.error('[superadmin/getActiveSessions] error:', error.message);
    return c.json({ success: false, message: 'Failed to load sessions.' }, 500);
  }

  const rows = (tokens ?? []) as Array<{
    user_id: string; user_agent: string | null; ip_address: string | null;
    last_seen_at: string; created_at: string; expires_at: string;
  }>;
  if (rows.length === 0) return c.json({ success: true, sessions: [] });

  // Join user identity in one query.
  const ids = [...new Set(rows.map(r => r.user_id))];
  const { data: users } = await sb
    .from('app_users')
    .select('id, username, full_name, role')
    .in('id', ids);
  const userMap = new Map((users ?? []).map(u => [u.id, u]));

  const sessions = rows
    .filter(r => new Date(r.expires_at) > new Date())   // active only
    .map(r => {
      const u = userMap.get(r.user_id);
      return {
        userId:     r.user_id,
        username:   u?.username ?? '—',
        fullName:   u?.full_name ?? 'Unknown user',
        role:       u?.role ?? '—',
        userAgent:  r.user_agent ?? '',
        ipAddress:  r.ip_address ?? '',
        lastSeenAt: r.last_seen_at,
        createdAt:  r.created_at,
      };
    });

  return c.json({ success: true, sessions });
});

// POST /superadmin/revokeSession — force-logout a user (epoch + delete refresh token).
router.post('/revokeSession', async c => {
  const actor = await requirePermission(c, 'sessions.manage');
  const v = zv(c, RevokeSessionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { userId } = v.data;

  if (userId === actor.id) {
    return c.json({ success: false, message: 'You cannot revoke your own active session here.' }, 400);
  }

  await revokeUserSessions(userId, actor.username);
  await log_(actor, 'session_revoke', 'user', userId,
    `forced logout of user ${userId}; re-authentication (incl. 2FA) required`);
  return c.json({ success: true });
});

// ── Audit log viewer ──────────────────────────────────────────────────────────
// Gated by 'audit.view' (superadmin by default). Append-only table; read-only here.

const GetAuditLogsSchema = z.object({
  search:   z.string().optional(),
  action:   z.string().optional(),
  entity:   z.string().optional(),
  username: z.string().optional(),
  from:     z.string().optional(),   // ISO date
  to:       z.string().optional(),   // ISO date
  limit:    z.number().int().min(1).max(500).optional(),
  offset:   z.number().int().min(0).optional(),
});

// POST /superadmin/getAuditLogs — filtered, paginated audit records (+ distinct
// actions/entities for the filter dropdowns on the first page).
router.post('/getAuditLogs', async c => {
  await requirePermission(c, 'audit.view');
  const v = zv(c, GetAuditLogsSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { search, action, entity, username, from, to } = v.data;
  const limit  = v.data.limit  ?? 50;
  const offset = v.data.offset ?? 0;

  let q = sb
    .from('activity_logs')
    .select('id, created_at, user_id, username, action, entity, entity_id, details, ip_address, user_agent', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (action)   q = q.eq('action', action);
  if (entity)   q = q.eq('entity', entity);
  if (username) q = q.ilike('username', `%${username}%`);
  if (from)     q = q.gte('created_at', from);
  if (to)       q = q.lte('created_at', to);
  if (search)   q = q.or(`details.ilike.%${search}%,entity_id.ilike.%${search}%,username.ilike.%${search}%`);

  const { data, error, count } = await q;
  if (error) {
    console.error('[superadmin/getAuditLogs] error:', error.message);
    return c.json({ success: false, message: 'Failed to load audit log.' }, 500);
  }

  // Filter option lists (distinct actions/entities) — only on the first page.
  let actions: string[] = [];
  let entities: string[] = [];
  if (offset === 0) {
    const { data: distinct } = await sb.from('activity_logs').select('action, entity').limit(2000);
    actions  = [...new Set((distinct ?? []).map(r => r.action).filter(Boolean))].sort();
    entities = [...new Set((distinct ?? []).map(r => r.entity).filter(Boolean))].sort();
  }

  return c.json({ success: true, logs: data ?? [], total: count ?? 0, actions, entities });
});

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  router as superadminRouter,
  loadRoleMatrix as loadModuleMatrix,
  ALL_MODULES,
};
