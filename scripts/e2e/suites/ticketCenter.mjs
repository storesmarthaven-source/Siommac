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
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };
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
      requestTypeCode: 'general_support',
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
      requestTypeCode: 'general_support',
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
      scope: 'queue', queueCode: 'general', limit: 50,
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
    const filtered = await api('communications/tickets/list', T.admin, {
      scope: 'queue',
      queueCode: 'general',
      priority: 'medium',
      requestTypeCode: 'general_support',
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

  h.section('Ticket Center › Preferences and overdue sweep');

  let mutedId;
  let mutedNumber;
  await test('ticket.created respects notification mute preferences', async () => {
    ok(await api('communications/notifications/mute', T.admin, {
      scope: muteScope,
    }));
    const r = await api('communications/tickets/create', T.c, {
      requestTypeCode: 'general_support',
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
