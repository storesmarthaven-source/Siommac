/**
 * src/components/sections/Finance/ApBillDrawer.tsx
 *
 * Rich, tabbed detail drawer for an AP bill — Summary · Line items · Approvals ·
 * Payments · Comments · Audit trail. Lifecycle actions live in the footer,
 * state-aware + permission-gated (handlers supplied by the page). Attachments +
 * related-records tabs land in a follow-up (need storage / handoff wiring).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { Drawer, HrfinPill, HrfinIcon, type HrfinTone } from '@ui';
import {
  useApBillDetail, useBillAudit, useBillComments, useCreateBillComment, type ApBill,
} from '@api/finance/accountsPayable';
import { money } from './hrfinFormat';

const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (iso: string): string => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const humanize = (s: string): string => s.replace(/[._]/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

function statusView(b: ApBill, today: string): { tone: HrfinTone; label: string } {
  if ((b.status === 'approved' || b.status === 'partially_paid') && b.dueDate && b.dueDate < today) return { tone: 'bad', label: 'Overdue' };
  switch (b.status) {
    case 'approved': return { tone: 'ok', label: 'Approved' };
    case 'submitted': return { tone: 'wn', label: 'Pending' };
    case 'partially_paid': return { tone: 'nu', label: 'Partial' };
    case 'paid': return { tone: 'nu', label: 'Paid' };
    case 'rejected': return { tone: 'bad', label: 'Rejected' };
    case 'void': return { tone: 'dr', label: 'Void' };
    default: return { tone: 'dr', label: 'Draft' };
  }
}

type Tab = 'summary' | 'lines' | 'approvals' | 'payments' | 'comments' | 'audit';
const TABS: { key: Tab; label: string }[] = [
  { key: 'summary', label: 'Summary' }, { key: 'lines', label: 'Line items' },
  { key: 'approvals', label: 'Approvals' }, { key: 'payments', label: 'Payments' },
  { key: 'comments', label: 'Comments' }, { key: 'audit', label: 'Audit' },
];

export interface ApBillDrawerActions {
  onSubmit: (b: ApBill) => void; onApprove: (b: ApBill) => void; onReject: (b: ApBill) => void;
  onVoid: (b: ApBill) => void; onPay: (b: ApBill) => void;
}

export function ApBillDrawer({ billId, open, onClose, canManage, canApprove, actions }: {
  billId: string | null; open: boolean; onClose: () => void;
  canManage: boolean; canApprove: boolean; actions: ApBillDrawerActions;
}): VNode {
  const today = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = useState<Tab>('summary');
  const detailQ = useApBillDetail(billId);
  const auditQ = useBillAudit(open && tab === 'audit' ? billId : null);
  const commentsQ = useBillComments(open && tab === 'comments' ? billId : null);
  const addComment = useCreateBillComment();
  const [commentBody, setCommentBody] = useState('');

  const d = detailQ.data;
  const bill = d?.bill;
  const sv = bill ? statusView(bill, today) : null;

  async function postComment(): Promise<void> {
    if (!billId || !commentBody.trim()) return;
    try { await addComment.mutateAsync({ id: billId, body: commentBody.trim() }); setCommentBody(''); }
    catch (e) { toast((e as Error).message); }
  }

  return (
    <Drawer
      open={open} onClose={onClose} panelClass="hrfin"
      title={bill?.vendorName ?? 'Bill'} sub={bill ? `${bill.billNo} · due ${fmtDate(bill.dueDate)}` : ''}
      foot={bill ? (
        <div style={{ display: 'flex', gap: 9, width: '100%' }}>
          {bill.status === 'draft' && canManage && <button class="hrfin-action is-primary" onClick={() => actions.onSubmit(bill)}>Submit</button>}
          {bill.status === 'submitted' && canApprove && <button class="hrfin-action is-primary" onClick={() => actions.onApprove(bill)}>Approve</button>}
          {bill.status === 'submitted' && canApprove && <button class="hrfin-action is-danger" onClick={() => actions.onReject(bill)}>Reject</button>}
          {(bill.status === 'approved' || bill.status === 'partially_paid') && canManage && <button class="hrfin-action is-primary" onClick={() => actions.onPay(bill)}>Record payment</button>}
          {!['paid', 'void'].includes(bill.status) && canApprove && <button class="hrfin-action" style={{ marginLeft: 'auto' }} onClick={() => actions.onVoid(bill)}>Void</button>}
        </div>
      ) : undefined}
    >
      {!d || !bill ? <div class="hrfin"><div class="hrfin-empty">Loading…</div></div> : (
        <div class="hrfin">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <strong style={{ fontSize: 28, fontWeight: 650, letterSpacing: '-.035em' }}>{money(bill.totalAmount)}</strong>
            {sv && <HrfinPill tone={sv.tone}>{sv.label}</HrfinPill>}
          </div>

          <div class="hrfin-tabs" style={{ marginBottom: 14 }}>
            {TABS.map(t => (
              <button key={t.key} type="button" class={t.key === tab ? 'is-active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>

          {tab === 'summary' && (
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Bill number</span><b>{bill.billNo}</b></div>
              <div class="hrfin-metric-row"><span>Vendor</span><b>{bill.vendorName}</b></div>
              <div class="hrfin-metric-row"><span>Bill date</span><b>{fmtDate(bill.billDate)}</b></div>
              <div class="hrfin-metric-row"><span>Due date</span><b>{fmtDate(bill.dueDate)}</b></div>
              <div class="hrfin-metric-row"><span>GL account</span><b>{bill.glAccountCode ?? '—'}</b></div>
              <div class="hrfin-metric-row"><span>Total</span><b>{money(bill.totalAmount)}</b></div>
              <div class="hrfin-metric-row"><span>Paid</span><b>{money(bill.paidAmount)}</b></div>
              <div class="hrfin-metric-row"><span>Balance</span><b>{money(bill.balance)}</b></div>
              {bill.description && <div class="hrfin-metric-row"><span>Description</span><b>{bill.description}</b></div>}
            </div>
          )}

          {tab === 'lines' && (
            d.lines.length === 0 ? <div class="hrfin-empty">No line items.</div> :
              <div class="hrfin-metric-list">{d.lines.map(l => <div class="hrfin-metric-row" key={l.id}><span>{l.description}{l.glAccountCode ? ` · ${l.glAccountCode}` : ''}</span><b>{money(l.amount)}</b></div>)}</div>
          )}

          {tab === 'approvals' && (
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Status</span><b>{sv?.label}</b></div>
              <div class="hrfin-metric-row"><span>Approved by</span><b>{bill.approvedBy ?? '—'}</b></div>
              <div class="hrfin-metric-row"><span>Workflow</span><b>{bill.workflowId ? 'Routed for approval' : 'Direct approve'}</b></div>
              {bill.rejectReason && <div class="hrfin-metric-row"><span>Reject reason</span><b>{bill.rejectReason}</b></div>}
              {bill.voidReason && <div class="hrfin-metric-row"><span>Void reason</span><b>{bill.voidReason}</b></div>}
              <div class="hrfin-sod-note" style={{ marginTop: 10 }}><HrfinIcon name="alert" /> Separation of duties: a bill's creator can't approve it.</div>
            </div>
          )}

          {tab === 'payments' && (
            d.payments.length === 0 ? <div class="hrfin-empty">No payments recorded.</div> :
              <div class="hrfin-metric-list">{d.payments.map(p => <div class="hrfin-metric-row" key={p.id}><span>{p.method.toUpperCase()}{p.reference ? ` · ${p.reference}` : ''} · {fmtDate(p.paidAt.slice(0, 10))}</span><b>{money(p.amount)}</b></div>)}</div>
          )}

          {tab === 'comments' && (
            <div>
              {canManage && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input class="hrfin-input" placeholder="Add a comment…" value={commentBody} onInput={e => setCommentBody((e.target as HTMLInputElement).value)} onKeyDown={e => { if (e.key === 'Enter') void postComment(); }} />
                  <button class="hrfin-action is-primary" disabled={!commentBody.trim() || addComment.isPending} onClick={() => void postComment()}>Post</button>
                </div>
              )}
              {commentsQ.isLoading ? <div class="hrfin-empty">Loading…</div> :
                (commentsQ.data ?? []).length === 0 ? <div class="hrfin-empty">No comments yet.</div> :
                  <div class="hrfin-metric-list">{(commentsQ.data ?? []).map(c => (
                    <div class="hrfin-metric-row" key={c.id} style={{ alignItems: 'flex-start' }}>
                      <span>{c.body}<br /><small style={{ color: 'var(--muted)' }}>{c.authorName ?? 'User'} · {fmtDateTime(c.createdAt)}{c.isInternal ? ' · internal' : ''}</small></span>
                    </div>
                  ))}</div>}
            </div>
          )}

          {tab === 'audit' && (
            auditQ.isLoading ? <div class="hrfin-empty">Loading…</div> :
              (auditQ.data ?? []).length === 0 ? <div class="hrfin-empty">No audit entries.</div> :
                <div class="hrfin-metric-list">{(auditQ.data ?? []).map(a => (
                  <div class="hrfin-metric-row" key={a.id} style={{ alignItems: 'flex-start' }}>
                    <span>{humanize(a.action)}{a.reason ? ` — ${a.reason}` : ''}<br /><small style={{ color: 'var(--muted)' }}>{a.actorName ?? 'System'} · {fmtDateTime(a.createdAt)}</small></span>
                  </div>
                ))}</div>
          )}
        </div>
      )}
    </Drawer>
  );
}
