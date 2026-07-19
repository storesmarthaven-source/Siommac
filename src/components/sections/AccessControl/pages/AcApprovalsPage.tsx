/**
 * src/components/sections/AccessControl/pages/AcApprovalsPage.tsx
 *
 * Access Control — Approvals. Maker-checker queue for critical permission grants,
 * rendered in the `.acx` design system (no dedicated mockup). Wired to the console
 * approval hooks: a different authorized reviewer approves (step-up) or rejects;
 * the requester cancels. Approve is blocked for your own request (segregation
 * of duties).
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { usePermissionApprovals, useApproveGrant, useRejectGrant, useCancelGrant } from '@sections/SuperadminConsole/hooks';
import { useSessionStore } from '@store/session';
import { PERMISSION_META } from '@lib/permissionMeta';
import { CRITICAL_GRANT_KEYS, type PermissionKey } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import { markApprovalsSeenApi, type ApprovalStatus } from '@lib/superadminApi';
import { scheduleHdrBadgeSync } from '@components/nav';

const STATUSES: { key: ApprovalStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' }, { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' }, { key: 'cancelled', label: 'Cancelled' },
];
const dateLong = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function AcApprovalsPage(): VNode {
  const meId = useSessionStore(s => s.userId);
  const [status, setStatus] = useState<ApprovalStatus>('pending');

  const q = usePermissionApprovals(status);
  const approve = useApproveGrant();
  const reject = useRejectGrant();
  const cancel = useCancelGrant();
  const rows = q.data ?? [];

  // Is the Approvals page the ACTIVE (visible) section? Every module mounts at
  // startup, so this component can render while its Access Control panel is hidden
  // (a compliance-only approver renders it unconditionally). We must NOT acknowledge
  // the queue on that hidden mount — it would clear the badge at login so it never
  // appears. Only a real `s-ac-approvals` navigation makes it active; navigating to
  // any other section clears it.
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onSection = (e: Event) => setActive((e as CustomEvent<string>).detail === 's-ac-approvals');
    window.addEventListener('siomac:section', onSection);
    return () => window.removeEventListener('siomac:section', onSection);
  }, []);

  // Acknowledge the pending queue ONLY while actually viewing it, by the exact ids
  // rendered — a request not in this list stays unseen (no acknowledgement race,
  // clock-free). Re-runs when a fresh request arrives while viewing. Never fires for
  // a hidden mount or a background refetch after navigating away. Then refresh the
  // nav badge (unseen → 0); the backlog + durable compliance_approve gate are unchanged.
  useEffect(() => {
    if (!active || status !== 'pending' || !q.isSuccess) return;
    const ids = q.data.map(a => a.id);   // isSuccess ⇒ data is defined
    void markApprovalsSeenApi(ids).finally(() => scheduleHdrBadgeSync());
  }, [active, status, q.isSuccess, q.dataUpdatedAt]);

  const doReject = async (id: string) => {
    const reason = await dialog.prompt({ title: 'Reject request', text: 'Reason (optional)', placeholder: 'Why is this being rejected?' });
    if (reason === null) return;
    reject.mutate({ approvalId: id, reason: reason || undefined });
  };

  return (
    <div class="acx">
      <div class="page-head">
        <h1 class="page-title">Approvals <span class="tag">Maker-Checker</span></h1>
        <p class="page-sub">Critical permission grants require a different authorized reviewer's approval before they take effect. You cannot approve your own request.</p>
      </div>

      <div class="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {STATUSES.map(s => (
          <div key={s.key} class="stat" style={{ cursor: 'pointer', boxShadow: s.key === status ? '0 0 0 2px var(--accent)' : undefined }} onClick={() => setStatus(s.key)}>
            <div class="stat-top"><span class={`stat-ico ${s.key === 'pending' ? 'amber' : s.key === 'approved' ? 'green' : s.key === 'rejected' ? 'red' : 'blue'}`}><i class={`fas fa-${s.key === 'pending' ? 'clock' : s.key === 'approved' ? 'circle-check' : s.key === 'rejected' ? 'circle-xmark' : 'ban'}`} /></span>
              <div><div class="stat-lbl">{s.label}</div><div class="stat-val">{s.key === status ? rows.length : ''}</div></div>
            </div>
          </div>
        ))}
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">{STATUSES.find(s => s.key === status)!.label} requests</div></div>
        {q.isLoading ? <div class="ac-loading">Loading…</div>
         : rows.length === 0 ? <div class="ac-empty">No {status} requests.</div>
         : (
          <table class="tbl">
            <thead><tr><th>Capability</th><th>Target</th><th>Requested by</th><th>Reason</th><th>Requested</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
            <tbody>
              {rows.map(a => {
                const meta = PERMISSION_META[a.permissionKey as PermissionKey];
                const isMine = meId === a.requestedBy;
                return (
                  <tr key={a.id}>
                    <td><div style={{ fontWeight: 600 }}>{meta?.label ?? a.permissionKey}</div><div class="sub">{meta?.module}{CRITICAL_GRANT_KEYS.has(a.permissionKey) ? ' · Critical' : ''}</div></td>
                    <td>{a.targetRole ? <span class="badge purple">{a.targetRole} role</span> : <span class="badge blue">User override</span>}</td>
                    <td>{a.requestedByName}{isMine && <span class="muted"> (you)</span>}</td>
                    <td class="muted" style={{ maxWidth: '260px', whiteSpace: 'normal' }}>{a.reason}</td>
                    <td class="sub">{dateLong(a.requestedAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {status === 'pending' ? (
                        isMine ? (
                          <button class="btn sm" disabled={cancel.isPending} onClick={() => cancel.mutate(a.id)}>Cancel</button>
                        ) : (
                          <span class="row" style={{ gap: '8px', justifyContent: 'flex-end' }}>
                            <button class="btn sm danger" disabled={reject.isPending} onClick={() => void doReject(a.id)}>Reject</button>
                            <button class="btn sm primary" disabled={approve.isPending} onClick={() => approve.mutate(a.id)}>Approve</button>
                          </span>
                        )
                      ) : <span class="sub">{a.decidedByName ? `by ${a.decidedByName}` : '—'}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
