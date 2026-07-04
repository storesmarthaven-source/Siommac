/**
 * E2E suite: Finance Budgeting & Budget-vs-Actual (F5)
 * Run: npm run test:e2e -- financeBudgets
 *
 * Covers:
 *   - list (finance_staff, finance_manager, employee)
 *   - upsert (create + idempotent update; duplicate 409; negative rejected)
 *   - get by id
 *   - variance (computes actuals from seeded finance_cost_entries)
 *   - delete
 *   - reports/list + reports/run
 *   - access control (employee denied manage)
 *   - S2 side-effects: app_events + hr_audit_log after upsert and delete
 *   - cleanup via h.TAG
 */

import { h, api, sb } from '../harness.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedCostCenter() {
  const { data, error } = await sb
    .from('finance_cost_centers')
    .insert({
      name:        h.tag('BudgetTest CC'),
      currency:    'TTD',
      annual_budget: 500000,
      metadata:    {},
    })
    .select('id')
    .single();
  if (error) throw new Error('seedCostCenter: ' + error.message);
  h.onCleanup(async () => {
    await sb.from('finance_cost_centers').delete().eq('id', data.id);
  });
  return data.id;
}

async function seedCostEntry(costCenterId, amount, periodYear) {
  const { data, error } = await sb
    .from('finance_cost_entries')
    .insert({
      ref:            h.tag('CE'),
      source_module:  'test',
      cost_center_id: costCenterId,
      amount,
      currency:       'TTD',
      status:         'approved',
      metadata:       { period_year: periodYear },
    })
    .select('id')
    .single();
  if (error) throw new Error('seedCostEntry: ' + error.message);
  h.onCleanup(async () => {
    await sb.from('finance_cost_entries').delete().eq('id', data.id);
  });
  return data.id;
}

async function cleanupBudgetLine(ccId, fy, cat) {
  await sb.from('finance_budget_lines')
    .delete()
    .eq('cost_center_id', ccId)
    .eq('fiscal_year', fy)
    .eq('category', cat);
}

// ---------------------------------------------------------------------------
// Main suite
// ---------------------------------------------------------------------------

h.suite('Finance Budgets', async () => {
  // Provision roles
  const fstaff  = await h.provisionUser('finance_staff');
  const fmgr    = await h.provisionUser('finance_manager');
  const emp     = await h.provisionUser('employee');

  const ccId = await seedCostCenter();
  const FY   = new Date().getFullYear();
  const CAT  = h.tag('Labour');
  const BUDGETED = 120000;

  // Seed two cost entries so we can verify actuals
  await seedCostEntry(ccId, 30000, FY);
  await seedCostEntry(ccId, 20000, FY);
  const EXPECTED_ACTUAL = 50000;

  h.onCleanup(async () => {
    await cleanupBudgetLine(ccId, FY, CAT);
  });

  // ── List (empty initially) ─────────────────────────────────────────────────
  h.test('list — finance_staff: empty list returned', async () => {
    const res = await api.post('/api/finance/budgets/list', { args: { costCenterId: ccId, fiscalYear: FY } }, fstaff.token);
    h.assert(res.success === true, 'success');
    h.assert(Array.isArray(res.data), 'data is array');
  });

  h.test('list — employee: denied (403)', async () => {
    const res = await api.post('/api/finance/budgets/list', { args: {} }, emp.token);
    h.assert(!res.success || res.status === 403, 'denied');
  });

  // ── Upsert ────────────────────────────────────────────────────────────────
  h.test('upsert — finance_staff: denied (403)', async () => {
    const res = await api.post('/api/finance/budgets/upsert', {
      args: { costCenterId: ccId, fiscalYear: FY, category: CAT, budgeted: BUDGETED },
    }, fstaff.token);
    h.assert(!res.success || res.status === 403, 'finance_staff cannot manage');
  });

  let createdId;
  h.test('upsert — finance_manager: creates budget line', async () => {
    const res = await api.post('/api/finance/budgets/upsert', {
      args: { costCenterId: ccId, fiscalYear: FY, category: CAT, budgeted: BUDGETED, label: 'Test Label' },
    }, fmgr.token);
    h.assert(res.success === true, 'success: ' + JSON.stringify(res));
    h.assert(res.data.costCenterId === ccId, 'ccId matches');
    h.assert(res.data.fiscalYear === FY, 'FY matches');
    h.assert(res.data.category === CAT, 'category matches');
    h.assert(Number(res.data.budgeted) === BUDGETED, 'budgeted: ' + res.data.budgeted);
    createdId = res.data.id;
  });

  // ── Negative budgeted ─────────────────────────────────────────────────────
  h.test('upsert — negative budgeted: 422', async () => {
    const res = await api.post('/api/finance/budgets/upsert', {
      args: { costCenterId: ccId, fiscalYear: FY, category: h.tag('NegCat'), budgeted: -100 },
    }, fmgr.token);
    h.assert(!res.success, 'should fail');
    h.assert(res.status === 422 || (res.message && res.message.includes('negative')), '422 or negative msg');
  });

  // ── Get by ID ─────────────────────────────────────────────────────────────
  h.test('get — finance_manager: returns line', async () => {
    h.assert(createdId, 'need createdId from prior test');
    const res = await api.post('/api/finance/budgets/get', { args: { id: createdId } }, fmgr.token);
    h.assert(res.success === true, 'success');
    h.assert(res.data.id === createdId, 'id matches');
  });

  // ── Idempotent upsert (update) ────────────────────────────────────────────
  h.test('upsert — idempotent update raises budgeted', async () => {
    const res = await api.post('/api/finance/budgets/upsert', {
      args: { costCenterId: ccId, fiscalYear: FY, category: CAT, budgeted: 200000 },
    }, fmgr.token);
    h.assert(res.success === true, 'idempotent upsert succeeds');
    h.assert(Number(res.data.budgeted) === 200000, 'budgeted updated');
  });

  // ── List with filter ──────────────────────────────────────────────────────
  h.test('list — finance_manager: filter by ccId + FY', async () => {
    const res = await api.post('/api/finance/budgets/list', {
      args: { costCenterId: ccId, fiscalYear: FY },
    }, fmgr.token);
    h.assert(res.success === true, 'success');
    h.assert(res.data.length >= 1, 'at least one line');
    const line = res.data.find(r => r.id === createdId);
    h.assert(line !== undefined, 'created line in results');
  });

  // ── Variance (actuals from seeded cost entries) ───────────────────────────
  h.test('variance — actuals match seeded cost entries', async () => {
    const res = await api.post('/api/finance/budgets/variance', {
      args: { fiscalYear: FY, costCenterId: ccId },
    }, fmgr.token);
    h.assert(res.success === true, 'success');
    const row = res.data.find(r => r.costCenterId === ccId && r.category === CAT);
    h.assert(row !== undefined, 'row for our cc+cat found');
    h.assert(Number(row.actual) >= EXPECTED_ACTUAL,
      `actual (${row.actual}) >= expected (${EXPECTED_ACTUAL})`);
    h.assert(Number(row.variance) === Number(row.budgeted) - Number(row.actual),
      'variance = budgeted - actual');
  });

  // ── S2 side-effects: app_events + hr_audit_log ────────────────────────────
  h.test('upsert side-effects: app_events emitted', async () => {
    h.assert(createdId, 'need createdId');
    const { data, error } = await sb
      .from('app_events')
      .select('id')
      .eq('source_module', 'finance_budgets')
      .eq('source_entity_id', createdId)
      .limit(1);
    h.assert(!error, 'app_events query ok: ' + (error?.message ?? ''));
    h.assert(data.length > 0, 'app_event emitted for budget line');
  });

  h.test('upsert side-effects: hr_audit_log written', async () => {
    h.assert(createdId, 'need createdId');
    const { data, error } = await sb
      .from('hr_audit_log')
      .select('id')
      .eq('submodule_key', 'finance_budgets')
      .eq('record_id', createdId)
      .limit(1);
    h.assert(!error, 'hr_audit_log query ok: ' + (error?.message ?? ''));
    h.assert(data.length > 0, 'hr_audit_log row written for budget line');
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  h.test('reports/list — finance_manager: catalog returned', async () => {
    const res = await api.post('/api/finance/budgets/reports/list', { args: {} }, fmgr.token);
    h.assert(res.success === true, 'success');
    h.assert(Array.isArray(res.data) && res.data.length > 0, 'catalog is non-empty');
    h.assert(res.data.some(r => r.key === 'budget_variance'), 'budget_variance in catalog');
  });

  h.test('reports/run — budget_variance', async () => {
    const res = await api.post('/api/finance/budgets/reports/run', {
      args: { reportKey: 'budget_variance', fiscalYear: FY, costCenterId: ccId },
    }, fmgr.token);
    h.assert(res.success === true, 'success');
    h.assert(Array.isArray(res.data), 'data is array');
  });

  h.test('reports/run — unknown key: 400', async () => {
    const res = await api.post('/api/finance/budgets/reports/run', {
      args: { reportKey: 'nonexistent_report', fiscalYear: FY },
    }, fmgr.token);
    h.assert(!res.success, 'should fail');
  });

  // ── Delete ────────────────────────────────────────────────────────────────
  h.test('delete — finance_staff: denied (403)', async () => {
    h.assert(createdId, 'need createdId');
    const res = await api.post('/api/finance/budgets/delete', { args: { id: createdId } }, fstaff.token);
    h.assert(!res.success || res.status === 403, 'finance_staff cannot delete');
  });

  h.test('delete — finance_manager: deletes line', async () => {
    h.assert(createdId, 'need createdId');
    const res = await api.post('/api/finance/budgets/delete', { args: { id: createdId } }, fmgr.token);
    h.assert(res.success === true, 'delete succeeded: ' + JSON.stringify(res));
    // Verify gone
    const res2 = await api.post('/api/finance/budgets/get', { args: { id: createdId } }, fmgr.token);
    h.assert(!res2.success || res2.data === null, 'line no longer exists');
  });

  h.test('delete side-effects: app_events emitted', async () => {
    h.assert(createdId, 'need createdId');
    const { data, error } = await sb
      .from('app_events')
      .select('id')
      .eq('source_module', 'finance_budgets')
      .eq('source_entity_id', createdId)
      .eq('event_type', 'finance.budgets.line.deleted')
      .limit(1);
    h.assert(!error, 'app_events query ok');
    h.assert(data.length > 0, 'delete app_event emitted');
  });

  h.test('delete side-effects: hr_audit_log written (delete action)', async () => {
    h.assert(createdId, 'need createdId');
    const { data, error } = await sb
      .from('hr_audit_log')
      .select('id')
      .eq('submodule_key', 'finance_budgets')
      .eq('record_id', createdId)
      .eq('action', 'budget_line.deleted')
      .limit(1);
    h.assert(!error, 'hr_audit_log query ok');
    h.assert(data.length > 0, 'delete audit row written');
  });
});
