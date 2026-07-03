// lib/hr/attendanceCorrections.ts
// Apply a field-level correction to an attendance record + audit.

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { recomputeAttendanceDay } from './attendanceCapture';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

const CORRECTABLE_FIELDS = ['punch_in_at', 'punch_out_at', 'status', 'notes', 'source'] as const;
type CorrectableField = typeof CORRECTABLE_FIELDS[number];

export async function applyCorrection(actorId: string, args: {
  recordId: string; fieldName: string; newValue: string; reason: string;
}): Promise<void> {
  if (!CORRECTABLE_FIELDS.includes(args.fieldName as CorrectableField)) {
    throw err(400, 'Field ' + args.fieldName + ' cannot be corrected. Allowed: ' + CORRECTABLE_FIELDS.join(', ') + '.');
  }

  const { data: rec, error: recErr } = await sb.from('hr_attendance_records').select('*').eq('id', args.recordId).single<Record<string, unknown>>();
  if (recErr || !rec) throw err(404, 'Attendance record not found.');

  const oldValue = rec[args.fieldName] == null ? null : String(rec[args.fieldName]);
  const newValue: unknown = ['punch_in_at', 'punch_out_at'].includes(args.fieldName)
    ? (args.newValue || null)
    : args.newValue;

  const { error: updErr } = await sb.from('hr_attendance_records').update({ [args.fieldName]: newValue }).eq('id', args.recordId);
  if (updErr) throw err(500, 'Failed to apply correction: ' + updErr.message);

  const { error: corrErr } = await sb.from('hr_attendance_corrections').insert({
    record_id:    args.recordId,
    employee_id:  rec['employee_id'] as string,
    work_date:    rec['work_date'] as string,
    field_name:   args.fieldName,
    old_value:    oldValue,
    new_value:    args.newValue,
    reason:       args.reason,
    corrected_by: actorId,
  });
  if (corrErr) {
    // Compensating rollback: revert the field change
    await sb.from('hr_attendance_records').update({ [args.fieldName]: oldValue }).eq('id', args.recordId);
    throw err(500, 'Failed to log correction (field change rolled back): ' + corrErr.message);
  }

  await writeHrAudit({
    submoduleKey: 'hr_attendance', recordId: args.recordId, actorId,
    action: 'attendance.correction', previousState: { [args.fieldName]: oldValue },
    newState: { [args.fieldName]: args.newValue }, reason: args.reason,
  });

  // Recompute if a punch time changed
  if (['punch_in_at', 'punch_out_at'].includes(args.fieldName)) {
    await recomputeAttendanceDay(args.recordId);
  }

  emitAppEvent({ eventType: 'hr.attendance.correction_applied', sourceModule: 'hr_attendance', sourceEntityType: 'attendance_record', sourceEntityId: args.recordId, actorUserId: actorId, severity: 'info', payload: { fieldName: args.fieldName, reason: args.reason } });
}