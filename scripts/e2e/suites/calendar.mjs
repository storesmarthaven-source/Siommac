/**
 * scripts/e2e/suites/calendar.mjs
 *
 * Live E2E for the platform Calendar & Tasks module (routes/calendar.ts). Hits the
 * real routes over HTTP and asserts the §2 side-effects (app_events + activity_logs)
 * via the service-role client.
 *
 * Covers, per the Testing Standard:
 *   • Every endpoint — list, get, task/create, activity/create, update, task/status,
 *     cancel, reminder get/set/sweep, and attendee response.
 *   • Flows — task lifecycle (not_started→in_progress→done), activity invitations,
 *     reminder and overdue delivery, preferences, reschedule/cancellation notifications,
 *     recurrence expansion + per-occurrence cancel/modify.
 *   • Access control — assignment gate, per-owner edit gate, personal-visibility scope,
 *     and calendar.view DENY via a user override (the negative path).
 *   • Response shape — the exact CalendarItemDTO fields the frontend consumes.
 *   • Side-effects — each mutation writes its app_events + activity_logs rows.
 *   • Cleanup — every created entry (+ its cascaded attendees/exceptions), events,
 *     audit rows, the view override, and synthetic actors are removed.
 */

export const title = 'Calendar';

const DAY = 86_400_000;
const dayKey = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  // Actors: two real employees (creator + "other user") and a manager (has assign/manage).
  const { actors: [emp1, emp2], createdIds: idsEmp } = await h.acquireActors('employee', 2, {}, {}, { forceSynthetic: true });
  const { actors: [mgr],        createdIds: idsMgr } = await h.acquireActors('manager', 1, {}, {}, { forceSynthetic: true });
  const createdActorIds = [...idsEmp, ...idsMgr];
  const T = { emp1: mint(emp1), emp2: mint(emp2), mgr: mint(mgr) };

  const runStart = new Date().toISOString();
  const entryIds = [];               // every calendar_entries id this run created
  const overrides = [];              // { userId, permission } overrides to remove
  const preferenceStates = [];       // preferences changed by this run, restored at cleanup

  h.onCleanup(async () => {
    if (entryIds.length) {
      await h.mustDelete('notifications', q => q.eq('module', 'calendar').in('source_id', entryIds).gte('created_at', runStart));
      await h.mustDelete('audit_logs', q => q.in('record_id', entryIds).gte('created_at', runStart));
      await h.mustDelete('calendar_entries', q => q.in('id', entryIds));
      await h.mustDelete('app_events', q => q.eq('source_module', 'calendar').in('source_entity_id', entryIds).gte('created_at', runStart));
      await h.mustDelete('activity_logs', q => q.eq('entity', 'calendar_entry').in('entity_id', entryIds).gte('created_at', runStart));
    }
    for (const state of preferenceStates) {
      if (state.before) await sb.from('notification_preferences').upsert(state.before, { onConflict: 'user_id,event_type' });
      else await h.mustDelete('notification_preferences', q => q.eq('user_id', state.userId).eq('event_type', state.eventType));
    }
    for (const o of overrides)
      await h.mustDelete('user_permissions', q => q.eq('user_id', o.userId).eq('permission', o.permission));
    if (createdActorIds.length) await h.mustDelete('app_users', q => q.in('id', createdActorIds));
  });

  const appEventExists = async (entityId, eventType) => {
    const { data } = await sb.from('app_events').select('id')
      .eq('source_module', 'calendar').eq('source_entity_id', entityId).eq('event_type', eventType).gte('created_at', runStart).limit(1);
    return (data ?? []).length > 0;
  };
  const auditExists = async (entityId, action) => {
    const { data } = await sb.from('activity_logs').select('id')
      .eq('entity', 'calendar_entry').eq('entity_id', entityId).eq('action', action).gte('created_at', runStart).limit(1);
    return (data ?? []).length > 0;
  };
  const listItems = async (token, from, to, extra = {}) => {
    const r = await api('calendar/list', token, { from, to, ...extra });
    ok(r);
    return r.body.items ?? [];
  };
  const serviceSweep = async now => {
    const response = await fetch(`${h.base}/api/calendar/reminders/run-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${h.serviceKey}` },
      body: JSON.stringify({ args: { now } }),
    });
    return { status: response.status, body: await response.json() };
  };

  // ── Tasks: create · list contract · update · status lifecycle · cancel ──────
  h.section('Calendar › Tasks');

  let taskId = null;
  await test('task/create → row written + app_event + audit', async () => {
    const r = await api('calendar/task/create', T.emp1, {
      title: `${TAG} Forecast`, notes: 'Q2', allDay: true, startsOn: dayKey(2), priority: 'high',
    });
    ok(r); taskId = r.body.id; expect(!!taskId, 'id returned'); entryIds.push(taskId);
    const { data: row } = await sb.from('calendar_entries').select('type, status, priority, owner_user_id').eq('id', taskId).maybeSingle();
    expect(row && row.type === 'task' && row.status === 'not_started' && row.priority === 'high', 'task row: not_started/high');
    expect(row.owner_user_id === emp1.id, 'owner = creator');
    expect(await appEventExists(taskId, 'calendar.task.created'), 'app_event calendar.task.created');
    expect(await auditExists(taskId, 'calendar_task_create'), 'audit calendar_task_create');
  });

  await test('list returns the CalendarItemDTO contract + computed capabilities', async () => {
    const items = await listItems(T.emp1, dayKey(-1), dayKey(10));
    const it = items.find(i => i.id === taskId);
    expect(!!it, 'created task appears in the window');
    for (const f of ['id', 'type', 'origin', 'title', 'status', 'priority', 'ownerUserId', 'allDay', 'editable', 'completable', 'assignable', 'cancelable', 'drillThrough'])
      expect(f in it, `CalendarItemDTO.${f} present`);
    expect(it.type === 'task' && it.origin === 'calendar', 'native task');
    expect(it.editable === true && it.completable === true && it.cancelable === true, 'owner can edit/complete/cancel');
    expect(it.assignable === false, 'employee (no assign perm) cannot assign');
  });

  await test('update changes title + priority', async () => {
    const r = await api('calendar/update', T.emp1, { id: taskId, patch: { title: `${TAG} Forecast v2`, priority: 'medium' } });
    ok(r);
    const g = await api('calendar/get', T.emp1, { id: taskId });
    ok(g); expect(g.body.item.title === `${TAG} Forecast v2` && g.body.item.priority === 'medium', 'title + priority updated');
    expect(await appEventExists(taskId, 'calendar.entry.updated'), 'update app_event');
  });

  await test('task/status: not_started → in_progress → done (completed_at stamped)', async () => {
    ok(await api('calendar/task/status', T.emp1, { id: taskId, status: 'in_progress' }));
    ok(await api('calendar/task/status', T.emp1, { id: taskId, status: 'done' }));
    const { data: row } = await sb.from('calendar_entries').select('status, completed_at, completed_by').eq('id', taskId).maybeSingle();
    expect(row && row.status === 'done' && row.completed_at && row.completed_by === emp1.id, 'done + completed_at/by set');
    expect(await appEventExists(taskId, 'calendar.task.completed'), 'app_event calendar.task.completed');
  });

  await test('cancel a task → status cancelled (row kept)', async () => {
    ok(await api('calendar/cancel', T.emp1, { id: taskId }));
    const { data: row } = await sb.from('calendar_entries').select('status').eq('id', taskId).maybeSingle();
    expect(row && row.status === 'cancelled', 'status cancelled');
    expect(await appEventExists(taskId, 'calendar.entry.cancelled'), 'cancel app_event');
    const reminder = await api('calendar/reminders/set', T.emp1, { id: taskId, offsetMinutes: [60] });
    fails(reminder); expect(reminder.status === 400, 'cancelled task rejects new reminders');
  });

  // ── Activities + attendees ──────────────────────────────────────────────────
  h.section('Calendar › Activities');

  let activityId = null;
  await test('activity/create with an attendee → row + attendee + app_event', async () => {
    const r = await api('calendar/activity/create', T.emp1, {
      title: `${TAG} Team Meeting`, allDay: false,
      startsAt: `${dayKey(1)}T10:00:00`, endsAt: `${dayKey(1)}T11:00:00`,
      visibility: 'team', attendeeUserIds: [emp2.id],
    });
    ok(r); activityId = r.body.id; entryIds.push(activityId);
    const { data: row } = await sb.from('calendar_entries').select('type, status, priority, all_day').eq('id', activityId).maybeSingle();
    expect(row && row.type === 'activity' && row.status === null && row.priority === null && row.all_day === false, 'activity: no status/priority, timed');
    const { data: att } = await sb.from('calendar_activity_attendees').select('user_id').eq('calendar_entry_id', activityId);
    expect((att ?? []).some(a => a.user_id === emp2.id), 'attendee row written');
    expect(await appEventExists(activityId, 'calendar.activity.created'), 'app_event calendar.activity.created');
  });

  await test('get returns attendee response contract to the invited user', async () => {
    const g = await api('calendar/get', T.emp2, { id: activityId });
    ok(g);
    expect(g.body.item.type === 'activity' && g.body.item.attendeeCount === 1, 'attendeeCount = 1');
    const attendee = (g.body.attendees ?? []).find(a => a.userId === emp2.id);
    expect(attendee && attendee.responseStatus === 'invited' && attendee.respondedAt === null, 'camelCase invitation contract');
  });

  await test('only an attendee can respond; acceptance is atomic and notifies the owner', async () => {
    const ownerAttempt = await api('calendar/activity/respond', T.emp1, { id: activityId, responseStatus: 'accepted' });
    fails(ownerAttempt); expect(ownerAttempt.status === 404, `non-attendee response expected 404, got ${ownerAttempt.status}`);

    ok(await api('calendar/activity/respond', T.emp2, { id: activityId, responseStatus: 'accepted' }));
    const { data: attendee } = await sb.from('calendar_activity_attendees')
      .select('response_status,responded_at').eq('calendar_entry_id', activityId).eq('user_id', emp2.id).maybeSingle();
    expect(attendee?.response_status === 'accepted' && !!attendee.responded_at, 'response + timestamp persisted');
    expect(await appEventExists(activityId, 'calendar.activity.response_changed'), 'response app_event');
    const { data: notification } = await sb.from('notifications').select('id')
      .eq('user_id', emp1.id).eq('type', 'calendar.activity.response_changed').eq('source_id', activityId).maybeSingle();
    expect(!!notification, 'owner response notification');
    ok(await api('calendar/activity/respond', T.emp2, { id: activityId, responseStatus: 'accepted' }));
    const { data: eventsAfterRetry } = await sb.from('app_events').select('id')
      .eq('source_module', 'calendar').eq('source_entity_id', activityId)
      .eq('event_type', 'calendar.activity.response_changed').gte('created_at', runStart);
    expect((eventsAfterRetry ?? []).length === 1, 'same response retry is a no-op');
  });

  await test('rescheduling an activity sends one idempotent attendee notification', async () => {
    const startsAt = `${dayKey(2)}T13:00:00`;
    const endsAt = `${dayKey(2)}T14:00:00`;
    ok(await api('calendar/update', T.emp1, { id: activityId, patch: { startsAt, endsAt } }));
    ok(await api('calendar/update', T.emp1, { id: activityId, patch: { startsAt, endsAt } }));
    const { data: notifications } = await sb.from('notifications').select('id')
      .eq('user_id', emp2.id).eq('type', 'calendar.activity.rescheduled').eq('source_id', activityId);
    expect((notifications ?? []).length === 1, 'one attendee reschedule notification');
    expect(await appEventExists(activityId, 'calendar.activity.rescheduled'), 'reschedule app_event');
  });

  await test('cancelling an activity notifies the attendee and deletes the activity', async () => {
    ok(await api('calendar/cancel', T.emp1, { id: activityId }));
    const { data: notifications } = await sb.from('notifications').select('id')
      .eq('user_id', emp2.id).eq('type', 'calendar.activity.cancelled').eq('source_id', activityId);
    expect((notifications ?? []).length === 1, 'one attendee cancellation notification');
    expect(await appEventExists(activityId, 'calendar.activity.cancelled'), 'participant cancellation app_event');
    const g = await api('calendar/get', T.emp1, { id: activityId });
    fails(g); expect(g.status === 404, 'activity gone (404)');
  });

  // ── Reminders, preferences, and overdue sweeps ──────────────────────────────
  h.section('Calendar › Reminders and overdue');

  const sweepNow = new Date(Date.now() + 5_000);
  let reminderTaskId = null;
  await test('reminder set/get deduplicates offsets and writes atomic event + audit', async () => {
    const eventType = 'calendar.reminder.due';
    const { data: before } = await sb.from('notification_preferences').select('*')
      .eq('user_id', emp1.id).eq('event_type', eventType).maybeSingle();
    preferenceStates.push({ userId: emp1.id, eventType, before });
    const { error: preferenceError } = await sb.from('notification_preferences').upsert({
      user_id: emp1.id, event_type: eventType, in_app: true, email: false, whatsapp: false,
    }, { onConflict: 'user_id,event_type' });
    expect(!preferenceError, `preference setup: ${preferenceError?.message ?? ''}`);

    const startsAt = new Date(sweepNow.getTime() + 30 * 60_000).toISOString();
    const r = await api('calendar/task/create', T.emp1, {
      title: `${TAG} Reminder task`, allDay: false, startsAt, visibility: 'personal',
    });
    ok(r); reminderTaskId = r.body.id; entryIds.push(reminderTaskId);
    const set = await api('calendar/reminders/set', T.emp1, { id: reminderTaskId, offsetMinutes: [30, 15, 30] });
    ok(set); expect(JSON.stringify(set.body.offsetMinutes) === JSON.stringify([15, 30]), 'offsets sorted and deduplicated');
    const get = await api('calendar/reminders/get', T.emp1, { id: reminderTaskId });
    ok(get); expect(JSON.stringify(get.body.offsetMinutes) === JSON.stringify([15, 30]), 'saved reminder contract');
    ok(await api('calendar/reminders/set', T.emp1, { id: reminderTaskId, offsetMinutes: [15, 30] }));
    expect(await appEventExists(reminderTaskId, 'calendar.reminders.updated'), 'reminder update app_event');
    const { data: events } = await sb.from('app_events').select('id')
      .eq('source_module', 'calendar').eq('source_entity_id', reminderTaskId)
      .eq('event_type', 'calendar.reminders.updated').gte('created_at', runStart);
    expect((events ?? []).length === 1, 'same reminder settings retry is a no-op');
    const { data: audit } = await sb.from('audit_logs').select('id')
      .eq('record_id', reminderTaskId).eq('action', 'calendar.reminders.updated').gte('created_at', runStart).limit(1);
    expect((audit ?? []).length === 1, 'atomic reminder audit');
    const hidden = await api('calendar/reminders/get', T.emp2, { id: reminderTaskId });
    fails(hidden); expect(hidden.status === 404, 'non-participant reminder read is hidden');
  });

  await test('the sweep is service-only, delivers due reminders once, and records the ledger', async () => {
    const denied = await api('calendar/reminders/run-sweep', T.emp1, { now: sweepNow.toISOString() });
    fails(denied); expect(denied.status === 403, `normal JWT expected 403, got ${denied.status}`);
    const first = await serviceSweep(sweepNow.toISOString());
    ok(first); expect(first.body.data.remindersDelivered >= 1, 'due reminder delivered');
    const { data: ledger } = await sb.from('calendar_reminder_deliveries').select('id')
      .eq('calendar_entry_id', reminderTaskId).eq('delivery_kind', 'reminder');
    expect((ledger ?? []).length === 1, 'one delivery ledger row');
    const { data: notifications } = await sb.from('notifications').select('id')
      .eq('user_id', emp1.id).eq('type', 'calendar.reminder.due').eq('source_id', reminderTaskId);
    expect((notifications ?? []).length === 1, 'one in-app reminder notification');
    const second = await serviceSweep(sweepNow.toISOString());
    ok(second);
    const { data: afterRetry } = await sb.from('calendar_reminder_deliveries').select('id')
      .eq('calendar_entry_id', reminderTaskId).eq('delivery_kind', 'reminder');
    expect((afterRetry ?? []).length === 1, 'retry did not duplicate delivery');
  });

  let preferenceTaskId = null;
  await test('notification preferences suppress channels without suppressing the delivery claim', async () => {
    const eventType = 'calendar.reminder.due';
    const { error: preferenceError } = await sb.from('notification_preferences').upsert({
      user_id: emp1.id, event_type: eventType, in_app: false, email: false, whatsapp: false,
    }, { onConflict: 'user_id,event_type' });
    expect(!preferenceError, `preference setup: ${preferenceError?.message ?? ''}`);

    const startsAt = new Date(sweepNow.getTime() + 45 * 60_000).toISOString();
    const r = await api('calendar/task/create', T.emp1, {
      title: `${TAG} Preference task`, allDay: false, startsAt, visibility: 'personal',
    });
    ok(r); preferenceTaskId = r.body.id; entryIds.push(preferenceTaskId);
    ok(await api('calendar/reminders/set', T.emp1, { id: preferenceTaskId, offsetMinutes: [45] }));
    ok(await serviceSweep(sweepNow.toISOString()));
    const { data: ledger } = await sb.from('calendar_reminder_deliveries').select('id')
      .eq('calendar_entry_id', preferenceTaskId).eq('delivery_kind', 'reminder');
    expect((ledger ?? []).length === 1, 'suppressed reminder is claimed once');
    const { data: notifications } = await sb.from('notifications').select('id')
      .eq('user_id', emp1.id).eq('type', eventType).eq('source_id', preferenceTaskId);
    expect((notifications ?? []).length === 0, 'in-app preference suppresses notification');
  });

  let overdueTaskId = null;
  await test('overdue sweep delivers once and records the shared notification', async () => {
    const r = await api('calendar/task/create', T.emp1, {
      title: `${TAG} Overdue task`, allDay: true, startsOn: dayKey(-2), visibility: 'personal',
    });
    ok(r); overdueTaskId = r.body.id; entryIds.push(overdueTaskId);
    const first = await serviceSweep(sweepNow.toISOString());
    ok(first);
    const { data: ledger } = await sb.from('calendar_reminder_deliveries').select('id')
      .eq('calendar_entry_id', overdueTaskId).eq('delivery_kind', 'overdue');
    expect((ledger ?? []).length === 1, 'one overdue delivery');
    const { data: notifications } = await sb.from('notifications').select('id')
      .eq('user_id', emp1.id).eq('type', 'calendar.task.overdue').eq('source_id', overdueTaskId);
    expect((notifications ?? []).length === 1, 'one overdue notification');
    ok(await serviceSweep(sweepNow.toISOString()));
    const { data: afterRetry } = await sb.from('calendar_reminder_deliveries').select('id')
      .eq('calendar_entry_id', overdueTaskId).eq('delivery_kind', 'overdue');
    expect((afterRetry ?? []).length === 1, 'overdue retry is idempotent');
  });

  // ── Assignment gating ───────────────────────────────────────────────────────
  h.section('Calendar › Assignment gating');

  await test('an employee CANNOT assign a task to another user (403)', async () => {
    const r = await api('calendar/task/create', T.emp1, { title: `${TAG} nope`, startsOn: dayKey(1), assigneeUserId: emp2.id });
    fails(r); expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('an invalid assignee is rejected (400)', async () => {
    const r = await api('calendar/task/create', T.mgr, { title: `${TAG} bad-assignee`, startsOn: dayKey(1), assigneeUserId: 'no-such-user-id' });
    fails(r); expect(r.status === 400, `expected 400, got ${r.status}`);
  });

  await test('a manager CAN assign a task to a team member', async () => {
    const r = await api('calendar/task/create', T.mgr, { title: `${TAG} assigned`, startsOn: dayKey(1), assigneeUserId: emp2.id, priority: 'low' });
    ok(r); entryIds.push(r.body.id);
    const { data: row } = await sb.from('calendar_entries').select('assignee_user_id').eq('id', r.body.id).maybeSingle();
    expect(row && row.assignee_user_id === emp2.id, 'assignee set');
  });

  // ── Recurrence: expansion + per-occurrence cancel / modify ──────────────────
  h.section('Calendar › Recurrence');

  let seriesId = null;
  await test('a daily recurring task expands into the window', async () => {
    const r = await api('calendar/task/create', T.emp1, {
      title: `${TAG} Daily`, allDay: true, startsOn: dayKey(0), priority: 'medium', recurrenceRule: 'FREQ=DAILY',
    });
    ok(r); seriesId = r.body.id; entryIds.push(seriesId);
    const items = (await listItems(T.emp1, dayKey(0), dayKey(3))).filter(i => i.title === `${TAG} Daily`);
    expect(items.length === 4, `4 daily occurrences expected, got ${items.length}`);
    expect(items.every(i => i.occurrenceDate && i.id.includes('::')), 'each occurrence has occurrenceDate + compound id');
  });

  await test('cancelling ONE occurrence drops just that day', async () => {
    ok(await api('calendar/cancel', T.emp1, { id: seriesId, scope: 'occurrence', occurrenceDate: dayKey(1) }));
    const items = (await listItems(T.emp1, dayKey(0), dayKey(3))).filter(i => i.title === `${TAG} Daily`);
    expect(items.length === 3, `3 occurrences after cancel, got ${items.length}`);
    expect(!items.some(i => i.occurrenceDate === dayKey(1)), 'the cancelled day is gone');
  });

  await test('modifying ONE occurrence status overrides just that day', async () => {
    ok(await api('calendar/task/status', T.emp1, { id: seriesId, status: 'done', scope: 'occurrence', occurrenceDate: dayKey(2) }));
    const items = (await listItems(T.emp1, dayKey(0), dayKey(3))).filter(i => i.title === `${TAG} Daily`);
    const day2 = items.find(i => i.occurrenceDate === dayKey(2));
    expect(day2 && day2.status === 'done', 'the modified occurrence is done');
    const day0 = items.find(i => i.occurrenceDate === dayKey(0));
    expect(day0 && day0.status === 'not_started', 'other occurrences unaffected');
  });

  // ── Access control (the negative path) ──────────────────────────────────────
  h.section('Calendar › Access control (deny)');

  let personalId = null;
  await test('a personal task is NOT visible to a non-participant', async () => {
    const r = await api('calendar/task/create', T.emp1, { title: `${TAG} secret`, startsOn: dayKey(2), visibility: 'personal' });
    ok(r); personalId = r.body.id; entryIds.push(personalId);
    const items = await listItems(T.emp2, dayKey(-1), dayKey(10));
    expect(!items.some(i => i.id === personalId), 'emp2 cannot see emp1 personal task');
  });

  await test('a non-owner cannot update or cancel the task (403)', async () => {
    const u = await api('calendar/update', T.emp2, { id: personalId, patch: { title: 'hijack' } });
    fails(u); expect(u.status === 403, `update expected 403, got ${u.status}`);
    const c = await api('calendar/cancel', T.emp2, { id: personalId });
    fails(c); expect(c.status === 403, `cancel expected 403, got ${c.status}`);
  });

  await test('central policy: a MANAGER cannot read or edit someone else\'s PERSONAL task', async () => {
    // get by UUID — calendar.manage must NOT reach a personal item.
    const g = await api('calendar/get', T.mgr, { id: personalId });
    fails(g, 'manager get on a personal task must be refused');
    // update/status via manage must also be refused.
    const u = await api('calendar/update', T.mgr, { id: personalId, patch: { title: 'mgr hijack' } });
    fails(u); expect(u.status === 403, `manager update on personal expected 403, got ${u.status}`);
    const st = await api('calendar/task/status', T.mgr, { id: personalId, status: 'done' });
    fails(st); expect(st.status === 403, `manager status on personal expected 403, got ${st.status}`);
  });

  await test('central policy: a TEAM entry is not readable by UUID for a non-participant', async () => {
    const r = await api('calendar/task/create', T.emp1, { title: `${TAG} team item`, startsOn: dayKey(2), visibility: 'team' });
    ok(r); const teamId = r.body.id; entryIds.push(teamId);
    // Non-participant plain employee: list excludes it AND get by UUID is refused.
    const items = await listItems(T.emp2, dayKey(-1), dayKey(10));
    expect(!items.some(i => i.id === teamId), 'emp2 must not see a team entry in list');
    const g = await api('calendar/get', T.emp2, { id: teamId });
    fails(g, 'team entry must not leak to a non-participant via get-by-UUID');
    // The manager (calendar.manage) DOES see team scope.
    const mgrGet = await api('calendar/get', T.mgr, { id: teamId });
    ok(mgrGet, 'manager should read a team entry');
  });

  await test('central policy: an invited ATTENDEE sees the activity in list + get', async () => {
    const r = await api('calendar/activity/create', T.emp1, {
      title: `${TAG} attendee visibility`, startsOn: dayKey(3), visibility: 'personal',
      attendeeUserIds: [emp2.id],
    });
    ok(r); const actId = r.body.id; entryIds.push(actId);
    const items = await listItems(T.emp2, dayKey(-1), dayKey(10));
    expect(items.some(i => i.id === actId), 'invited attendee must see the activity in list');
    const g = await api('calendar/get', T.emp2, { id: actId });
    ok(g, 'invited attendee must be able to get the activity');
  });

  await test('list range above 366 days is refused (400)', async () => {
    const r = await api('calendar/list', T.emp1, { from: dayKey(0), to: dayKey(400) });
    fails(r); expect(r.status === 400, `expected 400 for oversized range, got ${r.status}`);
  });

  await test('a user DENIED calendar.view is blocked from list (403)', async () => {
    await sb.from('user_permissions').upsert(
      { user_id: emp2.id, permission: 'calendar.view', granted: false, set_by: 'e2e', set_at: new Date().toISOString() },
      { onConflict: 'user_id,permission' });
    overrides.push({ userId: emp2.id, permission: 'calendar.view' });
    const r = await api('calendar/list', T.emp2, { from: dayKey(0), to: dayKey(3) });
    fails(r); expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('an explicit DENY on calendar.task.manage_own blocks editing your OWN task', async () => {
    // FE gate ⇒ BE gate: calendar.view alone must not allow mutations.
    await sb.from('user_permissions').upsert(
      { user_id: emp1.id, permission: 'calendar.task.manage_own', granted: false, set_by: 'e2e', set_at: new Date().toISOString() },
      { onConflict: 'user_id,permission' });
    overrides.push({ userId: emp1.id, permission: 'calendar.task.manage_own' });
    const u = await api('calendar/update', T.emp1, { id: personalId, patch: { title: 'should be blocked' } });
    fails(u); expect(u.status === 403, `denied manage_own update expected 403, got ${u.status}`);
    // Remove the deny so later tests aren't poisoned.
    await sb.from('user_permissions').delete().eq('user_id', emp1.id).eq('permission', 'calendar.task.manage_own');
  });

  // ── Deadline adapters (path runs + shape) ───────────────────────────────────
  h.section('Calendar › Deadlines (adapters)');

  await test('deadline adapters run and return an array (gated by source access)', async () => {
    const r = await api('calendar/list', T.emp1, { from: dayKey(-30), to: dayKey(30), types: ['deadline'] });
    ok(r); expect(Array.isArray(r.body.items), 'items is an array');
    // A plain employee has no finance/onboarding view → finance deadlines must not leak.
    expect(!r.body.items.some(i => i.sourceModule === 'finance'), 'finance deadlines gated out for a plain employee');
  });
}
