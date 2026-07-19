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
import { requirePermission, revokeUserSessions, log_ } from '../lib/auth';
import {
  COMPLIANCE_GATED_KEYS,
  PERMISSION_KEYS,
  invalidateRolePermissions,
  isCriticalGrant,
} from '../lib/permissions';
import { emitAppEvent, deliverEventNotifications } from '../lib/appEvents';
import { emitSignal }                     from '../lib/communications';
import { msgRpcHttpError }                from '../lib/messaging/messagingRpc';
import { getProfileSignedUrl }            from '../lib/photos';
import { requireStepUp }                  from '../lib/stepUp';
import { z, zv }                          from '../lib/validate';
import type { HonoVariables }             from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();


// ── Permissions: per-user RBAC grant matrix ───────────────────────────────────
// All gated by the 'permissions.manage' capability (superadmin by default).

const PERMISSION_KEY_SET = new Set<string>(PERMISSION_KEYS);

/**
 * Eligible reviewers for a compliance access grant request: superadmins (hold
 * permissions.manage by role) + explicit compliance_approve / permissions.manage
 * holders. Excludes the requester (maker ≠ checker). Used to notify approvers so a
 * pending request surfaces without them polling the queue.
 */
async function listComplianceGrantApprovers(excludeUserId: string): Promise<string[]> {
  const [superadmins, holders] = await Promise.all([
    sb.from('app_users').select('id').eq('role', 'superadmin').eq('status', 'active'),
    sb.from('user_permissions').select('user_id')
      .in('permission', ['communications.compliance_approve', 'permissions.manage'])
      .eq('granted', true).is('revoked_at', null),
  ]);
  const ids = new Set<string>();
  for (const u of (superadmins.data ?? []) as { id: string }[]) ids.add(u.id);
  for (const r of (holders.data ?? []) as { user_id: string }[]) ids.add(r.user_id);
  ids.delete(excludeUserId);
  return [...ids];
}

// The APPROVED-grant apply path lives in the DB now: routes/permissionApprovals.ts
// calls the approve_permission_grant_tx() RPC, which applies the grant and marks
// the approval row in ONE atomic transaction (migration 20260917000300). There is
// no JS apply path — that split write could leave a grant applied but the row
// pending, so it was removed rather than kept as a second code path.

// ── requestCriticalGrant — open a maker-checker approval for a CRITICAL grant ──
// A critical capability (isCriticalGrant) is NOT applied on a single actor's say-so:
// this inserts a pending permission_grant_approvals row that a different authorized
// reviewer must approve (routes/permissionApprovals.ts) before it takes effect.
// Returns the approval id so the caller can respond { pending: true }.
async function requestCriticalGrant(
  actor: { id: string; username: string },
  req: {
    requestType: 'user_override' | 'role_permission';
    targetUserId?: string;
    targetRole?: string;
    permissionKey: string;
    reason: string;
    validFrom?: string;
    validUntil?: string;
  },
): Promise<{ ok: true; approvalId: string } | { ok: false; status: 400 | 403 | 409 | 422 | 500; code: string; message: string }> {
  if (!req.reason.trim()) {
    return { ok: false, status: 400, code: 'reason_required', message: 'A reason is required to request a critical permission grant.' };
  }
  if (COMPLIANCE_GATED_KEYS.has(req.permissionKey)) {
    if (req.requestType !== 'user_override' || !req.targetUserId) {
      return {
        ok: false,
        status: 422,
        code: 'invalid_compliance_target',
        message: 'Compliance permissions can only be granted to a specific user.',
      };
    }
    if (!req.validFrom || !req.validUntil) {
      return {
        ok: false,
        status: 422,
        code: 'validity_required',
        message: 'A start and end time are required for compliance access.',
      };
    }

    const approvalId = `PGA-${crypto.randomUUID()}`;
    const { data, error } = await sb.rpc('request_compliance_permission_grant_tx', {
      p_request_id:        approvalId,
      p_actor_id:          actor.id,
      p_target_user_id:    req.targetUserId,
      p_permission_key:    req.permissionKey,
      p_reason:            req.reason.trim(),
      p_grant_valid_from:  req.validFrom,
      p_grant_valid_until: req.validUntil,
    }) as unknown as {
      data: unknown;
      error: { code: string; message: string } | null;
    };
    if (error) {
      const mapped = msgRpcHttpError(error);
      return {
        ok: false,
        status: (mapped.status === 400 || mapped.status === 403
          || mapped.status === 409 || mapped.status === 422
          ? mapped.status
          : 500),
        code: error.code,
        message: mapped.status ? mapped.message : 'Failed to create the approval request.',
      };
    }
    const result = (data ?? {}) as { status?: string; approval_id?: string };
    if (result.status === 'already_pending') {
      return { ok: false, status: 409, code: 'already_pending', message: 'A pending approval already exists for this grant.' };
    }
    if (result.status !== 'requested' || !result.approval_id) {
      return { ok: false, status: 500, code: 'unexpected_result', message: 'Failed to create the approval request.' };
    }

    // Notify eligible reviewers that a compliance access request needs review
    // (nav bubble + targeted rich toast → Access Control ▸ Approvals). Fire-and-
    // forget; dedupe-keyed so a re-emit for the same request never doubles.
    const requestApprovalId = result.approval_id;
    void (async () => {
      const approvers = await listComplianceGrantApprovers(actor.id);
      if (approvers.length === 0) return;
      await deliverEventNotifications({
        eventType: 'iam.permission.compliance_grant_requested',
        sourceModule: 'platform',
        sourceEntityType: 'permission_grant_approval',
        sourceEntityId: requestApprovalId,
        actorUserId: actor.id,
        severity: 'warning',
        explicitRecipients: approvers.map(userId => ({ userId, reason: 'explicit' as const })),
        notification: {
          title: 'Compliance access request',
          body: `${actor.username} requested compliance access — review and approve or reject.`,
          actionRoute: 's-ac-approvals',
          type: 'iam.permission.compliance_grant_requested',
        },
        dedupeKey: `iam.permission.compliance_grant_requested:${requestApprovalId}`,
      }, null);
    })().catch((err: unknown) => console.warn('[requestCriticalGrant] approver notification failed:', err));

    return { ok: true, approvalId: result.approval_id };
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
  if (error) {
    // The partial unique indexes (pga_uniq_pending_role/user) reject a duplicate
    // pending request even if the read-check above raced with a concurrent insert.
    if (error.code === '23505') {
      return { ok: false, status: 409, code: 'already_pending', message: 'A pending approval already exists for this grant.' };
    }
    console.error('[requestCriticalGrant] insert error:', error.message);
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
  validFrom:  z.iso.datetime().optional(),
  validUntil: z.iso.datetime().optional(),
});
const ClearUserPermSchema = z.object({
  userId:     z.string().min(1),
  permission: z.string().min(1),
  reason:     z.string().max(500).optional(),
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
  const rows = data as { id: string; username: string; full_name: string; role: string; email: string | null; position: string | null; status: string; profile_image: string | null; department_id: string | null }[];
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
    .select('permission, granted, valid_from, valid_until, approved_by, approval_id, revoked_at, revoked_by, revocation_reason')
    .eq('user_id', v.data.userId);
  if (error) {
    console.error('[superadmin/getUserPermissions] error:', error.message);
    return c.json({ success: false, message: 'Failed to load permissions.' }, 500);
  }
  return c.json({ success: true, permissions: data });
});

// POST /superadmin/setUserPermission — upsert an explicit grant/deny override.
router.post('/setUserPermission', async c => {
  const actor = await requirePermission(c, 'permissions.manage');
  const v = zv(c, SetUserPermSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { userId, permission, granted, reason, validFrom, validUntil } = v.data;

  if (!granted && COMPLIANCE_GATED_KEYS.has(permission)) {
    return c.json({
      success: false,
      code: 'compliance_revocation_route_required',
      message: 'Use the compliance revocation action with step-up verification and a reason.',
    }, 422);
  }

  // Critical ALLOW grant → maker-checker: create a pending approval, do NOT apply now.
  if (granted && isCriticalGrant(permission)) {
    const r = await requestCriticalGrant(actor, {
      requestType: 'user_override',
      targetUserId: userId,
      permissionKey: permission,
      reason: reason ?? '',
      validFrom,
      validUntil,
    });
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
  // Nudge the affected user's live session to re-pull its permission snapshot.
  void emitSignal([userId], 'permissions');
  return c.json({ success: true });
});

// POST /superadmin/clearUserPermission — remove an override (revert to role default).
router.post('/clearUserPermission', async c => {
  const actor = await requirePermission(c, 'permissions.manage');
  const v = zv(c, ClearUserPermSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { userId, permission, reason } = v.data;

  if (COMPLIANCE_GATED_KEYS.has(permission)) {
    await requireStepUp(c);
    if (!reason?.trim()) {
      return c.json({
        success: false,
        code: 'reason_required',
        message: 'A revocation reason is required for compliance access.',
      }, 400);
    }
    const { data, error } = await sb.rpc('revoke_compliance_permission_grant_tx', {
      p_actor_id:       actor.id,
      p_target_user_id: userId,
      p_permission_key: permission,
      p_reason:         reason.trim(),
    }) as unknown as {
      data: unknown;
      error: { code?: string; message: string } | null;
    };
    if (error) throw msgRpcHttpError(error);
    const result = (data ?? {}) as { status?: string };
    if (result.status === 'not_found') {
      return c.json({ success: false, message: 'Permission override not found.' }, 404);
    }
    if (result.status !== 'revoked'
        && result.status !== 'already_revoked'
        && result.status !== 'deny_cleared') {
      return c.json({ success: false, message: 'Unexpected revocation state.' }, 500);
    }
    // Nudge the affected user so the revoked compliance grant drops from their
    // live session (the shield disappears) without waiting for a reload.
    void emitSignal([userId], 'permissions');

    // Notify the grantee ONLY on a real revocation ('revoked'); a retry returns
    // 'already_revoked' (no-op) and 'deny_cleared' is not an access revocation,
    // so neither re-notifies.
    if (result.status === 'revoked') {
      void deliverEventNotifications({
        eventType: 'communications.compliance.access_revoked',
        sourceModule: 'communications',
        sourceEntityType: 'user',
        sourceEntityId: userId,
        actorUserId: actor.id,
        severity: 'warning',
        explicitRecipients: [{ userId, reason: 'explicit' }],
        notification: {
          title: 'Compliance access revoked',
          body: 'Your Messenger compliance access has been revoked.',
          actionRoute: 's-messages',
          type: 'communications.compliance.access_revoked',
        },
      }, null);
    }
    return c.json({ success: true, status: result.status });
  }

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
  // Nudge the affected user's live session to re-pull its permission snapshot.
  void emitSignal([userId], 'permissions');
  return c.json({ success: true });
});

// ── Active sessions: visibility + remote revoke ───────────────────────────────
// Gated by 'sessions.manage' (superadmin by default).

const RevokeSessionSchema = z.object({
  userId: z.string().min(1),
  // Client-generated once per attempt — the RPC's retry receipt (same key +
  // same target replays the committed result; different target → 409).
  idempotencyKey: z.uuid(),
});

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

  const rows = tokens as {
    user_id: string; user_agent: string | null; ip_address: string | null;
    last_seen_at: string; created_at: string; expires_at: string;
  }[];
  if (rows.length === 0) return c.json({ success: true, sessions: [] });

  // Join user identity in one query.
  const ids = [...new Set(rows.map(r => r.user_id))];
  const { data: users } = await sb
    .from('app_users')
    .select('id, username, full_name, role')
    .in('id', ids);
  const userMap = new Map(((users ?? []) as { id: string; username: string; full_name: string; role: string }[]).map(u => [u.id, u]));

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

// POST /superadmin/revokeSession — force-logout a user, ATOMICALLY:
// auth_revoke_user_sessions_tx owns the revocation marker, token purge, the
// single app_event AND the single audit row (no separate log_() — that would
// double-write the audit and could survive a failed revocation).
router.post('/revokeSession', async c => {
  const actor = await requirePermission(c, 'sessions.manage');
  const v = zv(c, RevokeSessionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { userId, idempotencyKey } = v.data;

  if (userId === actor.id) {
    return c.json({ success: false, message: 'You cannot revoke your own active session here.' }, 400);
  }

  try {
    const result = await revokeUserSessions(userId, { id: actor.id, username: actor.username }, idempotencyKey);
    return c.json({ success: true, data: result });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return c.json({ success: false, message: err.message ?? 'Session revocation failed' }, (err.status ?? 500) as 200);
  }
});

// ── Audit log viewer ──────────────────────────────────────────────────────────
// Gated by 'audit.view' (superadmin by default). Append-only table; read-only here.

const GetAuditLogsSchema = z.object({
  search:    z.string().optional(),
  action:    z.string().optional(),
  includeActions: z.array(z.string()).optional(), // whitelist (e.g. only real access changes)
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
  if (v.data.includeActions?.length) q = q.in('action', v.data.includeActions);
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

  // Enrich each row with the actor's display name / photo / title from app_users. The audit
  // row only carries a raw user_id + a possibly-code username, and superadmins aren't in the
  // console-user list — the server resolves them here (with a signed avatar URL).
  const logs = data as { id: string; user_id: string; username: string }[];
  const actorIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))];
  const actorMap = new Map<string, { name: string; title: string; photo: string }>();
  if (actorIds.length) {
    const { data: actors } = await sb.from('app_users')
      .select('id, full_name, username, position, role, profile_image')
      .in('id', actorIds);
    await Promise.all(((actors ?? []) as { id: string; full_name: string | null; username: string | null; position: string | null; role: string | null; profile_image: string | null }[]).map(async a => {
      actorMap.set(a.id, {
        name:  a.full_name ?? a.username ?? '',
        title: a.position ?? a.role ?? '',
        photo: await getProfileSignedUrl(a.id, a.profile_image),
      });
    }));
  }
  const enrichedLogs = logs.map(l => {
    const a = actorMap.get(l.user_id);
    return { ...l, actorName: a?.name ?? '', actorTitle: a?.title ?? '', actorPhoto: a?.photo ?? '' };
  });

  // Filter option lists (distinct actions/entities) — only on the first page.
  let actions: string[] = [];
  let entities: string[] = [];
  if (offset === 0) {
    const { data: distinct } = await sb.from('activity_logs').select('action, entity').limit(2000);
    const distinctRows = (distinct ?? []) as { action: string | null; entity: string | null }[];
    actions  = [...new Set(distinctRows.map(r => r.action).filter((x): x is string => Boolean(x)))].sort();
    entities = [...new Set(distinctRows.map(r => r.entity).filter((x): x is string => Boolean(x)))].sort();
  }

  return c.json({ success: true, logs: enrichedLogs, total: count ?? 0, actions, entities });
});

// ── Roles (roles-as-data) ─────────────────────────────────────────────────────
// Gated by 'roles.manage' (superadmin by default).

const RoleNameSchema  = z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits, underscore');
// Category = organizational tier (orthogonal to Source/is_system). A managed taxonomy
// (role_categories table), so this is a slug validated by FK, not a fixed enum. Required on create.
const RoleCategorySchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits, underscore');
const CreateRoleSchema = z.object({
  name:        RoleNameSchema,
  label:       z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  category:    RoleCategorySchema,
});
const UpdateRoleSchema = z.object({
  roleName:    z.string().min(1),
  label:       z.string().min(1).max(60).optional(),
  description: z.string().max(300).optional(),
  protected:   z.boolean().optional(),
  category:    RoleCategorySchema.optional(),
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
    .select('name, label, description, is_system, protected, sort_order, role_category')
    .order('sort_order');
  if (error) {
    console.error('[superadmin/listRoles] error:', error.message);
    return c.json({ success: false, message: 'Failed to load roles.' }, 500);
  }
  // User count per role (one grouped query).
  const { data: users } = await sb.from('app_users').select('role').eq('status', 'active');
  const counts = new Map<string, number>();
  for (const u of (users ?? []) as { role: string }[]) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);

  const out = (roles as { name: string; label: string | null; description: string | null; is_system: boolean; protected: boolean; sort_order: number | null; role_category: string | null }[]).map(r => ({
    name: r.name, label: r.label, description: r.description,
    isSystem: r.is_system, protected: r.protected, sortOrder: r.sort_order,
    category: r.role_category ?? null,
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
  return c.json({ success: true, permissions: (data as { permission: string }[]).map(r => r.permission) });
});

// POST /superadmin/createRole
router.post('/createRole', async c => {
  const actor = await requirePermission(c, 'roles.manage');
  const v = zv(c, CreateRoleSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { name, label, description, category } = v.data;
  const { error } = await sb.from('roles').insert({
    name, label, description: description ?? '', is_system: false, protected: false,
    sort_order: 100, role_category: category, updated_by: actor.username,
  });
  if (error) {
    if (error.code === '23505') return c.json({ success: false, message: 'A role with that name already exists.' }, 409);
    if (error.code === '23503') return c.json({ success: false, message: 'Unknown category.' }, 400);
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
  // Category (tier) reassignment — only for custom roles; built-ins keep their canonical
  // tier (D2). Also how a "Needs Categorization" custom role gets classified.
  if (v.data.category !== undefined && !role.is_system) patch.role_category = v.data.category;

  const { error } = await sb.from('roles').update(patch).eq('name', roleName);
  if (error) {
    if (error.code === '23503') return c.json({ success: false, message: 'Unknown category.' }, 400);
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

// ── Role categories (managed tiers) ───────────────────────────────────────────
const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const CreateCategorySchema = z.object({ label: z.string().min(1).max(40) });
const UpdateCategorySchema = z.object({ key: RoleCategorySchema, label: z.string().min(1).max(40).optional(), sortOrder: z.number().int().optional() });
const DeleteCategorySchema = z.object({ key: RoleCategorySchema });

// POST /superadmin/listRoleCategories — tiers + role counts.
router.post('/listRoleCategories', async c => {
  await requirePermission(c, 'roles.manage');
  const { data: cats, error } = await sb.from('role_categories').select('key, label, sort_order, is_system').order('sort_order');
  if (error) { console.error('[superadmin/listRoleCategories] error:', error.message); return c.json({ success: false, message: 'Failed to load tiers.' }, 500); }
  const { data: roles } = await sb.from('roles').select('role_category');
  const counts = new Map<string, number>();
  for (const r of (roles ?? []) as { role_category: string | null }[]) if (r.role_category) counts.set(r.role_category, (counts.get(r.role_category) ?? 0) + 1);
  const out = (cats as { key: string; label: string | null; sort_order: number | null; is_system: boolean }[]).map(x => ({ key: x.key, label: x.label, sortOrder: x.sort_order, isSystem: x.is_system, roleCount: counts.get(x.key) ?? 0 }));
  return c.json({ success: true, categories: out });
});

// POST /superadmin/createRoleCategory
router.post('/createRoleCategory', async c => {
  const actor = await requirePermission(c, 'roles.manage');
  const v = zv(c, CreateCategorySchema, c.get('body').args ?? {}); if (!v.ok) return v.response;
  const key = slugify(v.data.label);
  if (!key) return c.json({ success: false, message: 'Enter a valid tier name.' }, 400);
  const { data: max } = await sb.from('role_categories').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle<{ sort_order: number }>();
  const { error } = await sb.from('role_categories').insert({ key, label: v.data.label.trim(), sort_order: (max?.sort_order ?? 0) + 10, is_system: false });
  if (error) {
    if (error.code === '23505') return c.json({ success: false, message: 'A tier with that name already exists.' }, 409);
    console.error('[superadmin/createRoleCategory] error:', error.message);
    return c.json({ success: false, message: 'Failed to create tier.' }, 500);
  }
  await log_(actor, 'role_category_create', 'role_category', key, `created tier "${v.data.label.trim()}"`);
  return c.json({ success: true, key });
});

// POST /superadmin/updateRoleCategory — rename / reorder (system tiers can be renamed, not removed).
router.post('/updateRoleCategory', async c => {
  const actor = await requirePermission(c, 'roles.manage');
  const v = zv(c, UpdateCategorySchema, c.get('body').args ?? {}); if (!v.ok) return v.response;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.label !== undefined) patch.label = v.data.label.trim();
  if (v.data.sortOrder !== undefined) patch.sort_order = v.data.sortOrder;
  const { error } = await sb.from('role_categories').update(patch).eq('key', v.data.key);
  if (error) { console.error('[superadmin/updateRoleCategory] error:', error.message); return c.json({ success: false, message: 'Failed to update tier.' }, 500); }
  await log_(actor, 'role_category_update', 'role_category', v.data.key, JSON.stringify(patch));
  return c.json({ success: true });
});

// POST /superadmin/deleteRoleCategory — blocked for system tiers and tiers in use.
router.post('/deleteRoleCategory', async c => {
  const actor = await requirePermission(c, 'roles.manage');
  const v = zv(c, DeleteCategorySchema, c.get('body').args ?? {}); if (!v.ok) return v.response;
  const { data: cat } = await sb.from('role_categories').select('is_system').eq('key', v.data.key).maybeSingle<{ is_system: boolean }>();
  if (!cat) return c.json({ success: false, message: 'Tier not found.' }, 404);
  if (cat.is_system) return c.json({ success: false, message: 'Built-in tiers cannot be deleted.' }, 400);
  const { count } = await sb.from('roles').select('name', { count: 'exact', head: true }).eq('role_category', v.data.key) as unknown as { count: number };
  if (count && count > 0) return c.json({ success: false, message: `Cannot delete: ${count} role(s) use this tier. Reassign them first.` }, 400);
  const { error } = await sb.from('role_categories').delete().eq('key', v.data.key);
  if (error) { console.error('[superadmin/deleteRoleCategory] error:', error.message); return c.json({ success: false, message: 'Failed to delete tier.' }, 500); }
  await log_(actor, 'role_category_delete', 'role_category', v.data.key, 'deleted tier');
  return c.json({ success: true });
});

// POST /superadmin/setRolePermission — grant/revoke one permission in a role's default set.
router.post('/setRolePermission', async c => {
  const actor = await requirePermission(c, 'roles.manage');
  const v = zv(c, SetRolePermSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { roleName, permission, granted, reason } = v.data;

  if (roleName === 'superadmin') return c.json({ success: false, message: 'Superadmin permissions cannot be changed.' }, 400);
  if (granted && COMPLIANCE_GATED_KEYS.has(permission)) {
    return c.json({
      success: false,
      code: 'invalid_compliance_target',
      message: 'Compliance permissions can only be granted to a specific user.',
    }, 422);
  }

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
