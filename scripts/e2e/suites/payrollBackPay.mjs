/**
 * scripts/e2e/suites/payrollBackPay.mjs
 * E2E for Payroll back pay / retro adjustment (Wave 7c).
 * Uses existing tables (finance_payroll_runs/lines/inputs) — no new migration.
 */
export const title = 'Payroll — Back pay (retro adjustment)';

function yearFromTag(tag) {
  let n = 11;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  return 2500 + (n % 400);   // high, unlikely-to-collide year (period_month is table-unique)
}

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const Y = yearFromTag(TAG);
  const P1 = `${Y}-01-01`, P2 = `${Y}-02-01`, P3 = `${Y}-03-01`;   // prior1, prior2, current

  let fmgrId, empId, otherEmpId, fmgrT, empT;
  const ctx = { versionId: null, runIds: [], currentRunId: null, createdUserIds: [] };

  h.onCleanup(async () => {
    try { if (ctx.runIds.length) await sb.from('finance_payroll_run_inputs').delete().in('run_id', ctx.runIds); } catch {}
    try { if (ctx.runIds.length) await sb.from('finance_payroll_run_lines').delete().in('run_id', ctx.runIds); } catch {}
    try { if (ctx.runIds.length) await sb.from('finance_payroll_runs').delete().in('id', ctx.runIds); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { if (ctx.currentRunId) await sb.from('app_events').delete().eq('source_module', 'finance_payroll').eq('source_entity_id', ctx.currentRunId); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  h.section('Back pay > Setup');

  await test('acquire actors + seed version, 2 prior LOCKED runs, and the current input-locked run', async () => {
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

    // Two PRIOR locked runs, employee paid base 5000 each.
    for (const period of [P1, P2]) {
      const { data: rn, error: rErr } = await sb.from('finance_payroll_runs').insert({
        run_no: `RUN-BP-${period}-${TAG.slice(-4)}`, period_month: period, pay_frequency: 'monthly',
        statutory_version_id: ctx.versionId, status: 'locked', employee_count: 1,
      }).select('id').single();
      expect(!rErr, `seed prior run failed: ${rErr?.message}`);
      ctx.runIds.push(rn.id);
      const { error: lErr } = await sb.from('finance_payroll_run_lines').insert({
        run_id: rn.id, employee_id: empId, base: 5000, taxable_gross: 5000, gross: 5000, paye: 0, nis_employee: 0, nis_employer: 0, health_surcharge: 0, net: 5000,
      });
      expect(!lErr, `seed prior run line failed: ${lErr?.message}`);
    }

    // Current run — input_locked, employee is a member via a base_pay input (corrected base 6000).
    const { data: cur, error: cErr } = await sb.from('finance_payroll_runs').insert({
      run_no: `RUN-BP-CUR-${TAG.slice(-4)}`, period_month: P3, pay_frequency: 'monthly',
      statutory_version_id: ctx.versionId, status: 'input_locked', employee_count: 1,
    }).select('id').single();
    expect(!cErr, `seed current run failed: ${cErr?.message}`);
    ctx.currentRunId = cur.id; ctx.runIds.push(cur.id);
    const { error: iErr } = await sb.from('finance_payroll_run_inputs').insert({
      run_id: cur.id, employee_id: empId, source_type: 'base_pay', source_id: null,
      component_code: 'base', label: 'Basic Pay', amount: 6000, metadata: {},
    });
    expect(!iErr, `seed base input failed: ${iErr?.message}`);
  });

  h.section('Back pay > Preview + add');

  await test('employee is DENIED back-pay/preview', async () => {
    fails(await api('finance/payroll/back-pay/preview', empT, { currentRunId: ctx.currentRunId, employeeId: empId, fromPeriodMonth: P1, correctedPeriodBase: 6000 }), 'employee denied preview');
  });

  await test('preview recomputes the delta from the two prior runs (2 × (6000−5000) = 2000)', async () => {
    const r = await api('finance/payroll/back-pay/preview', fmgrT, { currentRunId: ctx.currentRunId, employeeId: empId, fromPeriodMonth: P1, correctedPeriodBase: 6000 });
    ok(r, `preview failed: ${r.body.message}`);
    expect(r.body.data.periods.length === 2, `expected 2 periods, got ${r.body.data.periods.length}`);
    expect(Math.abs(r.body.data.totalDelta - 2000) < 0.01, `totalDelta ${r.body.data.totalDelta}`);
  });

  await test('a non-positive delta (corrected base ≤ paid) is refused', async () => {
    fails(await api('finance/payroll/back-pay/add', fmgrT, { currentRunId: ctx.currentRunId, employeeId: empId, fromPeriodMonth: P1, correctedPeriodBase: 5000, reason: 'no raise' }), 'zero delta should be refused');
  });

  await test('add records a taxable back_pay earning input of 2000 (+ audit/event)', async () => {
    const r = await api('finance/payroll/back-pay/add', fmgrT, { currentRunId: ctx.currentRunId, employeeId: empId, fromPeriodMonth: P1, correctedPeriodBase: 6000, reason: 'Retro raise effective Jan' });
    ok(r, `add failed: ${r.body.message}`);
    expect(Math.abs(r.body.data.breakdown.totalDelta - 2000) < 0.01, `add delta ${r.body.data.breakdown.totalDelta}`);
    const { data: input } = await sb.from('finance_payroll_run_inputs').select('amount, metadata, component_code')
      .eq('run_id', ctx.currentRunId).eq('employee_id', empId).eq('component_code', 'back_pay').maybeSingle();
    expect(input, 'back_pay input row not found');
    expect(Math.abs(input.amount - 2000) < 0.01, `input amount ${input?.amount}`);
    expect(input.metadata?.back_pay === true && input.metadata?.kind === 'earning' && input.metadata?.is_taxable === true, 'back_pay metadata wrong');
    const { data: audit } = await sb.from('hr_audit_log').select('id').eq('submodule_key', 'finance_payroll').eq('action', 'payroll_run.back_pay_added').eq('record_id', ctx.currentRunId).limit(1);
    expect((audit ?? []).length > 0, 'back_pay_added audit not found');
  });

  await test('recalculate folds the back pay into taxable gross (6000 base + 2000 back pay = 8000)', async () => {
    const r = await api('finance/payroll/runs/calculate', fmgrT, { id: ctx.currentRunId });
    ok(r, `calculate failed: ${r.body.message}`);
    const { data: line } = await sb.from('finance_payroll_run_lines').select('gross').eq('run_id', ctx.currentRunId).eq('employee_id', empId).maybeSingle();
    expect(line, 'no run line after calculate');
    expect(Math.abs(line.gross - 8000) < 0.01, `expected gross 8000, got ${line?.gross}`);
  });

  await test('back pay for an employee NOT on the run is refused', async () => {
    fails(await api('finance/payroll/back-pay/add', fmgrT, { currentRunId: ctx.currentRunId, employeeId: otherEmpId, fromPeriodMonth: P1, correctedPeriodBase: 6000, reason: 'x' }), 'non-member should be refused');
  });
}
