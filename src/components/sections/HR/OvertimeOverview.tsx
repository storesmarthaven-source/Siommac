/**
 * src/components/sections/HR/OvertimeOverview.tsx
 *
 * HR ▸ Overtime (nav id `s-hr-overtime`).
 * A review/approve queue over the real `hr/overtime/*` backend: managers/HR approve,
 * reject or cancel submitted overtime; approved OT feeds payroll and becomes immutable
 * once paid. The "Log overtime" form self-submits (the submit endpoint is self-scoped —
 * an employee can only submit their own OT).
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import { useOvertimeEntries, useOvertimeMutation, hrOvertimeApi, type OvertimeEntry } from '@api/hr/overtime';
import { openActionModal, rejectAction, cancelAction, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import { useHrEmployees, type HrEmployeeRow } from '@api/hr/employees';
import { fmtDate, humanize, statusTone } from '../Finance/financeShared';
import '../Finance/finance.css';

const empName = (e: HrEmployeeRow): string => e.display_name || e.full_name || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.username || e.id;

const STATUS_FILTERS = ['submitted', 'approved', 'rejected', 'paid', 'cancelled'] as const;

export function OvertimeOverview(): VNode {
  const [status, setStatus] = useState<string>('submitted');
  const entriesQ = useOvertimeEntries(status ? { status } : {});
  const empsQ = useHrEmployees({ limit: 500 });
  const nameOf = useMemo(() => {
    const m = new Map((empsQ.data ?? []).map(e => [e.id, empName(e)]));
    return (id: string) => m.get(id) ?? id;
  }, [empsQ.data]);

  const approveMut = useOvertimeMutation(hrOvertimeApi.approveOvertime);
  const rejectMut  = useOvertimeMutation(hrOvertimeApi.rejectOvertime);
  const cancelMut  = useOvertimeMutation(hrOvertimeApi.cancelOvertime);
  const canApprove = can('hr.overtime.approve');
  const canSubmit  = can('hr.overtime.submit');
  const [showForm, setShowForm] = useState(false);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; dialog.success(ok); } catch (e) { dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  const otRecord = (e: OvertimeEntry) => toActionRecord({
    title: `${e.hours}h × ${e.multiplier} overtime`, subtitle: `${nameOf(e.employeeId)} · ${fmtDate(e.workDate)}`, icon: 'fa-clock',
    badges: [statusBadge(e.status)],
    fields: [
      e.overtimeNo ? { label: 'OT #', value: e.overtimeNo } : null,
      e.reason ? { label: 'Reason', value: e.reason } : null,
    ],
  });

  const entries = entriesQ.data ?? [];
  const STAT_ROW = [
    { label: 'Pending approval', val: entries.filter(e => e.status === 'submitted').length },
    { label: 'Approved',         val: entries.filter(e => e.status === 'approved').length },
    { label: 'Total hours',      val: entries.reduce((s, e) => s + (e.hours || 0), 0) },
  ];

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader
        icon="fa-clock" module="HR · Overtime" title="Overtime"
        sub="Review, approve and track overtime. Approved overtime feeds the payroll run at the recorded multiplier."
      />

      <div class="obx-repstats" style={{ margin: '4px 0 12px' }}>
        {STAT_ROW.map(s => (
          <div class="obx-repstat" key={s.label}>
            <div class="obx-repstat-val">{s.val}</div>
            <div class="obx-repstat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div class="obx-toolbar" style={{ margin: '10px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span class="obx-meta">Status:</span>
        <select class="obx-mini-select" value={status} onChange={e => setStatus((e.currentTarget as HTMLSelectElement).value)}>
          <option value="">All</option>
          {STATUS_FILTERS.map(s => <option value={s} key={s}>{humanize(s)}</option>)}
        </select>
        {canSubmit && <button class="obx-btn obx-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowForm(v => !v)}><i class={`fas ${showForm ? 'fa-xmark' : 'fa-plus'}`} /> {showForm ? 'Cancel' : 'Log overtime'}</button>}
      </div>

      {showForm && <LogOvertimeForm onDone={() => setShowForm(false)} />}

      <div class="obx-section"><div class="obx-section-body">
        {entriesQ.isLoading && !entriesQ.data ? <div class="obx-empty">Loading…</div>
          : !entries.length ? <EmptyState icon="fa-clock" title="No overtime entries" text="Overtime entries matching this filter will appear here." />
          : (
            <table class="obx-table">
              <thead><tr><th>OT #</th><th>Employee</th><th>Date</th><th>Hours</th><th>×</th><th>Reason</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
              <tbody>{entries.map(e => (
                <tr key={e.id}>
                  <td><b>{e.overtimeNo ?? '—'}</b></td>
                  <td class="obx-meta">{nameOf(e.employeeId)}</td>
                  <td class="obx-meta">{fmtDate(e.workDate)}</td>
                  <td class="obx-meta">{e.hours}</td>
                  <td class="obx-meta">{e.multiplier}×</td>
                  <td class="obx-meta">{e.reason ?? '—'}</td>
                  <td><span class={`obx-pill ${statusTone(e.status)}`}>{humanize(e.status)}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <div class="obx-rowbtns" style={{ justifyContent: 'flex-end' }}>
                      {canApprove && e.status === 'submitted' && (
                        <>
                          <button class="obx-btn obx-btn-sm" onClick={() => run(approveMut.mutateAsync({ id: e.id }), 'Overtime approved.')}>Approve</button>
                          <button class="obx-btn obx-btn-sm" onClick={async () => {
                            const res = await openActionModal(rejectAction({ noun: 'overtime', record: otRecord(e), whatNext: ['The overtime is rejected and will not feed payroll.'] }));
                            if (!res.confirmed) return;
                            await run(rejectMut.mutateAsync({ id: e.id, reason: res.reason || undefined }), 'Rejected.');
                          }}>Reject</button>
                        </>
                      )}
                      {canApprove && (e.status === 'submitted' || e.status === 'approved') && (
                        <button class="obx-btn obx-btn-sm" onClick={async () => {
                          const res = await openActionModal(cancelAction({ noun: 'overtime entry', reasonRequired: false, record: otRecord(e), whatNext: ['The overtime entry is voided.'] }));
                          if (!res.confirmed) return;
                          void run(cancelMut.mutateAsync({ id: e.id }), 'Cancelled.');
                        }}>Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </div></div>
    </div>
  );
}

function LogOvertimeForm({ onDone }: { onDone: () => void }): VNode {
  const submitMut = useOvertimeMutation(hrOvertimeApi.submitOvertime);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ workDate: today, hours: '', multiplier: '1.5', reason: '' });

  const submit = async (): Promise<void> => {
    const hours = Number(f.hours);
    if (!f.workDate || !(hours > 0)) { dialog.error('Work date and a positive number of hours are required.'); return; }
    try {
      await submitMut.mutateAsync({ workDate: f.workDate, hours, multiplier: Number(f.multiplier) || 1.5, reason: f.reason.trim() || null });
      dialog.success('Overtime submitted for approval.');
      onDone();
    } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to submit overtime.'); }
  };

  const hoursNum = Number(f.hours);
  const payable = hoursNum > 0 ? hoursNum * (Number(f.multiplier) || 1.5) : 0;
  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Overtime', title: 'Overtime Preview', description: 'Preview payable hours and payroll impact.',
    preview: { icon: 'OT', title: `${f.hours || '—'}h × ${f.multiplier}`, subtitle: f.workDate || 'Set work date' },
    metrics: [
      { label: 'Hours', value: f.hours || '—', tone: 'info' },
      { label: 'Multiplier', value: `${f.multiplier}×`, tone: 'default' },
      { label: 'Payable', value: payable ? payable.toFixed(2) : '—', tone: payable ? 'success' : 'muted' },
    ],
    validation: [
      ...(!f.workDate ? [{ message: 'Set the work date.', tone: 'danger' as const }] : []),
      ...(!(hoursNum > 0) ? [{ message: 'Enter a positive number of hours.', tone: 'danger' as const }] : []),
    ],
    approval: { required: true, risk: 'low', message: 'Submitted for approval by your manager / HR.' },
    whatNext: [
      { label: 'Routes for approval', description: 'Your manager or HR approves or rejects.' },
      { label: 'Feeds payroll', description: 'Approved overtime feeds the next pay run; immutable once paid.' },
    ],
  };
  return (
    <EnterpriseFormModal open
      title="Log Overtime"
      subtitle="Submit overtime — the panel previews payable hours."
      icon={<i class="fas fa-clock" />}
      context={context}
      primaryLabel="Submit overtime"
      loading={submitMut.isPending}
      disabled={!f.workDate || !(hoursNum > 0)}
      onCancel={onDone}
      onSubmit={() => void submit()}>
      <div class="fin-form-grid fin-form-grid--tight">
        <label class="fin-field"><span>Work date</span><input type="date" value={f.workDate} onInput={e => setF(p => ({ ...p, workDate: (e.currentTarget as HTMLInputElement).value }))} /></label>
        <label class="fin-field"><span>Hours</span><input type="number" step="0.25" value={f.hours} onInput={e => setF(p => ({ ...p, hours: (e.currentTarget as HTMLInputElement).value }))} /></label>
        <label class="fin-field"><span>Multiplier</span>
          <select value={f.multiplier} onChange={e => setF(p => ({ ...p, multiplier: (e.currentTarget as HTMLSelectElement).value }))}>
            <option value="1">1.0× (straight)</option><option value="1.5">1.5× (time-and-a-half)</option><option value="2">2.0× (double)</option>
          </select>
        </label>
        <label class="fin-field"><span>Reason</span><input type="text" value={f.reason} onInput={e => setF(p => ({ ...p, reason: (e.currentTarget as HTMLInputElement).value }))} /></label>
      </div>
    </EnterpriseFormModal>
  );
}
