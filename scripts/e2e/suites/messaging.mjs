/**
 * scripts/e2e/suites/messaging.mjs
 *
 * P0 Hardening E2E suite — Messaging Backend (Track 1).
 * Contract: netlify/functions/lib/messaging/MESSAGING_P0_CONTRACT.md
 *
 * Covers:
 *   1. Atomic create-thread: side-effects, sequence=1, both participants
 *   2. Atomic send-message: sequence monotonicity, delivery receipts, outbox
 *   3. Access control: non-participant denied on post/pin
 *   4. Membership: remove / re-add (UPSERT re-entry fix), last-owner guard, DM invariants
 *   5. Pin / unpin: atomic (version bump, app_events), conflict guard, version-If-Match
 *   6. Mark-read cursor: upToSequence, monotonic, set-based receipts
 *   7. Attachment guards: cross-user hijack, blocked scan status
 *   8. Atomic rollback: bad attachment on createThread leaves no orphan thread
 *   9. Response-shape contract: sequence present on posts, threads endpoint healthy
 *
 * Runs against: npm run dev:netlify (compiled dist/ — must build:backend first)
 * Run: npm run test:e2e -- messaging
 */

export const title = 'Messaging — P0 Hardening (create/send/membership/pin/read)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };

  const ctx = {
    threadIds: [],
    postIds:   [],
    pinIds:    [],
    attIds:    [],
  };

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  h.onCleanup(async () => {
    if (ctx.pinIds.length)  await sb.from('message_pins').delete().in('id', ctx.pinIds);
    if (ctx.attIds.length)  await sb.from('message_attachments').delete().in('id', ctx.attIds);
    if (ctx.postIds.length) {
      await sb.from('message_attachments').delete().in('post_id', ctx.postIds);
      await sb.from('message_post_receipts').delete().in('post_id', ctx.postIds);
    }
    if (ctx.threadIds.length) {
      await sb.from('message_event_outbox').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_posts').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_participants').delete().in('thread_id', ctx.threadIds);
      await sb.from('notifications').delete().in('source_id', ctx.threadIds);
      await sb.from('app_events').delete().in('source_entity_id', ctx.threadIds);
      await sb.from('message_threads').delete().in('id', ctx.threadIds);
    }
  });

  // ─────────────────── § 1  CREATE THREAD (atomic) ────────────────────────────
  h.section('Messaging › Atomic Create Thread');

  let threadId;
  let firstPostId;
  let threadVersion;

  await test('createThread (admin → B) returns threadId + postId', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType:         'group',
      subject:            `${TAG} P0 test thread`,
      participantUserIds: [b.id],
      body:               'hello from P0 test',
    });
    ok(r);
    expect(r.body.threadId, 'missing threadId');
    expect(r.body.postId,   'missing postId');
    threadId    = r.body.threadId;
    firstPostId = r.body.postId;
    ctx.threadIds.push(threadId);
    ctx.postIds.push(firstPostId);
  });

  await test('SIDE-EFFECT: thread row has next_message_sequence >= 1 and version >= 1', async () => {
    const { data } = await sb.from('message_threads')
      .select('next_message_sequence, version').eq('id', threadId).single();
    expect(data, 'thread row missing');
    expect(data.next_message_sequence >= 1, `next_message_sequence=${data.next_message_sequence}`);
    expect(data.version >= 1, `version=${data.version}`);
    threadVersion = data.version;
  });

  await test('SIDE-EFFECT: first post has sequence = 1', async () => {
    const { data } = await sb.from('message_posts')
      .select('sequence').eq('id', firstPostId).single();
    expect(data.sequence === 1, `sequence=${data.sequence}, expected 1`);
  });

  await test('SIDE-EFFECT: both participants present, admin = owner', async () => {
    const { data } = await sb.from('message_participants')
      .select('user_id, role').eq('thread_id', threadId).is('removed_at', null);
    const ids = (data ?? []).map(p => p.user_id);
    expect(ids.includes(admin.id), 'admin not a participant');
    expect(ids.includes(b.id),     'b not a participant');
    const adminRow = (data ?? []).find(p => p.user_id === admin.id);
    expect(adminRow?.role === 'owner', `admin role=${adminRow?.role}, expected owner`);
  });

  await test('SIDE-EFFECT: app_events row written for thread creation', async () => {
    const { data } = await sb.from('app_events')
      .select('event_type').eq('event_type', 'communications.thread.created')
      .eq('source_entity_id', threadId).limit(1);
    expect(data && data.length > 0, 'no app_events row for thread.created');
  });

  await test('SIDE-EFFECT: message_event_outbox row written (thread.created)', async () => {
    const { data } = await sb.from('message_event_outbox')
      .select('event_type').eq('thread_id', threadId).eq('event_type', 'thread.created').limit(1);
    expect(data && data.length > 0, 'no outbox row for thread.created');
  });

  // ─────────────────── § 2  SEND MESSAGE (atomic) ──────────────────────────────
  h.section('Messaging › Atomic Send Message');

  let postId2;

  await test('postMessage by B returns postId', async () => {
    const r = await api('communications/messages/post', T.b, {
      threadId,
      body: `${TAG} reply from B`,
    });
    ok(r);
    expect(r.body.postId, 'missing postId');
    postId2 = r.body.postId;
    ctx.postIds.push(postId2);
  });

  await test('SIDE-EFFECT: second post has sequence = 2', async () => {
    const { data } = await sb.from('message_posts')
      .select('sequence').eq('id', postId2).single();
    expect(data.sequence === 2, `sequence=${data.sequence}, expected 2`);
  });

  await test('SIDE-EFFECT: thread version incremented to 2 after second post', async () => {
    const { data } = await sb.from('message_threads')
      .select('version, next_message_sequence').eq('id', threadId).single();
    expect(data.next_message_sequence === 2, `next_message_sequence=${data.next_message_sequence}`);
    expect(data.version === 2, `thread.version=${data.version}, expected 2`);
  });

  await test('SIDE-EFFECT: delivery receipt created for admin (not for sender B)', async () => {
    const { data: adminRcpt } = await sb.from('message_post_receipts')
      .select('delivered_at').eq('post_id', postId2).eq('user_id', admin.id).maybeSingle();
    expect(adminRcpt, 'no delivery receipt for admin after B posted');
    const { data: bRcpt } = await sb.from('message_post_receipts')
      .select('id').eq('post_id', postId2).eq('user_id', b.id).maybeSingle();
    expect(!bRcpt, 'unexpected self-receipt for sender B');
  });

  await test('SIDE-EFFECT: outbox row written (message.created)', async () => {
    const { data } = await sb.from('message_event_outbox')
      .select('event_type').eq('thread_id', threadId).eq('event_type', 'message.created').limit(1);
    expect(data && data.length > 0, 'no outbox row for message.created');
  });

  // ─────────────────── § 3  ACCESS CONTROL ─────────────────────────────────────
  h.section('Messaging › Access control');

  await test('ACCESS: non-participant (C) cannot post to thread', async () => {
    const r = await api('communications/messages/post', T.c, {
      threadId, body: 'should fail',
    });
    expect(!r.ok || r.status === 403,
      `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  // ─────────────────── § 4  MEMBERSHIP ─────────────────────────────────────────
  h.section('Messaging › Membership');

  await test('participants/add: add C to thread', async () => {
    const r = await api('communications/messages/participants/add', T.admin, {
      threadId, userIds: [c.id],
    });
    ok(r);
  });

  await test('SIDE-EFFECT: C is now an active participant', async () => {
    const { data } = await sb.from('message_participants')
      .select('user_id').eq('thread_id', threadId)
      .eq('user_id', c.id).is('removed_at', null).maybeSingle();
    expect(data, 'C not in participants after add');
  });

  await test('participants/remove: remove C', async () => {
    const r = await api('communications/messages/participants/remove', T.admin, {
      threadId, userId: c.id,
    });
    ok(r);
  });

  await test('SIDE-EFFECT: C participant row has removed_at set', async () => {
    const { data } = await sb.from('message_participants')
      .select('removed_at').eq('thread_id', threadId).eq('user_id', c.id).maybeSingle();
    expect(data?.removed_at, 'C removed_at is still null after removal');
  });

  await test('RE-ENTRY FIX: re-adding C (previously removed) succeeds (UPSERT, not PK conflict)', async () => {
    const r = await api('communications/messages/participants/add', T.admin, {
      threadId, userIds: [c.id],
    });
    ok(r);
  });

  await test('SIDE-EFFECT: C participant row has removed_at = null after re-add', async () => {
    const { data } = await sb.from('message_participants')
      .select('removed_at').eq('thread_id', threadId)
      .eq('user_id', c.id).is('removed_at', null).maybeSingle();
    expect(data, 'C removed_at not cleared after re-add');
  });

  await test('LAST-OWNER GUARD: removing admin (sole owner) returns 409', async () => {
    const r = await api('communications/messages/participants/remove', T.admin, {
      threadId, userId: admin.id,
    });
    expect(!r.ok && r.status === 409,
      `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  // DM invariants ─────────────────────────────────────────────────────────────
  let dmThreadId;
  await test('createThread: direct admin ↔ B', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'direct', participantUserIds: [b.id], body: `${TAG} dm seed`,
    });
    ok(r);
    dmThreadId = r.body.threadId;
    ctx.threadIds.push(dmThreadId);
  });

  await test('DM INVARIANT: adding C to a direct thread returns 409', async () => {
    const r = await api('communications/messages/participants/add', T.admin, {
      threadId: dmThreadId, userIds: [c.id],
    });
    expect(!r.ok && r.status === 409,
      `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('DM INVARIANT: removing B from a direct thread returns 409', async () => {
    const r = await api('communications/messages/participants/remove', T.admin, {
      threadId: dmThreadId, userId: b.id,
    });
    expect(!r.ok && r.status === 409,
      `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  // ─────────────────── § 5  PIN / UNPIN ────────────────────────────────────────
  h.section('Messaging › Pin / Unpin (atomic via pinTx)');

  let pinId;

  // Ensure C is not a participant so the non-participant access test works
  await api('communications/messages/participants/remove', T.admin, { threadId, userId: c.id });

  await test('pins/pin: pin first post (thread-visible)', async () => {
    const r = await api('communications/messages/pins/pin', T.admin, {
      threadId,
      postId:     firstPostId,
      pinType:    'post',
      visibility: 'thread',
    });
    ok(r);
    expect(r.body.data?.id, 'missing pin id in response data');
    pinId = r.body.data.id;
    ctx.pinIds.push(pinId);
  });

  await test('SIDE-EFFECT: message_pins row exists with unpinned_at = null', async () => {
    const { data } = await sb.from('message_pins')
      .select('unpinned_at').eq('id', pinId).maybeSingle();
    expect(data && data.unpinned_at === null, 'pin row not found or already unpinned');
  });

  await test('SIDE-EFFECT: thread version incremented after pin', async () => {
    const { data } = await sb.from('message_threads')
      .select('version').eq('id', threadId).single();
    expect(data.version > threadVersion,
      `thread version not incremented (${data.version} <= ${threadVersion})`);
    threadVersion = data.version;
  });

  await test('SIDE-EFFECT: app_events row written for pin (communications.message_pinned)', async () => {
    // The pin app_event is keyed by the THREAD (source_entity_type='message_thread'),
    // with the pin id carried in the payload — not by source_entity_id=pinId.
    const { data } = await sb.from('app_events')
      .select('event_type, payload').eq('event_type', 'communications.message_pinned')
      .eq('source_entity_id', threadId).limit(5);
    expect(data && data.some(r => r.payload?.pinId === pinId), 'no app_events row for pin');
  });

  await test('PIN CONFLICT: pinning same post+visibility twice returns error', async () => {
    const r = await api('communications/messages/pins/pin', T.admin, {
      threadId, postId: firstPostId, pinType: 'post', visibility: 'thread',
    });
    expect(!r.ok, `duplicate pin should have failed, got ${r.status}`);
  });

  await test('VERSION IF-MATCH: expectedVersion=0 (stale) returns 409', async () => {
    const r = await api('communications/messages/pins/pin', T.admin, {
      threadId, postId: postId2, pinType: 'post', visibility: 'thread',
      expectedVersion: 0,
    });
    expect(!r.ok && r.status === 409,
      `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('ACCESS: non-participant (C) cannot pin', async () => {
    const r = await api('communications/messages/pins/pin', T.c, {
      threadId, postId: firstPostId, pinType: 'post', visibility: 'thread',
    });
    expect(!r.ok && (r.status === 403 || r.status === 401),
      `expected 403/401, got ${r.status}`);
  });

  await test('pins/unpin: unpin by pinId', async () => {
    const r = await api('communications/messages/pins/unpin', T.admin, { pinId });
    ok(r);
  });

  await test('SIDE-EFFECT: message_pins row has unpinned_at set', async () => {
    const { data } = await sb.from('message_pins')
      .select('unpinned_at').eq('id', pinId).maybeSingle();
    expect(data?.unpinned_at, 'unpinned_at not set after unpin');
  });

  // ─────────────────── § 6  MARK READ (cursor) ─────────────────────────────────
  h.section('Messaging › Mark Read (cursor)');

  await test('markRead with upToSequence=2 sets last_read_sequence for B', async () => {
    const r = await api('communications/messages/markRead', T.b, {
      threadId,
      upToSequence: 2,
    });
    ok(r);
  });

  await test('SIDE-EFFECT: B.last_read_sequence = 2', async () => {
    const { data } = await sb.from('message_participants')
      .select('last_read_sequence')
      .eq('thread_id', threadId).eq('user_id', b.id).maybeSingle();
    expect(data?.last_read_sequence === 2,
      `last_read_sequence=${data?.last_read_sequence}, expected 2`);
  });

  await test('MONOTONIC: markRead with lower sequence (1) does not regress cursor', async () => {
    await api('communications/messages/markRead', T.b, { threadId, upToSequence: 1 });
    const { data } = await sb.from('message_participants')
      .select('last_read_sequence')
      .eq('thread_id', threadId).eq('user_id', b.id).maybeSingle();
    expect(data?.last_read_sequence === 2,
      `cursor regressed to ${data?.last_read_sequence} after lower-seq markRead`);
  });

  await test('markRead without upToSequence (legacy path) succeeds', async () => {
    const r = await api('communications/messages/markRead', T.admin, { threadId });
    ok(r);
  });

  // ─────────────────── § 7  ATTACHMENT GUARDS ──────────────────────────────────
  h.section('Messaging › Attachment Guards');

  let blockedAttId;
  let crossUserAttId;

  await test('Setup: seed blocked-scan + cross-user attachment rows via service_role', async () => {
    const { data: blocked } = await sb.from('message_attachments').insert({
      post_id:       null,
      file_name:     `${TAG}-blocked.pdf`,
      file_path:     `test/${TAG}/blocked.pdf`,
      uploaded_by:   admin.id,
      scan_status:   'blocked',
      upload_status: 'uploaded',
    }).select('id').single();
    expect(blocked, 'failed to seed blocked attachment');
    blockedAttId = blocked.id;
    ctx.attIds.push(blockedAttId);

    // Clean scan but owned by B — admin sending it should 403 (cross-user hijack)
    const { data: other } = await sb.from('message_attachments').insert({
      post_id:       null,
      file_name:     `${TAG}-other.pdf`,
      file_path:     `test/${TAG}/other.pdf`,
      uploaded_by:   b.id,
      scan_status:   'clean',
      upload_status: 'uploaded',
    }).select('id').single();
    expect(other, 'failed to seed cross-user attachment');
    crossUserAttId = other.id;
    ctx.attIds.push(crossUserAttId);
  });

  await test('ATTACHMENT GUARD: sending blocked attachment returns 422', async () => {
    const r = await api('communications/messages/post', T.admin, {
      threadId,
      body:          null,
      attachmentIds: [blockedAttId],
    });
    expect(!r.ok && r.status === 422,
      `expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test("CROSS-USER HIJACK: sending another user's attachment returns 403", async () => {
    const r = await api('communications/messages/post', T.admin, {
      threadId,
      body:          null,
      attachmentIds: [crossUserAttId],
    });
    expect(!r.ok && r.status === 403,
      `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  // ─────────────────── § 8  ATOMIC ROLLBACK ────────────────────────────────────
  h.section('Messaging › Atomic rollback (bad attachment)');

  await test('createThread with invalid attachmentId leaves no orphaned thread', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const { count: before } = await sb.from('message_threads')
      .select('id', { count: 'exact', head: true });

    const r = await api('communications/messages/createThread', T.admin, {
      threadType:         'group',
      subject:            `${TAG} rollback test`,
      participantUserIds: [b.id],
      body:               'seed',
      attachmentIds:      [fakeId],
    });
    expect(!r.ok, 'createThread should fail with a bad attachmentId');

    const { count: after } = await sb.from('message_threads')
      .select('id', { count: 'exact', head: true });
    expect(after === before,
      `thread count changed: ${before} → ${after} (orphan thread created)`);
  });

  // ─────────────────── § 9  RESPONSE-SHAPE CONTRACT ────────────────────────────
  h.section('Messaging › Response-shape contract');

  await test('posts list returns sequence field on P0-created posts', async () => {
    const r = await api('communications/messages/posts', T.admin, {
      threadId, limit: 10,
    });
    ok(r);
    const posts = r.body.data ?? [];
    const withSeq = posts.filter(p => p.sequence != null);
    expect(withSeq.length > 0 || posts.length === 0,
      `0 of ${posts.length} posts have sequence field`);
  });

  await test('threads endpoint is healthy and returns an array', async () => {
    const r = await api('communications/messages/threads', T.admin, {
      tab: 'all', limit: 50,
    });
    ok(r);
    const threads = r.body.data ?? r.body;
    expect(Array.isArray(threads), 'threads endpoint did not return an array');
  });
}
