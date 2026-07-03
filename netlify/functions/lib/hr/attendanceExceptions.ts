// lib/hr/attendanceExceptions.ts
// Exception upsert + waive/resolve mutations.

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import type { ExceptionType } from '../../../../types/hrAttendance';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

/**
 * Delete open exceptions for a record and insert the new computed set.
 * Called after every recompute — only touches 'open' exceptions (waived/resolved are preserved).
 */
export async function upsertExceptionsForRecord(
  recordId: string,
  employeeId: string,
  workDate: string,
  exceptions: Array<{ exceptionType: ExceptionType; minutes: number | null }>,
): Promise<void> {
  const { error: delErr } = await sb.from('hr_attendance_exceptions')
    .delete().eq('record_id', recordId).eq('status', 'open');
  if (delErr) throw err(500, 'Failed to clear old exceptions: ' + delErr.message);

  if (exceptions.length === 0) return;

  const rows = exceptions.map(ex => ({
    record_id:      recordId,
    employee_id:    employeeId,
    work_date:      workDate,
    exception_type: ex.exceptionType,
    minutes:        ex.minutes ?? null,
    status:         'open' as const,
  }));

  const { error: insErr } = await sb.from('hr_attendance_exceptions').insert(rows);
  if (insErr) throw err(500, 'Failed to insert exceptions: ' + insErr.message);

  for (const ex of exceptions) {
    emitAppEvent({
      eventType: 'hr.attendance.exception_opened',
      sourceModule: 'hr_attendance', sourceEntityType: 'attendance_exception',
      sourceEntityId: recordId, actorUserId: employeeId, severity: 'warning',
      payload: { exceptionType: ex.exceptionType, workDate },
    });
  }
}

export async function waiveException(actorId: string, exceptionId: string, waiveReason: string): Promise<void> {
  const { data: ex, error } = await sb.from('hr_attendance_exceptions').select('*').eq('id', exceptionId).single<Record<string, unknown>>();
  if (error || !ex) throw err(404, 'Exception not found.');
  if (ex['status'] !== 'open') throw err(409, 'Exception is not open.');

  const { error: updErr } = await sb.from('hr_attendance_exceptions').update({
    status: 'waived', waived_by: actorId, waived_at: new Date().toISOString(), waive_reason: waiveReason,
  }).eq('id', exceptionId);
  if (updErr) throw err(500, 'Failed to waive exception: ' + updErr.message);

  await writeHrAudit({
    submoduleKey: 'hr_attendance', recordId: exceptionId, actorId,
    action: 'exception.waived', previousState: { status: 'open' }, newState: { status: 'waived' },
    reason: waiveReason,
  });
  emitAppEvent({ eventType: 'hr.attendance.exception_waived', sourceModule: 'hr_attendance', sourceEntityType: 'attendance_exception', sourceEntityId: exceptionId, actorUserId: actorId, severity: 'info', payload: { waiveReason } });
}

export async function resolveException(actorId: string, exceptionId: string, resolveNote: string): Promise<void> {
  const { data: ex, error } = await sb.from('hr_attendance_exceptions').select('*').eq('id', exceptionId).single<Record<string, unknown>>();
  if (error || !ex) throw err(404, 'Exception not found.');
  if (ex['status'] !== 'open') throw err(409, 'Exception is not open.');

  const { error: updErr } = await sb.from('hr_attendance_exceptions').update({
    status: 'resolved', resolved_by: actorId, resolved_at: new Date().toISOString(), resolve_note: resolveNote,
  }).eq('id', exceptionId);
  if (updErr) throw err(500, 'Failed to resolve exception: ' + updErr.message);

  await writeHrAudit({
    submoduleKey: 'hr_attendance', recordId: exceptionId, actorId,
    action: 'exception.resolved', previousState: { status: 'open' }, newState: { status: 'resolved' },
    reason: resolveNote,
  });
  emitAppEvent({ eventType: 'hr.attendance.exception_resolved', sourceModule: 'hr_attendance', sourceEntityType: 'attendance_exception', sourceEntityId: exceptionId, actorUserId: actorId, severity: 'info', payload: { resolveNote } });
}