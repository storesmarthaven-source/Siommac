/**
 * scripts/e2e/suites/messagingFavourites.mjs
 *
 * Favourites slice (mig 20260919000364): per-user thread favourites via
 * POST /communications/messages/favourites/set + isFavourite in /threads.
 *
 * Personal UI state by design: participant-gated, single-row writes,
 * NO app_events/audit (asserted).
 */

export const title = 'Messaging — Favourites slice';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };

  const ctx = { threadId: null };

  h.onCleanup(async () => {
    if (!ctx.threadId) return;
    const del = async (t, apply) => {
      const { error } = await apply(sb.from(t).delete());
      if (error) console.warn(`\n[cleanup] ${t}: ${error.message}`);
    };
    await del('message_thread_favourites', q => q.eq('thread_id', ctx.threadId));
    await del('message_event_outbox', q => q.eq('thread_id', ctx.threadId));
    await del('app_events', q => q.eq('source_entity_id', ctx.threadId).eq('source_module', 'communications'));
    const { data: posts } = await sb.from('message_posts').select('id').eq('thread_id', ctx.threadId);
    const postIds = (posts ?? []).map(p => p.id);
    if (postIds.length) await del('message_post_receipts', q => q.in('post_id', postIds));
    await del('message_posts', q => q.eq('thread_id', ctx.threadId));
    await del('message_participants', q => q.eq('thread_id', ctx.threadId));
    await del('message_threads', q => q.eq('id', ctx.threadId));
  });

  h.section('Favourites › Setup');

  await test('setup: create a group thread (admin + B)', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'group',
      subject: `${TAG} favourites`,
      participantUserIds: [admin.id, b.id],
      body: `${TAG} first message`,
      idempotencyKey: `e2e-fav-thread-${TAG}`,
    });
    ok(r, `createThread failed: ${r.body.message}`);
    ctx.threadId = r.body.threadId;
  });

  h.section('Favourites › Toggle + contract');

  await test('admin favourites the thread — row written, idempotent re-set', async () => {
    ok(await api('communications/messages/favourites/set', T.admin, { threadId: ctx.threadId, favourite: true }));
    // Idempotent: setting true again is a no-op, not an error or a dup row.
    ok(await api('communications/messages/favourites/set', T.admin, { threadId: ctx.threadId, favourite: true }));
    const { data: rows } = await sb.from('message_thread_favourites')
      .select('user_id').eq('thread_id', ctx.threadId);
    expect((rows ?? []).length === 1 && rows[0].user_id === admin.id,
      `expected exactly 1 favourite row for admin, got ${JSON.stringify(rows)}`);
  });

  await test('CONTRACT: /threads returns isFavourite=true for admin, false for B (per-user)', async () => {
    const rA = await api('communications/messages/threads', T.admin, { tab: 'all', limit: 100 });
    ok(rA);
    const tA = (rA.body.data ?? []).find(t => t.id === ctx.threadId);
    expect(tA?.isFavourite === true, `admin should see isFavourite=true, got ${tA?.isFavourite}`);

    const rB = await api('communications/messages/threads', T.b, { tab: 'all', limit: 100 });
    ok(rB);
    const tB = (rB.body.data ?? []).find(t => t.id === ctx.threadId);
    expect(tB?.isFavourite === false || tB?.isFavourite === undefined,
      `B should NOT see the thread as favourite, got ${tB?.isFavourite}`);
  });

  await test('NO §2 ceremony: favourite toggling writes no app_events', async () => {
    const { data: events } = await sb.from('app_events')
      .select('id, event_type').eq('source_entity_id', ctx.threadId)
      .ilike('event_type', '%favourite%');
    expect((events ?? []).length === 0, 'favourites must not emit app_events (personal UI state)');
  });

  await test('admin unfavourites — row removed', async () => {
    ok(await api('communications/messages/favourites/set', T.admin, { threadId: ctx.threadId, favourite: false }));
    const { data: rows } = await sb.from('message_thread_favourites')
      .select('user_id').eq('thread_id', ctx.threadId);
    expect((rows ?? []).length === 0, 'favourite row should be gone');
  });

  h.section('Favourites › Negative paths');

  await test('DENY: non-participant C cannot favourite (403)', async () => {
    const r = await api('communications/messages/favourites/set', T.c, { threadId: ctx.threadId, favourite: true });
    fails(r, 'non-participant must be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('DENY: unknown thread → 403 (not a participant of a nonexistent thread)', async () => {
    const r = await api('communications/messages/favourites/set', T.admin, { threadId: '11111111-1111-4111-8111-111111111111', favourite: true });
    fails(r, 'unknown thread must be denied');
  });

  await test('VALIDATION: missing favourite flag → 400', async () => {
    const r = await api('communications/messages/favourites/set', T.admin, { threadId: ctx.threadId });
    fails(r, 'missing favourite flag must be rejected');
  });

  await test('ACCESS: unauthenticated denied', async () => {
    fails(await api('communications/messages/favourites/set', null, { threadId: ctx.threadId, favourite: true }));
  });
}
