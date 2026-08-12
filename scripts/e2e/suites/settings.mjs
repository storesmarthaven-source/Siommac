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

  // ── My Preferences (owner-scoped read) ───────────────────────────────────────────
  h.section('Settings › My Preferences');

  await test('my-preferences (employee) returns own prefs + reflects the set theme', async () => {
    const r = await api('settings/my-preferences', T.b, {});
    ok(r, 'my-preferences failed');
    const list = r.body.data ?? [];
    expect(Array.isArray(list) && list.length > 0, 'no preferences returned');
    const theme = list.find(s => s.settingKey === PREF);
    expect(!!theme, 'user_theme not in my-preferences');
    // PREF was set to 'dark' at user scope earlier in the governance section.
    expect(theme.effectiveValue === 'dark' && theme.effectiveSource === 'user', `expected dark/user, got ${theme?.effectiveValue}/${theme?.effectiveSource}`);
  });

  await test('my-preferences returns ONLY personal/ui preference classes (no policy leak)', async () => {
    const r = await api('settings/my-preferences', T.b, {});
    const list = r.body.data ?? [];
    expect(list.every(s => s.settingClass === 'personal_preference' || s.settingClass === 'ui_preference'), 'my-preferences leaked non-preference settings');
  });

  await test('employee resets OWN preference → falls back to inherited', async () => {
    ok(await api('settings/values/reset', T.b, { settingKey: PREF, scopeType: 'user', scopeId: b.id }), 'reset own pref failed');
    const r = await api('settings/my-preferences', T.b, {});
    const theme = (r.body.data ?? []).find(s => s.settingKey === PREF);
    expect(theme && theme.effectiveSource !== 'user', 'pref override was not cleared');
  });

  // ── Critical governance (cross-module) ───────────────────────────────────────────
  h.section('Settings › Critical governance');

  await test('critical (admin) returns ONLY critical settings across modules', async () => {
    const r = await api('settings/critical', T.admin, {});
    ok(r, 'critical failed');
    const list = r.body.data ?? [];
    expect(Array.isArray(list) && list.length > 0, 'no critical settings returned');
    expect(list.every(s => s.isCritical === true), 'a non-critical setting leaked into critical view');
  });

  await test('ACCESS: employee denied settings/critical', async () => {
    fails(await api('settings/critical', T.b, {}), 'employee should not read critical governance');
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
    // h.users.admin can resolve to a superadmin (allow-all), and requireUser reads
    // the role from the DB (not the JWT) — so provision a real admin-ROLE user to
    // verify the admin role itself is denied (manifest approval is superadmin-only).
    const adminId = `${h.TAG}_mfadmin`;
    const { error: insErr } = await sb.from('app_users').insert({
      id: adminId, username: adminId, full_name: 'Settings E2E Admin',
      role: 'admin', status: 'active', employment_type: 'employee',
    });
    expect(!insErr, `seed admin failed: ${insErr?.message}`);
    h.onCleanup(() => sb.from('app_users').delete().eq('id', adminId));
    const Tadmin = mint({ id: adminId, username: adminId, role: 'admin' });
    fails(await api('settings/manifests/approve', Tadmin, { moduleKey: 'training' }), 'admin should not approve manifests');
  });

  // ── Company branding (legacy /api/* settings routes) ─────────────────────────
  //
  // This section exists because `/api/uploadLogo` was on the coverage waiver
  // list, and under that waiver the endpoint was BROKEN in production for as
  // long as anyone can tell: the frontend posted `{ base64 }` while
  // `UploadLogoSchema` requires `imageBase64`, so every save failed validation.
  // A route-coverage waiver is a decision to not find that class of bug. The
  // contract assertion below — the exact key the schema demands — is the point
  // of the whole section.
  h.section('Settings › Company branding');

  // A 1×1 transparent PNG as a data URI: the smallest input that exercises the
  // real path (MIME sniffing, base64 decode, storage upload) without shipping a
  // fixture file. `uploadBase64` rejects anything that is not a real image type.
  const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // Restore whatever the tenant had before this suite ran. Branding is a real
  // app-wide setting — leaving an E2E logo behind changes the login screen.
  const { data: priorLogo } = await sb.from('settings').select('value').eq('key', 'companyLogoUrl').maybeSingle();
  const uploadedPaths = [];
  h.onCleanup(async () => {
    if (uploadedPaths.length) {
      try { await sb.storage.from('branding').remove(uploadedPaths); } catch {}
    }
    try {
      if (priorLogo?.value !== undefined) {
        await sb.from('settings').upsert(
          { key: 'companyLogoUrl', value: priorLogo.value, updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
      } else {
        await sb.from('settings').delete().eq('key', 'companyLogoUrl');
      }
    } catch {}
  });

  await test('uploadLogo accepts the key the schema declares (imageBase64)', async () => {
    const r = await api('uploadLogo', T.admin, { imageBase64: PNG_1X1 });
    ok(r, 'uploadLogo failed');
    expect(typeof r.body.url === 'string' && r.body.url.length > 0, `no url returned — got ${JSON.stringify(r.body).slice(0, 200)}`);
    const path = r.body.url.split('/branding/').pop();
    if (path) uploadedPaths.push(decodeURIComponent(path.split('?')[0]));
  });

  await test('uploadLogo REJECTS the old `base64` key (regression guard)', async () => {
    // The exact shape the frontend used to send. If this ever starts passing,
    // someone has added a both-keys alias — which is the band-aid this fix
    // deliberately avoided.
    fails(await api('uploadLogo', T.admin, { base64: PNG_1X1 }), 'legacy `base64` key should not validate');
  });

  await test('uploadLogo persists companyLogoUrl and getPublicBranding serves it', async () => {
    const r = await api('uploadLogo', T.admin, { imageBase64: PNG_1X1 });
    ok(r, 'uploadLogo failed');
    const path = r.body.url.split('/branding/').pop();
    if (path) uploadedPaths.push(decodeURIComponent(path.split('?')[0]));

    const { data: row } = await sb.from('settings').select('value').eq('key', 'companyLogoUrl').maybeSingle();
    expect(row?.value === r.body.url, `settings.companyLogoUrl not updated — stored ${row?.value}`);

    // The login screen reads this public endpoint; it must see the new logo
    // without a redeploy, which is what invalidateSettingsCache() is for.
    const pub = await api('getPublicBranding', null, {});
    ok(pub, 'getPublicBranding failed');
    expect(pub.body.companyLogoUrl === r.body.url, `public branding still ${pub.body.companyLogoUrl}`);
  });

  await test('uploadLogo writes an activity_logs row', async () => {
    const { data: rows } = await sb.from('activity_logs')
      .select('action, entity, user_id')
      .eq('entity', 'companyLogoUrl')
      .order('created_at', { ascending: false })
      .limit(1);
    expect(rows?.length === 1 && rows[0].action === 'update', 'no audit row for the logo upload');
  });

  await test('uploadLogo validation rejects an empty and a non-image payload', async () => {
    fails(await api('uploadLogo', T.admin, { imageBase64: '' }), 'empty payload should be rejected');
    fails(await api('uploadLogo', T.admin, {}), 'missing payload should be rejected');
    // Passes the schema (a non-empty string) and must be stopped by uploadBase64's
    // MIME allow-list instead — the two guards cover different things.
    fails(await api('uploadLogo', T.admin, { imageBase64: 'data:application/pdf;base64,JVBERi0=' }), 'non-image type should be rejected');
  });

  await test('ACCESS: employee denied uploadLogo', async () => {
    fails(await api('uploadLogo', T.b, { imageBase64: PNG_1X1 }), 'employee should not change company branding');
  });

  await test('ACCESS: anonymous denied uploadLogo', async () => {
    fails(await api('uploadLogo', null, { imageBase64: PNG_1X1 }), 'anonymous should not change company branding');
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
