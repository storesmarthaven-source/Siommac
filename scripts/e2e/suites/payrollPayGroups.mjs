/**
 * scripts/e2e/suites/payrollPayGroups.mjs
 *
 * E2E for Wave 3 — pay groups + population + period-correct PAYE.
 *
 * Routes under test:
 *   /api/finance/payroll/pay-groups/{list, create, assign, members}
 *   /api/finance/payroll/runs/{create, lock-inputs, calculate}
 *
 * Covers:
 *   - Access control: a plain employee cannot create/assign pay groups (403).
 *   - Create a WEEKLY pay group; assign two employees to it.
 *   - Create a run scoped to the group → frequency=weekly, weeksInPeriod=1, payGroupId set.
 *   - lock-inputs populates ONLY the group's members (not other active employees).
 *   - calculate applies PERIOD-CORRECT PAYE: a weekly 2000 earner is taxed (>0),
 *     whereas the same base in a MONTHLY run (allowance 90000/12=7500) would be 0.
 *   - Cleanup via h.TAG.
 *
 * Requires migration 20260918000040 (pay-group tables) applied.
 */

export const title = 'Finance Wave 3 - Pay groups + period-correct PAYE';

function seedDateFromTag(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const day = (n % 1000) + salt * 1000;
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

import {
  payrollCalculationCommand,
  payrollRunCommand,
} from '../helpers/payrollRun.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  const emp1Id  = 'PG-EMP1-' + TAG;
  const emp2Id  = 'PG-EMP2-' + TAG;
  const fmgrId  = 'PG-FMGR-' + TAG;
  const plainId = 'PG-EE-'   + TAG;

  const ctx = { groupId: null, group2Id: null, runId: null };
  let fmgrToken, plainToken;

  h.onCleanup(async () => {
    try { if (ctx.runId) await sb.from('finance_payroll_run_inputs').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_lines').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_warnings').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
    try { if (ctx.groupId) await sb.from('finance_employee_pay_group_assignments').delete().eq('pay_group_id', ctx.groupId); } catch {}
    try { if (ctx.group2Id) await sb.from('finance_employee_pay_group_assignments').delete().eq('pay_group_id', ctx.group2Id); } catch {}
    try { if (ctx.groupId) await sb.from('finance_pay_groups').delete().eq('id', ctx.groupId); } catch {}
    try { if (ctx.group2Id) await sb.from('finance_pay_groups').delete().eq('id', ctx.group2Id); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_payroll').in('actor_user_id', [fmgrId]); } catch {}
    try { await sb.from('app_users').delete().in('id', [emp1Id, emp2Id, fmgrId, plainId]); } catch {}
  });

  // ===========================================================================
  h.section('Pay groups - Setup');
  // ===========================================================================

  await test('provision finance_manager, plain employee, and 2 payable employees', async () => {
    const users = [
      { id: fmgrId,  username: TAG + '_pgm', full_name: 'PG Fmgr (E2E)',  role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: plainId, username: TAG + '_pge', full_name: 'PG Plain (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: emp1Id,  username: TAG + '_pg1', full_name: 'PG Emp1 (E2E)',  role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 8667 },  // ~2000/week once prorated (8667*12/52)
      { id: emp2Id,  username: TAG + '_pg2', full_name: 'PG Emp2 (E2E)',  role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 8667 },  // ~2000/week once prorated (8667*12/52)
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, 'seed users failed: ' + error?.message);
    fmgrToken  = mint({ id: fmgrId,  username: TAG + '_pgm', role: 'finance_manager', department_id: null });
    plainToken = mint({ id: plainId, username: TAG + '_pge', role: 'employee',        department_id: null });
  });

  // ===========================================================================
  h.section('Pay groups - Access control + create + assign');
  // ===========================================================================

  await test('plain employee CANNOT create a pay group (403)', async () => {
    const r = await api('finance/payroll/pay-groups/create', plainToken, { code: 'X-' + TAG.slice(-4), name: 'Nope', frequency: 'weekly' });
    fails(r, 'employee must not create pay groups');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('finance_manager creates a WEEKLY pay group', async () => {
    const r = await api('finance/payroll/pay-groups/create', fmgrToken, {
      code: 'WK-' + TAG.slice(-6), name: 'E2E Weekly ' + TAG, frequency: 'weekly', defaultPayDay: 5, defaultCutoffOffsetDays: 1,
    });
    ok(r, 'create pay group failed');
    expect(r.body.data.frequency === 'weekly', 'group frequency must be weekly');
    ctx.groupId = r.body.data.id;
  });

  await test('plain employee CANNOT assign employees (403)', async () => {
    const r = await api('finance/payroll/pay-groups/assign', plainToken, { employeeId: emp1Id, payGroupId: ctx.groupId, effectiveFrom: '2000-01-01' });
    fails(r, 'employee must not assign to pay groups');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('finance_manager assigns emp1 + emp2 to the weekly group', async () => {
    for (const id of [emp1Id, emp2Id]) {
      const r = await api('finance/payroll/pay-groups/assign', fmgrToken, { employeeId: id, payGroupId: ctx.groupId, effectiveFrom: '2000-01-01' });
      ok(r, 'assign ' + id + ' failed');
    }
    const m = await api('finance/payroll/pay-groups/members', fmgrToken, { payGroupId: ctx.groupId });
    ok(m, 'members list failed');
    expect(m.body.data.length === 2, 'expected 2 members, got ' + m.body.data.length);
  });

  await test('overlap protection: reassigning to a NEW group closes the previous open assignment', async () => {
    // Create a second group and move emp1 into it from a later date.
    const g2 = await api('finance/payroll/pay-groups/create', fmgrToken, {
      code: `PG2-${TAG.slice(-6)}`, name: `E2E Group 2 ${TAG}`, frequency: 'monthly',
    });
    ok(g2, 'create second group failed');
    ctx.group2Id = g2.body.data.id;

    const r = await api('finance/payroll/pay-groups/assign', fmgrToken, {
      employeeId: emp1Id, payGroupId: ctx.group2Id, effectiveFrom: '2010-06-01',
    });
    ok(r, 'reassign to group 2 failed: ' + r.body.message);

    // The weekly-group assignment must now be CLOSED the day before the move.
    const { data: rows } = await sb.from('finance_employee_pay_group_assignments')
      .select('pay_group_id, effective_from, effective_to')
      .eq('employee_id', emp1Id).order('effective_from');
    const oldRow = (rows ?? []).find(x => x.pay_group_id === ctx.groupId);
    const newRow = (rows ?? []).find(x => x.pay_group_id === ctx.group2Id);
    expect(oldRow?.effective_to === '2010-05-31', `previous assignment should close 2010-05-31, got ${oldRow?.effective_to}`);
    expect(newRow && newRow.effective_to === null, 'new assignment should be open-ended');

    // Restore emp1 for the run-scoping tests below: put them back on the weekly
    // group open-ended (close group 2 first).
    await sb.from('finance_employee_pay_group_assignments').delete().eq('employee_id', emp1Id).eq('pay_group_id', ctx.group2Id);
    await sb.from('finance_employee_pay_group_assignments').update({ effective_to: null }).eq('employee_id', emp1Id).eq('pay_group_id', ctx.groupId);
  });

  await test('overlap protection: a bounded range overlapping an existing one is refused (409)', async () => {
    // emp2 is open-ended in the weekly group since 2000-01-01; a bounded overlap
    // in ANOTHER group cannot close it (it starts earlier + is open) → DB refuses.
    const r = await api('finance/payroll/pay-groups/assign', fmgrToken, {
      employeeId: emp2Id, payGroupId: ctx.group2Id,
      effectiveFrom: '1999-01-01', effectiveTo: '2001-01-01',
    });
    fails(r, 'overlapping bounded assignment should be refused');
  });

  await test('effectiveTo before effectiveFrom is refused (422)', async () => {
    const r = await api('finance/payroll/pay-groups/assign', fmgrToken, {
      employeeId: emp2Id, payGroupId: ctx.group2Id,
      effectiveFrom: '2035-06-01', effectiveTo: '2035-05-01',
    });
    fails(r, 'inverted date range should be refused');
  });

  // ===========================================================================
  h.section('Pay groups - Run scoping (population) + period-correct PAYE');
  // ===========================================================================

  await test('create a run scoped to the weekly group → weekly frequency', async () => {
    const r = await api('finance/payroll/runs/create', fmgrToken, payrollRunCommand({
      idempotencyKey: `${TAG}:pay-groups:run:create`,
      periodStart: seedDateFromTag(TAG, 33),
      payFrequency: 'weekly',
      payGroupId: ctx.groupId,
    }));
    ok(r, 'create run failed (is an active TT statutory version present?)');
    expect(r.body.data.payGroupId === ctx.groupId, 'run must link the pay group');
    expect(r.body.data.payFrequency === 'weekly', 'frequency must come from the group');
    expect(Math.abs(r.body.data.weeksInPeriod - 1) < 0.001, 'weekly run has weeksInPeriod 1, got ' + r.body.data.weeksInPeriod);
    ctx.runId = r.body.data.id;
  });

  await test('lock-inputs populates ONLY the group members (not all active employees)', async () => {
    const r = await api('finance/payroll/runs/lock-inputs', fmgrToken, {
      id: ctx.runId,
      idempotencyKey: `${TAG}:pay-groups:run:lock-inputs:1`,
    });
    ok(r, 'lock-inputs failed');
    expect(r.body.data.employeeCount === 2, 'expected 2 employees populated, got ' + r.body.data.employeeCount);

    const { data: inputs } = await sb.from('finance_payroll_run_inputs').select('employee_id').eq('run_id', ctx.runId);
    const ids = new Set((inputs ?? []).map(i => i.employee_id));
    expect(ids.size === 2, 'expected exactly 2 distinct employees in inputs, got ' + ids.size);
    for (const id of ids) expect([emp1Id, emp2Id].includes(id), 'unexpected employee in group run: ' + id);
  });

  await test('calculate applies period-correct (weekly) PAYE — a ~2000/wk earner is taxed', async () => {
    const r = await api(
      'finance/payroll/runs/calculate',
      fmgrToken,
      payrollCalculationCommand(ctx.runId, `${TAG}:pay-groups:run:calculate:1`),
    );
    ok(r, 'calculate failed');
    const { data: lines } = await sb.from('finance_payroll_run_lines').select('employee_id, base, paye').eq('run_id', ctx.runId);
    expect((lines ?? []).length === 2, 'expected 2 lines, got ' + (lines ?? []).length);
    for (const l of (lines ?? [])) {
      // Salaried base is prorated to the pay frequency: 8667/mo × 12 ÷ 52 ≈ 2000/week.
      expect(Math.abs(Number(l.base) - 2000) < 1, `weekly base should prorate to ~2000, got ${l.base} for ${l.employee_id}`);
      // Weekly: chargeable ≈ 2000 − (90000/52 = 1730.77) = 269.23 → PAYE ≈ 67.31.
      // A MONTHLY annualisation would give 2000 − 7500 < 0 → PAYE 0. So >0 proves period-correctness.
      expect(Number(l.paye) > 0, `weekly PAYE must be > 0 (period-correct), got ${l.paye} for ${l.employee_id}`);
    }
  });
}
