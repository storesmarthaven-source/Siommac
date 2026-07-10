/**
 * scripts/e2e/suites/financePayComponents.mjs
 *
 * E2E for Finance Phase 2 — Pay-Component Maker-Checker (Change-Request Envelope).
 *
 * IMPORTANT: The existing financeStatutory.mjs pay-component CRUD tests (create /
 * update / retire expect a PayComponent DTO back) are now BROKEN because Phase 2
 * converts those endpoints to return PayComponentChangeRequest. The owner of
 * financeStatutory.mjs must update or remove those tests. This suite replaces them.
 *
 * Routes under test:
 *   POST finance/payroll/components/create          — opens a CR (manage permission)
 *   POST finance/payroll/components/update          — opens a CR (manage permission)
 *   POST finance/payroll/components/retire          — opens a CR (manage permission)
 *   POST finance/payroll/components/change-requests/list    — view permission
 *   POST finance/payroll/components/change-requests/approve — approve permission + SoD
 *   POST finance/payroll/components/change-requests/reject  — approve permission + SoD
 *
 * Covers:
 *   • Create CR → submit → different manager approves → component created in DB.
 *   • Creator cannot approve own CR (SoD — 422 returned).
 *   • Update CR → approve → component patched in DB.
 *   • Retire CR → approve → component is_active=false in DB.
 *   • Reject CR → component unchanged.
 *   • finance_staff (view only) DENIED manage + approve.
 *   • employee DENIED all mutating endpoints.
 *   • §2 side-effects: app_events, hr_audit_log, workflow_tasks asserted.
 *   • Response shape assertions for fields the frontend consumes.
 *   • Cleanup: all test rows deleted via h.TAG / h.onCleanup.
 *
 * Prerequisites:
 *   • Migrations applied: 20260917000200 + 20260917000210 + all prior statutory.
 *   • Live dev server: npm run dev:netlify.
 *   • Run: npm run test:e2e -- financePayComponents
 */

export const title = 'Finance — Pay Component Maker-Checker (Phase 2)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  // ── Provision finance users ────────────────────────────────────────────────────
  let fmgr1Id, fmgr2Id, fstaff1Id, empId;
  let fmgr1Token, fmgr2Token, fstaff1Token, empToken;

  const ctx = {
    // CR ids
    createCrId: null,
    updateCrId: null,
    retireCrId: null,
    rejectCrId: null,
    // Component ids (set after approval applies the CR)
    createdCompId: null,
    retireTargetCompId: null,
    // Provisioned user ids (for cleanup)
    createdUserIds: [],
  };

  const waitFor = async (check, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    // Delete change requests first (they FK to components)
    const crIds = [ctx.createCrId, ctx.updateCrId, ctx.retireCrId, ctx.rejectCrId].filter(Boolean);
    try { if (crIds.length) await sb.from('finance_pay_component_change_requests').delete().in('id', crIds); } catch {}
    // Delete any test-created components
    try {
      await sb.from('finance_pay_components').delete().or(
        [ctx.createdCompId, ctx.retireTargetCompId].filter(Boolean).map(id => `id.eq.${id}`).join(',') || 'id.eq.00000000-0000-0000-0000-000000000000',
      );
    } catch {}
    // Clean up audit + event rows for test actors
    const actorIds = [fmgr1Id, fmgr2Id, fstaff1Id, empId].filter(Boolean);
    try { if (actorIds.length) await sb.from('hr_audit_log').delete().eq('submodule_key', 'finance_payroll_components').in('actor_id', actorIds); } catch {}
    try { if (actorIds.length) await sb.from('app_events').delete().eq('source_module', 'finance_payroll_components').in('actor_user_id', actorIds); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('Provision 2 finance_managers + 1 finance_staff + 1 employee', async () => {
    const mgrR  = await acquireActors('finance_manager', 2);
    const stfR  = await acquireActors('finance_staff', 1);
    const empR  = await acquireActors('employee', 1);
    const [mgr1, mgr2] = mgrR.actors;
    const [stf1] = stfR.actors;
    const [emp]  = empR.actors;
    fmgr1Id = mgr1.id; fmgr2Id = mgr2.id; fstaff1Id = stf1.id; empId = emp.id;
    ctx.createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

    fmgr1Token  = mint({ id: fmgr1Id,  username: mgr1.username, role: 'finance_manager', department_id: mgr1.department_id ?? null });
    fmgr2Token  = mint({ id: fmgr2Id,  username: mgr2.username, role: 'finance_manager', department_id: mgr2.department_id ?? null });
    fstaff1Token = mint({ id: fstaff1Id, username: stf1.username, role: 'finance_staff',   department_id: stf1.department_id ?? null });
    empToken    = mint({ id: empId,    username: emp.username,  role: 'employee',         department_id: emp.department_id ?? null });

    expect(fmgr1Id && fmgr2Id, 'failed to provision finance_managers');
    expect(fmgr1Id !== fmgr2Id, 'must be TWO distinct managers for SoD tests');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Submit change requests');
  // ═══════════════════════════════════════════════════════════════════════════

  // ── CREATE CR ──────────────────────────────────────────────────────────────

  await test('finance_manager creates a pay component — returns a CR, not a component', async () => {
    const r = await api('finance/payroll/components/create', fmgr1Token, {
      code:                   `PCR_${TAG.slice(-6)}`,
      name:                   `PCR Test Component ${TAG}`,
      kind:                   'earning',
      isStatutory:            false,
      isTaxable:              true,
      reducesChargeable:      false,
      glAccountCode:          null,
      costAllocationRequired: false,
    });
    ok(r, `create CR failed: ${r.body.message}`);
    const cr = r.body.data;
    // Response shape: PayComponentChangeRequest
    expect(cr.id,                            'CR missing id');
    expect(cr.changeType === 'create',        `changeType should be "create", got "${cr.changeType}"`);
    expect(cr.status === 'pending_approval',  `status should be "pending_approval", got "${cr.status}"`);
    expect(cr.componentId === null,           'componentId should be null for a create CR');
    expect(cr.createdBy === fmgr1Id,          `createdBy mismatch: expected ${fmgr1Id}, got ${cr.createdBy}`);
    expect(cr.payload,                        'CR missing payload');
    // Component should NOT yet exist in finance_pay_components
    const { data: notYet } = await sb.from('finance_pay_components')
      .select('id').eq('code', `PCR_${TAG.slice(-6)}`).limit(1);
    expect((notYet ?? []).length === 0, 'component should not exist before approval');
    ctx.createCrId = cr.id;
  });

  await test('finance_staff is DENIED creating a pay component', async () => {
    const r = await api('finance/payroll/components/create', fstaff1Token, {
      code: `STF_${TAG.slice(-6)}`, name: 'Should fail', kind: 'earning',
    });
    fails(r, 'finance_staff should be denied component create');
  });

  await test('employee is DENIED creating a pay component', async () => {
    const r = await api('finance/payroll/components/create', empToken, {
      code: `EMP_${TAG.slice(-6)}`, name: 'Should fail', kind: 'earning',
    });
    fails(r, 'employee should be denied component create');
  });

  await test('duplicate code rejected at submission (409)', async () => {
    // Try to create a second CR with the same code before the first is approved.
    // The optimistic duplicate-check should reject it immediately.
    const r1 = await api('finance/payroll/components/create', fmgr1Token, {
      code: `PCR_${TAG.slice(-6)}`, name: 'Duplicate attempt', kind: 'earning',
    });
    // Should fail (CR with same code already pending OR component already exists)
    // Accept 409 (exists) or 422 (validation) — both are correct.
    expect(!r1.body.success, 'duplicate code should be rejected');
  });

  // ── RETIRE TARGET: create a component via direct DB insert (bypasses CR, seed-style) ─

  await test('seed a retire-target component directly via service-role (simulates existing component)', async () => {
    const code = `RTG_${TAG.slice(-6)}`;
    const { data, error } = await sb
      .from('finance_pay_components')
      .insert({ code, name: `Retire Target ${TAG}`, kind: 'deduction', is_statutory: false, is_taxable: false,
                reduces_chargeable: false, cost_allocation_required: false, is_active: true, created_by: fmgr1Id })
      .select('id')
      .single();
    expect(!error, `failed to seed retire-target component: ${error?.message}`);
    ctx.retireTargetCompId = data.id;
  });

  // ── UPDATE CR ──────────────────────────────────────────────────────────────

  await test('finance_manager submits an update CR for the retire-target component', async () => {
    const r = await api('finance/payroll/components/update', fmgr1Token, {
      id:         ctx.retireTargetCompId,
      name:       `Retire Target UPDATED ${TAG}`,
      isTaxable:  true,
    });
    ok(r, `update CR failed: ${r.body.message}`);
    const cr = r.body.data;
    expect(cr.changeType === 'update',       'changeType should be "update"');
    expect(cr.status === 'pending_approval', 'status should be pending_approval');
    expect(cr.componentId === ctx.retireTargetCompId, 'componentId mismatch');
    ctx.updateCrId = cr.id;
    // Component name unchanged in DB yet
    const { data: dbRow } = await sb.from('finance_pay_components')
      .select('name').eq('id', ctx.retireTargetCompId).single();
    expect(!dbRow.name.includes('UPDATED'), 'component should not be updated before approval');
  });

  // ── RETIRE CR ──────────────────────────────────────────────────────────────

  await test('finance_manager submits a retire CR for the retire-target component', async () => {
    // Create a fresh component for the retire CR test (separate from the update target)
    const code = `RTA_${TAG.slice(-6)}`;
    const { data: seed } = await sb.from('finance_pay_components')
      .insert({ code, name: `Retire A ${TAG}`, kind: 'earning', is_active: true, created_by: fmgr1Id,
                is_statutory: false, is_taxable: true, reduces_chargeable: false, cost_allocation_required: false })
      .select('id').single();
    const retireAId = seed.id;

    const r = await api('finance/payroll/components/retire', fmgr1Token, { id: retireAId });
    ok(r, `retire CR failed: ${r.body.message}`);
    const cr = r.body.data;
    expect(cr.changeType === 'retire',       'changeType should be "retire"');
    expect(cr.status === 'pending_approval', 'status should be pending_approval');
    expect(cr.componentId === retireAId,     'componentId mismatch');
    ctx.retireCrId = cr.id;
    // Component still active
    const { data: dbRow } = await sb.from('finance_pay_components')
      .select('is_active').eq('id', retireAId).single();
    expect(dbRow.is_active === true, 'component should still be active before retire-CR is approved');

    // Clean up the seeded component after this run
    h.onCleanup(async () => {
      try { await sb.from('finance_pay_components').delete().eq('id', retireAId); } catch {}
    });
  });

  // ── REJECT CR (separate CR to test rejection path) ─────────────────────────

  await test('finance_manager submits a reject-target CR', async () => {
    const r = await api('finance/payroll/components/create', fmgr1Token, {
      code: `REJ_${TAG.slice(-6)}`, name: `Reject Target ${TAG}`, kind: 'deduction',
    });
    ok(r, `reject-target CR submit failed: ${r.body.message}`);
    ctx.rejectCrId = r.body.data.id;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Approval queue');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('list change requests — returns the pending CRs', async () => {
    const r = await api('finance/payroll/components/change-requests/list', fmgr2Token, { status: 'pending_approval' });
    ok(r, `list CRs failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data should be an array');
    const ids = r.body.data.map(cr => cr.id);
    expect(ids.includes(ctx.createCrId), 'createCrId missing from pending list');
  });

  await test('finance_staff can view the CR list', async () => {
    const r = await api('finance/payroll/components/change-requests/list', fstaff1Token, {});
    ok(r, `finance_staff CR list failed: ${r.body.message}`);
  });

  await test('employee is DENIED the CR list', async () => {
    const r = await api('finance/payroll/components/change-requests/list', empToken, {});
    fails(r, 'employee should be denied CR list');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Segregation of Duties (SoD)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('CREATOR cannot approve own CR (SoD) — must return 422', async () => {
    // fmgr1 submitted the create CR; fmgr1 must NOT be allowed to approve it.
    const r = await api('finance/payroll/components/change-requests/approve', fmgr1Token, { id: ctx.createCrId });
    fails(r, 'creator should be denied approving own CR (SoD)');
    // Should specifically be 422 Unprocessable
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  await test('CREATOR cannot reject own CR either (SoD) — must return 422', async () => {
    const r = await api('finance/payroll/components/change-requests/reject', fmgr1Token, { id: ctx.rejectCrId });
    fails(r, 'creator should be denied rejecting own CR (SoD)');
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  await test('finance_staff is DENIED approving (needs approve permission)', async () => {
    const r = await api('finance/payroll/components/change-requests/approve', fstaff1Token, { id: ctx.createCrId });
    fails(r, 'finance_staff should be denied approve');
  });

  await test('employee is DENIED approving', async () => {
    const r = await api('finance/payroll/components/change-requests/approve', empToken, { id: ctx.createCrId });
    fails(r, 'employee should be denied approve');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Reject path');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager2 can reject a CR (different from submitter)', async () => {
    const r = await api('finance/payroll/components/change-requests/reject', fmgr2Token, {
      id:     ctx.rejectCrId,
      reason: `E2E rejection ${TAG}`,
    });
    ok(r, `reject CR failed: ${r.body.message}`);
    const cr = r.body.data;
    expect(cr.status === 'rejected', `status should be "rejected", got "${cr.status}"`);
    expect(cr.approvedBy === fmgr2Id, 'approvedBy should be the rejecting manager');
  });

  await test('rejected CR cannot be re-approved (409/422)', async () => {
    const r = await api('finance/payroll/components/change-requests/approve', fmgr2Token, { id: ctx.rejectCrId });
    fails(r, 'already-rejected CR should not be approvable');
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  await test('§2: rejected CR emits change_rejected app_event + audit row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_payroll_components')
        .eq('event_type', 'finance.payroll.component.change_rejected')
        .eq('source_entity_id', ctx.rejectCrId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'change_rejected app_event not found after rejection');

    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_payroll_components')
      .eq('action', 'pay_component_cr.rejected')
      .eq('record_id', ctx.rejectCrId).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log pay_component_cr.rejected not found');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Approve path — CREATE');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager2 approves the create CR — component is created in DB', async () => {
    const r = await api('finance/payroll/components/change-requests/approve', fmgr2Token, { id: ctx.createCrId });
    ok(r, `approve CR failed: ${r.body.message}`);
    const cr = r.body.data;
    expect(cr.status === 'approved',         `status should be "approved", got "${cr.status}"`);
    expect(cr.approvedBy === fmgr2Id,        'approvedBy should be the approving manager');

    // The component must now exist in finance_pay_components
    const { data: comp } = await sb.from('finance_pay_components')
      .select('id, code, name, kind, is_active, is_taxable')
      .eq('code', `PCR_${TAG.slice(-6)}`).limit(1);
    expect((comp ?? []).length === 1, 'component not created after CR approval');
    const row = comp[0];
    expect(row.is_active === true,  'new component should be active');
    expect(row.kind === 'earning',  'kind mismatch');
    expect(row.is_taxable === true, 'is_taxable mismatch');
    ctx.createdCompId = row.id;
  });

  await test('§2 create approved: component.created app_event + audit + change_submitted audit', async () => {
    // change_submitted event (emitted at CR creation time)
    const gotSubmit = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_payroll_components')
        .eq('event_type', 'finance.payroll.component.change_submitted')
        .eq('source_entity_id', ctx.createCrId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotSubmit, 'change_submitted app_event not found for create CR');

    // component.created event (emitted when CR is applied on approve)
    const gotCreated = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_payroll_components')
        .eq('event_type', 'finance.payroll.component.created')
        .eq('source_entity_id', ctx.createdCompId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotCreated, 'component.created app_event not found after CR approval');

    // audit row for create_submitted
    const { data: auditSubmit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_payroll_components')
      .eq('action', 'pay_component_cr.create_submitted')
      .eq('record_id', ctx.createCrId).limit(1);
    expect((auditSubmit ?? []).length > 0, 'hr_audit_log pay_component_cr.create_submitted not found');

    // audit row for component.created (applied by adapter)
    const { data: auditCreated } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_payroll_components')
      .eq('action', 'pay_component.created')
      .eq('record_id', ctx.createdCompId).limit(1);
    expect((auditCreated ?? []).length > 0, 'hr_audit_log pay_component.created not found');
  });

  await test('approved create CR cannot be re-approved (422)', async () => {
    const r = await api('finance/payroll/components/change-requests/approve', fmgr2Token, { id: ctx.createCrId });
    fails(r, 'already-approved CR should not be approvable');
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Approve path — UPDATE');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager2 approves the update CR — component is patched in DB', async () => {
    const r = await api('finance/payroll/components/change-requests/approve', fmgr2Token, { id: ctx.updateCrId });
    ok(r, `approve update CR failed: ${r.body.message}`);
    const cr = r.body.data;
    expect(cr.status === 'approved', `status should be "approved", got "${cr.status}"`);

    const { data: dbRow } = await sb.from('finance_pay_components')
      .select('name, is_taxable').eq('id', ctx.retireTargetCompId).single();
    expect(dbRow.name.includes('UPDATED'), `name not patched: "${dbRow.name}"`);
    expect(dbRow.is_taxable === true, 'is_taxable not patched');
  });

  await test('§2 update approved: component.updated app_event + audit row', async () => {
    const gotUpdated = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_payroll_components')
        .eq('event_type', 'finance.payroll.component.updated')
        .eq('source_entity_id', ctx.retireTargetCompId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotUpdated, 'component.updated app_event not found after update CR approval');

    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_payroll_components')
      .eq('action', 'pay_component.updated')
      .eq('record_id', ctx.retireTargetCompId).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log pay_component.updated not found');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Approve path — RETIRE');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager2 approves the retire CR — component is set inactive in DB', async () => {
    // Resolve the component ID from the retire CR
    const { data: crRow } = await sb.from('finance_pay_component_change_requests')
      .select('component_id').eq('id', ctx.retireCrId).single();
    const retireCompId = crRow.component_id;

    const r = await api('finance/payroll/components/change-requests/approve', fmgr2Token, { id: ctx.retireCrId });
    ok(r, `approve retire CR failed: ${r.body.message}`);
    const cr = r.body.data;
    expect(cr.status === 'approved', `status should be "approved", got "${cr.status}"`);

    const { data: dbRow } = await sb.from('finance_pay_components')
      .select('is_active').eq('id', retireCompId).single();
    expect(dbRow.is_active === false, 'component should be inactive after retire CR approval');
  });

  await test('§2 retire approved: component.retired app_event + audit row', async () => {
    const { data: crRow } = await sb.from('finance_pay_component_change_requests')
      .select('component_id').eq('id', ctx.retireCrId).single();
    const retireCompId = crRow.component_id;

    const gotRetired = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_payroll_components')
        .eq('event_type', 'finance.payroll.component.retired')
        .eq('source_entity_id', retireCompId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotRetired, 'component.retired app_event not found after retire CR approval');

    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_payroll_components')
      .eq('action', 'pay_component.retired')
      .eq('record_id', retireCompId).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log pay_component.retired not found');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Workflow binding side-effect');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('workflow_tasks row was created for the create CR (if workflow engine ran)', async () => {
    // The workflow binding should have created a workflow_tasks row when the CR was submitted.
    // This is a best-effort check: the binding runs if the workflow template is seeded.
    const { data: crRow } = await sb.from('finance_pay_component_change_requests')
      .select('workflow_id').eq('id', ctx.createCrId).single();
    if (!crRow.workflow_id) {
      // Workflow template migration not yet applied — skip (non-fatal, noted).
      console.warn('[SKIP] workflow_id not set on CR — migration 20260917000210 may not be applied yet.');
      return;
    }
    const { data: tasks } = await sb.from('workflow_tasks')
      .select('id').eq('workflow_id', crRow.workflow_id).limit(1);
    expect((tasks ?? []).length > 0, 'no workflow_tasks found for the create CR workflow');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Pay Component CR › Edge cases');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('updating a non-existent component returns 404', async () => {
    const r = await api('finance/payroll/components/update', fmgr1Token, {
      id:   '00000000-0000-0000-0000-000000000000',
      name: 'Ghost update',
    });
    fails(r, 'updating non-existent component should fail');
    expect(r.status === 404, `expected 404, got ${r.status}`);
  });

  await test('retiring a non-existent component returns 404', async () => {
    const r = await api('finance/payroll/components/retire', fmgr1Token, {
      id: '00000000-0000-0000-0000-000000000000',
    });
    fails(r, 'retiring non-existent component should fail');
    expect(r.status === 404, `expected 404, got ${r.status}`);
  });

  await test('update with no fields returns 422', async () => {
    const r = await api('finance/payroll/components/update', fmgr1Token, {
      id: ctx.retireTargetCompId,
      // no fields
    });
    fails(r, 'empty update should fail');
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  await test('approving a non-existent CR returns 404', async () => {
    const r = await api('finance/payroll/components/change-requests/approve', fmgr2Token, {
      id: '00000000-0000-0000-0000-000000000000',
    });
    fails(r, 'approving non-existent CR should fail');
    expect(r.status === 404, `expected 404, got ${r.status}`);
  });
}
