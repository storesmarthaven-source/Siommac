/**
 * scripts/e2e/suites/notificationDeliveries.mjs
 *
 * Live proof that an EMAIL notification leaves an auditable per-channel record.
 *
 * The gap this closes: `notification_deliveries` has carried `channel`, `provider_message_id`
 * and `error` since the table was created, and only `in_app` rows were ever written. An email
 * could be attempted, skipped or rejected and the system recorded nothing — "did this person get
 * the email?" had no answer anywhere.
 *
 * ⛔ NO REAL EMAIL IS SENT BY THIS SUITE, and none may ever be added.
 * Every case below is steered to an outcome that stops BEFORE the provider is contacted:
 *   · opted out          → nothing attempted,
 *   · opted in, no address → skipped,
 *   · opted in, INVALID address → refused at validation, transport never called.
 * ⚠ Giving a fixture user a VALID email address and opting them in WOULD send real mail with the
 * configured live key. Do not do it. The `sent` path is proven by the pure status rule in
 * tests/vitest/emailDelivery.test.ts instead, which needs no provider at all.
 *
 * Harness contract: api(path, token, args) — token SECOND; ok/fails check body.success only.
 */

export const title = 'Platform — notification delivery records (email channel)';

export default async function run(h) {
  const { api, test, expect, ok, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = {
    optedOutId:  `NDEL-OUT-${TAG}`,
    noAddressId: `NDEL-NOADDR-${TAG}`,
    badAddressId:`NDEL-BAD-${TAG}`,
  };
  const userIds = [ctx.optedOutId, ctx.noAddressId, ctx.badAddressId];
  const TYPE = `e2e.delivery.${TAG}`.toLowerCase();

  h.onCleanup(async () => {
    const { data: notes } = await sb.from('notifications').select('id').in('user_id', userIds);
    const noteIds = (notes ?? []).map(n => n.id);
    if (noteIds.length) { try { await sb.from('notification_deliveries').delete().in('notification_id', noteIds); } catch {} }
    try { await sb.from('notifications').delete().in('user_id', userIds); } catch {}
    try { await sb.from('notification_preferences').delete().in('user_id', userIds); } catch {}
    try { await sb.from('app_users').delete().in('id', userIds); } catch {}
  });

  /** Trigger a notification and wait for the awaited email leg to finish recording. */
  const fire = async (userId) => {
    const r = await api('sendNotification', A, { userId, type: TYPE, title: `Delivery record test ${TAG}` });
    ok(r, `sendNotification: ${r.body.message ?? ''}`);
    // The route is fire-and-forget by design (it responds before notify() finishes), so the
    // record appears slightly after the response. Poll rather than sleep-and-hope.
    for (let i = 0; i < 25; i++) {
      const { data } = await sb.from('notifications').select('id').eq('user_id', userId).limit(1);
      if (data?.length) {
        const { data: d } = await sb.from('notification_deliveries')
          .select('id, channel, status, provider_message_id, error')
          .eq('notification_id', data[0].id);
        if ((d ?? []).some(x => x.channel === 'email')) return { notificationId: data[0].id, deliveries: d };
        if (i > 12 && (d ?? []).length) return { notificationId: data[0].id, deliveries: d };
      }
      await new Promise(res => setTimeout(res, 400));
    }
    return { notificationId: null, deliveries: [] };
  };

  const seed = async (id, email) => {
    const { error } = await sb.from('app_users').insert({
      id, username: `${TAG}_${id}`.toLowerCase().slice(0, 40), full_name: `Delivery E2E ${id}`,
      role: 'employee', status: 'active', employment_type: 'employee', email,
    });
    expect(!error, `seed ${id}: ${error?.message ?? ''}`);
  };
  const setPrefs = async (id, prefs) => {
    const { error } = await sb.from('notification_preferences')
      .insert({ user_id: id, event_type: TYPE, ...prefs });
    expect(!error, `prefs ${id}: ${error?.message ?? ''}`);
  };

  h.section('Delivery records › Opt-out');

  await test('a user opted OUT of email gets an in_app record and NO email record', async () => {
    await seed(ctx.optedOutId, null);
    await setPrefs(ctx.optedOutId, { in_app: true, email: false, whatsapp: false });

    const { notificationId, deliveries } = await fire(ctx.optedOutId);
    expect(!!notificationId, 'the notification was persisted');
    const channels = (deliveries ?? []).map(d => d.channel);
    expect(channels.includes('in_app'), `in_app delivery recorded, got ${JSON.stringify(channels)}`);
    expect(!channels.includes('email'),
      'opting out of email must record NO email delivery — an opt-out is not a skipped attempt');
  });

  h.section('Delivery records › Opted in');

  await test('opted in with NO address on file is recorded as skipped, with the reason', async () => {
    await seed(ctx.noAddressId, null);
    await setPrefs(ctx.noAddressId, { in_app: true, email: true, whatsapp: false });

    const { deliveries } = await fire(ctx.noAddressId);
    const email = (deliveries ?? []).find(d => d.channel === 'email');
    expect(!!email, `an email delivery row must exist, got ${JSON.stringify(deliveries)}`);
    expect(email.status === 'skipped', `expected skipped, got ${email.status}`);
    expect(/no email address/i.test(email.error ?? ''), `the reason must be recorded, got ${email.error}`);
    expect(email.provider_message_id === null, 'a skip has no provider message id');
  });

  await test('opted in with an INVALID address is recorded as failed — never as sent', async () => {
    // Invalid by construction: sendEmail refuses it at validation, so the provider is never
    // contacted. This is what makes the test safe to run against a live key.
    await seed(ctx.badAddressId, 'not-a-valid-address');
    await setPrefs(ctx.badAddressId, { in_app: true, email: true, whatsapp: false });

    const { deliveries } = await fire(ctx.badAddressId);
    const email = (deliveries ?? []).find(d => d.channel === 'email');
    expect(!!email, `an email delivery row must exist, got ${JSON.stringify(deliveries)}`);
    expect(email.status === 'failed', `expected failed, got ${email.status}`);
    expect(email.status !== 'sent', 'a refused message must NEVER be recorded as sent');
    expect(email.provider_message_id === null, 'a failure carries no provider message id');
    expect(/not-a-valid-address/.test(email.error ?? ''),
      `the failure must name the offending address, got ${email.error}`);
  });

  await test('exactly ONE email delivery row per notification — queued-first updates, not duplicates', async () => {
    // The attempt is recorded as `pending` BEFORE the send and UPDATED afterwards. If the update
    // ever became a second insert, evidence would double-count every email the platform sends.
    const { data: notes } = await sb.from('notifications').select('id').eq('user_id', ctx.badAddressId);
    const ids = (notes ?? []).map(n => n.id);
    expect(ids.length > 0, 'the notification exists');
    const { data: rows } = await sb.from('notification_deliveries')
      .select('id, channel').in('notification_id', ids).eq('channel', 'email');
    expect((rows ?? []).length === 1, `expected exactly 1 email delivery row, got ${(rows ?? []).length}`);
  });

  await test('no delivery row is ever left stranded in pending', async () => {
    const { data: notes } = await sb.from('notifications').select('id').in('user_id', userIds);
    const ids = (notes ?? []).map(n => n.id);
    const { data: rows } = await sb.from('notification_deliveries')
      .select('status, channel').in('notification_id', ids.length ? ids : ['-']).eq('channel', 'email');
    const stuck = (rows ?? []).filter(r => r.status === 'pending');
    expect(stuck.length === 0,
      `every recorded attempt must reach a terminal status — ${stuck.length} left pending`);
  });
}
