// E2E — Account-security policy (DB-backed MFA policy + admin policy/update).
// Verifies lib/securityPolicy reads auth_security_policy and that
// POST /api/admin/security/policy/update persists the MFA-mandatory roles
// (permission + step-up gated, strict schema, audited). Restores the original
// policy in cleanup. Requires migration 20260627400000 (+ 500000) applied.

export const title = 'Security Policy';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, mintStepUp, sb } = h;

  const { data: supers } = await sb.from('app_users')
    .select('id, username, role, department_id').eq('role', 'superadmin').eq('status', 'active').limit(1);
  const sup = supers?.[0];
  if (!sup) { h.log?.('No active superadmin — skipping security-policy suite.'); return; }

  // A non-superadmin, non-admin user (lacks auth.security.manage_policy).
  const { data: others } = await sb.from('app_users')
    .select('id, username, role, department_id').eq('status', 'active')
    .not('role', 'in', '("superadmin","admin")').limit(1);
  const other = others?.[0];

  // Snapshot + restore the singleton policy row so the suite leaves no trace.
  const { data: original } = await sb.from('auth_security_policy')
    .select('require_mfa_for_admin, require_mfa_for_manager, require_mfa_for_super_admin, updated_by')
    .eq('id', 'default').maybeSingle();
  h.onCleanup(async () => {
    if (original) await sb.from('auth_security_policy').update({
      require_mfa_for_admin:       original.require_mfa_for_admin,
      require_mfa_for_manager:     original.require_mfa_for_manager,
      require_mfa_for_super_admin: original.require_mfa_for_super_admin,
      updated_by:                  original.updated_by,
    }).eq('id', 'default');
  });

  // ── Read ──────────────────────────────────────────────────────────────────
  h.section('Security Policy › Read');
  await test('policy read (authenticated) → returns requireMfaRoles array', async () => {
    const r = await api('auth/security/policy', mint(sup), {});
    ok(r, 'policy read');
    expect(Array.isArray(r.body.policy?.requireMfaRoles), 'requireMfaRoles is an array');
  });

  // ── Access control ──────────────────────────────────────────────────────────
  h.section('Security Policy › Access control');
  await test('policy/update (non-privileged) → denied', async () => {
    if (!other) { h.log?.('no non-admin user — skipping'); return; }
    fails(await api('admin/security/policy/update', mintStepUp(other), { requireMfaRoles: ['admin'] }),
      'non-privileged user must be denied');
  });
  await test('policy/update (superadmin, no step-up) → denied', async () => {
    fails(await api('admin/security/policy/update', mint(sup), { requireMfaRoles: ['admin'] }),
      'missing step-up must be denied');
  });

  // ── Persistence + enforcement ─────────────────────────────────────────────
  h.section('Security Policy › Persistence');
  await test('policy/update (superadmin + step-up) → persists all three flags', async () => {
    const r = await api('admin/security/policy/update', mintStepUp(sup), { requireMfaRoles: ['admin', 'manager', 'superadmin'] });
    ok(r, 'policy update');
    const { data: row } = await sb.from('auth_security_policy')
      .select('require_mfa_for_admin, require_mfa_for_manager, require_mfa_for_super_admin').eq('id', 'default').maybeSingle();
    expect(row?.require_mfa_for_admin === true && row?.require_mfa_for_manager === true && row?.require_mfa_for_super_admin === true,
      'all three MFA flags persisted true');
    const rd = await api('auth/security/policy', mint(sup), {});
    expect((rd.body.policy?.requireMfaRoles ?? []).includes('superadmin'), 'read endpoint reflects the change');
  });
  await test('policy/update can turn roles OFF', async () => {
    const r = await api('admin/security/policy/update', mintStepUp(sup), { requireMfaRoles: ['admin'] });
    ok(r, 'policy update (off)');
    const { data: row } = await sb.from('auth_security_policy')
      .select('require_mfa_for_manager, require_mfa_for_super_admin').eq('id', 'default').maybeSingle();
    expect(row?.require_mfa_for_manager === false && row?.require_mfa_for_super_admin === false, 'manager + superadmin turned off');
  });

  // ── Strict schema + side-effects ──────────────────────────────────────────
  h.section('Security Policy › Contract');
  await test('policy/update unknown field → rejected (no silent accept-and-drop)', async () => {
    fails(await api('admin/security/policy/update', mintStepUp(sup), { requireMfaRoles: ['admin'], trustedDevicesEnabled: false }),
      'unknown field must be rejected by the strict schema');
  });
  await test('SIDE-EFFECT: policy update emits auth.security.policy_updated', async () => {
    let found = false;
    for (let i = 0; i < 10 && !found; i++) {                       // emitAppEvent is fire-and-forget
      const { data: ev } = await sb.from('app_events').select('id')
        .eq('event_type', 'auth.security.policy_updated').limit(1);
      found = !!(ev && ev.length);
      if (!found) await new Promise(res => setTimeout(res, 200));
    }
    expect(found, 'policy_updated app_event written');
  });
}
