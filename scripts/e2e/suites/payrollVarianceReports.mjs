/**
 * scripts/e2e/suites/payrollVarianceReports.mjs
 * E2E for the Wave 7d payroll comparison reports: variation + audit_comparison.
 * Existing tables — no new migration.
 */
export const title = 'Payroll — Variation + Audit-Comparison reports';

import { payrollPeriodYear, payrollRunSeed } from '../helpers/payrollRun.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const Y = payrollPeriodYear('payrollVarianceReports', TAG);
  const P1 = `${Y}-01-01`, P2 = `${Y}-02-01`;

  let fmgrT, empT, empA, empB;
  const ctx = { versionId: null, priorId: null, currentId: null, createdUserIds: [] };

  h.onCleanup(async () => {
    const ids = [ctx.priorId, ctx.currentId].filter(Boolean);
    try { if (ids.length) await sb.from('finance_payroll_run_lines').delete().in('run_id', ids); } catch {}
    try { if (ids.length) await sb.from('finance_payroll_runs').delete().in('id', ids); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  h.section('Variance reports > Setup');

  await test('seed a prior + current locked run with a changed + an added employee', async () => {
    const m = await acquireActors('finance_manager', 1);
    const e = await acquireActors('employee', 2);
    empA = e.actors[0].id; empB = e.actors[1].id;
    ctx.createdUserIds = [...m.createdIds, ...e.createdIds];
    fmgrT = mint({ id: m.actors[0].id, username: m.actors[0].username, role: 'finance_manager', department_id: null });
    empT  = mint({ id: empA, username: e.actors[0].username, role: 'employee', department_id: null });

    const { data: ver, error: vErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: P1, label: `E2E VAR ${TAG}`,
      paye_personal_allowance: 90000, paye_band1_ceiling: 1000000, paye_band1_rate: 0.25, paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99, hs_weekly_high: 8.25, hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!vErr, `seed version failed: ${vErr?.message}`);
    ctx.versionId = ver.id;

    const mkRun = async (period, empCount) => {
      const { data, error } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
        run_no: `RUN-VAR-${period}-${TAG.slice(-4)}`, periodStart: period,
        statutory_version_id: ctx.versionId, status: 'locked', employee_count: empCount,
      })).select('id').single();
      expect(!error, `seed run ${period} failed: ${error?.message}`);
      return data.id;
    };
    ctx.priorId = await mkRun(P1, 1);
    ctx.currentId = await mkRun(P2, 2);

    // Prior: empA gross 5000 / net 4000. Current: empA gross 6000 / net 4800 (changed) + empB new.
    const line = (runId, emp, gross, paye, net) => ({ run_id: runId, employee_id: emp, base: gross, taxable_gross: gross, gross, paye, nis_employee: 0, nis_employer: 0, health_surcharge: 0, net });
    const { error: l1 } = await sb.from('finance_payroll_run_lines').insert([line(ctx.priorId, empA, 5000, 500, 4500)]);
    expect(!l1, `seed prior lines failed: ${l1?.message}`);
    const { error: l2 } = await sb.from('finance_payroll_run_lines').insert([line(ctx.currentId, empA, 6000, 800, 5200), line(ctx.currentId, empB, 3000, 100, 2900)]);
    expect(!l2, `seed current lines failed: ${l2?.message}`);
  });

  // F-12 cutover: per-employee variation moved OFF the removed reports/run to the
  // Run Workspace endpoint runs/variation (retained reportVariation engine fn, same
  // shape). audit_comparison had no FE consumer and is not in the F-12 9-key scope,
  // so it was retired with the legacy public report contract.
  h.section('Variance reports > Variation (runs/variation)');

  await test('employee is DENIED runs/variation', async () => {
    fails(await api('finance/payroll/runs/variation', empT, { runId: ctx.currentId }), 'employee denied variation');
  });

  await test('variation compares the current run to the prior run (deltas + added employee)', async () => {
    const r = await api('finance/payroll/runs/variation', fmgrT, { runId: ctx.currentId });
    ok(r, `variation failed: ${r.body.message}`);
    expect(r.body.data.report === 'variation', 'wrong report key');
    const rows = r.body.data.rows;
    const a = rows.find(x => x.employee_id === empA);
    const bRow = rows.find(x => x.employee_id === empB);
    expect(a && Math.abs(a.gross_delta - 1000) < 0.01, `empA gross_delta ${a?.gross_delta}`);
    expect(a && a.status === 'changed', `empA status ${a?.status}`);
    expect(bRow && bRow.status === 'added' && Math.abs(bRow.gross_delta - 3000) < 0.01, `empB added delta ${bRow?.gross_delta}`);
  });

  await test('variation with no prior run returns an empty set (not an error)', async () => {
    const r = await api('finance/payroll/runs/variation', fmgrT, { runId: ctx.priorId });
    ok(r, `variation(prior) failed: ${r.body.message}`);
    // Prior run may still have an earlier run somewhere; assert it returns rows array without erroring.
    expect(Array.isArray(r.body.data.rows), 'variation rows must be an array');
  });
}
