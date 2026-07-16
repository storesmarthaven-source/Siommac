/**
 * scripts/e2e/suites/messagingReactions.mjs
 *
 * Reactions slice (mig 20260919000363): messaging_toggle_reaction_tx via
 * POST /communications/messages/reactions/toggle.
 *
 * Standalone suite on purpose (not folded into messaging.mjs) — it covers one
 * self-contained slice and keeps clear of concurrent suite maintenance.
 *
 * Covers: toggle add/remove atomicity + §2 side-effects (thread version bump,
 * message_event_outbox, app_events), aggregation in getThreadPosts, and every
 * negative path (non-participant, system post, deleted post, bad emoji, unauth).
 */

export const title = 'Messaging — Reactions slice';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };

  const ctx = { threadId: null, postId: null, systemPostId: null, deletedPostId: null };

  h.onCleanup(async () => {
    if (!ctx.threadId) return;
    const del = async (t, apply) => {
      const { error } = await apply(sb.from(t).delete());
      if (error) console.warn(`\n[cleanup] ${t}: ${error.message}`);
    };
    const { data: posts } = await sb.from('message_posts').select('id').eq('thread_id', ctx.threadId);
    const postIds = (posts ?? []).map(p => p.id);
    if (postIds.length) await del('message_post_reactions', q => q.in('post_id', postIds));
    await del('message_event_outbox', q => q.eq('thread_id', ctx.threadId));
    await del('app_events', q => q.eq('source_entity_id', ctx.threadId).eq('source_module', 'communications'));
    await del('message_post_receipts', q => q.in('post_id', postIds.length ? postIds : ['00000000-0000-0000-0000-000000000000']));
    await del('message_posts', q => q.eq('thread_id', ctx.threadId));
    await del('message_participants', q => q.eq('thread_id', ctx.threadId));
    await del('message_threads', q => q.eq('id', ctx.threadId));
  });

  // ── Setup ────────────────────────────────────────────────────────────────────
  h.section('Reactions › Setup');

  await test('setup: create a group thread (admin + B) with a first post', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'group',
      subject: `${TAG} reactions`,
      participantUserIds: [admin.id, b.id],
      body: `${TAG} first message`,
      idempotencyKey: `e2e-rx-thread-${TAG}`,
    });
    ok(r, `createThread failed: ${r.body.message}`);
    ctx.threadId = r.body.threadId;
    ctx.postId = r.body.postId;
    expect(ctx.threadId && ctx.postId, 'threadId/postId missing from createThread response');
  });

  // ── Toggle semantics + atomic side-effects ──────────────────────────────────
  h.section('Reactions › Toggle + §2 side-effects');

  await test('B adds 👍 — action=added, count=1', async () => {
    const r = await api('communications/messages/reactions/toggle', T.b, { postId: ctx.postId, emoji: '👍' });
    ok(r, `toggle failed: ${r.body.message}`);
    expect(r.body.action === 'added', `expected added, got ${r.body.action}`);
    expect(r.body.count === 1, `expected count 1, got ${r.body.count}`);

    const { data: rows } = await sb.from('message_post_reactions')
      .select('user_id, emoji').eq('post_id', ctx.postId);
    expect((rows ?? []).length === 1 && rows[0].user_id === b.id && rows[0].emoji === '👍',
      `unexpected reaction rows: ${JSON.stringify(rows)}`);
  });

  await test('SIDE-EFFECTS: thread version bumped + outbox + app_event written atomically', async () => {
    const { data: outbox } = await sb.from('message_event_outbox')
      .select('id, payload').eq('thread_id', ctx.threadId).eq('event_type', 'message.reaction');
    expect((outbox ?? []).length === 1, `expected 1 outbox row, got ${outbox?.length}`);
    expect(outbox[0].payload?.action === 'added' && outbox[0].payload?.emoji === '👍',
      `outbox payload wrong: ${JSON.stringify(outbox[0].payload)}`);

    const { data: events } = await sb.from('app_events')
      .select('id, payload').eq('event_type', 'communications.message.reaction')
      .eq('source_entity_id', ctx.threadId);
    expect((events ?? []).length === 1, `expected 1 app_event, got ${events?.length}`);

    const { data: thread } = await sb.from('message_threads')
      .select('version').eq('id', ctx.threadId).single();
    expect((thread?.version ?? 0) >= 2, `thread version should have bumped, got ${thread?.version}`);
  });

  await test('admin adds ❤️ then 👍 — aggregation groups by emoji', async () => {
    ok(await api('communications/messages/reactions/toggle', T.admin, { postId: ctx.postId, emoji: '❤️' }));
    const r2 = await api('communications/messages/reactions/toggle', T.admin, { postId: ctx.postId, emoji: '👍' });
    ok(r2);
    expect(r2.body.count === 2, `👍 count should be 2, got ${r2.body.count}`);
  });

  await test('CONTRACT: getThreadPosts returns aggregated reactions (emoji + userIds)', async () => {
    const r = await api('communications/messages/posts', T.admin, { threadId: ctx.threadId, limit: 10 });
    ok(r);
    const post = (r.body.data ?? []).find(p => p.id === ctx.postId);
    expect(post, 'post not returned');
    const rx = post.reactions ?? [];
    const thumbs = rx.find(x => x.emoji === '👍');
    const heart  = rx.find(x => x.emoji === '❤️');
    expect(thumbs && thumbs.userIds.length === 2, `👍 should have 2 userIds, got ${JSON.stringify(thumbs)}`);
    expect(heart && heart.userIds.length === 1 && heart.userIds[0] === admin.id,
      `❤️ should have [admin], got ${JSON.stringify(heart)}`);
  });

  await test('B toggles 👍 again — action=removed, row gone, count=1', async () => {
    const r = await api('communications/messages/reactions/toggle', T.b, { postId: ctx.postId, emoji: '👍' });
    ok(r);
    expect(r.body.action === 'removed', `expected removed, got ${r.body.action}`);
    expect(r.body.count === 1, `expected count 1 after removal, got ${r.body.count}`);
    const { data: rows } = await sb.from('message_post_reactions')
      .select('user_id').eq('post_id', ctx.postId).eq('emoji', '👍');
    expect((rows ?? []).length === 1 && rows[0].user_id === admin.id, 'B reaction row should be gone');
  });

  // ── Negative paths ───────────────────────────────────────────────────────────
  h.section('Reactions › Negative paths');

  await test('DENY: non-participant C cannot react (403)', async () => {
    const r = await api('communications/messages/reactions/toggle', T.c, { postId: ctx.postId, emoji: '👍' });
    fails(r, 'non-participant must be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
    const { data: rows } = await sb.from('message_post_reactions')
      .select('id').eq('post_id', ctx.postId).eq('user_id', c.id);
    expect((rows ?? []).length === 0, 'denied attempt must leave no row');
  });

  await test('DENY: empty emoji → 400', async () => {
    const r = await api('communications/messages/reactions/toggle', T.admin, { postId: ctx.postId, emoji: '   ' });
    fails(r, 'blank emoji must be rejected');
  });

  await test('DENY: over-length emoji payload → 400', async () => {
    const r = await api('communications/messages/reactions/toggle', T.admin, { postId: ctx.postId, emoji: 'x'.repeat(24) });
    fails(r, 'over-length emoji must be rejected');
  });

  await test('DENY: unknown post → 404', async () => {
    const r = await api('communications/messages/reactions/toggle', T.admin, { postId: '00000000-0000-0000-0000-000000000001', emoji: '👍' });
    fails(r, 'unknown post must 404');
    expect(r.status === 404, `expected 404, got ${r.status}`);
  });

  await test('DENY: deleted post cannot be reacted to (403)', async () => {
    const send = await api('communications/messages/post', T.admin, {
      threadId: ctx.threadId, body: `${TAG} to delete`,
    });
    ok(send, 'post for delete-test failed');
    ctx.deletedPostId = send.body.postId;
    ok(await api('communications/messages/delete', T.admin, { postId: ctx.deletedPostId }), 'own delete failed');
    const r = await api('communications/messages/reactions/toggle', T.admin, { postId: ctx.deletedPostId, emoji: '👍' });
    fails(r, 'deleted post must be rejected');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('DENY: system post cannot be reacted to (403)', async () => {
    const { data: sys, error } = await sb.from('message_posts').insert({
      thread_id: ctx.threadId, author_user_id: null, body: `${TAG} system row`,
      is_system: true, post_type: 'system_event', system_event_type: 'participant_added',
    }).select('id').single();
    expect(!error && sys?.id, `system post seed failed: ${error?.message}`);
    ctx.systemPostId = sys.id;
    const r = await api('communications/messages/reactions/toggle', T.admin, { postId: ctx.systemPostId, emoji: '👍' });
    fails(r, 'system post must be rejected');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('ACCESS: unauthenticated toggle denied', async () => {
    fails(await api('communications/messages/reactions/toggle', null, { postId: ctx.postId, emoji: '👍' }));
  });
}
