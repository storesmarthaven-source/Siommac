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
import {
  HrfinPageHeader,
  QuickActionStrip,
  KpiCard,
  HrfinTable,
  HrfinPill,
  type HrfinColumn,
  type HrfinTone,
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
    case 'calculating': return runs.filter(r => ['input_locked', 'calculated'].includes(r.status));
    case 'pending':     return runs.filter(r => r.status === 'pending_approval');
    case 'approved':    return runs.filter(r => r.status === 'approved');
    case 'locked':      return runs.filter(r => r.status === 'locked');
    default:            return runs;
  }
}

// ── Reports surface ───────────────────────────────────────────────────────────

const REPORTS: { key: string; label: string }[] = [
  { key: 'register',             label: 'Payroll Register' },
  { key: 'payslip_register',     label: 'Payslip Register' },
  { key: 'net_pay_summary',      label: 'Net-Pay Summary' },
  { key: 'employer_nis_summary', label: 'Employer-NIS Summary' },
];

function ReportsSurface({ runs }: { runs: PayrollRun[] }): VNode {
  const [report, setReport] = useState(REPORTS[0]!.key);
  const [runId, setRunId]   = useState<string>(() => runs[0]?.id ?? '');
  const [rows, setRows]     = useState<Array<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const canView = can('finance.payroll.reports.view');

  if (!canView) {
    return (
      <div class="hrfin" style={{ padding: 24 }}>
        <div class="hrfin-empty">You do not have permission to view payroll reports.</div>
      </div>
    );
  }

  async function runReport(): Promise<void> {
    setLoading(true); setRows(null);
    try {
      const res = await financePayrollApi.runReport({ report, runId: runId || undefined });
      setRows(res.rows);
    } catch (e) {
      toast((e as Error).message ?? 'Failed to run report.');
    } finally {
      setLoading(false);
    }
  }

  const cols = rows && rows.length > 0 ? Object.keys(rows[0]!) : [];

  return (
    <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Report</span>
          <select
            value={report}
            onChange={e => setReport((e.currentTarget as HTMLSelectElement).value)}
            style={{ fontSize: 13, padding: '8px 10px', background: 'var(--hrfin-surface-2)',
                     border: '1px solid var(--hrfin-border)', borderRadius: 6,
                     color: 'var(--hrfin-text-primary)' }}
          >
            {REPORTS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Pay run</span>
          <select
            value={runId}
            onChange={e => setRunId((e.currentTarget as HTMLSelectElement).value)}
            style={{ fontSize: 13, padding: '8px 10px', background: 'var(--hrfin-surface-2)',
                     border: '1px solid var(--hrfin-border)', borderRadius: 6,
                     color: 'var(--hrfin-text-primary)' }}
          >
            <option value="">— select —</option>
            {runs.map(r => <option key={r.id} value={r.id}>{r.runNo} · {monthLabel(r.periodMonth)}</option>)}
          </select>
        </label>

        <button
          type="button"
          class="hrfin-action is-primary"
          disabled={loading}
          onClick={() => void runReport()}
          style={{ marginBottom: 0, alignSelf: 'flex-end' }}
        >
          {loading ? 'Running…' : 'Run report'}
        </button>
      </div>

      {/* Results */}
      {loading ? (
        <div class="hrfin-empty">Running report…</div>
      ) : rows === null ? (
        <div class="hrfin-empty">Select a report and pay run, then click Run report.</div>
      ) : rows.length === 0 ? (
        <div class="hrfin-empty">No rows returned for the selected parameters.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--hrfin-border)', textAlign: 'left' }}>
                {cols.map(c => (
                  <th key={c} style={{ padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {humanize(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
                  {cols.map(c => (
                    <td key={c} style={{ padding: '6px 8px', color: 'var(--hrfin-text-secondary)' }}>
                      {row[c] == null ? '—' : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', margin: '8px 0 0' }}>
            {rows.length} row(s)
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PayrollOverview(): VNode {
  const [tab,      setTab]      = useState<PageTab>('all');
  const [search,   setSearch]   = useState('');
  const [page,     setPage]     = useState(0);
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [wizOpen,     setWizOpen]     = useState(false);

  // Permissions
  const canManage = can('finance.payroll.run.manage');
  const canLock   = can('finance.payroll.lock');
  const canApprove = can('finance.payroll.approve') || can('finance.payroll.lock');
  const canExport = can('finance.payroll.export');
  const canView   = can('finance.payroll.view_all') || canManage;

  // Data
  const runsQ = usePayrollRuns({ limit: 500 });
  const runs  = runsQ.data ?? [];

  // Mutations (used by drawer actions)
  const lockInputsMut = usePayrollMutation(financePayrollApi.lockInputs);
  const calcMut       = usePayrollMutation(financePayrollApi.calculate);
  const submitMut     = usePayrollMutation(financePayrollApi.submitRun);
  const approveMut    = usePayrollMutation(financePayrollApi.lockRun);   // lock = post-approve
  const lockRunMut    = usePayrollMutation(financePayrollApi.lockRun);
  const reopenMut     = usePayrollMutation(financePayrollApi.reopenRun);
  const exportMut     = usePayrollMutation(financePayrollApi.exportRun);
  const genMut        = usePayrollMutation(financePayrollApi.generatePayslips);

  async function runAction(p: Promise<unknown>, ok: string): Promise<void> {
    try { await p; toast(ok); }
    catch (e) { toast((e as Error).message ?? 'Action failed.'); }
  }

  // KPIs
  const totalNet        = runs.reduce((s, r) => s + (r.netTotal || 0), 0);
  const totalGross      = runs.reduce((s, r) => s + (r.grossTotal || 0), 0);
  const totalNisEmp     = runs.reduce((s, r) => s + (r.nisEmployerTotal || 0), 0);
  const countLocked     = runs.filter(r => r.status === 'locked').length;
  const countInProgress = runs.filter(r => ['draft', 'input_locked', 'calculated', 'pending_approval'].includes(r.status)).length;
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

  const { rows: pageRows, pageCount, total } = useMemo(
    () => tab === 'reports' ? { rows: [], pageCount: 1, total: 0 } : paginate(searched, page),
    [searched, page, tab],
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
    onApprove:     run => void runAction(approveMut.mutateAsync({ id: run.id }),      'Run approved.'),
    onReject:      run => {
      // Reject = reopen with reason "rejected"
      void runAction(reopenMut.mutateAsync({ id: run.id, reason: 'Rejected by approver.' }), 'Run rejected and returned to draft.');
    },
    onLockRun:     run => void runAction(lockRunMut.mutateAsync({ id: run.id }),      'Run locked.'),
    onExport:      run => void runAction(exportMut.mutateAsync({ id: run.id }),       'Export generated.'),
    onReopen:      run => void runAction(reopenMut.mutateAsync({ id: run.id }),       'Run reopened.'),
    onGenPayslips: run => void runAction(genMut.mutateAsync({ runId: run.id }),       'Payslips generated.'),
  };

  function openDrawer(run: PayrollRun): void {
    setDrawerRunId(run.id);
    setDrawerOpen(true);
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
          columns={COLS}
          rows={pageRows}
          rowKey={r => r.id}
          onRowClick={openDrawer}
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
