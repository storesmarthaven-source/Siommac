/**
 * scripts/e2e/suites/payrollOverrides.mjs
 *
 * E2E for Wave 4a — worksheet overrides + recalculation.
 *
 * Routes under test:
 *   /api/finance/payroll/overrides/{add, remove, list}
 *   /api/finance/payroll/runs/calculate (recalc)
 *
 * Covers:
 *   - Access control: a plain employee cannot add an override (403).
 *   - Add rejects an employee not in the run (422).
 *   - Add an earning override → recalculate → the line's gross reflects it.
 *   - Remove the override → recalculate → gross returns to baseline.
 *   - Overrides are preserved as separate input rows (source_type='override').
 *   - Cleanup via h.TAG.
 *
 * Fixture: seeded 'input_locked' run with a base_pay input for one employee, so
 * calculate produces a line and the override employee is "part of the run".
 * Requires an active TT statutory version (real seed) for calculate.
 */

export const title = 'Finance Wave 4 - Worksheet overrides';

function seedDateFromTag(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const day = (n % 1000) + salt * 1000;
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  const emp1Id  = 'OVR-EMP1-' + TAG;   // in the run
  const emp2Id  = 'OVR-EMP2-' + TAG;   // NOT in the run
  const fmgrId  = 'OVR-FMGR-' + TAG;
  const plainId = 'OVR-EE-'   + TAG;

  const ctx = { versionId: null, runId: null, overrideId: null };
  let fmgrToken, plainToken;

  h.onCleanup(async () => {
    try { if (ctx.runId) await sb.from('finance_payroll_run_inputs').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_lines').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_warnings').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_payroll').eq('source_entity_id', ctx.runId); } catch {}
    try { await sb.from('app_users').delete().in('id', [emp1Id, emp2Id, fmgrId, plainId]); } catch {}
  });

  // ===========================================================================
  h.section('Worksheet overrides - Setup');
  // ===========================================================================

  await test('provision users + input_locked run with a base_pay input for emp1', async () => {
    const users = [
      { id: fmgrId,  username: TAG + '_ofm', full_name: 'OVR Fmgr (E2E)',  role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: plainId, username: TAG + '_oee', full_name: 'OVR Plain (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: emp1Id,  username: TAG + '_ov1', full_name: 'OVR Emp1 (E2E)',  role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 5000 },
      { id: emp2Id,  username: TAG + '_ov2', full_name: 'OVR Emp2 (E2E)',  role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 4000 },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, 'seed users failed: ' + error?.message);
    fmgrToken  = mint({ id: fmgrId,  username: TAG + '_ofm', role: 'finance_manager', department_id: null });
    plainToken = mint({ id: plainId, username: TAG + '_oee', role: 'employee',        department_id: null });

    const { data: ver, error: verErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: seedDateFromTag(TAG, 11),
      label: 'E2E OVR Version ' + TAG,
      paye_personal_allowance: 90000, paye_band1_ceiling: 1000000,
      paye_band1_rate: 0.25, paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99, hs_weekly_high: 8.25, hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!verErr, 'seed version failed: ' + verErr?.message);
    ctx.versionId = ver.id;

    const { data: rn, error: rnErr } = await sb.from('finance_payroll_runs').insert({
      run_no: 'RUN-OVR-' + TAG.slice(-6), period_month: seedDateFromTag(TAG, 44),
      statutory_version_id: ctx.versionId, status: 'input_locked',
      pay_frequency: 'monthly', weeks_in_period: 4.333, employee_count: 1,
    }).select('id').single();
    expect(!rnErr, 'seed run failed: ' + rnErr?.message);
    ctx.runId = rn.id;

    const { error: inErr } = await sb.from('finance_payroll_run_inputs').insert({
      run_id: ctx.runId, employee_id: emp1Id, source_type: 'base_pay', source_id: emp1Id,
      component_code: 'basic', label: 'Monthly Salary', amount: 5000, metadata: { pay_basis: 'salary' },
    });
    expect(!inErr, 'seed input failed: ' + inErr?.message);
  });

  await test('baseline calculate → emp1 line gross = 5000', async () => {
    const r = await api('finance/payroll/runs/calculate', fmgrToken, { id: ctx.runId });
    ok(r, 'calculate failed');
    const { data: lines } = await sb.from('finance_payroll_run_lines').select('gross').eq('run_id', ctx.runId).eq('employee_id', emp1Id);
    expect(Math.abs(Number((lines ?? [])[0]?.gross) - 5000) < 0.01, 'baseline gross must be 5000, got ' + (lines ?? [])[0]?.gross);
  });

  // ===========================================================================
  h.section('Worksheet overrides - Add / access control / validation');
  // ===========================================================================

  await test('plain employee CANNOT add an override (403)', async () => {
    const r = await api('finance/payroll/overrides/add', plainToken, { runId: ctx.runId, employeeId: emp1Id, label: 'X', amount: 100, kind: 'earning', reason: 'nope' });
    fails(r, 'employee must not add overrides');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('add for an employee NOT in the run is rejected (422)', async () => {
    const r = await api('finance/payroll/overrides/add', fmgrToken, { runId: ctx.runId, employeeId: emp2Id, label: 'Bonus', amount: 100, kind: 'earning', reason: 'not in run' });
    fails(r, 'override for non-participant must fail');
    expect(r.status === 422, 'expected 422, got ' + r.status);
  });

  await test('finance_manager adds a +1000 earning override for emp1', async () => {
    const r = await api('finance/payroll/overrides/add', fmgrToken, { runId: ctx.runId, employeeId: emp1Id, label: 'Retro adjustment', amount: 1000, kind: 'earning', reason: 'Backdated increase' });
    ok(r, 'add override failed');
    expect(r.body.data.kind === 'earning' && r.body.data.amount === 1000, 'override shape mismatch');
    ctx.overrideId = r.body.data.id;
  });

  await test('overrides/list shows the override (stored as a separate input row)', async () => {
    const r = await api('finance/payroll/overrides/list', fmgrToken, { runId: ctx.runId });
    ok(r, 'list failed');
    expect(r.body.data.length === 1, 'expected 1 override, got ' + r.body.data.length);
    const { data: inputs } = await sb.from('finance_payroll_run_inputs').select('id').eq('run_id', ctx.runId).contains('metadata', { override: true });
    expect((inputs ?? []).length === 1, 'expected 1 override input row');
    // The original base_pay snapshot is preserved.
    const { data: base } = await sb.from('finance_payroll_run_inputs').select('id').eq('run_id', ctx.runId).eq('source_type', 'base_pay');
    expect((base ?? []).length === 1, 'base_pay snapshot must be preserved');
  });

  // ===========================================================================
  h.section('Worksheet overrides - Recalculation');
  // ===========================================================================

  await test('recalculate → emp1 line gross rises to 6000 (override applied)', async () => {
    const r = await api('finance/payroll/runs/calculate', fmgrToken, { id: ctx.runId });
    ok(r, 'recalculate failed');
    const { data: lines } = await sb.from('finance_payroll_run_lines').select('gross, taxable_gross').eq('run_id', ctx.runId).eq('employee_id', emp1Id);
    expect(Math.abs(Number((lines ?? [])[0]?.gross) - 6000) < 0.01, 'gross must be 6000 after +1000 earning override, got ' + (lines ?? [])[0]?.gross);
  });

  await test('remove override → recalculate → gross back to 5000', async () => {
    const rm = await api('finance/payroll/overrides/remove', fmgrToken, { overrideId: ctx.overrideId });
    ok(rm, 'remove failed');
    const rc = await api('finance/payroll/runs/calculate', fmgrToken, { id: ctx.runId });
    ok(rc, 'recalc after remove failed');
    const { data: lines } = await sb.from('finance_payroll_run_lines').select('gross').eq('run_id', ctx.runId).eq('employee_id', emp1Id);
    expect(Math.abs(Number((lines ?? [])[0]?.gross) - 5000) < 0.01, 'gross must return to 5000 after removal, got ' + (lines ?? [])[0]?.gross);
  });
}
