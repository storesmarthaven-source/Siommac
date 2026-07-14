/**
 * scripts/e2e/suites/communications.mjs
 *
 * REFERENCE SUITE — the bar every module suite must meet (see CLAUDE.md §Testing
 * Standard). Covers the Communications backbone end-to-end:
 *   Notifications · Messages · Tickets
 * and asserts not just happy-path responses but ALSO:
 *   • access control (participant / non-participant / after-add),
 *   • response shape (the contract the frontend consumes),
 *   • side-effects in the DB (the spec's "emit app_events / audit_logs /
 *     notifications / handoffs" rule) via the service-role client.
 *
 * All rows it creates are tagged with h.TAG and removed in onCleanup().
 */

export const title = 'Communications (Notifications · Messages · Tickets)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };
  const ctx = { threadIds: [], ticketIds: [] };

  // Register teardown up-front so partial runs still clean up.
  h.onCleanup(async () => {
    if (ctx.threadIds.length) {
      const posts = (await sb.from('message_posts').select('id').in('thread_id', ctx.threadIds)).data ?? [];
      if (posts.length) await sb.from('message_attachments').delete().in('post_id', posts.map(p => p.id));
      await sb.from('message_posts').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_participants').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_thread_access_grants').delete().in('thread_id', ctx.threadIds);
      await sb.from('notifications').delete().in('source_id', ctx.threadIds);  // message notifs (title isn't TAG-prefixed)
      await sb.from('message_threads').delete().in('id', ctx.threadIds);
    }
    if (ctx.ticketIds.length) {
      await sb.from('ticket_comments').delete().in('ticket_id', ctx.ticketIds);
      await sb.from('tickets').delete().in('id', ctx.ticketIds);
    }
    await sb.from('notifications').delete().ilike('title', `${TAG}%`);
  });

  // ───────────────────────── NOTIFICATIONS ─────────────────────────
  h.section('Communications › Notifications');

  await test('summary returns counts object', async () => {
    const r = await api('communications/summary', T.admin);
    ok(r); expect(typeof r.body.data?.messagesUnread === 'number', 'missing messagesUnread');
  });
  await test('list returns array', async () => {
    const r = await api('communications/notifications/list', T.admin, { limit: 10 });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('list honors unreadOnly filter', async () => {
    const r = await api('communications/notifications/list', T.admin, { limit: 50, unreadOnly: true });
    ok(r); expect((r.body.data || []).every(n => n.is_read === false), 'unread filter leaked read rows');
  });
  await test('list honors actionRequiredOnly filter', async () => {
    const r = await api('communications/notifications/list', T.admin, { limit: 50, actionRequiredOnly: true });
    ok(r); expect((r.body.data || []).every(n => n.action_required === true), 'actionRequired filter leaked');
  });
  await test('preferences/get returns shape', async () => {
    const r = await api('communications/notifications/preferences/get', T.admin);
    ok(r); expect(r.body.data && 'preferences' in r.body.data, 'missing preferences');
  });
  await test('preferences/set persists', async () => {
    const r = await api('communications/notifications/preferences/set', T.admin,
      { eventType: 'test.event', in_app: true, email: false, whatsapp: false });
    ok(r);
  });
  await test('mute then clear', async () => {
    ok(await api('communications/notifications/mute', T.admin, { scope: 'all' }), 'mute failed');
    ok(await api('communications/notifications/mute', T.admin, { scope: 'all', clear: true }), 'unmute failed');
  });

  let notifId = null;
  await test('broadcast → single user creates a notification', async () => {
    const r = await api('communications/notifications/broadcast', T.admin, {
      audience: { type: 'users', userIds: [admin.id] },
      severity: 'info', title: `${TAG} hello`, body: 'integration test',
    });
    ok(r); expect(typeof r.body.recipientCount === 'number', 'no recipientCount');
  });
  await test('SIDE-EFFECT: broadcast wrote a notifications row', async () => {
    const { data } = await sb.from('notifications').select('id').ilike('title', `${TAG}%`).limit(1);
    expect(data && data.length === 1, 'no notifications row created by broadcast');
    notifId = data[0].id;
  });
  await test('the broadcast notification appears in the recipient list', async () => {
    const r = await api('communications/notifications/list', T.admin, { limit: 50, search: TAG });
    ok(r); expect((r.body.data || []).some(n => (n.title || '').includes(TAG)), 'broadcast not in list');
  });
  await test('markRead marks it read', async () => {
    expect(notifId, 'no seeded notification id');
    ok(await api('communications/notifications/markRead', T.admin, { notificationId: notifId }));
    const { data } = await sb.from('notifications').select('is_read').eq('id', notifId).single();
    expect(data?.is_read === true, 'is_read not set in DB');
  });
  await test('markAllRead succeeds', async () => ok(await api('communications/notifications/markAllRead', T.admin, {})));
  await test('archive the seeded notification', async () => {
    ok(await api('communications/notifications/archive', T.admin, { notificationId: notifId }));
  });

  await test('ACTION WIRING: every action-required notification has a navigable action_route', async () => {
    const r = await api('communications/notifications/list', T.admin, { limit: 100, actionRequiredOnly: true });
    ok(r);
    const missing = (r.body.data || []).filter(n => !n.action_route);
    expect(missing.length === 0, `${missing.length} action-required notifications have no action_route (e.g. "${missing[0]?.title}") — clicking them can't navigate`);
  });
  await test('ACTION WIRING: notification action_routes are recognised by the FE resolver', async () => {
    // notifAction.ts converts any logical path to a section id (module/area → s-module-area)
    // so any well-formed slug path is valid. What is NOT valid: paths with embedded entity IDs
    // (UUIDs or numeric IDs), which can never map to an existing DOM section.
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const SLUG_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;   // valid logical paths + bare section ids
    const r = await api('communications/notifications/list', T.admin, { limit: 100 });
    ok(r);
    const routes = [...new Set((r.body.data || []).map(n => n.action_route).filter(Boolean))];
    // Reject routes that embed entity IDs (FE cannot navigate to s-finance-expenses-<uuid>).
    const withIds = routes.filter(rt => UUID_RE.test(rt));
    expect(withIds.length === 0, `action_routes embed entity IDs (FE cannot navigate): ${withIds.join(', ')}`);
    // Reject routes with characters the slug converter can't handle (spaces, colons, etc.).
    const malformed = routes.filter(rt => !SLUG_RE.test(rt.replace(/^\/+/, '')));
    expect(malformed.length === 0, `malformed action_routes (not slug-convertible): ${malformed.join(', ')}`);
  });

  await test('OPENABLE: a "new message" notification points to its THREAD (so the FE can open the conversation)', async () => {
    // The bug this missed before: message.received notifications carried the POST
    // id, not the thread id, so clicking them could navigate to Messages but never
    // open the specific thread. Exercise the real emit path, then assert the
    // notification addresses the openable record (the thread).
    const ct = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', subject: `${TAG} openable`, participantUserIds: [b.id], body: 'seed' });
    ok(ct); const threadId = ct.body.threadId; ctx.threadIds.push(threadId);
    ok(await api('communications/messages/post', T.b, { threadId, body: 'reply from B' }));
    let notif = null; const t0 = Date.now();
    while (Date.now() - t0 < 6000 && !notif) {
      const { data } = await sb.from('notifications')
        .select('type, source_type, source_id')
        .eq('user_id', admin.id).eq('type', 'communications.message.received').eq('source_id', threadId).limit(1);
      if (data && data.length) notif = data[0];
      else await new Promise(r => setTimeout(r, 250));
    }
    expect(notif, 'no message.received notification addressing the thread (FE could not deep-link it open)');
    expect(notif.source_type === 'message_thread', `source_type=${notif.source_type}, expected message_thread`);
  });

  // ───────────────────────── MESSAGES ─────────────────────────
  h.section('Communications › Messages');

  await test('createThread (admin → B)', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', subject: `${TAG} thread`, participantUserIds: [b.id], body: 'first message',
    });
    ok(r); expect(r.body.threadId, 'no threadId');
    ctx.threadId = r.body.threadId; ctx.threadIds.push(r.body.threadId);
  });
  await test('SIDE-EFFECT: participant rows written for both users', async () => {
    const { data } = await sb.from('message_participants').select('user_id').eq('thread_id', ctx.threadId).is('removed_at', null);
    const ids = (data || []).map(p => p.user_id);
    expect(ids.includes(admin.id) && ids.includes(b.id), `participants wrong: ${JSON.stringify(ids)}`);
  });
  await test('inbox lists the new thread', async () => {
    const r = await api('communications/messages/threads', T.admin, { tab: 'inbox', limit: 100 });
    ok(r); expect((r.body.data || []).some(t => t.id === ctx.threadId), 'thread missing from inbox');
  });
  for (const tab of ['inbox', 'sent', 'archived', 'all']) {
    await test(`threads/${tab} returns array`, async () => {
      const r = await api('communications/messages/threads', T.admin, { tab, limit: 20 });
      ok(r); expect(Array.isArray(r.body.data), 'data not array');
    });
  }
  await test('thread detail has named participants', async () => {
    const r = await api('communications/messages/thread', T.admin, { threadId: ctx.threadId });
    ok(r);
    const ps = r.body.data?.participants || [];
    expect(ps.length >= 2, `expected >=2 participants, got ${ps.length}`);
    expect(ps.some(p => p.displayName || p.email), 'participants missing displayName/email (full_name join)');
  });
  await test('posts returns the seeded message with author name', async () => {
    const r = await api('communications/messages/posts', T.admin, { threadId: ctx.threadId, limit: 100 });
    ok(r); expect((r.body.data || []).length >= 1, 'no posts returned');
    expect(r.body.data[0].authorName, 'post missing authorName (full_name join)');
  });
  await test('participant B can read posts', async () => ok(await api('communications/messages/posts', T.b, { threadId: ctx.threadId, limit: 100 }), 'participant B denied'));
  await test('ACCESS: non-participant C is denied posts', async () => {
    const r = await api('communications/messages/posts', T.c, { threadId: ctx.threadId, limit: 100 });
    fails(r, 'non-participant should NOT read posts');
    expect(['forbidden', 'compliance_required'].includes(r.body.code), `unexpected denial code: ${r.body.code}`);
  });
  await test('post a reply (admin)', async () => {
    const r = await api('communications/messages/post', T.admin, { threadId: ctx.threadId, body: `${TAG} reply` });
    ok(r); expect(r.body.postId, 'no postId');
  });
  await test('SIDE-EFFECT: thread.last_post_preview updated', async () => {
    const { data } = await sb.from('message_threads').select('last_post_preview').eq('id', ctx.threadId).single();
    expect((data?.last_post_preview || '').includes(TAG), `preview not updated: ${data?.last_post_preview}`);
  });
  await test('post count increased to >=2', async () => {
    const r = await api('communications/messages/posts', T.admin, { threadId: ctx.threadId, limit: 100 });
    ok(r); expect(r.body.data.length >= 2, `expected >=2 posts, got ${r.body.data.length}`);
  });
  await test('markRead (B reads the thread)', async () => ok(await api('communications/messages/markRead', T.b, { threadId: ctx.threadId })));
  await test('participants/add (admin adds C)', async () => ok(await api('communications/messages/participants/add', T.admin, { threadId: ctx.threadId, userIds: [c.id] })));
  await test('C can read after being added', async () => ok(await api('communications/messages/posts', T.c, { threadId: ctx.threadId, limit: 100 }), 'C denied after add'));
  await test('participants/remove (admin removes C)', async () => ok(await api('communications/messages/participants/remove', T.admin, { threadId: ctx.threadId, userId: c.id })));
  await test('ACCESS: C denied again after removal', async () => fails(await api('communications/messages/posts', T.c, { threadId: ctx.threadId, limit: 100 }), 'removed participant still has access'));
  await test('archive then unarchive', async () => {
    ok(await api('communications/messages/archive', T.admin, { threadId: ctx.threadId, archived: true }), 'archive failed');
    ok(await api('communications/messages/archive', T.admin, { threadId: ctx.threadId, archived: false }), 'unarchive failed');
  });
  await test('recipients search returns array', async () => {
    const r = await api('communications/messages/recipients', T.admin, {});
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('message search returns array', async () => {
    const r = await api('communications/messages/search', T.admin, { query: TAG, limit: 20 });
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });
  await test('attachments/upload-url returns a presigned URL', async () => {
    const r = await api('communications/messages/attachments/upload-url', T.admin, { fileName: 'test.png', mimeType: 'image/png' });
    ok(r); expect(r.body.data?.uploadUrl, 'no uploadUrl');
  });
  await test('compliance/search is gated (array or denied, never crash)', async () => {
    const r = await api('communications/messages/compliance/search', T.admin, { limit: 10 });
    expect(typeof r.body?.success === 'boolean', 'no response');
    if (r.body.success) expect(Array.isArray(r.body.data), 'data not array');
  });

  // ──────────── NEW MESSAGE DIALOG (compose) ────────────
  h.section('Communications › New Message dialog (compose)');

  await test('compose: recipient picker returns active users and excludes self', async () => {
    const r = await api('communications/messages/recipients', T.admin, {});
    ok(r);
    const ids = (r.body.data || []).map(u => u.userId);
    expect(ids.length >= 1, 'no recipients returned');
    expect(!ids.includes(admin.id), 'recipient picker must exclude the current user');
  });
  await test('compose: DIRECT thread (1 recipient) → threadType direct', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', subject: `${TAG} direct`, participantUserIds: [b.id], body: 'hi' });
    ok(r); expect(r.body.threadId, 'no threadId'); ctx.threadIds.push(r.body.threadId);
    const { data } = await sb.from('message_threads').select('thread_type').eq('id', r.body.threadId).single();
    expect(data?.thread_type === 'direct', `expected direct, got ${data?.thread_type}`);
  });
  await test('compose: GROUP thread (3 participants) → threadType group, all added', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'group', subject: `${TAG} group`, participantUserIds: [b.id, c.id], body: 'team hello' });
    ok(r); expect(r.body.threadId, 'no threadId'); ctx.threadIds.push(r.body.threadId);
    const { data } = await sb.from('message_participants').select('user_id').eq('thread_id', r.body.threadId).is('removed_at', null);
    const ids = (data || []).map(p => p.user_id);
    expect(ids.includes(admin.id) && ids.includes(b.id) && ids.includes(c.id), `group participants wrong: ${JSON.stringify(ids)}`);
    const { data: th } = await sb.from('message_threads').select('thread_type').eq('id', r.body.threadId).single();
    expect(th?.thread_type === 'group', `expected group, got ${th?.thread_type}`);
  });
  await test('compose: thread WITHOUT a subject succeeds (subject optional)', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', participantUserIds: [b.id], body: 'no subject here' });
    ok(r); expect(r.body.threadId, 'no threadId'); ctx.threadIds.push(r.body.threadId);
  });
  await test('compose VALIDATION: empty body is rejected by the backend', async () => {
    fails(await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', participantUserIds: [b.id], body: '' }), 'empty body should be rejected');
  });
  await test('compose VALIDATION: no recipients is rejected by the backend', async () => {
    fails(await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', participantUserIds: [], body: 'hi' }), 'no participants should be rejected');
  });
  await test('compose VALIDATION: an invalid recipient id is rejected (not silently dropped)', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', participantUserIds: ['USR-DOES-NOT-EXIST'], body: 'hi' });
    // Must NOT create a thread with only the author. Either rejected, or created
    // with the author only is a bug — assert it's rejected.
    fails(r, 'thread with a non-existent recipient should be rejected');
  });

  // ──────────── FILES, STATUS & CONCURRENCY ────────────
  h.section('Communications › Messages: files, status & concurrency');

  const uploadedPaths = [];
  h.onCleanup(async () => {
    await sb.from('message_attachments').delete().ilike('file_name', `${TAG}%`);
    if (uploadedPaths.length) await sb.storage.from('message-attachments').remove(uploadedPaths).catch(() => {});
  });

  // 1×1 transparent PNG
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  await test('file upload: presign → PUT to storage → create record → attach → retrieve', async () => {
    const up = await api('communications/messages/attachments/upload-url', T.admin, { fileName: `${TAG}.png`, mimeType: 'image/png' });
    ok(up, 'upload-url failed');
    const { uploadUrl, path } = up.body.data || {};
    expect(uploadUrl && path, 'missing uploadUrl/path');
    uploadedPaths.push(path);

    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: PNG });
    expect(put.ok, `storage PUT failed: ${put.status}`);

    const cr = await api('communications/messages/attachments/create', T.admin, { fileName: `${TAG}.png`, filePath: path, contentType: 'image/png', sizeBytes: PNG.length });
    ok(cr, 'attachment create failed'); expect(cr.body.id, 'no attachment id');

    const pm = await api('communications/messages/post', T.admin, { threadId: ctx.threadId, body: `${TAG} file-msg`, attachmentIds: [cr.body.id] });
    ok(pm, 'post with attachment failed');

    const posts = await api('communications/messages/posts', T.admin, { threadId: ctx.threadId, limit: 100 });
    ok(posts);
    const post = (posts.body.data || []).find(p => p.id === pm.body.postId);
    expect(post, 'attachment post not found');
    expect((post.attachments || []).length === 1, `expected 1 attachment, got ${(post.attachments || []).length}`);
    expect(post.attachments[0].fileName === `${TAG}.png`, 'wrong fileName');
    expect(post.attachments[0].url, 'attachment missing signed download url');
  });

  await test('uploaded file is actually downloadable via the signed url (bytes match)', async () => {
    const posts = await api('communications/messages/posts', T.admin, { threadId: ctx.threadId, limit: 100 });
    const att = (posts.body.data || []).flatMap(p => p.attachments || []).find(a => a.fileName === `${TAG}.png`);
    expect(att?.url, 'no attachment url');
    const dl = await fetch(att.url);
    expect(dl.ok, `download failed: ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    expect(buf.length === PNG.length, `downloaded ${buf.length} bytes, expected ${PNG.length}`);
  });

  await test('status: recipient unreadCount rises on new msg, resets on read', async () => {
    const ct = await api('communications/messages/createThread', T.admin, { threadType: 'direct', subject: `${TAG} status-thread`, participantUserIds: [b.id], body: 'hi' });
    ok(ct); ctx.threadIds.push(ct.body.threadId); const id = ct.body.threadId;
    const inB = async () => (await api('communications/messages/threads', T.b, { tab: 'inbox', limit: 100 })).body.data?.find(t => t.id === id);
    const t1 = await inB();
    expect(t1 && t1.unreadCount >= 1, `expected unreadCount>=1, got ${t1?.unreadCount}`);
    ok(await api('communications/messages/markRead', T.b, { threadId: id }));
    const t2 = await inB();
    expect(t2 && t2.unreadCount === 0, `expected unreadCount 0 after read, got ${t2?.unreadCount}`);
  });

  await test('status: archive removes from inbox → archived tab, isArchived flips, unarchive reverses', async () => {
    const ct = await api('communications/messages/createThread', T.admin, { threadType: 'direct', subject: `${TAG} arch-thread`, participantUserIds: [b.id], body: 'hi' });
    ok(ct); ctx.threadIds.push(ct.body.threadId); const id = ct.body.threadId;
    ok(await api('communications/messages/archive', T.admin, { threadId: id, archived: true }));
    const inbox = (await api('communications/messages/threads', T.admin, { tab: 'inbox', limit: 100 })).body.data || [];
    const archived = (await api('communications/messages/threads', T.admin, { tab: 'archived', limit: 100 })).body.data || [];
    expect(!inbox.some(t => t.id === id), 'archived thread still shows in inbox');
    const a = archived.find(t => t.id === id);
    expect(a && a.isArchived === true, 'thread not in archived tab / isArchived false');
    ok(await api('communications/messages/archive', T.admin, { threadId: id, archived: false }));
    const inbox2 = (await api('communications/messages/threads', T.admin, { tab: 'inbox', limit: 100 })).body.data || [];
    expect(inbox2.some(t => t.id === id), 'unarchived thread not back in inbox');
  });

  await test('concurrency: 8 messages posted at once all land, no loss, no dupes, in order', async () => {
    const ct = await api('communications/messages/createThread', T.admin, { threadType: 'direct', subject: `${TAG} bulk-thread`, participantUserIds: [b.id], body: 'seed' });
    ok(ct); ctx.threadIds.push(ct.body.threadId); const id = ct.body.threadId;
    const N = 8;
    const res = await Promise.all(Array.from({ length: N }, (_, i) => api('communications/messages/post', T.admin, { threadId: id, body: `${TAG} bulk ${i}` })));
    res.forEach((r, i) => ok(r, `bulk post ${i} failed`));
    const postIds = res.map(r => r.body.postId);
    expect(new Set(postIds).size === N, 'duplicate/missing postIds from concurrent posts');
    const posts = (await api('communications/messages/posts', T.admin, { threadId: id, limit: 100 })).body.data || [];
    const bulk = posts.filter(p => (p.body || '').includes(`${TAG} bulk`));
    expect(bulk.length === N, `expected ${N} bulk posts, found ${bulk.length}`);
    const times = posts.map(p => p.createdAt);
    expect(JSON.stringify(times) === JSON.stringify([...times].sort()), 'posts not returned in created_at order');
  });

  await test('concurrency: recipient unread reflects the bulk burst, clears on read', async () => {
    const list = (await api('communications/messages/threads', T.b, { tab: 'inbox', limit: 100 })).body.data || [];
    const bulk = list.find(t => (t.subject || '').includes('bulk-thread'));
    expect(bulk, 'bulk thread not visible to B');
    expect(bulk.unreadCount >= 1, `expected unread for B, got ${bulk.unreadCount}`);
    ok(await api('communications/messages/markRead', T.b, { threadId: bulk.id }));
    const list2 = (await api('communications/messages/threads', T.b, { tab: 'inbox', limit: 100 })).body.data || [];
    const bulk2 = list2.find(t => t.id === bulk.id);
    expect(bulk2 && bulk2.unreadCount === 0, `expected 0 unread after read, got ${bulk2?.unreadCount}`);
  });

  // ─────────────── BADGE & REALTIME FRESHNESS ───────────────
  // The header badge is driven by /summary (notificationsUnread / messagesUnread).
  // "Instant" updates come from a communication_signals row (keyed by the user's
  // realtime channel_key) the backend writes on new notif/message/read — the FE
  // subscribes to it and refetches the summary. We test: (a) the count is correct
  // on read, (b) the signal row is actually written, (c) the latency.
  h.section('Communications › Badge & realtime freshness');

  const sumN = async (tok) => (await api('communications/summary', tok)).body.data?.notificationsUnread ?? 0;
  const sumM = async (tok) => (await api('communications/summary', tok)).body.data?.messagesUnread ?? 0;
  const touchedChannels = new Set();
  h.onCleanup(async () => { if (touchedChannels.size) await sb.from('communication_signals').delete().in('channel_key', [...touchedChannels]); });

  async function waitForSignal(chan, domains, ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const { data } = await sb.from('communication_signals').select('domain').eq('channel_key', chan);
      if ((data || []).some(r => domains.includes(r.domain))) return Date.now() - t0;
      await new Promise(r => setTimeout(r, 120));
    }
    return -1;
  }

  await test('notification badge: unread +1 on new, −1 on read', async () => {
    const before = await sumN(T.admin);
    ok(await api('communications/notifications/broadcast', T.admin, {
      audience: { type: 'users', userIds: [admin.id] }, severity: 'info', title: `${TAG} badge-notif`, body: 'badge' }), 'broadcast failed');
    const mid = await sumN(T.admin);
    expect(mid === before + 1, `unread expected ${before}→${before + 1}, got ${mid}`);
    const list = await api('communications/notifications/list', T.admin, { limit: 50, search: `${TAG} badge-notif` });
    const id = (list.body.data || []).find(n => (n.title || '').includes('badge-notif'))?.id;
    expect(id, 'badge notif not found in list');
    ok(await api('communications/notifications/markRead', T.admin, { notificationId: id }), 'markRead failed');
    const after = await sumN(T.admin);
    expect(after === before, `unread expected back to ${before}, got ${after}`);
  });

  await test('message badge: unread +1 on new message, −1 on read (recipient B)', async () => {
    const before = await sumM(T.b);
    const ct = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', subject: `${TAG} badge-thread`, participantUserIds: [b.id], body: 'badge msg' });
    ok(ct, 'createThread failed'); ctx.threadIds.push(ct.body.threadId);
    const mid = await sumM(T.b);
    expect(mid >= before + 1, `B unread expected to rise from ${before}, got ${mid}`);
    ok(await api('communications/messages/markRead', T.b, { threadId: ct.body.threadId }), 'B markRead failed');
    const after = await sumM(T.b);
    // markRead must reduce the global badge count; pre-existing unread threads from earlier
    // test steps mean `after` may not equal `before` exactly, but it must be < mid to prove
    // that markRead had an effect. Also check the specific thread is now unread=0 for B.
    expect(after < mid, `B unread did not decrease after markRead — mid=${mid}, after=${after}`);
    const tlist = (await api('communications/messages/threads', T.b, { tab: 'inbox', limit: 200 })).body.data || [];
    const bt = tlist.find(t => t.id === ct.body.threadId);
    expect(!bt || bt.unreadCount === 0, `badge-thread still shows unreadCount=${bt?.unreadCount} for B after markRead`);
  });

  await test('realtime: a new message writes a communication_signals row for the recipient', async () => {
    const chan = (await api('communications/summary', T.b)).body.data?.realtimeChannelKey;
    expect(chan, 'no realtimeChannelKey for B'); touchedChannels.add(chan);
    const ct = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', subject: `${TAG} signal-thread`, participantUserIds: [b.id], body: 'x' });
    ok(ct); ctx.threadIds.push(ct.body.threadId);
    await sb.from('communication_signals').delete().eq('channel_key', chan);   // isolate the reply signal
    ok(await api('communications/messages/post', T.admin, { threadId: ct.body.threadId, body: 'reply' }));
    const dt = await waitForSignal(chan, ['messages']);
    expect(dt >= 0, 'no messages signal row — FE badge would NOT update in realtime');
    console.log(`\n      ⏱  message→signal: ${dt}ms`);
  });

  await test('realtime: a new notification writes a communication_signals row for the recipient', async () => {
    const chan = (await api('communications/summary', T.admin)).body.data?.realtimeChannelKey;
    expect(chan, 'no realtimeChannelKey for admin'); touchedChannels.add(chan);
    await sb.from('communication_signals').delete().eq('channel_key', chan);
    ok(await api('communications/notifications/broadcast', T.admin, {
      audience: { type: 'users', userIds: [admin.id] }, severity: 'info', title: `${TAG} signal-notif`, body: 'x' }));
    const dt = await waitForSignal(chan, ['notifications', 'summary']);
    expect(dt >= 0, 'no notifications signal row — FE badge would NOT update in realtime');
    console.log(`\n      ⏱  notification→signal: ${dt}ms`);
  });

  await test('realtime DELIVERY: the browser (anon) actually receives the signal', async () => {
    // Replicates exactly what useRealtimeSignals does in the browser. If this
    // fails, the badge + thread highlight will NOT update when a message/notif
    // arrives — they'd only refresh on the slow poll. (Needs communication_signals
    // in the supabase_realtime publication + anon SELECT RLS — mig 20260628100000.)
    const anon = h.anonClient();
    const chan = `e2e-rt-${Date.now()}`;
    let received = false;
    const ch = anon.channel(`probe-${chan}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'communication_signals', filter: `channel_key=eq.${chan}` },
        () => { received = true; })
      .subscribe();
    try {
      await new Promise(r => setTimeout(r, 2500));                 // let it SUBSCRIBE
      await sb.from('communication_signals').insert({ channel_key: chan, domain: 'messages' });
      const t0 = Date.now();
      while (Date.now() - t0 < 5000 && !received) await new Promise(r => setTimeout(r, 120));
    } finally {
      await sb.from('communication_signals').delete().eq('channel_key', chan);
      await anon.removeChannel(ch);
    }
    expect(received, 'anon realtime never received the signal — communication_signals not published for realtime or RLS blocks anon SELECT (run mig 20260628100000)');
  });

  await test('latency: summary endpoint responds quickly', async () => {
    const times = [];
    for (let i = 0; i < 3; i++) { const t0 = Date.now(); await api('communications/summary', T.admin); times.push(Date.now() - t0); }
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    console.log(`\n      ⏱  summary latency: ${avg}ms avg (${times.join('/')}ms)`);
    expect(avg < 3000, `summary too slow: ${avg}ms avg`);
  });

  // ──────────── CROSS-ROLE MESSAGING (badges & unread per role) ────────────
  h.section('Communications › Cross-role messaging');

  const unreadOf = async (tok) => (await api('communications/summary', tok)).body.data?.messagesUnread ?? 0;
  const threadUnread = async (tok, id) => {
    const r = await api('communications/messages/threads', tok, { tab: 'inbox', limit: 100 });
    return r.body.data?.find(t => t.id === id)?.unreadCount;
  };

  await test('employee → admin: admin badge + thread unread rise, reset on read', async () => {
    const before = await unreadOf(T.admin);
    const ct = await api('communications/messages/createThread', T.b, {
      threadType: 'direct', subject: `${TAG} emp2admin`, participantUserIds: [admin.id], body: 'hi boss' });
    ok(ct, 'employee could not message admin'); ctx.threadIds.push(ct.body.threadId);
    expect(await unreadOf(T.admin) === before + 1, 'admin badge (messagesUnread) did not rise');
    expect(await threadUnread(T.admin, ct.body.threadId) === 1, 'admin thread unreadCount != 1');
    expect((await threadUnread(T.b, ct.body.threadId) ?? 0) === 0, 'sender (employee) sees own message as unread');
    ok(await api('communications/messages/markRead', T.admin, { threadId: ct.body.threadId }));
    expect(await unreadOf(T.admin) === before, 'admin badge did not reset on read');
  });

  await test('admin → employee: employee badge + thread unread rise, reset on read', async () => {
    const before = await unreadOf(T.b);
    const ct = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', subject: `${TAG} admin2emp`, participantUserIds: [b.id], body: 'hi team' });
    ok(ct); ctx.threadIds.push(ct.body.threadId);
    expect(await unreadOf(T.b) === before + 1, 'employee badge did not rise');
    expect(await threadUnread(T.b, ct.body.threadId) === 1, 'employee thread unreadCount != 1');
    ok(await api('communications/messages/markRead', T.b, { threadId: ct.body.threadId }));
    expect(await unreadOf(T.b) === before, 'employee badge did not reset');
  });

  await test('employee → employee: recipient gets unread, sender does not', async () => {
    const before = await unreadOf(T.c);
    const ct = await api('communications/messages/createThread', T.b, {
      threadType: 'direct', subject: `${TAG} emp2emp`, participantUserIds: [c.id], body: 'hey' });
    ok(ct); ctx.threadIds.push(ct.body.threadId);
    expect(await unreadOf(T.c) === before + 1, 'recipient employee badge did not rise');
    expect((await threadUnread(T.b, ct.body.threadId) ?? 0) === 0, 'sender employee sees own as unread');
  });

  await test('group (admin+B+C): a post raises unread for BOTH others, not the author; reads are per-user', async () => {
    const ct = await api('communications/messages/createThread', T.admin, {
      threadType: 'group', subject: `${TAG} xrole-group`, participantUserIds: [b.id, c.id], body: 'kickoff' });
    ok(ct); const id = ct.body.threadId; ctx.threadIds.push(id);
    expect(await threadUnread(T.b, id) === 1, 'B unread != 1');
    expect(await threadUnread(T.c, id) === 1, 'C unread != 1');
    expect((await threadUnread(T.admin, id) ?? 0) === 0, 'author (admin) should have 0 unread');
    ok(await api('communications/messages/markRead', T.b, { threadId: id }));
    expect((await threadUnread(T.b, id) ?? 0) === 0, 'B unread not cleared after read');
    expect(await threadUnread(T.c, id) === 1, 'C unread should REMAIN after B reads (per-user state)');
  });

  await test('BADGE↔UNREAD-TAB: your OWN message must NOT inflate your badge', async () => {
    // The bug: summary.messagesUnread counted any thread whose last post was after
    // your last_read_at — including your OWN posts — so the badge showed "1 unread"
    // while the Unread tab (others-only) was empty.
    const before = await unreadOf(T.admin);
    const ct = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', subject: `${TAG} selfbadge`, participantUserIds: [b.id], body: 'hi' });
    ok(ct); const id = ct.body.threadId; ctx.threadIds.push(id);
    ok(await api('communications/messages/post', T.admin, { threadId: id, body: 'second own message' }));
    const after = await unreadOf(T.admin);
    expect(after === before, `own messages raised your own badge ${before}→${after} (badge>0 but Unread tab would be empty)`);
    expect((await threadUnread(T.admin, id) ?? 0) === 0, 'author thread shows unreadCount>0');
  });

  await test('BADGE↔UNREAD-TAB: badge equals the number of inbox threads with unreadCount>0', async () => {
    // The exact invariant the dropdown relies on: messagesUnread === #(threads in
    // the Unread tab). Uses the recipient (B) with a fresh unread thread.
    const ct = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', subject: `${TAG} invariant`, participantUserIds: [b.id], body: 'unread for B' });
    ok(ct); ctx.threadIds.push(ct.body.threadId);
    const badge   = await unreadOf(T.b);
    const threads = (await api('communications/messages/threads', T.b, { tab: 'inbox', limit: 100 })).body.data || [];
    const tabCount = threads.filter(t => t.unreadCount > 0).length;
    // Equality holds as long as B has ≤100 unread threads (the tab page size).
    expect(badge === tabCount || (badge > 100 && tabCount === 100),
      `badge says ${badge} unread but the Unread tab shows ${tabCount} threads`);
  });

  await test('group reply re-raises unread for the other members', async () => {
    const ct = await api('communications/messages/createThread', T.admin, {
      threadType: 'group', subject: `${TAG} xrole-reply`, participantUserIds: [b.id, c.id], body: 'one' });
    ok(ct); const id = ct.body.threadId; ctx.threadIds.push(id);
    await api('communications/messages/markRead', T.b, { threadId: id });
    ok(await api('communications/messages/post', T.b, { threadId: id, body: 'two from B' }));
    expect((await threadUnread(T.admin, id) ?? 0) >= 1, 'admin did not get unread from B reply');
    expect((await threadUnread(T.c, id) ?? 0) >= 1, 'C did not get unread from B reply');
  });

  // ───────────────────────── PINS · DRAFTS · PRESENCE ─────────────────────────
  // Rich Message Center add-on (migration 20260629000000). Threads created here
  // are pushed to ctx.threadIds; pins/drafts/receipts cascade-delete with them.
  h.section('Communications › Pins · Drafts · Presence');

  const pdp = {};
  await test('setup: thread (admin → B) for pins/drafts', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', participantUserIds: [admin.id, b.id], body: `${TAG} pin/draft seed`,
    });
    ok(r); pdp.threadId = r.body.threadId; pdp.postId = r.body.postId; ctx.threadIds.push(r.body.threadId);
    expect(pdp.postId, 'no seed postId from createThread');
  });

  // ── Pins ──
  await test('pin a post (personal) returns a pin', async () => {
    const r = await api('communications/messages/pins/pin', T.admin, {
      threadId: pdp.threadId, postId: pdp.postId, pinType: 'post', visibility: 'personal',
    });
    ok(r); expect(r.body.data?.id, 'no pin id'); expect(r.body.data?.pinType === 'post', 'wrong pinType');
    pdp.personalPinId = r.body.data.id;
  });
  await test('CONTRACT: pins/list returns the pin with expected shape', async () => {
    const r = await api('communications/messages/pins/list', T.admin, { threadId: pdp.threadId });
    ok(r); const p = (r.body.data || []).find(x => x.id === pdp.personalPinId);
    expect(p, 'personal pin missing from list');
    expect(p.threadId === pdp.threadId && p.visibility === 'personal' && !!p.pinnedBy?.displayName, 'pin shape wrong');
  });
  await test('personal pin is private to its creator (B cannot see it)', async () => {
    const r = await api('communications/messages/pins/list', T.b, { threadId: pdp.threadId });
    ok(r); expect(!(r.body.data || []).some(x => x.id === pdp.personalPinId), 'personal pin leaked to other user');
  });
  await test('SIDE-EFFECT: pin wrote app_events communications.message_pinned', async () => {
    const { data } = await sb.from('app_events').select('id')
      .eq('event_type', 'communications.message_pinned').eq('source_entity_id', pdp.personalPinId).limit(1);
    expect((data || []).length === 1, 'message_pinned app_event not written');
  });
  await test('owner can thread-pin; visible to participant B', async () => {
    const r = await api('communications/messages/pins/pin', T.admin, {
      threadId: pdp.threadId, pinType: 'thread', visibility: 'thread', note: `${TAG} pinned convo`,
    });
    ok(r); pdp.threadPinId = r.body.data?.id;
    const lb = await api('communications/messages/pins/list', T.b, { threadId: pdp.threadId });
    ok(lb); expect((lb.body.data || []).some(x => x.id === pdp.threadPinId), 'thread pin not visible to participant');
  });
  await test('CONTRACT: pinned-summary includes the pinned thread', async () => {
    const r = await api('communications/messages/pins/pinned-summary', T.admin);
    ok(r); expect(Array.isArray(r.body.data), 'not array');
    expect((r.body.data || []).some(x => x.threadId === pdp.threadId), 'pinned thread missing from summary');
  });
  await test('ACCESS: non-participant C cannot pin', async () =>
    fails(await api('communications/messages/pins/pin', T.c, { threadId: pdp.threadId, postId: pdp.postId, pinType: 'post', visibility: 'personal' }), 'non-participant pinned'));
  await test('VALIDATION: post pin without postId is rejected', async () =>
    fails(await api('communications/messages/pins/pin', T.admin, { threadId: pdp.threadId, pinType: 'post', visibility: 'personal' }), 'post pin without postId accepted'));
  await test('unpin own pin removes it from the list', async () => {
    ok(await api('communications/messages/pins/unpin', T.admin, { pinId: pdp.personalPinId }));
    const r = await api('communications/messages/pins/list', T.admin, { threadId: pdp.threadId });
    ok(r); expect(!(r.body.data || []).some(x => x.id === pdp.personalPinId), 'unpinned pin still listed');
  });
  await test('ACCESS: C (finance_manager, no unpin_any) cannot unpin admin thread-pin', async () => {
    // Manager (B) intentionally has communications.messages.unpin_any per the permissions seed.
    // Use C (finance_manager) which does NOT have unpin_any to verify the guard fires.
    fails(await api('communications/messages/pins/unpin', T.c, { pinId: pdp.threadPinId }), 'finance_manager unpinned someone elses pin without unpin_any');
  });


  // ── Drafts ──
  await test('draft/save stores a draft', async () =>
    ok(await api('communications/messages/draft/save', T.admin, { threadId: pdp.threadId, body: `${TAG} unsent draft` })));
  await test('draft/get returns the saved body', async () => {
    const r = await api('communications/messages/draft/get', T.admin, { threadId: pdp.threadId });
    ok(r); expect((r.body.data?.body || '').includes('unsent draft'), 'draft body not returned');
  });
  await test('CONTRACT: thread list surfaces hasDraft + draftPreview', async () => {
    const r = await api('communications/messages/threads', T.admin, { tab: 'inbox', limit: 100 });
    ok(r); const t = (r.body.data || []).find(x => x.id === pdp.threadId);
    expect(t && t.hasDraft === true && (t.draftPreview || '').includes('unsent draft'), 'hasDraft/draftPreview not surfaced');
  });
  await test('draft is per-user (B has no draft on this thread)', async () => {
    const r = await api('communications/messages/draft/get', T.b, { threadId: pdp.threadId });
    ok(r); expect(r.body.data == null, 'draft leaked across users');
  });
  await test('empty draft body deletes the draft', async () => {
    ok(await api('communications/messages/draft/save', T.admin, { threadId: pdp.threadId, body: '   ' }));
    const r = await api('communications/messages/draft/get', T.admin, { threadId: pdp.threadId });
    ok(r); expect(r.body.data == null, 'empty draft not cleared');
  });

  // ── Presence ──
  await test('presence/update accepts a heartbeat', async () =>
    ok(await api('communications/messages/presence/update', T.b, { status: 'online' })));
  await test('online: array, excludes self, includes a freshly-online peer', async () => {
    await api('communications/messages/presence/update', T.b, { status: 'online' });
    const r = await api('communications/messages/online', T.admin);
    ok(r); expect(Array.isArray(r.body.data), 'not array');
    expect(!(r.body.data || []).some(u => u.userId === admin.id), 'online list included self');
    expect((r.body.data || []).some(u => u.userId === b.id), 'freshly-online peer B missing');
  });

  // ───────────────────────── TICKETS ─────────────────────────
  h.section('Communications › Tickets');

  await test('create ticket', async () => {
    const r = await api('communications/tickets/create', T.admin, {
      category: 'it_support', priority: 'medium', subject: `${TAG} ticket`, description: 'integration test',
    });
    ok(r); expect(r.body.ticketId, 'no ticketId');
    ctx.ticketId = r.body.ticketId; ctx.ticketIds.push(r.body.ticketId);
  });
  await test('ticket appears in list', async () => {
    const r = await api('communications/tickets/list', T.admin, { mine: true, limit: 50 });
    ok(r); expect((r.body.data || []).some(t => t.id === ctx.ticketId), 'ticket not in list');
  });
  await test('get ticket detail', async () => {
    const r = await api('communications/tickets/get', T.admin, { ticketId: ctx.ticketId });
    ok(r); expect(r.body.data?.ticket?.id === ctx.ticketId, 'detail mismatch');
  });
  await test('comment on ticket', async () => ok(await api('communications/tickets/comment', T.admin, { ticketId: ctx.ticketId, body: 'a comment' })));
  await test('update ticket status', async () => ok(await api('communications/tickets/update', T.admin, { ticketId: ctx.ticketId, status: 'in_progress' })));
}
