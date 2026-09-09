/**
 * scripts/e2e/suites/calendar.mjs
 *
 * Live E2E for the platform Calendar & Tasks module (routes/calendar.ts). Hits the
 * real routes over HTTP and asserts the §2 side-effects (app_events + audit logs)
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

import crypto from 'node:crypto';

export const title = 'Calendar';

const DAY = 86_400_000;
const dayKey = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

export default async function run(h) {
  const { api: request, test, expect, ok, fails, mint, sb, TAG } = h;

  // Actors: two real employees (creator + "other user") and a manager (has assign/manage).
  const { actors: [emp1, emp2], createdIds: idsEmp } = await h.acquireActors('employee', 2, {}, {}, { forceSynthetic: true });
  const { actors: [mgr],        createdIds: idsMgr } = await h.acquireActors('manager', 1, {}, {}, { forceSynthetic: true });
  const createdActorIds = [...idsEmp, ...idsMgr];
  const T = { emp1: mint(emp1), emp2: mint(emp2), mgr: mint(mgr) };
  const { data: defaultCalendars, error: defaultCalendarError } = await sb.from('calendar_collections')
    .select('id,owner_user_id,is_default').in('owner_user_id', [emp1.id, emp2.id, mgr.id]).eq('status', 'active');
  expect(!defaultCalendarError, `default calendars loaded: ${defaultCalendarError?.message}`);
  const defaultCalendarByOwner = new Map((defaultCalendars ?? []).filter(calendar => calendar.is_default).map(calendar => [calendar.owner_user_id, calendar.id]));
  expect(defaultCalendarByOwner.size === 3, 'every synthetic actor received one default calendar');
  const calendarByToken = new Map([[T.emp1, defaultCalendarByOwner.get(emp1.id)], [T.emp2, defaultCalendarByOwner.get(emp2.id)], [T.mgr, defaultCalendarByOwner.get(mgr.id)]]);
  const api = (route, token, args = {}) => request(route, token, (route === 'calendar/task/create' || route === 'calendar/activity/create') && token
    ? { calendarId: calendarByToken.get(token), ...args }
    : args);

  const runStart = new Date().toISOString();
  const entryIds = [];               // every calendar_entries id this run created
  const onboardingCaseIds = [];      // adapter fixtures cascade their onboarding tasks
  const overrides = [];              // { userId, permission } overrides to remove
  const preferenceStates = [];       // preferences changed by this run, restored at cleanup
  const holidayCalendarIds = [];     // published day-context fixtures, purged through the guarded RPC
  const externalConnectionIds = [];  // external-connection fixtures and their cascaded provider calendars
  let departmentId = null;

  h.onCleanup(async () => {
    if (holidayCalendarIds.length) {
      await sb.rpc('work_calendar_purge_tx', { p_work_calendar_ids: null, p_holiday_calendar_ids: holidayCalendarIds });
      await h.mustDelete('app_events', q => q.eq('source_module', 'hr_work_calendar').eq('actor_user_id', mgr.id).gte('created_at', runStart));
      await h.mustDelete('hr_audit_log', q => q.eq('submodule_key', 'hr.work_calendar').eq('actor_id', mgr.id).gte('created_at', runStart));
      await h.mustDelete('work_calendar_command_receipts', q => q.eq('actor_id', mgr.id).gte('created_at', runStart));
    }
    if (entryIds.length) {
      await h.mustDelete('notifications', q => q.eq('module', 'calendar').in('source_id', entryIds).gte('created_at', runStart));
      await h.mustDelete('audit_logs', q => q.in('record_id', entryIds).gte('created_at', runStart));
      await h.mustDelete('calendar_entries', q => q.in('id', entryIds));
      await h.mustDelete('app_events', q => q.eq('source_module', 'calendar').in('source_entity_id', entryIds).gte('created_at', runStart));
      await h.mustDelete('activity_logs', q => q.eq('entity', 'calendar_entry').in('entity_id', entryIds).gte('created_at', runStart));
    }
    if (onboardingCaseIds.length) await h.mustDelete('hr_onboarding_cases', q => q.in('id', onboardingCaseIds));
    for (const state of preferenceStates) {
      if (state.before) await sb.from('notification_preferences').upsert(state.before, { onConflict: 'user_id,event_type' });
      else await h.mustDelete('notification_preferences', q => q.eq('user_id', state.userId).eq('event_type', state.eventType));
    }
    for (const o of overrides)
      await h.mustDelete('user_permissions', q => q.eq('user_id', o.userId).eq('permission', o.permission));
    await h.mustDelete('ui_user_preferences', q => q.in('user_id', [emp1.id, emp2.id]).eq('preference_key', 'calendar.navigator'));
    if (externalConnectionIds.length) {
      const { data: externalRows } = await sb.from('calendar_external_calendars').select('id,calendar_collection_id').in('connection_id', externalConnectionIds);
      const externalIds = (externalRows ?? []).map(row => row.id);
      const importedCollectionIds = (externalRows ?? []).map(row => row.calendar_collection_id).filter(Boolean);
      await h.mustDelete('app_events', q => q.eq('source_module', 'calendar').in('source_entity_id', [...externalConnectionIds, ...externalIds]));
      await h.mustDelete('audit_logs', q => q.in('record_id', [...externalConnectionIds, ...externalIds]));
      await h.mustDelete('calendar_connections', q => q.in('id', externalConnectionIds));
      if (importedCollectionIds.length) await h.mustDelete('calendar_collections', q => q.in('id', importedCollectionIds));
    }
    const { data: ownedCalendars } = await sb.from('calendar_collections').select('id').in('owner_user_id', createdActorIds);
    const ownedCalendarIds = (ownedCalendars ?? []).map(calendar => calendar.id);
    if (ownedCalendarIds.length) {
      await h.mustDelete('app_events', q => q.eq('source_module', 'calendar').eq('source_entity_type', 'calendar_collection').in('source_entity_id', ownedCalendarIds));
      await h.mustDelete('audit_logs', q => q.eq('table_name', 'calendar_collection').in('record_id', ownedCalendarIds));
      await h.mustDelete('calendar_collections', q => q.in('id', ownedCalendarIds));
    }
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
  const platformAuditExists = async (entityId, action) => {
    const { data } = await sb.from('audit_logs').select('id')
      .eq('table_name', 'calendar_collection').eq('record_id', entityId).eq('action', action).gte('created_at', runStart).limit(1);
    return (data ?? []).length > 0;
  };

  h.section('Calendar › Cross-device navigator');

  await test('calendar navigator settings persist through the typed preference API', async () => {
    const value = {
      view: 'agenda', scope: 'mine', zoom: 1.15, showAllDay: false,
      showWeather: true, showHolidays: true, weatherLocation: 'san-fernando',
      titleIconType: 'lucide',
      hiddenSources: ['payroll'], hiddenCategories: ['compliance'], hiddenCalendarIds: [defaultCalendarByOwner.get(emp2.id)], expandedSections: ['navigator'],
    };
    const save = await api('ui-preferences/save', T.emp1, { key: 'calendar.navigator', value });
    ok(save);
    expect(save.body.data.preference.version === 8, 'calendar navigator version returned');
    const get = await api('ui-preferences/get', T.emp1, { key: 'calendar.navigator' });
    ok(get);
    const stored = get.body.data.preference.value;
    expect(
      stored.view === value.view
      && stored.scope === value.scope
      && stored.zoom === value.zoom
      && stored.showAllDay === value.showAllDay
      && stored.showWeather === value.showWeather
      && stored.showHolidays === value.showHolidays
      && stored.weatherLocation === value.weatherLocation
      && stored.titleIconType === value.titleIconType
      && JSON.stringify(stored.hiddenSources) === JSON.stringify(value.hiddenSources)
      && JSON.stringify(stored.hiddenCategories) === JSON.stringify(value.hiddenCategories)
      && JSON.stringify(stored.hiddenCalendarIds) === JSON.stringify(value.hiddenCalendarIds)
      && JSON.stringify(stored.expandedSections) === JSON.stringify(value.expandedSections),
      'navigator preference round-trips exactly',
    );
    const { data: row, error } = await sb.from('ui_user_preferences').select('user_id,preference_key,preference_value').eq('user_id', emp1.id).eq('preference_key', 'calendar.navigator').maybeSingle();
    expect(!error && row?.preference_value?.scope === 'mine', 'navigator preference persisted for the caller');
    const other = await api('ui-preferences/get', T.emp2, { key: 'calendar.navigator' });
    ok(other);
    expect(other.body.data.preference === null, 'another user cannot read the caller preference');
  });

  await test('calendar navigator preference rejects malformed state', async () => {
    const response = await api('ui-preferences/save', T.emp1, { key: 'calendar.navigator', value: { view: 'week' } });
    fails(response);
    expect(response.status === 400, `malformed navigator expected 400, got ${response.status}`);
  });

  await test('day context requires calendar authentication', async () => {
    fails(await api('calendar/day-context', null, { from: dayKey(0), to: dayKey(7), jurisdiction: 'TT' }));
  });

  await test('day context returns a published TT holiday as header metadata, not an event', async () => {
    const holidayDate = dayKey(3);
    const requestKey = () => `${TAG}-${crypto.randomUUID()}`;
    const create = await sb.rpc('holiday_set_command_tx', {
      p_actor_id: mgr.id,
      p_command: 'create_version',
      p_request_key: requestKey(),
      p_payload: {
        reason: 'calendar day-context e2e',
        calendar: { name: `Calendar context ${TAG}`, jurisdiction: 'TT' },
        effectiveFrom: dayKey(-2),
        effectiveTo: dayKey(10),
        timezone: 'America/Port_of_Spain',
      },
    });
    expect(!create.error, `holiday set create: ${create.error?.message}`);
    const calendarId = create.data.calendar.id;
    const versionId = create.data.version.id;
    holidayCalendarIds.push(calendarId);
    const add = await sb.rpc('holiday_set_command_tx', {
      p_actor_id: mgr.id,
      p_command: 'add_holiday',
      p_request_key: requestKey(),
      p_payload: {
        reason: 'calendar day-context e2e', versionId,
        expectedLockVersion: create.data.version.lock_version,
        holiday: {
          holidayDate, dayFraction: 1, nameStatutory: `${TAG} Public Holiday`, nameCommon: `${TAG} Holiday`, holidayType: 'statutory',
          sourceReference: 'E2E verified fixture', sourcePublishedDate: dayKey(-5), provenanceNote: 'Calendar day-context contract fixture',
        },
      },
    });
    expect(!add.error, `holiday add: ${add.error?.message}`);
    const publish = await sb.rpc('holiday_set_command_tx', {
      p_actor_id: mgr.id,
      p_command: 'publish_version',
      p_request_key: requestKey(),
      p_payload: {
        reason: 'calendar day-context e2e', versionId,
        expectedVersionLockVersion: add.data.version.lock_version,
        expectedCalendarLockVersion: create.data.calendar.lock_version,
      },
    });
    expect(!publish.error, `holiday publish: ${publish.error?.message}`);

    const response = await api('calendar/day-context', T.emp1, { from: dayKey(0), to: dayKey(7), jurisdiction: 'TT' });
    ok(response);
    const marker = response.body.holidays.find(item => item.name === `${TAG} Holiday`);
    expect(marker?.date === holidayDate, 'published holiday is returned on its effective date');
    for (const field of ['id', 'date', 'name', 'statutoryName', 'holidayType', 'dayFraction', 'calendarName', 'sourceReference'])
      expect(field in marker, `CalendarHolidayMarkerDTO.${field} present`);
    const items = await listItems(T.emp1, dayKey(0), dayKey(7));
    expect(!items.some(item => item.title === `${TAG} Holiday`), 'holiday metadata is not duplicated into the calendar item list');
  });

  h.section('Calendar › My Calendars');

  let generalCategoryId = null;
  await test('calendar categories require authentication and return persisted preset taxonomy', async () => {
    fails(await api('calendar/categories/list', null, {}));
    const response = await api('calendar/categories/list', T.emp1, {});
    ok(response);
    expect(response.body.categories.length >= 10, 'the system category catalogue is available');
    const general = response.body.categories.find(category => category.key === 'general');
    expect(!!general, 'the general fallback category exists');
    generalCategoryId = general?.id ?? null;
    for (const field of ['id', 'key', 'name', 'iconName', 'scope', 'sortOrder', 'active', 'canManage'])
      expect(field in general, `CalendarCategoryDTO.${field} present`);
  });

  await test('calendar collections require authentication and return the durable container contract', async () => {
    fails(await api('calendar/calendars/list', null, {}));
    const response = await api('calendar/calendars/list', T.emp1, {});
    ok(response);
    const own = response.body.calendars.find(calendar => calendar.id === defaultCalendarByOwner.get(emp1.id));
    expect(!!own, 'default calendar is visible to its owner');
    for (const field of ['id', 'name', 'description', 'ownerUserId', 'ownerName', 'visibility', 'departmentId', 'departmentName', 'colorKey', 'customColor', 'isDefault', 'status', 'canEdit', 'canArchive', 'provider', 'readOnly'])
      expect(field in own, `CalendarCollectionDTO.${field} present`);
    expect(own.isDefault === true && own.canEdit === true, 'default ownership capabilities are server-computed');
  });

  let managedCollectionId = null;
  await test('create calendar is idempotent and atomically records event + platform audit', async () => {
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      idempotencyKey,
      name: `${TAG} Operations Plan`,
      description: 'E2E collection workflow',
      visibility: 'personal',
      colorKey: 'mint',
      customColor: null,
      makeDefault: false,
    };
    const first = await api('calendar/calendars/create', T.emp1, payload);
    ok(first);
    managedCollectionId = first.body.id;
    const replay = await api('calendar/calendars/create', T.emp1, payload);
    ok(replay);
    expect(replay.body.id === managedCollectionId, 'same request returns the original collection');
    const { data: events } = await sb.from('app_events').select('id').eq('event_type', 'calendar.collection.created').eq('source_entity_id', managedCollectionId);
    expect((events ?? []).length === 1, 'idempotent create emitted exactly one app_event');
    expect(await platformAuditExists(managedCollectionId, 'calendar.collection.created'), 'create wrote the platform audit row');
  });

  await test('calendar owner can rename, recolor and make default; another employee cannot', async () => {
    const denied = await api('calendar/calendars/update', T.emp2, {
      id: managedCollectionId, idempotencyKey: crypto.randomUUID(), name: `${TAG} Intrusion`, description: null,
      visibility: 'personal', colorKey: 'coral', customColor: null, makeDefault: false,
    });
    fails(denied);
    expect(denied.status === 403, `non-owner update expected 403, got ${denied.status}`);
    const updated = await api('calendar/calendars/update', T.emp1, {
      id: managedCollectionId, idempotencyKey: crypto.randomUUID(), name: `${TAG} Field Programme`, description: 'Renamed by E2E',
      visibility: 'personal', colorKey: 'amber', customColor: null, makeDefault: true,
    });
    ok(updated);
    const { data: row } = await sb.from('calendar_collections').select('name,color_key,is_default').eq('id', managedCollectionId).maybeSingle();
    expect(row?.name === `${TAG} Field Programme` && row.color_key === 'amber' && row.is_default === true, 'collection settings persisted');
    expect(await appEventExists(managedCollectionId, 'calendar.collection.updated'), 'update emitted app_event');
    expect(await platformAuditExists(managedCollectionId, 'calendar.collection.updated'), 'update wrote platform audit');
  });

  await test('archiving preserves at least one active calendar and promotes a replacement default', async () => {
    const archived = await api('calendar/calendars/archive', T.emp1, { id: managedCollectionId, idempotencyKey: crypto.randomUUID() });
    ok(archived);
    const { data: archivedRow } = await sb.from('calendar_collections').select('status,is_default').eq('id', managedCollectionId).maybeSingle();
    const { data: replacement } = await sb.from('calendar_collections').select('id').eq('owner_user_id', emp1.id).eq('status', 'active').eq('is_default', true).maybeSingle();
    expect(archivedRow?.status === 'archived' && archivedRow.is_default === false, 'calendar archived without deletion');
    expect(!!replacement, 'a remaining active calendar became default');
    expect(await appEventExists(managedCollectionId, 'calendar.collection.archived'), 'archive emitted app_event');
    expect(await platformAuditExists(managedCollectionId, 'calendar.collection.archived'), 'archive wrote platform audit');
  });

  await test('the last active calendar cannot be archived', async () => {
    const onlyActiveId = defaultCalendarByOwner.get(emp1.id);
    const response = await api('calendar/calendars/archive', T.emp1, { id: onlyActiveId, idempotencyKey: crypto.randomUUID() });
    fails(response);
    expect(response.status === 409, `last-calendar archive expected 409, got ${response.status}`);
    const { data: remaining } = await sb.from('calendar_collections').select('status,is_default').eq('id', onlyActiveId).maybeSingle();
    expect(remaining?.status === 'active' && remaining.is_default === true, 'last calendar remains active and default');
  });

  h.section('Calendar › Connected calendars');

  let externalConnectionId = null;
  let externalCalendarId = null;
  let importedCollectionId = null;
  await test('connected calendar list is authenticated and never exposes credentials', async () => {
    fails(await api('calendar/connections/list', null, {}));
    const response = await api('calendar/connections/list', T.emp1, {});
    ok(response);
    expect(response.body.providers.length === 4, 'all four supported providers are described');
    expect(response.body.providers.every(provider => ['oauth', 'credentials'].includes(provider.connectionMethod)), 'provider connection methods returned');
    expect(!JSON.stringify(response.body).includes('credentials_encrypted'), 'encrypted credentials are not exposed');
  });

  await test('provider activation is idempotent and writes one event + audit', async () => {
    const idempotencyKey = `${TAG}-external-connect-${crypto.randomUUID()}`;
    const args = {
      p_actor_id: emp1.id,
      p_provider: 'google',
      p_provider_account_id: `${TAG}-provider-account`,
      p_account_email: `${TAG}@example.com`,
      p_display_name: `${TAG} Google account`,
      p_credentials_encrypted: 'v1:e2e:opaque:fixture',
      p_granted_scopes: ['calendar.readonly'],
      p_provider_metadata: { fixture: true },
      p_calendars: [{ id: `${TAG}-primary`, name: 'Personal', description: 'E2E provider calendar', color: '#4285f4', timeZone: 'America/Port_of_Spain', accessRole: 'owner', isPrimary: true, etag: 'e2e' }],
      p_idempotency_key: idempotencyKey,
    };
    const first = await sb.rpc('calendar_connection_activate_tx', args);
    expect(!first.error && !!first.data?.connectionId, `external activation: ${first.error?.message ?? ''}`);
    externalConnectionId = first.data.connectionId;
    externalConnectionIds.push(externalConnectionId);
    const replay = await sb.rpc('calendar_connection_activate_tx', args);
    expect(!replay.error && replay.data?.connectionId === externalConnectionId && replay.data?.idempotentReplay === true, 'activation retry returns the same connection without replaying side effects');
    const { data: events } = await sb.from('app_events').select('id').eq('event_type', 'calendar.connection.activated').eq('source_entity_id', externalConnectionId);
    const { data: audits } = await sb.from('audit_logs').select('id').eq('action', 'calendar.connection.activated').eq('record_id', externalConnectionId);
    expect((events ?? []).length === 1 && (audits ?? []).length === 1, 'activation wrote exactly one event and one audit row');
    const { data: remote } = await sb.from('calendar_external_calendars').select('id').eq('connection_id', externalConnectionId).eq('is_primary', true).maybeSingle();
    externalCalendarId = remote?.id ?? null;
    expect(!!externalCalendarId, 'provider calendar discovery persisted');
  });

  await test('enabling an imported calendar creates a read-only My Calendars entry', async () => {
    const toggle = await api('calendar/connections/calendar/toggle', T.emp1, { externalCalendarId, enabled: true, colorKey: 'blue', idempotencyKey: crypto.randomUUID() });
    ok(toggle);
    expect(typeof toggle.body.syncWarning === 'string', 'provider sync failure is explicit while the validated calendar remains enabled');
    importedCollectionId = toggle.body.collectionId;
    const listed = await api('calendar/calendars/list', T.emp1, {});
    ok(listed);
    const imported = listed.body.calendars.find(calendar => calendar.id === importedCollectionId);
    expect(imported?.name === 'Personal' && imported.provider === 'google' && imported.readOnly === true, 'provider calendar appears in My Calendars with provider identity');
    expect(imported.canEdit === false && imported.canArchive === false, 'imported collection capabilities are read-only');
    const rejected = await api('calendar/activity/create', T.emp1, { calendarId: importedCollectionId, title: `${TAG} forbidden write`, startsOn: dayKey(1) });
    fails(rejected);
    expect(rejected.status === 403, `writing to an imported calendar expected 403, got ${rejected.status}`);
  });

  await test('disable and disconnect archive the imported calendar and clear credentials', async () => {
    const disabled = await api('calendar/connections/calendar/toggle', T.emp1, { externalCalendarId, enabled: false, idempotencyKey: crypto.randomUUID() });
    ok(disabled);
    const disconnected = await api('calendar/connections/disconnect', T.emp1, { connectionId: externalConnectionId, idempotencyKey: crypto.randomUUID() });
    ok(disconnected);
    const { data: connection } = await sb.from('calendar_connections').select('status,credentials_encrypted').eq('id', externalConnectionId).maybeSingle();
    const { data: collection } = await sb.from('calendar_collections').select('status').eq('id', importedCollectionId).maybeSingle();
    expect(connection?.status === 'disconnected' && connection.credentials_encrypted === null, 'disconnect clears credentials and retires the account');
    expect(collection?.status === 'archived', 'imported My Calendars entry is archived');
    const { data: events } = await sb.from('app_events').select('id').eq('event_type', 'calendar.connection.disconnected').eq('source_entity_id', externalConnectionId);
    const { data: audits } = await sb.from('audit_logs').select('id').eq('action', 'calendar.connection.disconnected').eq('record_id', externalConnectionId);
    expect((events ?? []).length === 1 && (audits ?? []).length === 1, 'disconnect wrote its event and audit row');
  });

  // ── Tasks: create · list contract · update · status lifecycle · cancel ──────
  h.section('Calendar › Tasks');

  let taskId = null;
  await test('task/create → row written + app_event + audit', async () => {
    const r = await api('calendar/task/create', T.emp1, {
      kind: 'task', categoryId: generalCategoryId, title: `${TAG} Forecast`, titleIconType: 'emoji', titleIconValue: '📊', notes: 'Q2', allDay: true, startsOn: dayKey(2), deadlineAt: new Date(`${dayKey(2)}T17:00:00`).toISOString(), priority: 'high', colorKey: 'purple', reminderOffsets: [15],
    });
    ok(r); taskId = r.body.id; expect(!!taskId, 'id returned'); entryIds.push(taskId);
    const { data: row } = await sb.from('calendar_entries').select('type,entry_kind,category_id,status,priority,color_key,title_icon_type,title_icon_value,deadline_at,owner_user_id,calendar_collection_id').eq('id', taskId).maybeSingle();
    expect(row && row.type === 'task' && row.entry_kind === 'task' && row.category_id === generalCategoryId && row.status === 'not_started' && row.priority === 'high' && row.color_key === 'purple', 'task row: persisted kind/category/not_started/high/purple');
    expect(row.title_icon_type === 'emoji' && row.title_icon_value === '📊', 'task title icon persisted as one paired value');
    expect(row.deadline_at?.startsWith(`${dayKey(2)}T`), 'task deadline metadata persisted without changing its schedule kind');
    expect(row.owner_user_id === emp1.id, 'owner = creator');
    expect(row.calendar_collection_id === defaultCalendarByOwner.get(emp1.id), 'task stored in the selected calendar');
    const { data: createdReminders } = await sb.from('calendar_reminders').select('offset_minutes').eq('calendar_entry_id', taskId);
    expect(createdReminders?.length === 1 && createdReminders[0]?.offset_minutes === 15, 'create transaction staged its reminder');
    expect(await appEventExists(taskId, 'calendar.task.created'), 'app_event calendar.task.created');
    expect(await auditExists(taskId, 'calendar_task_create'), 'audit calendar_task_create');
  });

  await test('list returns the CalendarItemDTO contract + computed capabilities', async () => {
    const items = await listItems(T.emp1, dayKey(-1), dayKey(10));
    const it = items.find(i => i.id === taskId);
    expect(!!it, 'created task appears in the window');
    for (const f of ['id', 'type', 'kind', 'categoryId', 'categoryKey', 'categoryName', 'categoryIcon', 'availability', 'origin', 'title', 'titleIconType', 'titleIconValue', 'status', 'priority', 'colorKey', 'customColor', 'locationLabel', 'deadlineAt', 'calendarId', 'calendarName', 'ownerUserId', 'allDay', 'departmentId', 'departmentName', 'sourceDepartment', 'sourceDepartmentLabel', 'editable', 'completable', 'assignable', 'cancelable', 'drillThrough'])
      expect(f in it, `CalendarItemDTO.${f} present`);
    expect(it.type === 'task' && it.origin === 'calendar', 'native task');
    expect(it.kind === 'task' && it.categoryKey === 'general', 'persisted entry kind and category are projected');
    expect(it.sourceDepartment === 'calendar' && it.sourceDepartmentLabel === 'Calendar', 'native task source department');
    expect(it.calendarId === defaultCalendarByOwner.get(emp1.id) && it.calendarName === 'My Calendar', 'native task exposes its calendar container');
    expect(it.editable === true && it.completable === true && it.cancelable === true, 'owner can edit/complete/cancel');
    expect(it.assignable === false, 'employee (no assign perm) cannot assign');
  });

  await test('update changes title, title icon, priority, custom colour, and deadline metadata', async () => {
    const r = await api('calendar/update', T.emp1, { id: taskId, patch: { title: `${TAG} Forecast v2`, titleIconType: 'lucide', titleIconValue: 'ListChecks', priority: 'medium', colorKey: null, customColor: '#2a8f64', deadlineAt: new Date(`${dayKey(3)}T16:30:00`).toISOString() } });
    ok(r);
    const g = await api('calendar/get', T.emp1, { id: taskId });
    ok(g); expect(g.body.item.title === `${TAG} Forecast v2` && g.body.item.titleIconType === 'lucide' && g.body.item.titleIconValue === 'ListChecks' && g.body.item.priority === 'medium' && g.body.item.colorKey === null && g.body.item.customColor === '#2a8f64' && g.body.item.deadlineAt?.startsWith(`${dayKey(3)}T`), 'title + icon + priority + custom colour + deadline updated');
    const { data: row } = await sb.from('calendar_entries').select('color_key,custom_color,title_icon_type,title_icon_value,deadline_at').eq('id', taskId).maybeSingle();
    expect(row?.color_key === null && row?.custom_color === '#2a8f64', 'custom colour persisted without a competing preset');
    expect(row?.title_icon_type === 'lucide' && row?.title_icon_value === 'ListChecks' && row?.deadline_at?.startsWith(`${dayKey(3)}T`), 'title icon and deadline persisted atomically');
    expect(await appEventExists(taskId, 'calendar.entry.updated'), 'update app_event');
  });

  await test('custom colour rejects malformed values at the API boundary', async () => {
    const r = await api('calendar/task/create', T.emp1, {
      title: `${TAG} Invalid colour`, allDay: true, startsOn: dayKey(3), customColor: 'red; background:url(x)',
    });
    fails(r);
    expect(r.status === 400, `invalid custom colour expected 400, got ${r.status}`);
  });

  await test('deadline is metadata on an event or task, never a standalone entry kind', async () => {
    const r = await api('calendar/task/create', T.emp1, {
      kind: 'deadline', categoryId: generalCategoryId, title: `${TAG} Invalid standalone deadline`, allDay: true, startsOn: dayKey(5), visibility: 'personal',
    });
    fails(r);
    expect(r.status === 400, `standalone deadline expected 400, got ${r.status}`);
  });

  await test('title icons reject unpaired or unrecognised values', async () => {
    const missingValue = await api('calendar/task/create', T.emp1, {
      title: `${TAG} Missing icon value`, titleIconType: 'emoji', allDay: true, startsOn: dayKey(5),
    });
    fails(missingValue); expect(missingValue.status === 400, 'unpaired title icon rejected');
    const unknownLucide = await api('calendar/task/create', T.emp1, {
      title: `${TAG} Unknown icon`, titleIconType: 'lucide', titleIconValue: 'NotARealCalendarIcon', allDay: true, startsOn: dayKey(5),
    });
    fails(unknownLucide); expect(unknownLucide.status === 400, 'unrecognised Lucide title icon rejected');
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
  await test('setup: existing department available for department-scoped calendar entries', async () => {
    const { data, error } = await sb.from('departments').select('id').order('name').limit(1).maybeSingle();
    expect(!error && !!data?.id, `department fixture: ${error?.message ?? ''}`);
    departmentId = data?.id ?? null;
    if (departmentId) {
      const { error: assignmentError } = await sb.from('app_users').update({ department_id: departmentId }).eq('id', emp2.id);
      expect(!assignmentError, `department member fixture: ${assignmentError?.message ?? ''}`);
    }
  });

  await test('activity/create with an attendee → row + attendee + app_event', async () => {
    const r = await api('calendar/activity/create', T.emp1, {
      kind: 'event', categoryId: generalCategoryId, title: `${TAG} Team Event`, allDay: false,
      startsAt: `${dayKey(1)}T10:00:00`, endsAt: `${dayKey(1)}T11:00:00`,
      visibility: 'personal', attendeeUserIds: [emp2.id], colorKey: 'mint', locationLabel: 'Operations Room 2', reminderOffsets: [30],
    });
    ok(r); activityId = r.body.id; entryIds.push(activityId);
    const { data: row } = await sb.from('calendar_entries').select('type,entry_kind,category_id,status,priority,color_key,location_label,all_day').eq('id', activityId).maybeSingle();
    expect(row && row.type === 'activity' && row.entry_kind === 'event' && row.category_id === generalCategoryId && row.status === null && row.priority === null && row.color_key === 'mint' && row.location_label === 'Operations Room 2' && row.all_day === false, 'event: kind/category, no status/priority, timed, visual metadata persisted');
    const { data: att } = await sb.from('calendar_activity_attendees').select('user_id').eq('calendar_entry_id', activityId);
    expect((att ?? []).some(a => a.user_id === emp2.id), 'attendee row written');
    expect(await appEventExists(activityId, 'calendar.activity.created'), 'app_event calendar.activity.created');
  });

  await test('standalone reminder is an activity-family kind without a fabricated end time', async () => {
    const r = await api('calendar/activity/create', T.emp1, {
      kind: 'reminder', categoryId: generalCategoryId, title: `${TAG} Standalone reminder`, allDay: false,
      startsAt: `${dayKey(3)}T15:00:00`, visibility: 'personal', availability: 'free', reminderOffsets: [0],
    });
    ok(r); entryIds.push(r.body.id);
    const { data: row } = await sb.from('calendar_entries').select('type,entry_kind,availability,starts_at,ends_at').eq('id', r.body.id).maybeSingle();
    expect(row?.type === 'activity' && row.entry_kind === 'reminder' && row.availability === 'free' && !!row.starts_at && row.ends_at === null, 'standalone reminder persists as a point-in-time item');
    const { data: reminderRows } = await sb.from('calendar_reminders').select('offset_minutes').eq('calendar_entry_id', r.body.id);
    expect(reminderRows?.length === 1 && reminderRows[0]?.offset_minutes === 0, 'standalone reminder delivery timing is created with the item');
  });

  await test('a multi-day activity is one record returned in every intersected calendar window', async () => {
    const r = await api('calendar/activity/create', T.emp1, {
      title: `${TAG} Multi-day mobilisation`, allDay: false,
      startsAt: `${dayKey(6)}T22:00:00`, endsAt: `${dayKey(8)}T02:00:00`,
      visibility: 'personal', colorKey: 'amber',
    });
    ok(r);
    const multiDayId = r.body.id;
    entryIds.push(multiDayId);
    const middleDay = await listItems(T.emp1, dayKey(7), dayKey(7), { types: ['activity'] });
    const projected = middleDay.filter(item => item.id === multiDayId);
    expect(projected.length === 1, 'the intersecting day returns one projection of the same record');
    expect(projected[0]?.startsAt?.startsWith(dayKey(6)) && projected[0]?.endsAt?.startsWith(dayKey(8)), 'the complete multi-day schedule is preserved');
    expect(await appEventExists(multiDayId, 'calendar.activity.created'), 'multi-day create app_event');
    expect(await auditExists(multiDayId, 'calendar_activity_create'), 'multi-day create audit');
  });

  await test('department-scoped activity persists department and returns hydrated department fields', async () => {
    if (!departmentId) return;
    const r = await api('calendar/activity/create', T.mgr, {
      title: `${TAG} Department town hall`, startsOn: dayKey(4), visibility: 'team', departmentId,
    });
    ok(r);
    const departmentActivityId = r.body.id;
    entryIds.push(departmentActivityId);
    const { data: row } = await sb.from('calendar_entries').select('department_id').eq('id', departmentActivityId).maybeSingle();
    expect(row?.department_id === departmentId, 'department_id persisted');
    const items = await listItems(T.mgr, dayKey(3), dayKey(5), { types: ['activity'] });
    const projected = items.find(i => i.id === departmentActivityId);
    expect(projected?.departmentId === departmentId && !!projected?.departmentName, 'department fields returned');
    const memberItems = await listItems(T.emp2, dayKey(3), dayKey(5), { types: ['activity'] });
    expect(memberItems.some(i => i.id === departmentActivityId), 'department member sees the scoped entry in list');
    const memberGet = await api('calendar/get', T.emp2, { id: departmentActivityId });
    ok(memberGet, 'department member can open the same entry returned by list');
  });

  await test('ACCESS: employee cannot create department-scoped calendar entries', async () => {
    if (!departmentId) return;
    const r = await api('calendar/activity/create', T.emp1, {
      title: `${TAG} blocked department activity`, startsOn: dayKey(5), visibility: 'team', departmentId,
    });
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('get returns attendee response contract to the invited user', async () => {
    const g = await api('calendar/get', T.emp2, { id: activityId });
    ok(g);
    expect(g.body.item.type === 'activity' && g.body.item.attendeeCount === 1 && g.body.item.colorKey === 'mint' && g.body.item.locationLabel === 'Operations Room 2', 'attendeeCount and visual metadata contract');
    const attendee = (g.body.attendees ?? []).find(a => a.userId === emp2.id);
    expect(attendee && attendee.responseStatus === 'invited' && attendee.respondedAt === null, 'camelCase invitation contract');
  });

  await test('update replaces event invitees and records participant notifications', async () => {
    ok(await api('calendar/update', T.emp1, { id: activityId, patch: { attendeeUserIds: [emp2.id, mgr.id] } }));
    const { data: afterAdd } = await sb.from('calendar_activity_attendees').select('user_id').eq('calendar_entry_id', activityId);
    expect((afterAdd ?? []).some(row => row.user_id === mgr.id), 'new invitee persisted');
    const { data: addedNotification } = await sb.from('notifications').select('id')
      .eq('user_id', mgr.id).eq('type', 'calendar.activity.participants_updated').eq('source_id', activityId).maybeSingle();
    expect(!!addedNotification, 'new invitee received a participant update notification');

    ok(await api('calendar/update', T.emp1, { id: activityId, patch: { attendeeUserIds: [emp2.id] } }));
    const { data: afterRemove } = await sb.from('calendar_activity_attendees').select('user_id').eq('calendar_entry_id', activityId);
    expect(!(afterRemove ?? []).some(row => row.user_id === mgr.id), 'removed invitee no longer has an attendee row');
    expect((afterRemove ?? []).some(row => row.user_id === emp2.id), 'unchanged invitee and response record are preserved');
    expect(await appEventExists(activityId, 'calendar.activity.participants_updated'), 'participant update app_event');
    expect(await auditExists(activityId, 'calendar_update'), 'participant update audit');
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

  await test('central policy: TEAM visibility requires a real department and follows membership', async () => {
    const missingDepartment = await api('calendar/task/create', T.emp1, { title: `${TAG} invalid team item`, startsOn: dayKey(2), visibility: 'team' });
    fails(missingDepartment); expect(missingDepartment.status === 400, 'team visibility cannot exist without a department');
    if (!departmentId) return;
    const r = await api('calendar/task/create', T.mgr, { title: `${TAG} team item`, startsOn: dayKey(2), visibility: 'team', departmentId });
    ok(r); const teamId = r.body.id; entryIds.push(teamId);
    ok(await api('calendar/update', T.mgr, { id: teamId, patch: { visibility: 'personal' } }), 'owner can make the item personal');
    const missingDepartmentUpdate = await api('calendar/update', T.mgr, { id: teamId, patch: { visibility: 'team' } });
    fails(missingDepartmentUpdate); expect(missingDepartmentUpdate.status === 400, 'editing to team visibility also requires a department');
    ok(await api('calendar/update', T.mgr, { id: teamId, patch: { visibility: 'team', departmentId } }), 'owner can restore valid department visibility');
    const memberItems = await listItems(T.emp2, dayKey(-1), dayKey(10));
    expect(memberItems.some(i => i.id === teamId), 'department member sees the team entry in list');
    ok(await api('calendar/get', T.emp2, { id: teamId }), 'department member can open the team entry');
    const outsiderItems = await listItems(T.emp1, dayKey(-1), dayKey(10));
    expect(!outsiderItems.some(i => i.id === teamId), 'non-member does not see the team entry in list');
    const outsiderGet = await api('calendar/get', T.emp1, { id: teamId });
    fails(outsiderGet, 'team entry does not leak to a non-member by UUID');
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

  await test('onboarding deadline projects its source priority without leaking it from other sources', async () => {
    await sb.from('user_permissions').upsert(
      { user_id: mgr.id, permission: 'hr.onboarding.view', granted: true, set_by: 'e2e', set_at: new Date().toISOString() },
      { onConflict: 'user_id,permission' },
    );
    overrides.push({ userId: mgr.id, permission: 'hr.onboarding.view' });
    const { data: kase, error: caseError } = await sb.from('hr_onboarding_cases').insert({
      case_no: `${TAG}-CAL-ONB`, employee_id: emp1.id, package_key: 'e2e', status: 'open', owner_id: mgr.id, started_by: mgr.id,
    }).select('id').single();
    expect(!caseError && !!kase?.id, `onboarding case fixture: ${caseError?.message ?? ''}`);
    if (!kase?.id) return;
    onboardingCaseIds.push(kase.id);
    const { data: task, error: taskError } = await sb.from('hr_onboarding_tasks').insert({
      case_id: kase.id, task_key: `${TAG}-calendar-priority`, task_title: `${TAG} Critical onboarding task`, status: 'pending',
      priority: 'critical', due_at: `${dayKey(4)}T09:00:00Z`, assigned_to: emp1.id, module_key: 'payroll', owner_role: 'payroll',
    }).select('id').single();
    expect(!taskError && !!task?.id, `onboarding task fixture: ${taskError?.message ?? ''}`);
    if (!task?.id) return;
    const items = await listItems(T.mgr, dayKey(3), dayKey(5), { types: ['deadline'], sourceModules: ['hr'] });
    const projected = items.find(i => i.id === `hr_onboarding:${task.id}`);
    expect(projected?.sourceModule === 'hr' && projected?.sourcePriority === 'critical', 'onboarding priority projects exactly');
    expect(projected?.sourceDepartment === 'payroll' && projected?.sourceDepartmentLabel === 'Payroll', 'onboarding department projects exactly');
    expect(projected?.priority === null, 'projected source priority stays separate from native task priority');
  });
}
