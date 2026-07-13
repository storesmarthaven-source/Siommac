/**
 * src/components/sections/Finance/ApVendorDrawer.tsx
 *
 * Vendor detail slide-over — read-only overview with tabs:
 *   Overview   — contact, payment defaults, bank accounts
 *   Bills      — last 50 bills for this vendor
 *   Payments   — last 50 payments for this vendor
 *
 * Opens via onRowClick in the Vendors tab of PayablesOverview.
 * "Edit" button inside the drawer triggers onEdit(vendor) which lifts state
 * back up to PayablesOverview to open ApVendorDialog in edit mode.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { can } from '@lib/permissions';
import {
  Drawer, HrfinPill, HrfinIcon, HrfinTable, type HrfinColumn, type HrfinTone,
} from '@ui';
import {
  useApVendorDetail, useApVendorBills, useApVendorPayments,
  type ApVendor, type ApBill, type ApPayment, type ApVendorBankAccount, type ApBillStatus,
} from '@api/finance/accountsPayable';
import { money } from './hrfinFormat';

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function vendorStatusTone(s: ApVendor['status']): HrfinTone {
  return s === 'active' ? 'ok' : s === 'on_hold' ? 'wn' : 'dr';
}
function vendorStatusLabel(s: ApVendor['status']): string {
  return s === 'active' ? 'Active' : s === 'on_hold' ? 'On hold' : 'Inactive';
}

function billTone(status: ApBillStatus, dueDate: string | null, today: string): { tone: HrfinTone; label: string } {
  if ((status === 'approved' || status === 'partially_paid') && dueDate && dueDate < today) return { tone: 'bad', label: 'Overdue' };
  switch (status) {
    case 'approved':        return { tone: 'ok',  label: 'Approved' };
    case 'submitted':       return { tone: 'wn',  label: 'Pending' };
    case 'partially_paid':  return { tone: 'nu',  label: 'Partial' };
    case 'paid':            return { tone: 'nu',  label: 'Paid' };
    case 'rejected':        return { tone: 'bad', label: 'Rejected' };
    case 'void':            return { tone: 'dr',  label: 'Void' };
    default:                return { tone: 'dr',  label: 'Draft' };
  }
}

// ── Sub-sections ──────────────────────────────────────────────────────────────

function VendorOverview({ vendor, accounts }: { vendor: ApVendor; accounts: ApVendorBankAccount[] }): VNode {
  return (
    <div class="hrfin">
      {/* Contact */}
      <div class="hrfin-card" style={{ marginBottom: 14 }}>
        <div class="hrfin-card-head"><h2>Contact</h2></div>
        <div class="hrfin-metric-list">
          <div class="hrfin-metric-row"><span>Name</span><b>{vendor.contactName ?? '—'}</b></div>
          <div class="hrfin-metric-row"><span>Email</span>
            <b>{vendor.contactEmail
              ? <a href={`mailto:${vendor.contactEmail}`} class="hrfin-link">{vendor.contactEmail}</a>
              : '—'}
            </b>
          </div>
          <div class="hrfin-metric-row"><span>Phone</span><b>{vendor.contactPhone ?? '—'}</b></div>
          <div class="hrfin-metric-row"><span>Registration no.</span><b>{vendor.registrationNo ?? '—'}</b></div>
        </div>
      </div>

      {/* Payment defaults */}
      <div class="hrfin-card" style={{ marginBottom: 14 }}>
        <div class="hrfin-card-head"><h2>Payment defaults</h2></div>
        <div class="hrfin-metric-list">
          <div class="hrfin-metric-row"><span>Payment terms</span><b>Net {vendor.paymentTermsDays}</b></div>
          <div class="hrfin-metric-row"><span>Preferred method</span><b>{vendor.preferredPaymentMethod?.toUpperCase() ?? '—'}</b></div>
          <div class="hrfin-metric-row"><span>Default currency</span><b>{vendor.defaultCurrency}</b></div>
          {vendor.defaultGlAccountCode && <div class="hrfin-metric-row"><span>Default GL</span><b>{vendor.defaultGlAccountCode}</b></div>}
        </div>
      </div>

      {/* Bank accounts */}
      <div class="hrfin-card">
        <div class="hrfin-card-head">
          <h2>Bank accounts</h2>
          <span class="hrfin-chip">{accounts.length}</span>
        </div>
        {accounts.length === 0 ? (
          <div class="hrfin-empty">No bank accounts on file.</div>
        ) : (
          <div class="hrfin-metric-list">
            {accounts.map(a => (
              <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--bd-color)' }}>
                <div class="hrfin-metric-row">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HrfinIcon name="bank" />{a.bankName}
                    {a.isDefault && <span class="hrfin-chip is-accent" style={{ fontSize: 10 }}>Default</span>}
                  </span>
                  <HrfinPill tone={a.status === 'active' ? 'ok' : 'dr'}>{a.status}</HrfinPill>
                </div>
                <div class="hrfin-metric-row" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  <span>{a.accountName}</span><span>{a.accountNumber}</span>
                </div>
                {(a.iban ?? a.swift) && (
                  <div class="hrfin-metric-row" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {a.iban && <span>IBAN: {a.iban}</span>}
                    {a.swift && <span>SWIFT: {a.swift}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BillsTab({ vendorId }: { vendorId: string }): VNode {
  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading } = useApVendorBills(vendorId);
  const cols: HrfinColumn<ApBill>[] = [
    { key: 'billNo', label: 'Bill', render: b => b.billNo },
    { key: 'date', label: 'Date', render: b => fmtDate(b.billDate) },
    { key: 'due', label: 'Due', render: b => fmtDate(b.dueDate) },
    { key: 'amount', label: 'Amount', render: b => money(b.totalAmount) },
    { key: 'balance', label: 'Balance', render: b => money(b.balance) },
    { key: 'status', label: 'Status', render: b => { const t = billTone(b.status, b.dueDate, today); return <HrfinPill tone={t.tone}>{t.label}</HrfinPill>; } },
  ];
  return (
    <HrfinTable<ApBill>
      columns={cols}
      rows={data ?? []}
      rowKey={b => b.id}
      total={data?.length ?? 0}
      page={0} pageCount={1} pageSize={50}
      onPage={() => undefined}
      noun="bill"
      loading={isLoading && !data}
    />
  );
}

function PaymentsTab({ vendorId }: { vendorId: string }): VNode {
  const { data, isLoading } = useApVendorPayments(vendorId);
  type PayRow = ApPayment & { billNo: string };
  const cols: HrfinColumn<PayRow>[] = [
    { key: 'billNo', label: 'Bill', render: p => p.billNo },
    { key: 'date', label: 'Date', render: p => fmtDate(p.paidAt) },
    { key: 'method', label: 'Method', render: p => p.method.toUpperCase() },
    { key: 'ref', label: 'Reference', render: p => p.reference ?? '—' },
    { key: 'amount', label: 'Amount', render: p => money(p.amount) },
  ];
  return (
    <HrfinTable<PayRow>
      columns={cols}
      rows={(data ?? [])}
      rowKey={p => p.id}
      total={data?.length ?? 0}
      page={0} pageCount={1} pageSize={50}
      onPage={() => undefined}
      noun="payment"
      loading={isLoading && !data}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ApVendorDrawerProps {
  open: boolean;
  vendorId: string | null;
  onClose: () => void;
  onEdit: (vendor: ApVendor) => void;
}

export function ApVendorDrawer({ open, vendorId, onClose, onEdit }: ApVendorDrawerProps): VNode {
  const [tab, setTab] = useState<'overview' | 'bills' | 'payments'>('overview');
  const canUpdate = can('finance.ap.vendors.update');

  const detailQ = useApVendorDetail(open ? vendorId : null);
  const vendor = detailQ.data?.vendor ?? null;
  const accounts = detailQ.data?.bankAccounts ?? [];

  return (
    <Drawer
      open={open}
      onClose={() => { onClose(); setTab('overview'); }}
      panelClass="hrfin"
      title={vendor ? vendor.name : (detailQ.isLoading ? 'Loading…' : 'Vendor')}
      sub={vendor ? `${vendor.vendorNo} · ${vendorStatusLabel(vendor.status)}` : undefined}
      foot={vendor && canUpdate ? (
        <button type="button" class="hrfin-action is-primary" onClick={() => onEdit(vendor)}>
          Edit vendor
        </button>
      ) : undefined}
    >
      {vendor && (
        <div class="hrfin">
          {/* Status pill + KPI row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <HrfinPill tone={vendorStatusTone(vendor.status)}>{vendorStatusLabel(vendor.status)}</HrfinPill>
            <span class="hrfin-chip">Net {vendor.paymentTermsDays}</span>
            <span class="hrfin-chip">{vendor.defaultCurrency}</span>
          </div>

          {/* Tab bar */}
          <div class="hrfin-tab-strip" style={{ marginBottom: 16 }}>
            {(['overview', 'bills', 'payments'] as const).map(t => (
              <button key={t} type="button"
                class={`hrfin-tab${tab === t ? ' is-active' : ''}`}
                onClick={() => setTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'overview' && <VendorOverview vendor={vendor} accounts={accounts} />}
          {tab === 'bills' && <BillsTab vendorId={vendor.id} />}
          {tab === 'payments' && <PaymentsTab vendorId={vendor.id} />}
        </div>
      )}

      {detailQ.isLoading && !vendor && (
        <div class="hrfin-empty" style={{ paddingTop: 40 }}>
          <HrfinIcon name="refresh" /> Loading vendor…
        </div>
      )}
    </Drawer>
  );
}
