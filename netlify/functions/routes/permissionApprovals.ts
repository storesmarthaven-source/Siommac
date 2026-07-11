/**
 * routes/permissionApprovals.ts
 *
 * Maker-checker approval routes for critical permission grants.
 * A critical permission grant (isCriticalGrant(key) && effect=allow) does NOT
 * take effect immediately — it creates a pending permission_grant_approvals row.
 * A DIFFERENT superadmin (maker ≠ checker) must approve it here before it applies.
 *
 * Routes (all POST, all require permissions.manage):
 *   POST /api/admin/approvals/list    — pending (or filtered) approval requests
 *   POST /api/admin/approvals/approve — approve a pending request (step-up required, maker≠checker)
 *   POST /api/admin/approvals/reject  — reject a pending request (maker≠checker enforced)
 *   POST /api/admin/approvals/cancel  — requester cancels their own pending request
 */

import { Hono }                      from 'hono';
import { sb }                        from '../lib/db';
import { requirePermission, log_ }   from '../lib/auth';
import { requireStepUp }             from '../lib/stepUp';
import { emitAppEvent }             from '../lib/appEvents';
import { invalidateRolePermissions } from '../lib/permissions';
import { z, zv }                     from '../lib/validate';
import type { HonoVariables }        from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Schemas ───────────────────────────────────────────────────────────────────

const ListSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});

const ApproveSchema = z.object({
  approvalId: z.string().min(1),
});

const RejectSchema = z.object({
  approvalId: z.string().min(1),
  reason:     z.string().optional(),
});

const CancelSchema = z.object({
  approvalId: z.string().min(1),
});

// ── Row type ──────────────────────────────────────────────────────────────────

interface ApprovalRow {
  id:              string;
  request_type:    'role_permission' | 'user_override';
  target_role:     string | null;
  target_user_id:  string | null;
  permission_key:  string;
  effect:          string;
  reason:          string;
  status:          string;
  requested_by:    string;
  requested_at:    string;
  decided_by:      string | null;
  decided_at:      string | null;
  decision_reason: string | null;
  applied_at:      string | null;
  expires_at:      string;
  created_at:      string;
}

// ── POST /api/admin/approvals/list ────────────────────────────────────────────

router.post('/list', async c => {
  await requirePermission(c, 'permissions.manage');

  const v = zv(c, ListSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const statusFilter = v.data.status ?? 'pending';

  const { data, error } = await sb
    .from('permission_grant_approvals')
    .select('*')
    .eq('status', statusFilter)
    .order('requested_at', { ascending: false });

  if (error) {
    console.error('[approvals/list] error:', error.message);
    return c.json({ success: false, message: 'Failed to load approvals.' }, 500);
  }

  const rows = (data ?? []) as ApprovalRow[];

  // Enrich with requester/decider display names
  const userIds = [...new Set([
    ...rows.map(r => r.requested_by),
    ...rows.map(r => r.decided_by).filter((id): id is string => id !== null),
  ])];

  let nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await sb
      .from('app_users')
      .select('id, username, full_name')
      .in('id', userIds);
    nameMap = new Map(
      ((users ?? []) as { id: string; username: string; full_name: string }[])
        .map(u => [u.id, u.full_name || u.username]),
    );
  }

  const approvals = rows.map(r => ({
    id:              r.id,
    requestType:     r.request_type,
    targetRole:      r.target_role,
    targetUserId:    r.target_user_id,
    permissionKey:   r.permission_key,
    effect:          r.effect,
    reason:          r.reason,
    status:          r.status,
    requestedBy:     r.requested_by,
    requestedByName: nameMap.get(r.requested_by) ?? r.requested_by,
    requestedAt:     r.requested_at,
    decidedBy:       r.decided_by,
    decidedByName:   r.decided_by ? (nameMap.get(r.decided_by) ?? r.decided_by) : null,
    decidedAt:       r.decided_at,
    decisionReason:  r.decision_reason,
    appliedAt:       r.applied_at,
    expiresAt:       r.expires_at,
  }));

  return c.json({ success: true, approvals });
});

// ── POST /api/admin/approvals/approve ─────────────────────────────────────────

router.post('/approve', async c => {
  // Permission check first (RBAC gate), then step-up freshness check
  const actor = await requirePermission(c, 'permissions.manage');
  await requireStepUp(c);

  const v = zv(c, ApproveSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { approvalId } = v.data;

  // Apply the grant + mark the approval approved in ONE atomic DB transaction.
  // The RPC row-locks the pending request, re-checks status / expiry / segregation
  // of duties, applies the grant to live RBAC, and flips status→approved. If any
  // step fails the whole call rolls back — a grant can never be applied while its
  // approval row is left pending, and two concurrent approvals serialize on the lock.
  const { data: rpcData, error: rpcErr } = await sb.rpc('approve_permission_grant_tx', {
    p_approval_id:      approvalId,
    p_checker_id:       actor.id,
    p_checker_username: actor.username,
  });
  if (rpcErr) {
    console.error('[approvals/approve] rpc error:', rpcErr.message);
    return c.json({ success: false, message: 'Failed to apply the permission grant.' }, 500);
  }

  const result = (rpcData ?? {}) as {
    status:          'applied' | 'not_found' | 'not_pending' | 'expired' | 'self_approval';
    current?:        string;
    request_type?:   'role_permission' | 'user_override';
    target_role?:    string | null;
    target_user_id?: string | null;
    permission_key?: string;
    effect?:         string;
    requested_by?:   string;
  };

  switch (result.status) {
    case 'applied':       break;
    case 'not_found':     return c.json({ success: false, message: 'Approval not found.' }, 404);
    case 'not_pending':   return c.json({ success: false, message: `Cannot approve: request is already ${result.current}.` }, 400);
    case 'expired':       return c.json({ success: false, code: 'expired', message: 'This approval request has expired.' }, 400);
    case 'self_approval': return c.json({ success: false, code: 'self_approval', message: 'You cannot approve your own permission grant request.' }, 403);
    default:              return c.json({ success: false, message: 'Unexpected approval state.' }, 500);
  }

  // The DB write is committed; drop the in-memory role-permission cache for role
  // grants so the new grant resolves immediately on the next authorization check.
  if (result.request_type === 'role_permission' && result.target_role) {
    invalidateRolePermissions(result.target_role);
  }

  // Audit log
  await log_(actor, 'permission_grant_approved', 'permission_grant_approval', approvalId,
    `approved ${result.permission_key} ${result.request_type === 'role_permission' ? 'for role ' + (result.target_role ?? '') : 'for user ' + (result.target_user_id ?? '')}`);

  // Emit audit events
  await Promise.all([
    emitAppEvent({
      eventType: 'iam.permission.grant_approved',
      sourceModule: 'platform',
      sourceEntityType: 'permission_grant_approval',
      sourceEntityId: approvalId,
      actorUserId: actor.id,
      severity: 'warning',
      payload: { permissionKey: result.permission_key, approvalId, requestedBy: result.requested_by },
    }),
    emitAppEvent({
      eventType: 'iam.permission.granted',
      sourceModule: 'platform',
      sourceEntityType: 'permission_grant_approval',
      sourceEntityId: approvalId,
      actorUserId: actor.id,
      severity: 'success',
      payload: { permissionKey: result.permission_key, target: result.target_role ?? result.target_user_id },
    }),
  ]);

  return c.json({ success: true });
});

// ── POST /api/admin/approvals/reject ──────────────────────────────────────────

router.post('/reject', async c => {
  const actor = await requirePermission(c, 'permissions.manage');
  const v = zv(c, RejectSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { approvalId, reason } = v.data;

  const { data: row, error: fetchErr } = await sb
    .from('permission_grant_approvals')
    .select('*')
    .eq('id', approvalId)
    .maybeSingle<ApprovalRow>();

  if (fetchErr) {
    console.error('[approvals/reject] fetch error:', fetchErr.message);
    return c.json({ success: false, message: 'Failed to load approval.' }, 500);
  }
  if (!row) return c.json({ success: false, message: 'Approval not found.' }, 404);
  if (row.status !== 'pending') {
    return c.json({ success: false, message: `Cannot reject: request is already ${row.status}.` }, 400);
  }

  // Maker ≠ checker
  if (row.requested_by === actor.id) {
    return c.json({ success: false, code: 'self_approval', message: 'You cannot reject your own permission grant request.' }, 403);
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from('permission_grant_approvals')
    .update({ status: 'rejected', decided_by: actor.id, decided_at: now, decision_reason: reason ?? null })
    .eq('id', approvalId);

  if (error) {
    console.error('[approvals/reject] error:', error.message);
    return c.json({ success: false, message: 'Failed to reject approval.' }, 500);
  }

  await log_(actor, 'permission_grant_rejected', 'permission_grant_approval', approvalId,
    `rejected ${row.permission_key}`);

  await emitAppEvent({
    eventType: 'iam.permission.grant_rejected',
    sourceModule: 'platform',
    sourceEntityType: 'permission_grant_approval',
    sourceEntityId: approvalId,
    actorUserId: actor.id,
    severity: 'info',
    payload: { permissionKey: row.permission_key, approvalId, requestedBy: row.requested_by, reason },
  });

  return c.json({ success: true });
});

// ── POST /api/admin/approvals/cancel ──────────────────────────────────────────

router.post('/cancel', async c => {
  const actor = await requirePermission(c, 'permissions.manage');
  const v = zv(c, CancelSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { approvalId } = v.data;

  const { data: row, error: fetchErr } = await sb
    .from('permission_grant_approvals')
    .select('id, status, requested_by, permission_key')
    .eq('id', approvalId)
    .maybeSingle<Pick<ApprovalRow, 'id' | 'status' | 'requested_by' | 'permission_key'>>();

  if (fetchErr) {
    console.error('[approvals/cancel] fetch error:', fetchErr.message);
    return c.json({ success: false, message: 'Failed to load approval.' }, 500);
  }
  if (!row) return c.json({ success: false, message: 'Approval not found.' }, 404);
  if (row.status !== 'pending') {
    return c.json({ success: false, message: `Cannot cancel: request is already ${row.status}.` }, 400);
  }

  // Only the requester can cancel
  if (row.requested_by !== actor.id) {
    return c.json({ success: false, message: 'Only the requester can cancel this approval request.' }, 403);
  }

  const { error } = await sb
    .from('permission_grant_approvals')
    .update({ status: 'cancelled', decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq('id', approvalId);

  if (error) {
    console.error('[approvals/cancel] error:', error.message);
    return c.json({ success: false, message: 'Failed to cancel approval.' }, 500);
  }

  await log_(actor, 'permission_grant_cancelled', 'permission_grant_approval', approvalId,
    `cancelled request for ${row.permission_key}`);

  return c.json({ success: true });
});

export default router;
