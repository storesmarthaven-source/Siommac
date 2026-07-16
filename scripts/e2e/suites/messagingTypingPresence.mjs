/**
 * scripts/e2e/suites/messagingTypingPresence.mjs
 *
 * Typing/presence slice (mig 20260919000365): ephemeral typing broadcasts on
 * PRIVATE per-thread channels + shared presence — authorized by RLS policies
 * on realtime.messages evaluated against the ES256 realtime JWT.
 *
 * No business rows by design: the suite asserts TRANSPORT authorization —
 * participant receives, non-participant channel errors, anon channel errors —
 * plus presence sync. Requires SUPABASE_JWT_ES256_PRIVATE_KEY/_KID in .env
 * (the same key the backend mints with) and migration 365 applied.
 */
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

export const title = 'Messaging — Typing & Presence slice';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run(h) {
  const { api, test, expect, ok, mint, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b) };

  const ES256_B64 = h.env.SUPABASE_JWT_ES256_PRIVATE_KEY;
  const ES256_KID = h.env.SUPABASE_JWT_ES256_KID;

  const ctx = { threadId: null, clients: [] };

  h.onCleanup(async () => {
    for (const client of ctx.clients) { try { await client.removeAllChannels(); } catch { /* best-effort */ } }
    if (!ctx.threadId) return;
    const del = async (t, apply) => {
      const { error } = await apply(sb.from(t).delete());
      if (error) console.warn(`\n[cleanup] ${t}: ${error.message}`);
    };
    await del('message_event_outbox', q => q.eq('thread_id', ctx.threadId));
    await del('app_events', q => q.eq('source_entity_id', ctx.threadId).eq('source_module', 'communications'));
    const { data: posts } = await sb.from('message_posts').select('id').eq('thread_id', ctx.threadId);
    const postIds = (posts ?? []).map(p => p.id);
    if (postIds.length) await del('message_post_receipts', q => q.in('post_id', postIds));
    await del('message_posts', q => q.eq('thread_id', ctx.threadId));
    await del('message_participants', q => q.eq('thread_id', ctx.threadId));
    await del('message_threads', q => q.eq('id', ctx.threadId));
  });

  // The realtime token the BACKEND would mint (same key/claims — lib/realtimeAuth.ts).
  const mintRealtime = (userId) => jwt.sign(
    { sub: userId, role: 'authenticated', aud: 'authenticated', iss: 'siomac-realtime' },
    Buffer.from(ES256_B64, 'base64').toString('utf8'),
    { algorithm: 'ES256', keyid: ES256_KID, expiresIn: '10m' },
  );

  const realtimeClient = (userId) => {
    const client = createClient(h.env.SUPABASE_URL, h.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    if (userId) client.realtime.setAuth(mintRealtime(userId));
    ctx.clients.push(client);
    return client;
  };

  /** Join a channel and resolve its terminal join status. */
  const joinStatus = (channel, timeoutMs = 8000) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), timeoutMs);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        clearTimeout(timer); resolve(status);
      }
    });
  });

  h.section('Typing/Presence › Setup');

  await test('env guard: ES256 realtime signing key configured', async () => {
    expect(ES256_B64 && ES256_KID, 'SUPABASE_JWT_ES256_PRIVATE_KEY/_KID missing from .env — realtime-auth must be configured (RUNBOOK_REALTIME_AUTH.md)');
  });

  await test('setup: direct thread between admin and B (via real createThread)', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'group', subject: `Typing suite ${TAG}`,
      participantUserIds: [b.id], body: `typing/presence probe ${TAG}`,
      idempotencyKey: crypto.randomUUID(),
    });
    ok(r, `createThread failed: ${r.body.message}`);
    ctx.threadId = r.body.threadId;
    expect(ctx.threadId, 'no threadId returned');
  });

  h.section('Typing/Presence › Typing broadcast authorization');

  await test('PARTICIPANT joins the typing channel (SUBSCRIBED)', async () => {
    const client = realtimeClient(admin.id);
    const channel = client.channel(`siomac:typing:${ctx.threadId}`, { config: { private: true, broadcast: { self: false } } });
    const status = await joinStatus(channel);
    expect(status === 'SUBSCRIBED', `participant join status ${status} — mig 365 policies or realtime token rejected`);
  });

  await test('typing broadcast from B is DELIVERED to admin', async () => {
    const receiver = realtimeClient(admin.id);
    let received = null;
    const rxChannel = receiver.channel(`siomac:typing:${ctx.threadId}`, { config: { private: true, broadcast: { self: false } } });
    rxChannel.on('broadcast', { event: 'typing' }, ({ payload }) => { received = payload; });
    expect((await joinStatus(rxChannel)) === 'SUBSCRIBED', 'receiver failed to join');

    const sender = realtimeClient(b.id);
    const txChannel = sender.channel(`siomac:typing:${ctx.threadId}`, { config: { private: true, broadcast: { self: false } } });
    expect((await joinStatus(txChannel)) === 'SUBSCRIBED', 'sender failed to join');
    await txChannel.send({ type: 'broadcast', event: 'typing', payload: { userId: b.id, active: true } });

    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && !received) await wait(120);
    expect(received, 'typing broadcast never delivered to the participant');
    expect(received.userId === b.id && received.active === true, `unexpected payload ${JSON.stringify(received)}`);
  });

  await test('NON-PARTICIPANT (authed) is DENIED the typing channel', async () => {
    const client = realtimeClient(c.id);   // real user, NOT a participant
    const channel = client.channel(`siomac:typing:${ctx.threadId}`, { config: { private: true, broadcast: { self: false } } });
    const status = await joinStatus(channel);
    expect(status !== 'SUBSCRIBED', 'non-participant subscribed to a private typing channel — participant policy not enforced');
  });

  await test('ANON is DENIED the typing channel', async () => {
    const client = realtimeClient(null);   // no setAuth
    const channel = client.channel(`siomac:typing:${ctx.threadId}`, { config: { private: true, broadcast: { self: false } } });
    const status = await joinStatus(channel);
    expect(status !== 'SUBSCRIBED', 'anon subscribed to a private typing channel — policies must not cover anon');
  });

  h.section('Typing/Presence › Presence channel');

  await test('presence: two authed users appear in each other\'s sync', async () => {
    const clientA = realtimeClient(admin.id);
    const channelA = clientA.channel('siomac:presence', { config: { private: true, presence: { key: admin.id } } });
    let stateA = {};
    channelA.on('presence', { event: 'sync' }, () => { stateA = channelA.presenceState(); });
    expect((await joinStatus(channelA)) === 'SUBSCRIBED', 'A failed to join presence');
    await channelA.track({ onlineAt: new Date().toISOString() });

    const clientB = realtimeClient(b.id);
    const channelB = clientB.channel('siomac:presence', { config: { private: true, presence: { key: b.id } } });
    expect((await joinStatus(channelB)) === 'SUBSCRIBED', 'B failed to join presence');
    await channelB.track({ onlineAt: new Date().toISOString() });

    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && !(stateA[admin.id] && stateA[b.id])) await wait(150);
    expect(stateA[admin.id], 'A does not see itself in presence sync');
    expect(stateA[b.id], 'A does not see B in presence sync');
  });

  await test('presence: ANON is DENIED', async () => {
    const client = realtimeClient(null);
    const channel = client.channel('siomac:presence', { config: { private: true, presence: { key: 'anon-probe' } } });
    const status = await joinStatus(channel);
    expect(status !== 'SUBSCRIBED', 'anon joined the private presence channel');
  });
}
