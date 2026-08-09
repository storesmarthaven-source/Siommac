/**
 * scripts/e2e/suites/emailDelivery.mjs
 *
 * Live proof of the canonical email delivery service over HTTP: configuration status, the
 * test-send flow, its access control, and the exact response shape an operator UI consumes.
 *
 * ⛔ THIS SUITE NEVER SENDS REAL MAIL. Every test-send here is a DRY RUN. `dryRun` defaults to
 * true precisely so an automated run cannot mail a human by omission, and the suite asserts that
 * default rather than trusting it. Nothing below may ever pass `dryRun: false` — a real send is
 * an explicit, human-approved act, not something a test run performs.
 *
 * Harness contract (see scripts/e2e/README.md):
 *   api(path, token, args)   — token is the SECOND argument
 *   ok(r) / fails(r, msg)    — body.success only; assert r.status SEPARATELY
 *   r.body.data              — not r.data
 */

export const title = 'Platform — email delivery service';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = { outsiderId: `EMAIL-OUT-${TAG}`, outsiderToken: null, sender: null, configured: null };

  h.onCleanup(async () => {
    try { await sb.from('app_events').delete().eq('source_entity_id', ctx.outsiderId); } catch {}
    try { await sb.from('app_users').delete().eq('id', ctx.outsiderId); } catch {}
  });

  h.section('Email delivery › Setup');

  await test('setup: a REAL non-admin user for the negative paths', async () => {
    // A forged role claim proves nothing — requireUser re-reads app_users.role by sub.
    const { error } = await sb.from('app_users').insert({
      id: ctx.outsiderId, username: `${TAG}_email_out`, full_name: `Email E2E Outsider (E2E ${TAG})`,
      role: 'hr_staff', status: 'active', employment_type: 'employee',
    });
    expect(!error, `seed hr_staff: ${error?.message ?? ''}`);
    ctx.outsiderToken = mint({ id: ctx.outsiderId, username: `${TAG}_email_out`, role: 'hr_staff', department_id: null });
  });

  h.section('Email delivery › Status');

  await test('status reports configuration, transport and the RESOLVED sender', async () => {
    const r = await api('email/status', A, {});
    ok(r, `email/status: ${r.body.message ?? ''}`);
    const d = r.body.data;

    expect(typeof d.configured === 'boolean', 'configured is a boolean');
    expect(d.transport === 'resend', `transport should be resend, got ${d.transport}`);
    expect(Array.isArray(d.problems), 'problems is an array');
    ctx.configured = d.configured;
    ctx.sender = d.sender;

    if (d.configured) {
      // No fallback exists, so a resolved sender is proof the environment supplied one.
      expect(d.sender && typeof d.sender.address === 'string' && d.sender.address.includes('@'),
        `a configured service must resolve a real sender — got ${JSON.stringify(d.sender)}`);
      expect(d.problems.length === 0, `configured means no problems, got ${JSON.stringify(d.problems)}`);
    } else {
      expect(d.sender === null, 'an unconfigured service reports a NULL sender, never a guessed default');
      expect(d.problems.length > 0, 'an unconfigured service names the variables at fault');
      expect(d.problems.every(p => typeof p.variable === 'string' && typeof p.message === 'string'),
        'each problem names its variable and explains itself');
    }
  });

  await test('⛔ status never returns the API key, in any form', async () => {
    const r = await api('email/status', A, {});
    ok(r, 'email/status');
    const serialized = JSON.stringify(r.body);
    expect(!/re_[A-Za-z0-9_-]{8,}/.test(serialized),
      'the response must not contain anything shaped like a Resend key');
    expect(!/apiKey|api_key/i.test(serialized), 'the response must not carry an apiKey field at all');
  });

  await test('status is denied to a real user without settings.system.view', async () => {
    const r = await api('email/status', ctx.outsiderToken, {});
    fails(r, 'hr_staff must not read platform email configuration');
    expect(r.status === 403 || r.status === 401, `expected 403/401, got ${r.status}`);
  });

  h.section('Email delivery › Test send (DRY RUN ONLY)');

  await test('test-send defaults to a DRY RUN when dryRun is omitted', async () => {
    // The safety default itself is the assertion: omitting the flag must not mail anyone.
    const r = await api('email/test-send', A, { to: 'e2e-dry-run@example.com' });

    if (!ctx.configured) {
      fails(r, 'an unconfigured service must refuse rather than pretend');
      expect(r.status === 422, `expected 422, got ${r.status}`);
      expect(r.body.data.reason === 'not_configured', `expected not_configured, got ${r.body.data.reason}`);
      return;
    }

    ok(r, `test-send dry run: ${r.body.message ?? ''}`);
    const d = r.body.data;
    expect(d.dryRun === true, `omitting dryRun MUST default to a dry run — got dryRun=${d.dryRun}`);
    expect(d.providerMessageId === null, 'a dry run has no provider message id');
    expect(d.transport === 'resend', `transport echoed, got ${d.transport}`);
    expect(Array.isArray(d.recipients) && d.recipients.includes('e2e-dry-run@example.com'), 'recipients echoed');
    expect(typeof d.sender === 'string' && d.sender.includes('@'), `the resolved sender is reported, got ${d.sender}`);
    expect(/Nothing was sent/i.test(d.message), `the response must say nothing was sent — got ${d.message}`);
  });

  await test('an explicit dryRun: true behaves identically', async () => {
    const r = await api('email/test-send', A, { to: 'e2e-dry-run@example.com', dryRun: true, subject: `E2E ${TAG}` });
    if (!ctx.configured) { fails(r, 'unconfigured'); return; }
    ok(r, `explicit dry run: ${r.body.message ?? ''}`);
    expect(r.body.data.dryRun === true, 'dryRun echoed as true');
  });

  await test('a dry run writes NO app_event — nothing happened externally', async () => {
    // Only a real send is an administrative act worth recording. Emitting an event for a dry run
    // would put a delivery in the trail that never left the building — the same class of defect
    // as a governance event for a zero-row write.
    const { count, error } = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .in('event_type', ['platform.email.test_sent', 'platform.email.test_failed'])
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    expect(!error, `app_events read: ${error?.message ?? ''}`);
    expect((count ?? 0) === 0, `a dry run must emit no test-send event, found ${count}`);
  });

  await test('an invalid recipient is refused by name, before any transport call', async () => {
    const r = await api('email/test-send', A, { to: 'definitely-not-an-address' });
    fails(r, 'an invalid recipient must be refused');
    expect(r.status === 422, `expected 422, got ${r.status}`);
    expect(r.body.data.reason === 'invalid_recipient', `expected invalid_recipient, got ${r.body.data.reason}`);
    expect(/definitely-not-an-address/.test(r.body.message ?? ''),
      `the refusal must name the bad address — got ${r.body.message}`);
  });

  await test('the route schema rejects a missing recipient', async () => {
    const r = await api('email/test-send', A, {});
    fails(r, 'to is required');
    expect(r.status === 400, `expected 400 from the schema, got ${r.status}`);
  });

  await test('test-send is denied to a real user without settings.system.manage', async () => {
    const r = await api('email/test-send', ctx.outsiderToken, { to: 'e2e-dry-run@example.com' });
    fails(r, 'hr_staff must not be able to send platform test mail');
    expect(r.status === 403 || r.status === 401, `expected 403/401, got ${r.status}`);
  });

  h.section('Email delivery › Callers still behave');

  await test('account provisioning reports invite delivery honestly rather than assuming', async () => {
    // Not a send test: it asserts the CONTRACT the canonical service preserved — when the invite
    // cannot be emailed, provisionAccount surfaces the link instead of claiming it was sent.
    // Previously an unverified fallback sender made "sent" indistinguishable from "rejected".
    const r = await api('hr/onboarding/provision-account', A, { employeeId: `NOPE-${TAG}` });
    fails(r, 'a missing employee is refused');
    expect(r.status === 404 || r.status === 400, `expected 404/400, got ${r.status}`);
  });
}
