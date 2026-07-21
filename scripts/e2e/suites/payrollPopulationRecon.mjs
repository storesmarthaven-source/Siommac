// ═══════════════════════════════════════════════════════════════════════════
// Payroll Create-Run Wizard — Slice 2: Population Reconciliation (live suite).
// ═══════════════════════════════════════════════════════════════════════════
// Proves POST /api/finance/payroll/runs/population-reconciliation end-to-end
// against :8888. Read-only route — no mutation, no create RPC touched. Seeds a
// pay group + employees with EACH defect (missing pay basis / statutory profile /
// primary bank), new hires, terminations, a department distribution, and a prior
// RELEASED run, then asserts the exact rule rows, department totals and prior-run
// deltas the wizard Step-5 table consumes.
//
// All seeding is via the service-role client (opaque test data only). Access
// control is tested on both paths: an authorized finance_manager passes; a plain
// employee is denied 403; an anonymous call is 401.
//
// Run via: npm run test:e2e -- payrollPopulationRecon (on :8888).

import { randomUUID as uuid } from 'node:crypto';

export const title = 'Payroll Population Reconciliation (create-run wizard Slice 2)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  h.section('Payroll Population Reconciliation (Slice 2)');

  // Period is arbitrary (read-only route, no calendar/policy dependency).
  const PERIOD_START = '2031-03-01', PERIOD_END = '2031-03-31';
  const IN_PERIOD_HIRE = '2031-03-10';   // new-hire start inside the period
  const IN_PERIOD_TERM = '2031-03-20';   // termination end inside the period

  const sfx = TAG.slice(-6);
  const deptId1 = `DEPT-PRCN-${sfx}-1`;
  const deptId2 = `DEPT-PRCN-${sfx}-2`;
  const deptName1 = `PRCN Alpha ${sfx}`;
  const deptName2 = `PRCN Bravo ${sfx}`;

  // Actors.
  const U = {
    fmgr:  `PRCN-FMGR-${TAG}`,
    plain: `PRCN-EMP-${TAG}`,
  };
  // Population employees (pay group A).
  const E = {
    clean:   `PRCN-CLEAN-${TAG}`,   // active salary, profile, bank, dept1
    newhire: `PRCN-HIRE-${TAG}`,    // active salary, profile, bank, dept1, start in period
    noBasis: `PRCN-NOBASIS-${TAG}`, // active, NO pay basis, profile, bank, dept2
    noStat:  `PRCN-NOSTAT-${TAG}`,  // active salary, NO profile, bank, dept2
    noBank:  `PRCN-NOBANK-${TAG}`,  // active salary, profile, NO bank, no dept
    term:    `PRCN-TERM-${TAG}`,    // inactive salary, end in period, dept1
    solo:    `PRCN-SOLO-${TAG}`,    // active salary, profile, bank, dept1 — pay group B only
  };
  const allUserIds = [...Object.values(U), ...Object.values(E)];

  let fmgrToken = null, plainToken = null;
  let pgA = null, pgB = null;
  let priorRunId = null;
  let statVersionId = null;

  // ── FK-safe teardown ──────────────────────────────────────────────────────
  h.onCleanup(async () => {
    if (priorRunId) {
      await h.mustDelete('finance_payroll_run_lines', q => q.eq('run_id', priorRunId));
      await h.mustDelete('finance_payroll_runs', q => q.eq('id', priorRunId));
    }
    const groups = [pgA, pgB].filter(Boolean);
    if (groups.length) {
      await h.mustDelete('finance_employee_pay_group_assignments', q => q.in('pay_group_id', groups));
      await h.mustDelete('finance_pay_groups', q => q.in('id', groups));
    }
    await h.mustDelete('finance_employee_bank_accounts', q => q.in('employee_id', Object.values(E)));
    await h.mustDelete('hr_employee_statutory_profiles', q => q.in('employee_id', Object.values(E)));
    await h.mustDelete('app_users', q => q.in('id', allUserIds));
    await h.mustDelete('departments', q => q.in('id', [deptId1, deptId2]));
  });

  // ── Seed ──────────────────────────────────────────────────────────────────
  await test('setup: departments, employees, assignments, sources, prior released run', async () => {
    // Departments (canonical org table; app_users.department_id FKs it).
    const dRes = await sb.from('departments').insert([
      { id: deptId1, name: deptName1 },
      { id: deptId2, name: deptName2 },
    ]);
    expect(!dRes.error, `seed departments: ${dRes.error?.message}`);

    // Employees. term is INACTIVE (not counted as active / not in dept totals).
    const uRes = await sb.from('app_users').insert([
      { id: U.fmgr,  username: `${TAG}_fmgr`,  full_name: 'PRCN Finance Mgr', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: U.plain, username: `${TAG}_plain`, full_name: 'PRCN Plain Emp',   role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: E.clean,   username: `${TAG}_clean`,   full_name: 'PRCN Clean',   role: 'employee', status: 'active',   employment_type: 'employee', pay_basis: 'salary', monthly_salary: 9000, department_id: deptId1 },
      { id: E.newhire, username: `${TAG}_hire`,    full_name: 'PRCN Hire',    role: 'employee', status: 'active',   employment_type: 'employee', pay_basis: 'salary', monthly_salary: 9000, department_id: deptId1, start_date: IN_PERIOD_HIRE },
      { id: E.noBasis, username: `${TAG}_nobasis`, full_name: 'PRCN NoBasis', role: 'employee', status: 'active',   employment_type: 'employee', pay_basis: null,     department_id: deptId2 },
      { id: E.noStat,  username: `${TAG}_nostat`,  full_name: 'PRCN NoStat',  role: 'employee', status: 'active',   employment_type: 'employee', pay_basis: 'salary', monthly_salary: 9000, department_id: deptId2 },
      { id: E.noBank,  username: `${TAG}_nobank`,  full_name: 'PRCN NoBank',  role: 'employee', status: 'active',   employment_type: 'employee', pay_basis: 'salary', monthly_salary: 9000, department_id: null },
      { id: E.term,    username: `${TAG}_term`,    full_name: 'PRCN Term',    role: 'employee', status: 'inactive', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 9000, department_id: deptId1, end_date: IN_PERIOD_TERM },
      { id: E.solo,    username: `${TAG}_solo`,    full_name: 'PRCN Solo',    role: 'employee', status: 'active',   employment_type: 'employee', pay_basis: 'salary', monthly_salary: 9000, department_id: deptId1 },
    ]);
    expect(!uRes.error, `seed users: ${uRes.error?.message}`);

    fmgrToken  = mint({ id: U.fmgr,  username: `${TAG}_fmgr`,  role: 'finance_manager', department_id: null });
    plainToken = mint({ id: U.plain, username: `${TAG}_plain`, role: 'employee',        department_id: null });

    // Two pay groups. A = the reconciled population; B = a fresh group with no
    // released run (exercises the null-prior-run branch).
    const gA = await sb.from('finance_pay_groups').insert({ code: `PRCNA-${sfx}`, name: `PRCN A ${TAG}`, frequency: 'monthly', statutory_country: 'TT' }).select('id').single();
    expect(!gA.error, `pay group A: ${gA.error?.message}`); pgA = gA.data.id;
    const gB = await sb.from('finance_pay_groups').insert({ code: `PRCNB-${sfx}`, name: `PRCN B ${TAG}`, frequency: 'monthly', statutory_country: 'TT' }).select('id').single();
    expect(!gB.error, `pay group B: ${gB.error?.message}`); pgB = gB.data.id;

    // Assign: all six population employees to A; solo to B (open-ended → covers the period).
    const asg = await sb.from('finance_employee_pay_group_assignments').insert([
      ...[E.clean, E.newhire, E.noBasis, E.noStat, E.noBank, E.term].map(id => ({ employee_id: id, pay_group_id: pgA, effective_from: '2000-01-01' })),
      { employee_id: E.solo, pay_group_id: pgB, effective_from: '2000-01-01' },
    ]);
    expect(!asg.error, `assign members: ${asg.error?.message}`);

    // Statutory profiles (jurisdiction TT) for everyone EXCEPT noStat.
    const sp = await sb.from('hr_employee_statutory_profiles').insert(
      [E.clean, E.newhire, E.noBasis, E.noBank, E.term, E.solo].map(id => ({ employee_id: id, jurisdiction: 'TT' })),
    );
    expect(!sp.error, `seed statutory profiles: ${sp.error?.message}`);

    // Active primary bank accounts for everyone EXCEPT noBank.
    const ba = await sb.from('finance_employee_bank_accounts').insert(
      [E.clean, E.newhire, E.noBasis, E.noStat, E.term, E.solo].map(id => ({
        employee_id: id, bank_name: 'E2E Bank', account_type: 'savings',
        account_number: '00012345678', account_number_masked: '****5678',
        is_primary: true, is_active: true,
      })),
    );
    expect(!ba.error, `seed bank accounts: ${ba.error?.message}`);

    // Prior RELEASED run on pay group A. Paid = {clean, noStat, noBasis} → 3.
    // Proposed now (active + pay basis) = {clean, newhire, noStat, noBank} → 4.
    //   added   = proposed \ prior = {newhire, noBank} = 2
    //   removed = prior \ proposed = {noBasis}          = 1
    const av = await sb.from('finance_statutory_versions').select('id').eq('is_active', true).eq('jurisdiction', 'TT').limit(1);
    expect((av.data ?? []).length > 0, 'an active TT statutory version must exist (apply + activate one first)');
    statVersionId = av.data[0].id;

    const rn = await sb.from('finance_payroll_runs').insert({
      run_no: `RUN-PRCN-${sfx}`,
      period_month: '2031-01-01', period_start: '2031-01-01', period_end: '2031-01-31',
      run_type: 'scheduled', pay_frequency: 'monthly', sequence_no: 1,
      status: 'released', pay_group_id: pgA, statutory_version_id: statVersionId,
      pay_policy_required: false, employee_count: 3,
      released_by: U.fmgr, released_at: new Date().toISOString(),
    }).select('id').single();
    expect(!rn.error, `seed prior run: ${rn.error?.message}`); priorRunId = rn.data.id;

    const rl = await sb.from('finance_payroll_run_lines').insert(
      [E.clean, E.noStat, E.noBasis].map(id => ({ run_id: priorRunId, employee_id: id, base: 9000, gross: 9000, net: 7000 })),
    );
    expect(!rl.error, `seed prior run lines: ${rl.error?.message}`);
  });

  // ── Access control ────────────────────────────────────────────────────────
  await test('anonymous is denied (401)', async () => {
    const r = await api('finance/payroll/runs/population-reconciliation', null, { payGroupId: pgA, periodStart: PERIOD_START, periodEnd: PERIOD_END });
    fails(r, 'anonymous should be denied');
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });

  await test('plain employee is denied (403 — lacks finance.payroll.view_all)', async () => {
    const r = await api('finance/payroll/runs/population-reconciliation', plainToken, { payGroupId: pgA, periodStart: PERIOD_START, periodEnd: PERIOD_END });
    fails(r, 'employee should be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ── Validation ────────────────────────────────────────────────────────────
  await test('non-uuid payGroupId is rejected (422)', async () => {
    const r = await api('finance/payroll/runs/population-reconciliation', fmgrToken, { payGroupId: 'not-a-uuid', periodStart: PERIOD_START, periodEnd: PERIOD_END });
    fails(r, 'bad payGroupId should fail');
  });

  await test('periodStart after periodEnd is rejected (422)', async () => {
    const r = await api('finance/payroll/runs/population-reconciliation', fmgrToken, { payGroupId: pgA, periodStart: PERIOD_END, periodEnd: PERIOD_START });
    fails(r, 'reversed period should fail');
  });

  await test('unknown pay group is 404', async () => {
    const r = await api('finance/payroll/runs/population-reconciliation', fmgrToken, { payGroupId: uuid(), periodStart: PERIOD_START, periodEnd: PERIOD_END });
    fails(r, 'unknown pay group should fail');
    expect(r.status === 404, `expected 404, got ${r.status}`);
  });

  // ── Reconciliation content ────────────────────────────────────────────────
  let data = null;
  await test('finance_manager gets the reconciliation (200) with the exact response shape', async () => {
    const r = await api('finance/payroll/runs/population-reconciliation', fmgrToken, { payGroupId: pgA, periodStart: PERIOD_START, periodEnd: PERIOD_END });
    ok(r, `reconciliation failed: ${r.body.message}`);
    data = r.body.data;
    expect(Array.isArray(data.rules), 'rules must be an array');
    expect(Array.isArray(data.departments), 'departments must be an array');
    expect(data.priorRun && typeof data.priorRun === 'object', 'priorRun must be an object');
    for (const rule of data.rules) {
      for (const k of ['key', 'label', 'count', 'rule', 'ownerRole', 'state']) {
        expect(k in rule, `rule missing field "${k}": ${JSON.stringify(rule)}`);
      }
      expect('action' in rule, 'rule missing "action" field (nullable)');
    }
  });

  const ruleCount = (key) => {
    const row = data.rules.find(r => r.key === key);
    expect(row, `rule "${key}" missing`);
    return row;
  };

  await test('rule counts + states are exact', async () => {
    const included = ruleCount('included');
    expect(included.count === 4, `included: expected 4, got ${included.count}`);       // clean, newhire, noStat, noBank
    expect(included.state === 'included', `included.state: ${included.state}`);

    const hires = ruleCount('new_hires');
    expect(hires.count === 1, `new_hires: expected 1, got ${hires.count}`);
    expect(hires.state === 'warning', `new_hires.state: ${hires.state}`);

    const terms = ruleCount('terminations');
    expect(terms.count === 1, `terminations: expected 1, got ${terms.count}`);
    expect(terms.state === 'review', `terminations.state: ${terms.state}`);

    const noBasis = ruleCount('missing_pay_basis');
    expect(noBasis.count === 1, `missing_pay_basis: expected 1, got ${noBasis.count}`);
    expect(noBasis.state === 'blocker', `missing_pay_basis.state: ${noBasis.state}`);
    expect(noBasis.ownerRole === 'hr', `missing_pay_basis.ownerRole: ${noBasis.ownerRole}`);
    expect(typeof noBasis.action === 'string' && noBasis.action.length > 0, 'blocker with count>0 must carry an action');

    const noStat = ruleCount('missing_statutory_profile');
    expect(noStat.count === 1, `missing_statutory_profile: expected 1, got ${noStat.count}`);
    expect(noStat.state === 'warning', `missing_statutory_profile.state: ${noStat.state}`);

    const noBank = ruleCount('missing_primary_bank');
    expect(noBank.count === 1, `missing_primary_bank: expected 1, got ${noBank.count}`);
    expect(noBank.state === 'review', `missing_primary_bank.state: ${noBank.state}`);
    expect(noBank.ownerRole === 'finance', `missing_primary_bank.ownerRole: ${noBank.ownerRole}`);
  });

  await test('department distribution groups active members by department (incl. Unassigned)', async () => {
    // Active members = clean+newhire (dept1), noBasis+noStat (dept2), noBank (unassigned) = 5.
    const total = data.departments.reduce((s, d) => s + d.count, 0);
    expect(total === 5, `active dept total: expected 5, got ${total}`);
    const byId = new Map(data.departments.map(d => [d.departmentId, d]));
    expect(byId.get(deptId1)?.count === 2, `dept1 count: ${byId.get(deptId1)?.count}`);
    expect(byId.get(deptId1)?.name === deptName1, `dept1 name: ${byId.get(deptId1)?.name}`);
    expect(byId.get(deptId2)?.count === 2, `dept2 count: ${byId.get(deptId2)?.count}`);
    const unassigned = data.departments.find(d => d.departmentId === null);
    expect(unassigned?.count === 1, `unassigned count: ${unassigned?.count}`);
    expect(unassigned?.name === 'Unassigned', `unassigned name: ${unassigned?.name}`);
  });

  await test('prior-run diff vs the last released run is exact', async () => {
    const p = data.priorRun;
    expect(p.runId === priorRunId, `priorRun.runId: ${p.runId}`);
    expect(p.releasedPopulation === 3, `releasedPopulation: expected 3, got ${p.releasedPopulation}`);
    expect(p.proposed === 4, `proposed: expected 4, got ${p.proposed}`);
    expect(p.added === 2, `added: expected 2, got ${p.added}`);       // newhire, noBank
    expect(p.removed === 1, `removed: expected 1, got ${p.removed}`); // noBasis
  });

  await test('a pay group with no released run reports a null prior run', async () => {
    const r = await api('finance/payroll/runs/population-reconciliation', fmgrToken, { payGroupId: pgB, periodStart: PERIOD_START, periodEnd: PERIOD_END });
    ok(r, `pgB reconciliation failed: ${r.body.message}`);
    const p = r.body.data.priorRun;
    expect(p.runId === null, `pgB priorRun.runId should be null, got ${p.runId}`);
    expect(p.releasedPopulation === 0, `pgB releasedPopulation: ${p.releasedPopulation}`);
    expect(p.removed === 0, `pgB removed: ${p.removed}`);
    expect(p.proposed === 1, `pgB proposed: expected 1 (solo), got ${p.proposed}`);
    expect(p.added === 1, `pgB added: expected 1, got ${p.added}`);
    // Solo employee is clean → included count 1, no defects.
    const included = r.body.data.rules.find(x => x.key === 'included');
    expect(included?.count === 1, `pgB included: ${included?.count}`);
  });
}
