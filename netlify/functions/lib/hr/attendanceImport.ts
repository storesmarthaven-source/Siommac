// lib/hr/attendanceImport.ts
// Bulk CSV import of attendance punches. Imports punch in/out per employee per day
// (source='import'), then reuses recomputeAttendanceDay so worked/late/overtime
// minutes + exceptions are derived by the SAME pipeline as live punches — the
// resulting worked_minutes roll up into hr_timesheets and feed payroll. No band-aid:
// hours are never written directly; they are always computed from the punches.

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { recomputeAttendanceDay } from './attendanceCapture';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

export const IMPORT_MAX_ROWS = 500;

export interface AttendanceImportRow {
  /** Resolve the employee by app_users.id … */
  employeeId?: string | null;
  /** … or by username (whichever is present; employeeId wins). */
  username?: string | null;
  workDate: string;               // YYYY-MM-DD
  punchIn?: string | null;        // "HH:MM" or full ISO
  punchOut?: string | null;       // "HH:MM" or full ISO
  siteId?: string | null;
}

export interface AttendanceImportError { row: number; employee?: string; message: string }
export interface AttendanceImportResult {
  total: number;
  imported: number;   // new records created
  updated: number;    // existing records overwritten
  skipped: number;    // rows with errors (not applied)
  errors: AttendanceImportError[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Combine a work date with a "HH:MM" time (or accept a full ISO timestamp). */
function toIso(workDate: string, t: string | null | undefined): string | null {
  if (t == null || String(t).trim() === '') return null;
  const s = String(t).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s; // already an ISO datetime
  const m = TIME_RE.exec(s);
  if (!m) throw err(422, `Invalid time "${s}" (expected HH:MM or ISO).`);
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 23 || mm > 59) throw err(422, `Time out of range "${s}".`);
  return `${workDate}T${String(hh).padStart(2, '0')}:${m[2]}:00.000Z`;
}

/**
 * Import a batch of attendance punches. Per-row error isolation — a bad row is
 * reported in `errors` and skipped; the rest still apply.
 */
export async function importAttendancePunches(
  actorId: string,
  rows: AttendanceImportRow[],
): Promise<AttendanceImportResult> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw err(422, 'No rows to import.');
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    throw err(422, `Too many rows (${rows.length}). Import at most ${IMPORT_MAX_ROWS} at a time.`);
  }

  // Resolve employees for the whole batch up front (by id and by username).
  const ids = [...new Set(rows.map(r => (r.employeeId ?? '').trim()).filter(Boolean))];
  const usernames = [...new Set(rows.map(r => (r.username ?? '').trim()).filter(Boolean))];
  const validIds = new Set<string>();
  const byUsername = new Map<string, string>();
  if (ids.length) {
    const { data } = await sb.from('app_users').select('id').in('id', ids);
    for (const u of (data ?? []) as { id: string }[]) validIds.add(u.id);
  }
  if (usernames.length) {
    const { data } = await sb.from('app_users').select('id, username').in('username', usernames);
    for (const u of (data ?? []) as { id: string; username: string }[]) byUsername.set(u.username, u.id);
  }

  const result: AttendanceImportResult = { total: rows.length, imported: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const rowNo = i + 1;
    const key = (raw.employeeId ?? raw.username ?? '').trim() || '(blank)';
    try {
      // Resolve employee
      const employeeId = raw.employeeId && validIds.has(raw.employeeId.trim())
        ? raw.employeeId.trim()
        : (raw.username ? byUsername.get(raw.username.trim()) : undefined);
      if (!employeeId) throw err(422, `Employee "${key}" not found.`);

      if (!DATE_RE.test(String(raw.workDate ?? '').trim())) {
        throw err(422, `Invalid work date "${raw.workDate}" (expected YYYY-MM-DD).`);
      }
      const workDate = String(raw.workDate).trim();

      const punchInAt  = toIso(workDate, raw.punchIn);
      const punchOutAt = toIso(workDate, raw.punchOut);
      if (!punchInAt && !punchOutAt) throw err(422, 'At least one of punchIn / punchOut is required.');
      if (punchInAt && punchOutAt && punchOutAt <= punchInAt) {
        throw err(422, 'Punch-out must be after punch-in.');
      }

      // Upsert on (employee_id, work_date)
      const { data: existing } = await sb.from('hr_attendance_records')
        .select('id').eq('employee_id', employeeId).eq('work_date', workDate).maybeSingle<{ id: string }>();

      let recordId: string;
      if (existing) {
        const { error } = await sb.from('hr_attendance_records').update({
          punch_in_at: punchInAt, punch_out_at: punchOutAt,
          punch_in_site: raw.siteId ?? null, source: 'import',
        }).eq('id', existing.id);
        if (error) throw err(500, error.message);
        recordId = existing.id;
        result.updated++;
      } else {
        const recordNo = await nextRef('ATR');
        const { data: ins, error } = await sb.from('hr_attendance_records').insert({
          record_no: recordNo, employee_id: employeeId, work_date: workDate,
          punch_in_at: punchInAt, punch_out_at: punchOutAt,
          punch_in_site: raw.siteId ?? null, source: 'import', status: 'missing_punch',
        }).select('id').single<{ id: string }>();
        if (error || !ins) throw err(500, error?.message ?? 'insert failed');
        recordId = ins.id;
        result.imported++;
      }

      // Derive worked/late/overtime minutes + exceptions via the shared pipeline.
      await recomputeAttendanceDay(recordId);
    } catch (e) {
      result.skipped++;
      result.errors.push({ row: rowNo, employee: key, message: (e as Error).message ?? 'Import failed.' });
    }
  }

  const applied = result.imported + result.updated;
  await writeHrAudit({
    submoduleKey: 'hr_attendance', recordId: `import_${actorId}`, actorId,
    action: 'attendance.imported',
    previousState: null,
    newState: { total: result.total, imported: result.imported, updated: result.updated, skipped: result.skipped },
  });
  void emitAppEvent({
    eventType: 'hr.attendance.imported',
    sourceModule: 'hr_attendance', sourceEntityType: 'attendance_import', sourceEntityId: `import_${actorId}`,
    actorUserId: actorId, severity: applied > 0 ? 'info' : 'warning',
    payload: { total: result.total, applied, skipped: result.skipped },
  });

  return result;
}
