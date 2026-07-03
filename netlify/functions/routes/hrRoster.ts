/**
 * netlify/functions/routes/hrRoster.ts
 *
 * HR Shift / Roster Scheduling — POST-only routes (mount at /api/hr/roster in api.ts).
 * Every route: requirePermission → validate body.args → call lib → c.json envelope.
 * No URL router. No workflow wiring (direct publish path per §2.3).
 *
 * Mount line for api.ts:
 *   import hrRosterRouter from './routes/hrRoster';
 *   app.route('/api/hr/roster', hrRosterRouter);
 */

import { Hono, type Context } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv }            from '../lib/validate';
import {
  listShiftTemplates, upsertShiftTemplate, removeShiftTemplate,
  listRotationPatterns, upsertRotationPattern,
  listCoverageRequirements, upsertCoverageRequirement,
} from '../lib/hr/rosterTemplates';
import {
  createRoster, generateFromRotation, syncLeave,
  saveAssignment, removeAssignment, bulkUpsertAssignments,
  publishRoster, reopenRoster,
} from '../lib/hr/rosterCore';
import {
  listRosters, getRoster, getCoverageGaps, getMyShifts, getExpectedShift,
} from '../lib/hr/rosterQueries';
import { getRosterStats, getEmployeeHoursSummary } from '../lib/hr/rosterReports';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

type HCtx = Context<{ Variables: HonoVariables }>;
const body = (c: HCtx) => (c.get('body') as Record<string, unknown>).args ?? {};
function routeErr(c: HCtx, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Request failed.' }, (er.status ?? 500) as 200);
}

// ── Shift templates ────────────────────────────────────────────────────────────

// POST /api/hr/roster/templates/list
router.post('/templates/list', async c => {
  await requirePermission(c, 'hr.roster.view');
  const v = zv(c, z.object({ siteId: z.string().optional(), activeOnly: z.boolean().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listShiftTemplates(v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/templates/upsert
router.post('/templates/upsert', async c => {
  const actor = await requirePermission(c, 'hr.roster.templates.manage');
  const v = zv(c, z.object({
    id:             z.string().uuid().optional(),
    code:           z.string().min(1).max(20),
    name:           z.string().min(1).max(100),
    startsAt:       z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    endsAt:         z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    crossesMidnight: z.boolean().optional(),
    breakMinutes:   z.number().int().min(0).optional(),
    paidHours:      z.number().min(0).max(24),
    colour:         z.string().max(20).nullable().optional(),
    siteId:         z.string().nullable().optional(),
    isActive:       z.boolean().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await upsertShiftTemplate(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/templates/remove
router.post('/templates/remove', async c => {
  const actor = await requirePermission(c, 'hr.roster.templates.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { await removeShiftTemplate(actor.id, v.data.id); return c.json({ success: true }); }
  catch (e) { return routeErr(c, e); }
});

// ── Rotation patterns ─────────────────────────────────────────────────────────

// POST /api/hr/roster/rotations/list
router.post('/rotations/list', async c => {
  await requirePermission(c, 'hr.roster.view');
  const v = zv(c, z.object({ activeOnly: z.boolean().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listRotationPatterns(v.data.activeOnly ?? true) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/rotations/upsert
router.post('/rotations/upsert', async c => {
  const actor = await requirePermission(c, 'hr.roster.templates.manage');
  const patternDaySchema = z.object({
    dayIndex: z.number().int().min(0),
    shiftTemplateCode: z.string().min(1),
  });
  const v = zv(c, z.object({
    id:        z.string().uuid().optional(),
    code:      z.string().min(1).max(20),
    name:      z.string().min(1).max(100),
    cycleDays: z.number().int().min(1).max(365),
    pattern:   z.array(patternDaySchema).min(1),
    isActive:  z.boolean().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await upsertRotationPattern(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// ── Coverage requirements ─────────────────────────────────────────────────────

// POST /api/hr/roster/coverage/list
router.post('/coverage/list', async c => {
  await requirePermission(c, 'hr.roster.view');
  const v = zv(c, z.object({ siteId: z.string().optional(), activeOnly: z.boolean().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listCoverageRequirements(v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/coverage/upsert
router.post('/coverage/upsert', async c => {
  const actor = await requirePermission(c, 'hr.roster.templates.manage');
  const v = zv(c, z.object({
    id:               z.string().uuid().optional(),
    siteId:           z.string().nullable().optional(),
    departmentId:     z.string().nullable().optional(),
    positionId:       z.string().uuid().nullable().optional(),
    shiftTemplateId:  z.string().uuid(),
    requiredHeadcount: z.number().int().min(1).max(1000),
    dayOfWeek:        z.number().int().min(0).max(6).nullable().optional(),
    isActive:         z.boolean().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await upsertCoverageRequirement(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// ── Rosters ───────────────────────────────────────────────────────────────────

// POST /api/hr/roster/rosters/list
router.post('/rosters/list', async c => {
  await requirePermission(c, 'hr.roster.view');
  const v = zv(c, z.object({
    siteId:       z.string().optional(),
    departmentId: z.string().optional(),
    status:       z.string().optional(),
    from:         z.string().optional(),
    to:           z.string().optional(),
    limit:        z.number().int().positive().max(500).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listRosters(v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/rosters/get
router.post('/rosters/get', async c => {
  await requirePermission(c, 'hr.roster.view');
  const v = zv(c, z.object({ rosterId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try {
    const detail = await getRoster(v.data.rosterId);
    if (!detail) return c.json({ success: false, message: 'Roster not found.' }, 404 as 200);
    return c.json({ success: true, data: detail });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/rosters/create
router.post('/rosters/create', async c => {
  const actor = await requirePermission(c, 'hr.roster.manage');
  const v = zv(c, z.object({
    title:              z.string().min(1).max(200),
    siteId:             z.string().min(1),
    departmentId:       z.string().nullable().optional(),
    periodStart:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rotationPatternId:  z.string().uuid().nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    const r = await createRoster(actor.id, v.data);
    return c.json({ success: true, data: r });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/rosters/generate
router.post('/rosters/generate', async c => {
  const actor = await requirePermission(c, 'hr.roster.manage');
  const v = zv(c, z.object({ rosterId: z.string().uuid(), patternId: z.string().uuid().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await generateFromRotation(actor.id, v.data.rosterId, v.data.patternId) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/rosters/sync-leave
router.post('/rosters/sync-leave', async c => {
  const actor = await requirePermission(c, 'hr.roster.manage');
  const v = zv(c, z.object({ rosterId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await syncLeave(actor.id, v.data.rosterId) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/rosters/publish
router.post('/rosters/publish', async c => {
  const actor = await requirePermission(c, 'hr.roster.publish');
  const v = zv(c, z.object({ rosterId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try {
    const updated = await publishRoster(actor.id, v.data.rosterId);
    return c.json({ success: true, data: updated });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/rosters/reopen
router.post('/rosters/reopen', async c => {
  const actor = await requirePermission(c, 'hr.roster.manage');
  const v = zv(c, z.object({ rosterId: z.string().uuid(), reason: z.string().max(500).optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await reopenRoster(actor.id, v.data.rosterId, v.data.reason) }); }
  catch (e) { return routeErr(c, e); }
});

// ── Assignments ───────────────────────────────────────────────────────────────

// POST /api/hr/roster/assignments/upsert
router.post('/assignments/upsert', async c => {
  const actor = await requirePermission(c, 'hr.roster.manage');
  const v = zv(c, z.object({
    rosterId:        z.string().uuid(),
    employeeId:      z.string().min(1),
    workDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    shiftTemplateId: z.string().uuid().nullable().optional(),
    kind:            z.enum(['shift', 'off', 'leave', 'open']),
    hours:           z.number().min(0).max(24).nullable().optional(),
    note:            z.string().max(500).nullable().optional(),
    source:          z.enum(['manual', 'rotation', 'leave_sync']).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await saveAssignment(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/assignments/remove
router.post('/assignments/remove', async c => {
  const actor = await requirePermission(c, 'hr.roster.manage');
  const v = zv(c, z.object({ assignmentId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { await removeAssignment(actor.id, v.data.assignmentId); return c.json({ success: true }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/assignments/bulk
router.post('/assignments/bulk', async c => {
  const actor = await requirePermission(c, 'hr.roster.manage');
  const assignmentSchema = z.object({
    employeeId:      z.string().min(1),
    workDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    shiftTemplateId: z.string().uuid().nullable().optional(),
    kind:            z.enum(['shift', 'off', 'leave', 'open']),
    hours:           z.number().min(0).max(24).nullable().optional(),
    note:            z.string().max(500).nullable().optional(),
    source:          z.enum(['manual', 'rotation', 'leave_sync']).optional(),
  });
  const v = zv(c, z.object({
    rosterId:    z.string().uuid(),
    assignments: z.array(assignmentSchema).min(1).max(500),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await bulkUpsertAssignments(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// ── Coverage gaps ─────────────────────────────────────────────────────────────

// POST /api/hr/roster/coverage/gaps
router.post('/coverage/gaps', async c => {
  await requirePermission(c, 'hr.roster.view');
  const v = zv(c, z.object({ rosterId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await getCoverageGaps(v.data.rosterId) }); }
  catch (e) { return routeErr(c, e); }
});

// ── My shifts (employee self-view) ────────────────────────────────────────────

// POST /api/hr/roster/my-shifts
router.post('/my-shifts', async c => {
  const actor = await requirePermission(c, 'hr.roster.view_own');
  const v = zv(c, z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // employee self-view: actor's own shifts only (no employeeId override)
  }), body(c));
  if (!v.ok) return v.response;
  try {
    const shifts = await getMyShifts(actor.id, v.data.from, v.data.to);
    return c.json({ success: true, data: shifts });
  } catch (e) { return routeErr(c, e); }
});

// ── Expected shift (Attendance feed) ─────────────────────────────────────────

// POST /api/hr/roster/expected-shift
// Used by the Attendance module to resolve the expected shift for an employee/date.
router.post('/expected-shift', async c => {
  await requirePermission(c, 'hr.roster.view');
  const v = zv(c, z.object({
    employeeId: z.string().min(1),
    workDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    const shift = await getExpectedShift(v.data.employeeId, v.data.workDate);
    return c.json({ success: true, data: shift ?? null });
  } catch (e) { return routeErr(c, e); }
});

// ── Reports ───────────────────────────────────────────────────────────────────

// POST /api/hr/roster/reports/stats
router.post('/reports/stats', async c => {
  await requirePermission(c, 'hr.roster.view');
  const v = zv(c, z.object({ siteId: z.string().optional(), departmentId: z.string().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await getRosterStats(v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/roster/reports/hours
router.post('/reports/hours', async c => {
  await requirePermission(c, 'hr.roster.view');
  const v = zv(c, z.object({ rosterId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await getEmployeeHoursSummary(v.data.rosterId) }); }
  catch (e) { return routeErr(c, e); }
});

export default router;
