/**
 * src/components/sections/Finance/PayRunDrawer.tsx
 *
 * Rich, tabbed detail drawer for a payroll run.
 *
 * Tabs:
 *   Summary · Run Lines · Inputs · Warnings · Payslips · Exports ·
 *   Approvals · Timeline · Audit · Related
 *
 * Lifecycle actions (footer, state-aware + permission-gated):
 *   draft          → Lock Inputs
 *   inputs_locked  → Calculate
 *   calculated     → Submit for Approval
 *   submitted      → Approve / Reject   (different Finance Manager — SoD)
 *   approved       → Lock Run
 *   locked         → Export Run · Create Disbursement · Create Remittance · Reopen
 *
 * All mutations call parent page handlers (page owns the useMutation + toast).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { Drawer, HrfinPill, type HrfinTone } from '@ui';
import {
  usePayrollRun,
  useRunLines,
  useRunInputs,
  useRunWarnings,
  useRunPayslips,
  useRunExports,
  useExportDownload,
  type PayrollRun,
  type PayrollRunLine,
  type PayrollRunWarning,
  type Payslip,
  type PayrollExport,
  financePayrollApi,
  usePayrollMutation,
} from '@api/finance/payroll';
import { useEmployeeNames } from '@api/finance/lookups';
import { EmployeeCellResolved, EmployeeCell } from './_shared/EmployeeCell';
import { PayWarningResolveDialog } from './PayWarningResolveDialog';
import { PayCreateDisbursementDialog, PayCreateRemittanceDialog } from './PayBridgeDialog';
import { fmtMoney, fmtDate, humanize } from './financeShared';

// ── Helpers ────────────────────────────────────────────────────────────────────

function runStatusTone(status: string): HrfinTone {
  switch (status) {
    case 'locked':   return 'ok';
    case 'approved': return 'ok';
    case 'submitted':
    case 'calculated':
    case 'inputs_locked':
      return 'wn';
    case 'cancelled': return 'bad';
    default:         return 'nu';  // draft
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = 'summary' | 'lines' | 'inputs' | 'warnings' | 'payslips' | 'exports' | 'approvals' | 'timeline' | 'audit' | 'related';

const TABS: { key: Tab; label: string }[] = [
  { key: 'summary',   label: 'Summary' },
  { key: 'lines',     label: 'Run Lines' },
  { key: 'inputs',    label: 'Inputs' },
  { key: 'warnings',  label: 'Warnings' },
  { key: 'payslips',  label: 'Payslips' },
  { key: 'exports',   label: 'Exports' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'timeline',  label: 'Timeline' },
  { key: 'related',   label: 'Related' },
];

// ── Tab: Summary ──────────────────────────────────────────────────────────────

function SummaryTab({ run }: { run: PayrollRun }): VNode {
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row"><span>Run number</span><b>{run.runNo}</b></div>
      <div class="hrfin-metric-row"><span>Pay period</span><b>{run.periodMonth.slice(0, 7)}</b></div>
      <div class="hrfin-metric-row"><span>Frequency</span><b>{humanize(run.payFrequency)}</b></div>
      <div class="hrfin-metric-row"><span>Weeks in period</span><b>{run.weeksInPeriod}</b></div>
      <div class="hrfin-metric-row"><span>Status</span>
        <HrfinPill tone={runStatusTone(run.status)}>{humanize(run.status)}</HrfinPill>
      </div>
      <div class="hrfin-metric-row"><span>Employees</span><b>{run.employeeCount}</b></div>
      <div class="hrfin-metric-row"><span>Gross total</span><b>{fmtMoney(run.grossTotal)}</b></div>
      <div class="hrfin-metric-row"><span>Total deductions</span><b>{fmtMoney(run.deductionTotal)}</b></div>
      <div class="hrfin-metric-row"><span>Net payroll</span>
        <b style={{ color: 'var(--hrfin-accent)' }}>{fmtMoney(run.netTotal)}</b>
      </div>
      <div class="hrfin-metric-row"><span>NIS (employer)</span><b>{fmtMoney(run.nisEmployerTotal)}</b></div>
      <div class="hrfin-metric-row"><span>Statutory version</span>
        <b style={{ fontSize: 11, fontFamily: 'monospace' }}>{run.statutoryVersionId.slice(0, 8)}…</b>
      </div>
      <div class="hrfin-metric-row"><span>Created by</span>
        <EmployeeCell employeeId={run.createdBy} />
      </div>
      {run.inputLockedBy && (
        <div class="hrfin-metric-row"><span>Inputs locked by</span>
          <EmployeeCell employeeId={run.inputLockedBy} />
        </div>
      )}
      {run.approvedBy && (
        <div class="hrfin-metric-row"><span>Approved by</span>
          <EmployeeCell employeeId={run.approvedBy} />
        </div>
      )}
      {run.lockedBy && (
        <div class="hrfin-metric-row"><span>Locked by</span>
          <EmployeeCell employeeId={run.lockedBy} />
        </div>
      )}
      {run.reopenedBy && (
        <>
          <div class="hrfin-metric-row"><span>Reopened by</span>
            <EmployeeCell employeeId={run.reopenedBy} />
          </div>
          <div class="hrfin-metric-row"><span>Reopen reason</span><b>{run.reopenReason ?? '—'}</b></div>
        </>
      )}
    </div>
  );
}

// ── Tab: Run Lines ────────────────────────────────────────────────────────────

function RunLinesTab({ runId }: { runId: string }): VNode {
  const { data: lines, isLoading } = useRunLines(runId);
  const allIds = (lines ?? []).map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);

  if (isLoading) return <div class="hrfin-empty">Loading run lines…</div>;
  if (!lines || lines.length === 0) return <div class="hrfin-empty">No run lines — run Calculate first.</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table class="hrfin-mini-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--hrfin-border)', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Employee</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Gross</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>PAYE</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>NIS (emp)</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>HS</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Vol. Ded.</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Net</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line: PayrollRunLine) => (
            <tr key={line.id} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
              <td style={{ padding: '6px 8px' }}>
                <EmployeeCellResolved
                  resolved={nameMap?.get(line.employeeId)}
                  fallbackId={line.employeeId}
                />
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtMoney(line.gross)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtMoney(line.paye)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtMoney(line.nisEmployee)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtMoney(line.healthSurcharge)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtMoney(line.voluntaryDeductions)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--hrfin-accent)' }}>
                {fmtMoney(line.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab: Inputs ───────────────────────────────────────────────────────────────

function InputsTab({ runId }: { runId: string }): VNode {
  const { data: inputs, isLoading } = useRunInputs(runId);
  const allIds = (inputs ?? []).map(i => i.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);

  if (isLoading) return <div class="hrfin-empty">Loading inputs…</div>;
  if (!inputs || inputs.length === 0) return <div class="hrfin-empty">No inputs snapshotted — run Lock Inputs first.</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table class="hrfin-mini-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--hrfin-border)', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Employee</th>
            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Source</th>
            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Component</th>
            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Label</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Qty</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Rate</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {inputs.map(inp => (
            <tr key={inp.id} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
              <td style={{ padding: '6px 8px' }}>
                <EmployeeCellResolved resolved={nameMap?.get(inp.employeeId)} fallbackId={inp.employeeId} />
              </td>
              <td style={{ padding: '6px 8px', color: 'var(--hrfin-text-secondary)' }}>{humanize(inp.sourceType)}</td>
              <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{inp.componentCode ?? '—'}</td>
              <td style={{ padding: '6px 8px' }}>{inp.label ?? '—'}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{inp.quantity ?? '—'}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{inp.rate != null ? fmtMoney(inp.rate) : '—'}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{inp.amount != null ? fmtMoney(inp.amount) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab: Warnings ─────────────────────────────────────────────────────────────

function WarningsTab({
  runId,
  canManage,
}: {
  runId:      string;
  canManage:  boolean;
}): VNode {
  const { data: warnings, isLoading } = useRunWarnings(runId);
  const [resolving, setResolving] = useState<PayrollRunWarning | null>(null);

  if (isLoading) return <div class="hrfin-empty">Loading warnings…</div>;
  if (!warnings || warnings.length === 0) return <div class="hrfin-empty">No warnings for this run.</div>;

  function warnTone(severity: string): HrfinTone {
    if (severity === 'blocker' || severity === 'error') return 'bad';
    if (severity === 'warning') return 'wn';
    return 'nu';
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {warnings.map((w: PayrollRunWarning) => (
          <div
            key={w.id}
            style={{
              padding: '10px 12px',
              background: 'var(--hrfin-surface-2)',
              border: '1px solid var(--hrfin-border)',
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HrfinPill tone={warnTone(w.severity)}>{w.severity.toUpperCase()}</HrfinPill>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{humanize(w.warningType)}</span>
              {w.resolved && <HrfinPill tone="ok">RESOLVED</HrfinPill>}
              {!w.resolved && canManage && (
                <button
                  type="button"
                  class="hrfin-action"
                  style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 10px' }}
                  onClick={() => setResolving(w)}
                >
                  Resolve
                </button>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>{w.message}</p>
            {w.employeeId && (
              <div style={{ fontSize: 11 }}>
                Employee: <EmployeeCell employeeId={w.employeeId} />
              </div>
            )}
            {w.resolved && w.resolvedBy && (
              <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)' }}>
                Resolved by <EmployeeCell employeeId={w.resolvedBy} />
                {w.resolvedAt ? ` · ${fmtDate(w.resolvedAt)}` : ''}
              </div>
            )}
          </div>
        ))}
      </div>

      {resolving && (
        <PayWarningResolveDialog
          warning={resolving}
          onClose={() => setResolving(null)}
          onResolved={() => setResolving(null)}
        />
      )}
    </>
  );
}

// ── Tab: Payslips ─────────────────────────────────────────────────────────────

function PayslipsTab({ runId }: { runId: string }): VNode {
  const { data: payslips, isLoading } = useRunPayslips(runId);
  const allIds = (payslips ?? []).map(p => p.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);

  async function downloadPayslip(payslip: Payslip): Promise<void> {
    try {
      const { data: res } = await import('@api/finance/payroll').then(m => {
        return { data: m.financePayrollApi.payslipSignedUrl({ id: payslip.id }) };
      });
      const url = await res;
      window.open(url.url, '_blank', 'noopener');
    } catch (e) {
      toast((e as Error).message ?? 'Failed to get payslip URL.');
    }
  }

  if (isLoading) return <div class="hrfin-empty">Loading payslips…</div>;
  if (!payslips || payslips.length === 0) return <div class="hrfin-empty">No payslips generated yet. Lock the run first, then generate payslips.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {payslips.map((p: Payslip) => (
        <div
          key={p.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 12px',
            background: 'var(--hrfin-surface-2)',
            border: '1px solid var(--hrfin-border)',
            borderRadius: 8,
          }}
        >
          <div style={{ flex: 1 }}>
            <EmployeeCellResolved resolved={nameMap?.get(p.employeeId)} fallbackId={p.employeeId} />
            <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', marginTop: 2 }}>
              {p.payslipNo} · Generated {fmtDateTime(p.generatedAt)}
            </div>
          </div>
          <button
            type="button"
            class="hrfin-action"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => void downloadPayslip(p)}
          >
            Download
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Exports ──────────────────────────────────────────────────────────────

function ExportsTab({ runId }: { runId: string }): VNode {
  const { data: exports, isLoading } = useRunExports(runId);
  const downloadMut = useExportDownload();

  async function handleDownload(exp: PayrollExport): Promise<void> {
    try {
      const res = await downloadMut.mutateAsync({ exportId: exp.id });
      const blob = new Blob([res.content], { type: res.mimeType });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Downloaded ${res.filename}`);
    } catch (e) {
      toast((e as Error).message ?? 'Download failed.');
    }
  }

  if (isLoading) return <div class="hrfin-empty">Loading exports…</div>;
  if (!exports || exports.length === 0) return <div class="hrfin-empty">No exports for this run. Lock the run first, then export.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {exports.map((exp: PayrollExport) => (
        <div
          key={exp.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 12px',
            background: 'var(--hrfin-surface-2)',
            border: '1px solid var(--hrfin-border)',
            borderRadius: 8,
          }}
        >
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 13 }}>{exp.exportNo}</b>
            {exp.isCurrent && <span style={{ marginLeft: 8 }}><HrfinPill tone="ok">Current</HrfinPill></span>}
            <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', marginTop: 2 }}>
              Format: {exp.format.toUpperCase()} · Generated {fmtDateTime(exp.generatedAt)}
            </div>
          </div>
          <button
            type="button"
            class="hrfin-action"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => void handleDownload(exp)}
            disabled={downloadMut.isPending}
          >
            {downloadMut.isPending ? '…' : 'Download'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Approvals ────────────────────────────────────────────────────────────

function ApprovalsTab({ run }: { run: PayrollRun }): VNode {
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row">
        <span>Workflow ID</span>
        <b style={{ fontSize: 11, fontFamily: 'monospace' }}>{run.workflowId ?? 'Direct approve (no workflow)'}</b>
      </div>
      <div class="hrfin-metric-row">
        <span>Submitted</span>
        <b>{run.status === 'submitted' || run.approvedBy ? 'Yes' : 'No'}</b>
      </div>
      <div class="hrfin-metric-row">
        <span>Approved by</span>
        <span>{run.approvedBy ? <EmployeeCell employeeId={run.approvedBy} /> : <em style={{ color: 'var(--hrfin-text-secondary)' }}>Pending</em>}</span>
      </div>
      <div class="hrfin-metric-row">
        <span>Current status</span>
        <HrfinPill tone={runStatusTone(run.status)}>{humanize(run.status)}</HrfinPill>
      </div>
      {run.status === 'submitted' && (
        <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
                      borderRadius: 8, padding: '12px 14px', fontSize: 12, marginTop: 8 }}>
          <strong>SoD note:</strong> The approver must be a different Finance Manager than the preparer.
          The system enforces this at the approval step.
        </div>
      )}
    </div>
  );
}

// ── Tab: Timeline ─────────────────────────────────────────────────────────────

function TimelineTab({ run }: { run: PayrollRun }): VNode {
  const events: { label: string; value: string | null }[] = [
    { label: 'Created',       value: run.createdAt },
    { label: 'Inputs locked', value: run.inputLockedAt },
    { label: 'Locked',        value: run.lockedAt },
    { label: 'Reopened',      value: run.reopenedAt ?? null },
    { label: 'Exported',      value: run.exportedAt ?? null },
    { label: 'Updated',       value: run.updatedAt },
  ];

  return (
    <div class="hrfin-metric-list">
      {events.map(ev => (
        <div key={ev.label} class="hrfin-metric-row">
          <span>{ev.label}</span>
          <b style={{ fontSize: 12, color: ev.value ? 'inherit' : 'var(--hrfin-text-secondary)' }}>
            {ev.value ? fmtDateTime(ev.value) : '—'}
          </b>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Related ──────────────────────────────────────────────────────────────

function RelatedTab({
  run,
  canManage,
  onBridgeDisb,
  onBridgeRem,
}: {
  run:         PayrollRun;
  canManage:   boolean;
  onBridgeDisb: () => void;
  onBridgeRem:  () => void;
}): VNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                    borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Disbursement</div>
        <p style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', margin: '0 0 10px' }}>
          Create a disbursement record to manage the bank transfer payment for this payroll run.
          Idempotent — safe to click again if you need the disbursement ID.
        </p>
        {canManage && run.status === 'locked' ? (
          <button type="button" class="hrfin-action is-primary" onClick={onBridgeDisb}>
            Create / Open Disbursement
          </button>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>
            Available once the run is locked.
          </span>
        )}
      </div>

      <div style={{ background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                    borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Statutory Remittances</div>
        <p style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', margin: '0 0 10px' }}>
          Create remittance records for PAYE/BIR, NIS/NIBTT, or Health Surcharge. Each authority
          gets its own remittance record. Idempotent per (run, authority) pair.
        </p>
        {canManage && run.status === 'locked' ? (
          <button type="button" class="hrfin-action is-primary" onClick={onBridgeRem}>
            Create Remittance
          </button>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>
            Available once the run is locked.
          </span>
        )}
      </div>
    </div>
  );
}

// ── Lifecycle footer ──────────────────────────────────────────────────────────

export interface PayRunDrawerActions {
  onLockInputs:  (run: PayrollRun) => void;
  onCalculate:   (run: PayrollRun) => void;
  onSubmit:      (run: PayrollRun) => void;
  onApprove:     (run: PayrollRun) => void;
  onReject:      (run: PayrollRun) => void;
  onLockRun:     (run: PayrollRun) => void;
  onExport:      (run: PayrollRun) => void;
  onReopen:      (run: PayrollRun) => void;
  onGenPayslips: (run: PayrollRun) => void;
}

function DrawerFooter({
  run,
  canManage,
  canApprove,
  actions,
}: {
  run:        PayrollRun;
  canManage:  boolean;
  canApprove: boolean;
  actions:    PayRunDrawerActions;
}): VNode {
  const s = run.status;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }}>
      {s === 'draft'         && canManage  && <button class="hrfin-action is-primary" onClick={() => actions.onLockInputs(run)}>Lock Inputs</button>}
      {s === 'inputs_locked' && canManage  && <button class="hrfin-action is-primary" onClick={() => actions.onCalculate(run)}>Calculate</button>}
      {s === 'calculated'    && canManage  && <button class="hrfin-action is-primary" onClick={() => actions.onSubmit(run)}>Submit for Approval</button>}
      {s === 'submitted'     && canApprove && <button class="hrfin-action is-primary" onClick={() => actions.onApprove(run)}>Approve</button>}
      {s === 'submitted'     && canApprove && <button class="hrfin-action is-danger"  onClick={() => actions.onReject(run)}>Reject</button>}
      {s === 'approved'      && canManage  && <button class="hrfin-action is-primary" onClick={() => actions.onLockRun(run)}>Lock Run</button>}
      {s === 'locked'        && canManage  && <button class="hrfin-action"            onClick={() => actions.onExport(run)}>Export</button>}
      {s === 'locked'        && canManage  && <button class="hrfin-action"            onClick={() => actions.onGenPayslips(run)}>Generate Payslips</button>}
      {s === 'locked'        && canApprove && <button class="hrfin-action"            style={{ marginLeft: 'auto' }} onClick={() => actions.onReopen(run)}>Reopen</button>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PayRunDrawer({
  runId,
  open,
  onClose,
  canManage,
  canApprove,
  actions,
}: {
  runId:      string | null;
  open:       boolean;
  onClose:    () => void;
  canManage:  boolean;
  canApprove: boolean;
  actions:    PayRunDrawerActions;
}): VNode {
  const [tab, setTab] = useState<Tab>('summary');
  const [showDisb, setShowDisb] = useState(false);
  const [showRem,  setShowRem]  = useState(false);

  const runQ = usePayrollRun(runId);
  const run  = runQ.data;

  const blockerCount = 0;  // Computed in WarningsTab when rendered

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        panelClass="hrfin"
        title={run?.runNo ?? 'Payroll Run'}
        sub={run ? `${run.periodMonth.slice(0, 7)} · ${humanize(run.payFrequency)} · ${run.employeeCount} employees` : ''}
        foot={run && (canManage || canApprove) ? (
          <DrawerFooter run={run} canManage={canManage} canApprove={canApprove} actions={actions} />
        ) : undefined}
      >
        {!run ? (
          <div class="hrfin">
            <div class="hrfin-empty">Loading run…</div>
          </div>
        ) : (
          <div class="hrfin">
            {/* KPI strip */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 80px', background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                            borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Net Payroll</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--hrfin-accent)' }}>{fmtMoney(run.netTotal)}</div>
              </div>
              <div style={{ flex: '1 1 80px', background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                            borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Gross</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{fmtMoney(run.grossTotal)}</div>
              </div>
              <div style={{ flex: '1 1 80px', background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                            borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Employees</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{run.employeeCount}</div>
              </div>
              <div style={{ flex: '1 1 80px', background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                            borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Status</div>
                <div style={{ marginTop: 2 }}>
                  <HrfinPill tone={runStatusTone(run.status)}>{humanize(run.status)}</HrfinPill>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div class="hrfin-tabs" style={{ marginBottom: 16 }}>
              {TABS.map(t => (
                <button key={t.key} type="button" class={t.key === tab ? 'is-active' : ''} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab body */}
            {tab === 'summary'   && <SummaryTab run={run} />}
            {tab === 'lines'     && <RunLinesTab runId={run.id} />}
            {tab === 'inputs'    && <InputsTab runId={run.id} />}
            {tab === 'warnings'  && <WarningsTab runId={run.id} canManage={canManage} />}
            {tab === 'payslips'  && <PayslipsTab runId={run.id} />}
            {tab === 'exports'   && <ExportsTab runId={run.id} />}
            {tab === 'approvals' && <ApprovalsTab run={run} />}
            {tab === 'timeline'  && <TimelineTab run={run} />}
            {tab === 'related'   && (
              <RelatedTab
                run={run}
                canManage={canManage}
                onBridgeDisb={() => setShowDisb(true)}
                onBridgeRem={() => setShowRem(true)}
              />
            )}
          </div>
        )}
      </Drawer>

      {/* Bridge dialogs — rendered outside the drawer to avoid stacking context issues */}
      {showDisb && run && (
        <PayCreateDisbursementDialog
          run={run}
          onClose={() => setShowDisb(false)}
          onCreated={() => setShowDisb(false)}
        />
      )}
      {showRem && run && (
        <PayCreateRemittanceDialog
          run={run}
          onClose={() => setShowRem(false)}
          onCreated={() => setShowRem(false)}
        />
      )}
    </>
  );
}
