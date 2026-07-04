/**
 * scripts/e2e/suites/financePayslipsEss.mjs
 *
 * E2E for Finance F3 - Payslip Distribution & Employee Self-Service.
 *
 * Routes under test:
 *   /api/finance/payroll/payslips/{my, get, signed-url}
 *
 * Covers:
 *   - Employee can list own payslips via /my (finance.payroll.view_own).
 *   - Employee can get a signed-url for their own payslip.
 *   - Employee CANNOT get a signed-url for another employee payslip (self-scope 403).
 *   - An employee with no payslips gets an empty list (not an error).
 *   - S2 side-effect: payslip-ready notification written on generate.
 *     After seeding a payslip row directly, calling /payslips/generate (which is
 *     Finance-gated) asserts the notifications table receives a row per employee.
 *   - Response-shape assertions for fields the frontend consumes.
 *   - Cleanup via h.TAG.
 *
 * Fixture: seeded via service-role (the generate endpoint requires a locked run).
 *   finance_statutory_versions
 *     -> finance_payroll_runs (status locked)
 *       -> finance_payroll_run_lines (2 employees)
 *         -> finance_payslips (1 row; a second row is generated via the API)
 *
 * Permission check: finance.payroll.view_own is on the employee role by default.
 */

export const title = 'Finance F3 - Payslip Distribution & ESS';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  // Unique IDs for this test run
  const emp1Id    = 'PSL-EMP1-' + TAG;
  const emp2Id    = 'PSL-EMP2-' + TAG;
  const fmgrId    = 'PSL-FMGR-' + TAG;
  const noSlipId  = 'PSL-NONE-' + TAG; // employee with no payslips

  const ctx = {
    versionId:  null,
    runId:      null,
    line1Id:    null,
    line2Id:    null,
    payslip1Id: null, // seeded directly for emp1
  };

  let emp1Token, emp2Token, fmgrToken, noSlipToken;

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('notifications').delete().in('metadata->runId', [ctx.runId]).eq('type', 'finance.payroll.payslip.ready'); } catch {}
    try { await sb.from('finance_payslips').delete().eq('run_id', ctx.runId); } catch {}
    try { await sb.from('finance_payroll_run_lines').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_payroll').in('actor_user_id', [fmgrId, emp1Id, emp2Id]); } catch {}
    try { await sb.from('app_users').delete().in('id', [emp1Id, emp2Id, fmgrId, noSlipId]); } catch {}
  });

  // ===========================================================================
  h.section('Finance Payslip ESS - Setup');
  // ===========================================================================

  await test('provision 2 employees, 1 finance_manager, 1 no-payslip employee', async () => {
    const users = [
      { id: emp1Id,   username: TAG + '_pe1', full_name: 'Payslip Emp1 (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: emp2Id,   username: TAG + '_pe2', full_name: 'Payslip Emp2 (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: fmgrId,   username: TAG + '_pfm', full_name: 'Payslip Fmgr (E2E)', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: noSlipId, username: TAG + '_pns', full_name: 'Payslip None (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, 'seed users failed: ' + error?.message);

    emp1Token   = mint({ id: emp1Id,   username: TAG + '_pe1', role: 'employee',        department_id: null });
    emp2Token   = mint({ id: emp2Id,   username: TAG + '_pe2', role: 'employee',        department_id: null });
    fmgrToken   = mint({ id: fmgrId,   username: TAG + '_pfm', role: 'finance_manager', department_id: null });
    noSlipToken = mint({ id: noSlipId, username: TAG + '_pns', role: 'employee',        department_id: null });
  });

  await test('seed statutory version + LOCKED run + 2 run-lines + 1 payslip (emp1)', async () => {
    const { data: ver, error: verErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: '2026-01-01',
      label: 'E2E PSL Version ' + TAG,
      paye_personal_allowance: 90000,
      hs_monthly_threshold: 469.99,
      hs_weekly_high: 8.25,
      hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!verErr, 'seed version failed: ' + verErr?.message);
    ctx.versionId = ver.id;

    const { data: rn, error: rnErr } = await sb.from('finance_payroll_runs').insert({
      run_no: 'RUN-PSL-' + TAG.slice(-6),
      period_month: '2026-06-01',
      statutory_version_id: ctx.versionId,
      status: 'locked',
      employee_count: 2,
    }).select('id').single();
    expect(!rnErr, 'seed run failed: ' + rnErr?.message);
    ctx.runId = rn.id;

    const { data: lines, error: lErr } = await sb.from('finance_payroll_run_lines').insert([
      { run_id: ctx.runId, employee_id: emp1Id, paye: 1000, nis_employee: 138, nis_employer: 290, health_surcharge: 8.25, gross: 5000, net: 3750 },
      { run_id: ctx.runId, employee_id: emp2Id, paye:  800, nis_employee: 100, nis_employer: 210, health_surcharge: 8.25, gross: 4000, net: 3000 },
    ]).select('id');
    expect(!lErr, 'seed lines failed: ' + lErr?.message);
    ctx.line1Id = lines[0]?.id;
    ctx.line2Id = lines[1]?.id;

    // Seed a payslip for emp1 only — emp2 payslip will be created via the generate endpoint.
    const { data: psl, error: pslErr } = await sb.from('finance_payslips').insert({
      payslip_no:   'PSL-E2E-' + TAG.slice(-6),
      run_id:       ctx.runId,
      run_line_id:  ctx.line1Id,
      employee_id:  emp1Id,
      file_path:    'payslips/e2e/test-payslip.pdf',
      generated_by: fmgrId,
      metadata:     {},
    }).select('id').single();
    expect(!pslErr, 'seed payslip failed: ' + pslErr?.message);
    ctx.payslip1Id = psl.id;
  });

  // ===========================================================================
  h.section('Finance Payslip ESS - Employee my-payslips listing');
  // ===========================================================================

  await test('emp1 can list own payslips via /my (finance.payroll.view_own)', async () => {
    const r = await api('finance/payroll/payslips/my', emp1Token, {});
    ok(r, 'payslips/my failed for emp1');
    expect(Array.isArray(r.body.data), 'expected data to be an array');
    const psl = r.body.data[0];
    expect(psl, 'emp1 should have at least one payslip');
    expect(psl.id === ctx.payslip1Id, 'payslip id mismatch');
    for (const k of ['id', 'payslipNo', 'runId', 'runLineId', 'employeeId', 'generatedAt', 'filePath']) {
      expect(k in psl, 'payslip missing field: ' + k);
    }
    expect(psl.employeeId === emp1Id, 'employeeId must be emp1');
  });

  await test('noSlip employee gets empty list from /my (not an error)', async () => {
    const r = await api('finance/payroll/payslips/my', noSlipToken, {});
    ok(r, 'payslips/my failed for noSlip employee');
    expect(Array.isArray(r.body.data), 'expected array');
    expect(r.body.data.length === 0, 'noSlip employee should have zero payslips');
  });

  // ===========================================================================
  h.section('Finance Payslip ESS - Signed URL (self-scope guard)');
  // ===========================================================================

  await test('emp1 can get a signed-url for their own payslip', async () => {
    const r = await api('finance/payroll/payslips/signed-url', emp1Token, { id: ctx.payslip1Id });
    ok(r, 'signed-url failed for emp1');
    const d = r.body.data;
    expect(typeof d.url === 'string', 'url must be a string');
    expect(d.url.length > 0, 'url must not be empty');
  });

  await test('emp2 CANNOT get a signed-url for emp1 payslip (self-scope 403)', async () => {
    const r = await api('finance/payroll/payslips/signed-url', emp2Token, { id: ctx.payslip1Id });
    fails(r, 'emp2 should be denied emp1 payslip signed-url');
  });

  // ===========================================================================
  h.section('Finance Payslip ESS - Generate + notification side-effect');
  // ===========================================================================

  await test('finance_manager generates payslips for the locked run', async () => {
    const r = await api('finance/payroll/payslips/generate', fmgrToken, { runId: ctx.runId });
    ok(r, 'generate failed');
    expect(Array.isArray(r.body.data), 'expected data array');
    expect(r.body.data.length === 2, 'expected 2 payslips total, got ' + r.body.data.length);
  });

  await test('S2: payslip-ready notification written for emp2 (newly created)', async () => {
    const gotNotification = await waitFor(async () => {
      const { data } = await sb.from('notifications')
        .select('id, type, user_id')
        .eq('user_id', emp2Id)
        .eq('type', 'finance.payroll.payslip.ready')
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotNotification, 'payslip-ready notification not found for emp2');
  });

  await test('S2: re-generate does NOT duplicate the notification (dedupeKey)', async () => {
    const r2 = await api('finance/payroll/payslips/generate', fmgrToken, { runId: ctx.runId });
    ok(r2, 'idempotent generate failed');
    await new Promise(res => setTimeout(res, 600));
    const { data: notifs } = await sb.from('notifications')
      .select('id')
      .eq('user_id', emp2Id)
      .eq('type', 'finance.payroll.payslip.ready');
    expect((notifs ?? []).length === 1, 'emp2 should have exactly 1 notification after re-generate, got ' + (notifs ?? []).length);
  });

  await test('emp2 can list their own payslip via /my after generate', async () => {
    const r = await api('finance/payroll/payslips/my', emp2Token, {});
    ok(r, 'payslips/my failed for emp2 post-generate');
    expect(r.body.data.length === 1, 'emp2 should have 1 payslip, got ' + r.body.data.length);
    expect(r.body.data[0].employeeId === emp2Id, 'payslip employeeId must be emp2');
  });

  await test('/my self-scope: emp2 sees only own payslip (not emp1)', async () => {
    const r = await api('finance/payroll/payslips/my', emp2Token, {});
    ok(r, 'payslips/my failed');
    const found = (r.body.data ?? []).find(p => p.employeeId === emp1Id);
    expect(!found, 'emp2 must not see emp1 payslip in /my list');
  });
}
