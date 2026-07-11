/**
 * scripts/e2e/suites/payrollOvertimeRules.mjs
 *
 * E2E for Wave 4b — overtime rule engine.
 *
 * Routes under test:
 *   /api/finance/payroll/overtime-rules/{list, create, set-active}
 *   /api/finance/payroll/runs/{create, lock-inputs}
 *
 * Covers:
 *   - Access control: a plain employee cannot create an OT rule (403).
 *   - Create a public_holiday rule (2.5×); it lists.
 *   - lock-inputs prices an approved OT entry tagged ot_type='public_holiday' at the RULE's
 *     multiplier (2.5), not the entry's own multiplier (1.5).
 *   - Cleanup via h.TAG (incl. the created rule, by code).
 *
 * Requires migrations 20260918000070 (OT rules + hr_overtime_entries.ot_type) and 40 (pay groups)
 * applied. The run is scoped to a one-member pay group so lock-inputs populates just that employee.
 */

export const title = 'Finance Wave 4 - Overtime rule engine';

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

  const emp1Id  = 'OT-EMP1-' + TAG;
  const fmgrId  = 'OT-FMGR-' + TAG;
  const plainId = 'OT-EE-'   + TAG;
  const ruleCode = 'OTX-' + TAG.slice(-6);

  const ctx = { groupId: null, runId: null, ruleId: null, period: seedDateFromTag(TAG, 55) };
  let fmgrToken, plainToken;

  h.onCleanup(async () => {
    try { if (ctx.runId) await sb.from('finance_payroll_run_inputs').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
    try { if (ctx.groupId) await sb.from('finance_employee_pay_group_assignments').delete().eq('pay_group_id', ctx.groupId); } catch {}
    try { if (ctx.groupId) await sb.from('finance_pay_groups').delete().eq('id', ctx.groupId); } catch {}
    try { await sb.from('hr_overtime_entries').delete().eq('employee_id', emp1Id); } catch {}
    try { await sb.from('finance_overtime_rules').delete().eq('code', ruleCode); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_payroll').eq('source_entity_id', ctx.runId); } catch {}
    try { await sb.from('app_users').delete().in('id', [emp1Id, fmgrId, plainId]); } catch {}
  });

  // ===========================================================================
  h.section('Overtime rules - Setup');
  // ===========================================================================

  await test('provision users + a one-member pay group + an approved public-holiday OT entry', async () => {
    const users = [
      { id: fmgrId,  username: TAG + '_otf', full_name: 'OT Fmgr (E2E)',  role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: plainId, username: TAG + '_ote', full_name: 'OT Plain (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: emp1Id,  username: TAG + '_ot1', full_name: 'OT Emp1 (E2E)',  role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 6000 },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, 'seed users failed: ' + error?.message);
    fmgrToken  = mint({ id: fmgrId,  username: TAG + '_otf', role: 'finance_manager', department_id: null });
    plainToken = mint({ id: plainId, username: TAG + '_ote', role: 'employee',        department_id: null });

    const { data: g, error: gErr } = await sb.from('finance_pay_groups').insert({
      code: 'OTG-' + TAG.slice(-6), name: 'E2E OT Group ' + TAG, frequency: 'monthly',
    }).select('id').single();
    expect(!gErr, 'seed group failed: ' + gErr?.message);
    ctx.groupId = g.id;
    await sb.from('finance_employee_pay_group_assignments').insert({ employee_id: emp1Id, pay_group_id: ctx.groupId, effective_from: '2000-01-01' });

    // Approved OT: entry multiplier 1.5, but tagged public_holiday → the rule (2.5) should win.
    const { error: otErr } = await sb.from('hr_overtime_entries').insert({
      employee_id: emp1Id, work_date: ctx.period, hours: 8, multiplier: 1.5, status: 'approved', ot_type: 'public_holiday',
    });
    expect(!otErr, 'seed OT entry failed: ' + otErr?.message);
  });

  // ===========================================================================
  h.section('Overtime rules - CRUD + access control');
  // ===========================================================================

  await test('plain employee CANNOT create an OT rule (403)', async () => {
    const r = await api('finance/payroll/overtime-rules/create', plainToken, { code: ruleCode, eventType: 'public_holiday', multiplier: 2.5, effectiveFrom: '2025-01-01' });
    fails(r, 'employee must not create OT rules');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('finance_manager creates a public_holiday rule (2.5×, latest effective)', async () => {
    const r = await api('finance/payroll/overtime-rules/create', fmgrToken, { code: ruleCode, eventType: 'public_holiday', multiplier: 2.5, effectiveFrom: '2025-01-01' });
    ok(r, 'create OT rule failed');
    expect(r.body.data.multiplier === 2.5 && r.body.data.eventType === 'public_holiday', 'rule shape mismatch');
    ctx.ruleId = r.body.data.id;
  });

  await test('the rule appears in the list', async () => {
    const r = await api('finance/payroll/overtime-rules/list', fmgrToken, {});
    ok(r, 'list failed');
    expect((r.body.data ?? []).some(x => x.code === ruleCode), 'created rule not in list');
  });

  // ===========================================================================
  h.section('Overtime rules - Applied at lock-inputs');
  // ===========================================================================

  await test('lock-inputs prices the OT at the RULE multiplier (2.5), not the entry (1.5)', async () => {
    const cr = await api('finance/payroll/runs/create', fmgrToken, { periodMonth: ctx.period, payGroupId: ctx.groupId });
    ok(cr, 'create run failed');
    ctx.runId = cr.body.data.id;

    const lk = await api('finance/payroll/runs/lock-inputs', fmgrToken, { id: ctx.runId });
    ok(lk, 'lock-inputs failed');

    const { data: otInputs } = await sb.from('finance_payroll_run_inputs')
      .select('rate, quantity, metadata').eq('run_id', ctx.runId).eq('source_type', 'overtime');
    expect((otInputs ?? []).length === 1, 'expected 1 OT input, got ' + (otInputs ?? []).length);
    const row = (otInputs ?? [])[0];
    expect(Math.abs(Number(row.rate) - 2.5) < 0.001, 'OT rate must be the rule multiplier 2.5, got ' + row.rate);
    expect(row.metadata?.ot_type === 'public_holiday', 'OT input must record ot_type');
  });
}
