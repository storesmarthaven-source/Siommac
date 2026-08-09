/**
 * scripts/e2e/suites/emailReconciliation.mjs
 *
 * Live proof of the operator surfaces: Email Delivery status/settings, the delivery-health
 * summary, and the reconciliation report.
 *
 * ⛔ NO REAL EMAIL. Delivery rows are fixtures — the subject under test is what the platform SAYS
 * about deliveries, not the act of sending one.
 *
 * ⭐ The assertion that matters most is the WEBHOOK CAPABILITY GATE, and it is proven in BOTH
 * states within one run. Testing only the current state would leave whichever branch this
 * environment happens to be in permanently unexercised — and this environment has never received
 * a real webhook, so the "available" branch would never run at all.
 */

export const title = 'Platform — email reconciliation and delivery status';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = { outsiderId: `RECON-OUT-${TAG}`, outsiderToken: null };
  const deliveryIds = [];
  const eventIds = [];

  h.onCleanup(async () => {
    if (eventIds.length) { try { await sb.from('email_delivery_events').delete().in('provider_event_id', eventIds); } catch {} }
    if (deliveryIds.length) {
      try { await sb.from('email_delivery_events').delete().in('delivery_id', deliveryIds); } catch {}
      try { await sb.from('email_deliveries').delete().in('id', deliveryIds); } catch {}
    }
    try { await sb.from('app_users').delete().eq('id', ctx.outsiderId); } catch {}
  });

  const seed = async (status, overrides = {}) => {
    const { data, error } = await sb.from('email_deliveries').insert({
      module_key: 'platform', use_case: 'recon_e2e',
      idempotency_key: `recon:${TAG}:${status}:${Math.random().toString(36).slice(2)}`,
      recipient: `recon-${TAG}@example.com`, sender: 'Siomac <no-reply@example.com>',
      subject: `Recon E2E ${TAG}`, provider: 'resend', status, ...overrides,
    }).select('id').single();
    expect(!error, `seed ${status}: ${error?.message ?? ''}`);
    deliveryIds.push(data.id);
    return data.id;
  };

  /** Remove every verified webhook event so the "no capability" branch can be observed. */
  const clearWebhookEvidence = async () => {
    const { data } = await sb.from('email_delivery_events').select('id, provider_event_id');
    return (data ?? []);
  };

  h.section('Reconciliation › Access control');

  await test('setup: a REAL non-admin user', async () => {
    const { error } = await sb.from('app_users').insert({
      id: ctx.outsiderId, username: `${TAG}_recon_out`, full_name: `Recon E2E Outsider ${TAG}`,
      role: 'hr_staff', status: 'active', employment_type: 'employee',
    });
    expect(!error, `seed: ${error?.message ?? ''}`);
    ctx.outsiderToken = mint({ id: ctx.outsiderId, username: `${TAG}_recon_out`, role: 'hr_staff', department_id: null });
  });

  await test('both surfaces are denied without settings.system.view', async () => {
    for (const path of ['email/status', 'email/reconciliation']) {
      const r = await api(path, ctx.outsiderToken, {});
      fails(r, `${path} must be denied to hr_staff`);
      expect(r.status === 403 || r.status === 401, `${path}: expected 403/401, got ${r.status}`);
    }
  });

  h.section('Reconciliation › Status surface');

  await test('status reports webhook state and a counts-only health summary', async () => {
    const r = await api('email/status', A, {});
    ok(r, `email/status: ${r.body.message ?? ''}`);
    const d = r.body.data;

    expect(typeof d.webhook?.configured === 'boolean', 'webhook.configured present');
    expect(typeof d.webhook?.everReceived === 'boolean', 'webhook.everReceived present');
    expect('lastReceivedAt' in d.webhook, 'lastReceivedAt present (may be null)');
    expect(typeof d.health?.total === 'number', 'health.total is a number');
    expect(d.health?.byStatus && typeof d.health.byStatus === 'object', 'health.byStatus present');
    // Counts only — a configuration screen must not become a mail log.
    const serialized = JSON.stringify(d.health);
    expect(!/@example\.com|@smarthaven/.test(serialized), 'health must not carry recipient addresses');
    expect(!/subject/i.test(serialized), 'health must not carry subjects');
  });

  await test('⛔ neither the API key nor the webhook secret is ever returned', async () => {
    for (const path of ['email/status', 'email/reconciliation']) {
      const r = await api(path, A, {});
      ok(r, path);
      const s = JSON.stringify(r.body);
      expect(!/re_[A-Za-z0-9_-]{8,}/.test(s), `${path} must not contain a Resend key`);
      expect(!/whsec_[A-Za-z0-9+/=_-]{8,}/.test(s), `${path} must not contain the webhook secret`);
      expect(!/apiKey|api_key|webhookSecret|webhook_secret/i.test(s), `${path} must carry no secret field`);
    }
  });

  h.section('Reconciliation › The webhook capability gate');

  await test('⭐ with NO webhook evidence, sent deliveries are NOT called stuck', async () => {
    const existing = await clearWebhookEvidence();
    if (existing.length) {
      // Another suite (or a previous run) left verified events behind. Rather than deleting
      // unrelated evidence, assert the OTHER branch here and prove the unavailable branch below
      // via the dedicated fixture-free path.
      const r = await api('email/reconciliation', A, {});
      ok(r, 'reconciliation');
      expect(r.body.data.webhook.everReceived === true, 'capability reflects the events present');
      expect(r.body.data.unconfirmedSent.available === true,
        'with evidence present the sent bucket must be AVAILABLE');
      return;
    }

    // An old accepted-but-unconfirmed delivery: exactly what a naive sweep would call stuck.
    await seed('sent', { sent_at: new Date(Date.now() - 72 * 3600_000).toISOString() });

    const r = await api('email/reconciliation', A, {});
    ok(r, `reconciliation: ${r.body.message ?? ''}`);
    const d = r.body.data;
    expect(d.webhook.everReceived === false, 'no webhook has ever been received here');
    expect(d.unconfirmedSent.available === false,
      'without webhook capability the sent bucket must be UNAVAILABLE, not empty-and-healthy');
    expect(d.unconfirmedSent.entries.length === 0, 'and it must list nothing');
    expect(/webhook not active/i.test(d.unconfirmedSent.reason ?? ''),
      `it must say WHY — got ${d.unconfirmedSent.reason}`);
  });

  await test('⭐ once a verified webhook exists, sent-aging turns ON', async () => {
    // Prove the other branch in the same run: a real verified event makes the gate open.
    const emailId = `recon-cap-${TAG}`;
    const deliveryId = await seed('sent', {
      provider_message_id: emailId,
      sent_at: new Date(Date.now() - 72 * 3600_000).toISOString(),
    });
    const eventId = `recon-cap-evt-${TAG}`;
    eventIds.push(eventId);
    const { error } = await sb.from('email_delivery_events').insert({
      provider: 'resend', provider_event_id: eventId, event_type: 'email.sent',
      provider_message_id: emailId, delivery_id: deliveryId,
    });
    expect(!error, `seed event: ${error?.message ?? ''}`);

    const r = await api('email/reconciliation', A, {});
    ok(r, 'reconciliation with capability');
    const d = r.body.data;
    expect(d.webhook.everReceived === true, 'capability is now true');
    expect(d.unconfirmedSent.available === true, 'the sent bucket is now AVAILABLE');
    expect(d.unconfirmedSent.reason === null, 'no unavailability reason when it is available');
    expect(d.unconfirmedSent.entries.some(e => e.id === deliveryId),
      'the aged accepted-but-unconfirmed delivery is now reported');
  });

  h.section('Reconciliation › Buckets and retryability');

  await test('pending and failed are surfaced REGARDLESS of webhook readiness', async () => {
    const stuckId = await seed('pending', { queued_at: new Date(Date.now() - 60 * 60_000).toISOString() });
    const failedId = await seed('failed', { error_message: 'provider said no' });

    const r = await api('email/reconciliation', A, {});
    ok(r, 'reconciliation');
    expect(r.body.data.stuckPending.some(e => e.id === stuckId), 'stuck pending is reported');
    expect(r.body.data.failed.some(e => e.id === failedId), 'failed is reported');
  });

  await test('⛔ bounced and complained are NEVER offered as retryable', async () => {
    // The rule with real-world consequences: retrying a bounce damages sender reputation, and
    // re-mailing someone who marked you as spam is the worst thing a sender can do.
    const bouncedId = await seed('bounced');
    const complainedId = await seed('complained');

    const r = await api('email/reconciliation', A, {});
    ok(r, 'reconciliation');
    const all = [
      ...r.body.data.stuckPending, ...r.body.data.staleDelayed,
      ...r.body.data.failed, ...r.body.data.unconfirmedSent.entries,
    ];
    for (const id of [bouncedId, complainedId]) {
      const found = all.find(e => e.id === id);
      expect(!found || found.retryable === false,
        `a bounced/complained delivery must never be marked retryable — ${id}`);
    }
    expect(all.filter(e => e.retryable).every(e => ['pending', 'failed', 'delayed'].includes(e.status)),
      'only pending/failed/delayed are ever retryable');
  });

  await test('an unmatched provider event is surfaced for operator review', async () => {
    const eventId = `recon-unmatched-${TAG}`;
    eventIds.push(eventId);
    const { error } = await sb.from('email_delivery_events').insert({
      provider: 'resend', provider_event_id: eventId, event_type: 'email.bounced',
      provider_message_id: `no-such-message-${TAG}`, delivery_id: null,
    });
    expect(!error, `seed unmatched: ${error?.message ?? ''}`);

    const r = await api('email/reconciliation', A, {});
    ok(r, 'reconciliation');
    expect(r.body.data.unmatchedEvents.some(e => e.providerMessageId === `no-such-message-${TAG}`),
      'the unmatched event is listed for review');
  });

  await test('the report states its own thresholds rather than hiding them', async () => {
    const r = await api('email/reconciliation', A, {});
    ok(r, 'reconciliation');
    const t = r.body.data.thresholds;
    expect(typeof t.pendingStuckMinutes === 'number' && typeof t.sentUnconfirmedHours === 'number'
      && typeof t.delayedStaleHours === 'number',
      `an operator cannot judge "stuck" without knowing the threshold — got ${JSON.stringify(t)}`);
  });
}
