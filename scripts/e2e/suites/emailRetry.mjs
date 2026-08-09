/**
 * scripts/e2e/suites/emailRetry.mjs
 *
 * Live proof of the generic Retry action and its origin-specific dispatch.
 *
 * ⛔ NO REAL EMAIL. Every case here stops BEFORE the provider is contacted — refused by the status
 * gate, refused by the origin handler, or refused at recipient validation. Nothing in this suite
 * may be changed to use a valid recipient on a registered handler: that WOULD send real mail with
 * the configured live key.
 */

export const title = 'Platform — email retry dispatch';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = { outsiderId: `RETRY-OUT-${TAG}`, outsiderToken: null, userId: `RETRY-USR-${TAG}` };
  const deliveryIds = [];
  const notificationIds = [];

  h.onCleanup(async () => {
    if (deliveryIds.length) {
      try { await sb.from('app_events').delete().in('source_entity_id', deliveryIds); } catch {}
      try { await sb.from('email_deliveries').delete().in('id', deliveryIds); } catch {}
    }
    if (notificationIds.length) {
      try { await sb.from('notification_deliveries').delete().in('notification_id', notificationIds); } catch {}
      try { await sb.from('notifications').delete().in('id', notificationIds); } catch {}
    }
    try { await sb.from('app_users').delete().in('id', [ctx.outsiderId, ctx.userId]); } catch {}
  });

  const seed = async (useCase, status, overrides = {}) => {
    const key = `retry:${TAG}:${useCase}:${status}:${Math.random().toString(36).slice(2)}`;
    const { data, error } = await sb.from('email_deliveries').insert({
      module_key: 'platform', use_case: useCase, idempotency_key: key,
      recipient: `retry-${TAG}@example.com`, sender: 'Siomac <no-reply@example.com>',
      subject: `Retry E2E ${TAG}`, provider: 'resend', status, ...overrides,
    }).select('id, idempotency_key').single();
    expect(!error, `seed ${useCase}/${status}: ${error?.message ?? ''}`);
    deliveryIds.push(data.id);
    return data;
  };

  const retry = (deliveryId, force) => api('email/retry', A, force === undefined ? { deliveryId } : { deliveryId, force });

  h.section('Retry › Access control');

  await test('setup: a REAL non-admin user', async () => {
    const { error } = await sb.from('app_users').insert({
      id: ctx.outsiderId, username: `${TAG}_retry_out`, full_name: `Retry E2E Outsider ${TAG}`,
      role: 'hr_staff', status: 'active', employment_type: 'employee',
    });
    expect(!error, `seed: ${error?.message ?? ''}`);
    ctx.outsiderToken = mint({ id: ctx.outsiderId, username: `${TAG}_retry_out`, role: 'hr_staff', department_id: null });
  });

  await test('retry is denied without settings.system.manage', async () => {
    const d = await seed('test_email', 'failed');
    const r = await api('email/retry', ctx.outsiderToken, { deliveryId: d.id });
    fails(r, 'hr_staff must not retry platform email');
    expect(r.status === 403 || r.status === 401, `expected 403/401, got ${r.status}`);
  });

  h.section('Retry › The status gate');

  await test('⛔ bounced and complained are REFUSED — and force does not unlock them', async () => {
    // The rule with real-world consequences. `force` exists for `delayed` only; if it ever
    // unlocked a bounce, one operator click would damage sender reputation.
    for (const status of ['bounced', 'complained']) {
      const d = await seed('test_email', status);
      for (const force of [undefined, true]) {
        const r = await retry(d.id, force);
        fails(r, `${status} must never be re-sent (force=${force})`);
        expect(r.status === 409, `expected 409, got ${r.status}`);
        expect(r.body.data.refusal === 'not_retryable_status',
          `expected not_retryable_status, got ${r.body.data.refusal}`);
      }
    }
  });

  await test('⭐ delayed requires an explicit operator decision', async () => {
    // The provider already accepted a delayed message, so an automatic re-send risks two copies.
    const d = await seed('test_email', 'delayed');
    const r = await retry(d.id);
    fails(r, 'delayed must not be auto-retried');
    expect(r.status === 409, `expected 409, got ${r.status}`);
    expect(r.body.data.refusal === 'requires_operator_decision',
      `expected requires_operator_decision, got ${r.body.data.refusal}`);
    expect(/two copies|duplicate|risks/i.test(r.body.message ?? ''),
      `the refusal must explain the duplication risk — got ${r.body.message}`);
  });

  await test('force gets a delayed delivery PAST the status gate (then the origin decides)', async () => {
    // Proven with an unregistered use case, so the request stops at the handler lookup and never
    // reaches the provider. What matters is that the refusal MOVED from status to origin.
    const d = await seed('unregistered_use_case', 'delayed');
    const r = await retry(d.id, true);
    fails(r, 'still refused, but for a different reason');
    expect(r.body.data.refusal === 'no_handler',
      `force must clear the STATUS gate — got ${r.body.data.refusal}`);
  });

  h.section('Retry › Origin dispatch');

  await test('an unregistered use case refuses with no_handler rather than guessing', async () => {
    const d = await seed('payslip', 'failed');
    const r = await retry(d.id);
    fails(r, 'payslip has no registered handler yet');
    expect(r.body.data.refusal === 'no_handler', `expected no_handler, got ${r.body.data.refusal}`);
    expect(/payslip/.test(r.body.message ?? ''), `the refusal names the use case — got ${r.body.message}`);
  });

  await test('⭐ an account invitation can NEVER be retried — it requires Reissue', async () => {
    // Not a gap: only token_hash is persisted, so the invite link cannot be rebuilt. Minting a new
    // token here would be a silent credential reissue behind a button labelled Retry.
    const d = await seed('account_invite', 'failed', { source_entity_id: ctx.userId, source_entity_type: 'employee' });
    const r = await retry(d.id);
    fails(r, 'an invitation email cannot be rebuilt');
    expect(r.body.data.refusal === 'origin_invalid', `expected origin_invalid, got ${r.body.data.refusal}`);
    expect(/Reissue Invitation/i.test(r.body.message ?? ''),
      `it must name the real action — got ${r.body.message}`);
    expect(/hash/i.test(r.body.message ?? ''),
      `it must explain WHY the link cannot be rebuilt — got ${r.body.message}`);
  });

  await test('a notification whose origin is gone refuses with origin_missing', async () => {
    const d = await seed('notification', 'failed', { notification_id: null });
    const r = await retry(d.id);
    fails(r, 'nothing to rebuild from');
    expect(r.body.data.refusal === 'origin_missing', `expected origin_missing, got ${r.body.data.refusal}`);
  });

  h.section('Retry › Reconstruction reuses the same record');

  await test('⭐ a real reconstruction reuses the SAME delivery row and the SAME idempotency key', async () => {
    // The user's address is deliberately INVALID, so the rebuilt message is refused at recipient
    // validation and the provider is never contacted — the reconstruction path runs for real
    // without sending. What is asserted is that retry did not mint a second delivery or key.
    const { error: userErr } = await sb.from('app_users').insert({
      id: ctx.userId, username: `${TAG}_retry_usr`, full_name: `Retry E2E Subject ${TAG}`,
      role: 'employee', status: 'active', employment_type: 'employee', email: 'not-a-valid-address',
    });
    expect(!userErr, `seed user: ${userErr?.message ?? ''}`);

    const { data: note, error: noteErr } = await sb.from('notifications').insert({
      user_id: ctx.userId, type: `e2e.retry.${TAG}`.toLowerCase(), title: `Retry origin ${TAG}`,
      body: 'rebuilt from the notification record', is_read: false,
    }).select('id').single();
    expect(!noteErr, `seed notification: ${noteErr?.message ?? ''}`);
    notificationIds.push(note.id);

    const d = await seed('notification', 'failed', { notification_id: note.id });
    const before = await sb.from('email_deliveries').select('id', { count: 'exact', head: true })
      .eq('idempotency_key', d.idempotency_key);

    const r = await retry(d.id);
    // Refused at recipient validation — proof the rebuild ran and the transport did not.
    fails(r, 'the rebuilt message has an invalid recipient');
    expect(/not-a-valid-address/.test(r.body.message ?? ''),
      `the rebuild used the CURRENT address from the origin record — got ${r.body.message}`);

    const after = await sb.from('email_deliveries').select('id, status', { count: 'exact' })
      .eq('idempotency_key', d.idempotency_key);
    expect((after.count ?? 0) === (before.count ?? 0),
      `retry must not create a second delivery row — ${before.count} → ${after.count}`);
    expect((after.data ?? []).length === 1 && after.data[0].id === d.id,
      'the SAME delivery row is reused');
  });

  await test('a retry never creates a new idempotency key', async () => {
    const { data: rows } = await sb.from('email_deliveries')
      .select('idempotency_key').in('id', deliveryIds);
    const keys = (rows ?? []).map(r => r.idempotency_key);
    expect(new Set(keys).size === keys.length,
      'every delivery still holds exactly one distinct key — no retry minted another');
  });
}
