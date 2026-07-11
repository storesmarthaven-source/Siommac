/**
 * scripts/e2e/suites/payrollScale.mjs
 * E2E for Wave 8 scale: a ~1100-employee run crosses PostgREST's 1000-row cap,
 * proving the batch/paginate/chunk refactor of lock-inputs + calculate (no
 * truncation, no N+1 profile query). Existing tables — no new migration.
 */
export const title = 'Payroll — Scale (1000+ employee run)';

const N = 1100;   // > 1000: forces a 2nd page on inputs + chunked IN/insert paths

function yearFromTag(tag) {
  let n = 17;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  return 2200 + (n % 300);
}

export default async function run(h) {
  const { api, test, expect, ok, mint, sb, TAG, acquireActors } = h;
  const Y = yearFromTag(TAG);
  const PERIOD = `${Y}-06-01`;
  const empPrefix = `SCL-${TAG.slice(-8)}-`;

  let fmgrT;
  const ctx = { versionId: null, groupId: null, runId: null, createdUserIds: [], empIds: [] };

  const chunk = (arr, size) => { const o = []; for (let i = 0; i < arr.length; i += size) o.push(arr.slice(i, i + size)); return o; };

  h.onCleanup(async () => {
    try { if (ctx.runId) await sb.from('finance_payroll_run_lines').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_inputs').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_warnings').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
    try { if (ctx.groupId) await sb.from('finance_employee_pay_group_assignments').delete().eq('pay_group_id', ctx.groupId); } catch {}
    try { if (ctx.groupId) await sb.from('finance_pay_groups').delete().eq('id', ctx.groupId); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    // Chunked delete — a single .like() delete of ~1100 rows hits the statement
    // timeout and would LEAK the seeded employees.
    try {
      for (let round = 0; round < 20; round++) {
        const { data } = await sb.from('app_users').select('id').like('id', `${empPrefix}%`).limit(300);
        const ids = (data ?? []).map(r => r.id);
        if (ids.length === 0) break;
        await sb.from('finance_employee_pay_group_assignments').delete().in('employee_id', ids);
        await sb.from('finance_payroll_run_inputs').delete().in('employee_id', ids);
        await sb.from('finance_payroll_run_lines').delete().in('employee_id', ids);
        await sb.from('app_users').delete().in('id', ids);
      }
    } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  h.section('Scale > Seed a 1100-employee pay group');

  await test(`seed ${N} active salaried employees (chunked)`, async () => {
    const m = await acquireActors('finance_manager', 1);
    ctx.createdUserIds = m.createdIds;
    fmgrT = mint({ id: m.actors[0].id, username: m.actors[0].username, role: 'finance_manager', department_id: null });

    ctx.empIds = Array.from({ length: N }, (_, i) => `${empPrefix}${i}`);
    const rows = ctx.empIds.map((id, i) => ({
      id, username: `scl_${TAG.slice(-6)}_${i}`, full_name: `Scale Emp ${i}`,
      role: 'employee', status: 'active', employment_type: 'employee',
      pay_basis: 'salary', monthly_salary: 5000,
    }));
    for (const batch of chunk(rows, 500)) {
      const { error } = await sb.from('app_users').insert(batch);
      expect(!error, `seed employees failed: ${error?.message}`);
    }
    const { count } = await sb.from('app_users').select('id', { count: 'exact', head: true }).like('id', `${empPrefix}%`);
    expect(count === N, `expected ${N} seeded employees, got ${count}`);
  });

  await test('seed statutory version + pay group + assign all members (chunked)', async () => {
    const { data: ver, error: vErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: `${Y}-01-01`, label: `E2E Scale ${TAG}`,
      paye_personal_allowance: 90000, paye_band1_ceiling: 1000000, paye_band1_rate: 0.25, paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99, hs_weekly_high: 8.25, hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!vErr, `seed version failed: ${vErr?.message}`);
    ctx.versionId = ver.id;

    const code = ('SCL' + TAG.replace(/[^a-z0-9]/gi, '')).slice(0, 16).toUpperCase();
    const gr = await api('finance/payroll/pay-groups/create', fmgrT, { code, name: `Scale Group ${TAG}`, frequency: 'monthly' });
    ok(gr, `create group failed: ${gr.body.message}`);
    ctx.groupId = gr.body.data.id;

    const assigns = ctx.empIds.map(id => ({ employee_id: id, pay_group_id: ctx.groupId, effective_from: `${Y}-01-01` }));
    for (const batch of chunk(assigns, 500)) {
      const { error } = await sb.from('finance_employee_pay_group_assignments').insert(batch);
      expect(!error, `seed assignments failed: ${error?.message}`);
    }
  });

  h.section('Scale > Lock inputs + calculate (crosses the 1000-row cap)');

  await test(`create run + lock-inputs populates all ${N} members (not truncated at 1000)`, async () => {
    const cr = await api('finance/payroll/runs/create', fmgrT, { periodMonth: PERIOD, payGroupId: ctx.groupId });
    ok(cr, `create run failed: ${cr.body.message}`);
    ctx.runId = cr.body.data.id;

    const lr = await api('finance/payroll/runs/lock-inputs', fmgrT, { id: ctx.runId });
    ok(lr, `lock-inputs failed: ${lr.body.message}`);

    // Base-pay inputs: exactly one per employee → N rows (> 1000 proves pagination + chunked insert).
    const { count: inputCount } = await sb.from('finance_payroll_run_inputs').select('id', { count: 'exact', head: true }).eq('run_id', ctx.runId).eq('source_type', 'base_pay');
    expect(inputCount === N, `expected ${N} base_pay inputs, got ${inputCount}`);
  });

  await test(`calculate produces ${N} run lines with correct totals (batch profiles + chunked insert)`, async () => {
    const r = await api('finance/payroll/runs/calculate', fmgrT, { id: ctx.runId });
    ok(r, `calculate failed: ${r.body.message}`);
    expect(r.body.data.employeeCount === N, `run employeeCount ${r.body.data.employeeCount}`);

    const { count: lineCount } = await sb.from('finance_payroll_run_lines').select('id', { count: 'exact', head: true }).eq('run_id', ctx.runId);
    expect(lineCount === N, `expected ${N} run lines, got ${lineCount}`);

    // Every employee is salaried $5000/mo → gross 5000 each → total gross = N * 5000.
    const { data: runRow } = await sb.from('finance_payroll_runs').select('gross_total, net_total').eq('id', ctx.runId).maybeSingle();
    expect(Math.abs(Number(runRow.gross_total) - N * 5000) < 1, `gross_total ${runRow?.gross_total} (expected ${N * 5000})`);
    expect(Number(runRow.net_total) > 0, 'net_total should be positive');
  });

  await test('recalculate is idempotent (still N lines, clears + rebuilds)', async () => {
    const r = await api('finance/payroll/runs/calculate', fmgrT, { id: ctx.runId });
    ok(r, `recalculate failed: ${r.body.message}`);
    const { count } = await sb.from('finance_payroll_run_lines').select('id', { count: 'exact', head: true }).eq('run_id', ctx.runId);
    expect(count === N, `after recalc expected ${N} lines, got ${count}`);
  });
}
