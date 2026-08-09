/**
 * scripts/e2e/suites/emailWebhook.mjs
 *
 * Live proof of the Resend webhook endpoint over HTTP: raw-body signature verification,
 * idempotency, monotonic lifecycle, unknown message ids and out-of-order delivery.
 *
 * ⛔ NO REAL EMAIL. Nothing here sends: the delivery rows are fixtures with a known
 * provider_message_id, because the subject under test is the WEBHOOK path, not the send path.
 * (The send path is proven by emailDelivery.mjs and the unit suite.)
 *
 * ⭐ The signature is computed HERE, independently, rather than by importing our own signer. A
 * test that signs with the implementation it is testing cannot detect a bug in that
 * implementation — it would agree with itself while rejecting every real Resend call.
 *
 * ⚠ DEPLOYMENT GAP, stated rather than implied: this proves our endpoint accepts correctly
 * signed traffic. It does NOT prove Resend can reach it — a real webhook needs a publicly
 * reachable environment, and localhost cannot receive one.
 */
import { createHmac, randomUUID } from 'node:crypto';

export const title = 'Platform — Resend webhook (signature, idempotency, lifecycle)';

export default async function run(h) {
  const { test, expect, sb, TAG } = h;

  // The harness loads .env into its OWN env object; process.env is not populated from it.
  // Reading the wrong one silently signs with a placeholder, and every assertion then "passes"
  // for the wrong reason — a 401 that proves nothing.
  const SECRET = h.env?.RESEND_WEBHOOK_SECRET ?? process.env.RESEND_WEBHOOK_SECRET;
  const BASE = process.env.BASE_URL || 'http://localhost:8888';
  const deliveryIds = [];
  const eventIds = [];

  h.onCleanup(async () => {
    if (eventIds.length) { try { await sb.from('email_delivery_events').delete().in('provider_event_id', eventIds); } catch {} }
    if (deliveryIds.length) {
      try { await sb.from('email_delivery_events').delete().in('delivery_id', deliveryIds); } catch {}
      try { await sb.from('app_events').delete().in('source_entity_id', deliveryIds); } catch {}
      try { await sb.from('email_deliveries').delete().in('id', deliveryIds); } catch {}
    }
  });

  /** Svix scheme, implemented from the specification rather than from our source. */
  const sign = (secret, id, ts, rawBody) =>
    createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
      .update(`${id}.${ts}.${rawBody}`).digest('base64');

  const post = async (payload, { eventId, secret = SECRET, ts, mangleBody = false } = {}) => {
    const id = eventId ?? `msg_${randomUUID()}`;
    eventIds.push(id);
    const stamp = ts ?? String(Math.floor(Date.now() / 1000));
    const raw = JSON.stringify(payload);
    // Sign the exact bytes we send. When mangleBody is set we sign one string and send another,
    // which is precisely what a re-serialising middleware would do to a genuine call.
    const signature = `v1,${sign(secret ?? 'whsec_x', id, stamp, raw)}`;
    const res = await fetch(`${BASE}/api/email/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': id, 'svix-timestamp': stamp, 'svix-signature': signature,
      },
      body: mangleBody ? JSON.stringify(payload, null, 2) : raw,
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body, eventId: id };
  };

  const seedDelivery = async (providerMessageId, status = 'sent') => {
    const { data, error } = await sb.from('email_deliveries').insert({
      module_key: 'platform', use_case: 'webhook_e2e',
      idempotency_key: `webhook-e2e:${TAG}:${providerMessageId}`,
      recipient: 'webhook-e2e@example.com', sender: 'Siomac <no-reply@example.com>',
      subject: `Webhook E2E ${TAG}`, provider: 'resend',
      provider_message_id: providerMessageId, status,
      sent_at: new Date().toISOString(),
    }).select('id').single();
    expect(!error, `seed delivery: ${error?.message ?? ''}`);
    deliveryIds.push(data.id);
    return data.id;
  };

  const readDelivery = async id => {
    const { data } = await sb.from('email_deliveries')
      .select('status, sent_at, delivered_at, delayed_at, bounced_at, complained_at, failed_at').eq('id', id).single();
    return data;
  };

  const evt = (type, emailId) => ({ type, created_at: new Date().toISOString(), data: { email_id: emailId } });

  h.section('Webhook › Signature');

  await test('setup: the webhook secret is configured for this run', async () => {
    expect(!!SECRET, 'RESEND_WEBHOOK_SECRET must be set in the worktree .env for this suite');
  });

  await test('an INVALID signature is rejected with 401 and writes nothing', async () => {
    const emailId = `wrongsig-${TAG}`;
    const id = await seedDelivery(emailId, 'sent');
    const r = await post(evt('email.delivered', emailId), { secret: 'whsec_YmFkc2VjcmV0YmFkc2VjcmV0YmFkc2VjcmV0' });
    expect(r.status === 401, `expected 401, got ${r.status}`);

    const after = await readDelivery(id);
    expect(after.status === 'sent', `an unverified call must not transition the delivery — got ${after.status}`);
    expect(after.delivered_at === null, 'an unverified call must not stamp delivered_at');
    const { count } = await sb.from('email_delivery_events').select('id', { count: 'exact', head: true }).eq('delivery_id', id);
    expect((count ?? 0) === 0, `an unverified call must write NO event, found ${count}`);
  });

  await test('⭐ a body altered after signing is rejected — the raw-body guarantee', async () => {
    const emailId = `mangled-${TAG}`;
    const id = await seedDelivery(emailId, 'sent');
    const r = await post(evt('email.delivered', emailId), { mangleBody: true });
    expect(r.status === 401, `re-serialised body must fail verification, got ${r.status}`);
    const after = await readDelivery(id);
    expect(after.delivered_at === null, 'nothing was applied');
  });

  h.section('Webhook › Lifecycle');

  await test('email.delivered advances the delivery and stamps delivered_at', async () => {
    const emailId = `delivered-${TAG}`;
    const id = await seedDelivery(emailId, 'sent');
    const r = await post(evt('email.delivered', emailId));
    expect(r.status === 200, `expected 200, got ${r.status}`);
    expect(r.body?.data?.outcome === 'recorded', `expected recorded, got ${r.body?.data?.outcome}`);

    const after = await readDelivery(id);
    expect(after.status === 'delivered', `expected delivered, got ${after.status}`);
    expect(!!after.delivered_at, 'delivered_at stamped');
    expect(!!after.sent_at, 'the earlier sent_at is PRESERVED, not overwritten');
  });

  await test('email.delivery_delayed and email.bounced are applied', async () => {
    const delayedId = `delayed-${TAG}`;
    const d1 = await seedDelivery(delayedId, 'sent');
    expect((await post(evt('email.delivery_delayed', delayedId))).status === 200, 'delayed accepted');
    const afterDelayed = await readDelivery(d1);
    expect(!!afterDelayed.delayed_at, 'delayed_at stamped');
    // delayed ranks BELOW sent, so it records its moment without regressing the status.
    expect(afterDelayed.status === 'sent', `a delay must not regress a sent delivery — got ${afterDelayed.status}`);

    const bouncedId = `bounced-${TAG}`;
    const d2 = await seedDelivery(bouncedId, 'sent');
    expect((await post(evt('email.bounced', bouncedId))).status === 200, 'bounced accepted');
    const afterBounced = await readDelivery(d2);
    expect(afterBounced.status === 'bounced', `a bounce outranks sent — got ${afterBounced.status}`);
    expect(!!afterBounced.sent_at && !!afterBounced.bounced_at, 'both moments preserved');
  });

  await test('email.complained becomes the outcome while earlier moments survive', async () => {
    const emailId = `complained-${TAG}`;
    const id = await seedDelivery(emailId, 'sent');
    expect((await post(evt('email.delivered', emailId))).status === 200, 'delivered first');
    expect((await post(evt('email.complained', emailId))).status === 200, 'then complained');

    const after = await readDelivery(id);
    expect(!!after.delivered_at, 'delivered_at is PRESERVED under a later complaint');
    expect(!!after.complained_at, 'complained_at stamped');
    expect(!!after.sent_at, 'sent_at preserved');
  });

  await test('⭐ an OUT-OF-ORDER sent webhook does not regress a delivered record', async () => {
    // The rule the whole timestamp design exists for: arrival order must not rewrite the outcome.
    const emailId = `ooo-${TAG}`;
    const id = await seedDelivery(emailId, 'sent');
    expect((await post(evt('email.delivered', emailId))).status === 200, 'delivered arrives');
    const beforeDeliveredAt = (await readDelivery(id)).delivered_at;

    const late = await post(evt('email.sent', emailId));
    expect(late.status === 200, 'the late event is still accepted');
    const after = await readDelivery(id);
    expect(after.status === 'delivered', `a late sent must NOT regress delivered — got ${after.status}`);
    expect(after.delivered_at === beforeDeliveredAt, 'delivered_at is untouched by the late event');
  });

  h.section('Webhook › Idempotency and unknown ids');

  await test('the SAME provider event id twice is a successful no-op', async () => {
    const emailId = `dupe-${TAG}`;
    const id = await seedDelivery(emailId, 'sent');
    const eventId = `msg_dupe_${TAG}`;

    const first = await post(evt('email.delivered', emailId), { eventId });
    expect(first.status === 200 && first.body?.data?.outcome === 'recorded', `first is recorded, got ${first.body?.data?.outcome}`);

    const second = await post(evt('email.delivered', emailId), { eventId });
    expect(second.status === 200, `a redelivery must succeed, got ${second.status}`);
    expect(second.body?.data?.outcome === 'duplicate', `expected duplicate, got ${second.body?.data?.outcome}`);

    const { count } = await sb.from('email_delivery_events').select('id', { count: 'exact', head: true })
      .eq('provider_event_id', eventId);
    expect((count ?? 0) === 1, `exactly one event row must exist, found ${count}`);
    void id;
  });

  await test('a duplicate webhook does not emit a second app_event', async () => {
    // Retries are normal provider behaviour; duplicating the audit trail on every retry would
    // make a single bounce look like an outbreak.
    const emailId = `dupevent-${TAG}`;
    const id = await seedDelivery(emailId, 'sent');
    const eventId = `msg_dupevent_${TAG}`;
    await post(evt('email.bounced', emailId), { eventId });
    await post(evt('email.bounced', emailId), { eventId });

    const { count } = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('source_entity_id', id).eq('event_type', 'platform.email.bounced');
    expect((count ?? 0) === 1, `exactly one bounced app_event, found ${count}`);
  });

  await test('an UNKNOWN provider message id is retained and modifies no delivery', async () => {
    const knownId = `untouched-${TAG}`;
    const id = await seedDelivery(knownId, 'sent');
    const before = await readDelivery(id);

    const r = await post(evt('email.bounced', `totally-unknown-${TAG}`));
    expect(r.status === 200, `an unmatched event is still acknowledged, got ${r.status}`);
    expect(r.body?.data?.outcome === 'unmatched', `expected unmatched, got ${r.body?.data?.outcome}`);

    const after = await readDelivery(id);
    expect(after.status === before.status && after.bounced_at === before.bounced_at,
      'an unknown provider id must never touch another delivery');

    const { data: retained } = await sb.from('email_delivery_events')
      .select('id, delivery_id').eq('provider_message_id', `totally-unknown-${TAG}`).maybeSingle();
    expect(!!retained, 'the unmatched event is RETAINED for reconciliation, not discarded');
    expect(retained.delivery_id === null, 'it is retained with a null delivery_id');
  });
}
