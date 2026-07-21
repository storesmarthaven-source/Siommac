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

  // ─────────────────── § 6b  SOFT-DELETE (atomic via deleteMessageTx) ───────────
  h.section('Messaging › Soft-delete');

  let delPostId, modPostId;

  await test('author soft-deletes own message within the 15-min window', async () => {
    const p = await api('communications/messages/post', T.b, { threadId, body: `${TAG} to-delete` });
    ok(p, `seed post failed: ${p.body.message}`);
    delPostId = p.body.postId; ctx.postIds.push(delPostId);
    const r = await api('communications/messages/delete', T.b, { postId: delPostId });
    ok(r, `delete failed: ${r.body.message}`);
    const { data } = await sb.from('message_posts').select('deleted_at, deleted_by').eq('id', delPostId).single();
    expect(data?.deleted_at != null, 'deleted_at not set');
    expect(data?.deleted_by === b.id, `deleted_by should be the author, got ${data?.deleted_by}`);
  });

  await test('SIDE-EFFECT: communications.message.deleted app_event written', async () => {
    const { data: ev } = await sb.from('app_events').select('id, payload')
      .eq('event_type', 'communications.message.deleted').eq('source_entity_id', threadId);
    expect((ev ?? []).some(e => e.payload?.postId === delPostId), 'no message.deleted event for the post');
  });

  await test('idempotent: deleting an already-deleted message still succeeds', async () => {
    const r = await api('communications/messages/delete', T.b, { postId: delPostId });
    ok(r, `idempotent re-delete failed: ${r.body.message}`);
  });

  await test('moderation delete WITHOUT a reason is rejected (400)', async () => {
    const p = await api('communications/messages/post', T.b, { threadId, body: `${TAG} mod-target` });
    ok(p); modPostId = p.body.postId; ctx.postIds.push(modPostId);
    const r = await api('communications/messages/delete', T.admin, { postId: modPostId });
    fails(r, 'moderator delete without a reason should be rejected');
  });

  await test('moderator (delete_any) soft-deletes any message WITH a reason', async () => {
    const r = await api('communications/messages/delete', T.admin, { postId: modPostId, reason: 'Policy violation' });
    ok(r, `moderator delete failed: ${r.body.message}`);
    const { data } = await sb.from('message_posts').select('deleted_at, deleted_by').eq('id', modPostId).single();
    expect(data?.deleted_at != null && data?.deleted_by === admin.id, 'moderator delete did not stamp deleted_by=admin');
  });

  await test('ACCESS: a non-author without delete_any is denied (403)', async () => {
    const p = await api('communications/messages/post', T.b, { threadId, body: `${TAG} c-cannot-delete` });
    ok(p); ctx.postIds.push(p.body.postId);
    const r = await api('communications/messages/delete', T.c, { postId: p.body.postId });
    fails(r, 'a non-author non-moderator must be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('GUARD: an own post older than 15 minutes cannot be deleted (403)', async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { data: seeded } = await sb.from('message_posts').insert({
      thread_id: threadId, author_user_id: b.id, body: `${TAG} old`, post_type: 'message', created_at: old,
    }).select('id').single();
    ctx.postIds.push(seeded.id);
    const r = await api('communications/messages/delete', T.b, { postId: seeded.id });
    fails(r, 'own post older than the 15-minute window must not be deletable');
  });

  await test('GUARD: system messages cannot be deleted, even by a moderator (403)', async () => {
    const { data: sys } = await sb.from('message_posts').insert({
      thread_id: threadId, author_user_id: null, body: `${TAG} sys`, is_system: true, post_type: 'system_event',
    }).select('id').single();
    ctx.postIds.push(sys.id);
    const r = await api('communications/messages/delete', T.admin, { postId: sys.id, reason: 'x' });
    fails(r, 'system messages must never be deletable');
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

  // ─────────────────── § 10  INTERNAL NOTES (author-only) ─────────────────────
  // An internal note lives in message_posts (is_internal=true), is visible ONLY
  // to its author, and has ZERO side-effects on the thread: no sequence/version
  // bump, no preview change, no receipts, no outbox delivery, no participant
  // notification, no unread increment for anyone else.
  h.section('Messaging › Internal notes (author-only)');

  let noteThreadId;
  let noteBaseline;            // { last_post_at, version, last_post_preview, next_message_sequence }
  let noteOutboxBaseline = 0;  // outbox rows for the thread before the note
  let notePostId;
  const NOTE_KEY = `${TAG}:internal-note-1`;
  const NOTE_BODY = `${TAG} confidential internal note — eyes only`;

  await test('setup: thread admin+B, B reads it (unread=0), capture baseline', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType:         'group',
      subject:            `${TAG} note thread`,
      participantUserIds: [b.id],
      body:               'first ordinary message',
    });
    ok(r);
    noteThreadId = r.body.threadId;
    ctx.threadIds.push(noteThreadId);
    ctx.postIds.push(r.body.postId);
    // B reads the thread so their unread baseline is 0 (isolates the note's effect).
    ok(await api('communications/messages/markRead', T.b, { threadId: noteThreadId }));

    const { data } = await sb.from('message_threads')
      .select('last_post_at, version, last_post_preview, next_message_sequence')
      .eq('id', noteThreadId).single();
    noteBaseline = data;
    const { count } = await sb.from('message_event_outbox')
      .select('id', { count: 'exact', head: true }).eq('thread_id', noteThreadId);
    noteOutboxBaseline = count ?? 0;
  });

  await test('author adds an internal note → DTO isInternal=true, sequence=null', async () => {
    const r = await api('communications/messages/internal-note', T.admin, {
      threadId: noteThreadId, body: NOTE_BODY, clientMessageKey: NOTE_KEY,
    });
    ok(r);
    expect(r.body.post && r.body.post.isInternal === true, 'note DTO missing / not isInternal');
    expect(r.body.post.sequence === null || r.body.post.sequence == null, 'note DTO carries a sequence');
    expect(r.body.duplicate === false, 'first note wrongly flagged duplicate');
    notePostId = r.body.post.id;
    ctx.postIds.push(notePostId);
  });

  await test('AUTHOR sees the note in posts; B (participant) does NOT', async () => {
    const authorPosts = await api('communications/messages/posts', T.admin, {
      threadId: noteThreadId, limit: 50,
    });
    ok(authorPosts);
    expect((authorPosts.body.data ?? []).some(p => p.id === notePostId && p.isInternal === true),
      'author cannot see own internal note in posts');

    const bPosts = await api('communications/messages/posts', T.b, {
      threadId: noteThreadId, limit: 50,
    });
    ok(bPosts);
    expect(!(bPosts.body.data ?? []).some(p => p.id === notePostId),
      'other participant B can see the internal note in posts');
  });

  await test('note is excluded from B search + B activity; author search finds it', async () => {
    const bSearch = await api('communications/messages/search', T.b, { query: 'confidential internal note' });
    ok(bSearch);
    expect(!(bSearch.body.data ?? []).some(hit => hit.postId === notePostId),
      'B search surfaced the internal note');

    const bActivity = await api('communications/messages/activity', T.b, { threadId: noteThreadId });
    ok(bActivity);
    expect(!(bActivity.body.data ?? []).some(e => e.id === `post-${notePostId}`),
      'B activity surfaced the internal note');

    const aSearch = await api('communications/messages/search', T.admin, { query: 'confidential internal note' });
    ok(aSearch);
    expect((aSearch.body.data ?? []).some(hit => hit.postId === notePostId),
      'author search did not find own internal note');
  });

  await test('ZERO thread side-effects: preview/last_post_at/version/sequence unchanged', async () => {
    const { data: after } = await sb.from('message_threads')
      .select('last_post_at, version, last_post_preview, next_message_sequence')
      .eq('id', noteThreadId).single();
    expect(after.last_post_at === noteBaseline.last_post_at, 'note changed last_post_at');
    expect(after.version === noteBaseline.version, `note changed thread version (${noteBaseline.version}→${after.version})`);
    expect(after.last_post_preview === noteBaseline.last_post_preview, 'note changed last_post_preview');
    expect(after.next_message_sequence === noteBaseline.next_message_sequence,
      `note bumped next_message_sequence (${noteBaseline.next_message_sequence}→${after.next_message_sequence})`);

    const { data: noteRow } = await sb.from('message_posts')
      .select('sequence, is_internal').eq('id', notePostId).single();
    expect(noteRow.sequence === null, 'note row has a sequence');
    expect(noteRow.is_internal === true, 'note row not flagged is_internal');
  });

  await test('NO receipts, NO outbox delivery, NO unread bump for B', async () => {
    const { count: rc } = await sb.from('message_post_receipts')
      .select('post_id', { count: 'exact', head: true }).eq('post_id', notePostId);
    expect((rc ?? 0) === 0, `note created ${rc} delivery receipts`);

    const { count: oc } = await sb.from('message_event_outbox')
      .select('id', { count: 'exact', head: true }).eq('thread_id', noteThreadId);
    expect((oc ?? 0) === noteOutboxBaseline, `note created an outbox delivery row (${noteOutboxBaseline}→${oc})`);

    // B's unread for the thread must still be 0 (they read it at baseline; the note is invisible).
    const bThreads = await api('communications/messages/threads', T.b, { tab: 'all', limit: 100 });
    ok(bThreads);
    const row = (bThreads.body.data ?? []).find(t => t.id === noteThreadId);
    expect(!row || (row.unreadCount ?? 0) === 0, `internal note marked the thread unread for B (${row?.unreadCount})`);
  });

  await test('SIDE-EFFECT: exactly one app_event + one audit_log for the note', async () => {
    const { data: ev } = await sb.from('app_events')
      .select('id, actor_user_id')
      .eq('source_entity_id', noteThreadId)
      .eq('event_type', 'communications.message.internal_note_added');
    expect((ev ?? []).length === 1, `expected 1 internal_note_added app_event, got ${(ev ?? []).length}`);
    expect((ev ?? []).every(e => e.actor_user_id === admin.id), 'note app_event has wrong actor');

    const { count: al } = await sb.from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('record_id', notePostId)
      .eq('action', 'communications.message.internal_note');
    expect((al ?? 0) === 1, `expected 1 internal_note audit_log, got ${al}`);
  });

  await test('IDEMPOTENT: duplicate note (same key) yields one row + one event', async () => {
    const r = await api('communications/messages/internal-note', T.admin, {
      threadId: noteThreadId, body: NOTE_BODY, clientMessageKey: NOTE_KEY,
    });
    ok(r);
    expect(r.body.duplicate === true, 'duplicate note not flagged duplicate');
    expect(r.body.post.id === notePostId, 'duplicate note created a different post id');

    const { count: pc } = await sb.from('message_posts')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', noteThreadId).eq('author_user_id', admin.id).eq('client_idempotency_key', NOTE_KEY);
    expect((pc ?? 0) === 1, `expected 1 note row after duplicate, got ${pc}`);

    const { count: ec } = await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', noteThreadId)
      .eq('event_type', 'communications.message.internal_note_added');
    expect((ec ?? 0) === 1, `duplicate created a second app_event (${ec})`);
  });

  await test('ACCESS: non-participant C cannot add an internal note (403)', async () => {
    const r = await api('communications/messages/internal-note', T.c, {
      threadId: noteThreadId, body: `${TAG} intruder note`, clientMessageKey: `${TAG}:intruder`,
    });
    fails(r, 'non-participant C was allowed to add an internal note');
  });

  await test('ordinary messages still deliver to B after an internal note', async () => {
    const r = await api('communications/messages/post', T.admin, {
      threadId: noteThreadId, body: `${TAG} ordinary followup after note`,
    });
    ok(r);
    ctx.postIds.push(r.body.postId);
    const bPosts = await api('communications/messages/posts', T.b, { threadId: noteThreadId, limit: 50 });
    ok(bPosts);
    expect((bPosts.body.data ?? []).some(p => p.id === r.body.postId),
      'B did not receive the ordinary followup after the note');
  });

  // ─────────────────── § 11  READ RECEIPTS (sender sees read state) ────────────
  // markThreadRead is authoritative: it sets B's receipts read_at, returns the
  // cursor, and signals every participant so the SENDER's posts refetch with a
  // real readByCount. Internal notes (no receipts) are never counted.
  h.section('Messaging › Read receipts');

  let rrThreadId, rrPostId, rrSeq;

  await test('setup: thread admin+B; admin sends a message', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'group', subject: `${TAG} receipt thread`, participantUserIds: [b.id], body: 'first',
    });
    ok(r); rrThreadId = r.body.threadId; ctx.threadIds.push(rrThreadId); ctx.postIds.push(r.body.postId);
    const post = await api('communications/messages/post', T.admin, { threadId: rrThreadId, body: `${TAG} receipt target` });
    ok(post); rrPostId = post.body.postId; ctx.postIds.push(rrPostId);
    const { data: prow } = await sb.from('message_posts').select('sequence').eq('id', rrPostId).single();
    rrSeq = prow.sequence;
    // Provision a realtime channel for BOTH participants: /communications/summary
    // upserts user_realtime_channels (_ensureRealtimeChannel). emitSignal only writes
    // a communication_signals row for users who have a live channel, so without this
    // markRead's messages-signal has no target and the SIDE-EFFECT assertion below fails.
    await api('communications/summary', T.admin);
    await api('communications/summary', T.b);
  });

  await test('B has an UNREAD receipt; admin sees readByCount 0', async () => {
    const { data: rcpt } = await sb.from('message_post_receipts')
      .select('read_at').eq('post_id', rrPostId).eq('user_id', b.id).single();
    expect(rcpt, 'no receipt row for B'); expect(rcpt.read_at === null, 'B receipt already marked read');
    const posts = await api('communications/messages/posts', T.admin, { threadId: rrThreadId, limit: 50 });
    ok(posts);
    const target = (posts.body.data ?? []).find(p => p.id === rrPostId);
    expect(target, 'admin cannot see own message'); expect((target.readByCount ?? 0) === 0, `readByCount=${target?.readByCount} before read`);
  });

  await test('B marks read → route returns lastReadSequence, receipt set, admin sees readByCount 1', async () => {
    const mr = await api('communications/messages/markRead', T.b, { threadId: rrThreadId, upToSequence: rrSeq });
    ok(mr);
    expect(typeof mr.body.data?.lastReadSequence === 'number', 'markRead did not return data.lastReadSequence');
    const { data: rcpt } = await sb.from('message_post_receipts')
      .select('read_at').eq('post_id', rrPostId).eq('user_id', b.id).single();
    expect(rcpt.read_at !== null, 'B receipt not marked read after markRead');
    const posts = await api('communications/messages/posts', T.admin, { threadId: rrThreadId, limit: 50 });
    ok(posts);
    const target = (posts.body.data ?? []).find(p => p.id === rrPostId);
    expect((target.readByCount ?? 0) === 1, `readByCount=${target?.readByCount} after B read`);
  });

  await test('SIDE-EFFECT: markRead emitted a messages signal to participants', async () => {
    const { data: sigs } = await sb.from('communication_signals')
      .select('user_id, domain').eq('domain', 'messages').in('user_id', [admin.id, b.id]);
    expect((sigs ?? []).length > 0, 'no messages signal for participants after markRead');
  });

  await test('internal notes are NOT counted as read for other participants', async () => {
    const note = await api('communications/messages/internal-note', T.admin, {
      threadId: rrThreadId, body: `${TAG} rr internal note`, clientMessageKey: `${TAG}:rr-note`,
    });
    ok(note); const notePostId = note.body.post.id; ctx.postIds.push(notePostId);
    const { count: rc } = await sb.from('message_post_receipts')
      .select('post_id', { count: 'exact', head: true }).eq('post_id', notePostId).eq('user_id', b.id);
    expect((rc ?? 0) === 0, 'internal note created a receipt for B');
    // B marks read again; the author-only note stays uncounted.
    ok(await api('communications/messages/markRead', T.b, { threadId: rrThreadId }));
    const authorPosts = await api('communications/messages/posts', T.admin, { threadId: rrThreadId, limit: 50 });
    ok(authorPosts);
    const noteRow = (authorPosts.body.data ?? []).find(p => p.id === notePostId);
    expect(!noteRow || (noteRow.readByCount ?? 0) === 0, 'internal note readByCount is non-zero');
  });
}
