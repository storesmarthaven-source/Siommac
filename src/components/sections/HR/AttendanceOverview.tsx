/**
 * src/components/sections/HR/AttendanceOverview.tsx
 *
 * HR ▸ Attendance & Timekeeping — functional overview (nav id `s-hr-attendance`).
 * Surfaces: Daily Log · Timesheets · Exceptions. Reads/writes the real greenfield
 * `hr/attendance/*` backend; no widget board (functional-first per the module brief).
 * Reuses the shared `.obx-*` table/pill/button families.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import {
  useAttendanceRecords, useTimesheets, useAttendanceExceptions, useAttendanceStats,
  useWaiveException, useResolveException, useSubmitTimesheet, useReopenTimesheet, useCorrectRecord, fmtMinutes,
} from '@api/hr/attendance';
import type { AttendanceRecord } from '../../../../types/hrAttendance';
import { humanize } from './shared';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import './onboardingCase.css';
import '../Finance/finance.css';

type ExcRow = { id: string; workDate: string; employeeId: string; exceptionType: string; minutes: number | null; status: string };

const STATUS_OPTIONS: AttendanceRecord['status'][] = ['present', 'absent', 'late', 'half_day', 'on_leave', 'holiday', 'missing_punch', 'short_hours', 'over_hours'];
const SOURCE_OPTIONS: AttendanceRecord['source'][] = ['manual', 'kiosk', 'mobile', 'import'];
const CORRECTABLE: { field: string; label: string; kind: 'datetime' | 'status' | 'source' | 'text' }[] = [
  { field: 'punch_in_at',  label: 'Punch in time',  kind: 'datetime' },
  { field: 'punch_out_at', label: 'Punch out time', kind: 'datetime' },
  { field: 'status',       label: 'Status',          kind: 'status' },
  { field: 'notes',        label: 'Notes',           kind: 'text' },
  { field: 'source',       label: 'Source',          kind: 'source' },
];
const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type Surface = 'log' | 'timesheets' | 'exceptions';

const SURFACES: { id: Surface; label: string }[] = [
  { id: 'log',         label: 'Daily Log' },
  { id: 'timesheets',  label: 'Timesheets' },
  { id: 'exceptions',  label: 'Exceptions' },
];

function tsTone(s: string): string {
  return s === 'approved' ? 'green' : s === 'rejected' ? 'red' : s === 'submitted' || s === 'in_review' ? 'amber' : 'gray';
}
function excTone(s: string): string {
  return s === 'resolved' ? 'green' : s === 'waived' ? 'gray' : 'amber';
}
function statTone(s: string): string {
  return s === 'present' ? 'green' : s === 'absent' || s === 'missing_punch' ? 'red' : s === 'on_leave' || s === 'holiday' ? 'gray' : 'amber';
}
const fmtTime = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—');

export function AttendanceOverview(): VNode {
  const [surface, setSurface] = useState<Surface>('log');

  const statsQ  = useAttendanceStats();
  const recQ    = useAttendanceRecords({ limit: 100 });
  const tsQ     = useTimesheets({ limit: 100 });
  const excQ    = useAttendanceExceptions({ status: 'open', limit: 100 });

  const waiveMut   = useWaiveException();
  const resolveMut = useResolveException();
  const submitMut  = useSubmitTimesheet();
  const reopenMut  = useReopenTimesheet();

  const canManageExc = can('hr.attendance.exceptions.manage');
  const canSubmitTs  = can('hr.attendance.timesheets.submit');
  const canApproveTs = can('hr.attendance.timesheets.approve');
  const canCorrect   = can('hr.attendance.correct');
  const [correcting, setCorrecting] = useState<AttendanceRecord | null>(null);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; dialog.success(ok); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  const excRecord = (x: ExcRow) => toActionRecord({
    title: humanize(x.exceptionType), subtitle: `${x.employeeId} · ${x.workDate}`, icon: 'fa-triangle-exclamation',
    badges: [statusBadge(x.status)],
    fields: [{ label: 'Minutes', value: x.minutes != null ? fmtMinutes(x.minutes) : '—' }],
  });
  const onWaive = async (x: ExcRow): Promise<void> => {
    const res = await openActionModal({
      title: 'Waive exception', icon: 'fa-circle-minus', tone: 'warning', record: excRecord(x),
      warning: 'Waiving accepts this exception without a timekeeping correction.',
      reason: { required: true, label: 'Reason for waiving', type: 'textarea', placeholder: 'Why is this exception acceptable?' },
      whatNext: ['The exception is marked waived and excluded from follow-up.'],
      confirmLabel: 'Waive',
    });
    if (!res.confirmed) return;
    await run(waiveMut.mutateAsync({ exceptionId: x.id, waiveReason: (res.reason ?? '').trim() }), 'Exception waived.');
  };
  const onResolve = async (x: ExcRow): Promise<void> => {
    const res = await openActionModal({
      title: 'Resolve exception', icon: 'fa-circle-check', tone: 'success', record: excRecord(x),
      reason: { required: true, label: 'Resolution note', type: 'textarea', placeholder: 'How was this exception resolved?' },
      whatNext: ['The exception is marked resolved.'],
      confirmLabel: 'Resolve',
    });
    if (!res.confirmed) return;
    await run(resolveMut.mutateAsync({ exceptionId: x.id, resolveNote: (res.reason ?? '').trim() }), 'Exception resolved.');
  };

  const stats = statsQ.data;
  const STAT_ROW = [
    { label: 'Present today',       val: stats?.presentToday },
    { label: 'Absent today',        val: stats?.absentToday },
    { label: 'Late today',          val: stats?.lateToday },
    { label: 'Open exceptions',     val: stats?.openExceptions },
    { label: 'Pending timesheets',  val: stats?.pendingTimesheets },
    { label: 'Total employees',     val: stats?.totalEmployees },
  ];

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader
        icon="fa-clock" module="HR · Attendance" title="Attendance & Timekeeping"
        sub="Punch records, timesheets, and exceptions — verified work-time inputs for payroll."
      />

      <div class="obx-repstats" style={{ margin: '4px 0 12px' }}>
        {STAT_ROW.map(s => (
          <div class="obx-repstat" key={s.label}>
            <div class="obx-repstat-val">{s.val ?? (statsQ.isLoading ? '…' : 0)}</div>
            <div class="obx-repstat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        {SURFACES.map(s => (
          <button key={s.id} class={`obx-view-btn${surface === s.id ? ' active' : ''}`} onClick={() => setSurface(s.id)}>{s.label}</button>
        ))}
      </div>

      {/* ── Daily Log ── */}
      {surface === 'log' && (
        <div class="obx-section"><div class="obx-section-body">
          {recQ.isLoading && !recQ.data ? <div class="obx-empty">Loading…</div>
            : !(recQ.data?.records.length) ? <EmptyState icon="fa-clock" title="No attendance records" text="Punch records will appear here once employees clock in." />
            : (
              <table class="obx-table">
                <thead><tr><th>Date</th><th>Employee</th><th>In</th><th>Out</th><th>Worked</th><th>Late</th><th>OT</th><th>Status</th>{canCorrect && <th style={{ textAlign: 'right' }}>Actions</th>}</tr></thead>
                <tbody>{recQ.data.records.map(r => (
                  <tr key={r.id}>
                    <td><b>{r.workDate}</b></td>
                    <td class="obx-meta">{r.employeeId}</td>
                    <td class="obx-meta">{fmtTime(r.punchInAt)}</td>
                    <td class="obx-meta">{fmtTime(r.punchOutAt)}</td>
                    <td class="obx-meta">{fmtMinutes(r.workedMinutes)}</td>
                    <td class="obx-meta">{r.lateMinutes ? fmtMinutes(r.lateMinutes) : '—'}</td>
                    <td class="obx-meta">{r.overtimeMinutes ? fmtMinutes(r.overtimeMinutes) : '—'}</td>
                    <td><span class={`obx-pill ${statTone(r.status)}`}>{humanize(r.status)}</span></td>
                    {canCorrect && <td style={{ textAlign: 'right' }}><button class="obx-btn obx-btn-sm" onClick={() => setCorrecting(r)}><i class="fas fa-pen" /> Correct</button></td>}
                  </tr>
                ))}</tbody>
              </table>
            )}
        </div></div>
      )}

      {/* ── Timesheets ── */}
      {surface === 'timesheets' && (
        <div class="obx-section"><div class="obx-section-body">
          {tsQ.isLoading && !tsQ.data ? <div class="obx-empty">Loading…</div>
            : !(tsQ.data?.timesheets.length) ? <EmptyState icon="fa-file-lines" title="No timesheets" text="Build a timesheet from a period's attendance records to submit it for approval." />
            : (
              <table class="obx-table">
                <thead><tr><th>Timesheet</th><th>Period</th><th>Worked</th><th>OT</th><th style={{ textAlign: 'center' }}>Exceptions</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{tsQ.data.timesheets.map(t => {
                  const canSubmit = canSubmitTs && (t.status === 'draft' || t.status === 'reopened' || t.status === 'rejected');
                  const canReopen = canApproveTs && t.status === 'approved';
                  return (
                    <tr key={t.id}>
                      <td><b>{t.timesheetNo}</b></td>
                      <td class="obx-meta">{t.periodStart} → {t.periodEnd}</td>
                      <td class="obx-meta">{fmtMinutes(t.totalWorkedMinutes)}</td>
                      <td class="obx-meta">{t.totalOvertimeMinutes ? fmtMinutes(t.totalOvertimeMinutes) : '—'}</td>
                      <td class="obx-meta" style={{ textAlign: 'center' }}>{t.openExceptionCount}</td>
                      <td><span class={`obx-pill ${tsTone(t.status)}`}>{humanize(t.status)}</span></td>
                      <td>
                        {canSubmit && <button class="obx-mini" onClick={() => void run(submitMut.mutateAsync({ timesheetId: t.id }), 'Timesheet submitted.')}>Submit</button>}
                        {canReopen && <button class="obx-mini" onClick={() => void run(reopenMut.mutateAsync({ timesheetId: t.id }), 'Timesheet reopened.')}>Reopen</button>}
                        {!canSubmit && !canReopen && <span class="obx-meta">—</span>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
        </div></div>
      )}

      {/* ── Exceptions ── */}
      {surface === 'exceptions' && (
        <div class="obx-section"><div class="obx-section-body">
          {excQ.isLoading && !excQ.data ? <div class="obx-empty">Loading…</div>
            : !(excQ.data?.exceptions.length) ? <EmptyState icon="fa-triangle-exclamation" title="No open exceptions" text="Late arrivals, missing punches, and other exceptions surface here for review." />
            : (
              <table class="obx-table">
                <thead><tr><th>Date</th><th>Employee</th><th>Type</th><th>Minutes</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{excQ.data.exceptions.map(x => (
                  <tr key={x.id}>
                    <td><b>{x.workDate}</b></td>
                    <td class="obx-meta">{x.employeeId}</td>
                    <td class="obx-meta">{humanize(x.exceptionType)}</td>
                    <td class="obx-meta">{x.minutes != null ? fmtMinutes(x.minutes) : '—'}</td>
                    <td><span class={`obx-pill ${excTone(x.status)}`}>{humanize(x.status)}</span></td>
                    <td>
                      {canManageExc && x.status === 'open' ? (
                        <>
                          <button class="obx-mini" onClick={() => void onResolve(x)}>Resolve</button>
                          <button class="obx-mini" onClick={() => void onWaive(x)}>Waive</button>
                        </>
                      ) : <span class="obx-meta">—</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
        </div></div>
      )}

      {correcting && <CorrectRecordModal record={correcting} onClose={() => setCorrecting(null)} />}
    </div>
  );
}

function CorrectRecordModal({ record, onClose }: { record: AttendanceRecord; onClose: () => void }): VNode {
  const correctMut = useCorrectRecord();
  const initialValue = (field: string): string => {
    if (field === 'punch_in_at')  return toLocalInput(record.punchInAt);
    if (field === 'punch_out_at') return toLocalInput(record.punchOutAt);
    if (field === 'status')       return record.status;
    if (field === 'source')       return record.source;
    if (field === 'notes')        return record.notes ?? '';
    return '';
  };
  const [field, setField] = useState<string>('punch_in_at');
  const [newValue, setNewValue] = useState<string>(initialValue('punch_in_at'));
  const [reason, setReason] = useState('');

  const spec = CORRECTABLE.find(c => c.field === field)!;
  const pickField = (f: string): void => { setField(f); setNewValue(initialValue(f)); };

  const currentDisplay = (): string => {
    if (field === 'punch_in_at')  return fmtTime(record.punchInAt);
    if (field === 'punch_out_at') return fmtTime(record.punchOutAt);
    if (field === 'status')       return humanize(record.status);
    if (field === 'source')       return humanize(record.source);
    return record.notes ?? '—';
  };
  const newDisplay = (): string => {
    if (!newValue) return spec.kind === 'datetime' ? 'Cleared' : '—';
    if (spec.kind === 'datetime') return new Date(newValue).toLocaleString();
    if (spec.kind === 'status' || spec.kind === 'source') return humanize(newValue);
    return newValue;
  };
  const changed = newValue !== initialValue(field);

  const submit = async (): Promise<void> => {
    if (!reason.trim()) return;
    try {
      await correctMut.mutateAsync({ recordId: record.id, fieldName: field, newValue, reason: reason.trim() });
      dialog.success('Correction applied and logged.');
      onClose();
    } catch (e) { dialog.error(e instanceof Error ? e.message : 'Failed to apply correction.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Attendance', title: 'Correction Preview', description: 'A correction is audit-logged with the old and new value; punch changes recompute worked/late/OT minutes.',
    preview: { icon: 'FIX', title: `${record.recordNo}`, subtitle: `${record.employeeId} · ${record.workDate}` },
    derived: { title: 'Field change', fields: [
      { label: 'Field', value: spec.label },
      { label: 'Current', value: currentDisplay() },
      { label: 'New', value: newDisplay() },
    ] },
    validation: [
      ...(!changed ? [{ message: 'New value matches the current value — nothing to correct.', tone: 'warning' as const }] : []),
      ...(!reason.trim() ? [{ message: 'A reason is required for every correction.', tone: 'danger' as const }] : []),
    ],
    approval: { required: false, risk: 'medium', message: 'Corrections are recorded against the employee’s timekeeping audit trail.' },
    whatNext: [
      { label: 'Audit-logged', description: 'The old and new value are written to the corrections log and HR audit trail.' },
      ...(field === 'punch_in_at' || field === 'punch_out_at'
        ? [{ label: 'Recomputed', description: 'Worked, late, and overtime minutes are recalculated for the day.' }] : []),
    ],
  };

  return (
    <EnterpriseFormModal open
      title="Correct attendance record"
      subtitle={`${record.recordNo} · ${record.workDate}`}
      icon={<i class="fas fa-pen" />}
      context={context}
      primaryLabel="Apply correction"
      loading={correctMut.isPending}
      disabled={!reason.trim() || !changed}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <div class="fin-form-grid fin-form-grid--tight">
        <label class="fin-field"><span>Field to correct</span>
          <select value={field} onChange={e => pickField((e.currentTarget as HTMLSelectElement).value)}>
            {CORRECTABLE.map(c => <option value={c.field} key={c.field}>{c.label}</option>)}
          </select>
        </label>
        <label class="fin-field"><span>New value</span>
          {spec.kind === 'datetime'
            ? <input type="datetime-local" value={newValue} onInput={e => setNewValue((e.currentTarget as HTMLInputElement).value)} />
            : spec.kind === 'status'
            ? <select value={newValue} onChange={e => setNewValue((e.currentTarget as HTMLSelectElement).value)}>{STATUS_OPTIONS.map(s => <option value={s} key={s}>{humanize(s)}</option>)}</select>
            : spec.kind === 'source'
            ? <select value={newValue} onChange={e => setNewValue((e.currentTarget as HTMLSelectElement).value)}>{SOURCE_OPTIONS.map(s => <option value={s} key={s}>{humanize(s)}</option>)}</select>
            : <input type="text" value={newValue} onInput={e => setNewValue((e.currentTarget as HTMLInputElement).value)} placeholder="New note" />}
        </label>
        <label class="fin-field" style={{ gridColumn: '1 / -1' }}><span>Reason (required)</span>
          <textarea value={reason} onInput={e => setReason((e.currentTarget as HTMLTextAreaElement).value)} rows={3} placeholder="Why is this correction being made? (audit-logged)" />
        </label>
      </div>
    </EnterpriseFormModal>
  );
}
