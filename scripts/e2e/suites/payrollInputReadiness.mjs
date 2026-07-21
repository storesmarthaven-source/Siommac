// ═══════════════════════════════════════════════════════════════════════════
// Payroll Create-Run Wizard — Slice 3: Input-source readiness (live suite).
// ═══════════════════════════════════════════════════════════════════════════
// Proves POST /api/finance/payroll/runs/input-readiness end-to-end against :8888.
// Read-only route — no mutation, no create RPC touched. Seeds a pay group +
// members + one row per input source in a known approval state, then asserts the
// exact per-source record counts, freshness, owner and state (ready/pending/
// review) the wizard Step-6 rows consume, plus both access-control paths.
//
// Source model mirrors lockInputs: base compensation (app_users), overtime
// (hr_overtime_entries), timesheets (hr_timesheets), leave (hr_leave_requests),
// loans (finance_employee_loans), one-time adjustments (hr_employee_pay_items).
//
// Run via: npm run test:e2e -- payrollInputReadiness (on :8888).

import { randomUUID as uuid } from 'node:crypto';

export const title = 'Payroll Input-source Readiness (create-run wizard Slice 3)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  h.section('Payroll Input-source Readiness (Slice 3)');

  const PERIOD_START = '2031-03-01', PERIOD_END = '2031-03-31';
  const sfx = TAG.slice(-6);

  const U = { fmgr: `PRIR-FMGR-${TAG}`, plain: `PRIR-EMP-${TAG}` };
  const E = {
    e1:   `PRIR-E1-${TAG}`,    // active salary + base + one row per source
    e2:   `PRIR-E2-${TAG}`,    // active, NO pay basis → base 'review'
    solo: `PRIR-SOLO-${TAG}`,  // active salary + base, no source rows (pay group B)
  };
  const allUserIds = [...Object.values(U), ...Object.values(E)];

  let fmgrToken = null, plainToken = null;
  let pgA = null, pgB = null, leaveTypeId = null, componentId = null;

  h.onCleanup(async () => {
    const emps = Object.values(E);
    await h.mustDelete('hr_overtime_entries', q => q.in('employee_id', emps));
    await h.mustDelete('hr_timesheets', q => q.in('employee_id', emps));
    await h.mustDelete('hr_leave_requests', q => q.in('employee_id', emps));
    if (leaveTypeId) await h.mustDelete('hr_leave_types', q => q.eq('id', leaveTypeId));
    await h.mustDelete('finance_employee_loans', q => q.in('employee_id', emps));
    await h.mustDelete('hr_employee_pay_items', q => q.in('employee_id', emps));
    const groups = [pgA, pgB].filter(Boolean);
    if (groups.length) {
      await h.mustDelete('finance_employee_pay_group_assignments', q => q.in('pay_group_id', groups));
      await h.mustDelete('finance_pay_groups', q => q.in('id', groups));
    }
    await h.mustDelete('app_users', q => q.in('id', allUserIds));
  });

  await test('setup: pay groups, members, and one row per input source', async () => {
    const uRes = await sb.from('app_users').insert([
      { id: U.fmgr,  username: `${TAG}_fmgr`,  full_name: 'PRIR Finance Mgr', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: U.plain, username: `${TAG}_plain`, full_name: 'PRIR Plain Emp',   role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: E.e1,   username: `${TAG}_e1`,   full_name: 'PRIR E1',   role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 9000 },
      { id: E.e2,   username: `${TAG}_e2`,   full_name: 'PRIR E2',   role: 'employee', status: 'active', employment_type: 'employee', pay_basis: null },
      { id: E.solo, username: `${TAG}_solo`, full_name: 'PRIR Solo', role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 9000 },
    ]);
    expect(!uRes.error, `seed users: ${uRes.error?.message}`);

    fmgrToken  = mint({ id: U.fmgr,  username: `${TAG}_fmgr`,  role: 'finance_manager', department_id: null });
    plainToken = mint({ id: U.plain, username: `${TAG}_plain`, role: 'employee',        department_id: null });

    const gA = await sb.from('finance_pay_groups').insert({ code: `PRIRA-${sfx}`, name: `PRIR A ${TAG}`, frequency: 'monthly', statutory_country: 'TT' }).select('id').single();
    expect(!gA.error, `pay group A: ${gA.error?.message}`); pgA = gA.data.id;
    const gB = await sb.from('finance_pay_groups').insert({ code: `PRIRB-${sfx}`, name: `PRIR B ${TAG}`, frequency: 'monthly', statutory_country: 'TT' }).select('id').single();
    expect(!gB.error, `pay group B: ${gB.error?.message}`); pgB = gB.data.id;

    const asg = await sb.from('finance_employee_pay_group_assignments').insert([
      { employee_id: E.e1, pay_group_id: pgA, effective_from: '2000-01-01' },
      { employee_id: E.e2, pay_group_id: pgA, effective_from: '2000-01-01' },
      { employee_id: E.solo, pay_group_id: pgB, effective_from: '2000-01-01' },
    ]);
    expect(!asg.error, `assign members: ${asg.error?.message}`);

    // Lookups: a self-owned leave type + an existing active pay component.
    const lt = await sb.from('hr_leave_types').insert({ code: `PRIRLT-${sfx}`, label: `PRIR Leave ${sfx}` }).select('id').single();
    expect(!lt.error, `seed leave type: ${lt.error?.message}`); leaveTypeId = lt.data.id;
    const comp = await sb.from('finance_pay_components').select('id').eq('is_active', true).limit(1).single();
    expect(!comp.error, `an active finance_pay_component must exist: ${comp.error?.message}`); componentId = comp.data.id;

    // One row per source for E1, each in a known state.
    const ot = await sb.from('hr_overtime_entries').insert({ employee_id: E.e1, work_date: '2031-03-05', hours: 2, status: 'submitted' });
    expect(!ot.error, `seed overtime: ${ot.error?.message}`);                          // pending

    const ts = await sb.from('hr_timesheets').insert({ timesheet_no: `PRIR-TS-${sfx}`, employee_id: E.e1, period_start: '2031-03-03', period_end: '2031-03-16', status: 'approved' });
    expect(!ts.error, `seed timesheet: ${ts.error?.message}`);                         // ready

    const lv = await sb.from('hr_leave_requests').insert({ case_no: `PRIR-LV-${sfx}`, employee_id: E.e1, leave_type_id: leaveTypeId, from_date: '2031-03-10', to_date: '2031-03-12', status: 'pending_approval' });
    expect(!lv.error, `seed leave: ${lv.error?.message}`);                             // pending

    const ln = await sb.from('finance_employee_loans').insert({ reference: `PRIR-LN-${sfx}`, employee_id: E.e1, loan_type: 'loan', principal: 1000, total_repayable: 1000, installment_amount: 100, balance: 1000, status: 'active', start_period: '2031-03-01' });
    expect(!ln.error, `seed loan: ${ln.error?.message}`);                              // ready

    const pi = await sb.from('hr_employee_pay_items').insert({ employee_id: E.e1, component_id: componentId, effective_from: '2031-03-01', amount: 500, status: 'pending_approval', is_active: false });
    expect(!pi.error, `seed pay item: ${pi.error?.message}`);                          // pending
  });

  // ── Access control ────────────────────────────────────────────────────────
  await test('anonymous is denied (401)', async () => {
    const r = await api('finance/payroll/runs/input-readiness', null, { payGroupId: pgA, periodStart: PERIOD_START, periodEnd: PERIOD_END });
    fails(r, 'anonymous should be denied');
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });
  await test('plain employee is denied (403)', async () => {
    const r = await api('finance/payroll/runs/input-readiness', plainToken, { payGroupId: pgA, periodStart: PERIOD_START, periodEnd: PERIOD_END });
    fails(r, 'employee should be denied');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ── Validation ────────────────────────────────────────────────────────────
  await test('non-uuid payGroupId is rejected', async () => {
    const r = await api('finance/payroll/runs/input-readiness', fmgrToken, { payGroupId: 'nope', periodStart: PERIOD_START, periodEnd: PERIOD_END });
    fails(r, 'bad payGroupId should fail');
  });
  await test('periodStart after periodEnd is rejected', async () => {
    const r = await api('finance/payroll/runs/input-readiness', fmgrToken, { payGroupId: pgA, periodStart: PERIOD_END, periodEnd: PERIOD_START });
    fails(r, 'reversed period should fail');
  });
  await test('unknown pay group is 404', async () => {
    const r = await api('finance/payroll/runs/input-readiness', fmgrToken, { payGroupId: uuid(), periodStart: PERIOD_START, periodEnd: PERIOD_END });
    fails(r, 'unknown pay group should fail');
    expect(r.status === 404, `expected 404, got ${r.status}`);
  });

  // ── Readiness content ───────────────────────────────────────────────────────
  let sources = null;
  const byKey = (k) => {
    const s = sources.find(x => x.key === k);
    expect(s, `source "${k}" missing`);
    return s;
  };

  await test('finance_manager gets the six sources with the exact response shape', async () => {
    const r = await api('finance/payroll/runs/input-readiness', fmgrToken, { payGroupId: pgA, periodStart: PERIOD_START, periodEnd: PERIOD_END });
    ok(r, `input-readiness failed: ${r.body.message}`);
    sources = r.body.data.sources;
    expect(Array.isArray(sources), 'sources must be an array');
    const keys = sources.map(s => s.key).sort();
    expect(JSON.stringify(keys) === JSON.stringify(['adjustments', 'base_compensation', 'leave', 'loans', 'overtime', 'timesheets']),
      `unexpected source keys: ${keys.join(',')}`);
    for (const s of sources) {
      for (const k of ['key', 'label', 'records', 'ownerRole', 'state']) expect(k in s, `source missing "${k}"`);
      expect('freshnessAt' in s, 'source missing freshnessAt (nullable)');
      expect(['ready', 'pending', 'review'].includes(s.state), `bad state ${s.state}`);
    }
  });

  await test('base compensation flags the member missing a pay basis (review)', () => {
    const s = byKey('base_compensation');
    expect(s.records === 1, `base records: expected 1, got ${s.records}`);   // only E1 has a base
    expect(s.state === 'review', `base state: ${s.state}`);                  // E2 missing basis
    expect(s.freshnessAt === null, `base freshnessAt should be null, got ${s.freshnessAt}`);
    expect(s.ownerRole === 'hr', `base owner: ${s.ownerRole}`);
  });

  await test('overtime with a submitted entry is pending', () => {
    const s = byKey('overtime');
    expect(s.records === 1, `overtime records: ${s.records}`);
    expect(s.state === 'pending', `overtime state: ${s.state}`);
    expect(typeof s.freshnessAt === 'string', 'overtime freshnessAt should be set');
  });

  await test('an approved timesheet is ready', () => {
    const s = byKey('timesheets');
    expect(s.records === 1, `timesheets records: ${s.records}`);
    expect(s.state === 'ready', `timesheets state: ${s.state}`);
  });

  await test('a pending_approval leave request is pending', () => {
    const s = byKey('leave');
    expect(s.records === 1, `leave records: ${s.records}`);
    expect(s.state === 'pending', `leave state: ${s.state}`);
  });

  await test('an active loan due this period is ready', () => {
    const s = byKey('loans');
    expect(s.records === 1, `loans records: ${s.records}`);
    expect(s.state === 'ready', `loans state: ${s.state}`);
    expect(s.ownerRole === 'finance', `loans owner: ${s.ownerRole}`);
  });

  await test('a pending_approval pay item (adjustment) is pending', () => {
    const s = byKey('adjustments');
    expect(s.records === 1, `adjustments records: ${s.records}`);
    expect(s.state === 'pending', `adjustments state: ${s.state}`);
  });

  await test('a pay group with no input rows reports every source ready/empty', async () => {
    const r = await api('finance/payroll/runs/input-readiness', fmgrToken, { payGroupId: pgB, periodStart: PERIOD_START, periodEnd: PERIOD_END });
    ok(r, `pgB input-readiness failed: ${r.body.message}`);
    const s = r.body.data.sources;
    const base = s.find(x => x.key === 'base_compensation');
    expect(base.records === 1 && base.state === 'ready', `pgB base: ${JSON.stringify(base)}`); // solo has a base
    for (const k of ['overtime', 'timesheets', 'leave', 'loans', 'adjustments']) {
      const src = s.find(x => x.key === k);
      expect(src.records === 0 && src.state === 'ready', `pgB ${k} should be 0/ready, got ${JSON.stringify(src)}`);
      expect(src.freshnessAt === null, `pgB ${k} freshnessAt should be null`);
    }
  });
}
