/**
 * scripts/e2e/suites/payslipTemplates.mjs
 *
 * E2E for Payslip Studio layout templates — CRUD, access control, editor-state.
 * Updated for the maker-checker lifecycle (migration 20260919000110):
 *   - createTemplate now returns status='draft', isDefault=false
 *     (only APPROVED templates can be set as default)
 *   - listTemplates returns all non-archived (not just approved)
 *   - updateTemplate works on draft/changes_requested templates
 *   - set-default and delete/archive require status='approved' and are tested in
 *     payslipTemplateApproval.mjs (the approval lifecycle suite)
 *
 * Routes under test (mounted at /api/finance):
 *   /api/finance/payroll/payslip-templates/{list, get, create, update}
 *   /api/finance/payroll/payslip-templates/{set-default, delete} — access control only
 *   /api/finance/payroll/payslip-templates/editor-state/{get, save}
 *
 * Requires operator migrations 20260919000020 + 20260919000110 + 20260919000120
 * applied, then build:backend + dev restart.
 */

export const title = 'Finance — Payslip Studio templates (CRUD + editor-state)';

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

  const ctx = {
    aId: null,
    bId: null,
  };
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
  h.section('Payslip templates — Setup');
  // ===========================================================================

  await test('provision finance_manager, plain employee, and view-only user', async () => {
    const users = [
      { id: fmgrId,   username: TAG + '_ptm', full_name: 'PT Fmgr (E2E)',   role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: plainId,  username: TAG + '_pte', full_name: 'PT Plain (E2E)',  role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: viewerId, username: TAG + '_ptv', full_name: 'PT Viewer (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, 'seed users failed: ' + error?.message);

    // Grant the view-only user ONLY finance.payroll.templates.view (view/manage split test).
    const { error: permErr } = await sb.from('user_permissions').upsert(
      { user_id: viewerId, permission: 'finance.payroll.templates.view', granted: true, set_by: 'e2e', set_at: new Date().toISOString() },
      { onConflict: 'user_id,permission' });
    expect(!permErr, 'grant view override failed: ' + permErr?.message);

    fmgrToken   = mint({ id: fmgrId,   username: TAG + '_ptm', role: 'finance_manager', department_id: null });
    plainToken  = mint({ id: plainId,  username: TAG + '_pte', role: 'employee',        department_id: null });
    viewerToken = mint({ id: viewerId, username: TAG + '_ptv', role: 'employee',        department_id: null });
  });

  // ===========================================================================
  h.section('Payslip templates — Access control (both paths)');
  // ===========================================================================

  await test('plain employee CANNOT list templates (view gate -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/list', plainToken, {});
    fails(r, 'employee must not list templates');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('plain employee CANNOT create a template (manage gate -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/create', plainToken, { name: TAG + ' nope', design: sampleDesign(TAG) });
    fails(r, 'employee must not create templates');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('plain employee CANNOT submit (manage gate -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/submit', plainToken, { id: '00000000-0000-0000-0000-000000000001' });
    fails(r, 'employee must not submit');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('plain employee CANNOT approve (approve gate -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/approve', plainToken, { id: '00000000-0000-0000-0000-000000000001' });
    fails(r, 'employee must not approve');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  // ===========================================================================
  h.section('Payslip templates — Create: response shape, always-draft');
  // ===========================================================================

  await test('finance_manager creates template A -> draft, isDefault=false', async () => {
    const r = await api('finance/payroll/payslip-templates/create', fmgrToken, { name: TAG + ' Template A', design: sampleDesign(TAG) });
    ok(r, 'create A failed: ' + r.body.message);
    const d = r.body.data;
    expect(typeof d.id === 'string' && d.id.length > 0, 'DTO has an id');
    expect(d.name === TAG + ' Template A', 'DTO echoes name');
    // Post-P2: new templates are always draft, never auto-default
    expect(d.status === 'draft', 'new template status is draft, got: ' + d.status);
    expect(d.isDefault === false, 'new template is not the default (drafts cannot be default)');
    expect(d.version === 1, 'version starts at 1');
    expect(d.parentTemplateId === null, 'parentTemplateId is null for a fresh template');
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
  h.section('Payslip templates — List / get / update (draft templates)');
  // ===========================================================================

  await test('list includes A (all non-archived); get returns A', async () => {
    const list = await api('finance/payroll/payslip-templates/list', fmgrToken, {});
    ok(list, 'list failed');
    expect(Array.isArray(list.body.data), 'list data is an array');
    expect(list.body.data.some(t => t.id === ctx.aId), 'list includes our draft template A');

    const got = await api('finance/payroll/payslip-templates/get', fmgrToken, { id: ctx.aId });
    ok(got, 'get failed');
    expect(got.body.data && got.body.data.id === ctx.aId, 'get returns A');
    expect(got.body.data.status === 'draft', 'get returns the status field');
  });

  await test('update A renames it (draft templates can be updated)', async () => {
    const r = await api('finance/payroll/payslip-templates/update', fmgrToken, { id: ctx.aId, name: TAG + ' Template A2' });
    ok(r, 'update failed: ' + r.body.message);
    expect(r.body.data.name === TAG + ' Template A2', 'update changes the name');
    expect(r.body.data.status === 'draft', 'update does not change status');
    const au = await sb.from('hr_audit_log').select('action').eq('record_id', ctx.aId);
    expect((au.data ?? []).some(a => a.action === 'payslip_template.updated'), 'update writes an audit row');
  });

  await test('create template B as another draft', async () => {
    const r = await api('finance/payroll/payslip-templates/create', fmgrToken, { name: TAG + ' Template B', design: sampleDesign(TAG + 'b') });
    ok(r, 'create B failed: ' + r.body.message);
    expect(r.body.data.status === 'draft', 'B is also a draft');
    expect(r.body.data.isDefault === false, 'B is not default');
    ctx.bId = r.body.data.id;
  });

  await test('update of APPROVED template is rejected (422)', async () => {
    // Seed an approved template directly via service-role to test the guard
    const { data: approvedRow, error: insErr } = await sb.from('payroll_payslip_templates').insert({
      name: TAG + ' Approved Direct',
      design: sampleDesign(TAG + '_ap'),
      status: 'approved',
      is_default: false,
      version: 1,
      created_by: fmgrId,
      updated_by: fmgrId,
    }).select('id').single();
    expect(!insErr, 'seed approved template failed: ' + insErr?.message);
    const approvedId = approvedRow.id;

    const r = await api('finance/payroll/payslip-templates/update', fmgrToken, { id: approvedId, name: TAG + ' Approved Updated' });
    fails(r, 'updating an approved template must be refused');

    // Cleanup the directly-inserted approved row
    await sb.from('payroll_payslip_templates').delete().eq('id', approvedId);
  });

  // ===========================================================================
  h.section('Payslip templates — Validation');
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
  h.section('Payslip templates — View/manage split (view-only user)');
  // ===========================================================================

  await test('view-only user CAN list', async () => {
    const r = await api('finance/payroll/payslip-templates/list', viewerToken, {});
    ok(r, 'view-only user should be able to list: ' + r.body.message);
    expect(Array.isArray(r.body.data), 'list returns an array for the viewer');
  });

  await test('view-only user CANNOT create (manage gate -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/create', viewerToken, { name: TAG + ' viewer nope', design: sampleDesign(TAG) });
    fails(r, 'view-only user must not create');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('view-only user CANNOT set-default (manage gate -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/set-default', viewerToken, { id: ctx.aId });
    fails(r, 'view-only user must not set-default');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  // ===========================================================================
  h.section('Payslip templates — Per-user editor state (DB-backed autosave)');
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
    expect(g.body.data.draftDesign && g.body.data.draftDesign.elements?.length === 1, 'draft round-trips');
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

  await test('plain employee CANNOT read editor-state (manage gate -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/editor-state/get', plainToken, {});
    fails(r, 'employee must not read editor-state');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('view-only user CANNOT save editor-state (manage gate -> 403)', async () => {
    const r = await api('finance/payroll/payslip-templates/editor-state/save', viewerToken, { draftDesign: sampleDesign(TAG) });
    fails(r, 'view-only user must not save editor-state');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });
}
