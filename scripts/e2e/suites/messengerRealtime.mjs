/**
 * scripts/e2e/suites/messengerRealtime.mjs
 *
 * TWO-SESSION realtime verification for the messenger — the release gate the
 * hardening roadmap requires before the messenger is enterprise-ready
 * (see memory: project-messenger-hardening-roadmap, slice 1).
 *
 * Unlike communications.mjs (which probes signal DELIVERY by inserting
 * signal rows directly), this suite exercises the REAL loop end-to-end with
 * two authenticated users on separate realtime connections:
 *
 *   A posts via the API → backend writes the recipient's signal →
 *   B's AUTHENTICATED subscription (own ES256 token, own channel) receives it.
 *
 * Covers: two-user delivery · one-subscription-many-threads (thread switching
 * needs no resubscribe) · reconnect with a rotated token · duplicate delivery
 * (at-least-once semantics — the FE handler is a refetch, so dupes are safe)
 * · AUTHENTICATED cross-user denial (C listening on B's channel goes dark)
 * · polling fallback (summary unread counts move with realtime out of the loop).
 */

export const title = 'Messenger — two-session realtime verification';

const SUBSCRIBE_MS = 8000;   // channel join window
const DELIVER_MS   = 15000;  // full-suite fan-out can exceed the standalone 7s
const SILENCE_MS   = 4000;   // negative-path listen window

export default async function run(h) {
  const { api, test, expect, ok, mint, sb, TAG, acquireActors } = h;

  const ctx = { threadIds: [], channels: new Set(), createdUserIds: [], clients: [] };

  h.onCleanup(async () => {
    for (const client of ctx.clients) { try { await client.removeAllChannels(); } catch { /* closed */ } }
    if (ctx.threadIds.length) {
      const posts = (await sb.from('message_posts').select('id').in('thread_id', ctx.threadIds)).data ?? [];
      if (posts.length) await sb.from('message_attachments').delete().in('post_id', posts.map(p => p.id));
      await sb.from('message_post_receipts').delete().in('thread_id', ctx.threadIds).then(() => {}, () => {});
      await sb.from('message_posts').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_participants').delete().in('thread_id', ctx.threadIds);
      await sb.from('message_thread_access_grants').delete().in('thread_id', ctx.threadIds);
      await sb.from('notifications').delete().in('source_id', ctx.threadIds);
      await sb.from('message_threads').delete().in('id', ctx.threadIds);
    }
    if (ctx.channels.size) await sb.from('communication_signals').delete().in('channel_key', [...ctx.channels]);
    if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds);
  });

  // ── Actors: three REAL provisioned employees (never the admin fixture) ─────
  let A, B, C, tA, tB, tC;

  await test('setup: provision two participants + one outsider', async () => {
    const r = await acquireActors('employee', 3);
    [A, B, C] = r.actors;
    ctx.createdUserIds.push(...r.createdIds);
    tA = mint(A); tB = mint(B); tC = mint(C);
    expect(A && B && C, 'need three employee actors');
  });

  let threadId;
  await test('setup: A starts a group thread with B', async () => {
    const r = await api('communications/messages/createThread', tA, {
      threadType: 'group', subject: `${TAG} rt-two-user`, participantUserIds: [B.id], body: 'opening',
    });
    ok(r, 'createThread failed: ' + r.body.message);
    threadId = r.body.threadId;
    ctx.threadIds.push(threadId);
  });

  /** Open an AUTHENTICATED subscription for a user's own signal channel.
   *  Returns { chan, events, resubscribe, close } — events.count increments
   *  per delivered signal. */
  async function openSession(token, who) {
    const summary = (await api('communications/summary', token)).body.data ?? {};
    const chan = summary.realtimeChannelKey;
    const rt   = summary.realtimeToken;
    expect(chan, `no realtimeChannelKey for ${who}`);
    expect(rt,   `no realtimeToken for ${who} — SUPABASE_JWT_ES256_* not configured`);
    ctx.channels.add(chan);
    const client = h.anonClient();
    ctx.clients.push(client);
    client.realtime.setAuth(rt);
    const events = { count: 0 };
    let channel = null;

    async function subscribe(filterChan) {
      let subscribed = false;
      channel = client.channel(`probe-${who}-${Math.abs(Date.now() % 100000)}-${filterChan}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'communication_signals', filter: `channel_key=eq.${filterChan}` },
          () => { events.count += 1; })
        .subscribe((status) => { if (status === 'SUBSCRIBED') subscribed = true; });
      const s0 = Date.now();
      while (Date.now() - s0 < SUBSCRIBE_MS && !subscribed) await new Promise(r => setTimeout(r, 120));
      expect(subscribed, `${who}: channel never reached SUBSCRIBED`);
    }

    await subscribe(chan);
    return {
      chan, events, client,
      resubscribe: async (freshToken, filterChan = chan) => {
        if (channel) await client.removeChannel(channel);
        if (freshToken) client.realtime.setAuth(freshToken);
        await subscribe(filterChan);
      },
      close: async () => { if (channel) await client.removeChannel(channel); },
    };
  }

  const waitFor = async (check, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (check()) return true; await new Promise(r => setTimeout(r, 120)); }
    return check();
  };

  let sessionB;

  await test('TWO-USER delivery: A posts via the API → B\'s live subscription receives the signal', async () => {
    sessionB = await openSession(tB, 'B');
    await sb.from('communication_signals').delete().eq('channel_key', sessionB.chan);
    sessionB.events.count = 0;

    const post = await api('communications/messages/post', tA, { threadId, body: `${TAG} live one` });
    ok(post, 'post failed: ' + post.body.message);

    const got = await waitFor(() => sessionB.events.count >= 1, DELIVER_MS);
    expect(got, 'B never received the realtime signal for A\'s message — the live badge/thread refresh is broken');
  });

  await test('THREAD SWITCHING: the same subscription covers a second thread (channel is user-scoped)', async () => {
    const r = await api('communications/messages/createThread', tA, {
      threadType: 'group', subject: `${TAG} rt-second-thread`, participantUserIds: [B.id], body: 'second',
    });
    ok(r, 'second createThread failed: ' + r.body.message);
    ctx.threadIds.push(r.body.threadId);

    sessionB.events.count = 0;
    const post = await api('communications/messages/post', tA, { threadId: r.body.threadId, body: `${TAG} live two` });
    ok(post, 'post to second thread failed: ' + post.body.message);

    const got = await waitFor(() => sessionB.events.count >= 1, DELIVER_MS);
    expect(got, 'signal for a DIFFERENT thread did not reach the same user-scoped subscription');
  });

  await test('RECONNECT: after teardown + resubscribe with a ROTATED token, delivery resumes', async () => {
    // Fresh summary = fresh short-lived ES256 token (the FE rotates via the
    // 30s poll); the resubscribed channel must deliver like the first one.
    const fresh = (await api('communications/summary', tB)).body.data ?? {};
    expect(fresh.realtimeToken, 'no rotated realtimeToken for B');
    await sessionB.resubscribe(fresh.realtimeToken);

    sessionB.events.count = 0;
    const post = await api('communications/messages/post', tA, { threadId, body: `${TAG} after reconnect` });
    ok(post, 'post after reconnect failed: ' + post.body.message);

    const got = await waitFor(() => sessionB.events.count >= 1, DELIVER_MS);
    expect(got, 'no delivery after reconnect — token rotation or resubscribe path is broken');
  });

  await test('DUPLICATE delivery: two rapid posts arrive as (at least) two signals — dupes are refetch-safe', async () => {
    sessionB.events.count = 0;
    const p1 = await api('communications/messages/post', tA, { threadId, body: `${TAG} burst 1` });
    const p2 = await api('communications/messages/post', tA, { threadId, body: `${TAG} burst 2` });
    ok(p1, 'burst post 1 failed'); ok(p2, 'burst post 2 failed');

    const got = await waitFor(() => sessionB.events.count >= 2, DELIVER_MS);
    expect(got, `expected >=2 signal deliveries for 2 posts, saw ${sessionB.events.count} — at-least-once delivery not holding`);
  });

  await test('CROSS-USER denial: authenticated C listening on B\'s channel receives NOTHING (B still receives)', async () => {
    // Stronger than the anon-denial test in communications.mjs: C holds a VALID
    // token of their own — RLS must still scope delivery to the channel OWNER.
    const summaryC = (await api('communications/summary', tC)).body.data ?? {};
    expect(summaryC.realtimeToken, 'no realtimeToken for C');
    const spy = h.anonClient();
    ctx.clients.push(spy);
    spy.realtime.setAuth(summaryC.realtimeToken);
    let spySubscribed = false, spyReceived = 0;
    const spyCh = spy.channel(`probe-spy-${Math.abs(Date.now() % 100000)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'communication_signals', filter: `channel_key=eq.${sessionB.chan}` },
        () => { spyReceived += 1; })
      .subscribe((status) => { if (status === 'SUBSCRIBED') spySubscribed = true; });
    try {
      const s0 = Date.now();
      while (Date.now() - s0 < SUBSCRIBE_MS && !spySubscribed) await new Promise(r => setTimeout(r, 120));
      // Join may succeed — enforcement is on DELIVERY.

      sessionB.events.count = 0;
      const post = await api('communications/messages/post', tA, { threadId, body: `${TAG} for B only` });
      ok(post, 'post failed: ' + post.body.message);

      // B receiving proves the signal EXISTS (no false-negative for C).
      const bGot = await waitFor(() => sessionB.events.count >= 1, DELIVER_MS);
      expect(bGot, 'control failed: B did not receive its own signal');
      await new Promise(r => setTimeout(r, SILENCE_MS));
    } finally {
      await spy.removeChannel(spyCh);
    }
    expect(spyReceived === 0, `authenticated NON-OWNER received ${spyReceived} signal(s) from B's channel — realtime RLS leak`);
  });

  await test('POLLING fallback: with realtime out of the loop, B\'s summary unread count still moves', async () => {
    await sessionB.close();   // no live subscription — polling is all B has

    // messagesUnread counts UNREAD THREADS — the earlier tests left both
    // threads unread (saturated). Read them all first so A's next post flips
    // exactly one thread back to unread and the poll can observe the change.
    for (const id of ctx.threadIds) {
      const mr = await api('communications/messages/markRead', tB, { threadId: id });
      ok(mr, 'markRead failed: ' + mr.body.message);
    }
    const before = (await api('communications/summary', tB)).body.data ?? {};
    const post = await api('communications/messages/post', tA, { threadId, body: `${TAG} poll fallback` });
    ok(post, 'post failed: ' + post.body.message);

    // The summary read is the poll — the new message must be visible to it
    // without any realtime assist.
    let after = {};
    let moved = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && !moved) {
      after = (await api('communications/summary', tB)).body.data ?? {};
      moved = (after.messagesUnread ?? 0) > (before.messagesUnread ?? 0);
      if (!moved) await new Promise(r => setTimeout(r, 400));
    }
    expect(moved, `summary messagesUnread did not increase (before=${before.messagesUnread}, after=${after.messagesUnread}) — the polling fallback would leave B blind`);
  });
}
