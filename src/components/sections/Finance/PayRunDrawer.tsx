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
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { Drawer, HrfinPill, type HrfinTone } from '@ui';
import {
  usePayrollRun,
  useRunLines,
  useRunInputs,
  useRunWarnings,
  useRunPayslips,
  useRunExports,
  useRunGlPreview,
  useRunOverrides,
  useExportDownload,
  useRunAuditLog,
  type PayrollRun,
  type PayrollRunLine,
  type PayrollRunInput,
  type PayrollRunWarning,
  type Payslip,
  type PayrollExport,
  type RunAuditLogEntry,
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
    case 'locked':           return 'ok';
    case 'approved':         return 'ok';
    case 'pending_approval':
    case 'calculated':
    case 'input_locked':
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

type Tab = 'summary' | 'lines' | 'inputs' | 'worksheet' | 'warnings' | 'payslips' | 'exports' | 'gl' | 'approvals' | 'timeline' | 'audit' | 'related';

const TABS: { key: Tab; label: string }[] = [
  { key: 'summary',   label: 'Summary' },
  { key: 'lines',     label: 'Run Lines' },
  { key: 'inputs',    label: 'Inputs' },
  { key: 'worksheet', label: 'Worksheet' },
  { key: 'warnings',  label: 'Warnings' },
  { key: 'payslips',  label: 'Payslips' },
  { key: 'exports',   label: 'Exports' },
  { key: 'gl',        label: 'GL' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'timeline',  label: 'Timeline' },
  { key: 'audit',     label: 'Audit' },
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

function InputsTab({ runId, runStatus, canManage }: { runId: string; runStatus: string; canManage: boolean }): VNode {
  const { data: inputs, isLoading } = useRunInputs(runId);
  const allIds = (inputs ?? []).map(i => i.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);
  // edit-before-lock is only available in 'input_locked' state (before calculate)
  const canEditInputs = canManage && runStatus === 'input_locked';

  if (isLoading) return <div class="hrfin-empty">Loading inputs…</div>;
  if (!inputs || inputs.length === 0) return <div class="hrfin-empty">No inputs snapshotted — run Lock Inputs first.</div>;

  async function handleEditAmount(inp: PayrollRunInput): Promise<void> {
    const raw = await dialog.prompt({
      title: `Edit amount — ${inp.label ?? inp.componentCode ?? inp.sourceType}`,
      text: `Current value: ${inp.amount ?? 0}`,
      value: String(inp.amount ?? 0),
      placeholder: 'Enter new amount',
      type: 'number',
      confirmText: 'Update',
    });
    if (raw === null) return;
    const val = parseFloat(raw);
    if (isNaN(val)) { toast('Invalid amount — please enter a number.'); return; }
    try {
      const { apiPost } = await import('@lib/api');
      await apiPost('finance/payroll/inputs/edit', { inputId: inp.id, amount: val } as Record<string, unknown>);
      toast('Input updated.');
    } catch (e) {
      toast((e as Error).message ?? 'Failed to update input.');
    }
  }

  async function handleExclude(inp: PayrollRunInput): Promise<void> {
    const confirmed = await dialog.confirm({
      title: 'Exclude input from run?',
      text: `"${inp.label ?? inp.sourceType}" will be excluded from this pay run for this employee. This cannot be undone without reopening the run.`,
      confirmText: 'Exclude',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const { apiPost } = await import('@lib/api');
      await apiPost('finance/payroll/inputs/exclude', { inputId: inp.id } as Record<string, unknown>);
      toast('Input excluded from run.');
    } catch (e) {
      toast((e as Error).message ?? 'Exclude failed.');
    }
  }

  function handleViewSource(inp: PayrollRunInput): void {
    if (!inp.sourceId) { toast('No source record linked to this input.'); return; }
    // Navigate based on source type
    const hash = inp.sourceType === 'overtime'
      ? `s-hr-attendance?id=${inp.sourceId}`
      : inp.sourceType === 'pay_item'
      ? `s-hr-compensation?id=${inp.sourceId}`
      : `s-hr-employees?id=${inp.employeeId}`;
    window.location.hash = hash;
  }

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
            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {inputs.map((inp: PayrollRunInput) => (
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
              <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                {canEditInputs && (
                  <button type="button" class="hrfin-action" style={{ fontSize: 10, padding: '2px 7px', marginRight: 4 }}
                    onClick={() => void handleEditAmount(inp)}>
                    Edit
                  </button>
                )}
                {canEditInputs && (
                  <button type="button" class="hrfin-action" style={{ fontSize: 10, padding: '2px 7px', marginRight: 4, color: 'var(--danger)' }}
                    onClick={() => void handleExclude(inp)}>
                    Exclude
                  </button>
                )}
                <button type="button" class="hrfin-action" style={{ fontSize: 10, padding: '2px 7px' }}
                  onClick={() => handleViewSource(inp)}>
                  View Source
                </button>
              </td>
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
  const { data: warnings, isLoading, refetch } = useRunWarnings(runId);
  const [resolving,     setResolving]     = useState<PayrollRunWarning | null>(null);
  const [acknowledging, setAcknowledging] = useState<string | null>(null); // warning id being acked
  const ackMut = usePayrollMutation(financePayrollApi.resolveWarning);

  if (isLoading) return <div class="hrfin-empty">Loading warnings…</div>;
  if (!warnings || warnings.length === 0) return <div class="hrfin-empty">No warnings for this run.</div>;

  function warnTone(severity: string): HrfinTone {
    if (severity === 'blocker' || severity === 'error') return 'bad';
    if (severity === 'warning') return 'wn';
    return 'nu';
  }

  async function handleAcknowledge(w: PayrollRunWarning): Promise<void> {
    setAcknowledging(w.id);
    try {
      await ackMut.mutateAsync({ warningId: w.id, note: 'Acknowledged without action' });
      void refetch();
      toast('Warning acknowledged.');
    } catch (e) {
      toast((e as Error).message ?? 'Acknowledge failed.');
    } finally {
      setAcknowledging(null);
    }
  }

  async function handleCreateTicket(w: PayrollRunWarning): Promise<void> {
    // Cross-module: open a support ticket for this warning.
    // Creates a ticket via the communications/tickets module.
    try {
      const { apiPost } = await import('@lib/api');
      await apiPost('communications/tickets/create', {
        subject:  `Payroll warning: ${humanize(w.warningType)} (run ${runId.slice(0, 8)})`,
        body:     w.message,
        priority: w.severity === 'blocker' || w.severity === 'error' ? 'high' : 'medium',
        metadata: { sourceType: 'payroll_warning', sourceId: w.id, runId },
      } as Record<string, unknown>);
      toast('Ticket created.');
    } catch (e) {
      toast((e as Error).message ?? 'Failed to create ticket.');
    }
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <HrfinPill tone={warnTone(w.severity)}>{w.severity.toUpperCase()}</HrfinPill>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{humanize(w.warningType)}</span>
              {w.resolved && <HrfinPill tone="ok">RESOLVED</HrfinPill>}
              {!w.resolved && canManage && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    class="hrfin-action"
                    style={{ fontSize: 11, padding: '3px 10px' }}
                    onClick={() => setResolving(w)}
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    class="hrfin-action"
                    style={{ fontSize: 11, padding: '3px 10px' }}
                    disabled={acknowledging === w.id || ackMut.isPending}
                    onClick={() => void handleAcknowledge(w)}
                  >
                    {acknowledging === w.id ? '…' : 'Acknowledge'}
                  </button>
                  <button
                    type="button"
                    class="hrfin-action"
                    style={{ fontSize: 11, padding: '3px 10px' }}
                    onClick={() => void handleCreateTicket(w)}
                  >
                    Create Ticket
                  </button>
                  {w.employeeId && (
                    <button
                      type="button"
                      class="hrfin-action"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                      onClick={() => {
                        // Navigate to employee profile (hash-based routing)
                        window.location.hash = `s-hr-employees?id=${w.employeeId}`;
                      }}
                    >
                      Open Profile
                    </button>
                  )}
                </div>
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
          onResolved={() => { setResolving(null); void refetch(); }}
        />
      )}
    </>
  );
}

// ── Tab: Payslips ─────────────────────────────────────────────────────────────

function PayslipsTab({ runId, canManage }: { runId: string; canManage: boolean }): VNode {
  const { data: payslips, isLoading, refetch } = useRunPayslips(runId);
  const allIds = (payslips ?? []).map(p => p.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notifying, setNotifying] = useState(false);
  const renderMut = usePayrollMutation(financePayrollApi.renderRunPayslips);
  const emailMut = usePayrollMutation(financePayrollApi.deliverRunPayslips);
  const canDistribute = can('finance.payroll.payslips.distribute');

  async function downloadPayslip(payslip: Payslip): Promise<void> {
    try {
      const url = await financePayrollApi.payslipSignedUrl({ id: payslip.id });
      window.open(url.url, '_blank', 'noopener');
    } catch (e) {
      toast((e as Error).message ?? 'Failed to get payslip URL.');
    }
  }

  async function bulkDownload(): Promise<void> {
    if (selected.size === 0) { toast('Select at least one payslip.'); return; }
    const toDownload = (payslips ?? []).filter(p => selected.has(p.id));
    for (const p of toDownload) {
      await downloadPayslip(p);
      // Brief pause to avoid browser popup blocker
      await new Promise(r => setTimeout(r, 300));
    }
    toast(`Downloaded ${toDownload.length} payslip(s).`);
  }

  async function generatePayslips(): Promise<void> {
    try {
      const r = await renderMut.mutateAsync({ runId });
      void refetch();
      toast(r.failed > 0
        ? `Rendered ${r.rendered}/${r.total} payslips — ${r.failed} failed (retry individually).`
        : `Generated ${r.rendered} payslip PDF${r.rendered === 1 ? '' : 's'}.`);
    } catch (e) {
      toast((e as Error).message ?? 'Payslip generation failed.');
    }
  }

  async function emailPayslips(): Promise<void> {
    try {
      const r = await emailMut.mutateAsync({ runId });
      const parts = [`${r.sent} sent`];
      if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
      if (r.failed > 0) parts.push(`${r.failed} failed`);
      toast(`Payslip emails: ${parts.join(', ')} of ${r.total}.`);
    } catch (e) {
      toast((e as Error).message ?? 'Emailing payslips failed.');
    }
  }

  async function resendOne(payslipId: string): Promise<void> {
    try {
      const d = await financePayrollApi.deliverPayslip({ payslipId });
      toast(d.status === 'sent' ? 'Payslip emailed.' : d.status === 'skipped' ? `Skipped: ${d.error ?? 'no email/disabled'}` : `Failed: ${d.error ?? 'send error'}`);
    } catch (e) { toast((e as Error).message ?? 'Email failed.'); }
  }

  async function notifyEmployees(): Promise<void> {
    setNotifying(true);
    try {
      const { apiPost } = await import('@lib/api');
      const res = await apiPost<{ success: boolean; data?: { notified: number }; message?: string }>(
        'finance/payroll/payslips/notify',
        { runId } as Record<string, unknown>,
      );
      if (!res.success) throw new Error(res.message ?? 'Notify failed.');
      toast(`${res.data?.notified ?? 0} employee(s) notified.`);
    } catch (e) {
      toast((e as Error).message ?? 'Failed to send notifications.');
    } finally {
      setNotifying(false);
    }
  }

  function toggleSelect(id: string): void {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    if (!payslips) return;
    setSelected(prev => prev.size === payslips.length ? new Set() : new Set(payslips.map(p => p.id)));
  }

  if (isLoading) return <div class="hrfin-empty">Loading payslips…</div>;
  if (!payslips || payslips.length === 0) return (
    <div class="hrfin-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div>No payslips yet. The run must be <strong>locked</strong> first.</div>
      {canManage && (
        <button type="button" class="hrfin-action is-primary" disabled={renderMut.isPending} onClick={() => void generatePayslips()}>
          {renderMut.isPending ? 'Generating…' : 'Generate payslips'}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Bulk toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                    padding: '8px 0', borderBottom: '1px solid var(--hrfin-border)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox"
            checked={selected.size === payslips.length && payslips.length > 0}
            onChange={toggleAll}
          />
          Select all ({payslips.length})
        </label>
        {selected.size > 0 && (
          <button type="button" class="hrfin-action is-primary" style={{ fontSize: 11 }} onClick={() => void bulkDownload()}>
            Download {selected.size} selected
          </button>
        )}
        {canManage && (
          <>
            <button type="button" class="hrfin-action is-primary" style={{ fontSize: 11 }} disabled={renderMut.isPending} onClick={() => void generatePayslips()}>
              {renderMut.isPending ? 'Generating…' : 'Generate payslips'}
            </button>
            {canDistribute && (
              <button type="button" class="hrfin-action" style={{ fontSize: 11 }} disabled={emailMut.isPending} onClick={() => void emailPayslips()}
                title="Email each rendered payslip to the employee as a password-protected PDF">
                {emailMut.isPending ? 'Emailing…' : 'Email payslips'}
              </button>
            )}
            <button type="button" class="hrfin-action" style={{ fontSize: 11 }} disabled={notifying} onClick={() => void notifyEmployees()}>
              {notifying ? 'Notifying…' : 'Notify employees'}
            </button>
          </>
        )}
      </div>

      {payslips.map((p: Payslip) => (
        <div
          key={p.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 12px',
            background: selected.has(p.id) ? 'rgba(var(--hrfin-accent-rgb,99,102,241),0.06)' : 'var(--hrfin-surface-2)',
            border: `1px solid ${selected.has(p.id) ? 'var(--hrfin-accent)' : 'var(--hrfin-border)'}`,
            borderRadius: 8,
            cursor: 'pointer',
          }}
          onClick={() => toggleSelect(p.id)}
        >
          <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} onClick={e => e.stopPropagation()} />
          <div style={{ flex: 1 }}>
            <EmployeeCellResolved resolved={nameMap?.get(p.employeeId)} fallbackId={p.employeeId} />
            <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', marginTop: 2 }}>
              {p.payslipNo} · {p.filePath
                ? <span style={{ color: '#16a34a', fontWeight: 600 }}>PDF ready</span>
                : <span style={{ color: '#b45309', fontWeight: 600 }}>PDF pending</span>}
              {' · '}Generated {fmtDateTime(p.generatedAt)}
            </div>
          </div>
          {canDistribute && p.filePath && (
            <button
              type="button"
              class="hrfin-action"
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={e => { e.stopPropagation(); void resendOne(p.id); }}
              title="Email this payslip to the employee"
            >
              Email
            </button>
          )}
          <button
            type="button"
            class="hrfin-action"
            style={{ fontSize: 11, padding: '4px 10px', opacity: p.filePath ? 1 : 0.5 }}
            disabled={!p.filePath}
            onClick={e => { e.stopPropagation(); void downloadPayslip(p); }}
          >
            Download
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Worksheet (per-employee overrides) ─────────────────────────────────────

function WorksheetTab({ runId, runStatus }: { runId: string; runStatus: string }): VNode {
  const { data: lines } = useRunLines(runId);
  const { data: overrides, isLoading } = useRunOverrides(runId);
  const empIds = (lines ?? []).map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(empIds);
  const canOverride = can('finance.payroll.worksheet.override');
  const editable = runStatus === 'input_locked' || runStatus === 'calculated';

  const addMut    = usePayrollMutation(financePayrollApi.addOverride);
  const removeMut = usePayrollMutation(financePayrollApi.removeOverride);
  const calcMut   = usePayrollMutation(financePayrollApi.calculate);

  const [empId, setEmpId]   = useState('');
  const [label, setLabel]   = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind]     = useState<'earning' | 'deduction'>('earning');
  const [reason, setReason] = useState('');

  async function add(): Promise<void> {
    const amt = parseFloat(amount);
    if (!empId) { toast('Select an employee.'); return; }
    if (!label.trim()) { toast('Enter a label.'); return; }
    if (!(amt > 0)) { toast('Amount must be greater than 0.'); return; }
    if (!reason.trim()) { toast('A reason is required.'); return; }
    try {
      await addMut.mutateAsync({ runId, employeeId: empId, label: label.trim(), amount: amt, kind, reason: reason.trim() });
      setLabel(''); setAmount(''); setReason('');
      toast('Override added — recalculate to apply it to the run.');
    } catch (e) { toast((e as Error).message ?? 'Failed to add override.'); }
  }
  async function remove(id: string): Promise<void> {
    try { await removeMut.mutateAsync({ overrideId: id }); toast('Override removed — recalculate to apply.'); }
    catch (e) { toast((e as Error).message ?? 'Failed to remove override.'); }
  }
  async function recalc(): Promise<void> {
    try { await calcMut.mutateAsync({ id: runId }); toast('Run recalculated with overrides.'); }
    catch (e) { toast((e as Error).message ?? 'Recalculate failed.'); }
  }

  const fieldStyle = { fontSize: 12, padding: '6px 8px', background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)', borderRadius: 6, color: 'var(--hrfin-text-primary)' };
  const list = overrides ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!editable && (
        <div style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>
          Overrides can only be edited while the run is input-locked or calculated (run is “{humanize(runStatus)}”).
        </div>
      )}

      {canOverride && editable && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.9fr 1.2fr 0.8fr 1.4fr auto', gap: 6, alignItems: 'end',
                      padding: '8px', border: '1px dashed var(--hrfin-border)', borderRadius: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>EMPLOYEE
            <select value={empId} onChange={e => setEmpId((e.currentTarget as HTMLSelectElement).value)} style={fieldStyle}>
              <option value="">Select…</option>
              {empIds.map(id => <option key={id} value={id}>{nameMap?.get(id)?.fullName ?? id}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>TYPE
            <select value={kind} onChange={e => setKind((e.currentTarget as HTMLSelectElement).value as 'earning' | 'deduction')} style={fieldStyle}>
              <option value="earning">Earning</option>
              <option value="deduction">Deduction</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>LABEL
            <input value={label} placeholder="e.g. Retro adjustment" onInput={e => setLabel((e.currentTarget as HTMLInputElement).value)} style={fieldStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>AMOUNT
            <input type="number" min="0.01" step="0.01" value={amount} onInput={e => setAmount((e.currentTarget as HTMLInputElement).value)} style={fieldStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>REASON
            <input value={reason} placeholder="Required" onInput={e => setReason((e.currentTarget as HTMLInputElement).value)} style={fieldStyle} />
          </label>
          <button type="button" class="hrfin-action is-primary" style={{ fontSize: 11 }} disabled={addMut.isPending} onClick={() => void add()}>
            {addMut.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}

      {isLoading ? <div class="hrfin-empty">Loading overrides…</div>
        : list.length === 0 ? <div class="hrfin-empty" style={{ padding: '14px 0' }}>No overrides on this run.</div>
        : (
          <table class="vt-table" style={{ fontSize: 12 }}>
            <thead><tr><th>Employee</th><th>Adjustment</th><th class="tc">Type</th><th class="tc">Amount</th><th>Reason</th><th /></tr></thead>
            <tbody>
              {list.map(o => (
                <tr key={o.id}>
                  <td><EmployeeCellResolved resolved={nameMap?.get(o.employeeId)} fallbackId={o.employeeId} /></td>
                  <td>{o.label}</td>
                  <td class="tc"><HrfinPill tone={o.kind === 'earning' ? 'ok' : 'wn'}>{o.kind}</HrfinPill></td>
                  <td class="tc" style={{ fontVariantNumeric: 'tabular-nums' }}>{o.kind === 'deduction' ? '−' : ''}{fmtMoney(o.amount)}</td>
                  <td style={{ color: 'var(--hrfin-text-secondary)' }}>{o.reason ?? '—'}</td>
                  <td class="tc">
                    {canOverride && editable && (
                      <button type="button" class="hrfin-action" style={{ fontSize: 10, padding: '3px 8px' }} disabled={removeMut.isPending} onClick={() => void remove(o.id)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {canOverride && editable && list.length > 0 && (
        <div>
          <button type="button" class="hrfin-action is-primary" style={{ fontSize: 11 }} disabled={calcMut.isPending} onClick={() => void recalc()}>
            {calcMut.isPending ? 'Recalculating…' : 'Recalculate run with overrides'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tab: GL (general-ledger posting) ────────────────────────────────────────────

function GlTab({ runId, runStatus }: { runId: string; runStatus: string }): VNode {
  const { data: p, isLoading } = useRunGlPreview(runId);
  const postMut    = usePayrollMutation(financePayrollApi.glPost);
  const reverseMut = usePayrollMutation(financePayrollApi.glReverse);
  const canPost = can('finance.payroll.gl.post');

  async function post(): Promise<void> {
    try {
      const r = await postMut.mutateAsync({ runId });
      toast(`GL posted: ${r.journalNo} — ${fmtMoney(r.totalDebit)} (balanced).`);
    } catch (e) { toast((e as Error).message ?? 'GL posting failed.'); }
  }
  async function reverse(): Promise<void> {
    const reason = await dialog.prompt({
      title: 'Reverse GL posting',
      text: 'Creates a reversing journal and unlinks the run so it can be re-posted after a correction.',
      placeholder: 'Reason (required)', confirmText: 'Reverse posting',
    });
    if (!reason?.trim()) return;
    try {
      const r = await reverseMut.mutateAsync({ runId, reason });
      toast(`GL reversed — ${r.reversingJournalNo}.`);
    } catch (e) { toast((e as Error).message ?? 'GL reversal failed.'); }
  }

  if (isLoading) return <div class="hrfin-empty">Loading GL…</div>;
  if (!p) return <div class="hrfin-empty">GL preview unavailable.</div>;

  const isLocked = runStatus === 'locked' || runStatus === 'exported';
  const canDoPost = canPost && !p.alreadyPosted && isLocked && p.balanced && p.missingMappings.length === 0;
  const note = (text: string, warn = false): VNode => (
    <div style={{ fontSize: 12, color: warn ? '#b45309' : 'var(--hrfin-text-secondary)', padding: '2px 0' }}>{text}</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--hrfin-border)' }}>
        {p.alreadyPosted
          ? <HrfinPill tone="ok">Posted to GL</HrfinPill>
          : <HrfinPill tone={p.balanced ? 'nu' : 'bad'}>{p.balanced ? 'Balanced · not posted' : 'Unbalanced'}</HrfinPill>}
        {p.missingMappings.length > 0 && <HrfinPill tone="bad">{p.missingMappings.length} unmapped</HrfinPill>}
        <div style={{ flex: 1 }} />
        {canPost && !p.alreadyPosted && (
          <button type="button" class="hrfin-action is-primary" style={{ fontSize: 11 }} disabled={!canDoPost || postMut.isPending} onClick={() => void post()}>
            {postMut.isPending ? 'Posting…' : 'Post to GL'}
          </button>
        )}
        {canPost && p.alreadyPosted && (
          <button type="button" class="hrfin-action" style={{ fontSize: 11 }} disabled={reverseMut.isPending} onClick={() => void reverse()}>
            {reverseMut.isPending ? 'Reversing…' : 'Reverse posting'}
          </button>
        )}
      </div>

      {!isLocked && !p.alreadyPosted && note('GL can be posted once the run is locked.')}
      {p.missingMappings.length > 0 && note('Missing account mappings: ' + p.missingMappings.join(', ') + '. Configure payroll GL mappings before posting.', true)}

      <table class="vt-table" style={{ fontSize: 12 }}>
        <thead>
          <tr><th>Account</th><th>Line</th><th class="tc">Debit</th><th class="tc">Credit</th></tr>
        </thead>
        <tbody>
          {p.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.accountCode ?? <span style={{ color: '#dc2626' }}>unmapped</span>}{l.accountName ? ` · ${l.accountName}` : ''}</td>
              <td>{humanize(l.mappingKey)}</td>
              <td class="tc" style={{ fontVariantNumeric: 'tabular-nums' }}>{l.side === 'debit' ? fmtMoney(l.amount) : ''}</td>
              <td class="tc" style={{ fontVariantNumeric: 'tabular-nums' }}>{l.side === 'credit' ? fmtMoney(l.amount) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700 }}>
            <td colSpan={2}>Totals</td>
            <td class="tc" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(p.totalDebit)}</td>
            <td class="tc" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(p.totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Tab: Exports ──────────────────────────────────────────────────────────────

function ExportsTab({ runId, canExport }: { runId: string; canExport: boolean }): VNode {
  const { data: exports, isLoading, refetch } = useRunExports(runId);
  const downloadMut = useExportDownload();
  const regenMut    = usePayrollMutation(financePayrollApi.exportRun);

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

  async function handleRegenerate(exp: PayrollExport): Promise<void> {
    try {
      await regenMut.mutateAsync({ id: exp.runId, format: exp.format });
      void refetch();
      toast(`Re-export (${exp.format.toUpperCase()}) generated.`);
    } catch (e) {
      toast((e as Error).message ?? 'Regenerate failed.');
    }
  }

  function copyId(id: string): void {
    void navigator.clipboard.writeText(id);
    toast('Export ID copied.');
  }

  if (isLoading) return <div class="hrfin-empty">Loading exports…</div>;
  if (!exports || exports.length === 0) return <div class="hrfin-empty">No exports for this run. Lock the run first, then export.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {exports.map((exp: PayrollExport) => (
        <div
          key={exp.id}
          style={{
            padding: '10px 12px',
            background: 'var(--hrfin-surface-2)',
            border: '1px solid var(--hrfin-border)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13 }}>{exp.exportNo}</b>
              {exp.isCurrent && <span style={{ marginLeft: 8 }}><HrfinPill tone="ok">Current</HrfinPill></span>}
              <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', marginTop: 2 }}>
                Format: {exp.format.toUpperCase()} · Generated {fmtDateTime(exp.generatedAt)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                class="hrfin-action"
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => void handleDownload(exp)}
                disabled={downloadMut.isPending}
              >
                {downloadMut.isPending ? '…' : 'Download'}
              </button>
              <button
                type="button"
                class="hrfin-action"
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => copyId(exp.id)}
                title={`Export ID: ${exp.id}`}
              >
                Copy ID
              </button>
              {canExport && (
                <button
                  type="button"
                  class="hrfin-action"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  disabled={regenMut.isPending}
                  onClick={() => void handleRegenerate(exp)}
                >
                  Regenerate
                </button>
              )}
            </div>
          </div>
          {/* View audit — link to audit tab */}
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer',
                     fontSize: 11, color: 'var(--hrfin-accent)', marginTop: 4, padding: 0 }}
            onClick={() => {
              // Switch to audit tab (parent state managed via the AuditTab)
              const auditBtn = document.querySelector<HTMLButtonElement>('.hrfin-tabs button[data-tab="audit"]');
              auditBtn?.click();
            }}
          >
            View audit trail →
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
        <b>{run.status === 'pending_approval' || run.approvedBy ? 'Yes' : 'No'}</b>
      </div>
      <div class="hrfin-metric-row">
        <span>Approved by</span>
        <span>{run.approvedBy ? <EmployeeCell employeeId={run.approvedBy} /> : <em style={{ color: 'var(--hrfin-text-secondary)' }}>Pending</em>}</span>
      </div>
      <div class="hrfin-metric-row">
        <span>Current status</span>
        <HrfinPill tone={runStatusTone(run.status)}>{humanize(run.status)}</HrfinPill>
      </div>
      {run.status === 'pending_approval' && (
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

// ── Tab: Audit ────────────────────────────────────────────────────────────────

function AuditTab({ runId }: { runId: string }): VNode {
  const { data: entries, isLoading } = useRunAuditLog(runId);

  if (isLoading) return <div class="hrfin-empty">Loading audit log…</div>;
  if (!entries || entries.length === 0) return <div class="hrfin-empty">No audit events recorded for this run yet.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map((e: RunAuditLogEntry) => (
        <div
          key={e.id}
          style={{
            padding: '8px 12px',
            background: 'var(--hrfin-surface-2)',
            border: '1px solid var(--hrfin-border)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }}>{e.action}</span>
            <span style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', whiteSpace: 'nowrap', marginLeft: 8 }}>
              {fmtDateTime(e.createdAt)}
            </span>
          </div>
          {e.actorId && (
            <div style={{ marginTop: 2, fontSize: 11, color: 'var(--hrfin-text-secondary)' }}>
              by <EmployeeCell employeeId={e.actorId} />
            </div>
          )}
          {e.reason && (
            <div style={{ marginTop: 2, fontSize: 11, color: 'var(--hrfin-text-secondary)' }}>
              Reason: {e.reason}
            </div>
          )}
          {e.newState && Object.keys(e.newState).length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--hrfin-text-secondary)' }}>
                State change
              </summary>
              <pre style={{ fontSize: 10, margin: '4px 0 0', color: 'var(--hrfin-text-secondary)',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(e.newState, null, 2)}
              </pre>
            </details>
          )}
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
      {s === 'draft'           && canManage  && <button class="hrfin-action is-primary" onClick={() => actions.onLockInputs(run)}>Lock Inputs</button>}
      {s === 'input_locked'   && canManage  && <button class="hrfin-action is-primary" onClick={() => actions.onCalculate(run)}>Calculate</button>}
      {s === 'calculated'     && canManage  && <button class="hrfin-action is-primary" onClick={() => actions.onSubmit(run)}>Submit for Approval</button>}
      {s === 'pending_approval' && canApprove && <button class="hrfin-action is-primary" onClick={() => actions.onApprove(run)}>Approve</button>}
      {s === 'pending_approval' && canApprove && <button class="hrfin-action is-danger"  onClick={() => actions.onReject(run)}>Reject</button>}
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
                <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--hrfin-accent)' }}>{fmtMoney(run.netTotal)}</div>
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
            {tab === 'inputs'    && <InputsTab runId={run.id} runStatus={run.status} canManage={canManage} />}
            {tab === 'worksheet' && <WorksheetTab runId={run.id} runStatus={run.status} />}
            {tab === 'warnings'  && <WarningsTab runId={run.id} canManage={canManage} />}
            {tab === 'payslips'  && <PayslipsTab runId={run.id} canManage={canManage} />}
            {tab === 'exports'   && <ExportsTab runId={run.id} canExport={canApprove || canManage} />}
            {tab === 'gl'        && <GlTab runId={run.id} runStatus={run.status} />}
            {tab === 'approvals' && <ApprovalsTab run={run} />}
            {tab === 'timeline'  && <TimelineTab run={run} />}
            {tab === 'audit'     && <AuditTab runId={run.id} />}
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
