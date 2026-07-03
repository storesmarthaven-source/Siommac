// lib/hr/attendanceCapture.ts
// Punch-in/out capture with geofence validation and photo presign.
// Calls recomputeAttendanceDay after each punch.

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { loadAttendancePolicy, findApprovedLeaveForDate, getAttendanceRecordForDate, mapRecord } from './attendanceQueries';
import { computeDay } from './timekeepingCompute';
import { upsertExceptionsForRecord } from './attendanceExceptions';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

/** Haversine distance in metres between two lat/lng pairs. */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function checkGeofence(siteId: string | null | undefined, lat: number | null | undefined, lng: number | null | undefined, radiusM: number): Promise<boolean> {
  if (!siteId || lat == null || lng == null) return false;
  const { data } = await sb.from('project_sites').select('latitude, longitude').eq('id', siteId).maybeSingle<{ latitude: number | null; longitude: number | null }>();
  if (!data || data.latitude == null || data.longitude == null) return false;
  const dist = distanceMeters(lat, lng, data.latitude, data.longitude);
  return dist > radiusM;
}

/**
 * Recompute a single day: load record + policy + leave -> computeDay ->
 * update computed fields on the record -> delete open exceptions -> upsert new ones.
 */
export async function recomputeAttendanceDay(recordId: string): Promise<void> {
  const { data: recRow, error: recErr } = await sb.from('hr_attendance_records').select('*').eq('id', recordId).single<Record<string, unknown>>();
  if (recErr || !recRow) throw err(404, 'Attendance record not found for recompute.');

  const employeeId = recRow['employee_id'] as string;
  const workDate   = recRow['work_date'] as string;

  // Load punch-in site to resolve the geofence policy
  const punchInSite = recRow['punch_in_site'] as string | null;
  const policy = await loadAttendancePolicy(punchInSite);
  const approvedLeave = await findApprovedLeaveForDate(employeeId, workDate);

  const result = computeDay({
    record: {
      workDate,
      punchInAt:  recRow['punch_in_at'] as string | null,
      punchOutAt: recRow['punch_out_at'] as string | null,
      geofenceViolation: recRow['geofence_violation'] as boolean,
    },
    policy,
    approvedLeave,
  });

  const { error: updateErr } = await sb.from('hr_attendance_records').update({
    status:           result.status,
    worked_minutes:   result.workedMinutes,
    late_minutes:     result.lateMinutes,
    overtime_minutes: result.overtimeMinutes,
  }).eq('id', recordId);
  if (updateErr) throw err(500, 'Failed to update computed fields: ' + updateErr.message);

  await upsertExceptionsForRecord(recordId, employeeId, workDate, result.exceptions);
}
export async function punchIn(actorId: string, args: {
  workDate: string; lat?: number | null; lng?: number | null; siteId?: string | null;
  photoPath?: string | null; source?: string; notes?: string | null;
}) {
  const policy = await loadAttendancePolicy(args.siteId);
  if (!policy.enabled) throw err(403, 'Attendance module is disabled.');

  // Check if already punched in today
  const existing = await getAttendanceRecordForDate(actorId, args.workDate);
  if (existing?.punchInAt) throw err(409, 'Already punched in for this date.');

  const geofenceViolation = await checkGeofence(args.siteId, args.lat, args.lng, policy.geofenceRadiusM);

  const recordNo = await nextRef('ATR');
  const now = new Date().toISOString();

  if (existing) {
    // Upsert onto existing record
    const { error } = await sb.from('hr_attendance_records').update({
      punch_in_at: now, punch_in_site: args.siteId ?? null,
      punch_in_lat: args.lat ?? null, punch_in_lng: args.lng ?? null,
      geofence_violation: geofenceViolation,
      photo_in_path: args.photoPath ?? null, notes: args.notes ?? null,
      source: args.source ?? 'mobile',
    }).eq('id', existing.id);
    if (error) throw err(500, 'Failed to record punch-in: ' + error.message);
    await recomputeAttendanceDay(existing.id);
    const updated = await getAttendanceRecordForDate(actorId, args.workDate);
    emitAppEvent({ eventType: 'hr.attendance.punched_in', sourceModule: 'hr_attendance', sourceEntityType: 'attendance_record', sourceEntityId: existing.id, actorUserId: actorId, severity: 'info', payload: { workDate: args.workDate, geofenceViolation } });
    return updated;
  }

  const { data: newRec, error: insErr } = await sb.from('hr_attendance_records').insert({
    record_no: recordNo, employee_id: actorId, work_date: args.workDate,
    punch_in_at: now, punch_in_site: args.siteId ?? null,
    punch_in_lat: args.lat ?? null, punch_in_lng: args.lng ?? null,
    geofence_violation: geofenceViolation,
    photo_in_path: args.photoPath ?? null, notes: args.notes ?? null,
    source: args.source ?? 'mobile', status: 'missing_punch',
  }).select('*').single<Record<string, unknown>>();
  if (insErr || !newRec) throw err(500, 'Failed to create attendance record: ' + insErr?.message);

  await recomputeAttendanceDay(newRec['id'] as string);
  const freshRec = await getAttendanceRecordForDate(actorId, args.workDate);
  emitAppEvent({ eventType: 'hr.attendance.punched_in', sourceModule: 'hr_attendance', sourceEntityType: 'attendance_record', sourceEntityId: newRec['id'] as string, actorUserId: actorId, severity: 'info', payload: { workDate: args.workDate, geofenceViolation } });
  return freshRec;
}
export async function punchOut(actorId: string, args: {
  recordId?: string; lat?: number | null; lng?: number | null;
  siteId?: string | null; photoPath?: string | null;
}) {
  let record;
  if (args.recordId) {
    const { data } = await sb.from('hr_attendance_records').select('*').eq('id', args.recordId).maybeSingle<Record<string, unknown>>();
    record = data;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await sb.from('hr_attendance_records').select('*')
      .eq('employee_id', actorId).eq('work_date', today).maybeSingle<Record<string, unknown>>();
    record = data;
  }
  if (!record) throw err(404, 'No open attendance record found for punch-out.');
  if (!record['punch_in_at']) throw err(409, 'Cannot punch out without a prior punch-in.');
  if (record['punch_out_at']) throw err(409, 'Already punched out for this record.');

  const punchInSite = record['punch_in_site'] as string | null;
  const policy = await loadAttendancePolicy(punchInSite);
  const geofenceViolation = (record['geofence_violation'] as boolean) ||
    await checkGeofence(args.siteId, args.lat, args.lng, policy.geofenceRadiusM);
  const now = new Date().toISOString();

  const { error: updErr } = await sb.from('hr_attendance_records').update({
    punch_out_at: now, punch_out_site: args.siteId ?? null,
    punch_out_lat: args.lat ?? null, punch_out_lng: args.lng ?? null,
    geofence_violation: geofenceViolation,
    photo_out_path: args.photoPath ?? null,
  }).eq('id', record['id'] as string);
  if (updErr) throw err(500, 'Failed to record punch-out: ' + updErr.message);

  await recomputeAttendanceDay(record['id'] as string);
  emitAppEvent({ eventType: 'hr.attendance.punched_out', sourceModule: 'hr_attendance', sourceEntityType: 'attendance_record', sourceEntityId: record['id'] as string, actorUserId: actorId, severity: 'info', payload: { geofenceViolation } });
  return getAttendanceRecordForDate(actorId, record['work_date'] as string);
}

/** Generate presigned upload URL for punch photo (private hr-attendance-photos bucket). */
export async function createPunchPhotoUploadUrl(mimeType: string): Promise<{ uploadUrl: string; path: string }> {
  const ext: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const fileExt = ext[mimeType.toLowerCase()];
  if (!fileExt) throw err(400, 'Unsupported photo type. Allowed: jpeg, png, webp.');
  const path = `punch_${Date.now()}.${fileExt}`;
  const { data, error } = await sb.storage.from('hr-attendance-photos').createSignedUploadUrl(path);
  if (error || !data) throw err(500, 'Failed to create photo upload URL: ' + (error?.message ?? 'unknown'));
  return { uploadUrl: data.signedUrl, path };
}

/** Generate presigned read URL for a punch photo. */
export async function createPunchPhotoReadUrl(path: string): Promise<string> {
  const { data, error } = await sb.storage.from('hr-attendance-photos').createSignedUrl(path, 900);
  if (error || !data) throw err(500, 'Failed to create photo read URL: ' + (error?.message ?? 'unknown'));
  return data.signedUrl;
}