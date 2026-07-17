/**
 * scripts/e2e/suites/payrollGl.mjs
 *
 * E2E for Wave 2 — Payroll → General Ledger posting.
 *
 * Routes under test:
 *   /api/finance/payroll/gl/{preview, post, reverse, get}
 *
 * Covers:
 *   - Preview builds a BALANCED journal (Σdebit == Σcredit) with no missing mappings.
 *   - Access control: a plain employee is DENIED preview (gl.preview) and post (gl.post).
 *   - Post creates a posted journal + lines that balance, links gl_journal_id on the run,
 *     and emits the finance.payroll.gl.posted app_event.
 *   - Double-post is refused (409).
 *   - gl/get returns the posted journal (header + lines).
 *   - Reverse creates a mirror reversing journal, marks the original 'reversed', and unlinks
 *     the run (re-postable). After reverse, preview.alreadyPosted is false again.
 *   - Cleanup via h.TAG (journals removed by source_ref = run_no; lines cascade).
 *
 * Depends on the payroll GL mappings existing — this suite inserts the base mappings if
 * missing (idempotent, shared config; not deleted on cleanup).
 */

export const title = 'Finance Wave 2 - Payroll GL posting';

function seedDateFromTag(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const day = (n % 1000) + salt * 1000;
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

const BASE_MAPPINGS = [
  ['salary_expense', '5000'], ['overtime_expense', '5010'], ['allowance_expense', '5020'],
  ['employer_nis_expense', '5030'], ['net_pay_clearing', '2100'], ['paye_payable', '2110'],
  ['nis_employee_payable', '2120'], ['nis_employer_payable', '2130'],
  ['health_surcharge_payable', '2140'], ['deductions_payable', '2150'],
];

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  const emp1Id = 'GL-EMP1-' + TAG;
  const emp2Id = 'GL-EMP2-' + TAG;
  const fmgrId = 'GL-FMGR-' + TAG;
  const plainId = 'GL-EE-' + TAG;

  const ctx = { versionId: null, runId: null, runNo: null };
  let fmgrToken, plainToken;

  h.onCleanup(async () => {
    try { if (ctx.runNo) await sb.from('finance_gl_journals').delete().eq('source_module', 'finance_payroll').eq('source_ref', ctx.runNo); } catch {}
    try { await sb.from('finance_payroll_run_lines').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_payroll').eq('source_entity_id', ctx.runId); } catch {}
    try { await sb.from('app_users').delete().in('id', [emp1Id, emp2Id, fmgrId, plainId]); } catch {}
  });

  // ===========================================================================
  h.section('Payroll GL - Setup');
  // ===========================================================================

  await test('ensure base GL mappings exist (idempotent, shared config)', async () => {
    for (const [k, c] of BASE_MAPPINGS) {
      const { data: exist } = await sb.from('finance_payroll_gl_mappings')
        .select('id').eq('mapping_key', k).is('component_id', null).is('department_id', null).maybeSingle();
      if (!exist) {
        const { error } = await sb.from('finance_payroll_gl_mappings').insert({ mapping_key: k, account_code: c });
        expect(!error, 'insert mapping ' + k + ' failed: ' + error?.message);
      }
    }
  });

  await test('provision finance_manager + plain employee', async () => {
    const users = [
      { id: emp1Id, username: TAG + '_ge1', full_name: 'GL Emp1 (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: emp2Id, username: TAG + '_ge2', full_name: 'GL Emp2 (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: fmgrId, username: TAG + '_gfm', full_name: 'GL Fmgr (E2E)', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: plainId,username: TAG + '_gee', full_name: 'GL Plain (E2E)',role: 'employee',        status: 'active', employment_type: 'employee' },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, 'seed users failed: ' + error?.message);
    fmgrToken  = mint({ id: fmgrId,  username: TAG + '_gfm', role: 'finance_manager', department_id: null });
    plainToken = mint({ id: plainId, username: TAG + '_gee', role: 'employee',        department_id: null });
  });

  await test('seed statutory version + LOCKED run + 2 run-lines', async () => {
    const { data: ver, error: verErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: seedDateFromTag(TAG, 7),
      label: 'E2E GL Version ' + TAG,
      paye_personal_allowance: 90000, paye_band1_ceiling: 1000000,
      paye_band1_rate: 0.25, paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99, hs_weekly_high: 8.25, hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!verErr, 'seed version failed: ' + verErr?.message);
    ctx.versionId = ver.id;

    ctx.runNo = 'RUN-GL-' + TAG.slice(-6);
    const { data: rn, error: rnErr } = await sb.from('finance_payroll_runs').insert({
      run_no: ctx.runNo, period_month: seedDateFromTag(TAG, 82),
      statutory_version_id: ctx.versionId, status: 'locked', employee_count: 2,
    }).select('id').single();
    expect(!rnErr, 'seed run failed: ' + rnErr?.message);
    ctx.runId = rn.id;

    const { error: lErr } = await sb.from('finance_payroll_run_lines').insert([
      { run_id: ctx.runId, employee_id: emp1Id, base: 5000, gross: 5000, paye: 1000, nis_employee: 138, nis_employer: 290, health_surcharge: 8.25, voluntary_deductions: 0, net: 3563.75, breakdown: {} },
      { run_id: ctx.runId, employee_id: emp2Id, base: 4000, gross: 4000, paye:  800, nis_employee: 100, nis_employer: 210, health_surcharge: 8.25, voluntary_deductions: 50, net: 2831.75, breakdown: {} },
    ]);
    expect(!lErr, 'seed lines failed: ' + lErr?.message);
  });

  // ===========================================================================
  h.section('Payroll GL - Preview + access control');
  // ===========================================================================

  await test('preview builds a BALANCED journal with no missing mappings', async () => {
    const r = await api('finance/payroll/gl/preview', fmgrToken, { runId: ctx.runId });
    ok(r, 'gl/preview failed');
    const p = r.body.data;
    expect(p.balanced === true, 'journal must balance (debit ' + p.totalDebit + ' vs credit ' + p.totalCredit + ')');
    expect(p.missingMappings.length === 0, 'unexpected missing mappings: ' + p.missingMappings.join(','));
    expect(p.alreadyPosted === false, 'should not be posted yet');
    // Debits = salary(9000) + employer NIS(500) = 9500
    expect(Math.abs(p.totalDebit - 9500) < 0.01, 'expected total debit 9500, got ' + p.totalDebit);
    expect(Math.abs(p.totalDebit - p.totalCredit) < 0.01, 'debit must equal credit');
  });

  await test('plain employee is DENIED gl/preview (403)', async () => {
    const r = await api('finance/payroll/gl/preview', plainToken, { runId: ctx.runId });
    fails(r, 'employee must not preview GL');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('plain employee is DENIED gl/post (403)', async () => {
    const r = await api('finance/payroll/gl/post', plainToken, { runId: ctx.runId });
    fails(r, 'employee must not post GL');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  // ===========================================================================
  h.section('Payroll GL - Post + side-effects');
  // ===========================================================================

  await test('finance_manager posts the run to the GL', async () => {
    const r = await api('finance/payroll/gl/post', fmgrToken, { runId: ctx.runId });
    ok(r, 'gl/post failed');
    expect(typeof r.body.data.journalNo === 'string' && /^JE-/.test(r.body.data.journalNo), 'expected JE- journal no');
    expect(Math.abs(r.body.data.totalDebit - r.body.data.totalCredit) < 0.01, 'posted journal must balance');
  });

  await test('run.gl_journal_id is set + journal lines balance in DB', async () => {
    const { data: run } = await sb.from('finance_payroll_runs').select('gl_journal_id, gl_posted_at').eq('id', ctx.runId).maybeSingle();
    expect(run?.gl_journal_id, 'run must have gl_journal_id after post');
    expect(run?.gl_posted_at, 'run must have gl_posted_at');
    const { data: lines } = await sb.from('finance_gl_journal_lines').select('debit, credit').eq('journal_id', run.gl_journal_id);
    const td = (lines ?? []).reduce((s, l) => s + Number(l.debit), 0);
    const tc = (lines ?? []).reduce((s, l) => s + Number(l.credit), 0);
    expect(Math.abs(td - tc) < 0.01, 'DB journal must balance: ' + td + ' vs ' + tc);
    expect((lines ?? []).length >= 2, 'expected >= 2 journal lines');
  });

  await test('S2: finance.payroll.gl.posted app_event emitted', async () => {
    let found = false;
    for (let i = 0; i < 20 && !found; i++) {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_entity_id', ctx.runId).eq('event_type', 'finance.payroll.gl.posted').limit(1);
      found = (data ?? []).length > 0;
      if (!found) await new Promise(res => setTimeout(res, 250));
    }
    expect(found, 'gl.posted app_event not found');
  });

  await test('double-post is refused (409)', async () => {
    const r = await api('finance/payroll/gl/post', fmgrToken, { runId: ctx.runId });
    fails(r, 'second post must be refused');
    expect(r.status === 409, 'expected 409, got ' + r.status);
  });

  await test('gl/get returns the posted journal + lines', async () => {
    const r = await api('finance/payroll/gl/get', fmgrToken, { runId: ctx.runId });
    ok(r, 'gl/get failed');
    expect(r.body.data && r.body.data.status === 'posted', 'expected a posted journal');
    expect(Array.isArray(r.body.data.lines) && r.body.data.lines.length >= 2, 'expected journal lines');
  });

  // ===========================================================================
  h.section('Payroll GL - Reverse');
  // ===========================================================================

  await test('reverse requires a reason', async () => {
    const r = await api('finance/payroll/gl/reverse', fmgrToken, { runId: ctx.runId, reason: '' });
    fails(r, 'reverse without reason must fail');
  });

  await test('finance_manager reverses the posting (mirror journal + unlink run)', async () => {
    const r = await api('finance/payroll/gl/reverse', fmgrToken, { runId: ctx.runId, reason: 'E2E correction' });
    ok(r, 'gl/reverse failed');
    expect(/^JE-/.test(r.body.data.reversingJournalNo), 'expected a reversing JE- journal');

    const { data: run } = await sb.from('finance_payroll_runs').select('gl_journal_id').eq('id', ctx.runId).maybeSingle();
    expect(!run?.gl_journal_id, 'run gl_journal_id must be cleared after reverse');

    const { data: journals } = await sb.from('finance_gl_journals').select('status').eq('source_ref', ctx.runNo).eq('source_module', 'finance_payroll');
    const statuses = (journals ?? []).map(j => j.status).sort();
    expect(statuses.includes('reversed'), 'original journal must be marked reversed');
    expect((journals ?? []).length >= 2, 'expected original + reversing journal, got ' + (journals ?? []).length);
  });

  await test('after reverse, preview.alreadyPosted is false again (re-postable)', async () => {
    const r = await api('finance/payroll/gl/preview', fmgrToken, { runId: ctx.runId });
    ok(r, 'gl/preview after reverse failed');
    expect(r.body.data.alreadyPosted === false, 'run should be re-postable after reverse');
  });
}
