/**
 * tabs/ApprovalsTab.tsx
 *
 * Maker-checker approval queue for critical permission grants.
 *
 * Lists pending permission-grant approval requests. For each row:
 *   - If the viewer is the REQUESTER → show Cancel action.
 *   - If the viewer is a DIFFERENT superadmin → show Approve (step-up) + Reject.
 *
 * The server enforces maker≠checker — the UI surfaces the error clearly if
 * somehow the same user attempts both. Approve goes through withStepUp().
 *
 * Optionally shows a small pending count badge on the tab (passed via context).
 */

import { type VNode } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { Modal }              from '@shared/Modal';
import { PERMISSION_META }    from '@lib/permissionMeta';
import { useSessionStore }    from '@store/session';
import {
  usePermissionApprovals,
  useApproveGrant,
  useRejectGrant,
  useCancelGrant,
} from '../hooks';
import type { PermissionApproval } from '@lib/superadminApi';

// ── Helpers ───────────────────────────────────────────────────────────────────

function permLabel(key: string): string {
  const meta = PERMISSION_META[key as keyof typeof PERMISSION_META];
  return meta ? `${meta.label} (${key})` : key;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

// ── Reject dialog ─────────────────────────────────────────────────────────────

function RejectDialog({ approval, onConfirm, onCancel }: {
  approval: PermissionApproval;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}): VNode {
  const [reason, setReason] = useState('');

  const footer = (
    <>
      <button
        type="button"
        onClick={onCancel}
        style={{ padding: '8px 20px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() => onConfirm(reason.trim() || undefined)}
        style={{ padding: '8px 20px', background: 'var(--siomac-red, #dc2626)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}
      >
        Reject
      </button>
    </>
  );

  return (
    <Modal open onClose={onCancel} title="Reject permission grant" size="sm" footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>
          Rejecting the grant of <strong>{permLabel(approval.permissionKey)}</strong>
          {approval.requestType === 'role_permission'
            ? ` for role ${approval.targetRole ?? ''}`
            : ` for user ${approval.targetUserId ?? ''}`}.
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
            Reason <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>(optional)</span>
          </label>
          <textarea
            value={reason}
            onInput={e => setReason((e.target as HTMLTextAreaElement).value)}
            placeholder="Why is this request being rejected?"
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              border: '1px solid var(--border, #d1d5db)', borderRadius: '6px',
              fontSize: '13px', resize: 'vertical', fontFamily: 'inherit',
              background: 'var(--bg-input, #fff)', color: 'var(--text-primary)',
            }}
            autoFocus
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Single approval row ───────────────────────────────────────────────────────

function ApprovalRow({ approval, currentUserId }: {
  approval: PermissionApproval;
  currentUserId: string;
}): VNode {
  const isOwn     = approval.requestedBy === currentUserId;
  const expired   = isExpired(approval.expiresAt);
  const approve   = useApproveGrant();
  const reject    = useRejectGrant();
  const cancel    = useCancelGrant();
  const [showReject, setShowReject] = useState(false);

  const handleApprove = useCallback(() => {
    approve.mutate(approval.id);
  }, [approve, approval.id]);

  const handleReject = useCallback((reason?: string) => {
    setShowReject(false);
    reject.mutate({ approvalId: approval.id, reason });
  }, [reject, approval.id]);

  const handleCancel = useCallback(() => {
    cancel.mutate(approval.id);
  }, [cancel, approval.id]);

  const busy = approve.isPending || reject.isPending || cancel.isPending;

  return (
    <>
      {showReject && (
        <RejectDialog
          approval={approval}
          onConfirm={handleReject}
          onCancel={() => setShowReject(false)}
        />
      )}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '14px 16px',
        borderBottom: '1px solid var(--border)',
        background: expired ? 'rgba(239,68,68,0.04)' : undefined,
      }}>
        {/* Main info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <span style={{ fontWeight: '600', fontSize: '13.5px', color: 'var(--text-primary)' }}>
              {permLabel(approval.permissionKey)}
            </span>
            {expired && (
              <span style={{ fontSize: '10.5px', fontWeight: '700', padding: '2px 6px', borderRadius: '10px', background: 'rgba(239,68,68,0.1)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.25)' }}>
                EXPIRED
              </span>
            )}
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '6px' }}>
            <span>
              <i class="fas fa-bullseye" style={{ marginRight: '4px', opacity: 0.6 }} />
              {approval.requestType === 'role_permission'
                ? `Role: ${approval.targetRole ?? '—'}`
                : `User: ${approval.targetUserId ?? '—'}`}
            </span>
            <span>
              <i class="fas fa-user" style={{ marginRight: '4px', opacity: 0.6 }} />
              Requested by <strong>{approval.requestedByName}</strong>
            </span>
            <span>
              <i class="fas fa-calendar" style={{ marginRight: '4px', opacity: 0.6 }} />
              {formatDate(approval.requestedAt)}
            </span>
            <span>
              <i class="fas fa-hourglass-end" style={{ marginRight: '4px', opacity: 0.6 }} />
              Expires {formatDate(approval.expiresAt)}
            </span>
          </div>
          {approval.reason && (
            <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', fontStyle: 'italic', background: 'var(--bg-subtle)', padding: '6px 10px', borderRadius: '5px', borderLeft: '3px solid var(--border)' }}>
              "{approval.reason}"
            </div>
          )}
          {/* Self-approval notice */}
          {isOwn && (
            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <i class="fas fa-info-circle" />
              You submitted this request. A different superadmin must approve it.
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center' }}>
          {isOwn ? (
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              style={{
                padding: '6px 14px', fontSize: '12.5px', fontWeight: '600', borderRadius: '6px',
                border: '1px solid var(--border)', background: '#f9fafb', color: 'var(--text-secondary)',
                cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
              }}
            >
              {cancel.isPending ? <i class="fas fa-spinner fa-spin" /> : 'Cancel request'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleApprove}
                disabled={busy || expired}
                title={expired ? 'This request has expired' : 'Approve (requires step-up verification)'}
                style={{
                  padding: '6px 14px', fontSize: '12.5px', fontWeight: '600', borderRadius: '6px',
                  border: 'none',
                  background: busy || expired ? '#9ca3af' : 'var(--siomac-navy, #1e3a5f)',
                  color: '#fff', cursor: busy || expired ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                }}
              >
                {approve.isPending
                  ? <><i class="fas fa-spinner fa-spin" /> Approving…</>
                  : <><i class="fas fa-shield-check" /> Approve</>}
              </button>
              <button
                type="button"
                onClick={() => setShowReject(true)}
                disabled={busy}
                style={{
                  padding: '6px 14px', fontSize: '12.5px', fontWeight: '600', borderRadius: '6px',
                  border: '1px solid rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.06)',
                  color: 'var(--siomac-red, #dc2626)', cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {reject.isPending ? <i class="fas fa-spinner fa-spin" /> : 'Reject'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Tab root ──────────────────────────────────────────────────────────────────

export function ApprovalsTab(): VNode {
  const userId = useSessionStore(s => s.userId);
  const approvalsQ = usePermissionApprovals('pending');
  const approvals  = approvalsQ.data ?? [];

  if (approvalsQ.isLoading) {
    return (
      <div class="emp-loading">
        <i class="fas fa-spinner fa-spin" /> Loading approval requests…
      </div>
    );
  }

  if (approvalsQ.isError) {
    return (
      <div class="emp-loading emp-err">
        <i class="fas fa-exclamation-triangle" /> Failed to load approvals.{' '}
        <button
          type="button"
          onClick={() => void approvalsQ.refetch()}
          style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Critical permission grants require a second superadmin's approval before they take effect.
            Approve with step-up verification, or reject with an optional reason.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void approvalsQ.refetch()}
          disabled={approvalsQ.isFetching}
          style={{
            padding: '6px 12px', fontSize: '12.5px', borderRadius: '6px',
            border: '1px solid var(--border)', background: '#f9fafb', color: 'var(--text-secondary)',
            cursor: approvalsQ.isFetching ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: '6px',
          }}
        >
          <i class={`fas fa-arrows-rotate${approvalsQ.isFetching ? ' fa-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {approvals.length === 0 ? (
        <div style={{
          padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)',
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        }}>
          <i class="fas fa-check-circle" style={{ fontSize: '28px', marginBottom: '10px', display: 'block', color: '#16a34a', opacity: 0.6 }} />
          <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '4px', color: 'var(--text-primary)' }}>
            No pending approvals
          </div>
          <div style={{ fontSize: '13px' }}>
            All critical permission grants have been reviewed.
          </div>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--siomac-navy)' }}>
              Pending requests
            </span>
            <span style={{
              fontSize: '11px', fontWeight: '700', padding: '1px 7px', borderRadius: '10px',
              background: 'rgba(234,179,8,0.15)', color: '#713f12', border: '1px solid rgba(234,179,8,0.3)',
            }}>
              {approvals.length}
            </span>
          </div>
          {approvals.map(a => (
            <ApprovalRow key={a.id} approval={a} currentUserId={userId ?? ''} />
          ))}
        </div>
      )}
    </div>
  );
}
