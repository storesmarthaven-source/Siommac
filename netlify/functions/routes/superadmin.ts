/**
 * routes/superadmin.ts
 *
 * Superadmin-only RBAC routes: per-user permission overrides, per-role permission
 * grants, active sessions, and the audit surface. Module access is NOT managed here
 * any more — it is governed entirely by the permission catalogue (moduleRegistry gates
 * the sidebar; the Console "Modules" tab is a read-only catalogue rollup). The legacy
 * coarse module matrix (module_permissions / manager_module_permissions) was retired.
 */

import { Hono }                           from 'hono';
import { sb }                             from '../lib/db';
import { requireUser, requireRole, requirePermission, revokeUserSessions, log_ } from '../lib/auth';
import { PERMISSION_KEYS, invalidateRolePermissions, isCriticalGrant } from '../lib/permissions';
import { emitAppEvent }                   from '../lib/appEvents';
import { getProfileSignedUrl }            from '../lib/photos';
import { z, zv }                          from '../lib/validate';
import type { HonoVariables }             from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();


// ── Permissions: per-user RBAC grant matrix ───────────────────────────────────
// All gated by the 'permissions.manage' capability (superadmin by default).

const PERMISSION_KEY_SET = new Set<string>(PERMISSION_KEYS);

// The APPROVED-grant apply path lives in the DB now: routes/permissionApprovals.ts
// calls the approve_permission_grant_tx() RPC, which applies the grant and marks
// the approval row in ONE atomic transaction (migration 20260917000300). There is
// no JS apply path — that split write could leave a grant applied but the row
// pending, so it was removed rather than kept as a second code path.

// ── requestCriticalGrant — open a maker-checker approval for a CRITICAL grant ──
// A critical capability (isCriticalGrant) is NOT applied on a single actor's say-so:
// this inserts a pending permission_grant_approvals row that a SECOND superadmin must
// approve (routes/permissionApprovals.ts) before it takes effect. Returns the approval
// id so the caller can respond { pending: true }.
async function requestCriticalGrant(
  actor: { id: string; username: string },
  req: { requestType: 'user_override' | 'role_permission'; targetUserId?: string; targetRole?: string; permissionKey: string; reason: string },
): Promise<{ ok: true; approvalId: string } | { ok: false; status: 400 | 409 | 500; code: string; message: string }> {
  if (!req.reason.trim()) {
    return { ok: false, status: 400, code: 'reason_required', message: 'A reason is required to request a critical permission grant.' };
  }
  // Dedupe: one open request per target + capability.
  let dq = sb.from('permission_grant_approvals').select('id')
    .eq('request_type', req.requestType).eq('permission_key', req.permissionKey).eq('status', 'pending');
  dq = req.requestType === 'user_override' ? dq.eq('target_user_id', req.targetUserId ?? '') : dq.eq('target_role', req.targetRole ?? '');
  const { data: existing } = await dq.maybeSingle<{ id: string }>();
  if (existing) return { ok: false, status: 409, code: 'already_pending', message: 'A pending approval already exists for this grant.' };

  const { data: ins, error } = await sb.from('permission_grant_approvals').insert({
    id:             `PGA-${crypto.randomUUID()}`,   // code-generated id (no DB default — see migration)
    request_type:   req.requestType,
    target_user_id: req.targetUserId ?? null,
    target_role:    req.targetRole ?? null,
    permission_key: req.permissionKey,
    effect:         'allow',
    reason:         req.reason.trim(),
    requested_by:   actor.id,
    expires_at:     new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }).select('id').single<{ id: string }>();
  if (error || !ins) {
    // The partial unique indexes (pga_uniq_pending_role/user) reject a duplicate
    // pending request even if the read-check above raced with a concurrent insert.
    if (error?.code === '23505') {
      return { ok: false, status: 409, code: 'already_pending', message: 'A pending approval already exists for this grant.' };
    }
    console.error('[requestCriticalGrant] insert error:', error?.message);
    return { ok: false, status: 500, code: 'insert_failed', message: 'Failed to create the approval request.' };
  }

  await log_(actor, 'permission_grant_requested',
    req.requestType === 'user_override' ? 'user' : 'role',
    req.targetUserId ?? req.targetRole ?? '',
    JSON.stringify({ permission: req.permissionKey, approvalId: ins.id, critical: true }));
  await emitAppEvent({
    eventType: 'iam.permission.grant_requested', sourceModule: 'platform',
    sourceEntityType: 'permission_grant_approval', sourceEntityId: ins.id,
    actorUserId: actor.id, severity: 'warning',
    payload: { permissionKey: req.permissionKey, requestType: req.requestType, target: req.targetUserId ?? req.targetRole },
  });
  return { ok: true, approvalId: ins.id };
}

const GetUserPermsSchema = z.object({ userId: z.string().min(1) });
const SetUserPermSchema  = z.object({
  userId:     z.string().min(1),
  permission: z.string().refine(p => PERMISSION_KEY_SET.has(p), 'Unknown permission key'),
  granted:    z.boolean(),
  reason:     z.string().max(500).optional(),
});
const ClearUserPermSchema = z.object({
  userId:     z.string().min(1),
  permission: z.string().min(1),
});

// POST /superadmin/listUsers — all non-superadmin users (for the accounts view).
// Includes inactive accounts so the UI can show Enabled/Disabled status, plus a
// per-user override count so it can label "Access" (Full / Limited / Read-Only).
router.post('/listUsers', async c => {
  await requirePermission(c, 'permissions.manage');
  // Pure employees have the fixed self-service baseline (no configurable access)
  // and are managed on their own page — exclude them, and superadmin, from the
  // accounts/permissions view, which is for configurable roles only.
  const [{ data, error }, { data: overrides }, { data: depts }] = await Promise.all([
    sb.from('app_users')
      .select('id, username, full_name, role, email, position, status, profile_image, department_id')
      .not('role', 'in', '("superadmin","employee")')
      .order('role')
      .order('full_name'),
    sb.from('user_permissions').select('user_id, granted'),
    sb.from('departments').select('id, name'),
  ]);
  if (error) {
    console.error('[superadmin/listUsers] error:', error.message);
    return c.json({ success: false, message: 'Failed to load users.' }, 500);
  }
  // Tally per-user grant/deny overrides to derive an access label.
  const tally = new Map<string, { grants: number; denials: number }>();
  for (const o of (overrides ?? []) as { user_id: string; granted: boolean }[]) {
    const t = tally.get(o.user_id) ?? { grants: 0, denials: 0 };
    if (o.granted) t.grants++; else t.denials++;
    tally.set(o.user_id, t);
  }
  // Resolve profile photo signed URLs in parallel.
  const deptMap = Object.fromEntries(((depts ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]));
  const rows = (data ?? []) as { id: string; username: string; full_name: string; role: string; email: string | null; position: string | null; status: string; profile_image: string | null; department_id: string | null }[];
  const photos = await Promise.all(rows.map(u => getProfileSignedUrl(u.id, u.profile_image)));
  const users = rows.map((u, i) => {
    const t = tally.get(u.id) ?? { grants: 0, denials: 0 };
    const access = t.denials > 0 ? 'Restricted' : t.grants > 0 ? 'Extended' : 'Role default';
    return {
      id:         u.id,
      username:   u.username,
      fullName:   u.full_name,
      role:       u.role,
      email:      u.email ?? '',
      position:   u.position ?? '',
      department: deptMap[u.department_id ?? ''] ?? '',
      active:     u.status === 'active',
      access,
      overrideCount: t.grants + t.denials,
      profileImage:  photos[i] ?? '',
    };
  });
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
  const { userId, permission, granted, reason } = v.data;

  // Critical ALLOW grant → maker-checker: create a pending approval, do NOT apply now.
  if (granted && isCriticalGrant(permission)) {
    const r = await requestCriticalGrant(actor, { requestType: 'user_override', targetUserId: userId, permissionKey: permission, reason: reason ?? '' });
    if (!r.ok) return c.json({ success: false, code: r.code, message: r.message }, r.status);
    return c.json({ success: true, pending: true, approvalId: r.approvalId });
  }

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
  // Structured details (JSON) so the audit timeline + module coverage can render the capability.
  await log_(actor, granted ? 'permission_grant' : 'permission_deny', 'user', userId,
    JSON.stringify({ permission, granted }));
  await emitAppEvent({
    eventType: granted ? 'iam.permission.override_allow' : 'iam.permission.override_deny',
    sourceModule: 'platform', sourceEntityType: 'user', sourceEntityId: userId,
    actorUserId: actor.id, severity: 'warning', payload: { permission, granted },
  });
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
    JSON.stringify({ permission, cleared: true }));
  await emitAppEvent({
    eventType: 'iam.permission.override_cleared',
    sourceModule: 'platform', sourceEntityType: 'user', sourceEntityId: userId,
    actorUserId: actor.id, severity: 'info', payload: { permission },
  });
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
  search:    z.string().optional(),
  action:    z.string().optional(),
  excludeActions: z.array(z.string()).optional(), // drop noisy routine actions (e.g. tokenRefresh)
  entity:    z.string().optional(),
  entity_id: z.string().optional(),  // filter to a specific record (e.g. a user's ID)
  username:  z.string().optional(),
  from:      z.string().optional(),   // ISO date
  to:        z.string().optional(),   // ISO date
  limit:     z.number().int().min(1).max(500).optional(),
  offset:    z.number().int().min(0).optional(),
});

// POST /superadmin/getAuditLogs — filtered, paginated audit records (+ distinct
// actions/entities for the filter dropdowns on the first page).
router.post('/getAuditLogs', async c => {
  await requirePermission(c, 'audit.view');
  const v = zv(c, GetAuditLogsSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { search, action, entity, entity_id, username, from, to } = v.data;
  const limit  = v.data.limit  ?? 50;
  const offset = v.data.offset ?? 0;

  let q = sb
    .from('activity_logs')
    .select('id, created_at, user_id, username, action, entity, entity_id, details, ip_address, user_agent', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (action)    q = q.eq('action', action);
  for (const a of v.data.excludeActions ?? []) q = q.neq('action', a);
  if (entity)    q = q.eq('entity', entity);
  if (entity_id) q = q.eq('entity_id', entity_id);
  if (username)  q = q.ilike('username', `%${username}%`);
  if (from)      q = q.gte('created_at', from);
  if (to)        q = q.lte('created_at', to);
  if (search)    q = q.or(`details.ilike.%${search}%,entity_id.ilike.%${search}%,username.ilike.%${search}%`);

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

// ── Roles (roles-as-data) ─────────────────────────────────────────────────────
// Gated by 'roles.manage' (superadmin by default).

const RoleNameSchema  = z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits, underscore');
const CreateRoleSchema = z.object({
  name:        RoleNameSchema,
  label:       z.string().min(1).max(60),
  description: z.string().max(300).optional(),
});
const UpdateRoleSchema = z.object({
  roleName:    z.string().min(1),
  label:       z.string().min(1).max(60).optional(),
  description: z.string().max(300).optional(),
  protected:   z.boolean().optional(),
});
const GetRolePermsSchema = z.object({ roleName: z.string().min(1) });
const SetRolePermSchema  = z.object({
  roleName:   z.string().min(1),
  permission: z.string().refine(p => PERMISSION_KEY_SET.has(p), 'Unknown permission key'),
  granted:    z.boolean(),
  reason:     z.string().max(500).optional(),
});
const DeleteRoleSchema = z.object({ roleName: z.string().min(1) });

// POST /superadmin/listRoles — all roles + user counts.
router.post('/listRoles', async c => {
  await requirePermission(c, 'roles.manage');
  const { data: roles, error } = await sb
    .from('roles')
    .select('name, label, description, is_system, protected, sort_order')
    .order('sort_order');
  if (error) {
    console.error('[superadmin/listRoles] error:', error.message);
    return c.json({ success: false, message: 'Failed to load roles.' }, 500);
  }
  // User count per role (one grouped query).
  const { data: users } = await sb.from('app_users').select('role').eq('status', 'active');
  const counts = new Map<string, number>();
  for (const u of (users ?? []) as { role: string }[]) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);

  const out = (roles ?? []).map(r => ({
    name: r.name, label: r.label, description: r.description,
    isSystem: r.is_system, protected: r.protected, sortOrder: r.sort_order,
    userCount: counts.get(r.name) ?? 0,
  }));
  return c.json({ success: true, roles: out });
});

// POST /superadmin/getRolePermissions — a role's default permission set.
router.post('/getRolePermissions', async c => {
  await requirePermission(c, 'roles.manage');
  const v = zv(c, GetRolePermsSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  if (v.data.roleName === 'superadmin') {
    return c.json({ success: true, permissions: [...PERMISSION_KEYS] });
  }
  const { data, error } = await sb
    .from('role_permissions')
    .select('permission')
    .eq('role_name', v.data.roleName);
  if (error) {
    console.error('[superadmin/getRolePermissions] error:', error.message);
    return c.json({ success: false, message: 'Failed to load role permissions.' }, 500);
  }
  return c.json({ success: true, permissions: (data ?? []).map(r => r.permission) });
});

// POST /superadmin/createRole
router.post('/createRole', async c => {
  const actor = await requirePermission(c, 'roles.manage');
  const v = zv(c, CreateRoleSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { name, label, description } = v.data;
  const { error } = await sb.from('roles').insert({
    name, label, description: description ?? '', is_system: false, protected: false,
    sort_order: 100, updated_by: actor.username,
  });
  if (error) {
    if (error.code === '23505') return c.json({ success: false, message: 'A role with that name already exists.' }, 409);
    console.error('[superadmin/createRole] error:', error.message);
    return c.json({ success: false, message: 'Failed to create role.' }, 500);
  }
  await log_(actor, 'role_create', 'role', name, `created role "${label}"`);
  return c.json({ success: true });
});

// POST /superadmin/updateRole
router.post('/updateRole', async c => {
  const actor = await requirePermission(c, 'roles.manage');
  const v = zv(c, UpdateRoleSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { roleName, label, description } = v.data;

  const { data: role } = await sb.from('roles').select('is_system').eq('name', roleName).maybeSingle<{ is_system: boolean }>();
  if (!role) return c.json({ success: false, message: 'Role not found.' }, 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.username };
  if (label       !== undefined) patch.label       = label;
  if (description !== undefined) patch.description = description;
  // protected flag editable for non-system roles; superadmin/employee stay protected.
  if (v.data.protected !== undefined && !role.is_system) patch.protected = v.data.protected;

  const { error } = await sb.from('roles').update(patch).eq('name', roleName);
  if (error) {
    console.error('[superadmin/updateRole] error:', error.message);
    return c.json({ success: false, message: 'Failed to update role.' }, 500);
  }
  await log_(actor, 'role_update', 'role', roleName, JSON.stringify(patch));
  return c.json({ success: true });
});

// POST /superadmin/deleteRole — blocked for system/protected roles and roles in use.
router.post('/deleteRole', async c => {
  const actor = await requirePermission(c, 'roles.manage');
  const v = zv(c, DeleteRoleSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { roleName } = v.data;

  const { data: role } = await sb.from('roles').select('is_system, protected').eq('name', roleName).maybeSingle<{ is_system: boolean; protected: boolean }>();
  if (!role) return c.json({ success: false, message: 'Role not found.' }, 404);
  if (role.is_system || role.protected) return c.json({ success: false, message: 'This role is protected and cannot be deleted.' }, 400);

  const { count } = await sb.from('app_users').select('id', { count: 'exact', head: true }).eq('role', roleName) as unknown as { count: number };
  if (count && count > 0) return c.json({ success: false, message: `Cannot delete: ${count} user(s) still have this role. Reassign them first.` }, 400);

  const { error } = await sb.from('roles').delete().eq('name', roleName);
  if (error) {
    console.error('[superadmin/deleteRole] error:', error.message);
    return c.json({ success: false, message: 'Failed to delete role.' }, 500);
  }
  invalidateRolePermissions(roleName);
  await log_(actor, 'role_delete', 'role', roleName, `deleted role`);
  return c.json({ success: true });
});

// POST /superadmin/setRolePermission — grant/revoke one permission in a role's default set.
router.post('/setRolePermission', async c => {
  const actor = await requirePermission(c, 'roles.manage');
  const v = zv(c, SetRolePermSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { roleName, permission, granted, reason } = v.data;

  if (roleName === 'superadmin') return c.json({ success: false, message: 'Superadmin permissions cannot be changed.' }, 400);

  // Critical ALLOW grant → maker-checker: create a pending approval, do NOT apply now.
  if (granted && isCriticalGrant(permission)) {
    const r = await requestCriticalGrant(actor, { requestType: 'role_permission', targetRole: roleName, permissionKey: permission, reason: reason ?? '' });
    if (!r.ok) return c.json({ success: false, code: r.code, message: r.message }, r.status);
    return c.json({ success: true, pending: true, approvalId: r.approvalId });
  }

  if (granted) {
    const { error } = await sb.from('role_permissions').upsert({ role_name: roleName, permission }, { onConflict: 'role_name,permission' });
    if (error) { console.error('[superadmin/setRolePermission] error:', error.message); return c.json({ success: false, message: 'Failed to update.' }, 500); }
  } else {
    const { error } = await sb.from('role_permissions').delete().eq('role_name', roleName).eq('permission', permission);
    if (error) { console.error('[superadmin/setRolePermission] error:', error.message); return c.json({ success: false, message: 'Failed to update.' }, 500); }
  }
  invalidateRolePermissions(roleName);
  await log_(actor, granted ? 'role_perm_grant' : 'role_perm_revoke', 'role', roleName,
    JSON.stringify({ permission, granted }));
  await emitAppEvent({
    eventType: granted ? 'iam.role.permission_granted' : 'iam.role.permission_revoked',
    sourceModule: 'platform', sourceEntityType: 'role', sourceEntityId: roleName,
    actorUserId: actor.id, severity: 'warning', payload: { permission, granted, roleName },
  });
  return c.json({ success: true });
});

// ── Exports ───────────────────────────────────────────────────────────────────

export { router as superadminRouter };
