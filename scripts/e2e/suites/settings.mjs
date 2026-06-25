// E2E — Settings & Preferences (catalog sync → resolve → governance → audit → reset)
// Requires migrations 20260703000000 + 20260703000001 applied (+ NOTIFY pgrst).

export const title = 'Settings & Preferences';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), b: mint(b) };

  const RENEWAL = 'training.default_renewal_window_days';
  const SAFETY  = 'training.expired_blocks_permit_assignment';
  const STRICT  = 'training.override_requires_reason';
  const PREF    = 'system.user_theme';

  h.onCleanup(async () => {
    for (const k of [RENEWAL, SAFETY, STRICT, PREF]) {
      try { await sb.from('app_setting_values').delete().eq('setting_key', k); } catch {}
      try { await sb.from('app_setting_audit_log').delete().eq('setting_key', k); } catch {}
    }
    // reset the training manifest review state so re-runs start clean
    try {
      const { data: m } = await sb.from('module_settings_manifests').select('id').eq('module_key', 'training').maybeSingle();
      if (m) {
        await sb.from('module_settings_review_approvals').delete().eq('manifest_id', m.id);
        await sb.from('module_settings_manifests').update({ review_status: 'draft', approved_by: null, approved_at: null, returned_reason: null }).eq('id', m.id);
      }
    } catch {}
  });

  const findSetting = (resp, key) => (resp.body.data?.settings ?? []).find(s => s.settingKey === key);

  // ── Catalog sync + list ──────────────────────────────────────────────────────
  h.section('Settings › Catalog');

  await test('catalog/sync populates the catalog from manifests', async () => {
    const r = await api('settings/catalog/sync', T.admin, {});
    ok(r, 'sync failed');
    expect((r.body.data?.totalSettings ?? 0) > 0, 'sync reported zero settings');
  });

  await test('catalog/list returns training entries', async () => {
    const r = await api('settings/catalog/list', T.admin, { moduleKey: 'training' });
    ok(r, 'catalog list failed');
    expect(r.body.data.some(x => x.setting_key === RENEWAL), 'renewal setting not catalogued');
  });

  // ── Resolution + override ────────────────────────────────────────────────────
  h.section('Settings › Resolution & governance');

  await test('effective returns catalog default before any override', async () => {
    const r = await api('settings/effective', T.admin, { moduleKey: 'training' });
    ok(r, 'effective failed');
    const s = findSetting(r, RENEWAL);
    expect(!!s, 'renewal not in effective');
    expect(s.effectiveValue === 90 && s.effectiveSource === 'default', `expected 90/default, got ${s.effectiveValue}/${s.effectiveSource}`);
  });

  await test('admin sets a global override → effective + resolve reflect it', async () => {
    const r = await api('settings/values/set', T.admin, { settingKey: RENEWAL, scopeType: 'global', value: 45, reason: 'E2E' });
    ok(r, 'set global failed');
    const eff = await api('settings/effective', T.admin, { moduleKey: 'training' });
    const s = findSetting(eff, RENEWAL);
    expect(s.effectiveValue === 45 && s.effectiveSource === 'global', `expected 45/global, got ${s.effectiveValue}/${s.effectiveSource}`);
    const res = await api('settings/resolve', T.admin, { settingKey: RENEWAL, moduleKey: 'training' });
    expect(res.body.data?.value === 45, 'resolve did not reflect override');
  });

  await test('value validation rejects out-of-range / wrong type', async () => {
    fails(await api('settings/values/set', T.admin, { settingKey: RENEWAL, scopeType: 'global', value: 9999 }), 'max should be enforced');
    fails(await api('settings/values/set', T.admin, { settingKey: RENEWAL, scopeType: 'global', value: 'thirty' }), 'type should be enforced');
  });

  await test('audit/list records the override', async () => {
    const r = await api('settings/audit/list', T.admin, { settingKey: RENEWAL });
    ok(r, 'audit list failed');
    expect(r.body.data.some(a => Number(a.new_value) === 45), 'override not audited');
  });

  await test('reset removes the override → falls back to default', async () => {
    const r = await api('settings/values/reset', T.admin, { settingKey: RENEWAL, scopeType: 'global' });
    ok(r, 'reset failed');
    const eff = await api('settings/effective', T.admin, { moduleKey: 'training' });
    const s = findSetting(eff, RENEWAL);
    expect(s.effectiveValue === 90 && s.effectiveSource === 'default', 'did not fall back to default');
  });

  // ── Governance limits ────────────────────────────────────────────────────────
  h.section('Settings › Governance limits');

  await test('no-reduce-strictness: admin cannot weaken a locked policy true→false', async () => {
    fails(await api('settings/values/set', T.admin, { settingKey: STRICT, scopeType: 'global', value: false }), 'reducing strictness should be blocked');
  });

  await test('employee can set OWN ui_preference at user scope', async () => {
    const r = await api('settings/values/set', T.b, { settingKey: PREF, scopeType: 'user', scopeId: b.id, value: 'dark' });
    ok(r, 'employee own-preference set failed');
  });

  await test('ACCESS: employee cannot set module policy (no manage perm)', async () => {
    fails(await api('settings/values/set', T.b, { settingKey: RENEWAL, scopeType: 'global', value: 60 }), 'employee should not set module policy');
  });

  await test('ACCESS: employee cannot change a safety rule', async () => {
    fails(await api('settings/values/set', T.b, { settingKey: SAFETY, scopeType: 'global', value: false }), 'employee should not change safety rules');
  });

  await test('ACCESS: employee cannot set another user\'s preference', async () => {
    fails(await api('settings/values/set', T.b, { settingKey: PREF, scopeType: 'user', scopeId: admin.id, value: 'light' }), 'employee should not set others\' prefs');
  });

  await test('ACCESS: employee denied catalog/sync', async () => {
    fails(await api('settings/catalog/sync', T.b, {}), 'employee should not sync catalog');
  });

  // ── Manifest review ──────────────────────────────────────────────────────────────
  h.section('Settings › Manifest review');

  const { data: superUser } = await sb.from('app_users').select('id, username, role').eq('role', 'superadmin').eq('status', 'active').limit(1).maybeSingle();
  const Tsuper = superUser ? mint(superUser) : null;

  await test('manifests/list returns synced manifests', async () => {
    const r = await api('settings/manifests/list', T.admin, {});
    ok(r, 'manifests list failed');
    expect(r.body.data.some(m => m.module_key === 'training'), 'training manifest not listed');
  });

  await test('manifests/get returns manifest + sections + approvals', async () => {
    const r = await api('settings/manifests/get', T.admin, { moduleKey: 'training' });
    ok(r, 'manifests get failed');
    expect(!!r.body.data?.manifest, 'no manifest body');
    expect(Array.isArray(r.body.data.sections), 'no sections array');
  });

  await test('manifests/submit → pending_review', async () => {
    const r = await api('settings/manifests/submit', T.admin, { moduleKey: 'training' });
    ok(r, 'submit failed');
    expect(r.body.data.reviewStatus === 'pending_review', `expected pending_review, got ${r.body.data.reviewStatus}`);
  });

  await test('ACCESS: employee denied manifests/submit', async () => {
    fails(await api('settings/manifests/submit', T.b, { moduleKey: 'training' }), 'employee should not submit manifests');
  });

  await test('ACCESS: admin denied manifests/approve (superadmin-only governance)', async () => {
    fails(await api('settings/manifests/approve', T.admin, { moduleKey: 'training' }), 'admin should not approve manifests');
  });

  if (Tsuper) {
    await test('superadmin review + approve → approved', async () => {
      ok(await api('settings/manifests/review', Tsuper, { moduleKey: 'training', reviewerRole: 'hse', decision: 'approved', comment: 'E2E' }), 'review failed');
      const r = await api('settings/manifests/approve', Tsuper, { moduleKey: 'training' });
      ok(r, 'approve failed');
      expect(r.body.data.reviewStatus === 'approved', `expected approved, got ${r.body.data.reviewStatus}`);
    });
  } else {
    h.log?.('No superadmin user found — skipping manifest review/approve happy-path.');
  }
}
