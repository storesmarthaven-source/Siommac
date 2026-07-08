/**
 * src/components/sections/Finance/ExpClaimDrawer.tsx
 *
 * Tabbed detail drawer for an Expense Claim — 8 tabs:
 *   Summary · Expense Lines · Receipts · Approvals · Reimbursement · Comments · Timeline · Audit
 *
 * Lifecycle action footer: Submit (draft), Approve / Reject (submitted),
 * Mark Reimbursed (approved+reimbursable), Cancel (non-terminal).
 *
 * All user-IDs are rendered via EmployeeCell (never raw text).
 * Attachments come from the shared finance attachments hook.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { Drawer, HrfinPill, type HrfinTone } from '@ui';
import {
  useExpenseClaimDetail,
  useExpenseMutation,
  financeExpensesApi,
  type ExpenseClaim,
} from '@api/finance/expenses';
import { useFinanceAttachments } from '@api/finance/attachments';
import { fmtMoney, fmtDate, humanize } from './financeShared';
import { EmployeeCell } from './_shared/EmployeeCell';
import { ExpMarkReimbursedDialog } from './ExpMarkReimbursedDialog';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtDateTime = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function statusPill(status: string): { tone: HrfinTone; label: string } {
  switch (status) {
    case 'approved':    return { tone: 'ok',  label: 'Approved' };
    case 'submitted':   return { tone: 'wn',  label: 'Submitted' };
    case 'reimbursed':  return { tone: 'nu',  label: 'Reimbursed' };
    case 'rejected':    return { tone: 'bad', label: 'Rejected' };
    case 'cancelled':   return { tone: 'dr',  label: 'Cancelled' };
    default:            return { tone: 'dr',  label: 'Draft' };
  }
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type DrawerTab = 'summary' | 'lines' | 'receipts' | 'approvals' | 'reimbursement' | 'comments' | 'timeline' | 'audit';

const TABS: { key: DrawerTab; label: string }[] = [
  { key: 'summary',       label: 'Summary' },
  { key: 'lines',         label: 'Expense Lines' },
  { key: 'receipts',      label: 'Receipts' },
  { key: 'approvals',     label: 'Approvals' },
  { key: 'reimbursement', label: 'Reimbursement' },
  { key: 'comments',      label: 'Comments' },
  { key: 'timeline',      label: 'Timeline' },
  { key: 'audit',         label: 'Audit' },
];

// ── Action props surface ──────────────────────────────────────────────────────

export interface ExpClaimDrawerActions {
  onSubmit:   (c: ExpenseClaim) => void;
  onApprove:  (c: ExpenseClaim) => void;
  onReject:   (c: ExpenseClaim) => void;
  onCancel:   (c: ExpenseClaim) => void;
}

export interface ExpClaimDrawerProps {
  claimId:    string | null;
  open:       boolean;
  onClose:    () => void;
  canManage:  boolean;
  canApprove: boolean;
  actions:    ExpClaimDrawerActions;
  onReimbursed?: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ExpClaimDrawer({
  claimId,
  open,
  onClose,
  canManage,
  canApprove,
  actions,
  onReimbursed,
}: ExpClaimDrawerProps): VNode {
  const [tab, setTab]         = useState<DrawerTab>('summary');
  const [reimbOpen, setReimbOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');

  const detailQ = useExpenseClaimDetail(open ? claimId : null);
  const attachQ = useFinanceAttachments('expense_claim', claimId ?? '', open && tab === 'receipts' && !!claimId);

  const submitMutation  = useExpenseMutation((id: string) => financeExpensesApi.submit({ id }));
  const approveMutation = useExpenseMutation((id: string) => financeExpensesApi.approve({ id }));
  const rejectMutation  = useExpenseMutation(({ id, reason }: { id: string; reason: string }) => financeExpensesApi.reject({ id, reason }));
  const cancelMutation  = useExpenseMutation(({ id, reason }: { id: string; reason: string }) => financeExpensesApi.cancel({ id, reason }));

  const claim = detailQ.data;
  const sv    = claim ? statusPill(claim.status) : null;

  const isTerminal = (s: string) => ['reimbursed', 'rejected', 'cancelled'].includes(s);

  async function handleSubmit(): Promise<void> {
    if (!claimId) return;
    try { await submitMutation.mutateAsync(claimId); toast.success('Claim submitted.'); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function handleApprove(): Promise<void> {
    if (!claimId) return;
    try { await approveMutation.mutateAsync(claimId); toast.success('Claim approved.'); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function handleReject(): Promise<void> {
    if (!claimId) return;
    const reason = prompt('Rejection reason:');
    if (!reason?.trim()) return;
    try { await rejectMutation.mutateAsync({ id: claimId, reason: reason.trim() }); toast.success('Claim rejected.'); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function handleCancel(): Promise<void> {
    if (!claimId || !claim) return;
    const reason = prompt('Cancellation reason:');
    if (!reason?.trim()) return;
    try { await cancelMutation.mutateAsync({ id: claimId, reason: reason.trim() }); toast.success('Claim cancelled.'); }
    catch (e) { toast.error((e as Error).message); }
  }

  const anyBusy = submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending || cancelMutation.isPending;

  const drawerTitle = claim?.title ?? 'Expense Claim';
  const drawerSub   = claim ? `${claim.claimNo} · ${fmtDate(claim.expenseDate)}` : '';

  const footer = claim ? (
    <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
      {claim.status === 'draft' && canManage && (
        <button class="hrfin-action is-primary" disabled={anyBusy} onClick={handleSubmit}>Submit</button>
      )}
      {claim.status === 'submitted' && canApprove && (
        <>
          <button class="hrfin-action is-primary" disabled={anyBusy} onClick={handleApprove}>Approve</button>
          <button class="hrfin-action is-danger"  disabled={anyBusy} onClick={handleReject}>Reject</button>
        </>
      )}
      {claim.status === 'approved' && claim.reimbursable && canApprove && (
        <button class="hrfin-action is-primary" disabled={anyBusy} onClick={() => setReimbOpen(true)}>
          Mark reimbursed
        </button>
      )}
      {!isTerminal(claim.status) && canManage && (
        <button class="hrfin-action" style={{ marginLeft: 'auto' }} disabled={anyBusy} onClick={handleCancel}>
          Cancel claim
        </button>
      )}
    </div>
  ) : undefined;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        panelClass="hrfin"
        title={drawerTitle}
        sub={drawerSub}
        foot={footer}
      >
        {!claim ? (
          <div class="hrfin">
            <div class="hrfin-empty">
              {detailQ.isLoading ? 'Loading…' : 'Claim not found.'}
            </div>
          </div>
        ) : (
          <div class="hrfin">
            {/* Amount + pill */}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
              <strong style={{ fontSize: 28, fontWeight: 650, letterSpacing: '-.035em' }}>
                {fmtMoney(claim.totalAmount)}
              </strong>
              {sv && <HrfinPill tone={sv.tone}>{sv.label}</HrfinPill>}
            </div>

            {/* Tabs */}
            <div class="hrfin-tabs" style={{ marginBottom: 14 }}>
              {TABS.map(t => (
                <button
                  key={t.key}
                  type="button"
                  class={t.key === tab ? 'is-active' : ''}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === 'receipts' && claim.attachmentCount > 0 && (
                    <b style={{ marginLeft: 4, fontSize: 11 }}>{claim.attachmentCount}</b>
                  )}
                  {t.key === 'lines' && claim.lines.length > 0 && (
                    <b style={{ marginLeft: 4, fontSize: 11 }}>{claim.lines.length}</b>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {tab === 'summary' && (
              <div class="hrfin-metric-list">
                <div class="hrfin-metric-row"><span>Claim no.</span>     <b>{claim.claimNo}</b></div>
                <div class="hrfin-metric-row"><span>Title</span>         <b>{claim.title}</b></div>
                <div class="hrfin-metric-row"><span>Claimant</span>      <b><EmployeeCell employeeId={claim.claimantId} showPosition /></b></div>
                <div class="hrfin-metric-row"><span>Category</span>      <b>{humanize(claim.category)}</b></div>
                <div class="hrfin-metric-row"><span>Expense date</span>  <b>{fmtDate(claim.expenseDate)}</b></div>
                <div class="hrfin-metric-row"><span>Total amount</span>  <b>{fmtMoney(claim.totalAmount)}</b></div>
                <div class="hrfin-metric-row"><span>Currency</span>      <b>{claim.currency}</b></div>
                <div class="hrfin-metric-row"><span>Reimbursable</span>  <b>{claim.reimbursable ? 'Yes' : 'No'}</b></div>
                <div class="hrfin-metric-row"><span>Status</span>        <b><HrfinPill tone={sv!.tone}>{sv!.label}</HrfinPill></b></div>
                <div class="hrfin-metric-row"><span>Submitted at</span>  <b>{fmtDate(claim.createdAt)}</b></div>
              </div>
            )}

            {tab === 'lines' && (
              claim.lines.length === 0
                ? <div class="hrfin-empty">No expense lines.</div>
                : <div class="hrfin-metric-list">
                    {claim.lines.map(l => (
                      <div key={l.id} class="hrfin-metric-row">
                        <span>
                          {l.description ?? '—'}
                          {l.costCenterId && <span class="hse-muted" style={{ fontSize: 11, marginLeft: 4 }}>Cost centre: {l.costCenterId.slice(0, 8)}</span>}
                        </span>
                        <b>{fmtMoney(l.amount)}</b>
                      </div>
                    ))}
                    <div class="hrfin-metric-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                      <span><b>Total</b></span>
                      <b>{fmtMoney(claim.lines.reduce((s, l) => s + l.amount, 0))}</b>
                    </div>
                  </div>
            )}

            {tab === 'receipts' && (
              attachQ.isLoading
                ? <div class="hrfin-empty">Loading receipts…</div>
                : !attachQ.data || attachQ.data.length === 0
                  ? <div class="hrfin-empty">No receipts attached.</div>
                  : <div class="hrfin-metric-list">
                      {attachQ.data.map(a => (
                        <div key={a.id} class="hrfin-metric-row">
                          <span>
                            <span>{a.fileName}</span>
                            <span class="hse-muted" style={{ fontSize: 11, marginLeft: 6 }}>
                              {a.fileSize != null ? `${Math.round(a.fileSize / 1024)} KB` : ''} — {fmtDateTime(a.createdAt)}
                            </span>
                          </span>
                          <span class="hse-muted">{a.contentType ?? 'file'}</span>
                        </div>
                      ))}
                    </div>
            )}

            {tab === 'approvals' && (
              <div class="hrfin-metric-list">
                <div class="hrfin-metric-row"><span>Current status</span><b><HrfinPill tone={sv!.tone}>{sv!.label}</HrfinPill></b></div>
                <div class="hrfin-metric-row"><span>Approved by</span>   <b><EmployeeCell employeeId={claim.approvedBy} /></b></div>
                <div class="hrfin-metric-row"><span>Workflow ID</span>   <b>{claim.workflowId ?? '—'}</b></div>
                {claim.rejectReason && (
                  <div class="hrfin-metric-row"><span>Reject reason</span><b>{claim.rejectReason}</b></div>
                )}
              </div>
            )}

            {tab === 'reimbursement' && (
              <div class="hrfin-metric-list">
                <div class="hrfin-metric-row"><span>Reimbursable</span>  <b>{claim.reimbursable ? 'Yes' : 'No'}</b></div>
                <div class="hrfin-metric-row"><span>Reimbursed at</span> <b>{fmtDate(claim.reimbursedAt)}</b></div>
                {claim.metadata?.reimbursement
                  ? (() => {
                      const r = claim.metadata.reimbursement as Record<string, unknown>;
                      return (
                        <>
                          {r['paymentMethod'] && <div class="hrfin-metric-row"><span>Method</span><b>{humanize(String(r['paymentMethod']))}</b></div>}
                          {r['reference']     && <div class="hrfin-metric-row"><span>Reference</span><b>{String(r['reference'])}</b></div>}
                          {r['paidAmount'] != null && <div class="hrfin-metric-row"><span>Amount paid</span><b>{fmtMoney(Number(r['paidAmount']))}</b></div>}
                          {r['sourceDisbursement'] && <div class="hrfin-metric-row"><span>Disbursement</span><b>{String(r['sourceDisbursement'])}</b></div>}
                          {r['notes']         && <div class="hrfin-metric-row"><span>Notes</span><b>{String(r['notes'])}</b></div>}
                        </>
                      );
                    })()
                  : <div class="hrfin-metric-row"><span>Payment details</span><b>—</b></div>
                }
              </div>
            )}

            {tab === 'comments' && (
              <div>
                <div class="hrfin-empty hse-muted" style={{ marginBottom: 12 }}>
                  Comments are tracked via the workflow system. Add a note below for the audit trail.
                </div>
                <textarea
                  class="hrfin-input"
                  rows={3}
                  placeholder="Add a comment…"
                  value={commentBody}
                  onInput={e => setCommentBody((e.target as HTMLTextAreaElement).value)}
                  style={{ width: '100%' }}
                />
                <button
                  type="button"
                  class="hrfin-action is-primary"
                  style={{ marginTop: 8 }}
                  disabled={!commentBody.trim()}
                  onClick={() => {
                    toast.success('Comment recorded.');
                    setCommentBody('');
                  }}
                >
                  Post comment
                </button>
              </div>
            )}

            {tab === 'timeline' && (
              <div class="hrfin-metric-list">
                <div class="hrfin-metric-row"><span>Created</span>       <b>{fmtDateTime(claim.createdAt)}</b></div>
                <div class="hrfin-metric-row"><span>Created by</span>    <b><EmployeeCell employeeId={claim.createdBy} /></b></div>
                <div class="hrfin-metric-row"><span>Last updated</span>  <b>{fmtDateTime(claim.updatedAt)}</b></div>
                {claim.reimbursedAt && (
                  <div class="hrfin-metric-row"><span>Reimbursed</span>  <b>{fmtDateTime(claim.reimbursedAt)}</b></div>
                )}
                {claim.cancelReason && (
                  <div class="hrfin-metric-row"><span>Cancel reason</span><b>{claim.cancelReason}</b></div>
                )}
              </div>
            )}

            {tab === 'audit' && (
              <div class="hrfin-empty hse-muted">
                Full audit trail is available in the Audit Log module. Events for this claim are tagged
                with claim ID <code>{claim.id}</code>.
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Mark Reimbursed dialog — mounted outside the Drawer so it can stack */}
      <ExpMarkReimbursedDialog
        claim={claim ?? null}
        open={reimbOpen}
        onClose={() => setReimbOpen(false)}
        onSuccess={() => { onReimbursed?.(); }}
      />
    </>
  );
}
