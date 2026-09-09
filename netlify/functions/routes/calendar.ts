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
 *   /calendar/day-context    — published TT public-holiday metadata for day headers
 *   /calendar/calendars/*    — list and manage real calendar collections
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
import { CALENDAR_COLOR_KEYS, CALENDAR_LUCIDE_TITLE_ICONS, CALENDAR_TITLE_ICON_TYPES } from '../../../types/calendar';
import type {
  CalendarItemDTO, CalendarListResponse, CalendarVisibility, CalendarTaskStatus, CalendarTaskPriority,
  CalendarAttendeeDTO, CalendarSourceDepartment, CalendarColorKey,
  CalendarDayContextResponse, CalendarHolidayMarkerDTO, CalendarCollectionDTO, CalendarCollectionsResponse,
  CalendarEntryKind, CalendarAvailability, CalendarCategoryDTO, CalendarCategoriesResponse, CalendarTitleIconType,
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
  entry_kind: CalendarEntryKind; category_id: string | null; availability: CalendarAvailability | null;
  title_icon_type: string | null; title_icon_value: string | null;
  color_key: string | null; custom_color: string | null; location_label: string | null;
  calendar_collection_id: string | null;
  all_day: boolean; starts_on: string | null; ends_on: string | null;
  starts_at: string | null; ends_at: string | null; deadline_at: string | null;
  owner_user_id: string; assignee_user_id: string | null; visibility: string;
  department_id: string | null;
  status: string | null; priority: string | null; completed_at: string | null;
  recurrence_rule: string | null; recurrence_series_id: string | null;
  source_module: string | null; source_ref: string | null;
  updated_at: string;
}

interface Caps { canManage: boolean; canAssign: boolean; userId: string; departmentId: string | null; }

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
  // Linked rows are projections owned by their source workflow. Mutating or
  // cancelling them through Calendar would desynchronise the business record
  // (for example, deleting a meeting's schedule without cancelling the meeting).
  const sourceControlled = Boolean(row.source_module);
  return {
    editable:    !sourceControlled && mine,
    completable: !sourceControlled && isTask && openish && (isOwner || isAssignee || caps.canManage),
    assignable:  !sourceControlled && isTask && caps.canAssign && mine,
    cancelable:  !sourceControlled && row.status !== 'cancelled' && mine,
    drillThrough: sourceControlled && row.source_module !== 'external_calendar',
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
    kind:               row.entry_kind,
    origin:             'calendar',
    title:              occ?.title ?? row.title,
    titleIconType:      (row.title_icon_type ?? null) as CalendarTitleIconType | null,
    titleIconValue:     row.title_icon_value ?? null,
    notes:              occ?.notes ?? row.notes,
    colorKey:           (row.color_key ?? null) as CalendarColorKey | null,
    customColor:        row.custom_color ?? null,
    locationLabel:      row.location_label ?? null,
    categoryId:         row.category_id ?? null,
    categoryKey:        null,
    categoryName:       null,
    categoryIcon:       null,
    availability:       row.availability ?? null,
    calendarId:         row.calendar_collection_id ?? null,
    calendarName:       null,
    allDay:             occ ? occ.allDay : row.all_day,
    startsOn:           occ ? occ.startsOn : row.starts_on,
    endsOn:             occ ? occ.endsOn : row.ends_on,
    startsAt:           occ ? occ.startsAt : row.starts_at,
    endsAt:             occ ? occ.endsAt : row.ends_at,
    deadlineAt:         row.deadline_at ?? null,
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
    sourceRoute:        row.source_module === 'meetings' ? 's-meetings' : null,
    sourceLabel:        row.source_module === 'meetings' ? 'Meeting' : null,
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
  const collectionIds = [...new Set(items.map(i => i.calendarId).filter((x): x is string => !!x))];
  const categoryIds = [...new Set(items.map(i => i.categoryId).filter((x): x is string => !!x))];
  const [{ data: users, error: userError }, { data: departments, error: departmentError }, { data: collections, error: collectionError }, { data: categories, error: categoryError }] = await Promise.all([
    ids.length
      ? sb.from('app_users').select('id, full_name, username').in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    departmentIds.length
      ? sb.from('departments').select('id, name').in('id', departmentIds)
      : Promise.resolve({ data: [], error: null }),
    collectionIds.length
      ? sb.from('calendar_collections').select('id, name').in('id', collectionIds)
      : Promise.resolve({ data: [], error: null }),
    categoryIds.length
      ? sb.from('calendar_categories').select('id, category_key, name, icon_name').in('id', categoryIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (userError) throw new Error(`calendar name hydration failed: ${userError.message}`);
  if (departmentError) throw new Error(`calendar department hydration failed: ${departmentError.message}`);
  if (collectionError) throw new Error(`calendar collection hydration failed: ${collectionError.message}`);
  if (categoryError) throw new Error(`calendar category hydration failed: ${categoryError.message}`);
  const nameOf = new Map(users.map((u: { id: string; full_name: string | null; username: string }) => [u.id, u.full_name ?? u.username]));
  const departmentNameOf = new Map(departments.map((d: { id: string; name: string }) => [d.id, d.name]));
  const collectionNameOf = new Map(collections.map((collection: { id: string; name: string }) => [collection.id, collection.name]));
  const categoryOf = new Map(categories.map((category: { id: string; category_key: string; name: string; icon_name: string }) => [category.id, category]));
  for (const it of items) {
    if (it.ownerUserId)    it.ownerName    = nameOf.get(it.ownerUserId) ?? null;
    if (it.assigneeUserId) it.assigneeName = nameOf.get(it.assigneeUserId) ?? null;
    if (it.departmentId) {
      it.departmentName = departmentNameOf.get(it.departmentId) ?? null;
      it.sourceDepartment = classifyDepartmentName(it.departmentName);
      it.sourceDepartmentLabel = it.departmentName;
    }
    if (it.calendarId) it.calendarName = collectionNameOf.get(it.calendarId) ?? null;
    const category = it.categoryId ? categoryOf.get(it.categoryId) : null;
    it.categoryKey = category?.category_key ?? null;
    it.categoryName = category?.name ?? null;
    it.categoryIcon = category?.icon_name ?? null;
  }
}

/** Split a DTO id into its master entry id + optional occurrence date. */
function parseEntryId(id: string): { entryId: string; occurrenceDate: string | null } {
  const i = id.indexOf(OCC_SEP);
  return i === -1 ? { entryId: id, occurrenceDate: null } : { entryId: id.slice(0, i), occurrenceDate: id.slice(i + OCC_SEP.length) };
}

interface CalendarCollectionRow {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string;
  visibility: CalendarVisibility;
  department_id: string | null;
  color_key: CalendarColorKey | null;
  custom_color: string | null;
  is_default: boolean;
  status: 'active' | 'archived';
}

const COLLECTION_COLOR = z.enum(CALENDAR_COLOR_KEYS);
const COLLECTION_VISIBILITY = z.enum(['personal', 'team', 'org']);
const IDEMPOTENCY_KEY = z.string().trim().min(8).max(160);
const TITLE_ICON_TYPE = z.enum(CALENDAR_TITLE_ICON_TYPES).nullable();
const TITLE_ICON_VALUE = z.string().trim().min(1).max(64).nullable();
const CALENDAR_LUCIDE_TITLE_ICON_SET = new Set<string>(CALENDAR_LUCIDE_TITLE_ICONS);

function validateTitleIcon(type: string | null | undefined, value: string | null | undefined): string | null {
  const hasType = Boolean(type);
  const hasValue = Boolean(value?.trim());
  if (hasType !== hasValue) return 'Choose both an icon style and an icon, or clear both fields.';
  if (!hasType || !hasValue) return null;
  if (type === 'lucide' && !CALENDAR_LUCIDE_TITLE_ICON_SET.has(value!.trim())) return 'Choose a supported calendar icon.';
  if (type === 'emoji' && Array.from(value!.trim()).length > 8) return 'Choose a single emoji for the calendar title.';
  return null;
}

async function loadCalendarCollectionForEntry(
  user: { id: string; role?: string | null },
  id: string,
): Promise<{ ok: true; row: CalendarCollectionRow } | { ok: false; status: 400 | 403 | 404; message: string }> {
  const { data, error } = await sb.from('calendar_collections').select('*').eq('id', id).eq('status', 'active').maybeSingle<CalendarCollectionRow>();
  if (error) return { ok: false, status: 400, message: 'The selected calendar could not be validated.' };
  if (!data) return { ok: false, status: 404, message: 'The selected calendar was not found.' };
  const { data: external, error: externalError } = await sb.from('calendar_external_calendars')
    .select('id').eq('calendar_collection_id', id).maybeSingle<{ id: string }>();
  if (externalError) return { ok: false, status: 400, message: 'The selected calendar source could not be validated.' };
  if (external) return { ok: false, status: 403, message: 'Imported calendars are read-only in SIOMAC.' };
  const can = await effectiveCan(user);
  const canContribute = data.owner_user_id === user.id || (can('calendar.manage') && data.visibility !== 'personal');
  if (!canContribute) return { ok: false, status: 403, message: 'You cannot add items to the selected calendar.' };
  return { ok: true, row: data };
}

const CollectionWriteSchema = z.object({
  idempotencyKey: IDEMPOTENCY_KEY,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).nullable().optional(),
  visibility: COLLECTION_VISIBILITY,
  departmentId: z.string().nullable().optional(),
  colorKey: COLLECTION_COLOR.nullable().optional(),
  customColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  makeDefault: z.boolean().optional(),
}).strict();

router.post('/calendar/calendars/list', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const can = await effectiveCan(user);
  const scopeOr = [
    `owner_user_id.eq.${user.id}`,
    'visibility.eq.org',
    ...(user.department_id ? [`and(visibility.eq.team,department_id.eq.${user.department_id})`] : []),
    ...(can('calendar.manage') ? ['visibility.eq.team'] : []),
  ].join(',');
  const { data, error } = await sb.from('calendar_collections')
    .select('*').eq('status', 'active').or(scopeOr)
    .order('is_default', { ascending: false }).order('name', { ascending: true });
  if (error) {
    console.error('[calendar/calendars/list]', error.message);
    return c.json({ success: false, message: 'Failed to load calendars.' }, 500);
  }
  const rows = data as CalendarCollectionRow[];
  const ownerIds = [...new Set(rows.map(row => row.owner_user_id))];
  const departmentIds = [...new Set(rows.map(row => row.department_id).filter((id): id is string => !!id))];
  const [{ data: owners, error: ownerError }, { data: departments, error: departmentError }] = await Promise.all([
    ownerIds.length ? sb.from('app_users').select('id,full_name,username').in('id', ownerIds) : Promise.resolve({ data: [], error: null }),
    departmentIds.length ? sb.from('departments').select('id,name').in('id', departmentIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (ownerError || departmentError) {
    console.error('[calendar/calendars/list] hydration', ownerError?.message ?? departmentError?.message);
    return c.json({ success: false, message: 'Failed to load calendars.' }, 500);
  }
  const ownerNames = new Map((owners as { id: string; full_name: string | null; username: string }[]).map(owner => [owner.id, owner.full_name ?? owner.username]));
  const departmentNames = new Map((departments as { id: string; name: string }[]).map(department => [department.id, department.name]));
  const collectionIds = rows.map(row => row.id);
  const { data: externalCalendars, error: externalCalendarError } = collectionIds.length
    ? await sb.from('calendar_external_calendars').select('calendar_collection_id,connection_id,name').in('calendar_collection_id', collectionIds)
    : { data: [], error: null };
  if (externalCalendarError) return c.json({ success: false, message: 'Failed to load calendar sources.' }, 500);
  const externalCalendarRows = externalCalendars as { calendar_collection_id: string; connection_id: string; name: string }[];
  const connectionIds = [...new Set(externalCalendarRows.map(row => row.connection_id))];
  const { data: externalConnections, error: externalConnectionError } = connectionIds.length
    ? await sb.from('calendar_connections').select('id,provider').in('id', connectionIds)
    : { data: [], error: null };
  if (externalConnectionError) return c.json({ success: false, message: 'Failed to load calendar sources.' }, 500);
  const externalConnectionRows = externalConnections as { id: string; provider: import('../../../types/calendar').CalendarProvider }[];
  const providerByConnection = new Map(externalConnectionRows.map(row => [row.id, row.provider]));
  const providerByCollection = new Map(externalCalendarRows.map(row => [row.calendar_collection_id, providerByConnection.get(row.connection_id) ?? null]));
  const externalNameByCollection = new Map(externalCalendarRows.map(row => [row.calendar_collection_id, row.name]));
  const ownedActiveCount = rows.filter(row => row.owner_user_id === user.id).length;
  const calendars: CalendarCollectionDTO[] = rows.map(row => {
    const provider = providerByCollection.get(row.id) ?? null;
    return ({
    id: row.id,
    name: externalNameByCollection.get(row.id) ?? row.name,
    description: row.description,
    ownerUserId: row.owner_user_id,
    ownerName: ownerNames.get(row.owner_user_id) ?? null,
    visibility: row.visibility,
    departmentId: row.department_id,
    departmentName: row.department_id ? departmentNames.get(row.department_id) ?? null : null,
    colorKey: row.color_key,
    customColor: row.custom_color,
    isDefault: row.is_default,
    status: row.status,
    canEdit: row.owner_user_id === user.id && provider === null,
    canArchive: row.owner_user_id === user.id && provider === null && ownedActiveCount > 1,
    provider,
    readOnly: provider !== null,
  }); });
  const response: CalendarCollectionsResponse = { success: true, calendars };
  return c.json(response);
});

router.post('/calendar/categories/list', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const can = await effectiveCan(user);
  const { data, error } = await sb.from('calendar_categories')
    .select('id,category_key,name,icon_name,scope,sort_order,is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.error('[calendar/categories/list]', error.message);
    return c.json({ success: false, message: 'Failed to load calendar categories.' }, 500);
  }
  const categories: CalendarCategoryDTO[] = data.map(row => ({
    id: row.id as string,
    key: row.category_key as string,
    name: row.name as string,
    iconName: row.icon_name as string,
    scope: row.scope as CalendarCategoryDTO['scope'],
    sortOrder: row.sort_order as number,
    active: row.is_active as boolean,
    canManage: can('calendar.manage'),
  }));
  const response: CalendarCategoriesResponse = { success: true, categories };
  return c.json(response);
});

router.post('/calendar/calendars/create', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, CollectionWriteSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const d = v.data;
  const can = await effectiveCan(user);
  if (!can('calendar.activity.manage_own') && !can('calendar.task.manage_own')) {
    return c.json({ success: false, message: 'You do not have permission to create calendars.' }, 403);
  }
  if (d.visibility === 'org' && !can('calendar.manage')) {
    return c.json({ success: false, message: 'Only calendar managers can create organisation calendars.' }, 403);
  }
  const departmentId = d.visibility === 'team' ? d.departmentId ?? user.department_id ?? null : null;
  if (d.visibility === 'team' && !departmentId) return c.json({ success: false, message: 'Choose a department for a department calendar.' }, 400);
  if (departmentId && departmentId !== user.department_id && !can('calendar.manage')) {
    return c.json({ success: false, message: 'You cannot create a calendar for another department.' }, 403);
  }
  if (departmentId && !(await validDepartment(departmentId))) return c.json({ success: false, message: 'The selected department is not valid.' }, 400);
  const createResult = await sb.rpc('calendar_collection_create_tx', {
    p_actor_id: user.id,
    p_name: d.name,
    p_description: d.description ?? null,
    p_visibility: d.visibility,
    p_department_id: departmentId,
    p_color_key: d.customColor ? null : d.colorKey ?? 'blue',
    p_custom_color: d.customColor ?? null,
    p_make_default: d.makeDefault ?? false,
    p_idempotency_key: d.idempotencyKey,
  });
  if (createResult.error) {
    console.error('[calendar/calendars/create]', createResult.error.message);
    const duplicate = createResult.error.code === '23505';
    return c.json({ success: false, message: duplicate ? 'You already have an active calendar with that name.' : 'The calendar could not be created.' }, duplicate ? 409 : 500);
  }
  const result = createResult.data as { collectionId: string; isDefault: boolean };
  return c.json({ success: true, id: result.collectionId, isDefault: result.isDefault });
});

router.post('/calendar/calendars/update', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, CollectionWriteSchema.extend({ id: z.uuid() }), c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const d = v.data;
  const { data: externalCollection } = await sb.from('calendar_external_calendars').select('id').eq('calendar_collection_id', d.id).maybeSingle();
  if (externalCollection) return c.json({ success: false, message: 'Imported calendars are managed from Manage Calendars.' }, 409);
  const { data: owned, error: ownedError } = await sb.from('calendar_collections').select('id').eq('id', d.id).eq('owner_user_id', user.id).eq('status', 'active').maybeSingle();
  if (ownedError) return c.json({ success: false, message: 'The calendar could not be loaded.' }, 500);
  if (!owned) return c.json({ success: false, message: 'Only the calendar owner can change its settings.' }, 403);
  const can = await effectiveCan(user);
  if (d.visibility === 'org' && !can('calendar.manage')) return c.json({ success: false, message: 'Only calendar managers can publish organisation calendars.' }, 403);
  const departmentId = d.visibility === 'team' ? d.departmentId ?? user.department_id ?? null : null;
  if (d.visibility === 'team' && !departmentId) return c.json({ success: false, message: 'Choose a department for a department calendar.' }, 400);
  if (departmentId && departmentId !== user.department_id && !can('calendar.manage')) return c.json({ success: false, message: 'You cannot move this calendar to another department.' }, 403);
  if (departmentId && !(await validDepartment(departmentId))) return c.json({ success: false, message: 'The selected department is not valid.' }, 400);
  const updateResult = await sb.rpc('calendar_collection_update_tx', {
    p_actor_id: user.id,
    p_collection_id: d.id,
    p_name: d.name,
    p_description: d.description ?? null,
    p_visibility: d.visibility,
    p_department_id: departmentId,
    p_color_key: d.customColor ? null : d.colorKey ?? 'blue',
    p_custom_color: d.customColor ?? null,
    p_make_default: d.makeDefault ?? false,
    p_idempotency_key: d.idempotencyKey,
  });
  if (updateResult.error) {
    console.error('[calendar/calendars/update]', updateResult.error.message);
    const duplicate = updateResult.error.code === '23505';
    return c.json({ success: false, message: duplicate ? 'You already have an active calendar with that name.' : 'The calendar could not be updated.' }, duplicate ? 409 : 500);
  }
  const result = updateResult.data as { collectionId: string; isDefault: boolean };
  return c.json({ success: true, id: result.collectionId, isDefault: result.isDefault });
});

const ArchiveCollectionSchema = z.object({ id: z.uuid(), idempotencyKey: IDEMPOTENCY_KEY }).strict();
router.post('/calendar/calendars/archive', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, ArchiveCollectionSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { data: externalCollection } = await sb.from('calendar_external_calendars').select('id').eq('calendar_collection_id', v.data.id).maybeSingle();
  if (externalCollection) return c.json({ success: false, message: 'Disable imported calendars from Manage Calendars.' }, 409);
  const archiveResult = await sb.rpc('calendar_collection_archive_tx', {
    p_actor_id: user.id,
    p_collection_id: v.data.id,
    p_idempotency_key: v.data.idempotencyKey,
  });
  if (archiveResult.error) {
    console.error('[calendar/calendars/archive]', archiveResult.error.message);
    const onlyCalendar = archiveResult.error.code === '22023' && archiveResult.error.message.includes('at least one active calendar');
    const notFound = archiveResult.error.code === 'P0002';
    return c.json({ success: false, message: onlyCalendar ? 'Create another calendar before archiving your only active calendar.' : notFound ? 'The calendar was not found or is not yours.' : 'The calendar could not be archived.' }, onlyCalendar ? 409 : notFound ? 404 : 500);
  }
  const result = archiveResult.data as { collectionId: string; defaultCollectionId: string | null };
  return c.json({ success: true, id: result.collectionId, defaultCollectionId: result.defaultCollectionId });
});

// ── POST /calendar/list ─────────────────────────────────────────────────────

const ListSchema = z.object({
  from:           z.string().regex(DATE_RE),
  to:             z.string().regex(DATE_RE),
  types:          z.array(z.enum(['deadline', 'task', 'activity'])).optional(),
  kinds:          z.array(z.enum(['event', 'meeting', 'task', 'deadline', 'reminder'])).optional(),
  categoryIds:    z.array(z.uuid()).optional(),
  sourceModules:  z.array(z.string()).optional(),
  ownerUserId:    z.string().optional(),
  assigneeUserId: z.string().optional(),
  statuses:       z.array(z.enum(['not_started', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'])).optional(),
  priorities:     z.array(z.enum(['low', 'medium', 'high'])).optional(),
  onboardingScope: z.enum(['my', 'team', 'all']).optional(),
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
  const caps: Caps = { canManage: can('calendar.manage'), canAssign: can('calendar.task.assign'), userId: user.id, departmentId: user.department_id ?? null };
  const { data: archivedCollections, error: archivedCollectionError } = await sb.from('calendar_collections').select('id').eq('status', 'archived');
  if (archivedCollectionError) {
    console.error('[calendar/list] archived collections:', archivedCollectionError.message);
    return c.json({ success: false, message: 'Failed to load calendar.' }, 500);
  }
  const archivedCollectionIds = new Set(archivedCollections.map(collection => collection.id as string));

  // Read scope: own (owner/assignee/INVITED ATTENDEE) + org, plus team for managers.
  // Never others' personal. Mirrors canReadEntry (the central policy).
  const { data: attRows, error: attendeeScopeError } = await sb.from('calendar_activity_attendees')
    .select('calendar_entry_id').eq('user_id', user.id);
  if (attendeeScopeError) {
    console.error('[calendar/list] attendee scope:', attendeeScopeError.message);
    return c.json({ success: false, message: 'Failed to load calendar.' }, 500);
  }
  const attendeeIds = [...new Set((attRows as { calendar_entry_id: string }[]).map(a => a.calendar_entry_id))];
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
      .or(`and(all_day.eq.true,starts_on.lte.${to},or(ends_on.gte.${from},and(ends_on.is.null,starts_on.gte.${from}))),and(all_day.eq.false,starts_at.lte.${toTs},or(ends_at.gt.${fromTs},and(ends_at.is.null,starts_at.gte.${fromTs})))`);
    if (error) { console.error('[calendar/list] entries:', error.message); return c.json({ success: false, message: 'Failed to load calendar.' }, 500); }
    for (const row of data as EntryRow[]) {
      if (row.calendar_collection_id && archivedCollectionIds.has(row.calendar_collection_id)) continue;
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

    const masterRows = masters as EntryRow[];
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
      for (const e of exRows as Record<string, unknown>[]) {
        const mid = e.calendar_entry_id as string;
        (exByMaster.get(mid) ?? exByMaster.set(mid, []).get(mid)!).push({
          occurrenceDate:      e.occurrence_date as string,
          exceptionType:       e.exception_type as 'cancelled' | 'modified',
          replacementTitle:    (e.replacement_title as string | undefined) ?? null,
          replacementNotes:    (e.replacement_notes as string | undefined) ?? null,
          replacementAllDay:   (e.replacement_all_day as boolean | undefined) ?? null,
          replacementStartsOn: (e.replacement_starts_on as string | undefined) ?? null,
          replacementEndsOn:   (e.replacement_ends_on as string | undefined) ?? null,
          replacementStartsAt: (e.replacement_starts_at as string | undefined) ?? null,
          replacementEndsAt:   (e.replacement_ends_at as string | undefined) ?? null,
          replacementStatus:   (e.replacement_status as string | undefined) ?? null,
        });
      }
    }

    for (const m of masterRows) {
      if (m.calendar_collection_id && archivedCollectionIds.has(m.calendar_collection_id)) continue;
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
    for (const a of att as { calendar_entry_id: string }[]) counts.set(a.calendar_entry_id, (counts.get(a.calendar_entry_id) ?? 0) + 1);
    for (const it of items) if (it.type === 'activity' && it.origin === 'calendar') it.attendeeCount = counts.get(parseEntryId(it.id).entryId) ?? 0;
  }

  // 4. Module deadlines (adapters) — each self-gates on the caller's source access.
  if (wantType('deadline')) {
    const ctx: AdapterContext = {
      userId: user.id,
      can,
      fromKey: from,
      toKey: to,
      ...(v.data.onboardingScope ? { onboardingScope: v.data.onboardingScope } : {}),
    };
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
      if ((e as { status?: number }).status === 403) {
        return c.json({ success: false, message: (e as Error).message }, 403);
      }
      return c.json({ success: false, message: 'Failed to load calendar.' }, 500);
    }
  }

  // 5. Post-filters the DB couldn't express (status / owner / assignee across origins).
  let out = items;
  if (v.data.statuses)      out = out.filter(i => i.status && v.data.statuses!.includes(i.status));
  if (v.data.priorities)    out = out.filter(i => i.priority && v.data.priorities!.includes(i.priority));
  if (v.data.ownerUserId)   out = out.filter(i => i.ownerUserId === v.data.ownerUserId);
  if (v.data.assigneeUserId) out = out.filter(i => i.assigneeUserId === v.data.assigneeUserId);
  if (v.data.kinds)          out = out.filter(i => v.data.kinds!.includes(i.kind));
  if (v.data.categoryIds)    out = out.filter(i => Boolean(i.categoryId && v.data.categoryIds!.includes(i.categoryId)));

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

// ── POST /calendar/day-context ─────────────────────────────────────────────

const DayContextSchema = z.object({
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
  jurisdiction: z.literal('TT'),
}).strict();

interface HolidayCalendarRow { id: string; name: string }
interface HolidayVersionRow { id: string; holiday_calendar_id: string }
interface HolidayDateRow {
  id: string;
  effective_date: string;
  name_common: string;
  name_statutory: string;
  holiday_type: 'statutory' | 'proclaimed' | 'movable';
  day_fraction: number | string;
  source_reference: string;
  holiday_calendar_version_id: string;
}

router.post('/calendar/day-context', async c => {
  await requirePermission(c, 'calendar.view');
  const v = zv(c, DayContextSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { from, to, jurisdiction } = v.data;
  if (from > to) return c.json({ success: false, message: '`from` must be on or before `to`.' }, 400);
  const rangeDays = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (rangeDays > 366) return c.json({ success: false, message: 'Date range too large — request at most 366 days.' }, 400);

  const { data: calendars, error: calendarError } = await sb.from('holiday_calendars')
    .select('id,name').eq('jurisdiction', jurisdiction);
  if (calendarError) {
    console.error('[calendar/day-context] calendars:', calendarError.message);
    return c.json({ success: false, message: 'Failed to load calendar day context.' }, 500);
  }
  const calendarRows = calendars as HolidayCalendarRow[];
  if (!calendarRows.length) {
    const empty: CalendarDayContextResponse = { success: true, holidays: [], range: { from, to } };
    return c.json(empty);
  }

  const { data: versions, error: versionError } = await sb.from('holiday_calendar_versions')
    .select('id,holiday_calendar_id')
    .in('holiday_calendar_id', calendarRows.map(calendar => calendar.id))
    .eq('status', 'published')
    .lte('effective_from', to)
    .or(`effective_to.is.null,effective_to.gte.${from}`);
  if (versionError) {
    console.error('[calendar/day-context] versions:', versionError.message);
    return c.json({ success: false, message: 'Failed to load calendar day context.' }, 500);
  }
  const versionRows = versions as HolidayVersionRow[];
  if (!versionRows.length) {
    const empty: CalendarDayContextResponse = { success: true, holidays: [], range: { from, to } };
    return c.json(empty);
  }

  const { data: dates, error: dateError } = await sb.from('holiday_dates')
    .select('id,effective_date,name_common,name_statutory,holiday_type,day_fraction,source_reference,holiday_calendar_version_id')
    .in('holiday_calendar_version_id', versionRows.map(version => version.id))
    .gte('effective_date', from)
    .lte('effective_date', to)
    .order('effective_date', { ascending: true });
  if (dateError) {
    console.error('[calendar/day-context] dates:', dateError.message);
    return c.json({ success: false, message: 'Failed to load calendar day context.' }, 500);
  }

  const calendarNameById = new Map(calendarRows.map(calendar => [calendar.id, calendar.name]));
  const calendarIdByVersion = new Map(versionRows.map(version => [version.id, version.holiday_calendar_id]));
  const seen = new Set<string>();
  const holidays: CalendarHolidayMarkerDTO[] = [];
  for (const date of dates as HolidayDateRow[]) {
    const key = `${date.effective_date}:${date.name_common.trim().toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const calendarId = calendarIdByVersion.get(date.holiday_calendar_version_id);
    holidays.push({
      id: date.id,
      date: date.effective_date,
      name: date.name_common,
      statutoryName: date.name_statutory,
      holidayType: date.holiday_type,
      dayFraction: Number(date.day_fraction),
      calendarName: calendarId ? calendarNameById.get(calendarId) ?? 'Trinidad & Tobago' : 'Trinidad & Tobago',
      sourceReference: date.source_reference,
    });
  }
  const response: CalendarDayContextResponse = { success: true, holidays, range: { from, to } };
  return c.json(response);
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
  const caps: Caps = { canManage: can('calendar.manage'), canAssign: can('calendar.task.assign'), userId: user.id, departmentId: user.department_id ?? null };
  // Central read policy — same scope as /calendar/list (a known UUID grants nothing extra):
  // participants + org; department members/managers for team; personal never via calendar.manage.
  const attendee = await isAttendee(entryId, user.id);
  if (!canReadEntry(row, caps, attendee)) {
    return c.json({ success: false, message: 'Not found.' }, 404);
  }

  const dto = entryToDto(row, caps);
  const { data: att, error: attendeeError } = await sb.from('calendar_activity_attendees').select('user_id, response_status, responded_at').eq('calendar_entry_id', entryId);
  if (attendeeError) return c.json({ success: false, message: 'Failed to load item.' }, 500);
  dto.attendeeCount = att.length;
  try {
    await hydrateNames([dto]);
  } catch (e) {
    console.error('[calendar/get] names:', (e as Error).message);
    return c.json({ success: false, message: 'Failed to load item.' }, 500);
  }
  const attendees: CalendarAttendeeDTO[] = att.map(row => ({
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

async function loadReadableEntry(user: { id: string; role?: string | null; department_id?: string | null }, rawId: string): Promise<{ row: EntryRow; entryId: string } | null> {
  const { entryId } = parseEntryId(rawId);
  const { data: row, error } = await sb.from('calendar_entries').select('*').eq('id', entryId).maybeSingle<EntryRow>();
  if (error) throw new Error(`calendar entry read failed: ${error.message}`);
  if (!row) return null;
  const can = await effectiveCan(user);
  const caps: Caps = { canManage: can('calendar.manage'), canAssign: can('calendar.task.assign'), userId: user.id, departmentId: user.department_id ?? null };
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
const CUSTOM_COLOR = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

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

async function validCalendarCategory(id: string): Promise<boolean> {
  const { data, error } = await sb.from('calendar_categories')
    .select('id').eq('id', id).eq('is_active', true).maybeSingle<{ id: string }>();
  if (error) throw new Error(`calendar category validation failed: ${error.message}`);
  return !!data;
}

// ── POST /calendar/task/create ──────────────────────────────────────────────

const CreateTaskSchema = z.object({
  calendarId:     z.uuid(),
  kind:           z.literal('task').optional(),
  categoryId:     z.uuid().optional(),
  title:          z.string().trim().min(1).max(200),
  titleIconType:  TITLE_ICON_TYPE.optional(),
  titleIconValue: TITLE_ICON_VALUE.optional(),
  notes:          z.string().max(4000).nullable().optional(),
  allDay:         z.boolean().optional(),
  startsOn:       z.string().regex(DATE_RE).nullable().optional(),
  endsOn:         z.string().regex(DATE_RE).nullable().optional(),
  startsAt:       z.string().nullable().optional(),
  endsAt:         z.string().nullable().optional(),
  deadlineAt:     z.iso.datetime().nullable().optional(),
  assigneeUserId: z.string().optional(),
  departmentId:   z.string().nullable().optional(),
  priority:       z.enum(['low', 'medium', 'high']).optional(),
  visibility:     VISIBILITY.optional(),
  recurrenceRule: z.string().max(400).nullable().optional(),
  colorKey:       z.enum(CALENDAR_COLOR_KEYS).nullable().optional(),
  customColor:    CUSTOM_COLOR.nullable().optional(),
  locationLabel:  z.string().trim().max(240).nullable().optional(),
  reminderOffsets: z.array(z.number().int().min(0).max(525600)).max(5).optional(),
});

router.post('/calendar/task/create', async c => {
  const user = await requirePermission(c, 'calendar.task.manage_own');
  const v = zv(c, CreateTaskSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const d = v.data;
  const titleIconError = validateTitleIcon(d.titleIconType, d.titleIconValue);
  if (titleIconError) return c.json({ success: false, message: titleIconError }, 400);
  const selectedCalendar = await loadCalendarCollectionForEntry(user, d.calendarId);
  if (!selectedCalendar.ok) return c.json({ success: false, message: selectedCalendar.message }, selectedCalendar.status);
  const allDay = d.allDay ?? true;
  if (d.categoryId && !(await validCalendarCategory(d.categoryId))) return c.json({ success: false, message: 'The selected category is not available.' }, 400);

  const when = normalizeWhen(allDay, d.startsOn ?? null, d.endsOn ?? null, d.startsAt ?? null, d.endsAt ?? null);
  if (!when.ok) return c.json({ success: false, message: when.message }, 400);
  const visibility = d.visibility ?? 'personal';
  const departmentId = d.departmentId ?? null;
  if (visibility === 'team' && !departmentId) return c.json({ success: false, message: 'Choose a department for a department-visible task.' }, 400);
  if (departmentId) {
    if (departmentId !== user.department_id && !(await userCan(user, 'calendar.manage'))) return c.json({ success: false, message: 'You cannot create calendar tasks for another department.' }, 403);
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
      idempotencyKey: `calendar.task.create:${user.id}:${d.calendarId}:${d.categoryId ?? 'general'}:${d.title}:${d.titleIconType ?? ''}:${d.titleIconValue ?? ''}:${d.startsOn ?? d.startsAt ?? ''}:${d.deadlineAt ?? 'no-deadline'}:${assignee ?? ''}:${departmentId ?? ''}:${d.colorKey ?? 'auto'}:${d.customColor ?? 'no-custom'}:${d.locationLabel ?? ''}`,
      eventType:      'calendar.task.created',
      eventSeverity:  'info',
      eventPayload:   { title: d.title, titleIconType: d.titleIconType ?? null, titleIconValue: d.titleIconValue ?? null, kind: 'task', categoryId: d.categoryId ?? null, calendarId: d.calendarId, deadlineAt: d.deadlineAt ?? null, assigneeUserId: assignee, departmentId, colorKey: d.colorKey ?? null, customColor: d.customColor ?? null, locationLabel: d.locationLabel ?? null, recurring: !!seriesId },
      getEntityIdentity: (r) => ({ id: r.id }),
      ...(assignee && assignee !== user.id ? {
        explicitRecipients: [{ userId: assignee, reason: 'assignee' as const }],
        notification: {
          title:          `Task assigned: ${d.title}`,
          body:           d.deadlineAt ? `Due ${new Date(d.deadlineAt).toLocaleString('en-US')}.` : 'A new task was assigned to you.',
          actionRoute:    's-calendar',
          type:           'calendar.task.assigned',
          actionRequired: true,
          dueAt:          d.deadlineAt ?? null,
        },
      } : {}),
    },
    writeRecord: async () => {
      const createResult = await sb.rpc('calendar_entry_create_tx', {
        p_actor_id: user.id,
        p_entry: {
          type: 'task', entryKind: 'task', categoryId: d.categoryId ?? null,
          calendarId: d.calendarId, title: d.title.trim(), titleIconType: d.titleIconType ?? null, titleIconValue: d.titleIconValue ?? null, notes: d.notes ?? null,
          colorKey: d.customColor ? null : d.colorKey ?? null, customColor: d.customColor ?? null,
          locationLabel: d.locationLabel ?? null, allDay,
          startsOn: allDay ? d.startsOn ?? null : null,
          endsOn: allDay ? d.endsOn ?? null : null,
          startsAt: allDay ? null : d.startsAt ?? null,
          endsAt: allDay ? null : d.endsAt ?? null,
          deadlineAt: d.deadlineAt ?? null,
          assigneeUserId: assignee, departmentId, visibility, priority: d.priority ?? 'medium',
          recurrenceRule: d.recurrenceRule ?? null, recurrenceSeriesId: seriesId,
        },
        p_attendee_user_ids: [],
        p_reminder_offsets: [...new Set(d.reminderOffsets ?? [])],
      });
      if (createResult.error) throw new Error(createResult.error.message);
      return createResult.data as { id: string };
    },
  });

  await log_(user, 'calendar_task_create', 'calendar_entry', result.entityId, JSON.stringify({ title: d.title, assignee }));
  return c.json({ success: true, id: result.entityId });
});

// ── POST /calendar/activity/create ──────────────────────────────────────────

const CreateActivitySchema = z.object({
  calendarId:      z.uuid(),
  kind:            z.enum(['event', 'reminder']).optional(),
  categoryId:      z.uuid().optional(),
  availability:    z.enum(['busy', 'free', 'tentative', 'out_of_office']).optional(),
  title:           z.string().trim().min(1).max(200),
  titleIconType:   TITLE_ICON_TYPE.optional(),
  titleIconValue:  TITLE_ICON_VALUE.optional(),
  notes:           z.string().max(4000).nullable().optional(),
  allDay:          z.boolean().optional(),
  startsOn:        z.string().regex(DATE_RE).nullable().optional(),
  endsOn:          z.string().regex(DATE_RE).nullable().optional(),
  startsAt:        z.string().nullable().optional(),
  endsAt:          z.string().nullable().optional(),
  deadlineAt:      z.iso.datetime().nullable().optional(),
  visibility:      VISIBILITY.optional(),
  departmentId:    z.string().nullable().optional(),
  attendeeUserIds: z.array(z.string()).max(200).optional(),
  recurrenceRule:  z.string().max(400).nullable().optional(),
  colorKey:         z.enum(CALENDAR_COLOR_KEYS).nullable().optional(),
  customColor:      CUSTOM_COLOR.nullable().optional(),
  locationLabel:    z.string().trim().max(240).nullable().optional(),
  reminderOffsets:  z.array(z.number().int().min(0).max(525600)).max(5).optional(),
});

router.post('/calendar/activity/create', async c => {
  const user = await requirePermission(c, 'calendar.activity.manage_own');
  const v = zv(c, CreateActivitySchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const d = v.data;
  const titleIconError = validateTitleIcon(d.titleIconType, d.titleIconValue);
  if (titleIconError) return c.json({ success: false, message: titleIconError }, 400);
  if ((d.kind ?? 'event') !== 'event' && d.deadlineAt) {
    return c.json({ success: false, message: 'A deadline can be added to an event, not to a standalone reminder.' }, 400);
  }
  const selectedCalendar = await loadCalendarCollectionForEntry(user, d.calendarId);
  if (!selectedCalendar.ok) return c.json({ success: false, message: selectedCalendar.message }, selectedCalendar.status);
  const allDay = d.allDay ?? true;
  if (d.categoryId && !(await validCalendarCategory(d.categoryId))) return c.json({ success: false, message: 'The selected category is not available.' }, 400);

  const when = normalizeWhen(allDay, d.startsOn ?? null, d.endsOn ?? null, d.startsAt ?? null, d.endsAt ?? null);
  if (!when.ok) return c.json({ success: false, message: when.message }, 400);
  const visibility = d.visibility ?? 'personal';
  const departmentId = d.departmentId ?? null;
  if (visibility === 'team' && !departmentId) return c.json({ success: false, message: 'Choose a department for a department-visible event.' }, 400);
  if (departmentId) {
    if (departmentId !== user.department_id && !(await userCan(user, 'calendar.manage'))) return c.json({ success: false, message: 'You cannot create calendar activities for another department.' }, 403);
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
      idempotencyKey: `calendar.activity.create:${user.id}:${d.calendarId}:${d.kind ?? 'event'}:${d.categoryId ?? 'general'}:${d.title}:${d.titleIconType ?? ''}:${d.titleIconValue ?? ''}:${d.startsOn ?? d.startsAt ?? ''}:${d.deadlineAt ?? 'no-deadline'}:${departmentId ?? ''}:${d.colorKey ?? 'auto'}:${d.customColor ?? 'no-custom'}:${d.locationLabel ?? ''}`,
      eventType:      'calendar.activity.created',
      eventSeverity:  'info',
      eventPayload:   { title: d.title, titleIconType: d.titleIconType ?? null, titleIconValue: d.titleIconValue ?? null, kind: d.kind ?? 'event', categoryId: d.categoryId ?? null, calendarId: d.calendarId, deadlineAt: d.deadlineAt ?? null, attendees: attendees.length, departmentId, colorKey: d.colorKey ?? null, customColor: d.customColor ?? null, locationLabel: d.locationLabel ?? null, recurring: !!seriesId },
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
    },
    writeRecord: async () => {
      const createResult = await sb.rpc('calendar_entry_create_tx', {
        p_actor_id: user.id,
        p_entry: {
          type: 'activity', entryKind: d.kind ?? 'event', categoryId: d.categoryId ?? null,
          calendarId: d.calendarId, availability: d.availability ?? 'busy', title: d.title.trim(), titleIconType: d.titleIconType ?? null, titleIconValue: d.titleIconValue ?? null, notes: d.notes ?? null,
          colorKey: d.customColor ? null : d.colorKey ?? null, customColor: d.customColor ?? null,
          locationLabel: d.locationLabel ?? null, allDay,
          startsOn: allDay ? d.startsOn ?? null : null,
          endsOn: allDay ? d.endsOn ?? null : null,
          startsAt: allDay ? null : d.startsAt ?? null,
          endsAt: allDay ? null : d.endsAt ?? null,
          deadlineAt: d.deadlineAt ?? null,
          departmentId, visibility, recurrenceRule: d.recurrenceRule ?? null, recurrenceSeriesId: seriesId,
        },
        p_attendee_user_ids: attendees,
        p_reminder_offsets: [...new Set(d.reminderOffsets ?? [])],
      });
      if (createResult.error) throw new Error(createResult.error.message);
      return createResult.data as { id: string };
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
  return [...new Set(data.map(row => row.user_id as string))];
}

/**
 * Read policy (mirrors /calendar/list scope):
 *   participant (owner / assignee / invited attendee) → yes
 *   org visibility → yes · department team visibility → that department
 *   calendar managers may read non-personal team entries for governance
 *   personal → participants ONLY (never through calendar.manage)
 */
function canReadEntry(row: EntryRow, caps: Caps, attendee: boolean): boolean {
  const participant = row.owner_user_id === caps.userId || row.assignee_user_id === caps.userId || attendee;
  if (participant) return true;
  if (row.visibility === 'org') return true;
  if (row.visibility === 'team') {
    if (caps.canManage) return true;
    return Boolean(row.department_id && caps.departmentId && row.department_id === caps.departmentId);
  }
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
async function loadEditable(user: { id: string; role?: string | null }, entryId: string): Promise<{ ok: true; row: EntryRow; canManage: boolean } | { ok: false; status: 400 | 403 | 404 | 409; message: string }> {
  const { data: row, error } = await sb.from('calendar_entries').select('*').eq('id', entryId).maybeSingle<EntryRow>();
  if (error) return { ok: false, status: 400, message: 'Failed to load item.' };
  if (!row) return { ok: false, status: 404, message: 'Item not found.' };
  if (row.source_module) {
    return { ok: false, status: 409, message: 'This calendar item is controlled by its source module. Open the source record to change it.' };
  }

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
    titleIconType:  TITLE_ICON_TYPE.optional(),
    titleIconValue: TITLE_ICON_VALUE.optional(),
    notes:          z.string().max(4000).nullable().optional(),
    allDay:         z.boolean().optional(),
    startsOn:       z.string().regex(DATE_RE).nullable().optional(),
    endsOn:         z.string().regex(DATE_RE).nullable().optional(),
    startsAt:       z.string().nullable().optional(),
    endsAt:         z.string().nullable().optional(),
    deadlineAt:     z.iso.datetime().nullable().optional(),
    assigneeUserId: z.string().nullable().optional(),
    attendeeUserIds:z.array(z.string()).max(200).optional(),
    departmentId:   z.string().nullable().optional(),
    priority:       z.enum(['low', 'medium', 'high']).optional(),
    visibility:     VISIBILITY.optional(),
    colorKey:       z.enum(CALENDAR_COLOR_KEYS).nullable().optional(),
    customColor:    CUSTOM_COLOR.nullable().optional(),
    locationLabel:  z.string().trim().max(240).nullable().optional(),
    calendarId:     z.uuid().optional(),
    categoryId:     z.uuid().optional(),
    availability:   z.enum(['busy', 'free', 'tentative', 'out_of_office']).optional(),
    recurrenceRule: z.string().max(400).nullable().optional(),
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
  const nextTitleIconType = p.titleIconType !== undefined ? p.titleIconType : row.title_icon_type;
  const nextTitleIconValue = p.titleIconValue !== undefined ? p.titleIconValue : row.title_icon_value;
  const titleIconError = validateTitleIcon(nextTitleIconType, nextTitleIconValue);
  if (titleIconError) return c.json({ success: false, message: titleIconError }, 400);
  if (p.deadlineAt !== undefined && row.type !== 'task' && row.entry_kind !== 'event') {
    return c.json({ success: false, message: 'Deadlines can only be added to events and tasks.' }, 400);
  }
  const nextVisibility = p.visibility ?? row.visibility;
  const requestedDepartmentId = p.departmentId !== undefined ? p.departmentId : row.department_id;
  const nextDepartmentId = nextVisibility === 'team' ? requestedDepartmentId : null;
  let existingAttendees: string[] = [];
  let desiredAttendees: string[] | null = null;
  if (p.attendeeUserIds !== undefined) {
    if (row.type !== 'activity') return c.json({ success: false, message: 'Only events have invitees.' }, 400);
    if (scope === 'occurrence') return c.json({ success: false, message: 'Participants apply to the entire recurring series. Choose “Entire series” to change them.' }, 400);
    desiredAttendees = [...new Set(p.attendeeUserIds.filter(id => id !== row.owner_user_id))];
    for (const attendeeId of desiredAttendees) {
      if (!(await validAssignee(attendeeId))) return c.json({ success: false, message: 'One or more invitees are not valid active users.' }, 400);
    }
    existingAttendees = await attendeeUserIds(entryId);
  }
  const temporalChange =
    (p.allDay !== undefined && p.allDay !== row.all_day)
    || (p.startsOn !== undefined && p.startsOn !== row.starts_on)
    || (p.endsOn !== undefined && p.endsOn !== row.ends_on)
    || (p.startsAt !== undefined && !sameInstant(p.startsAt, row.starts_at))
    || (p.endsAt !== undefined && !sameInstant(p.endsAt, row.ends_at));
  const rescheduleRecipients = row.type === 'activity' && temporalChange ? await attendeeUserIds(entryId) : [];

  if (scope === 'occurrence' && (
    p.assigneeUserId !== undefined || p.departmentId !== undefined || p.priority !== undefined || p.visibility !== undefined
    || p.colorKey !== undefined || p.customColor !== undefined || p.locationLabel !== undefined
    || p.calendarId !== undefined || p.categoryId !== undefined || p.availability !== undefined || p.recurrenceRule !== undefined
    || p.deadlineAt !== undefined || p.titleIconType !== undefined || p.titleIconValue !== undefined
  )) {
    return c.json({ success: false, message: 'Ownership, access, calendar, category, recurrence, appearance, location and deadline apply to the entire recurring series. Choose “Entire series” to change them.' }, 400);
  }

  if (p.calendarId !== undefined && p.calendarId !== row.calendar_collection_id) {
    const selectedCalendar = await loadCalendarCollectionForEntry(user, p.calendarId);
    if (!selectedCalendar.ok) return c.json({ success: false, message: selectedCalendar.message }, selectedCalendar.status);
  }
  if (p.categoryId && p.categoryId !== row.category_id && !(await validCalendarCategory(p.categoryId))) {
    return c.json({ success: false, message: 'The selected category is not available.' }, 400);
  }
  if (p.availability !== undefined && row.type !== 'activity') {
    return c.json({ success: false, message: 'Availability applies only to events, meetings and reminders.' }, 400);
  }
  if (p.recurrenceRule) {
    const recurrenceError = validateRrule(p.recurrenceRule);
    if (recurrenceError) return c.json({ success: false, message: recurrenceError }, 400);
  }

  // Reassignment is gated + validated.
  if (p.assigneeUserId !== undefined && p.assigneeUserId && p.assigneeUserId !== row.owner_user_id) {
    if (!(await userCan(user, 'calendar.task.assign'))) return c.json({ success: false, message: 'You cannot assign tasks to other users.' }, 403);
    if (!(await validAssignee(p.assigneeUserId))) return c.json({ success: false, message: 'The selected assignee is not a valid active user.' }, 400);
  }
  if (nextVisibility === 'team' && !nextDepartmentId) {
    return c.json({ success: false, message: 'Choose a department for a department-visible calendar item.' }, 400);
  }
  if (nextDepartmentId) {
    if (nextDepartmentId !== user.department_id && !(await userCan(user, 'calendar.manage'))) return c.json({ success: false, message: 'You cannot assign calendar entries to another department.' }, 403);
    if (!(await validDepartment(nextDepartmentId))) return c.json({ success: false, message: 'The selected department is not valid.' }, 400);
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
    if (p.titleIconType !== undefined || p.titleIconValue !== undefined) {
      updates.title_icon_type = nextTitleIconType;
      updates.title_icon_value = nextTitleIconValue;
    }
    if (p.notes !== undefined)          updates.notes            = p.notes;
    if (p.priority !== undefined)       updates.priority         = p.priority;
    if (p.visibility !== undefined)     updates.visibility       = nextVisibility;
    if (p.colorKey !== undefined)       updates.color_key        = p.colorKey;
    if (p.customColor !== undefined)    updates.custom_color     = p.customColor;
    if (p.customColor)                  updates.color_key        = null;
    else if (p.colorKey)                updates.custom_color     = null;
    if (p.locationLabel !== undefined)  updates.location_label   = p.locationLabel;
    if (p.calendarId !== undefined)     updates.calendar_collection_id = p.calendarId;
    if (p.categoryId !== undefined)     updates.category_id      = p.categoryId;
    if (p.availability !== undefined)   updates.availability     = p.availability;
    if (p.deadlineAt !== undefined)     updates.deadline_at      = p.deadlineAt;
    if (p.recurrenceRule !== undefined) {
      updates.recurrence_rule = p.recurrenceRule ?? null;
      updates.recurrence_series_id = p.recurrenceRule ? row.recurrence_series_id ?? crypto.randomUUID() : null;
    }
    if (p.assigneeUserId !== undefined) updates.assignee_user_id = p.assigneeUserId;
    if (p.departmentId !== undefined || p.visibility !== undefined) updates.department_id = nextDepartmentId;
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

  const addedAttendees = desiredAttendees?.filter(id => !existingAttendees.includes(id)) ?? [];
  const removedAttendees = desiredAttendees === null ? [] : existingAttendees.filter(id => !desiredAttendees.includes(id));
  if (addedAttendees.length) {
    const { error } = await sb.from('calendar_activity_attendees').insert(
      addedAttendees.map(attendeeId => ({ calendar_entry_id: entryId, user_id: attendeeId, response_status: 'invited' })),
    );
    if (error) return c.json({ success: false, message: 'The event changed, but its new invitees could not be added.' }, 500);
  }
  if (removedAttendees.length) {
    const { error } = await sb.from('calendar_activity_attendees')
      .delete()
      .eq('calendar_entry_id', entryId)
      .in('user_id', removedAttendees);
    if (error) {
      if (addedAttendees.length) {
        const { error: rollbackError } = await sb.from('calendar_activity_attendees')
          .delete()
          .eq('calendar_entry_id', entryId)
          .in('user_id', addedAttendees);
        if (rollbackError) console.error('[calendar/update] attendee rollback failed:', rollbackError.message);
      }
      return c.json({ success: false, message: 'The event changed, but its invitee list could not be updated.' }, 500);
    }
  }

  const updatedEvent = await emitAppEvent({
    eventType: 'calendar.entry.updated', sourceModule: 'calendar',
    sourceEntityType: row.type, sourceEntityId: entryId, actorUserId: user.id,
    severity: 'info', payload: { scope, occurrenceDate },
  });
  if (!updatedEvent.ok) return c.json({ success: false, message: 'The item changed, but its update event could not be recorded.' }, 500);
  if (addedAttendees.length || removedAttendees.length) {
    const participantEvent = await emitAppEvent({
      eventType: 'calendar.activity.participants_updated',
      sourceModule: 'calendar',
      sourceEntityType: 'activity',
      sourceEntityId: entryId,
      actorUserId: user.id,
      severity: 'info',
      payload: { title: p.title ?? row.title, addedUserIds: addedAttendees, removedUserIds: removedAttendees, attendeeCount: desiredAttendees?.length ?? 0 },
      dedupeKey: `calendar.activity.participants_updated:${entryId}:${[...(desiredAttendees ?? [])].sort().join(',') || 'none'}`,
      explicitRecipients: [...new Set([...addedAttendees, ...removedAttendees])].map(userId => ({ userId, reason: 'assignee' as const })),
      notification: {
        type: 'calendar.activity.participants_updated',
        title: `Event participants updated: ${p.title ?? row.title}`,
        body: 'The invitee list for this event changed.',
        actionRoute: 's-calendar',
      },
    });
    if (!participantEvent.ok) return c.json({ success: false, message: 'The invitee list changed, but participant notifications could not be recorded.' }, 500);
  }
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
      // Content-derived dedupe: activity + occurrence + the RESULTING schedule.
      // Must NOT include row.updated_at — it changes on every save, so an idempotent
      // re-save to the same schedule would otherwise mint a fresh key and a duplicate
      // attendee notification (the retry must dedupe to exactly one).
      dedupeKey: `calendar.activity.rescheduled:${entryId}:${occurrenceDate ?? 'series'}:${scheduleIdentity}`,
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
  await log_(user, 'calendar_update', 'calendar_entry', entryId, JSON.stringify({
    scope,
    occurrenceDate,
    attendeesAdded: addedAttendees.length,
    attendeesRemoved: removedAttendees.length,
  }));
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
  if (row.source_module) return c.json({ success: false, message: 'This task is controlled by its source module. Open the source record to change it.' }, 409);

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
