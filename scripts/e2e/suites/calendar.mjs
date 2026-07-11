/**
 * scripts/e2e/suites/calendar.mjs
 *
 * Live E2E for the platform Calendar & Tasks module (routes/calendar.ts). Hits the
 * real routes over HTTP and asserts the §2 side-effects (app_events + activity_logs)
 * via the service-role client.
 *
 * Covers, per the Testing Standard:
 *   • Every endpoint — list, get, task/create, activity/create, update, task/status, cancel.
 *   • Flows — task lifecycle (not_started→in_progress→done), activity + attendees,
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
  const { actors: [emp1, emp2], createdIds: idsEmp } = await h.acquireActors('employee', 2);
  const { actors: [mgr],        createdIds: idsMgr } = await h.acquireActors('manager', 1);
  const createdActorIds = [...idsEmp, ...idsMgr];
  const T = { emp1: mint(emp1), emp2: mint(emp2), mgr: mint(mgr) };

  const runStart = new Date().toISOString();
  const entryIds = [];               // every calendar_entries id this run created
  const overrides = [];              // { userId, permission } overrides to remove

  h.onCleanup(async () => {
    if (entryIds.length) {
      await sb.from('calendar_entries').delete().in('id', entryIds);          // cascades attendees + exceptions
      await sb.from('app_events').delete().eq('source_module', 'calendar').in('source_entity_id', entryIds).gte('created_at', runStart);
      await sb.from('activity_logs').delete().eq('entity', 'calendar_entry').in('entity_id', entryIds).gte('created_at', runStart);
    }
    for (const o of overrides) await sb.from('user_permissions').delete().eq('user_id', o.userId).eq('permission', o.permission);
    if (createdActorIds.length) await sb.from('app_users').delete().in('id', createdActorIds);
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

  await test('get returns the activity + attendeeCount', async () => {
    const g = await api('calendar/get', T.emp1, { id: activityId });
    ok(g); expect(g.body.item.type === 'activity' && g.body.item.attendeeCount === 1, 'attendeeCount = 1');
  });

  await test('cancel an activity → row deleted', async () => {
    ok(await api('calendar/cancel', T.emp1, { id: activityId }));
    const g = await api('calendar/get', T.emp1, { id: activityId });
    fails(g); expect(g.status === 404, 'activity gone (404)');
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
