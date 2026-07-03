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
  useWaiveException, useResolveException, useSubmitTimesheet, useReopenTimesheet, fmtMinutes,
} from '@api/hr/attendance';
import { humanize } from './shared';
import './onboardingCase.css';

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

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; dialog.success(ok); }
    catch (e) { dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  const onWaive = async (exceptionId: string): Promise<void> => {
    const reason = await dialog.prompt({ title: 'Waive exception', text: 'Reason for waiving this exception.', placeholder: 'Why is this exception acceptable?' });
    if (reason == null || !reason.trim()) return;
    await run(waiveMut.mutateAsync({ exceptionId, waiveReason: reason.trim() }), 'Exception waived.');
  };
  const onResolve = async (exceptionId: string): Promise<void> => {
    const note = await dialog.prompt({ title: 'Resolve exception', text: 'How was this exception resolved?', placeholder: 'Resolution note' });
    if (note == null || !note.trim()) return;
    await run(resolveMut.mutateAsync({ exceptionId, resolveNote: note.trim() }), 'Exception resolved.');
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
    <div class="hr-offboarding">
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
                <thead><tr><th>Date</th><th>Employee</th><th>In</th><th>Out</th><th>Worked</th><th>Late</th><th>OT</th><th>Status</th></tr></thead>
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
                          <button class="obx-mini" onClick={() => void onResolve(x.id)}>Resolve</button>
                          <button class="obx-mini" onClick={() => void onWaive(x.id)}>Waive</button>
                        </>
                      ) : <span class="obx-meta">—</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
        </div></div>
      )}
    </div>
  );
}
