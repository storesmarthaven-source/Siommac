/**
 * src/components/sections/Finance/ExpensesOverview.tsx
 *
 * Finance — Expense Claims (nav id `s-finance-expenses`). Aurora rebuild (Wave 2B).
 *
 * Layout:
 *   HrfinPageHeader (Expenses · Open / Pending chips)
 *   QuickActionStrip (New Claim, Export CSV)
 *   6 KpiCards (Open, Pending approval, Reimbursable, Reimbursed MTD, Exceptions, Missing receipts)
 *   TrendArea (monthly spend — last 12 months)
 *   HrfinTable — tabs: Claims · Reports
 *     Claims: search + status/category filters, row actions (View, Submit, Approve, Reject, Cancel)
 *     Reports: ReportPanel for 4 report types
 *
 * Drawer: ExpClaimDrawer (8-tab detail + lifecycle actions)
 * Wizard: ExpNewClaimWizard (5-step)
 *
 * No legacy classes (fin-page, hr-offboarding, obx-*). Pure .hrfin shell.
 * SoD enforcement is server-side; this page surfaces success/error toasts.
 */

import { type VNode } from 'preact';
import { useState, useMemo, useCallback } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import {
  HrfinPageHeader,
  QuickActionStrip,
  KpiCard,
  HrfinTable,
  TrendArea,
  HrfinPill,
  type HrfinTone,
  type HrfinColumn,
  type HrfinTab,
  type RowActionItem,
} from '@ui';
import {
  useExpenseClaims,
  useExpenseTrend,
  useExpenseKpis,
  useExpenseMutation,
  financeExpensesApi,
  type ExpenseClaim,
  type ExpenseStatus,
  type ExpenseReportType,
} from '@api/finance/expenses';
import { useEmployeeNames } from '@api/finance/lookups';
import { EmployeeCellResolved } from './_shared/EmployeeCell';
import { ReportPanel, type ReportDescriptor, type ReportColumn } from './_shared/reports';
import { ExpClaimDrawer, type ExpClaimDrawerActions } from './ExpClaimDrawer';
import { ExpNewClaimWizard } from './ExpNewClaimWizard';
import { fmtMoney, fmtDate, humanize } from './financeShared';
import { moneyCompact } from './hrfinFormat';
import { exportCsv } from '@ui/lib/exportCsv';

// ── Types ─────────────────────────────────────────────────────────────────────

type MainTab = 'claims' | 'reports';

// ── Status pill helper ────────────────────────────────────────────────────────

function statusTone(s: string): HrfinTone {
  switch (s) {
    case 'approved':   return 'ok';
    case 'submitted':  return 'wn';
    case 'reimbursed': return 'nu';
    case 'rejected':   return 'bad';
    case 'cancelled':  return 'bad';
    default:           return 'dr';
  }
}

// ── Report definitions ────────────────────────────────────────────────────────

const REPORTS: ReportDescriptor[] = [
  { key: 'expense_claim_summary',    label: 'Claim Summary',          description: 'All expense claims with status and amounts.' },
  { key: 'expense_policy_exceptions', label: 'Policy Exceptions',     description: 'Claims with policy violations.' },
  { key: 'reimbursement_summary',    label: 'Reimbursement Summary',  description: 'Approved reimbursements by period.' },
  { key: 'missing_receipts',         label: 'Missing Receipts',       description: 'Claims submitted without receipts.' },
];

const REPORT_COLUMNS: ReportColumn[] = [
  { header: 'Claim No',       key: 'claimNo' },
  { header: 'Title',          key: 'title' },
  { header: 'Category',       key: 'category' },
  { header: 'Date',           key: 'expenseDate',  format: 'date' },
  { header: 'Total',          key: 'totalAmount',  format: 'currency' },
  { header: 'Status',         key: 'status' },
  { header: 'Reimbursable',   key: 'reimbursable' },
  { header: 'Reimbursed At',  key: 'reimbursedAt', format: 'date' },
];

// ── CSV export helper ─────────────────────────────────────────────────────────

function exportClaimsCsv(rows: ExpenseClaim[]): void {
  exportCsv(rows, [
    { header: 'Claim No',      value: r => r.claimNo },
    { header: 'Title',         value: r => r.title },
    { header: 'Category',      value: r => humanize(r.category) },
    { header: 'Expense Date',  value: r => r.expenseDate },
    { header: 'Total',         value: r => r.totalAmount },
    { header: 'Currency',      value: r => r.currency },
    { header: 'Status',        value: r => r.status },
    { header: 'Reimbursable',  value: r => r.reimbursable ? 'Yes' : 'No' },
    { header: 'Reimbursed At', value: r => r.reimbursedAt ?? '' },
  ], 'expense-claims');
}

// ── Page constants ────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const MAIN_TABS: HrfinTab[] = [
  { key: 'claims',  label: 'Claims'  },
  { key: 'reports', label: 'Reports' },
];

const CATEGORY_OPTIONS = [
  { value: '',                 label: 'All categories' },
  { value: 'travel',           label: 'Travel' },
  { value: 'accommodation',    label: 'Accommodation' },
  { value: 'meals',            label: 'Meals' },
  { value: 'equipment',        label: 'Equipment' },
  { value: 'supplies',         label: 'Supplies' },
  { value: 'professional_fees', label: 'Professional Fees' },
  { value: 'utilities',        label: 'Utilities' },
  { value: 'other',            label: 'Other' },
];

const STATUS_OPTIONS: { value: ExpenseStatus | ''; label: string }[] = [
  { value: '',           label: 'All statuses' },
  { value: 'draft',      label: 'Draft' },
  { value: 'submitted',  label: 'Submitted' },
  { value: 'approved',   label: 'Approved' },
  { value: 'rejected',   label: 'Rejected' },
  { value: 'reimbursed', label: 'Reimbursed' },
  { value: 'cancelled',  label: 'Cancelled' },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export function ExpensesOverview(): VNode {
  // Permissions
  const canView    = can('finance.expenses.view');
  const canSubmit  = can('finance.expenses.submit');
  const canManage  = can('finance.expenses.manage');
  const canApprove = can('finance.expenses.approve');

  // Tab state
  const [mainTab, setMainTab] = useState<MainTab>('claims');

  // Filter state
  const [search,    setSearch]    = useState('');
  const [statusF,   setStatusF]   = useState<ExpenseStatus | ''>('');
  const [categoryF, setCategoryF] = useState('');
  const [page,      setPage]      = useState(0);

  // Sort state
  const [sortField, setSortField] = useState<'created_at' | 'expense_date' | 'total_amount' | 'status' | 'claim_no'>('created_at');
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>('desc');

  // Filter panel
  const [filterOpen, setFilterOpen] = useState(false);

  // Drawer
  const [drawerClaimId, setDrawerClaimId] = useState<string | null>(null);
  const [drawerOpen,    setDrawerOpen]    = useState(false);

  // Wizard
  const [wizardOpen, setWizardOpen] = useState(false);

  // Report state
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [reportResult,   setReportResult]   = useState<{ report: string; generatedAt: string; rows: Record<string, unknown>[] } | null>(null);
  const [reportLoading,  setReportLoading]  = useState(false);
  const [reportError,    setReportError]    = useState<string | null>(null);

  // ── Data queries ────────────────────────────────────────────────────────────

  const claimsQ = useExpenseClaims({
    search:    search || undefined,
    status:    statusF   || undefined,
    category:  categoryF || undefined,
    page,
    pageSize:  PAGE_SIZE,
    sortField,
    sortDir,
  });

  const trendQ = useExpenseTrend();
  const kpisQ  = useExpenseKpis();

  const claims    = claimsQ.data?.data ?? [];
  const total     = claimsQ.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Batch-resolve employee IDs for the table
  const allClaimantIds = useMemo(() => [...new Set(claims.map(c => c.claimantId).filter(Boolean))], [claims]);
  const { data: nameMap } = useEmployeeNames(allClaimantIds);

  // Page-scoped open count (draft claims on the current page — for header chips only)
  const openCount = useMemo(() => claims.filter(c => c.status === 'draft').length, [claims]);

  // Server-side KPI aggregates — derived from kpisQ, not the current page slice
  const pendingCount    = kpisQ.data?.pendingCount    ?? 0;
  const reimbursableAmt = kpisQ.data?.reimbursableAmt ?? 0;
  const reimbursedMTD   = kpisQ.data?.reimbursedMTD   ?? 0;

  // Trend chart data
  const trendLabels  = useMemo(() => (trendQ.data ?? []).map(p => p.month.slice(0, 7)), [trendQ.data]);
  const trendSeriesA = useMemo(() => (trendQ.data ?? []).map(p => p.amount),            [trendQ.data]);

  // ── Mutations ───────────────────────────────────────────────────────────────

  const submitMutation  = useExpenseMutation((id: string) => financeExpensesApi.submit({ id }));
  const approveMutation = useExpenseMutation((id: string) => financeExpensesApi.approve({ id }));
  const rejectMutation  = useExpenseMutation(({ id, reason }: { id: string; reason: string }) => financeExpensesApi.reject({ id, reason }));
  const cancelMutation  = useExpenseMutation(({ id, reason }: { id: string; reason: string }) => financeExpensesApi.cancel({ id, reason }));

  // ── Row actions ─────────────────────────────────────────────────────────────

  const rowActions = useCallback((c: ExpenseClaim): RowActionItem[] => {
    const items: RowActionItem[] = [
      {
        key: 'view', label: 'View details', icon: 'file',
        onClick: () => { setDrawerClaimId(c.id); setDrawerOpen(true); },
      },
    ];
    if (c.status === 'draft' && (canManage || canSubmit)) {
      items.push({
        key: 'submit', label: 'Submit for approval', icon: 'send',
        onClick: () => { void (async () => {
          try { await submitMutation.mutateAsync(c.id); toast.success('Claim submitted.'); }
          catch (e) { toast.error((e as Error).message); }
        })(); },
      });
    }
    if (c.status === 'submitted' && canApprove) {
      items.push({
        key: 'approve', label: 'Approve', icon: 'check',
        onClick: () => { void (async () => {
          try { await approveMutation.mutateAsync(c.id); toast.success('Claim approved.'); }
          catch (e) { toast.error((e as Error).message); }
        })(); },
      });
      items.push({
        key: 'reject', label: 'Reject', icon: 'close', tone: 'danger' as const,
        onClick: () => { void (async () => {
          const reason = await dialog.prompt({ title: 'Rejection reason', placeholder: 'Enter reason…', confirmText: 'Reject', type: 'textarea' });
          if (!reason?.trim()) return;
          try { await rejectMutation.mutateAsync({ id: c.id, reason: reason.trim() }); toast.success('Claim rejected.'); }
          catch (e) { toast.error((e as Error).message); }
        })(); },
      });
    }
    if (!['reimbursed', 'rejected', 'cancelled'].includes(c.status) && (canManage || canSubmit)) {
      items.push({
        key: 'cancel', label: 'Cancel', icon: 'close', tone: 'danger' as const,
        onClick: () => { void (async () => {
          const reason = await dialog.prompt({ title: 'Cancellation reason', placeholder: 'Enter reason…', confirmText: 'Cancel claim', type: 'textarea' });
          if (!reason?.trim()) return;
          try { await cancelMutation.mutateAsync({ id: c.id, reason: reason.trim() }); toast.success('Claim cancelled.'); }
          catch (e) { toast.error((e as Error).message); }
        })(); },
      });
    }
    return items;
  }, [canManage, canSubmit, canApprove, submitMutation, approveMutation, rejectMutation, cancelMutation]);

  // ── Drawer actions ──────────────────────────────────────────────────────────

  const drawerActions: ExpClaimDrawerActions = {
    onSubmit:  (c) => { void (async () => {
      try { await submitMutation.mutateAsync(c.id); toast.success('Claim submitted.'); }
      catch (e) { toast.error((e as Error).message); }
    })(); },
    onApprove: (c) => { void (async () => {
      try { await approveMutation.mutateAsync(c.id); toast.success('Claim approved.'); }
      catch (e) { toast.error((e as Error).message); }
    })(); },
    onReject:  (c) => { void (async () => {
      const reason = await dialog.prompt({ title: 'Rejection reason', placeholder: 'Enter reason…', confirmText: 'Reject', type: 'textarea' });
      if (!reason?.trim()) return;
      try { await rejectMutation.mutateAsync({ id: c.id, reason: reason.trim() }); toast.success('Claim rejected.'); }
      catch (e) { toast.error((e as Error).message); }
    })(); },
    onCancel:  (c) => { void (async () => {
      const reason = await dialog.prompt({ title: 'Cancellation reason', placeholder: 'Enter reason…', confirmText: 'Cancel claim', type: 'textarea' });
      if (!reason?.trim()) return;
      try { await cancelMutation.mutateAsync({ id: c.id, reason: reason.trim() }); toast.success('Claim cancelled.'); }
      catch (e) { toast.error((e as Error).message); }
    })(); },
  };

  // ── Table columns ───────────────────────────────────────────────────────────

  // Maps column key → backend sortField name
  const SORT_FIELD_MAP: Partial<Record<string, 'created_at' | 'expense_date' | 'total_amount' | 'status' | 'claim_no'>> = {
    claimNo:     'claim_no',
    expenseDate: 'expense_date',
    totalAmount: 'total_amount',
    status:      'status',
  } as const;

  // Maps backend sortField name → column key (for HrfinTable highlight)
  const SORT_COL_MAP: Partial<Record<string, string>> = {
    claim_no:     'claimNo',
    expense_date: 'expenseDate',
    total_amount: 'totalAmount',
    status:       'status',
  } as const;

  const handleSort = useCallback((field: string, dir: 'asc' | 'desc') => {
    const mapped = SORT_FIELD_MAP[field];
    if (mapped) { setSortField(mapped); setSortDir(dir); setPage(0); }
  }, []);

  const columns: readonly HrfinColumn<ExpenseClaim>[] = [
    {
      key: 'claimNo', label: 'Claim No', sortable: true,
      render: c => <b style={{ fontFamily: 'monospace', fontSize: 13 }}>{c.claimNo}</b>,
    },
    {
      key: 'title', label: 'Title',
      render: c => <span>{c.title}</span>,
    },
    {
      key: 'claimant', label: 'Claimant',
      render: c => <EmployeeCellResolved resolved={nameMap?.get(c.claimantId)} fallbackId={c.claimantId} />,
    },
    {
      key: 'category', label: 'Category',
      render: c => <span>{humanize(c.category)}</span>,
    },
    {
      key: 'expenseDate', label: 'Date', sortable: true,
      render: c => <span class="hse-muted">{fmtDate(c.expenseDate)}</span>,
    },
    {
      key: 'totalAmount', label: 'Amount', sortable: true,
      render: c => <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.totalAmount)}</b>,
    },
    {
      key: 'status', label: 'Status', sortable: true,
      render: c => <HrfinPill tone={statusTone(c.status)}>{humanize(c.status)}</HrfinPill>,
    },
    {
      key: 'reimbursable', label: 'Reimbursable',
      render: c => <span class="hse-muted">{c.reimbursable ? 'Yes' : 'No'}</span>,
    },
  ];

  // ── Report fetch ────────────────────────────────────────────────────────────

  async function runReport(key: string): Promise<void> {
    setReportLoading(true);
    setReportError(null);
    setReportResult(null);
    try {
      const result = await financeExpensesApi.runReport({
        report: key as ExpenseReportType,
      });
      setReportResult(result);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Report failed.');
    } finally {
      setReportLoading(false);
    }
  }

  function handleSelectReport(key: string): void {
    setSelectedReport(key);
    void runReport(key);
  }

  // ── Chips for page header ───────────────────────────────────────────────────

  const chips = [
    ...(pendingCount > 0 ? [{ label: `${pendingCount} pending`, tone: 'warning' as const }] : []),
    ...(openCount    > 0 ? [{ label: `${openCount} open` }] : []),
  ];

  // ── Guard ────────────────────────────────────────────────────────────────────

  if (!canView) {
    return (
      <div class="hrfin" style={{ padding: 32 }}>
        <p class="hse-muted">You do not have permission to view expense claims.</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div class="hrfin">
      {/* Page header */}
      <HrfinPageHeader
        icon="file"
        title="Expense Claims"
        sub="Submit, review and reimburse employee expense claims"
        chips={chips}
      />

      {/* Quick actions */}
      <QuickActionStrip
        actions={[
          ...(canSubmit || canManage ? [{
            key: 'new',
            label: 'New Claim',
            icon: 'plus' as const,
            variant: 'primary' as const,
            onClick: () => setWizardOpen(true),
          }] : []),
          {
            key: 'export',
            label: 'Export CSV',
            icon: 'download' as const,
            onClick: () => exportClaimsCsv(claims),
          },
        ]}
      />

      {/* KPI strip */}
      <section class="hrfin-kpi-row">
        <KpiCard
          label="Open claims"
          value={String(total)}
          visual="none"
          loading={claimsQ.isLoading}
        />
        <KpiCard
          label="Pending approval"
          value={kpisQ.data ? String(pendingCount) : '—'}
          tone={pendingCount > 0 ? 'danger' : 'accent'}
          visual="none"
          loading={kpisQ.isLoading && !kpisQ.data}
        />
        <KpiCard
          label="Reimbursable"
          value={kpisQ.data ? moneyCompact(reimbursableAmt) : '—'}
          visual="none"
          loading={kpisQ.isLoading && !kpisQ.data}
        />
        <KpiCard
          label="Reimbursed MTD"
          value={kpisQ.data ? moneyCompact(reimbursedMTD) : '—'}
          tone="success"
          visual="none"
          loading={kpisQ.isLoading && !kpisQ.data}
        />
        <KpiCard
          label="Policy exceptions"
          value={kpisQ.data ? String(kpisQ.data.policyExceptions) : '—'}
          tone={kpisQ.data?.policyExceptions ? 'danger' : undefined}
          visual="none"
          loading={kpisQ.isLoading && !kpisQ.data}
        />
        <KpiCard
          label="Missing receipts"
          value={kpisQ.data ? String(kpisQ.data.missingReceipts) : '—'}
          tone={kpisQ.data?.missingReceipts ? 'danger' : undefined}
          visual="none"
          loading={kpisQ.isLoading && !kpisQ.data}
        />
      </section>

      {/* Trend chart */}
      {!trendQ.isLoading && trendSeriesA.length > 0 && (
        <section class="hrfin-trend-row">
          <TrendArea
            title="Monthly Spend"
            labels={trendLabels}
            seriesA={trendSeriesA}
            seriesALabel="Spend"
          />
        </section>
      )}

      {/* Filter panel (category + status) */}
      {filterOpen && (
        <div class="hrfin-filter-panel" style={{ display: 'flex', gap: 12, padding: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            Status:
            <select class="hrfin-input" value={statusF} onChange={e => { setStatusF((e.target as HTMLSelectElement).value as ExpenseStatus | ''); setPage(0); }} style={{ minWidth: 140 }}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            Category:
            <select class="hrfin-input" value={categoryF} onChange={e => { setCategoryF((e.target as HTMLSelectElement).value); setPage(0); }} style={{ minWidth: 160 }}>
              {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button type="button" class="hrfin-action" onClick={() => { setStatusF(''); setCategoryF(''); setSearch(''); setPage(0); }}>Clear</button>
        </div>
      )}

      {/* Main table */}
      <HrfinTable
        tabs={MAIN_TABS}
        activeTab={mainTab}
        onTab={k => setMainTab(k as MainTab)}
        searchValue={search}
        onSearch={v => { setSearch(v); setPage(0); }}
        searchPlaceholder="Search claims…"
        filters={[
          { label: 'Filters', icon: 'filter', onClick: () => setFilterOpen(f => !f) },
        ]}
        columns={mainTab === 'claims' ? columns : [
          { key: 'report', label: 'Reports', render: () => null },
        ]}
        rows={mainTab === 'claims' ? claims : []}
        rowKey={c => c.id}
        onRowClick={mainTab === 'claims' ? (c) => { setDrawerClaimId(c.id); setDrawerOpen(true); } : undefined}
        rowActions={mainTab === 'claims' ? rowActions : undefined}
        page={page}
        pageCount={pageCount}
        total={mainTab === 'claims' ? total : 0}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        noun="claims"
        loading={claimsQ.isLoading && !claimsQ.data}
        emptyMessage="No expense claims found."
        sortField={SORT_COL_MAP[sortField]}
        sortDir={sortDir}
        onSort={handleSort}
      />

      {/* Reports tab (rendered below the table when active) */}
      {mainTab === 'reports' && (
        <ReportPanel
          reports={REPORTS}
          selectedReport={selectedReport}
          onSelectReport={handleSelectReport}
          result={reportResult}
          columns={REPORT_COLUMNS}
          exportFilename="expense-report"
          loading={reportLoading}
          error={reportError}
        />
      )}

      {/* Drawer */}
      <ExpClaimDrawer
        claimId={drawerClaimId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        canManage={canManage}
        canApprove={canApprove}
        actions={drawerActions}
        onReimbursed={() => {
          void claimsQ.refetch();
        }}
      />

      {/* New claim wizard */}
      <ExpNewClaimWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(id) => {
          setWizardOpen(false);
          setDrawerClaimId(id);
          setDrawerOpen(true);
        }}
      />
    </div>
  );
}
