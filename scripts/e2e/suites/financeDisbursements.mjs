/**
 * scripts/e2e/suites/financeDisbursements.mjs
 * E2E for Finance Bank Accounts & Payroll Bank Disbursements (module F2).
 */

export const title = 'Finance -- Bank Accounts & Payroll Bank Disbursements (F2)';

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

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  let fmgr1Id, fmgr2Id, fstaff1Id, empId, emp2Id;

  const ctx = { bankAccountId: null, versionId: null, runId: null, draftRunId: null, staffRunId: null, cancelRunId: null, disbId: null, cancelDisbId: null, staffDisbId: null, createdUserIds: [] };

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    const ids  = [ctx.disbId, ctx.cancelDisbId, ctx.staffDisbId].filter(Boolean);
    const rids = [ctx.runId, ctx.draftRunId, ctx.staffRunId, ctx.cancelRunId].filter(Boolean);
    try { if (ids.length)  await sb.from('finance_disbursement_lines').delete().in('disbursement_id', ids); } catch {}
    try { if (ids.length)  await sb.from('finance_disbursements').delete().in('id', ids); } catch {}
    try { if (rids.length) await sb.from('finance_payslips').delete().in('run_id', rids); } catch {}
    try { if (rids.length) await sb.from('finance_payroll_run_lines').delete().in('run_id', rids); } catch {}
    try { if (rids.length) await sb.from('finance_payroll_runs').delete().in('id', rids); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    // Scoped by the SPECIFIC accounts this run created — empId/emp2Id may now be real
    // employees with unrelated real bank accounts, so a broad employee_id delete
    // would destroy their genuine data.
    const bankAcctIds = [ctx.bankAccountId, ctx.emp2BankAccountId].filter(Boolean);
    try { if (bankAcctIds.length) await sb.from('finance_employee_bank_accounts').delete().in('id', bankAcctIds); } catch {}
    try {
      const evIds = [ctx.disbId, ctx.cancelDisbId, ctx.staffDisbId].filter(Boolean);
      if (evIds.length) await sb.from('app_events').delete().eq('source_module', 'finance_disbursements').in('source_entity_id', evIds);
    } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  h.section('Finance Disbursements > Setup');

  let fmgr1Token, fmgr2Token, fstaff1Token, empToken;

  await test('acquire finance_manager x2 + finance_staff + employee x2 (real roster preferred)', async () => {
    const mgrR = await acquireActors('finance_manager', 2);
    const stfR = await acquireActors('finance_staff', 1);
    const empR = await acquireActors('employee', 2);
    const [fmgr1, fmgr2] = mgrR.actors, [fstaff1] = stfR.actors, [emp, emp2] = empR.actors;
    fmgr1Id = fmgr1.id; fmgr2Id = fmgr2.id; fstaff1Id = fstaff1.id; empId = emp.id; emp2Id = emp2.id;
    ctx.createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

    fmgr1Token  = mint({ id: fmgr1Id,   username: fmgr1.username, role: 'finance_manager', department_id: fmgr1.department_id ?? null });
    fmgr2Token  = mint({ id: fmgr2Id,   username: fmgr2.username, role: 'finance_manager', department_id: fmgr2.department_id ?? null });
    fstaff1Token = mint({ id: fstaff1Id, username: fstaff1.username, role: 'finance_staff', department_id: fstaff1.department_id ?? null });
    empToken    = mint({ id: empId,     username: emp.username,  role: 'employee',        department_id: emp.department_id ?? null });
  });

  await test('seed statutory version + approved payroll run + run-lines', async () => {
    const { data: ver, error: verErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: seedDateFromTag(TAG, 2),
      label: `E2E Disb Version ${TAG}`,
      paye_personal_allowance: 90000, paye_band1_ceiling: 1000000, paye_band1_rate: 0.25, paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99, hs_weekly_high: 8.25, hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!verErr, `seed version failed: ${verErr?.message}`);
    ctx.versionId = ver.id;
    // finance_payroll_runs.period_month is unique across the WHOLE table — derive
    // TAG-specific dates (distinct salts from other suites) to avoid colliding.
    const { data: rn, error: rnErr } = await sb.from('finance_payroll_runs').insert({
      run_no: `RUN-DSB-${TAG.slice(-6)}`, period_month: seedDateFromTag(TAG, 13),
      statutory_version_id: ctx.versionId, status: 'approved', employee_count: 2,
    }).select('id').single();
    expect(!rnErr, `seed run failed: ${rnErr?.message}`);
    ctx.runId = rn.id;
    const { data: dr, error: drErr } = await sb.from('finance_payroll_runs').insert({
      run_no: `RUN-DSB-DRAFT-${TAG.slice(-6)}`, period_month: seedDateFromTag(TAG, 14),
      statutory_version_id: ctx.versionId, status: 'draft', employee_count: 1,
    }).select('id').single();
    expect(!drErr, `seed draft run failed: ${drErr?.message}`);
    ctx.draftRunId = dr.id;
    // Real column is `net` (not net_pay). computeFromRun reads finance_payslips first,
    // then joins run_lines by run_line_id — so a payslip must exist per employee too
    // (mirrors the real flow: lock run -> generate payslips -> compute disbursement).
    const { data: lines, error: lErr } = await sb.from('finance_payroll_run_lines').insert([
      { run_id: ctx.runId, employee_id: empId,  net: 4500.00 },
      { run_id: ctx.runId, employee_id: emp2Id, net: 3200.00 },
    ]).select('id, employee_id');
    expect(!lErr, `seed run-lines failed: ${lErr?.message}`);
    const { error: pslErr } = await sb.from('finance_payslips').insert(
      (lines ?? []).map((l, i) => ({
        payslip_no:  `PSL-DSB-${TAG.slice(-6)}-${i + 1}`,
        run_id:      ctx.runId,
        run_line_id: l.id,
        employee_id: l.employee_id,
        generated_by: fmgr1Id,
      })),
    );
    expect(!pslErr, `seed payslips failed: ${pslErr?.message}`);
    // emp2 deliberately has NO bank account yet — the Compute test below asserts
    // it shows up in missingBankAccounts. It's seeded later, right before the
    // real disbursement lifecycle needs every employee on ctx.runId to have one.

    // A second approved run with a SINGLE employee (empId, who gets a bank
    // account in the Bank Accounts section below) — used only for the
    // finance_staff "can create" access-control check, so it doesn't collide
    // with the (run_id) uniqueness of the main lifecycle disbursement below.
    const { data: sr, error: srErr } = await sb.from('finance_payroll_runs').insert({
      run_no: `RUN-DSB-STF-${TAG.slice(-6)}`, period_month: seedDateFromTag(TAG, 16),
      statutory_version_id: ctx.versionId, status: 'approved', employee_count: 1,
    }).select('id').single();
    expect(!srErr, `seed staff run failed: ${srErr?.message}`);
    ctx.staffRunId = sr.id;
    const { data: sLines, error: slErr } = await sb.from('finance_payroll_run_lines').insert([
      { run_id: ctx.staffRunId, employee_id: empId, net: 4500.00 },
    ]).select('id, employee_id');
    expect(!slErr, `seed staff run-lines failed: ${slErr?.message}`);
    const { error: sPslErr } = await sb.from('finance_payslips').insert(
      (sLines ?? []).map((l, i) => ({
        payslip_no:  `PSL-DSB-STF-${TAG.slice(-6)}-${i + 1}`,
        run_id:      ctx.staffRunId,
        run_line_id: l.id,
        employee_id: l.employee_id,
        generated_by: fmgr1Id,
      })),
    );
    expect(!sPslErr, `seed staff run payslips failed: ${sPslErr?.message}`);

    // A third approved run, single employee (empId), reserved for the Cancel-path
    // test — finance_disbursements has unique(payroll_run_id), so cancelling a
    // disbursement does not free up its run for a new one to reuse.
    const { data: cr, error: crErr } = await sb.from('finance_payroll_runs').insert({
      run_no: `RUN-DSB-CANCEL-${TAG.slice(-6)}`, period_month: seedDateFromTag(TAG, 17),
      statutory_version_id: ctx.versionId, status: 'approved', employee_count: 1,
    }).select('id').single();
    expect(!crErr, `seed cancel run failed: ${crErr?.message}`);
    ctx.cancelRunId = cr.id;
    const { data: cLines, error: clErr } = await sb.from('finance_payroll_run_lines').insert([
      { run_id: ctx.cancelRunId, employee_id: empId, net: 4500.00 },
    ]).select('id, employee_id');
    expect(!clErr, `seed cancel run-lines failed: ${clErr?.message}`);
    const { error: cPslErr } = await sb.from('finance_payslips').insert(
      (cLines ?? []).map((l, i) => ({
        payslip_no:  `PSL-DSB-CXL-${TAG.slice(-6)}-${i + 1}`,
        run_id:      ctx.cancelRunId,
        run_line_id: l.id,
        employee_id: l.employee_id,
        generated_by: fmgr1Id,
      })),
    );
    expect(!cPslErr, `seed cancel run payslips failed: ${cPslErr?.message}`);
  });

  h.section('Finance Disbursements > Bank Accounts');

  await test('employee adds own bank account (masked number storage)', async () => {
    const r = await api('finance/bank-accounts/upsert', empToken, {
      bankName: 'Republic Bank', branch: 'Port of Spain',
      accountType: 'savings', accountNumber: '1234567890', isPrimary: true,
    });
    ok(r, `upsert failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.id, 'missing id');
    expect(d.accountNumberMasked === '****7890', `masked mismatch: ${d.accountNumberMasked}`);
    expect(!('accountNumber' in d), 'full account number must NOT be in response');
    expect(d.isPrimary === true, 'expected isPrimary true');
    ctx.bankAccountId = d.id;
  });

  await test('employee can list own bank accounts', async () => {
    const r = await api('finance/bank-accounts/list', empToken, {});
    ok(r, `list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'expected array');
    expect(r.body.data.some(a => a.id === ctx.bankAccountId), 'own account not in list');
  });

  await test('finance_staff can view bank accounts', async () => {
    ok(await api('finance/bank-accounts/list', fstaff1Token, {}), 'finance_staff should be able to list');
  });

  await test('get returns the masked account', async () => {
    const r = await api('finance/bank-accounts/get', fmgr1Token, { id: ctx.bankAccountId });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data.accountNumberMasked === '****7890', 'masked mismatch on get');
  });

  h.section('Finance Disbursements > Access control');

  await test('employee is DENIED disbursements/list', async () => {
    fails(await api('finance/disbursements/list', empToken, {}), 'employee should be denied list');
  });

  await test('employee is DENIED disbursements/create', async () => {
    fails(await api('finance/disbursements/create', empToken, { payrollRunId: ctx.runId }), 'employee should be denied create');
  });

  await test('finance_staff can VIEW list and CREATE (has manage) but is DENIED approve', async () => {
    ok(await api('finance/disbursements/list', fstaff1Token, {}), 'finance_staff should be able to list');
    // finance.disbursement.manage is granted to finance_staff by design — uses a
    // dedicated run (ctx.staffRunId) so it doesn't collide with the (run_id)
    // uniqueness of the main lifecycle disbursement created further down.
    const r = await api('finance/disbursements/create', fstaff1Token, { payrollRunId: ctx.staffRunId });
    ok(r, `finance_staff should be denied create — got ${JSON.stringify(r.body)}`);
    ctx.staffDisbId = r.body.data.id;
    fails(await api('finance/disbursements/approve', fstaff1Token, { id: ctx.staffDisbId }), 'finance_staff should be denied approve');
  });

  h.section('Finance Disbursements > Compute');

  await test('compute from approved run returns net pay totals + missing bank accounts', async () => {
    const r = await api('finance/disbursements/compute', fmgr1Token, { payrollRunId: ctx.runId });
    ok(r, `compute failed: ${r.body.message}`);
    const d = r.body.data;
    expect(typeof d.totalAmount === 'number', 'totalAmount missing');
    expect(Math.abs(d.totalAmount - 7700.00) < 0.01, `total mismatch: ${d.totalAmount}`);
    expect(d.employeeCount === 2, `employeeCount mismatch: ${d.employeeCount}`);
    expect(Array.isArray(d.missingBankAccounts), 'missingBankAccounts must be array');
    expect(d.missingBankAccounts.includes(emp2Id), 'emp2Id should be in missingBankAccounts');
  });

  await test('compute on a NON-approved (draft) run -> refused (422)', async () => {
    fails(await api('finance/disbursements/compute', fmgr1Token, { payrollRunId: ctx.draftRunId }), 'compute on draft run should fail');
  });

  h.section('Finance Disbursements > Lifecycle + SoD');

  await test('seed emp2 bank account (now that the missing-account case is proven)', async () => {
    const { data: ba, error: baErr } = await sb.from('finance_employee_bank_accounts').insert({
      employee_id: emp2Id, bank_name: 'Scotiabank', branch: 'San Fernando',
      account_type: 'savings', account_number: '9988776655', account_number_masked: '****6655',
      is_primary: true, is_active: true, created_by: fmgr1Id,
    }).select('id').single();
    expect(!baErr, `seed emp2 bank account failed: ${baErr?.message}`);
    ctx.emp2BankAccountId = ba.id;
  });

  await test('finance_manager creates a disbursement (draft) from the approved run', async () => {
    const r = await api('finance/disbursements/create', fmgr1Token, { payrollRunId: ctx.runId });
    ok(r, `create failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.id, 'missing id');
    expect(d.status === 'draft', `expected draft, got ${d.status}`);
    expect(Math.abs(d.totalAmount - 7700.00) < 0.01, `total mismatch: ${d.totalAmount}`);
    expect(d.disbursementNo, 'disbursementNo missing');
    ctx.disbId = d.id;
  });

  await test('side-effect: finance.disbursement.created app_event written', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_disbursements').eq('event_type', 'finance.disbursement.created')
        .eq('source_entity_id', ctx.disbId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'created app_event not found');
  });

  await test('submit (draft -> submitted)', async () => {
    const r = await api('finance/disbursements/submit', fmgr1Token, { id: ctx.disbId });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.status === 'submitted', `expected submitted, got ${r.body.data.status}`);
  });

  await test('SoD: creator cannot approve their own disbursement -> refused', async () => {
    fails(await api('finance/disbursements/approve', fmgr1Token, { id: ctx.disbId }), 'creator should not approve own disbursement');
  });

  await test('a DIFFERENT finance_manager (fmgr2) can approve', async () => {
    const r = await api('finance/disbursements/approve', fmgr2Token, { id: ctx.disbId });
    ok(r, `approve failed: ${r.body.message}`);
    expect(r.body.data.status === 'approved', `expected approved, got ${r.body.data.status}`);
  });

  await test('generate bank file (approved -> file_generated)', async () => {
    const r = await api('finance/disbursements/generate-file', fmgr2Token, { id: ctx.disbId });
    ok(r, `generate-file failed: ${r.body.message}`);
    expect(r.body.data.status === 'file_generated', `expected file_generated, got ${r.body.data.status}`);
    expect(r.body.data.bankFilePath, 'bankFilePath must be present after file generation');
  });

  await test('mark-paid (file_generated -> paid)', async () => {
    const r = await api('finance/disbursements/mark-paid', fmgr2Token, { id: ctx.disbId });
    ok(r, `mark-paid failed: ${r.body.message}`);
    expect(r.body.data.status === 'paid', `expected paid, got ${r.body.data.status}`);
  });

  await test('side-effects: approved + file_generated + paid events all written', async () => {
    const gotAll = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('event_type')
        .eq('source_module', 'finance_disbursements').eq('source_entity_id', ctx.disbId);
      const types = new Set((data ?? []).map(e => e.event_type));
      return ['finance.disbursement.approved', 'finance.disbursement.file_generated', 'finance.disbursement.paid'].every(t => types.has(t));
    });
    expect(gotAll, 'approved/file_generated/paid events not all present');
  });

  h.section('Finance Disbursements > Cancel path');

  await test('create a second disbursement then cancel it at draft state', async () => {
    const cr = await api('finance/disbursements/create', fmgr1Token, { payrollRunId: ctx.cancelRunId });
    ok(cr, `create for cancel failed: ${cr.body.message}`);
    ctx.cancelDisbId = cr.body.data.id;
    const r = await api('finance/disbursements/cancel', fmgr1Token, { id: ctx.cancelDisbId, reason: 'E2E cancel test' });
    ok(r, `cancel failed: ${r.body.message}`);
    expect(r.body.data.status === 'cancelled', `expected cancelled, got ${r.body.data.status}`);
  });

  h.section('Finance Disbursements > Response shape + reports');

  await test('get returns disbursement with all frontend-consumed fields', async () => {
    const r = await api('finance/disbursements/get', fmgr2Token, { id: ctx.disbId });
    ok(r, `get failed: ${r.body.message}`);
    const d = r.body.data;
    for (const k of ['id', 'disbursementNo', 'status', 'totalAmount', 'currency', 'employeeCount', 'createdAt', 'bankFilePath']) {
      expect(k in d, `get response missing field: ${k}`);
    }
  });

  await test('lines/list returns per-employee net pay lines (masked account number)', async () => {
    const r = await api('finance/disbursements/lines/list', fmgr2Token, { disbursementId: ctx.disbId });
    ok(r, `lines/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'lines should be array');
    const line = r.body.data[0];
    if (line) {
      for (const k of ['id', 'employeeId', 'netAmount']) { expect(k in line, `line missing field: ${k}`); }
      expect(!('accountNumber' in line), 'full account number must NOT be in line response');
    }
  });

  await test('finance_manager and finance_staff can list disbursements reports', async () => {
    ok(await api('finance/disbursements/reports/list', fmgr1Token, {}), 'reports/list failed for finance_manager');
    ok(await api('finance/disbursements/reports/list', fstaff1Token, {}), 'reports/list failed for finance_staff');
  });

  await test('employee is DENIED disbursements reports/list', async () => {
    fails(await api('finance/disbursements/reports/list', empToken, {}), 'employee should be denied reports');
  });

  await test('deactivate removes bank account from the active list', async () => {
    const r = await api('finance/bank-accounts/deactivate', fmgr1Token, { id: ctx.bankAccountId });
    ok(r, `deactivate failed: ${r.body.message}`);
    expect(r.body.data.isActive === false, 'isActive should be false after deactivate');
    const list = await api('finance/bank-accounts/list', empToken, {});
    ok(list, 'list failed after deactivate');
    expect(!list.body.data.some(a => a.id === ctx.bankAccountId), 'deactivated account must not appear in default list');
  });

  h.section('Finance Disbursements > New Aurora routes');

  await test('lines/list-detail returns enriched lines with bankName + accountNumberMasked', async () => {
    const r = await api('finance/disbursements/lines/list-detail', fmgr1Token, { disbursementId: ctx.disbId });
    ok(r, `list-detail failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'expected array');
    const line = r.body.data[0];
    if (line) {
      for (const k of ['id', 'employeeId', 'netAmount', 'accountNumberMasked', 'bankName']) {
        expect(k in line, `list-detail line missing field: ${k}`);
      }
      expect(!('accountNumber' in line), 'full account number must NOT be in list-detail response');
    }
  });

  await test('employee is DENIED lines/list-detail', async () => {
    const r = await api('finance/disbursements/lines/list-detail', empToken, { disbursementId: ctx.disbId });
    fails(r, 'employee should be denied lines/list-detail');
  });

  await test('kpis returns aggregates for the Aurora KPI strip', async () => {
    const r = await api('finance/disbursements/kpis', fmgr1Token, {});
    ok(r, `kpis failed: ${r.body.message}`);
    const d = r.body.data;
    for (const k of ['pending', 'approved', 'fileGenerated', 'paidMtd', 'totalMtdAmount', 'missingBankAccountCount', 'failedLineCount', 'trend']) {
      expect(k in d, `kpis missing field: ${k}`);
    }
    expect(Array.isArray(d.trend), 'trend must be array');
    expect(d.trend.length === 6, `trend should have 6 months, got ${d.trend.length}`);
  });

  await test('employee is DENIED kpis', async () => {
    const r = await api('finance/disbursements/kpis', empToken, {});
    fails(r, 'employee should be denied kpis');
  });

  await test('bank-file/signed-url returns a signed URL for a generated file', async () => {
    // ctx.disbId is now in `paid` state with a bankFilePath set during the lifecycle tests.
    const r = await api('finance/disbursements/bank-file/signed-url', fmgr1Token, { disbursementId: ctx.disbId });
    ok(r, `bank-file/signed-url failed: ${r.body.message}`);
    const d = r.body.data;
    expect(typeof d.signedUrl === 'string' && d.signedUrl.length > 0, 'signedUrl must be a non-empty string');
    expect(d.disbursement?.id === ctx.disbId, 'disbursement.id mismatch');
  });

  await test('bank-file/signed-url emits finance.disbursement.bank_file.downloaded app_event', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'finance_disbursements')
        .eq('event_type', 'finance.disbursement.bank_file.downloaded')
        .eq('source_entity_id', ctx.disbId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'bank_file.downloaded app_event not found');
  });

  await test('bank-file/signed-url is DENIED for employee (needs finance.disbursements.bankFile.download)', async () => {
    const r = await api('finance/disbursements/bank-file/signed-url', empToken, { disbursementId: ctx.disbId });
    fails(r, 'employee should be denied bank-file/signed-url');
  });

  await test('bank-file/signed-url on a disbursement without file_path returns 422', async () => {
    // ctx.staffDisbId is in draft/submitted state — no bankFilePath
    const r = await api('finance/disbursements/bank-file/signed-url', fmgr1Token, { disbursementId: ctx.staffDisbId });
    const code = r.status ?? 422;
    expect(code >= 400, `expected 4xx for no bank file, got ${code}`);
  });

  await test('hr_audit_log has entries for all lifecycle transitions', async () => {
    const { data: auditRows, error } = await sb.from('hr_audit_log')
      .select('action')
      .eq('submodule_key', 'finance_disbursements')
      .eq('record_id', ctx.disbId);
    expect(!error, `hr_audit_log query failed: ${error?.message}`);
    const actions = new Set((auditRows ?? []).map(r => r.action));
    for (const a of ['disbursement.created', 'disbursement.submitted', 'disbursement.approved', 'disbursement.file_generated', 'disbursement.paid', 'disbursement.bank_file.downloaded']) {
      expect(actions.has(a), `hr_audit_log missing action: ${a}`);
    }
  });

  await test('CSV export (reports/list) returns rows with correct fields', async () => {
    const r = await api('finance/disbursements/reports/list', fmgr1Token, {});
    ok(r, 'reports/list failed');
    expect(Array.isArray(r.body.data), 'expected array');
    if (r.body.data.length > 0) {
      const row = r.body.data[0];
      for (const k of ['id', 'disbursementNo', 'status', 'totalAmount', 'currency', 'createdAt']) {
        expect(k in row, `report row missing field: ${k}`);
      }
    }
  });

}
