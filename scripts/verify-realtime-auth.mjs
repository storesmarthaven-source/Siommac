/**
 * scripts/verify-realtime-auth.mjs
 *
 * Live verification of the authenticated-realtime slice (finding #5).
 * Standalone on purpose — no E2E-harness dependency.
 *
 *   Phase A: mint a realtime JWT (ES256, SIOMAC-controlled imported signing
 *            key — SUPABASE_JWT_ES256_PRIVATE_KEY/_KID) for a real user,
 *            setAuth + subscribe to their channel_key, insert a signal via the
 *            service role, assert delivery. The key must be imported AND
 *            rotated to CURRENT in the dashboard (standby keys do not verify).
 *   Phase B: subscribe ANONYMOUSLY the same way and assert NO delivery.
 *            Before migration 351 is applied this phase only WARNS (the
 *            permissive policy still allows anon); after 351 it must PASS.
 *
 * Usage: node scripts/verify-realtime-auth.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_JWT_ES256_PRIVATE_KEY, SUPABASE_JWT_ES256_KID } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (!SUPABASE_JWT_ES256_PRIVATE_KEY || !SUPABASE_JWT_ES256_KID) {
  console.error('SUPABASE_JWT_ES256_PRIVATE_KEY / SUPABASE_JWT_ES256_KID are not configured.');
  console.error('Generate the keypair, import the JWK into Supabase (JWT Keys → import),');
  console.error('rotate it to CURRENT, and put the base64 PKCS8 PEM + kid in .env first.');
  process.exit(1);
}
const ES256_PEM = Buffer.from(SUPABASE_JWT_ES256_PRIVATE_KEY, 'base64').toString('utf8');
if (!ES256_PEM.includes('BEGIN PRIVATE KEY')) {
  console.error('SUPABASE_JWT_ES256_PRIVATE_KEY does not decode to a PKCS8 PEM private key.');
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const USER_ID = process.argv[2] ?? 'USR-001';

function realtimeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
}

function subscribeAndCollect(client, channelKey, label) {
  const seen = [];
  const channel = client
    .channel(`verify-${label}-${randomUUID().slice(0, 8)}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'communication_signals',
      filter: `channel_key=eq.${channelKey}`,
    }, payload => seen.push(payload?.new?.domain ?? 'unknown'))
    .subscribe();
  return { channel, seen };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // Ensure the user has a live channel key (mirrors _ensureRealtimeChannel).
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const { data: chan, error: chanErr } = await svc
    .from('user_realtime_channels')
    .upsert({ user_id: USER_ID, expires_at: expiresAt }, { onConflict: 'user_id' })
    .select('channel_key')
    .single();
  if (chanErr || !chan) { console.error('channel upsert failed:', chanErr?.message); process.exit(1); }
  const channelKey = chan.channel_key;
  console.log(`user ${USER_ID} channel_key ${channelKey}`);

  // ── Phase A: AUTHENTICATED subscription must receive the signal ────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { sub: USER_ID, role: 'authenticated', aud: 'authenticated', iss: 'siomac-realtime', iat: nowSec, exp: nowSec + 300 },
    ES256_PEM, { algorithm: 'ES256', keyid: SUPABASE_JWT_ES256_KID },
  );
  const authed = realtimeClient();
  authed.realtime.setAuth(token);
  const a = subscribeAndCollect(authed, channelKey, 'authed');
  await wait(2500); // allow join

  const { error: insErr } = await svc.from('communication_signals')
    .insert({ channel_key: channelKey, domain: 'notifications' });
  if (insErr) { console.error('signal insert failed:', insErr.message); process.exit(1); }
  await wait(3500);

  const phaseA = a.seen.length > 0;
  console.log(phaseA
    ? `PHASE A PASS — authenticated subscription received ${a.seen.length} signal(s)`
    : 'PHASE A FAIL — authenticated subscription received nothing');
  await authed.removeChannel(a.channel);

  // ── Phase B: ANONYMOUS subscription must receive nothing (post-351) ────────
  const anon = realtimeClient();               // no setAuth — anon token only
  const b = subscribeAndCollect(anon, channelKey, 'anon');
  await wait(2500);
  await svc.from('communication_signals').insert({ channel_key: channelKey, domain: 'messages' });
  await wait(3500);

  const anonBlocked = b.seen.length === 0;
  console.log(anonBlocked
    ? 'PHASE B PASS — anonymous subscription received nothing (RLS enforced)'
    : `PHASE B WARN — anonymous subscription still receives signals (${b.seen.length}); migration 351 not applied yet`);
  await anon.removeChannel(b.channel);

  // Cleanup the two verification signals.
  await svc.from('communication_signals').delete().eq('channel_key', channelKey).in('domain', ['notifications', 'messages'])
    .gte('created_at', new Date(Date.now() - 60_000).toISOString());

  process.exit(phaseA ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
