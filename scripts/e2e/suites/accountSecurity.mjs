/**
 * scripts/e2e/suites/accountSecurity.mjs
 *
 * E2E for the account-security surface (previously untested — coverage-gate debt):
 *   • Trusted devices     (routes/trustedDevices.ts)   — list / revoke / revoke-all
 *   • WebAuthn passkeys    (routes/webauthn.ts)         — credentials list/rename/delete,
 *                                                         prompt/dismiss, options + verify surface
 *   • Step-up             (routes/authStepUp.ts)        — options + verify surface
 *   • Permission overrides (routes/auth.ts)             — authenticated self-only read
 *   • Admin security      (routes/adminSecurity.ts)     — users/status, admin revoke-all,
 *                                                         policy read + update
 *
 * Covers, per the Testing Standard:
 *   • Every reachable endpoint (crypto VERIFY endpoints are covered at the
 *     reachability/negative level — a full success needs a virtual authenticator,
 *     which we do NOT fake).
 *   • Access control: self-service is self-scoped; admin endpoints gate on the
 *     right permission AND step-up; the negative path (plain user, or no step-up)
 *     is denied.
 *   • Step-up gating: high-risk actions require a step-up token (mintStepUp);
 *     a normal token is refused.
 *   • Side-effects: admin revoke + policy update emit their app_events.
 *   • Cleanup: synthetic users + seeded creds/devices removed; the shared
 *     auth_security_policy singleton is SNAPSHOTTED and restored.
 */

import crypto from 'node:crypto';

export const title = 'Account Security (trusted devices, passkeys, step-up, admin)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const mintStepUp = h.mintStepUp;
  const admin = h.users.admin;                       // superadmin harness user (allow-all)

  const uid = (p) => `SEC-${p}-${TAG.slice(-8)}`;
  const secUser     = { id: uid('SELF'),  username: `sec_self_${TAG.slice(-6)}`,  role: 'employee', department_id: null };
  const targetUser  = { id: uid('TGT'),   username: `sec_tgt_${TAG.slice(-6)}`,   role: 'employee', department_id: null };
  const plainUser   = { id: uid('PLAIN'), username: `sec_plain_${TAG.slice(-6)}`, role: 'employee', department_id: null };

  const selfT   = mint(secUser);
  const selfSU  = mintStepUp(secUser);
  const plainT  = mint(plainUser);
  const adminT  = mint(admin);
  const adminSU = mintStepUp(admin);

  const ctx = { credSelf: [], credTgt: [], devSelf: [], devTgt: [], policySnapshot: null, sessionTokenHash: null };

  const seedCred = (owner, n) => ({
    id: `WAC-${owner.id}-${n}`, user_id: owner.id,
    credential_id: `cred_${owner.id}_${n}`, public_key: `pk_${owner.id}_${n}`,
    counter: 0, backed_up: false, device_type: 'multiDevice', label: `Passkey ${n}`,
  });
  const seedDev = (owner, n) => ({
    id: `TD-${owner.id}-${n}`, user_id: owner.id,
    device_id_hash: `didh_${owner.id}_${n}`, device_secret_hash: `dsh_${owner.id}_${n}`,
    label: `Device ${n}`, browser_name: 'Chrome', os_name: 'Windows', device_type: 'desktop',
    trusted_until: '2099-01-01T00:00:00Z', created_with_method: 'totp', security_stamp: `stamp_${owner.id}`,
  });

  h.onCleanup(async () => {
    const users = [secUser.id, targetUser.id, plainUser.id];
    try { await sb.from('webauthn_credentials').delete().in('user_id', users); } catch {}
    try { await sb.from('auth_trusted_devices').delete().in('user_id', users); } catch {}
    try { await sb.from('refresh_tokens').delete().in('user_id', users); } catch {}
    try { await sb.from('session_revocations').delete().in('user_id', users); } catch {}
    try { await sb.from('user_permissions').delete().in('user_id', users); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'auth').in('source_entity_id', [...users, 'default']); } catch {}
    try { await sb.from('activity_logs').delete().eq('action', 'session_revoke').in('entity_id', users); } catch {}
    try { await sb.from('activity_logs').delete().eq('user_id', secUser.id); } catch {}
    try { await sb.from('app_users').delete().in('id', users); } catch {}
    // Restore the shared security-policy singleton to its pre-test values.
    if (ctx.policySnapshot) {
      try {
        await sb.from('auth_security_policy').update({
          require_mfa_for_admin:       ctx.policySnapshot.require_mfa_for_admin,
          require_mfa_for_manager:     ctx.policySnapshot.require_mfa_for_manager,
          require_mfa_for_super_admin: ctx.policySnapshot.require_mfa_for_super_admin,
          updated_by:                  ctx.policySnapshot.updated_by,
          updated_at:                  ctx.policySnapshot.updated_at,
        }).eq('id', 'default');
      } catch {}
    }
  });

  // ── Setup ────────────────────────────────────────────────────────────────────
  h.section('Account Security > Setup');

  await test('provision synthetic users + seed passkeys and trusted devices', async () => {
    const { error: uErr } = await sb.from('app_users').insert(
      [secUser, targetUser, plainUser].map(u => ({
        id: u.id, username: u.username, full_name: `${u.username} (E2E)`,
        role: 'employee', status: 'active', employment_type: 'employee', totp_enabled: false,
      })),
    );
    expect(!uErr, `seed users failed: ${uErr?.message}`);

    const { error: cErr } = await sb.from('webauthn_credentials').insert([seedCred(secUser, 1), seedCred(secUser, 2), seedCred(targetUser, 1), seedCred(targetUser, 2)]);
    expect(!cErr, `seed credentials failed: ${cErr?.message}`);
    // rename/delete match on the `id` column (WAC-...), which listCredentials returns
    // as `id` and the FE passes back as `credentialId`.
    ctx.credSelf = [`WAC-${secUser.id}-1`, `WAC-${secUser.id}-2`];

    const { error: dErr } = await sb.from('auth_trusted_devices').insert([seedDev(secUser, 1), seedDev(secUser, 2), seedDev(targetUser, 1)]);
    expect(!dErr, `seed devices failed: ${dErr?.message}`);
    ctx.devSelf = ['TD-' + secUser.id + '-1', 'TD-' + secUser.id + '-2'];

    const { error: pErr } = await sb.from('user_permissions').insert([
      { user_id: secUser.id, permission: 'dashboard.view', granted: true, set_by: admin.id },
      { user_id: targetUser.id, permission: 'hr.view', granted: false, set_by: admin.id },
    ]);
    expect(!pErr, `seed permission overrides failed: ${pErr?.message}`);

    ctx.sessionTokenHash = crypto.createHash('sha256').update(`session-${TAG}-${targetUser.id}`).digest('hex');
    const { error: sErr } = await sb.from('refresh_tokens').insert({
      user_id: targetUser.id,
      token_hash: ctx.sessionTokenHash,
      user_agent: 'SIOMAC E2E Browser',
      ip_address: '203.0.113.25',
      last_seen_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(!sErr, `seed active session failed: ${sErr?.message}`);

    // Snapshot the policy singleton so we can restore it after policy/update.
    const { data: pol } = await sb.from('auth_security_policy').select('*').eq('id', 'default').maybeSingle();
    ctx.policySnapshot = pol;
    expect(pol, 'auth_security_policy default row must exist');
  });

  // ── Trusted devices (self-service) ───────────────────────────────────────────
  h.section('Account Security > Permission overrides');

  await test('getMyPermissionOverrides denies unauthenticated callers', async () => {
    fails(await api('getMyPermissionOverrides', null, {}), 'permission overrides require authentication');
  });

  await test('getMyPermissionOverrides returns only the caller\'s rows', async () => {
    const r = await api('getMyPermissionOverrides', selfT, {});
    ok(r, `permission override read failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'permission override data must be an array');
    expect(r.body.data.length === 1, `expected one self override, got ${r.body.data.length}`);
    const row = r.body.data[0];
    expect(row.user_id === secUser.id, `cross-user override leaked: ${row.user_id}`);
    expect(row.permission === 'dashboard.view' && row.granted === true, 'override response shape/value mismatch');
    expect('set_by' in row && 'set_at' in row, 'override response is missing audit fields');
  });

  h.section('Account Security > Trusted devices');

  await test('unauthenticated trusted-devices/list is rejected', async () => {
    fails(await api('auth/trusted-devices/list', null, {}), 'no-token list must be denied');
  });

  await test('list returns own devices with the FE-consumed shape', async () => {
    const r = await api('auth/trusted-devices/list', selfT, {});
    ok(r, `list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.devices), 'devices must be an array');
    expect(r.body.devices.length === 2, `expected 2 devices, got ${r.body.devices.length}`);
    for (const k of ['id', 'label', 'browserName', 'osName', 'deviceType', 'trustedUntil', 'method', 'currentDevice']) {
      expect(k in r.body.devices[0], `device missing field: ${k}`);
    }
  });

  await test('revoke a single device → revoked_at set, drops from active list', async () => {
    const r = await api('auth/trusted-devices/revoke', selfT, { trustedDeviceId: ctx.devSelf[0] });
    ok(r, `revoke failed: ${r.body.message}`);
    const { data } = await sb.from('auth_trusted_devices').select('revoked_at').eq('id', ctx.devSelf[0]).maybeSingle();
    expect(data?.revoked_at, 'revoked_at should be set after revoke');
    const list = await api('auth/trusted-devices/list', selfT, {});
    expect(!list.body.devices.some(d => d.id === ctx.devSelf[0]), 'revoked device must not appear in the active list');
  });

  await test('revoke-all WITHOUT step-up is refused (high-risk gate)', async () => {
    fails(await api('auth/trusted-devices/revoke-all', selfT, {}), 'revoke-all needs step-up');
  });

  await test('revoke-all WITH a step-up token revokes every remaining device', async () => {
    const r = await api('auth/trusted-devices/revoke-all', selfSU, {});
    ok(r, `revoke-all failed: ${r.body.message}`);
    const { count } = await sb.from('auth_trusted_devices').select('id', { count: 'exact', head: true })
      .eq('user_id', secUser.id).is('revoked_at', null);
    expect((count ?? 0) === 0, `all devices should be revoked, ${count} still active`);
  });

  // ── WebAuthn passkeys (self-service) ─────────────────────────────────────────
  h.section('Account Security > Passkeys');

  await test('credentials/list returns own passkeys', async () => {
    const r = await api('webauthn/credentials/list', selfT, {});
    ok(r, `credentials/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.credentials) && r.body.credentials.length === 2, `expected 2 passkeys, got ${r.body.credentials?.length}`);
  });

  await test('credentials/rename updates the label', async () => {
    const r = await api('webauthn/credentials/rename', selfT, { credentialId: ctx.credSelf[0], label: 'Renamed Key' });
    ok(r, `rename failed: ${r.body.message}`);
    const { data } = await sb.from('webauthn_credentials').select('label').eq('id', ctx.credSelf[0]).maybeSingle();
    expect(data?.label === 'Renamed Key', `label not updated, got ${data?.label}`);
  });

  await test('credentials/delete WITHOUT step-up is refused', async () => {
    fails(await api('webauthn/credentials/delete', selfT, { credentialId: ctx.credSelf[1] }), 'delete needs step-up');
  });

  await test('credentials/delete WITH step-up removes the passkey', async () => {
    const r = await api('webauthn/credentials/delete', selfSU, { credentialId: ctx.credSelf[1] });
    ok(r, `delete failed: ${r.body.message}`);
    const { data } = await sb.from('webauthn_credentials').select('id').eq('id', ctx.credSelf[1]).maybeSingle();
    expect(!data, 'passkey should be gone after delete');
  });

  await test('prompt/dismiss stamps last_passkey_prompt_at', async () => {
    const r = await api('webauthn/prompt/dismiss', selfT, {});
    ok(r, `prompt/dismiss failed: ${r.body.message}`);
    const { data } = await sb.from('app_users').select('last_passkey_prompt_at').eq('id', secUser.id).maybeSingle();
    expect(data?.last_passkey_prompt_at, 'last_passkey_prompt_at should be set');
  });

  // ── Options + verify SURFACE (crypto verify needs a virtual authenticator) ────
  h.section('Account Security > Challenge options + verify surface');

  await test('webauthn/register/options returns a challenge for an authed user', async () => {
    const r = await api('webauthn/register/options', selfT, {});
    ok(r, `register/options failed: ${r.body.message}`);
    // simplewebauthn returns { challenge, rp, user, pubKeyCredParams, ... } (possibly under `options`)
    const opts = r.body.options ?? r.body;
    expect(typeof opts.challenge === 'string' && opts.challenge.length > 0, 'register/options must return a challenge');
  });

  await test('step-up/options returns a challenge for an authed user', async () => {
    const r = await api('auth/step-up/options', selfT, {});
    ok(r, `step-up/options failed: ${r.body.message}`);
  });

  await test('webauthn/auth/options is reachable (pre-auth login challenge)', async () => {
    const r = await api('webauthn/auth/options', null, { username: secUser.username });
    // No auth required; returns a challenge or a clean 4xx — never a 500 crash.
    expect(r.status !== 500 && r.status !== 0, `auth/options should not 500, got ${r.status}`);
  });

  await test('verify endpoints reject a garbage assertion cleanly (no 500)', async () => {
    // A real success needs a signed authenticator assertion (virtual authenticator),
    // which we do NOT fake. We assert the endpoints EXIST and reject malformed input
    // gracefully. Calls use literal paths so the static coverage gate counts them.
    const bad = { bogus: true, response: {}, username: secUser.username };
    const checks = [
      await api('webauthn/register/verify', selfT, bad),
      await api('webauthn/auth/verify', null, bad),
      await api('auth/step-up/verify', selfT, bad),
      await api('webauthn/register/preauth/options', null, bad),
      await api('webauthn/register/preauth/verify', null, bad),
    ];
    for (const r of checks) {
      expect(r.status !== 500, `verify should reject bad input gracefully, got ${r.status}`);
      expect(r.body && r.body.success === false, 'verify should return success:false on bad input');
    }
  });

  // ── Admin security ───────────────────────────────────────────────────────────
  h.section('Account Security > Admin security');

  await test('users/status reports accurate factor counts for a target user', async () => {
    const r = await api('admin/security/users/status', adminT, { userId: targetUser.id });
    ok(r, `users/status failed: ${r.body.message}`);
    expect(r.body.passkeyCount === 2, `expected 2 passkeys, got ${r.body.passkeyCount}`);
    expect(r.body.trustedDeviceCount === 1, `expected 1 trusted device, got ${r.body.trustedDeviceCount}`);
    expect(r.body.totpEnabled === false, 'totpEnabled should be false');
    expect('mfaMandatory' in r.body, 'mfaMandatory field missing');
  });

  await test('a plain employee is DENIED users/status (needs auth.security.view)', async () => {
    fails(await api('admin/security/users/status', plainT, { userId: targetUser.id }), 'employee must be denied users/status');
  });

  await test('admin passkeys/revoke-all WITHOUT step-up is refused', async () => {
    fails(await api('admin/security/users/passkeys/revoke-all', adminT, { userId: targetUser.id }), 'admin revoke needs step-up');
  });

  await test('admin passkeys/revoke-all WITH step-up deletes target passkeys + emits event', async () => {
    const r = await api('admin/security/users/passkeys/revoke-all', adminSU, { userId: targetUser.id });
    ok(r, `passkeys/revoke-all failed: ${r.body.message}`);
    const { count } = await sb.from('webauthn_credentials').select('id', { count: 'exact', head: true }).eq('user_id', targetUser.id);
    expect((count ?? 0) === 0, `target passkeys should be gone, ${count} remain`);
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('event_type', 'auth.passkey.admin_revoked').eq('source_entity_id', targetUser.id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'auth.passkey.admin_revoked app_event not found');
  });

  await test('admin trusted-devices/revoke-all WITH step-up revokes target devices + emits event', async () => {
    const r = await api('admin/security/users/trusted-devices/revoke-all', adminSU, { userId: targetUser.id });
    ok(r, `trusted-devices/revoke-all failed: ${r.body.message}`);
    const { count } = await sb.from('auth_trusted_devices').select('id', { count: 'exact', head: true })
      .eq('user_id', targetUser.id).is('revoked_at', null);
    expect((count ?? 0) === 0, `target devices should be revoked, ${count} active`);
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('event_type', 'auth.trusted_devices.admin_revoked').eq('source_entity_id', targetUser.id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'auth.trusted_devices.admin_revoked app_event not found');
  });

  await test('a plain employee is DENIED both admin revoke-all endpoints', async () => {
    fails(await api('admin/security/users/passkeys/revoke-all', mintStepUp(plainUser), { userId: targetUser.id }), 'employee denied passkeys revoke');
    fails(await api('admin/security/users/trusted-devices/revoke-all', mintStepUp(plainUser), { userId: targetUser.id }), 'employee denied devices revoke');
  });

  // ── Active-session administration ───────────────────────────────────────────
  h.section('Account Security > Active sessions');

  // sessions.manage is superadmin-only by catalogue design. h.users.admin is
  // NON-DETERMINISTIC (pickUsers takes admin-or-superadmin with no ORDER BY),
  // so this section pins BOTH actors explicitly: the acting revoker is THE
  // real superadmin row; the denial check uses a guaranteed role-admin.
  const { data: saRow } = await sb.from('app_users').select('id, username, role, department_id')
    .eq('role', 'superadmin').eq('status', 'active').limit(1).maybeSingle();
  const saUser = saRow;
  const saT = mint(saUser);
  const { actors: [roleAdmin], createdIds: raCreated } = await h.acquireActors('admin', 1);
  const roleAdminT = mint(roleAdmin);
  h.onCleanup(async () => { if (raCreated?.length) { try { await sb.from('app_users').delete().in('id', raCreated); } catch { /* best-effort */ } } });

  await test('a plain employee is DENIED the active-session register', async () => {
    expect(saUser, 'no active superadmin on the roster — required for session administration');
    fails(await api('superadmin/getActiveSessions', plainT, {}), 'employee must be denied the active-session register');
    fails(await api('superadmin/getActiveSessions', roleAdminT, {}), 'role admin must be denied (sessions.manage is superadmin-only)');
  });

  await test('getActiveSessions returns the synthetic active session with the UI contract', async () => {
    const r = await api('superadmin/getActiveSessions', saT, {});
    ok(r, `getActiveSessions failed: ${r.body.message}`);
    expect(Array.isArray(r.body.sessions), 'sessions must be an array');
    const session = r.body.sessions.find(row => row.userId === targetUser.id);
    expect(session, 'synthetic target session missing from active-session register');
    for (const field of ['userId', 'username', 'fullName', 'role', 'userAgent', 'ipAddress', 'lastSeenAt', 'createdAt']) {
      expect(field in session, `active-session row missing field: ${field}`);
    }
    expect(session.userAgent === 'SIOMAC E2E Browser', `unexpected user agent: ${session.userAgent}`);
    expect(session.ipAddress === '203.0.113.25', `unexpected IP address: ${session.ipAddress}`);
  });

  await test('revokeSession rejects self-revocation and unauthorized callers', async () => {
    fails(await api('superadmin/revokeSession', saT, { userId: saUser.id, idempotencyKey: crypto.randomUUID() }), 'a superadmin must not revoke their own current session');
    fails(await api('superadmin/revokeSession', plainT, { userId: targetUser.id, idempotencyKey: crypto.randomUUID() }), 'employee must be denied remote session revoke');
  });

  await test('revokeSession REQUIRES an idempotency key (no server fallback)', async () => {
    // Exact 400: run as the AUTHORIZED superadmin so a 403 (wrong actor) can
    // never masquerade as the missing-key rejection this test is about.
    const r = await api('superadmin/revokeSession', saT, { userId: targetUser.id });
    fails(r, 'a revoke without an idempotency key must be rejected');
    expect(r.status === 400, `expected 400 for a missing idempotency key, got ${r.status}`);
  });

  const revokeKey = crypto.randomUUID();

  await test('revokeSession is ATOMIC: zero tokens + exactly one marker, event and audit', async () => {
    const r = await api('superadmin/revokeSession', saT, { userId: targetUser.id, idempotencyKey: revokeKey });
    ok(r, `revokeSession failed: ${r.body.message}`);
    expect(r.body.data?.replay === false, 'first revoke must not be a replay');

    const { count: refreshCount } = await sb.from('refresh_tokens').select('token_hash', { count: 'exact', head: true }).eq('user_id', targetUser.id);
    expect((refreshCount ?? 0) === 0, `target refresh tokens remain after revoke: ${refreshCount}`);

    const { data: revocations } = await sb.from('session_revocations').select('revoked_at, revoked_by').eq('user_id', targetUser.id);
    expect(revocations?.length === 1, `expected exactly one revocation marker, got ${revocations?.length}`);
    expect(revocations[0].revoked_by === saUser.username, `unexpected revocation actor: ${revocations[0].revoked_by}`);

    const { data: events } = await sb.from('app_events').select('id')
      .eq('event_type', 'auth.session.revoked').eq('source_entity_id', targetUser.id);
    expect(events?.length === 1, `expected exactly one auth.session.revoked event, got ${events?.length}`);

    const { data: audits } = await sb.from('activity_logs').select('id, user_id')
      .eq('action', 'session_revoke').eq('entity', 'user').eq('entity_id', targetUser.id);
    expect(audits?.length === 1, `expected exactly one session_revoke audit row, got ${audits?.length}`);
    expect(audits[0].user_id === saUser.id, 'audit row has the wrong actor');
  });

  await test('revokeSession same-key RETRY replays the original result and writes nothing new', async () => {
    const r = await api('superadmin/revokeSession', saT, { userId: targetUser.id, idempotencyKey: revokeKey });
    ok(r, `same-key retry failed: ${r.body.message}`);
    expect(r.body.data?.replay === true, 'retry must report replay=true');

    const { data: events } = await sb.from('app_events').select('id')
      .eq('event_type', 'auth.session.revoked').eq('source_entity_id', targetUser.id);
    expect(events?.length === 1, `retry duplicated the event: ${events?.length}`);
    const { data: audits } = await sb.from('activity_logs').select('id')
      .eq('action', 'session_revoke').eq('entity', 'user').eq('entity_id', targetUser.id);
    expect(audits?.length === 1, `retry duplicated the audit row: ${audits?.length}`);
    const { data: revocations } = await sb.from('session_revocations').select('user_id').eq('user_id', targetUser.id);
    expect(revocations?.length === 1, `retry duplicated the revocation marker: ${revocations?.length}`);
  });

  await test('revokeSession same key + DIFFERENT target → 409, nothing written', async () => {
    const r = await api('superadmin/revokeSession', saT, { userId: secUser.id, idempotencyKey: revokeKey });
    fails(r, 'reusing an idempotency key for another target must be rejected');
    expect(r.status === 409, `expected 409, got ${r.status}`);
    const { data: marker } = await sb.from('session_revocations').select('user_id').eq('user_id', secUser.id).maybeSingle();
    expect(!marker, 'a 409 must not write a revocation marker for the other target');
    const { data: events } = await sb.from('app_events').select('id')
      .eq('event_type', 'auth.session.revoked').eq('source_entity_id', secUser.id);
    expect((events?.length ?? 0) === 0, 'a 409 must not write an event for the other target');
  });

  await test('revokeSession on a NON-EXISTENT target → 404, no state written', async () => {
    const ghost = 'USR-GHOST-' + TAG;
    const r = await api('superadmin/revokeSession', saT, { userId: ghost, idempotencyKey: crypto.randomUUID() });
    fails(r, 'revoking a missing user must fail');
    expect(r.status === 404, `expected 404, got ${r.status}`);
    const { data: marker } = await sb.from('session_revocations').select('user_id').eq('user_id', ghost).maybeSingle();
    expect(!marker, 'a failed revoke must not write a revocation marker');
    const { data: audits } = await sb.from('activity_logs').select('id')
      .eq('action', 'session_revoke').eq('entity_id', ghost);
    expect((audits?.length ?? 0) === 0, 'a failed revoke must not write an audit row');
  });

  // ── Security policy ──────────────────────────────────────────────────────────
  h.section('Account Security > Policy');

  await test('auth/security/policy returns the public policy to any authed user', async () => {
    const r = await api('auth/security/policy', selfT, {});
    ok(r, `policy read failed: ${r.body.message}`);
    expect(r.body.policy && typeof r.body.policy === 'object', 'policy object missing');
  });

  await test('policy/update WITHOUT step-up is refused', async () => {
    fails(await api('admin/security/policy/update', adminT, { requireMfaRoles: ['admin'] }), 'policy update needs step-up');
  });

  await test('a plain employee is DENIED policy/update', async () => {
    fails(await api('admin/security/policy/update', mintStepUp(plainUser), { requireMfaRoles: ['admin'] }), 'employee denied policy update');
  });

  await test('policy/update WITH step-up persists requireMfaRoles + emits event (restored on cleanup)', async () => {
    const r = await api('admin/security/policy/update', adminSU, { requireMfaRoles: ['admin', 'manager'] });
    ok(r, `policy/update failed: ${r.body.message}`);
    const { data } = await sb.from('auth_security_policy').select('require_mfa_for_admin, require_mfa_for_manager, require_mfa_for_super_admin').eq('id', 'default').maybeSingle();
    expect(data?.require_mfa_for_admin === true && data?.require_mfa_for_manager === true, 'admin+manager MFA should be on');
    expect(data?.require_mfa_for_super_admin === false, 'superadmin MFA should be off (not requested)');
    const gotEvent = await waitFor(async () => {
      const { data: ev } = await sb.from('app_events').select('id')
        .eq('event_type', 'auth.security.policy_updated').eq('source_entity_id', 'default').limit(1);
      return (ev ?? []).length > 0;
    });
    expect(gotEvent, 'auth.security.policy_updated app_event not found');
  });

  // local waitFor (side-effects are fire-and-forget)
  async function waitFor(check, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  }
}
