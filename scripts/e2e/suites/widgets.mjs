/**
 * scripts/e2e/suites/widgets.mjs
 *
 * Installable widget packages (/api/widgets/packages/*) + dashboard board layouts
 * (/api/layout/*InstanceLayout*). Covers, per the testing standard:
 *   • every endpoint (list / install / uninstall ; layout get / save / default / reset)
 *   • access control — admin passes, non-admin is denied the admin-only keys
 *   • response shape (the contract the board consumes)
 *   • side-effects — install/uninstall emit app_events + audit_logs (the backbone)
 *   • collision rejection + server-side payload sanitisation
 *   • cleanup (tagged rows removed in onCleanup)
 *
 * NOTE: requires the RBAC seed (20260714000010) applied so non-superadmin grants resolve.
 * Positive paths run as `admin` (superadmin = allow-all, seed-independent); negative paths
 * run as `b` (non-admin), which is denied the admin-only manage/default keys regardless of seed.
 */

export const title = 'Widget packages + dashboard layouts';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), b: mint(b) };
  const ctx = { pkgIds: [] };
  const PAGE = `e2e.${TAG}.board`;

  h.onCleanup(async () => {
    if (ctx.pkgIds.length) {
      await sb.from('app_events').delete().in('source_entity_id', ctx.pkgIds);
      await sb.from('audit_logs').delete().in('record_id', ctx.pkgIds);
      await sb.from('ui_widget_packages').delete().in('id', ctx.pkgIds);
    }
    await sb.from('ui_widget_packages').delete().ilike('name', `${TAG}%`);
    await sb.from('ui_layout').delete().eq('page_key', PAGE);
  });

  const pkg = suffix => ({
    name: `${TAG} Pack ${suffix}`, version: '1.0.0',
    widgets: [{ id: `e2e.${TAG}.${suffix}.metric`, title: 'E2E Metric',
      view: { kind: 'metric', metric: 42, supporting: 'e2e' } }],
  });

  // ───────────────────────── PACKAGES ─────────────────────────
  h.section('Widgets › Packages');

  await test('list returns an array (view perm)', async () => {
    const r = await api('widgets/packages/list', T.admin);
    ok(r); expect(Array.isArray(r.body.data), 'data not array');
  });

  let pkgId;
  await test('install (manage perm) creates a package', async () => {
    const r = await api('widgets/packages/install', T.admin, pkg('a'));
    ok(r); pkgId = r.body.data?.id; expect(pkgId, 'no package id returned'); ctx.pkgIds.push(pkgId);
  });

  await test('SIDE-EFFECT: install emitted an app_event', async () => {
    const { data } = await sb.from('app_events').select('event_type')
      .eq('source_entity_id', pkgId).eq('event_type', 'ui.widget_package.installed');
    expect(data && data.length === 1, 'no ui.widget_package.installed app_event');
  });

  await test('SIDE-EFFECT: install wrote an audit_logs row', async () => {
    const { data } = await sb.from('audit_logs').select('id')
      .eq('record_id', pkgId).eq('action', 'ui.widget_package.installed');
    expect(data && data.length >= 1, 'no audit_logs row for install');
  });

  await test('SHAPE: list includes the installed package with its widgets', async () => {
    const r = await api('widgets/packages/list', T.admin);
    ok(r);
    const row = (r.body.data || []).find(p => p.id === pkgId);
    expect(row && Array.isArray(row.widgets) && row.widgets.length === 1, 'installed package not in list with widgets');
  });

  await test('COLLISION: re-installing the same widget id is rejected', async () => {
    fails(await api('widgets/packages/install', T.admin, pkg('a')), 'duplicate widget id was accepted');
  });

  await test('ACCESS: non-admin cannot install', async () => {
    fails(await api('widgets/packages/install', T.b, pkg('z')), 'non-admin installed a package');
  });
  await test('ACCESS: non-admin cannot uninstall', async () => {
    fails(await api('widgets/packages/uninstall', T.b, { id: pkgId }), 'non-admin uninstalled a package');
  });

  await test('uninstall (manage perm) removes the package', async () => {
    const r = await api('widgets/packages/uninstall', T.admin, { id: pkgId });
    ok(r);
    const { data } = await sb.from('ui_widget_packages').select('id').eq('id', pkgId);
    expect(!data || data.length === 0, 'package still present after uninstall');
  });
  await test('SIDE-EFFECT: uninstall emitted an app_event', async () => {
    const { data } = await sb.from('app_events').select('event_type')
      .eq('source_entity_id', pkgId).eq('event_type', 'ui.widget_package.uninstalled');
    expect(data && data.length === 1, 'no ui.widget_package.uninstalled app_event');
  });
  await test('uninstall of a missing package is rejected', async () => {
    fails(await api('widgets/packages/uninstall', T.admin, { id: '00000000-0000-0000-0000-000000000000' }), 'uninstall of missing id accepted');
  });

  // ───────────────────────── BOARD LAYOUTS ─────────────────────────
  h.section('Widgets › Board layouts');

  const layout = { version: 3, columns: 12, pageKey: PAGE, zones: { main: [
    { instanceId: 'i1', widgetId: `e2e.${TAG}.w`, pageKey: PAGE, zoneId: 'main', x: 0, y: 0, w: 4, h: 3, sizeKey: 'standard', config: { metric: 'headcount' }, responsive: { mobile: { x: 0, y: 0, w: 4, h: 3 } } },
  ] } };

  await test('getInstanceLayout returns a layout field for any user', async () => {
    const r = await api('layout/getInstanceLayout', T.admin, { pageKey: PAGE });
    ok(r); expect(r.body.data && 'layout' in r.body.data, 'no layout field');
  });

  await test('saveInstanceLayout (layout.manage) persists the user override', async () => {
    const r = await api('layout/saveInstanceLayout', T.admin, { pageKey: PAGE, layout });
    ok(r);
    const { data } = await sb.from('ui_layout').select('layout').eq('page_key', PAGE).eq('user_id', admin.id).maybeSingle();
    expect(data?.layout?.zones?.main?.length === 1, 'layout not persisted');
    expect(data?.layout?.version === 3 && data?.layout?.columns === 12, 'v3 envelope not persisted');
    const saved = data?.layout?.zones?.main?.[0];
    expect(saved?.pageKey === PAGE && saved?.zoneId === 'main', 'instance placement context missing');
    expect(saved?.config?.metric === 'headcount' && saved?.responsive?.mobile?.w === 4, 'config/responsive placement lost');
  });

  await test('ACCESS: user without layout.manage cannot persist a board', async () => {
    fails(await api('layout/saveInstanceLayout', T.b, { pageKey: PAGE, layout }), 'user without layout.manage saved a board');
  });

  await test('PAYLOAD: oversized ids are capped server-side', async () => {
    const big = 'x'.repeat(500);
    const r = await api('layout/saveInstanceLayout', T.admin, { pageKey: PAGE, layout: {
      pageKey: PAGE, zones: { main: [{ instanceId: big, widgetId: big, x: 0, y: 0, w: 4, h: 3 }] } } });
    ok(r);
    const { data } = await sb.from('ui_layout').select('layout').eq('page_key', PAGE).eq('user_id', admin.id).maybeSingle();
    const it = data?.layout?.zones?.main?.[0];
    expect(it && it.instanceId.length <= 80 && it.widgetId.length <= 120, 'oversized ids were not capped');
  });

  await test('ACCESS: non-admin cannot set the org default layout', async () => {
    fails(await api('layout/saveInstanceLayoutDefault', T.b, { pageKey: PAGE, layout }), 'non-admin set the org default layout');
  });
  await test('saveInstanceLayoutDefault (admin) persists the org default', async () => {
    const r = await api('layout/saveInstanceLayoutDefault', T.admin, { pageKey: PAGE, layout });
    ok(r);
    const { data } = await sb.from('ui_layout').select('id').eq('page_key', PAGE).is('user_id', null).maybeSingle();
    expect(data, 'default layout not persisted');
  });

  await test('resetInstanceLayout clears the user override', async () => {
    const r = await api('layout/resetInstanceLayout', T.admin, { pageKey: PAGE });
    ok(r);
    const { data } = await sb.from('ui_layout').select('layout').eq('page_key', PAGE).eq('user_id', admin.id).maybeSingle();
    expect(!data || data.layout === null, 'user override not cleared');
  });
}
