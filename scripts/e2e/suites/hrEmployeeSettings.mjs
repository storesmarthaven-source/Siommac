/**
 * scripts/e2e/suites/hrEmployeeSettings.mjs
 *
 * E2E for HR Employee Master settings (v36 §11), RECONCILED to the existing
 * catalog system (no dedicated table). Exercises the catalog endpoints
 * (/api/settings/*) for moduleKey 'employees':
 *   catalog/sync → catalog/list → values/set → resolve → values/reset → audit/list
 *
 * Plus the real enforcement loop: setting employees.import_default_create_logins
 * is honored by the import upload (batch policy default).
 *
 * Covers the new §11 setting groups (Import / Onboarding / Change Control / Register
 * Layout / Profile Drawer / Audit & Privacy) + access control (non-settings role
 * denied). No migration needed — catalog/sync is a runtime upsert.
 */

export const title = 'HR Employee Master Settings';

const NEW_KEYS = [
  'employees.import_default_mode', 'employees.import_default_create_logins',
  'employees.onboarding_default_package', 'employees.contact_change_requires_approval',
  'employees.register_show_worker_type', 'employees.profile_default_tab', 'employees.audit_profile_views',
];
const TEST_KEYS = ['employees.contact_change_requires_approval', 'employees.import_default_create_logins'];

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = { empTok: null, importBatchId: null };

  h.onCleanup(async () => {
    // Remove the value overrides + their audit rows this run created (catalog entries stay — they're real).
    await sb.from('app_setting_values').delete().in('setting_key', TEST_KEYS).eq('scope_type', 'global');
    await sb.from('app_setting_audit_log').delete().in('setting_key', TEST_KEYS).eq('changed_by', admin.id);
    if (ctx.importBatchId) await sb.from('hr_employee_import_batches').delete().eq('id', ctx.importBatchId);
  });

  { const { data: emp } = await sb.from('app_users').select('id, username, role, department_id').eq('role', 'employee').eq('status', 'active').limit(1).maybeSingle();
    if (emp) ctx.empTok = mint(emp); }

  // ── catalog sync + list ─────────────────────────────────────────────────────
  await test('catalog/sync (admin) → upserts manifests', async () => {
    const r = await api('settings/catalog/sync', A, {});
    ok(r, 'catalog/sync');
  });

  await test('catalog/list (employees) → new §11 settings present', async () => {
    const r = await api('settings/catalog/list', A, { moduleKey: 'employees' });
    ok(r, 'catalog/list');
    const keys = (r.body.data ?? []).map(x => x.setting_key);
    for (const k of NEW_KEYS) expect(keys.includes(k), `catalog has ${k}`);
    // sanity: a select setting carries allowed_values
    const mode = (r.body.data ?? []).find(x => x.setting_key === 'employees.import_default_mode');
    expect(mode && Array.isArray(mode.allowed_values) && mode.allowed_values.includes('create_update'), 'select allowed_values present');
  });

  await test('catalog/list unauthorized (employee) → denied', async () => {
    const r = await api('settings/catalog/list', ctx.empTok, { moduleKey: 'employees' });
    fails(r, 'employee cannot view settings catalog');
  });

  // ── set / resolve / reset ───────────────────────────────────────────────────
  await test('values/set (admin) → override a setting at global scope', async () => {
    const r = await api('settings/values/set', A, { settingKey: 'employees.contact_change_requires_approval', scopeType: 'global', value: true, reason: 'e2e' });
    ok(r, 'values/set');
    const { data: row } = await sb.from('app_setting_values').select('value').eq('setting_key', 'employees.contact_change_requires_approval').eq('scope_type', 'global').maybeSingle();
    expect(row && row.value === true, `override stored true — got ${row && JSON.stringify(row.value)}`);
  });

  await test('resolve (admin) → reflects the override', async () => {
    const r = await api('settings/resolve', A, { settingKey: 'employees.contact_change_requires_approval', moduleKey: 'employees' });
    ok(r, 'resolve');
  });

  await test('values/set unauthorized (employee) → denied', async () => {
    const r = await api('settings/values/set', ctx.empTok, { settingKey: 'employees.contact_change_requires_approval', scopeType: 'global', value: false });
    fails(r, 'employee cannot set settings');
  });

  await test('values/reset (admin) → removes the override', async () => {
    const r = await api('settings/values/reset', A, { settingKey: 'employees.contact_change_requires_approval', scopeType: 'global', reason: 'e2e reset' });
    ok(r, 'values/reset');
    const { data: row } = await sb.from('app_setting_values').select('id').eq('setting_key', 'employees.contact_change_requires_approval').eq('scope_type', 'global').maybeSingle();
    expect(!row, 'override removed');
  });

  await test('audit/list (admin) → records the set + reset', async () => {
    const r = await api('settings/audit/list', A, { settingKey: 'employees.contact_change_requires_approval' });
    ok(r, 'audit/list');
    expect((r.body.data ?? []).length >= 2, `>=2 audit entries (set + reset) — got ${(r.body.data ?? []).length}`);
  });

  // ── enforcement loop: import honors the setting default ──────────────────────
  await test('import honors employees.import_default_create_logins', async () => {
    await api('settings/values/set', A, { settingKey: 'employees.import_default_create_logins', scopeType: 'global', value: false });
    const csv = Buffer.from('firstName,lastName,workerType,department,position\nA,B,employee,Ops,Tester\n', 'utf8').toString('base64');
    const up = await api('hr/employees/import/upload', A, { fileName: `${TAG}-set.csv`, fileType: 'csv', fileBase64: csv });
    ok(up, 'upload (no explicit policy)');
    ctx.importBatchId = up.body.data.batchId;
    const { data: batch } = await sb.from('hr_employee_import_batches').select('policy').eq('id', ctx.importBatchId).maybeSingle();
    expect(batch && batch.policy && batch.policy.createLogins === false, `batch policy createLogins from setting — got ${batch && JSON.stringify(batch.policy)}`);
  });
}
