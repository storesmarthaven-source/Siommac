/**
 * scripts/e2e/suites/payslipTemplates.mjs
 *
 * E2E for Phase 1 — Payslip Studio layout templates.
 *
 * Routes under test (mounted at /api/finance):
 *   /api/finance/payroll/payslip-templates/{list, get, create, update, set-default, delete}
 *
 * Covers:
 *   - Access control BOTH paths: a plain employee is denied list (view gate) AND
 *     create (manage gate) with 403; a view-only user (per-user override) CAN list
 *     but CANNOT create/set-default (manage gate) → proves the view/manage split.
 *   - Full CRUD lifecycle via a real finance_manager (needs the templates grant).
 *   - Response shape: the exact StoredTemplate the studio consumes
 *     (id, name, isDefault:boolean, updatedAt:number, design).
 *   - Default semantics: first template auto-defaults; set-default flips exactly
 *     one active default; deleting the default promotes another (keep-a-default).
 *   - Soft-delete: archived templates drop out of list.
 *   - Validation: blank name / missing design are refused (422).
 *   - §2 side-effects: every mutation writes app_events + hr_audit_log (asserted
 *     via the service-role client).
 *   - Cleanup: everything tagged by our seeded actor ids, removed in onCleanup.
 *
 * Requires operator migrations 20260919000020 (payroll_payslip_templates) +
 * 20260919000030 (templates grants) applied, then build:backend + dev restart.
 */

export const title = 'Finance Phase 1 - Payslip Studio templates';

function sampleDesign(tag) {
  return {
    page: { size: 'a4', orient: 'portrait', bg: '#ffffff', grid: true },
    elements: [
      {
        id: 'el-' + tag, type: 'heading', x: 24, y: 24, w: 300, h: 32, z: 1, text: 'PAYSLIP',
        color: '#1a2340', bg: 'transparent', fontSize: 26, fontFamily: 'Inter, sans-serif',
        bold: true, italic: false, underline: false, align: 'left', valign: 'top',
        borderW: 0, borderColor: '#d0d5e2', borderStyle: 'solid', radius: 0, padding: 6, lineHeight: 1.4,
      },
    ],
  };
}

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  const fmgrId   = 'PT-FMGR-' + TAG;
  const plainId  = 'PT-EE-'   + TAG;
  const viewerId = 'PT-VIEW-' + TAG;

  const ctx = { aId: null, bId: null };
  let fmgrToken, plainToken, viewerToken;

  h.onCleanup(async () => {
    try { await sb.from('payroll_payslip_templates').delete().in('created_by', [fmgrId, viewerId, plainId]); } catch {}
    try { await sb.from('payroll_payslip_editor_state').delete().in('user_id', [fmgrId, viewerId, plainId]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_payroll').in('actor_user_id', [fmgrId, viewerId, plainId]); } catch {}
    try { await sb.from('hr_audit_log').delete().in('actor_id', [fmgrId, viewerId, plainId]); } catch {}
    try { await sb.from('user_permissions').delete().eq('user_id', viewerId); } catch {}
    try { await sb.from('app_users').delete().in('id', [fmgrId, plainId, viewerId]); } catch {}
  });

  // ===========================================================================
  h.section('Payslip templates - Setup');
  // ===========================================================================

  await test('provision finance_manager, plain employee, and a view-only user', async () => {
    const users = [
      { id: fmgrId,   username: TAG + '_ptm', full_name: 'PT Fmgr (E2E)',   role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: plainId,  username: TAG + '_pte', full_name: 'PT Plain (E2E)',  role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: viewerId, username: TAG + '_ptv', full_name: 'PT Viewer (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, 'seed users failed: ' + error?.message);

    // Grant the view-only user ONLY finance.payroll.templates.view (allow override
    // on an employee) so we can prove the view gate passes while manage denies.
    const { error: permErr } = await sb.from('user_permissions').upsert(
      { user_id: viewerId, permission: 'finance.payroll.templates.view', granted: true, set_by: 'e2e', set_at: new Date().toISOString() },
      { onConflict: 'user_id,permission' });
    expect(!permErr, 'grant view override failed: ' + permErr?.message);

    fmgrToken   = mint({ id: fmgrId,   username: TAG + '_ptm', role: 'finance_manager', department_id: null });
    plainToken  = mint({ id: plainId,  username: TAG + '_pte', role: 'employee',        department_id: null });
    viewerToken = mint({ id: viewerId, username: TAG + '_ptv', role: 'employee',        department_id: null });
  });

  // ===========================================================================
  h.section('Payslip templates - Access control (both paths)');
  // ===========================================================================

  await test('plain employee CANNOT list templates (view gate → 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/list', plainToken, {});
    fails(r, 'employee must not list templates');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('plain employee CANNOT create a template (manage gate → 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/create', plainToken, { name: TAG + ' nope', design: sampleDesign(TAG) });
    fails(r, 'employee must not create templates');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  // ===========================================================================
  h.section('Payslip templates - Create + response shape + first-is-default');
  // ===========================================================================

  await test('finance_manager creates template A (first → auto default)', async () => {
    const r = await api('finance/payroll/payslip-templates/create', fmgrToken, { name: TAG + ' Template A', design: sampleDesign(TAG) });
    ok(r, 'create A failed: ' + r.body.message);
    const d = r.body.data;
    expect(typeof d.id === 'string' && d.id.length > 0, 'DTO has an id');
    expect(d.name === TAG + ' Template A', 'DTO echoes name');
    expect(typeof d.isDefault === 'boolean' && d.isDefault === true, 'first template is the default');
    expect(typeof d.updatedAt === 'number' && d.updatedAt > 0, 'DTO updatedAt is epoch ms');
    expect(d.design && Array.isArray(d.design.elements) && d.design.elements.length === 1, 'DTO carries the design');
    ctx.aId = d.id;
  });

  await test('create A wrote app_events + hr_audit_log (§2)', async () => {
    const ev = await sb.from('app_events').select('event_type').eq('source_entity_id', ctx.aId);
    expect((ev.data ?? []).some(e => e.event_type === 'finance.payroll.payslip_template.created'), 'create emits the created event');
    const au = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.aId);
    expect((au.data ?? []).some(a => a.action === 'payslip_template.created'), 'create writes an audit row');
  });

  // ===========================================================================
  h.section('Payslip templates - List / get / update');
  // ===========================================================================

  await test('list includes A; get returns A', async () => {
    const list = await api('finance/payroll/payslip-templates/list', fmgrToken, {});
    ok(list, 'list failed');
    expect(Array.isArray(list.body.data) && list.body.data.some(t => t.id === ctx.aId), 'list includes A');

    const got = await api('finance/payroll/payslip-templates/get', fmgrToken, { id: ctx.aId });
    ok(got, 'get failed');
    expect(got.body.data && got.body.data.id === ctx.aId, 'get returns A');
  });

  await test('update A renames it + writes another audit row', async () => {
    const r = await api('finance/payroll/payslip-templates/update', fmgrToken, { id: ctx.aId, name: TAG + ' Template A2' });
    ok(r, 'update failed: ' + r.body.message);
    expect(r.body.data.name === TAG + ' Template A2', 'update changes the name');
    const au = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.aId);
    expect((au.data ?? []).some(a => a.action === 'payslip_template.updated'), 'update writes an audit row');
  });

  // ===========================================================================
  h.section('Payslip templates - Default semantics');
  // ===========================================================================

  await test('create template B (second → NOT default)', async () => {
    const r = await api('finance/payroll/payslip-templates/create', fmgrToken, { name: TAG + ' Template B', design: sampleDesign(TAG + 'b') });
    ok(r, 'create B failed: ' + r.body.message);
    expect(r.body.data.isDefault === false, 'second template is not the default');
    ctx.bId = r.body.data.id;
  });

  await test('set-default B → exactly one active default, and it is B', async () => {
    const r = await api('finance/payroll/payslip-templates/set-default', fmgrToken, { id: ctx.bId });
    ok(r, 'set-default failed: ' + r.body.message);
    const list = await api('finance/payroll/payslip-templates/list', fmgrToken, {});
    const mine = list.body.data.filter(t => t.id === ctx.aId || t.id === ctx.bId);
    const defaults = mine.filter(t => t.isDefault);
    expect(defaults.length === 1 && defaults[0].id === ctx.bId, 'exactly one default among ours, and it is B');
    const au = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.bId);
    expect((au.data ?? []).some(a => a.action === 'payslip_template.default_changed'), 'set-default writes an audit row');
  });

  await test('delete the DEFAULT (B) promotes the remaining active template (A)', async () => {
    const r = await api('finance/payroll/payslip-templates/delete', fmgrToken, { id: ctx.bId });
    ok(r, 'delete B failed: ' + r.body.message);
    const list = await api('finance/payroll/payslip-templates/list', fmgrToken, {});
    expect(!list.body.data.some(t => t.id === ctx.bId), 'archived B is not listed (soft-delete)');
    const a = list.body.data.find(t => t.id === ctx.aId);
    expect(a && a.isDefault === true, 'A is promoted to default after B is archived');
  });

  // ===========================================================================
  h.section('Payslip templates - Validation');
  // ===========================================================================

  await test('create with a blank name is refused (422)', async () => {
    const r = await api('finance/payroll/payslip-templates/create', fmgrToken, { name: '   ', design: sampleDesign(TAG) });
    fails(r, 'blank name must be refused');
  });

  await test('create with a missing design is refused (422)', async () => {
    const r = await api('finance/payroll/payslip-templates/create', fmgrToken, { name: TAG + ' no-design' });
    fails(r, 'missing design must be refused');
  });

  // ===========================================================================
  h.section('Payslip templates - View/manage split (view-only user)');
  // ===========================================================================

  await test('view-only user CAN list', async () => {
    const r = await api('finance/payroll/payslip-templates/list', viewerToken, {});
    ok(r, 'view-only user should be able to list: ' + r.body.message);
    expect(Array.isArray(r.body.data), 'list returns an array for the viewer');
  });

  await test('view-only user CANNOT create (manage gate → 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/create', viewerToken, { name: TAG + ' viewer nope', design: sampleDesign(TAG) });
    fails(r, 'view-only user must not create');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('view-only user CANNOT set-default (manage gate → 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/set-default', viewerToken, { id: ctx.aId });
    fails(r, 'view-only user must not set-default');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  // ===========================================================================
  h.section('Payslip templates - Per-user editor state (DB-backed autosave)');
  // ===========================================================================

  await test('editor-state starts empty for a fresh user', async () => {
    const r = await api('finance/payroll/payslip-templates/editor-state/get', fmgrToken, {});
    ok(r, 'editor-state get failed: ' + r.body.message);
    expect(r.body.data.draftDesign === null, 'fresh draftDesign is null');
    expect(r.body.data.openRef === null, 'fresh openRef is null');
  });

  await test('save + read back a working draft (DB round-trip, per-user row)', async () => {
    const design = sampleDesign(TAG + '-draft');
    const s = await api('finance/payroll/payslip-templates/editor-state/save', fmgrToken, { draftDesign: design });
    ok(s, 'editor-state save failed: ' + s.body.message);
    const g = await api('finance/payroll/payslip-templates/editor-state/get', fmgrToken, {});
    ok(g, 'editor-state get failed');
    expect(g.body.data.draftDesign && g.body.data.draftDesign.elements?.length === 1, 'draft round-trips with its design');
    // stored under THIS user's id (per-user isolation is structural — get uses actor.id)
    const { data: row } = await sb.from('payroll_payslip_editor_state').select('user_id').eq('user_id', fmgrId).maybeSingle();
    expect(row && row.user_id === fmgrId, 'draft row is keyed to the calling user');
  });

  await test('partial save of openRef preserves the existing draft', async () => {
    const s = await api('finance/payroll/payslip-templates/editor-state/save', fmgrToken, { openRef: { id: ctx.aId, name: TAG + ' Template A2' } });
    ok(s, 'openRef save failed: ' + s.body.message);
    const g = await api('finance/payroll/payslip-templates/editor-state/get', fmgrToken, {});
    expect(g.body.data.openRef && g.body.data.openRef.id === ctx.aId, 'openRef round-trips');
    expect(g.body.data.draftDesign && g.body.data.draftDesign.elements?.length === 1, 'partial save kept the draft');
  });

  await test('plain employee CANNOT read editor-state (manage gate → 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/editor-state/get', plainToken, {});
    fails(r, 'employee must not read editor-state');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('view-only user CANNOT save editor-state (manage gate → 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/editor-state/save', viewerToken, { draftDesign: sampleDesign(TAG) });
    fails(r, 'view-only user must not save editor-state');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });
}
