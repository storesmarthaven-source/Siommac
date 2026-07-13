/**
 * src/components/sections/Finance/PayrollOverview.tsx
 *
 * Finance ▸ Payroll — full Aurora rebuild.
 *
 * Shell: HrfinPageHeader + QuickActionStrip + 6 KPI cards + HrfinTable (7 tabs)
 * Row-click → PayRunDrawer (tabbed drawer with lifecycle footer)
 * "New Run" → PayNewRunWizard (6-step wizard)
 * Reports tab → in-page report surface
 *
 * Zero legacy classes: no obx-*, no hr-offboarding, no fin-page, no PageHeader.
 *
 * Lifecycle (all through drawer footer → page handlers):
 *   draft → lock-inputs → calculate → submit → [approve / reject] → lock
 *   locked → export / generate-payslips / create-disbursement / create-remittance / reopen
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import {
  HrfinPageHeader,
  QuickActionStrip,
  KpiCard,
  HrfinTable,
  HrfinPill,
  TrendArea,
  HorizontalBars,
  type HrfinColumn,
  type HrfinTone,
  type RowActionItem,
} from '@ui';
import {
  usePayrollRuns,
  usePayrollMutation,
  financePayrollApi,
  type PayrollRun,
} from '@api/finance/payroll';
import { fmtMoney, fmtDate, humanize } from './financeShared';
import { PayNewRunWizard }  from './PayNewRunWizard';
import { PayRunDrawer, type PayRunDrawerActions } from './PayRunDrawer';
import {
  ReportPanel,
  type ReportResult,
  type ReportColumn,
  type ReportDescriptor,
} from './_shared/reports';

// ── Helpers ────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

function paginate<T>(rows: T[], page: number): { rows: T[]; pageCount: number; total: number } {
  return {
    rows:      rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    pageCount: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    total:     rows.length,
  };
}

function runStatusTone(status: string): HrfinTone {
  switch (status) {
    case 'locked':           return 'ok';
    case 'approved':         return 'ok';
    case 'pending_approval':
    case 'calculated':
    case 'input_locked':     return 'wn';
    case 'returned':         return 'bad';  // rejected/returned by approval — needs revision
    case 'cancelled':        return 'bad';
    default:                 return 'nu';   // draft, unknown
  }
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// ── Page-level tabs ────────────────────────────────────────────────────────────

type PageTab = 'all' | 'draft' | 'calculating' | 'pending' | 'approved' | 'locked' | 'reports';

const PAGE_TABS: { key: PageTab; label: string }[] = [
  { key: 'all',         label: 'All Runs' },
  { key: 'draft',       label: 'Draft' },
  { key: 'calculating', label: 'Calculating' },
  { key: 'pending',     label: 'Pending Approval' },
  { key: 'approved',    label: 'Approved' },
  { key: 'locked',      label: 'Locked' },
  { key: 'reports',     label: 'Reports' },
];

function tabFilter(runs: PayrollRun[], tab: PageTab): PayrollRun[] {
  switch (tab) {
    case 'draft':       return runs.filter(r => r.status === 'draft');
    case 'calculating': return runs.filter(r => ['input_locked', 'calculated', 'returned'].includes(r.status));
    case 'pending':     return runs.filter(r => r.status === 'pending_approval');
    case 'approved':    return runs.filter(r => r.status === 'approved');
    case 'locked':      return runs.filter(r => r.status === 'locked');
    default:            return runs;
  }
}

// ── Reports surface ───────────────────────────────────────────────────────────

const REPORTS: ReportDescriptor[] = [
  { key: 'register',             label: 'Payroll Register',      description: 'All runs with gross/net totals' },
  { key: 'payslip_register',     label: 'Payslip Register',      description: 'All generated payslips' },
  { key: 'net_pay_summary',      label: 'Net-Pay Summary',       description: 'Per-employee net pay for a run' },
  { key: 'employer_nis_summary', label: 'Employer-NIS Summary',  description: 'Employer NIS contributions by run' },
  { key: 'paye_summary',         label: 'PAYE Summary',          description: 'PAYE deductions for a run' },
  { key: 'hs_summary',           label: 'Health Surcharge',      description: 'HS deductions for a run' },
  { key: 'cost_by_department',   label: 'Cost by Department',    description: 'Payroll cost split by department' },
  { key: 'nis_remittance',       label: 'NIS Remittance',        description: 'NIS figures for statutory remittance' },
  { key: 'nis_exceptions',       label: 'NIS Exceptions',        description: 'NIS warning exceptions for a run' },
  { key: 'variation',            label: 'Variation (vs prior)',  description: 'This run vs the immediately-prior run: per-employee gross/net/PAYE/NIS deltas' },
  { key: 'audit_comparison',     label: 'Audit Comparison',      description: 'Diff any two runs line-by-line (added / removed / changed)' },
];

/** Dynamic columns derived from the first result row (unknown schema at design time). */
function dynamicColumns(rows: Record<string, unknown>[]): ReportColumn[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]!).map(k => ({
    key:    k,
    header: humanize(k),
    value:  (row: Record<string, unknown>) => {
      const v = row[k];
      return v == null ? '' : String(v);
    },
  }));
}

function ReportsSurface({ runs }: { runs: PayrollRun[] }): VNode {
  const [selectedReport, setSelectedReport] = useState<string>(REPORTS[0]!.key);
  const [runId,  setRunId]   = useState<string>(() => runs[0]?.id ?? '');
  const [compareRunId, setCompareRunId] = useState<string>('');
  const [result, setResult]  = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const canView = can('finance.payroll.reports.view');

  if (!canView) {
    return (
      <div class="hrfin" style={{ padding: 24 }}>
        <div class="hrfin-empty">You do not have permission to view payroll reports.</div>
      </div>
    );
  }

  async function runReport(): Promise<void> {
    setLoading(true); setResult(null); setError(null);
    try {
      const res = await financePayrollApi.runReport({
        report: selectedReport,
        params: {
          ...(runId ? { runId } : {}),
          ...(selectedReport === 'audit_comparison' && compareRunId ? { compareRunId } : {}),
        },
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to run report.');
      toast((e as Error).message ?? 'Failed to run report.');
    } finally {
      setLoading(false);
    }
  }

  const columns = result ? dynamicColumns(result.rows) : [];

  // Pay-run picker rendered as the params slot of ReportPanel
  const paramsSlot = (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Pay run</span>
        <select
          value={runId}
          onChange={e => { setRunId((e.currentTarget).value); setResult(null); }}
          style={{ fontSize: 13, padding: '8px 10px', background: 'var(--hrfin-surface-2)',
                   border: '1px solid var(--hrfin-border)', borderRadius: 6,
                   color: 'var(--hrfin-text-primary)' }}
        >
          <option value="">— all runs —</option>
          {runs.map(r => <option key={r.id} value={r.id}>{r.runNo} · {monthLabel(r.periodMonth)}</option>)}
        </select>
      </label>
      {selectedReport === 'audit_comparison' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Compare against</span>
          <select
            value={compareRunId}
            onChange={e => { setCompareRunId((e.currentTarget).value); setResult(null); }}
            style={{ fontSize: 13, padding: '8px 10px', background: 'var(--hrfin-surface-2)',
                     border: '1px solid var(--hrfin-border)', borderRadius: 6, color: 'var(--hrfin-text-primary)' }}
          >
            <option value="">— second run —</option>
            {runs.map(r => <option key={r.id} value={r.id}>{r.runNo} · {monthLabel(r.periodMonth)}</option>)}
          </select>
        </label>
      )}
      <button
        type="button"
        class="hrfin-action is-primary"
        disabled={loading || (selectedReport === 'audit_comparison' && (!runId || !compareRunId))}
        onClick={() => void runReport()}
        style={{ alignSelf: 'flex-end', marginBottom: 0 }}
      >
        {loading ? 'Running…' : 'Run report'}
      </button>
    </div>
  );

  return (
    <div class="hrfin">
      <ReportPanel
        reports={REPORTS}
        selectedReport={selectedReport}
        onSelectReport={key => { setSelectedReport(key); setResult(null); setError(null); }}
        params={paramsSlot}
        result={result}
        columns={columns}
        exportFilename={`payroll-${selectedReport}`}
        loading={loading}
        error={error}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type SortKey = 'period' | 'net' | 'gross' | 'employees' | 'created';
type SortDir = 'asc' | 'desc';

function sortRuns(rows: PayrollRun[], key: SortKey, dir: SortDir): PayrollRun[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'period':    return sign * a.periodMonth.localeCompare(b.periodMonth);
      case 'net':       return sign * ((a.netTotal ?? 0) - (b.netTotal ?? 0));
      case 'gross':     return sign * ((a.grossTotal ?? 0) - (b.grossTotal ?? 0));
      case 'employees': return sign * ((a.employeeCount ?? 0) - (b.employeeCount ?? 0));
      case 'created':   return sign * a.createdAt.localeCompare(b.createdAt);
      default:          return 0;
    }
  });
}

function downloadCsv(rows: PayrollRun[]): void {
  const headers = ['Run #', 'Period', 'Frequency', 'Employees', 'Gross', 'Net', 'Status', 'Created'];
  const lines   = rows.map(r => [
    r.runNo,
    r.periodMonth.slice(0, 7),
    r.payFrequency,
    String(r.employeeCount),
    r.grossTotal.toFixed(2),
    r.netTotal.toFixed(2),
    r.status,
    r.createdAt.slice(0, 10),
  ].map(v => `"${v.replace(/"/g, '""')}"`).join(','));
  const csv  = [headers.join(','), ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `payroll-runs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function PayrollOverview(): VNode {
  const [tab,      setTab]      = useState<PageTab>('all');
  const [search,   setSearch]   = useState('');
  const [page,     setPage]     = useState(0);
  const [sortKey,  setSortKey]  = useState<SortKey>('period');
  const [sortDir,  setSortDir]  = useState<SortDir>('desc');
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [wizOpen,     setWizOpen]     = useState(false);

  // Permissions
  const canManage = can('finance.payroll.run.manage');
  const _canLock   = can('finance.payroll.lock');
  const canApprove = can('finance.payroll.approve') || can('finance.payroll.lock');
  const canExport = can('finance.payroll.export');
  const _canView   = can('finance.payroll.view_all') || canManage;

  // Data
  const runsQ = usePayrollRuns({ limit: 500 });
  const runs  = runsQ.data ?? [];

  // Mutations (used by drawer actions)
  const lockInputsMut  = usePayrollMutation(financePayrollApi.lockInputs);
  const calcMut        = usePayrollMutation(financePayrollApi.calculate);
  const submitMut      = usePayrollMutation(financePayrollApi.submitRun);
  const approveRunMut  = usePayrollMutation(financePayrollApi.approveRun);
  const rejectRunMut   = usePayrollMutation(financePayrollApi.rejectRun);
  const lockRunMut     = usePayrollMutation(financePayrollApi.lockRun);
  const reopenMut      = usePayrollMutation(financePayrollApi.reopenRun);
  const exportMut      = usePayrollMutation(financePayrollApi.exportRun);
  const genMut         = usePayrollMutation(financePayrollApi.generatePayslips);

  async function runAction(p: Promise<unknown>, ok: string): Promise<void> {
    try { await p; toast(ok); }
    catch (e) { toast((e as Error).message ?? 'Action failed.'); }
  }

  // KPIs
  const totalNet        = runs.reduce((s, r) => s + (r.netTotal || 0), 0);
  const totalGross      = runs.reduce((s, r) => s + (r.grossTotal || 0), 0);
  const totalNisEmp     = runs.reduce((s, r) => s + (r.nisEmployerTotal || 0), 0);
  const countLocked     = runs.filter(r => r.status === 'locked').length;
  const countInProgress = runs.filter(r => ['draft', 'input_locked', 'calculated', 'returned', 'pending_approval'].includes(r.status)).length;
  const countPending    = runs.filter(r => r.status === 'pending_approval').length;

  // Tab filtering + search + pagination
  const tabFiltered = useMemo(() => tabFilter(runs, tab), [runs, tab]);
  const searched = useMemo(() => {
    if (!search.trim() || tab === 'reports') return tabFiltered;
    const q = search.trim().toLowerCase();
    return tabFiltered.filter(r =>
      r.runNo.toLowerCase().includes(q) ||
      r.periodMonth.includes(q) ||
      r.status.includes(q) ||
      r.payFrequency.toLowerCase().includes(q),
    );
  }, [tabFiltered, search, tab]);

  const sorted = useMemo(
    () => tab === 'reports' ? searched : sortRuns(searched, sortKey, sortDir),
    [searched, sortKey, sortDir, tab],
  );

  const { rows: pageRows, pageCount, total } = useMemo(
    () => tab === 'reports' ? { rows: [], pageCount: 1, total: 0 } : paginate(sorted, page),
    [sorted, page, tab],
  );

  // Table columns
  const COLS: HrfinColumn<PayrollRun>[] = [
    {
      key:    'runNo',
      label:  'Run #',
      render: r => <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.runNo}</strong>,
    },
    {
      key:    'period',
      label:  'Period',
      render: r => <span style={{ fontSize: 13 }}>{monthLabel(r.periodMonth)}</span>,
    },
    {
      key:    'frequency',
      label:  'Frequency',
      render: r => <span style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>{humanize(r.payFrequency)}</span>,
    },
    {
      key:    'employees',
      label:  'Employees',
      render: r => <span style={{ fontSize: 13, textAlign: 'right', display: 'block' }}>{r.employeeCount}</span>,
    },
    {
      key:    'gross',
      label:  'Gross',
      render: r => <span style={{ fontSize: 13, fontFamily: 'tabular-nums', textAlign: 'right', display: 'block' }}>{fmtMoney(r.grossTotal)}</span>,
    },
    {
      key:    'net',
      label:  'Net',
      render: r => (
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'tabular-nums', textAlign: 'right', display: 'block',
                       color: 'var(--hrfin-accent)' }}>
          {fmtMoney(r.netTotal)}
        </span>
      ),
    },
    {
      key:    'status',
      label:  'Status',
      render: r => <HrfinPill tone={runStatusTone(r.status)}>{humanize(r.status)}</HrfinPill>,
    },
    {
      key:    'created',
      label:  'Created',
      render: r => <span style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)' }}>{fmtDate(r.createdAt)}</span>,
    },
  ];

  function toggleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(0);
  }

  const SORT_LABELS: Record<SortKey, string> = {
    period:    'Period',
    net:       'Net',
    gross:     'Gross',
    employees: 'Employees',
    created:   'Created',
  };

  // Quick actions (top strip)
  const quickActions = [
    ...(canManage ? [{
      key:     'new-run',
      label:   'New Run',
      icon:    'plus' as const,
      variant: 'primary' as const,
      onClick: () => setWizOpen(true),
    }] : []),
    {
      key:    'refresh',
      label:  'Refresh',
      icon:   'refresh' as const,
      onClick: () => { void runsQ.refetch(); },
    },
    ...(tab !== 'reports' ? [{
      key:    'export-csv',
      label:  'Export CSV',
      icon:   'download' as const,
      onClick: () => downloadCsv(sorted),
    }] : []),
    ...(countPending > 0 && canApprove ? [{
      key:   'pending',
      label: 'Pending Approval',
      icon:  'alert' as const,
      badge: countPending,
      onClick: () => { setTab('pending'); setPage(0); },
    }] : []),
  ];

  // Drawer actions (passed into PayRunDrawer)
  const drawerActions: PayRunDrawerActions = {
    onLockInputs:  run => void runAction(lockInputsMut.mutateAsync({ id: run.id }), 'Inputs locked.'),
    onCalculate:   run => void runAction(calcMut.mutateAsync({ id: run.id }),        'Run calculated.'),
    onSubmit:      run => void runAction(submitMut.mutateAsync({ id: run.id }),       'Submitted for approval.'),
    onApprove:     run => { void (async () => {
      const confirmed = await dialog.confirm({
        title: `Approve run ${run.runNo}?`,
        text: `Approving will transition the ${run.periodMonth.slice(0, 7)} pay run to 'Approved' status. It will then be ready to lock. SoD check: you must not be the preparer.`,
        confirmText: 'Approve',
        icon: 'question',
      });
      if (!confirmed) return;
      void runAction(approveRunMut.mutateAsync({ id: run.id }), 'Run approved.');
    })(); },
    onReject:      run => { void (async () => {
      const reason = await dialog.prompt({
        title: `Reject run ${run.runNo}`,
        text: 'Provide a reason for rejection. The workflow task is decided as rejected; the preparer is notified and the run is returned to them for revision.',
        placeholder: 'Reason for rejection…',
        confirmText: 'Reject',
      });
      if (reason == null) return;
      void runAction(
        rejectRunMut.mutateAsync({ id: run.id, reason: reason.trim() || 'Rejected by approver.' }),
        'Run rejected and returned for revision.',
      );
    })(); },
    onLockRun:     run => void runAction(lockRunMut.mutateAsync({ id: run.id }),      'Run locked.'),
    onExport:      run => void runAction(exportMut.mutateAsync({ id: run.id }),       'Export generated.'),
    onReopen:      run => void runAction(reopenMut.mutateAsync({ id: run.id }),       'Run reopened.'),
    onGenPayslips: run => void runAction(genMut.mutateAsync({ runId: run.id }),       'Payslips generated.'),
  };

  function openDrawer(run: PayrollRun): void {
    setDrawerRunId(run.id);
    setDrawerOpen(true);
  }

  function runRowActions(run: PayrollRun): RowActionItem[] {
    const items: RowActionItem[] = [
      { key: 'view', label: 'View details', icon: 'file', onClick: () => openDrawer(run) },
    ];
    if (canManage && run.status === 'draft') {
      items.push({ key: 'lock-inputs', label: 'Lock Inputs', icon: 'gavel', onClick: () => drawerActions.onLockInputs(run) });
    }
    if (canManage && ['input_locked', 'returned'].includes(run.status)) {
      items.push({ key: 'calculate', label: 'Calculate', icon: 'refresh', onClick: () => drawerActions.onCalculate(run) });
    }
    if (canManage && ['calculated', 'returned'].includes(run.status)) {
      items.push({ key: 'submit', label: 'Submit for Approval', icon: 'check', onClick: () => drawerActions.onSubmit(run) });
    }
    if (canApprove && run.status === 'pending_approval') {
      items.push({ key: 'approve', label: 'Approve', icon: 'check', onClick: () => drawerActions.onApprove(run) });
      items.push({ key: 'reject',  label: 'Reject',  icon: 'close', onClick: () => drawerActions.onReject(run), tone: 'danger' });
    }
    if (canManage && run.status === 'approved') {
      items.push({ key: 'lock-run', label: 'Lock Run', icon: 'gavel', onClick: () => drawerActions.onLockRun(run) });
    }
    if (canExport && run.status === 'locked') {
      items.push({ key: 'export', label: 'Export', icon: 'download', onClick: () => drawerActions.onExport(run) });
    }
    return items;
  }

  return (
    <div class="hrfin">
      {/* Page header */}
      <HrfinPageHeader
        icon="receipt"
        title="Payroll"
        sub="Pay runs, statutory calculation, SoD approval, payslips and export — consuming approved HR compensation inputs."
        chips={[
          ...(countPending > 0 ? [{ icon: 'alert' as const, label: `${countPending} pending`, tone: 'warning' as const }] : []),
          ...(countLocked > 0  ? [{ icon: 'check' as const, label: `${countLocked} locked`,  tone: 'success' as const }] : []),
        ]}
      />

      {/* Quick-action strip */}
      <QuickActionStrip actions={quickActions} />

      {/* KPI strip */}
      <section class="hrfin-kpi-strip">
        <KpiCard
          label="Total Pay Runs"
          value={String(runs.length)}
          support={`${countLocked} locked`}
          loading={runsQ.isLoading && !runsQ.data}
        />
        <KpiCard
          label="In Progress"
          value={String(countInProgress)}
          support="draft → submitted"
          tone={countInProgress > 0 ? 'danger' : undefined}
          loading={runsQ.isLoading && !runsQ.data}
        />
        <KpiCard
          label="Pending Approval"
          value={String(countPending)}
          support="submitted runs"
          tone={countPending > 0 ? 'danger' : undefined}
          loading={runsQ.isLoading && !runsQ.data}
        />
        <KpiCard
          label="Net Payroll (All)"
          value={fmtMoney(totalNet)}
          support="all runs"
          loading={runsQ.isLoading && !runsQ.data}
        />
        <KpiCard
          label="Gross Payroll"
          value={fmtMoney(totalGross)}
          support="before deductions"
          loading={runsQ.isLoading && !runsQ.data}
        />
        <KpiCard
          label="Employer NIS"
          value={fmtMoney(totalNisEmp)}
          support="statutory cost"
          loading={runsQ.isLoading && !runsQ.data}
        />
      </section>

      {/* Chart strip — TrendArea (net payroll over time) + HorizontalBars (status mix) */}
      {!runsQ.isLoading && runs.length > 0 && (
        <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
          {/* Net payroll trend — last 12 locked/approved runs sorted by period */}
          {(() => {
            const trendRuns = [...runs]
              .filter(r => ['locked', 'approved', 'exported'].includes(r.status))
              .sort((a, b) => a.periodMonth.localeCompare(b.periodMonth))
              .slice(-12);
            if (trendRuns.length < 2) return null;
            return (
              <div style={{ flex: '2 1 320px', background: 'var(--hrfin-surface-2)',
                            border: '1px solid var(--hrfin-border)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                              letterSpacing: '.06em', color: 'var(--hrfin-text-secondary)', marginBottom: 8 }}>
                  Net Payroll Trend
                </div>
                <TrendArea
                  labels={trendRuns.map(r => r.periodMonth.slice(0, 7))}
                  seriesA={trendRuns.map(r => r.netTotal)}
                  title="Net payroll"
                />
              </div>
            );
          })()}

          {/* Status mix — HorizontalBars */}
          {(() => {
            const total = runs.length;
            if (total === 0) return null;
            const barItems = [
              { label: 'Draft',           n: runs.filter(r => r.status === 'draft').length,                                         tone: 'accent'  as const },
              { label: 'Calculating',      n: runs.filter(r => ['input_locked','calculated','returned'].includes(r.status)).length,   tone: 'warning' as const },
              { label: 'Pending',          n: runs.filter(r => r.status === 'pending_approval').length,                               tone: 'danger'  as const },
              { label: 'Locked/Approved',  n: runs.filter(r => ['approved','locked','exported'].includes(r.status)).length,           tone: 'success' as const },
            ]
              .filter(g => g.n > 0)
              .map(g => ({
                label:   g.label,
                value:   String(g.n),
                percent: Math.round((g.n / total) * 100),
                tone:    g.tone,
              }));
            if (barItems.length < 2) return null;
            return (
              <div style={{ flex: '1 1 200px', background: 'var(--hrfin-surface-2)',
                            border: '1px solid var(--hrfin-border)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                              letterSpacing: '.06em', color: 'var(--hrfin-text-secondary)', marginBottom: 8 }}>
                  Run Status Mix
                </div>
                <HorizontalBars items={barItems} />
              </div>
            );
          })()}
        </section>
      )}

      {/* Error state (Gap 5) */}
      {runsQ.isError && (
        <div class="hrfin" style={{
          padding: '16px 20px',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 10,
          color: 'var(--danger)',
          fontSize: 13,
        }}>
          <strong>Failed to load payroll runs.</strong>{' '}
          {(runsQ.error)?.message ?? 'Unknown error.'}{' '}
          <button type="button" class="hrfin-action" style={{ marginLeft: 12 }} onClick={() => void runsQ.refetch()}>
            Retry
          </button>
        </div>
      )}

      {/* Table (or reports surface when tab === 'reports') */}
      {tab === 'reports' ? (
        <div class="hrfin-table-card">
          <div class="hrfin-tabs">
            {PAGE_TABS.map(t => (
              <button key={t.key} type="button" class={t.key === tab ? 'is-active' : ''} onClick={() => { setTab(t.key); setPage(0); }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ padding: '16px 20px' }}>
            <ReportsSurface runs={runs} />
          </div>
        </div>
      ) : (
        <HrfinTable<PayrollRun>
          tabs={PAGE_TABS}
          activeTab={tab}
          onTab={key => { setTab(key as PageTab); setPage(0); setSearch(''); }}
          searchValue={search}
          onSearch={v => { setSearch(v); setPage(0); }}
          searchPlaceholder="Search by run number, period or status…"
          filters={(['period', 'net', 'gross'] as SortKey[]).map(k => ({
            label: `${SORT_LABELS[k]} ${sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}`,
            onClick: () => toggleSort(k),
          }))}
          columns={COLS}
          rows={pageRows}
          rowKey={r => r.id}
          onRowClick={openDrawer}
          rowActions={runRowActions}
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          noun="pay runs"
          loading={runsQ.isLoading && !runsQ.data}
          emptyMessage={
            search ? 'No pay runs match your search.' :
            tab !== 'all' ? `No ${humanize(tab)} pay runs.` :
            'No pay runs yet. Click New Run to create the first payroll run.'
          }
        />
      )}

      {/* New Run wizard */}
      {wizOpen && (
        <PayNewRunWizard
          onClose={() => setWizOpen(false)}
          onCreated={run => {
            setWizOpen(false);
            // Open the newly-created run's drawer immediately
            setDrawerRunId(run.id);
            setDrawerOpen(true);
            // Ensure the table shows "all" tab so the new run is visible
            setTab('all');
          }}
        />
      )}

      {/* Run drawer */}
      <PayRunDrawer
        runId={drawerRunId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        canManage={canManage}
        canApprove={canApprove}
        actions={drawerActions}
      />
    </div>
  );
}
