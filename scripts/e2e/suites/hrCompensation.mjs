/**
 * scripts/e2e/suites/hrCompensation.mjs
 *
 * E2E for HR Phase 2: Compensation Inputs (pay items).
 *
 * Routes under test:
 *   /api/hr/compensation/pay-items/{list,get,create,submit,approve,reject,retire}
 *   /api/hr/compensation/reports/list
 *
 * Covers:
 *   • hr_staff can create + submit pay items using an active Finance component.
 *   • Component must be active — inactive component rejected.
 *   • HR cannot create Finance pay components (DENIED).
 *   • Submit starts a workflow; item moves to pending_approval.
 *   • hr_manager can approve; SoD enforced — creator cannot approve own item.
 *   • hr_manager can reject a pending item.
 *   • Active item can be retired; rejected/draft items cannot.
 *   • Response-shape assertions for fields the frontend will consume.
 *   • §2 side-effects: app_events + hr_audit_log asserted via service-role client.
 *   • Access control negatives: employee denied manage/approve.
 *   • Cleanup via h.TAG.
 *
 * NOTE: Migrations 20260802000005–20260802000008 + NOTIFY pgrst must be applied
 * before running this suite.
 */

export const title = 'HR — Compensation Inputs (Phase 2)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  // ── Provision users (real roster preferred) ─────────────────────────────────
  let hrMgr1Id, hrMgr2Id, hrStaff1Id, empId;

  // Context for cross-test values
  const ctx = {
    compId: null,         // active Finance component used for items
    inactiveCompId: null, // inactive Finance component (should be refused)
    item1Id: null,        // pay item created by hrStaff1 (used for submit→approve)
    item2Id: null,        // pay item for reject test
    item3Id: null,        // pay item for retire test
    createdUserIds: [],
  };

  const waitFor = async (check, ms = 7000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 400)); }
    return false;
  };

  h.onCleanup(async () => {
    // Scoped by the SPECIFIC pay items this run created — empId may now be a real
    // employee with real pay items, so a broad employee_id delete (the old `HC-%`
    // prefix filter never matched real UUID-style ids anyway, silently leaking) would
    // be both wrong AND dangerous once it did match.
    const itemIds = [ctx.item1Id, ctx.item2Id, ctx.item3Id].filter(Boolean);
    try { if (itemIds.length) await sb.from('hr_employee_pay_items').delete().in('id', itemIds); } catch {}
    try { await sb.from('finance_pay_components').delete().like('code', `HC_%${TAG.slice(-6)}%`); } catch {}
    try { if (itemIds.length) await sb.from('hr_audit_log').delete().eq('submodule_key', 'hr_compensation').in('record_id', itemIds); } catch {}
    try { if (itemIds.length) await sb.from('app_events').delete().eq('source_module', 'hr_compensation').in('source_entity_id', itemIds); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Compensation › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  let hrMgr1Token, hrMgr2Token, hrStaff1Token, empToken;

  await test('acquire hr_manager x2, hr_staff x1, employee x1 (real roster preferred)', async () => {
    const mgrR = await acquireActors('hr_manager', 2);
    const stfR = await acquireActors('hr_staff', 1);
    const empR = await acquireActors('employee', 1);
    const [hrMgr1, hrMgr2] = mgrR.actors, [hrStaff1] = stfR.actors, [emp] = empR.actors;
    hrMgr1Id = hrMgr1.id; hrMgr2Id = hrMgr2.id; hrStaff1Id = hrStaff1.id; empId = emp.id;
    ctx.createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

    hrMgr1Token  = mint({ id: hrMgr1Id,  username: hrMgr1.username, role: 'hr_manager', department_id: hrMgr1.department_id ?? null });
    hrMgr2Token  = mint({ id: hrMgr2Id,  username: hrMgr2.username, role: 'hr_manager', department_id: hrMgr2.department_id ?? null });
    hrStaff1Token = mint({ id: hrStaff1Id, username: hrStaff1.username, role: 'hr_staff',   department_id: hrStaff1.department_id ?? null });
    empToken     = mint({ id: empId,      username: emp.username,  role: 'employee',   department_id: emp.department_id ?? null });
  });

  await test('seed an active Finance pay component for use in pay items', async () => {
    const { data, error } = await sb.from('finance_pay_components').insert({
      code: `HC_ALLOW_${TAG.slice(-6)}`,
      name: `HC Housing Allowance ${TAG}`,
      kind: 'earning',
      is_statutory: false,
      is_taxable: true,
      reduces_chargeable: false,
      is_active: true,
      created_by: admin.id,
    }).select().single();
    expect(!error, `seed active component failed: ${error?.message}`);
    ctx.compId = data.id;
  });

  await test('seed an INACTIVE Finance pay component (must be refused)', async () => {
    const { data, error } = await sb.from('finance_pay_components').insert({
      code: `HC_INACT_${TAG.slice(-6)}`,
      name: `HC Inactive Component ${TAG}`,
      kind: 'deduction',
      is_active: false,
      created_by: admin.id,
    }).select().single();
    expect(!error, `seed inactive component failed: ${error?.message}`);
    ctx.inactiveCompId = data.id;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Compensation › Pay Items — CRUD');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('hr_staff can view pay items list (empty)', async () => {
    const r = await api('hr/compensation/pay-items/list', hrStaff1Token, { employeeId: empId });
    ok(r, `list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data not array');
  });

  await test('employee is DENIED viewing pay items list', async () => {
    const r = await api('hr/compensation/pay-items/list', empToken, {});
    fails(r, 'employee should be denied pay items list');
  });

  await test('hr_staff can create a pay item for employee using active component', async () => {
    const r = await api('hr/compensation/pay-items/create', hrStaff1Token, {
      employeeId: empId,
      componentId: ctx.compId,
      amount: 500.00,
      effectiveFrom: '2026-08-01',
      note: 'Housing allowance test',
    });
    ok(r, `create failed: ${r.body.message}`);
    const d = r.body.data;
    // Response shape
    expect(d.id, 'missing id');
    expect(d.employeeId === empId, 'employeeId mismatch');
    expect(d.componentId === ctx.compId, 'componentId mismatch');
    expect(d.amount === 500, 'amount mismatch');
    expect(d.percent === null, 'percent should be null');
    expect(d.status === 'draft', 'new item should be draft');
    expect(d.isActive === false, 'new item should not be active');
    expect(d.createdBy === hrStaff1Id, 'createdBy mismatch');
    ctx.item1Id = d.id;
  });

  await test('hr_staff is DENIED using an INACTIVE pay component', async () => {
    const r = await api('hr/compensation/pay-items/create', hrStaff1Token, {
      employeeId: empId,
      componentId: ctx.inactiveCompId,
      amount: 100.00,
      effectiveFrom: '2026-08-01',
    });
    fails(r, 'inactive component should be refused');
  });

  await test('amount XOR percent constraint enforced — both set rejected', async () => {
    const r = await api('hr/compensation/pay-items/create', hrStaff1Token, {
      employeeId: empId,
      componentId: ctx.compId,
      amount: 100,
      percent: 5,
      effectiveFrom: '2026-08-01',
    });
    fails(r, 'both amount+percent should be rejected');
  });

  await test('amount XOR percent constraint enforced — neither set rejected', async () => {
    const r = await api('hr/compensation/pay-items/create', hrStaff1Token, {
      employeeId: empId,
      componentId: ctx.compId,
      effectiveFrom: '2026-08-01',
    });
    fails(r, 'neither amount nor percent should be rejected');
  });

  await test('employee is DENIED creating a pay item', async () => {
    const r = await api('hr/compensation/pay-items/create', empToken, {
      employeeId: empId,
      componentId: ctx.compId,
      amount: 200,
      effectiveFrom: '2026-08-01',
    });
    fails(r, 'employee should be denied pay item create');
  });

  await test('HR cannot create a Finance pay component', async () => {
    const r = await api('finance/payroll/components/create', hrStaff1Token, {
      code: `HC_NOAUTH_${TAG.slice(-6)}`,
      name: 'Should fail',
      kind: 'earning',
    });
    fails(r, 'hr_staff should be denied Finance component create');
  });

  await test('hr_staff can get a specific pay item', async () => {
    const r = await api('hr/compensation/pay-items/get', hrStaff1Token, { id: ctx.item1Id });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.item1Id, 'id mismatch');
  });

  await test('§2 side-effects: pay_item.created event + hr_audit_log row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'hr_compensation')
        .eq('event_type', 'hr.compensation.item.created')
        .eq('source_entity_id', ctx.item1Id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'hr.compensation.item.created app_event not found');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'hr_compensation')
      .eq('action', 'pay_item.created').eq('record_id', ctx.item1Id).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log pay_item.created not found');
  });

  // Create item2 and item3 for reject + retire tests
  await test('create second and third pay items for reject/retire tests', async () => {
    const r2 = await api('hr/compensation/pay-items/create', hrMgr1Token, {
      employeeId: empId,
      componentId: ctx.compId,
      percent: 5,
      effectiveFrom: '2026-09-01',
      note: 'For reject test',
    });
    ok(r2, `create item2 failed: ${r2.body.message}`);
    ctx.item2Id = r2.body.data.id;

    const r3 = await api('hr/compensation/pay-items/create', hrStaff1Token, {
      employeeId: empId,
      componentId: ctx.compId,
      amount: 250,
      effectiveFrom: '2026-10-01',
      note: 'For retire test',
    });
    ok(r3, `create item3 failed: ${r3.body.message}`);
    ctx.item3Id = r3.body.data.id;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Compensation › Submit + Approval Workflow');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('hr_staff can submit item1 for approval', async () => {
    const r = await api('hr/compensation/pay-items/submit', hrStaff1Token, { id: ctx.item1Id });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.status === 'pending_approval', `expected pending_approval, got: ${r.body.data.status}`);
  });

  await test('§2 side-effects: pay_item.submitted event after submit', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'hr_compensation')
        .eq('event_type', 'hr.compensation.item.submitted')
        .eq('source_entity_id', ctx.item1Id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'hr.compensation.item.submitted app_event not found');
  });

  await test('workflow instance created for item1', async () => {
    const got = await waitFor(async () => {
      const { data } = await sb.from('hr_employee_pay_items')
        .select('workflow_id').eq('id', ctx.item1Id).single();
      return data?.workflow_id != null;
    });
    expect(got, 'workflow_id not set after submit');
  });

  await test('SoD: hrStaff1 (creator) CANNOT approve own item', async () => {
    const r = await api('hr/compensation/pay-items/approve', hrStaff1Token, { id: ctx.item1Id });
    fails(r, 'creator should be denied approving own item');
  });

  await test('employee is DENIED approving pay items', async () => {
    const r = await api('hr/compensation/pay-items/approve', empToken, { id: ctx.item1Id });
    fails(r, 'employee should be denied approve');
  });

  await test('hr_manager (different user) can approve item1', async () => {
    const r = await api('hr/compensation/pay-items/approve', hrMgr2Token, { id: ctx.item1Id });
    ok(r, `approve failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.status === 'active', `expected active, got: ${d.status}`);
    expect(d.isActive === true, 'isActive should be true');
    expect(d.approvedBy === hrMgr2Id, 'approvedBy mismatch');
    expect(d.approvedAt != null, 'approvedAt should be set');
  });

  await test('§2 side-effects: pay_item.approved event + hr_audit_log row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'hr_compensation')
        .eq('event_type', 'hr.compensation.item.approved')
        .eq('source_entity_id', ctx.item1Id).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'hr.compensation.item.approved app_event not found');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'hr_compensation')
      .eq('action', 'pay_item.approved').eq('record_id', ctx.item1Id).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log pay_item.approved not found');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Compensation › Reject');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('submit item2 for rejection test', async () => {
    const r = await api('hr/compensation/pay-items/submit', hrMgr1Token, { id: ctx.item2Id });
    ok(r, `submit item2 failed: ${r.body.message}`);
    expect(r.body.data.status === 'pending_approval', 'item2 should be pending_approval');
  });

  await test('reject WITHOUT a reason → refused (reason now mandatory)', async () => {
    const r = await api('hr/compensation/pay-items/reject', hrMgr2Token, { id: ctx.item2Id });
    expect(!r.ok || !r.body?.success, 'reject with no reason should be refused');
  });

  await test('hr_manager can reject item2 (SoD: mgr2 rejects mgr1 submission)', async () => {
    const r = await api('hr/compensation/pay-items/reject', hrMgr2Token, {
      id: ctx.item2Id,
      reason: 'Test rejection from E2E',
    });
    ok(r, `reject failed: ${r.body.message}`);
    expect(r.body.data.status === 'rejected', `expected rejected, got: ${r.body.data.status}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Compensation › Retire');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('submit and approve item3 so it becomes active', async () => {
    const rs = await api('hr/compensation/pay-items/submit', hrStaff1Token, { id: ctx.item3Id });
    ok(rs, `submit item3 failed: ${rs.body.message}`);
    const ra = await api('hr/compensation/pay-items/approve', hrMgr2Token, { id: ctx.item3Id });
    ok(ra, `approve item3 failed: ${ra.body.message}`);
    expect(ra.body.data.status === 'active', 'item3 should be active');
  });

  await test('hr_staff can retire item3 (active → retired)', async () => {
    const r = await api('hr/compensation/pay-items/retire', hrStaff1Token, { id: ctx.item3Id });
    ok(r, `retire failed: ${r.body.message}`);
    expect(r.body.data.status === 'retired', `expected retired, got: ${r.body.data.status}`);
    expect(r.body.data.isActive === false, 'isActive should be false after retire');
    expect(r.body.data.retiredBy === hrStaff1Id, 'retiredBy mismatch');
  });

  await test('cannot retire a non-active item (rejected item2)', async () => {
    const r = await api('hr/compensation/pay-items/retire', hrMgr1Token, { id: ctx.item2Id });
    fails(r, 'retiring a rejected item should fail');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('HR Compensation › Reports');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('hr_manager can view compensation report', async () => {
    const r = await api('hr/compensation/reports/list', hrMgr1Token, { employeeId: empId });
    ok(r, `reports list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data not array');
    // Should include items we created
    const ids = r.body.data.map(x => x.id);
    expect(ids.includes(ctx.item1Id), 'item1 not in report');
  });

  await test('employee is DENIED compensation reports', async () => {
    const r = await api('hr/compensation/reports/list', empToken, {});
    fails(r, 'employee should be denied compensation reports');
  });

  await test('hr_staff is DENIED compensation reports (has only view+manage, not reports.view)', async () => {
    // hr_staff does not have hr.compensation.reports.view per the migration
    // (only hr_manager, admin, superadmin have it)
    const r = await api('hr/compensation/reports/list', hrStaff1Token, {});
    fails(r, 'hr_staff should be denied compensation reports');
  });
}
