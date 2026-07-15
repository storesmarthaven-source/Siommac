/**
 * src/components/sections/HR/AttendanceOverview.tsx
 *
 * HR ▸ Attendance & Timekeeping — functional overview (nav id `s-hr-attendance`).
 * Surfaces: Daily Log · Timesheets · Exceptions. Reads/writes the real greenfield
 * `hr/attendance/*` backend; no widget board (functional-first per the module brief).
 * Reuses the shared `.obx-*` table/pill/button families.
 */

import { type VNode } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import {
  useAttendanceRecords, useTimesheets, useAttendanceExceptions, useAttendanceStats,
  useWaiveException, useResolveException, useSubmitTimesheet, useReopenTimesheet, useCorrectRecord, fmtMinutes,
  useImportAttendance, type AttendanceImportRow, type AttendanceImportResult,
} from '@api/hr/attendance';
import type { AttendanceRecord } from '../../../../types/hrAttendance';
import { humanize } from './shared';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import './onboardingCase.css';
import '../Finance/finance.css';

interface ExcRow { id: string; workDate: string; employeeId: string; exceptionType: string; minutes: number | null; status: string }

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
  // Idempotency: one stable key per submit ATTEMPT (per id), reused on retry, cleared on success.
  const submitKeys = useRef<Map<string, string>>(new Map());
  const reopenMut  = useReopenTimesheet();

  const canManageExc = can('hr.attendance.exceptions.manage');
  const canSubmitTs  = can('hr.attendance.timesheets.submit');
  const canApproveTs = can('hr.attendance.timesheets.approve');
  const canCorrect   = can('hr.attendance.correct');
  const [correcting, setCorrecting] = useState<AttendanceRecord | null>(null);
  const [importing, setImporting]   = useState(false);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; void dialog.success(ok); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
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
        <div class="obx-section">
          {canCorrect && (
            <div class="obx-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '8px 10px' }}>
              <button class="obx-btn obx-btn-sm" onClick={() => setImporting(true)}><i class="fas fa-file-import" /> Import CSV</button>
            </div>
          )}
          <div class="obx-section-body">
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
                        {canSubmit && <button class="obx-mini" onClick={() => { const key = submitKeys.current.get(t.id) ?? crypto.randomUUID(); submitKeys.current.set(t.id, key); void run(submitMut.mutateAsync({ timesheetId: t.id, idempotencyKey: key }).then(r => { submitKeys.current.delete(t.id); return r; }), 'Timesheet submitted.'); }}>Submit</button>}
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
      {importing && <ImportAttendanceModal onClose={() => setImporting(false)} />}
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
      void dialog.success('Correction applied and logged.');
      onClose();
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Failed to apply correction.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Attendance', title: 'Correction Preview', description: 'A correction is audit-logged with the old and new value; punch changes recompute worked/late/OT minutes.',
    preview: { icon: 'FIX', title: record.recordNo, subtitle: `${record.employeeId} · ${record.workDate}` },
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
          <select value={field} onChange={e => pickField((e.currentTarget).value)}>
            {CORRECTABLE.map(c => <option value={c.field} key={c.field}>{c.label}</option>)}
          </select>
        </label>
        <label class="fin-field"><span>New value</span>
          {spec.kind === 'datetime'
            ? <input type="datetime-local" value={newValue} onInput={e => setNewValue((e.currentTarget).value)} />
            : spec.kind === 'status'
            ? <select value={newValue} onChange={e => setNewValue((e.currentTarget).value)}>{STATUS_OPTIONS.map(s => <option value={s} key={s}>{humanize(s)}</option>)}</select>
            : spec.kind === 'source'
            ? <select value={newValue} onChange={e => setNewValue((e.currentTarget).value)}>{SOURCE_OPTIONS.map(s => <option value={s} key={s}>{humanize(s)}</option>)}</select>
            : <input type="text" value={newValue} onInput={e => setNewValue((e.currentTarget).value)} placeholder="New note" />}
        </label>
        <label class="fin-field" style={{ gridColumn: '1 / -1' }}><span>Reason (required)</span>
          <textarea value={reason} onInput={e => setReason((e.currentTarget).value)} rows={3} placeholder="Why is this correction being made? (audit-logged)" />
        </label>
      </div>
    </EnterpriseFormModal>
  );
}

// ── Bulk CSV import ────────────────────────────────────────────────────────────
// Imports punch in/out per employee per day; worked minutes are derived server-side
// by the shared recompute pipeline and roll up into timesheets that feed payroll.

interface ParsedCsv { rows: AttendanceImportRow[]; errors: string[] }

const CSV_TEMPLATE = 'username,workDate,punchIn,punchOut\njdoe,2026-07-06,08:00,16:30\njdoe,2026-07-07,08:05,16:30';

function parseAttendanceCsv(text: string): ParsedCsv {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], errors: ['Provide a header row and at least one data row.'] };
  const header = lines[0]!.split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  const col = (names: string[]): number => header.findIndex(h => names.includes(h));
  const iUser = col(['username', 'user', 'employee', 'employeeref']);
  const iId   = col(['employeeid', 'employee_id', 'id']);
  const iDate = col(['workdate', 'date', 'work_date']);
  const iIn   = col(['punchin', 'in', 'punch_in', 'clockin', 'timein']);
  const iOut  = col(['punchout', 'out', 'punch_out', 'clockout', 'timeout']);
  const iSite = col(['siteid', 'site', 'site_id']);
  if (iDate < 0) errors.push('Missing a "workDate" (or "date") column.');
  if (iUser < 0 && iId < 0) errors.push('Need a "username" or "employeeId" column.');
  if (iIn < 0 && iOut < 0) errors.push('Need a "punchIn" and/or "punchOut" column.');
  const rows: AttendanceImportRow[] = [];
  if (errors.length === 0) {
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]!.split(',').map(c => c.trim());
      const at = (idx: number): string => (idx >= 0 ? (cols[idx] ?? '') : '');
      rows.push({
        username:   iUser >= 0 ? (at(iUser) || null) : null,
        employeeId: iId >= 0 ? (at(iId) || null) : null,
        workDate:   at(iDate),
        punchIn:    iIn >= 0 ? (at(iIn) || null) : null,
        punchOut:   iOut >= 0 ? (at(iOut) || null) : null,
        siteId:     iSite >= 0 ? (at(iSite) || null) : null,
      });
    }
  }
  return { rows, errors };
}

function rowIsValid(r: AttendanceImportRow): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((r.workDate ?? '').trim())) return false;
  if (!r.username && !r.employeeId) return false;
  if (!r.punchIn && !r.punchOut) return false;
  return true;
}

function ImportAttendanceModal({ onClose }: { onClose: () => void }): VNode {
  const importMut = useImportAttendance();
  const [text, setText] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<AttendanceImportResult | null>(null);

  const parsed = parseAttendanceCsv(text);
  const validRows = parsed.rows.filter(rowIsValid);
  const invalidCount = parsed.rows.length - validRows.length;
  const hasHeaderErrors = parsed.errors.length > 0;

  const onFile = (e: Event): void => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText((reader.result as string | null) ?? '');
    reader.readAsText(file);
  };

  const doImport = async (): Promise<void> => {
    if (!validRows.length) return;
    try {
      const res = await importMut.mutateAsync({ rows: validRows, overwriteExisting: overwrite });
      setResult(res);
      void dialog.success(`Imported ${res.imported + res.updated} of ${res.total} rows.`);
    } catch (err) { void dialog.error(err instanceof Error ? err.message : 'Import failed.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Attendance', title: 'CSV Import', description: 'Import punch in/out per employee per day. Worked hours are computed server-side and roll up into timesheets that feed payroll.',
    preview: { icon: 'CSV', title: result ? 'Import complete' : `${validRows.length} ready`, subtitle: result ? `${result.imported + result.updated} applied` : `${parsed.rows.length} parsed` },
    metrics: result
      ? [
          { label: 'Imported', value: result.imported, tone: 'success' },
          { label: 'Updated', value: result.updated, tone: 'info' },
          { label: 'Skipped', value: result.skipped, tone: result.skipped ? 'danger' : 'muted' },
        ]
      : [
          { label: 'Valid rows', value: validRows.length, tone: validRows.length ? 'success' : 'muted' },
          { label: 'Invalid', value: invalidCount, tone: invalidCount ? 'warning' : 'muted' },
        ],
    validation: result ? [] : [
      ...parsed.errors.map(m => ({ message: m, tone: 'danger' as const })),
      ...(invalidCount > 0 ? [{ message: `${invalidCount} row(s) missing a valid date, employee or punch — they will be skipped.`, tone: 'warning' as const }] : []),
      ...(!hasHeaderErrors && validRows.length === 0 ? [{ message: 'No valid rows to import yet.', tone: 'info' as const }] : []),
    ],
    whatNext: [
      { label: 'Columns', description: 'username (or employeeId), workDate (YYYY-MM-DD), punchIn, punchOut (HH:MM), optional siteId.' },
      { label: 'Computed', description: 'Worked / late / overtime minutes are derived from the punches, per the attendance policy.' },
    ],
  };

  return (
    <EnterpriseFormModal open
      title="Import attendance (CSV)"
      subtitle="Bulk-import punch records for many employees"
      icon={<i class="fas fa-file-import" />}
      context={context}
      primaryLabel={result ? 'Done' : `Import ${validRows.length} row${validRows.length === 1 ? '' : 's'}`}
      loading={importMut.isPending}
      disabled={result ? false : validRows.length === 0}
      cancelLabel={result ? 'Close' : 'Cancel'}
      onCancel={onClose}
      onSubmit={() => (result ? onClose() : void doImport())}>
      {result ? (
        <div>
          <p style={{ fontSize: 13, color: '#334155', marginTop: 0 }}>
            Applied <b>{result.imported + result.updated}</b> of <b>{result.total}</b> rows
            ({result.imported} new, {result.updated} updated). {result.skipped > 0 ? `${result.skipped} skipped.` : 'No errors.'}
          </p>
          {result.errors.length > 0 && (
            <table class="obx-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Row</th><th>Employee</th><th>Error</th></tr></thead>
              <tbody>{result.errors.slice(0, 100).map(er => (
                <tr key={er.row}>
                  <td class="obx-meta">{er.row}</td>
                  <td class="obx-meta">{er.employee ?? '—'}</td>
                  <td class="obx-meta">{er.message}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      ) : (
        <div class="fin-form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <label class="fin-field"><span>Upload a .csv file</span>
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
          </label>
          <label class="fin-field"><span>…or paste CSV rows</span>
            <textarea value={text} onInput={e => setText((e.currentTarget).value)} rows={10}
              placeholder={CSV_TEMPLATE} style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </label>
          <label class="fin-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={e => setOverwrite((e.currentTarget).checked)}
            />
            <span style={{ margin: 0 }}>
              Overwrite existing live/manual punches (correction mode)
              <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
                Off by default — rows that collide with a real punch are skipped instead of replacing it.
              </span>
            </span>
          </label>
          <button type="button" class="obx-btn obx-btn-sm" style={{ justifySelf: 'start' }} onClick={() => setText(CSV_TEMPLATE)}>
            <i class="fas fa-file-lines" /> Load sample
          </button>
        </div>
      )}
    </EnterpriseFormModal>
  );
}
