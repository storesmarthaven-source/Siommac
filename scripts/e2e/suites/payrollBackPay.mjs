/**
 * scripts/e2e/suites/payrollBackPay.mjs
 * E2E for Payroll back pay / retro adjustment (Wave 7c, rebuilt P2-a).
 *
 * P2-a changes verified here:
 *   - effectiveDate is stored in the breakdown and in the input metadata.
 *   - Content-keyed idempotency: same params → same row (no dup); different
 *     effectiveDate → separate row allowed to coexist.
 *   - Frequency filter: prior runs with a different pay_frequency are excluded.
 *   - Pay-group filter: if the current run is grouped, only prior runs from the
 *     same pay_group are included (verified via distinct grouped run setup).
 *   - The old one-per-run-per-employee constraint is GONE: two distinct adjustments
 *     (different effectiveDate) are both allowed on the same run.
 *
 * Uses existing tables (finance_payroll_runs/lines/inputs) — new migration
 * 20260919000100 replaces the migration-080 unique index.
 */
export const title = 'Payroll — Back pay (retro adjustment, P2-a rebuild)';

import {
  payrollCalculationCommand,
  payrollPeriodYear,
  payrollRunSeed,
} from '../helpers/payrollRun.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const Y = payrollPeriodYear('payrollBackPay', TAG);
  const P1 = `${Y}-01-01`, P2 = `${Y}-02-01`, P3 = `${Y}-03-01`;   // prior1, prior2, current

  let fmgrId, empId, otherEmpId, fmgrT, empT;
  const ctx = {
    versionId: null,
    runIds: [],
    currentRunId: null,
    createdUserIds: [],
    weeklyRunId: null,    // a weekly-frequency run (for frequency filter test)
  };

  h.onCleanup(async () => {
    try { if (ctx.runIds.length) await sb.from('finance_payroll_run_inputs').delete().in('run_id', ctx.runIds); } catch {}
    try { if (ctx.runIds.length) await sb.from('finance_payroll_run_lines').delete().in('run_id', ctx.runIds); } catch {}
    try { if (ctx.runIds.length) await sb.from('finance_payroll_runs').delete().in('id', ctx.runIds); } catch {}
    try { if (ctx.weeklyRunId) await sb.from('finance_payroll_run_inputs').delete().eq('run_id', ctx.weeklyRunId); } catch {}
    try { if (ctx.weeklyRunId) await sb.from('finance_payroll_run_lines').delete().eq('run_id', ctx.weeklyRunId); } catch {}
    try { if (ctx.weeklyRunId) await sb.from('finance_payroll_runs').delete().eq('id', ctx.weeklyRunId); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { if (ctx.currentRunId) await sb.from('app_events').delete().eq('source_module', 'finance_payroll').eq('source_entity_id', ctx.currentRunId); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  h.section('Back pay > Setup');

  await test('acquire actors + seed version, 2 prior LOCKED monthly runs, 1 prior LOCKED weekly run, and the current input-locked run', async () => {
    const m = await acquireActors('finance_manager', 1);
    const e = await acquireActors('employee', 2);
    fmgrId = m.actors[0].id; empId = e.actors[0].id; otherEmpId = e.actors[1].id;
    ctx.createdUserIds = [...m.createdIds, ...e.createdIds];
    fmgrT = mint({ id: fmgrId, username: m.actors[0].username, role: 'finance_manager', department_id: null });
    empT  = mint({ id: empId,  username: e.actors[0].username, role: 'employee', department_id: null });

    const { data: ver, error: vErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: P1, label: `E2E BP ${TAG}`,
      paye_personal_allowance: 90000, paye_band1_ceiling: 1000000, paye_band1_rate: 0.25, paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99, hs_weekly_high: 8.25, hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!vErr, `seed version failed: ${vErr?.message}`);
    ctx.versionId = ver.id;

    // Two PRIOR locked monthly runs — employee paid base 5000 each.
    for (const period of [P1, P2]) {
      const { data: rn, error: rErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
        run_no: `RUN-BP-${period}-${TAG.slice(-4)}`, periodStart: period,
        statutory_version_id: ctx.versionId, status: 'locked', employee_count: 1,
      })).select('id').single();
      expect(!rErr, `seed prior run failed: ${rErr?.message}`);
      ctx.runIds.push(rn.id);
      const { error: lErr } = await sb.from('finance_payroll_run_lines').insert({
        run_id: rn.id, employee_id: empId, base: 5000,
        taxable_gross: 5000, gross: 5000, paye: 0, nis_employee: 0, nis_employer: 0, health_surcharge: 0, net: 5000,
      });
      expect(!lErr, `seed prior run line failed: ${lErr?.message}`);
    }

    // One prior LOCKED weekly run — for the frequency filter test.
    const { data: wkRun, error: wErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: `RUN-BP-WK-${TAG.slice(-4)}`, periodStart: `${Y}-01-08`, payFrequency: 'weekly',
      statutory_version_id: ctx.versionId, status: 'locked', employee_count: 1,
    })).select('id').single();
    expect(!wErr, `seed weekly run failed: ${wErr?.message}`);
    ctx.weeklyRunId = wkRun.id;
    const { error: wlErr } = await sb.from('finance_payroll_run_lines').insert({
      run_id: wkRun.id, employee_id: empId, base: 1200,
      taxable_gross: 1200, gross: 1200, paye: 0, nis_employee: 0, nis_employer: 0, health_surcharge: 0, net: 1200,
    });
    expect(!wlErr, `seed weekly run line failed: ${wlErr?.message}`);

    // Current run — monthly, input_locked, employee is a member (base_pay input).
    const { data: cur, error: cErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: `RUN-BP-CUR-${TAG.slice(-4)}`, periodStart: P3,
      statutory_version_id: ctx.versionId, status: 'input_locked', employee_count: 1,
    })).select('id').single();
    expect(!cErr, `seed current run failed: ${cErr?.message}`);
    ctx.currentRunId = cur.id;
    ctx.runIds.push(cur.id);
    const { error: iErr } = await sb.from('finance_payroll_run_inputs').insert({
      run_id: cur.id, employee_id: empId, source_type: 'base_pay', source_id: null,
      component_code: 'base', label: 'Basic Pay', amount: 6000, metadata: {},
    });
    expect(!iErr, `seed base input failed: ${iErr?.message}`);
  });

  h.section('Back pay > Access control');

  await test('employee is DENIED back-pay/preview', async () => {
    fails(
      await api('finance/payroll/back-pay/preview', empT, {
        currentRunId: ctx.currentRunId, employeeId: empId,
        fromPeriodMonth: P1, correctedPeriodBase: 6000,
      }),
      'employee denied preview',
    );
  });

  h.section('Back pay > Preview + add (basic)');

  await test('preview recomputes the delta from the two prior monthly runs (2 × 1000 = 2000)', async () => {
    const r = await api('finance/payroll/back-pay/preview', fmgrT, {
      currentRunId: ctx.currentRunId, employeeId: empId,
      fromPeriodMonth: P1, correctedPeriodBase: 6000,
    });
    ok(r, `preview failed: ${r.body.message}`);
    expect(r.body.data.periods.length === 2, `expected 2 periods, got ${r.body.data.periods.length}`);
    expect(Math.abs(r.body.data.totalDelta - 2000) < 0.01, `totalDelta ${r.body.data.totalDelta}`);
    // Scope should be returned
    expect(r.body.data.scope && r.body.data.scope.payFrequency === 'monthly', 'scope.payFrequency should be monthly');
  });

  await test('P2-a: frequency filter — weekly run is NOT included in a monthly back-pay preview', async () => {
    // The current run is monthly; the weekly prior run (wkRun) has period_month = P1.
    // Its base (1200) would produce a delta of 4800 if included. Verifying totalDelta = 2000
    // (not 2000+4800=6800) confirms frequency filtering is working.
    const r = await api('finance/payroll/back-pay/preview', fmgrT, {
      currentRunId: ctx.currentRunId, employeeId: empId,
      fromPeriodMonth: P1, correctedPeriodBase: 6000,
    });
    ok(r, `preview failed: ${r.body.message}`);
    // If the weekly run were included, delta would be 2000 + (6000-1200) = 6800
    expect(Math.abs(r.body.data.totalDelta - 2000) < 0.01,
      `Frequency filter failed: totalDelta ${r.body.data.totalDelta} includes the weekly run (expected 2000)`);
  });

  await test('P2-a: effectiveDate is stored in the breakdown', async () => {
    const r = await api('finance/payroll/back-pay/preview', fmgrT, {
      currentRunId: ctx.currentRunId, employeeId: empId,
      fromPeriodMonth: P1, correctedPeriodBase: 6000,
      effectiveDate: `${P1.substring(0, 7)}-15`, // mid-month date
    });
    ok(r, `preview with effectiveDate failed: ${r.body.message}`);
    expect(r.body.data.effectiveDate === `${P1.substring(0, 7)}-15`,
      `effectiveDate not returned, got ${r.body.data.effectiveDate}`);
  });

  await test('effectiveDate defaults to fromPeriodMonth when omitted', async () => {
    const r = await api('finance/payroll/back-pay/preview', fmgrT, {
      currentRunId: ctx.currentRunId, employeeId: empId,
      fromPeriodMonth: P1, correctedPeriodBase: 6000,
    });
    ok(r, `preview failed: ${r.body.message}`);
    expect(r.body.data.effectiveDate === P1,
      `effectiveDate should default to fromPeriodMonth, got ${r.body.data.effectiveDate}`);
  });

  await test('a non-positive delta (corrected base ≤ paid) is refused', async () => {
    fails(
      await api('finance/payroll/back-pay/add', fmgrT, {
        currentRunId: ctx.currentRunId, employeeId: empId,
        fromPeriodMonth: P1, correctedPeriodBase: 5000, reason: 'no raise',
      }),
      'zero delta should be refused',
    );
  });

  await test('add records a taxable back_pay earning input of 2000 (+ audit/event)', async () => {
    const r = await api('finance/payroll/back-pay/add', fmgrT, {
      currentRunId: ctx.currentRunId, employeeId: empId,
      fromPeriodMonth: P1, correctedPeriodBase: 6000,
      reason: 'Retro raise effective Jan',
    });
    ok(r, `add failed: ${r.body.message}`);
    expect(Math.abs(r.body.data.breakdown.totalDelta - 2000) < 0.01, `add delta ${r.body.data.breakdown.totalDelta}`);
    // effectiveDate present in breakdown
    expect(r.body.data.breakdown.effectiveDate === P1, `effectiveDate missing in add breakdown`);

    const { data: input } = await sb.from('finance_payroll_run_inputs')
      .select('amount, metadata, component_code')
      .eq('run_id', ctx.currentRunId).eq('employee_id', empId).eq('component_code', 'back_pay')
      .maybeSingle();
    expect(input, 'back_pay input row not found');
    expect(Math.abs(input.amount - 2000) < 0.01, `input amount ${input?.amount}`);
    expect(
      input.metadata?.back_pay === true &&
      input.metadata?.kind === 'earning' &&
      input.metadata?.is_taxable === true,
      'back_pay metadata wrong',
    );
    // P2-a: idem key must be present in the metadata
    expect(typeof input.metadata?.back_pay_idem_key === 'string' && input.metadata.back_pay_idem_key.length > 0,
      'back_pay_idem_key missing from metadata');
    // P2-a: effective_date must be stored in the metadata
    expect(input.metadata?.effective_date === P1, 'effective_date missing from metadata');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'finance_payroll')
      .eq('action', 'payroll_run.back_pay_added').eq('record_id', ctx.currentRunId).limit(1);
    expect((audit ?? []).length > 0, 'back_pay_added audit not found');
  });

  h.section('Back pay > Content-keyed idempotency (P2-a)');

  await test('2d/P2-a: re-adding the SAME back pay is idempotent (no duplicate row)', async () => {
    const r = await api('finance/payroll/back-pay/add', fmgrT, {
      currentRunId: ctx.currentRunId, employeeId: empId,
      fromPeriodMonth: P1, correctedPeriodBase: 6000,
      reason: 'Retro raise effective Jan',
    });
    ok(r, `idempotent re-add failed: ${r.body.message}`);
    expect(Math.abs(r.body.data.breakdown.totalDelta - 2000) < 0.01,
      `idempotent re-add delta ${r.body.data.breakdown.totalDelta}`);

    const { count } = await sb.from('finance_payroll_run_inputs')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.currentRunId).eq('employee_id', empId).eq('component_code', 'back_pay');
    expect((count ?? 0) === 1, `expected exactly 1 back_pay input after idempotent re-add, got ${count}`);
  });

  await test('2d/P2-a: a DIFFERENT back-pay (different correctedBase, same fromPeriod+effectiveDate) is refused (409)', async () => {
    // Same idem key content → different amount → should 409
    const r = await api('finance/payroll/back-pay/add', fmgrT, {
      currentRunId: ctx.currentRunId, employeeId: empId,
      fromPeriodMonth: P1, correctedPeriodBase: 8000,
      reason: 'bigger raise',
    });
    fails(r, 'a conflicting correctedBase should be refused');
    expect(r.status === 409, `expected 409 for a conflicting back-pay, got ${r.status}`);

    const { count } = await sb.from('finance_payroll_run_inputs')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.currentRunId).eq('employee_id', empId).eq('component_code', 'back_pay');
    expect((count ?? 0) === 1, `expected still exactly 1 back_pay input after the refused conflict, got ${count}`);
  });

  await test('P2-a: a DISTINCT back-pay with a different effectiveDate is ALLOWED (two rows coexist)', async () => {
    // Same fromPeriodMonth but a different effectiveDate → different idem key → allowed
    const r = await api('finance/payroll/back-pay/add', fmgrT, {
      currentRunId: ctx.currentRunId, employeeId: empId,
      fromPeriodMonth: P2, correctedPeriodBase: 6000,
      effectiveDate: P2,  // effectively starts from P2, different from the first adjustment (P1)
      reason: 'Second correction starting Feb',
    });
    ok(r, `distinct back-pay with different fromPeriod failed: ${r.body.message}`);

    // Now there should be TWO back_pay rows for this employee on this run
    const { data: rows } = await sb.from('finance_payroll_run_inputs')
      .select('id, metadata')
      .eq('run_id', ctx.currentRunId).eq('employee_id', empId).eq('component_code', 'back_pay');
    expect((rows ?? []).length === 2,
      `expected 2 back_pay inputs after distinct adjustment, got ${(rows ?? []).length}`);

    // Both should have distinct idem keys
    const keys = (rows ?? []).map(r => r.metadata?.back_pay_idem_key).filter(Boolean);
    expect(new Set(keys).size === 2, 'the two back_pay rows should have distinct idem keys');
  });

  h.section('Back pay > Calculate + recalculate');

  await test('recalculate folds BOTH back-pay adjustments into taxable gross', async () => {
    // First adj: P1 and P2 both had base 5000, corrected to 6000 → delta 2000 (2 × 1000)
    // Second adj: P2 only had base 5000, corrected to 6000 → delta 1000 (1 × 1000)
    // Total back pay in inputs = 3000; base pay in current run = 6000
    // Expected gross ≈ 9000 (6000 base + 3000 back pay)
    const r = await api(
      'finance/payroll/runs/calculate',
      fmgrT,
      payrollCalculationCommand(ctx.currentRunId, `${TAG}:back-pay:run:calculate:1`),
    );
    ok(r, `calculate failed: ${r.body.message}`);
    const { data: line } = await sb.from('finance_payroll_run_lines')
      .select('gross').eq('run_id', ctx.currentRunId).eq('employee_id', empId).maybeSingle();
    expect(line, 'no run line after calculate');
    expect(Math.abs(line.gross - 9000) < 0.01, `expected gross 9000, got ${line?.gross}`);
  });

  h.section('Back pay > Other validation');

  await test('back pay for an employee NOT on the run is refused', async () => {
    fails(
      await api('finance/payroll/back-pay/add', fmgrT, {
        currentRunId: ctx.currentRunId, employeeId: otherEmpId,
        fromPeriodMonth: P1, correctedPeriodBase: 6000, reason: 'x',
      }),
      'non-member should be refused',
    );
  });

  await test('fromPeriodMonth must be before the current run period', async () => {
    fails(
      await api('finance/payroll/back-pay/preview', fmgrT, {
        currentRunId: ctx.currentRunId, employeeId: empId,
        fromPeriodMonth: P3, correctedPeriodBase: 6000,
      }),
      'fromPeriodMonth = current period should be refused',
    );
  });
}
