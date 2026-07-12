/**
 * src/components/sections/Finance/PayablesOverview.tsx
 *
 * Finance ▸ Accounts payable — a 1:1 render of the approved Aurora mockup
 * (siomac-finance-pages/AccountsPayable.html) wired to the real AP backend:
 * KPIs, payables-vs-payments + aging, a tabbed bills register with a detail
 * drawer, a new-bill wizard, lifecycle actions (submit/approve/reject/pay/void),
 * and the domain rail (payment run · vendor exceptions · deadlines · activity).
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { openActionModal } from '@/components/common/actions';
import {
  HrfinPageHeader, QuickActionStrip, KpiCard, RailCard, DeadlineList, ActivityFeed,
  HrfinTable, HrfinPill, TrendArea, HorizontalBars, HrfinIcon,
  exportCsv,
  type QuickAction, type HrfinColumn, type HrfinTone, type RowActionItem,
} from '@ui';
import {
  useApBills, useApVendors, useApPayments, useApKpis, useApAging, useApTrend,
  useSubmitBill, useApproveBill, useRejectBill, useVoidBill,
  type ApBill, type ApVendor,
} from '@api/finance/accountsPayable';
import { money, moneyCompact } from './hrfinFormat';
import { ApVendorDialog } from './ApVendorDialog';
import { ApVendorDrawer } from './ApVendorDrawer';
import { ApRecordPaymentDialog } from './ApRecordPaymentDialog';
import { ApStatusFilterMenu, BILL_STATUS_LABEL, type BillStatusFacet } from './ApStatusFilterMenu';
import { ApAdvancedFilterPanel, countAdvFilters, type ApAdvFilters } from './ApAdvancedFilterPanel';
import { ApBillDrawer } from './ApBillDrawer';
import { ApNewBillWizard } from './ApNewBillWizard';
import { ApDuplicateRiskBanner } from './ApDuplicateRiskBanner';
import { ApDuplicateReviewDrawer } from './ApDuplicateReviewDrawer';
import { ApBulkApprovalQueue } from './ApBulkApprovalQueue';
import { ApPaymentRunBuilder } from './ApPaymentRunBuilder';
import { ApImportWizard } from './ApImportWizard';

const fmtDue = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');
const AGING_TONE: ('accent' | 'warning' | 'danger')[] = ['accent', 'accent', 'warning', 'danger'];

function billTone(b: ApBill, today: string): { tone: HrfinTone; label: string } {
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
function nextFriday(): string {
  const d = new Date(); const add = ((5 - d.getDay() + 7) % 7) || 7; d.setDate(d.getDate() + add);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function PayablesOverview(): VNode {
  const today = new Date().toISOString().slice(0, 10);
  const canManage = can('finance.ap.manage');
  const canApprove = can('finance.ap.approve');
  const canCreateVendor = can('finance.ap.vendors.create');
  const canImport = can('finance.ap.bills.import');
  const canRunPayment = can('finance.ap.payment.run.manage');

  const [tab, setTab] = useState('bills');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [statusFacet, setStatusFacet] = useState<BillStatusFacet>('all');
  const [adv, setAdv] = useState<ApAdvFilters>({});
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [wizOpen, setWizOpen] = useState(false);
  const [payFor, setPayFor] = useState<ApBill | null>(null);
  // Vendor dialog + drawer state
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<ApVendor | null>(null);
  const [vendorDrawerId, setVendorDrawerId] = useState<string | null>(null);
  // Chunk 7 — duplicate review
  const [dupReviewOpen, setDupReviewOpen] = useState(false);
  // Chunk 8 — bulk approval
  const [bulkApprovalOpen, setBulkApprovalOpen] = useState(false);
  // Chunk 12 — payment run builder
  const [payRunOpen, setPayRunOpen] = useState(false);
  // Chunk 13 — import wizard
  const [importOpen, setImportOpen] = useState(false);

  const kpis = useApKpis();
  const aging = useApAging();
  const trend = useApTrend();
  const billsQ = useApBills({ search: search || undefined, status: statusFacet === 'all' ? undefined : statusFacet, ...adv, page, pageSize: 10 });
  const railQ = useApBills({ pageSize: 100 });
  const vendorsQ = useApVendors();
  const paymentsQ = useApPayments();

  const submitBill = useSubmitBill();
  const approveBill = useApproveBill();
  const rejectBill = useRejectBill();
  const voidBill = useVoidBill();

  const railBills = railQ.data?.rows ?? [];
  const open = railBills.filter(b => b.status === 'approved' || b.status === 'partially_paid');
  const paymentRunTotal = open.reduce((s, b) => s + b.balance, 0);
  const vendorExceptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of open) if (b.dueDate && b.dueDate < today) m.set(b.vendorName, (m.get(b.vendorName) ?? 0) + b.balance);
    return Array.from(m.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 3);
  }, [railBills]);
  const upcoming = open.filter(b => b.dueDate && b.dueDate >= today).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)).slice(0, 3);
  const recent = [...railBills].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)).slice(0, 3);

  const d = kpis.data;
  const kloading = kpis.isLoading && !d;
  const advCount = countAdvFilters(adv);

  async function doApprove(b: ApBill): Promise<void> {
    const r = await openActionModal({ title: 'Approve bill', subtitle: b.billNo, tone: 'success', icon: 'fa-check', record: { title: b.vendorName, subtitle: `${b.billNo} · ${money(b.totalAmount)}` }, warning: 'You can’t approve a bill you created (separation of duties).', whatNext: ['The bill becomes payable.', 'An app event + audit record are written.'], confirmLabel: 'Approve' });
    if (r.confirmed) try { await approveBill.mutateAsync({ id: b.id }); toast('Bill approved'); } catch (e) { toast((e as Error).message); }
  }
  async function doReject(b: ApBill): Promise<void> {
    const r = await openActionModal({ title: 'Reject bill', subtitle: b.billNo, tone: 'danger', icon: 'fa-xmark', record: { title: b.vendorName, subtitle: `${b.billNo} · ${money(b.totalAmount)}` }, reason: { required: true, label: 'Reason', type: 'textarea' }, confirmLabel: 'Reject' });
    if (r.confirmed) try { await rejectBill.mutateAsync({ id: b.id, reason: r.reason ?? '' }); toast('Bill rejected'); } catch (e) { toast((e as Error).message); }
  }
  async function doVoid(b: ApBill): Promise<void> {
    const r = await openActionModal({ title: 'Void bill', subtitle: b.billNo, tone: 'danger', icon: 'fa-ban', record: { title: b.vendorName, subtitle: `${b.billNo} · ${money(b.totalAmount)}` }, warning: 'Voiding is permanent.', reason: { required: true, label: 'Reason', type: 'textarea' }, confirmLabel: 'Void bill' });
    if (r.confirmed) try { await voidBill.mutateAsync({ id: b.id, reason: r.reason ?? '' }); toast('Bill voided'); } catch (e) { toast((e as Error).message); }
  }
  async function doSubmit(b: ApBill): Promise<void> { try { await submitBill.mutateAsync({ id: b.id }); toast('Submitted for approval'); } catch (e) { toast((e as Error).message); } }
  function openPay(b: ApBill): void { setPayFor(b); }

  const exportBills = (): void => exportCsv(billsQ.data?.rows ?? [], [{ header: 'Bill', value: b => b.billNo }, { header: 'Vendor', value: b => b.vendorName }, { header: 'Due', value: b => b.dueDate ?? '' }, { header: 'Amount', value: b => b.totalAmount }, { header: 'Balance', value: b => b.balance }, { header: 'Status', value: b => b.status }], 'accounts-payable');
  const actions: QuickAction[] = [
    ...(canManage ? [{ key: 'new', label: 'New bill', icon: 'plus', variant: 'primary', onClick: () => setWizOpen(true) } as QuickAction] : []),
    ...(canApprove ? [{ key: 'approve', label: 'Approve', icon: 'check', badge: d?.pendingApprovalCount || undefined, onClick: () => setBulkApprovalOpen(true) } as QuickAction] : []),
    ...(canManage ? [{ key: 'pay', label: 'Record payment', icon: 'receipt', onClick: () => { if (open[0]) openPay(open[0]); } } as QuickAction] : []),
    ...(canCreateVendor ? [{ key: 'vendor', label: 'New vendor', icon: 'bank', onClick: () => { setEditingVendor(null); setVendorDialogOpen(true); } } as QuickAction] : []),
    ...(canImport ? [{ key: 'import', label: 'Import', icon: 'file', onClick: () => setImportOpen(true) } as QuickAction] : []),
    { key: 'export', label: 'Export', icon: 'download', onClick: exportBills },
  ];

  const billCols: HrfinColumn<ApBill>[] = [
    { key: 'billNo', label: 'Bill', render: b => b.billNo },
    { key: 'vendor', label: 'Vendor', render: b => b.vendorName },
    { key: 'due', label: 'Due', render: b => fmtDue(b.dueDate) },
    { key: 'amount', label: 'Amount', render: b => money(b.totalAmount) },
    { key: 'approver', label: 'Approver', render: b => b.approvedBy ?? '—' },
    { key: 'status', label: 'Status', render: b => { const t = billTone(b, today); return <HrfinPill tone={t.tone}>{t.label}</HrfinPill>; } },
  ];
  const vendorCols: HrfinColumn<Record<string, unknown>>[] = [
    { key: 'name', label: 'Vendor', render: r => String(r.name) },
    { key: 'vendorNo', label: 'Vendor no.', render: r => String(r.vendorNo) },
    { key: 'terms', label: 'Terms', render: r => `Net ${String(r.paymentTermsDays)}` },
    { key: 'status', label: 'Status', render: r => <HrfinPill tone={r.status === 'active' ? 'ok' : 'dr'}>{r.status === 'active' ? 'Active' : 'Inactive'}</HrfinPill> },
  ];
  const paymentCols: HrfinColumn<Record<string, unknown>>[] = [
    { key: 'billNo', label: 'Bill', render: r => String(r.billNo) },
    { key: 'method', label: 'Method', render: r => String(r.method).toUpperCase() },
    { key: 'paidAt', label: 'Date', render: r => new Date(String(r.paidAt)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) },
    { key: 'amount', label: 'Amount', render: r => money(Number(r.amount)) },
    { key: 'reference', label: 'Reference', render: r => (r.reference ? String(r.reference) : '—') },
  ];
  const agingTotal = (aging.data ?? []).reduce((s, x) => s + x.amount, 0);

  return (
    <div class="hrfin">
      <HrfinPageHeader
        icon="grid" title="Accounts payable" sub="Track bills, approvals, and payments to keep cash flow and suppliers on track."
        chips={[
          { icon: 'clock', label: `${d?.pendingApprovalCount ?? 0} approval${(d?.pendingApprovalCount ?? 0) === 1 ? '' : 's'} waiting` },
          ...((d?.overdueCount ?? 0) > 0 ? [{ icon: 'alert' as const, label: `${d!.overdueCount} overdue`, tone: 'danger' as const }] : []),
          { icon: 'users', label: `${d?.vendorCount ?? 0} vendors` },
        ]}
      />

      <QuickActionStrip actions={actions} />

      {/* Chunk 7 — duplicate risk banner (conditional) */}
      <ApDuplicateRiskBanner onReview={() => setDupReviewOpen(true)} />

      <section class="hrfin-kpi-grid">
        <KpiCard loading={kloading} label="Total payable" value={money(d?.totalPayable)} support={`${d?.openBills ?? 0} open bills`} visual="line" values={trend.data?.billed ?? []} />
        <KpiCard loading={kloading} label="Overdue" value={money(d?.overdue)} badge={d ? `${d.overdueCount} bill${d.overdueCount === 1 ? '' : 's'}` : undefined} badgeTone="danger" support="past due date" />
        <KpiCard loading={kloading} label="Due this week" value={money(d?.dueThisWeek)} badge={d ? `${d.dueThisWeekCount} bills` : undefined} badgeTone="muted" support="due within 7 days" />
        <KpiCard loading={kloading} label="On-time rate" value={d ? `${d.onTimeRatePct}%` : undefined} support="paid on/before due (90d)" visual="progress" percent={d?.onTimeRatePct ?? 0} />
      </section>

      <section class="hrfin-layout">
        <div class="hrfin-main-stack">
          <div class="hrfin-analytics-grid">
            <article class="hrfin-card">
              <div class="hrfin-card-head"><h2>Payables vs payments</h2><span class="hrfin-chip">MTD · By week</span></div>
              {trend.data && <TrendArea title="Payables vs payments" labels={trend.data.labels} seriesA={trend.data.billed} seriesB={trend.data.paid} />}
              <div class="hrfin-chart-footer">
                <span>{trend.data ? `Latest month: billed ${moneyCompact(trend.data.billed.at(-1))} vs paid ${moneyCompact(trend.data.paid.at(-1))}` : 'Payables vs payments.'}</span>
                <button type="button" class="hrfin-card-link" onClick={() => setTab('payments')}>View report →</button>
              </div>
            </article>
            <article class="hrfin-card">
              <div class="hrfin-card-head"><h2>Aging by bucket</h2></div>
              <HorizontalBars items={(aging.data ?? []).map((b, i) => ({ label: b.label, value: moneyCompact(b.amount), percent: agingTotal > 0 ? Math.round((b.amount / agingTotal) * 100) : 0, tone: AGING_TONE[i] }))} />
              <button type="button" class="hrfin-card-link" onClick={() => setTab('bills')}>View aging detail →</button>
            </article>
          </div>

          <HrfinTable<ApBill | Record<string, unknown>>
            tabs={[{ key: 'bills', label: 'Bills' }, { key: 'vendors', label: 'Vendors' }, { key: 'payments', label: 'Payments' }]}
            activeTab={tab} onTab={t => { setTab(t); setPage(0); }}
            searchValue={search} onSearch={v => { setSearch(v); setPage(0); }} searchPlaceholder="Search bills..."
            filters={tab === 'bills' ? [
              { label: statusFacet === 'all' ? 'Status' : `Status: ${BILL_STATUS_LABEL[statusFacet]}`, onClick: () => setStatusMenuOpen(true) },
              { label: advCount ? `Filters · ${advCount}` : 'Filters', onClick: () => setAdvOpen(true) },
              { label: 'Export', icon: 'download', onClick: exportBills },
            ] : [{ label: 'Export', icon: 'download', onClick: exportBills }]}
            columns={(tab === 'bills' ? billCols : tab === 'vendors' ? vendorCols : paymentCols) as HrfinColumn<ApBill | Record<string, unknown>>[]}
            rows={(tab === 'bills' ? (billsQ.data?.rows ?? []) : tab === 'vendors' ? (vendorsQ.data ?? []) : (paymentsQ.data ?? [])) as (ApBill | Record<string, unknown>)[]}
            rowKey={r => (r as { id: string }).id}
            onRowClick={tab === 'bills'
              ? (r => setDrawerId((r as ApBill).id))
              : tab === 'vendors'
              ? (r => setVendorDrawerId((r as { id: string }).id))
              : undefined}
            rowActions={tab === 'bills' ? (r => {
              const bill = r as ApBill;
              const items: RowActionItem[] = [{ key: 'view', label: 'View details', icon: 'file', onClick: () => setDrawerId(bill.id) }];
              if (bill.status === 'draft' && canManage) items.push({ key: 'submit', label: 'Submit for approval', icon: 'send', onClick: () => void doSubmit(bill) });
              if (bill.status === 'submitted' && canApprove) {
                items.push({ key: 'approve', label: 'Approve', icon: 'check', onClick: () => void doApprove(bill) });
                items.push({ key: 'reject', label: 'Reject', icon: 'close', tone: 'danger', onClick: () => void doReject(bill) });
              }
              if ((bill.status === 'approved' || bill.status === 'partially_paid') && canManage) items.push({ key: 'pay', label: 'Record payment', icon: 'receipt', onClick: () => openPay(bill) });
              if (!['paid', 'void'].includes(bill.status) && canApprove) items.push({ key: 'void', label: 'Void bill', icon: 'alert', tone: 'danger', onClick: () => void doVoid(bill) });
              return items;
            }) : tab === 'vendors' ? (r => [
              { key: 'view', label: 'View vendor', icon: 'file', onClick: () => setVendorDrawerId((r as { id: string }).id) },
              ...(canManage ? [{ key: 'edit', label: 'Edit vendor', icon: 'user', onClick: () => { setEditingVendor(r as unknown as ApVendor); setVendorDialogOpen(true); } } as RowActionItem] : []),
            ]) : undefined}
            page={tab === 'bills' ? page : 0} pageCount={tab === 'bills' ? (billsQ.data?.pageCount ?? 1) : 1}
            total={tab === 'bills' ? (billsQ.data?.total ?? 0) : tab === 'vendors' ? (vendorsQ.data?.length ?? 0) : (paymentsQ.data?.length ?? 0)}
            pageSize={10} onPage={setPage} noun={tab}
            loading={tab === 'bills' ? billsQ.isLoading && !billsQ.data : false}
          />
        </div>

        <aside class="hrfin-rail">
          <article class="hrfin-card">
            <div class="hrfin-card-head"><h2>Payment run this week</h2><HrfinIcon name="calendar" /></div>
            <p>{open.length} bill{open.length === 1 ? '' : 's'} ready to pay</p>
            <h1>{money(paymentRunTotal)}</h1>
            <div class="hrfin-metric-row" style={{ marginTop: 12 }}><span>Run date</span><b>{nextFriday()}</b></div>
            <div class="hrfin-metric-row"><span>Payment method</span><b>ACH</b></div>
            {canRunPayment && open.length > 0 && <button type="button" class="hrfin-action is-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={() => setPayRunOpen(true)}>Review &amp; run payment</button>}
          </article>

          <RailCard title="Vendors needing attention" right={vendorExceptions.length ? <span class="hrfin-mini-badge is-danger">{vendorExceptions.length} exceptions</span> : undefined} linkLabel="View all exceptions" onLink={() => setTab('vendors')}>
            {vendorExceptions.length === 0 ? <div class="hrfin-empty">No overdue vendors.</div> : (
              <div class="hrfin-metric-list">
                {vendorExceptions.map(v => <div class="hrfin-metric-row" key={v.name}><span>{v.name}</span><b style={{ color: 'var(--danger)' }}>{money(v.amount)} overdue</b></div>)}
              </div>
            )}
          </RailCard>

          <RailCard title="Upcoming deadlines" right={<span>{new Date().toLocaleDateString('en-US', { month: 'short' })}</span>} linkLabel="View all deadlines" onLink={() => setTab('bills')}>
            <DeadlineList items={upcoming.map(b => { const dt = new Date(b.dueDate!); return { top: String(dt.getUTCDate()), bottom: dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase(), title: `${b.vendorName} due`, meta: money(b.balance) }; })} />
          </RailCard>

          <RailCard title="Recent activity">
            <ActivityFeed items={recent.map(b => ({ icon: b.status === 'approved' ? 'check' : b.status === 'paid' || b.status === 'partially_paid' ? 'receipt' : 'file', title: `${b.billNo} · ${billTone(b, today).label}`, meta: new Date(b.updatedAt ?? b.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) }))} />
          </RailCard>
        </aside>
      </section>

      {/* Bill detail drawer (tabbed) */}
      <ApBillDrawer
        billId={drawerId} open={!!drawerId} onClose={() => setDrawerId(null)}
        canManage={canManage} canApprove={canApprove}
        actions={{ onSubmit: doSubmit, onApprove: doApprove, onReject: doReject, onVoid: doVoid, onPay: openPay }}
      />

      {/* New-bill wizard (enterprise, multi-line) */}
      <ApNewBillWizard open={wizOpen} onClose={() => setWizOpen(false)} onCreated={() => setTab('bills')} />

      {/* Record-payment dialog (full form) */}
      <ApRecordPaymentDialog
        open={!!payFor}
        bill={payFor}
        onClose={() => setPayFor(null)}
        onPaid={() => setPayFor(null)}
      />

      {/* Vendor create / edit dialog */}
      <ApVendorDialog
        open={vendorDialogOpen}
        vendor={editingVendor}
        onClose={() => setVendorDialogOpen(false)}
        onSaved={() => { setVendorDialogOpen(false); setTab('vendors'); }}
      />

      {/* Vendor detail drawer */}
      <ApVendorDrawer
        open={!!vendorDrawerId}
        vendorId={vendorDrawerId}
        onClose={() => setVendorDrawerId(null)}
        onEdit={v => { setVendorDrawerId(null); setEditingVendor(v); setVendorDialogOpen(true); }}
      />

      {/* Status facet menu + advanced filter panel */}
      <ApStatusFilterMenu
        open={statusMenuOpen} value={statusFacet} onClose={() => setStatusMenuOpen(false)}
        onChange={v => { setStatusFacet(v); setPage(0); }}
      />
      <ApAdvancedFilterPanel
        open={advOpen} value={adv} onClose={() => setAdvOpen(false)}
        onApply={f => { setAdv(f); setPage(0); setAdvOpen(false); }}
        onClear={() => { setAdv({}); setPage(0); }}
      />

      {/* Chunk 7 — duplicate review drawer */}
      <ApDuplicateReviewDrawer
        open={dupReviewOpen} onClose={() => setDupReviewOpen(false)}
        onOpenBill={id => { setDupReviewOpen(false); setDrawerId(id); }}
      />

      {/* Chunk 8 — bulk approval queue */}
      <ApBulkApprovalQueue
        open={bulkApprovalOpen} onClose={() => setBulkApprovalOpen(false)}
        onOpenBill={id => { setBulkApprovalOpen(false); setDrawerId(id); }}
      />

      {/* Chunk 12 — payment run builder */}
      <ApPaymentRunBuilder
        open={payRunOpen} onClose={() => setPayRunOpen(false)}
        onComplete={() => { setPayRunOpen(false); setTab('bills'); }}
      />

      {/* Chunk 13 — import wizard */}
      <ApImportWizard
        open={importOpen} onClose={() => setImportOpen(false)}
        onImported={() => { setImportOpen(false); setTab('bills'); }}
      />
    </div>
  );
}
