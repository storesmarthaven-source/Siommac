/**
 * scripts/e2e/suites/payrollReports.mjs
 * E2E for the Payroll Reports Center (F-12, Phase A — Slice 2: catalog + summary +
 * PREVIEW branch + history). Worker / file exports / status / download / purge land
 * in Slice 3–4 and are covered when those routes exist (REPORT_FILE_EXPORTS_ENABLED).
 * Existing engine tables — the F-12 job/artifact tables (migs 740–745) are exercised
 * by later slices; this suite hits catalog/summary/run(preview)/history/list.
 */
export const title = 'Payroll — Reports Center (F-12, preview)';

import { randomUUID, createHash } from 'node:crypto';
import { payrollPeriodYear, payrollRunSeed } from '../helpers/payrollRun.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const Y = payrollPeriodYear('payrollReports', TAG);
  const P1 = `${Y}-01-01`, P2 = `${Y}-02-01`, P3 = `${Y}-03-01`, P4 = `${Y}-04-01`;
  const M1 = `${Y}-01`, M2 = `${Y}-02`;

  let fmgrT, fmgr2T, viewOnlyT, empT, empA, empB;
  const ctx = { versionId: null, priorId: null, currentId: null, draftId: null, skewId: null, users: [], viewOnlyId: null, fmgrId: null, jobIds: [], artifactId: null, csvPath: null, orphanPaths: [], purgeArtifactId: null, purgePath: null };
  const BUCKET = 'payroll-report-artifacts';

  h.onCleanup(async () => {
    // §7 cleanup: remove Storage objects FIRST, then delete the job (CASCADE clears
    // upload_attempts + artifacts).
    if (ctx.jobIds.length) {
      try {
        const { data: arts } = await sb.from('payroll_report_artifacts').select('storage_path').in('job_id', ctx.jobIds);
        const { data: atts } = await sb.from('payroll_report_upload_attempts').select('storage_path').in('job_id', ctx.jobIds);
        const paths = [...(arts ?? []), ...(atts ?? [])].map(x => x.storage_path).filter(Boolean);
        if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      } catch {}
      try { await sb.from('payroll_report_jobs').delete().in('id', ctx.jobIds); } catch {}
    }
    // Orphan-reconciler test objects + any ledger rows keyed to them.
    if (ctx.orphanPaths.length) {
      try { await sb.storage.from(BUCKET).remove(ctx.orphanPaths); } catch {}
      try { await sb.from('payroll_report_upload_attempts').delete().in('storage_path', ctx.orphanPaths); } catch {}
    }
    const runIds = [ctx.priorId, ctx.currentId, ctx.draftId, ctx.skewId].filter(Boolean);
    try { if (runIds.length) await sb.from('finance_payroll_run_warnings').delete().in('run_id', runIds); } catch {}
    try { if (runIds.length) await sb.from('finance_payroll_run_lines').delete().in('run_id', runIds); } catch {}
    try { if (runIds.length) await sb.from('finance_payroll_runs').delete().in('id', runIds); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { if (ctx.users.length) await sb.from('user_permissions').delete().in('user_id', ctx.users); } catch {}
    try { if (ctx.users.length) await sb.from('app_users').delete().in('id', ctx.users); } catch {}
  });

  h.section('Reports Center > Setup');

  await test('provision actors + seed locked runs (prior + current + draft + skew)', async () => {
    const m = await acquireActors('finance_manager', 2);
    const v = await acquireActors('employee', 1);
    const e = await acquireActors('employee', 2);
    empA = e.actors[0].id; empB = e.actors[1].id;
    ctx.viewOnlyId = v.actors[0].id;
    ctx.fmgrId = m.actors[0].id;
    ctx.users = [...m.createdIds, ...v.createdIds, ...e.createdIds];
    // fmgr = finance_manager + reports.maintain (drives the workers). fmgr2 = a plain
    // finance_manager: it HAS reports.export via its role but NOT maintain, so it
    // proves an exporter cannot drive the global generation/purge workers (#15).
    fmgrT     = mint({ id: m.actors[0].id, username: m.actors[0].username, role: 'finance_manager', department_id: null });
    fmgr2T    = mint({ id: m.actors[1].id, username: m.actors[1].username, role: 'finance_manager', department_id: null });
    viewOnlyT = mint({ id: v.actors[0].id, username: v.actors[0].username, role: 'employee', department_id: null });
    empT      = mint({ id: empA, username: e.actors[0].username, role: 'employee', department_id: null });

    // Grant ONLY reports.view to the view-only actor (reports.view WITHOUT view_all) —
    // no finance role carries that exact combo, so we use a user_permissions override.
    const now = new Date().toISOString();
    const { error: gErr } = await sb.from('user_permissions').insert([
      { user_id: ctx.viewOnlyId, permission: 'finance.payroll.reports.view', granted: true, set_by: m.actors[0].id, set_at: now },
      // reports.maintain is a system-operator permission carried by NO finance role —
      // grant it to fmgr via override so it can drive the worker trigger routes.
      { user_id: m.actors[0].id, permission: 'finance.payroll.reports.maintain', granted: true, set_by: m.actors[0].id, set_at: now },
    ]);
    expect(!gErr, `grant reports.view/maintain failed: ${gErr?.message}`);

    // A hire in the current period for population_movements. empB's name is a
    // spreadsheet formula so the CSV export can prove formula-injection neutralization.
    await sb.from('app_users').update({ start_date: P2, full_name: '=1+2' }).eq('id', empB);

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

  await test('RPT-CAT-01 finance_manager sees the 9-key catalog (preview + csv/pdf; xlsx + zip deferred)', async () => {
    const r = await api('finance/payroll/reports/catalog', fmgrT, {});
    ok(r, `catalog failed: ${r.body.message}`);
    const reports = r.body.data.reports;
    expect(reports.length === 9, `expected 9, got ${reports.length}`);
    const reg = reports.find(x => x.key === 'payroll_register');
    expect(reg && reg.requiresViewAll === true, 'payroll_register must require view_all');
    expect(reg && ['preview', 'csv', 'pdf'].every(f => reg.supportedFormats.includes(f)) && !reg.supportedFormats.includes('xlsx'),
      `register should offer preview+csv/pdf (no xlsx), got ${reg?.supportedFormats}`);
    const audit = reports.find(x => x.key === 'export_audit_package');
    expect(audit && audit.supportedFormats.length === 0, 'export_audit_package (zip) still deferred → not runnable');
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
  await test('RPT-FMT-02 the audit-package ZIP is still deferred → 400', async () => {
    fails(await api('finance/payroll/reports/run', fmgrT, { params: { report: 'export_audit_package', runId: ctx.currentId }, format: 'zip', idempotencyKey: 'e2e-rpt-zip-000001' }), 'zip deferred');
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
  await test('RPT-BOUND-02 invalid month (YYYY-99) → 400 (structural)', async () => {
    const r = await api('finance/payroll/reports/run', fmgrT, { params: { report: 'payroll_cost_analysis', period: { from: `${Y}-99`, to: `${Y}-12` } }, format: 'preview' });
    expect(r.status === 400 && !r.body.success, `expected 400 for month 99, got ${r.status}`);
  });
  await test('RPT-BOUND-03 reversed period (to < from) → 422, not an empty success', async () => {
    const r = await api('finance/payroll/reports/run', fmgrT, { params: { report: 'payroll_cost_analysis', period: { from: `${Y}-06`, to: `${Y}-01` } }, format: 'preview' });
    expect(r.status === 422 && !r.body.success, `expected 422 for reversed range, got ${r.status} ${JSON.stringify(r.body).slice(0,120)}`);
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

  // ── File exports: enqueue → worker → status → artifact (Slice 3) ────────────
  h.section('Reports Center > File exports (worker)');
  const IDEM = `e2e-rpt-csv-${TAG.slice(-8)}`;

  await test('FSM-RPT-001 / MUT-RPT-001 enqueue a CSV export → queued + jobId (+ event/audit)', async () => {
    const r = await api('finance/payroll/reports/run', fmgrT, {
      params: { report: 'gross_to_net_reconciliation', runId: ctx.currentId }, format: 'csv', idempotencyKey: IDEM,
    });
    ok(r, `enqueue failed: ${r.body.message}`);
    expect(r.body.data.state === 'queued' && r.body.data.jobId, 'expected {state:queued, jobId}');
    ctx.jobIds.push(r.body.data.jobId);
    const { count: ev } = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.report.enqueued').eq('source_entity_id', r.body.data.jobId);
    expect((ev ?? 0) === 1, 'exactly one enqueued event');
    const { count: au } = await sb.from('hr_audit_log').select('id', { count: 'exact', head: true })
      .eq('action', 'payroll_report.enqueued').eq('record_id', r.body.data.jobId);
    expect((au ?? 0) === 1, 'exactly one enqueue audit row');
  });

  await test('RPT-IDEM-01 same idempotency key returns the SAME job', async () => {
    const r = await api('finance/payroll/reports/run', fmgrT, {
      params: { report: 'gross_to_net_reconciliation', runId: ctx.currentId }, format: 'csv', idempotencyKey: IDEM,
    });
    ok(r, `re-enqueue failed: ${r.body.message}`);
    expect(r.body.data.jobId === ctx.jobIds[0], 'same key must return the original jobId');
  });

  await test('AUTH-RPT-003 file export requires reports.export (view-only denied)', async () => {
    fails(await api('finance/payroll/reports/run', viewOnlyT, {
      params: { report: 'gross_to_net_reconciliation', runId: ctx.currentId }, format: 'csv', idempotencyKey: `e2e-rpt-deny-${TAG.slice(-8)}`,
    }), 'file export needs reports.export');
  });

  await test('missing/blank idempotencyKey on a file export → 400', async () => {
    fails(await api('finance/payroll/reports/run', fmgrT, {
      params: { report: 'gross_to_net_reconciliation', runId: ctx.currentId }, format: 'csv',
    }), 'file export needs an idempotency key');
  });

  await test('INT-RPT-001 the worker generates the artifact; status → succeeded (checksum + audit)', async () => {
    const w = await api('finance/payroll/reports/generation/run', fmgrT, { limit: 10 });
    ok(w, `worker run failed: ${w.body.message}`);
    expect(w.body.data.claimed >= 1 && w.body.data.succeeded >= 1, `worker summary ${JSON.stringify(w.body.data)}`);

    const s = await api('finance/payroll/reports/status', fmgrT, { jobId: ctx.jobIds[0] });
    ok(s, `status failed: ${s.body.message}`);
    expect(s.body.data.state === 'succeeded', `expected succeeded, got ${s.body.data.state}`);
    const a = s.body.data.artifact;
    expect(a && a.format === 'csv' && a.byteSize > 0 && /^[0-9a-f]{64}$/.test(a.sha256), 'artifact checksum + bytes');
    expect(a.reportKey === 'gross_to_net_reconciliation', 'artifact report key');
    ctx.artifactId = a.id;
    const { count: ev } = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.report.completed').eq('source_entity_id', a.id);
    expect((ev ?? 0) === 1, 'exactly one completed event');
    // Remember the committed object's path (proves committed-path-safety later).
    const { data: art } = await sb.from('payroll_report_artifacts').select('storage_path').eq('id', a.id).maybeSingle();
    ctx.csvPath = art?.storage_path ?? null;
  });

  await test('RPT-HIS-02 the generated artifact now appears in history', async () => {
    const r = await api('finance/payroll/reports/history/list', fmgrT, { limit: 25 });
    ok(r, `history failed: ${r.body.message}`);
    expect(r.body.data.rows.some(x => x.reportKey === 'gross_to_net_reconciliation' && x.format === 'csv'), 'artifact in history');
  });

  await test('RPT-STA-05 a non-owner basic viewer gets 404 (no leak)', async () => {
    const r = await api('finance/payroll/reports/status', viewOnlyT, { jobId: ctx.jobIds[0] });
    expect(r.status === 404 || !r.body.success, `expected 404 for non-owner non-reviewer, got ${r.status}`);
  });

  // ── Download (§6A / API-RPT-006) ─────────────────────────────────────────────
  h.section('Reports Center > Download');
  const dlAuditCount = async () => (await sb.from('hr_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'payroll_report.downloaded').eq('record_id', ctx.artifactId)).count ?? 0;

  await test('RPT-DL-01 owner-with-export downloads → {url, expiresAt}; TTL ≈ 120s; +1 audit', async () => {
    const before = await dlAuditCount();
    const r = await api('finance/payroll/reports/artifacts/download', fmgrT, { artifactId: ctx.artifactId });
    ok(r, `download failed: ${r.body.message}`);
    expect(typeof r.body.data.url === 'string' && r.body.data.url.length > 0, 'expected a signed url');
    const ttl = (new Date(r.body.data.expiresAt).getTime() - Date.now()) / 1000;
    expect(ttl > 116 && ttl <= 121, `TTL must be ~120s, got ${ttl.toFixed(1)}s`);
    expect((await dlAuditCount()) === before + 1, 'exactly one download audit row per action');
  });

  await test('RPT-DL-02 a fresh URL is issued per action (audit increments again)', async () => {
    const before = await dlAuditCount();
    const r = await api('finance/payroll/reports/artifacts/download', fmgrT, { artifactId: ctx.artifactId });
    ok(r, `second download failed: ${r.body.message}`);
    expect((await dlAuditCount()) === before + 1, 'a second action re-issues (a second audit row)');
  });

  await test('AUTH-RPT-003b a viewer without reports.export is DENIED download (403)', async () => {
    const r = await api('finance/payroll/reports/artifacts/download', viewOnlyT, { artifactId: ctx.artifactId });
    expect(r.status === 403 && !r.body.success, `expected 403, got ${r.status}`);
  });

  await test('RPT-DL-04 an unknown artifactId → 404', async () => {
    const r = await api('finance/payroll/reports/artifacts/download', fmgrT, { artifactId: randomUUID() });
    expect(r.status === 404 && !r.body.success, `expected 404, got ${r.status}`);
  });

  // ── Orphan-object reconciler (§6A) ───────────────────────────────────────────
  h.section('Reports Center > Orphan reconciler');
  const objectExists = async (path) => {
    const dl = await sb.storage.from(BUCKET).download(path);
    return !dl.error && !!dl.data;
  };
  // Seed an uncommitted upload attempt (stale token vs the succeeded job) + a real
  // Storage object at its immutable path — exactly the shape a crashed worker leaves.
  const seedOrphan = async (ageMs = 0, cleanupAttempts = 0) => {
    const token = randomUUID();
    const bytes = Buffer.from(`orphan,${token}\n`, 'utf8');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const path = `${ctx.jobIds[0]}/${token}/${sha}.csv`;
    ctx.orphanPaths.push(path);
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'text/csv', upsert: false });
    if (up.error) throw new Error(`seed upload: ${up.error.message}`);
    const { data, error } = await sb.from('payroll_report_upload_attempts').insert({
      job_id: ctx.jobIds[0], claim_token: token, storage_path: path, sha256: sha, byte_size: bytes.length,
      committed_at: null, cleanup_attempts: cleanupAttempts, created_at: new Date(Date.now() - ageMs).toISOString(),
    }).select('id').single();
    if (error) throw new Error(`seed attempt: ${error.message}`);
    return { id: data.id, path };
  };

  await test('RPT-ORPH-01 reconciler removes a fresh orphan object + bumps cleanup (row kept < 24h)', async () => {
    const o = await seedOrphan(0, 0);
    expect(await objectExists(o.path), 'seed object should exist');
    const r = await api('finance/payroll/reports/purge/run', fmgrT, { limit: 50 });
    ok(r, `purge/run failed: ${r.body.message}`);
    expect(r.body.data.reconcile.removed >= 1, `reconcile.removed ${JSON.stringify(r.body.data.reconcile)}`);
    expect(!(await objectExists(o.path)), 'orphan object must be removed');
    const { data: row } = await sb.from('payroll_report_upload_attempts')
      .select('cleanup_attempts, committed_at').eq('id', o.id).maybeSingle();
    expect(row && row.committed_at === null && row.cleanup_attempts >= 1, 'row kept (quarantine) with cleanup bumped');
  });

  await test('RPT-ORPH-02 a COMMITTED artifact object is never removed by the reconciler', async () => {
    expect(ctx.csvPath, 'committed csv path known');
    expect(await objectExists(ctx.csvPath), 'committed object must survive reconcile');
  });

  await test('RPT-ORPH-03 concurrent reconcilers are safe (no crash, no error)', async () => {
    const [a, b] = await Promise.all([
      api('finance/payroll/reports/purge/run', fmgrT, { limit: 50 }),
      api('finance/payroll/reports/purge/run', fmgrT, { limit: 50 }),
    ]);
    ok(a, `concurrent purge A: ${a.body.message}`);
    ok(b, `concurrent purge B: ${b.body.message}`);
  });

  await test('RPT-ORPH-04 an AGED orphan (>24h, cleaned once) has its ledger row deleted', async () => {
    const o = await seedOrphan(25 * 3600 * 1000, 1);
    const r = await api('finance/payroll/reports/purge/run', fmgrT, { limit: 50 });
    ok(r, `purge/run failed: ${r.body.message}`);
    expect(r.body.data.reconcile.deleted >= 1, `reconcile.deleted ${JSON.stringify(r.body.data.reconcile)}`);
    const { data: row } = await sb.from('payroll_report_upload_attempts').select('id').eq('id', o.id).maybeSingle();
    expect(!row, 'aged orphan ledger row must be deleted');
    expect(!(await objectExists(o.path)), 'aged orphan object removed');
  });

  // ── Retention purge saga (§6B) ───────────────────────────────────────────────
  h.section('Reports Center > Retention purge');

  await test('RPT-PRG-01 a retention-expired artifact is purged: ONE purged event, object gone', async () => {
    // retention_expires_at is immutable after creation (append-only trigger), so seed
    // an ALREADY-expired artifact by direct INSERT (allowed) on its own job + object.
    const enq = await api('finance/payroll/reports/run', fmgrT, {
      params: { report: 'net_pay_summary', runId: ctx.currentId }, format: 'csv', idempotencyKey: `e2e-rpt-purge-${TAG.slice(-8)}`,
    });
    ok(enq, `purge enqueue failed: ${enq.body.message}`);
    const jobId = enq.body.data.jobId; ctx.jobIds.push(jobId);
    const token = randomUUID();
    const bytes = Buffer.from(`purge,${token}\n`, 'utf8');
    const sha = createHash('sha256').update(bytes).digest('hex');
    ctx.purgePath = `${jobId}/${token}/${sha}.csv`;
    const up = await sb.storage.from(BUCKET).upload(ctx.purgePath, bytes, { contentType: 'text/csv', upsert: false });
    expect(!up.error, `seed purge object: ${up.error?.message}`);
    const { data: art, error: insErr } = await sb.from('payroll_report_artifacts').insert({
      job_id: jobId, storage_path: ctx.purgePath, content_type: 'text/csv', byte_size: bytes.length, sha256: sha,
      scope: {}, scope_id: 'purge-e2e', row_count: 0, retention_class: 'standard',
      retention_expires_at: new Date(Date.now() - 3600_000).toISOString(),
      requires_view_all: false, requires_export: true, format: 'csv', created_by: ctx.fmgrId,
    }).select('id').single();
    expect(!insErr, `seed expired artifact: ${insErr?.message}`);
    ctx.purgeArtifactId = art.id;

    const r = await api('finance/payroll/reports/purge/run', fmgrT, { limit: 50 });
    ok(r, `purge/run failed: ${r.body.message}`);
    expect(r.body.data.purge.purged >= 1, `purge.purged ${JSON.stringify(r.body.data.purge)}`);
    const { data: row } = await sb.from('payroll_report_artifacts')
      .select('purge_state, purged_at, purge_token').eq('id', ctx.purgeArtifactId).maybeSingle();
    expect(row && row.purge_state === 'purged' && row.purged_at, 'artifact marked purged');
    ctx._purgeToken = row.purge_token;
    const { count: ev } = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.report.purged').eq('source_entity_id', ctx.purgeArtifactId);
    expect((ev ?? 0) === 1, 'exactly one purged event');
    expect(!(await objectExists(ctx.purgePath)), 'purged object removed from storage');
  });

  await test('RPT-PRG-02 same-token finalize replay → duplicate, still exactly one event', async () => {
    const { data, error } = await sb.rpc('finance_payroll_report_purge_finalize', {
      p_artifact_id: ctx.purgeArtifactId, p_purge_token: ctx._purgeToken,
    });
    expect(!error, `same-token finalize should not error: ${error?.message}`);
    expect(data && data.duplicate === true, 'replay returns duplicate:true');
    const { count: ev } = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.report.purged').eq('source_entity_id', ctx.purgeArtifactId);
    expect((ev ?? 0) === 1, 'still exactly one purged event after retry');
  });

  await test('RPT-PRG-03 a stale/different purge token is rejected even after purged', async () => {
    const fin = await sb.rpc('finance_payroll_report_purge_finalize', { p_artifact_id: ctx.purgeArtifactId, p_purge_token: randomUUID() });
    expect(fin.error, 'stale-token finalize must reject');
    const fail = await sb.rpc('finance_payroll_report_purge_fail', { p_artifact_id: ctx.purgeArtifactId, p_purge_token: randomUUID(), p_error: { code: 'x', message: 'y' } });
    expect(fail.error, 'stale-token purge_fail must reject');
  });

  await test('RPT-DL-05 download of a purged artifact → 410', async () => {
    const r = await api('finance/payroll/reports/artifacts/download', fmgrT, { artifactId: ctx.purgeArtifactId });
    expect(r.status === 410 && !r.body.success, `expected 410, got ${r.status}`);
  });

  await test('RPT-HIS-03 history reflects the purged artifact status', async () => {
    const r = await api('finance/payroll/reports/history/list', fmgrT, { limit: 25 });
    ok(r, `history failed: ${r.body.message}`);
    const row = r.body.data.rows.find(x => x.id === ctx.purgeArtifactId);
    expect(!row || row.status === 'purged', 'purged artifact shows purged status if listed');
  });

  // ── Review remediation: maintain gate, reap, append-only, P0 fence ──────────
  h.section('Reports Center > Hardening (review remediation)');

  await test('MAINT-01 an exporter WITHOUT reports.maintain cannot drive the workers (403)', async () => {
    // fmgr2 is a finance_manager → HAS reports.export via its role, but NOT maintain.
    const gen = await api('finance/payroll/reports/generation/run', fmgr2T, { limit: 1 });
    expect(gen.status === 403 && !gen.body.success, `generation/run should be 403 for a non-maintainer, got ${gen.status}`);
    const purge = await api('finance/payroll/reports/purge/run', fmgr2T, { limit: 1 });
    expect(purge.status === 403 && !purge.body.success, `purge/run should be 403 for a non-maintainer, got ${purge.status}`);
    // and a plain viewer is denied too.
    const v = await api('finance/payroll/reports/purge/run', viewOnlyT, { limit: 1 });
    expect(v.status === 403 && !v.body.success, `purge/run should be 403 for a viewer, got ${v.status}`);
  });

  await test('REAP-01 a stuck running job at max attempts is reaped to failed (one failed event)', async () => {
    const enq = await api('finance/payroll/reports/run', fmgrT, {
      params: { report: 'net_pay_summary', runId: ctx.currentId }, format: 'csv', idempotencyKey: `e2e-rpt-reap-${TAG.slice(-8)}`,
    });
    ok(enq, `reap enqueue failed: ${enq.body.message}`);
    const jobId = enq.body.data.jobId;
    ctx.jobIds.push(jobId);
    const { data: job } = await sb.from('payroll_report_jobs').select('max_attempts').eq('id', jobId).single();
    // Simulate a worker killed repeatedly: running, retry budget exhausted, lease dead.
    const { error: upErr } = await sb.from('payroll_report_jobs')
      .update({ state: 'running', attempts: job.max_attempts, claim_token: randomUUID(), lease_expires_at: new Date(Date.now() - 3600_000).toISOString() })
      .eq('id', jobId);
    expect(!upErr, `force-stuck failed: ${upErr?.message}`);
    const w = await api('finance/payroll/reports/generation/run', fmgrT, { limit: 5 });
    ok(w, `generation/run failed: ${w.body.message}`);
    const { data: after } = await sb.from('payroll_report_jobs').select('state, error').eq('id', jobId).single();
    expect(after.state === 'failed' && after.error?.code === 'max_attempts_exceeded', `expected reaped→failed, got ${JSON.stringify(after)}`);
    const { count: ev } = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.report.failed').eq('source_entity_id', jobId);
    expect((ev ?? 0) === 1, 'exactly one failed event for the reaped job');
  });

  await test('APPEND-01 evidence AND retention are immutable; only purge columns may change', async () => {
    const enq = await api('finance/payroll/reports/run', fmgrT, {
      params: { report: 'net_pay_summary', runId: ctx.currentId }, format: 'csv', idempotencyKey: `e2e-rpt-append-${TAG.slice(-8)}`,
    });
    ok(enq, `append enqueue failed: ${enq.body.message}`);
    const jobId = enq.body.data.jobId; ctx.jobIds.push(jobId);
    const w = await api('finance/payroll/reports/generation/run', fmgrT, { limit: 5 });
    ok(w, `generation/run failed: ${w.body.message}`);
    const { data: art } = await sb.from('payroll_report_artifacts').select('id, storage_path').eq('job_id', jobId).single();
    // Frozen evidence column → DB trigger rejects.
    const { error: shaErr } = await sb.from('payroll_report_artifacts').update({ sha256: 'tampered' }).eq('id', art.id);
    expect(shaErr, 'updating sha256 (frozen evidence) must be rejected by the append-only trigger');
    // retention_expires_at is now FROZEN too (retention is fixed at complete_tx).
    const { error: retErr } = await sb.from('payroll_report_artifacts')
      .update({ retention_expires_at: new Date(Date.now() + 86400_000).toISOString() }).eq('id', art.id);
    expect(retErr, 'updating retention_expires_at must be rejected by the append-only trigger');
    // A purge-saga column IS still updatable (that is how the purge worker operates).
    const { error: pErr } = await sb.from('payroll_report_artifacts')
      .update({ purge_error: { code: 'e2e', message: 'probe' } }).eq('id', art.id);
    expect(!pErr, `purge column should remain updatable, got ${pErr?.message}`);
  });

  await test('CSVINJ-01 a formula-leading text cell is neutralized in the CSV export', async () => {
    // empB is a hire named "=1+2" → population_movements CSV must emit it as "'=1+2".
    const enq = await api('finance/payroll/reports/run', fmgrT, {
      params: { report: 'population_movements', period: { from: M1, to: M2 } }, format: 'csv', idempotencyKey: `e2e-rpt-inj-${TAG.slice(-8)}`,
    });
    ok(enq, `inj enqueue failed: ${enq.body.message}`);
    const jobId = enq.body.data.jobId; ctx.jobIds.push(jobId);
    const w = await api('finance/payroll/reports/generation/run', fmgrT, { limit: 5 });
    ok(w, `generation/run failed: ${w.body.message}`);
    const { data: art } = await sb.from('payroll_report_artifacts').select('id').eq('job_id', jobId).single();
    const dl = await api('finance/payroll/reports/artifacts/download', fmgrT, { artifactId: art.id });
    ok(dl, `download failed: ${dl.body.message}`);
    const res = await fetch(dl.body.data.url);
    const csv = await res.text();
    expect(csv.includes("'=1+2"), 'the formula name must be prefixed with a quote (neutralized)');
    expect(!/(^|,)=1\+2/m.test(csv), 'no raw =1+2 may appear at a cell boundary');
  });

  await test('FENCE-01 an attempt reclaimed by the reconciler cannot be completed (P0)', async () => {
    // Enqueue → claim (real running token) → register a ledger attempt.
    const enq = await api('finance/payroll/reports/run', fmgrT, {
      params: { report: 'net_pay_summary', runId: ctx.currentId }, format: 'csv', idempotencyKey: `e2e-rpt-fence-${TAG.slice(-8)}`,
    });
    ok(enq, `fence enqueue failed: ${enq.body.message}`);
    const jobId = enq.body.data.jobId; ctx.jobIds.push(jobId);
    const { data: claimed } = await sb.rpc('finance_payroll_report_claim', { p_worker_id: 'e2e-fence', p_limit: 25, p_lease_seconds: 300 });
    const mine = (claimed ?? []).find(j => j.id === jobId);
    expect(mine && mine.claim_token, 'claim should return our job with a token');
    const token = mine.claim_token;
    const path = `${jobId}/${token}/fence.csv`;
    const reg = await sb.rpc('finance_payroll_report_register_upload_tx', { p_job_id: jobId, p_claim_token: token, p_storage_path: path, p_sha256: 'abc', p_byte_size: 1 });
    expect(!reg.error, `register attempt failed: ${reg.error?.message}`);
    // Expire the lease so the still-current-token attempt becomes reconcilable, then
    // the reconciler claims it (stamps last_cleanup_at).
    await sb.from('payroll_report_jobs').update({ lease_expires_at: new Date(Date.now() - 3600_000).toISOString() }).eq('id', jobId);
    const rc = await sb.rpc('finance_payroll_report_reconcile_claim', { p_worker_id: 'e2e-fence', p_limit: 50 });
    expect(!rc.error && (rc.data ?? []).some(a => a.storage_path === path), 'reconciler should claim the orphan attempt');
    // The fence: completing the same token now must be REJECTED (409), so no succeeded
    // artifact can point at an object the reconciler is removing.
    const comp = await sb.rpc('finance_payroll_report_complete_tx', {
      p_job_id: jobId, p_claim_token: token, p_storage_path: path, p_content_type: 'text/csv',
      p_byte_size: 1, p_sha256: 'abc', p_scope: {}, p_scope_id: 'v', p_row_count: 0, p_retention_class: 'standard', p_retention_days: 30,
    });
    expect(comp.error, 'complete_tx must reject a reconciler-claimed attempt (the P0 fence)');
    const { count: arts } = await sb.from('payroll_report_artifacts').select('id', { count: 'exact', head: true }).eq('job_id', jobId);
    expect((arts ?? 0) === 0, 'no artifact may exist for the fenced job');
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
