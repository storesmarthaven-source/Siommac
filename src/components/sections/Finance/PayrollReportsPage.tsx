// Payroll Reports Center (F-12, Phase A) — full-page report workspace.
// Statutory-look surface, scoped `.prc-*`. Backed by the F-12 routes
// (reports/catalog, reports/summary, reports/run preview, reports/history/list).
// Slice 2 ships PREVIEW only; file exports (worker + download) arrive in Slice 3.

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { financePayrollApi } from '@api/finance/payroll';
import { useRunsRegister } from '@api/finance/payrollRunsRegister';
import { dialog } from '@lib/dialog';
import type {
  MoneyValue, PayrollReportKey, ReportParams, ReportFormat, ReportCatalogEntry, ReportRunResult,
  RegisterRow, NetPaySummaryRow, CostRow, VarianceRow, OvertimeRow, ReportArtifactRow,
  PopulationMovementRow, NisExceptionRow, ReconciliationResult, ReportChart,
} from '../../../../types/payrollReports';
import './payrollReports.css';

type Completed = Extract<ReportRunResult, { state: 'completed' }>;
const ELIGIBLE = new Set(['locked', 'released', 'exported']);

const money = (m: MoneyValue): string =>
  `$${m.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number): string => n.toLocaleString('en-US');
const fmtDate = (d: string): string =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
/** Current YYYY-MM in AST (UTC-4, no DST) — the payroll operating timezone. */
const thisMonth = (): string => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 7);

/**
 * A fresh idempotency key is minted per intentional Export action (a UUID) and
 * reused only for in-flight retries of THAT action. Re-exporting after the source
 * data changed (e.g. another run locked into a period) must produce a NEW artifact,
 * so we never derive the key from the parameters. 36 chars → within 8..128.
 */
const newExportKey = (): string => crypto.randomUUID();

/** Navigate to a fresh signed URL without leaving the page (never cached). */
function triggerDownload(url: string): void {
  const el = document.createElement('a');
  el.href = url; el.rel = 'noopener'; el.target = '_blank';
  document.body.appendChild(el); el.click(); el.remove();
}

function buildParams(
  key: PayrollReportKey,
  s: { runId: string; compareRunId: string; from: string; to: string; scope: 'run' | 'all' },
): ReportParams | null {
  switch (key) {
    case 'payroll_register':            return s.runId ? { report: key, runId: s.runId } : null;
    case 'net_pay_summary':             return s.runId ? { report: key, runId: s.runId } : null;
    case 'gross_to_net_reconciliation': return s.runId ? { report: key, runId: s.runId } : null;
    case 'variance_analysis':           return s.runId ? { report: key, runId: s.runId, ...(s.compareRunId ? { compareRunId: s.compareRunId } : {}) } : null;
    case 'nis_exceptions':              return s.scope === 'all' ? { report: key, scope: 'all' } : (s.runId ? { report: key, scope: 'run', runId: s.runId } : null);
    case 'payroll_cost_analysis':       return s.from && s.to ? { report: key, period: { from: s.from, to: s.to } } : null;
    case 'overtime_allowance_analysis': return s.from && s.to ? { report: key, period: { from: s.from, to: s.to } } : null;
    case 'population_movements':        return s.from && s.to ? { report: key, period: { from: s.from, to: s.to } } : null;
    default:                            return null; // export_audit_package: file-only, no preview
  }
}

export function PayrollReportsPage(): VNode {
  const [selected, setSelected] = useState<PayrollReportKey | null>(null);
  const [runId, setRunId] = useState('');
  const [compareRunId, setCompareRunId] = useState('');
  const [from, setFrom] = useState(thisMonth());
  const [to, setTo] = useState(thisMonth());
  const [scope, setScope] = useState<'run' | 'all'>('run');
  const [exportFmt, setExportFmt] = useState<ReportFormat | ''>('');
  const [jobId, setJobId] = useState<string | null>(null);
  // Keyset "Load more" for history — appended pages beyond the first.
  const [morePages, setMorePages] = useState<ReportArtifactRow[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const qc = useQueryClient();
  const summaryQ = useQuery({ queryKey: ['payroll', 'reports', 'summary'], queryFn: () => financePayrollApi.reportsSummary() });
  const catalogQ = useQuery({ queryKey: ['payroll', 'reports', 'catalog'], queryFn: () => financePayrollApi.reportsCatalog() });
  const historyQ = useQuery({ queryKey: ['payroll', 'reports', 'history'], queryFn: () => financePayrollApi.reportsHistory({ limit: 25 }) });
  const runsQ = useRunsRegister({ tab: 'all', limit: 200 });

  const historyRows = [...(historyQ.data?.rows ?? []), ...morePages];
  const historyNextCursor = moreCursor !== undefined ? moreCursor : (historyQ.data?.nextCursor ?? null);
  async function loadMoreHistory(): Promise<void> {
    if (!historyNextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await financePayrollApi.reportsHistory({ cursor: historyNextCursor, limit: 25 });
      setMorePages(p => [...p, ...page.rows]);
      setMoreCursor(page.nextCursor);
    } catch (e) {
      dialog.error('Couldn’t load more history', (e as Error)?.message ?? 'Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }

  const catalog = catalogQ.data?.reports ?? [];
  const entry = useMemo(() => catalog.find(c => c.key === selected) ?? null, [catalog, selected]);
  const eligibleRuns = (runsQ.data?.items ?? []).filter(r => ELIGIBLE.has(r.state));
  const fileFormats = (entry?.supportedFormats ?? []).filter((f): f is ReportFormat => f !== 'preview');
  const canPreview = (entry?.supportedFormats ?? []).includes('preview');

  const runMut = useMutation({
    mutationFn: (params: ReportParams) => financePayrollApi.runReport({ params, format: 'preview' }),
  });
  const result = runMut.data && runMut.data.state === 'completed' ? (runMut.data as Completed) : null;

  // File export → enqueue a durable job, then poll status until it settles. The
  // idempotency key is minted per Export click (see runExport) so a later export
  // of changed source data is a NEW artifact, while an in-flight retry dedupes.
  const exportMut = useMutation({
    mutationFn: (a: { params: ReportParams; format: ReportFormat; idempotencyKey: string }) =>
      financePayrollApi.runReport({ params: a.params, format: a.format, idempotencyKey: a.idempotencyKey }),
    onSuccess: r => { if (r.state === 'queued') setJobId(r.jobId); },
  });
  const statusQ = useQuery({
    queryKey: ['payroll', 'reports', 'status', jobId],
    queryFn: () => financePayrollApi.reportStatus({ jobId: jobId as string }),
    enabled: !!jobId,
    refetchInterval: q => {
      const s = q.state.data;
      return s && (s.state === 'succeeded' || s.state === 'failed') ? false : 1500;
    },
  });
  // A finished export lands a new artifact — refresh history + KPI once, and reset
  // the "Load more" pages so the fresh first page is authoritative.
  useEffect(() => {
    if (statusQ.data?.state === 'succeeded') {
      setMorePages([]); setMoreCursor(undefined);
      qc.invalidateQueries({ queryKey: ['payroll', 'reports', 'history'] });
      qc.invalidateQueries({ queryKey: ['payroll', 'reports', 'summary'] });
    }
  }, [statusQ.data?.state, qc]);

  const downloadMut = useMutation({
    mutationFn: (artifactId: string) => financePayrollApi.reportDownload({ artifactId }),
    onSuccess: ({ url }) => triggerDownload(url),
    onError: e => dialog.error('Download unavailable', (e as Error)?.message ?? 'The file could not be downloaded.'),
  });

  const params = useMemo(
    () => (selected ? buildParams(selected, { runId, compareRunId, from, to, scope }) : null),
    [selected, runId, compareRunId, from, to, scope],
  );

  function pick(key: PayrollReportKey): void {
    setSelected(key);
    runMut.reset();
    exportMut.reset();
    setJobId(null);
    const next = (catalog.find(c => c.key === key)?.supportedFormats ?? []).filter(f => f !== 'preview');
    setExportFmt(next.length ? (next[0] as ReportFormat) : '');
  }
  function run(): void {
    if (params) runMut.mutate(params);
  }
  function runExport(): void {
    if (params && exportFmt) { setJobId(null); exportMut.mutate({ params, format: exportFmt, idempotencyKey: newExportKey() }); }
  }
  const status = statusQ.data;
  const succeededArtifactId = status?.state === 'succeeded' ? status.artifact.id : null;

  const tiles = summaryQ.data;
  const tile = (label: string, t?: { value: number | null; available: boolean }): VNode => (
    <div class={`prc-kpi${t?.available ? '' : ' is-na'}`}>
      <div class="prc-kpi-v">{t?.available && t.value != null ? num(t.value) : '—'}</div>
      <div class="prc-kpi-l">{label}</div>
    </div>
  );

  return (
    <div class="prc">
      <header class="prc-lead">
        <div>
          <div class="prc-crumbs"><span>Payroll</span><span class="sep">›</span><b>Reports</b></div>
          <h1>Payroll Reports</h1>
          <p>Preview and export tamper-evident reports from locked, authorized payroll runs. Currency TTD.</p>
        </div>
      </header>

      {(summaryQ.isError || catalogQ.isError) && (
        <div class="prc-banner-err">
          Some report data couldn’t be loaded{summaryQ.isError && catalogQ.isError ? '' : summaryQ.isError ? ' (KPIs)' : ' (catalog)'} — {((summaryQ.error ?? catalogQ.error) as Error)?.message ?? 'please retry.'}
        </div>
      )}

      {/* KPI board */}
      <div class="prc-kpis">
        {tile('Available reports', tiles?.availableReports)}
        {tile('Generated this month', tiles?.generatedThisMonth)}
        {tile('NIS exceptions', tiles?.nisExceptions)}
        {tile('Material variances', tiles?.materialVariances)}
        {tile('Audit packages', tiles?.auditPackages)}
      </div>

      <div class="prc-body">
        {/* Catalog */}
        <aside class="prc-catalog">
          <div class="prc-catalog-h">Report catalog</div>
          {catalogQ.isLoading && <div class="prc-empty">Loading…</div>}
          {catalogQ.isError && <div class="prc-empty prc-err">Couldn’t load the report catalog.</div>}
          {catalog.map(c => (
            <button
              key={c.key}
              type="button"
              class={`prc-cat-item${selected === c.key ? ' is-active' : ''}${c.supportedFormats.length === 0 ? ' is-disabled' : ''}`}
              disabled={c.supportedFormats.length === 0}
              onClick={() => pick(c.key)}
            >
              <span class="prc-cat-label">{c.label}</span>
              <span class="prc-cat-cat">{c.category}</span>
              {c.supportedFormats.length === 0 && <span class="prc-cat-soon">soon</span>}
            </button>
          ))}
        </aside>

        {/* Params + preview */}
        <section class="prc-main">
          {!entry && <div class="prc-empty prc-pad">Select a report from the catalog to configure and preview it.</div>}
          {entry && (
            <>
              <div class="prc-params">
                <div class="prc-params-h">{entry.label}</div>
                <p class="prc-params-sub">{entry.description}</p>
                <ParamFields
                  entry={entry}
                  eligibleRuns={eligibleRuns}
                  state={{ runId, compareRunId, from, to, scope }}
                  set={{ setRunId, setCompareRunId, setFrom, setTo, setScope }}
                />
                <div class="prc-run-row">
                  {canPreview && (
                    <button type="button" class="prc-run" disabled={!params || runMut.isPending} onClick={run}>
                      {runMut.isPending ? 'Running…' : 'Run preview'}
                    </button>
                  )}
                  {fileFormats.length > 0 && (
                    <>
                      <label class="prc-fmt">
                        <span>Format</span>
                        <select value={exportFmt} onChange={e => setExportFmt((e.target as HTMLSelectElement).value as ReportFormat)}>
                          {fileFormats.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                        </select>
                      </label>
                      <button
                        type="button"
                        class="prc-run prc-run-ghost"
                        disabled={!params || !exportFmt || exportMut.isPending || (!!jobId && !statusQ.isError && status?.state !== 'succeeded' && status?.state !== 'failed')}
                        onClick={runExport}
                      >
                        {exportMut.isPending ? 'Queuing…' : 'Export file'}
                      </button>
                    </>
                  )}
                  {runMut.isError && <span class="prc-err">{(runMut.error as Error)?.message ?? 'Preview failed.'}</span>}
                  {exportMut.isError && <span class="prc-err">{(exportMut.error as Error)?.message ?? 'Export failed.'}</span>}
                </div>

                {jobId && (status || statusQ.isError) && (
                  <div class="prc-export-status">
                    {statusQ.isError && (
                      <span class="prc-err">Couldn’t check the export status — {(statusQ.error as Error)?.message ?? 'try exporting again.'}</span>
                    )}
                    {status && (status.state === 'queued' || status.state === 'running') && (
                      <span class="prc-export-wait">Generating {exportFmt.toUpperCase()} export… <span class="prc-pill prc-pill-purging">{status.state}</span></span>
                    )}
                    {status && status.state === 'failed' && (
                      <span class="prc-err">Export failed: {status.error.message}</span>
                    )}
                    {status && status.state === 'succeeded' && succeededArtifactId && (
                      <span class="prc-export-done">
                        <span class="prc-pill prc-pill-ready">ready</span>
                        <button type="button" class="prc-dl" disabled={downloadMut.isPending} onClick={() => downloadMut.mutate(succeededArtifactId)}>
                          {downloadMut.isPending ? 'Preparing…' : `Download ${status.artifact.format.toUpperCase()}`}
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {result && (
                <div class="prc-preview">
                  <div class="prc-preview-h">
                    Preview <span class="prc-scope">scope {result.scopeId}</span>
                  </div>
                  <ReportResult data={result} />
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* History */}
      <div class="prc-history">
        <div class="prc-history-h">Generated report history</div>
        {historyQ.isError
          ? <div class="prc-empty prc-pad prc-err">Couldn’t load report history — {(historyQ.error as Error)?.message ?? 'please retry.'}</div>
          : historyQ.isLoading
            ? <div class="prc-empty prc-pad">Loading…</div>
            : historyRows.length === 0
              ? <div class="prc-empty prc-pad">No generated report files yet. Run an export above to generate one.</div>
              : (
                <>
                  <table class="prc-table">
                    <thead><tr><th>Report</th><th>Format</th><th class="num">Rows</th><th class="num">Size</th><th>Created</th><th>Status</th><th class="prc-actions-h">Actions</th></tr></thead>
                    <tbody>
                      {historyRows.map(a => (
                        <tr key={a.id}>
                          <td>{a.reportKey}</td><td>{a.format.toUpperCase()}</td>
                          <td class="num">{num(a.rowCount)}</td><td class="num">{(a.byteSize / 1024).toFixed(1)} KB</td>
                          <td>{new Date(a.createdAt).toLocaleString('en-GB')}</td>
                          <td><span class={`prc-pill prc-pill-${a.status}`}>{a.status}</span></td>
                          <td class="prc-actions">
                            {a.status === 'ready'
                              ? <button type="button" class="prc-dl" disabled={downloadMut.isPending} onClick={() => downloadMut.mutate(a.id)}>Download</button>
                              : <span class="prc-muted">{a.status === 'purged' ? 'expired' : '—'}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {historyNextCursor && (
                    <div class="prc-more">
                      <button type="button" class="prc-run-ghost prc-dl" disabled={loadingMore} onClick={loadMoreHistory}>
                        {loadingMore ? 'Loading…' : 'Load more'}
                      </button>
                    </div>
                  )}
                </>
              )}
      </div>
    </div>
  );
}

// ── param fields per report kind ─────────────────────────────────────────────
function ParamFields(props: {
  entry: ReportCatalogEntry;
  eligibleRuns: { id: string; reference: string; period: { startsOn: string } }[];
  state: { runId: string; compareRunId: string; from: string; to: string; scope: 'run' | 'all' };
  set: {
    setRunId: (v: string) => void; setCompareRunId: (v: string) => void;
    setFrom: (v: string) => void; setTo: (v: string) => void; setScope: (v: 'run' | 'all') => void;
  };
}): VNode {
  const { entry, eligibleRuns, state, set } = props;
  const runPicker = (value: string, onChange: (v: string) => void, label: string, allowNone = false): VNode => (
    <label class="prc-field">
      <span>{label}</span>
      <select value={value} onChange={e => onChange((e.target as HTMLSelectElement).value)}>
        <option value="">{allowNone ? 'Prior released run (auto)' : 'Select a run…'}</option>
        {eligibleRuns.map(r => <option key={r.id} value={r.id}>{r.reference} · {fmtDate(r.period.startsOn)}</option>)}
      </select>
    </label>
  );
  const monthField = (value: string, onChange: (v: string) => void, label: string): VNode => (
    <label class="prc-field"><span>{label}</span>
      <input type="month" value={value} onInput={e => onChange((e.target as HTMLInputElement).value)} />
    </label>
  );

  if (entry.paramKind === 'period') {
    return <div class="prc-fields">{monthField(state.from, set.setFrom, 'From')}{monthField(state.to, set.setTo, 'To')}</div>;
  }
  if (entry.paramKind === 'two_run') {
    return <div class="prc-fields">{runPicker(state.runId, set.setRunId, 'Run')}{runPicker(state.compareRunId, set.setCompareRunId, 'Compare against', true)}</div>;
  }
  if (entry.paramKind === 'nis_scope') {
    return (
      <div class="prc-fields">
        <label class="prc-field"><span>Scope</span>
          <select value={state.scope} onChange={e => set.setScope((e.target as HTMLSelectElement).value as 'run' | 'all')}>
            <option value="run">A single run</option>
            <option value="all">All employees</option>
          </select>
        </label>
        {state.scope === 'run' && runPicker(state.runId, set.setRunId, 'Run')}
      </div>
    );
  }
  // single_run
  return <div class="prc-fields">{runPicker(state.runId, set.setRunId, 'Run')}</div>;
}

// ── result renderer per report ───────────────────────────────────────────────
function ReportResult({ data }: { data: Completed }): VNode {
  switch (data.report) {
    case 'payroll_register':            return <RegisterTable rows={data.rows} totals={data.totals} />;
    case 'net_pay_summary':             return <NetPayTable rows={data.rows} totals={data.totals} />;
    case 'payroll_cost_analysis':       return <><CostTable rows={data.rows} /><ChartStrip chart={data.chart} /></>;
    case 'gross_to_net_reconciliation': return <Reconciliation r={data.reconciliation} />;
    case 'variance_analysis':           return <><VarianceTable rows={data.rows} /><ChartStrip chart={data.chart} /></>;
    case 'overtime_allowance_analysis': return <><OvertimeTable rows={data.rows} /><ChartStrip chart={data.chart} /></>;
    case 'population_movements':        return <MovementsTable rows={data.rows} />;
    case 'nis_exceptions':              return <NisTable rows={data.rows} />;
    default:                            return <div class="prc-empty">No preview.</div>;
  }
}

const Totals = ({ t }: { t: { employees: number; gross: MoneyValue; deductions: MoneyValue; net: MoneyValue } }): VNode => (
  <div class="prc-totals">
    <span>{num(t.employees)} employees</span><span>Gross {money(t.gross)}</span>
    <span>Deductions {money(t.deductions)}</span><span class="strong">Net {money(t.net)}</span>
  </div>
);
const Empty = (): VNode => <div class="prc-empty prc-pad">No rows for this selection.</div>;

function RegisterTable({ rows, totals }: { rows: RegisterRow[]; totals: { employees: number; gross: MoneyValue; deductions: MoneyValue; net: MoneyValue } }): VNode {
  if (!rows.length) return <Empty />;
  return (<><Totals t={totals} /><div class="prc-tw"><table class="prc-table"><thead><tr><th>Employee</th><th>Pay group</th><th class="num">Gross</th><th class="num">PAYE</th><th class="num">NIS</th><th class="num">Other</th><th class="num">Net</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.employeeId}><td>{r.employeeName}</td><td>{r.payGroup}</td><td class="num">{money(r.gross)}</td><td class="num">{money(r.paye)}</td><td class="num">{money(r.nis)}</td><td class="num">{money(r.other)}</td><td class="num strong">{money(r.net)}</td></tr>)}</tbody></table></div></>);
}
function NetPayTable({ rows, totals }: { rows: NetPaySummaryRow[]; totals: { employees: number; gross: MoneyValue; deductions: MoneyValue; net: MoneyValue } }): VNode {
  if (!rows.length) return <Empty />;
  return (<><Totals t={totals} /><div class="prc-tw"><table class="prc-table"><thead><tr><th>Group</th><th class="num">Employees</th><th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net</th><th>Readiness</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.group}</td><td class="num">{num(r.employees)}</td><td class="num">{money(r.gross)}</td><td class="num">{money(r.deductions)}</td><td class="num strong">{money(r.net)}</td><td><span class={`prc-pill prc-pill-${r.readiness}`}>{r.readiness}</span></td></tr>)}</tbody></table></div></>);
}
function CostTable({ rows }: { rows: CostRow[] }): VNode {
  if (!rows.length) return <Empty />;
  return (<div class="prc-tw"><table class="prc-table"><thead><tr><th>Department</th><th>Cost centre</th><th class="num">Employees</th><th class="num">Gross</th><th class="num">Employer cost</th><th class="num">vs prior</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.department}</td><td>{r.costCentre}</td><td class="num">{num(r.employees)}</td><td class="num">{money(r.gross)}</td><td class="num">{money(r.employerCost)}</td><td class={`num ${r.vsPriorPct >= 0 ? 'up' : 'down'}`}>{r.vsPriorPct >= 0 ? '+' : ''}{r.vsPriorPct}%</td></tr>)}</tbody></table></div>);
}
function VarianceTable({ rows }: { rows: VarianceRow[] }): VNode {
  if (!rows.length) return <Empty />;
  return (<div class="prc-tw"><table class="prc-table"><thead><tr><th>Measure</th><th class="num">Prior</th><th class="num">Current</th><th class="num">Change</th><th>Driver</th></tr></thead>
    <tbody>{rows.map((r, i) => {
      const prior = r.value.unit === 'money' ? money(r.value.prior) : num(r.value.prior);
      const cur = r.value.unit === 'money' ? money(r.value.current) : num(r.value.current);
      return <tr key={i}><td>{r.measure}</td><td class="num">{prior}</td><td class="num">{cur}</td><td class={`num ${r.changePct >= 0 ? 'up' : 'down'}`}>{r.changePct >= 0 ? '+' : ''}{r.changePct}%</td><td>{r.driver}</td></tr>;
    })}</tbody></table></div>);
}
function OvertimeTable({ rows }: { rows: OvertimeRow[] }): VNode {
  if (!rows.length) return <Empty />;
  return (<div class="prc-tw"><table class="prc-table"><thead><tr><th>Department</th><th class="num">Employees</th><th class="num">OT hours</th><th class="num">OT cost</th><th class="num">Allowance cost</th><th>Control</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.department}</td><td class="num">{num(r.employees)}</td><td class="num">{num(r.overtimeHours)}</td><td class="num">{money(r.overtimeCost)}</td><td class="num">{money(r.allowanceCost)}</td><td><span class={`prc-pill prc-pill-${r.controlStatus}`}>{r.controlStatus}</span></td></tr>)}</tbody></table></div>);
}
function MovementsTable({ rows }: { rows: PopulationMovementRow[] }): VNode {
  if (!rows.length) return <Empty />;
  return (<div class="prc-tw"><table class="prc-table"><thead><tr><th>Employee</th><th>Movement</th><th>Effective</th><th>From</th><th>To</th><th>Impact</th><th>Evidence</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.employeeName}</td><td><span class={`prc-pill prc-pill-${r.movement}`}>{r.movement.replace('_', ' ')}</span></td><td>{fmtDate(r.effectiveDate)}</td><td>{r.priorAssignment}</td><td>{r.currentAssignment}</td><td>{r.payrollImpact}</td><td>{r.evidence}</td></tr>)}</tbody></table></div>);
}
function NisTable({ rows }: { rows: NisExceptionRow[] }): VNode {
  if (!rows.length) return <Empty />;
  return (<div class="prc-tw"><table class="prc-table"><thead><tr><th>Employee</th><th>NIS number</th><th>Class</th><th>Profile</th><th>Impact</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.employeeName}</td><td>{r.nisNumber ?? '—'}</td><td>{r.nisClass}</td><td><span class={`prc-pill prc-pill-${r.profileStatus}`}>{r.profileStatus.replace('_', ' ')}</span></td><td>{r.payrollImpact}</td></tr>)}</tbody></table></div>);
}
function Reconciliation({ r }: { r: ReconciliationResult }): VNode {
  return (
    <div class="prc-recon">
      <div class={`prc-recon-badge ${r.balanced ? 'ok' : 'bad'}`}>{r.balanced ? 'Balanced — every source matches exactly' : 'Not balanced — a source differs'}</div>
      <div class="prc-tw"><table class="prc-table"><thead><tr><th>Source</th><th class="num">Register total</th><th class="num">Summary total</th><th class="num">Difference</th><th>Match</th></tr></thead>
        <tbody>{r.sources.map((s, i) => <tr key={i}><td>{s.source}</td><td class="num">{money(s.registerTotal)}</td><td class="num">{money(s.summaryTotal)}</td><td class={`num ${s.matched ? '' : 'down'}`}>{money(s.difference)}</td><td>{s.matched ? '✓' : '✗'}</td></tr>)}</tbody></table></div>
    </div>
  );
}
function ChartStrip({ chart }: { chart: ReportChart }): VNode {
  // Render EVERY series (variance = Prior + Current, overtime = Hours + Cost) —
  // never just the first, or measures silently vanish from the chart.
  const drawn = chart.series.filter(s => s.points.length);
  if (!drawn.length) return <></>;
  return (
    <>
      {drawn.map((series, si) => {
        const max = Math.max(...series.points.map(p => Math.abs(p.y)), 1);
        return (
          <div key={si} class="prc-chart">
            <div class="prc-chart-h">{series.label} <span class="prc-unit">({series.unit})</span></div>
            {series.points.map((p, i) => (
              <div key={i} class="prc-bar-row"><span class="prc-bar-l">{p.x}</span><span class="prc-bar-t"><span class="prc-bar" style={`width:${Math.round((Math.abs(p.y) / max) * 100)}%`} /></span><span class="prc-bar-v">{series.unit === 'TTD' ? `$${num(Math.round(p.y))}` : num(p.y)}</span></div>
            ))}
          </div>
        );
      })}
    </>
  );
}
