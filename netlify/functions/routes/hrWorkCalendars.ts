// Shared Work Calendar (F-CAL) routes. All POST; authenticated; body = args ?? raw. The backend injects the
// actor; the browser never chooses an audit actor. RPCs derive the idempotency hash in SQL.
import { Hono } from 'hono';
import type { HonoVariables } from '../../../types/api';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  holidaySetCommand, workCalendarCommand, assignmentCommand, resolveWorkCalendar,
  listHolidayCalendars, listWorkCalendars, getHolidayCalendar, getWorkCalendar, listHolidays, listAssignments,
} from '../lib/hr/workCalendar';

const router = new Hono<{ Variables: HonoVariables }>();
const body = (c: { get: (k: string) => unknown }): unknown => {
  const raw = c.get('body') as Record<string, unknown>;
  return raw.args ?? raw;
};
const fail = (c: { json: (v: unknown, s: number) => Response }, error: unknown): Response => {
  const e = error as { status?: number; message?: string };
  return c.json({ success: false, message: e.message ?? 'Internal error' }, (e.status ?? 500) as 200);
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requestKey = z.string().trim().min(8).max(200);
const reason = z.string().trim().min(1).max(500);
const uuid = z.string().uuid();
const weekday = z.number().int().min(1).max(7);
const fractions = z.record(z.string().regex(/^[1-7]$/), z.number().gt(0).lt(1));
const holidayInput = z.object({
  holidayDate: date, observedDate: date.optional(), dayFraction: z.number().gt(0).max(1).optional(),
  nameStatutory: z.string().trim().min(1).max(200), nameCommon: z.string().trim().min(1).max(200),
  holidayType: z.enum(['statutory', 'proclaimed', 'movable']),
  sourceReference: z.string().trim().min(1).max(500), sourcePublishedDate: date, provenanceNote: z.string().trim().min(1).max(1000),
}).strict();

// ── Holiday-set commands ─────────────────────────────────────────────────────
const holidaySchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('create_version'), requestKey, reason, calendarId: uuid.optional(),
    calendar: z.object({ name: z.string().trim().min(2).max(120), jurisdiction: z.string().trim().min(2).max(20) }).strict().optional(),
    effectiveFrom: date, effectiveTo: date.optional(), timezone: z.string().optional() }).strict(),
  z.object({ command: z.literal('copy_version'), requestKey, reason, sourceVersionId: uuid, effectiveFrom: date, effectiveTo: date.optional() }).strict(),
  z.object({ command: z.literal('add_holiday'), requestKey, reason, versionId: uuid, expectedLockVersion: z.number().int(), holiday: holidayInput }).strict(),
  z.object({ command: z.literal('update_holiday'), requestKey, reason, versionId: uuid, holidayId: uuid, expectedLockVersion: z.number().int(), holiday: holidayInput }).strict(),
  z.object({ command: z.literal('remove_holiday'), requestKey, reason, versionId: uuid, holidayId: uuid, expectedLockVersion: z.number().int() }).strict(),
  z.object({ command: z.literal('publish_version'), requestKey, reason, versionId: uuid, expectedVersionLockVersion: z.number().int(), expectedCalendarLockVersion: z.number().int() }).strict(),
]);
router.post('/work-calendars/holiday-set/command', async c => {
  const actor = await requirePermission(c, 'hr.work_calendar.manage');
  const v = zv(c, holidaySchema, body(c));
  if (!v.ok) return v.response;
  const { command, requestKey: rk, ...payload } = v.data;
  try { return c.json({ success: true, data: await holidaySetCommand(actor.id, { command, requestKey: rk, payload: payload as Record<string, unknown> }) }, 200); }
  catch (e) { return fail(c, e); }
});

// ── Work-calendar version commands ───────────────────────────────────────────
const versionSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('create_version'), requestKey, reason, calendarId: uuid.optional(),
    calendar: z.object({ name: z.string().trim().min(2).max(120) }).strict().optional(),
    effectiveFrom: date, effectiveTo: date.optional(), timezone: z.string().optional(),
    holidayCalendarVersionId: uuid, workingWeekdays: z.array(weekday).min(1).max(7), weekdayFractions: fractions.optional() }).strict(),
  z.object({ command: z.literal('copy_version'), requestKey, reason, sourceVersionId: uuid, effectiveFrom: date, effectiveTo: date.optional() }).strict(),
  z.object({ command: z.literal('set_pattern'), requestKey, reason, versionId: uuid, expectedLockVersion: z.number().int(),
    workingWeekdays: z.array(weekday).min(1).max(7), weekdayFractions: fractions.optional(), holidayCalendarVersionId: uuid.optional() }).strict(),
  z.object({ command: z.literal('publish_version'), requestKey, reason, versionId: uuid, expectedVersionLockVersion: z.number().int(), expectedCalendarLockVersion: z.number().int() }).strict(),
]);
router.post('/work-calendars/version/command', async c => {
  const actor = await requirePermission(c, 'hr.work_calendar.manage');
  const v = zv(c, versionSchema, body(c));
  if (!v.ok) return v.response;
  const { command, requestKey: rk, ...payload } = v.data;
  try { return c.json({ success: true, data: await workCalendarCommand(actor.id, { command, requestKey: rk, payload: payload as Record<string, unknown> }) }, 200); }
  catch (e) { return fail(c, e); }
});

// ── Assignment commands ──────────────────────────────────────────────────────
const assignSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('assign'), requestKey, reason, scope: z.enum(['pay_group', 'organization']),
    payGroupId: uuid.optional(), workCalendarVersionId: uuid, effectiveFrom: date, effectiveTo: date.optional() }).strict()
    .refine(v => v.scope === 'organization' ? v.payGroupId == null : v.payGroupId != null, { message: 'payGroupId is required for pay_group scope and forbidden for organization scope.', path: ['payGroupId'] }),
  z.object({ command: z.literal('end_assignment'), requestKey, reason, assignmentId: uuid, effectiveTo: date }).strict(),
  z.object({ command: z.literal('cancel_assignment'), requestKey, reason, assignmentId: uuid }).strict(),
]);
router.post('/work-calendars/assignment/command', async c => {
  const actor = await requirePermission(c, 'hr.work_calendar.manage');
  const v = zv(c, assignSchema, body(c));
  if (!v.ok) return v.response;
  const { command, requestKey: rk, ...payload } = v.data;
  try { return c.json({ success: true, data: await assignmentCommand(actor.id, { command, requestKey: rk, payload: payload as Record<string, unknown> }) }, 200); }
  catch (e) { return fail(c, e); }
});

// ── Bounded reads + resolve preview ──────────────────────────────────────────
const readSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_holiday_calendars'), cursor: z.string().optional(), limit: z.number().int().optional(), search: z.string().optional() }).strict(),
  z.object({ action: z.literal('list_work_calendars'), cursor: z.string().optional(), limit: z.number().int().optional(), search: z.string().optional() }).strict(),
  z.object({ action: z.literal('get_holiday_calendar'), id: uuid }).strict(),
  z.object({ action: z.literal('get_work_calendar'), id: uuid }).strict(),
  z.object({ action: z.literal('list_holidays'), versionId: uuid }).strict(),
  z.object({ action: z.literal('list_assignments'), payGroupId: uuid.optional() }).strict(),
  z.object({ action: z.literal('resolve'), payGroupId: uuid, periodStart: date, periodEnd: date }).strict(),
]);
router.post('/work-calendars/read', async c => {
  await requirePermission(c, 'hr.work_calendar.view');
  const v = zv(c, readSchema, body(c));
  if (!v.ok) return v.response;
  const p = v.data;
  try {
    let data: unknown;
    switch (p.action) {
      case 'list_holiday_calendars': data = await listHolidayCalendars(p); break;
      case 'list_work_calendars':    data = await listWorkCalendars(p); break;
      case 'get_holiday_calendar':   data = await getHolidayCalendar(p.id); break;
      case 'get_work_calendar':      data = await getWorkCalendar(p.id); break;
      case 'list_holidays':          data = await listHolidays(p.versionId); break;
      case 'list_assignments':       data = await listAssignments(p); break;
      case 'resolve':                data = await resolveWorkCalendar(p.payGroupId, p.periodStart, p.periodEnd); break;
    }
    return c.json({ success: true, data }, 200);
  } catch (e) { return fail(c, e); }
});

export default router;
