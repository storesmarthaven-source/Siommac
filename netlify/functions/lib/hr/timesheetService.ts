// lib/hr/timesheetService.ts
// Build + submit + approve/reject/reopen timesheets.

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { rpcHttpError } from '../workflow/service';
import { selectWorkflowBinding } from '../workflow/bindingResolver';
import { notify } from '../notify';
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
  timesheetId: string; notes?: string | null; idempotencyKey: string;
}) {
  // ATOMIC (finding #3): when an approval binding exists, the status flip
  // (draft/reopened -> in_review) + submitted_by/submitted_at + workflow_id + the whole
  // workflow + business event + hr_audit_log commit in ONE txn via
  // workflow_submit_for_record_tx (hr_timesheets branch), with request-key idempotency.
  // The department_manager first step may be UNASSIGNED when the employee has no
  // resolvable manager (mig 219 lets the RPC create an unassigned task, matching the
  // engine). When NO binding is configured, fall back to the direct auto-approve path.
  const requestKey = args.idempotencyKey?.trim();
  if (!requestKey) throw err(400, 'An idempotency key is required to submit a timesheet.');

  const ts = await getTimesheet(args.timesheetId);
  if (!ts) throw err(404, 'Timesheet not found.');

  const binding = await selectWorkflowBinding(sb, {
    moduleKey: 'hr_attendance', workflowType: 'hr_timesheet_approval',
    triggerEvent: 'hr.timesheet.submitted', sourceRecordId: args.timesheetId,
    requestedBy: actorId, recordData: {},
  });

  if (binding) {
    // Resolve the employee's active department manager so the department_manager first
    // step routes to a real approver; a missing department/manager leaves the task
    // unassigned (mig 219), decidable by an elevated actor.
    let departmentManagerId: string | null = null;
    const { data: emp } = await sb.from('app_users').select('department_id').eq('id', ts.employeeId).maybeSingle<{ department_id: string | null }>();
    if (emp?.department_id) {
      const { data: dept } = await sb.from('departments').select('manager_id').eq('id', emp.department_id).maybeSingle<{ manager_id: string | null }>();
      if (dept?.manager_id) {
        const { data: mgr } = await sb.from('app_users').select('id').eq('id', dept.manager_id).eq('status', 'active').maybeSingle<{ id: string }>();
        departmentManagerId = mgr?.id ?? null;
      }
    }
    const { data, error } = await sb.rpc('workflow_submit_for_record_tx', {
      p_source_table: 'hr_timesheets', p_source_id: args.timesheetId, p_actor_id: actorId,
      p_binding_id: binding.id, p_request_key: requestKey,
      p_business: { employeeId: ts.employeeId, periodStart: ts.periodStart, periodEnd: ts.periodEnd, departmentManagerId },
    });
    if (error) throw rpcHttpError(error as { code?: string | null; message: string });
    const result = (data ?? {}) as { firstTasks?: Array<{ assignedTo?: string | null }> };
    // The RPC does not touch `notes`; persist it best-effort post-commit.
    if (args.notes != null) await sb.from('hr_timesheets').update({ notes: args.notes }).eq('id', args.timesheetId);
    // Notify the resolved approver, if the department_manager assignee resolved (a
    // no-department timesheet leaves the task unassigned → nobody to notify here).
    const assignedTo = result.firstTasks?.[0]?.assignedTo ?? null;
    if (assignedTo) void notify({
      userId: assignedTo, type: 'hr.timesheet.submitted',
      title: `Timesheet ${ts.timesheetNo} awaiting your review`,
      body: 'A timesheet has been submitted for your approval.',
      module: 'hr_attendance', severity: 'warning', sourceType: 'timesheet', sourceId: args.timesheetId,
      actionRequired: true, dedupeKey: `timesheet.in_review.${args.timesheetId}`,
    });
  } else {
    // No binding -> direct auto-approve (graceful fallback; no workflow, no strand).
    if (!['draft', 'reopened'].includes(ts.status)) throw err(409, 'Timesheet cannot be submitted in current status.');
    const now = new Date().toISOString();
    const { error: updErr } = await sb.from('hr_timesheets').update({
      status: 'approved', submitted_by: actorId, submitted_at: now,
      approved_by: actorId, approved_at: now, notes: args.notes ?? ts.notes,
    }).eq('id', args.timesheetId);
    if (updErr) throw err(500, 'Failed to submit timesheet: ' + updErr.message);
    await writeHrAudit({
      submoduleKey: 'hr_attendance', recordId: args.timesheetId, actorId,
      action: 'timesheet.auto_approved', previousState: { status: ts.status }, newState: { status: 'approved' },
      reason: 'No active workflow binding; auto-approved.',
    });
    emitAppEvent({ eventType: 'hr.timesheet.submitted', sourceModule: 'hr_attendance', sourceEntityType: 'timesheet', sourceEntityId: args.timesheetId, actorUserId: actorId, severity: 'info', payload: {} });
    emitAppEvent({ eventType: 'hr.timesheet.approved', sourceModule: 'hr_attendance', sourceEntityType: 'timesheet', sourceEntityId: args.timesheetId, actorUserId: actorId, severity: 'success', payload: { auto: true } });
  }

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