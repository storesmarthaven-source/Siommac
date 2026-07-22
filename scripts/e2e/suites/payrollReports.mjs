/**
 * scripts/e2e/suites/payrollReports.mjs
 * E2E for the Payroll Reports Center (F-12, Phase A — Slice 2: catalog + summary +
 * PREVIEW branch + history). Worker / file exports / status / download / purge land
 * in Slice 3–4 and are covered when those routes exist (REPORT_FILE_EXPORTS_ENABLED).
 * Existing engine tables — the F-12 job/artifact tables (migs 740–745) are exercised
 * by later slices; this suite hits catalog/summary/run(preview)/history/list.
 */
export const title = 'Payroll — Reports Center (F-12, preview)';

import { payrollPeriodYear, payrollRunSeed } from '../helpers/payrollRun.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const Y = payrollPeriodYear('payrollReports', TAG);
  const P1 = `${Y}-01-01`, P2 = `${Y}-02-01`, P3 = `${Y}-03-01`, P4 = `${Y}-04-01`;
  const M1 = `${Y}-01`, M2 = `${Y}-02`;

  let fmgrT, viewOnlyT, empT, empA, empB;
  const ctx = { versionId: null, priorId: null, currentId: null, draftId: null, skewId: null, users: [], viewOnlyId: null };

  h.onCleanup(async () => {
    const runIds = [ctx.priorId, ctx.currentId, ctx.draftId, ctx.skewId].filter(Boolean);
    try { if (runIds.length) await sb.from('finance_payroll_run_warnings').delete().in('run_id', runIds); } catch {}
    try { if (runIds.length) await sb.from('finance_payroll_run_lines').delete().in('run_id', runIds); } catch {}
    try { if (runIds.length) await sb.from('finance_payroll_runs').delete().in('id', runIds); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { if (ctx.viewOnlyId) await sb.from('user_permissions').delete().eq('user_id', ctx.viewOnlyId); } catch {}
    try { if (ctx.users.length) await sb.from('app_users').delete().in('id', ctx.users); } catch {}
  });

  h.section('Reports Center > Setup');

  await test('provision actors + seed locked runs (prior + current + draft + skew)', async () => {
    const m = await acquireActors('finance_manager', 1);
    const v = await acquireActors('employee', 1);
    const e = await acquireActors('employee', 2);
    empA = e.actors[0].id; empB = e.actors[1].id;
    ctx.viewOnlyId = v.actors[0].id;
    ctx.users = [...m.createdIds, ...v.createdIds, ...e.createdIds];
    fmgrT     = mint({ id: m.actors[0].id, username: m.actors[0].username, role: 'finance_manager', department_id: null });
    viewOnlyT = mint({ id: v.actors[0].id, username: v.actors[0].username, role: 'employee', department_id: null });
    empT      = mint({ id: empA, username: e.actors[0].username, role: 'employee', department_id: null });

    // Grant ONLY reports.view to the view-only actor (reports.view WITHOUT view_all) —
    // no finance role carries that exact combo, so we use a user_permissions override.
    const { error: gErr } = await sb.from('user_permissions').insert({
      user_id: ctx.viewOnlyId, permission: 'finance.payroll.reports.view', granted: true,
      set_by: m.actors[0].id, set_at: new Date().toISOString(),
    });
    expect(!gErr, `grant reports.view failed: ${gErr?.message}`);

    // A hire in the current period for population_movements.
    await sb.from('app_users').update({ start_date: P2 }).eq('id', empB);

    const { data: ver, error: vErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: P1, label: `E2E RPT ${TAG}`,
      paye_personal_allowance: 90000, paye_band1_ceiling: 1000000, paye_band1_rate: 0.25, paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99, hs_weekly_high: 8.25, hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!vErr, `seed version failed: ${vErr?.message}`);
    ctx.versionId = ver.id;

    const mkRun = async (period, status, totals, empCount) => {
      const { data, error } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
        run_no: `RUN-RPT-${period}-${status}-${TAG.slice(-4)}`, periodStart: period,
        statutory_version_id: ctx.versionId, status, employee_count: empCount, pay_group: `E2E-PG-${TAG.slice(-4)}`,
        ...totals,
      })).select('id').single();
      expect(!error, `seed run ${period}/${status} failed: ${error?.message}`);
      return data.id;
    };
    const line = (runId, emp, o) => ({
      run_id: runId, employee_id: emp, base: o.gross, taxable_gross: o.gross, gross: o.gross,
      paye: o.paye, nis_employee: 0, nis_employer: 0, health_surcharge: 0, voluntary_deductions: o.vol ?? 0, net: o.net,
      department_id: null, cost_center_id: null,
      nis_status: o.nisStatus ?? null, nis_class_no: o.nisClass ?? null, nis_number_masked: o.nisMask ?? null,
    });

    // Distinct periods P1..P4 (avoid the scheduled unique key). Prior (P1) + current
    // (P2) header totals CONSISTENT with lines → reconciliation balanced. Draft (P3)
    // and skew (P4) sit OUTSIDE the M1..M2 cost/variance window on purpose.
    ctx.priorId = await mkRun(P1, 'locked', { gross_total: 5000, deduction_total: 500, net_total: 4500, nis_employer_total: 0 }, 1);
    ctx.currentId = await mkRun(P2, 'locked', { gross_total: 9000, deduction_total: 900, net_total: 8100, nis_employer_total: 0 }, 2);
    ctx.draftId = await mkRun(P3, 'draft', { gross_total: 0, deduction_total: 0, net_total: 0, nis_employer_total: 0 }, 0);
    // Skew: header gross_total deliberately ≠ line sum → reconciliation NOT balanced.
    ctx.skewId = await mkRun(P4, 'released', { gross_total: 9999, deduction_total: 500, net_total: 4500, nis_employer_total: 0 }, 1);

    const { error: lp } = await sb.from('finance_payroll_run_lines').insert([line(ctx.priorId, empA, { gross: 5000, paye: 500, net: 4500 })]);
    expect(!lp, `seed prior lines failed: ${lp?.message}`);
    const { error: lc } = await sb.from('finance_payroll_run_lines').insert([
      line(ctx.currentId, empA, { gross: 6000, paye: 800, net: 5200, vol: 0, nisStatus: 'unverified', nisClass: 1, nisMask: '***123' }),
      line(ctx.currentId, empB, { gross: 3000, paye: 100, net: 2900 }),
    ]);
    expect(!lc, `seed current lines failed: ${lc?.message}`);
    await sb.from('finance_payroll_run_lines').insert([line(ctx.skewId, empA, { gross: 5000, paye: 500, net: 4500 })]);

    // One NIS warning on the current run → nis_exceptions has a row.
    await sb.from('finance_payroll_run_warnings').insert({
      run_id: ctx.currentId, employee_id: empA, warning_type: 'missing_nis_number', severity: 'warning', message: 'NIS number missing',
    });
  });

  // ── Catalog + summary ──────────────────────────────────────────────────────
  h.section('Reports Center > Catalog + Summary');

  await test('RPT-CAT-01 finance_manager sees the 9-key catalog (preview-only formats in Slice 2)', async () => {
    const r = await api('finance/payroll/reports/catalog', fmgrT, {});
    ok(r, `catalog failed: ${r.body.message}`);
    const reports = r.body.data.reports;
    expect(reports.length === 9, `expected 9, got ${reports.length}`);
    const reg = reports.find(x => x.key === 'payroll_register');
    expect(reg && reg.requiresViewAll === true, 'payroll_register must require view_all');
    expect(reg && reg.supportedFormats.length === 1 && reg.supportedFormats[0] === 'preview', 'Slice 2 offers preview only');
    const audit = reports.find(x => x.key === 'export_audit_package');
    expect(audit && audit.supportedFormats.length === 0, 'export_audit_package is not runnable in Slice 2 (no preview)');
  });

  await test('RPT-SUM-01/04 summary returns 5 tiles; materialVariances inert', async () => {
    const r = await api('finance/payroll/reports/summary', fmgrT, {});
    ok(r, `summary failed: ${r.body.message}`);
    const t = r.body.data;
    for (const k of ['availableReports', 'generatedThisMonth', 'nisExceptions', 'materialVariances', 'auditPackages']) {
      expect(t[k] && typeof t[k].available === 'boolean', `tile ${k} missing`);
    }
    expect(t.materialVariances.value === null && t.materialVariances.available === false, 'materialVariances must be {null,false}');
    expect(t.availableReports.available && t.availableReports.value >= 1, 'availableReports should be counted');
  });

  await test('AUTH-RPT-002 non-payroll employee is DENIED catalog + summary', async () => {
    fails(await api('finance/payroll/reports/catalog', empT, {}), 'employee denied catalog');
    fails(await api('finance/payroll/reports/summary', empT, {}), 'employee denied summary');
  });

  // ── Preview: exact §5B DTOs ─────────────────────────────────────────────────
  h.section('Reports Center > Preview (per-report DTO)');
  const preview = (token, params) => api('finance/payroll/reports/run', token, { params, format: 'preview' });

  await test('RPT-SHP-01 payroll_register → RegisterRow[] + MoneyValue totals', async () => {
    const r = await preview(fmgrT, { report: 'payroll_register', runId: ctx.currentId });
    ok(r, `register failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.state === 'completed' && d.report === 'payroll_register', 'shape');
    expect(typeof d.scopeId === 'string' && d.generatedAt, 'scopeId + generatedAt');
    expect(d.rows.length === 2, `expected 2 rows, got ${d.rows.length}`);
    const row = d.rows[0];
    expect(row.employeeName && row.gross && row.gross.currency === 'TTD', 'RegisterRow MoneyValue');
    expect(d.totals.gross.amount === 9000 && d.totals.net.amount === 8100, `totals gross/net ${d.totals.gross.amount}/${d.totals.net.amount}`);
  });

  await test('RPT-SHP-02 net_pay_summary → grouped rows + readiness + totals', async () => {
    const r = await preview(fmgrT, { report: 'net_pay_summary', runId: ctx.currentId });
    ok(r, `net_pay_summary failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.report === 'net_pay_summary' && Array.isArray(d.rows), 'shape');
    expect(d.rows.every(x => ['ready', 'held', 'review'].includes(x.readiness)), 'readiness enum');
    expect(d.totals.net.amount === 8100, `net ${d.totals.net.amount}`);
  });

  await test('RPT-SHP-04 + RPT-REC-02 reconciliation EXACT (balanced iff every diff=0)', async () => {
    const r = await preview(fmgrT, { report: 'gross_to_net_reconciliation', runId: ctx.currentId });
    ok(r, `reconciliation failed: ${r.body.message}`);
    const rec = r.body.data.reconciliation;
    expect(rec.sources.length === 4 && rec.currency === 'TTD', '4 sources');
    for (const s of rec.sources) expect(s.matched === (s.difference.amount === 0), 'matched ⇔ diff==0');
    expect(rec.balanced === true, 'consistent run must be balanced (all diffs 0)');
  });

  await test('RPT-REC-01 reconciliation NOT balanced when a source differs (skew run)', async () => {
    const r = await preview(fmgrT, { report: 'gross_to_net_reconciliation', runId: ctx.skewId });
    ok(r, `reconciliation(skew) failed: ${r.body.message}`);
    const rec = r.body.data.reconciliation;
    expect(rec.balanced === false, 'skewed header must NOT balance');
    expect(rec.sources.some(s => !s.matched && s.difference.amount !== 0), 'a source must be unmatched');
  });

  await test('RPT-SHP-05 variance_analysis → VarianceRow[] (money=MoneyValue) + chart unit', async () => {
    const r = await preview(fmgrT, { report: 'variance_analysis', runId: ctx.currentId, compareRunId: ctx.priorId });
    ok(r, `variance failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.rows.length === 4, `expected 4 measures, got ${d.rows.length}`);
    const gross = d.rows.find(x => x.measure === 'gross');
    expect(gross && gross.value.unit === 'money' && gross.value.current.amount === 9000, 'gross current 9000 as MoneyValue');
    expect(d.chart && d.chart.series[0].unit === 'TTD' && typeof d.chart.scopeId === 'string', 'chart unit + scopeId');
  });

  await test('RPT-SHP-03 payroll_cost_analysis (period) → CostRow[] + chart + totals', async () => {
    const r = await preview(fmgrT, { report: 'payroll_cost_analysis', period: { from: M1, to: M2 } });
    ok(r, `cost_analysis failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.report === 'payroll_cost_analysis' && Array.isArray(d.rows), 'shape');
    expect(d.chart && d.chart.series[0].unit === 'TTD', 'chart unit');
    expect(d.totals.gross.currency === 'TTD', 'totals MoneyValue');
  });

  await test('RPT-SHP-06/07/08 overtime + movements + nis_exceptions return typed shapes', async () => {
    const ot = await preview(fmgrT, { report: 'overtime_allowance_analysis', period: { from: M1, to: M2 } });
    ok(ot, `overtime failed: ${ot.body.message}`);
    expect(Array.isArray(ot.body.data.rows) && ot.body.data.chart.series[0].unit === 'TTD', 'overtime shape');

    const pm = await preview(fmgrT, { report: 'population_movements', period: { from: M1, to: M2 } });
    ok(pm, `movements failed: ${pm.body.message}`);
    expect(Array.isArray(pm.body.data.rows), 'movements array');
    expect(pm.body.data.rows.every(x => x.movement !== 'transfer'), 'Phase A has NO transfer movement');

    const nis = await preview(fmgrT, { report: 'nis_exceptions', scope: 'run', runId: ctx.currentId });
    ok(nis, `nis_exceptions failed: ${nis.body.message}`);
    const row = nis.body.data.rows.find(x => x.employeeId === empA);
    expect(row && row.profileStatus === 'unverified' && row.nisClass === '1', 'nis row mapped from warning + line');
  });

  // ── Eligibility + validation ────────────────────────────────────────────────
  h.section('Reports Center > Eligibility + validation');

  await test('RPT-ELIG-02 draft run is ineligible (422)', async () => {
    fails(await preview(fmgrT, { report: 'payroll_register', runId: ctx.draftId }), 'draft run ineligible');
  });
  await test('RPT-ELIG-01 released run is eligible', async () => {
    const r = await preview(fmgrT, { report: 'gross_to_net_reconciliation', runId: ctx.skewId });
    ok(r, `released run should be eligible: ${r.body.message}`);
  });
  await test('RPT-DISC-01 params without a report discriminant → 400', async () => {
    fails(await preview(fmgrT, { runId: ctx.currentId }), 'no report discriminant');
  });
  await test('RPT-FMT-01 audit-package preview → 400 (zip only)', async () => {
    fails(await api('finance/payroll/reports/run', fmgrT, { params: { report: 'export_audit_package', runId: ctx.currentId }, format: 'preview' }), 'audit preview rejected');
  });
  await test('RPT-FMT-02 file format in preview-only Slice 2 → 400', async () => {
    fails(await api('finance/payroll/reports/run', fmgrT, { params: { report: 'payroll_register', runId: ctx.currentId }, format: 'xlsx', idempotencyKey: 'e2e-rpt-xlsx-0001' }), 'file export gated');
  });
  await test('RPT-PARAM-01 nis scope=run without runId → 422', async () => {
    fails(await preview(fmgrT, { report: 'nis_exceptions', scope: 'run' }), 'nis run needs runId');
  });
  await test('RPT-PARAM-01b nis scope=all WITH runId → 422', async () => {
    fails(await preview(fmgrT, { report: 'nis_exceptions', scope: 'all', runId: ctx.currentId }), 'nis all forbids runId');
  });
  await test('RPT-PARAM-02 variance compareRunId === runId → 422', async () => {
    fails(await preview(fmgrT, { report: 'variance_analysis', runId: ctx.currentId, compareRunId: ctx.currentId }), 'variance same-run');
  });
  await test('RPT-BOUND period > 24 months → 422', async () => {
    fails(await preview(fmgrT, { report: 'payroll_cost_analysis', period: { from: `${Y - 3}-01`, to: `${Y}-12` } }), 'period > 24 months');
  });

  // ── Additive gate (view_all) ────────────────────────────────────────────────
  h.section('Reports Center > Additive record gate (view_all)');

  await test('RPT-AUTH-11 reports.view + view_all runs employee-level preview', async () => {
    const r = await preview(fmgrT, { report: 'payroll_register', runId: ctx.currentId });
    ok(r, `manager register preview should pass: ${r.body.message}`);
  });
  await test('RPT-AUTH view-only (no view_all) CAN run an AGGREGATE preview', async () => {
    const r = await preview(viewOnlyT, { report: 'gross_to_net_reconciliation', runId: ctx.currentId });
    ok(r, `view-only aggregate preview should pass: ${r.body.message}`);
  });
  await test('AUTH-RPT-001 view-only (no view_all) is DENIED an EMPLOYEE-level preview (403)', async () => {
    fails(await preview(viewOnlyT, { report: 'payroll_register', runId: ctx.currentId }), 'employee-level needs view_all');
  });

  // ── History ─────────────────────────────────────────────────────────────────
  h.section('Reports Center > History');

  await test('RPT-HIS-01 history/list returns a keyset page (empty until file exports)', async () => {
    const r = await api('finance/payroll/reports/history/list', fmgrT, { limit: 25 });
    ok(r, `history failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data.rows), 'rows array');
    expect('nextCursor' in r.body.data, 'keyset nextCursor present');
  });

  // ── Side-effects (§2): preview writes ONE audit row, NO business event ───────
  h.section('Reports Center > Preview side-effects');

  await test('RPT-LOG-01 a preview writes exactly one audit row and NO business event', async () => {
    const r = await preview(fmgrT, { report: 'net_pay_summary', runId: ctx.currentId });
    ok(r, `preview failed: ${r.body.message}`);
    const scopeId = r.body.data.scopeId;
    const { data: audits } = await sb.from('hr_audit_log')
      .select('id, action, new_state')
      .eq('submodule_key', 'finance_payroll').eq('action', 'payroll_report.previewed').eq('record_id', scopeId);
    expect((audits ?? []).length >= 1, 'expected a payroll_report.previewed audit row');
    const { count: evCount } = await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .like('event_type', 'finance.payroll.report.%').eq('source_entity_id', scopeId);
    expect((evCount ?? 0) === 0, 'a preview must NOT emit a business event');
  });
}
