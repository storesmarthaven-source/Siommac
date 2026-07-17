/**
 * scripts/e2e/suites/payrollGl.mjs
 *
 * E2E for Wave 2 - Payroll to General Ledger posting.
 *
 * Routes under test:
 *   /api/finance/payroll/gl/{preview, post, reverse, get}
 *
 * Covers:
 *   - Preview builds a balanced journal with no missing mappings.
 *   - Access control: a plain employee is DENIED preview (gl.preview) and post (gl.post).
 *   - Post creates a posted journal + lines that balance, links gl_journal_id on the run,
 *     and atomically writes the event, audit, handoff, and command receipt.
 *   - Same-key retries replay the original result; fresh-key double-post is refused (409).
 *   - gl/get returns the posted journal (header + lines).
 *   - Reverse creates a mirror reversing journal, marks the original 'reversed', and unlinks
 *     the run with exactly-once event/audit/receipt side effects.
 *   - Cleanup reports every failed delete instead of swallowing teardown errors.
 *
 * Depends on payroll GL mappings - this suite inserts the base mappings if
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

import { payrollRunSeed } from '../helpers/payrollRun.mjs';

const BASE_MAPPINGS = [
  ['salary_expense', '5200'], ['overtime_expense', '5120'], ['allowance_expense', '5220'],
  ['employer_nis_expense', '5210'], ['net_pay_clearing', '2110'], ['paye_payable', '2310'],
  ['nis_employee_payable', '2320'], ['nis_employer_payable', '2320'],
  ['health_surcharge_payable', '2300'], ['deductions_payable', '2500'],
];

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  const emp1Id = 'GL-EMP1-' + TAG;
  const emp2Id = 'GL-EMP2-' + TAG;
  const fmgrId = 'GL-FMGR-' + TAG;
  const plainId = 'GL-EE-' + TAG;

  const ctx = {
    versionId: null,
    runId: null,
    runNo: null,
    inputSnapshotId: null,
    calculationVersionId: null,
    postedJournalId: null,
    reversingJournalId: null,
  };
  let fmgrToken, plainToken;

  h.onCleanup(async () => {
    if (ctx.runId) {
      await h.mustDelete('finance_payroll_gl_command_receipts',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('handoff_outbox',
        query => query.eq('source_entity_id', ctx.runId));
      await h.mustDelete('hr_audit_log',
        query => query.eq('record_id', ctx.runId));
      await h.mustDelete('app_events',
        query => query
          .eq('source_module', 'finance_payroll')
          .eq('source_entity_id', ctx.runId));
      const { error: unlinkError } = await sb.from('finance_payroll_runs')
        .update({
          current_calculation_version_id: null,
          current_input_snapshot_id: null,
          gl_journal_id: null,
          gl_posted_at: null,
        })
        .eq('id', ctx.runId);
      expect(!unlinkError, `unlink payroll GL evidence failed: ${unlinkError?.message}`);
      await h.mustDelete('finance_payroll_calculation_version_lines',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('finance_payroll_calculation_versions',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('finance_payroll_input_snapshots',
        query => query.eq('run_id', ctx.runId));
    }
    if (ctx.runNo) {
      await h.mustDelete('finance_gl_journals',
        query => query
          .eq('source_module', 'finance_payroll')
          .eq('source_ref', ctx.runNo));
    }
    if (ctx.runId) {
      await h.mustDelete('finance_payroll_runs',
        query => query.eq('id', ctx.runId));
    }
    if (ctx.versionId) {
      await h.mustDelete('finance_statutory_versions',
        query => query.eq('id', ctx.versionId));
    }
    await h.mustDelete('app_users',
      query => query.in('id', [emp1Id, emp2Id, fmgrId, plainId]));
  });

  // ===========================================================================
  h.section('Payroll GL - Setup');
  // ===========================================================================

  await test('ensure base GL mappings exist (idempotent, shared config)', async () => {
    for (const [mappingKey, defaultAccountCode] of BASE_MAPPINGS) {
      const { data: existing, error: mappingError } = await sb
        .from('finance_payroll_gl_mappings')
        .select('id, account_code, active')
        .eq('mapping_key', mappingKey)
        .is('component_id', null)
        .is('department_id', null)
        .maybeSingle();
      expect(!mappingError, `lookup mapping ${mappingKey} failed: ${mappingError?.message}`);

      if (!existing) {
        const { data: defaultAccount, error: defaultAccountError } = await sb
          .from('finance_gl_accounts')
          .select('code, is_active')
          .eq('code', defaultAccountCode)
          .maybeSingle();
        expect(!defaultAccountError && defaultAccount?.is_active === true,
          `default account ${defaultAccountCode} for ${mappingKey} is missing or inactive`);
        const { error } = await sb.from('finance_payroll_gl_mappings').insert({
          mapping_key: mappingKey,
          account_code: defaultAccountCode,
          active: true,
        });
        expect(!error, `insert mapping ${mappingKey} failed: ${error?.message}`);
      } else {
        expect(existing.active === true, `mapping ${mappingKey} is inactive`);
        const { data: account, error: accountError } = await sb
          .from('finance_gl_accounts')
          .select('code, is_active')
          .eq('code', existing.account_code)
          .maybeSingle();
        expect(!accountError && account?.is_active === true,
          `mapping ${mappingKey} points to missing or inactive account ${existing.account_code}`);
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

  await test('seed statutory version + locked run + immutable calculation evidence', async () => {
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
    const { data: rn, error: rnErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: ctx.runNo, periodStart: seedDateFromTag(TAG, 21),
      statutory_version_id: ctx.versionId, status: 'locked', employee_count: 2,
    })).select('id').single();
    expect(!rnErr, 'seed run failed: ' + rnErr?.message);
    ctx.runId = rn.id;

    const { data: snapshot, error: snapshotError } = await sb
      .from('finance_payroll_input_snapshots')
      .insert({
        run_id: ctx.runId,
        snapshot_no: 1,
        checksum: `gl-input-${TAG}`,
        employee_count: 2,
        input_count: 2,
        source_summary: { suite: 'payrollGl' },
        locked_by: fmgrId,
      })
      .select('id')
      .single();
    expect(!snapshotError, `seed input snapshot failed: ${snapshotError?.message}`);
    ctx.inputSnapshotId = snapshot.id;

    const { data: calculationVersion, error: calculationVersionError } = await sb
      .from('finance_payroll_calculation_versions')
      .insert({
        run_id: ctx.runId,
        input_snapshot_id: ctx.inputSnapshotId,
        version_no: 1,
        checksum: `gl-calculation-${TAG}`,
        employee_count: 2,
        gross_total: 9000,
        deduction_total: 2104.50,
        net_total: 6895.50,
        nis_employer_total: 500,
        statutory_version_id: ctx.versionId,
        published_by: fmgrId,
      })
      .select('id')
      .single();
    expect(!calculationVersionError,
      `seed calculation version failed: ${calculationVersionError?.message}`);
    ctx.calculationVersionId = calculationVersion.id;

    const evidence = {
      approvedOtAmount: 0,
      taxableAllowances: 0,
      nonTaxableAllowances: 0,
    };
    const { error: lErr } = await sb.from('finance_payroll_calculation_version_lines').insert([
      {
        calculation_version_id: ctx.calculationVersionId,
        run_id: ctx.runId,
        employee_id: emp1Id,
        base: 5000,
        taxable_gross: 5000,
        gross: 5000,
        paye: 1000,
        nis_employee: 138,
        nis_employer: 290,
        health_surcharge: 8.25,
        chargeable_income: 5000,
        voluntary_deductions: 0,
        net: 3853.75,
        breakdown: evidence,
      },
      {
        calculation_version_id: ctx.calculationVersionId,
        run_id: ctx.runId,
        employee_id: emp2Id,
        base: 4000,
        taxable_gross: 4000,
        gross: 4000,
        paye: 800,
        nis_employee: 100,
        nis_employer: 210,
        health_surcharge: 8.25,
        chargeable_income: 4000,
        voluntary_deductions: 50,
        net: 3041.75,
        breakdown: evidence,
      },
    ]);
    expect(!lErr, 'seed calculation lines failed: ' + lErr?.message);

    const { error: runEvidenceError } = await sb.from('finance_payroll_runs')
      .update({
        current_input_snapshot_id: ctx.inputSnapshotId,
        current_calculation_version_id: ctx.calculationVersionId,
        gross_total: 9000,
        deduction_total: 2104.50,
        net_total: 6895.50,
        nis_employer_total: 500,
      })
      .eq('id', ctx.runId);
    expect(!runEvidenceError, `link calculation evidence failed: ${runEvidenceError?.message}`);
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
    const r = await api('finance/payroll/gl/post', plainToken, {
      runId: ctx.runId,
      idempotencyKey: `${TAG}:gl:denied:post`,
    });
    fails(r, 'employee must not post GL');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('GL posting RPC does not accept caller-supplied journal lines', async () => {
    const { error } = await sb.rpc('post_payroll_gl_tx', {
      p_run_id: ctx.runId,
      p_actor: fmgrId,
      p_idempotency_key: `${TAG}:gl:caller-lines:rejected`,
      p_metadata: {},
      p_lines: [{
        account_code: '5200',
        debit: 1,
        credit: 0,
      }],
    });
    expect(error, 'caller-supplied GL lines should not match any RPC signature');
  });

  // ===========================================================================
  h.section('Payroll GL - Post + side-effects');
  // ===========================================================================

  await test('finance_manager posts the run to the GL', async () => {
    const command = {
      runId: ctx.runId,
      idempotencyKey: `${TAG}:gl:post:1`,
    };
    const r = await api('finance/payroll/gl/post', fmgrToken, command);
    ok(r, 'gl/post failed');
    expect(typeof r.body.data.journalNo === 'string' && /^JE-/.test(r.body.data.journalNo), 'expected JE- journal no');
    expect(Math.abs(r.body.data.totalDebit - r.body.data.totalCredit) < 0.01, 'posted journal must balance');
    ctx.postedJournalId = r.body.data.journalId;

    const replay = await api('finance/payroll/gl/post', fmgrToken, command);
    ok(replay, 'gl/post same-key replay failed');
    expect(replay.body.data.journalId === ctx.postedJournalId,
      'same-key GL post replay returned a different journal');
  });

  await test('run.gl_journal_id is set + journal lines balance in DB', async () => {
    const { data: run } = await sb.from('finance_payroll_runs').select('gl_journal_id, gl_posted_at').eq('id', ctx.runId).maybeSingle();
    expect(run?.gl_journal_id, 'run must have gl_journal_id after post');
    expect(run?.gl_posted_at, 'run must have gl_posted_at');
    const { data: journal } = await sb.from('finance_gl_journals')
      .select('metadata')
      .eq('id', run.gl_journal_id)
      .maybeSingle();
    expect(journal?.metadata?.calculationVersionId === ctx.calculationVersionId,
      'journal must identify the immutable calculation version');
    expect(/^[0-9a-f]{32}$/.test(journal?.metadata?.payrollControlChecksum ?? ''),
      'journal must carry the payroll control checksum');

    const { data: lines } = await sb.from('finance_gl_journal_lines')
      .select('debit, credit, description')
      .eq('journal_id', run.gl_journal_id);
    const td = (lines ?? []).reduce((s, l) => s + Number(l.debit), 0);
    const tc = (lines ?? []).reduce((s, l) => s + Number(l.credit), 0);
    expect(Math.abs(td - tc) < 0.01, 'DB journal must balance: ' + td + ' vs ' + tc);
    expect((lines ?? []).length >= 2, 'expected >= 2 journal lines');
    const amountFor = (description, side) => Number(
      (lines ?? []).find(line => line.description === description)?.[side] ?? -1,
    );
    expect(amountFor('Salaries & Wages', 'debit') === 9000,
      'canonical salary debit should be 9000');
    expect(amountFor('Employer NIS', 'debit') === 500,
      'canonical employer NIS debit should be 500');
    expect(amountFor('Net Pay Clearing', 'credit') === 6895.5,
      'canonical net-pay clearing credit should be 6895.50');
  });

  await test('post retry retained exactly one journal, event, audit, handoff, and receipt', async () => {
    const journalCount = (await sb.from('finance_gl_journals')
      .select('id', { count: 'exact', head: true })
      .contains('metadata', { payrollRunId: ctx.runId })
      .eq('status', 'posted')).count ?? 0;
    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('event_type', 'finance.payroll.gl.posted')).count ?? 0;
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('record_id', ctx.runId)
      .eq('action', 'payroll_run.gl_posted')).count ?? 0;
    const handoffCount = (await sb.from('handoff_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('target_entity_id', ctx.postedJournalId)).count ?? 0;
    const receiptCount = (await sb.from('finance_payroll_gl_command_receipts')
      .select('request_key', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('command', 'post')).count ?? 0;

    expect(journalCount === 1, `post retry retained ${journalCount} posted journals`);
    expect(eventCount === 1, `post retry retained ${eventCount} posted events`);
    expect(auditCount === 1, `post retry retained ${auditCount} posted audits`);
    expect(handoffCount === 1, `post retry retained ${handoffCount} GL handoffs`);
    expect(receiptCount === 1, `post retry retained ${receiptCount} post receipts`);
  });

  await test('double-post is refused (409)', async () => {
    const r = await api('finance/payroll/gl/post', fmgrToken, {
      runId: ctx.runId,
      idempotencyKey: `${TAG}:gl:post:second-command`,
    });
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
    const r = await api('finance/payroll/gl/reverse', fmgrToken, {
      runId: ctx.runId,
      reason: '',
      idempotencyKey: `${TAG}:gl:reverse:missing-reason`,
    });
    fails(r, 'reverse without reason must fail');
  });

  await test('finance_manager reverses the posting (mirror journal + unlink run)', async () => {
    const command = {
      runId: ctx.runId,
      reason: 'E2E correction',
      idempotencyKey: `${TAG}:gl:reverse:1`,
    };
    const r = await api('finance/payroll/gl/reverse', fmgrToken, command);
    ok(r, 'gl/reverse failed');
    expect(/^JE-/.test(r.body.data.reversingJournalNo), 'expected a reversing JE- journal');
    ctx.reversingJournalId = r.body.data.reversingJournalId;

    const replay = await api('finance/payroll/gl/reverse', fmgrToken, command);
    ok(replay, 'gl/reverse same-key replay failed');
    expect(replay.body.data.reversingJournalId === ctx.reversingJournalId,
      'same-key GL reversal replay returned a different journal');

    const { data: run } = await sb.from('finance_payroll_runs').select('gl_journal_id').eq('id', ctx.runId).maybeSingle();
    expect(!run?.gl_journal_id, 'run gl_journal_id must be cleared after reverse');

    const { data: journals } = await sb.from('finance_gl_journals')
      .select('id, status, reversal_of')
      .eq('source_ref', ctx.runNo)
      .eq('source_module', 'finance_payroll');
    const statuses = (journals ?? []).map(j => j.status).sort();
    expect(statuses.includes('reversed'), 'original journal must be marked reversed');
    expect((journals ?? []).length === 2,
      'expected exactly original + reversing journal, got ' + (journals ?? []).length);
    const reversingJournal = (journals ?? []).find(j => j.id === ctx.reversingJournalId);
    expect(reversingJournal?.reversal_of === ctx.postedJournalId,
      'reversing journal does not point to the original journal');
  });

  await test('reverse retry retained exactly one event, audit, handoff, and receipt', async () => {
    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('event_type', 'finance.payroll.gl.reversed')).count ?? 0;
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('record_id', ctx.runId)
      .eq('action', 'payroll_run.gl_reversed')).count ?? 0;
    const receiptCount = (await sb.from('finance_payroll_gl_command_receipts')
      .select('request_key', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('command', 'reverse')).count ?? 0;
    const handoffCount = (await sb.from('handoff_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('target_entity_id', ctx.reversingJournalId)
      .eq('target_entity_type', 'gl_reversal')).count ?? 0;
    expect(eventCount === 1, `reverse retry retained ${eventCount} reversed events`);
    expect(auditCount === 1, `reverse retry retained ${auditCount} reversed audits`);
    expect(handoffCount === 1, `reverse retry retained ${handoffCount} reversal handoffs`);
    expect(receiptCount === 1, `reverse retry retained ${receiptCount} reverse receipts`);
  });

  await test('same reverse key with different inputs is rejected (409)', async () => {
    const r = await api('finance/payroll/gl/reverse', fmgrToken, {
      runId: ctx.runId,
      reason: 'Different correction',
      idempotencyKey: `${TAG}:gl:reverse:1`,
    });
    fails(r, 'same reverse key with different inputs must fail');
    expect(r.status === 409, `expected 409, got ${r.status}`);
  });

  await test('after reverse, preview.alreadyPosted is false again (re-postable)', async () => {
    const r = await api('finance/payroll/gl/preview', fmgrToken, { runId: ctx.runId });
    ok(r, 'gl/preview after reverse failed');
    expect(r.body.data.alreadyPosted === false, 'run should be re-postable after reverse');
  });
}
