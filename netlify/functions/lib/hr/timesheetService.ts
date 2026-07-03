// lib/hr/timesheetService.ts
// Build + submit + approve/reject/reopen timesheets.

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { startWorkflowForRecord } from '../workflow/service';
import {
  listAttendanceRecords, getTimesheet, mapTimesheet,
} from './attendanceQueries';
import { computePeriod } from './timekeepingCompute';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

export async function buildTimesheet(actorId: string, args: {
  employeeId: string; periodStart: string; periodEnd: string;
}) {
  const { records } = await listAttendanceRecords({
    employeeId: args.employeeId, fromDate: args.periodStart, toDate: args.periodEnd, limit: 400,
  });

  const rollup = computePeriod(records);

  // Count open exceptions that fall in this period
  const { count: openExcCount } = await sb.from('hr_attendance_exceptions')
    .select('id', { count: 'exact' })
    .eq('employee_id', args.employeeId)
    .eq('status', 'open')
    .gte('work_date', args.periodStart)
    .lte('work_date', args.periodEnd);

  const timesheetNo = await nextRef('TSH');

  const upsertRow = {
    employee_id:           args.employeeId,
    period_start:          args.periodStart,
    period_end:            args.periodEnd,
    timesheet_no:          timesheetNo,
    total_worked_minutes:  rollup.totalWorkedMinutes,
    total_late_minutes:    rollup.totalLateMinutes,
    total_overtime_minutes:rollup.totalOvertimeMinutes,
    days_present:          rollup.daysPresent,
    days_absent:           rollup.daysAbsent,
    days_on_leave:         rollup.daysOnLeave,
    open_exception_count:  openExcCount ?? 0,
    status:                'draft',
  };

  const { data: ts, error: tsErr } = await sb.from('hr_timesheets')
    .upsert(upsertRow, { onConflict: 'employee_id,period_start,period_end', ignoreDuplicates: false })
    .select('*').single<Record<string, unknown>>();
  if (tsErr || !ts) throw err(500, 'Failed to build timesheet: ' + tsErr?.message);

  // Link records to timesheet
  if (records.length > 0) {
    const recordIds = records.map(r => r.id);
    await sb.from('hr_attendance_records').update({ timesheet_id: ts['id'] as string }).in('id', recordIds);
    // Link open exceptions in the period
    await sb.from('hr_attendance_exceptions')
      .update({ timesheet_id: ts['id'] as string })
      .eq('employee_id', args.employeeId)
      .gte('work_date', args.periodStart)
      .lte('work_date', args.periodEnd);
  }

  emitAppEvent({ eventType: 'hr.attendance.timesheet_built', sourceModule: 'hr_attendance', sourceEntityType: 'timesheet', sourceEntityId: ts['id'] as string, actorUserId: actorId, severity: 'info', payload: { employeeId: args.employeeId, periodStart: args.periodStart, periodEnd: args.periodEnd } });
  return getTimesheet(ts['id'] as string);
}
export async function submitTimesheet(actorId: string, args: {
  timesheetId: string; notes?: string | null;
}) {
  const ts = await getTimesheet(args.timesheetId);
  if (!ts) throw err(404, 'Timesheet not found.');
  if (!['draft', 'reopened'].includes(ts.status)) throw err(409, 'Timesheet cannot be submitted in current status.');

  const now = new Date().toISOString();
  const { error: updErr } = await sb.from('hr_timesheets').update({
    status: 'submitted', submitted_at: now, submitted_by: actorId,
    notes: args.notes ?? ts.notes,
  }).eq('id', args.timesheetId);
  if (updErr) throw err(500, 'Failed to submit timesheet: ' + updErr.message);

  await writeHrAudit({
    submoduleKey: 'hr_attendance', recordId: args.timesheetId, actorId,
    action: 'timesheet.submitted', previousState: { status: ts.status }, newState: { status: 'submitted' },
  });

  // Start workflow -- null fallback: no binding -> direct approve
  const wf = await startWorkflowForRecord({
    context: {
      moduleKey: 'hr_attendance', workflowType: 'hr_timesheet_approval',
      triggerEvent: 'hr.timesheet.submitted',
      sourceRecordId: args.timesheetId,
      sourceRecordRef: ts.timesheetNo,
      requestedBy: actorId, ownerId: actorId,
      departmentId: null, siteId: null,
      priority: 'medium',
      recordData: { employeeId: ts.employeeId, periodStart: ts.periodStart, periodEnd: ts.periodEnd },
    },
    actor: { id: actorId },
  });

  if (wf) {
    await sb.from('hr_timesheets').update({ workflow_id: wf.id, status: 'in_review' }).eq('id', args.timesheetId);
  } else {
    // No binding -> direct approve (graceful fallback)
    const approveNow = new Date().toISOString();
    await sb.from('hr_timesheets').update({
      status: 'approved', approved_by: actorId, approved_at: approveNow,
    }).eq('id', args.timesheetId);
    await writeHrAudit({
      submoduleKey: 'hr_attendance', recordId: args.timesheetId, actorId,
      action: 'timesheet.auto_approved', previousState: { status: 'submitted' }, newState: { status: 'approved' },
      reason: 'No active workflow binding; auto-approved.',
    });
    emitAppEvent({ eventType: 'hr.timesheet.approved', sourceModule: 'hr_attendance', sourceEntityType: 'timesheet', sourceEntityId: args.timesheetId, actorUserId: actorId, severity: 'success', payload: { auto: true } });
  }

  emitAppEvent({ eventType: 'hr.timesheet.submitted', sourceModule: 'hr_attendance', sourceEntityType: 'timesheet', sourceEntityId: args.timesheetId, actorUserId: actorId, severity: 'info', payload: {} });
  return getTimesheet(args.timesheetId);
}

export async function reopenTimesheet(actorId: string, timesheetId: string): Promise<void> {
  const ts = await getTimesheet(timesheetId);
  if (!ts) throw err(404, 'Timesheet not found.');
  if (!['approved', 'rejected'].includes(ts.status)) throw err(409, 'Only approved or rejected timesheets can be reopened.');

  const { error } = await sb.from('hr_timesheets').update({
    status: 'reopened', approved_by: null, approved_at: null, rejection_note: null, workflow_id: null,
  }).eq('id', timesheetId);
  if (error) throw err(500, 'Failed to reopen timesheet: ' + error.message);

  await writeHrAudit({
    submoduleKey: 'hr_attendance', recordId: timesheetId, actorId,
    action: 'timesheet.reopened', previousState: { status: ts.status }, newState: { status: 'reopened' },
  });
  emitAppEvent({ eventType: 'hr.timesheet.reopened', sourceModule: 'hr_attendance', sourceEntityType: 'timesheet', sourceEntityId: timesheetId, actorUserId: actorId, severity: 'info', payload: {} });
}