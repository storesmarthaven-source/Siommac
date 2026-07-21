/**
 * Canonical Ticket Center live E2E.
 *
 * Exercises every Ticket Center endpoint, participant/queue access, internal
 * note protection, idempotency, lifecycle transitions, tags, read cursors,
 * overdue processing, notification preferences, and required side effects.
 */

export const title = 'Ticket Center';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  // A synthetic manager + one active direct report exercise team mode
  // deterministically (the report is only ever a requester, never an actor).
  const { actors: [mgr],    createdIds: idsMgr }    = await h.acquireActors('manager', 1, {}, {}, { forceSynthetic: true });
  const { actors: [report], createdIds: idsReport } = await h.acquireActors('employee', 1, { supervisor_id: mgr.id }, {}, { forceSynthetic: true });
  const createdActorIds = [...idsMgr, ...idsReport];
  const T = { admin: mint(admin), b: mint(b), c: mint(c), mgr: mint(mgr) };
  const ctx = { ticketIds: [], ticketNumbers: [], attachmentPaths: [] };
  const key = suffix => `${TAG}:${suffix}`;
  const muteScope = 'event:ticket.created';
  const { data: originalAdminCreatedMute } = await sb.from('notification_mutes')
    .select('user_id, scope, muted_until, created_at')
    .eq('user_id', admin.id)
    .eq('scope', muteScope)
    .maybeSingle();

  h.onCleanup(async () => {
    await sb.from('notification_mutes')
      .delete()
      .eq('user_id', admin.id)
      .eq('scope', muteScope);
    if (originalAdminCreatedMute) {
      await sb.from('notification_mutes').insert(originalAdminCreatedMute);
    }
    if (ctx.ticketIds.length) {
      if (ctx.attachmentPaths.length) {
        await sb.storage.from('ticket-attachments').remove(ctx.attachmentPaths);
      }
      await sb.from('notifications').delete().in('source_id', ctx.ticketNumbers);
      await sb.from('audit_logs').delete().in('record_id', ctx.ticketNumbers);
      await sb.from('app_events').delete().in('source_entity_id', ctx.ticketNumbers);
      await sb.from('tickets').delete().in('id', ctx.ticketIds);
    }
    // Synthetic actors last — tickets (and their cascaded participants / receipts)
    // must be gone before the users they reference can be removed.
    if (createdActorIds.length) await h.mustDelete('app_users', q => q.in('id', createdActorIds));
  });

  h.section('Ticket Center › Catalogue and creation');

  await test('request-types returns the configured staff catalogue', async () => {
    const r = await api('communications/tickets/request-types', T.b, {});
    ok(r);
    expect(Array.isArray(r.body.data), 'request types must be an array');
    const codes = r.body.data.map(row => row.code);
    expect(codes.includes('employment_letter'), 'employment_letter missing');
    expect(codes.includes('technical_support'), 'technical_support missing');
    expect(codes.includes('hse_confidential_concern'), 'confidential HSE type missing');
  });

  let primaryId;
  let primaryNumber;
  let primaryHandlerIds = [];
  await test('employee creates a configured ticket', async () => {
    const r = await api('communications/tickets/create', T.b, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} primary support request`,
      description: 'Please help with this E2E support request.',
      priority: 'medium',
      idempotencyKey: key('create-primary'),
    });
    ok(r);
    primaryId = r.body.data?.ticketId;
    primaryNumber = r.body.data?.ticketNumber;
    primaryHandlerIds = r.body.data?.notificationRecipientIds ?? [];
    expect(primaryId && primaryNumber, 'create response missing ticket identity');
    ctx.ticketIds.push(primaryId);
    ctx.ticketNumbers.push(primaryNumber);
  });

  await test('create is idempotent for the same actor and key', async () => {
    const r = await api('communications/tickets/create', T.b, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} primary support request`,
      description: 'Please help with this E2E support request.',
      priority: 'medium',
      idempotencyKey: key('create-primary'),
    });
    ok(r);
    expect(r.body.data.ticketId === primaryId, 'idempotent replay created a different ticket');
    expect(r.body.data.replayed === true, 'replay flag missing');
    const { count } = await sb.from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('id', primaryId);
    expect(count === 1, `expected one ticket row, got ${count}`);
  });

  await test('SIDE-EFFECT: create wrote ticket event, app event, audit, tags, and handler notification', async () => {
    const [te, ae, al, tags, notifications] = await Promise.all([
      sb.from('ticket_events').select('event_type, sequence').eq('ticket_id', primaryId),
      sb.from('app_events').select('event_type').eq('source_entity_id', primaryNumber),
      sb.from('audit_logs').select('action').eq('record_id', primaryNumber),
      sb.from('ticket_tags').select('label, tag_kind').eq('ticket_id', primaryId),
      sb.from('notifications').select('user_id, type, action_route')
        .eq('source_id', primaryNumber).eq('type', 'ticket.created'),
    ]);
    expect(te.data?.some(row => row.event_type === 'created' && row.sequence === 1), 'ticket event missing');
    expect(ae.data?.some(row => row.event_type === 'ticket.created'), 'app event missing');
    expect(al.data?.some(row => row.action === 'ticket.created'), 'audit log missing');
    expect(tags.data?.some(row => row.tag_kind === 'system'), 'system tags missing');
    expect(primaryHandlerIds.includes(admin.id), 'admin was not resolved as a queue handler');
    expect(notifications.data?.every(row => row.action_route === 's-ticket-center'), 'ticket action route invalid');
  });

  await test('invalid request type fails closed', async () => {
    const r = await api('communications/tickets/create', T.b, {
      requestTypeCode: 'not-a-real-type',
      subject: `${TAG} invalid`,
      description: 'Must not be accepted.',
      idempotencyKey: key('invalid-type'),
    });
    fails(r, 'unknown request type was accepted');
  });

  h.section('Ticket Center › Creation modes and permissions');

  await test('request-types(self) exposes employee types and hides internal-only ones', async () => {
    const r = await api('communications/tickets/request-types', T.b, { creationMode: 'self' });
    ok(r);
    const codes = r.body.data.map(row => row.code);
    expect(codes.includes('facilities_issue'), 'employee-facing type missing from self catalogue');
    expect(!codes.includes('general_support'), 'internal type general_support leaked to self catalogue');
    expect(!codes.includes('finance_admin'), 'internal type finance_admin leaked to self catalogue');
  });

  await test('request-types(internal) returns internal types for a handler and nothing for staff', async () => {
    const handler = await api('communications/tickets/request-types', T.admin, { creationMode: 'internal' });
    ok(handler);
    const handlerCodes = handler.body.data.map(row => row.code);
    expect(handlerCodes.includes('finance_admin'), 'internal type missing for a handler');
    expect(!handlerCodes.includes('facilities_issue'), 'employee type leaked into the internal catalogue');
    const staff = await api('communications/tickets/request-types', T.b, { creationMode: 'internal' });
    ok(staff);
    expect(staff.body.data.length === 0, 'internal request types were exposed to ordinary staff');
  });

  await test('requester-search team returns only the actor active direct reports', async () => {
    const r = await api('communications/tickets/requester-search', T.mgr, { creationMode: 'team', query: '' });
    ok(r);
    const ids = r.body.data.map(row => row.id);
    expect(ids.includes(report.id), 'direct report missing from team search');
    expect(!ids.includes(mgr.id), 'team search returned the actor');
    expect(!ids.includes(c.id) && !ids.includes(b.id), 'team search leaked non-reports');
  });

  await test('requester-search on_behalf is gated on tickets.create_on_behalf', async () => {
    const allowed = await api('communications/tickets/requester-search', T.admin, { creationMode: 'on_behalf', query: '' });
    ok(allowed);
    expect(allowed.body.data.length > 0, 'on-behalf search returned nobody for an authorised actor');
    expect(!allowed.body.data.some(row => row.id === admin.id), 'on-behalf search returned the actor');
    const denied = await api('communications/tickets/requester-search', T.b, { creationMode: 'on_behalf', query: '' });
    ok(denied);
    expect(denied.body.data.length === 0, 'on-behalf search exposed employees to ordinary staff');
  });

  await test('self ticket records self provenance (created_by = requester)', async () => {
    const { data: row } = await sb.from('tickets')
      .select('creation_mode, created_by_user_id, requester_user_id, creation_reason')
      .eq('id', primaryId).single();
    expect(row?.creation_mode === 'self', 'self ticket creation_mode wrong');
    expect(row?.created_by_user_id === b.id, 'self ticket created_by wrong');
    expect(row?.requester_user_id === b.id, 'self ticket requester wrong');
    expect(row?.creation_reason === null, 'self ticket must not carry a reason');
  });

  let teamId;
  let teamNumber;
  await test('manager raises a team ticket for a direct report and the report is notified', async () => {
    const r = await api('communications/tickets/create', T.mgr, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} team facilities request`,
      description: 'Raised by the manager for a direct report.',
      creationMode: 'team',
      requesterId: report.id,
      idempotencyKey: key('create-team'),
    });
    ok(r);
    teamId = r.body.data?.ticketId;
    teamNumber = r.body.data?.ticketNumber;
    expect(teamId && teamNumber, 'team create response missing identity');
    ctx.ticketIds.push(teamId);
    ctx.ticketNumbers.push(teamNumber);
    const { data: row } = await sb.from('tickets')
      .select('creation_mode, created_by_user_id, requester_user_id')
      .eq('id', teamId).single();
    expect(row?.creation_mode === 'team', 'team creation_mode wrong');
    expect(row?.created_by_user_id === mgr.id, 'team created_by must be the manager');
    expect(row?.requester_user_id === report.id, 'team requester must be the direct report');
    const { count } = await sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', teamNumber).eq('user_id', report.id).eq('type', 'ticket.created_for_you');
    expect(count === 1, 'direct report was not notified their ticket was raised');
  });

  await test('manager cannot raise a team ticket for a non-direct-report', async () => {
    const r = await api('communications/tickets/create', T.mgr, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} team stranger`,
      description: 'Must be rejected — not the manager report.',
      creationMode: 'team',
      requesterId: c.id,
      idempotencyKey: key('team-stranger'),
    });
    fails(r, 'manager raised a team ticket for a non-report');
  });

  await test('employee without create_team cannot use team mode', async () => {
    const r = await api('communications/tickets/create', T.b, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} team unauthorised`,
      description: 'Must be rejected — employee lacks create_team.',
      creationMode: 'team',
      requesterId: c.id,
      idempotencyKey: key('team-noperm'),
    });
    fails(r, 'employee without create_team raised a team ticket');
  });

  let onBehalfId;
  let onBehalfNumber;
  await test('admin raises an on-behalf ticket with a reason and notifies the employee', async () => {
    const r = await api('communications/tickets/create', T.admin, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} on-behalf request`,
      description: 'Raised on behalf of an employee.',
      creationMode: 'on_behalf',
      requesterId: b.id,
      creationReason: 'Employee is on site with no laptop access.',
      idempotencyKey: key('create-onbehalf'),
    });
    ok(r);
    onBehalfId = r.body.data?.ticketId;
    onBehalfNumber = r.body.data?.ticketNumber;
    expect(onBehalfId && onBehalfNumber, 'on-behalf create response missing identity');
    ctx.ticketIds.push(onBehalfId);
    ctx.ticketNumbers.push(onBehalfNumber);
    const { data: row } = await sb.from('tickets')
      .select('creation_mode, created_by_user_id, requester_user_id, creation_reason')
      .eq('id', onBehalfId).single();
    expect(row?.creation_mode === 'on_behalf', 'on-behalf creation_mode wrong');
    expect(row?.created_by_user_id === admin.id, 'on-behalf created_by must be the actor');
    expect(row?.requester_user_id === b.id, 'on-behalf requester must be the named employee');
    expect(typeof row?.creation_reason === 'string' && row.creation_reason.length > 0, 'on-behalf reason not persisted');
    const { count } = await sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', onBehalfNumber).eq('user_id', b.id).eq('type', 'ticket.created_for_you');
    expect(count === 1, 'named employee was not notified of the on-behalf ticket');
  });

  await test('on-behalf without a reason is rejected', async () => {
    const r = await api('communications/tickets/create', T.admin, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} on-behalf no reason`,
      description: 'Must be rejected — no reason supplied.',
      creationMode: 'on_behalf',
      requesterId: c.id,
      idempotencyKey: key('onbehalf-noreason'),
    });
    fails(r, 'on-behalf ticket without a reason was accepted');
  });

  await test('employee without create_on_behalf cannot use on-behalf mode', async () => {
    const r = await api('communications/tickets/create', T.b, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} on-behalf unauthorised`,
      description: 'Must be rejected — employee lacks create_on_behalf.',
      creationMode: 'on_behalf',
      requesterId: c.id,
      creationReason: 'Should not matter.',
      idempotencyKey: key('onbehalf-noperm'),
    });
    fails(r, 'employee without create_on_behalf raised an on-behalf ticket');
  });

  let internalId;
  let internalNumber;
  await test('handler raises internal work under their own identity', async () => {
    const r = await api('communications/tickets/create', T.admin, {
      requestTypeCode: 'finance_admin',
      subject: `${TAG} internal work item`,
      description: 'Internal finance follow-up logged by a handler.',
      creationMode: 'internal',
      idempotencyKey: key('create-internal'),
    });
    ok(r);
    internalId = r.body.data?.ticketId;
    internalNumber = r.body.data?.ticketNumber;
    expect(internalId && internalNumber, 'internal create response missing identity');
    ctx.ticketIds.push(internalId);
    ctx.ticketNumbers.push(internalNumber);
    const { data: row } = await sb.from('tickets')
      .select('creation_mode, created_by_user_id, requester_user_id')
      .eq('id', internalId).single();
    expect(row?.creation_mode === 'internal', 'internal creation_mode wrong');
    expect(row?.created_by_user_id === admin.id, 'internal created_by must be the actor');
    expect(row?.requester_user_id === admin.id, 'internal work is recorded under its creator');
  });

  await test('ordinary staff cannot raise internal work', async () => {
    const r = await api('communications/tickets/create', T.b, {
      requestTypeCode: 'finance_admin',
      subject: `${TAG} internal unauthorised`,
      description: 'Must be rejected — employee lacks create_internal.',
      creationMode: 'internal',
      idempotencyKey: key('internal-noperm'),
    });
    fails(r, 'employee without create_internal raised internal work');
  });

  await test('an internal-only type cannot be raised as a self-service request', async () => {
    const r = await api('communications/tickets/create', T.b, {
      requestTypeCode: 'finance_admin',
      subject: `${TAG} internal via self`,
      description: 'Must be rejected — internal type is not employee-requestable.',
      creationMode: 'self',
      idempotencyKey: key('internal-as-self'),
    });
    fails(r, 'internal-only type was accepted through self mode');
  });

  await test('SIDE-EFFECT: on-behalf event and app_event payloads carry creation provenance', async () => {
    const [ev, ae] = await Promise.all([
      sb.from('ticket_events').select('payload').eq('ticket_id', onBehalfId).eq('event_type', 'created').single(),
      sb.from('app_events').select('payload').eq('source_entity_id', onBehalfNumber).eq('event_type', 'ticket.created').single(),
    ]);
    for (const [label, payload] of [['ticket_events', ev.data?.payload], ['app_events', ae.data?.payload]]) {
      expect(payload?.creationMode === 'on_behalf', `${label} payload missing creationMode`);
      expect(payload?.requesterUserId === b.id, `${label} payload missing requesterUserId`);
      expect(payload?.createdByUserId === admin.id, `${label} payload missing createdByUserId`);
      expect(typeof payload?.creationReason === 'string' && payload.creationReason.length > 0, `${label} payload missing creationReason`);
    }
  });

  h.section('Ticket Center › Reads and access');

  await test('requester mine list contains the ticket with tags and unread fields', async () => {
    const r = await api('communications/tickets/list', T.b, {
      scope: 'mine', limit: 50,
    });
    ok(r);
    const row = r.body.data.find(ticket => ticket.id === primaryId);
    expect(row, 'requester ticket missing');
    expect(Array.isArray(row.tags) && row.tags.length > 0, 'tags missing from list contract');
    expect(typeof row.unreadCount === 'number', 'unreadCount missing');
    expect(typeof row.canHandle === 'boolean', 'canHandle missing');
    expect(row.requester?.id === b.id, 'requester profile identity missing from list contract');
    expect(typeof row.requester?.displayName === 'string', 'requester display name missing from list contract');
  });

  await test('queue handler sees the ticket in queue scope', async () => {
    const r = await api('communications/tickets/list', T.admin, {
      scope: 'queue', queueCode: 'facilities', limit: 50,
    });
    ok(r);
    expect(r.body.data.some(ticket => ticket.id === primaryId), 'queue ticket missing for handler');
  });

  await test('non-participant cannot open another employee ticket', async () => {
    const r = await api('communications/tickets/get', T.c, { ticketId: primaryId });
    fails(r, 'non-participant read was allowed');
  });

  await test('requester and queue handler can open ticket detail', async () => {
    const requester = await api('communications/tickets/get', T.b, { ticketId: primaryId });
    const handler = await api('communications/tickets/get', T.admin, { ticketId: primaryId });
    ok(requester);
    ok(handler);
    expect(Array.isArray(requester.body.data.comments), 'requester comments contract missing');
    expect(handler.body.data.canHandle === true, 'handler capability missing');
    expect(requester.body.data.ticket.requester?.id === b.id, 'requester profile missing from detail contract');
    expect(handler.body.data.participants.some(participant => participant.user?.id === b.id), 'participant profile missing from handler detail');
  });

  await test('mark-read advances a monotonic ticket cursor', async () => {
    const first = await api('communications/tickets/mark-read', T.admin, {
      ticketId: primaryId, sequence: 1,
    });
    const older = await api('communications/tickets/mark-read', T.admin, {
      ticketId: primaryId, sequence: 0,
    });
    ok(first);
    ok(older);
    expect(older.body.data.lastReadSequence >= 1, 'read cursor moved backwards');
  });

  h.section('Ticket Center › Comments, notes, and lifecycle');

  await test('requester comment is atomic and idempotent', async () => {
    const args = {
      ticketId: primaryId,
      body: `${TAG} requester clarification`,
      isInternal: false,
      idempotencyKey: key('requester-comment'),
    };
    const first = await api('communications/tickets/comment', T.b, args);
    const replay = await api('communications/tickets/comment', T.b, args);
    ok(first);
    ok(replay);
    expect(first.body.data.commentId === replay.body.data.commentId, 'comment replay duplicated');
    const { count } = await sb.from('ticket_comments')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_id', primaryId).eq('client_request_id', key('requester-comment'));
    expect(count === 1, `expected one comment, got ${count}`);
  });

  await test('non-participant cannot comment', async () => {
    const r = await api('communications/tickets/comment', T.c, {
      ticketId: primaryId,
      body: 'I should not be able to reply.',
      isInternal: false,
      idempotencyKey: key('intruder-comment'),
    });
    fails(r, 'non-participant comment was accepted');
  });

  await test('handler adds an internal note that requester cannot read', async () => {
    const r = await api('communications/tickets/comment', T.admin, {
      ticketId: primaryId,
      body: `${TAG} confidential handler note`,
      isInternal: true,
      idempotencyKey: key('internal-note'),
    });
    ok(r);
    const requester = await api('communications/tickets/get', T.b, { ticketId: primaryId });
    const handler = await api('communications/tickets/get', T.admin, { ticketId: primaryId });
    ok(requester);
    ok(handler);
    expect(!requester.body.data.comments.some(comment => comment.isInternal), 'internal note leaked');
    expect(handler.body.data.comments.some(comment => comment.isInternal), 'handler cannot see internal note');
  });

  await test('requester cannot create an internal note', async () => {
    const r = await api('communications/tickets/comment', T.b, {
      ticketId: primaryId,
      body: 'Forbidden internal note.',
      isInternal: true,
      idempotencyKey: key('forbidden-note'),
    });
    fails(r, 'requester internal note was accepted');
  });

  await test('participant uploads, completes, and securely reads an attachment', async () => {
    const content = Buffer.from(`${TAG} ticket attachment`, 'utf8');
    const reserved = await api('communications/tickets/attachments/upload-url', T.b, {
      ticketId: primaryId,
      fileName: `${TAG}.txt`,
      contentType: 'text/plain',
      sizeBytes: content.byteLength,
    });
    ok(reserved);
    const { attachmentId, uploadUrl, path } = reserved.body.data ?? {};
    expect(attachmentId && uploadUrl && path, 'attachment reservation shape incomplete');
    ctx.attachmentPaths.push(path);
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    });
    expect(put.ok, `attachment PUT failed: ${put.status}`);
    const complete = await api('communications/tickets/attachments/complete', T.b, {
      attachmentId,
      idempotencyKey: key('attachment-complete'),
    });
    ok(complete);
    const url = await api('communications/tickets/attachments/get-url', T.b, { attachmentId });
    ok(url);
    expect(typeof url.body.data?.url === 'string', 'signed attachment URL missing');
    const denied = await api('communications/tickets/attachments/get-url', T.c, { attachmentId });
    fails(denied, 'non-participant downloaded ticket attachment');
    const detail = await api('communications/tickets/get', T.b, { ticketId: primaryId });
    expect(detail.body.data.attachments.some(row => row.id === attachmentId), 'uploaded attachment missing from detail');
    const { data: event } = await sb.from('ticket_events')
      .select('event_type').eq('ticket_id', primaryId).eq('event_type', 'attachment_added').limit(1);
    expect(event?.length === 1, 'attachment audit event missing');
  });

  await test('handler assigns and starts the ticket', async () => {
    const assign = await api('communications/tickets/command', T.admin, {
      ticketId: primaryId,
      action: 'assign',
      payload: { assigneeId: admin.id },
      idempotencyKey: key('assign'),
    });
    ok(assign);
    expect(assign.body.data.status === 'assigned', 'assign did not set assigned status');
    const start = await api('communications/tickets/command', T.admin, {
      ticketId: primaryId,
      action: 'start',
      payload: {},
      idempotencyKey: key('start'),
    });
    ok(start);
    expect(start.body.data.status === 'in_progress', 'start did not set in_progress');
  });

  await test('handler can add and remove a custom tag', async () => {
    ok(await api('communications/tickets/command', T.admin, {
      ticketId: primaryId,
      action: 'add_tag',
      payload: { label: 'Mortgage' },
      idempotencyKey: key('add-tag'),
    }));
    let detail = await api('communications/tickets/get', T.admin, { ticketId: primaryId });
    ok(detail);
    expect(detail.body.data.tags.some(tag => tag.key === 'mortgage'), 'custom tag missing');
    // The ticket is assigned by now, so it is no longer in the Inbox (queue) scope
    // (queue = unassigned only). Use `all` to validate the combined filter set.
    const filtered = await api('communications/tickets/list', T.admin, {
      scope: 'all',
      queueCode: 'facilities',
      priority: 'medium',
      requestTypeCode: 'facilities_issue',
      tagKey: 'mortgage',
      search: TAG,
      limit: 50,
    });
    ok(filtered);
    expect(filtered.body.data.some(ticket => ticket.id === primaryId), 'combined ticket filters missed ticket');
    ok(await api('communications/tickets/command', T.admin, {
      ticketId: primaryId,
      action: 'remove_tag',
      payload: { tagKey: 'mortgage' },
      idempotencyKey: key('remove-tag'),
    }));
    detail = await api('communications/tickets/get', T.admin, { ticketId: primaryId });
    expect(!detail.body.data.tags.some(tag => tag.key === 'mortgage'), 'custom tag not removed');
  });

  await test('waiting_requester notification is completed by requester reply', async () => {
    ok(await api('communications/tickets/command', T.admin, {
      ticketId: primaryId,
      action: 'wait_requester',
      payload: {},
      idempotencyKey: key('wait-requester'),
    }));
    const before = await sb.from('notifications').select('id, action_status')
      .eq('source_id', primaryNumber).eq('type', 'ticket.waiting_requester')
      .eq('user_id', b.id).limit(1);
    expect(before.data?.[0]?.action_status === 'pending', 'requester action notification missing');
    const delivery = await sb.from('notification_deliveries')
      .select('channel, status')
      .eq('notification_id', before.data[0].id)
      .eq('channel', 'in_app')
      .maybeSingle();
    expect(delivery.data?.status === 'sent', 'in-app notification delivery evidence missing');
    ok(await api('communications/tickets/comment', T.b, {
      ticketId: primaryId,
      body: `${TAG} requested response`,
      isInternal: false,
      idempotencyKey: key('waiting-response'),
    }));
    const after = await sb.from('notifications').select('action_status')
      .eq('id', before.data[0].id).single();
    expect(after.data?.action_status === 'completed', 'requester action notification not completed');
  });

  await test('resolve, close, and requester reopen follow the state machine', async () => {
    const resolved = await api('communications/tickets/command', T.admin, {
      ticketId: primaryId,
      action: 'resolve',
      payload: { resolutionCode: 'completed' },
      idempotencyKey: key('resolve'),
    });
    ok(resolved);
    expect(resolved.body.data.status === 'resolved', 'resolve failed');
    const closed = await api('communications/tickets/command', T.admin, {
      ticketId: primaryId,
      action: 'close',
      payload: {},
      idempotencyKey: key('close'),
    });
    ok(closed);
    expect(closed.body.data.status === 'closed', 'close failed');
    const reopened = await api('communications/tickets/command', T.b, {
      ticketId: primaryId,
      action: 'reopen',
      payload: {},
      idempotencyKey: key('reopen'),
    });
    ok(reopened);
    expect(reopened.body.data.status === 'reopened', 'requester reopen failed');
  });

  await test('SIDE-EFFECT: lifecycle commands have sequenced events and audits', async () => {
    const { data: events } = await sb.from('ticket_events')
      .select('event_type, sequence').eq('ticket_id', primaryId).order('sequence');
    const sequences = (events ?? []).map(row => row.sequence);
    expect(sequences.every((seq, index) => index === 0 || seq > sequences[index - 1]), 'event sequence is not monotonic');
    const { data: audits } = await sb.from('audit_logs')
      .select('action').eq('record_id', primaryNumber);
    expect(audits?.some(row => row.action === 'ticket.resolved'), 'resolve audit missing');
    expect(audits?.some(row => row.action === 'ticket.reopened'), 'reopen audit missing');
  });

  h.section('Ticket Center › Scope model + navigation context');

  const sc = { openId: null, assignedId: null, resolvedId: null, closedId: null };
  async function makeScopeTicket(token, label, key2) {
    const r = await api('communications/tickets/create', token, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} scope ${label}`,
      description: `Scope-model fixture (${label}).`,
      creationMode: 'self',
      idempotencyKey: key(key2),
    });
    ok(r);
    ctx.ticketIds.push(r.body.data.ticketId);
    ctx.ticketNumbers.push(r.body.data.ticketNumber);
    return r.body.data.ticketId;
  }
  const scopeIds = async (token, args) => {
    const r = await api('communications/tickets/list', token, { search: TAG, limit: 100, ...args });
    ok(r);
    return { ids: r.body.data.map(row => row.id), total: r.body.total };
  };

  await test('scope fixtures: one open/unassigned, assigned, resolved, and archived ticket', async () => {
    sc.openId     = await makeScopeTicket(T.b, 'open', 'scope-open');
    sc.assignedId = await makeScopeTicket(T.c, 'assigned', 'scope-assigned');
    sc.resolvedId = await makeScopeTicket(T.b, 'resolved', 'scope-resolved');
    sc.closedId   = await makeScopeTicket(T.b, 'closed', 'scope-closed');
    // Drive each fixture into its target state via the service-role client.
    await sb.from('tickets').update({ assignee_user_id: admin.id, status: 'assigned' }).eq('id', sc.assignedId);
    await sb.from('tickets').update({ status: 'resolved' }).eq('id', sc.resolvedId);
    await sb.from('tickets').update({ status: 'closed' }).eq('id', sc.closedId);
  });

  await test('Inbox (queue) = handled + unassigned + active only; All = full visible set (queue <> all)', async () => {
    const inbox = await scopeIds(T.admin, { scope: 'queue' });
    const all   = await scopeIds(T.admin, { scope: 'all', statusGroup: 'all' });
    expect(inbox.ids.includes(sc.openId), 'inbox missing the open unassigned ticket');
    expect(!inbox.ids.includes(sc.assignedId), 'inbox leaked an ASSIGNED ticket');
    expect(!inbox.ids.includes(sc.resolvedId), 'inbox leaked a RESOLVED ticket');
    expect(!inbox.ids.includes(sc.closedId), 'inbox leaked a CLOSED ticket');
    for (const id of [sc.openId, sc.assignedId, sc.resolvedId, sc.closedId]) {
      expect(all.ids.includes(id), `all scope missing fixture ${id}`);
    }
    expect(inbox.ids.length < all.ids.length, 'queue and all returned the same set (scope collision)');
  });

  await test('assigned = actor is assignee; mine = requester/participant', async () => {
    const adminAssigned = await scopeIds(T.admin, { scope: 'assigned', statusGroup: 'all' });
    expect(adminAssigned.ids.includes(sc.assignedId), 'assignee did not see their assigned ticket');
    expect(!adminAssigned.ids.includes(sc.openId), 'assigned scope leaked an unassigned ticket');
    const cAssigned = await scopeIds(T.c, { scope: 'assigned', statusGroup: 'all' });
    expect(!cAssigned.ids.includes(sc.assignedId), 'assigned scope leaked another actor’s assignment');
    const bMine = await scopeIds(T.b, { scope: 'mine', statusGroup: 'all' });
    expect(bMine.ids.includes(sc.openId), 'requester did not see their own ticket in mine');
  });

  await test('status groups map to the correct statuses', async () => {
    const active   = await scopeIds(T.admin, { scope: 'all', statusGroup: 'active' });
    const resolved = await scopeIds(T.admin, { scope: 'all', statusGroup: 'resolved' });
    const archived = await scopeIds(T.admin, { scope: 'all', statusGroup: 'archived' });
    expect(active.ids.includes(sc.openId) && active.ids.includes(sc.assignedId), 'active group missing an active ticket');
    expect(!active.ids.includes(sc.resolvedId) && !active.ids.includes(sc.closedId), 'active group leaked a non-active ticket');
    expect(resolved.ids.includes(sc.resolvedId) && !resolved.ids.includes(sc.openId) && !resolved.ids.includes(sc.closedId), 'resolved group wrong');
    expect(archived.ids.includes(sc.closedId) && !archived.ids.includes(sc.openId) && !archived.ids.includes(sc.resolvedId), 'archived group wrong');
  });

  await test('total counts the full filter set even when the limit truncates the page', async () => {
    const r = await api('communications/tickets/list', T.admin, { scope: 'all', statusGroup: 'all', search: TAG, limit: 1 });
    ok(r);
    expect(r.body.data.length === 1, 'limit did not truncate the page');
    expect(r.body.total >= 4, `total (${r.body.total}) must count the full set, not the page`);
  });

  await test('nav-context: handler capabilities + counts from permissions; requester is denied', async () => {
    const a = await api('communications/tickets/nav-context', T.admin, {});
    ok(a);
    expect(a.body.data.capabilities.isHandler === true, 'admin should be a handler');
    expect(Array.isArray(a.body.data.capabilities.handledServiceAreas) && a.body.data.capabilities.handledServiceAreas.length > 0, 'admin handled service areas missing');
    expect(typeof a.body.data.counts.inbox === 'number' && typeof a.body.data.counts.all.all === 'number', 'nav counts shape invalid');
    const req = await api('communications/tickets/nav-context', T.b, {});
    ok(req);
    expect(req.body.data.capabilities.isHandler === false, 'a plain requester must not be a handler');
    expect(req.body.data.capabilities.handledServiceAreas.length === 0, 'a requester must handle no service areas');
  });

  await test('isHandler is permission-derived (empty inbox stays a handler) and an explicit deny removes the service area', async () => {
    const { actors: [navUser] } = await h.acquireActors('employee', 1, {}, {}, { forceSynthetic: true });
    h.onCleanup(async () => {
      await h.mustDelete('user_permissions', q => q.eq('user_id', navUser.id));
      await h.mustDelete('app_users', q => q.eq('id', navUser.id));
    });
    const T2 = mint(navUser);
    const before = await api('communications/tickets/nav-context', T2, {});
    ok(before);
    expect(before.body.data.capabilities.isHandler === false, 'a fresh employee should not be a handler');

    // Grant the IT service-area handler permission — this user owns NO IT tickets.
    await sb.from('user_permissions').insert({
      user_id: navUser.id, permission: 'settings.system.manage', granted: true, set_by: admin.id, set_at: new Date().toISOString(),
    });
    const granted = await api('communications/tickets/nav-context', T2, {});
    ok(granted);
    expect(granted.body.data.capabilities.isHandler === true, 'granting a handler permission did not make isHandler true (empty inbox)');
    expect(granted.body.data.capabilities.handledServiceAreas.some(area => area.code === 'it'), 'IT service area missing after grant');

    // Explicit deny — the service area must disappear.
    await sb.from('user_permissions').update({ granted: false }).eq('user_id', navUser.id).eq('permission', 'settings.system.manage');
    const denied = await api('communications/tickets/nav-context', T2, {});
    ok(denied);
    expect(!denied.body.data.capabilities.handledServiceAreas.some(area => area.code === 'it'), 'explicit deny did not remove the IT service area');
  });

  await test('general_support seeds LOW default priority', async () => {
    const { data } = await sb.from('ticket_request_types').select('default_priority').eq('code', 'general_support').single();
    expect(data?.default_priority === 'low', `general_support default_priority must be low, got ${data?.default_priority}`);
  });

  h.section('Ticket Center › Preferences and overdue sweep');

  let mutedId;
  let mutedNumber;
  await test('ticket.created respects notification mute preferences', async () => {
    ok(await api('communications/notifications/mute', T.admin, {
      scope: muteScope,
    }));
    const r = await api('communications/tickets/create', T.c, {
      requestTypeCode: 'facilities_issue',
      subject: `${TAG} muted notification`,
      description: 'Handler has muted ticket.created.',
      priority: 'medium',
      idempotencyKey: key('create-muted'),
    });
    ok(r);
    mutedId = r.body.data.ticketId;
    mutedNumber = r.body.data.ticketNumber;
    ctx.ticketIds.push(mutedId);
    ctx.ticketNumbers.push(mutedNumber);
    const { count } = await sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', mutedNumber).eq('user_id', admin.id).eq('type', 'ticket.created');
    expect(count === 0, 'muted notification was persisted');
    ok(await api('communications/notifications/mute', T.admin, {
      scope: muteScope, clear: true,
    }));
  });

  await test('overdue sweep is idempotent and emits required side effects', async () => {
    await sb.from('tickets').update({
      resolution_due_at: new Date(Date.now() - 60_000).toISOString(),
      overdue_notified_at: null,
    }).eq('id', mutedId);
    const first = await api('communications/tickets/run-overdue-sweep', T.admin, { limit: 100 });
    const second = await api('communications/tickets/run-overdue-sweep', T.admin, { limit: 100 });
    ok(first);
    ok(second);
    expect(first.body.data.processed >= 1, 'overdue ticket was not processed');
    expect(second.body.data.processed === 0, 'overdue sweep delivered twice');
    const [events, audits, notifications] = await Promise.all([
      sb.from('app_events').select('event_type').eq('source_entity_id', mutedNumber).eq('event_type', 'ticket.overdue'),
      sb.from('audit_logs').select('action').eq('record_id', mutedNumber).eq('action', 'ticket.overdue'),
      sb.from('notifications').select('type, action_required').eq('source_id', mutedNumber).eq('type', 'ticket.overdue'),
    ]);
    expect(events.data?.length === 1, 'overdue app event missing or duplicated');
    expect(audits.data?.length === 1, 'overdue audit missing or duplicated');
    expect(notifications.data?.some(row => row.action_required), 'overdue action notification missing');
  });

  await test('summary exposes real ticket open and unread counts', async () => {
    const r = await api('communications/summary', T.admin, {});
    ok(r);
    expect(typeof r.body.data.ticketsOpen === 'number', 'ticketsOpen missing');
    expect(typeof r.body.data.ticketsUnread === 'number', 'ticketsUnread missing');
    expect(r.body.data.ticketsOpen >= 1, 'open queue ticket not counted');
  });
}
