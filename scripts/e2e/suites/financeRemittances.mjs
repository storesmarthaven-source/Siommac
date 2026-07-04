/**
 * scripts/e2e/suites/financeRemittances.mjs
 *
 * E2E for Finance ▸ Statutory Remittances & Filing (module F1).
 *
 * Routes under test:
 *   /api/finance/remittances/{list,get,lines/list,compute,create,submit,approve,
 *                             mark-paid,mark-filed,cancel,reports/list,reports/run}
 *
 * Covers:
 *   • Access control: employee DENIED; finance_staff can VIEW but not create/approve.
 *   • compute from an approved payroll run → returns PAYE/NIS/HS portions.
 *   • compute on a non-approved run → 422.
 *   • Full lifecycle: create → submit → approve → mark-paid → mark-filed.
 *   • SoD: creator (fmgr1) cannot approve own remittance → 422; a different finance_manager can.
 *   • Cancel path (with reason).
 *   • Response-shape assertions for fields the frontend consumes.
 *   • §2 side-effects: app_events (source_module 'finance_remittances') + hr_audit_log asserted
 *     via the service-role client.
 *   • Cleanup via h.TAG.
 *
 * Fixture seeded via service-role (compute needs a real approved run + run-lines):
 *   finance_statutory_versions → finance_payroll_runs (status 'approved') → finance_payroll_run_lines.
 *
 * NOTE: apply these migrations to the live DB before running, then NOTIFY pgrst, 'reload schema':
 *   20260805000000_finance_remittances.sql
 *   20260805000001_finance_remittances_permissions.sql
 *   20260805000002_workflow_finance_remittance_binding.sql
 */

export const title = 'Finance — Statutory Remittances & Filing (F1)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const fmgr1Id = `RM-MGR1-${TAG}`;
  const fmgr2Id = `RM-MGR2-${TAG}`;
  const fstaff1Id = `RM-STF1-${TAG}`;
  const empId = `RM-EMP-${TAG}`;
  const line1EmpId = `RM-LEMP1-${TAG}`;
  const line2EmpId = `RM-LEMP2-${TAG}`;

  const ctx = {
    versionId: null,
    runId: null,          // approved run (computable)
    draftRunId: null,     // non-approved run (compute must 422)
    nisRemId: null,       // NIS remittance taken through the full lifecycle
    cancelRemId: null,    // remittance for the cancel path
  };

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('finance_remittance_lines').delete().in('remittance_id', [ctx.nisRemId, ctx.cancelRemId].filter(Boolean)); } catch {}
    try { await sb.from('finance_remittances').delete().or(`id.eq.${ctx.nisRemId},id.eq.${ctx.cancelRemId}`); } catch {}
    try { await sb.from('finance_payroll_run_lines').delete().in('run_id', [ctx.runId, ctx.draftRunId].filter(Boolean)); } catch {}
    try { await sb.from('finance_payroll_runs').delete().or(`id.eq.${ctx.runId},id.eq.${ctx.draftRunId}`); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { await sb.from('hr_audit_log').delete().eq('submodule_key', 'finance_remittances').in('actor_id', [fmgr1Id, fmgr2Id, fstaff1Id]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_remittances').like('actor_user_id', 'RM-%'); } catch {}
    try { await sb.from('app_users').delete().in('id', [fmgr1Id, fmgr2Id, fstaff1Id, empId, line1EmpId, line2EmpId]); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  let fmgr1Token, fmgr2Token, fstaff1Token, empToken;

  await test('provision finance_manager ×2, finance_staff, employee + 2 line employees', async () => {
    const users = [
      { id: fmgr1Id, username: `${TAG}_rmgr1`, full_name: 'Rem Mgr One (E2E)', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: fmgr2Id, username: `${TAG}_rmgr2`, full_name: 'Rem Mgr Two (E2E)', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: fstaff1Id, username: `${TAG}_rstf`, full_name: 'Rem Staff (E2E)', role: 'finance_staff', status: 'active', employment_type: 'employee' },
      { id: empId, username: `${TAG}_remp`, full_name: 'Rem Employee (E2E)', role: 'employee', status: 'active', employment_type: 'employee' },
      { id: line1EmpId, username: `${TAG}_rl1`, full_name: 'Line Emp 1 (E2E)', role: 'employee', status: 'active', employment_type: 'employee' },
      { id: line2EmpId, username: `${TAG}_rl2`, full_name: 'Line Emp 2 (E2E)', role: 'employee', status: 'active', employment_type: 'employee' },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, `seed users failed: ${error?.message}`);

    fmgr1Token  = mint({ id: fmgr1Id,  username: `${TAG}_rmgr1`, role: 'finance_manager', department_id: null });
    fmgr2Token  = mint({ id: fmgr2Id,  username: `${TAG}_rmgr2`, role: 'finance_manager', department_id: null });
    fstaff1Token = mint({ id: fstaff1Id, username: `${TAG}_rstf`, role: 'finance_staff', department_id: null });
    empToken    = mint({ id: empId,    username: `${TAG}_remp`, role: 'employee', department_id: null });
  });

  await test('seed a statutory version + approved payroll run + 2 run-lines (fixture for compute)', async () => {
    // statutory version (required NOT-NULL cols; others default)
    const { data: ver, error: verErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: '2026-01-01',
      label: `E2E Rem Version ${TAG}`,
      paye_personal_allowance: 90000,
      hs_monthly_threshold: 469.99,
      hs_weekly_high: 8.25,
      hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!verErr, `seed version failed: ${verErr?.message}`);
    ctx.versionId = ver.id;

    // approved run (compute requires status in approved/locked/exported)
    const { data: rn, error: rnErr } = await sb.from('finance_payroll_runs').insert({
      run_no: `RUN-E2E-${TAG.slice(-6)}`,
      period_month: '2026-06-01',
      statutory_version_id: ctx.versionId,
      status: 'approved',
      employee_count: 2,
    }).select('id').single();
    expect(!rnErr, `seed run failed: ${rnErr?.message}`);
    ctx.runId = rn.id;

    // a second, draft run — compute must reject it
    const { data: dr, error: drErr } = await sb.from('finance_payroll_runs').insert({
      run_no: `RUN-E2E-DRAFT-${TAG.slice(-6)}`,
      period_month: '2026-07-01',
      statutory_version_id: ctx.versionId,
      status: 'draft',
      employee_count: 1,
    }).select('id').single();
    expect(!drErr, `seed draft run failed: ${drErr?.message}`);
    ctx.draftRunId = dr.id;

    // run-lines carrying the deduction columns compute reads
    const { error: lErr } = await sb.from('finance_payroll_run_lines').insert([
      { run_id: ctx.runId, employee_id: line1EmpId, paye: 1200.00, nis_employee: 138.60, nis_employer: 291.20, health_surcharge: 8.25 },
      { run_id: ctx.runId, employee_id: line2EmpId, paye: 800.00,  nis_employee: 138.60, nis_employer: 291.20, health_surcharge: 8.25 },
    ]);
    expect(!lErr, `seed run-lines failed: ${lErr?.message}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Access control');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee is DENIED remittances/list', async () => {
    fails(await api('finance/remittances/list', empToken, {}), 'employee should be denied list');
  });

  await test('employee is DENIED remittances/create', async () => {
    fails(await api('finance/remittances/create', empToken, { payrollRunId: ctx.runId, authority: 'nis_nibtt' }), 'employee should be denied create');
  });

  await test('finance_staff can VIEW (list) but is DENIED create + approve', async () => {
    ok(await api('finance/remittances/list', fstaff1Token, {}), 'finance_staff should be able to list');
    fails(await api('finance/remittances/create', fstaff1Token, { payrollRunId: ctx.runId, authority: 'nis_nibtt' }), 'finance_staff should be denied create');
    fails(await api('finance/remittances/approve', fstaff1Token, { id: '00000000-0000-0000-0000-000000000000' }), 'finance_staff should be denied approve');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Compute');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('compute NIS from the approved run → sums employee + employer portions', async () => {
    const r = await api('finance/remittances/compute', fmgr1Token, { payrollRunId: ctx.runId, authority: 'nis_nibtt' });
    ok(r, `compute failed: ${r.body.message}`);
    const d = r.body.data;
    expect(Math.abs(d.employeePortion - 277.20) < 0.01, `NIS employee portion mismatch: ${d.employeePortion}`);
    expect(Math.abs(d.employerPortion - 582.40) < 0.01, `NIS employer portion mismatch: ${d.employerPortion}`);
    expect(Math.abs(d.totalDue - 859.60) < 0.01, `NIS total mismatch: ${d.totalDue}`);
    expect(d.lineCount === 2, 'expected 2 computed lines');
  });

  await test('compute PAYE from the approved run → employee portion only', async () => {
    const r = await api('finance/remittances/compute', fmgr1Token, { payrollRunId: ctx.runId, authority: 'paye_bir' });
    ok(r, `compute PAYE failed: ${r.body.message}`);
    expect(Math.abs(r.body.data.totalDue - 2000.00) < 0.01, `PAYE total mismatch: ${r.body.data.totalDue}`);
    expect(r.body.data.employerPortion === 0, 'PAYE employer portion should be 0');
  });

  await test('compute on a NON-approved (draft) run → refused (422)', async () => {
    fails(await api('finance/remittances/compute', fmgr1Token, { payrollRunId: ctx.draftRunId, authority: 'nis_nibtt' }), 'compute on draft run should fail');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Lifecycle + SoD');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager creates an NIS remittance (draft) from the run', async () => {
    const r = await api('finance/remittances/create', fmgr1Token, { payrollRunId: ctx.runId, authority: 'nis_nibtt', dueDate: '2026-07-15' });
    ok(r, `create failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.id, 'missing id');
    expect(d.status === 'draft', `expected draft, got ${d.status}`);
    expect(d.authority === 'nis_nibtt', 'authority mismatch');
    expect(Math.abs(d.totalDue - 859.60) < 0.01, `total mismatch: ${d.totalDue}`);
    ctx.nisRemId = d.id;
  });

  await test('§2 side-effect: finance.remittance.created event + audit row', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_remittances').eq('event_type', 'finance.remittance.created')
        .eq('source_entity_id', ctx.nisRemId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'created app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'finance_remittances').eq('action', 'remittance.created').eq('record_id', ctx.nisRemId).limit(1);
    expect((audit ?? []).length > 0, 'created audit row not found');
  });

  await test('submit (draft → submitted) starts the approval workflow', async () => {
    const r = await api('finance/remittances/submit', fmgr1Token, { id: ctx.nisRemId });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.status === 'submitted', `expected submitted, got ${r.body.data.status}`);
  });

  await test('SoD: creator (fmgr1) cannot approve their own remittance → refused', async () => {
    fails(await api('finance/remittances/approve', fmgr1Token, { id: ctx.nisRemId }), 'creator should not approve own remittance');
  });

  await test('a DIFFERENT finance_manager (fmgr2) can approve', async () => {
    const r = await api('finance/remittances/approve', fmgr2Token, { id: ctx.nisRemId });
    ok(r, `approve failed: ${r.body.message}`);
    expect(r.body.data.status === 'approved', `expected approved, got ${r.body.data.status}`);
  });

  await test('mark-paid (approved → paid) with authority reference', async () => {
    const r = await api('finance/remittances/mark-paid', fmgr2Token, { id: ctx.nisRemId, paidDate: '2026-07-10', authorityReference: `NIBTT-${TAG.slice(-6)}` });
    ok(r, `mark-paid failed: ${r.body.message}`);
    expect(r.body.data.status === 'paid', `expected paid, got ${r.body.data.status}`);
  });

  await test('mark-filed (paid → filed)', async () => {
    const r = await api('finance/remittances/mark-filed', fmgr2Token, { id: ctx.nisRemId, filedDate: '2026-07-12' });
    ok(r, `mark-filed failed: ${r.body.message}`);
    expect(r.body.data.status === 'filed', `expected filed, got ${r.body.data.status}`);
  });

  await test('§2 side-effect: approved + paid + filed events all written', async () => {
    const gotAll = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('event_type')
        .eq('source_module', 'finance_remittances').eq('source_entity_id', ctx.nisRemId);
      const types = new Set((data ?? []).map(e => e.event_type));
      return ['finance.remittance.approved', 'finance.remittance.paid', 'finance.remittance.filed'].every(t => types.has(t));
    });
    expect(gotAll, 'approved/paid/filed events not all present');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Remittances › Cancel + reports');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('create a Health-Surcharge remittance then cancel it (with reason)', async () => {
    const cr = await api('finance/remittances/create', fmgr1Token, { payrollRunId: ctx.runId, authority: 'health_surcharge' });
    ok(cr, `create HS failed: ${cr.body.message}`);
    ctx.cancelRemId = cr.body.data.id;
    const r = await api('finance/remittances/cancel', fmgr1Token, { id: ctx.cancelRemId, reason: 'E2E cancel' });
    ok(r, `cancel failed: ${r.body.message}`);
    expect(r.body.data.status === 'cancelled', `expected cancelled, got ${r.body.data.status}`);
  });

  await test('get returns the remittance with the fields the frontend consumes', async () => {
    const r = await api('finance/remittances/get', fmgr1Token, { id: ctx.nisRemId });
    ok(r, `get failed: ${r.body.message}`);
    const d = r.body.data;
    for (const k of ['id', 'remittanceNo', 'authority', 'status', 'totalDue', 'employeePortion', 'employerPortion', 'periodYear', 'periodMonth']) {
      expect(k in d, `get response missing ${k}`);
    }
  });

  await test('finance_manager can run the remittances report; finance_staff can view it', async () => {
    ok(await api('finance/remittances/reports/list', fmgr1Token, {}), 'reports/list failed for finance_manager');
    ok(await api('finance/remittances/reports/list', fstaff1Token, {}), 'reports/list failed for finance_staff');
  });

  await test('employee is DENIED remittances reports', async () => {
    fails(await api('finance/remittances/reports/list', empToken, {}), 'employee should be denied reports');
  });
}
