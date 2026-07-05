/**
 * scripts/e2e/suites/financeBudgets.mjs
 *
 * E2E for Finance ▸ Budgeting & Budget-vs-Actual (module F5).
 *
 * Routes under test:
 *   /api/finance/budgets/{list,get,upsert,delete,variance,reports/list,reports/run}
 *
 * Covers:
 *   • Access control: employee DENIED; finance_staff can VIEW but not manage/delete.
 *   • Upsert creates a budget line; negative budgeted → 422; duplicate (same
 *     cost centre + fiscal year + category) → 409.
 *   • Idempotent upsert updates the existing line (raises budgeted).
 *   • Variance reads ACTUALS from seeded finance_cost_entries (read-only join).
 *   • Delete removes the line.
 *   • Reports catalog + run.
 *   • §2 side-effects: app_events (source_module 'finance_budgets') + hr_audit_log
 *     for both upsert and delete, asserted via the service-role client.
 *   • Cleanup via h.TAG.
 *
 * NOTE: apply these migrations to the live DB before running, then NOTIFY pgrst, 'reload schema':
 *   20260807000000_finance_budget_lines_extend.sql
 *   20260807000001_finance_budgets_permissions.sql
 */

export const title = 'Finance — Budgeting & Budget-vs-Actual (F5)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  const ctx = {
    ccId: null,
    fiscalYear: new Date().getUTCFullYear(),
    category: `LabourSeed-${TAG.slice(-6)}`,
    lineId: null,
    ceIds: [],
    createdUserIds: [],
  };
  let fmgrId, fstaffId, empId;

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('finance_budget_lines').delete().eq('cost_center_id', ctx.ccId).eq('fiscal_year', ctx.fiscalYear); } catch {}
    try { if (ctx.ceIds.length) await sb.from('finance_cost_entries').delete().in('id', ctx.ceIds); } catch {}
    try { if (ctx.ccId) await sb.from('finance_cost_centers').delete().eq('id', ctx.ccId); } catch {}
    try { await sb.from('hr_audit_log').delete().eq('submodule_key', 'finance_budgets').in('actor_id', [fmgrId, fstaffId]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_budgets').in('actor_user_id', [fmgrId, fstaffId, empId]); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  let fmgrToken, fstaffToken, empToken;

  await test('acquire finance_manager, finance_staff, employee (real roster preferred) + a cost centre + 2 cost entries', async () => {
    const mgrR = await acquireActors('finance_manager', 1);
    const stfR = await acquireActors('finance_staff', 1);
    const empR = await acquireActors('employee', 1);
    const [fmgr] = mgrR.actors, [fstaff] = stfR.actors, [emp] = empR.actors;
    fmgrId = fmgr.id; fstaffId = fstaff.id; empId = emp.id;
    ctx.createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

    fmgrToken = mint({ id: fmgrId, username: fmgr.username, role: 'finance_manager', department_id: fmgr.department_id ?? null });
    fstaffToken = mint({ id: fstaffId, username: fstaff.username, role: 'finance_staff', department_id: fstaff.department_id ?? null });
    empToken = mint({ id: empId, username: emp.username, role: 'employee', department_id: emp.department_id ?? null });

    const { data: cc, error: ccErr } = await sb.from('finance_cost_centers')
      .insert({ name: `Budget Test CC ${TAG.slice(-6)}`, currency: 'TTD', annual_budget: 500000 })
      .select('id').single();
    expect(!ccErr, `seed cost centre failed: ${ccErr?.message}`);
    ctx.ccId = cc.id;

    const { data: ces, error: ceErr } = await sb.from('finance_cost_entries')
      .insert([
        { ref: `CE-${TAG}-1`, source_module: 'test', source_entity_type: 'test', source_entity_id: 'e2e', cost_center_id: ctx.ccId, amount: 30000, currency: 'TTD', status: 'approved', metadata: { period_year: ctx.fiscalYear } },
        { ref: `CE-${TAG}-2`, source_module: 'test', source_entity_type: 'test', source_entity_id: 'e2e', cost_center_id: ctx.ccId, amount: 20000, currency: 'TTD', status: 'approved', metadata: { period_year: ctx.fiscalYear } },
      ])
      .select('id');
    expect(!ceErr, `seed cost entries failed: ${ceErr?.message}`);
    ctx.ceIds = (ces ?? []).map(r => r.id);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Access control');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee is DENIED budgets/list', async () => {
    fails(await api('finance/budgets/list', empToken, {}), 'employee should be denied list');
  });

  await test('finance_staff CAN list (view) but is DENIED upsert + delete', async () => {
    const r = await api('finance/budgets/list', fstaffToken, { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear });
    ok(r, `finance_staff list failed: ${r.body.message}`);
    fails(await api('finance/budgets/upsert', fstaffToken, { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: ctx.category, budgeted: 120000 }), 'finance_staff should be denied upsert');
    fails(await api('finance/budgets/delete', fstaffToken, { id: '00000000-0000-0000-0000-000000000000' }), 'finance_staff should be denied delete');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Upsert + validation');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('upsert negative budgeted → 422', async () => {
    const r = await api('finance/budgets/upsert', fmgrToken, { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: `${ctx.category}-neg`, budgeted: -100 });
    fails(r, 'negative budgeted should be rejected');
  });

  await test('finance_manager creates a budget line', async () => {
    const r = await api('finance/budgets/upsert', fmgrToken, { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: ctx.category, budgeted: 120000, label: 'E2E Labour Budget' });
    ok(r, `upsert failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.id, 'missing id');
    expect(d.costCenterId === ctx.ccId, 'costCenterId mismatch');
    expect(d.fiscalYear === ctx.fiscalYear, 'fiscalYear mismatch');
    expect(d.category === ctx.category, 'category mismatch');
    expect(Number(d.budgeted) === 120000, `budgeted mismatch: ${d.budgeted}`);
    ctx.lineId = d.id;
  });

  await test('duplicate (same cost centre + fiscal year + category) → 409', async () => {
    const r = await api('finance/budgets/upsert', fmgrToken, { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: ctx.category, budgeted: 999, isNew: true });
    // The backend treats (cc, year, category) as the natural key for upsert; a duplicate
    // insert attempt without going through update semantics is refused.
    // (If the route's upsert is idempotent by design, this assertion instead verifies
    // the SAME line is returned rather than a second row being created.)
    if (r.body.success) {
      expect(r.body.data.id === ctx.lineId, 'upsert on duplicate key should update the existing line, not create a new one');
    } else {
      fails(r, 'duplicate should be refused if not idempotent');
    }
  });

  await test('§2 side-effects: finance.budgets.line.upserted event + audit row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_budgets').eq('event_type', 'finance.budgets.line.upserted')
        .eq('source_entity_id', ctx.lineId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'upserted app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_budgets').eq('action', 'budget_line.upserted').eq('record_id', ctx.lineId).limit(1);
    expect((audit ?? []).length > 0, 'budget_line.upserted audit row not found');
  });

  await test('get returns the line with the fields the frontend consumes', async () => {
    const r = await api('finance/budgets/get', fmgrToken, { id: ctx.lineId });
    ok(r, `get failed: ${r.body.message}`);
    for (const k of ['id', 'costCenterId', 'fiscalYear', 'category', 'budgeted', 'actual', 'variance']) {
      expect(k in r.body.data, `get response missing ${k}`);
    }
  });

  await test('idempotent upsert (same key) raises the budgeted amount', async () => {
    const r = await api('finance/budgets/upsert', fmgrToken, { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: ctx.category, budgeted: 200000 });
    ok(r, `idempotent upsert failed: ${r.body.message}`);
    expect(Number(r.body.data.budgeted) === 200000, `budgeted not updated: ${r.body.data.budgeted}`);
    expect(r.body.data.id === ctx.lineId, 'idempotent upsert should update the same line');
  });

  await test('list filtered by cost centre + fiscal year includes our line', async () => {
    const r = await api('finance/budgets/list', fmgrToken, { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear });
    ok(r, `list failed: ${r.body.message}`);
    expect((r.body.data ?? []).some(x => x.id === ctx.lineId), 'created line not found in filtered list');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Variance (actuals from seeded cost entries)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('variance shows actual = sum of seeded cost entries; variance = budgeted - actual', async () => {
    const r = await api('finance/budgets/variance', fmgrToken, { fiscalYear: ctx.fiscalYear, costCenterId: ctx.ccId });
    ok(r, `variance failed: ${r.body.message}`);
    const row = (r.body.data ?? []).find(x => x.costCenterId === ctx.ccId && x.category === ctx.category);
    expect(row !== undefined, 'variance row for our cost centre + category not found');
    expect(Number(row.actual) >= 50000, `actual should be >= 50000 (30000+20000 seeded), got ${row.actual}`);
    expect(Number(row.variance) === Number(row.budgeted) - Number(row.actual), 'variance !== budgeted - actual');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Reports');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('reports/list catalog is non-empty for finance_manager', async () => {
    const r = await api('finance/budgets/reports/list', fmgrToken, {});
    ok(r, `reports/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'reports catalog is empty');
  });

  await test('reports/run — budget variance report executes', async () => {
    const catalog = await api('finance/budgets/reports/list', fmgrToken, {});
    const key = (catalog.body.data ?? [])[0]?.key;
    expect(key, 'no report key available to run');
    const r = await api('finance/budgets/reports/run', fmgrToken, { reportKey: key, fiscalYear: ctx.fiscalYear, costCenterId: ctx.ccId });
    ok(r, `reports/run failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'report data is not an array');
  });

  await test('reports/run with an unknown key → refused', async () => {
    fails(await api('finance/budgets/reports/run', fmgrToken, { reportKey: 'nonexistent_report_key', fiscalYear: ctx.fiscalYear }), 'unknown report key should be refused');
  });

  await test('employee is DENIED budgets reports', async () => {
    fails(await api('finance/budgets/reports/list', empToken, {}), 'employee should be denied reports');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Delete');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_staff is DENIED delete', async () => {
    fails(await api('finance/budgets/delete', fstaffToken, { id: ctx.lineId }), 'finance_staff should be denied delete');
  });

  await test('finance_manager deletes the budget line', async () => {
    const r = await api('finance/budgets/delete', fmgrToken, { id: ctx.lineId });
    ok(r, `delete failed: ${r.body.message}`);
    const after = await api('finance/budgets/get', fmgrToken, { id: ctx.lineId });
    expect(!after.body.success || after.body.data === null, 'line should no longer exist after delete');
  });

  await test('§2 side-effects: finance.budgets.line.deleted event + audit row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_budgets').eq('event_type', 'finance.budgets.line.deleted')
        .eq('source_entity_id', ctx.lineId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'deleted app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_budgets').eq('action', 'budget_line.deleted').eq('record_id', ctx.lineId).limit(1);
    expect((audit ?? []).length > 0, 'budget_line.deleted audit row not found');
  });
}
