/** Live contract coverage for the Meetings list/get/create vertical slice. */
export const title = 'Meetings (List · Detail · Atomic Create)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };
  const ctx = { meetingIds: [], calendarIds: [], threadIds: [], refs: [], inactiveUserIds: [] };

  h.onCleanup(async () => {
    if (ctx.meetingIds.length) {
      await sb.from('notifications').delete().in('source_id', ctx.meetingIds);
      await sb.from('record_links').delete().eq('source_module', 'meetings').in('source_record_id', ctx.meetingIds);
      await sb.from('audit_logs').delete().eq('table_name', 'meetings').in('record_id', ctx.meetingIds);
      await sb.from('app_events').delete().eq('source_module', 'meetings').in('source_entity_id', ctx.meetingIds);
      await sb.from('meetings').delete().in('id', ctx.meetingIds); // meeting children + receipts cascade
    }
    if (ctx.threadIds.length) {
      await sb.from('message_event_outbox').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_posts').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_participants').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_threads').delete().in('id', ctx.threadIds);
    }
    if (ctx.calendarIds.length) {
      await sb.from('calendar_activity_attendees').delete().in('calendar_entry_id', ctx.calendarIds);
      await sb.from('calendar_entries').delete().in('id', ctx.calendarIds);
    }
    if (ctx.inactiveUserIds.length) await sb.from('app_users').delete().in('id', ctx.inactiveUserIds);
  });

  const startsAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
  const key = `meetings-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const createArgs = {
    idempotencyKey: key,
    title: `${TAG} Operations review`,
    description: 'Live E2E atomic Meetings contract.',
    schedule: { allDay: false, startsAt, endsAt, visibility: 'personal' },
    participants: [{ userId: admin.id, role: 'presenter', required: true }],
    agendaItems: [{ title: 'Readiness review', description: 'Confirm access and permits.', ownerUserId: admin.id, plannedMinutes: 20 }],
    provider: 'external', joinUrl: 'https://meet.example.test/e2e',
    confidentiality: 'internal', recordingPolicy: 'optional', transcriptPolicy: 'manual',
  };

  h.section('Meetings › Authentication and validation');
  await test('list requires authentication', async () => fails(await api('meetings/list', null, {})));
  await test('get requires authentication', async () => fails(await api('meetings/get', null, { meetingId: crypto.randomUUID() })));
  await test('create requires authentication', async () => fails(await api('meetings/create', null, createArgs)));
  await test('create rejects invalid timed schedule', async () => {
    const r = await api('meetings/create', T.admin, { ...createArgs, idempotencyKey: `${key}-bad-time`, schedule: { allDay: false, visibility: 'personal' } });
    fails(r); expect(r.status === 400, `expected 400, got ${r.status}`);
  });
  await test('create rejects duplicate participants before mutation', async () => {
    const r = await api('meetings/create', T.admin, { ...createArgs, idempotencyKey: `${key}-dupe`, participants: [{ userId: b.id }, { userId: b.id }] });
    fails(r); expect(r.status === 400, `expected 400, got ${r.status}`);
    const { count } = await sb.from('meetings').select('id', { count: 'exact', head: true }).eq('title', createArgs.title);
    expect((count ?? 0) === 0, 'duplicate request wrote a meeting');
  });

  const acquired = await h.acquireActors('employee', 1, {}, {}, { forceSynthetic: true });
  const inactive = acquired.actors[0];
  ctx.inactiveUserIds.push(...acquired.createdIds);
  await sb.from('app_users').update({ status: 'inactive' }).eq('id', inactive.id);
  await test('create rejects inactive participants atomically', async () => {
    const r = await api('meetings/create', T.admin, { ...createArgs, idempotencyKey: `${key}-inactive`, participants: [{ userId: inactive.id }] });
    fails(r); expect(r.status === 400, `expected 400, got ${r.status}`);
    const { count } = await sb.from('calendar_entries').select('id', { count: 'exact', head: true }).eq('title', createArgs.title);
    expect((count ?? 0) === 0, 'inactive participant failure stranded a Calendar row');
  });

  h.section('Meetings › Atomic create and response contract');
  let created;
  await test('employee permission permits a participant-capable create', async () => {
    const r = await api('meetings/create', T.b, createArgs);
    ok(r); expect(r.status === 201, `expected 201, got ${r.status}`);
    created = r.body.data;
    ctx.meetingIds.push(created.id); ctx.calendarIds.push(created.schedule.calendarEntryId);
    ctx.threadIds.push(created.discussionThreadId); ctx.refs.push(created.reference);
  });
  await test('create returns the exact frontend aggregate shape', async () => {
    for (const keyName of ['id','reference','title','description','status','confidentiality','recordingPolicy','transcriptPolicy','retentionStatus','retentionUntil','organizer','schedule','provider','discussionThreadId','participants','labels','recordLinks','agendaItems','sessions','currentSession','publishedSummary','join','createdAt','updatedAt','version','capabilities']) {
      expect(Object.hasOwn(created, keyName), `missing ${keyName}`);
    }
    expect(created.title === createArgs.title, 'title mismatch');
    expect(created.organizer.userId === b.id, 'organizer mismatch');
    expect(created.participants.length === 2, 'organizer + invitee not returned');
    expect(created.participants.some(p => p.person.userId === admin.id && p.role === 'presenter'), 'invitee projection mismatch');
    expect(Date.parse(created.schedule.startsAt) === Date.parse(startsAt) && Date.parse(created.schedule.endsAt) === Date.parse(endsAt), 'Calendar schedule mismatch');
    expect(created.currentSession?.status === 'scheduled', 'initial session missing');
    expect(created.agendaItems.length === 1 && created.agendaItems[0].title === 'Readiness review' && created.agendaItems[0].owner?.userId === admin.id, 'agenda projection mismatch');
    expect(typeof created.capabilities.edit === 'boolean' && created.capabilities.manageParticipants === true, 'capabilities malformed');
  });
  await test('business, Calendar, Communications, and session rows commit together', async () => {
    const [m, cal, attendees, thread, parts, posts, sessions, agenda] = await Promise.all([
      sb.from('meetings').select('calendar_entry_id,discussion_thread_id,version').eq('id', created.id).single(),
      sb.from('calendar_entries').select('type,source_module,source_ref').eq('id', created.schedule.calendarEntryId).single(),
      sb.from('calendar_activity_attendees').select('user_id,response_status').eq('calendar_entry_id', created.schedule.calendarEntryId),
      sb.from('message_threads').select('thread_type,source_module,source_entity_id').eq('id', created.discussionThreadId).single(),
      sb.from('message_participants').select('user_id,role').eq('thread_id', created.discussionThreadId),
      sb.from('message_posts').select('is_system,post_type,system_event_type').eq('thread_id', created.discussionThreadId),
      sb.from('meeting_sessions').select('status,occurrence_key').eq('meeting_id', created.id),
      sb.from('meeting_agenda_items').select('sequence,title,planned_minutes').eq('meeting_id', created.id).order('sequence'),
    ]);
    expect(!m.error && m.data.version === 1, 'meeting row missing');
    expect(cal.data?.type === 'activity' && cal.data.source_module === 'meetings', 'Calendar activity linkage missing');
    expect((attendees.data ?? []).length === 2, 'Calendar attendees incomplete');
    expect(thread.data?.thread_type === 'record' && thread.data.source_entity_id === created.id, 'record thread linkage missing');
    expect((parts.data ?? []).length === 2, 'Communications participants incomplete');
    expect((posts.data ?? []).some(p => p.is_system && p.post_type === 'system_event' && p.system_event_type === 'thread_created'), 'system post missing');
    expect((sessions.data ?? []).length === 1, 'initial session missing');
    expect((agenda.data ?? []).length === 1 && agenda.data[0].sequence === 0 && agenda.data[0].planned_minutes === 20, 'agenda rows were not committed atomically');
  });
  await test('Calendar read model links the meeting card back to Meetings', async () => {
    const date = startsAt.slice(0, 10);
    const response = await api('calendar/list', T.b, { from: date, to: date });
    ok(response);
    const item = (response.body.items ?? []).find(candidate => candidate.id === created.schedule.calendarEntryId);
    expect(item?.sourceModule === 'meetings', 'meeting Calendar projection source missing');
    expect(item?.sourceLabel === 'Meeting' && item?.sourceRoute === 's-meetings' && item?.drillThrough === true, 'meeting Calendar projection cannot open its source workspace');
    expect(item?.editable === false && item?.cancelable === false, 'source-controlled meeting schedule exposed unsafe Calendar mutations');
  });
  await test('Calendar rejects direct mutation of a meeting-owned schedule', async () => {
    const update = await api('calendar/update', T.b, { id: created.schedule.calendarEntryId, patch: { title: 'must not diverge' } });
    const cancel = await api('calendar/cancel', T.b, { id: created.schedule.calendarEntryId });
    fails(update); fails(cancel);
    expect(update.status === 409 && cancel.status === 409, 'Calendar did not enforce source ownership');
    const { data } = await sb.from('calendar_entries').select('title').eq('id', created.schedule.calendarEntryId).single();
    expect(data?.title === createArgs.title, 'rejected Calendar mutation changed the meeting schedule');
  });
  await test('required event, audit, notification, and durable outbox side-effects exist', async () => {
    const [events, audits, notifications, outbox] = await Promise.all([
      sb.from('app_events').select('id,dedupe_key').eq('source_module','meetings').eq('source_entity_id',created.id),
      sb.from('audit_logs').select('id').eq('table_name','meetings').eq('record_id',created.id),
      sb.from('notifications').select('user_id,type,action_route').eq('source_id',created.id),
      sb.from('message_event_outbox').select('event_type,status').eq('thread_id',created.discussionThreadId),
    ]);
    expect((events.data ?? []).length === 1, 'meeting event missing or duplicated');
    expect((audits.data ?? []).length === 1, 'meeting audit missing');
    expect((notifications.data ?? []).some(n => n.user_id === admin.id && n.type === 'meeting_invitation' && n.action_route === 's-meetings'), 'invitee notification missing');
    expect((outbox.data ?? []).some(o => o.event_type === 'thread.created'), 'Communications outbox row missing');
  });

  h.section('Meetings › Commands and synchronization');
  let version = created.version;
  await test('update reschedules Calendar and bumps the optimistic version', async () => {
    const shiftedStart = new Date(Date.parse(startsAt) + 7200000).toISOString();
    const shiftedEnd = new Date(Date.parse(endsAt) + 7200000).toISOString();
    const r = await api('meetings/update', T.b, { meetingId:created.id, expectedVersion:version, idempotencyKey:`${key}-update`, patch:{ title:`${TAG} Updated review`, schedule:{allDay:false,startsAt:shiftedStart,endsAt:shiftedEnd,visibility:'personal'} } });
    ok(r); version=r.body.data.version; expect(version===2,'update did not bump version');
    const {data:cal}=await sb.from('calendar_entries').select('title,starts_at,ends_at').eq('id',created.schedule.calendarEntryId).single();
    expect(cal?.title===`${TAG} Updated review` && Date.parse(cal.starts_at)===Date.parse(shiftedStart) && Date.parse(cal.ends_at)===Date.parse(shiftedEnd),'Calendar was not synchronized');
  });
  await test('stale update is rejected without mutation', async () => {
    const r=await api('meetings/update',T.b,{meetingId:created.id,expectedVersion:1,idempotencyKey:`${key}-stale`,patch:{title:'must not persist'}});
    fails(r); expect(r.status===409,`expected 409, got ${r.status}`);
  });
  await test('non-owner cannot update', async () => {
    const r=await api('meetings/update',T.c,{meetingId:created.id,expectedVersion:version,idempotencyKey:`${key}-denied`,patch:{title:'denied'}});
    fails(r); expect(r.status===404 || r.status===403,'non-owner update was not denied');
  });
  await test('agenda update replaces and reorders topics with versioned side effects', async () => {
    const existing = created.agendaItems[0];
    const r=await api('meetings/agenda/update',T.b,{meetingId:created.id,expectedVersion:version,idempotencyKey:`${key}-agenda`,items:[
      {sequence:0,title:'Decision and owners',description:'Agree accountable owners.',status:'open',plannedMinutes:15},
      {id:existing.id,sequence:1,title:'Readiness review',description:'Updated scope.',ownerUserId:admin.id,status:'covered',plannedMinutes:10},
    ]});
    ok(r); version=r.body.data.version; expect(version===3,'agenda update did not bump version');
    expect(r.body.data.items.length===2&&r.body.data.items[0].title==='Decision and owners'&&r.body.data.items[1].status==='covered','agenda response order or status mismatch');
    const [events,audits,posts]=await Promise.all([
      sb.from('app_events').select('id').eq('source_entity_id',created.id).eq('event_type','meetings.agenda.updated'),
      sb.from('audit_logs').select('id').eq('record_id',created.id).eq('action','meetings.agenda.updated'),
      sb.from('message_posts').select('id').eq('thread_id',created.discussionThreadId).eq('system_event_type','meetings.agenda.updated'),
    ]);
    expect((events.data??[]).length===1&&(audits.data??[]).length===1&&(posts.data??[]).length===1,'agenda side effects incomplete');
  });
  await test('non-owner cannot manage agenda', async () => {
    const r=await api('meetings/agenda/update',T.c,{meetingId:created.id,expectedVersion:version,idempotencyKey:`${key}-agenda-denied`,items:[]});
    fails(r); expect(r.status===403||r.status===404,'non-owner agenda update was not denied');
  });
  await test('stale agenda update is rejected without mutation', async () => {
    const r=await api('meetings/agenda/update',T.b,{meetingId:created.id,expectedVersion:1,idempotencyKey:`${key}-agenda-stale`,items:[]});
    fails(r); expect(r.status===409,'stale agenda update was not rejected');
  });
  await test('invite synchronizes Meeting, Calendar, Communications and notification', async () => {
    const r=await api('meetings/participants/invite',T.b,{meetingId:created.id,expectedVersion:version,idempotencyKey:`${key}-invite`,participants:[{userId:c.id,role:'observer',required:false}]});
    ok(r); version=r.body.data.version; expect(r.body.data.participants.some(p=>p.person.userId===c.id),'invitee missing from response');
    const [calPart,msgPart,notif]=await Promise.all([
      sb.from('calendar_activity_attendees').select('id').eq('calendar_entry_id',created.schedule.calendarEntryId).eq('user_id',c.id),
      sb.from('message_participants').select('removed_at').eq('thread_id',created.discussionThreadId).eq('user_id',c.id),
      sb.from('notifications').select('id').eq('source_id',created.id).eq('user_id',c.id),
    ]);
    expect((calPart.data??[]).length===1 && (msgPart.data??[]).some(p=>p.removed_at===null),'participant projections not synchronized');
    expect((notif.data??[]).length>=1,'invite notification missing');
  });
  await test('invite optimistic conflict is rejected', async () => {
    const r=await api('meetings/participants/invite',T.b,{meetingId:created.id,expectedVersion:1,idempotencyKey:`${key}-invite-stale`,participants:[{userId:c.id}]});
    fails(r); expect(r.status===409,'stale invite not rejected');
  });
  await test('remove synchronizes Meeting, Calendar and Communications', async () => {
    const r=await api('meetings/participants/remove',T.b,{meetingId:created.id,expectedVersion:version,idempotencyKey:`${key}-remove`,userId:c.id,reason:'E2E removal'});
    ok(r); version=r.body.data.version; expect(!r.body.data.participants.some(p=>p.person.userId===c.id),'removed participant returned active');
    const [{data:mp},{data:cp}]=await Promise.all([
      sb.from('meeting_participants').select('removed_at').eq('meeting_id',created.id).eq('user_id',c.id).single(),
      sb.from('message_participants').select('removed_at').eq('thread_id',created.discussionThreadId).eq('user_id',c.id).single(),
    ]);
    expect(Boolean(mp?.removed_at)&&Boolean(cp?.removed_at),'soft removal was not synchronized');
  });
  await test('participant RSVP updates Calendar and meeting version', async () => {
    const r=await api('meetings/rsvp',T.admin,{meetingId:created.id,expectedVersion:version,idempotencyKey:`${key}-rsvp`,responseStatus:'accepted'});
    ok(r); version=r.body.data.version; expect(r.body.data.responseStatus==='accepted','RSVP response mismatch');
    const {data}=await sb.from('calendar_activity_attendees').select('response_status,responded_at').eq('calendar_entry_id',created.schedule.calendarEntryId).eq('user_id',admin.id).single();
    expect(data?.response_status==='accepted'&&Boolean(data.responded_at),'Calendar RSVP not synchronized');
  });
  let liveSession;
  await test('session start transitions session and meeting atomically', async () => {
    const r=await api('meetings/sessions/start',T.b,{meetingId:created.id,occurrenceKey:'master',idempotencyKey:`${key}-start`});
    ok(r); liveSession=r.body.data; expect(liveSession.status==='live'&&Boolean(liveSession.startedAt),'session did not start');
  });
  await test('participant cannot end organizer session', async () => {
    const r=await api('meetings/sessions/end',T.admin,{meetingId:created.id,sessionId:liveSession.id,expectedStatus:'live',idempotencyKey:`${key}-end-denied`});
    fails(r); expect(r.status===403||r.status===404,'participant ended organizer session');
  });
  await test('session end completes session and meeting', async () => {
    const r=await api('meetings/sessions/end',T.b,{meetingId:created.id,sessionId:liveSession.id,expectedStatus:'live',idempotencyKey:`${key}-end`});
    ok(r); expect(r.body.data.status==='completed'&&Boolean(r.body.data.endedAt),'session did not complete');
    const {data:m}=await sb.from('meetings').select('status,version').eq('id',created.id).single(); expect(m?.status==='completed','meeting not completed'); version=Number(m.version);
  });
  await test('archive completes lifecycle and archives Communications thread', async () => {
    const r=await api('meetings/archive',T.b,{meetingId:created.id,expectedVersion:version,idempotencyKey:`${key}-archive`}); ok(r);
    const {data:thread}=await sb.from('message_threads').select('archived_at').eq('id',created.discussionThreadId).single(); expect(Boolean(thread?.archived_at),'thread not archived');
  });
  await test('cancel transitions a separate scheduled meeting and cancels its session', async () => {
    const create=await api('meetings/create',T.b,{...createArgs,idempotencyKey:`${key}-cancel-create`,title:`${TAG} Cancel target`}); ok(create);
    const target=create.body.data; ctx.meetingIds.push(target.id);ctx.calendarIds.push(target.schedule.calendarEntryId);ctx.threadIds.push(target.discussionThreadId);
    const r=await api('meetings/cancel',T.b,{meetingId:target.id,expectedVersion:target.version,idempotencyKey:`${key}-cancel`,reason:'E2E cancellation'}); ok(r);
    const {data:sessions}=await sb.from('meeting_sessions').select('status').eq('meeting_id',target.id); expect((sessions??[]).every(s=>s.status==='cancelled'),'sessions not cancelled');
  });
  await test('every lifecycle command left event, audit, notification and outbox evidence', async () => {
    const [events,audits,outbox,notifications]=await Promise.all([
      sb.from('app_events').select('event_type').eq('source_module','meetings').eq('source_entity_id',created.id),
      sb.from('audit_logs').select('action').eq('table_name','meetings').eq('record_id',created.id),
      sb.from('message_event_outbox').select('payload').eq('thread_id',created.discussionThreadId),
      sb.from('notifications').select('type').eq('source_id',created.id),
    ]);
    const required=['meetings.meeting.created','meetings.meeting.updated','meetings.agenda.updated','meetings.participants.invited','meetings.participant.removed','meetings.participant.rsvp_changed','meetings.session.started','meetings.session.ended','meetings.meeting.archived'];
    const eventTypes=new Set((events.data??[]).map(row=>row.event_type)); const auditTypes=new Set((audits.data??[]).map(row=>row.action));
    for(const type of required){expect(eventTypes.has(type),`missing ${type} app_event`);expect(auditTypes.has(type),`missing ${type} audit`);}
    expect((outbox.data??[]).length>=required.length,'durable command outbox evidence incomplete');
    expect((notifications.data??[]).length>=4,'participant lifecycle notifications incomplete');
  });
  await test('recurring update and cancel are explicitly rejected before mutation', async () => {
    const r=await api('meetings/create',T.b,{...createArgs,idempotencyKey:`${key}-recurring`,title:`${TAG} Recurring`,schedule:{...createArgs.schedule,recurrenceRule:'FREQ=WEEKLY;COUNT=3'}});ok(r);
    const recurring=r.body.data;ctx.meetingIds.push(recurring.id);ctx.calendarIds.push(recurring.schedule.calendarEntryId);ctx.threadIds.push(recurring.discussionThreadId);
    const update=await api('meetings/update',T.b,{meetingId:recurring.id,expectedVersion:recurring.version,idempotencyKey:`${key}-recurring-update`,scope:'series',patch:{title:'must not persist'}});fails(update);expect(update.status===400,'recurring update was not explicitly rejected');
    const cancel=await api('meetings/cancel',T.b,{meetingId:recurring.id,expectedVersion:recurring.version,idempotencyKey:`${key}-recurring-cancel`,scope:'series',reason:'must not persist'});fails(cancel);expect(cancel.status===400,'recurring cancel was not explicitly rejected');
    const {data}=await sb.from('meetings').select('title,status,version').eq('id',recurring.id).single();expect(data?.title===`${TAG} Recurring`&&data.status==='scheduled'&&Number(data.version)===recurring.version,'rejected recurring command mutated state');
  });

  h.section('Meetings › Idempotency and read scope');
  await test('same key and payload replays without duplicate rows or notifications', async () => {
    const r = await api('meetings/create', T.b, createArgs); ok(r);
    expect(r.body.data.id === created.id, 'replay returned a different meeting');
    const [meetings, events, notifications] = await Promise.all([
      sb.from('meetings').select('id').eq('id',created.id),
      sb.from('app_events').select('id').eq('source_module','meetings').eq('source_entity_id',created.id).eq('event_type','meetings.meeting.created'),
      sb.from('notifications').select('id').eq('source_id',created.id).eq('user_id',admin.id).eq('type','meeting_invitation'),
    ]);
    expect((meetings.data ?? []).length === 1 && (events.data ?? []).length === 1 && (notifications.data ?? []).length === 1, 'replay duplicated state');
  });
  await test('same key with different content is a conflict', async () => {
    const r = await api('meetings/create', T.b, { ...createArgs, title: `${createArgs.title} changed` });
    fails(r); expect(r.status === 409, `expected 409, got ${r.status}`);
  });
  await test('participant can get and list the meeting', async () => {
    const get = await api('meetings/get', T.admin, { meetingId: created.id }); ok(get);
    expect(get.body.data.id === created.id, 'participant get mismatch');
    const list = await api('meetings/list', T.admin, { query: TAG, limit: 10 }); ok(list);
    expect(Array.isArray(list.body.data.items) && list.body.data.items.some(item => item.id === created.id), 'participant list omitted meeting');
    expect(Object.hasOwn(list.body.data, 'nextCursor'), 'list cursor envelope missing');
  });
  await test('non-participant cannot get or discover the meeting', async () => {
    const get = await api('meetings/get', T.c, { meetingId: created.id }); fails(get);
    expect(get.status === 404, `expected scoped 404, got ${get.status}`);
    const list = await api('meetings/list', T.c, { query: TAG, limit: 10 }); ok(list);
    expect(!(list.body.data.items ?? []).some(item => item.id === created.id), 'non-participant discovered meeting');
  });
  await test('invalid cursor is rejected', async () => {
    const r = await api('meetings/list', T.admin, { cursor: 'not-a-cursor' });
    fails(r); expect(r.status === 400, `expected 400, got ${r.status}`);
  });
}
