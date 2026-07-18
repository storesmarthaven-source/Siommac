/**
 * src/components/sections/Finance/ApBulkApprovalQueue.tsx
 *
 * Bulk-approval queue slide-in panel for submitted AP bills.
 * - Lists all submitted bills with SoD indicator (can this user approve?).
 * - Checkbox select + "Approve selected" / "Reject selected" actions.
 * - Per-item SoD block shown inline (not just a toast).
 * - Reject requires a reason via openActionModal.
 * Perm: finance.ap.bills.approve.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store';
import { useSessionStore } from '@store/session';
import { can } from '@lib/permissions';
import { Drawer, HrfinPill, HrfinIcon } from '@ui';
import { useApBills, useBulkApproveBills, useRejectBill, type ApBill } from '@api/finance/accountsPayable';
import { openActionModal } from '@/components/common/actions';
import { money } from './hrfinFormat';

const fmtDue = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenBill?: (billId: string) => void;
}

export function ApBulkApprovalQueue({ open, onClose, onOpenBill }: Props): VNode {
  const canApprove = can('finance.ap.bills.approve');
  const userId = useSessionStore(s => s.userId);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const billsQ = useApBills({ status: 'submitted', pageSize: 100 });
  const bulkApprove = useBulkApproveBills();
  const rejectBill = useRejectBill();

  const bills = billsQ.data?.rows ?? [];

  // A bill is SoD-blocked if the current user created it
  const sodBlocked = useMemo(
    () => new Set(bills.filter(b => b.createdBy === userId).map(b => b.id)),
    [bills, userId],
  );

  const eligibleSelected = [...selected].filter(id => !sodBlocked.has(id));

  function toggleAll(): void {
    if (selected.size === bills.length) setSelected(new Set());
    else setSelected(new Set(bills.map(b => b.id)));
  }
  function toggle(id: string): void {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function doApprove(): Promise<void> {
    if (!eligibleSelected.length) { toast('No eligible bills selected.'); return; }
    setBusy(true);
    try {
      const result = await bulkApprove.mutateAsync({ billIds: eligibleSelected });
      toast(`Approved ${result.approved.length} bill${result.approved.length === 1 ? '' : 's'}.`);
      if (result.blocked.length) {
        toast(`${result.blocked.length} bill${result.blocked.length === 1 ? '' : 's'} could not be approved — see inline reasons.`);
      }
      setSelected(new Set());
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doRejectOne(bill: ApBill): Promise<void> {
    const r = await openActionModal({
      title: 'Reject bill', subtitle: bill.billNo,
      tone: 'danger', icon: 'xmark',
      record: { title: bill.vendorName, subtitle: `${bill.billNo} · ${money(bill.totalAmount)}` },
      reason: { required: true, label: 'Reason', type: 'textarea' },
      confirmLabel: 'Reject',
    });
    if (!r.confirmed) return;
    try {
      await rejectBill.mutateAsync({ id: bill.id, reason: r.reason ?? '' });
      toast('Bill rejected.');
      setSelected(s => { const n = new Set(s); n.delete(bill.id); return n; });
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <Drawer
      open={open} onClose={onClose} panelClass="hrfin"
      title="Approval queue"
      sub={`${bills.length} bill${bills.length === 1 ? '' : 's'} pending`}
      foot={canApprove && bills.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button
            type="button" class="hrfin-action is-primary"
            disabled={eligibleSelected.length === 0 || busy}
            onClick={() => void doApprove()}
          >
            <HrfinIcon name="check" /> Approve {eligibleSelected.length > 0 ? `(${eligibleSelected.length})` : ''}
          </button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
            {selected.size - eligibleSelected.length > 0 && `${selected.size - eligibleSelected.length} SoD-blocked`}
          </span>
        </div>
      ) : undefined}
    >
      {billsQ.isLoading && <div class="hrfin-empty">Loading...</div>}

      {!billsQ.isLoading && bills.length === 0 && (
        <div class="hrfin-empty"><HrfinIcon name="check" /> No bills pending approval.</div>
      )}

      {!billsQ.isLoading && bills.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', marginBottom: 8, borderBottom: '1px solid var(--border)' }}>
            <input type="checkbox" checked={selected.size === bills.length} onChange={toggleAll} title="Select all" />
            <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>{selected.size} of {bills.length} selected</span>
          </div>

          {bills.map(bill => {
            const blocked = sodBlocked.has(bill.id);
            const isSelected = selected.has(bill.id);
            return (
              <div
                key={bill.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 0', borderBottom: '1px solid var(--border)',
                  opacity: blocked ? 0.7 : 1,
                }}
              >
                <input
                  type="checkbox" checked={isSelected}
                  onChange={() => toggle(bill.id)}
                  style={{ marginTop: 3, cursor: 'pointer' }}
                  title={blocked ? 'SoD: you cannot approve your own bill' : 'Select'}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{bill.billNo}</span>
                    {blocked && <HrfinPill tone="wn">SoD block</HrfinPill>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)' }}>{bill.vendorName}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {money(bill.totalAmount)} · Due {fmtDue(bill.dueDate)}
                  </div>
                  {blocked && (
                    <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 3 }}>
                      Cannot approve — you created this bill (SoD).
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {onOpenBill && (
                    <button type="button" class="hrfin-action" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => onOpenBill(bill.id)}>
                      View
                    </button>
                  )}
                  {canApprove && !blocked && (
                    <button type="button" class="hrfin-action" style={{ fontSize: 12, padding: '4px 8px', color: 'var(--danger)' }} onClick={() => void doRejectOne(bill)}>
                      Reject
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </Drawer>
  );
}
