/**
 * src/components/sections/Finance/payRunDetail/interactiveTabs.tsx
 *
 * The interactive run-detail tab bodies, moved verbatim from the retired
 * PayRunDrawer so the full-page run workspace (PayRunDetailPage) can reuse them
 * without duplication: Inputs, Worksheet (overrides / mass-edit / back-pay),
 * Warnings, Payslips, GL, Exports, Related (disbursement / remittance bridges),
 * plus Run Lines. Each keeps its original wiring, permissions, and mutations.
 */

import { type VNode } from 'preact';
import { useState, useMemo, useRef } from 'preact/hooks';
import { toast } from '@store';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { HrfinPill, type HrfinTone } from '@ui';
import { openHrEmployee } from '../../HR/hrDeepLink';
import { PayrollPanelState } from './PanelState';
import {
  useRunLines,
  useRunInputs,
  useRunWarnings,
  useRunPayslips,
  useRunExports,
  useRunGlPreview,
  useRunOverrides,
  useExportDownload,
  usePayslipTemplates,
  useSetRunTemplate,
  type PayrollRun,
  type PayrollRunLine,
  type PayrollRunInput,
  type PayrollRunWarning,
  type Payslip,
  type PayrollExport,
  financePayrollApi,
  usePayrollMutation,
} from '@api/finance/payroll';
import { useEmployeeNames } from '@api/finance/lookups';
import { EmployeeCellResolved, EmployeeCell } from '../_shared/EmployeeCell';
import { PayWarningResolveDialog } from '../PayWarningResolveDialog';
import { fmtMoney, fmtDate, humanize } from '../financeShared';

// ── Shared lifecycle helpers (also used by the page header) ─────────────────────

export function runStatusTone(status: string): HrfinTone {
  switch (status) {
    case 'locked':
    case 'approved':
    case 'released':
      return 'ok';
    case 'pending_approval':
    case 'calculated':
    case 'input_locked':
      return 'wn';
    case 'returned':
    case 'cancelled':
    case 'calculation_failed':
      return 'bad';
    default:
      return 'nu';
  }
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Lifecycle actions surfaced in the page header (Run Actions) + panels. */
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

// ── Run Lines ───────────────────────────────────────────────────────────────────

export function RunLinesTab({ runId }: { runId: string }): VNode {
  const { data: lines, isLoading, isError, error, refetch } = useRunLines(runId);
  const allIds = (lines ?? []).map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);

  // P1-7: loading / error / truthful-empty are distinct — an API failure must
  // never render as "No run lines".
  if (isLoading || isError || !lines?.length) {
    return <PayrollPanelState loading={isLoading} error={isError ? error : undefined}
      onRetry={() => void refetch()} empty label="run lines"
      emptyText="No run lines — run Calculate first." />;
  }

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
                <EmployeeCellResolved resolved={nameMap?.get(line.employeeId)} fallbackId={line.employeeId} />
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

// ── Inputs ──────────────────────────────────────────────────────────────────────

export function InputsTab({ runId, runStatus, canManage }: { runId: string; runStatus: string; canManage: boolean }): VNode {
  const { data: inputs, isLoading, isError, error, refetch } = useRunInputs(runId);
  const allIds = (inputs ?? []).map(i => i.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);
  const canEditInputs = canManage && runStatus === 'input_locked';

  if (isLoading || isError || !inputs?.length) {
    return <PayrollPanelState loading={isLoading} error={isError ? error : undefined}
      onRetry={() => void refetch()} empty label="input snapshot"
      emptyText="No inputs snapshotted — run Lock Inputs first." />;
  }

  async function handleEditAmount(inp: PayrollRunInput): Promise<void> {
    const raw = await dialog.prompt({
      title: `Edit amount — ${inp.label ?? inp.componentCode ?? inp.sourceType}`,
      text: `Current value: ${inp.amount ?? 0}`,
      value: String(inp.amount ?? 0),
      placeholder: 'Enter new amount',
      type: 'number',
      confirmText: 'Update',
    });
    if (raw == null) return;
    const val = parseFloat(raw);
    if (isNaN(val)) { toast('Invalid amount — please enter a number.'); return; }
    try {
      const { apiPost } = await import('@lib/api');
      await apiPost('finance/payroll/inputs/edit', { inputId: inp.id, amount: val });
      toast('Input updated.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update input.');
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
      await apiPost('finance/payroll/inputs/exclude', { inputId: inp.id });
      toast('Input excluded from run.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Exclude failed.');
    }
  }

  function handleViewSource(inp: PayrollRunInput): void {
    if (!inp.sourceId) { toast('No source record linked to this input.'); return; }
    // Employee-scoped sources open the real HR profile deep-link; the attendance /
    // compensation sub-records still route by hash to their own sections.
    if (inp.sourceType === 'overtime') { window.location.hash = `s-hr-attendance?id=${inp.sourceId}`; return; }
    if (inp.sourceType === 'pay_item') { window.location.hash = `s-hr-compensation?id=${inp.sourceId}`; return; }
    if (inp.employeeId) { openHrEmployee(inp.employeeId); return; }
    toast('No employee linked to this input.');
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

// ── Warnings ──────────────────────────────────────────────────────────────────

export function WarningsTab({ runId, canManage }: { runId: string; canManage: boolean }): VNode {
  const { data: warnings, isLoading, isError, error, refetch } = useRunWarnings(runId);
  const [resolving,     setResolving]     = useState<PayrollRunWarning | null>(null);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const ackMut = usePayrollMutation(financePayrollApi.resolveWarning);

  // "No warnings" is a CONTROL claim — it may only render after a successful
  // empty response, never as the face of an outage (P1-7).
  if (isLoading || isError || !warnings?.length) {
    return <PayrollPanelState loading={isLoading} error={isError ? error : undefined}
      onRetry={() => void refetch()} empty label="warnings"
      emptyText="No warnings for this run." />;
  }

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
      toast(e instanceof Error ? e.message : 'Acknowledge failed.');
    } finally {
      setAcknowledging(null);
    }
  }

  async function handleCreateTicket(w: PayrollRunWarning): Promise<void> {
    try {
      const { apiPost } = await import('@lib/api');
      await apiPost('communications/tickets/create', {
        subject:  `Payroll warning: ${humanize(w.warningType)} (run ${runId.slice(0, 8)})`,
        body:     w.message,
        priority: w.severity === 'blocker' || w.severity === 'error' ? 'high' : 'medium',
        metadata: { sourceType: 'payroll_warning', sourceId: w.id, runId },
      });
      toast('Ticket created.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to create ticket.');
    }
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {warnings.map((w: PayrollRunWarning) => (
          <div key={w.id}
            style={{ padding: '10px 12px', background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                     borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <HrfinPill tone={warnTone(w.severity)}>{w.severity.toUpperCase()}</HrfinPill>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{humanize(w.warningType)}</span>
              {w.resolved && <HrfinPill tone="ok">RESOLVED</HrfinPill>}
              {!w.resolved && canManage && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button type="button" class="hrfin-action" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setResolving(w)}>
                    Resolve
                  </button>
                  <button type="button" class="hrfin-action" style={{ fontSize: 11, padding: '3px 10px' }}
                    disabled={acknowledging === w.id || ackMut.isPending} onClick={() => void handleAcknowledge(w)}>
                    {acknowledging === w.id ? '…' : 'Acknowledge'}
                  </button>
                  <button type="button" class="hrfin-action" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => void handleCreateTicket(w)}>
                    Create Ticket
                  </button>
                  {w.employeeId && (
                    <button type="button" class="hrfin-action" style={{ fontSize: 11, padding: '3px 10px' }}
                      onClick={() => openHrEmployee(w.employeeId!)}>
                      Open Profile
                    </button>
                  )}
                </div>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>{w.message}</p>
            {w.employeeId && (
              <div style={{ fontSize: 11 }}>Employee: <EmployeeCell employeeId={w.employeeId} /></div>
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

// ── Payslips ──────────────────────────────────────────────────────────────────

export function PayslipsTab({ run, canManage }: { run: PayrollRun; canManage: boolean }): VNode {
  const runId = run.id;
  const { data: payslips, isLoading, isError, error, refetch } = useRunPayslips(runId);
  const allIds = (payslips ?? []).map(p => p.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notifying, setNotifying] = useState(false);
  const renderMut = usePayrollMutation(financePayrollApi.renderRunPayslips);
  const emailMut = usePayrollMutation(financePayrollApi.deliverRunPayslips);
  const canDistribute = can('finance.payroll.payslips.distribute');
  const { data: templates } = usePayslipTemplates();
  const setTemplateMut = useSetRunTemplate();

  async function downloadPayslip(payslip: Payslip): Promise<void> {
    try {
      const url = await financePayrollApi.payslipSignedUrl({ id: payslip.id });
      window.open(url.url, '_blank', 'noopener');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to get payslip URL.');
    }
  }

  async function bulkDownload(): Promise<void> {
    if (selected.size === 0) { toast('Select at least one payslip.'); return; }
    const toDownload = (payslips ?? []).filter(p => selected.has(p.id));
    for (const p of toDownload) {
      await downloadPayslip(p);
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
      toast(e instanceof Error ? e.message : 'Payslip generation failed.');
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
      toast(e instanceof Error ? e.message : 'Emailing payslips failed.');
    }
  }

  async function resendOne(payslipId: string): Promise<void> {
    try {
      const d = await financePayrollApi.deliverPayslip({ payslipId });
      toast(d.status === 'sent' ? 'Payslip emailed.' : d.status === 'skipped' ? `Skipped: ${d.error ?? 'no email/disabled'}` : `Failed: ${d.error ?? 'send error'}`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Email failed.'); }
  }

  async function notifyEmployees(): Promise<void> {
    setNotifying(true);
    try {
      const { apiPost } = await import('@lib/api');
      const res = await apiPost<{ success: boolean; data?: { notified: number }; message?: string }>(
        'finance/payroll/payslips/notify', { runId });
      if (!res.success) throw new Error(res.message ?? 'Notify failed.');
      toast(`${res.data?.notified ?? 0} employee(s) notified.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to send notifications.');
    } finally {
      setNotifying(false);
    }
  }

  function toggleSelect(id: string): void {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleAll(): void {
    if (!payslips) return;
    setSelected(prev => prev.size === payslips.length ? new Set() : new Set(payslips.map(p => p.id)));
  }

  if (isLoading || isError) {
    return <PayrollPanelState loading={isLoading} error={isError ? error : undefined}
      onRetry={() => void refetch()} label="payslips" />;
  }
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

  async function handleTemplateChange(e: Event): Promise<void> {
    const val = (e.target as HTMLSelectElement).value;
    const templateId = val === '' ? null : val;
    try {
      await setTemplateMut.mutateAsync({ runId, templateId });
      toast(templateId ? 'Template updated.' : 'Reverted to active default template.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update template.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {canManage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--hrfin-border)' }}>
          <label style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', whiteSpace: 'nowrap' }}>Payslip template:</label>
          <select class="hrfin-input" style={{ fontSize: 12, padding: '4px 8px', flex: 1, maxWidth: 280 }}
            value={run.templateId ?? ''} onChange={e => void handleTemplateChange(e)} disabled={setTemplateMut.isPending}>
            <option value="">Active default</option>
            {(templates ?? []).map(t => (
              <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>
            ))}
          </select>
          {setTemplateMut.isPending && <span style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)' }}>Saving…</span>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--hrfin-border)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={selected.size === payslips.length && payslips.length > 0} onChange={toggleAll} />
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
        <div key={p.id}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                   background: selected.has(p.id) ? 'rgba(var(--hrfin-accent-rgb,99,102,241),0.06)' : 'var(--hrfin-surface-2)',
                   border: `1px solid ${selected.has(p.id) ? 'var(--hrfin-accent)' : 'var(--hrfin-border)'}`,
                   borderRadius: 8, cursor: 'pointer' }}
          onClick={() => toggleSelect(p.id)}>
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
            <button type="button" class="hrfin-action" style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={e => { e.stopPropagation(); void resendOne(p.id); }} title="Email this payslip to the employee">
              Email
            </button>
          )}
          <button type="button" class="hrfin-action" style={{ fontSize: 11, padding: '4px 10px', opacity: p.filePath ? 1 : 0.5 }}
            disabled={!p.filePath} onClick={e => { e.stopPropagation(); void downloadPayslip(p); }}>
            Download
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Worksheet (per-employee overrides) ──────────────────────────────────────────

export function WorksheetTab({ runId, runStatus }: { runId: string; runStatus: string }): VNode {
  const { data: lines } = useRunLines(runId);
  const { data: overrides, isLoading, isError: ovIsError, error: ovError, refetch: ovRefetch } = useRunOverrides(runId);
  const empIds = (lines ?? []).map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(empIds);
  const canOverride = can('finance.payroll.worksheet.override');
  const editable = runStatus === 'input_locked' || runStatus === 'calculated';

  const addMut    = usePayrollMutation(financePayrollApi.addOverride);
  const removeMut = usePayrollMutation(financePayrollApi.removeOverride);
  const calcMut   = usePayrollMutation(financePayrollApi.calculate);
  const recalcKeyRef = useRef<string | null>(null);

  const [empId, setEmpId]   = useState('');
  const [label, setLabel]   = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind]     = useState<'earning' | 'deduction'>('earning');
  const [reason, setReason] = useState('');

  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [massEdit, setMassEdit] = useState(false);
  const [backPayOpen, setBackPayOpen] = useState(false);

  const overrideCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of overrides ?? []) m.set(o.employeeId, (m.get(o.employeeId) ?? 0) + 1);
    return m;
  }, [overrides]);

  const gridRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (lines ?? []).map(l => ({
      employeeId: l.employeeId,
      name:       nameMap?.get(l.employeeId)?.fullName ?? l.employeeId,
      gross:      l.gross,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DB numeric columns typed non-null but may be null in legacy rows
      deductions: (l.paye ?? 0) + (l.nisEmployee ?? 0) + (l.healthSurcharge ?? 0) + (l.voluntaryDeductions ?? 0),
      net:        l.net,
      ovr:        overrideCount.get(l.employeeId) ?? 0,
    }));
    return q ? rows.filter(r => r.name.toLowerCase().includes(q) || r.employeeId.toLowerCase().includes(q)) : rows;
  }, [lines, nameMap, overrideCount, search]);

  const allFilteredSelected = gridRows.length > 0 && gridRows.every(r => selected.has(r.employeeId));
  const toggleOne = (id: string): void => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = (): void => setSelected(prev => {
    const n = new Set(prev);
    if (allFilteredSelected) gridRows.forEach(r => n.delete(r.employeeId));
    else gridRows.forEach(r => n.add(r.employeeId));
    return n;
  });

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
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to add override.'); }
  }
  async function remove(id: string): Promise<void> {
    try { await removeMut.mutateAsync({ overrideId: id }); toast('Override removed — recalculate to apply.'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed to remove override.'); }
  }
  async function recalc(): Promise<void> {
    // Idempotency: stable key per recalc ATTEMPT (held across retries; cleared on success).
    const key = recalcKeyRef.current ?? crypto.randomUUID();
    recalcKeyRef.current = key;
    try {
      await calcMut.mutateAsync({ id: runId, idempotencyKey: key });
      recalcKeyRef.current = null;
      toast('Run recalculated with overrides.');
    } catch (e) { toast(e instanceof Error ? e.message : 'Recalculate failed.'); }
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

      {(lines?.length ?? 0) > 0 && (
        <div style={{ border: '1px solid var(--hrfin-border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8, borderBottom: '1px solid var(--hrfin-border)' }}>
            <input value={search} placeholder="Filter employees…" onInput={e => setSearch((e.currentTarget).value)} style={{ ...fieldStyle, flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', whiteSpace: 'nowrap' }}>{selected.size} selected · {gridRows.length} shown</span>
            {canOverride && editable && (
              <button type="button" class="hrfin-action" style={{ fontSize: 11 }} onClick={() => setBackPayOpen(true)}>Back pay</button>
            )}
            {canOverride && editable && (
              <button type="button" class="hrfin-action is-primary" style={{ fontSize: 11 }} disabled={selected.size === 0} onClick={() => setMassEdit(true)}>
                Mass-edit ({selected.size})
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--hrfin-text-secondary)', borderBottom: '1px solid var(--hrfin-border)' }}>
            <span style={{ width: 28 }}>{canOverride && editable && <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} aria-label="Select all" />}</span>
            <span style={{ flex: 1 }}>Employee</span>
            <span style={{ width: 88, textAlign: 'right' }}>Gross</span>
            <span style={{ width: 88, textAlign: 'right' }}>Deductions</span>
            <span style={{ width: 88, textAlign: 'right' }}>Net</span>
            <span style={{ width: 40, textAlign: 'center' }}>Ovr</span>
          </div>
          <WorksheetVirtualRows rows={gridRows} rowHeight={32} viewportHeight={300} selectable={canOverride && editable} selected={selected} onToggle={toggleOne} />
        </div>
      )}

      {canOverride && editable && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.9fr 1.2fr 0.8fr 1.4fr auto', gap: 6, alignItems: 'end', padding: '8px', border: '1px dashed var(--hrfin-border)', borderRadius: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>EMPLOYEE
            <select value={empId} onChange={e => setEmpId((e.currentTarget).value)} style={fieldStyle}>
              <option value="">Select…</option>
              {empIds.map(id => <option key={id} value={id}>{nameMap?.get(id)?.fullName ?? id}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>TYPE
            <select value={kind} onChange={e => setKind((e.currentTarget).value as 'earning' | 'deduction')} style={fieldStyle}>
              <option value="earning">Earning</option>
              <option value="deduction">Deduction</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>LABEL
            <input value={label} placeholder="e.g. Retro adjustment" onInput={e => setLabel((e.currentTarget).value)} style={fieldStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>AMOUNT
            <input type="number" min="0.01" step="0.01" value={amount} onInput={e => setAmount((e.currentTarget).value)} style={fieldStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>REASON
            <input value={reason} placeholder="Required" onInput={e => setReason((e.currentTarget).value)} style={fieldStyle} />
          </label>
          <button type="button" class="hrfin-action is-primary" style={{ fontSize: 11 }} disabled={addMut.isPending} onClick={() => void add()}>
            {addMut.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}

      {isLoading || ovIsError ? (
        <PayrollPanelState loading={isLoading} error={ovIsError ? ovError : undefined}
          onRetry={() => void ovRefetch()} label="worksheet overrides" />
      )
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

      {massEdit && (
        <MassEditModal runId={runId} employeeIds={[...selected]} onClose={() => setMassEdit(false)}
          onApplied={() => { setMassEdit(false); setSelected(new Set()); }} />
      )}
      {backPayOpen && (
        <BackPayModal runId={runId} employeeIds={empIds} nameMap={nameMap}
          onClose={() => setBackPayOpen(false)} onApplied={() => setBackPayOpen(false)} />
      )}
    </div>
  );
}

function BackPayModal({ runId, employeeIds, nameMap, onClose, onApplied }: {
  runId: string; employeeIds: string[];
  nameMap: Map<string, { fullName: string }> | undefined;
  onClose: () => void; onApplied: () => void;
}): VNode {
  const previewMut = usePayrollMutation(financePayrollApi.backPayPreview);
  const addMut     = usePayrollMutation(financePayrollApi.backPayAdd);
  const [empId, setEmpId]   = useState('');
  const [fromMonth, setFrom] = useState('');
  const [effectiveDate, setEffDate] = useState('');
  const [base, setBase]     = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<import('@api/finance/payroll').BackPayBreakdown | null>(null);

  const fromPeriodMonth = fromMonth ? `${fromMonth}-01` : '';
  const correctedPeriodBase = parseFloat(base);
  const effDate = effectiveDate || undefined;
  const canPreview = !!empId && !!fromPeriodMonth && correctedPeriodBase > 0;
  const canAdd = canPreview && !!reason.trim() && !!preview && preview.totalDelta > 0;
  const fieldStyle = { fontSize: 12, padding: '6px 8px', background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)', borderRadius: 6, color: 'var(--hrfin-text-primary)', width: '100%' };

  async function runPreview(): Promise<void> {
    if (!canPreview) return;
    try { const r = await previewMut.mutateAsync({ currentRunId: runId, employeeId: empId, fromPeriodMonth, correctedPeriodBase, effectiveDate: effDate }); setPreview(r); }
    catch (e) { toast(e instanceof Error ? e.message : 'Preview failed.'); setPreview(null); }
  }
  async function apply(): Promise<void> {
    if (!canAdd) return;
    try {
      await addMut.mutateAsync({ currentRunId: runId, employeeId: empId, fromPeriodMonth, correctedPeriodBase, reason: reason.trim(), effectiveDate: effDate });
      toast('Back pay added — recalculate to apply it to the run.');
      onApplied();
    } catch (e) { toast(e instanceof Error ? e.message : 'Back pay failed.'); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--hrfin-surface-1, #fff)', border: '1px solid var(--hrfin-border)', borderRadius: 12, padding: 18, width: 480, maxWidth: '92vw' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--hrfin-text-primary)' }}>Back pay (retro adjustment)</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>
          Recomputes the employee's base for prior finalised periods against a corrected per-period base and pays the delta on this run, taxed at this period's rates. Prior runs are not changed.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>EMPLOYEE
            <select value={empId} onChange={e => { setEmpId((e.currentTarget).value); setPreview(null); }} style={fieldStyle}>
              <option value="">Select…</option>
              {employeeIds.map(id => <option key={id} value={id}>{nameMap?.get(id)?.fullName ?? id}</option>)}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>FROM PERIOD
              <input type="month" value={fromMonth} onInput={e => { setFrom((e.currentTarget).value); setPreview(null); }} style={fieldStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>CORRECTED BASE / PERIOD
              <input type="number" min="0.01" step="0.01" value={base} onInput={e => { setBase((e.currentTarget).value); setPreview(null); }} style={fieldStyle} />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>
            EFFECTIVE DATE (optional — when the correction became effective)
            <input type="date" value={effectiveDate} onInput={e => { setEffDate((e.currentTarget).value); setPreview(null); }} style={fieldStyle} />
            <span style={{ fontSize: 9, color: 'var(--hrfin-text-secondary)' }}>Leave blank to use the FROM PERIOD as the effective date. Stored in the audit trail.</span>
          </label>
          <button type="button" class="hrfin-action" style={{ fontSize: 11, alignSelf: 'flex-start' }} disabled={!canPreview || previewMut.isPending} onClick={() => void runPreview()}>
            {previewMut.isPending ? 'Computing…' : 'Preview delta'}
          </button>

          {preview && (
            <div style={{ border: '1px solid var(--hrfin-border)', borderRadius: 8, padding: 10, fontSize: 12 }}>
              {preview.periods.length === 0 ? (
                <span style={{ color: 'var(--hrfin-text-secondary)' }}>No finalised runs for this employee in the selected range.</span>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginBottom: 6 }}>
                    <span>{preview.periods.length} period(s)</span>
                    <span>Total back pay: {fmtMoney(preview.totalDelta)}</span>
                  </div>
                  {preview.periods.map(p => (
                    <div key={p.runId} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--hrfin-text-secondary)' }}>
                      <span>{p.periodMonth}</span>
                      <span>{fmtMoney(p.oldBase)} → {fmtMoney(p.correctedBase)} = +{fmtMoney(p.delta)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>REASON (required)
            <input value={reason} placeholder="Audit-logged" onInput={e => setReason((e.currentTarget).value)} style={fieldStyle} />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" class="hrfin-action" onClick={onClose}>Cancel</button>
          <button type="button" class="hrfin-action is-primary" disabled={!canAdd || addMut.isPending} onClick={() => void apply()}>
            {addMut.isPending ? 'Adding…' : preview ? `Add back pay (${fmtMoney(preview.totalDelta)})` : 'Add back pay'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface GridRow { employeeId: string; name: string; gross: number; deductions: number; net: number; ovr: number }

function WorksheetVirtualRows({ rows, rowHeight, viewportHeight, selectable, selected, onToggle }: {
  rows: GridRow[]; rowHeight: number; viewportHeight: number; selectable: boolean;
  selected: Set<string>; onToggle: (id: string) => void;
}): VNode {
  const [scrollTop, setScrollTop] = useState(0);
  const overscan = 8;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end   = Math.min(rows.length, start + Math.ceil(viewportHeight / rowHeight) + overscan * 2);
  const padTop = start * rowHeight;
  const padBottom = Math.max(0, (rows.length - end) * rowHeight);

  if (rows.length === 0) return <div class="hrfin-empty" style={{ padding: 14 }}>No employees match the filter.</div>;

  return (
    <div style={{ maxHeight: viewportHeight, overflowY: 'auto' }} onScroll={e => setScrollTop((e.currentTarget).scrollTop)}>
      <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
        {rows.slice(start, end).map(r => (
          <div key={r.employeeId} style={{ display: 'flex', alignItems: 'center', height: rowHeight, padding: '0 8px', fontSize: 12, borderBottom: '1px solid var(--hrfin-border)' }}>
            <span style={{ width: 28 }}>{selectable && <input type="checkbox" checked={selected.has(r.employeeId)} onChange={() => onToggle(r.employeeId)} aria-label={`Select ${r.name}`} />}</span>
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
            <span style={{ width: 88, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.gross)}</span>
            <span style={{ width: 88, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--hrfin-text-secondary)' }}>{fmtMoney(r.deductions)}</span>
            <span style={{ width: 88, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtMoney(r.net)}</span>
            <span style={{ width: 40, textAlign: 'center' }}>{r.ovr > 0 ? <HrfinPill tone="ok">{String(r.ovr)}</HrfinPill> : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MassEditModal({ runId, employeeIds, onClose, onApplied }: {
  runId: string; employeeIds: string[]; onClose: () => void; onApplied: () => void;
}): VNode {
  const bulkMut = usePayrollMutation(financePayrollApi.addOverridesBulk);
  const [label, setLabel]   = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind]     = useState<'earning' | 'deduction'>('earning');
  const [reason, setReason] = useState('');
  const amt = parseFloat(amount);
  const valid = !!label.trim() && amt > 0 && !!reason.trim() && employeeIds.length > 0;
  const fieldStyle = { fontSize: 12, padding: '6px 8px', background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)', borderRadius: 6, color: 'var(--hrfin-text-primary)', width: '100%' };

  async function apply(): Promise<void> {
    if (!valid) return;
    try {
      const res = await bulkMut.mutateAsync({ runId, employeeIds, label: label.trim(), amount: amt, kind, reason: reason.trim() });
      toast(`Adjustment applied to ${res.applied} employee(s)${res.skipped ? `, ${res.skipped} skipped` : ''} — recalculate to apply.`);
      onApplied();
    } catch (e) { toast(e instanceof Error ? e.message : 'Mass-edit failed.'); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--hrfin-surface-1, #fff)', border: '1px solid var(--hrfin-border)', borderRadius: 12, padding: 18, width: 440, maxWidth: '92vw' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--hrfin-text-primary)' }}>Mass-edit — {employeeIds.length} employee{employeeIds.length === 1 ? '' : 's'}</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>
          Applies one earning or deduction to every selected employee. Employees not on this run are skipped. Recalculate to apply.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>LABEL
            <input value={label} placeholder="e.g. COLA allowance" onInput={e => setLabel((e.currentTarget).value)} style={fieldStyle} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>TYPE
              <select value={kind} onChange={e => setKind((e.currentTarget).value as 'earning' | 'deduction')} style={fieldStyle}>
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>AMOUNT (each)
              <input type="number" min="0.01" step="0.01" value={amount} onInput={e => setAmount((e.currentTarget).value)} style={fieldStyle} />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--hrfin-text-secondary)' }}>REASON (required)
            <input value={reason} placeholder="Audit-logged" onInput={e => setReason((e.currentTarget).value)} style={fieldStyle} />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" class="hrfin-action" onClick={onClose}>Cancel</button>
          <button type="button" class="hrfin-action is-primary" disabled={!valid || bulkMut.isPending} onClick={() => void apply()}>
            {bulkMut.isPending ? 'Applying…' : `Apply to ${employeeIds.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── GL (general-ledger posting) ─────────────────────────────────────────────────

export function GlTab({ runId, runStatus }: { runId: string; runStatus: string }): VNode {
  const { data: p, isLoading, isError, error, refetch } = useRunGlPreview(runId);
  const postMut    = usePayrollMutation(financePayrollApi.glPost);
  const reverseMut = usePayrollMutation(financePayrollApi.glReverse);
  const canPost = can('finance.payroll.gl.post');

  async function post(): Promise<void> {
    try {
      const r = await postMut.mutateAsync({ runId });
      toast(`GL posted: ${r.journalNo} — ${fmtMoney(r.totalDebit)} (balanced).`);
    } catch (e) { toast(e instanceof Error ? e.message : 'GL posting failed.'); }
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
    } catch (e) { toast(e instanceof Error ? e.message : 'GL reversal failed.'); }
  }

  // "GL unavailable" was the doc's cited failure-masking symptom — an API error
  // now renders as an ERROR with retry + correlation id, never as absence (P1-7).
  if (isLoading || isError || !p) {
    return <PayrollPanelState loading={isLoading} error={isError ? error : undefined}
      onRetry={() => void refetch()} empty label="GL preview"
      emptyText="No GL preview — the run needs a calculated version first." />;
  }

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

// ── Exports ─────────────────────────────────────────────────────────────────────

export function ExportsTab({ runId, canExport }: { runId: string; canExport: boolean }): VNode {
  const { data: exports, isLoading, isError, error, refetch } = useRunExports(runId);
  const downloadMut = useExportDownload();
  const regenMut    = usePayrollMutation(financePayrollApi.exportRun);
  const regenKeys   = useRef<Map<string, string>>(new Map());

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
      toast(e instanceof Error ? e.message : 'Download failed.');
    }
  }

  async function handleRegenerate(exp: PayrollExport): Promise<void> {
    // Idempotency: one stable key per regenerate ATTEMPT (per run+format), held across
    // retries so a lost response recovers via the receipt; cleared on success. A later
    // intentional re-export mints a NEW key (source data may have changed).
    const mapKey = `${exp.runId}:${exp.format}`;
    const keys = regenKeys.current;
    const key = keys.get(mapKey) ?? crypto.randomUUID();
    keys.set(mapKey, key);
    try {
      await regenMut.mutateAsync({ id: exp.runId, format: exp.format, idempotencyKey: key });
      keys.delete(mapKey);
      void refetch();
      toast(`Re-export (${exp.format.toUpperCase()}) generated.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Regenerate failed.');
    }
  }

  function copyId(id: string): void {
    void navigator.clipboard.writeText(id);
    toast('Export ID copied.');
  }

  if (isLoading || isError || !exports?.length) {
    return <PayrollPanelState loading={isLoading} error={isError ? error : undefined}
      onRetry={() => void refetch()} empty label="exports"
      emptyText="No exports for this run yet. A released run can be exported." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {exports.map((exp: PayrollExport) => (
        <div key={exp.id} style={{ padding: '10px 12px', background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13 }}>{exp.exportNo}</b>
              {exp.isCurrent && <span style={{ marginLeft: 8 }}><HrfinPill tone="ok">Current</HrfinPill></span>}
              <div style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', marginTop: 2 }}>
                Format: {exp.format.toUpperCase()} · Generated {fmtDateTime(exp.generatedAt)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" class="hrfin-action" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => void handleDownload(exp)} disabled={downloadMut.isPending}>
                {downloadMut.isPending ? '…' : 'Download'}
              </button>
              <button type="button" class="hrfin-action" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => copyId(exp.id)} title={`Export ID: ${exp.id}`}>
                Copy ID
              </button>
              {canExport && (
                <button type="button" class="hrfin-action" style={{ fontSize: 11, padding: '4px 10px' }} disabled={regenMut.isPending} onClick={() => void handleRegenerate(exp)}>
                  Regenerate
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
