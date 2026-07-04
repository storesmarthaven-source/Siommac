/**
 * src/components/sections/Finance/PayrollOverview.tsx
 *
 * Finance ▸ Payroll (nav id `s-finance-payroll`).
 * Master–detail over the real `finance/payroll/*` backend:
 *   • Runs list + New Run + status-aware lifecycle actions
 *     (lock-inputs → calculate → submit → [workflow approve] → lock → export)
 *   • Run detail: Run Lines · Warnings · Payslips · Exports
 *   • Reports surface (register, net-pay summary, employer-NIS summary, …)
 * Approval (pending_approval → approved) is driven by the central workflow, so the UI
 * shows an "awaiting approval" state rather than a direct approve button.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import {
  usePayrollRuns, usePayrollRun, useRunLines, useRunWarnings, useRunPayslips, useRunExports,
  usePayrollMutation, financePayrollApi, type PayrollRun,
} from '@api/finance/payroll';
import { fmtMoney, fmtDate, humanize, statusTone } from './financeShared';
import { openActionModal, lockAction, reopenAction, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import './finance.css';

type Top = 'runs' | 'reports';
type Detail = 'lines' | 'warnings' | 'payslips' | 'exports';

const monthLabel = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

export function PayrollOverview(): VNode {
  const [top, setTop] = useState<Top>('runs');
  const [runId, setRunId] = useState<string | null>(null);

  const runsQ = usePayrollRuns({ limit: 100 });
  const runs = runsQ.data ?? [];

  const totalNet = runs.reduce((s, r) => s + (r.netTotal || 0), 0);
  const STAT_ROW = [
    { label: 'Pay runs',        val: runs.length },
    { label: 'Locked / paid',   val: runs.filter(r => r.status === 'locked' || r.status === 'exported').length },
    { label: 'In progress',     val: runs.filter(r => ['draft', 'input_locked', 'calculated', 'pending_approval', 'approved'].includes(r.status)).length },
    { label: 'Net (all runs)',  val: fmtMoney(totalNet) },
  ];

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader
        icon="fa-money-check-dollar" module="Finance · Payroll" title="Payroll"
        sub="Pay runs, statutory calculation, approval, payslips and export — consuming approved HR compensation inputs."
      />

      <div class="obx-repstats" style={{ margin: '4px 0 12px' }}>
        {STAT_ROW.map(s => (
          <div class="obx-repstat" key={s.label}>
            <div class="obx-repstat-val">{s.val}</div>
            <div class="obx-repstat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {!runId && (
        <div class="obx-viewswitch" style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
          <button class={`obx-view-btn${top === 'runs' ? ' active' : ''}`} onClick={() => setTop('runs')}>Pay Runs</button>
          <button class={`obx-view-btn${top === 'reports' ? ' active' : ''}`} onClick={() => setTop('reports')}>Reports</button>
        </div>
      )}

      {runId ? (
        <RunDetail runId={runId} onBack={() => setRunId(null)} monthLabel={monthLabel} />
      ) : top === 'runs' ? (
        <RunsSurface runs={runs} loading={runsQ.isLoading} onOpen={setRunId} monthLabel={monthLabel} />
      ) : (
        <ReportsSurface runs={runs} />
      )}
    </div>
  );
}

// ── Runs list ───────────────────────────────────────────────────────────────────

function RunsSurface({ runs, loading, onOpen, monthLabel }: {
  runs: PayrollRun[]; loading: boolean; onOpen: (id: string) => void; monthLabel: (iso: string) => string;
}): VNode {
  const [showForm, setShowForm] = useState(false);
  const canManage = can('finance.payroll.run.manage');

  return (
    <div class="obx-section"><div class="obx-section-body">
      {canManage && (
        <div class="obx-toolbar" style={{ marginBottom: 10 }}>
          <button class="obx-btn" onClick={() => setShowForm(v => !v)}><i class={`fas ${showForm ? 'fa-xmark' : 'fa-plus'}`} /> {showForm ? 'Cancel' : 'New pay run'}</button>
        </div>
      )}
      {showForm && <NewRunForm onDone={() => setShowForm(false)} />}

      {loading ? <div class="obx-empty">Loading…</div>
        : !runs.length ? <EmptyState icon="fa-money-check-dollar" title="No pay runs" text="Create a pay run for a month to begin the payroll cycle." />
        : (
          <table class="obx-table">
            <thead><tr><th>Run #</th><th>Period</th><th>Freq</th><th>Employees</th><th>Gross</th><th>Net</th><th>Status</th></tr></thead>
            <tbody>{runs.map(r => (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
                <td><b>{r.runNo}</b></td>
                <td>{monthLabel(r.periodMonth)}</td>
                <td class="obx-meta">{humanize(r.payFrequency)}</td>
                <td class="obx-meta">{r.employeeCount}</td>
                <td class="obx-meta">{fmtMoney(r.grossTotal)}</td>
                <td class="obx-meta">{fmtMoney(r.netTotal)}</td>
                <td><span class={`obx-pill ${statusTone(r.status)}`}>{humanize(r.status)}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
    </div></div>
  );
}

function NewRunForm({ onDone }: { onDone: () => void }): VNode {
  const [periodMonth, setPeriodMonth] = useState('');
  const [payFrequency, setPayFrequency] = useState('monthly');
  const createMut = usePayrollMutation(financePayrollApi.createRun);

  const submit = async (): Promise<void> => {
    if (!periodMonth) { dialog.error('Select the pay month.'); return; }
    // month input gives YYYY-MM; normalise to first-of-month date.
    const iso = periodMonth.length === 7 ? `${periodMonth}-01` : periodMonth;
    try { await createMut.mutateAsync({ periodMonth: iso, payFrequency }); dialog.success('Pay run created as draft.'); onDone(); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to create run.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'Finance · Payroll', title: 'Pay Run Preview', description: 'Preview what this run will consume.',
    preview: {
      icon: 'RUN', title: periodMonth ? `Pay run · ${periodMonth}` : 'New pay run', subtitle: humanize(payFrequency),
      badges: [{ label: humanize(payFrequency), tone: 'info' }],
    },
    validation: [...(!periodMonth ? [{ message: 'Select the pay month.', tone: 'danger' as const }] : [])],
    whatNext: [
      { label: 'Draft run created', description: 'A draft run is created for the selected month.' },
      { label: 'Inputs pulled on lock', description: 'Approved pay items + approved overtime + statutory profiles.' },
      { label: 'Statutory version', description: 'The currently active statutory version applies to the calculation.' },
    ],
  };
  return (
    <EnterpriseFormModal open
      title="New Pay Run"
      subtitle="Create a monthly pay run — the panel previews the inputs it consumes."
      icon={<i class="fas fa-money-check-dollar" />}
      context={context}
      primaryLabel="Create draft run"
      loading={createMut.isPending}
      disabled={!periodMonth}
      onCancel={onDone}
      onSubmit={() => void submit()}>
      <div class="fin-form-grid fin-form-grid--tight">
        <label class="fin-field"><span>Pay month</span><input type="month" value={periodMonth} onInput={e => setPeriodMonth((e.currentTarget as HTMLInputElement).value)} /></label>
        <label class="fin-field"><span>Frequency</span>
          <select value={payFrequency} onChange={e => setPayFrequency((e.currentTarget as HTMLSelectElement).value)}>
            <option value="monthly">Monthly</option><option value="fortnightly">Fortnightly</option><option value="weekly">Weekly</option>
          </select>
        </label>
      </div>
    </EnterpriseFormModal>
  );
}

// ── Run detail ──────────────────────────────────────────────────────────────────

function RunDetail({ runId, onBack, monthLabel }: { runId: string; onBack: () => void; monthLabel: (iso: string) => string }): VNode {
  const [tab, setTab] = useState<Detail>('lines');
  const runQ = usePayrollRun(runId);
  const run = runQ.data;

  const lockInputsMut = usePayrollMutation(financePayrollApi.lockInputs);
  const calcMut       = usePayrollMutation(financePayrollApi.calculate);
  const submitMut     = usePayrollMutation(financePayrollApi.submitRun);
  const lockMut       = usePayrollMutation(financePayrollApi.lockRun);
  const reopenMut     = usePayrollMutation(financePayrollApi.reopenRun);
  const exportMut     = usePayrollMutation(financePayrollApi.exportRun);
  const genMut        = usePayrollMutation(financePayrollApi.generatePayslips);

  const canManage = can('finance.payroll.run.manage');
  const canLock   = can('finance.payroll.lock');
  const canExport = can('finance.payroll.export');

  const run2 = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; dialog.success(ok); } catch (e) { dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  if (runQ.isLoading && !run) return <div class="obx-section"><div class="obx-section-body"><div class="obx-empty">Loading…</div></div></div>;
  if (!run) return <div class="obx-section"><div class="obx-section-body"><EmptyState icon="fa-triangle-exclamation" title="Run not found" text="This pay run could not be loaded." /></div></div>;

  const s = run.status;
  const runRecord = toActionRecord({
    title: run.runNo, subtitle: monthLabel(run.periodMonth), icon: 'fa-money-check-dollar',
    badges: [statusBadge(run.status)],
    fields: [
      { label: 'Employees', value: run.employeeCount },
      { label: 'Gross', value: fmtMoney(run.grossTotal) },
      { label: 'Net', value: fmtMoney(run.netTotal) },
      { label: 'Employer NIS', value: fmtMoney(run.nisEmployerTotal) },
    ],
  });
  return (
    <div class="obx-section"><div class="obx-section-body">
      <button class="obx-back" onClick={onBack}><i class="fas fa-arrow-left" /> All runs</button>

      <div class="fin-detail-head">
        <div>
          <h2 class="fin-detail-title">{run.runNo} <span class={`obx-pill ${statusTone(s)}`}>{humanize(s)}</span></h2>
          <div class="obx-meta">{monthLabel(run.periodMonth)} · {humanize(run.payFrequency)} · {run.weeksInPeriod} week(s) · {run.employeeCount} employees</div>
        </div>
        <div class="fin-detail-totals">
          <div><span class="obx-repstat-label">Gross</span><b>{fmtMoney(run.grossTotal)}</b></div>
          <div><span class="obx-repstat-label">Deductions</span><b>{fmtMoney(run.deductionTotal)}</b></div>
          <div><span class="obx-repstat-label">Net</span><b>{fmtMoney(run.netTotal)}</b></div>
          <div><span class="obx-repstat-label">Employer NIS</span><b>{fmtMoney(run.nisEmployerTotal)}</b></div>
        </div>
      </div>

      {/* Lifecycle actions — status-aware */}
      <div class="obx-rowbtns" style={{ margin: '10px 0' }}>
        {canManage && s === 'draft'         && <button class="obx-btn obx-btn-sm" onClick={async () => {
          const res = await openActionModal({ title: 'Lock inputs', icon: 'fa-lock', tone: 'warning', record: runRecord, warning: 'Inputs are frozen so the run can be calculated.', whatNext: ['Status → input_locked; no further input changes.'], confirmLabel: 'Lock inputs' });
          if (res.confirmed) void run2(lockInputsMut.mutateAsync({ id: run.id }), 'Inputs locked.');
        }}>Lock inputs</button>}
        {canManage && s === 'input_locked'  && <button class="obx-btn obx-btn-sm" onClick={async () => {
          const res = await openActionModal({ title: 'Calculate run', icon: 'fa-calculator', tone: 'info', record: runRecord, whatNext: ['Calculates NIS / Health Surcharge / PAYE + net pay per employee.', 'Status → calculated; review lines + warnings.'], confirmLabel: 'Calculate' });
          if (res.confirmed) void run2(calcMut.mutateAsync({ id: run.id }), 'Run calculated.');
        }}>Calculate</button>}
        {canManage && s === 'calculated'    && <button class="obx-btn obx-btn-sm" onClick={async () => {
          const res = await openActionModal({ title: 'Submit for approval', icon: 'fa-paper-plane', tone: 'info', record: runRecord, whatNext: ['Submits the run through the approval workflow.', 'Status → pending_approval (approver ≠ creator).'], confirmLabel: 'Submit' });
          if (res.confirmed) void run2(submitMut.mutateAsync({ id: run.id }), 'Submitted for approval.');
        }}>Submit for approval</button>}
        {s === 'pending_approval'           && <span class="obx-pill amber">Awaiting workflow approval</span>}
        {canLock && s === 'approved'        && <button class="obx-btn obx-btn-sm" onClick={async () => {
          const res = await openActionModal(lockAction({ noun: 'pay run', record: runRecord, whatNext: ['Figures become immutable.', 'Export and payslip generation become available.'] }));
          if (res.confirmed) void run2(lockMut.mutateAsync({ id: run.id }), 'Run locked.');
        }}>Lock run</button>}
        {canExport && (s === 'locked' || s === 'exported') && <button class="obx-btn obx-btn-sm" onClick={async () => {
          const res = await openActionModal({ title: 'Generate export', icon: 'fa-file-export', tone: 'info', record: runRecord, whatNext: ['Generates the statutory export file for this run.', 'Marks the run exported.'], confirmLabel: 'Generate export' });
          if (res.confirmed) void run2(exportMut.mutateAsync({ id: run.id }), 'Export generated.');
        }}>Generate export</button>}
        {canManage && (s === 'locked' || s === 'exported') && <button class="obx-btn obx-btn-sm" onClick={async () => {
          const res = await openActionModal({ title: 'Generate payslips', icon: 'fa-file-invoice-dollar', tone: 'info', record: runRecord, whatNext: ['Generates a payslip document for every run line.'], confirmLabel: 'Generate payslips' });
          if (res.confirmed) void run2(genMut.mutateAsync({ runId: run.id }), 'Payslips generated.');
        }}>Generate payslips</button>}
        {canManage && s === 'locked'        && <button class="obx-btn obx-btn-sm" onClick={async () => {
          const res = await openActionModal(reopenAction({ noun: 'pay run', record: runRecord, whatNext: ['Clears all run lines + inputs; the run returns to draft.', 'It must be re-locked and recalculated.'] }));
          if (!res.confirmed) return;
          void run2(reopenMut.mutateAsync({ id: run.id, reason: res.reason || undefined }), 'Run reopened.');
        }}>Reopen</button>}
      </div>

      <div class="obx-viewswitch" style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        {(['lines', 'warnings', 'payslips', 'exports'] as Detail[]).map(t => (
          <button key={t} class={`obx-view-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{humanize(t)}</button>
        ))}
      </div>

      {tab === 'lines'    && <LinesTab runId={run.id} />}
      {tab === 'warnings' && <WarningsTab runId={run.id} />}
      {tab === 'payslips' && <PayslipsTab runId={run.id} />}
      {tab === 'exports'  && <ExportsTab runId={run.id} />}
    </div></div>
  );
}

function LinesTab({ runId }: { runId: string }): VNode {
  const q = useRunLines(runId);
  if (q.isLoading && !q.data) return <div class="obx-empty">Loading…</div>;
  if (!q.data?.length) return <EmptyState icon="fa-table-list" title="No run lines" text="Calculate the run to produce per-employee lines." />;
  return (
    <table class="obx-table">
      <thead><tr><th>Employee</th><th>Gross</th><th>NIS (EE)</th><th>Health S/C</th><th>PAYE</th><th>Other ded.</th><th>Net</th></tr></thead>
      <tbody>{q.data.map(l => (
        <tr key={l.id}>
          <td class="obx-meta">{l.employeeId}</td>
          <td class="obx-meta">{fmtMoney(l.gross)}</td>
          <td class="obx-meta">{fmtMoney(l.nisEmployee)}</td>
          <td class="obx-meta">{fmtMoney(l.healthSurcharge)}</td>
          <td class="obx-meta">{fmtMoney(l.paye)}</td>
          <td class="obx-meta">{fmtMoney(l.voluntaryDeductions)}</td>
          <td><b>{fmtMoney(l.net)}</b></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function WarningsTab({ runId }: { runId: string }): VNode {
  const q = useRunWarnings(runId);
  if (q.isLoading && !q.data) return <div class="obx-empty">Loading…</div>;
  if (!q.data?.length) return <EmptyState icon="fa-circle-check" title="No warnings" text="This run has no unresolved warnings." />;
  return (
    <table class="obx-table">
      <thead><tr><th>Type</th><th>Employee</th><th>Severity</th><th>Message</th><th>Resolved</th></tr></thead>
      <tbody>{q.data.map(w => (
        <tr key={w.id}>
          <td class="obx-meta">{humanize(w.warningType)}</td>
          <td class="obx-meta">{w.employeeId ?? '—'}</td>
          <td><span class={`obx-pill ${w.severity === 'error' ? 'red' : w.severity === 'warning' ? 'amber' : 'gray'}`}>{humanize(w.severity)}</span></td>
          <td>{w.message}</td>
          <td class="obx-meta">{w.resolved ? 'Yes' : 'No'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function PayslipsTab({ runId }: { runId: string }): VNode {
  const q = useRunPayslips(runId);
  const openSlip = async (id: string): Promise<void> => {
    try { const { url } = await financePayrollApi.payslipSignedUrl({ id }); window.open(url, '_blank', 'noopener'); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Could not open payslip.'); }
  };
  if (q.isLoading && !q.data) return <div class="obx-empty">Loading…</div>;
  if (!q.data?.length) return <EmptyState icon="fa-file-invoice-dollar" title="No payslips" text="Generate payslips once the run is locked." />;
  return (
    <table class="obx-table">
      <thead><tr><th>Payslip #</th><th>Employee</th><th>Generated</th><th style={{ textAlign: 'right' }}>Document</th></tr></thead>
      <tbody>{q.data.map(p => (
        <tr key={p.id}>
          <td><b>{p.payslipNo}</b></td>
          <td class="obx-meta">{p.employeeId}</td>
          <td class="obx-meta">{fmtDate(p.generatedAt)}</td>
          <td style={{ textAlign: 'right' }}>{p.filePath ? <button class="obx-btn obx-btn-sm" onClick={() => openSlip(p.id)}>Open</button> : <span class="obx-meta">—</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function ExportsTab({ runId }: { runId: string }): VNode {
  const q = useRunExports(runId);
  if (q.isLoading && !q.data) return <div class="obx-empty">Loading…</div>;
  if (!q.data?.length) return <EmptyState icon="fa-file-export" title="No exports" text="Generate a statutory export once the run is locked." />;
  return (
    <table class="obx-table">
      <thead><tr><th>Export #</th><th>Format</th><th>Generated</th><th>Current</th></tr></thead>
      <tbody>{q.data.map(x => (
        <tr key={x.id}>
          <td><b>{x.exportNo}</b></td>
          <td class="obx-meta">{x.format.toUpperCase()}</td>
          <td class="obx-meta">{fmtDate(x.generatedAt)}</td>
          <td class="obx-meta">{x.isCurrent ? 'Yes' : 'No'}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────────

const REPORTS: { key: string; label: string; needsRun: boolean }[] = [
  { key: 'register',            label: 'Payroll Register',       needsRun: true },
  { key: 'payslip_register',    label: 'Payslip Register',       needsRun: true },
  { key: 'net_pay_summary',     label: 'Net-Pay Summary',        needsRun: true },
  { key: 'employer_nis_summary',label: 'Employer-NIS Summary',   needsRun: true },
];

function ReportsSurface({ runs }: { runs: PayrollRun[] }): VNode {
  const [report, setReport] = useState(REPORTS[0]!.key);
  const [runId, setRunId] = useState<string>(() => runs[0]?.id ?? '');
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const canView = can('finance.payroll.reports.view');

  const runReport = async (): Promise<void> => {
    setLoading(true); setRows(null);
    try { const res = await financePayrollApi.runReport({ report, runId: runId || undefined }); setRows(res.rows); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to run report.'); }
    finally { setLoading(false); }
  };

  const cols = rows && rows.length ? Object.keys(rows[0]!) : [];
  return (
    <div class="obx-section"><div class="obx-section-body">
      {!canView ? <EmptyState icon="fa-lock" title="No access" text="You do not have permission to view payroll reports." />
        : (
          <>
            <div class="fin-form">
              <div class="fin-form-grid fin-form-grid--tight">
                <label class="fin-field"><span>Report</span>
                  <select value={report} onChange={e => setReport((e.currentTarget as HTMLSelectElement).value)}>
                    {REPORTS.map(r => <option value={r.key} key={r.key}>{r.label}</option>)}
                  </select>
                </label>
                <label class="fin-field"><span>Pay run</span>
                  <select value={runId} onChange={e => setRunId((e.currentTarget as HTMLSelectElement).value)}>
                    <option value="">— select —</option>
                    {runs.map(r => <option value={r.id} key={r.id}>{r.runNo}</option>)}
                  </select>
                </label>
              </div>
              <div class="obx-rowbtns" style={{ marginTop: 10 }}><button class="obx-btn" disabled={loading} onClick={runReport}><i class="fas fa-play" /> Run report</button></div>
            </div>

            {loading ? <div class="obx-empty">Running…</div>
              : rows == null ? <EmptyState icon="fa-chart-column" title="Run a report" text="Choose a report and pay run, then run it." />
              : !rows.length ? <EmptyState icon="fa-inbox" title="No rows" text="This report returned no rows for the selected run." />
              : (
                <table class="obx-table">
                  <thead><tr>{cols.map(c => <th key={c}>{humanize(c)}</th>)}</tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i}>{cols.map(c => <td class="obx-meta" key={c}>{r[c] == null ? '—' : String(r[c])}</td>)}</tr>
                  ))}</tbody>
                </table>
              )}
          </>
        )}
    </div></div>
  );
}
