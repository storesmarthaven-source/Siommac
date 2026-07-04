/**
 * scripts/e2e/suites/financeExpenses.mjs
 *
 * E2E for Finance -- Expense Claims (module F4).
 *
 * Routes under test:
 *   /api/finance/expenses/{list,get,lines/list,create,submit,approve,reject,
 *                           mark-reimbursed,cancel,reports/list,reports/run}
 *
 * Covers:
 *   - Access control: employee DENIED; finance_staff can VIEW but not create/approve.
 *   - Allocation sum validation: lines not summing to total -> 422.
 *   - Full lifecycle: create (with lines) -> submit -> approve -> mark-reimbursed.
 *   - SoD: claimant (fmgr1) cannot approve their own claim -> 422.
 *   - Reject path (with reason required).
 *   - Cancel path (with reason required).
 *   - Response-shape assertions for fields the frontend consumes.
 *   - Section 2 side-effects: app_events (source_module 'finance_expenses') + hr_audit_log.
 *   - Cleanup via h.TAG.
 *
 * NOTE: apply the finance_expenses migration + permissions migration + workflow binding
 * to the live DB before running, then NOTIFY pgrst, 'reload schema'.
 */

export const title = 'Finance -- Expense Claims (F4)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;

  const fmgr1Id  = `EX-MGR1-${TAG}`;
  const fmgr2Id  = `EX-MGR2-${TAG}`;
  const fstaffId = `EX-STF-${TAG}`;
  const empId    = `EX-EMP-${TAG}`;
  const ccId1    = null; // cost-centre UUIDs are seeded separately; use null for tests that accept it or seed below
  const ctx = {
    claimId:       null,   // main claim taken through the lifecycle
    cancelClaimId: null,   // claim for the cancel path
    rejectClaimId: null,   // claim for the reject path
    ccUuid:        null,   // seeded cost-centre UUID
  };

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('finance_cost_entries').delete().in('expense_claim_id', [ctx.claimId, ctx.cancelClaimId, ctx.rejectClaimId].filter(Boolean)); } catch {}
    try { await sb.from('finance_expense_claims').delete().or([ctx.claimId, ctx.cancelClaimId, ctx.rejectClaimId].filter(Boolean).map(id => `id.eq.${id}`).join(',')); } catch {}
    try { await sb.from('finance_cost_centers').delete().eq('id', ctx.ccUuid); } catch {}
    try { await sb.from('hr_audit_log').delete().eq('submodule_key', 'finance_expenses').in('actor_id', [fmgr1Id, fmgr2Id, fstaffId]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_expenses').like('actor_user_id', 'EX-%'); } catch {}
    try { await sb.from('app_users').delete().in('id', [fmgr1Id, fmgr2Id, fstaffId, empId]); } catch {}
  });

  // =========================================================================
  h.section('Finance Expenses > Setup');
  // =========================================================================

  let fmgr1Token, fmgr2Token, fstaffToken, empToken;

  await test('provision finance_manager x2, finance_staff, employee', async () => {
    const users = [
      { id: fmgr1Id,  username: `${TAG}_emgr1`, full_name: 'Exp Mgr One (E2E)',   role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: fmgr2Id,  username: `${TAG}_emgr2`, full_name: 'Exp Mgr Two (E2E)',   role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: fstaffId, username: `${TAG}_estf`,  full_name: 'Exp Staff (E2E)',      role: 'finance_staff',   status: 'active', employment_type: 'employee' },
      { id: empId,    username: `${TAG}_eemp`,  full_name: 'Exp Employee (E2E)',   role: 'employee',        status: 'active', employment_type: 'employee' },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, `seed users failed: ${error?.message}`);

    fmgr1Token  = mint({ id: fmgr1Id,  username: `${TAG}_emgr1`, role: 'finance_manager', department_id: null });
    fmgr2Token  = mint({ id: fmgr2Id,  username: `${TAG}_emgr2`, role: 'finance_manager', department_id: null });
    fstaffToken = mint({ id: fstaffId, username: `${TAG}_estf`,  role: 'finance_staff',   department_id: null });
    empToken    = mint({ id: empId,    username: `${TAG}_eemp`,  role: 'employee',        department_id: null });
  });

  await test('seed a cost centre for allocation lines', async () => {
    const { data: cc, error } = await sb.from('finance_cost_centers').insert({
      code:   `CC-E2E-${TAG.slice(-6)}`,
      name:   `E2E Cost Centre ${TAG}`,
      status: 'active',
    }).select('id').single();
    expect(!error, `seed cost centre failed: ${error?.message}`);
    ctx.ccUuid = cc.id;
  });

  // =========================================================================
  h.section('Finance Expenses > Access control');
  // =========================================================================

  await test('employee is DENIED expenses/list', async () => {
    fails(await api('finance/expenses/list', empToken, {}), 'employee should be denied list');
  });

  await test('employee is DENIED expenses/create', async () => {
    fails(await api('finance/expenses/create', empToken, {
      claimantId: empId, title: 'test', expenseDate: '2026-07-01',
      category: 'travel', totalAmount: 100,
      allocationLines: [{ costCenterId: ctx.ccUuid, amount: 100 }],
    }), 'employee should be denied create');
  });

  await test('finance_staff can VIEW (list) but is DENIED create + approve', async () => {
    ok(await api('finance/expenses/list', fstaffToken, {}), 'finance_staff should list');
    fails(await api('finance/expenses/create', fstaffToken, {
      claimantId: fstaffId, title: 'test', expenseDate: '2026-07-01',
      category: 'travel', totalAmount: 100,
      allocationLines: [{ costCenterId: ctx.ccUuid, amount: 100 }],
    }), 'finance_staff should be denied create');
    fails(await api('finance/expenses/approve', fstaffToken, { id: '00000000-0000-0000-0000-000000000000' }), 'finance_staff should be denied approve');
  });

  // =========================================================================
  h.section('Finance Expenses > Allocation sum validation');
  // =========================================================================

  await test('create with lines not summing to total -> 422', async () => {
    fails(await api('finance/expenses/create', fmgr1Token, {
      claimantId:      fmgr1Id,
      title:           'Mismatched lines',
      expenseDate:     '2026-07-01',
      category:        'travel',
      totalAmount:     500,
      allocationLines: [{ costCenterId: ctx.ccUuid, amount: 400 }],  // 400 != 500
    }), 'mismatched lines should 422');
  });

  // =========================================================================
  h.section('Finance Expenses > Lifecycle');
  // =========================================================================

  await test('finance_manager creates an expense claim (draft) with 2 allocation lines', async () => {
    const r = await api('finance/expenses/create', fmgr1Token, {
      claimantId:      fmgr1Id,
      title:           `E2E Travel Expense ${TAG}`,
      expenseDate:     '2026-07-01',
      category:        'travel',
      totalAmount:     850,
      currency:        'TTD',
      reimbursable:    true,
      allocationLines: [
        { costCenterId: ctx.ccUuid, amount: 500, description: 'Flight' },
        { costCenterId: ctx.ccUuid, amount: 350, description: 'Hotel' },
      ],
    });
    ok(r, `create failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.id, 'missing id');
    expect(d.status === 'draft', `expected draft, got ${d.status}`);
    expect(Math.abs(d.totalAmount - 850) < 0.01, `total mismatch: ${d.totalAmount}`);
    ctx.claimId = d.id;
  });

  await test('section 2 side-effect: finance.expense.created event + audit row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_expenses').eq('event_type', 'finance.expense.created')
        .eq('source_entity_id', ctx.claimId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'created app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_expenses').eq('action', 'expense.created').eq('record_id', ctx.claimId).limit(1);
    expect((audit ?? []).length > 0, 'created audit row not found');
  });

  await test('lines/list returns the 2 allocation lines', async () => {
    const r = await api('finance/expenses/lines/list', fmgr1Token, { claimId: ctx.claimId });
    ok(r, `lines/list failed: ${r.body.message}`);
    expect(r.body.data.length === 2, `expected 2 lines, got ${r.body.data.length}`);
  });

  await test('submit (draft -> submitted) starts the approval workflow', async () => {
    const r = await api('finance/expenses/submit', fmgr1Token, { id: ctx.claimId });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.status === 'submitted', `expected submitted, got ${r.body.data.status}`);
  });

  await test('SoD: claimant (fmgr1) cannot approve their own claim -> refused', async () => {
    fails(await api('finance/expenses/approve', fmgr1Token, { id: ctx.claimId }), 'claimant should not approve own claim');
  });

  await test('a DIFFERENT finance_manager (fmgr2) can approve', async () => {
    const r = await api('finance/expenses/approve', fmgr2Token, { id: ctx.claimId });
    ok(r, `approve failed: ${r.body.message}`);
    expect(r.body.data.status === 'approved', `expected approved, got ${r.body.data.status}`);
  });

  await test('mark-reimbursed (approved -> reimbursed)', async () => {
    const r = await api('finance/expenses/mark-reimbursed', fmgr2Token, { id: ctx.claimId, reimbursedAt: '2026-07-10T12:00:00Z' });
    ok(r, `mark-reimbursed failed: ${r.body.message}`);
    expect(r.body.data.status === 'reimbursed', `expected reimbursed, got ${r.body.data.status}`);
  });

  await test('section 2 side-effect: submitted + approved + reimbursed events all written', async () => {
    const gotAll = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('event_type')
        .eq('source_module', 'finance_expenses').eq('source_entity_id', ctx.claimId);
      const types = new Set((data ?? []).map(e => e.event_type));
      return ['finance.expense.submitted', 'finance.expense.approved', 'finance.expense.reimbursed'].every(t => types.has(t));
    });
    expect(gotAll, 'submitted/approved/reimbursed events not all present');
  });

  // =========================================================================
  h.section('Finance Expenses > Reject path');
  // =========================================================================

  await test('create a second claim then reject it (reason required)', async () => {
    const cr = await api('finance/expenses/create', fmgr1Token, {
      claimantId:      fmgr1Id,
      title:           `E2E Reject Expense ${TAG}`,
      expenseDate:     '2026-07-02',
      category:        'meals',
      totalAmount:     200,
      allocationLines: [{ costCenterId: ctx.ccUuid, amount: 200, description: 'Team lunch' }],
    });
    ok(cr, `create for reject failed: ${cr.body.message}`);
    ctx.rejectClaimId = cr.body.data.id;

    // Submit it
    const sr = await api('finance/expenses/submit', fmgr1Token, { id: ctx.rejectClaimId });
    ok(sr, `submit for reject failed: ${sr.body.message}`);

    // Reject without reason -> should 422
    fails(await api('finance/expenses/reject', fmgr2Token, { id: ctx.rejectClaimId, reason: '' }), 'reject without reason should fail');

    // Reject with reason -> success
    const rr = await api('finance/expenses/reject', fmgr2Token, { id: ctx.rejectClaimId, reason: 'E2E reject reason' });
    ok(rr, `reject failed: ${rr.body.message}`);
    expect(rr.body.data.status === 'rejected', `expected rejected, got ${rr.body.data.status}`);
    expect(rr.body.data.rejectReason === 'E2E reject reason', 'rejectReason not set');
  });

  // =========================================================================
  h.section('Finance Expenses > Cancel + get + reports');
  // =========================================================================

  await test('create a third claim then cancel it (reason required)', async () => {
    const cr = await api('finance/expenses/create', fmgr1Token, {
      claimantId:      fmgr1Id,
      title:           `E2E Cancel Expense ${TAG}`,
      expenseDate:     '2026-07-03',
      category:        'supplies',
      totalAmount:     75,
      allocationLines: [{ costCenterId: ctx.ccUuid, amount: 75 }],
    });
    ok(cr, `create for cancel failed: ${cr.body.message}`);
    ctx.cancelClaimId = cr.body.data.id;

    // Cancel without reason -> 422
    fails(await api('finance/expenses/cancel', fmgr1Token, { id: ctx.cancelClaimId, reason: '' }), 'cancel without reason should fail');

    // Cancel with reason -> success
    const r = await api('finance/expenses/cancel', fmgr1Token, { id: ctx.cancelClaimId, reason: 'E2E cancel' });
    ok(r, `cancel failed: ${r.body.message}`);
    expect(r.body.data.status === 'cancelled', `expected cancelled, got ${r.body.data.status}`);
    expect(r.body.data.cancelReason === 'E2E cancel', 'cancelReason not set');
  });

  await test('get returns all fields the frontend consumes', async () => {
    const r = await api('finance/expenses/get', fmgr1Token, { id: ctx.claimId });
    ok(r, `get failed: ${r.body.message}`);
    const d = r.body.data;
    for (const k of ['id', 'claimNo', 'claimantId', 'title', 'expenseDate', 'category', 'totalAmount', 'currency', 'status', 'reimbursable', 'createdAt', 'updatedAt']) {
      expect(k in d, `get response missing ${k}`);
    }
  });

  await test('finance_manager can run the expenses report; finance_staff can view it', async () => {
    ok(await api('finance/expenses/reports/list', fmgr1Token, {}), 'reports/list failed for finance_manager');
    ok(await api('finance/expenses/reports/list', fstaffToken, {}), 'reports/list failed for finance_staff');
    ok(await api('finance/expenses/reports/run',  fmgr1Token, {}), 'reports/run failed for finance_manager');
  });

  await test('employee is DENIED expense reports', async () => {
    fails(await api('finance/expenses/reports/list', empToken, {}), 'employee should be denied reports');
  });
}
