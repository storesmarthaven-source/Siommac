/**
 * src/components/sections/Finance/RemittancesOverview.tsx
 *
 * Finance ▸ Statutory Remittances & Filing — Aurora rebuild (Wave 2B §12).
 *
 * Shell: .hrfin / HrfinPageHeader + QuickActionStrip + KPI strip + HrfinTable.
 * Tabs: Remittances · Lines · Filings · Authorities · Reports.
 * Every FK uses a picker (ApprovedRunPicker / AuthorityPicker).
 * Every employee reference uses EmployeeCellResolved.
 * Every mutation → emitFinanceMutationBackbone (handled server-side).
 * CSV export via @ui exportCsv.
 *
 * Drawer tabs: Summary · Lines · Authority Filing · Payments · Approvals ·
 *              Timeline · Audit · Related Payroll Run · Attachments.
 * Wizard (5 steps): Run picker → Authority picker → Computed preview →
 *                   Due date / settings → Review.
 * Mark-Filed dialog: filed date, filing reference, receipt reference,
 *                    filing method, receipt attachment, notes.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import { Drawer, exportCsv, type CsvColumn } from '@ui';
import {
  HrfinPageHeader, QuickActionStrip, KpiCard, HrfinTable, HrfinPill, HrfinWizardModal,
  ActivityFeed, InsightBanner, RailCard,
  type HrfinColumn, type HrfinTab, type QuickAction, type HrfinTone, type ActivityItem,
} from '@ui';
import { TrendArea } from '@ui';
import {
  useRemittances, useRemittance, useRemittanceLines, useRemittanceLinesAll,
  useComputedRemittance, useRemittancesReport, useRemittanceAudit,
  useSubmitRemittance, useApproveRemittance, useMarkPaidRemittance,
  useMarkFiledRemittance, useCancelRemittance, useCreateRemittance,
  type Remittance, type RemittanceLineWithContext,
  type RemittanceAuthority, type RemittanceStatus, type MarkFiledArgs,
} from '@api/finance/remittances';
import { useEmployeeNames } from '@api/finance/lookups';
import {
  useFinanceAttachments, useFinanceAttachmentUploadUrl, useCompleteFinanceAttachment,
  useFinanceAttachmentSignedUrl, useDeleteFinanceAttachment,
} from '@api/finance/attachments';
import { ApprovedRunPicker, AuthorityPicker } from './_shared/pickers';
import { EmployeeCellResolved } from './_shared/EmployeeCell';
import { ReportPanel, type ReportDescriptor, type ReportColumn } from './_shared/reports';
import { money } from './hrfinFormat';
import { fmtDate, humanize } from './financeShared';
import './finance.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTHORITY_LABEL: Record<RemittanceAuthority, string> = {
  paye_bir:         'PAYE / BIR',
  nis_nibtt:        'NIS / NIBTT',
  health_surcharge: 'Health Surcharge',
};

const FILING_METHOD_OPTIONS = [
  { value: 'online_portal', label: 'Online Portal' },
  { value: 'in_person',     label: 'In Person' },
  { value: 'courier',       label: 'Courier' },
  { value: 'eft',           label: 'EFT' },
  { value: 'other',         label: 'Other' },
];

const STATUS_TONES: Record<string, HrfinTone> = {
  draft:     'dr',
  submitted: 'wn',
  approved:  'ok',
  paid:      'nu',
  filed:     'ok',
  cancelled: 'bad',
};

function statusTone(s: string): HrfinTone {
  return STATUS_TONES[s] ?? 'dr';
}

function periodLabel(year: number, month: number): string {
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${m[(month - 1) % 12] ?? month} ${year}`;
}

type PageTab = 'remittances' | 'lines' | 'payments' | 'filings' | 'authorities' | 'reports';

const PAGE_TABS: HrfinTab[] = [
  { key: 'remittances', label: 'Remittances' },
  { key: 'lines',       label: 'Lines' },
  { key: 'payments',    label: 'Payments' },
  { key: 'filings',     label: 'Filings' },
  { key: 'authorities', label: 'Authorities' },
  { key: 'reports',     label: 'Reports' },
];

const PAGE_SIZE = 20;

// ── Main page ─────────────────────────────────────────────────────────────────

export function RemittancesOverview(): VNode {
  const [tab, setTab]               = useState<PageTab>('remittances');
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState<string>('');
  const [authorityFilter, setAuth]  = useState<string>('');
  const [page, setPage]             = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const canManage  = can('finance.remittances.manage');
  const canApprove = can('finance.remittances.approve');
  const canFiled   = can('finance.remittances.markFiled');

  const listQ  = useRemittances({ status: statusFilter as RemittanceStatus | undefined, authority: authorityFilter as RemittanceAuthority | undefined });
  const remittances = listQ.data ?? [];

  // ── KPI derivations ─────────────────────────────────────────────────────────
  const today  = new Date().toISOString().slice(0, 10);

  const outstanding = remittances.filter(r => !['cancelled','filed'].includes(r.status))
    .reduce((s, r) => s + r.totalDue, 0);
  const overdue     = remittances.filter(r =>
    r.dueDate && r.dueDate < today && !['filed','cancelled'].includes(r.status)
  ).length;
  const paidMtd     = remittances.filter(r =>
    r.status === 'paid' && r.paidDate && r.paidDate.slice(0, 7) === today.slice(0, 7)
  ).reduce((s, r) => s + r.totalDue, 0);
  const filedMtd    = remittances.filter(r =>
    r.status === 'filed' && r.filedDate && r.filedDate.slice(0, 7) === today.slice(0, 7)
  ).length;
  const authLiability = remittances.filter(r => r.status === 'approved')
    .reduce((s, r) => s + r.totalDue, 0);
  const blocked     = remittances.filter(r => r.status === 'submitted').length;

  // ── Trend sparkline ──────────────────────────────────────────────────────────
  const trendLabels = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getMonth() + 1}/${d.getFullYear().toString().slice(-2)}`);
    }
    return months;
  }, []);

  const trendValues = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      return remittances
        .filter(r => r.periodYear === y && r.periodMonth === m)
        .reduce((s, r) => s + r.totalDue, 0);
    });
  }, [remittances]);

  // ── Filter + search on client ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = remittances;
    if (search)         r = r.filter(x => x.remittanceNo.toLowerCase().includes(search.toLowerCase()) || AUTHORITY_LABEL[x.authority].toLowerCase().includes(search.toLowerCase()));
    if (statusFilter)   r = r.filter(x => x.status === statusFilter);
    if (authorityFilter) r = r.filter(x => x.authority === authorityFilter);
    return r;
  }, [remittances, search, statusFilter, authorityFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Quick actions ────────────────────────────────────────────────────────────
  const quickActions: QuickAction[] = [
    ...(canManage ? [{
      key: 'create', label: 'Compute & Create', icon: 'plus' as const, variant: 'primary' as const,
      onClick: () => setWizardOpen(true),
    }] : []),
    {
      key: 'export', label: 'Export CSV', icon: 'download' as const,
      onClick: () => {
        const cols: CsvColumn<Remittance>[] = [
          { header: 'Ref',           value: r => r.remittanceNo },
          { header: 'Authority',     value: r => AUTHORITY_LABEL[r.authority] },
          { header: 'Period',        value: r => periodLabel(r.periodYear, r.periodMonth) },
          { header: 'Due Date',      value: r => r.dueDate ?? '' },
          { header: 'Employee Amt',  value: r => r.employeePortion },
          { header: 'Employer Amt',  value: r => r.employerPortion },
          { header: 'Total Due',     value: r => r.totalDue },
          { header: 'Status',        value: r => r.status },
          { header: 'Paid Date',     value: r => r.paidDate ?? '' },
          { header: 'Filed Date',    value: r => r.filedDate ?? '' },
          { header: 'Auth Ref',      value: r => r.authorityReference ?? '' },
          { header: 'Filing Method', value: r => r.filingMethod ?? '' },
          { header: 'Receipt Ref',   value: r => r.receiptReference ?? '' },
        ];
        exportCsv(filtered, cols, 'remittances');
        toast('CSV downloaded');
      },
    },
    {
      key: 'refresh', label: 'Refresh', icon: 'refresh' as const,
      onClick: () => void listQ.refetch(),
    },
  ];

  // ── Table columns ────────────────────────────────────────────────────────────
  const REG_COLS: HrfinColumn<Remittance>[] = [
    {
      key: 'ref',
      label: 'Ref',
      render: r => (
        <span style={{ fontWeight: 600, fontSize: 13 }}>{r.remittanceNo}</span>
      ),
    },
    {
      key: 'authority',
      label: 'Authority',
      render: r => <span>{AUTHORITY_LABEL[r.authority]}</span>,
    },
    {
      key: 'period',
      label: 'Period',
      render: r => <span class="hrfin-muted">{periodLabel(r.periodYear, r.periodMonth)}</span>,
    },
    {
      key: 'dueDate',
      label: 'Due Date',
      render: r => {
        const overdue = r.dueDate && r.dueDate < today && !['filed','cancelled'].includes(r.status);
        return (
          <span style={{ color: overdue ? 'var(--hrfin-danger, #e05)' : undefined }}>
            {r.dueDate ? fmtDate(r.dueDate) : '—'}
            {overdue && ' ⚠'}
          </span>
        );
      },
    },
    {
      key: 'totalDue',
      label: 'Total Due',
      render: r => <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.totalDue)}</strong>,
    },
    {
      key: 'status',
      label: 'Status',
      render: r => <HrfinPill tone={statusTone(r.status)}>{humanize(r.status)}</HrfinPill>,
    },
    {
      key: 'payrollRun',
      label: 'Source Run',
      render: r => (
        <button
          type="button"
          class="hrfin-muted"
          title={`Payroll run ID: ${r.payrollRunId}`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', color: 'inherit' }}
          onClick={e => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('siomac:section', { detail: 's-finance-payroll' }));
          }}
        >
          {r.payrollRunNo ?? `${r.payrollRunId.slice(0, 8)}…`}
        </button>
      ),
    },
  ];

  function rowActions(r: Remittance): import('@ui').RowActionItem[] {
    const items: import('@ui').RowActionItem[] = [
      {
        key: 'view', label: 'View details', icon: 'file',
        onClick: () => { setSelectedId(r.id); setDrawerOpen(true); },
      },
    ];
    if (canManage && r.status === 'draft') {
      items.push({ key: 'submit', label: 'Submit for approval', icon: 'send', onClick: () => void doSubmit(r.id) });
    }
    if (canApprove && r.status === 'submitted') {
      items.push({ key: 'approve', label: 'Approve', icon: 'check', onClick: () => void doApprove(r.id) });
    }
    if (canApprove && r.status === 'approved') {
      items.push({ key: 'markPaid', label: 'Mark paid', icon: 'bank', onClick: () => openMarkPaid(r) });
    }
    if (canFiled && r.status === 'paid') {
      items.push({ key: 'markFiled', label: 'Mark filed', icon: 'check', onClick: () => openMarkFiled(r) });
    }
    if (canManage && ['draft','submitted'].includes(r.status)) {
      items.push({ key: 'cancel', label: 'Cancel', icon: 'close', tone: 'danger', onClick: () => void doCancel(r.id) });
    }
    return items;
  }

  // ── Mutations ────────────────────────────────────────────────────────────────
  const submitMut  = useSubmitRemittance();
  const approveMut = useApproveRemittance();
  const cancelMut  = useCancelRemittance();

  async function doSubmit(id: string) {
    try { await submitMut.mutateAsync({ id }); toast('Submitted for approval.'); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function doApprove(id: string) {
    try { await approveMut.mutateAsync({ id }); toast('Remittance approved.'); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function doCancel(id: string) {
    const reason = await dialog.prompt({
      title:       'Cancel Remittance',
      text:        'Provide a reason for cancellation.',
      placeholder: 'Reason for cancellation',
      confirmText: 'Cancel Remittance',
      cancelText:  'Keep',
    });
    if (!reason?.trim()) return;
    try { await cancelMut.mutateAsync({ id, reason: reason.trim() }); toast('Cancelled.'); }
    catch (e) { toast.error((e as Error).message); }
  }

  // ── Mark-Paid / Mark-Filed state ─────────────────────────────────────────────
  const [markPaidTarget, setMarkPaidTarget]   = useState<Remittance | null>(null);
  const [markFiledTarget, setMarkFiledTarget] = useState<Remittance | null>(null);

  function openMarkPaid(r: Remittance)  { setMarkPaidTarget(r); }
  function openMarkFiled(r: Remittance) { setMarkFiledTarget(r); }

  // ── Insights ─────────────────────────────────────────────────────────────────
  const hasOverdue  = overdue > 0;
  const hasPending  = blocked > 0;

  return (
    <div class="hrfin">
      {/* Page header */}
      <HrfinPageHeader
        icon="receipt"
        title="Statutory Remittances &amp; Filing"
        sub="PAYE/BIR, NIS/NIBTT and Health Surcharge remittances derived from approved payroll runs."
        chips={[
          ...(overdue > 0 ? [{ label: `${overdue} overdue`, tone: 'danger' as const, icon: 'alert' as const }] : []),
          ...(blocked > 0 ? [{ label: `${blocked} pending approval`, tone: 'warning' as const }] : []),
        ]}
      />

      {/* Quick actions */}
      <QuickActionStrip actions={quickActions} />

      {/* KPI strip */}
      <section class="hrfin-kpi-grid">
        <KpiCard
          label="Outstanding Dues"
          value={money(outstanding)}
          support="Active remittances"
          loading={listQ.isLoading && !listQ.data}
          tone="accent"
          visual="bars"
          values={trendValues}
          footer="Click to filter"
        />
        <KpiCard
          label="Overdue Filings"
          value={String(overdue)}
          support={overdue > 0 ? 'Past due date' : 'None overdue'}
          loading={listQ.isLoading && !listQ.data}
          tone={overdue > 0 ? 'danger' : 'success'}
          badge={overdue > 0 ? 'ACTION REQUIRED' : undefined}
          badgeTone={overdue > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Paid MTD"
          value={money(paidMtd)}
          support="This calendar month"
          loading={listQ.isLoading && !listQ.data}
          tone="success"
          visual="progress"
          percent={outstanding > 0 ? (paidMtd / outstanding) * 100 : 100}
        />
        <KpiCard
          label="Filed MTD"
          value={String(filedMtd)}
          support={`${filedMtd} filing${filedMtd !== 1 ? 's' : ''} this month`}
          loading={listQ.isLoading && !listQ.data}
          tone="success"
        />
        <KpiCard
          label="Authority Liability"
          value={money(authLiability)}
          support="Approved, awaiting payment"
          loading={listQ.isLoading && !listQ.data}
          tone={authLiability > 0 ? 'accent' : 'success'}
        />
        <KpiCard
          label="Pending Approval"
          value={String(blocked)}
          support={blocked > 0 ? 'Awaiting approver action' : 'None pending'}
          loading={listQ.isLoading && !listQ.data}
          tone={blocked > 0 ? 'accent' : 'success'}
        />
      </section>

      {/* Insights / warnings */}
      {(hasOverdue || hasPending) && (
        <section style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          {hasOverdue && (
            <InsightBanner
              title={`${overdue} remittance${overdue !== 1 ? 's are' : ' is'} past the filing due date.`}
              sub="File immediately to avoid penalties."
              actions={[{ label: 'Filter overdue', onClick: () => { setStatus(''); setTab('remittances'); } }]}
            />
          )}
          {hasPending && (
            <InsightBanner
              title={`${blocked} remittance${blocked !== 1 ? 's are' : ' is'} awaiting approval.`}
              actions={[{ label: 'View pending', onClick: () => { setStatus('submitted'); setTab('remittances'); } }]}
            />
          )}
        </section>
      )}

      {/* Main content area */}
      <div class="hrfin-layout">
        <div class="hrfin-main-stack">
          {tab === 'remittances' && (
            <HrfinTable
              tabs={PAGE_TABS}
              activeTab={tab}
              onTab={k => { setTab(k as PageTab); setPage(0); }}
              searchValue={search}
              onSearch={v => { setSearch(v); setPage(0); }}
              searchPlaceholder="Search remittances…"
              filters={[
                { label: 'All statuses', icon: 'filter', onClick: () => setStatus('') },
                { label: 'Draft', onClick: () => setStatus('draft') },
                { label: 'Submitted', onClick: () => setStatus('submitted') },
                { label: 'Approved', onClick: () => setStatus('approved') },
                { label: 'Paid', onClick: () => setStatus('paid') },
                { label: 'Filed', onClick: () => setStatus('filed') },
                { label: '— All authorities', icon: 'gavel', onClick: () => setAuth('') },
                { label: 'PAYE / BIR', onClick: () => setAuth('paye_bir') },
                { label: 'NIS / NIBTT', onClick: () => setAuth('nis_nibtt') },
                { label: 'Health Surcharge', onClick: () => setAuth('health_surcharge') },
              ]}
              columns={REG_COLS}
              rows={pageRows}
              rowKey={r => r.id}
              onRowClick={r => { setSelectedId(r.id); setDrawerOpen(true); }}
              rowActions={rowActions}
              page={page}
              pageCount={pageCount}
              total={filtered.length}
              pageSize={PAGE_SIZE}
              onPage={setPage}
              noun="remittances"
              loading={listQ.isLoading && !listQ.data}
              emptyMessage={listQ.isError ? 'Failed to load remittances.' : 'No remittances found.'}
            />
          )}
          {tab === 'lines' && (
            <RemLinesTab
              tabs={PAGE_TABS}
              activeTab={tab}
              onTab={k => { setTab(k as PageTab); setPage(0); }}
            />
          )}
          {tab === 'payments' && (
            <RemPaymentsTab
              remittances={remittances}
              loading={listQ.isLoading && !listQ.data}
              tabs={PAGE_TABS}
              activeTab={tab}
              onTab={k => { setTab(k as PageTab); setPage(0); }}
            />
          )}
          {tab === 'filings' && (
            <RemFilingsTab
              remittances={remittances.filter(r => r.status === 'filed')}
              loading={listQ.isLoading && !listQ.data}
              tabs={PAGE_TABS}
              activeTab={tab}
              onTab={k => { setTab(k as PageTab); setPage(0); }}
            />
          )}
          {tab === 'authorities' && (
            <RemAuthoritiesTab
              remittances={remittances}
              loading={listQ.isLoading && !listQ.data}
              tabs={PAGE_TABS}
              activeTab={tab}
              onTab={k => { setTab(k as PageTab); setPage(0); }}
            />
          )}
          {tab === 'reports' && (
            <RemReportsTab
              tabs={PAGE_TABS}
              activeTab={tab}
              onTab={k => { setTab(k as PageTab); setPage(0); }}
            />
          )}
        </div>

        {/* Right rail — 340px column */}
        <aside class="hrfin-rail">
          <RailCard title="Trend — 6 Months">
            <TrendArea
              labels={trendLabels}
              seriesA={trendValues}
              title="Remittance obligations trend"
              seriesALabel="Total due"
            />
          </RailCard>
          <RailCard title="Authority Breakdown">
            {(['paye_bir','nis_nibtt','health_surcharge'] as RemittanceAuthority[]).map(auth => {
              const authTotal = remittances
                .filter(r => r.authority === auth && !['cancelled','filed'].includes(r.status))
                .reduce((s, r) => s + r.totalDue, 0);
              return (
                <div key={auth} class="hrfin-metric-row" style={{ marginBottom: 8 }}>
                  <span class="hrfin-muted" style={{ fontSize: 12 }}>{AUTHORITY_LABEL[auth]}</span>
                  <strong style={{ fontSize: 13 }}>{money(authTotal)}</strong>
                </div>
              );
            })}
          </RailCard>
        </aside>
      </div>

      {/* Drawer */}
      <RemittanceDrawer
        remittanceId={selectedId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        canManage={canManage}
        canApprove={canApprove}
        canFiled={canFiled}
        onSubmit={doSubmit}
        onApprove={doApprove}
        onMarkPaid={openMarkPaid}
        onMarkFiled={openMarkFiled}
        onCancel={doCancel}
      />

      {/* Compute & Create wizard */}
      {wizardOpen && (
        <RemComputeWizard
          onClose={() => setWizardOpen(false)}
        />
      )}

      {/* Mark-Paid dialog */}
      {markPaidTarget && (
        <RemMarkPaidDialog
          remittance={markPaidTarget}
          onClose={() => setMarkPaidTarget(null)}
        />
      )}

      {/* Mark-Filed dialog */}
      {markFiledTarget && (
        <RemMarkFiledDialog
          remittance={markFiledTarget}
          onClose={() => setMarkFiledTarget(null)}
        />
      )}
    </div>
  );
}

// ── Lines tab ─────────────────────────────────────────────────────────────────

function RemLinesTab({ tabs, activeTab, onTab }: {
  tabs: HrfinTab[]; activeTab: string; onTab: (k: string) => void;
}): VNode {
  const [authorityFilter, setAuthority] = useState<string>('');
  const [search, setSearch]             = useState('');
  const [page, setPage]                 = useState(0);

  const linesQ = useRemittanceLinesAll({
    authority: authorityFilter as RemittanceAuthority | undefined,
    limit:     500,
  });
  const allLines = linesQ.data ?? [];

  const filtered = useMemo(() => {
    let r = allLines;
    if (search) r = r.filter(l =>
      l.remittanceNo.toLowerCase().includes(search.toLowerCase()) ||
      l.employeeId.toLowerCase().includes(search.toLowerCase())
    );
    return r;
  }, [allLines, search]);

  // Batch-resolve employee IDs
  const employeeIds = useMemo(() => [...new Set(filtered.map(l => l.employeeId))], [filtered]);
  const { data: nameMap } = useEmployeeNames(employeeIds);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const LINE_COLS: HrfinColumn<RemittanceLineWithContext>[] = [
    { key: 'remNo',    label: 'Remittance',     render: l => <span style={{ fontWeight: 600, fontSize: 12 }}>{l.remittanceNo}</span> },
    { key: 'auth',     label: 'Authority',      render: l => <span>{AUTHORITY_LABEL[l.authority]}</span> },
    { key: 'period',   label: 'Period',         render: l => <span class="hrfin-muted">{periodLabel(l.periodYear, l.periodMonth)}</span> },
    { key: 'employee', label: 'Employee',       render: l => <EmployeeCellResolved resolved={nameMap?.get(l.employeeId)} fallbackId={l.employeeId} /> },
    { key: 'empPor',   label: 'Employee Amt',   render: l => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(l.employeePortion)}</span> },
    { key: 'erPor',    label: 'Employer Amt',   render: l => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(l.employerPortion)}</span> },
    { key: 'total',    label: 'Total',          render: l => <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(l.lineTotal)}</strong> },
  ];

  const cols: CsvColumn<RemittanceLineWithContext>[] = [
    { header: 'Remittance',    value: l => l.remittanceNo },
    { header: 'Authority',     value: l => AUTHORITY_LABEL[l.authority] },
    { header: 'Period',        value: l => periodLabel(l.periodYear, l.periodMonth) },
    { header: 'Employee ID',   value: l => l.employeeId },
    { header: 'Employee Name', value: l => nameMap?.get(l.employeeId)?.fullName ?? l.employeeId },
    { header: 'Employee Amt',  value: l => l.employeePortion },
    { header: 'Employer Amt',  value: l => l.employerPortion },
    { header: 'Total',         value: l => l.lineTotal },
  ];

  return (
    <HrfinTable
      tabs={tabs}
      activeTab={activeTab}
      onTab={onTab}
      searchValue={search}
      onSearch={v => { setSearch(v); setPage(0); }}
      searchPlaceholder="Search lines…"
      filters={[
        { label: 'All authorities', icon: 'gavel', onClick: () => setAuthority('') },
        { label: 'PAYE / BIR',     onClick: () => setAuthority('paye_bir') },
        { label: 'NIS / NIBTT',    onClick: () => setAuthority('nis_nibtt') },
        { label: 'Health Surcharge', onClick: () => setAuthority('health_surcharge') },
        { label: 'Export CSV', icon: 'download', onClick: () => { exportCsv(filtered, cols, 'remittance-lines'); toast('CSV downloaded'); } },
      ]}
      columns={LINE_COLS}
      rows={pageRows}
      rowKey={l => l.id}
      page={page}
      pageCount={pageCount}
      total={filtered.length}
      pageSize={PAGE_SIZE}
      onPage={setPage}
      noun="lines"
      loading={linesQ.isLoading && !linesQ.data}
      emptyMessage="No remittance lines found."
    />
  );
}

// ── Payments tab (§12: top-level register of payments across all remittances) ──

function RemPaymentsTab({ remittances, loading, tabs, activeTab, onTab }: {
  remittances: Remittance[];
  loading: boolean;
  tabs: HrfinTab[];
  activeTab: string;
  onTab: (k: string) => void;
}): VNode {
  const [page, setPage]   = useState(0);
  const [search, setSearch] = useState('');

  const paid = useMemo(() =>
    remittances.filter(r => ['paid', 'filed'].includes(r.status)),
    [remittances],
  );

  const filtered = useMemo(() => {
    if (!search) return paid;
    const q = search.toLowerCase();
    return paid.filter(r =>
      r.remittanceNo.toLowerCase().includes(q) ||
      AUTHORITY_LABEL[r.authority].toLowerCase().includes(q) ||
      (r.authorityReference ?? '').toLowerCase().includes(q),
    );
  }, [paid, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const COLS: HrfinColumn<Remittance>[] = [
    { key: 'ref',      label: 'Ref',           render: r => <span style={{ fontWeight: 600, fontSize: 13 }}>{r.remittanceNo}</span> },
    { key: 'auth',     label: 'Authority',      render: r => <span>{AUTHORITY_LABEL[r.authority]}</span> },
    { key: 'period',   label: 'Period',         render: r => <span class="hrfin-muted">{periodLabel(r.periodYear, r.periodMonth)}</span> },
    { key: 'paidDate', label: 'Paid Date',      render: r => <span>{fmtDate(r.paidDate)}</span> },
    { key: 'total',    label: 'Amount Paid',    render: r => <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.totalDue)}</strong> },
    { key: 'authRef',  label: 'Authority Ref',  render: r => <span class="hrfin-muted">{r.authorityReference ?? '—'}</span> },
    { key: 'status',   label: 'Status',         render: r => <HrfinPill tone={statusTone(r.status)}>{humanize(r.status)}</HrfinPill> },
  ];

  const csvCols: CsvColumn<Remittance>[] = [
    { header: 'Ref',            value: r => r.remittanceNo },
    { header: 'Authority',      value: r => AUTHORITY_LABEL[r.authority] },
    { header: 'Period',         value: r => periodLabel(r.periodYear, r.periodMonth) },
    { header: 'Paid Date',      value: r => r.paidDate ?? '' },
    { header: 'Amount Paid',    value: r => r.totalDue },
    { header: 'Authority Ref',  value: r => r.authorityReference ?? '' },
    { header: 'Status',         value: r => r.status },
  ];

  return (
    <HrfinTable
      tabs={tabs}
      activeTab={activeTab}
      onTab={onTab}
      searchValue={search}
      onSearch={v => { setSearch(v); setPage(0); }}
      searchPlaceholder="Search payments…"
      filters={[
        { label: 'Export CSV', icon: 'download', onClick: () => { exportCsv(filtered, csvCols, 'remittance-payments'); toast('CSV downloaded'); } },
      ]}
      columns={COLS}
      rows={pageRows}
      rowKey={r => r.id}
      page={page}
      pageCount={pageCount}
      total={filtered.length}
      pageSize={PAGE_SIZE}
      onPage={setPage}
      noun="payments"
      loading={loading}
      emptyMessage="No paid remittances found."
    />
  );
}

// ── Filings tab ───────────────────────────────────────────────────────────────

function RemFilingsTab({ remittances, loading, tabs, activeTab, onTab }: {
  remittances: Remittance[];
  loading: boolean;
  tabs: HrfinTab[];
  activeTab: string;
  onTab: (k: string) => void;
}): VNode {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return remittances;
    return remittances.filter(r =>
      r.remittanceNo.toLowerCase().includes(search.toLowerCase()) ||
      AUTHORITY_LABEL[r.authority].toLowerCase().includes(search.toLowerCase())
    );
  }, [remittances, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const COLS: HrfinColumn<Remittance>[] = [
    { key: 'ref',     label: 'Ref',          render: r => <span style={{ fontWeight: 600, fontSize: 13 }}>{r.remittanceNo}</span> },
    { key: 'auth',    label: 'Authority',    render: r => <span>{AUTHORITY_LABEL[r.authority]}</span> },
    { key: 'period',  label: 'Period',       render: r => <span class="hrfin-muted">{periodLabel(r.periodYear, r.periodMonth)}</span> },
    { key: 'filed',   label: 'Filed Date',   render: r => <span>{fmtDate(r.filedDate)}</span> },
    { key: 'method',  label: 'Method',       render: r => <span class="hrfin-muted">{r.filingMethod ? humanize(r.filingMethod) : '—'}</span> },
    { key: 'ref2',    label: 'Receipt Ref',  render: r => <span class="hrfin-muted">{r.receiptReference ?? '—'}</span> },
    { key: 'total',   label: 'Total Filed',  render: r => <strong>{money(r.totalDue)}</strong> },
    { key: 'status',  label: 'Status',       render: r => <HrfinPill tone="ok">Filed</HrfinPill> },
  ];

  const csvCols: CsvColumn<Remittance>[] = [
    { header: 'Ref',         value: r => r.remittanceNo },
    { header: 'Authority',   value: r => AUTHORITY_LABEL[r.authority] },
    { header: 'Period',      value: r => periodLabel(r.periodYear, r.periodMonth) },
    { header: 'Filed Date',  value: r => r.filedDate ?? '' },
    { header: 'Method',      value: r => r.filingMethod ?? '' },
    { header: 'Receipt Ref', value: r => r.receiptReference ?? '' },
    { header: 'Auth Ref',    value: r => r.authorityReference ?? '' },
    { header: 'Total',       value: r => r.totalDue },
  ];

  return (
    <HrfinTable
      tabs={tabs}
      activeTab={activeTab}
      onTab={onTab}
      searchValue={search}
      onSearch={v => { setSearch(v); setPage(0); }}
      searchPlaceholder="Search filings…"
      filters={[
        { label: 'Export CSV', icon: 'download', onClick: () => { exportCsv(filtered, csvCols, 'remittance-filings'); toast('CSV downloaded'); } },
      ]}
      columns={COLS}
      rows={pageRows}
      rowKey={r => r.id}
      page={page}
      pageCount={pageCount}
      total={filtered.length}
      pageSize={PAGE_SIZE}
      onPage={setPage}
      noun="filings"
      loading={loading}
      emptyMessage="No filed remittances found."
    />
  );
}

// ── Authorities tab ────────────────────────────────────────────────────────────

function RemAuthoritiesTab({ remittances, loading, tabs, activeTab, onTab }: {
  remittances: Remittance[];
  loading: boolean;
  tabs: HrfinTab[];
  activeTab: string;
  onTab: (k: string) => void;
}): VNode {
  const today = new Date().toISOString().slice(0, 10);
  const AUTHORITIES: RemittanceAuthority[] = ['paye_bir', 'nis_nibtt', 'health_surcharge'];

  function authStats(auth: RemittanceAuthority) {
    const rows = remittances.filter(r => r.authority === auth);
    const outstanding = rows.filter(r => !['cancelled','filed'].includes(r.status)).reduce((s, r) => s + r.totalDue, 0);
    const overdueCount = rows.filter(r => r.dueDate && r.dueDate < today && !['filed','cancelled'].includes(r.status)).length;
    const filedCount = rows.filter(r => r.status === 'filed').length;
    const total = rows.length;
    return { outstanding, overdueCount, filedCount, total };
  }

  return (
    <article class="hrfin-table-card">
      <div class="hrfin-tabs">
        {tabs.map(t => (
          <button key={t.key} type="button" class={t.key === activeTab ? 'is-active' : ''} onClick={() => onTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div style={{ padding: '20px 24px' }}>
        {loading ? (
          <div class="hrfin-empty">Loading…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
            {AUTHORITIES.map(auth => {
              const s = authStats(auth);
              return (
                <div key={auth} style={{ background: 'var(--hrfin-surface-2, #1e2535)', borderRadius: 12, padding: 20, border: '1px solid var(--hrfin-border, #2a3347)' }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{AUTHORITY_LABEL[auth]}</div>
                  <div class="hrfin-metric-row" style={{ marginBottom: 6 }}>
                    <span class="hrfin-muted" style={{ fontSize: 12 }}>Outstanding</span>
                    <strong style={{ color: s.outstanding > 0 ? 'var(--hrfin-accent, #6c8fff)' : undefined }}>{money(s.outstanding)}</strong>
                  </div>
                  <div class="hrfin-metric-row" style={{ marginBottom: 6 }}>
                    <span class="hrfin-muted" style={{ fontSize: 12 }}>Overdue</span>
                    <span style={{ color: s.overdueCount > 0 ? 'var(--hrfin-danger, #e05)' : 'var(--hrfin-ok, #4caf50)' }}>
                      {s.overdueCount > 0 ? `${s.overdueCount} overdue` : 'None overdue'}
                    </span>
                  </div>
                  <div class="hrfin-metric-row">
                    <span class="hrfin-muted" style={{ fontSize: 12 }}>Filed of {s.total}</span>
                    <span>{s.filedCount} / {s.total}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

// ── Reports tab ───────────────────────────────────────────────────────────────

const REPORT_DESCRIPTORS: ReportDescriptor[] = [
  { key: 'remittance_summary',     label: 'Remittance Summary',     description: 'Overview of all remittances with status and amounts.' },
  { key: 'remittance_lines',       label: 'Remittance Lines',       description: 'Per-employee breakdown across all remittances.' },
  { key: 'authority_filing_status',label: 'Authority Filing Status', description: 'Filing status and overdue detection per authority.' },
];

const SUMMARY_COLS: ReportColumn[] = [
  { header: 'Ref',            key: 'remittanceNo' },
  { header: 'Authority',      key: 'authority' },
  { header: 'Period',         key: 'period' },
  { header: 'Status',         key: 'status' },
  { header: 'Employee Amt',   key: 'employeePortion', format: 'currency' },
  { header: 'Employer Amt',   key: 'employerPortion', format: 'currency' },
  { header: 'Total Due',      key: 'totalDue',        format: 'currency' },
  { header: 'Due Date',       key: 'dueDate' },
  { header: 'Paid Date',      key: 'paidDate' },
  { header: 'Filed Date',     key: 'filedDate' },
  { header: 'Auth Ref',       key: 'authorityReference' },
];

const LINES_COLS: ReportColumn[] = [
  { header: 'Remittance',    key: 'remittanceNo' },
  { header: 'Authority',     key: 'authority' },
  { header: 'Period',        key: 'period' },
  { header: 'Employee ID',   key: 'employeeId' },
  { header: 'Employee Amt',  key: 'employeePortion', format: 'currency' },
  { header: 'Employer Amt',  key: 'employerPortion', format: 'currency' },
  { header: 'Total',         key: 'lineTotal',       format: 'currency' },
];

const FILING_COLS: ReportColumn[] = [
  { header: 'Ref',            key: 'remittanceNo' },
  { header: 'Authority',      key: 'authority' },
  { header: 'Period',         key: 'period' },
  { header: 'Status',         key: 'status' },
  { header: 'Due Date',       key: 'dueDate' },
  { header: 'Filed Date',     key: 'filedDate' },
  { header: 'Method',         key: 'filingMethod' },
  { header: 'Receipt Ref',    key: 'receiptReference' },
  { header: 'Overdue',        key: 'overdue' },
];

function COLS_FOR(report: string): ReportColumn[] {
  if (report === 'remittance_lines')        return LINES_COLS;
  if (report === 'authority_filing_status') return FILING_COLS;
  return SUMMARY_COLS;
}

function RemReportsTab({ tabs, activeTab, onTab }: {
  tabs: HrfinTab[]; activeTab: string; onTab: (k: string) => void;
}): VNode {
  const [selectedReport, setReport] = useState<string>('remittance_summary');
  const [periodYear, setPeriodYear] = useState<number | undefined>(undefined);
  const [authorityFilter, setAuth]  = useState<RemittanceAuthority | undefined>(undefined);

  const reportQ = useRemittancesReport({
    report:     selectedReport,
    periodYear,
    authority:  authorityFilter,
    enabled:    !!selectedReport,
  });

  const params = (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        <span class="hrfin-muted">Year</span>
        <input
          type="number" min={2020} max={2100} placeholder="All years"
          style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--hrfin-border, #2a3347)', background: 'transparent', color: 'inherit', fontSize: 13, width: 100 }}
          value={periodYear ?? ''}
          onInput={e => {
            const n = Number((e.currentTarget as HTMLInputElement).value);
            setPeriodYear(Number.isFinite(n) && n > 2000 ? n : undefined);
          }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        <span class="hrfin-muted">Authority</span>
        <select
          style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--hrfin-border, #2a3347)', background: 'var(--hrfin-surface-2, #1e2535)', color: 'inherit', fontSize: 13 }}
          value={authorityFilter ?? ''}
          onChange={e => {
            const v = (e.currentTarget as HTMLSelectElement).value as RemittanceAuthority;
            setAuth(v || undefined);
          }}
        >
          <option value="">All authorities</option>
          <option value="paye_bir">PAYE / BIR</option>
          <option value="nis_nibtt">NIS / NIBTT</option>
          <option value="health_surcharge">Health Surcharge</option>
        </select>
      </label>
    </div>
  );

  return (
    <article class="hrfin-table-card">
      <div class="hrfin-tabs">
        {tabs.map(t => (
          <button key={t.key} type="button" class={t.key === activeTab ? 'is-active' : ''} onClick={() => onTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <ReportPanel
        reports={REPORT_DESCRIPTORS}
        selectedReport={selectedReport}
        onSelectReport={k => setReport(k)}
        params={params}
        result={reportQ.data ?? null}
        columns={COLS_FOR(selectedReport)}
        exportFilename="remittances-report"
        loading={reportQ.isLoading}
        error={reportQ.isError ? 'Failed to load report.' : null}
      />
    </article>
  );
}

// ── Remittance Drawer ─────────────────────────────────────────────────────────

type DrawerTab = 'summary' | 'lines' | 'filing' | 'payments' | 'approvals' | 'timeline' | 'audit' | 'payrollRun' | 'attachments';

const DRAWER_TABS: { key: DrawerTab; label: string }[] = [
  { key: 'summary',     label: 'Summary' },
  { key: 'lines',       label: 'Lines' },
  { key: 'filing',      label: 'Authority Filing' },
  { key: 'payments',    label: 'Payments' },
  { key: 'approvals',   label: 'Approvals' },
  { key: 'timeline',    label: 'Timeline' },
  { key: 'audit',       label: 'Audit' },
  { key: 'payrollRun',  label: 'Related Payroll Run' },
  { key: 'attachments', label: 'Attachments' },
];

function RemittanceDrawer({ remittanceId, open, onClose, canManage, canApprove, canFiled, onSubmit, onApprove, onMarkPaid, onMarkFiled, onCancel }: {
  remittanceId: string | null;
  open: boolean;
  onClose: () => void;
  canManage: boolean;
  canApprove: boolean;
  canFiled: boolean;
  onSubmit: (id: string) => void;
  onApprove: (id: string) => void;
  onMarkPaid: (r: Remittance) => void;
  onMarkFiled: (r: Remittance) => void;
  onCancel: (id: string) => void;
}): VNode {
  const [tab, setTab] = useState<DrawerTab>('summary');
  const detailQ = useRemittance(remittanceId);
  const r = detailQ.data;

  return (
    <Drawer
      open={open}
      onClose={() => { onClose(); setTab('summary'); }}
      panelClass="hrfin"
      title={r ? r.remittanceNo : 'Remittance'}
      sub={r ? `${AUTHORITY_LABEL[r.authority]} · ${periodLabel(r.periodYear, r.periodMonth)}` : ''}
      foot={r ? (
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', width: '100%' }}>
          {canManage && r.status === 'draft'     && <button class="hrfin-action is-primary" onClick={() => onSubmit(r.id)}>Submit</button>}
          {canApprove && r.status === 'submitted' && <button class="hrfin-action is-primary" onClick={() => onApprove(r.id)}>Approve</button>}
          {canApprove && r.status === 'approved'  && <button class="hrfin-action is-primary" onClick={() => onMarkPaid(r)}>Mark Paid</button>}
          {canFiled  && r.status === 'paid'       && <button class="hrfin-action is-primary" onClick={() => onMarkFiled(r)}>Mark Filed</button>}
          {canManage && ['draft','submitted'].includes(r.status) && (
            <button class="hrfin-action is-danger" style={{ marginLeft: 'auto' }} onClick={() => onCancel(r.id)}>Cancel</button>
          )}
        </div>
      ) : undefined}
    >
      {!r ? (
        <div class="hrfin hrfin-empty">{detailQ.isLoading ? 'Loading…' : 'Failed to load.'}</div>
      ) : (
        <div class="hrfin">
          {/* Status + amount hero */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <strong style={{ fontSize: 28, fontWeight: 650 }}>{money(r.totalDue)}</strong>
            <HrfinPill tone={statusTone(r.status)}>{humanize(r.status)}</HrfinPill>
          </div>

          {/* Tabs */}
          <div class="hrfin-tabs" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
            {DRAWER_TABS.map(t => (
              <button key={t.key} type="button" class={t.key === tab ? 'is-active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>

          {tab === 'summary'     && <DrawerSummaryTab r={r} />}
          {tab === 'lines'       && <DrawerLinesTab remittanceId={r.id} open={open} />}
          {tab === 'filing'      && <DrawerFilingTab r={r} />}
          {tab === 'payments'    && <DrawerPaymentsTab r={r} />}
          {tab === 'approvals'   && <DrawerApprovalsTab r={r} />}
          {tab === 'timeline'    && <DrawerTimelineTab r={r} />}
          {tab === 'audit'       && <DrawerAuditTab remittanceId={r.id} open={open} activeTab={tab} />}
          {tab === 'payrollRun'  && <DrawerPayrollRunTab r={r} />}
          {tab === 'attachments' && <DrawerAttachmentsTab remittanceId={r.id} open={open} />}
        </div>
      )}
    </Drawer>
  );
}

// ── Drawer sub-tabs ────────────────────────────────────────────────────────────

function DrawerSummaryTab({ r }: { r: Remittance }): VNode {
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row"><span>Remittance No.</span><b>{r.remittanceNo}</b></div>
      <div class="hrfin-metric-row"><span>Authority</span><b>{AUTHORITY_LABEL[r.authority]}</b></div>
      <div class="hrfin-metric-row"><span>Period</span><b>{periodLabel(r.periodYear, r.periodMonth)}</b></div>
      <div class="hrfin-metric-row"><span>Currency</span><b>{r.currency}</b></div>
      <div class="hrfin-metric-row"><span>Employee portion</span><b>{money(r.employeePortion)}</b></div>
      <div class="hrfin-metric-row"><span>Employer portion</span><b>{money(r.employerPortion)}</b></div>
      <div class="hrfin-metric-row"><span>Total due</span><b style={{ color: 'var(--hrfin-accent)' }}>{money(r.totalDue)}</b></div>
      <div class="hrfin-metric-row"><span>Due date</span><b>{fmtDate(r.dueDate)}</b></div>
      <div class="hrfin-metric-row"><span>Status</span><b><HrfinPill tone={statusTone(r.status)}>{humanize(r.status)}</HrfinPill></b></div>
      <div class="hrfin-metric-row"><span>Created</span><b class="hrfin-muted">{fmtDate(r.createdAt)}</b></div>
      {r.cancelReason && (
        <div class="hrfin-metric-row"><span>Cancel reason</span><b class="hrfin-muted">{r.cancelReason}</b></div>
      )}
    </div>
  );
}

function DrawerLinesTab({ remittanceId, open }: { remittanceId: string; open: boolean }): VNode {
  const linesQ = useRemittanceLines(remittanceId, open);
  const lines  = linesQ.data ?? [];

  const empIds = useMemo(() => lines.map(l => l.employeeId), [lines]);
  const { data: nameMap } = useEmployeeNames(empIds);

  if (linesQ.isLoading && !linesQ.data) return <div class="hrfin-empty">Loading lines…</div>;
  if (!lines.length) return <div class="hrfin-empty">No lines for this remittance.</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--hrfin-border, #2a3347)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Employee</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Employee</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Employer</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id} style={{ borderBottom: '1px solid var(--hrfin-border, #2a3347)' }}>
              <td style={{ padding: '6px 8px' }}>
                <EmployeeCellResolved resolved={nameMap?.get(l.employeeId)} fallbackId={l.employeeId} />
              </td>
              <td style={{ textAlign: 'right', padding: '6px 8px', fontVariantNumeric: 'tabular-nums' }}>{money(l.employeePortion)}</td>
              <td style={{ textAlign: 'right', padding: '6px 8px', fontVariantNumeric: 'tabular-nums' }}>{money(l.employerPortion)}</td>
              <td style={{ textAlign: 'right', padding: '6px 8px', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ padding: '8px 8px', fontWeight: 700 }}>Total ({lines.length} employees)</td>
            <td style={{ textAlign: 'right', padding: '8px 8px', fontWeight: 700 }}>{money(lines.reduce((s, l) => s + l.employeePortion, 0))}</td>
            <td style={{ textAlign: 'right', padding: '8px 8px', fontWeight: 700 }}>{money(lines.reduce((s, l) => s + l.employerPortion, 0))}</td>
            <td style={{ textAlign: 'right', padding: '8px 8px', fontWeight: 700 }}>{money(lines.reduce((s, l) => s + l.lineTotal, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DrawerFilingTab({ r }: { r: Remittance }): VNode {
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row"><span>Filing status</span><b><HrfinPill tone={r.status === 'filed' ? 'ok' : 'dr'}>{r.status === 'filed' ? 'Filed' : 'Not yet filed'}</HrfinPill></b></div>
      <div class="hrfin-metric-row"><span>Filed date</span><b>{fmtDate(r.filedDate)}</b></div>
      <div class="hrfin-metric-row"><span>Filing method</span><b>{r.filingMethod ? humanize(r.filingMethod) : '—'}</b></div>
      <div class="hrfin-metric-row"><span>Authority reference</span><b>{r.authorityReference ?? '—'}</b></div>
      <div class="hrfin-metric-row"><span>Receipt reference</span><b>{r.receiptReference ?? '—'}</b></div>
      {r.filedNotes && (
        <div style={{ marginTop: 12 }}>
          <div class="hrfin-muted" style={{ fontSize: 11, marginBottom: 4 }}>Filing notes</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>{r.filedNotes}</div>
        </div>
      )}
      {r.status !== 'filed' && (
        <div class="hrfin-muted" style={{ marginTop: 16, fontSize: 12 }}>
          Mark the remittance as Paid first, then use "Mark Filed" to record filing details.
        </div>
      )}
    </div>
  );
}

function DrawerPaymentsTab({ r }: { r: Remittance }): VNode {
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row"><span>Payment status</span><b><HrfinPill tone={['paid','filed'].includes(r.status) ? 'ok' : 'dr'}>{['paid','filed'].includes(r.status) ? 'Paid' : 'Not paid'}</HrfinPill></b></div>
      <div class="hrfin-metric-row"><span>Paid date</span><b>{fmtDate(r.paidDate)}</b></div>
      <div class="hrfin-metric-row"><span>Authority reference</span><b>{r.authorityReference ?? '—'}</b></div>
      <div class="hrfin-metric-row"><span>Total paid</span><b style={{ color: 'var(--hrfin-ok, #4caf50)' }}>{['paid','filed'].includes(r.status) ? money(r.totalDue) : '—'}</b></div>
      <div class="hrfin-metric-row"><span>Employee portion paid</span><b>{['paid','filed'].includes(r.status) ? money(r.employeePortion) : '—'}</b></div>
      <div class="hrfin-metric-row"><span>Employer portion paid</span><b>{['paid','filed'].includes(r.status) ? money(r.employerPortion) : '—'}</b></div>
    </div>
  );
}

function DrawerApprovalsTab({ r }: { r: Remittance }): VNode {
  const userIds = useMemo(() =>
    [r.approvedBy, r.createdBy].filter((x): x is string => !!x),
    [r.approvedBy, r.createdBy],
  );
  const { data: nameMap } = useEmployeeNames(userIds);

  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row"><span>Workflow ID</span><b class="hrfin-muted" style={{ fontSize: 11 }}>{r.workflowId ?? 'None'}</b></div>
      <div class="hrfin-metric-row"><span>Approval status</span><b>
        {r.status === 'approved' || r.status === 'paid' || r.status === 'filed'
          ? <HrfinPill tone="ok">Approved</HrfinPill>
          : r.status === 'submitted'
          ? <HrfinPill tone="wn">Pending approval</HrfinPill>
          : <HrfinPill tone="dr">{humanize(r.status)}</HrfinPill>}
      </b></div>
      <div class="hrfin-metric-row"><span>Approved by</span><b>
        {r.approvedBy
          ? <EmployeeCellResolved resolved={nameMap?.get(r.approvedBy)} fallbackId={r.approvedBy} />
          : <span class="hrfin-muted">—</span>}
      </b></div>
      <div class="hrfin-metric-row"><span>Creator</span><b>
        {r.createdBy
          ? <EmployeeCellResolved resolved={nameMap?.get(r.createdBy)} fallbackId={r.createdBy} />
          : <span class="hrfin-muted">—</span>}
      </b></div>
      {r.status === 'submitted' && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--hrfin-surface-2)', borderRadius: 8, fontSize: 12 }}>
          <strong>Maker-checker:</strong> the creator cannot approve their own remittance.
          A different finance_manager must approve.
        </div>
      )}
    </div>
  );
}

function DrawerTimelineTab({ r }: { r: Remittance }): VNode {
  const events: ActivityItem[] = [
    { icon: 'plus', title: 'Created as draft', meta: fmtDate(r.createdAt) },
    ...(r.status !== 'draft' && r.status !== 'cancelled' ? [
      { icon: 'send' as const, title: 'Submitted for approval', meta: fmtDate(r.updatedAt) },
    ] : []),
    ...(['approved','paid','filed'].includes(r.status) ? [
      { icon: 'check' as const, title: 'Approved', meta: fmtDate(r.updatedAt) },
    ] : []),
    ...(['paid','filed'].includes(r.status) && r.paidDate ? [
      { icon: 'bank' as const, title: 'Marked paid', meta: fmtDate(r.paidDate) },
    ] : []),
    ...(r.status === 'filed' && r.filedDate ? [
      { icon: 'receipt' as const, title: 'Filed with authority', meta: fmtDate(r.filedDate) },
    ] : []),
    ...(r.status === 'cancelled' ? [
      { icon: 'close' as const, title: `Cancelled${r.cancelReason ? `: ${r.cancelReason}` : ''}`, meta: fmtDate(r.updatedAt) },
    ] : []),
  ];
  return <ActivityFeed items={events} />;
}

function DrawerAuditTab({ remittanceId, open, activeTab }: { remittanceId: string; open: boolean; activeTab: string }): VNode {
  const auditQ = useRemittanceAudit(remittanceId, open && activeTab === 'audit');
  const entries = auditQ.data ?? [];

  const actorIds = useMemo(() =>
    [...new Set(entries.map(e => e.actorId).filter((x): x is string => !!x))],
    [entries],
  );
  const { data: nameMap } = useEmployeeNames(actorIds);

  if (auditQ.isLoading && !auditQ.data) return <div class="hrfin-empty">Loading audit log…</div>;
  if (!entries.length) return <div class="hrfin-empty">No audit entries yet.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map(e => (
        <div key={e.id} style={{ padding: '10px 12px', background: 'var(--hrfin-surface-2)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <strong style={{ fontSize: 13 }}>{humanize(e.action)}</strong>
            <span class="hrfin-muted">{fmtDate(e.createdAt)}</span>
          </div>
          {e.reason && <div class="hrfin-muted">Reason: {e.reason}</div>}
          {e.actorId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span class="hrfin-muted" style={{ fontSize: 11 }}>Actor:</span>
              <EmployeeCellResolved resolved={nameMap?.get(e.actorId)} fallbackId={e.actorId} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DrawerPayrollRunTab({ r }: { r: Remittance }): VNode {
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row">
        <span>Payroll run</span>
        <b style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{r.payrollRunNo ?? `${r.payrollRunId.slice(0, 8)}…`}</span>
          <button
            type="button"
            class="hrfin-action"
            style={{ padding: '3px 10px', fontSize: 11 }}
            onClick={() => window.dispatchEvent(new CustomEvent('siomac:section', { detail: 's-finance-payroll' }))}
          >
            Open ↗
          </button>
        </b>
      </div>
      <div class="hrfin-metric-row"><span>Period</span><b>{periodLabel(r.periodYear, r.periodMonth)}</b></div>
      <div class="hrfin-metric-row">
        <span class="hrfin-muted" style={{ fontSize: 11 }}>Run ID</span>
        <b class="hrfin-muted" style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.payrollRunId}</b>
      </div>
    </div>
  );
}

function DrawerAttachmentsTab({ remittanceId, open }: { remittanceId: string; open: boolean }): VNode {
  const attachQ = useFinanceAttachments('remittance', remittanceId, open);
  const canUpload = can('finance.remittances.manage');
  const getUploadUrl  = useFinanceAttachmentUploadUrl();
  const completeUpload = useCompleteFinanceAttachment();
  const getSignedUrl  = useFinanceAttachmentSignedUrl();
  const deleteAtt     = useDeleteFinanceAttachment();

  async function handleUpload(file: File) {
    try {
      const { uploadUrl, path } = await getUploadUrl.mutateAsync({
        entityType: 'remittance', entityId: remittanceId,
        fileName: file.name, mimeType: file.type || 'application/octet-stream',
      });
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      await completeUpload.mutateAsync({
        entityType: 'remittance', entityId: remittanceId,
        fileName: file.name, storagePath: path,
        mimeType: file.type, fileSize: file.size,
      });
      toast('Attachment uploaded.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleView(storagePath: string) {
    try {
      const url = await getSignedUrl.mutateAsync({ entityType: 'remittance', entityId: remittanceId, storagePath });
      window.open(url, '_blank');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    const ok = await dialog.confirm({ title: 'Delete attachment?', text: 'This cannot be undone.', danger: true });
    if (!ok) return;
    try {
      await deleteAtt.mutateAsync({ id, entityType: 'remittance', entityId: remittanceId });
      toast('Attachment deleted.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const attachments = attachQ.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {canUpload && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
          border: '1px dashed var(--hrfin-border, #2a3347)', borderRadius: 8,
          cursor: 'pointer', fontSize: 13,
        }}>
          <input
            type="file"
            accept="image/*,application/pdf,.csv,.xls,.xlsx,.doc,.docx"
            style={{ display: 'none' }}
            onChange={e => {
              const f = (e.currentTarget as HTMLInputElement).files?.[0];
              if (f) void handleUpload(f);
            }}
          />
          <span style={{ fontSize: 16 }}>📎</span>
          <span>{getUploadUrl.isPending ? 'Uploading…' : 'Attach a filing receipt or support document'}</span>
        </label>
      )}

      {attachQ.isLoading && !attachQ.data && <div class="hrfin-empty">Loading attachments…</div>}

      {!attachments.length && !attachQ.isLoading && (
        <div class="hrfin-empty">No attachments yet.</div>
      )}

      {attachments.map(att => (
        <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--hrfin-surface-2)', borderRadius: 8 }}>
          <span style={{ fontSize: 16 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.fileName}</div>
            <div class="hrfin-muted" style={{ fontSize: 11 }}>{att.fileSize ? `${Math.round(att.fileSize / 1024)} KB` : ''} · {fmtDate(att.createdAt)}</div>
          </div>
          <button
            type="button" class="hrfin-action" style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={() => void handleView(att.storagePath)}
          >View</button>
          {canUpload && (
            <button
              type="button" class="hrfin-action" style={{ padding: '5px 10px', fontSize: 12, color: 'var(--hrfin-danger, #e05)' }}
              onClick={() => void handleDelete(att.id)}
            >Delete</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Compute & Create wizard (5 steps) ─────────────────────────────────────────

type WizardStep = 0 | 1 | 2 | 3 | 4;

function RemComputeWizard({ onClose }: { onClose: () => void }): VNode {
  const [step, setStep]           = useState<WizardStep>(0);
  const [runId, setRunId]         = useState<string | null>(null);
  const [authority, setAuthority] = useState<RemittanceAuthority | null>(null);
  const [dueDate, setDueDate]     = useState('');
  const [errors, setErrors]       = useState<Record<string, string>>({});

  const computeQ = useComputedRemittance(
    step >= 2 ? runId : null,
    step >= 2 ? authority : null,
  );
  const computed = computeQ.data;

  const createMut = useCreateRemittance();

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (step === 0 && !runId)        e['runId']     = 'Select a payroll run.';
    if (step === 1 && !authority)    e['authority'] = 'Select an authority.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() {
    if (!validate()) return;
    if (step < 4) setStep((step + 1) as WizardStep);
  }

  async function submit() {
    if (!runId || !authority) return;
    try {
      await createMut.mutateAsync({ payrollRunId: runId, authority, dueDate: dueDate || null });
      toast('Remittance created as draft.');
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const primaryLabel =
    step === 4 ? 'Create Draft' :
    step === 3 ? 'Review' :
    'Next';

  const primaryDisabled =
    (step === 0 && !runId) ||
    (step === 1 && !authority) ||
    (step === 2 && computeQ.isLoading) ||
    (step === 4 && createMut.isPending);

  return (
    <HrfinWizardModal
      open
      title="Compute & Create Remittance"
      stepCount={5}
      activeStep={step}
      onClose={onClose}
      onBack={step > 0 ? () => setStep((step - 1) as WizardStep) : undefined}
      primaryLabel={step === 4 ? (createMut.isPending ? 'Creating…' : 'Create Draft') : 'Next'}
      onPrimary={step === 4 ? () => void submit() : next}
      primaryDisabled={primaryDisabled}
    >
      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--hrfin-muted)' }}>
            Select the approved payroll run to compute remittances from.
          </div>
          <ApprovedRunPicker
            label="Approved payroll run"
            value={runId}
            onChange={v => { setRunId(v); setErrors({}); }}
            error={errors['runId']}
            required
          />
        </div>
      )}

      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--hrfin-muted)' }}>
            Select the statutory authority for this remittance.
          </div>
          <AuthorityPicker
            label="Authority"
            value={authority}
            onChange={v => { setAuthority(v as RemittanceAuthority | null); setErrors({}); }}
            error={errors['authority']}
            required
          />
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 14, color: 'var(--hrfin-muted)' }}>
            Computing totals from the selected payroll run…
          </div>
          {computeQ.isLoading && <div class="hrfin-empty">Computing…</div>}
          {computeQ.isError && (
            <div style={{ color: 'var(--hrfin-danger, #e05)', fontSize: 13 }}>
              {(computeQ.error as Error).message}
            </div>
          )}
          {computed && (
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Authority</span><b>{authority ? AUTHORITY_LABEL[authority] : '—'}</b></div>
              <div class="hrfin-metric-row"><span>Period</span><b>{periodLabel(computed.periodYear, computed.periodMonth)}</b></div>
              <div class="hrfin-metric-row"><span>Employee portion</span><b>{money(computed.employeePortion)}</b></div>
              <div class="hrfin-metric-row"><span>Employer portion</span><b>{money(computed.employerPortion)}</b></div>
              <div class="hrfin-metric-row"><span>Total due</span><b style={{ color: 'var(--hrfin-accent)' }}>{money(computed.totalDue)}</b></div>
              <div class="hrfin-metric-row"><span>Employees</span><b>{computed.lineCount}</b></div>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--hrfin-muted)' }}>
            Set the filing due date and additional settings.
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <span>Due date <span class="hrfin-muted">(optional — defaults to authority's standard date)</span></span>
            <input
              type="date"
              value={dueDate}
              onInput={e => setDueDate((e.currentTarget as HTMLInputElement).value)}
              style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--hrfin-border)', background: 'transparent', color: 'inherit', fontSize: 13 }}
            />
          </label>
        </div>
      )}

      {step === 4 && computed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Review before creating</div>
          <div class="hrfin-metric-list">
            <div class="hrfin-metric-row"><span>Authority</span><b>{authority ? AUTHORITY_LABEL[authority] : '—'}</b></div>
            <div class="hrfin-metric-row"><span>Period</span><b>{periodLabel(computed.periodYear, computed.periodMonth)}</b></div>
            <div class="hrfin-metric-row"><span>Employee portion</span><b>{money(computed.employeePortion)}</b></div>
            <div class="hrfin-metric-row"><span>Employer portion</span><b>{money(computed.employerPortion)}</b></div>
            <div class="hrfin-metric-row"><span>Total due</span><b style={{ color: 'var(--hrfin-accent)' }}>{money(computed.totalDue)}</b></div>
            {dueDate && <div class="hrfin-metric-row"><span>Due date</span><b>{fmtDate(dueDate)}</b></div>}
          </div>
          <div style={{ padding: '10px 12px', background: 'var(--hrfin-surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--hrfin-muted)' }}>
            <strong>Maker-checker:</strong> After creating, submit for approval.
            A different finance_manager must approve before payment.
          </div>
          {createMut.isError && (
            <div style={{ color: 'var(--hrfin-danger, #e05)', fontSize: 13 }}>{(createMut.error as Error).message}</div>
          )}
        </div>
      )}
    </HrfinWizardModal>
  );
}

// ── Mark-Paid dialog ──────────────────────────────────────────────────────────

function RemMarkPaidDialog({ remittance, onClose }: { remittance: Remittance; onClose: () => void }): VNode {
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [authRef,  setAuthRef]  = useState(remittance.authorityReference ?? '');
  const [error,    setError]    = useState('');

  const markPaid = useMarkPaidRemittance();

  async function submit() {
    setError('');
    if (!paidDate) { setError('Payment date is required.'); return; }
    try {
      await markPaid.mutateAsync({ id: remittance.id, paidDate, authorityReference: authRef || undefined });
      toast('Marked as paid.');
      onClose();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <HrfinWizardModal
      open
      title="Mark Remittance Paid"
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel={markPaid.isPending ? 'Saving…' : 'Mark Paid'}
      onPrimary={() => void submit()}
      primaryDisabled={!paidDate || markPaid.isPending}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div class="hrfin-metric-list" style={{ marginBottom: 8 }}>
          <div class="hrfin-metric-row"><span>Remittance</span><b>{remittance.remittanceNo}</b></div>
          <div class="hrfin-metric-row"><span>Authority</span><b>{AUTHORITY_LABEL[remittance.authority]}</b></div>
          <div class="hrfin-metric-row"><span>Total due</span><b>{money(remittance.totalDue)}</b></div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span>Payment date <span style={{ color: 'var(--hrfin-danger, #e05)' }}>*</span></span>
          <input
            type="date" required value={paidDate}
            onInput={e => { setPaidDate((e.currentTarget as HTMLInputElement).value); setError(''); }}
            style={{ padding: '7px 10px', borderRadius: 6, border: `1px solid ${!paidDate ? 'var(--hrfin-danger, #e05)' : 'var(--hrfin-border)'}`, background: 'transparent', color: 'inherit', fontSize: 13 }}
          />
          {!paidDate && <span style={{ color: 'var(--hrfin-danger, #e05)', fontSize: 11 }}>Payment date is required.</span>}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span>Authority reference / receipt no. <span class="hrfin-muted">(optional)</span></span>
          <input
            type="text" placeholder="e.g. NIBTT-2026-00123" value={authRef}
            onInput={e => setAuthRef((e.currentTarget as HTMLInputElement).value)}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--hrfin-border)', background: 'transparent', color: 'inherit', fontSize: 13 }}
          />
        </label>
        {error && <div style={{ color: 'var(--hrfin-danger, #e05)', fontSize: 13 }}>{error}</div>}
      </div>
    </HrfinWizardModal>
  );
}

// ── Mark-Filed dialog (full §12 fields) ──────────────────────────────────────

function RemMarkFiledDialog({ remittance, onClose }: { remittance: Remittance; onClose: () => void }): VNode {
  const [filedDate,      setFiledDate]     = useState(new Date().toISOString().slice(0, 10));
  const [authRef,        setAuthRef]       = useState(remittance.authorityReference ?? '');
  const [filingMethod,   setFilingMethod]  = useState('');
  const [receiptRef,     setReceiptRef]    = useState('');
  const [notes,          setNotes]         = useState('');
  const [receiptFile,    setReceiptFile]   = useState<File | null>(null);
  const [fieldErrors,    setFieldErrors]   = useState<Record<string, string>>({});
  const [uploadErr,      setUploadErr]     = useState('');
  const [submitting,     setSubmitting]    = useState(false);

  const markFiled      = useMarkFiledRemittance();
  const getUploadUrl   = useFinanceAttachmentUploadUrl();
  const completeUpload = useCompleteFinanceAttachment();

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!filedDate)     e['filedDate']    = 'Filed date is required.';
    if (!filingMethod)  e['filingMethod'] = 'Filing method is required.';
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSubmitting(true);
    setUploadErr('');
    try {
      const args: MarkFiledArgs = {
        id:                 remittance.id,
        filedDate:          filedDate || undefined,
        authorityReference: authRef || undefined,
        filingMethod:       filingMethod || undefined,
        receiptReference:   receiptRef || undefined,
        filedNotes:         notes || undefined,
      };
      await markFiled.mutateAsync(args);

      // Upload receipt attachment if the user selected one.
      if (receiptFile) {
        try {
          const { uploadUrl, path } = await getUploadUrl.mutateAsync({
            entityType: 'remittance',
            entityId:   remittance.id,
            fileName:   receiptFile.name,
            mimeType:   receiptFile.type || 'application/octet-stream',
          });
          await fetch(uploadUrl, {
            method:  'PUT',
            body:    receiptFile,
            headers: { 'Content-Type': receiptFile.type || 'application/octet-stream' },
          });
          await completeUpload.mutateAsync({
            entityType: 'remittance',
            entityId:   remittance.id,
            fileName:   receiptFile.name,
            storagePath: path,
            mimeType:   receiptFile.type,
            fileSize:   receiptFile.size,
          });
        } catch (uploadE) {
          // Filing is already recorded — surface the upload failure without hiding success.
          setUploadErr(
            `Filed successfully, but receipt upload failed: ${(uploadE as Error).message}. ` +
            `Re-upload in the drawer's Attachments tab.`,
          );
          setSubmitting(false);
          return; // Keep dialog open so user sees the error.
        }
      }

      toast(`${remittance.remittanceNo} filed with authority.`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSubmitting(false); }
  }

  return (
    <HrfinWizardModal
      open
      title="Mark Remittance Filed"
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel={submitting ? 'Recording…' : 'Mark Filed'}
      onPrimary={() => void submit()}
      primaryDisabled={submitting}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div class="hrfin-metric-list" style={{ marginBottom: 8 }}>
          <div class="hrfin-metric-row"><span>Remittance</span><b>{remittance.remittanceNo}</b></div>
          <div class="hrfin-metric-row"><span>Authority</span><b>{AUTHORITY_LABEL[remittance.authority]}</b></div>
          <div class="hrfin-metric-row"><span>Total paid</span><b>{money(remittance.totalDue)}</b></div>
        </div>

        {/* Filed date */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span>Filed date <span style={{ color: 'var(--hrfin-danger, #e05)' }}>*</span></span>
          <input
            type="date" required value={filedDate}
            onInput={e => { setFiledDate((e.currentTarget as HTMLInputElement).value); setFieldErrors(f => ({ ...f, filedDate: '' })); }}
            style={{ padding: '7px 10px', borderRadius: 6, border: `1px solid ${fieldErrors['filedDate'] ? 'var(--hrfin-danger, #e05)' : 'var(--hrfin-border)'}`, background: 'transparent', color: 'inherit', fontSize: 13 }}
          />
          {fieldErrors['filedDate'] && <span style={{ color: 'var(--hrfin-danger, #e05)', fontSize: 11 }}>{fieldErrors['filedDate']}</span>}
        </label>

        {/* Filing method */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span>Filing method <span style={{ color: 'var(--hrfin-danger, #e05)' }}>*</span></span>
          <select
            required value={filingMethod}
            onChange={e => { setFilingMethod((e.currentTarget as HTMLSelectElement).value); setFieldErrors(f => ({ ...f, filingMethod: '' })); }}
            style={{ padding: '7px 10px', borderRadius: 6, border: `1px solid ${fieldErrors['filingMethod'] ? 'var(--hrfin-danger, #e05)' : 'var(--hrfin-border)'}`, background: 'var(--hrfin-surface-2)', color: 'inherit', fontSize: 13 }}
          >
            <option value="">Select method…</option>
            {FILING_METHOD_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          {fieldErrors['filingMethod'] && <span style={{ color: 'var(--hrfin-danger, #e05)', fontSize: 11 }}>{fieldErrors['filingMethod']}</span>}
        </label>

        {/* Authority filing reference */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span>Authority filing reference <span class="hrfin-muted">(ref # issued by authority)</span></span>
          <input
            type="text" placeholder="e.g. BIR-2026-00123" value={authRef}
            onInput={e => setAuthRef((e.currentTarget as HTMLInputElement).value)}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--hrfin-border)', background: 'transparent', color: 'inherit', fontSize: 13 }}
          />
        </label>

        {/* Receipt reference */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span>Receipt reference <span class="hrfin-muted">(payment receipt #)</span></span>
          <input
            type="text" placeholder="e.g. RCPT-2026-00456" value={receiptRef}
            onInput={e => setReceiptRef((e.currentTarget as HTMLInputElement).value)}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--hrfin-border)', background: 'transparent', color: 'inherit', fontSize: 13 }}
          />
        </label>

        {/* Notes */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span>Filing notes <span class="hrfin-muted">(optional)</span></span>
          <textarea
            rows={3} value={notes} placeholder="Any notes about this filing…"
            onInput={e => setNotes((e.currentTarget as HTMLTextAreaElement).value)}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--hrfin-border)', background: 'transparent', color: 'inherit', fontSize: 13, resize: 'vertical' }}
          />
        </label>

        {/* Receipt attachment — inline upload (§12 field 6) */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <span>Receipt attachment <span class="hrfin-muted">(optional — authority-issued receipt document)</span></span>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            border: '1px dashed var(--hrfin-border, #2a3347)', borderRadius: 8,
            cursor: 'pointer', fontSize: 13,
          }}>
            <input
              type="file"
              accept="image/*,application/pdf,.csv,.xls,.xlsx"
              style={{ display: 'none' }}
              onChange={e => {
                const f = (e.currentTarget as HTMLInputElement).files?.[0];
                setReceiptFile(f ?? null);
                setUploadErr('');
              }}
            />
            <span style={{ fontSize: 15 }}>📎</span>
            <span style={{ flex: 1 }}>
              {getUploadUrl.isPending ? 'Uploading…' : (receiptFile ? receiptFile.name : 'Choose file…')}
            </span>
            {receiptFile && (
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--hrfin-muted)', fontSize: 12, padding: 0 }}
                onClick={ev => { ev.preventDefault(); setReceiptFile(null); }}
              >
                Remove
              </button>
            )}
          </label>
        </label>

        {uploadErr && (
          <div style={{ color: 'var(--hrfin-danger, #e05)', fontSize: 12, padding: '8px 10px', background: 'var(--hrfin-surface-2)', borderRadius: 6 }}>
            {uploadErr}
          </div>
        )}
      </div>
    </HrfinWizardModal>
  );
}
