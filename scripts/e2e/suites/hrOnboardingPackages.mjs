/**
 * scripts/e2e/suites/hrOnboardingPackages.mjs
 *
 * E2E suite for the Package Manager (new work): package CRUD, task/handoff
 * template CRUD, package status transitions, and the recent-activity feed.
 * Backend route: hrOnboarding.ts (`/onboarding/packages/*`, `/onboarding/activity/recent`).
 *
 * Scope note: this suite covers ONLY the new work from this batch. The rest of
 * the onboarding module (cases/tasks/handoffs/blockers/wizard/custom-action
 * templates) has no E2E suite yet — a separate, larger pre-existing gap tracked
 * as follow-up work, not part of this batch (explicit scope decision).
 *
 * Permissions: hr.onboarding.packages.manage (superadmin/admin/hr_manager only —
 * NOT hr_staff, which is execution-tier). The negative-path test below PROVISIONS
 * a real hr_staff user rather than forging a JWT role claim, because requireUser
 * resolves role from app_users by sub, not from the token (CLAUDE.md pitfall).
 *
 * Requires 20260714000002/000013/000014 migrations applied + NOTIFY pgrst.
 */

export const title = 'HR Onboarding — Package Manager';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const T = { admin: mint(admin) };

  const staffId = `HR-STAFF-E2E-${TAG}`;
  const label = `E2E Package ${TAG}`;
  const ctx = { packageId: null, packageKey: null, taskTemplateId: null, handoffTemplateId: null };

  h.onCleanup(async () => {
    try { await sb.from('hr_audit_log').delete().eq('record_id', ctx.packageId); } catch {}
    try { await sb.from('app_events').delete().eq('source_entity_id', ctx.packageId); } catch {}
    try { if (ctx.packageId) await sb.from('hr_onboarding_packages').delete().eq('id', ctx.packageId); } catch {} // cascades templates
    try { await sb.from('app_users').delete().eq('id', staffId); } catch {}
  });

  // ── Setup: an hr_staff user for the negative access-control path ────────────────
  h.section('Package Manager › Setup');
  await test('provision a real hr_staff user', async () => {
    const { error } = await sb.from('app_users').insert({
      id: staffId, username: `${TAG}_hrstaff`, full_name: 'HR Staff E2E Tester', role: 'hr_staff', status: 'active', employment_type: 'employee',
    });
    expect(!error, `seed hr_staff failed: ${error?.message}`);
  });
  const staffToken = mint({ id: staffId, username: `${TAG}_hrstaff`, role: 'hr_staff' });

  // ── Access control (negative path FIRST — nothing to create yet) ────────────────
  h.section('Package Manager › Access control');
  await test('hr_staff is denied packages/create (403, no packages.manage)', async () => {
    const r = await api('hr/onboarding/packages/create', staffToken, { label: `${label} (denied)` });
    fails(r, 'hr_staff should not be able to create packages');
  });

  // ── Package CRUD ──────────────────────────────────────────────────────────────
  h.section('Package Manager › Package CRUD');
  await test('packages/create (admin)', async () => {
    const r = await api('hr/onboarding/packages/create', T.admin, {
      label, description: 'E2E test package', workerTypes: ['full_time'], defaultSlaDays: 12, defaultOwnerRole: 'hr',
    });
    ok(r, 'create failed');
    expect(typeof r.body.data?.id === 'string', 'missing id');
    expect(typeof r.body.data?.key === 'string', 'missing key');
    ctx.packageId = r.body.data.id; ctx.packageKey = r.body.data.key;
  });

  await test('packages/get returns full detail shape (draft, empty templates)', async () => {
    const r = await api('hr/onboarding/packages/get', T.admin, { packageKey: ctx.packageKey });
    ok(r, 'get failed');
    const d = r.body.data;
    expect(d.status === 'draft', 'new package should start draft');
    expect(Array.isArray(d.taskTemplates) && d.taskTemplates.length === 0, 'taskTemplates should start empty');
    expect(Array.isArray(d.handoffTemplates) && d.handoffTemplates.length === 0, 'handoffTemplates should start empty');
  });

  await test('packages/update persists label/description/SLA', async () => {
    const r = await api('hr/onboarding/packages/update', T.admin, { id: ctx.packageId, label: `${label} v2`, defaultSlaDays: 20 });
    ok(r, 'update failed');
    const { data } = await sb.from('hr_onboarding_packages').select('package_name, default_sla_days').eq('id', ctx.packageId).single();
    expect(data.package_name === `${label} v2`, 'label not persisted');
    expect(data.default_sla_days === 20, 'SLA not persisted');
  });

  await test('hr_staff is denied packages/update too', async () => {
    const r = await api('hr/onboarding/packages/update', staffToken, { id: ctx.packageId, label: 'hacked' });
    fails(r, 'hr_staff should not be able to update packages');
  });

  // ── Task templates ────────────────────────────────────────────────────────────
  h.section('Package Manager › Task templates');
  await test('task-templates/create', async () => {
    const r = await api('hr/onboarding/packages/task-templates/create', T.admin, {
      packageId: ctx.packageId, taskKey: 'e2e_collect_docs', taskTitle: 'Collect ID documents', ownerRole: 'hr', isBlocking: true, requiresEvidence: true,
    });
    ok(r, 'create failed');
    ctx.taskTemplateId = r.body.data.id;
  });
  await test('duplicate task key in the same package is rejected (409)', async () => {
    const r = await api('hr/onboarding/packages/task-templates/create', T.admin, { packageId: ctx.packageId, taskKey: 'e2e_collect_docs', taskTitle: 'Dup', ownerRole: 'hr' });
    fails(r, 'duplicate task_key should be rejected');
  });
  await test('task-templates/update', async () => {
    const r = await api('hr/onboarding/packages/task-templates/update', T.admin, { id: ctx.taskTemplateId, taskTitle: 'Collect ID + proof of address', isBlocking: false });
    ok(r, 'update failed');
    const { data } = await sb.from('hr_onboarding_task_templates').select('task_title, is_blocking').eq('id', ctx.taskTemplateId).single();
    expect(data.task_title === 'Collect ID + proof of address', 'title not persisted');
    expect(data.is_blocking === false, 'is_blocking not persisted');
  });
  await test('packages/get reflects the task template', async () => {
    const r = await api('hr/onboarding/packages/get', T.admin, { packageKey: ctx.packageKey });
    ok(r);
    expect(r.body.data.taskTemplates.some(t => t.id === ctx.taskTemplateId), 'task template missing from detail');
  });

  // ── Handoff templates ─────────────────────────────────────────────────────────
  h.section('Package Manager › Handoff templates');
  await test('handoff-templates/create', async () => {
    const r = await api('hr/onboarding/packages/handoff-templates/create', T.admin, {
      packageId: ctx.packageId, handoffKey: 'e2e_it_provision', targetModule: 'it', handoffType: 'account_setup',
    });
    ok(r, 'create failed');
    ctx.handoffTemplateId = r.body.data.id;
  });
  await test('handoff-templates/update', async () => {
    const r = await api('hr/onboarding/packages/handoff-templates/update', T.admin, { id: ctx.handoffTemplateId, isRequired: false });
    ok(r, 'update failed');
    const { data } = await sb.from('hr_onboarding_handoff_templates').select('is_required').eq('id', ctx.handoffTemplateId).single();
    expect(data.is_required === false, 'is_required not persisted');
  });

  // ── Side-effects: audit log on package create/update ─────────────────────────────
  h.section('Package Manager › Side-effects');
  await test('package mutations wrote hr_audit_log rows', async () => {
    const { data } = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.packageId).eq('submodule_key', 'onboarding');
    const actions = (data ?? []).map(r => r.action);
    expect(actions.includes('hr.onboarding.package_created'), 'missing package_created audit row');
    expect(actions.includes('hr.onboarding.package_updated'), 'missing package_updated audit row');
  });
  await test('recent activity feed includes this package\'s events', async () => {
    const r = await api('hr/onboarding/activity/recent', T.admin, { limit: 50 });
    ok(r, 'activity/recent failed');
    expect(Array.isArray(r.body.data), 'data not array');
    expect(r.body.data.some(a => a.action === 'hr.onboarding.package_created'), 'package_created not in recent activity');
  });
  await test('hr_staff CAN read activity/recent (view-only, has hr.onboarding.view)', async () => {
    const r = await api('hr/onboarding/activity/recent', staffToken, { limit: 5 });
    ok(r, 'hr_staff should be able to view recent activity');
  });

  // ── Status transitions ────────────────────────────────────────────────────────
  h.section('Package Manager › Status transitions');
  await test('set-status draft → active', async () => {
    const r = await api('hr/onboarding/packages/set-status', T.admin, { id: ctx.packageId, status: 'active' });
    ok(r); expect(r.body.data.status === 'active', 'status not active');
  });
  await test('an active package with templates now appears in packages/list', async () => {
    const r = await api('hr/onboarding/packages/list', T.admin, {});
    ok(r);
    expect(r.body.data.some(p => p.key === ctx.packageKey && p.taskCount === 1 && p.handoffCount === 1), 'package missing/miscounted in list');
  });
  await test('set-status active → retired', async () => {
    const r = await api('hr/onboarding/packages/set-status', T.admin, { id: ctx.packageId, status: 'retired' });
    ok(r); expect(r.body.data.status === 'retired', 'status not retired');
  });

  // ── Cleanup: delete template rows explicitly before the package cascade check ────
  h.section('Package Manager › Template deletion');
  await test('task-templates/delete', async () => {
    const r = await api('hr/onboarding/packages/task-templates/delete', T.admin, { id: ctx.taskTemplateId });
    ok(r, 'delete failed');
    const { data } = await sb.from('hr_onboarding_task_templates').select('id').eq('id', ctx.taskTemplateId).maybeSingle();
    expect(!data, 'task template still exists after delete');
  });
  await test('handoff-templates/delete', async () => {
    const r = await api('hr/onboarding/packages/handoff-templates/delete', T.admin, { id: ctx.handoffTemplateId });
    ok(r, 'delete failed');
    const { data } = await sb.from('hr_onboarding_handoff_templates').select('id').eq('id', ctx.handoffTemplateId).maybeSingle();
    expect(!data, 'handoff template still exists after delete');
  });
}
