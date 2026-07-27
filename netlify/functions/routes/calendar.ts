/**
 * routes/calendar.ts
 *
 * Platform Calendar & Tasks. ONE shared source of dated items:
 *   • native calendar_entries (user tasks + activities, incl. recurrence masters)
 *   • module DEADLINES projected read-only by source adapters (calendarAdapters.ts)
 * All views (calendar page, Upcoming-Deadlines widget, Tasks widget) consume the
 * one CalendarItemDTO. AUTHZ is server-computed — the client never infers it.
 *
 * Routes (all POST, mounted at /api):
 *   /calendar/list           — items in a date window (native expanded + adapters), scoped
 *   /calendar/get            — one native item with detail (attendees)
 *   /calendar/task/create    — create a task (assignment gated + validated)
 *   /calendar/activity/create— create an activity (+ attendees)
 *   /calendar/update         — edit an entry (series or a single occurrence)
 *   /calendar/task/status    — complete / reopen a task (series or occurrence)
 *   /calendar/cancel         — cancel a task / activity (series or occurrence)
 *   /calendar/reminders/get  — load the signed-in user's reminder offsets
 *   /calendar/reminders/set  — atomically replace the user's reminder offsets
 *   /calendar/activity/respond — accept, tentatively accept, or decline an invite
 *   /calendar/reminders/run-sweep — service-only verification/operator sweep
 *
 * Creates go through runModuleMutation (business row + app_events + audit +
 * assignee notifications). Transitions/updates use a direct write + emitAppEvent
 * (+ audit), the house convention (see hseCapa/update).
 */

import { Hono }                     from 'hono';
import { sb }                       from '../lib/db';
import { requirePermission, userCan, loadUserOverrides, log_ } from '../lib/auth';
import { loadRolePermissions, resolveWithSet } from '../lib/permissions';
import { deliverEventNotifications, emitAppEvent } from '../lib/appEvents';
import { runModuleMutation }        from '../lib/moduleServiceAdapter';
import { z, zv }                    from '../lib/validate';
import { expandRecurrence, validateRrule, type RecurrenceMaster, type OccurrenceException } from '../lib/calendarRecurrence';
import { DEADLINE_ADAPTERS, type AdapterContext } from '../lib/calendarAdapters';
import { runCalendarReminderSweep } from '../lib/calendarReminderSweep';
import type {
  CalendarItemDTO, CalendarListResponse, CalendarVisibility, CalendarTaskStatus, CalendarTaskPriority,
  CalendarAttendeeDTO, CalendarSourceDepartment,
} from '../../../types/calendar';
import type { HonoVariables }       from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── helpers ───────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OCC_SEP = '::';

function sameInstant(left: string | null, right: string | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return !Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime === rightTime;
}

/** Load a caller's effective-permission checker once (superadmin-aware, no throw). */
async function effectiveCan(user: { id: string; role?: string | null }): Promise<(key: string) => boolean> {
  if (user.role === 'superadmin') return () => true;
  const [roleSet, overrides] = await Promise.all([
    loadRolePermissions(user.role ?? ''),
    loadUserOverrides(user.id),
  ]);
  return (key: string) => resolveWithSet(key, roleSet, overrides);
}

interface EntryRow {
  id: string; type: 'task' | 'activity'; title: string; notes: string | null;
  all_day: boolean; starts_on: string | null; ends_on: string | null;
  starts_at: string | null; ends_at: string | null;
  owner_user_id: string; assignee_user_id: string | null; visibility: string;
  department_id: string | null;
  status: string | null; priority: string | null; completed_at: string | null;
  recurrence_rule: string | null; recurrence_series_id: string | null;
  source_module: string | null; source_ref: string | null;
  updated_at: string;
}

interface Caps { canManage: boolean; canAssign: boolean; userId: string; }

function classifyDepartmentName(name: string | null): CalendarSourceDepartment {
  const value = (name ?? '').trim().toLowerCase();
  if (!value) return 'calendar';
  if (value.includes('finance')) return 'finance';
  if (value.includes('payroll')) return 'payroll';
  if (value.includes('hse') || value.includes('safety')) return 'hse';
  if (value.includes('human') || value === 'hr' || value.includes('people')) return 'human_resource';
  if (value === 'it' || value.includes('information technology') || value.includes('technology')) return 'it';
  if (value.includes('operation')) return 'operations';
  return 'department';
}

/** Compute a native entry's capability flags for this caller. */
function entryCaps(row: EntryRow, caps: Caps) {
  const isOwner    = row.owner_user_id === caps.userId;
  const isAssignee = row.assignee_user_id === caps.userId;
  const mine       = isOwner || caps.canManage;
  const isTask     = row.type === 'task';
  const openish   = row.status !== 'done' && row.status !== 'cancelled';
  return {
    editable:    mine,
    completable: isTask && openish && (isOwner || isAssignee || caps.canManage),
    assignable:  isTask && caps.canAssign && mine,
    cancelable:  row.status !== 'cancelled' && mine,
    drillThrough: !!row.source_module,
  };
}

/** Map a native entry row → DTO (names hydrated later). `occ` overlays a recurrence occurrence. */
function entryToDto(row: EntryRow, caps: Caps, occ?: {
  occurrenceDate: string; allDay: boolean; startsOn: string | null; endsOn: string | null;
  startsAt: string | null; endsAt: string | null; title?: string | null; notes?: string | null; status?: string | null;
}): CalendarItemDTO {
  const c = entryCaps(row, caps);
  const status = (occ?.status ?? row.status) as CalendarTaskStatus | null;
  return {
    id:                 occ ? `${row.id}${OCC_SEP}${occ.occurrenceDate}` : row.id,
    type:               row.type,
    origin:             'calendar',
    title:              occ?.title ?? row.title,
    notes:              occ?.notes ?? row.notes,
    allDay:             occ ? occ.allDay : row.all_day,
    startsOn:           occ ? occ.startsOn : row.starts_on,
    endsOn:             occ ? occ.endsOn : row.ends_on,
    startsAt:           occ ? occ.startsAt : row.starts_at,
    endsAt:             occ ? occ.endsAt : row.ends_at,
    status,
    priority:           (row.priority ?? null) as CalendarTaskPriority | null,
    ownerUserId:        row.owner_user_id,
    ownerName:          null,
    assigneeUserId:     row.assignee_user_id,
    assigneeName:       null,
    departmentId:       row.department_id ?? null,
    departmentName:     null,
    attendeeCount:      0,
    visibility:         row.visibility as CalendarVisibility,
    sourceModule:       row.source_module,
    sourceRef:          row.source_ref,
    sourceRoute:        null,   // native entries carry no drill-through route (v1)
    sourceLabel:        null,
    sourceDepartment:   row.department_id ? 'department' : 'calendar',
    sourceDepartmentLabel: row.department_id ? null : 'Calendar',
    recurrenceSeriesId: row.recurrence_series_id,
    recurrenceRule:     row.recurrence_rule,
    occurrenceDate:     occ?.occurrenceDate ?? null,
    ...c,
  };
}

/** Fill ownerName / assigneeName / departmentName for a batch of items. */
async function hydrateNames(items: CalendarItemDTO[]): Promise<void> {
  const ids = [...new Set(items.flatMap(i => [i.ownerUserId, i.assigneeUserId]).filter((x): x is string => !!x))];
  const departmentIds = [...new Set(items.map(i => i.departmentId).filter((x): x is string => !!x))];
  const [{ data: users, error: userError }, { data: departments, error: departmentError }] = await Promise.all([
    ids.length
      ? sb.from('app_users').select('id, full_name, username').in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    departmentIds.length
      ? sb.from('departments').select('id, name').in('id', departmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (userError) throw new Error(`calendar name hydration failed: ${userError.message}`);
  if (departmentError) throw new Error(`calendar department hydration failed: ${departmentError.message}`);
  const nameOf = new Map((users ?? []).map((u: { id: string; full_name: string | null; username: string }) => [u.id, u.full_name || u.username]));
  const departmentNameOf = new Map((departments ?? []).map((d: { id: string; name: string }) => [d.id, d.name]));
  for (const it of items) {
    if (it.ownerUserId)    it.ownerName    = nameOf.get(it.ownerUserId) ?? null;
    if (it.assigneeUserId) it.assigneeName = nameOf.get(it.assigneeUserId) ?? null;
    if (it.departmentId) {
      it.departmentName = departmentNameOf.get(it.departmentId) ?? null;
      it.sourceDepartment = classifyDepartmentName(it.departmentName);
      it.sourceDepartmentLabel = it.departmentName;
    }
  }
}

/** Split a DTO id into its master entry id + optional occurrence date. */
function parseEntryId(id: string): { entryId: string; occurrenceDate: string | null } {
  const i = id.indexOf(OCC_SEP);
  return i === -1 ? { entryId: id, occurrenceDate: null } : { entryId: id.slice(0, i), occurrenceDate: id.slice(i + OCC_SEP.length) };
}

// ── POST /calendar/list ─────────────────────────────────────────────────────

const ListSchema = z.object({
  from:           z.string().regex(DATE_RE),
  to:             z.string().regex(DATE_RE),
  types:          z.array(z.enum(['deadline', 'task', 'activity'])).optional(),
  sourceModules:  z.array(z.string()).optional(),
  ownerUserId:    z.string().optional(),
  assigneeUserId: z.string().optional(),
  statuses:       z.array(z.enum(['not_started', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'])).optional(),
  priorities:     z.array(z.enum(['low', 'medium', 'high'])).optional(),
});

router.post('/calendar/list', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, ListSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { from, to } = v.data;
  if (from > to) return c.json({ success: false, message: '`from` must be on or before `to`.' }, 400);
  // Cap the window — unbounded ranges force unbounded recurrence expansion.
  const rangeDays = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (rangeDays > 366) return c.json({ success: false, message: 'Date range too large — request at most 366 days.' }, 400);

  const can = await effectiveCan(user);
  const caps: Caps = { canManage: can('calendar.manage'), canAssign: can('calendar.task.assign'), userId: user.id };

  // Read scope: own (owner/assignee/INVITED ATTENDEE) + org, plus team for managers.
  // Never others' personal. Mirrors canReadEntry (the central policy).
  const { data: attRows, error: attendeeScopeError } = await sb.from('calendar_activity_attendees')
    .select('calendar_entry_id').eq('user_id', user.id);
  if (attendeeScopeError) {
    console.error('[calendar/list] attendee scope:', attendeeScopeError.message);
    return c.json({ success: false, message: 'Failed to load calendar.' }, 500);
  }
  const attendeeIds = [...new Set(((attRows ?? []) as Array<{ calendar_entry_id: string }>).map(a => a.calendar_entry_id))];
  const scopeOr = [
    `owner_user_id.eq.${user.id}`,
    `assignee_user_id.eq.${user.id}`,
    `visibility.eq.org`,
    ...(user.department_id ? [`and(visibility.eq.team,department_id.eq.${user.department_id})`] : []),
    ...(caps.canManage ? ['visibility.eq.team'] : []),
    ...(attendeeIds.length ? [`id.in.(${attendeeIds.join(',')})`] : []),
  ].join(',');

  const wantType = (t: 'task' | 'activity' | 'deadline') => !v.data.types || v.data.types.includes(t);
  const fromTs = `${from}T00:00:00`;
  const toTs   = `${to}T23:59:59.999`;

  const items: CalendarItemDTO[] = [];

  // 1. Non-recurring native entries that fall within the window.
  {
    const { data, error } = await sb
      .from('calendar_entries')
      .select('*')
      .or(scopeOr)
      .is('recurrence_rule', null)
      .or(`and(starts_on.gte.${from},starts_on.lte.${to}),and(starts_at.gte.${fromTs},starts_at.lte.${toTs})`);
    if (error) { console.error('[calendar/list] entries:', error.message); return c.json({ success: false, message: 'Failed to load calendar.' }, 500); }
    for (const row of (data ?? []) as EntryRow[]) {
      if (!wantType(row.type)) continue;
      items.push(entryToDto(row, caps));
    }
  }

  // 2. Recurring masters — expand each into the window, merging its exceptions.
  {
    const { data: masters, error } = await sb
      .from('calendar_entries')
      .select('*')
      .or(scopeOr)
      .not('recurrence_rule', 'is', null);
    if (error) { console.error('[calendar/list] masters:', error.message); return c.json({ success: false, message: 'Failed to load calendar.' }, 500); }

    const masterRows = (masters ?? []) as EntryRow[];
    const masterIds = masterRows.map(m => m.id);
    const exByMaster = new Map<string, OccurrenceException[]>();
    if (masterIds.length) {
      const { data: exRows, error: exceptionError } = await sb
        .from('calendar_recurrence_exceptions')
        .select('*')
        .in('calendar_entry_id', masterIds);
      if (exceptionError) {
        console.error('[calendar/list] recurrence exceptions:', exceptionError.message);
        return c.json({ success: false, message: 'Failed to load calendar.' }, 500);
      }
      for (const e of (exRows ?? []) as Array<Record<string, unknown>>) {
        const mid = e.calendar_entry_id as string;
        (exByMaster.get(mid) ?? exByMaster.set(mid, []).get(mid)!).push({
          occurrenceDate:      e.occurrence_date as string,
          exceptionType:       e.exception_type as 'cancelled' | 'modified',
          replacementTitle:    (e.replacement_title as string) ?? null,
          replacementNotes:    (e.replacement_notes as string) ?? null,
          replacementAllDay:   (e.replacement_all_day as boolean) ?? null,
          replacementStartsOn: (e.replacement_starts_on as string) ?? null,
          replacementEndsOn:   (e.replacement_ends_on as string) ?? null,
          replacementStartsAt: (e.replacement_starts_at as string) ?? null,
          replacementEndsAt:   (e.replacement_ends_at as string) ?? null,
          replacementStatus:   (e.replacement_status as string) ?? null,
        });
      }
    }

    for (const m of masterRows) {
      if (!wantType(m.type)) continue;
      const master: RecurrenceMaster = {
        id: m.id, allDay: m.all_day, startsOn: m.starts_on, endsOn: m.ends_on,
        startsAt: m.starts_at, endsAt: m.ends_at, recurrenceRule: m.recurrence_rule!, recurrenceSeriesId: m.recurrence_series_id,
      };
      for (const occ of expandRecurrence(master, from, to, exByMaster.get(m.id) ?? [])) {
        items.push(entryToDto(m, caps, {
          occurrenceDate: occ.occurrenceDate, allDay: occ.allDay,
          startsOn: occ.startsOn, endsOn: occ.endsOn, startsAt: occ.startsAt, endsAt: occ.endsAt,
          title: occ.overrideTitle ?? undefined, notes: occ.overrideNotes ?? undefined, status: occ.overrideStatus ?? undefined,
        }));
      }
    }
  }

  // 3. Attendee counts for any activities in the result.
  const activityIds = items.filter(i => i.type === 'activity' && i.origin === 'calendar').map(i => parseEntryId(i.id).entryId);
  if (activityIds.length) {
    const { data: att, error: attendeeCountError } = await sb.from('calendar_activity_attendees').select('calendar_entry_id').in('calendar_entry_id', [...new Set(activityIds)]);
    if (attendeeCountError) {
      console.error('[calendar/list] attendee counts:', attendeeCountError.message);
      return c.json({ success: false, message: 'Failed to load calendar.' }, 500);
    }
    const counts = new Map<string, number>();
    for (const a of (att ?? []) as Array<{ calendar_entry_id: string }>) counts.set(a.calendar_entry_id, (counts.get(a.calendar_entry_id) ?? 0) + 1);
    for (const it of items) if (it.type === 'activity' && it.origin === 'calendar') it.attendeeCount = counts.get(parseEntryId(it.id).entryId) ?? 0;
  }

  // 4. Module deadlines (adapters) — each self-gates on the caller's source access.
  if (wantType('deadline')) {
    const ctx: AdapterContext = { userId: user.id, can, fromKey: from, toKey: to };
    const wantModule = (m: string) => !v.data.sourceModules || v.data.sourceModules.includes(m);
    try {
      const projections = await Promise.all(
        Object.entries(DEADLINE_ADAPTERS)
          .filter(([mod]) => wantModule(mod))
          .map(([, adapter]) => adapter(ctx)),
      );
      items.push(...projections.flat());
    } catch (e) {
      console.error('[calendar/list] deadline adapter:', (e as Error).message);
      return c.json({ success: false, message: 'Failed to load calendar.' }, 500);
    }
  }

  // 5. Post-filters the DB couldn't express (status / owner / assignee across origins).
  let out = items;
  if (v.data.statuses)      out = out.filter(i => i.status && v.data.statuses!.includes(i.status));
  if (v.data.priorities)    out = out.filter(i => i.priority && v.data.priorities!.includes(i.priority));
  if (v.data.ownerUserId)   out = out.filter(i => i.ownerUserId === v.data.ownerUserId);
  if (v.data.assigneeUserId) out = out.filter(i => i.assigneeUserId === v.data.assigneeUserId);

  try {
    await hydrateNames(out);
  } catch (e) {
    console.error('[calendar/list] names:', (e as Error).message);
    return c.json({ success: false, message: 'Failed to load calendar.' }, 500);
  }
  out.sort((a, b) => (a.startsAt ?? a.startsOn ?? '').localeCompare(b.startsAt ?? b.startsOn ?? ''));

  const res: CalendarListResponse = { success: true, items: out, range: { from, to } };
  return c.json(res);
});

// ── POST /calendar/get ──────────────────────────────────────────────────────

const GetSchema = z.object({ id: z.string().min(1) });

router.post('/calendar/get', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, GetSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { entryId } = parseEntryId(v.data.id);

  const { data: row, error } = await sb.from('calendar_entries').select('*').eq('id', entryId).maybeSingle<EntryRow>();
  if (error) return c.json({ success: false, message: 'Failed to load item.' }, 500);
  if (!row) return c.json({ success: false, message: 'Item not found.' }, 404);

  const can = await effectiveCan(user);
  const caps: Caps = { canManage: can('calendar.manage'), canAssign: can('calendar.task.assign'), userId: user.id };
  // Central read policy — same scope as /calendar/list (a known UUID grants nothing extra):
  // participants + org; team only for managers; personal NEVER via calendar.manage.
  const attendee = await isAttendee(entryId, user.id);
  if (!canReadEntry(row, caps, attendee)) {
    return c.json({ success: false, message: 'Not found.' }, 404);
  }

  const dto = entryToDto(row, caps);
  const { data: att, error: attendeeError } = await sb.from('calendar_activity_attendees').select('user_id, response_status, responded_at').eq('calendar_entry_id', entryId);
  if (attendeeError) return c.json({ success: false, message: 'Failed to load item.' }, 500);
  dto.attendeeCount = (att ?? []).length;
  try {
    await hydrateNames([dto]);
  } catch (e) {
    console.error('[calendar/get] names:', (e as Error).message);
    return c.json({ success: false, message: 'Failed to load item.' }, 500);
  }
  const attendees: CalendarAttendeeDTO[] = (att ?? []).map(row => ({
    userId: row.user_id as string,
    responseStatus: row.response_status as CalendarAttendeeDTO['responseStatus'],
    respondedAt: row.responded_at as string | null,
  }));
  return c.json({ success: true, item: dto, attendees });
});

const ReminderGetSchema = z.object({ id: z.string().min(1) });
const ReminderSetSchema = z.object({
  id: z.string().min(1),
  offsetMinutes: z.array(z.number().int().min(0).max(525600)).max(5),
});

async function loadReadableEntry(user: { id: string; role?: string | null }, rawId: string): Promise<{ row: EntryRow; entryId: string } | null> {
  const { entryId } = parseEntryId(rawId);
  const { data: row, error } = await sb.from('calendar_entries').select('*').eq('id', entryId).maybeSingle<EntryRow>();
  if (error) throw new Error(`calendar entry read failed: ${error.message}`);
  if (!row) return null;
  const can = await effectiveCan(user);
  const caps: Caps = { canManage: can('calendar.manage'), canAssign: can('calendar.task.assign'), userId: user.id };
  if (!canReadEntry(row, caps, await isAttendee(entryId, user.id))) return null;
  return { row, entryId };
}

router.post('/calendar/reminders/get', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, ReminderGetSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const readable = await loadReadableEntry(user, v.data.id);
  if (!readable) return c.json({ success: false, message: 'Item not found.' }, 404);
  const { data, error } = await sb.from('calendar_reminders')
    .select('offset_minutes')
    .eq('calendar_entry_id', readable.entryId)
    .eq('user_id', user.id)
    .eq('enabled', true)
    .order('offset_minutes', { ascending: true });
  if (error) return c.json({ success: false, message: 'Failed to load reminders.' }, 500);
  return c.json({
    success: true,
    entryId: readable.entryId,
    offsetMinutes: data.map(row => row.offset_minutes as number),
  });
});

router.post('/calendar/reminders/set', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, ReminderSetSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const readable = await loadReadableEntry(user, v.data.id);
  if (!readable) return c.json({ success: false, message: 'Item not found.' }, 404);
  if (readable.row.status === 'done' || readable.row.status === 'cancelled') {
    return c.json({ success: false, message: 'Reminders cannot be set on a completed or cancelled task.' }, 400);
  }
  const offsets = [...new Set(v.data.offsetMinutes)].sort((a, b) => a - b);
  const rpcResult = await sb.rpc('calendar_replace_reminders_tx', {
    p_calendar_entry_id: readable.entryId,
    p_user_id: user.id,
    p_actor_user_id: user.id,
    p_offsets: offsets,
  }) as { data: unknown; error: { message: string } | null };
  const { data, error } = rpcResult;
  if (error) return c.json({ success: false, message: error.message }, 500);
  return c.json({ success: true, entryId: readable.entryId, offsetMinutes: offsets, result: data });
});

const AttendeeResponseSchema = z.object({
  id: z.string().min(1),
  responseStatus: z.enum(['accepted', 'declined', 'tentative']),
});

router.post('/calendar/activity/respond', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, AttendeeResponseSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { entryId } = parseEntryId(v.data.id);
  const { data: attendee, error: attendeeError } = await sb.from('calendar_activity_attendees')
    .select('user_id')
    .eq('calendar_entry_id', entryId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (attendeeError) return c.json({ success: false, message: 'Failed to load invitation.' }, 500);
  if (!attendee) return c.json({ success: false, message: 'Invitation not found.' }, 404);
  const rpcResult = await sb.rpc('calendar_attendee_respond_tx', {
    p_calendar_entry_id: entryId,
    p_user_id: user.id,
    p_response_status: v.data.responseStatus,
  }) as { data: unknown; error: { message: string } | null };
  const { data, error } = rpcResult;
  if (error) return c.json({ success: false, message: error.message }, 500);
  const result = (data ?? {}) as { changed?: boolean; eventId?: string; ownerUserId?: string; dedupeKey?: string };
  if (result.changed && result.ownerUserId && result.ownerUserId !== user.id && result.dedupeKey) {
    await deliverEventNotifications({
      eventType: 'calendar.activity.response_changed',
      sourceModule: 'calendar',
      sourceEntityType: 'activity',
      sourceEntityId: entryId,
      actorUserId: user.id,
      severity: 'info',
      payload: { responseStatus: v.data.responseStatus, attendeeUserId: user.id },
      dedupeKey: result.dedupeKey,
      explicitRecipients: [{ userId: result.ownerUserId, reason: 'owner' }],
      notification: {
        type: 'calendar.activity.response_changed',
        title: 'Calendar invitation response',
        body: `An attendee responded ${v.data.responseStatus}.`,
        actionRoute: 's-calendar',
      },
    }, result.eventId ?? null);
  }
  return c.json({ success: true });
});

router.post('/calendar/reminders/run-sweep', async c => {
  const authHeader = (c.req.raw.headers.get('authorization') ?? '').trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return c.json({ success: false, message: 'Service-role authentication required.' }, 403);
  }
  const v = zv(c, z.object({ now: z.string().optional() }), c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const now = v.data.now ? new Date(v.data.now) : new Date();
  if (Number.isNaN(now.getTime())) return c.json({ success: false, message: 'Invalid sweep time.' }, 400);
  try {
    const data = await runCalendarReminderSweep(now);
    return c.json({ success: true, data });
  } catch (error) {
    return c.json({ success: false, message: error instanceof Error ? error.message : 'Calendar reminder sweep failed.' }, 500);
  }
});

// ── create helpers ──────────────────────────────────────────────────────────

const VISIBILITY = z.enum(['personal', 'team', 'org']);

/** Validate the when-fields (all-day ⇔ date cols; timed ⇔ timestamptz cols). */
function normalizeWhen(allDay: boolean, startsOn?: string | null, endsOn?: string | null, startsAt?: string | null, endsAt?: string | null): { ok: true; row: Record<string, unknown> } | { ok: false; message: string } {
  if (allDay) {
    if (!startsOn) return { ok: false, message: 'An all-day item needs a start date.' };
    if (endsOn && endsOn < startsOn) return { ok: false, message: 'End date is before the start date.' };
    return { ok: true, row: { all_day: true, starts_on: startsOn, ends_on: endsOn ?? null, starts_at: null, ends_at: null } };
  }
  if (!startsAt) return { ok: false, message: 'A timed item needs a start time.' };
  if (endsAt && endsAt < startsAt) return { ok: false, message: 'End time is before the start time.' };
  return { ok: true, row: { all_day: false, starts_at: startsAt, ends_at: endsAt ?? null, starts_on: null, ends_on: null } };
}

/** Confirm an assignee is a real active user (server-side, never trust the client id). */
async function validAssignee(id: string): Promise<boolean> {
  const { data, error } = await sb.from('app_users').select('id, status').eq('id', id).maybeSingle<{ id: string; status: string }>();
  if (error) throw new Error(`calendar assignee validation failed: ${error.message}`);
  return !!data && data.status === 'active';
}

/** Confirm a department is real before a calendar entry can be scoped to it. */
async function validDepartment(id: string): Promise<boolean> {
  const { data, error } = await sb.from('departments').select('id').eq('id', id).maybeSingle<{ id: string }>();
  if (error) throw new Error(`calendar department validation failed: ${error.message}`);
  return !!data;
}

// ── POST /calendar/task/create ──────────────────────────────────────────────

const CreateTaskSchema = z.object({
  title:          z.string().trim().min(1).max(200),
  notes:          z.string().max(4000).optional(),
  allDay:         z.boolean().optional(),
  startsOn:       z.string().regex(DATE_RE).optional(),
  startsAt:       z.string().optional(),
  endsAt:         z.string().optional(),
  assigneeUserId: z.string().optional(),
  departmentId:   z.string().nullable().optional(),
  priority:       z.enum(['low', 'medium', 'high']).optional(),
  visibility:     VISIBILITY.optional(),
  recurrenceRule: z.string().max(400).optional(),
});

router.post('/calendar/task/create', async c => {
  const user = await requirePermission(c, 'calendar.task.manage_own');
  const v = zv(c, CreateTaskSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const d = v.data;
  const allDay = d.allDay ?? true;

  const when = normalizeWhen(allDay, d.startsOn ?? null, null, d.startsAt ?? null, d.endsAt ?? null);
  if (!when.ok) return c.json({ success: false, message: when.message }, 400);
  const visibility = d.visibility ?? 'personal';
  const departmentId = d.departmentId ?? null;
  if (departmentId) {
    if (!(await userCan(user, 'calendar.manage'))) return c.json({ success: false, message: 'You cannot create department-scoped calendar tasks.' }, 403);
    if (!(await validDepartment(departmentId))) return c.json({ success: false, message: 'The selected department is not valid.' }, 400);
  }

  // Assignment is gated + validated server-side.
  let assignee: string | null = null;
  if (d.assigneeUserId && d.assigneeUserId !== user.id) {
    if (!(await userCan(user, 'calendar.task.assign'))) return c.json({ success: false, message: 'You cannot assign tasks to other users.' }, 403);
    if (!(await validAssignee(d.assigneeUserId))) return c.json({ success: false, message: 'The selected assignee is not a valid active user.' }, 400);
    assignee = d.assigneeUserId;
  } else if (d.assigneeUserId === user.id) {
    assignee = user.id;
  }

  if (d.recurrenceRule) {
    const err = validateRrule(d.recurrenceRule);
    if (err) return c.json({ success: false, message: err }, 400);
  }
  const seriesId = d.recurrenceRule ? crypto.randomUUID() : null;

  const result = await runModuleMutation<{ id: string }>({
    context: { actorUserId: user.id },
    options: {
      module:         'calendar',
      operation:      'create',
      entityType:     'task',
      idempotencyKey: `calendar.task.create:${user.id}:${d.title}:${d.startsOn ?? d.startsAt ?? ''}:${assignee ?? ''}:${departmentId ?? ''}`,
      eventType:      'calendar.task.created',
      eventSeverity:  'info',
      eventPayload:   { title: d.title, assigneeUserId: assignee, departmentId, recurring: !!seriesId },
      getEntityIdentity: (r) => ({ id: r.id }),
      ...(assignee && assignee !== user.id ? {
        explicitRecipients: [{ userId: assignee, reason: 'assignee' as const }],
        notification: {
          title:          `Task assigned: ${d.title}`,
          body:           d.startsOn ? `Due ${d.startsOn}.` : 'A new task was assigned to you.',
          actionRoute:    's-calendar',
          type:           'calendar.task.assigned',
          actionRequired: true,
          dueAt:          d.startsAt ?? (d.startsOn ? `${d.startsOn}T00:00:00` : null),
        },
      } : {}),
    },
    writeRecord: async () => {
      const now = new Date().toISOString();
      const { data, error } = await sb.from('calendar_entries').insert({
        type: 'task', title: d.title.trim(), notes: d.notes ?? null,
        ...when.row,
        owner_user_id: user.id, assignee_user_id: assignee,
        ...(departmentId ? { department_id: departmentId } : {}),
        visibility, status: 'not_started', priority: d.priority ?? 'medium',
        recurrence_rule: d.recurrenceRule ?? null, recurrence_series_id: seriesId,
        created_by: user.id, created_at: now, updated_at: now,
      }).select('id').single<{ id: string }>();
      if (error || !data) throw new Error(error?.message ?? 'Insert failed');
      return data;
    },
  });

  await log_(user, 'calendar_task_create', 'calendar_entry', result.entityId, JSON.stringify({ title: d.title, assignee }));
  return c.json({ success: true, id: result.entityId });
});

// ── POST /calendar/activity/create ──────────────────────────────────────────

const CreateActivitySchema = z.object({
  title:           z.string().trim().min(1).max(200),
  notes:           z.string().max(4000).optional(),
  allDay:          z.boolean().optional(),
  startsOn:        z.string().regex(DATE_RE).optional(),
  endsOn:          z.string().regex(DATE_RE).optional(),
  startsAt:        z.string().optional(),
  endsAt:          z.string().optional(),
  visibility:      VISIBILITY.optional(),
  departmentId:    z.string().nullable().optional(),
  attendeeUserIds: z.array(z.string()).max(200).optional(),
  recurrenceRule:  z.string().max(400).optional(),
});

router.post('/calendar/activity/create', async c => {
  const user = await requirePermission(c, 'calendar.activity.manage_own');
  const v = zv(c, CreateActivitySchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const d = v.data;
  const allDay = d.allDay ?? true;

  const when = normalizeWhen(allDay, d.startsOn ?? null, d.endsOn ?? null, d.startsAt ?? null, d.endsAt ?? null);
  if (!when.ok) return c.json({ success: false, message: when.message }, 400);
  const visibility = d.visibility ?? 'personal';
  const departmentId = d.departmentId ?? null;
  if (departmentId) {
    if (!(await userCan(user, 'calendar.manage'))) return c.json({ success: false, message: 'You cannot create department-scoped calendar activities.' }, 403);
    if (!(await validDepartment(departmentId))) return c.json({ success: false, message: 'The selected department is not valid.' }, 400);
  }

  // Validate attendees are real active users.
  const attendees = [...new Set((d.attendeeUserIds ?? []).filter(id => id !== user.id))];
  for (const id of attendees) {
    if (!(await validAssignee(id))) return c.json({ success: false, message: 'One or more attendees are not valid active users.' }, 400);
  }

  if (d.recurrenceRule) {
    const err = validateRrule(d.recurrenceRule);
    if (err) return c.json({ success: false, message: err }, 400);
  }
  const seriesId = d.recurrenceRule ? crypto.randomUUID() : null;

  const result = await runModuleMutation<{ id: string }>({
    context: { actorUserId: user.id },
    options: {
      module:         'calendar',
      operation:      'create',
      entityType:     'activity',
      idempotencyKey: `calendar.activity.create:${user.id}:${d.title}:${d.startsOn ?? d.startsAt ?? ''}:${departmentId ?? ''}`,
      eventType:      'calendar.activity.created',
      eventSeverity:  'info',
      eventPayload:   { title: d.title, attendees: attendees.length, departmentId, recurring: !!seriesId },
      getEntityIdentity: (r) => ({ id: r.id }),
      ...(attendees.length ? {
        explicitRecipients: attendees.map(id => ({ userId: id, reason: 'assignee' as const })),
        notification: {
          title:       `You're invited: ${d.title}`,
          body:        d.startsOn ? `On ${d.startsOn}.` : (d.startsAt ? `On ${d.startsAt.slice(0, 10)}.` : 'A new activity.'),
          actionRoute: 's-calendar',
          type:        'calendar.activity.invited',
        },
      } : {}),
      afterCommit: async ({ entityId }) => {
        if (attendees.length) {
          const { error } = await sb.from('calendar_activity_attendees').insert(
            attendees.map(uid => ({ calendar_entry_id: entityId, user_id: uid, response_status: 'invited' })),
          );
          if (error) throw new Error(`calendar attendee creation failed: ${error.message}`);
        }
      },
    },
    writeRecord: async () => {
      const now = new Date().toISOString();
      const { data, error } = await sb.from('calendar_entries').insert({
        type: 'activity', title: d.title.trim(), notes: d.notes ?? null,
        ...when.row,
        owner_user_id: user.id, assignee_user_id: null,
        ...(departmentId ? { department_id: departmentId } : {}),
        visibility, status: null,
        recurrence_rule: d.recurrenceRule ?? null, recurrence_series_id: seriesId,
        created_by: user.id, created_at: now, updated_at: now,
      }).select('id').single<{ id: string }>();
      if (error || !data) throw new Error(error?.message ?? 'Insert failed');
      return data;
    },
  });

  await log_(user, 'calendar_activity_create', 'calendar_entry', result.entityId, JSON.stringify({ title: d.title, attendees: attendees.length }));
  return c.json({ success: true, id: result.entityId });
});

// ── central calendar policy ───────────────────────────────────────────────────
// ONE place that answers "may this caller read / mutate this entry". Every
// list/get/update/status/cancel path goes through these — no route derives its
// own scope rules.

/** Is the caller an invited attendee of this entry? */
async function isAttendee(entryId: string, userId: string): Promise<boolean> {
  const { data, error } = await sb.from('calendar_activity_attendees')
    .select('user_id').eq('calendar_entry_id', entryId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`calendar attendee authorization failed: ${error.message}`);
  return !!data;
}

async function attendeeUserIds(entryId: string): Promise<string[]> {
  const { data, error } = await sb.from('calendar_activity_attendees')
    .select('user_id')
    .eq('calendar_entry_id', entryId);
  if (error) throw new Error(`calendar attendees fetch failed: ${error.message}`);
  return [...new Set((data ?? []).map(row => row.user_id as string))];
}

/**
 * Read policy (mirrors /calendar/list scope):
 *   participant (owner / assignee / invited attendee) → yes
 *   org visibility → yes · team visibility → managers only
 *   personal → participants ONLY (never through calendar.manage)
 */
function canReadEntry(row: EntryRow, caps: Caps, attendee: boolean): boolean {
  const participant = row.owner_user_id === caps.userId || row.assignee_user_id === caps.userId || attendee;
  if (participant) return true;
  if (row.visibility === 'org') return true;
  if (row.visibility === 'team') return caps.canManage;
  return false; // personal
}

/**
 * Mutation authz: load the target + confirm the caller may edit it.
 *   • The per-type manage permission is REQUIRED (task → calendar.task.manage_own,
 *     activity → calendar.activity.manage_own) — an explicit deny on it cannot be
 *     bypassed by calendar.view.
 *   • Owners edit their own entries; calendar.manage reaches team/org entries but
 *     NEVER someone else's personal items.
 */
async function loadEditable(user: { id: string; role?: string | null }, entryId: string): Promise<{ ok: true; row: EntryRow; canManage: boolean } | { ok: false; status: 400 | 403 | 404; message: string }> {
  const { data: row, error } = await sb.from('calendar_entries').select('*').eq('id', entryId).maybeSingle<EntryRow>();
  if (error) return { ok: false, status: 400, message: 'Failed to load item.' };
  if (!row) return { ok: false, status: 404, message: 'Item not found.' };

  const can = await effectiveCan(user);
  const managePerm = row.type === 'task' ? 'calendar.task.manage_own' : 'calendar.activity.manage_own';
  const canManage = can('calendar.manage');
  const isOwner = row.owner_user_id === user.id;

  if (isOwner) {
    if (!can(managePerm)) {
      return { ok: false, status: 403, message: `You do not have permission to manage calendar ${row.type === 'task' ? 'tasks' : 'activities'}.` };
    }
  } else if (canManage) {
    if (row.visibility === 'personal') {
      return { ok: false, status: 403, message: 'Personal calendar items can only be changed by their owner.' };
    }
  } else {
    return { ok: false, status: 403, message: 'You can only change your own calendar items.' };
  }
  return { ok: true, row, canManage };
}

/** Upsert a recurrence exception for one occurrence (modify or cancel). */
async function writeException(row: EntryRow, occurrenceDate: string, actorId: string, ex: Partial<OccurrenceException> & { exceptionType: 'cancelled' | 'modified' }): Promise<void> {
  const { error } = await sb.from('calendar_recurrence_exceptions').upsert({
    calendar_entry_id:     row.id,
    series_id:             row.recurrence_series_id ?? row.id,
    occurrence_date:       occurrenceDate,
    exception_type:        ex.exceptionType,
    replacement_title:     ex.replacementTitle ?? null,
    replacement_notes:     ex.replacementNotes ?? null,
    replacement_all_day:   ex.replacementAllDay ?? null,
    replacement_starts_on: ex.replacementStartsOn ?? null,
    replacement_ends_on:   ex.replacementEndsOn ?? null,
    replacement_starts_at: ex.replacementStartsAt ?? null,
    replacement_ends_at:   ex.replacementEndsAt ?? null,
    replacement_status:    ex.replacementStatus ?? null,
    created_by:            actorId,
    updated_at:            new Date().toISOString(),
  }, { onConflict: 'calendar_entry_id,occurrence_date' });
  if (error) throw new Error(`calendar recurrence exception failed: ${error.message}`);
}

// ── POST /calendar/update ───────────────────────────────────────────────────

const UpdateSchema = z.object({
  id:             z.string().min(1),
  scope:          z.enum(['occurrence', 'series']).optional(),
  occurrenceDate: z.string().regex(DATE_RE).optional(),
  patch: z.object({
    title:          z.string().trim().min(1).max(200).optional(),
    notes:          z.string().max(4000).nullable().optional(),
    allDay:         z.boolean().optional(),
    startsOn:       z.string().regex(DATE_RE).nullable().optional(),
    endsOn:         z.string().regex(DATE_RE).nullable().optional(),
    startsAt:       z.string().nullable().optional(),
    endsAt:         z.string().nullable().optional(),
    assigneeUserId: z.string().nullable().optional(),
    departmentId:   z.string().nullable().optional(),
    priority:       z.enum(['low', 'medium', 'high']).optional(),
    visibility:     VISIBILITY.optional(),
  }),
});

router.post('/calendar/update', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, UpdateSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { entryId, occurrenceDate: idOcc } = parseEntryId(v.data.id);
  const occurrenceDate = v.data.occurrenceDate ?? idOcc;
  const scope = v.data.scope ?? (occurrenceDate ? 'occurrence' : 'series');

  const load = await loadEditable(user, entryId);
  if (!load.ok) return c.json({ success: false, message: load.message }, load.status);
  const { row } = load;
  const p = v.data.patch;
  const temporalChange =
    (p.allDay !== undefined && p.allDay !== row.all_day)
    || (p.startsOn !== undefined && p.startsOn !== row.starts_on)
    || (p.endsOn !== undefined && p.endsOn !== row.ends_on)
    || (p.startsAt !== undefined && !sameInstant(p.startsAt, row.starts_at))
    || (p.endsAt !== undefined && !sameInstant(p.endsAt, row.ends_at));
  const rescheduleRecipients = row.type === 'activity' && temporalChange ? await attendeeUserIds(entryId) : [];

  // Reassignment is gated + validated.
  if (p.assigneeUserId !== undefined && p.assigneeUserId && p.assigneeUserId !== row.owner_user_id) {
    if (!(await userCan(user, 'calendar.task.assign'))) return c.json({ success: false, message: 'You cannot assign tasks to other users.' }, 403);
    if (!(await validAssignee(p.assigneeUserId))) return c.json({ success: false, message: 'The selected assignee is not a valid active user.' }, 400);
  }
  if (p.departmentId !== undefined && p.departmentId) {
    if (!(await userCan(user, 'calendar.manage'))) return c.json({ success: false, message: 'You cannot assign calendar entries to a department.' }, 403);
    if (!(await validDepartment(p.departmentId))) return c.json({ success: false, message: 'The selected department is not valid.' }, 400);
  }

  // A single occurrence of a recurring series → write a 'modified' exception.
  if (scope === 'occurrence' && row.recurrence_rule && occurrenceDate) {
    const allDay = p.allDay ?? row.all_day;
    await writeException(row, occurrenceDate, user.id, {
      exceptionType:       'modified',
      replacementTitle:    p.title ?? null,
      replacementNotes:    p.notes ?? null,
      replacementAllDay:   allDay,
      replacementStartsOn: allDay ? (p.startsOn ?? occurrenceDate) : null,
      replacementEndsOn:   allDay ? (p.endsOn ?? null) : null,
      replacementStartsAt: !allDay ? (p.startsAt ?? null) : null,
      replacementEndsAt:   !allDay ? (p.endsAt ?? null) : null,
    });
  } else {
    // Whole entry / series → update the master row.
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (p.title !== undefined)          updates.title            = p.title.trim();
    if (p.notes !== undefined)          updates.notes            = p.notes;
    if (p.priority !== undefined)       updates.priority         = p.priority;
    if (p.visibility !== undefined)     updates.visibility       = p.visibility;
    if (p.assigneeUserId !== undefined) updates.assignee_user_id = p.assigneeUserId;
    if (p.departmentId !== undefined)   updates.department_id    = p.departmentId;
    if (p.allDay !== undefined || p.startsOn !== undefined || p.startsAt !== undefined || p.endsOn !== undefined || p.endsAt !== undefined) {
      const allDay = p.allDay ?? row.all_day;
      const when = normalizeWhen(allDay,
        p.startsOn !== undefined ? p.startsOn : row.starts_on,
        p.endsOn !== undefined ? p.endsOn : row.ends_on,
        p.startsAt !== undefined ? p.startsAt : row.starts_at,
        p.endsAt !== undefined ? p.endsAt : row.ends_at);
      if (!when.ok) return c.json({ success: false, message: when.message }, 400);
      Object.assign(updates, when.row);
    }
    const { error } = await sb.from('calendar_entries').update(updates).eq('id', entryId);
    if (error) return c.json({ success: false, message: error.message }, 500);
  }

  const updatedEvent = await emitAppEvent({
    eventType: 'calendar.entry.updated', sourceModule: 'calendar',
    sourceEntityType: row.type, sourceEntityId: entryId, actorUserId: user.id,
    severity: 'info', payload: { scope, occurrenceDate },
  });
  if (!updatedEvent.ok) return c.json({ success: false, message: 'The item changed, but its update event could not be recorded.' }, 500);
  if (rescheduleRecipients.length) {
    const scheduleIdentity = [
      p.startsOn ?? row.starts_on ?? '',
      p.endsOn ?? row.ends_on ?? '',
      p.startsAt ?? row.starts_at ?? '',
      p.endsAt ?? row.ends_at ?? '',
    ].join('|');
    const rescheduledEvent = await emitAppEvent({
      eventType: 'calendar.activity.rescheduled',
      sourceModule: 'calendar',
      sourceEntityType: 'activity',
      sourceEntityId: entryId,
      actorUserId: user.id,
      severity: 'info',
      payload: { title: p.title ?? row.title, scope, occurrenceDate },
      dedupeKey: `calendar.activity.rescheduled:${entryId}:${occurrenceDate ?? 'series'}:${row.updated_at}:${scheduleIdentity}`,
      explicitRecipients: rescheduleRecipients.map(userId => ({ userId, reason: 'assignee' as const })),
      notification: {
        type: 'calendar.activity.rescheduled',
        title: `Activity rescheduled: ${p.title ?? row.title}`,
        body: 'The date or time changed. Open Calendar to review the updated schedule.',
        actionRoute: 's-calendar',
      },
    });
    if (!rescheduledEvent.ok) return c.json({ success: false, message: 'The activity changed, but attendee notifications could not be recorded.' }, 500);
  }
  await log_(user, 'calendar_update', 'calendar_entry', entryId, JSON.stringify({ scope, occurrenceDate }));
  return c.json({ success: true });
});

// ── POST /calendar/task/status ──────────────────────────────────────────────

const StatusSchema = z.object({
  id:             z.string().min(1),
  status:         z.enum(['not_started', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled']),
  scope:          z.enum(['occurrence', 'series']).optional(),
  occurrenceDate: z.string().regex(DATE_RE).optional(),
});

router.post('/calendar/task/status', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, StatusSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { entryId, occurrenceDate: idOcc } = parseEntryId(v.data.id);
  const occurrenceDate = v.data.occurrenceDate ?? idOcc;

  const { data: row, error } = await sb.from('calendar_entries').select('*').eq('id', entryId).maybeSingle<EntryRow>();
  if (error) return c.json({ success: false, message: 'Failed to load task.' }, 500);
  if (!row) return c.json({ success: false, message: 'Task not found.' }, 404);
  if (row.type !== 'task') return c.json({ success: false, message: 'Only tasks have a completion status.' }, 400);

  // Owner, assignee, or a manager may complete/reopen — but calendar.manage
  // never reaches someone else's PERSONAL task (central policy).
  const canManage = await userCan(user, 'calendar.manage');
  const isParticipant = row.owner_user_id === user.id || row.assignee_user_id === user.id;
  const mayComplete = isParticipant || (canManage && row.visibility !== 'personal');
  if (!mayComplete) return c.json({ success: false, message: 'You cannot change this task.' }, 403);

  const now = new Date().toISOString();
  if (occurrenceDate && row.recurrence_rule) {
    await writeException(row, occurrenceDate, user.id, { exceptionType: 'modified', replacementStatus: v.data.status });
  } else {
    const { error: uErr } = await sb.from('calendar_entries').update({
      status: v.data.status,
      completed_at: v.data.status === 'done' ? now : null,
      completed_by: v.data.status === 'done' ? user.id : null,
      updated_at: now,
    }).eq('id', entryId);
    if (uErr) return c.json({ success: false, message: uErr.message }, 500);
  }

  await emitAppEvent({
    eventType: v.data.status === 'done' ? 'calendar.task.completed' : 'calendar.task.status_changed',
    sourceModule: 'calendar', sourceEntityType: 'task', sourceEntityId: entryId, actorUserId: user.id,
    severity: 'info', payload: { status: v.data.status, occurrenceDate },
  });
  await log_(user, 'calendar_task_status', 'calendar_entry', entryId, JSON.stringify({ status: v.data.status, occurrenceDate }));
  return c.json({ success: true });
});

// ── POST /calendar/cancel ───────────────────────────────────────────────────

const CancelSchema = z.object({
  id:             z.string().min(1),
  scope:          z.enum(['occurrence', 'series']).optional(),
  occurrenceDate: z.string().regex(DATE_RE).optional(),
});

router.post('/calendar/cancel', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, CancelSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { entryId, occurrenceDate: idOcc } = parseEntryId(v.data.id);
  const occurrenceDate = v.data.occurrenceDate ?? idOcc;
  const scope = v.data.scope ?? (occurrenceDate ? 'occurrence' : 'series');

  const load = await loadEditable(user, entryId);
  if (!load.ok) return c.json({ success: false, message: load.message }, load.status);
  const { row } = load;
  const cancellationRecipients = row.type === 'activity' ? await attendeeUserIds(entryId) : [];
  const now = new Date().toISOString();

  if (occurrenceDate && row.recurrence_rule) {
    // Cancel just this occurrence.
    await writeException(row, occurrenceDate, user.id, { exceptionType: 'cancelled' });
  } else if (row.type === 'task') {
    // Cancel the whole task → status cancelled (keeps the row + audit trail).
    const { error } = await sb.from('calendar_entries').update({ status: 'cancelled', updated_at: now }).eq('id', entryId);
    if (error) return c.json({ success: false, message: error.message }, 500);
  } else {
    // Cancel an activity → remove it (and its attendees via FK cascade).
    const { error } = await sb.from('calendar_entries').delete().eq('id', entryId);
    if (error) return c.json({ success: false, message: error.message }, 500);
  }

  const cancelledEvent = await emitAppEvent({
    eventType: 'calendar.entry.cancelled', sourceModule: 'calendar',
    sourceEntityType: row.type, sourceEntityId: entryId, actorUserId: user.id,
    severity: 'info', payload: { occurrenceDate },
  });
  if (!cancelledEvent.ok) return c.json({ success: false, message: 'The item was cancelled, but its cancellation event could not be recorded.' }, 500);
  if (cancellationRecipients.length) {
    const participantEvent = await emitAppEvent({
      eventType: 'calendar.activity.cancelled',
      sourceModule: 'calendar',
      sourceEntityType: 'activity',
      sourceEntityId: entryId,
      actorUserId: user.id,
      severity: 'warning',
      payload: { title: row.title, scope, occurrenceDate },
      dedupeKey: `calendar.activity.cancelled:${entryId}:${occurrenceDate ?? 'series'}`,
      explicitRecipients: cancellationRecipients.map(userId => ({ userId, reason: 'assignee' as const })),
      notification: {
        type: 'calendar.activity.cancelled',
        title: `Activity cancelled: ${row.title}`,
        body: occurrenceDate ? `The ${occurrenceDate} occurrence was cancelled.` : 'This activity was cancelled.',
        actionRoute: 's-calendar',
      },
    });
    if (!participantEvent.ok) return c.json({ success: false, message: 'The activity was cancelled, but attendee notifications could not be recorded.' }, 500);
  }
  await log_(user, 'calendar_cancel', 'calendar_entry', entryId, JSON.stringify({ occurrenceDate, type: row.type }));
  return c.json({ success: true });
});

export default router;
