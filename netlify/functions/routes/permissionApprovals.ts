/**
 * routes/permissionApprovals.ts
 *
 * Maker-checker approval routes for permission grants that require review.
 * A gated grant request does NOT take effect immediately — it creates a pending
 * permission_grant_approvals row. A different authorized reviewer (maker ≠
 * checker) must approve it here before it applies.
 *
 * Review scopes:
 *   - permissions.manage: full queue for all gated permission grants.
 *   - communications.compliance_approve: only time-boxed compliance_read/export grants.
 *
 * Routes (all POST):
 *   POST /api/admin/approvals/list    — pending (or filtered) approval requests
 *   POST /api/admin/approvals/approve — approve a pending request (step-up required, maker≠checker)
 *   POST /api/admin/approvals/reject  — reject a pending request (maker≠checker enforced)
 *   POST /api/admin/approvals/cancel  — requester cancels their own pending request (permissions.manage)
 */

import { Hono }                      from 'hono';
import { sb }                        from '../lib/db';
import { requirePermission, requireUser, userCan } from '../lib/auth';
import { requireStepUp }             from '../lib/stepUp';
import { invalidateRolePermissions } from '../lib/permissions';
import { emitSignal }                from '../lib/communications';
import { deliverEventNotifications } from '../lib/appEvents';
import {
  COMPLIANCE_ACCESS_GRANT_KEYS,
  canReviewPermissionGrant,
  isComplianceAccessGrant,
  resolvePermissionApprovalScope,
  type PermissionApprovalScope,
} from '../lib/permissionApprovalScope';
import { z, zv }                     from '../lib/validate';
import type { HonoVariables }        from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Schemas ───────────────────────────────────────────────────────────────────

const ListSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});

const MarkSeenSchema = z.object({
  // The exact approval ids the reviewer just rendered. The ids ARE the snapshot —
  // no client/DB clock comparison — and the backend revalidates each one.
  approvalIds: z.array(z.string().min(1)).max(1000),
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
  grant_valid_from:  string | null;
  grant_valid_until: string | null;
  created_at:      string;
}

async function requireApprovalScope(
  c: Parameters<typeof requireUser>[0],
): Promise<{ actor: Awaited<ReturnType<typeof requireUser>>; scope: PermissionApprovalScope }> {
  const actor = await requireUser(c);
  const [canManagePermissions, canApproveCompliance] = await Promise.all([
    userCan(actor, 'permissions.manage'),
    userCan(actor, 'communications.compliance_approve'),
  ]);
  const scope = resolvePermissionApprovalScope(canManagePermissions, canApproveCompliance);
  if (!scope) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return { actor, scope };
}

async function approvalPermissionKey(approvalId: string): Promise<{
  permissionKey: string | null;
  error: { message: string } | null;
}> {
  const { data, error } = await sb
    .from('permission_grant_approvals')
    .select('permission_key')
    .eq('id', approvalId)
    .maybeSingle();
  return {
    permissionKey: (data as { permission_key?: string } | null)?.permission_key ?? null,
    error: error ? { message: error.message } : null,
  };
}

async function enforceApprovalTarget(
  c: Parameters<typeof requireUser>[0],
  scope: PermissionApprovalScope,
  approvalId: string,
): Promise<Response | null> {
  const target = await approvalPermissionKey(approvalId);
  if (target.error) {
    console.error('[approvals/scope] approval lookup error:', target.error.message);
    return c.json({ success: false, message: 'Failed to validate approval scope.' }, 500);
  }
  if (!target.permissionKey) {
    return c.json({ success: false, message: 'Approval not found.' }, 404);
  }
  if (!canReviewPermissionGrant(scope, target.permissionKey)) {
    return c.json({ success: false, message: 'This approval is outside your authorized scope.' }, 403);
  }
  return null;
}

// ── POST /api/admin/approvals/list ────────────────────────────────────────────

router.post('/list', async c => {
  const { scope } = await requireApprovalScope(c);

  const v = zv(c, ListSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const statusFilter = v.data.status ?? 'pending';

  let query = sb
    .from('permission_grant_approvals')
    .select('*')
    .eq('status', statusFilter);
  if (scope === 'compliance') {
    query = query.in('permission_key', [...COMPLIANCE_ACCESS_GRANT_KEYS]);
  }
  const { data, error } = await query.order('requested_at', { ascending: false });

  if (error) {
    console.error('[approvals/list] error:', error.message);
    return c.json({ success: false, message: 'Failed to load approvals.' }, 500);
  }

  const rows = data as ApprovalRow[];

  // Enrich with requester/decider display names
  const userIds = [...new Set([
    ...rows.map(r => r.requested_by),
    ...rows.map(r => r.decided_by).filter((id): id is string => id !== null),
  ])];

  let nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users, error: usersError } = await sb
      .from('app_users')
      .select('id, username, full_name')
      .in('id', userIds);
    if (usersError) {
      console.error('[approvals/list] user enrichment error:', usersError.message);
      return c.json({ success: false, message: 'Failed to load approval actors.' }, 500);
    }
    nameMap = new Map(
      (users as { id: string; username: string; full_name: string }[])
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
    grantValidFrom:  r.grant_valid_from,
    grantValidUntil: r.grant_valid_until,
  }));

  return c.json({ success: true, approvals });
});

// ── POST /api/admin/approvals/counts ──────────────────────────────────────────
// Actionable pending requests for this reviewer, split into the full backlog
// (pendingActionableCount) and the NOT-yet-acknowledged subset
// (unseenActionableCount = actionable pending with no per-reviewer seen receipt).
// The badge shows unseen; the queue shows pending. Receipts are per-approval, so a
// scope expansion (compliance-only → +permissions.manage) correctly surfaces older,
// previously-invisible approvals as unseen (they were never receipted).
router.post('/counts', async c => {
  const { actor, scope } = await requireApprovalScope(c);

  let query = sb
    .from('permission_grant_approvals')
    .select('id, requested_by')
    .eq('status', 'pending');
  if (scope === 'compliance') {
    query = query.in('permission_key', [...COMPLIANCE_ACCESS_GRANT_KEYS]);
  }
  const { data, error } = await query;
  if (error) {
    console.error('[approvals/counts] error:', error.message);
    return c.json({ success: false, message: 'Failed to load approval counts.' }, 500);
  }

  // Maker ≠ checker: a reviewer's OWN requests are never actionable by them.
  const actionable = (data as { id: string; requested_by: string }[])
    .filter(r => r.requested_by !== actor.id);
  const pendingActionableCount = actionable.length;

  let seen = new Set<string>();
  if (actionable.length > 0) {
    const { data: receipts, error: rErr } = await sb
      .from('approval_seen_receipts')
      .select('approval_id')
      .eq('user_id', actor.id)
      .in('approval_id', actionable.map(r => r.id));
    if (rErr) {
      console.error('[approvals/counts] receipts error:', rErr.message);
      return c.json({ success: false, message: 'Failed to load approval counts.' }, 500);
    }
    seen = new Set((receipts as { approval_id: string }[]).map(r => r.approval_id));
  }
  const unseenActionableCount = actionable.filter(r => !seen.has(r.id)).length;

  return c.json({ success: true, pendingActionableCount, unseenActionableCount });
});

// ── POST /api/admin/approvals/markSeen ────────────────────────────────────────
// Record a per-approval seen receipt for exactly the approval ids the reviewer
// rendered (the ids ARE the snapshot — no client/DB clock comparison, so no
// acknowledgement race). Each id is REVALIDATED server-side as still pending,
// actionable (not the reviewer's own request), and in the reviewer's CURRENT scope
// before a receipt is written — a client can only acknowledge what it can act on,
// and a request committed after the render (absent from `approvalIds`) stays unseen.
// Clears unseenActionableCount only; the pending backlog is unchanged.
router.post('/markSeen', async c => {
  const { actor, scope } = await requireApprovalScope(c);
  const v = zv(c, MarkSeenSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const ids = [...new Set(v.data.approvalIds)];
  if (ids.length === 0) return c.json({ success: true, receiptCount: 0 });

  let query = sb
    .from('permission_grant_approvals')
    .select('id')
    .in('id', ids)
    .eq('status', 'pending')
    .neq('requested_by', actor.id);          // maker ≠ checker
  if (scope === 'compliance') {
    query = query.in('permission_key', [...COMPLIANCE_ACCESS_GRANT_KEYS]);
  }
  const { data, error } = await query;
  if (error) {
    console.error('[approvals/markSeen] revalidation error:', error.message);
    return c.json({ success: false, message: 'Failed to record approvals seen.' }, 500);
  }

  const rows = data as { id: string }[];
  if (rows.length > 0) {
    const receipts = rows.map(r => ({ user_id: actor.id, approval_id: r.id }));
    const { error: upErr } = await sb
      .from('approval_seen_receipts')
      .upsert(receipts, { onConflict: 'user_id,approval_id', ignoreDuplicates: true });
    if (upErr) {
      console.error('[approvals/markSeen] receipt error:', upErr.message);
      return c.json({ success: false, message: 'Failed to record approvals seen.' }, 500);
    }
  }
  return c.json({ success: true, receiptCount: rows.length });
});

// ── POST /api/admin/approvals/approve ─────────────────────────────────────────

router.post('/approve', async c => {
  const { actor, scope } = await requireApprovalScope(c);

  const v = zv(c, ApproveSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { approvalId } = v.data;
  const scopeError = await enforceApprovalTarget(c, scope, approvalId);
  if (scopeError) return scopeError;
  await requireStepUp(c);

  // Apply the grant + mark the approval approved in ONE atomic DB transaction.
  // The RPC row-locks the pending request, re-checks status / expiry / segregation
  // of duties, applies the grant to live RBAC, and flips status→approved. If any
  // step fails the whole call rolls back — a grant can never be applied while its
  // approval row is left pending, and two concurrent approvals serialize on the lock.
  const { data: rpcData, error: rpcErr } = await sb.rpc('approve_permission_grant_tx', {
    p_approval_id:      approvalId,
    p_checker_id:       actor.id,
    p_checker_username: actor.username,
  }) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
  if (rpcErr) {
    console.error('[approvals/approve] rpc error:', rpcErr.message);
    return c.json({ success: false, message: 'Failed to apply the permission grant.' }, 500);
  }

  const result = (rpcData ?? {}) as {
    status:
      | 'applied'
      | 'not_found'
      | 'not_pending'
      | 'expired'
      | 'self_approval'
      | 'target_inactive'
      | 'invalid_compliance_target'
      | 'invalid_compliance_effect'
      | 'invalid_validity';
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
    case 'target_inactive':
      return c.json({ success: false, code: result.status, message: 'The target user is no longer active.' }, 409);
    case 'invalid_compliance_target':
      return c.json({ success: false, code: result.status, message: 'Compliance access must target one user.' }, 422);
    case 'invalid_compliance_effect':
      return c.json({ success: false, code: result.status, message: 'Compliance access can only be approved as an allow grant.' }, 422);
    case 'invalid_validity':
      return c.json({ success: false, code: result.status, message: 'The compliance grant validity window is no longer valid.' }, 422);
    default:              return c.json({ success: false, message: 'Unexpected approval state.' }, 500);
  }

  // The DB write is committed; drop the in-memory role-permission cache for role
  // grants so the new grant resolves immediately on the next authorization check.
  if (result.request_type === 'role_permission' && result.target_role) {
    invalidateRolePermissions(result.target_role);
  }

  // Targeted realtime nudge: the affected user (never the approver — maker-checker)
  // re-pulls their permission snapshot so the grant reflects in their live session
  // without a reload. Fire-and-forget; login/token-refresh/focus are the fallbacks.
  if (result.request_type === 'user_override' && result.target_user_id) {
    void emitSignal([result.target_user_id], 'permissions');

    // Real state change (status='applied' → we're past the switch) on a compliance
    // access grant → notify the grantee (nav bubble + notification centre). Reaching
    // here means the grant was actually applied, so a retry (→ 'not_pending') never
    // re-notifies; the dedupeKey also guards double-delivery.
    if (isComplianceAccessGrant(result.permission_key ?? '')) {
      const grantee = result.target_user_id;
      void (async () => {
        const { data: appr } = await sb
          .from('permission_grant_approvals')
          .select('grant_valid_until')
          .eq('id', approvalId)
          .maybeSingle<{ grant_valid_until: string | null }>();
        const until = appr?.grant_valid_until;
        const untilCopy = until ? ` until ${until.slice(0, 16).replace('T', ' ')} UTC` : '';
        await deliverEventNotifications({
          eventType: 'communications.compliance.access_granted',
          sourceModule: 'communications',
          sourceEntityType: 'user',
          sourceEntityId: grantee,
          actorUserId: actor.id,
          severity: 'info',
          explicitRecipients: [{ userId: grantee, reason: 'explicit' }],
          notification: {
            title: 'Compliance access granted',
            body: `You can now view Messenger compliance conversations${untilCopy}.`,
            actionRoute: 's-messages',
            type: 'communications.compliance.access_granted',
          },
          dedupeKey: `communications.compliance.access_granted:${approvalId}`,
        }, null);
      })().catch((err: unknown) => console.warn('[approvals/approve] compliance grant notification failed:', err));
    }
  }

  return c.json({ success: true });
});

// ── POST /api/admin/approvals/reject ──────────────────────────────────────────

router.post('/reject', async c => {
  const { actor, scope } = await requireApprovalScope(c);
  const v = zv(c, RejectSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { approvalId, reason } = v.data;
  const scopeError = await enforceApprovalTarget(c, scope, approvalId);
  if (scopeError) return scopeError;

  // ONE atomic transaction (row lock + pending re-check + maker≠checker inside
  // the tx) — a concurrent approve can no longer apply the grant between a
  // read and this status flip.
  const { data: rpcData, error: rpcErr } = await sb.rpc('reject_permission_grant_tx', {
    p_approval_id: approvalId,
    p_checker_id:  actor.id,
    p_reason:      reason ?? '',
  }) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
  if (rpcErr) {
    console.error('[approvals/reject] rpc error:', rpcErr.message);
    return c.json({ success: false, message: 'Failed to reject approval.' }, 500);
  }
  const row = (rpcData ?? {}) as { status: string; current?: string; permission_key?: string; requested_by?: string };
  switch (row.status) {
    case 'rejected':      break;
    case 'not_found':     return c.json({ success: false, message: 'Approval not found.' }, 404);
    case 'not_pending':   return c.json({ success: false, message: `Cannot reject: request is already ${row.current}.` }, 400);
    case 'self_approval': return c.json({ success: false, code: 'self_approval', message: 'You cannot reject your own permission grant request.' }, 403);
    default:              return c.json({ success: false, message: 'Unexpected approval state.' }, 500);
  }

  return c.json({ success: true });
});

// ── POST /api/admin/approvals/cancel ──────────────────────────────────────────

router.post('/cancel', async c => {
  const actor = await requirePermission(c, 'permissions.manage');
  const v = zv(c, CancelSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { approvalId } = v.data;

  // ONE atomic transaction (row lock + pending re-check + requester-only inside
  // the tx) — cannot race a concurrent approve.
  const { data: rpcData, error: rpcErr } = await sb.rpc('cancel_permission_grant_tx', {
    p_approval_id: approvalId,
    p_actor_id:    actor.id,
  }) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
  if (rpcErr) {
    console.error('[approvals/cancel] rpc error:', rpcErr.message);
    return c.json({ success: false, message: 'Failed to cancel approval.' }, 500);
  }
  const row = (rpcData ?? {}) as { status: string; current?: string; permission_key?: string };
  switch (row.status) {
    case 'cancelled':     break;
    case 'not_found':     return c.json({ success: false, message: 'Approval not found.' }, 404);
    case 'not_pending':   return c.json({ success: false, message: `Cannot cancel: request is already ${row.current}.` }, 400);
    case 'not_requester': return c.json({ success: false, message: 'Only the requester can cancel this approval request.' }, 403);
    default:              return c.json({ success: false, message: 'Unexpected approval state.' }, 500);
  }

  return c.json({ success: true });
});

export default router;
