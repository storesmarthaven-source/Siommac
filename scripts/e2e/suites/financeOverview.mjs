/**
 * scripts/e2e/suites/financeOverview.mjs
 *
 * Finance — Overview dashboard end-to-end suite.
 * Covers Wave 2A chunks:
 *   - Chunk 9  (Export):              /overview/export  — CSV download + audit event
 *   - Chunk 10 (KPI drill-through):   /overview/kpi-drilldown — per-KPI register
 *   - Chunk 11 (Approvals inbox):     /overview/approvals/list + /act — cross-module approve/reject
 *   - Chunk 13 (Spend-budget series): /overview/spend-budget-series — period-aware series
 *   - Baseline  (summary):            /overview/summary — existing endpoint still works
 *
 * Permission matrix (from permissions.ts):
 *   finance_staff:   overview.view ✓ | overview.export ✓ | kpi.drill ✗ | approvals.inline ✗
 *   finance_manager: all four ✓
 *   hr_staff:        none ✗
 *
 * NOTE: These tests run against whatever data is in the DB at test time. Approval-flow
 * tests that need existing submitted rows skip gracefully if the DB is empty.
 *
 * Operator gate:
 *   npm run build:backend → restart dev:netlify → npm run test:e2e -- financeOverview
 */

export const title = 'Finance — Overview';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const T = { admin: mint(admin) };

  // Acquire role actors
  const { actors: [fstaff] }    = await h.acquireActors('finance_staff',   1);
  const { actors: [fmgr] }      = await h.acquireActors('finance_manager',  1);
  const { actors: [noFinance] } = await h.acquireActors('hr_staff', 1);

  const Tstaff = mint(fstaff);
  const Tmgr   = mint(fmgr);
  const TnoFin = mint(noFinance);

  // Track created rows for cleanup
  const ctx = {
    billIds: /** @type {string[]} */ ([]),
  };

  h.onCleanup(async () => {
    if (ctx.billIds.length) await sb.from('finance_ap_bills').delete().in('id', ctx.billIds);
    await sb.from('app_events').delete().ilike('payload->>tag', `${TAG}%`);
    await sb.from('audit_logs').delete().ilike('data->>tag', `${TAG}%`);
  });

  // ────────────────────── BASELINE — Overview summary ──────────────────────────

  h.section('Overview › Summary');

  await test('finance_staff can load overview summary', async () => {
    const r = await api('finance/overview/summary', Tstaff, {});
    ok(r);
    const data = r.body.data;
    expect(data && typeof data.kpis === 'object', 'missing kpis');
    expect(Array.isArray(data.approvalsQueue), 'approvalsQueue not array');
    expect(Array.isArray(data.costCentreBurn), 'costCentreBurn not array');
    expect(Array.isArray(data.deadlines), 'deadlines not array');
    expect(Array.isArray(data.activity), 'activity not array');
    expect(data.approvalsAging && typeof data.approvalsAging.totalPending === 'number', 'missing approvalsAging');
    expect(data.spendTrend && Array.isArray(data.spendTrend.labels), 'missing spendTrend');
  });

  await test('finance_manager can load overview summary', async () => {
    const r = await api('finance/overview/summary', Tmgr, {});
    ok(r);
  });

  await test('unauthenticated request denied 401', async () => {
    const r = await api('finance/overview/summary', null, {});
    fails(r, 'unauthenticated should fail');
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });

  await test('hr_staff denied 403 on overview summary', async () => {
    const r = await api('finance/overview/summary', TnoFin, {});
    fails(r, 'hr_staff must be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('kpis shape has all required numeric fields', async () => {
    const r = await api('finance/overview/summary', Tstaff, {});
    ok(r);
    const k = r.body.data?.kpis;
    expect(typeof k.spendMtd === 'number', 'missing spendMtd');
    expect(typeof k.pendingApprovalsCount === 'number', 'missing pendingApprovalsCount');
    expect(typeof k.pendingApprovalsAmount === 'number', 'missing pendingApprovalsAmount');
    expect(typeof k.budgetVariance === 'number', 'missing budgetVariance');
    expect(typeof k.cashOutMtd === 'number', 'missing cashOutMtd');
  });

  // ────────────────────── CHUNK 9 — Export ─────────────────────────────────────

  h.section('Overview › Export (Chunk 9)');

  await test('finance_staff can export all data (has overview.export perm)', async () => {
    const r = await api('finance/overview/export', Tstaff, { type: 'all' });
    ok(r);
    const { csv, filename, rowCount } = r.body.data;
    expect(typeof csv === 'string', 'csv not a string');
    expect(typeof filename === 'string' && filename.endsWith('.csv'), 'filename must end .csv');
    expect(typeof rowCount === 'number' && rowCount >= 0, 'rowCount must be non-negative');
  });

  await test('finance_manager can export all data', async () => {
    const r = await api('finance/overview/export', Tmgr, { type: 'all' });
    ok(r);
    expect(typeof r.body.data.csv === 'string', 'csv not string');
  });

  await test('export type=approvals returns csv with correct header or empty', async () => {
    const r = await api('finance/overview/export', Tmgr, { type: 'approvals' });
    ok(r);
    const csv = r.body.data.csv;
    expect(typeof csv === 'string', 'csv not string');
    if (csv.trim().length > 0) {
      expect(csv.startsWith('Type,'), `approvals csv wrong header: ${csv.slice(0, 80)}`);
    }
  });

  await test('export type=spend-budget returns csv', async () => {
    const r = await api('finance/overview/export', Tmgr, { type: 'spend-budget' });
    ok(r);
    expect(typeof r.body.data.csv === 'string', 'csv not string');
  });

  await test('export type=dashboard returns csv with Metric header or empty', async () => {
    const r = await api('finance/overview/export', Tmgr, { type: 'dashboard' });
    ok(r);
    const csv = r.body.data.csv;
    expect(typeof csv === 'string', 'csv not string');
    if (csv.trim().length > 0) {
      expect(csv.startsWith('Metric,'), `dashboard csv wrong header: ${csv.slice(0, 80)}`);
    }
  });

  await test('export emits finance.dashboard.exported app event', async () => {
    await api('finance/overview/export', Tmgr, { type: 'all' });
    await new Promise(res => setTimeout(res, 600));
    const { data: events } = await sb.from('app_events')
      .select('id, event_type, actor_user_id')
      .eq('event_type', 'finance.dashboard.exported')
      .eq('actor_user_id', fmgr.id)
      .order('created_at', { ascending: false })
      .limit(1);
    expect(Array.isArray(events) && events.length > 0, 'finance.dashboard.exported event not emitted');
  });

  await test('hr_staff denied 403 on export (no finance.overview.export perm)', async () => {
    const r = await api('finance/overview/export', TnoFin, { type: 'all' });
    fails(r, 'hr_staff must be denied export');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('unauthenticated export denied 401', async () => {
    const r = await api('finance/overview/export', null, {});
    fails(r, 'unauthenticated must fail');
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });

  // ────────────────────── CHUNK 10 — KPI Drill-through ─────────────────────────

  h.section('Overview › KPI Drill-through (Chunk 10)');

  const KPI_TYPES = ['spend', 'pending-approvals', 'budget-variance', 'cash-out'];

  for (const kpiType of KPI_TYPES) {
    await test(`kpi-drilldown type=${kpiType} returns titled rows`, async () => {
      const r = await api('finance/overview/kpi-drilldown', Tmgr, { kpiType, period: 'mtd' });
      ok(r);
      const data = r.body.data;
      expect(data && typeof data.title === 'string' && data.title.length > 0, 'missing or empty title');
      expect(Array.isArray(data.rows), 'rows not array');
      expect(typeof data.total === 'number', 'total not number');
      expect(data.kpiType === kpiType, `kpiType echo mismatch: expected '${kpiType}' got '${data.kpiType}'`);
      if (data.rows.length > 0) {
        const row = data.rows[0];
        expect(typeof row.id === 'string', 'row.id not string');
        expect(typeof row.ref === 'string', 'row.ref not string');
        expect(typeof row.type === 'string', 'row.type not string');
        expect(typeof row.party === 'string', 'row.party not string');
        expect(typeof row.amount === 'number', 'row.amount not number');
        expect(typeof row.route === 'string', 'row.route not string');
      }
    });
  }

  await test('finance_staff denied 403 on kpi-drilldown (no kpi.drill perm)', async () => {
    const r = await api('finance/overview/kpi-drilldown', Tstaff, { kpiType: 'spend' });
    fails(r, 'finance_staff must be denied kpi.drill');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('hr_staff denied 403 on kpi-drilldown', async () => {
    const r = await api('finance/overview/kpi-drilldown', TnoFin, { kpiType: 'spend' });
    fails(r, 'hr_staff must be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('kpi-drilldown rejects invalid kpiType with 400', async () => {
    const r = await api('finance/overview/kpi-drilldown', Tmgr, { kpiType: 'not-a-real-type' });
    fails(r, 'invalid kpiType must return error');
    expect(r.status === 400, `expected 400, got ${r.status}`);
  });

  await test('kpi-drilldown emits finance.kpi.drilled event', async () => {
    await api('finance/overview/kpi-drilldown', Tmgr, { kpiType: 'spend', period: 'mtd' });
    await new Promise(res => setTimeout(res, 600));
    const { data: events } = await sb.from('app_events')
      .select('id, event_type, actor_user_id, payload')
      .eq('event_type', 'finance.kpi.drilled')
      .eq('actor_user_id', fmgr.id)
      .order('created_at', { ascending: false })
      .limit(1);
    expect(Array.isArray(events) && events.length > 0, 'finance.kpi.drilled event not emitted');
    if (events && events.length > 0) {
      expect(events[0].payload?.kpiType === 'spend',
        `kpiType mismatch in event payload: ${JSON.stringify(events[0].payload)}`);
    }
  });

  await test('kpi-drilldown unauthenticated denied 401', async () => {
    const r = await api('finance/overview/kpi-drilldown', null, { kpiType: 'spend' });
    fails(r, 'unauthenticated must fail');
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });

  // ────────────────────── CHUNK 11 — Approvals Inbox ───────────────────────────

  h.section('Overview › Approvals Inbox (Chunk 11)');

  await test('approvals/list returns array with all required fields', async () => {
    const r = await api('finance/overview/approvals/list', Tmgr, {});
    ok(r);
    const items = r.body.data;
    expect(Array.isArray(items), 'approvals list not array');
    if (items.length > 0) {
      const item = items[0];
      expect(typeof item.id === 'string', 'missing id');
      expect(['Bill', 'Expense', 'Remittance', 'Disbursement'].includes(item.type),
        `invalid type: '${item.type}'`);
      expect(typeof item.ref === 'string', 'missing ref');
      expect(typeof item.party === 'string', 'missing party');
      expect(typeof item.amount === 'number', 'amount not number');
      expect(typeof item.ageDays === 'number', 'ageDays not number');
      expect(typeof item.userCanApprove === 'boolean', 'userCanApprove not boolean');
      expect(typeof item.canReject === 'boolean', 'canReject not boolean');
      expect(typeof item.route === 'string', 'route not string');
    }
  });

  await test('approvals/list type=Bill filter narrows to Bill only', async () => {
    const r = await api('finance/overview/approvals/list', Tmgr, { type: 'Bill' });
    ok(r);
    const items = r.body.data;
    expect(Array.isArray(items), 'not array');
    expect(items.every(i => i.type === 'Bill'), 'filter did not narrow to Bill — mixed types returned');
  });

  await test('approvals/list type=Expense filter narrows to Expense only', async () => {
    const r = await api('finance/overview/approvals/list', Tmgr, { type: 'Expense' });
    ok(r);
    expect(r.body.data.every(i => i.type === 'Expense'), 'filter leaked non-Expense items');
  });

  await test('approvals/list priority=high returns only items with amount >= 15000', async () => {
    const r = await api('finance/overview/approvals/list', Tmgr, { priority: 'high' });
    ok(r);
    const items = r.body.data;
    expect(items.every(i => i.amount >= 15000), 'low-value item slipped through priority=high filter');
  });

  await test('approvals/list Remittance items always have canReject=false', async () => {
    const r = await api('finance/overview/approvals/list', Tmgr, { type: 'Remittance' });
    ok(r);
    expect(r.body.data.every(i => i.canReject === false),
      'Remittance item has canReject=true — must be false (reject not supported)');
  });

  await test('approvals/list Disbursement items always have canReject=false', async () => {
    const r = await api('finance/overview/approvals/list', Tmgr, { type: 'Disbursement' });
    ok(r);
    expect(r.body.data.every(i => i.canReject === false),
      'Disbursement item has canReject=true — must be false');
  });

  await test('finance_staff denied 403 on approvals/list (no approvals.inline perm)', async () => {
    const r = await api('finance/overview/approvals/list', Tstaff, {});
    fails(r, 'finance_staff must be denied approvals.inline');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('hr_staff denied 403 on approvals/list', async () => {
    const r = await api('finance/overview/approvals/list', TnoFin, {});
    fails(r, 'hr_staff must be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('approvals/act reject without reason returns 422', async () => {
    // Use a dummy UUID — Zod validates after permission check, before DB, so reason
    // validation fires even for non-existent IDs. The validation is the thing under test.
    const r = await api('finance/overview/approvals/act', Tmgr, {
      id: '00000000-0000-0000-0000-000000000001', type: 'Bill', action: 'reject',
      // reason intentionally omitted
    });
    fails(r, 'missing reason must return failure');
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  await test('approvals/act Remittance reject returns 422 (cross-module reject not supported)', async () => {
    const r = await api('finance/overview/approvals/act', Tmgr, {
      id: '00000000-0000-0000-0000-000000000002', type: 'Remittance',
      action: 'reject', reason: 'Testing inline reject restriction',
    });
    fails(r, 'Remittance reject must be rejected');
    expect(r.status === 422, `expected 422 for Remittance reject, got ${r.status}`);
  });

  await test('approvals/act Disbursement reject returns 422', async () => {
    const r = await api('finance/overview/approvals/act', Tmgr, {
      id: '00000000-0000-0000-0000-000000000003', type: 'Disbursement',
      action: 'reject', reason: 'Testing inline reject restriction',
    });
    fails(r, 'Disbursement reject must be rejected');
    expect(r.status === 422, `expected 422 for Disbursement reject, got ${r.status}`);
  });

  await test('approvals/act SoD — fstaff denied 403 (no approvals.inline perm, not SoD)', async () => {
    // fstaff has no approvals.inline permission → 403 before SoD even runs
    const r = await api('finance/overview/approvals/act', Tstaff, {
      id: '00000000-0000-0000-0000-000000000006', type: 'Bill', action: 'approve',
    });
    fails(r, 'finance_staff must be denied approvals.inline');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('approvals/act approve bill inline by finance_manager (happy path)', async () => {
    // Find a submitted bill that fmgr can approve (SoD-checked server-side)
    const listR = await api('finance/overview/approvals/list', Tmgr, { type: 'Bill' });
    ok(listR);
    const bills = listR.body.data.filter(i => i.type === 'Bill' && i.userCanApprove);
    if (!bills.length) return; // no manager-approvable bills in queue — skip

    const r = await api('finance/overview/approvals/act', Tmgr, {
      id: bills[0].id, type: 'Bill', action: 'approve',
    });
    ok(r);
    expect(typeof r.body.data.status === 'string', 'missing status in response');
    expect(r.body.data.status === 'approved', `expected status=approved, got ${r.body.data.status}`);

    // Side-effect: finance.bill.approved event emitted by the AP module
    await new Promise(res => setTimeout(res, 600));
    const { data: events } = await sb.from('app_events')
      .select('id, event_type')
      .eq('event_type', 'finance.bill.approved')
      .order('created_at', { ascending: false })
      .limit(1);
    expect(Array.isArray(events) && events.length > 0, 'finance.bill.approved event not emitted after inline approve');
  });

  await test('approvals/act hr_staff denied 403', async () => {
    const r = await api('finance/overview/approvals/act', TnoFin, {
      id: '00000000-0000-0000-0000-000000000005', type: 'Bill', action: 'approve',
    });
    fails(r, 'hr_staff must be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ────────────────────── CHUNK 13-chart — Spend-Budget Series ─────────────────

  h.section('Overview › Spend-Budget Series (Chunk 13-chart)');

  const PERIODS = ['MTD', 'Monthly', 'Quarterly'];

  for (const period of PERIODS) {
    await test(`spend-budget-series period=${period} returns correct parallel-array shape`, async () => {
      const r = await api('finance/overview/spend-budget-series', Tstaff, { period });
      ok(r);
      const s = r.body.data;
      expect(s && Array.isArray(s.labels), 'labels not array');
      expect(Array.isArray(s.spend), 'spend not array');
      expect(Array.isArray(s.budget), 'budget not array');
      expect(Array.isArray(s.forecast), 'forecast not array');
      expect(typeof s.forecastFromIndex === 'number', 'forecastFromIndex not number');
      expect(s.labels.length === s.spend.length,
        `labels/spend length mismatch: ${s.labels.length} vs ${s.spend.length}`);
      expect(s.labels.length === s.budget.length,
        `labels/budget length mismatch: ${s.labels.length} vs ${s.budget.length}`);
      expect(s.labels.length === s.forecast.length,
        `labels/forecast length mismatch: ${s.labels.length} vs ${s.forecast.length}`);
      // Forecast values must be numbers (NaN is a valid number in JS), null, or omitted — never a string
      const invalidForecast = s.forecast.filter(v => v !== null && typeof v !== 'number');
      expect(invalidForecast.length === 0,
        `forecast contains non-numeric values: ${JSON.stringify(invalidForecast.slice(0, 3))}`);
    });
  }

  await test('spend-budget-series MTD has day-level numeric labels', async () => {
    const r = await api('finance/overview/spend-budget-series', Tstaff, { period: 'MTD' });
    ok(r);
    const labels = r.body.data.labels;
    expect(labels.length > 0, 'MTD labels empty');
    expect(!isNaN(Number(labels[0])), `MTD label[0] should be numeric day, got '${labels[0]}'`);
  });

  await test('spend-budget-series Monthly returns exactly 6 labels', async () => {
    const r = await api('finance/overview/spend-budget-series', Tstaff, { period: 'Monthly' });
    ok(r);
    expect(r.body.data.labels.length === 6,
      `expected 6 monthly labels, got ${r.body.data.labels.length}`);
  });

  await test('spend-budget-series Quarterly returns exactly 4 labels', async () => {
    const r = await api('finance/overview/spend-budget-series', Tstaff, { period: 'Quarterly' });
    ok(r);
    expect(r.body.data.labels.length === 4,
      `expected 4 quarterly labels, got ${r.body.data.labels.length}`);
  });

  await test('finance_manager can access spend-budget-series', async () => {
    const r = await api('finance/overview/spend-budget-series', Tmgr, { period: 'Monthly' });
    ok(r);
  });

  await test('hr_staff denied 403 on spend-budget-series (no finance.overview.view)', async () => {
    const r = await api('finance/overview/spend-budget-series', TnoFin, { period: 'Monthly' });
    fails(r, 'hr_staff must be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('spend-budget-series invalid period rejected with 400', async () => {
    const r = await api('finance/overview/spend-budget-series', Tstaff, { period: 'Weekly' });
    fails(r, 'invalid period must return error');
    expect(r.status === 400, `expected 400 for invalid period, got ${r.status}`);
  });

  await test('spend-budget-series unauthenticated denied 401', async () => {
    const r = await api('finance/overview/spend-budget-series', null, {});
    fails(r, 'unauthenticated must fail');
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });
}
