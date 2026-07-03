// routes/hrAttendance.ts — HR Attendance & Timekeeping routes
// Mounted at /api/hr/attendance in api.ts.
// All routes POST-only, JWT-gated via requirePermission.

import { Hono } from 'hono';
import { requirePermission, userCan } from '../lib/auth';
import { z, zv } from '../lib/validate';
import { emitAppEvent } from '../lib/appEvents';
import {
  listAttendanceRecords, getAttendanceRecord, getAttendanceStats,
  listTimesheets, getTimesheet, listExceptions, loadAttendancePolicy,
} from '../lib/hr/attendanceQueries';
import { punchIn, punchOut, createPunchPhotoUploadUrl, createPunchPhotoReadUrl, recomputeAttendanceDay } from '../lib/hr/attendanceCapture';
import { applyCorrection } from '../lib/hr/attendanceCorrections';
import { waiveException, resolveException } from '../lib/hr/attendanceExceptions';
import { buildTimesheet, submitTimesheet, reopenTimesheet } from '../lib/hr/timesheetService';
import { listReports, runReport } from '../lib/hr/attendanceReports';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const body = (c: { get: (k: string) => unknown }) => (c.get('body') as Record<string, unknown>).args ?? {};

// ── Photo upload URL ─────────────────────────────────────────────────────────
router.post('/attendance/punch/upload-url', async c => {
  await requirePermission(c, 'hr.attendance.punch');
  const v = zv(c, z.object({ mimeType: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  try {
    const result = await createPunchPhotoUploadUrl(v.data.mimeType);
    return c.json({ success: true, data: result });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Photo read URL ───────────────────────────────────────────────────────────
router.post('/attendance/punch/photo-url', async c => {
  await requirePermission(c, 'hr.attendance.view');
  const v = zv(c, z.object({ path: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  try {
    const url = await createPunchPhotoReadUrl(v.data.path);
    return c.json({ success: true, data: { url } });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Punch in ──────────────────────────────────────────────────────────────────
router.post('/attendance/punch/in', async c => {
  const actor = await requirePermission(c, 'hr.attendance.punch');
  const v = zv(c, z.object({
    workDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    lat:       z.number().nullable().optional(),
    lng:       z.number().nullable().optional(),
    siteId:    z.string().nullable().optional(),
    photoPath: z.string().nullable().optional(),
    source:    z.enum(['manual','kiosk','mobile','import']).optional(),
    notes:     z.string().max(500).nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    const record = await punchIn(actor.id, v.data);
    return c.json({ success: true, data: record });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Punch out ─────────────────────────────────────────────────────────────────
router.post('/attendance/punch/out', async c => {
  const actor = await requirePermission(c, 'hr.attendance.punch');
  const v = zv(c, z.object({
    recordId:  z.string().uuid().optional(),
    lat:       z.number().nullable().optional(),
    lng:       z.number().nullable().optional(),
    siteId:    z.string().nullable().optional(),
    photoPath: z.string().nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    const record = await punchOut(actor.id, v.data);
    return c.json({ success: true, data: record });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Records list ─────────────────────────────────────────────────────────────
router.post('/attendance/records/list', async c => {
  const actor = await requirePermission(c, 'hr.attendance.view');
  const v = zv(c, z.object({
    employeeId: z.string().optional(),
    fromDate:   z.string().optional(),
    toDate:     z.string().optional(),
    timesheetId:z.string().uuid().optional(),
    limit:      z.number().int().min(1).max(500).optional(),
    offset:     z.number().int().min(0).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  // Self-scope enforcement: employees without view_all can only see their own records
  const canViewAll = await userCan(actor, 'hr.attendance.view_all');
  const empId = canViewAll ? v.data.employeeId : actor.id;
  try {
    const result = await listAttendanceRecords({ ...v.data, employeeId: empId });
    return c.json({ success: true, data: result });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Record get ───────────────────────────────────────────────────────────────
router.post('/attendance/records/get', async c => {
  const actor = await requirePermission(c, 'hr.attendance.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  const record = await getAttendanceRecord(v.data.id);
  if (!record) return c.json({ success: false, message: 'Record not found.' }, 404 as 200);
  const canViewAll = await userCan(actor, 'hr.attendance.view_all');
  if (!canViewAll && record.employeeId !== actor.id) return c.json({ success: false, message: 'Access denied.' }, 403 as 200);
  return c.json({ success: true, data: record });
});

// ── Correction ───────────────────────────────────────────────────────────────
router.post('/attendance/records/correct', async c => {
  const actor = await requirePermission(c, 'hr.attendance.correct');
  const v = zv(c, z.object({
    recordId:  z.string().uuid(),
    fieldName: z.string().min(1),
    newValue:  z.string(),
    reason:    z.string().min(1).max(500),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    await applyCorrection(actor.id, v.data);
    const updated = await getAttendanceRecord(v.data.recordId);
    return c.json({ success: true, data: updated });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Compute run ───────────────────────────────────────────────────────────────
router.post('/attendance/compute/run', async c => {
  const actor = await requirePermission(c, 'hr.attendance.compute.run');
  const v = zv(c, z.object({ recordId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try {
    await recomputeAttendanceDay(v.data.recordId);
    const updated = await getAttendanceRecord(v.data.recordId);
    emitAppEvent({ eventType: 'hr.attendance.compute_completed', sourceModule: 'hr_attendance', sourceEntityType: 'attendance_record', sourceEntityId: v.data.recordId, actorUserId: actor.id, severity: 'info', payload: {} });
    return c.json({ success: true, data: updated });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Exceptions list ───────────────────────────────────────────────────────────
router.post('/attendance/exceptions/list', async c => {
  const actor = await requirePermission(c, 'hr.attendance.exceptions.view');
  const v = zv(c, z.object({
    employeeId:  z.string().optional(),
    status:      z.string().optional(),
    timesheetId: z.string().uuid().optional(),
    fromDate:    z.string().optional(),
    toDate:      z.string().optional(),
    limit:       z.number().int().min(1).max(500).optional(),
    offset:      z.number().int().min(0).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  const canViewAll = await userCan(actor, 'hr.attendance.view_all');
  const empId = canViewAll ? v.data.employeeId : actor.id;
  try {
    const result = await listExceptions({ ...v.data, employeeId: empId });
    return c.json({ success: true, data: result });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Exception waive ───────────────────────────────────────────────────────────
router.post('/attendance/exceptions/waive', async c => {
  const actor = await requirePermission(c, 'hr.attendance.exceptions.manage');
  const v = zv(c, z.object({ exceptionId: z.string().uuid(), waiveReason: z.string().min(1).max(500) }), body(c));
  if (!v.ok) return v.response;
  try {
    await waiveException(actor.id, v.data.exceptionId, v.data.waiveReason);
    return c.json({ success: true, data: null });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Exception resolve ─────────────────────────────────────────────────────────
router.post('/attendance/exceptions/resolve', async c => {
  const actor = await requirePermission(c, 'hr.attendance.exceptions.manage');
  const v = zv(c, z.object({ exceptionId: z.string().uuid(), resolveNote: z.string().min(1).max(500) }), body(c));
  if (!v.ok) return v.response;
  try {
    await resolveException(actor.id, v.data.exceptionId, v.data.resolveNote);
    return c.json({ success: true, data: null });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Timesheet list ────────────────────────────────────────────────────────────
router.post('/attendance/timesheets/list', async c => {
  const actor = await requirePermission(c, 'hr.attendance.timesheets.view');
  const v = zv(c, z.object({
    employeeId: z.string().optional(),
    status:     z.string().optional(),
    fromPeriod: z.string().optional(),
    toPeriod:   z.string().optional(),
    limit:      z.number().int().min(1).max(200).optional(),
    offset:     z.number().int().min(0).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  const canViewAll = await userCan(actor, 'hr.attendance.view_all');
  const empId = canViewAll ? v.data.employeeId : actor.id;
  try {
    const result = await listTimesheets({ ...v.data, employeeId: empId });
    return c.json({ success: true, data: result });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Timesheet get ─────────────────────────────────────────────────────────────
router.post('/attendance/timesheets/get', async c => {
  const actor = await requirePermission(c, 'hr.attendance.timesheets.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  const ts = await getTimesheet(v.data.id);
  if (!ts) return c.json({ success: false, message: 'Timesheet not found.' }, 404 as 200);
  const canViewAll = await userCan(actor, 'hr.attendance.view_all');
  if (!canViewAll && ts.employeeId !== actor.id) return c.json({ success: false, message: 'Access denied.' }, 403 as 200);
  return c.json({ success: true, data: ts });
});

// ── Timesheet build ───────────────────────────────────────────────────────────
router.post('/attendance/timesheets/build', async c => {
  const actor = await requirePermission(c, 'hr.attendance.timesheets.submit');
  const v = zv(c, z.object({
    employeeId:  z.string().min(1),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }), body(c));
  if (!v.ok) return v.response;
  const canViewAll = await userCan(actor, 'hr.attendance.view_all');
  if (!canViewAll && v.data.employeeId !== actor.id) return c.json({ success: false, message: 'Access denied.' }, 403 as 200);
  try {
    const ts = await buildTimesheet(actor.id, v.data);
    return c.json({ success: true, data: ts });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Timesheet submit ──────────────────────────────────────────────────────────
router.post('/attendance/timesheets/submit', async c => {
  const actor = await requirePermission(c, 'hr.attendance.timesheets.submit');
  const v = zv(c, z.object({
    timesheetId: z.string().uuid(),
    notes:       z.string().max(500).nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    const ts = await submitTimesheet(actor.id, v.data);
    return c.json({ success: true, data: ts });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Timesheet reopen ──────────────────────────────────────────────────────────
router.post('/attendance/timesheets/reopen', async c => {
  const actor = await requirePermission(c, 'hr.attendance.timesheets.approve');
  const v = zv(c, z.object({ timesheetId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try {
    await reopenTimesheet(actor.id, v.data.timesheetId);
    return c.json({ success: true, data: null });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Live / daily stats ────────────────────────────────────────────────────────
router.post('/attendance/stats', async c => {
  await requirePermission(c, 'hr.attendance.view');
  const v = zv(c, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), body(c));
  if (!v.ok) return v.response;
  const today = v.data.date ?? new Date().toISOString().slice(0, 10);
  try {
    const stats = await getAttendanceStats(today);
    return c.json({ success: true, data: stats });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Policy get ────────────────────────────────────────────────────────────────
router.post('/attendance/policy/get', async c => {
  await requirePermission(c, 'hr.attendance.view');
  const v = zv(c, z.object({ siteId: z.string().nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  try {
    const policy = await loadAttendancePolicy(v.data.siteId);
    return c.json({ success: true, data: policy });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Reports list ──────────────────────────────────────────────────────────────
router.post('/attendance/reports/list', async c => {
  await requirePermission(c, 'hr.attendance.reports.view');
  return c.json({ success: true, data: await listReports() });
});

// ── Reports run ───────────────────────────────────────────────────────────────
router.post('/attendance/reports/run', async c => {
  await requirePermission(c, 'hr.attendance.reports.view');
  const v = zv(c, z.object({
    reportKey:    z.string().min(1),
    fromDate:     z.string().optional(),
    toDate:       z.string().optional(),
    employeeId:   z.string().optional(),
    departmentId: z.string().optional(),
    siteId:       z.string().optional(),
    limit:        z.number().int().min(1).max(1000).optional(),
    offset:       z.number().int().min(0).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    const result = await runReport(v.data as Parameters<typeof runReport>[0]);
    return c.json({ success: true, data: result });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

export default router;
