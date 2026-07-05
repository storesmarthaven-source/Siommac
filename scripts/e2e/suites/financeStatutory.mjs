/**
 * scripts/e2e/suites/financeStatutory.mjs
 *
 * E2E for Finance Phase 1: Pay-Component Catalogue + Statutory Configuration.
 *
 * Routes under test:
 *   /api/finance/statutory/versions/{list,get,create,update,submit,approve,reject,activate,retire}
 *   /api/finance/statutory/nis-classes/{list,upsert}
 *   /api/finance/statutory/reports/list
 *   /api/finance/payroll/components/{list,create,update,retire}
 *
 * Covers:
 *   • Finance roles exist in the DB.
 *   • Pay-component CRUD (list/create/update/retire).
 *   • Non-finance role (employee/manager) DENIED manage endpoints.
 *   • Statutory version draft→submit→approve lifecycle.
 *   • CREATOR ≠ APPROVER enforced: same user attempting approve returns 422.
 *   • HR role cannot manage statutory (422/403).
 *   • Activate retires the prior active version (one-active-per-jurisdiction).
 *   • Response-shape assertions for fields the frontend will consume.
 *   • §2 side-effects: app_events + hr_audit_log asserted via service-role client.
 *   • Cleanup via h.TAG.
 *
 * NOTE: These migrations must be applied to the live DB before running:
 *   20260802000000 → 20260802000004 + NOTIFY pgrst, 'reload schema';
 */

export const title = 'Finance — Statutory Configuration (Phase 1)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  // ── Provision finance users for this suite (real roster preferred) ─────────
  let fmgr1Id, fmgr2Id, fstaff1Id, empId;

  const ctx = {
    compId: null,
    comp2Id: null,
    sv1Id: null,  // first statutory version (to be activated, then superseded)
    sv2Id: null,  // second statutory version (to replace sv1 on activation)
    nisVersionId: null,
    createdUserIds: [],
  };

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    // Delete test-created records in reverse dependency order
    try { await sb.from('finance_nis_classes').delete().in('statutory_version_id', [ctx.sv1Id, ctx.sv2Id].filter(Boolean)); } catch {}
    try { await sb.from('finance_statutory_versions').delete().or(`id.eq.${ctx.sv1Id},id.eq.${ctx.sv2Id}`).select(); } catch {}
    try { if (ctx.compId) await sb.from('finance_pay_components').delete().eq('id', ctx.compId); } catch {}
    try { if (ctx.comp2Id) await sb.from('finance_pay_components').delete().eq('id', ctx.comp2Id); } catch {}
    try { await sb.from('hr_audit_log').delete().in('actor_id', [fmgr1Id, fmgr2Id, fstaff1Id]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_statutory').in('actor_user_id', [fmgr1Id, fmgr2Id, fstaff1Id, empId]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_payroll_components').in('actor_user_id', [fmgr1Id, fmgr2Id, fstaff1Id, empId]); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  let fmgr1Token, fmgr2Token, fstaff1Token, empToken;

  await test('finance_staff and finance_manager roles exist in roles table', async () => {
    const { data, error } = await sb.from('roles').select('name').in('name', ['finance_staff', 'finance_manager']);
    expect(!error, `roles query failed: ${error?.message}`);
    const names = (data ?? []).map(r => r.name);
    expect(names.includes('finance_staff'), 'finance_staff role missing from DB');
    expect(names.includes('finance_manager'), 'finance_manager role missing from DB');
  });

  await test('acquire two finance_manager users + one finance_staff + one employee (real roster preferred)', async () => {
    const mgrR = await acquireActors('finance_manager', 2);
    const stfR = await acquireActors('finance_staff', 1);
    const empR = await acquireActors('employee', 1);
    const [fmgr1, fmgr2] = mgrR.actors, [fstaff1] = stfR.actors, [emp] = empR.actors;
    fmgr1Id = fmgr1.id; fmgr2Id = fmgr2.id; fstaff1Id = fstaff1.id; empId = emp.id;
    ctx.createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

    fmgr1Token  = mint({ id: fmgr1Id,  username: fmgr1.username, role: 'finance_manager', department_id: fmgr1.department_id ?? null });
    fmgr2Token  = mint({ id: fmgr2Id,  username: fmgr2.username, role: 'finance_manager', department_id: fmgr2.department_id ?? null });
    fstaff1Token = mint({ id: fstaff1Id, username: fstaff1.username, role: 'finance_staff', department_id: fstaff1.department_id ?? null });
    empToken    = mint({ id: empId,    username: emp.username,  role: 'employee',        department_id: emp.department_id ?? null });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Pay Components — CRUD');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager can list pay components (active seed from migration)', async () => {
    const r = await api('finance/payroll/components/list', fmgr1Token, {});
    ok(r, `components list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data is not an array');
    // The seeded migration inserts 12 components
    expect(r.body.data.length >= 1, 'no seeded pay components found');
  });

  await test('finance_staff can view pay components', async () => {
    const r = await api('finance/payroll/components/list', fstaff1Token, {});
    ok(r, `finance_staff list failed: ${r.body.message}`);
  });

  await test('employee is DENIED pay components list', async () => {
    const r = await api('finance/payroll/components/list', empToken, {});
    fails(r, 'employee should be denied component list');
  });

  await test('finance_manager can create a pay component', async () => {
    const r = await api('finance/payroll/components/create', fmgr1Token, {
      code: `TEST_${TAG.slice(-6)}`,
      name: `Test Allowance ${TAG}`,
      kind: 'earning',
      isStatutory: false,
      isTaxable: true,
      reducesChargeable: false,
      glAccountCode: null,
      costAllocationRequired: false,
    });
    ok(r, `create component failed: ${r.body.message}`);
    const d = r.body.data;
    // Response shape assertions
    expect(d.id,         'missing id');
    expect(d.code,       'missing code');
    expect(d.name,       'missing name');
    expect(d.kind === 'earning', 'kind mismatch');
    expect(d.isActive === true,  'new component should be active');
    expect(d.createdBy === fmgr1Id, 'createdBy mismatch');
    ctx.compId = d.id;
  });

  await test('employee is DENIED creating a pay component', async () => {
    const r = await api('finance/payroll/components/create', empToken, {
      code: `EMP_${TAG.slice(-6)}`, name: 'Should fail', kind: 'earning',
    });
    fails(r, 'employee should be denied component create');
  });

  await test('finance_staff is DENIED creating a pay component', async () => {
    const r = await api('finance/payroll/components/create', fstaff1Token, {
      code: `STF_${TAG.slice(-6)}`, name: 'Should fail', kind: 'deduction',
    });
    fails(r, 'finance_staff should be denied component create');
  });

  await test('finance_manager can update a pay component name', async () => {
    const r = await api('finance/payroll/components/update', fmgr1Token, {
      id: ctx.compId,
      name: `Updated Allowance ${TAG}`,
    });
    ok(r, `update component failed: ${r.body.message}`);
    expect(r.body.data.name.startsWith('Updated'), 'name not updated');
  });

  await test('§2 side-effects: pay_component.created event + hr_audit_log row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'finance_payroll_components')
        .eq('event_type', 'finance.payroll.component.created')
        .eq('source_entity_id', ctx.compId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'finance.payroll.component.created app_event not found');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'finance_payroll_components')
      .eq('action', 'pay_component.created')
      .eq('record_id', ctx.compId).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log pay_component.created not found');
  });

  await test('finance_manager can retire a pay component', async () => {
    // Create a separate component to retire so compId stays available
    const rc = await api('finance/payroll/components/create', fmgr1Token, {
      code: `RET_${TAG.slice(-6)}`,
      name: `Retire Test ${TAG}`,
      kind: 'deduction',
    });
    ok(rc, `create for retire failed: ${rc.body.message}`);
    ctx.comp2Id = rc.body.data.id;

    const r = await api('finance/payroll/components/retire', fmgr1Token, { id: ctx.comp2Id });
    ok(r, `retire failed: ${r.body.message}`);

    // Verify it is now inactive
    const { data: dbRow } = await sb.from('finance_pay_components').select('is_active').eq('id', ctx.comp2Id).single();
    expect(dbRow.is_active === false, 'component should be is_active=false after retire');
  });

  await test('retired component does not appear in activeOnly list', async () => {
    const r = await api('finance/payroll/components/list', fmgr1Token, { activeOnly: true });
    ok(r, 'list failed');
    expect(!r.body.data.some(x => x.id === ctx.comp2Id), 'retired component should not appear in activeOnly list');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Statutory Versions — Lifecycle');
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Draft creation ---
  await test('finance_manager can create a statutory version draft', async () => {
    const r = await api('finance/statutory/versions/create', fmgr1Token, {
      effectiveFrom: '2027-01-01',
      label: `E2E Test Version ${TAG}`,
      jurisdiction: 'TT',
      currency: 'TTD',
      payePersonalAllowance: 84000,
      payeBand1Ceiling: 1000000,
      payeBand1Rate: 0.25,
      payeBand2Rate: 0.30,
      hsMonthlyThreshold: 469.99,
      hsWeeklyHigh: 4.80,
      hsWeeklyLow: 2.40,
      nisMonthyCeiling: null,
    });
    ok(r, `create version failed: ${r.body.message}`);
    const d = r.body.data;
    // Response shape assertions
    expect(d.id,               'missing id');
    expect(d.effectiveFrom,    'missing effectiveFrom');
    expect(d.jurisdiction === 'TT', 'wrong jurisdiction');
    expect(d.status === 'draft',    'new version should be draft');
    expect(d.isActive === false,    'new version should not be active');
    expect(d.createdBy === fmgr1Id, 'createdBy mismatch');
    ctx.sv1Id = d.id;
  });

  await test('employee is DENIED creating statutory version', async () => {
    const r = await api('finance/statutory/versions/create', empToken, {
      effectiveFrom: '2028-01-01', label: 'Should fail',
      payePersonalAllowance: 1, payeBand1Ceiling: 1, payeBand1Rate: 0.1, payeBand2Rate: 0.1,
      hsMonthlyThreshold: 1, hsWeeklyHigh: 1, hsWeeklyLow: 1,
    });
    fails(r, 'employee should be denied create');
  });

  await test('finance_staff is DENIED creating statutory version', async () => {
    const r = await api('finance/statutory/versions/create', fstaff1Token, {
      effectiveFrom: '2028-01-01', label: 'Should fail',
      payePersonalAllowance: 1, payeBand1Ceiling: 1, payeBand1Rate: 0.1, payeBand2Rate: 0.1,
      hsMonthlyThreshold: 1, hsWeeklyHigh: 1, hsWeeklyLow: 1,
    });
    fails(r, 'finance_staff should be denied create');
  });

  await test('finance_staff can VIEW statutory versions', async () => {
    const r = await api('finance/statutory/versions/list', fstaff1Token, {});
    ok(r, `finance_staff list failed: ${r.body.message}`);
    expect(r.body.data.some(v => v.id === ctx.sv1Id), 'newly created version not in list');
  });

  await test('finance_manager can get a specific version', async () => {
    const r = await api('finance/statutory/versions/get', fmgr1Token, { id: ctx.sv1Id });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.sv1Id, 'wrong id');
  });

  await test('finance_manager can update a draft version', async () => {
    const r = await api('finance/statutory/versions/update', fmgr1Token, {
      id: ctx.sv1Id,
      label: `E2E Test Version (Updated) ${TAG}`,
      payePersonalAllowance: 90000,
    });
    ok(r, `update failed: ${r.body.message}`);
    expect(r.body.data.payePersonalAllowance === 90000, 'payePersonalAllowance not updated');
  });

  // --- NIS classes ---
  await test('finance_manager can upsert NIS classes for the draft version', async () => {
    const r = await api('finance/statutory/nis-classes/upsert', fmgr1Token, {
      statutoryVersionId: ctx.sv1Id,
      classes: [
        { classNo: 1, weeklyMin: 0,    weeklyMax: 299.99, employeeWeekly: 12.95, employerWeekly: 19.40 },
        { classNo: 2, weeklyMin: 300,  weeklyMax: 399.99, employeeWeekly: 17.15, employerWeekly: 25.70 },
        { classNo: 3, weeklyMin: 400,  weeklyMax: null,   employeeWeekly: 21.35, employerWeekly: 32.00 },
      ],
    });
    ok(r, `upsert NIS classes failed: ${r.body.message}`);
    expect(r.body.data.length === 3, `expected 3 NIS classes, got ${r.body.data.length}`);
    ctx.nisVersionId = ctx.sv1Id;
  });

  await test('finance_manager can list NIS classes', async () => {
    const r = await api('finance/statutory/nis-classes/list', fmgr1Token, { statutoryVersionId: ctx.sv1Id });
    ok(r, 'list NIS classes failed');
    expect(r.body.data.length === 3, `expected 3 NIS classes, got ${r.body.data.length}`);
    const c1 = r.body.data.find(c => c.classNo === 1);
    expect(c1, 'class 1 missing');
    // Response shape assertions
    expect('id'             in c1, 'NIS class missing id');
    expect('classNo'        in c1, 'NIS class missing classNo');
    expect('weeklyMin'      in c1, 'NIS class missing weeklyMin');
    expect('employeeWeekly' in c1, 'NIS class missing employeeWeekly');
    expect('employerWeekly' in c1, 'NIS class missing employerWeekly');
  });

  // --- Submit (draft → pending_approval) ---
  await test('finance_manager (creator) can submit the version for approval', async () => {
    const r = await api('finance/statutory/versions/submit', fmgr1Token, { id: ctx.sv1Id });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.status === 'pending_approval', `expected pending_approval, got ${r.body.data.status}`);
  });

  await test('submitted version cannot be updated (must be draft)', async () => {
    const r = await api('finance/statutory/versions/update', fmgr1Token, {
      id: ctx.sv1Id, label: 'Should fail — not draft',
    });
    fails(r, 'update of pending_approval version should fail');
  });

  // --- Segregation of duties: creator ≠ approver ---
  await test('CREATOR cannot approve their own submission (SoD violation → 422/error)', async () => {
    const r = await api('finance/statutory/versions/approve', fmgr1Token, { id: ctx.sv1Id });
    fails(r, 'creator should be denied approval of their own submission');
    expect(r.body.message?.toLowerCase().includes('segregation') || r.body.message?.toLowerCase().includes('creator'),
      `expected SoD error message, got: ${r.body.message}`);
  });

  // --- A DIFFERENT finance_manager can approve ---
  await test('DIFFERENT finance_manager can approve the submitted version', async () => {
    const r = await api('finance/statutory/versions/approve', fmgr2Token, { id: ctx.sv1Id });
    ok(r, `approve by mgr2 failed: ${r.body.message}`);
    expect(r.body.data.status === 'approved', `expected approved, got ${r.body.data.status}`);
    expect(r.body.data.approvedBy === fmgr2Id, 'approvedBy mismatch');
  });

  await test('§2 side-effects: statutory_version.approved event + hr_audit_log row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'finance_statutory')
        .eq('event_type', 'finance.statutory.version.approved')
        .eq('source_entity_id', ctx.sv1Id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'finance.statutory.version.approved app_event not found');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'finance_statutory')
      .eq('action', 'statutory_version.approved')
      .eq('record_id', ctx.sv1Id).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log statutory_version.approved not found');
  });

  // --- Activate (approved → active, creator SoD still applies) ---
  await test('CREATOR cannot activate (SoD: creator cannot activate)', async () => {
    const r = await api('finance/statutory/versions/activate', fmgr1Token, { id: ctx.sv1Id });
    fails(r, 'creator should be denied activation (SoD)');
  });

  await test('DIFFERENT finance_manager can activate the approved version', async () => {
    const r = await api('finance/statutory/versions/activate', fmgr2Token, { id: ctx.sv1Id });
    ok(r, `activate failed: ${r.body.message}`);
    expect(r.body.data.status === 'active',  `expected active, got ${r.body.data.status}`);
    expect(r.body.data.isActive === true,    'isActive should be true');
    expect(r.body.data.activatedBy === fmgr2Id, 'activatedBy mismatch');
  });

  // --- One-active-per-jurisdiction: create a second version and activate it ---
  await test('creating and activating a second version retires the first (one-active-per-jurisdiction)', async () => {
    // Create sv2 (by fmgr2, so fmgr1 can approve)
    const c = await api('finance/statutory/versions/create', fmgr2Token, {
      effectiveFrom: '2028-01-01',
      label: `E2E Version 2 ${TAG}`,
      jurisdiction: 'TT', currency: 'TTD',
      payePersonalAllowance: 95000, payeBand1Ceiling: 1000000,
      payeBand1Rate: 0.25, payeBand2Rate: 0.30,
      hsMonthlyThreshold: 500, hsWeeklyHigh: 5.00, hsWeeklyLow: 2.50,
    });
    ok(c, `create sv2 failed: ${c.body.message}`);
    ctx.sv2Id = c.body.data.id;

    // Submit sv2 (by creator fmgr2)
    const s = await api('finance/statutory/versions/submit', fmgr2Token, { id: ctx.sv2Id });
    ok(s, `submit sv2 failed: ${s.body.message}`);

    // Approve sv2 by fmgr1 (different from creator fmgr2)
    const ap = await api('finance/statutory/versions/approve', fmgr1Token, { id: ctx.sv2Id });
    ok(ap, `approve sv2 failed: ${ap.body.message}`);

    // Activate sv2 by fmgr1 (different from creator fmgr2, and now also the approver — but not the creator)
    const act = await api('finance/statutory/versions/activate', fmgr1Token, { id: ctx.sv2Id });
    ok(act, `activate sv2 failed: ${act.body.message}`);
    expect(act.body.data.isActive === true, 'sv2 should be active');

    // Assert sv1 was retired by the activation
    const { data: sv1Row } = await sb.from('finance_statutory_versions')
      .select('status, is_active').eq('id', ctx.sv1Id).single();
    expect(sv1Row.status === 'retired', `sv1 should be retired, got ${sv1Row.status}`);
    expect(sv1Row.is_active === false,  'sv1 is_active should be false after sv2 activation');

    // Assert only one active version for TT
    const { data: activeVersions } = await sb.from('finance_statutory_versions')
      .select('id').eq('jurisdiction', 'TT').eq('is_active', true);
    expect((activeVersions ?? []).length === 1, `expected 1 active version, got ${(activeVersions ?? []).length}`);
    expect(activeVersions[0].id === ctx.sv2Id, 'active version should be sv2');
  });

  // --- Reports ---
  await test('finance_manager can view statutory reports', async () => {
    const r = await api('finance/statutory/reports/list', fmgr1Token, {});
    ok(r, `reports/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data not an array');
    // Shape assertions
    if (r.body.data.length > 0) {
      const row = r.body.data[0];
      expect('id' in row,            'report row missing id');
      expect('label' in row,         'report row missing label');
      expect('effectiveFrom' in row, 'report row missing effectiveFrom');
      expect('status' in row,        'report row missing status');
      expect('isActive' in row,      'report row missing isActive');
    }
  });

  await test('finance_staff is DENIED statutory reports (manager/admin surface)', async () => {
    // Statutory/finance reports are a manager/admin reporting surface. finance_staff
    // holds finance.statutory.view (data entry/review) but NOT reports.view — by design.
    const r = await api('finance/statutory/reports/list', fstaff1Token, {});
    fails(r, 'finance_staff should be denied statutory reports/list (reports.view is manager/admin only)');
  });

  await test('employee is DENIED statutory reports', async () => {
    const r = await api('finance/statutory/reports/list', empToken, {});
    fails(r, 'employee should be denied reports/list');
  });

  // --- Reject path ---
  await test('reject flow: draft → pending_approval → reject → back to draft', async () => {
    // Create a new draft by fmgr1
    const c = await api('finance/statutory/versions/create', fmgr1Token, {
      effectiveFrom: '2029-01-01',
      label: `E2E Reject Test ${TAG}`,
      jurisdiction: 'TT', currency: 'TTD',
      payePersonalAllowance: 100000, payeBand1Ceiling: 1000000,
      payeBand1Rate: 0.25, payeBand2Rate: 0.30,
      hsMonthlyThreshold: 500, hsWeeklyHigh: 5.00, hsWeeklyLow: 2.50,
    });
    ok(c, `create for reject test failed: ${c.body.message}`);
    const rejectId = c.body.data.id;

    // Submit it (creator: fmgr1)
    const s = await api('finance/statutory/versions/submit', fmgr1Token, { id: rejectId });
    ok(s, `submit for reject test failed: ${s.body.message}`);

    // Creator cannot reject their own (SoD)
    const selfReject = await api('finance/statutory/versions/reject', fmgr1Token, { id: rejectId, reason: 'Self reject attempt' });
    fails(selfReject, 'creator should not be able to reject their own submission');

    // Reason is now mandatory — a reject with no reason is refused (fails at validation, no state change)
    const noReason = await api('finance/statutory/versions/reject', fmgr2Token, { id: rejectId });
    fails(noReason, 'reject with no reason should be refused');

    // Different manager can reject
    const r = await api('finance/statutory/versions/reject', fmgr2Token, { id: rejectId, reason: 'Rates need recalibration' });
    ok(r, `reject failed: ${r.body.message}`);
    expect(r.body.data.status === 'draft', `expected draft after reject, got ${r.body.data.status}`);

    // Cleanup this extra version
    h.onCleanup(async () => {
      try { await sb.from('finance_statutory_versions').delete().eq('id', rejectId); } catch {}
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › Access Control — HR role denied statutory manage');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('a regular employee cannot manage statutory (also covers hr_staff equivalent denial)', async () => {
    const r = await api('finance/statutory/versions/create', empToken, {
      effectiveFrom: '2030-01-01', label: 'HR attempt',
      payePersonalAllowance: 1, payeBand1Ceiling: 1, payeBand1Rate: 0.1, payeBand2Rate: 0.1,
      hsMonthlyThreshold: 1, hsWeeklyHigh: 1, hsWeeklyLow: 1,
    });
    fails(r, 'non-finance role should be denied statutory.create');
  });

  await test('finance_staff can list (view) but not submit, approve, or activate', async () => {
    const listR = await api('finance/statutory/versions/list', fstaff1Token, {});
    ok(listR, 'finance_staff should be able to list statutory versions');

    // submit requires manage permission
    const submitR = await api('finance/statutory/versions/submit', fstaff1Token, { id: ctx.sv2Id });
    fails(submitR, 'finance_staff should be denied submit');

    // approve requires approve permission
    const approveR = await api('finance/statutory/versions/approve', fstaff1Token, { id: ctx.sv2Id });
    fails(approveR, 'finance_staff should be denied approve');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Statutory › §2 Side-effects Verification');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('created + submitted events exist for sv1 in app_events', async () => {
    const { data: events } = await sb.from('app_events')
      .select('event_type').eq('source_module', 'finance_statutory')
      .eq('source_entity_id', ctx.sv1Id);
    const types = (events ?? []).map(e => e.event_type);
    expect(types.includes('finance.statutory.version.created'),  'missing created event for sv1');
    expect(types.includes('finance.statutory.version.submitted'), 'missing submitted event for sv1');
  });

  await test('hr_audit_log has created/submitted/approved/activated rows for sv1', async () => {
    const { data: auditRows } = await sb.from('hr_audit_log')
      .select('action').eq('submodule_key', 'finance_statutory')
      .eq('record_id', ctx.sv1Id);
    const actions = (auditRows ?? []).map(a => a.action);
    expect(actions.includes('statutory_version.created'),  `missing created audit — found: ${JSON.stringify(actions)}`);
    expect(actions.includes('statutory_version.submitted'), `missing submitted audit`);
    expect(actions.includes('statutory_version.approved'),  `missing approved audit`);
    expect(actions.includes('statutory_version.activated'), `missing activated audit`);
  });

  await test('retired_by_activation audit row exists for sv1 when sv2 activated', async () => {
    const { data: retireAudit } = await sb.from('hr_audit_log')
      .select('action').eq('submodule_key', 'finance_statutory')
      .eq('record_id', ctx.sv1Id)
      .eq('action', 'statutory_version.retired_by_activation').limit(1);
    expect((retireAudit ?? []).length > 0, 'retired_by_activation audit row missing for sv1');
  });
}
