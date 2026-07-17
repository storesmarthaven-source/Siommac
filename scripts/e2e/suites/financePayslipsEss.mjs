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
 *   - Employee requesting a signed-url for their OWN payslip passes self-scope, then
 *     correctly 422s BEFORE render (file_path still null), and SUCCEEDS after render.
 *   - Wave 1: render-run produces PDFs (file_path set); deliver-run emails them
 *     (password-protected) or records 'skipped' when RESEND_API_KEY is unset; both are
 *     permission-gated (generate / distribute) and tracked in finance_payslip_deliveries.
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

/** Deterministic-but-unique date from TAG + a per-suite salt, so this suite's seeded
 *  finance_statutory_versions row (unique on effective_from+jurisdiction) never
 *  collides with another suite's seed or a stale row from a crashed prior run. */
function seedDateFromTag(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const day = (n % 1000) + salt * 1000;
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

import { payrollRunSeed } from '../helpers/payrollRun.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  // These 4 actors must be synthetic, not real employees: several assertions below
  // check EXACT payslip counts per employee (0 for noSlip, 1 for emp2) which only
  // holds for a clean slate — a real employee could already have real payslip
  // history from actual payroll runs and silently break those checks.
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
    try { await sb.from('finance_payslip_deliveries').delete().eq('run_id', ctx.runId); } catch {}
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
      effective_from: seedDateFromTag(TAG, 3),
      label: 'E2E PSL Version ' + TAG,
      paye_personal_allowance: 90000,
      paye_band1_ceiling: 1000000,
      paye_band1_rate: 0.25,
      paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99,
      hs_weekly_high: 8.25,
      hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!verErr, 'seed version failed: ' + verErr?.message);
    ctx.versionId = ver.id;

    // Use a TAG-specific execution period so a crashed prior run cannot collide
    // with this fixture's scheduled-run business identity.
    const { data: rn, error: rnErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: 'RUN-PSL-' + TAG.slice(-6),
      periodStart: seedDateFromTag(TAG, 15),
      statutory_version_id: ctx.versionId,
      status: 'locked',
      employee_count: 2,
    })).select('id').single();
    expect(!rnErr, 'seed run failed: ' + rnErr?.message);
    ctx.runId = rn.id;

    const { data: lines, error: lErr } = await sb.from('finance_payroll_run_lines').insert([
      { run_id: ctx.runId, employee_id: emp1Id, paye: 1000, nis_employee: 138, nis_employer: 290, health_surcharge: 8.25, gross: 5000, net: 3750 },
      { run_id: ctx.runId, employee_id: emp2Id, paye:  800, nis_employee: 100, nis_employer: 210, health_surcharge: 8.25, gross: 4000, net: 3000 },
    ]).select('id');
    expect(!lErr, 'seed lines failed: ' + lErr?.message);
    ctx.line1Id = lines[0]?.id;
    ctx.line2Id = lines[1]?.id;

    // PDF rendering/upload is not yet built (generatePayslips always inserts
    // file_path: null — signedPayslipUrl correctly returns 422 "not generated yet"
    // for that case, per the no-band-aids policy: don't pretend an unbuilt feature
    // works). Seed emp1's payslip the same way the real generate flow does —
    // file_path: null — and assert the honest 422, not a fake signed URL.
    const { data: psl, error: pslErr } = await sb.from('finance_payslips').insert({
      payslip_no:   'PSL-E2E-' + TAG.slice(-6),
      run_id:       ctx.runId,
      run_line_id:  ctx.line1Id,
      employee_id:  emp1Id,
      file_path:    null,
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

  await test('emp1 requesting a signed-url passes self-scope, then correctly 422s (not rendered yet)', async () => {
    // The payslip has not been RENDERED yet at this point (file_path is null), so
    // signedPayslipUrl correctly refuses with 422 rather than pretending a file exists.
    // Asserts self-scope let the request THROUGH (not a 403/404). The render section
    // below then renders the PDF and re-checks that signed-url succeeds.
    const r = await api('finance/payroll/payslips/signed-url', emp1Token, { id: ctx.payslip1Id });
    fails(r, 'expected a refusal (file not generated), not success');
    expect(r.status !== 403, 'emp1 owns this payslip — must not be self-scope-denied');
    expect(/not.*generated/i.test(r.body.message ?? ''), `expected the "not generated yet" message, got: ${r.body.message}`);
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

  // ===========================================================================
  h.section('Finance Payslip - PDF render + storage (Wave 1)');
  // ===========================================================================

  await test('employee CANNOT render payslips (needs finance.payroll.payslips.generate)', async () => {
    const r = await api('finance/payroll/payslips/render-run', emp1Token, { runId: ctx.runId });
    fails(r, 'employee must be denied payslip render');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('finance_manager renders payslip PDFs for the locked run', async () => {
    const r = await api('finance/payroll/payslips/render-run', fmgrToken, { runId: ctx.runId });
    ok(r, 'render-run failed (is the `payslips` storage bucket migration applied?)');
    expect(typeof r.body.data.rendered === 'number', 'expected rendered count');
    expect(r.body.data.rendered >= 2, 'expected >=2 rendered, got ' + r.body.data.rendered);
    expect(r.body.data.failed === 0, 'expected 0 failed, got ' + r.body.data.failed);
  });

  await test('file_path is now set on the payslips (list endpoint)', async () => {
    const r = await api('finance/payroll/payslips/list', fmgrToken, { runId: ctx.runId });
    ok(r, 'payslips/list failed');
    const withFile = (r.body.data ?? []).filter(p => p.filePath);
    expect(withFile.length >= 2, 'expected >=2 payslips with filePath, got ' + withFile.length);
  });

  await test('after render, emp1 signed-url SUCCEEDS (returns a url)', async () => {
    const r = await api('finance/payroll/payslips/signed-url', emp1Token, { id: ctx.payslip1Id });
    ok(r, 'signed-url should now succeed after render');
    expect(typeof r.body.data.url === 'string' && r.body.data.url.length > 0, 'expected a signed url');
  });

  // ===========================================================================
  h.section('Finance Payslip - Email delivery + tracking (Wave 1)');
  // ===========================================================================

  await test('employee CANNOT distribute payslips (needs finance.payroll.payslips.distribute)', async () => {
    const r = await api('finance/payroll/payslips/deliver-run', emp1Token, { runId: ctx.runId });
    fails(r, 'employee must be denied payslip distribution');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('finance_manager delivers payslips (email or skipped when RESEND disabled)', async () => {
    const r = await api('finance/payroll/payslips/deliver-run', fmgrToken, { runId: ctx.runId });
    ok(r, 'deliver-run failed');
    const d = r.body.data;
    expect(typeof d.total === 'number' && d.total >= 2, 'expected total >=2, got ' + d.total);
    expect(d.sent + d.skipped + d.failed === d.total, 'delivery counts must sum to total');
    expect(d.failed === 0, 'expected 0 hard failures (skipped is OK), got ' + d.failed);
  });

  await test('S5: a delivery row is recorded per payslip', async () => {
    const { data } = await sb.from('finance_payslip_deliveries')
      .select('id, status, employee_id, channel').eq('run_id', ctx.runId);
    expect((data ?? []).length >= 2, 'expected >=2 delivery rows, got ' + (data ?? []).length);
    for (const row of (data ?? [])) {
      expect(['sent', 'skipped', 'failed'].includes(row.status), 'unexpected delivery status: ' + row.status);
      expect(row.channel === 'email', 'expected email channel');
    }
  });

  await test('deliveries/list returns the delivery history (Finance)', async () => {
    const r = await api('finance/payroll/payslips/deliveries/list', fmgrToken, { runId: ctx.runId });
    ok(r, 'deliveries/list failed');
    expect(Array.isArray(r.body.data) && r.body.data.length >= 2, 'expected >=2 deliveries');
    for (const k of ['id', 'payslipId', 'employeeId', 'status', 'channel', 'passwordProtected']) {
      expect(k in r.body.data[0], 'delivery missing field: ' + k);
    }
  });

  await test('a payslip is NEVER emailed unprotected: no DOB on file → delivery skipped', async () => {
    // emp1 is a synthetic TAG user — mutating it is safe. Give it an EMAIL (so the
    // no-recipient skip doesn't mask the check) but clear the DOB.
    const { error: clrErr } = await sb.from('app_users')
      .update({ date_of_birth: null, email: `${TAG.toLowerCase()}_psl1@e2e.local` })
      .eq('id', emp1Id);
    expect(!clrErr, `clear DOB failed: ${clrErr?.message}`);

    const r = await api('finance/payroll/payslips/deliver', fmgrToken, { payslipId: ctx.payslip1Id });
    ok(r, `single deliver failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.status === 'skipped', `expected skipped (unprotectable PDF), got ${d.status}`);
    expect(d.passwordProtected === false, 'passwordProtected must be false for a skipped no-DOB delivery');
    expect(/date of birth/i.test(d.error ?? ''), `skip reason should cite the missing DOB, got: ${d.error}`);
  });
}
