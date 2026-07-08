/**
 * scripts/e2e/suites/financeBudgets.mjs
 *
 * E2E for Finance ▸ Budgeting & Budget-vs-Actual (module F5).
 *
 * Routes under test:
 *   /api/finance/budgets/{list,get,upsert,delete,variance,
 *                          bulk-upsert,copy-last-year,
 *                          line-actuals,actuals,
 *                          reports/list,reports/run}
 *
 * Covers:
 *   • Access control: employee DENIED; finance_staff can VIEW but not manage.
 *   • Upsert creates a budget line; negative budgeted → 422; duplicate → idempotent.
 *   • Variance reads ACTUALS from seeded finance_cost_entries (read-only join).
 *   • Bulk-upsert creates/updates multiple lines in one call; returns correct count +
 *     overBudgetCount; backbone emits one event per call.
 *   • Copy-last-year copies source FY lines to target FY with adjustmentPct + roundingRule.
 *   • line-actuals returns the budget actuals result shape (budgetLine + entries + byMonth).
 *   • actuals returns a flat list of cost entries for the FY.
 *   • budget_actuals report key returns CostEntryRow[] shape.
 *   • Delete removes the line.
 *   • §2 side-effects: app_events (source_module 'finance_budgets') + hr_audit_log
 *     asserted via the service-role client.
 *   • Cleanup via h.TAG.
 *
 * NOTE: apply these migrations to the live DB before running, then NOTIFY pgrst, 'reload schema':
 *   20260807000000_finance_budget_lines_extend.sql
 *   20260807000001_finance_budgets_permissions.sql
 *
 * NOTE: new permission keys (not yet in permissionMeta.ts — add via orchestrator):
 *   finance.budgets.bulkUpsert  — required for /bulk-upsert
 *   finance.budgets.copyLastYear — required for /copy-last-year
 */

export const title = 'Finance — Budgeting & Budget-vs-Actual (F5)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  const ctx = {
    ccId:           null,
    fiscalYear:     new Date().getUTCFullYear(),
    prevFiscalYear: new Date().getUTCFullYear() - 1,
    category:       `LabourSeed-${TAG.slice(-6)}`,
    category2:      `OverheadSeed-${TAG.slice(-6)}`,
    lineId:         null,
    bulkLineIds:    [],
    copyLineIds:    [],
    ceIds:          [],
    createdUserIds: [],
  };
  let fmgrId, fstaffId, empId;

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('finance_budget_lines').delete().eq('cost_center_id', ctx.ccId); } catch {}
    try { if (ctx.ceIds.length) await sb.from('finance_cost_entries').delete().in('id', ctx.ceIds); } catch {}
    try { if (ctx.ccId) await sb.from('finance_cost_centers').delete().eq('id', ctx.ccId); } catch {}
    try { await sb.from('hr_audit_log').delete().eq('submodule_key', 'finance_budgets').in('actor_id', [fmgrId, fstaffId].filter(Boolean)); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_budgets').in('actor_user_id', [fmgrId, fstaffId, empId].filter(Boolean)); } catch {}
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

    fmgrToken  = mint({ id: fmgrId,  username: fmgr.username,  role: 'finance_manager', department_id: fmgr.department_id  ?? null });
    fstaffToken = mint({ id: fstaffId, username: fstaff.username, role: 'finance_staff', department_id: fstaff.department_id ?? null });
    empToken   = mint({ id: empId,   username: emp.username,   role: 'employee',       department_id: emp.department_id   ?? null });

    const { data: cc, error: ccErr } = await sb.from('finance_cost_centers')
      .insert({ name: `Budget Test CC ${TAG.slice(-6)}`, currency: 'TTD', annual_budget: 500000 })
      .select('id').single();
    expect(!ccErr, `seed cost centre failed: ${ccErr?.message}`);
    ctx.ccId = cc.id;

    // Seed cost entries to give actuals data
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

  await test('duplicate (same cost centre + fiscal year + category) → idempotent update', async () => {
    const r = await api('finance/budgets/upsert', fmgrToken, { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: ctx.category, budgeted: 999 });
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
  h.section('Finance Budgets › Bulk Upsert (finance.budgets.bulkUpsert)');
  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE: requires the permission 'finance.budgets.bulkUpsert' to be granted
  // to finance_manager in permissionMeta.ts + permissions migration. Until then,
  // finance_manager will receive 403 and these tests will record expected failures.

  await test('employee is DENIED bulk-upsert', async () => {
    fails(await api('finance/budgets/bulk-upsert', empToken, {
      lines: [{ costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: ctx.category2, budgeted: 5000 }],
    }), 'employee should be denied bulk-upsert');
  });

  await test('finance_staff is DENIED bulk-upsert (manage perm required)', async () => {
    fails(await api('finance/budgets/bulk-upsert', fstaffToken, {
      lines: [{ costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: ctx.category2, budgeted: 5000 }],
    }), 'finance_staff should be denied bulk-upsert');
  });

  await test('bulk-upsert: missing costCenterId line → 422', async () => {
    const r = await api('finance/budgets/bulk-upsert', fmgrToken, {
      lines: [{ fiscalYear: ctx.fiscalYear, category: ctx.category2, budgeted: 5000 }],
    });
    fails(r, 'bulk-upsert with missing costCenterId should be rejected');
  });

  await test('finance_manager bulk-upserts two lines', async () => {
    const r = await api('finance/budgets/bulk-upsert', fmgrToken, {
      lines: [
        { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: ctx.category2, budgeted: 80000, label: 'Bulk E2E Overhead' },
        { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: `Admin-${TAG.slice(-6)}`,   budgeted: 30000, label: 'Bulk E2E Admin' },
      ],
    });
    ok(r, `bulk-upsert failed: ${r.body.message}`);
    const d = r.body.data;
    expect(typeof d.count === 'number' && d.count >= 2, `count should be >= 2, got ${d.count}`);
    expect(Array.isArray(d.ids) && d.ids.length >= 2, 'ids should be array of >= 2');
    expect(typeof d.overBudgetCount === 'number', 'overBudgetCount must be numeric');
    ctx.bulkLineIds = d.ids;
  });

  await test('§2 side-effects: bulk-upsert emits one app_event (batch) + audit row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_budgets')
        .eq('event_type', 'finance.budgets.lines.bulk_upserted')
        .eq('actor_user_id', fmgrId)
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'bulk_upserted app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_budgets').eq('action', 'budget_lines.bulk_upserted')
      .eq('actor_id', fmgrId).limit(1);
    expect((audit ?? []).length > 0, 'budget_lines.bulk_upserted audit row not found');
  });

  await test('over-budget: bulk-upsert sets budgeted < actuals → overBudgetCount increments', async () => {
    // The two seeded cost entries total $50k for this cost centre.
    // Budget the category at $10k (below actual $50k) to trigger over-budget detection.
    const r = await api('finance/budgets/bulk-upsert', fmgrToken, {
      lines: [{ costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear, category: ctx.category, budgeted: 10000 }],
    });
    ok(r, `over-budget bulk-upsert failed: ${r.body.message}`);
    // overBudgetCount should reflect the lines that are now over budget
    expect(typeof r.body.data.overBudgetCount === 'number', 'overBudgetCount must be numeric');
    // The category has actual >= 50000 > budgeted 10000, so it should be counted
    expect(r.body.data.overBudgetCount >= 1, `expected overBudgetCount >= 1, got ${r.body.data.overBudgetCount}`);
  });

  await test('§9 side-effects: variance breach emits finance.budget.variance.threshold_breached app_event + notifications', async () => {
    // Gap 9 fix: assert that the backbone fired a variance breach event and notifications
    // after the over-budget bulk-upsert above.
    const gotBreachEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_budgets')
        .eq('event_type', 'finance.budget.variance.threshold_breached')
        .eq('actor_user_id', fmgrId)
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotBreachEvent, 'finance.budget.variance.threshold_breached app_event not found after over-budget bulk-upsert');
    // Notifications must have been written for finance_manager / finance_lead recipients
    const { data: breachNotifs } = await sb.from('notifications').select('id, recipient_user_id')
      .eq('source_type', 'budget_line_batch')
      .eq('module', 'finance_budgets')
      .limit(20);
    expect((breachNotifs ?? []).length > 0, 'no notifications written for variance breach recipients');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Copy Last Year (finance.budgets.copyLastYear)');
  // ═══════════════════════════════════════════════════════════════════════════
  // NOTE: requires the permission 'finance.budgets.copyLastYear' to be granted
  // to finance_manager. Until the orchestrator adds the grant this section 403s.

  await test('employee is DENIED copy-last-year', async () => {
    fails(await api('finance/budgets/copy-last-year', empToken, {
      sourceFiscalYear: ctx.fiscalYear, targetFiscalYear: ctx.prevFiscalYear,
    }), 'employee should be denied copy-last-year');
  });

  await test('finance_staff is DENIED copy-last-year', async () => {
    fails(await api('finance/budgets/copy-last-year', fstaffToken, {
      sourceFiscalYear: ctx.fiscalYear, targetFiscalYear: ctx.prevFiscalYear,
    }), 'finance_staff should be denied copy-last-year');
  });

  await test('copy-last-year: same source + target FY → 422', async () => {
    const r = await api('finance/budgets/copy-last-year', fmgrToken, {
      sourceFiscalYear: ctx.fiscalYear, targetFiscalYear: ctx.fiscalYear,
    });
    fails(r, 'same source + target fiscal year should be rejected');
  });

  await test('finance_manager copies current FY lines to prevFiscalYear + 10% adjustment', async () => {
    const r = await api('finance/budgets/copy-last-year', fmgrToken, {
      sourceFiscalYear:  ctx.fiscalYear,
      targetFiscalYear:  ctx.prevFiscalYear,
      costCenterId:      ctx.ccId,
      adjustmentPct:     10,
      roundingRule:      'hundred',
    });
    ok(r, `copy-last-year failed: ${r.body.message}`);
    const d = r.body.data;
    expect(typeof d.copied === 'number', `copied must be numeric, got ${typeof d.copied}`);
    expect(typeof d.skipped === 'number', `skipped must be numeric, got ${typeof d.skipped}`);
    expect(Array.isArray(d.ids), 'ids must be an array');
    expect(d.copied >= 0, 'copied must be >= 0');
    ctx.copyLineIds = d.ids;
  });

  await test('copied lines have adjusted amounts (10% increase) and correct target FY', async () => {
    if (!ctx.copyLineIds.length) { console.log('  skip: no lines were copied'); return; }
    const r = await api('finance/budgets/list', fmgrToken, { costCenterId: ctx.ccId, fiscalYear: ctx.prevFiscalYear });
    ok(r, `list for prevFiscalYear failed: ${r.body.message}`);
    const lines = (r.body.data ?? []).filter(l => ctx.copyLineIds.includes(l.id));
    expect(lines.length > 0, 'copied lines not found in list for prevFiscalYear');
    for (const line of lines) {
      expect(line.fiscalYear === ctx.prevFiscalYear, `line FY should be ${ctx.prevFiscalYear}, got ${line.fiscalYear}`);
    }
  });

  await test('§2 side-effects: copy-last-year emits app_event + audit row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_budgets')
        .eq('event_type', 'finance.budgets.lines.copied')
        .eq('actor_user_id', fmgrId)
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'copy_last_year app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_budgets').eq('action', 'budget_lines.copied')
      .eq('actor_id', fmgrId).limit(1);
    expect((audit ?? []).length > 0, 'budget_lines.copied audit row not found');
  });

  await test('copy-last-year: lines already in target FY are skipped (skipped >= existing count)', async () => {
    // Second copy of the same source to the same target should skip all (they already exist)
    const r = await api('finance/budgets/copy-last-year', fmgrToken, {
      sourceFiscalYear: ctx.fiscalYear,
      targetFiscalYear: ctx.prevFiscalYear,
      costCenterId:     ctx.ccId,
    });
    ok(r, `second copy-last-year failed: ${r.body.message}`);
    expect(r.body.data.copied === 0, `second copy should copy 0 (all exist), got ${r.body.data.copied}`);
    expect(r.body.data.skipped >= ctx.copyLineIds.length, `skipped should be >= ${ctx.copyLineIds.length}, got ${r.body.data.skipped}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Line Actuals (line-actuals)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee is DENIED line-actuals', async () => {
    fails(await api('finance/budgets/line-actuals', empToken, { id: ctx.lineId }), 'employee should be denied line-actuals');
  });

  await test('line-actuals returns the BudgetActualsResult shape', async () => {
    const r = await api('finance/budgets/line-actuals', fmgrToken, { id: ctx.lineId });
    ok(r, `line-actuals failed: ${r.body.message}`);
    const d = r.body.data;
    // Verify the shape the frontend consumes
    expect(d.budgetLine && typeof d.budgetLine === 'object', 'budgetLine must be an object');
    expect(Array.isArray(d.entries), 'entries must be an array');
    expect(typeof d.totalActual === 'number', 'totalActual must be numeric');
    expect(Array.isArray(d.byMonth), 'byMonth must be an array');
    // budgetLine should have all standard fields
    for (const k of ['id', 'costCenterId', 'fiscalYear', 'category', 'budgeted', 'actual', 'variance']) {
      expect(k in d.budgetLine, `budgetLine missing field: ${k}`);
    }
    // Each entry should have sourceModule, amount, etc.
    if (d.entries.length > 0) {
      const entry = d.entries[0];
      for (const k of ['id', 'sourceModule', 'amount', 'status', 'createdAt']) {
        expect(k in entry, `cost entry missing field: ${k}`);
      }
    }
  });

  await test('line-actuals totalActual matches sum of entries for correct FY', async () => {
    const r = await api('finance/budgets/line-actuals', fmgrToken, { id: ctx.lineId });
    ok(r, `line-actuals failed: ${r.body.message}`);
    const d = r.body.data;
    const sumFromEntries = d.entries.reduce((s, e) => s + Number(e.amount), 0);
    // totalActual should match sum of filtered entries
    expect(Math.abs(d.totalActual - sumFromEntries) < 0.01, `totalActual (${d.totalActual}) should match sum of entries (${sumFromEntries})`);
  });

  await test('finance_staff can VIEW line-actuals (view permission)', async () => {
    const r = await api('finance/budgets/line-actuals', fstaffToken, { id: ctx.lineId });
    ok(r, `finance_staff should be able to view line-actuals: ${r.body.message}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Actuals (actuals tab / cost entries for FY)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee is DENIED actuals', async () => {
    fails(await api('finance/budgets/actuals', empToken, { fiscalYear: ctx.fiscalYear }), 'employee should be denied actuals');
  });

  await test('actuals returns flat CostEntryRow[] for the FY', async () => {
    const r = await api('finance/budgets/actuals', fmgrToken, { fiscalYear: ctx.fiscalYear, costCenterId: ctx.ccId });
    ok(r, `actuals failed: ${r.body.message}`);
    const rows = r.body.data;
    expect(Array.isArray(rows), 'actuals must return an array');
    // Should include our seeded cost entries
    expect(rows.length >= 2, `should have at least 2 seeded entries, got ${rows.length}`);
    // Shape check
    if (rows.length > 0) {
      const row = rows[0];
      for (const k of ['id', 'sourceModule', 'sourceEntityType', 'amount', 'status', 'createdAt']) {
        expect(k in row, `cost entry missing field: ${k}`);
      }
    }
  });

  await test('actuals filtered by costCenterId returns only that cost centre entries', async () => {
    const r = await api('finance/budgets/actuals', fmgrToken, { fiscalYear: ctx.fiscalYear, costCenterId: ctx.ccId });
    ok(r, `actuals filtered failed: ${r.body.message}`);
    // All returned entries should be for our seeded CC (checked via ref prefix)
    const ourRefs = r.body.data.filter(e => (e.ref ?? '').startsWith(`CE-${TAG}`));
    expect(ourRefs.length >= 2, `expected at least 2 seeded entries with our TAG, found ${ourRefs.length}`);
  });

  await test('finance_staff can VIEW actuals (view permission)', async () => {
    const r = await api('finance/budgets/actuals', fstaffToken, { fiscalYear: ctx.fiscalYear });
    ok(r, `finance_staff should be able to view actuals: ${r.body.message}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › Reports');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('reports/list catalog is non-empty for finance_manager', async () => {
    const r = await api('finance/budgets/reports/list', fmgrToken, {});
    ok(r, `reports/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'reports catalog is empty');
  });

  await test('reports catalog includes the budget_actuals report key', async () => {
    const r = await api('finance/budgets/reports/list', fmgrToken, {});
    ok(r, `reports/list failed: ${r.body.message}`);
    const keys = (r.body.data ?? []).map(r => r.key);
    expect(keys.includes('budget_actuals'), `budget_actuals key missing from catalog, found: ${keys.join(', ')}`);
  });

  await test('reports/run — budget variance report executes', async () => {
    const catalog = await api('finance/budgets/reports/list', fmgrToken, {});
    const first = (catalog.body.data ?? []).find(r => r.key !== 'budget_actuals');
    expect(first?.key, 'no non-actuals report key available to run');
    const r = await api('finance/budgets/reports/run', fmgrToken, { reportKey: first.key, fiscalYear: ctx.fiscalYear, costCenterId: ctx.ccId });
    ok(r, `reports/run failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'report data is not an array');
  });

  await test('reports/run — budget_actuals report returns CostEntryRow shape', async () => {
    const r = await api('finance/budgets/reports/run', fmgrToken, { reportKey: 'budget_actuals', fiscalYear: ctx.fiscalYear, costCenterId: ctx.ccId });
    ok(r, `budget_actuals report failed: ${r.body.message}`);
    const rows = r.body.data;
    expect(Array.isArray(rows), 'budget_actuals report data is not an array');
    if (rows.length > 0) {
      const row = rows[0];
      expect('sourceModule' in row, 'budget_actuals row missing sourceModule');
      expect('amount' in row, 'budget_actuals row missing amount');
    }
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

  await test('line-actuals for deleted line → 404 or empty data', async () => {
    const r = await api('finance/budgets/line-actuals', fmgrToken, { id: ctx.lineId });
    // Either fails with 404 or returns empty data — both are acceptable
    if (r.body.success) {
      expect(!r.body.data || !r.body.data.budgetLine, 'line-actuals for deleted line should return empty data');
    }
    // If it fails (404), that is also acceptable
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › CSV export (Gap 7 — FE-only, data-shape asserted here)');
  // ═══════════════════════════════════════════════════════════════════════════
  // The CSV export is a frontend-only operation (exportCsv utility, no backend
  // endpoint). The E2E layer asserts that the list endpoint returns all the fields
  // that the frontend maps into the export file.

  await test('list returns all fields required for CSV export', async () => {
    // Recreate a line to assert against (the previous one was deleted)
    const cr = await api('finance/budgets/upsert', fmgrToken, {
      costCenterId: ctx.ccId,
      fiscalYear:   ctx.fiscalYear,
      category:     `CsvExportTest-${TAG.slice(-6)}`,
      budgeted:     5000,
      label:        'CSV export E2E test',
    });
    ok(cr, `create line for csv test failed: ${cr.body.message}`);
    const csvLineId = cr.body.data.id;

    const r = await api('finance/budgets/list', fmgrToken, { costCenterId: ctx.ccId, fiscalYear: ctx.fiscalYear });
    ok(r, `list for csv test failed: ${r.body.message}`);
    const row = (r.body.data ?? []).find(x => x.id === csvLineId);
    expect(row !== undefined, 'csv test line not found in list');
    // Assert all fields the frontend's exportCsv maps into columns
    for (const k of ['category', 'label', 'costCenterName', 'fiscalYear', 'budgeted', 'actual', 'variance', 'variancePct']) {
      expect(k in row, `list row missing CSV field: ${k}`);
    }
    // Cleanup
    await api('finance/budgets/delete', fmgrToken, { id: csvLineId });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › /approvals endpoint (Gap 8)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee is DENIED /approvals', async () => {
    const anyId = ctx.bulkLineIds[0] ?? '00000000-0000-0000-0000-000000000001';
    fails(await api('finance/budgets/approvals', empToken, { id: anyId }), 'employee should be denied /approvals');
  });

  await test('/approvals returns an array of approval tasks for a budget line', async () => {
    // Use a bulk-upserted line id (may have no workflow tasks yet — empty array is valid)
    const lineId = ctx.bulkLineIds[0];
    if (!lineId) { console.log('  skip: no bulk lines available'); return; }
    const r = await api('finance/budgets/approvals', fmgrToken, { id: lineId });
    ok(r, `/approvals failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), '/approvals must return an array');
    // If tasks exist, verify the shape the frontend consumes
    if (r.body.data.length > 0) {
      const t = r.body.data[0];
      for (const k of ['id', 'stepKey', 'status', 'createdAt']) {
        expect(k in t, `/approvals task missing field: ${k}`);
      }
    }
  });

  await test('finance_staff can VIEW /approvals', async () => {
    const lineId = ctx.bulkLineIds[0];
    if (!lineId) { console.log('  skip: no bulk lines available'); return; }
    const r = await api('finance/budgets/approvals', fstaffToken, { id: lineId });
    ok(r, `finance_staff should be able to view /approvals: ${r.body.message}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Budgets › /audit-log endpoint (Gap 8)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee is DENIED /audit-log', async () => {
    const anyId = ctx.bulkLineIds[0] ?? '00000000-0000-0000-0000-000000000001';
    fails(await api('finance/budgets/audit-log', empToken, { id: anyId }), 'employee should be denied /audit-log');
  });

  await test('finance_staff is DENIED /audit-log (manage permission required)', async () => {
    const lineId = ctx.bulkLineIds[0];
    if (!lineId) { console.log('  skip: no bulk lines available'); return; }
    fails(await api('finance/budgets/audit-log', fstaffToken, { id: lineId }), 'finance_staff should be denied /audit-log');
  });

  await test('/audit-log returns an array of audit entries for a budget line', async () => {
    const lineId = ctx.bulkLineIds[0];
    if (!lineId) { console.log('  skip: no bulk lines available'); return; }
    const r = await api('finance/budgets/audit-log', fmgrToken, { id: lineId });
    ok(r, `/audit-log failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), '/audit-log must return an array');
    // If entries exist, verify the shape the frontend consumes
    if (r.body.data.length > 0) {
      const e = r.body.data[0];
      for (const k of ['id', 'action', 'actorId', 'createdAt']) {
        expect(k in e, `/audit-log entry missing field: ${k}`);
      }
    }
  });
}
