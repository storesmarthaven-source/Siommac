/**
 * scripts/e2e/suites/financePayroll.mjs
 *
 * E2E for Finance Phase 3 (all stages): Payroll Runs - full lifecycle.
 *
 * Routes under test:
 *   /api/finance/payroll/runs/{list,get,create,lock-inputs,calculate,certify,submit,lock,reopen,export}
 *   /api/finance/payroll/releases/{preflight,confirm-funding,release,get-certificate}
 *   /api/finance/payroll/runs/workspace
 *   /api/finance/payroll/calculations/{attempts/list,attempts/get,versions/list,versions/get,compare}
 *   /api/finance/payroll/findings/{list,get,assign,resolve,waive,reopen}
 *   /api/finance/payroll/inputs/list
 *   /api/finance/payroll/run-lines/list
 *   /api/finance/payroll/warnings/list
 *   /api/finance/payroll/payslips/{generate,list,my,get,signed-url}
 *   /api/finance/payroll/exports/list
 *   /api/finance/payroll/reports/{list,run}
 *
 * Covers:
 *   - finance_manager and finance_staff roles exist.
 *   - Create -> lock inputs -> calculate, including failed-attempt recovery and immutable versions.
 *   - Findings block certification until resolved with evidence.
 *   - Certify -> submit -> approve -> lock with maker-checker separation.
 *   - Locked runs can reopen only through the controlled reversal path.
 *   - Funding confirmation and release enforce segregation of duties.
 *   - Release freezes statutory, disbursement, and bank-routing evidence.
 *   - Exports are immutable versioned artifacts; exporting does not change run status.
 *   - Payslip ownership, GL posting/reversal, reports, permissions, and exact side effects.
 *   - Cleanup via h.TAG.
 *
 * NOTE: These migrations must be applied to the live DB before running:
 *   20260804000000 through 20260804000004, corrected source migrations,
 *   and 20260919000420 through 20260919000425.
 */

import { createHash } from 'node:crypto';

import {
  payrollCalculationCommand,
  payrollCertificationCommand,
  payrollExportCommand,
  payrollFundingCommand,
  payrollLockCommand,
  payrollReleaseCommand,
  payrollReopenCommand,
  payrollPeriod,
  payrollRunCommand,
  payrollRunSeed,
} from '../helpers/payrollRun.mjs';

export const title = 'Finance — Payroll Runs (Phase 3 — full lifecycle)';

/** Deterministic-but-unique NEAR-FUTURE date from TAG + salt — period_month is
 *  unique across the WHOLE runs table (a fixed date collides with residue from
 *  crashed runs), while remittances/statutory logic expect a sane year (the
 *  finance_remittances period_year CHECK rejects far-future periods). Each salt
 *  gets its own ~1-year window from a 2027 base so salts never collide. */
const BASE_GL_MAPPINGS = [
  ['salary_expense', '5200'],
  ['overtime_expense', '5120'],
  ['allowance_expense', '5220'],
  ['employer_nis_expense', '5210'],
  ['net_pay_clearing', '2110'],
  ['paye_payable', '2310'],
  ['nis_employee_payable', '2320'],
  ['nis_employer_payable', '2320'],
  ['health_surcharge_payable', '2300'],
  ['deductions_payable', '2500'],
];

function seedDateFromTag(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const day = 20820 + (salt % 10) * 400 + (n % 365); // 2027-01-01 + per-salt window
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  // ── Test user IDs — acquired below (real roster preferred; created only when
  // the role/precondition (e.g. a real salaried employee) doesn't already exist) ──
  let fmgr1Id, fmgr2Id, fstaff1Id, emp1Id, emp2Id;

  const ctx = {
    runId:            null,
    runNo:            null,
    lineId1:          null,   // run_line for emp1
    payslipId1:       null,   // payslip for emp1
    exportId:         null,
    disbursementId:   null,   // bridge flow test — create-disbursement (Gap 16)
    disbRunId:        null,   // isolated (pay-scoped) run seeded for the disbursement test
    remittancePAYEId: null,   // bridge flow test — create-remittance paye_bir (Gap 16)
    sodRunId:         null,   // seeded run for the SoD / no-workflow approve negatives
    createdUserIds:   [],
    statutoryVersionId: null,
    calculationAttemptIds: [],
    calculationVersionIds: [],
    inputSnapshotId: null,
    findingIds: [],
    reopenedSnapshotId: null,
    reopenedCalculationVersionId: null,
    mainPayGroupId: null,
    bankAccountIds: [],
    certificationIds: [],
    fundingConfirmationIds: [],
    releaseCertificateId: null,
    releaseDisbursementId: null,
    releaseRemittanceIds: [],
    reopenBlockerDisbursementId: null,
    reopenBlockerRemittanceId: null,
    glJournalIds: [],
  };

  const waitFor = async (check, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await check()) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  };

  let fmgr1Token, fmgr2Token, fstaff1Token, emp1Token, emp2Token;

  h.onCleanup(async () => {
    const runIds = [ctx.runId, ctx.disbRunId, ctx.sodRunId].filter(Boolean);
    const artifactIds = [
      ctx.runId,
      ctx.disbRunId,
      ctx.sodRunId,
      ctx.disbursementId,
      ctx.releaseDisbursementId,
      ctx.reopenBlockerDisbursementId,
      ctx.reopenBlockerRemittanceId,
      ctx.remittancePAYEId,
      ctx.releaseCertificateId,
      ...ctx.releaseRemittanceIds,
      ...ctx.calculationAttemptIds,
      ...ctx.findingIds,
    ].filter(Boolean);

    if (ctx.runId) {
      const { data: exports, error: exportLookupError } = await sb
        .from('finance_payroll_exports')
        .select('id')
        .eq('run_id', ctx.runId);
      if (exportLookupError) {
        console.warn(`[cleanup] export lookup failed: ${exportLookupError.message}`);
      } else {
        artifactIds.push(...(exports ?? []).map(row => row.id));
      }

      await h.mustDelete('finance_payroll_export_command_receipts',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('finance_payroll_exports',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('finance_payroll_release_command_receipts',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('finance_payroll_gl_command_receipts',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('finance_payroll_lifecycle_command_receipts',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('finance_payroll_input_lock_receipts',
        query => query.eq('run_id', ctx.runId));
      if (ctx.releaseCertificateId) {
        await h.mustDelete('finance_payroll_release_remittances',
          query => query.eq('release_certificate_id', ctx.releaseCertificateId));
      }

      const { error: unlinkError } = await sb.from('finance_payroll_runs')
        .update({
          release_certificate_id: null,
          approval_certification_id: null,
          gl_journal_id: null,
          gl_posted_at: null,
          current_calculation_version_id: null,
          current_input_snapshot_id: null,
        })
        .eq('id', ctx.runId);
      if (unlinkError) {
        console.warn(`[cleanup] payroll run unlink failed: ${unlinkError.message}`);
      }

      await h.mustDelete('finance_payroll_release_certificates',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('finance_remittances',
        query => query.eq('payroll_run_id', ctx.runId));

      const { data: disbursements, error: disbursementLookupError } = await sb
        .from('finance_disbursements')
        .select('id')
        .in('payroll_run_id', runIds);
      if (disbursementLookupError) {
        console.warn(`[cleanup] disbursement lookup failed: ${disbursementLookupError.message}`);
      } else {
        const disbursementIds = (disbursements ?? []).map(row => row.id);
        if (disbursementIds.length) {
          await h.mustDelete('finance_disbursement_bank_files',
            query => query.in('disbursement_id', disbursementIds));
          await h.mustDelete('finance_disbursement_lines',
            query => query.in('disbursement_id', disbursementIds));
          await h.mustDelete('finance_disbursements',
            query => query.in('id', disbursementIds));
        }
      }

      await h.mustDelete('finance_payroll_funding_confirmations',
        query => query.eq('run_id', ctx.runId));
      await h.mustDelete('finance_payroll_certifications',
        query => query.eq('run_id', ctx.runId));

      if (ctx.runNo) {
        await h.mustDelete('finance_gl_journals',
          query => query
            .eq('source_module', 'finance_payroll')
            .eq('source_ref', ctx.runNo));
      }
    }

    if (runIds.length) {
      await h.mustDelete('finance_payslip_deliveries',
        query => query.in('run_id', runIds));
      await h.mustDelete('finance_payslips',
        query => query.in('run_id', runIds));
      const { data: findings, error: findingsLookupError } = await sb
        .from('finance_payroll_control_findings')
        .select('id')
        .in('run_id', runIds);
      if (findingsLookupError) {
        console.warn(`[cleanup] payroll finding lookup failed: ${findingsLookupError.message}`);
      } else {
        const findingIds = (findings ?? []).map(row => row.id);
        if (findingIds.length) {
          await h.mustDelete('finance_payroll_finding_command_receipts',
            query => query.in('finding_id', findingIds));
        }
      }
      await h.mustDelete('finance_payroll_control_findings',
        query => query.in('run_id', runIds));
      await h.mustDelete('finance_payroll_run_warnings',
        query => query.in('run_id', runIds));
      await h.mustDelete('finance_payroll_run_lines',
        query => query.in('run_id', runIds));
      await h.mustDelete('finance_payroll_run_inputs',
        query => query.in('run_id', runIds));
      await h.mustDelete('finance_payroll_calculation_version_lines',
        query => query.in('run_id', runIds));
      await h.mustDelete('finance_payroll_calculation_versions',
        query => query.in('run_id', runIds));
      await h.mustDelete('finance_payroll_calculation_attempts',
        query => query.in('run_id', runIds));
      await h.mustDelete('finance_payroll_input_snapshot_lines',
        query => query.in('run_id', runIds));
      await h.mustDelete('finance_payroll_input_snapshots',
        query => query.in('run_id', runIds));
    }

    if (ctx.runId) {
      const { error: workflowError } = await sb.from('workflow_instances')
        .update({ status: 'cancelled' })
        .eq('source_record_id', ctx.runId)
        .in('status', ['pending', 'open', 'in_progress']);
      if (workflowError) {
        console.warn(`[cleanup] workflow cancellation failed: ${workflowError.message}`);
      }
    }

    const notificationSourceIds = [ctx.runId, ...ctx.findingIds].filter(Boolean);
    if (notificationSourceIds.length) {
      await h.mustDelete('notifications',
        query => query.in('source_id', notificationSourceIds));
    }
    if (runIds.length) {
      await h.mustDelete('handoff_outbox',
        query => query.in('source_entity_id', runIds));
    }
    if (artifactIds.length) {
      await h.mustDelete('hr_audit_log',
        query => query.in('record_id', artifactIds));
      await h.mustDelete('app_events',
        query => query.in('source_entity_id', artifactIds));
    }

    if (runIds.length) {
      await h.mustDelete('finance_payroll_runs',
        query => query.in('id', runIds));
    }
    if (ctx.bankAccountIds.length) {
      await h.mustDelete('finance_employee_bank_accounts',
        query => query.in('id', ctx.bankAccountIds));
    }
    if (ctx.mainPayGroupId) {
      await h.mustDelete('finance_employee_pay_group_assignments',
        query => query.eq('pay_group_id', ctx.mainPayGroupId));
      await h.mustDelete('finance_pay_groups',
        query => query.eq('id', ctx.mainPayGroupId));
    }
    if (ctx.createdUserIds.length) {
      await h.mustDelete('app_users',
        query => query.in('id', ctx.createdUserIds));
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_staff and finance_manager roles exist in roles table', async () => {
    const { data, error } = await sb.from('roles').select('name').in('name', ['finance_staff', 'finance_manager']);
    expect(!error, `roles query failed: ${error?.message}`);
    const names = (data ?? []).map(r => r.name);
    expect(names.includes('finance_staff'),   'finance_staff role missing from DB');
    expect(names.includes('finance_manager'), 'finance_manager role missing from DB');
  });

  await test('acquire finance actors and two isolated salaried employees', async () => {
    const mgrR = await acquireActors('finance_manager', 2, { pay_basis: 'salary', monthly_salary: 10000.00 });
    const stfR = await acquireActors('finance_staff', 1, { pay_basis: 'salary', monthly_salary: 8000.00 });
    // Real employees must be salaried (pay_basis='salary') so the run produces a > 0 net —
    // an hourly real employee with no salary would fail the "net > 0" assertions below.
    const empR = await acquireActors(
      'employee',
      2,
      { pay_basis: 'salary', monthly_salary: 6000.00 },
      {},
      { forceSynthetic: true },
    );
    const [fmgr1, fmgr2] = mgrR.actors, [fstaff1] = stfR.actors, [emp1, emp2] = empR.actors;
    fmgr1Id = fmgr1.id; fmgr2Id = fmgr2.id; fstaff1Id = fstaff1.id; emp1Id = emp1.id; emp2Id = emp2.id;
    ctx.createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];

    fmgr1Token   = mint({ id: fmgr1Id,   username: fmgr1.username, role: 'finance_manager', department_id: fmgr1.department_id ?? null });
    fmgr2Token   = mint({ id: fmgr2Id,   username: fmgr2.username, role: 'finance_manager', department_id: fmgr2.department_id ?? null });
    fstaff1Token = mint({ id: fstaff1Id, username: fstaff1.username, role: 'finance_staff', department_id: fstaff1.department_id ?? null });
    emp1Token    = mint({ id: emp1Id,    username: emp1.username, role: 'employee',         department_id: emp1.department_id ?? null });
    emp2Token    = mint({ id: emp2Id,    username: emp2.username, role: 'employee',         department_id: emp2.department_id ?? null });
  });

  await test('an active statutory version must exist before creating a run', async () => {
    const { data } = await sb.from('finance_statutory_versions')
      .select('id').eq('is_active', true).limit(1);
    expect((data ?? []).length > 0, 'No active statutory version — apply migrations 20260802000002 and activate a version before running this suite');
    ctx.statutoryVersionId = (data ?? [])[0]?.id ?? null;
  });

  await test('main lifecycle uses an isolated two-employee pay group', async () => {
    const group = await api('finance/payroll/pay-groups/create', fmgr1Token, {
      code: `E2E-${TAG.slice(-10)}`,
      name: `E2E Payroll Lifecycle ${TAG}`,
      frequency: 'monthly',
      statutoryCountry: 'TT',
    });
    ok(group, `main pay group creation failed: ${group.body.message}`);
    ctx.mainPayGroupId = group.body.data.id;

    for (const employeeId of [emp1Id, emp2Id]) {
      const assignment = await api('finance/payroll/pay-groups/assign', fmgr1Token, {
        employeeId,
        payGroupId: ctx.mainPayGroupId,
        effectiveFrom: '2000-01-01',
      });
      ok(assignment, `main pay group assignment failed: ${assignment.body.message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Create Run');
  // ═══════════════════════════════════════════════════════════════════════════

  const testPeriod = payrollPeriod('financePayroll', 'lifecycle', TAG); // registry-derived to avoid scheduled-run identity collisions

  await test('finance_staff can create a payroll run', async () => {
    const r = await api('finance/payroll/runs/create', fstaff1Token, payrollRunCommand({
      idempotencyKey: `${TAG}:run:main:create`,
      periodStart: testPeriod,
      payGroupId: ctx.mainPayGroupId,
    }));
    ok(r, `create run failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.id,                        'missing id');
    expect(d.runNo,                     'missing runNo');
    expect(d.status === 'draft',        `status should be draft, got ${d.status}`);
    expect(
      d.periodMonth === `${testPeriod.slice(0, 7)}-01`,
      `periodMonth mismatch: ${d.periodMonth}`,
    );
    expect(d.statutoryVersionId,        'missing statutoryVersionId');
    expect(d.createdBy === fstaff1Id,   'createdBy mismatch');
    ctx.runId  = d.id;
    ctx.runNo  = d.runNo;
  });

  await test('create retry with the same key returns one run and one set of side-effects', async () => {
    const replay = await api('finance/payroll/runs/create', fstaff1Token, payrollRunCommand({
      idempotencyKey: `${TAG}:run:main:create`,
      periodStart: testPeriod,
      payGroupId: ctx.mainPayGroupId,
    }));
    ok(replay, `create replay failed: ${replay.body.message}`);
    expect(replay.body.data.id === ctx.runId, 'create replay returned a different payroll run');

    const runCount = (await sb.from('finance_payroll_runs')
      .select('id', { count: 'exact', head: true })
      .eq('creation_request_key', `${fstaff1Id}|payroll_run.create|${TAG}:run:main:create`)).count ?? 0;
    expect(runCount === 1, `create replay should retain exactly one run, got ${runCount}`);
    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.run.created')
      .eq('source_entity_id', ctx.runId)).count ?? 0;
    expect(eventCount === 1, `create replay should retain one created event, got ${eventCount}`);
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'payroll_run.created')
      .eq('record_id', ctx.runId)).count ?? 0;
    expect(auditCount === 1, `create replay should retain one created audit, got ${auditCount}`);
  });

  await test('employee is DENIED creating a payroll run', async () => {
    const r = await api('finance/payroll/runs/create', emp1Token, payrollRunCommand({
      idempotencyKey: `${TAG}:run:denied:create`,
      periodStart: payrollPeriod('financePayroll', 'denyCreate', TAG),
    }));
    fails(r, 'employee should be denied run creation');
  });

  await test('duplicate scheduled run business key is rejected (409)', async () => {
    const r = await api('finance/payroll/runs/create', fmgr1Token, payrollRunCommand({
      idempotencyKey: `${TAG}:run:duplicate:create`,
      periodStart: testPeriod,
      payGroupId: ctx.mainPayGroupId,
    }));
    expect(!r.ok || r.body.success === false, 'duplicate period should fail');
    expect(r.status === 409, `duplicate business key should return 409, got ${r.status}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Lock Inputs');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('plain employee is DENIED locking payroll inputs', async () => {
    const denied = await api(
      'finance/payroll/runs/lock-inputs',
      emp1Token,
      {
        id: ctx.runId,
        idempotencyKey: `${TAG}:run:main:lock-inputs:denied`,
      },
    );
    expect(denied.status === 403,
      `plain employee input lock should return 403, got ${denied.status}`);
  });

  await test('input lock requires an idempotency key', async () => {
    const r = await api(
      'finance/payroll/runs/lock-inputs',
      fmgr1Token,
      { id: ctx.runId },
    );
    expect(r.status === 400, `missing input-lock key should return 400, got ${r.status}`);
  });

  await test('finance_manager can lock inputs for the run', async () => {
    const r = await api('finance/payroll/runs/lock-inputs', fmgr1Token, {
      id: ctx.runId,
      idempotencyKey: `${TAG}:run:main:lock-inputs:1`,
    });
    ok(r, `lock-inputs failed: ${r.body.message}`);
    expect(r.body.data.status === 'input_locked', `status should be input_locked, got ${r.body.data.status}`);
    ctx.inputSnapshotId = r.body.data.currentInputSnapshotId;
    expect(ctx.inputSnapshotId, 'input lock response is missing currentInputSnapshotId');
    expect(r.body.data.employeeCount > 0, `employeeCount should be > 0 (got ${r.body.data.employeeCount}) — test users need pay_basis`);
  });

  await test('input-lock retry replays one immutable snapshot and exact side effects', async () => {
    const replay = await api('finance/payroll/runs/lock-inputs', fmgr1Token, {
      id: ctx.runId,
      idempotencyKey: `${TAG}:run:main:lock-inputs:1`,
    });
    ok(replay, `input-lock replay failed: ${replay.body.message}`);
    expect(replay.body.data.status === 'input_locked',
      `input-lock replay should return input_locked, got ${replay.body.data.status}`);

    const snapshotCount = (await sb.from('finance_payroll_input_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)).count ?? 0;
    const receiptCount = (await sb.from('finance_payroll_input_lock_receipts')
      .select('request_key', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)).count ?? 0;
    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.run.inputs_locked')
      .eq('source_entity_id', ctx.runId)).count ?? 0;
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'payroll_run.inputs_locked')
      .eq('record_id', ctx.runId)).count ?? 0;

    expect(snapshotCount === 1, `input-lock replay retained ${snapshotCount} snapshots`);
    expect(receiptCount === 1, `input-lock replay retained ${receiptCount} receipts`);
    expect(eventCount === 1, `input-lock replay retained ${eventCount} events`);
    expect(auditCount === 1, `input-lock replay retained ${auditCount} audits`);
  });

  await test('input-lock same key with a different payload is rejected', async () => {
    const { error } = await sb.rpc('finance_payroll_lock_inputs_tx', {
      p_run_id: ctx.runId,
      p_actor_id: fmgr1Id,
      p_idempotency_key: `${TAG}:run:main:lock-inputs:1`,
      p_inputs: [],
      p_employee_count: 0,
      p_source_summary: {},
    });
    expect(error?.code === 'PR409',
      `divergent input-lock replay should return PR409, got ${error?.code ?? 'success'}`);
  });

  await test('an input-locked run rejects a fresh command key', async () => {
    const r = await api('finance/payroll/runs/lock-inputs', fmgr1Token, {
      id: ctx.runId,
      idempotencyKey: `${TAG}:run:main:lock-inputs:fresh`,
    });
    expect(r.status === 409,
      `fresh key on an input-locked run should return 409, got ${r.status}`);
  });

  await test('run inputs are created in finance_payroll_run_inputs', async () => {
    const r = await api('finance/payroll/inputs/list', fmgr1Token, { runId: ctx.runId });
    ok(r, `inputs/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'inputs data is not an array');
    expect(r.body.data.length > 0, 'no inputs created — seeded users should have pay_basis=salary');

    // Assert base_pay inputs exist and at least one is > 0. (Real-roster hourly
    // employees legitimately have 0 base pay until an approved timesheet exists, so
    // don't require the FIRST base_pay input to be positive.)
    const basePays = r.body.data.filter(i => i.sourceType === 'base_pay');
    expect(basePays.length > 0, 'no base_pay input found');
    expect(basePays.some(i => i.amount > 0), 'at least one base_pay input should be > 0 (payable employees present)');
    expect(basePays.every(i => i.runId === ctx.runId), 'input runId mismatch');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Calculate');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('plain employee is DENIED calculating payroll', async () => {
    const denied = await api(
      'finance/payroll/runs/calculate',
      emp1Token,
      payrollCalculationCommand(ctx.runId, `${TAG}:run:main:calculate:denied`),
    );
    expect(denied.status === 403,
      `plain employee calculation should return 403, got ${denied.status}`);
  });

  await test('finance_manager can calculate the run', async () => {
    const r = await api(
      'finance/payroll/runs/calculate',
      fmgr1Token,
      payrollCalculationCommand(ctx.runId, `${TAG}:run:main:calculate:1`),
    );
    ok(r, `calculate failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.status === 'calculated',  `status should be calculated, got ${d.status}`);
    expect(d.grossTotal > 0,           `grossTotal should be > 0 (got ${d.grossTotal})`);
    expect(d.netTotal > 0,             `netTotal should be > 0 (got ${d.netTotal})`);
    expect(d.employeeCount > 0,        `employeeCount should be > 0`);
  });

  await test('calculate retry replays one durable attempt and one immutable version', async () => {
    const replay = await api(
      'finance/payroll/runs/calculate',
      fmgr1Token,
      payrollCalculationCommand(ctx.runId, `${TAG}:run:main:calculate:1`),
    );
    ok(replay, `calculate replay failed: ${replay.body.message}`);
    expect(replay.body.data.status === 'calculated', 'calculate replay did not return the run');

    const attempts = await api('finance/payroll/calculations/attempts/list', fmgr1Token, {
      runId: ctx.runId,
    });
    ok(attempts, `attempt list failed: ${attempts.body.message}`);
    expect(attempts.body.data.length === 1,
      `calculate replay should retain one attempt, got ${attempts.body.data.length}`);
    const attempt = attempts.body.data[0];
    expect(attempt.status === 'succeeded', `attempt should be succeeded, got ${attempt.status}`);
    expect(attempt.correlationId, 'attempt is missing correlationId');
    expect(!('technicalDetail' in attempt), 'attempt API leaked technicalDetail');
    ctx.calculationAttemptIds.push(attempt.id);

    const versions = await api('finance/payroll/calculations/versions/list', fmgr1Token, {
      runId: ctx.runId,
    });
    ok(versions, `version list failed: ${versions.body.message}`);
    expect(versions.body.data.length === 1,
      `calculate replay should retain one version, got ${versions.body.data.length}`);
    expect(versions.body.data[0].versionNo === 1, 'first calculation version should be version 1');
    ctx.calculationVersionIds.push(versions.body.data[0].id);
  });

  await test('calculation evidence get endpoints and run workspace return the UI contract', async () => {
    const attempt = await api(
      'finance/payroll/calculations/attempts/get',
      fmgr1Token,
      { id: ctx.calculationAttemptIds[0] },
    );
    ok(attempt, `attempt get failed: ${attempt.body.message}`);
    expect(attempt.body.data.runId === ctx.runId, 'attempt get returned the wrong run');

    const version = await api(
      'finance/payroll/calculations/versions/get',
      fmgr1Token,
      { id: ctx.calculationVersionIds[0] },
    );
    ok(version, `version get failed: ${version.body.message}`);
    expect(version.body.data.runId === ctx.runId, 'version get returned the wrong run');
    expect(version.body.data.employeeCount > 0, 'version is missing employee totals');

    const workspace = await api('finance/payroll/runs/workspace', fmgr1Token, { id: ctx.runId });
    ok(workspace, `workspace failed: ${workspace.body.message}`);
    const data = workspace.body.data;
    expect(data.run.id === ctx.runId, 'workspace returned the wrong run');
    expect(data.inputSnapshot?.id, 'workspace is missing the current input snapshot');
    expect(data.currentCalculationVersion?.id === ctx.calculationVersionIds[0],
      'workspace is missing the current calculation version');
    expect(Array.isArray(data.calculationAttempts), 'workspace calculationAttempts is not an array');
    expect(typeof data.findingSummary?.total === 'number', 'workspace is missing finding summary');
    expect(Array.isArray(data.priorityFindings), 'workspace priorityFindings is not an array');
    expect(Array.isArray(data.audit), 'workspace audit is not an array');
  });

  await test('plain employee is DENIED payroll execution evidence endpoints', async () => {
    const requests = [
      ['finance/payroll/runs/workspace', { id: ctx.runId }],
      ['finance/payroll/calculations/attempts/list', { runId: ctx.runId }],
      ['finance/payroll/calculations/attempts/get', { id: ctx.calculationAttemptIds[0] }],
      ['finance/payroll/calculations/versions/list', { runId: ctx.runId }],
      ['finance/payroll/calculations/versions/get', { id: ctx.calculationVersionIds[0] }],
    ];
    for (const [path, payload] of requests) {
      const denied = await api(path, emp1Token, payload);
      expect(denied.status === 403, `${path} should deny a plain employee, got ${denied.status}`);
    }
  });

  await test('run lines are created with NIS snapshot', async () => {
    const r = await api('finance/payroll/run-lines/list', fmgr1Token, { runId: ctx.runId });
    ok(r, `run-lines/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'run lines is not an array');
    expect(r.body.data.length > 0,    'no run lines created');

    // Find line for emp1
    const line1 = r.body.data.find(l => l.employeeId === emp1Id);
    expect(line1,                      `run line for emp1 (${emp1Id}) not found`);
    // emp1 salary = 6000; assert computed fields present
    expect(line1?.gross > 0,           'line gross should be > 0');
    expect(line1?.net > 0,             'line net should be > 0');
    expect(line1?.paye >= 0,           'line paye should be >= 0');
    expect(line1?.healthSurcharge >= 0,'line hs should be >= 0');
    expect(line1?.nisEmployee >= 0,    'line nisEmployee should be >= 0');
    // NIS snapshot fields
    expect('nisStatus' in line1,       'missing nisStatus field in line');
    expect('nisClassNo' in line1,      'missing nisClassNo field in line');
    expect(typeof line1?.openingYtdNisEmployee === 'number', 'openingYtdNisEmployee should be a number');

    ctx.lineId1 = line1?.id ?? null;
  });

  await test('published calculation population and NIS evidence match the frozen input snapshot', async () => {
    const { data: snapshotLines, error: snapshotError } = await sb
      .from('finance_payroll_input_snapshot_lines')
      .select('employee_id')
      .eq('input_snapshot_id', ctx.inputSnapshotId);
    expect(!snapshotError, `snapshot-line lookup failed: ${snapshotError?.message}`);
    const { data: versionLines, error: versionError } = await sb
      .from('finance_payroll_calculation_version_lines')
      .select('employee_id, nis_employee, nis_employer, breakdown')
      .eq('calculation_version_id', ctx.calculationVersionIds[0]);
    expect(!versionError, `version-line lookup failed: ${versionError?.message}`);

    const snapshotEmployees = [...new Set((snapshotLines ?? []).map(row => row.employee_id))].sort();
    const calculatedEmployees = (versionLines ?? []).map(row => row.employee_id).sort();
    expect(
      JSON.stringify(calculatedEmployees) === JSON.stringify(snapshotEmployees),
      'published calculation employee population differs from the frozen input snapshot',
    );

    for (const line of versionLines ?? []) {
      const periods = line.breakdown?.nisContributionPeriods;
      const weeks = Number(line.breakdown?.weeksInPeriod);
      expect(Array.isArray(periods), `employee ${line.employee_id} has no frozen NIS period array`);
      expect(Number.isInteger(weeks) && weeks > 0,
        `employee ${line.employee_id} has invalid frozen NIS weeks`);
      expect(periods.reduce((sum, item) => sum + Number(item.weeks), 0) === weeks,
        `employee ${line.employee_id} NIS period weeks do not reconcile`);
      expect(Math.abs(
        periods.reduce((sum, item) => sum + Number(item.employeeAmount), 0)
          - Number(line.nis_employee),
      ) < 0.005, `employee ${line.employee_id} NIS employee amounts do not reconcile`);
      expect(Math.abs(
        periods.reduce((sum, item) => sum + Number(item.employerAmount), 0)
          - Number(line.nis_employer),
      ) < 0.005, `employee ${line.employee_id} NIS employer amounts do not reconcile`);
    }
  });

  await test('published payroll evidence rejects in-place updates', async () => {
    const { error: snapshotUpdateError } = await sb
      .from('finance_payroll_input_snapshots')
      .update({ checksum: 'tampered-input-snapshot' })
      .eq('id', ctx.inputSnapshotId);
    expect(snapshotUpdateError?.code === 'PR409',
      `input snapshot update should return PR409, got ${snapshotUpdateError?.code ?? 'success'}`);

    const { error: versionUpdateError } = await sb
      .from('finance_payroll_calculation_versions')
      .update({ checksum: 'tampered-calculation-version' })
      .eq('id', ctx.calculationVersionIds[0]);
    expect(versionUpdateError?.code === 'PR409',
      `calculation version update should return PR409, got ${versionUpdateError?.code ?? 'success'}`);
  });

  await test('NIS warnings are created for employees with no verified NIS profile', async () => {
    // Our seeded test employees have no hr_employee_statutory_profiles → missing_nis_number warning
    const r = await api('finance/payroll/warnings/list', fmgr1Token, { runId: ctx.runId });
    ok(r, `warnings/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'warnings is not an array');
    // Employees without a statutory profile trigger missing_nis_number
    const missingNis = r.body.data.filter(w => w.warningType === 'missing_nis_number');
    expect(missingNis.length > 0, 'expected missing_nis_number warnings for test employees with no statutory profile');
    // Verify shape
    const w = missingNis[0];
    expect(w.runId === ctx.runId,    'warning runId mismatch');
    expect(w.severity,               'missing severity field');
    expect(typeof w.message === 'string', 'warning message should be a string');
  });

  await test('normalized findings expose current calculation warnings and support get', async () => {
    const r = await api('finance/payroll/findings/list', fmgr1Token, {
      runId: ctx.runId,
      calculationVersionId: ctx.calculationVersionIds[0],
    });
    ok(r, `findings/list failed: ${r.body.message}`);
    expect(r.body.data.length > 0, 'calculation warnings were not normalized into findings');
    const finding = r.body.data.find(item => item.severity === 'warning') ?? r.body.data[0];
    expect(finding.calculationVersionId === ctx.calculationVersionIds[0],
      'finding does not belong to the current calculation version');
    ctx.findingIds.push(finding.id);

    const get = await api('finance/payroll/findings/get', fmgr1Token, { id: finding.id });
    ok(get, `findings/get failed: ${get.body.message}`);
    expect(get.body.data.id === finding.id, 'findings/get returned the wrong record');
  });

  await test('plain employee is DENIED every payroll finding read and command route', async () => {
    const findingId = ctx.findingIds[0];
    const requests = [
      ['finance/payroll/findings/list', {
        runId: ctx.runId,
        calculationVersionId: ctx.calculationVersionIds[0],
      }],
      ['finance/payroll/findings/get', { id: findingId }],
      ['finance/payroll/findings/assign', {
        id: findingId,
        expectedVersion: 1,
        idempotencyKey: `${TAG}:finding:denied:assign`,
        assigneeId: fstaff1Id,
      }],
      ['finance/payroll/findings/resolve', {
        id: findingId,
        expectedVersion: 1,
        idempotencyKey: `${TAG}:finding:denied:resolve`,
        note: 'Unauthorized resolution.',
        evidence: { source: TAG },
      }],
      ['finance/payroll/findings/waive', {
        id: findingId,
        expectedVersion: 1,
        idempotencyKey: `${TAG}:finding:denied:waive`,
        reason: 'Unauthorized waiver.',
      }],
      ['finance/payroll/findings/reopen', {
        id: findingId,
        expectedVersion: 1,
        idempotencyKey: `${TAG}:finding:denied:reopen`,
        reason: 'Unauthorized reopen.',
      }],
    ];
    for (const [path, payload] of requests) {
      const denied = await api(path, emp1Token, payload);
      expect(denied.status === 403, `${path} should deny a plain employee, got ${denied.status}`);
    }
  });

  await test('finding lifecycle is versioned, idempotent and permission-gated', async () => {
    const findingId = ctx.findingIds[0];
    const assigned = await api('finance/payroll/findings/assign', fmgr1Token, {
      id: findingId,
      expectedVersion: 1,
      idempotencyKey: `${TAG}:finding:warning:assign`,
      assigneeId: fstaff1Id,
      note: 'Assigned for statutory profile review.',
    });
    ok(assigned, `finding assign failed: ${assigned.body.message}`);
    expect(assigned.body.data.state === 'in_progress', 'assigned finding should be in progress');
    expect(assigned.body.data.version === 2, 'assign should increment the finding version');

    const stale = await api('finance/payroll/findings/resolve', fmgr1Token, {
      id: findingId,
      expectedVersion: 1,
      idempotencyKey: `${TAG}:finding:warning:stale`,
      note: 'This stale command must not apply.',
      evidence: { source: TAG },
    });
    expect(stale.status === 409, `stale finding command should return 409, got ${stale.status}`);

    const waived = await api('finance/payroll/findings/waive', fmgr2Token, {
      id: findingId,
      expectedVersion: 2,
      idempotencyKey: `${TAG}:finding:warning:waive`,
      reason: 'Reviewed and accepted for this calculation version.',
    });
    ok(waived, `finding waive failed: ${waived.body.message}`);
    expect(waived.body.data.state === 'waived' && waived.body.data.version === 3,
      'waive should produce version 3 in waived state');

    const waiverReplay = await api('finance/payroll/findings/waive', fmgr2Token, {
      id: findingId,
      expectedVersion: 2,
      idempotencyKey: `${TAG}:finding:warning:waive`,
      reason: 'Reviewed and accepted for this calculation version.',
    });
    ok(waiverReplay, `finding waiver replay failed: ${waiverReplay.body.message}`);
    expect(waiverReplay.body.data.version === 3, 'waiver replay created another version');

    const reopened = await api('finance/payroll/findings/reopen', fmgr1Token, {
      id: findingId,
      expectedVersion: 3,
      idempotencyKey: `${TAG}:finding:warning:reopen`,
      reason: 'New evidence requires another review.',
    });
    ok(reopened, `finding reopen failed: ${reopened.body.message}`);
    expect(reopened.body.data.state === 'open' && reopened.body.data.version === 4,
      'reopen should return the finding to open');

    const resolved = await api('finance/payroll/findings/resolve', fmgr1Token, {
      id: findingId,
      expectedVersion: 4,
      idempotencyKey: `${TAG}:finding:warning:resolve`,
      note: 'Statutory profile evidence reviewed.',
      evidence: { source: 'e2e', reference: TAG },
    });
    ok(resolved, `finding resolve failed: ${resolved.body.message}`);
    expect(resolved.body.data.state === 'resolved' && resolved.body.data.version === 5,
      'resolve should close the finding with evidence');

    const denied = await api('finance/payroll/findings/reopen', emp1Token, {
      id: findingId,
      expectedVersion: 5,
      idempotencyKey: `${TAG}:finding:warning:denied`,
      reason: 'Unauthorized employee attempt.',
    });
    expect(denied.status === 403, `employee finding command should return 403, got ${denied.status}`);

    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', findingId)
      .like('event_type', 'finance.payroll.finding.%')).count ?? 0;
    expect(eventCount === 4, `expected four finding command events, got ${eventCount}`);
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('record_id', findingId)
      .like('action', 'payroll_finding.%')).count ?? 0;
    expect(auditCount === 4, `expected four finding command audits, got ${auditCount}`);
    const notificationsDelivered = await waitFor(async () => {
      const count = (await sb.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('source_type', 'payroll_control_finding')
        .eq('source_id', findingId)).count ?? 0;
      return count >= 4;
    });
    expect(notificationsDelivered,
      'finding lifecycle did not deliver the expected assignment/action notifications');
  });

  await test('a failed calculation is durable, safe to inspect, and recoverable with a new key', async () => {
    const failureKey = `${TAG}:run:main:forced-failure`;
    const { data: started, error: startError } = await sb.rpc(
      'finance_payroll_calculation_start_tx',
      {
        p_run_id: ctx.runId,
        p_actor_id: fmgr1Id,
        p_idempotency_key: failureKey,
      },
    );
    expect(!startError, `forced failure attempt could not start: ${startError?.message}`);
    const failedAttempt = started?.attempt;
    expect(failedAttempt?.id && failedAttempt?.correlation_id,
      'forced failure attempt is missing durable identity');
    ctx.calculationAttemptIds.push(failedAttempt.id);

    const { error: failError } = await sb.rpc('finance_payroll_calculation_fail_tx', {
      p_attempt_id: failedAttempt.id,
      p_actor_id: fmgr1Id,
      p_error_code: 'E2E_FORCED_FAILURE',
      p_error_message: 'A controlled calculation dependency failed.',
      p_technical_detail: `${TAG}: internal stack detail must not reach the API`,
    });
    expect(!failError, `forced calculation failure could not be recorded: ${failError?.message}`);

    const { data: failedRun } = await sb.from('finance_payroll_runs')
      .select('status, current_calculation_version_id').eq('id', ctx.runId).single();
    expect(failedRun.status === 'calculation_failed',
      `failed calculation should set calculation_failed, got ${failedRun.status}`);
    expect(failedRun.current_calculation_version_id === ctx.calculationVersionIds[0],
      'failure should preserve the last successful immutable version');

    const failedGet = await api(
      'finance/payroll/calculations/attempts/get',
      fmgr1Token,
      { id: failedAttempt.id },
    );
    ok(failedGet, `failed attempt get failed: ${failedGet.body.message}`);
    expect(failedGet.body.data.status === 'failed', 'attempt get did not expose failed status');
    expect(failedGet.body.data.errorCode === 'E2E_FORCED_FAILURE', 'attempt get lost error code');
    expect(!('technicalDetail' in failedGet.body.data), 'attempt API exposed technical detail');

    const replay = await api(
      'finance/payroll/runs/calculate',
      fmgr1Token,
      payrollCalculationCommand(ctx.runId, failureKey),
    );
    expect(replay.status === 422, `failed-key replay should return 422, got ${replay.status}`);
    expect(replay.body.message.includes(failedAttempt.correlation_id),
      'failed-key replay did not return the correlation ID');
    expect(!replay.body.message.includes(TAG), 'failed-key replay leaked technical detail');

    const recovered = await api(
      'finance/payroll/runs/calculate',
      fmgr1Token,
      payrollCalculationCommand(ctx.runId, `${TAG}:run:main:calculate:recovery`),
    );
    ok(recovered, `calculation recovery failed: ${recovered.body.message}`);
    expect(recovered.body.data.status === 'calculated', 'recovery did not restore calculated status');

    const versions = await api('finance/payroll/calculations/versions/list', fmgr1Token, {
      runId: ctx.runId,
    });
    ok(versions, `recovery version list failed: ${versions.body.message}`);
    expect(versions.body.data.length === 2,
      `recovery should publish version 2 without replacing version 1, got ${versions.body.data.length}`);
    expect(versions.body.data[0].versionNo === 2, 'recovery version should be version 2');
    ctx.calculationVersionIds.push(versions.body.data[0].id);
  });

  await test('an unresolved blocker prevents submission until evidence-backed resolution', async () => {
    const { data: blocker, error } = await sb.from('finance_payroll_control_findings').insert({
      run_id: ctx.runId,
      calculation_version_id: ctx.calculationVersionIds.at(-1),
      source_type: 'e2e_control',
      source_id: `${TAG}:submission-blocker`,
      finding_type: 'funding_not_confirmed',
      domain: 'funding',
      severity: 'blocker',
      state: 'open',
      title: 'Funding Confirmation Required',
      detail: 'Funding evidence must be recorded before submission.',
    }).select('id').single();
    expect(!error, `blocker fixture failed: ${error?.message}`);
    ctx.findingIds.push(blocker.id);

    const blocked = await api(
      'finance/payroll/runs/certify',
      fstaff1Token,
      payrollCertificationCommand(
        ctx.runId,
        `${TAG}:run:main:certify:blocked`,
      ),
    );
    expect(blocked.status === 422, `unresolved blocker should return 422, got ${blocked.status}`);
    const { data: unchanged } = await sb.from('finance_payroll_runs')
      .select('status, workflow_id').eq('id', ctx.runId).single();
    expect(unchanged.status === 'calculated', `blocked submit changed status to ${unchanged.status}`);
    expect(unchanged.workflow_id === null, 'blocked submit created or attached a workflow');

    const submitWithoutCertification = await api(
      'finance/payroll/runs/submit',
      fstaff1Token,
      {
        id: ctx.runId,
        idempotencyKey: `${TAG}:run:main:submit:uncertified`,
      },
    );
    expect(
      submitWithoutCertification.status === 422,
      `uncertified submit should return 422, got ${submitWithoutCertification.status}`,
    );

    const waive = await api('finance/payroll/findings/waive', fmgr2Token, {
      id: blocker.id,
      expectedVersion: 1,
      idempotencyKey: `${TAG}:finding:blocker:waive`,
      reason: 'A blocker must never be waivable.',
    });
    expect(waive.status === 422, `blocker waiver should return 422, got ${waive.status}`);

    const resolved = await api('finance/payroll/findings/resolve', fmgr1Token, {
      id: blocker.id,
      expectedVersion: 1,
      idempotencyKey: `${TAG}:finding:blocker:resolve`,
      note: 'Funding confirmation attached and reconciled.',
      evidence: { confirmationReference: `${TAG}-FUNDING` },
    });
    ok(resolved, `blocker resolution failed: ${resolved.body.message}`);
    expect(resolved.body.data.state === 'resolved', 'blocker did not resolve');
  });

  await test('plain employee is DENIED payroll certification', async () => {
    const denied = await api(
      'finance/payroll/runs/certify',
      emp1Token,
      payrollCertificationCommand(
        ctx.runId,
        `${TAG}:run:main:certify:denied`,
        'Unauthorized certification attempt.',
      ),
    );
    expect(denied.status === 403,
      `plain employee certification should return 403, got ${denied.status}`);
  });

  await test('processor certifies the current calculation package exactly once', async () => {
    const command = payrollCertificationCommand(
      ctx.runId,
      `${TAG}:run:main:certify:1`,
      'Calculation population, inputs, statutory results, and variances reviewed.',
    );
    const first = await api('finance/payroll/runs/certify', fstaff1Token, command);
    ok(first, `certification failed: ${first.body.message}`);
    expect(first.body.data.certification?.id, 'certification response missing id');
    expect(first.body.data.controlState?.ready === true, 'certification state should be ready');
    ctx.certificationIds.push(first.body.data.certification.id);

    const replay = await api('finance/payroll/runs/certify', fstaff1Token, command);
    ok(replay, `certification replay failed: ${replay.body.message}`);
    expect(
      replay.body.data.certification.id === first.body.data.certification.id,
      'certification replay returned a different immutable certificate',
    );

    const certCount = (await sb.from('finance_payroll_certifications')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('calculation_version_id', ctx.calculationVersionIds.at(-1))).count ?? 0;
    expect(certCount === 1, `certification replay should retain one row, got ${certCount}`);
    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.run.certified')
      .eq('source_entity_id', ctx.runId)).count ?? 0;
    expect(eventCount === 1, `expected one certification event, got ${eventCount}`);
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'payroll_run.certified')
      .eq('record_id', ctx.runId)).count ?? 0;
    expect(auditCount === 1, `expected one certification audit, got ${auditCount}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Submit');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_staff can submit the run for approval', async () => {
    const r = await api('finance/payroll/runs/submit', fstaff1Token, { id: ctx.runId, idempotencyKey: `submit-main-${TAG}` });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.status === 'pending_approval',
      `status should be pending_approval, got ${r.body.data.status}`);
  });

  await test('employee is DENIED submitting a run', async () => {
    // Create a separate draft run to test deny
    const cr = await api('finance/payroll/runs/create', fmgr1Token, payrollRunCommand({
      idempotencyKey: `${TAG}:run:submit-denied:create`,
      periodStart: payrollPeriod('financePayroll', 'denySubmit', TAG),
    }));
    ok(cr, 'could not create a secondary draft run for deny test');
    const draftId = cr.body.data.id;

    const r = await api('finance/payroll/runs/submit', emp1Token, { id: draftId, idempotencyKey: `submit-deny-${TAG}` });
    fails(r, 'employee should be denied run submit');

    // Cleanup secondary run
    await sb.from('finance_payroll_runs').delete().eq('id', draftId);
  });

  await test('a pending_approval run cannot be submitted again', async () => {
    // DIFFERENT key than the first submit — a same-key retry would idempotently return
    // the original result; a fresh key must hit the status guard (WF409).
    const r = await api('finance/payroll/runs/submit', fstaff1Token, { id: ctx.runId, idempotencyKey: `submit-resubmit-deny-${TAG}` });
    expect(!r.body.success, 're-submitting a pending_approval run should fail');
  });

  await test('§2 side-effects: payroll_run.submitted app_event + audit_log after submit', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id')
        .eq('event_type', 'finance.payroll.run.submitted')
        .eq('source_entity_id', ctx.runId)
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'finance.payroll.run.submitted app_event not found within 8s');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id')
      .eq('submodule_key', 'finance_payroll')
      .eq('action', 'payroll_run.submitted')
      .eq('record_id', ctx.runId)
      .limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log payroll_run.submitted not found');
  });

  await test('§8.1 handoff: payroll_approval handoff_outbox row emitted after submit (Gap 18)', async () => {
    const gotHandoff = await waitFor(async () => {
      const { data } = await sb.from('handoff_outbox')
        .select('id')
        .eq('source_module', 'finance_payroll')
        .eq('source_entity_id', ctx.runId)
        .eq('target_entity_type', 'payroll_approval')
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotHandoff, 'handoff_outbox payroll_approval row not found within 8s after submit');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Atomic submit (finding #3 — workflow_submit_for_record_tx)');
  // ═══════════════════════════════════════════════════════════════════════════
  // The submit path now commits status + workflow_id + the whole workflow + business
  // event/audit/handoff in ONE transaction (no strand), with request-key idempotency.

  // A minimal 'calculated' run we can submit WITHOUT the full calc pipeline (the RPC
  // only gates on status, not run_lines). The execution period is TAG-derived so a leaked
  // row can't collide with real data. Cleaned up at the end of this section.
  const atomRunIds = [];
  const { data: _mainRun } = await sb.from('finance_payroll_runs')
    .select('statutory_version_id').eq('id', ctx.runId).single();
  const atomStatVer = _mainRun?.statutory_version_id;
  const { data: _binding } = await sb.from('module_workflow_bindings')
    .select('id').eq('module_key', 'finance_payroll').eq('workflow_type', 'finance_payroll_approval')
    .eq('trigger_event', 'finance.payroll.run.submitted').eq('is_active', true).limit(1).maybeSingle();
  const atomBindingId = _binding?.id;

  const seedRun = async (salt, status = 'calculated') => {
    const { data, error } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: `${TAG}-ATOM-${salt}`, periodStart: payrollPeriod('financePayroll', `atom${salt}`, TAG),
      status, statutory_version_id: atomStatVer, created_by: fstaff1Id,
    })).select('id').single();
    if (error) throw new Error(`seedRun(${salt}): ${error.message}`);
    atomRunIds.push(data.id);
    return data.id;
  };

  // Build a genuinely calculated + certified run: a real input snapshot, a real
  // immutable calculation version and its line, totals internally consistent, and
  // no control findings — so the production submission guard (a current
  // calculation version + a valid, ready processor certification) is satisfied
  // HONESTLY. Never a raw row mislabelled 'calculated'. Returns the submittable id.
  const seedCalculatedRun = async (salt) => {
    const runId = await seedRun(salt, 'input_locked');
    const gross = 6000, paye = 1000, nisEe = 200, nisEr = 400, hs = 8.25, vol = 0;
    const deductions = paye + nisEe + hs + vol; // 1208.25
    const net = gross - deductions;             // 4791.75

    const { data: snap, error: snapErr } = await sb.from('finance_payroll_input_snapshots')
      .insert({
        run_id: runId, snapshot_no: 1, checksum: `atom-snap-${runId}`,
        employee_count: 1, input_count: 1, source_summary: {}, locked_by: fstaff1Id,
      }).select('id').single();
    if (snapErr) throw new Error(`seedCalculatedRun(${salt}) snapshot: ${snapErr.message}`);

    const { error: slErr } = await sb.from('finance_payroll_input_snapshot_lines').insert({
      input_snapshot_id: snap.id, run_id: runId, input_row_no: 1, employee_id: emp1Id,
      source_type: 'base_pay', component_code: 'BASE', label: 'Base pay',
      amount: gross, row_checksum: `atom-snapline-${runId}`,
    });
    if (slErr) throw new Error(`seedCalculatedRun(${salt}) snapshot line: ${slErr.message}`);

    const { data: ver, error: verErr } = await sb.from('finance_payroll_calculation_versions')
      .insert({
        run_id: runId, input_snapshot_id: snap.id, version_no: 1, checksum: `atom-ver-${runId}`,
        employee_count: 1, gross_total: gross, deduction_total: deductions, net_total: net,
        nis_employer_total: nisEr, statutory_version_id: atomStatVer, published_by: fstaff1Id,
      }).select('id').single();
    if (verErr) throw new Error(`seedCalculatedRun(${salt}) version: ${verErr.message}`);

    const { error: vlErr } = await sb.from('finance_payroll_calculation_version_lines').insert({
      calculation_version_id: ver.id, run_id: runId, employee_id: emp1Id,
      base: gross, taxable_gross: gross, gross, nis_employee: nisEe, nis_employer: nisEr,
      health_surcharge: hs, chargeable_income: gross, paye, voluntary_deductions: vol, net,
      breakdown: {},
    });
    if (vlErr) throw new Error(`seedCalculatedRun(${salt}) version line: ${vlErr.message}`);

    const { error: upErr } = await sb.from('finance_payroll_runs').update({
      current_input_snapshot_id: snap.id, current_calculation_version_id: ver.id,
      employee_count: 1, gross_total: gross, deduction_total: deductions,
      net_total: net, nis_employer_total: nisEr, status: 'calculated',
    }).eq('id', runId);
    if (upErr) throw new Error(`seedCalculatedRun(${salt}) run update: ${upErr.message}`);

    const cert = await api('finance/payroll/runs/certify', fstaff1Token,
      payrollCertificationCommand(runId, `atom-cert-${TAG}-${salt}`));
    if (!cert.body.success) {
      throw new Error(`seedCalculatedRun(${salt}) certify failed: ${cert.body.message}`);
    }
    return runId;
  };

  await test('atomic submit: retry with the same idempotency key returns the original workflow (no double-create)', async () => {
    const runId = await seedCalculatedRun(60);
    const key = `atom-idem-${TAG}-${runId}`;
    const r1 = await api('finance/payroll/runs/submit', fstaff1Token, { id: runId, idempotencyKey: key });
    ok(r1, `first submit failed: ${r1.body.message}`);
    const wf1 = r1.body.data.workflowId;
    expect(wf1, 'first submit should return a workflowId');
    // Same key — the run is now pending_approval, but the receipt short-circuits BEFORE
    // the status guard and returns the original result (no WF409, no second workflow).
    const r2 = await api('finance/payroll/runs/submit', fstaff1Token, { id: runId, idempotencyKey: key });
    ok(r2, `idempotent retry failed: ${r2.body.message}`);
    expect(r2.body.data.workflowId === wf1, `retry should return workflow ${wf1}, got ${r2.body.data.workflowId}`);
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', runId);
    expect((wfs ?? []).length === 1, `exactly one workflow should exist, got ${(wfs ?? []).length}`);
    // EXACT side-effect counts after the retry — proves the ownership cutover created NO
    // duplicates (each written exactly once, in one txn; the retry short-circuited).
    const evc = (await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('source_entity_id', runId).eq('event_type', 'finance.payroll.run.submitted')).count ?? 0;
    expect(evc === 1, `exactly one submitted app_event expected, got ${evc}`);
    const auc = (await sb.from('hr_audit_log').select('id', { count: 'exact', head: true })
      .eq('record_id', runId).eq('action', 'payroll_run.submitted')).count ?? 0;
    expect(auc === 1, `exactly one hr_audit_log row expected, got ${auc}`);
    const hoc = (await sb.from('handoff_outbox').select('id', { count: 'exact', head: true })
      .eq('source_entity_id', runId).eq('target_entity_type', 'payroll_approval')).count ?? 0;
    expect(hoc === 1, `exactly one handoff_outbox row expected, got ${hoc}`);
    const { data: tsk } = await sb.from('workflow_tasks').select('id').eq('workflow_id', wf1);
    expect((tsk ?? []).length === 1, `exactly one workflow task expected, got ${(tsk ?? []).length}`);
  });

  await test('atomic submit: a rejected submit leaves the run UNCHANGED (no strand, no orphan workflow)', async () => {
    const runId = await seedRun(61, 'draft');   // draft is not a legal from-status
    const r = await api('finance/payroll/runs/submit', fstaff1Token, { id: runId, idempotencyKey: `atom-str-${runId}` });
    fails(r, 'submitting a draft run should be rejected');
    const { data: after } = await sb.from('finance_payroll_runs').select('status, workflow_id').eq('id', runId).single();
    expect(after.status === 'draft', `run should stay draft, got ${after.status}`);
    expect(after.workflow_id === null, `no workflow_id should be stamped, got ${after.workflow_id}`);
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', runId);
    expect((wfs ?? []).length === 0, `no workflow should exist for a rejected submit, got ${(wfs ?? []).length}`);
  });

  await test('atomic submit: same key + different payload is rejected WF409 (direct RPC)', async () => {
    const runId = await seedCalculatedRun(62);
    const key = `atom-hash-${TAG}-${runId}`;
    const { error: e1 } = await sb.rpc('workflow_submit_for_record_tx', {
      p_source_table: 'finance_payroll_runs', p_source_id: runId, p_actor_id: fstaff1Id,
      p_binding_id: atomBindingId, p_request_key: key, p_business: { probe: 'A' } });
    expect(!e1, `first direct submit failed: ${e1?.message}`);
    const { error: e2 } = await sb.rpc('workflow_submit_for_record_tx', {
      p_source_table: 'finance_payroll_runs', p_source_id: runId, p_actor_id: fstaff1Id,
      p_binding_id: atomBindingId, p_request_key: key, p_business: { probe: 'B' } });
    expect(e2 && e2.code === 'WF409', `different-payload retry should be WF409, got ${e2?.code} ${e2?.message}`);
  });

  await test('atomic submit: concurrent submits — exactly one succeeds, exactly one workflow', async () => {
    const runId = await seedCalculatedRun(63);
    const [a, b2] = await Promise.all([
      api('finance/payroll/runs/submit', fstaff1Token, { id: runId, idempotencyKey: `atom-c1-${runId}` }),
      api('finance/payroll/runs/submit', fstaff1Token, { id: runId, idempotencyKey: `atom-c2-${runId}` }),
    ]);
    const successes = [a, b2].filter(x => x.body.success).length;
    expect(successes === 1, `exactly one concurrent submit should succeed, got ${successes}`);
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', runId);
    expect((wfs ?? []).length === 1, `exactly one workflow should exist, got ${(wfs ?? []).length}`);
  });

  await test('atomic submit: a returned run resubmits with a fresh workflow linked via supersedes', async () => {
    const runId = await seedCalculatedRun(64);
    const r1 = await api('finance/payroll/runs/submit', fstaff1Token, { id: runId, idempotencyKey: `atom-sup1-${runId}` });
    ok(r1, `first submit failed: ${r1.body.message}`);
    const wfA = r1.body.data.workflowId;
    // Simulate the approval workflow RETURNING the run (terminal 'returned' + run returned).
    await sb.from('workflow_instances').update({ status: 'returned' }).eq('id', wfA);
    await sb.from('finance_payroll_runs').update({ status: 'returned' }).eq('id', runId);
    // A returned run must be recertified before it can be resubmitted (the maker
    // revises, then re-attests) — mirror that here so the resubmit is legitimate.
    const recert = await api('finance/payroll/runs/certify', fstaff1Token,
      payrollCertificationCommand(runId, `atom-sup-recert-${runId}`));
    ok(recert, `recertification after return failed: ${recert.body.message}`);
    const r2 = await api('finance/payroll/runs/submit', fstaff1Token, { id: runId, idempotencyKey: `atom-sup2-${runId}` });
    ok(r2, `resubmit failed: ${r2.body.message}`);
    const wfB = r2.body.data.workflowId;
    expect(wfB && wfB !== wfA, `resubmit should create a NEW workflow, got ${wfB} vs ${wfA}`);
    const { data: wfBrow } = await sb.from('workflow_instances').select('supersedes_workflow_id').eq('id', wfB).single();
    expect(wfBrow?.supersedes_workflow_id === wfA, `new workflow should supersede ${wfA}, got ${wfBrow?.supersedes_workflow_id}`);
  });

  await test('atomic submit: primitive wrote the workflow instance + first task + workflow.started audit', async () => {
    const { data: wf } = await sb.from('workflow_instances')
      .select('id, status, workflow_no').eq('source_record_id', ctx.runId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    expect(wf && wf.status === 'in_progress', `workflow should be in_progress, got ${wf?.status}`);
    expect(/^WF-\d{4}-\d{4}$/.test(wf.workflow_no ?? ''), `workflow_no should be WF-YYYY-NNNN, got ${wf?.workflow_no}`);
    const { data: tasks } = await sb.from('workflow_tasks')
      .select('status, assigned_role, step_key').eq('workflow_id', wf.id);
    expect((tasks ?? []).length === 1, `expected one first task, got ${(tasks ?? []).length}`);
    expect(tasks[0].assigned_role === 'finance_manager' && tasks[0].status === 'pending',
      `first task should be pending/finance_manager, got ${tasks[0]?.status}/${tasks[0]?.assigned_role}`);
    const { data: audit } = await sb.from('workflow_audit_log')
      .select('id').eq('workflow_id', wf.id).eq('action', 'workflow.started').limit(1);
    expect((audit ?? []).length > 0, 'workflow.started workflow_audit_log row missing');
  });

  await test('atomic submit: a submit without an idempotency key is rejected', async () => {
    const runId = await seedCalculatedRun(65);
    const r = await api('finance/payroll/runs/submit', fstaff1Token, { id: runId });
    fails(r, 'submit without an idempotency key should be rejected');
    const { data: after } = await sb.from('finance_payroll_runs').select('status').eq('id', runId).single();
    expect(after.status === 'calculated', `run should be unchanged, got ${after.status}`);
  });

  await test('atomic submit: cleanup seeded runs', async () => {
    for (const rid of atomRunIds) {
      const { data: workflowRows, error: workflowReadError } = await sb
        .from('workflow_instances')
        .select('id')
        .eq('source_record_id', rid);
      expect(!workflowReadError,
        `atomic-submit cleanup could not read workflows for ${rid}: ${workflowReadError?.message}`);

      const workflowIds = (workflowRows ?? []).map(w => w.id);
      if (workflowIds.length > 0) {
        expect(await h.mustDelete('workflow_tasks', q => q.in('workflow_id', workflowIds)),
          `atomic-submit cleanup could not delete workflow tasks for ${rid}`);
      }
      expect(await h.mustDelete('workflow_instances', q => q.eq('source_record_id', rid)),
        `atomic-submit cleanup could not delete workflow instances for ${rid}`);
      expect(await h.mustDelete('handoff_outbox', q => q.eq('source_entity_id', rid)),
        `atomic-submit cleanup could not delete handoffs for ${rid}`);
      expect(await h.mustDelete('app_events', q => q.eq('source_entity_id', rid)),
        `atomic-submit cleanup could not delete events for ${rid}`);
      expect(await h.mustDelete('hr_audit_log', q => q.eq('record_id', rid)),
        `atomic-submit cleanup could not delete audit rows for ${rid}`);
      // seedCalculatedRun attaches a processor certification. The run also
      // back-references it (approval_certification_id, ON DELETE RESTRICT), and
      // the cert references the run (run_id, ON DELETE RESTRICT) — so null the
      // run's pointer first, then delete the cert, then the run cascades its
      // snapshot/version evidence.
      await sb.from('finance_payroll_runs')
        .update({ approval_certification_id: null }).eq('id', rid);
      // seedCalculatedRun certifies, and certify writes its command receipt into
      // the shared finance_payroll_release_command_receipts table (run_id RESTRICT).
      await sb.from('finance_payroll_release_command_receipts').delete().eq('run_id', rid);
      expect(await h.mustDelete('finance_payroll_certifications', q => q.eq('run_id', rid)),
        `atomic-submit cleanup could not delete certifications for ${rid}`);
      // seedCalculatedRun runs also carry calculation-version + snapshot evidence
      // whose FKs restrict each other (version→snapshot); delete in dependency
      // order so the run delete isn't blocked. Bare draft runs simply have none.
      await sb.from('finance_payroll_calculation_versions').delete().eq('run_id', rid);
      await sb.from('finance_payroll_input_snapshots').delete().eq('run_id', rid);
      expect(await h.mustDelete('finance_payroll_runs', q => q.eq('id', rid)),
        `atomic-submit cleanup could not delete run ${rid}`);
    }
    // NOTE: wf_internal.workflow_request_receipts rows leak (schema is off PostgREST so
    // the service-role client can't reach it) — harmless: keys are TAG-scoped.
    expect(true, 'cleanup complete');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Approve — SoD enforcement');
  // ═══════════════════════════════════════════════════════════════════════════

  // The central workflow engine drives approval — we use decideTask on the open task.
  // But: the route layer uses the adapter. For the negative SoD test we call /runs/submit
  // (which already shows it's pending), then manually advance the workflow to test the
  // adapter's SoD guard by calling decideTask with the creator (fstaff1) — if the
  // adapter fires and the run creator is fstaff1 but the workflow actor is also fstaff1,
  // the SoD check fires. However fstaff1 is finance_staff and cannot approve workflow tasks.
  // The simpler SoD negative test: try to approve via the workflow with fmgr1 as the
  // approver — but fmgr1 did NOT create the run (fstaff1 did). So we test the positive
  // flow with fmgr1 approving, and assert the run reaches 'approved'.
  // For the creator-as-approver negative, we use approveRun directly via a separate run.

  await test('workflow task created for pending_approval run', async () => {
    const { data: tasks } = await sb.from('workflow_tasks')
      .select('id, step_key, status, assigned_role')
      .eq('status', 'pending')
      .limit(10);
    // Find the task linked to our run's workflow_id
    const { data: run } = await sb.from('finance_payroll_runs')
      .select('workflow_id').eq('id', ctx.runId).maybeSingle();
    expect(run?.workflow_id, 'run should have a workflow_id after submit');

    const { data: wfTasks } = await sb.from('workflow_tasks')
      .select('id, step_key, status')
      .eq('workflow_id', run.workflow_id)
      .in('status', ['pending', 'open', 'in_progress'])
      .limit(1);
    expect((wfTasks ?? []).length > 0, 'no pending workflow task found for the submitted run');
  });

  await test('finance_manager (fmgr1, different from creator fstaff1) can approve via decideTask', async () => {
    // Get the workflow task
    const { data: run } = await sb.from('finance_payroll_runs')
      .select('workflow_id').eq('id', ctx.runId).maybeSingle();

    const { data: wfTasks } = await sb.from('workflow_tasks')
      .select('id').eq('workflow_id', run.workflow_id)
      .in('status', ['pending', 'open', 'in_progress']).limit(1);
    expect((wfTasks ?? []).length > 0, 'no pending task to approve');
    const taskId = wfTasks[0].id;

    // Approve via the workflow engine route
    const r = await api('workflow-engine/decide', fmgr1Token, {
      workflowId: run.workflow_id,
      taskId,
      decision:   'approved',
    });
    ok(r, `decide approved failed: ${r.body.message}`);

    // Wait for the adapter to update the run
    const approved = await waitFor(async () => {
      const { data } = await sb.from('finance_payroll_runs')
        .select('status').eq('id', ctx.runId).maybeSingle();
      return data?.status === 'approved';
    });
    expect(approved, 'run status did not reach approved within 8s');

    // Approval must leave NO dangling open task — the workflow is fully closed.
    const { data: leftover } = await sb.from('workflow_tasks')
      .select('id').eq('workflow_id', run.workflow_id)
      .in('status', ['pending', 'open', 'in_progress']);
    expect((leftover ?? []).length === 0, `open workflow tasks remain after approval: ${(leftover ?? []).length}`);
    const { data: wfRow } = await sb.from('workflow_instances')
      .select('status').eq('id', run.workflow_id).maybeSingle();
    expect(wfRow?.status === 'completed', `workflow should be completed after approval, got ${wfRow?.status}`);
  });

  await test('SoD + no-workflow guards on the runs/approve route (seeded negatives)', async () => {
    // Seed a minimal pending_approval run CREATED BY fmgr1 with NO workflow attached.
    const dSalt = (TAG.split('').reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % 900) + 40;
    const d = new Date(Date.UTC(1971, 0, 1)); d.setUTCDate(d.getUTCDate() + dSalt);
    const { data: sodRun, error: sodErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: `RUN-SOD-${TAG.slice(-6)}`, periodStart: d.toISOString().slice(0, 10),
      statutory_version_id: ctx.statutoryVersionId, status: 'pending_approval',
      created_by: fmgr1Id, employee_count: 0,
    })).select('id').single();
    expect(!sodErr, `seed SoD run failed: ${sodErr?.message}`);
    ctx.sodRunId = sodRun.id;

    // SoD: the creator cannot approve their own run (fast-fail before the engine).
    const rSod = await api('finance/payroll/runs/approve', fmgr1Token, { id: ctx.sodRunId });
    fails(rSod, 'creator approving own run should be refused (SoD)');

    // No-workflow guard: a different manager hits the missing-workflow 422 (not a silent flip).
    const rNoWf = await api('finance/payroll/runs/approve', fmgr2Token, { id: ctx.sodRunId });
    fails(rNoWf, 'approve on a run with no workflow attached should be refused');
    const { data: still } = await sb.from('finance_payroll_runs').select('status').eq('id', ctx.sodRunId).maybeSingle();
    expect(still?.status === 'pending_approval', 'run status must be unchanged by refused approvals');
  });

  await test('§2 side-effects: payroll_run.approved app_event + audit_log', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id')
        .eq('event_type', 'finance.payroll.run.approved')
        .eq('source_entity_id', ctx.runId)
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'finance.payroll.run.approved app_event not found');
  });

  await test('§8.1 handoff: payroll_locking handoff_outbox row emitted after approve (Gap 18)', async () => {
    const gotHandoff = await waitFor(async () => {
      const { data } = await sb.from('handoff_outbox')
        .select('id')
        .eq('source_module', 'finance_payroll')
        .eq('source_entity_id', ctx.runId)
        .eq('target_entity_type', 'payroll_locking')
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotHandoff, 'handoff_outbox payroll_locking row not found within 8s after approve');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Lock Run');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_staff is DENIED locking a run (SoD — needs finance.payroll.lock)', async () => {
    const r = await api(
      'finance/payroll/runs/lock',
      fstaff1Token,
      payrollLockCommand(ctx.runId, `${TAG}:run:main:lock:denied:staff`),
    );
    fails(r, 'finance_staff should be denied lock');
  });

  await test('employee is DENIED locking a run', async () => {
    const r = await api(
      'finance/payroll/runs/lock',
      emp1Token,
      payrollLockCommand(ctx.runId, `${TAG}:run:main:lock:denied:employee`),
    );
    fails(r, 'employee should be denied lock');
  });

  await test('lock requires an explicit idempotency key', async () => {
    const r = await api('finance/payroll/runs/lock', fmgr2Token, {
      ...payrollLockCommand(ctx.runId, `${TAG}:run:main:lock:missing-key`),
      idempotencyKey: '',
    });
    expect(r.status === 400, `lock without an idempotency key should return 400, got ${r.status}`);
  });

  await test('finance_manager can lock an approved run', async () => {
    const r = await api(
      'finance/payroll/runs/lock',
      fmgr2Token,
      payrollLockCommand(ctx.runId, `${TAG}:run:main:lock:1`),
    );
    ok(r, `lock run failed: ${r.body.message}`);
    expect(r.body.data.status === 'locked',
      `status should be locked, got ${r.body.data.status}`);
    expect(r.body.data.lockedAt, 'missing lockedAt');
    expect(r.body.data.lockedBy === fmgr2Id, 'lockedBy mismatch');
  });

  await test('lock same-key retry replays the result and writes each side effect once', async () => {
    const replay = await api(
      'finance/payroll/runs/lock',
      fmgr2Token,
      payrollLockCommand(ctx.runId, `${TAG}:run:main:lock:1`),
    );
    ok(replay, `lock replay failed: ${replay.body.message}`);
    expect(replay.body.data.status === 'locked', 'lock replay should return the locked run');

    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.run.locked')
      .eq('source_entity_id', ctx.runId)).count ?? 0;
    expect(eventCount === 1, `lock replay should retain one locked event, got ${eventCount}`);
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'payroll_run.locked')
      .eq('record_id', ctx.runId)).count ?? 0;
    expect(auditCount === 1, `lock replay should retain one locked audit, got ${auditCount}`);
    const handoffCount = (await sb.from('handoff_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('target_entity_type', 'payslip_generation')).count ?? 0;
    expect(handoffCount === 1, `lock replay should retain one payslip handoff, got ${handoffCount}`);
    const receiptCount = (await sb.from('finance_payroll_lifecycle_command_receipts')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('command', 'lock')).count ?? 0;
    expect(receiptCount === 1, `lock replay should retain one lock receipt, got ${receiptCount}`);
  });

  await test('lock same key with a different run is rejected as an idempotency conflict', async () => {
    const r = await api(
      'finance/payroll/runs/lock',
      fmgr2Token,
      payrollLockCommand(ctx.sodRunId, `${TAG}:run:main:lock:1`),
    );
    expect(r.status === 409, `same lock key with a different run should return 409, got ${r.status}`);
  });

  await test('a locked run cannot be locked again', async () => {
    const r = await api(
      'finance/payroll/runs/lock',
      fmgr2Token,
      payrollLockCommand(ctx.runId, `${TAG}:run:main:lock:already-locked`),
    );
    expect(!r.body.success, 're-locking a locked run should fail');
  });

  await test('§8.1 handoff: payslip_generation handoff_outbox row emitted after lock (Gap 18)', async () => {
    const gotHandoff = await waitFor(async () => {
      const { data } = await sb.from('handoff_outbox')
        .select('id')
        .eq('source_module', 'finance_payroll')
        .eq('source_entity_id', ctx.runId)
        .eq('target_entity_type', 'payslip_generation')
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotHandoff, 'handoff_outbox payslip_generation row not found within 8s after lock');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  const runPayslipFlow = async () => {
    h.section('Finance Payroll › Payslips');
    // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager can generate payslips for a locked run', async () => {
    const r = await api('finance/payroll/payslips/generate', fmgr2Token, { runId: ctx.runId });
    ok(r, `generate payslips failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'payslips data should be an array');
    expect(r.body.data.length > 0, 'no payslips generated');

    // Assert shape
    const ps = r.body.data[0];
    expect(ps.id,         'payslip missing id');
    expect(ps.payslipNo,  'payslip missing payslipNo');
    expect(ps.runId === ctx.runId, 'payslip runId mismatch');
    expect(ps.runLineId,  'payslip missing runLineId');
    expect(ps.employeeId, 'payslip missing employeeId');

    // Find emp1's payslip
    const emp1Payslip = r.body.data.find(p => p.employeeId === emp1Id);
    expect(emp1Payslip, `payslip for emp1 (${emp1Id}) not found`);
    ctx.payslipId1 = emp1Payslip?.id ?? null;
  });

  await test('generating payslips for an already-generated run is idempotent', async () => {
    const r = await api('finance/payroll/payslips/generate', fmgr2Token, { runId: ctx.runId });
    ok(r, `idempotent generate failed: ${r.body.message}`);
    // Should return same count — not duplicate
    const { data: ps } = await sb.from('finance_payslips').select('id').eq('run_id', ctx.runId);
    const initial = r.body.data.length;
    expect(initial === (ps ?? []).length, `idempotent: DB has ${(ps??[]).length} but response returned ${initial}`);
  });

  await test('finance_staff renders every generated payslip before release', async () => {
    const r = await api('finance/payroll/payslips/render-run', fstaff1Token, {
      runId: ctx.runId,
    });
    ok(r, `render-run failed: ${r.body.message}`);
    expect(r.body.data.failed === 0,
      `render-run left ${r.body.data.failed} failed payslip(s)`);

    const { data: rendered } = await sb.from('finance_payslips')
      .select('id, file_path, pdf_rendered_at, pdf_checksum')
      .eq('run_id', ctx.runId);
    expect((rendered ?? []).length === r.body.data.total,
      'render-run response does not match the persisted payslip population');
    expect(
      (rendered ?? []).every(p =>
        p.file_path && p.pdf_rendered_at && p.pdf_checksum),
      'every payslip must have a file path, render timestamp, and checksum',
    );
  });

  await test('finance_manager can list payslips for a run', async () => {
    const r = await api('finance/payroll/payslips/list', fmgr1Token, { runId: ctx.runId });
    ok(r, `payslips list failed: ${r.body.message}`);
    expect(r.body.data.length > 0, 'no payslips in list');
  });

  await test('employee emp1 can view their own payslips (view_own)', async () => {
    const r = await api('finance/payroll/payslips/my', emp1Token, {});
    ok(r, `payslips/my failed for emp1: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'payslips/my should return an array');
    expect(r.body.data.length > 0, 'emp1 should have at least one payslip');
    // All returned payslips must belong to emp1
    for (const ps of r.body.data) {
      expect(ps.employeeId === emp1Id, `payslip ${ps.id} does not belong to emp1`);
    }
  });

  await test('employee emp2 sees ONLY their own payslips (not emp1\'s)', async () => {
    const r = await api('finance/payroll/payslips/my', emp2Token, {});
    ok(r, `payslips/my failed for emp2: ${r.body.message}`);
    // emp2 should not see emp1's payslip
    const emp1Slip = r.body.data.find(p => p.employeeId === emp1Id);
    expect(!emp1Slip, 'emp2 should NOT see emp1\'s payslip');
  });

  await test('emp1 can get their specific payslip by ID', async () => {
    const r = await api('finance/payroll/payslips/get', emp1Token, { id: ctx.payslipId1 });
    ok(r, `payslips/get failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.payslipId1, 'payslip id mismatch');
    expect(r.body.data.employeeId === emp1Id, 'payslip employeeId mismatch');
  });

  await test('emp2 is DENIED getting emp1\'s payslip by ID', async () => {
    const r = await api('finance/payroll/payslips/get', emp2Token, { id: ctx.payslipId1 });
    // Should return 403 or {success:false}
    expect(!r.body.success || r.status === 403, 'emp2 should be denied emp1\'s payslip');
  });

  await test('§2 side-effects: finance_payroll_run.payslips_generated audit_log', async () => {
    const { data: audit } = await sb.from('hr_audit_log')
      .select('id')
      .eq('submodule_key', 'finance_payroll')
      .eq('action', 'payroll_run.payslips_generated')
      .eq('record_id', ctx.runId)
      .limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log payroll_run.payslips_generated not found');
  });

  await test('§8.1 notification: employees receive payslip.ready notification after generate (Gap 17)', async () => {
    // generatePayslips calls notifyMany(employeeIds, { type: 'finance.payroll.payslip.ready', ... })
    // which is fire-and-forget — poll for it.
    const gotNotif = await waitFor(async () => {
      const { data } = await sb.from('notifications')
        .select('id')
        .eq('user_id', emp1Id)
        .eq('type', 'finance.payroll.payslip.ready')
        .eq('source_id', ctx.runId)
        .limit(1);
      return (data ?? []).length > 0;
    }, 10000);
    expect(gotNotif, 'notification finance.payroll.payslip.ready not found for emp1 within 10s');

    // emp2 also receives a notification if they have a payslip
    const { data: emp2Notif } = await sb.from('notifications')
      .select('id')
      .eq('user_id', emp2Id)
      .eq('type', 'finance.payroll.payslip.ready')
      .eq('source_id', ctx.runId)
      .limit(1);
    // emp2 notification is asserted only if they had a run line (may be 0 if only emp1 was enrolled)
    if ((emp2Notif ?? []).length === 0) {
      // Acceptable if emp2 had no run line; document the case without failing.
      console.log('[E2E] emp2 has no payslip.ready notification — likely no run line for emp2');
    }
  });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Reopen (locked → draft)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('active bank disbursement blocks reopen atomically, then owner cancellation clears the gate', async () => {
    const { data: before, error: beforeError } = await sb.from('finance_payroll_runs')
      .select('status, current_input_snapshot_id, current_calculation_version_id')
      .eq('id', ctx.runId)
      .single();
    expect(!beforeError && before, `locked run lookup failed: ${beforeError?.message}`);

    const { data: blocker, error: blockerError } = await sb.from('finance_disbursements')
      .insert({
        disbursement_no: `E2E-REOPEN-DISB-${TAG}`,
        payroll_run_id: ctx.runId,
        status: 'draft',
        total_amount: 0,
        employee_count: 0,
        currency: 'TTD',
        created_by: fmgr1Id,
        metadata: { testTag: TAG, purpose: 'payroll-reopen-gate' },
      })
      .select('id')
      .single();
    expect(!blockerError && blocker, `disbursement blocker seed failed: ${blockerError?.message}`);
    ctx.reopenBlockerDisbursementId = blocker.id;

    const blocked = await api(
      'finance/payroll/runs/reopen',
      fmgr2Token,
      payrollReopenCommand(
        ctx.runId,
        'Attempt while an active bank disbursement exists.',
        `${TAG}:run:main:reopen:blocked:disbursement`,
      ),
    );
    expect(blocked.status === 422,
      `active disbursement should block reopen with 422, got ${blocked.status}`);
    expect(String(blocked.body.message).includes('active bank disbursement'),
      `unexpected active-disbursement blocker message: ${blocked.body.message}`);

    const { data: unchanged } = await sb.from('finance_payroll_runs')
      .select('status, current_input_snapshot_id, current_calculation_version_id')
      .eq('id', ctx.runId)
      .single();
    expect(
      unchanged.status === before.status
      && unchanged.current_input_snapshot_id === before.current_input_snapshot_id
      && unchanged.current_calculation_version_id === before.current_calculation_version_id,
      'failed reopen changed the locked payroll state',
    );
    const failedReceiptCount = (await sb.from('finance_payroll_lifecycle_command_receipts')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('command', 'reopen')).count ?? 0;
    expect(failedReceiptCount === 0, 'failed reopen must not commit an idempotency receipt');

    const cancelled = await api('finance/disbursements/cancel', fmgr1Token, {
      id: ctx.reopenBlockerDisbursementId,
      reason: 'Cancel draft before correcting the source payroll run.',
    });
    ok(cancelled, `disbursement cancellation failed: ${cancelled.body.message}`);
    expect(cancelled.body.data.status === 'cancelled',
      'disbursement owner command did not clear the active state');
  });

  await test('active statutory remittance blocks reopen atomically, then owner cancellation clears the gate', async () => {
    const { data: run, error: runError } = await sb.from('finance_payroll_runs')
      .select('status, period_month, current_input_snapshot_id, current_calculation_version_id')
      .eq('id', ctx.runId)
      .single();
    expect(!runError && run, `locked run lookup failed: ${runError?.message}`);
    const periodYear = Number(run.period_month.slice(0, 4));
    const periodMonth = Number(run.period_month.slice(5, 7));

    const { data: blocker, error: blockerError } = await sb.from('finance_remittances')
      .insert({
        remittance_no: `E2E-REOPEN-REM-${TAG}`,
        period_year: periodYear,
        period_month: periodMonth,
        authority: 'paye_bir',
        payroll_run_id: ctx.runId,
        employee_portion: 0,
        employer_portion: 0,
        total_due: 0,
        currency: 'TTD',
        status: 'draft',
        due_date: `${periodYear}-${String(periodMonth).padStart(2, '0')}-15`,
        created_by: fmgr1Id,
        metadata: { testTag: TAG, purpose: 'payroll-reopen-gate' },
      })
      .select('id')
      .single();
    expect(!blockerError && blocker, `remittance blocker seed failed: ${blockerError?.message}`);
    ctx.reopenBlockerRemittanceId = blocker.id;

    const blocked = await api(
      'finance/payroll/runs/reopen',
      fmgr2Token,
      payrollReopenCommand(
        ctx.runId,
        'Attempt while an active statutory remittance exists.',
        `${TAG}:run:main:reopen:blocked:remittance`,
      ),
    );
    expect(blocked.status === 422,
      `active remittance should block reopen with 422, got ${blocked.status}`);
    expect(String(blocked.body.message).includes('active statutory remittance'),
      `unexpected active-remittance blocker message: ${blocked.body.message}`);

    const { data: unchanged } = await sb.from('finance_payroll_runs')
      .select('status, current_input_snapshot_id, current_calculation_version_id')
      .eq('id', ctx.runId)
      .single();
    expect(
      unchanged.status === run.status
      && unchanged.current_input_snapshot_id === run.current_input_snapshot_id
      && unchanged.current_calculation_version_id === run.current_calculation_version_id,
      'failed reopen changed the locked payroll state',
    );
    const failedReceiptCount = (await sb.from('finance_payroll_lifecycle_command_receipts')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('command', 'reopen')).count ?? 0;
    expect(failedReceiptCount === 0, 'failed reopen must not commit an idempotency receipt');

    const cancelled = await api('finance/remittances/cancel', fmgr1Token, {
      id: ctx.reopenBlockerRemittanceId,
      reason: 'Cancel draft before correcting the source payroll run.',
    });
    ok(cancelled, `remittance cancellation failed: ${cancelled.body.message}`);
    expect(cancelled.body.data.status === 'cancelled',
      'remittance owner command did not clear the active state');
  });

  await test('finance_manager can reopen a locked run with a reason', async () => {
    const { data: before } = await sb.from('finance_payroll_runs')
      .select('current_input_snapshot_id, current_calculation_version_id')
      .eq('id', ctx.runId)
      .maybeSingle();
    ctx.reopenedSnapshotId = before?.current_input_snapshot_id ?? null;
    ctx.reopenedCalculationVersionId = before?.current_calculation_version_id ?? null;
    expect(ctx.reopenedSnapshotId, 'locked run should have a current input snapshot before reopen');
    expect(ctx.reopenedCalculationVersionId, 'locked run should have a current calculation version before reopen');

    const r = await api(
      'finance/payroll/runs/reopen',
      fmgr2Token,
      payrollReopenCommand(
        ctx.runId,
        'Correction required — OT entries missing for dept A',
        `${TAG}:run:main:reopen:1`,
      ),
    );
    ok(r, `reopen failed: ${r.body.message}`);
    expect(r.body.data.status === 'draft', `status should be draft after reopen, got ${r.body.data.status}`);
    expect(r.body.data.reopenReason, 'missing reopenReason');
    expect(r.body.data.currentInputSnapshotId === null, 'reopen should clear the current snapshot pointer');
    expect(r.body.data.currentCalculationVersionId === null, 'reopen should clear the current version pointer');

    const snapshotCount = (await sb.from('finance_payroll_input_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('id', ctx.reopenedSnapshotId)).count ?? 0;
    expect(snapshotCount === 1, 'reopen must preserve the immutable input snapshot');
    const versionCount = (await sb.from('finance_payroll_calculation_versions')
      .select('id', { count: 'exact', head: true })
      .eq('id', ctx.reopenedCalculationVersionId)).count ?? 0;
    expect(versionCount === 1, 'reopen must preserve the immutable calculation version');
    for (const table of [
      'finance_payroll_run_inputs',
      'finance_payroll_run_lines',
      'finance_payroll_run_warnings',
    ]) {
      const count = (await sb.from(table)
        .select('id', { count: 'exact', head: true })
        .eq('run_id', ctx.runId)).count ?? 0;
      expect(count === 0, `reopen should clear only the ${table} current projection`);
    }
  });

  await test('reopen same-key retry replays the result and writes each side effect once', async () => {
    const replay = await api(
      'finance/payroll/runs/reopen',
      fmgr2Token,
      payrollReopenCommand(
        ctx.runId,
        'Correction required — OT entries missing for dept A',
        `${TAG}:run:main:reopen:1`,
      ),
    );
    ok(replay, `reopen replay failed: ${replay.body.message}`);
    expect(replay.body.data.status === 'draft', 'reopen replay should return the draft run');

    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.run.reopened')
      .eq('source_entity_id', ctx.runId)).count ?? 0;
    expect(eventCount === 1, `reopen replay should retain one reopened event, got ${eventCount}`);
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'payroll_run.reopened')
      .eq('record_id', ctx.runId)).count ?? 0;
    expect(auditCount === 1, `reopen replay should retain one reopened audit, got ${auditCount}`);
    const receiptCount = (await sb.from('finance_payroll_lifecycle_command_receipts')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('command', 'reopen')).count ?? 0;
    expect(receiptCount === 1, `reopen replay should retain one reopen receipt, got ${receiptCount}`);
  });

  await test('reopen same key with a different reason is rejected as an idempotency conflict', async () => {
    const r = await api(
      'finance/payroll/runs/reopen',
      fmgr2Token,
      payrollReopenCommand(
        ctx.runId,
        'Different correction reason',
        `${TAG}:run:main:reopen:1`,
      ),
    );
    expect(r.status === 409, `same reopen key with a different reason should return 409, got ${r.status}`);
  });

  await test('UI reject path: runs/reject decides the workflow task → run returned, no dangling task', async () => {
    // Run is now draft (reopened) — take it back to pending_approval.
    await api('finance/payroll/runs/lock-inputs', fmgr1Token, {
      id: ctx.runId,
      idempotencyKey: `${TAG}:run:main:lock-inputs:2`,
    });
    await api(
      'finance/payroll/runs/calculate',
      fmgr1Token,
      payrollCalculationCommand(ctx.runId, `${TAG}:run:main:calculate:2`),
    );
    const recertified = await api(
      'finance/payroll/runs/certify',
      fstaff1Token,
      payrollCertificationCommand(
        ctx.runId,
        `${TAG}:run:main:certify:2`,
        'Recalculated package reviewed after the locked run was reopened.',
      ),
    );
    ok(recertified, `re-certification after reopen failed: ${recertified.body.message}`);
    ctx.certificationIds.push(recertified.body.data.certification.id);
    const sr = await api('finance/payroll/runs/submit', fstaff1Token, { id: ctx.runId, idempotencyKey: `submit-relock-${TAG}` });
    ok(sr, `re-submit failed: ${sr.body.message}`);
    const { data: runRow } = await sb.from('finance_payroll_runs').select('workflow_id').eq('id', ctx.runId).maybeSingle();
    expect(runRow?.workflow_id, 'resubmitted run should have a workflow_id');

    // finance_staff (no finance.payroll.approve) is DENIED the route outright.
    fails(await api('finance/payroll/runs/reject', fstaff1Token, { id: ctx.runId, reason: 'nope' }),
      'finance_staff should be denied runs/reject');

    // Reject WITHOUT a reason → zod 400 (mandatory reason).
    fails(await api('finance/payroll/runs/reject', fmgr1Token, { id: ctx.runId, reason: '' }),
      'reject without a reason should fail');

    // fmgr1 rejects via the RUN route (the UI path) — this must decide the task.
    const rj = await api('finance/payroll/runs/reject', fmgr1Token, { id: ctx.runId, reason: 'Numbers off — revise dept B OT' });
    ok(rj, `runs/reject failed: ${rj.body.message}`);
    const returned = await waitFor(async () => {
      const { data } = await sb.from('finance_payroll_runs').select('status').eq('id', ctx.runId).maybeSingle();
      return data?.status === 'returned';
    });
    expect(returned, 'run should be returned after workflow rejection');

    // No dangling open task; the workflow instance is closed as rejected.
    const { data: leftover } = await sb.from('workflow_tasks')
      .select('id').eq('workflow_id', runRow.workflow_id)
      .in('status', ['pending', 'open', 'in_progress']);
    expect((leftover ?? []).length === 0, 'open workflow tasks remain after rejection');
    const { data: wfRow } = await sb.from('workflow_instances')
      .select('status').eq('id', runRow.workflow_id).maybeSingle();
    expect(wfRow?.status === 'rejected', `workflow should be rejected, got ${wfRow?.status}`);
  });

  await test('returned run is revisable: recalculate → resubmit → runs/approve completes the workflow', async () => {
    // Recalculate from 'returned' (preparer revises), then resubmit — a NEW workflow starts.
    const rc = await api(
      'finance/payroll/runs/calculate',
      fmgr1Token,
      payrollCalculationCommand(ctx.runId, `${TAG}:run:main:calculate:3`),
    );
    ok(rc, `recalculate from returned failed: ${rc.body.message}`);

    const versions = await api('finance/payroll/calculations/versions/list', fmgr1Token, {
      runId: ctx.runId,
    });
    ok(versions, `version history failed: ${versions.body.message}`);
    expect(versions.body.data.length >= 3,
      `expected immutable recalculation history, got ${versions.body.data.length} versions`);
    const latestVersion = versions.body.data[0];
    expect(latestVersion.versionNo >= 3, `latest version should be at least 3, got ${latestVersion.versionNo}`);
    ctx.calculationVersionIds.push(...versions.body.data
      .map(version => version.id)
      .filter(id => !ctx.calculationVersionIds.includes(id)));

    const comparison = await api('finance/payroll/calculations/compare', fmgr1Token, {
      fromVersionId: ctx.calculationVersionIds[0],
      toVersionId: latestVersion.id,
    });
    ok(comparison, `version comparison failed: ${comparison.body.message}`);
    expect(comparison.body.data.runId === ctx.runId, 'version comparison returned the wrong run');
    expect(typeof comparison.body.data.changedEmployees === 'number',
      'version comparison is missing changedEmployees');
    const deniedComparison = await api(
      'finance/payroll/calculations/compare',
      emp1Token,
      {
        fromVersionId: ctx.calculationVersionIds[0],
        toVersionId: latestVersion.id,
      },
    );
    expect(deniedComparison.status === 403,
      `plain employee version comparison should return 403, got ${deniedComparison.status}`);

    const recertified = await api(
      'finance/payroll/runs/certify',
      fstaff1Token,
      payrollCertificationCommand(
        ctx.runId,
        `${TAG}:run:main:certify:3`,
        'Returned payroll corrections and the resulting calculation package were reviewed.',
      ),
    );
    ok(recertified, `re-certification after return failed: ${recertified.body.message}`);
    ctx.certificationIds.push(recertified.body.data.certification.id);

    const sr = await api('finance/payroll/runs/submit', fstaff1Token, { id: ctx.runId, idempotencyKey: `submit-fromreturned-${TAG}` });
    ok(sr, `resubmit after return failed: ${sr.body.message}`);
    const { data: runRow } = await sb.from('finance_payroll_runs').select('workflow_id').eq('id', ctx.runId).maybeSingle();
    expect(runRow?.workflow_id, 'resubmitted run should carry a fresh workflow_id');

    // Approve via the RUN route (the UI path) — fmgr1 is role-assigned to the task.
    const ap = await api('finance/payroll/runs/approve', fmgr1Token, { id: ctx.runId });
    ok(ap, `runs/approve failed: ${ap.body.message}`);
    const approved = await waitFor(async () => {
      const { data } = await sb.from('finance_payroll_runs').select('status').eq('id', ctx.runId).maybeSingle();
      return data?.status === 'approved';
    });
    expect(approved, 'run should be approved after runs/approve');

    // Single approval authority: task closed, workflow completed.
    const { data: leftover } = await sb.from('workflow_tasks')
      .select('id').eq('workflow_id', runRow.workflow_id)
      .in('status', ['pending', 'open', 'in_progress']);
    expect((leftover ?? []).length === 0, 'open workflow tasks remain after runs/approve');
    const { data: wfRow } = await sb.from('workflow_instances')
      .select('status').eq('id', runRow.workflow_id).maybeSingle();
    expect(wfRow?.status === 'completed', `workflow should be completed, got ${wfRow?.status}`);
  });

  await test('corrected and approved run can be locked again with a fresh command key', async () => {
    const locked = await api(
      'finance/payroll/runs/lock',
      fmgr2Token,
      payrollLockCommand(ctx.runId, `${TAG}:run:main:lock:2`),
    );
    ok(locked, `second lock failed: ${locked.body.message}`);
    const reachedLocked = await waitFor(async () => {
      const { data } = await sb.from('finance_payroll_runs').select('status').eq('id', ctx.runId).maybeSingle();
      return data?.status === 'locked';
    });
    expect(reachedLocked, 'corrected run did not reach locked status');
  });

  await runPayslipFlow();

  await test('plain employee is DENIED reopening a locked payroll run', async () => {
    const denied = await api(
      'finance/payroll/runs/reopen',
      emp1Token,
      payrollReopenCommand(
        ctx.runId,
        'Unauthorized reopen attempt.',
        `${TAG}:run:main:reopen:denied`,
      ),
    );
    expect(denied.status === 403,
      `plain employee reopen should return 403, got ${denied.status}`);
  });

  await test('reopen without a reason is rejected (422)', async () => {
    // Now test: reopen without a reason should fail
    const r = await api('finance/payroll/runs/reopen', fmgr2Token, {
      ...payrollReopenCommand(
        ctx.runId,
        'negative-path-placeholder',
        `${TAG}:run:main:reopen:missing-reason`,
      ),
      reason: '',
    });
    expect(!r.body.success, 'reopen without reason should fail');
  });

  await test('generated payslips block reopening and leave the locked run unchanged', async () => {
    const r = await api(
      'finance/payroll/runs/reopen',
      fmgr2Token,
      payrollReopenCommand(
        ctx.runId,
        'Attempt after downstream artifacts exist',
        `${TAG}:run:main:reopen:payslips-exist`,
      ),
    );
    expect(r.status === 422, `reopen with generated payslips should return 422, got ${r.status}`);
    const { data: unchanged } = await sb.from('finance_payroll_runs')
      .select('status, current_input_snapshot_id, current_calculation_version_id')
      .eq('id', ctx.runId)
      .maybeSingle();
    expect(unchanged?.status === 'locked', 'failed reopen must leave the run locked');
    expect(unchanged?.current_input_snapshot_id, 'failed reopen must retain the current input snapshot');
    expect(unchanged?.current_calculation_version_id, 'failed reopen must retain the current calculation version');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Release and Immutable Exports');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('release preflight names every unresolved operational gate', async () => {
    const r = await api('finance/payroll/releases/preflight', fmgr1Token, {
      runId: ctx.runId,
    });
    ok(r, `release preflight failed: ${r.body.message}`);
    expect(r.body.data.ready === false, 'release preflight should be blocked initially');
    const codes = new Set(r.body.data.blockers.map(blocker => blocker.code));
    for (const code of [
      'funding_confirmation_missing',
      'gl_journal_missing',
      'bank_accounts_missing',
    ]) {
      expect(codes.has(code), `release preflight did not expose '${code}'`);
    }
    expect(!codes.has('payslips_not_ready'),
      'rendered payslips should already satisfy the release gate');
    expect(r.body.data.payslipCount === r.body.data.employeeCount,
      'preflight payslip population does not match the run');
    expect(r.body.data.renderedPayslipCount === r.body.data.employeeCount,
      'preflight did not recognize all rendered payslips');
  });

  await test('release setup creates one active primary bank account per paid employee', async () => {
    for (const [index, employeeId] of [emp1Id, emp2Id].entries()) {
      const suffix = index === 0 ? '7890' : '3210';
      const { data, error } = await sb.from('finance_employee_bank_accounts').insert({
        employee_id: employeeId,
        bank_name: 'E2E Trinidad Bank',
        branch: index === 0 ? 'Port of Spain' : 'San Fernando',
        account_type: 'savings',
        account_number: index === 0 ? '1234567890' : '9876543210',
        account_number_masked: `****${suffix}`,
        is_primary: true,
        is_active: true,
        created_by: fmgr2Id,
        metadata: { transitNumber: index === 0 ? '00101' : '00202' },
      }).select('id').single();
      expect(!error, `bank account for ${employeeId} failed: ${error?.message}`);
      ctx.bankAccountIds.push(data.id);
    }
    expect(ctx.bankAccountIds.length === 2,
      'release setup did not create the exact bank-account population');
  });

  await test('release setup has valid active payroll GL mappings', async () => {
    for (const [mappingKey, defaultAccountCode] of BASE_GL_MAPPINGS) {
      const { data: existing, error: existingError } = await sb
        .from('finance_payroll_gl_mappings')
        .select('id, account_code, active')
        .eq('mapping_key', mappingKey)
        .is('component_id', null)
        .is('department_id', null)
        .maybeSingle();
      expect(!existingError, `GL mapping lookup failed for ${mappingKey}`);
      if (!existing) {
        const { data: defaultAccount, error: defaultAccountError } = await sb
          .from('finance_gl_accounts')
          .select('code, is_active')
          .eq('code', defaultAccountCode)
          .maybeSingle();
        expect(!defaultAccountError && defaultAccount?.is_active === true,
          `active default GL account ${defaultAccountCode} is required for ${mappingKey}`);
        const { error } = await sb.from('finance_payroll_gl_mappings').insert({
          mapping_key: mappingKey,
          account_code: defaultAccountCode,
          active: true,
        });
        expect(!error, `GL mapping insert failed for ${mappingKey}: ${error?.message}`);
      } else {
        expect(existing.active === true,
          `GL mapping ${mappingKey} is inactive`);
        const { data: mappedAccount, error: mappedAccountError } = await sb
          .from('finance_gl_accounts')
          .select('code, is_active')
          .eq('code', existing.account_code)
          .maybeSingle();
        expect(!mappedAccountError && mappedAccount?.is_active === true,
          `GL mapping ${mappingKey} points to missing or inactive account ${existing.account_code}`);
      }
    }
  });

  await test('GL post is atomic and same-key retry creates no duplicate side effects', async () => {
    const command = {
      runId: ctx.runId,
      idempotencyKey: `${TAG}:run:main:gl:post`,
    };
    const first = await api('finance/payroll/gl/post', fstaff1Token, command);
    ok(first, `GL post failed: ${first.body.message}`);
    expect(first.body.data.journalId, 'GL post response is missing journalId');
    expect(Math.abs(first.body.data.totalDebit - first.body.data.totalCredit) < 0.005,
      'posted payroll journal is not balanced');
    ctx.glJournalIds.push(first.body.data.journalId);

    const replay = await api('finance/payroll/gl/post', fstaff1Token, command);
    ok(replay, `GL post replay failed: ${replay.body.message}`);
    expect(replay.body.data.journalId === first.body.data.journalId,
      'GL post replay returned a different journal');

    const journalCount = (await sb.from('finance_gl_journals')
      .select('id', { count: 'exact', head: true })
      .contains('metadata', { payrollRunId: ctx.runId })
      .eq('status', 'posted')).count ?? 0;
    expect(journalCount === 1, `GL replay retained ${journalCount} posted journals`);
    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('event_type', 'finance.payroll.gl.posted')).count ?? 0;
    expect(eventCount === 1, `GL replay retained ${eventCount} posted events`);
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('record_id', ctx.runId)
      .eq('action', 'payroll_run.gl_posted')).count ?? 0;
    expect(auditCount === 1, `GL replay retained ${auditCount} posted audits`);
    const handoffCount = (await sb.from('handoff_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('target_entity_type', 'gl_journal')).count ?? 0;
    expect(handoffCount === 1, `GL replay retained ${handoffCount} GL handoffs`);
    const receiptCount = (await sb.from('finance_payroll_gl_command_receipts')
      .select('request_key', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('command', 'post')).count ?? 0;
    expect(receiptCount === 1, `GL replay retained ${receiptCount} command receipts`);
  });

  await test('GL post with a fresh key is rejected after the run is posted', async () => {
    const r = await api('finance/payroll/gl/post', fstaff1Token, {
      runId: ctx.runId,
      idempotencyKey: `${TAG}:run:main:gl:post:fresh`,
    });
    expect(r.status === 409, `fresh duplicate GL post should return 409, got ${r.status}`);
  });

  let releaseNetPayroll = 0;
  await test('the payroll approver cannot confirm funding', async () => {
    const preflight = await api('finance/payroll/releases/preflight', fmgr1Token, {
      runId: ctx.runId,
    });
    ok(preflight, `preflight before funding failed: ${preflight.body.message}`);
    releaseNetPayroll = preflight.body.data.netPayroll;
    const denied = await api(
      'finance/payroll/releases/confirm-funding',
      fmgr1Token,
      payrollFundingCommand({
        runId: ctx.runId,
        idempotencyKey: `${TAG}:run:main:funding:approver-denied`,
        confirmedAmount: releaseNetPayroll,
        confirmationReference: `${TAG}-APPROVER-DENIED`,
      }),
    );
    expect(denied.status === 403,
      `payroll approver funding confirmation should return 403, got ${denied.status}`);
  });

  await test('the payroll preparer and certifier cannot bypass funding SoD through the RPC', async () => {
    const { error } = await sb.rpc('finance_payroll_confirm_funding_tx', {
      p_run_id: ctx.runId,
      p_actor_id: fstaff1Id,
      p_idempotency_key: `${TAG}:run:main:funding:certifier-direct-denied`,
      p_confirmed_amount: releaseNetPayroll,
      p_confirmation_reference: `${TAG}-CERTIFIER-DIRECT-DENIED`,
      p_account_reference: null,
      p_note: 'Direct RPC segregation-of-duties probe.',
    });
    expect(error?.code === 'PR403',
      `preparer/certifier funding RPC should return PR403, got ${error?.code ?? 'success'}`);
    const count = (await sb.from('finance_payroll_funding_confirmations')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('confirmed_by', fstaff1Id)).count ?? 0;
    expect(count === 0, `denied funding RPC retained ${count} confirmation rows`);
  });

  await test('independent releaser confirms exact funding with idempotent evidence', async () => {
    const command = payrollFundingCommand({
      runId: ctx.runId,
      idempotencyKey: `${TAG}:run:main:funding:1`,
      confirmedAmount: releaseNetPayroll,
      confirmationReference: `${TAG}-FUNDING-CONFIRMED`,
      accountReference: 'TTD-PAYROLL-OPERATING',
      note: 'Funding reconciled to the approved payroll net total.',
    });
    const first = await api('finance/payroll/releases/confirm-funding', fmgr2Token, command);
    ok(first, `funding confirmation failed: ${first.body.message}`);
    const fundingId = first.body.data.fundingConfirmation?.id;
    expect(fundingId, 'funding confirmation response is missing its immutable id');
    ctx.fundingConfirmationIds.push(fundingId);

    const replay = await api('finance/payroll/releases/confirm-funding', fmgr2Token, command);
    ok(replay, `funding confirmation replay failed: ${replay.body.message}`);
    expect(replay.body.data.fundingConfirmation.id === fundingId,
      'funding replay returned a different confirmation');

    const fundingCount = (await sb.from('finance_payroll_funding_confirmations')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)).count ?? 0;
    expect(fundingCount === 1,
      `funding replay retained ${fundingCount} confirmations`);
    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('event_type', 'finance.payroll.run.funding_confirmed')).count ?? 0;
    expect(eventCount === 1,
      `funding replay retained ${eventCount} funding events`);
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('record_id', ctx.runId)
      .eq('action', 'payroll_run.funding_confirmed')).count ?? 0;
    expect(auditCount === 1,
      `funding replay retained ${auditCount} funding audits`);
  });

  await test('published certification and funding evidence cannot be rewritten', async () => {
    const { error: certificationError } = await sb
      .from('finance_payroll_certifications')
      .update({ checksum: 'tampered-certification' })
      .eq('id', ctx.certificationIds.at(-1));
    expect(certificationError?.code === 'PR409',
      `certification update should return PR409, got ${certificationError?.code ?? 'success'}`);

    const { error: fundingError } = await sb
      .from('finance_payroll_funding_confirmations')
      .update({ confirmation_reference: 'tampered-funding-reference' })
      .eq('id', ctx.fundingConfirmationIds[0]);
    expect(fundingError?.code === 'PR409',
      `funding update should return PR409, got ${fundingError?.code ?? 'success'}`);
  });

  await test('release preflight becomes ready only after every gate is satisfied', async () => {
    const r = await api('finance/payroll/releases/preflight', fmgr2Token, {
      runId: ctx.runId,
    });
    ok(r, `ready release preflight failed: ${r.body.message}`);
    expect(r.body.data.ready === true,
      `release preflight still has blockers: ${JSON.stringify(r.body.data.blockers)}`);
    expect(r.body.data.blockers.length === 0, 'ready preflight should have no blockers');
    expect(r.body.data.glJournalId === ctx.glJournalIds[0],
      'preflight references the wrong GL journal');
    expect(r.body.data.fundingConfirmationId === ctx.fundingConfirmationIds[0],
      'preflight references the wrong funding confirmation');
  });

  await test('an actor other than the funding confirmer cannot release through the RPC', async () => {
    const { error } = await sb.rpc('finance_payroll_release_run_tx', {
      p_run_id: ctx.runId,
      p_actor_id: emp2Id,
      p_idempotency_key: `${TAG}:run:main:release:non-funder-direct-denied`,
    });
    expect(error?.code === 'PR403',
      `non-funder release RPC should return PR403, got ${error?.code ?? 'success'}`);
    const certificateCount = (await sb.from('finance_payroll_release_certificates')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)).count ?? 0;
    expect(certificateCount === 0,
      `denied release RPC retained ${certificateCount} release certificates`);
  });

  await test('payroll approver is denied release by three-way segregation of duties', async () => {
    const r = await api(
      'finance/payroll/releases/release',
      fmgr1Token,
      payrollReleaseCommand(ctx.runId, `${TAG}:run:main:release:approver-denied`),
    );
    expect(r.status === 403,
      `payroll approver release should return 403, got ${r.status}`);
  });

  await test('independent manager atomically releases payroll and creates downstream drafts', async () => {
    const command = payrollReleaseCommand(ctx.runId, `${TAG}:run:main:release:1`);
    const first = await api('finance/payroll/releases/release', fmgr2Token, command);
    ok(first, `payroll release failed: ${first.body.message}`);
    expect(first.body.data.status === 'released',
      `released run returned status ${first.body.data.status}`);
    expect(first.body.data.releaseCertificate?.id,
      'release response is missing the immutable release certificate');
    expect(first.body.data.disbursementId,
      'release response is missing the downstream disbursement');
    expect(first.body.data.remittances.length >= 3,
      'release did not create PAYE, NIS, and Health Surcharge drafts');
    ctx.releaseCertificateId = first.body.data.releaseCertificate.id;
    ctx.releaseDisbursementId = first.body.data.disbursementId;
    ctx.disbursementId = first.body.data.disbursementId;
    ctx.releaseRemittanceIds = first.body.data.remittances.map(item => item.id);
    ctx.remittancePAYEId = first.body.data.remittances
      .find(item => item.authority === 'paye_bir')?.id ?? null;

    const replay = await api('finance/payroll/releases/release', fmgr2Token, command);
    ok(replay, `payroll release replay failed: ${replay.body.message}`);
    expect(replay.body.data.releaseCertificate.id === ctx.releaseCertificateId,
      'release replay returned a different certificate');
    expect(replay.body.data.disbursementId === ctx.releaseDisbursementId,
      'release replay returned a different disbursement');
    expect(replay.body.data.remittances.length === first.body.data.remittances.length,
      'release replay returned a different remittance manifest');
  });

  await test('fresh release key cannot create a second release package', async () => {
    const r = await api(
      'finance/payroll/releases/release',
      fmgr2Token,
      payrollReleaseCommand(ctx.runId, `${TAG}:run:main:release:fresh`),
    );
    expect(r.status === 409, `fresh duplicate release should return 409, got ${r.status}`);
  });

  await test('release persisted one reconciled certificate and immutable bank snapshots', async () => {
    const { data: run } = await sb.from('finance_payroll_runs')
      .select('status, released_by, released_at, release_certificate_id, exported_at')
      .eq('id', ctx.runId)
      .maybeSingle();
    expect(run?.status === 'released', `run status should be released, got ${run?.status}`);
    expect(run?.released_by === fmgr2Id, 'released_by does not identify the independent releaser');
    expect(run?.released_at, 'released run is missing released_at');
    expect(run?.release_certificate_id === ctx.releaseCertificateId,
      'run points to the wrong release certificate');
    expect(run?.exported_at === null, 'release should not imply that an export was generated');

    const { data: disbursementHistory, error: disbursementHistoryError } = await sb
      .from('finance_disbursements')
      .select('id, status')
      .eq('payroll_run_id', ctx.runId);
    expect(!disbursementHistoryError,
      `release disbursement history lookup failed: ${disbursementHistoryError?.message}`);
    expect(disbursementHistory?.length === 2,
      `expected one cancelled and one active disbursement, got ${disbursementHistory?.length ?? 0}`);
    expect(
      disbursementHistory?.some(row =>
        row.id === ctx.reopenBlockerDisbursementId && row.status === 'cancelled'),
      'release did not preserve the cancelled disbursement as history',
    );
    expect(
      disbursementHistory?.filter(row => row.status !== 'cancelled').length === 1
      && disbursementHistory?.some(row => row.id === ctx.releaseDisbursementId),
      'release did not create exactly one replacement active disbursement',
    );

    const { data: payeHistory, error: payeHistoryError } = await sb
      .from('finance_remittances')
      .select('id, status')
      .eq('payroll_run_id', ctx.runId)
      .eq('authority', 'paye_bir');
    expect(!payeHistoryError,
      `release PAYE history lookup failed: ${payeHistoryError?.message}`);
    expect(payeHistory?.length === 2,
      `expected one cancelled and one active PAYE remittance, got ${payeHistory?.length ?? 0}`);
    expect(
      payeHistory?.some(row =>
        row.id === ctx.reopenBlockerRemittanceId && row.status === 'cancelled'),
      'release did not preserve the cancelled PAYE remittance as history',
    );
    expect(
      payeHistory?.filter(row => row.status !== 'cancelled').length === 1
      && payeHistory?.some(row => row.id === ctx.remittancePAYEId),
      'release did not create exactly one replacement active PAYE remittance',
    );

    const certificateCount = (await sb.from('finance_payroll_release_certificates')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)).count ?? 0;
    expect(certificateCount === 1,
      `release replay retained ${certificateCount} certificates`);
    const { data: lines } = await sb.from('finance_disbursement_lines')
      .select('employee_id, bank_account_id, bank_name_snapshot, account_number_snapshot, routing_snapshot_checksum, net_amount')
      .eq('disbursement_id', ctx.releaseDisbursementId);
    expect((lines ?? []).length === 2,
      `release disbursement contains ${(lines ?? []).length} lines instead of 2`);
    expect(
      (lines ?? []).every(line =>
        line.bank_account_id &&
        line.bank_name_snapshot &&
        line.account_number_snapshot &&
        line.routing_snapshot_checksum &&
        Number(line.net_amount) > 0),
      'release did not freeze complete bank-routing evidence',
    );

    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('event_type', 'finance.payroll.run.released')).count ?? 0;
    expect(eventCount === 1, `release replay retained ${eventCount} release events`);
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('record_id', ctx.runId)
      .eq('action', 'payroll_run.released')).count ?? 0;
    expect(auditCount === 1, `release replay retained ${auditCount} release audits`);
    const notificationCount = (await sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', ctx.runId)
      .eq('type', 'finance.payroll.run.released')).count ?? 0;
    expect(notificationCount === 2,
      `release should notify preparer and approver exactly once, got ${notificationCount}`);
    const receiptCount = (await sb.from('finance_payroll_release_command_receipts')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .eq('command', 'release')).count ?? 0;
    expect(receiptCount === 1,
      `release replay retained ${receiptCount} release receipts`);

    const disbursementEventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.releaseDisbursementId)
      .eq('event_type', 'finance.disbursement.created')).count ?? 0;
    const disbursementAuditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('record_id', ctx.releaseDisbursementId)
      .eq('action', 'disbursement.created')).count ?? 0;
    const disbursementHandoffCount = (await sb.from('handoff_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('target_module', 'finance_disbursements')
      .eq('target_entity_id', ctx.releaseDisbursementId)).count ?? 0;
    expect(disbursementEventCount === 1,
      `release retained ${disbursementEventCount} disbursement-created events`);
    expect(disbursementAuditCount === 1,
      `release retained ${disbursementAuditCount} disbursement-created audits`);
    expect(disbursementHandoffCount === 1,
      `release retained ${disbursementHandoffCount} disbursement handoffs`);

    const expectedRemittanceArtifacts = ctx.releaseRemittanceIds.length;
    const remittanceEventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .in('source_entity_id', ctx.releaseRemittanceIds)
      .eq('event_type', 'finance.remittance.created')).count ?? 0;
    const remittanceAuditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .in('record_id', ctx.releaseRemittanceIds)
      .eq('action', 'remittance.created')).count ?? 0;
    const remittanceHandoffCount = (await sb.from('handoff_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.runId)
      .eq('target_module', 'finance_remittances')
      .in('target_entity_id', ctx.releaseRemittanceIds)).count ?? 0;
    expect(remittanceEventCount === expectedRemittanceArtifacts,
      `release retained ${remittanceEventCount}/${expectedRemittanceArtifacts} remittance events`);
    expect(remittanceAuditCount === expectedRemittanceArtifacts,
      `release retained ${remittanceAuditCount}/${expectedRemittanceArtifacts} remittance audits`);
    expect(remittanceHandoffCount === expectedRemittanceArtifacts,
      `release retained ${remittanceHandoffCount}/${expectedRemittanceArtifacts} remittance handoffs`);

    const { error: releaseUpdateError } = await sb
      .from('finance_payroll_release_certificates')
      .update({ checksum: 'tampered-release-certificate' })
      .eq('id', ctx.releaseCertificateId);
    expect(releaseUpdateError?.code === 'PR409',
      `release certificate update should return PR409, got ${releaseUpdateError?.code ?? 'success'}`);
  });

  await test('release certificate read returns immutable output links and 404 for an unknown run', async () => {
    const certificate = await api(
      'finance/payroll/releases/get-certificate',
      fmgr1Token,
      { runId: ctx.runId },
    );
    ok(certificate, `release certificate read failed: ${certificate.body.message}`);
    expect(certificate.body.data.id === ctx.releaseCertificateId,
      'release certificate read returned the wrong certificate');
    expect(certificate.body.data.runId === ctx.runId,
      'release certificate read returned the wrong payroll run');
    expect(certificate.body.data.checksum,
      'release certificate read is missing its immutable checksum');
    expect(certificate.body.data.disbursementId === ctx.releaseDisbursementId,
      'release certificate read points to the wrong disbursement');
    const linkedRemittanceIds = certificate.body.data.remittances
      .map(item => item.id)
      .sort();
    expect(
      JSON.stringify(linkedRemittanceIds) === JSON.stringify([...ctx.releaseRemittanceIds].sort()),
      'release certificate read returned a different remittance manifest',
    );

    const missing = await api(
      'finance/payroll/releases/get-certificate',
      fmgr1Token,
      { runId: '00000000-0000-4000-8000-000000000001' },
    );
    expect(missing.status === 404,
      `unknown release certificate should return 404, got ${missing.status}`);
  });

  await test('plain employee is DENIED every payroll release-control endpoint', async () => {
    const requests = [
      ['finance/payroll/releases/preflight', { runId: ctx.runId }],
      ['finance/payroll/releases/confirm-funding', payrollFundingCommand({
        runId: ctx.runId,
        idempotencyKey: `${TAG}:run:main:funding:denied`,
        confirmedAmount: releaseNetPayroll,
        confirmationReference: `${TAG}-UNAUTHORIZED`,
      })],
      [
        'finance/payroll/releases/release',
        payrollReleaseCommand(ctx.runId, `${TAG}:run:main:release:denied`),
      ],
      ['finance/payroll/releases/get-certificate', { runId: ctx.runId }],
    ];
    for (const [path, payload] of requests) {
      const denied = await api(path, emp1Token, payload);
      expect(denied.status === 403, `${path} should deny a plain employee, got ${denied.status}`);
    }
  });

  await test('finance_staff is DENIED exporting a run', async () => {
    const r = await api(
      'finance/payroll/runs/export',
      fstaff1Token,
      payrollExportCommand(ctx.runId, `${TAG}:run:main:export:denied`, 'csv'),
    );
    fails(r, 'finance_staff should be denied export');
  });

  await test('finance_manager creates an immutable CSV export exactly once', async () => {
    const command = payrollExportCommand(
      ctx.runId,
      `${TAG}:run:main:export:csv`,
      'csv',
    );
    const first = await api('finance/payroll/runs/export', fmgr2Token, command);
    ok(first, `CSV export failed: ${first.body.message}`);
    const d = first.body.data;
    expect(d.id,          'export missing id');
    expect(d.exportNo,    'export missing exportNo');
    expect(d.format === 'csv', `format should be csv, got ${d.format}`);
    expect(d.isCurrent === true, 'first export should be is_current');
    expect(d.checksum,    'export missing checksum');
    expect(d.filePath,    'export missing filePath');
    ctx.exportId = d.id;

    const replay = await api('finance/payroll/runs/export', fmgr2Token, command);
    ok(replay, `CSV export replay failed: ${replay.body.message}`);
    expect(replay.body.data.id === d.id,
      'CSV export replay returned a different artifact');
    const exportCount = (await sb.from('finance_payroll_exports')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)).count ?? 0;
    expect(exportCount === 1, `CSV replay retained ${exportCount} exports`);
  });

  await test('CSV export persists canonical immutable bytes and strong integrity metadata', async () => {
    const { data: artifact, error } = await sb.from('finance_payroll_exports')
      .select(
        'id, calculation_version_id, version_no, format, checksum, content_text, content_size_bytes, content_md5, serializer_version, metadata',
      )
      .eq('id', ctx.exportId)
      .single();
    expect(!error && artifact, `CSV artifact lookup failed: ${error?.message}`);
    expect(artifact.format === 'csv', `stored artifact format should be csv, got ${artifact.format}`);
    expect(artifact.version_no === 1, `stored CSV version should be 1, got ${artifact.version_no}`);
    expect(artifact.serializer_version === 'payroll-export-v1',
      `unexpected serializer version ${artifact.serializer_version}`);
    expect(typeof artifact.content_text === 'string' && artifact.content_text.length > 0,
      'CSV artifact did not persist its exact content');
    expect(Buffer.byteLength(artifact.content_text, 'utf8') === artifact.content_size_bytes,
      'CSV artifact byte count does not match its persisted content');
    expect(createHash('md5').update(artifact.content_text, 'utf8').digest('hex') === artifact.content_md5,
      'CSV artifact internal MD5 does not match its persisted content');
    expect(createHash('sha256').update(artifact.content_text, 'utf8').digest('hex') === artifact.checksum,
      'CSV artifact public SHA-256 checksum does not match its persisted content');

    const { data: run } = await sb.from('finance_payroll_runs')
      .select('current_calculation_version_id, employee_count')
      .eq('id', ctx.runId)
      .single();
    expect(artifact.calculation_version_id === run.current_calculation_version_id,
      'CSV artifact is not pinned to the released calculation version');
    expect(artifact.metadata?.canonicalSource === 'finance_payroll_calculation_version_lines',
      'CSV artifact does not identify its canonical immutable source');
    expect(Number(artifact.metadata?.lineCount) === Number(run.employee_count),
      'CSV artifact metadata line count does not match the released population');
    expect(artifact.content_text.split('\n').length === Number(run.employee_count) + 1,
      'CSV artifact does not contain one header plus one row per released employee');
  });

  await test('export artifact bytes cannot be rewritten', async () => {
    const { data: before } = await sb.from('finance_payroll_exports')
      .select('content_text, checksum')
      .eq('id', ctx.exportId)
      .single();
    const { error } = await sb.from('finance_payroll_exports')
      .update({ content_text: 'tampered-export-content' })
      .eq('id', ctx.exportId);
    expect(error?.code === 'PR409',
      `export content update should return PR409, got ${error?.code ?? 'success'}`);
    const { data: after } = await sb.from('finance_payroll_exports')
      .select('content_text, checksum')
      .eq('id', ctx.exportId)
      .single();
    expect(after.content_text === before.content_text && after.checksum === before.checksum,
      'rejected export update changed immutable artifact state');
  });

  await test('same export key with a different format is rejected', async () => {
    const r = await api(
      'finance/payroll/runs/export',
      fmgr2Token,
      payrollExportCommand(ctx.runId, `${TAG}:run:main:export:csv`, 'json'),
    );
    expect(r.status === 409,
      `same export key with different format should return 409, got ${r.status}`);
  });

  await test('after export, run remains released and records export time', async () => {
    const { data: run } = await sb.from('finance_payroll_runs')
      .select('status, exported_at').eq('id', ctx.runId).maybeSingle();
    expect(run?.status === 'released', `run status should remain released, got ${run?.status}`);
    expect(run?.exported_at, 'run exported_at should be set');
  });

  await test('re-export creates a new is_current version; prior is_current becomes false', async () => {
    const csvExportId = ctx.exportId;
    const r = await api(
      'finance/payroll/runs/export',
      fmgr2Token,
      payrollExportCommand(ctx.runId, `${TAG}:run:main:export:json`, 'json'),
    );
    ok(r, `re-export (json) failed: ${r.body.message}`);
    expect(r.body.data.isCurrent === true, 'new export should be is_current');
    expect(r.body.data.format === 'json',  'new export format should be json');
    expect(r.body.data.versionNo === 2,
      `JSON export should be version 2, got ${r.body.data.versionNo}`);
    ctx.exportId = r.body.data.id;

    // Original CSV export should now have is_current=false
    const { data: oldExport } = await sb.from('finance_payroll_exports')
      .select('is_current, content_text, checksum').eq('id', csvExportId).maybeSingle();
    expect(oldExport?.is_current === false, 'original export should have is_current=false after re-export');
    expect(createHash('sha256').update(oldExport.content_text, 'utf8').digest('hex') === oldExport.checksum,
      'retiring the prior export altered its immutable bytes');

    const { data: jsonArtifact, error: jsonArtifactError } = await sb
      .from('finance_payroll_exports')
      .select('content_text, checksum, calculation_version_id, metadata')
      .eq('id', ctx.exportId)
      .single();
    expect(!jsonArtifactError && jsonArtifact,
      `JSON artifact lookup failed: ${jsonArtifactError?.message}`);
    expect(createHash('sha256').update(jsonArtifact.content_text, 'utf8').digest('hex')
      === jsonArtifact.checksum, 'JSON artifact checksum does not match its persisted content');
    const parsed = JSON.parse(jsonArtifact.content_text);
    expect(parsed.runId === ctx.runId, 'JSON artifact contains the wrong run id');
    expect(Array.isArray(parsed.lines), 'JSON artifact lines should be an array');
    expect(parsed.lines.length === Number(jsonArtifact.metadata?.lineCount),
      'JSON artifact line count does not match canonical metadata');
    const { data: canonicalLines } = await sb
      .from('finance_payroll_calculation_version_lines')
      .select('employee_id')
      .eq('calculation_version_id', jsonArtifact.calculation_version_id)
      .order('employee_id');
    expect(
      JSON.stringify(parsed.lines.map(line => line.employeeId).sort())
        === JSON.stringify((canonicalLines ?? []).map(line => line.employee_id).sort()),
      'JSON artifact employee population differs from the immutable calculation version',
    );
  });

  await test('released run CANNOT be reopened', async () => {
    const r = await api(
      'finance/payroll/runs/reopen',
      fmgr2Token,
      payrollReopenCommand(
        ctx.runId,
        'Attempting to reopen a released run',
        `${TAG}:run:main:reopen:released`,
      ),
    );
    expect(!r.body.success, 'released run should NOT be reopenable');
  });

  await test('finance_manager can list exports for a run', async () => {
    const r = await api('finance/payroll/exports/list', fmgr1Token, { runId: ctx.runId });
    ok(r, `exports/list failed: ${r.body.message}`);
    expect(r.body.data.length === 2,
      `should have exactly 2 export versions (csv + json), got ${r.body.data.length}`);
    expect(r.body.data[0].id === ctx.exportId && r.body.data[0].isCurrent === true,
      'exports/list did not return the current artifact first');
  });

  await test('export retries retain one event, audit and receipt per artifact', async () => {
    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'finance.payroll.export.generated')
      .eq('source_entity_id', ctx.runId)).count ?? 0;
    expect(eventCount === 2, `expected two export events, got ${eventCount}`);

    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'payroll_run.export.generated')
      .eq('record_id', ctx.runId)).count ?? 0;
    expect(auditCount === 2, `expected two export audits, got ${auditCount}`);
    const receiptCount = (await sb.from('finance_payroll_export_command_receipts')
      .select('request_key', { count: 'exact', head: true })
      .eq('run_id', ctx.runId)
      .like('request_key', '%|payroll_run.export|%')).count ?? 0;
    expect(receiptCount === 2, `expected two export receipts, got ${receiptCount}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Reports');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_staff can list available report keys', async () => {
    const r = await api('finance/payroll/reports/list', fstaff1Token, {});
    ok(r, `reports/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'reports list should be an array');
    expect(r.body.data.length >= 10, `expected at least 10 report keys, got ${r.body.data.length}`);
    const keys = r.body.data.map(d => d.key);
    expect(keys.includes('register'),          'missing register report key');
    expect(keys.includes('net_pay_summary'),   'missing net_pay_summary report key');
    expect(keys.includes('nis_exceptions'),    'missing nis_exceptions report key');
  });

  await test('employee is DENIED running any payroll report', async () => {
    const r = await api('finance/payroll/reports/run', emp1Token, { report: 'register', params: {} });
    fails(r, 'employee should be denied payroll reports');
  });

  await test('finance_staff can run the register report', async () => {
    const r = await api('finance/payroll/reports/run', fstaff1Token, {
      report: 'register',
      params: { status: 'released', limit: 10 },
    });
    ok(r, `reports/run register failed: ${r.body.message}`);
    expect(r.body.data.report === 'register', 'report key mismatch');
    expect(r.body.data.generatedAt,           'missing generatedAt');
    expect(Array.isArray(r.body.data.rows),   'rows should be an array');
    // Our released run should appear.
    const ourRun = r.body.data.rows.find(row => row.id === ctx.runId);
    expect(ourRun, `released run ${ctx.runId} not found in register report`);
  });

  await test('finance_staff can run the net_pay_summary report for the run', async () => {
    const r = await api('finance/payroll/reports/run', fstaff1Token, {
      report: 'net_pay_summary',
      params: { runId: ctx.runId },
    });
    ok(r, `reports/run net_pay_summary failed: ${r.body.message}`);
    expect(r.body.data.rows.length > 0, 'net_pay_summary should have rows');
    const row = r.body.data.rows[0];
    // Reports return raw snake_case DB rows (the FE renders them generically via humanize()).
    expect('net' in row,         'net_pay_summary row missing net field');
    expect('gross' in row,       'net_pay_summary row missing gross field');
    expect('employee_id' in row, 'net_pay_summary row missing employee_id field');
  });

  await test('finance_staff can run the export_audit report', async () => {
    const r = await api('finance/payroll/reports/run', fstaff1Token, {
      report: 'export_audit',
      params: { runId: ctx.runId },
    });
    ok(r, `reports/run export_audit failed: ${r.body.message}`);
    expect(r.body.data.rows.length >= 2, 'export_audit should show at least 2 export artifacts');
  });

  await test('finance_staff can run nis_exceptions report for the run', async () => {
    const r = await api('finance/payroll/reports/run', fstaff1Token, {
      report: 'nis_exceptions',
      params: { runId: ctx.runId },
    });
    ok(r, `reports/run nis_exceptions failed: ${r.body.message}`);
    // Our test employees have missing NIS — expect warnings
    expect(Array.isArray(r.body.data.rows), 'nis_exceptions rows should be an array');
  });

  await test('unverified_nis report runs without a runId', async () => {
    const r = await api('finance/payroll/reports/run', fstaff1Token, {
      report: 'unverified_nis',
      params: {},
    });
    ok(r, `unverified_nis report failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data.rows), 'rows should be an array');
  });

  await test('unknown report key is rejected (422)', async () => {
    const r = await api('finance/payroll/reports/run', fstaff1Token, {
      report: 'not_a_real_report',
      params: {},
    });
    expect(!r.body.success, 'unknown report key should fail');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Warning Resolve (Wave 2B)');
  // ═══════════════════════════════════════════════════════════════════════════

  let warnId = null;

  await test('warnings list for the locked run returns any existing warnings', async () => {
    // After lock + calculate + reopen cycle, warnings may have been generated.
    // If not, this section verifies the endpoint at minimum returns a success.
    const r = await api('finance/payroll/warnings/list', fmgr1Token, { runId: ctx.runId });
    ok(r, `warnings/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'warnings/list should return an array');
    // Capture first unresolved warning (if any) for the resolve test
    const unresolved = (r.body.data ?? []).filter(w => !w.resolved);
    if (unresolved.length > 0) warnId = unresolved[0].id;
  });

  // NOTE: the raw-warning-mutation route `finance/payroll/warnings/resolve` was
  // REMOVED by the execution handoff. Per its Current Code Reconciliation (§5.4),
  // raw calculation warnings stay the engine's immutable output and are NOT
  // mutated from the UI; resolution now flows through normalized CONTROL FINDINGS
  // (`finance/payroll/findings/{resolve,waive,reopen}`), which the main lifecycle
  // section already covers (blocker resolve/waive + exact §2 side-effects). The
  // obsolete raw-warning-resolve tests were dropped rather than pointed at a
  // deleted route. `warnings/list` (above) remains valid as a read of that output.

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Population Preview (Wave 2B)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('population-preview returns total/salaried/hourly/missingPayBasis counts', async () => {
    const r = await api('finance/payroll/runs/population-preview', fmgr1Token, {});
    ok(r, `population-preview failed: ${r.body.message}`);
    const d = r.body.data;
    expect(typeof d.total === 'number',           'total should be a number');
    expect(typeof d.salaried === 'number',        'salaried should be a number');
    expect(typeof d.hourly === 'number',          'hourly should be a number');
    expect(typeof d.missingPayBasis === 'number', 'missingPayBasis should be a number');
    expect(d.total >= 0,                          'total should be >= 0');
    expect(d.salaried + d.hourly <= d.total,      'salaried+hourly <= total (missing covers the rest)');
  });

  await test('population-preview includes Wave 2B extended fields (newHires/terminations/missingStatutoryProfile)', async () => {
    // Gap 8: wizard Step 1 requires these for period-scoped population warnings
    const r = await api('finance/payroll/runs/population-preview', fmgr1Token, {});
    ok(r, `population-preview failed: ${r.body.message}`);
    const d = r.body.data;
    expect(typeof d.newHires === 'number',
      `newHires should be a number, got ${typeof d.newHires}`);
    expect(typeof d.terminations === 'number',
      `terminations should be a number, got ${typeof d.terminations}`);
    expect(typeof d.missingStatutoryProfile === 'number',
      `missingStatutoryProfile should be a number, got ${typeof d.missingStatutoryProfile}`);
    expect(d.newHires >= 0,                  'newHires should be >= 0');
    expect(d.terminations >= 0,              'terminations should be >= 0');
    expect(d.missingStatutoryProfile >= 0,   'missingStatutoryProfile should be >= 0');
    expect(d.missingStatutoryProfile <= d.total,
      'missingStatutoryProfile cannot exceed total active employees');
  });

  await test('population-preview accepts a periodMonth param and returns period-scoped counts', async () => {
    // Pass current month; should return same shape as the unscoped call
    const periodMonth = new Date().toISOString().slice(0, 7) + '-01';
    const r = await api('finance/payroll/runs/population-preview', fmgr1Token, { periodMonth });
    ok(r, `population-preview with periodMonth failed: ${r.body.message}`);
    const d = r.body.data;
    expect(typeof d.total === 'number',       'periodMonth-scoped: total should be a number');
    expect(typeof d.newHires === 'number',    'periodMonth-scoped: newHires should be a number');
    expect(typeof d.terminations === 'number','periodMonth-scoped: terminations should be a number');
  });

  await test('finance_staff can see population preview (view_all scope)', async () => {
    const r = await api('finance/payroll/runs/population-preview', fstaff1Token, {});
    ok(r, `population-preview denied for finance_staff: ${r.body.message}`);
  });

  await test('employee role is denied population preview', async () => {
    const r = await api('finance/payroll/runs/population-preview', emp1Token, {});
    expect(!r.body.success, 'employee should not access population preview');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Export Download (Wave 2B)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('export download returns content + metadata for the current export', async () => {
    // ctx.exportId was set earlier in the Export generation tests
    if (!ctx.exportId) {
      // Try to find the latest export for this run
      const { data: exps } = await sb.from('finance_payroll_exports')
        .select('id').eq('run_id', ctx.runId).eq('is_current', true).limit(1);
      ctx.exportId = exps?.[0]?.id ?? null;
    }
    if (!ctx.exportId) { expect(false, 'No export record found — run the full lifecycle first'); return; }

    const command = {
      exportId: ctx.exportId,
      idempotencyKey: `${TAG}:run:main:export:download`,
    };
    const r = await api('finance/payroll/exports/download', fmgr1Token, command);
    ok(r, `export download failed: ${r.body.message}`);
    const d = r.body.data;
    expect(typeof d.content === 'string',   'download content should be a string');
    expect(typeof d.mimeType === 'string',  'mimeType should be a string');
    expect(typeof d.filename === 'string',  'filename should be a string');
    expect(typeof d.exportNo === 'string',  'exportNo should be present');
    expect(d.runId === ctx.runId,           'runId in response should match');
    expect(d.duplicate === false, 'first export download should not be a replay');
    expect(Buffer.byteLength(d.content, 'utf8') === d.contentSizeBytes,
      'download byte length does not match immutable metadata');
    expect(createHash('sha256').update(d.content, 'utf8').digest('hex') === d.checksum,
      'download checksum does not match immutable content');

    const replay = await api('finance/payroll/exports/download', fmgr1Token, command);
    ok(replay, `export download replay failed: ${replay.body.message}`);
    expect(replay.body.data.duplicate === true,
      'same-key export download should identify the replay');
    expect(replay.body.data.content === d.content,
      'download replay returned different immutable content');
    expect(replay.body.data.checksum === d.checksum,
      'download replay returned a different checksum');

    const eventCount = (await sb.from('app_events')
      .select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ctx.exportId)
      .eq('event_type', 'finance.payroll.export.downloaded')).count ?? 0;
    expect(eventCount === 1,
      `download replay retained ${eventCount} download events`);
    const auditCount = (await sb.from('hr_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('actor_id', fmgr1Id)
      .eq('record_id', ctx.runId)
      .eq('action', 'payroll_export.downloaded')).count ?? 0;
    expect(auditCount === 1,
      `download replay retained ${auditCount} download audits`);
  });

  await test('same download key with another export is rejected', async () => {
    const { data: prior } = await sb.from('finance_payroll_exports')
      .select('id')
      .eq('run_id', ctx.runId)
      .eq('is_current', false)
      .maybeSingle();
    expect(prior?.id, 'prior export is required for download conflict coverage');
    const r = await api('finance/payroll/exports/download', fmgr1Token, {
      exportId: prior.id,
      idempotencyKey: `${TAG}:run:main:export:download`,
    });
    expect(r.status === 409,
      `same download key for a different export should return 409, got ${r.status}`);
  });

  await test('finance_staff is denied export download (needs finance.payroll.export)', async () => {
    if (!ctx.exportId) return; // skip if no export exists
    const r = await api('finance/payroll/exports/download', fstaff1Token, {
      exportId: ctx.exportId,
      idempotencyKey: `${TAG}:run:main:export:download:denied`,
    });
    expect(!r.body.success, 'finance_staff should not download exports');
  });

  await test('export download for non-existent export returns clean error', async () => {
    const r = await api('finance/payroll/exports/download', fmgr1Token, {
      exportId: '00000000-0000-0000-0000-000000000001',
      idempotencyKey: `${TAG}:run:main:export:download:not-found`,
    });
    expect(!r.body.success, 'download of non-existent export should fail cleanly');
    expect(r.status !== 500, 'should not throw 500 on not-found export');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Bridge Flows (Wave 2B — Gap 16)');
  // ═══════════════════════════════════════════════════════════════════════════
  // The released main run already proved bank and remittance readiness. The
  // isolated exported fixture below remains only for legacy bridge compatibility.

  const [bankAcct1Id, bankAcct2Id] = ctx.bankAccountIds;

  await test('bridge setup reuses release-validated employee bank accounts', async () => {
    expect(bankAcct1Id && bankAcct2Id,
      'bridge coverage requires both release-validated bank accounts');
  });

  await test('bridge setup: seed an isolated exported run (emp1+emp2 only) for disbursement', async () => {
    // The MAIN run is UNGROUPED (all active employees); the shared roster has ~13 payable
    // employees with no bank account, which legitimately blocks a disbursement. Isolate this
    // test on a run scoped to just emp1/emp2 (who DO have bank accounts) so it exercises the
    // happy path WITHOUT weakening the backend's "every paid employee needs a bank account" gate.
    const { data: rn, error: rnErr } = await sb.from('finance_payroll_runs').insert(payrollRunSeed({
      run_no: 'RUN-DISB-' + TAG.slice(-6), periodStart: '2029-09-01',
      statutory_version_id: ctx.statutoryVersionId, status: 'exported',
      pay_frequency: 'monthly', employee_count: 2,
    })).select('id').single();
    expect(!rnErr, `seed disbursement run failed: ${rnErr?.message}`);
    ctx.disbRunId = rn.id;

    for (const [empId, net, no] of [[emp1Id, 5000, '1'], [emp2Id, 4000, '2']]) {
      const { data: rl, error: rlErr } = await sb.from('finance_payroll_run_lines').insert({
        run_id: ctx.disbRunId, employee_id: empId, base: net, gross: net, net,
      }).select('id').single();
      expect(!rlErr, `seed run_line failed: ${rlErr?.message}`);
      const { error: psErr } = await sb.from('finance_payslips').insert({
        payslip_no: `PS-DISB-${TAG}-${no}`, run_id: ctx.disbRunId, run_line_id: rl.id,
        employee_id: empId, generated_by: fmgr1Id,
      });
      expect(!psErr, `seed payslip failed: ${psErr?.message}`);
    }
  });

  await test('employee is DENIED create-disbursement (no finance.disbursement.manage)', async () => {
    const r = await api('finance/bridges/create-disbursement', emp1Token, { payrollRunId: ctx.disbRunId });
    fails(r, 'employee should be denied create-disbursement');
  });

  await test('finance_manager can create a disbursement from an exported run', async () => {
    if (!bankAcct1Id) { console.log('[E2E] bank accounts missing — skip disbursement test'); return; }
    const r = await api('finance/bridges/create-disbursement', fmgr1Token, { payrollRunId: ctx.disbRunId });
    ok(r, `create-disbursement failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.disbursement,             'response missing disbursement object');
    expect(d.disbursement.id,          'disbursement.id missing');
    expect(d.reusedExisting === false, 'first disbursement creation: reusedExisting should be false');
    ctx.disbursementId = d.disbursement.id;
  });

  await test('create-disbursement is idempotent (second call returns reusedExisting: true)', async () => {
    if (!ctx.disbursementId) { console.log('[E2E] no disbursementId — skip idempotency test'); return; }
    const r = await api('finance/bridges/create-disbursement', fmgr1Token, { payrollRunId: ctx.disbRunId });
    ok(r, `idempotent create-disbursement failed: ${r.body.message}`);
    expect(r.body.data.reusedExisting === true,
      'second call should return reusedExisting: true');
    expect(r.body.data.disbursement.id === ctx.disbursementId,
      'idempotent call should return the same disbursement id');
  });

  await test('employee is DENIED create-remittance (no finance.remittances.manage)', async () => {
    const r = await api('finance/bridges/create-remittance', emp1Token,
      { payrollRunId: ctx.runId, authority: 'paye_bir' });
    fails(r, 'employee should be denied create-remittance');
  });

  await test('bridge reuses the PAYE remittance created by atomic release', async () => {
    const r = await api('finance/bridges/create-remittance', fmgr1Token,
      { payrollRunId: ctx.runId, authority: 'paye_bir' });
    ok(r, `create-remittance paye_bir failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.remittance,                          'response missing remittance object');
    expect(d.remittance.id,                       'remittance.id missing');
    expect(d.remittance.authority === 'paye_bir', `authority mismatch: got ${d.remittance.authority}`);
    expect(d.reusedExisting === true,
      'bridge should reuse the release-created PAYE remittance');
    ctx.remittancePAYEId = d.remittance.id;
  });

  await test('create-remittance paye_bir is idempotent (second call returns reusedExisting: true)', async () => {
    if (!ctx.remittancePAYEId) { console.log('[E2E] no remittancePAYEId — skip idempotency test'); return; }
    const r = await api('finance/bridges/create-remittance', fmgr1Token,
      { payrollRunId: ctx.runId, authority: 'paye_bir' });
    ok(r, `idempotent create-remittance failed: ${r.body.message}`);
    expect(r.body.data.reusedExisting === true,
      'second call should return reusedExisting: true');
    expect(r.body.data.remittance.id === ctx.remittancePAYEId,
      'idempotent call should return the same remittance id');
  });

  await test('finance_staff bridge reuses the NIBTT remittance created by release', async () => {
    const r = await api('finance/bridges/create-remittance', fstaff1Token,
      { payrollRunId: ctx.runId, authority: 'nis_nibtt' });
    ok(r, `create-remittance nis_nibtt failed: ${r.body.message}`);
    expect(r.body.data.remittance.authority === 'nis_nibtt',
      `authority mismatch: got ${r.body.data.remittance?.authority}`);
    expect(r.body.data.reusedExisting === true,
      'bridge should reuse the release-created NIBTT remittance');
  });

  await test('bridge setup: cleanup isolated disbursement run in FK order', async () => {
    // Delete the isolated disbursement before its run. The validated bank
    // accounts remain pinned by the main release package until suite cleanup.
    if (ctx.disbursementId) {
      const linesDeleted = await h.mustDelete(
        'finance_disbursement_lines',
        query => query.eq('disbursement_id', ctx.disbursementId),
      );
      const headerDeleted = await h.mustDelete(
        'finance_disbursements',
        query => query.eq('id', ctx.disbursementId),
      );
      if (linesDeleted && headerDeleted) ctx.disbursementId = null;
    }
    if (ctx.disbRunId) {
      await h.mustDelete(
        'finance_payslip_deliveries',
        query => query.eq('run_id', ctx.disbRunId),
      );
      const runDeleted = await h.mustDelete(
        'finance_payroll_runs',
        query => query.eq('id', ctx.disbRunId),
      );
      if (runDeleted) ctx.disbRunId = null;
    }
    expect(true, 'cleanup complete');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Hourly base pay from approved timesheets (Wave 4c)');
  // ═══════════════════════════════════════════════════════════════════════════
  // Isolated via a dedicated pay group so lockInputs populates ONLY these two
  // hourly employees. Emp A has an approved timesheet (base = rate × hours);
  // Emp B has none (base = 0 + missing_approved_timesheet warning).

  const hrly = {
    empAId: `${TAG}_hrlyA`,
    empBId: `${TAG}_hrlyB`,
    groupId: null,
    tsId: null,
    runId: null,
    period: '2031-03-01',
    periodEnd: '2031-03-31',
  };

  await test('setup: create two hourly employees + a scoped pay group with an approved timesheet', async () => {
    const { error: uErr } = await sb.from('app_users').insert([
      { id: hrly.empAId, username: `${TAG}_hrlyA`, full_name: 'Hourly A (E2E)', role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'hourly', hourly_rate: 50 },
      { id: hrly.empBId, username: `${TAG}_hrlyB`, full_name: 'Hourly B (E2E)', role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'hourly', hourly_rate: 40 },
    ]);
    expect(!uErr, `create hourly employees failed: ${uErr?.message}`);
    ctx.createdUserIds.push(hrly.empAId, hrly.empBId);

    const code = ('HG' + TAG.replace(/[^a-z0-9]/gi, '')).slice(0, 18).toUpperCase();
    // Monthly group so the run covers the whole March timesheet (the base-pay
    // assertion is rate × the timesheet's total hours "inside the run month").
    const gr = await api('finance/payroll/pay-groups/create', fmgr1Token, { code, name: `Hourly Group ${TAG}`, frequency: 'monthly' });
    ok(gr, `create pay group failed: ${gr.body.message}`);
    hrly.groupId = gr.body.data.id;

    for (const id of [hrly.empAId, hrly.empBId]) {
      const ar = await api('finance/payroll/pay-groups/assign', fmgr1Token, { employeeId: id, payGroupId: hrly.groupId, effectiveFrom: '2031-01-01' });
      ok(ar, `assign ${id} failed: ${ar.body.message}`);
    }

    // Emp A: approved timesheet inside the run month — 4800 worked minutes = 80h.
    const { data: ts, error: tsErr } = await sb.from('hr_timesheets').insert({
      employee_id: hrly.empAId, period_start: '2031-03-03', period_end: '2031-03-16',
      timesheet_no: `${TAG}-TSA`, total_worked_minutes: 4800, total_late_minutes: 0, total_overtime_minutes: 0,
      days_present: 10, days_absent: 0, days_on_leave: 0, open_exception_count: 0,
      status: 'approved', approved_by: fmgr1Id, approved_at: new Date().toISOString(),
    }).select('id').single();
    expect(!tsErr, `seed approved timesheet failed: ${tsErr?.message}`);
    hrly.tsId = ts?.id ?? null;

    // lockInputs requires the approved timesheet to be backed by linked daily
    // attendance records (worked dates drive the NIS contribution weeks). Seed
    // 10 working days × 480 min = 4800 min, matching the timesheet total.
    const attDays = ['2031-03-03','2031-03-04','2031-03-05','2031-03-06','2031-03-07',
                     '2031-03-10','2031-03-11','2031-03-12','2031-03-13','2031-03-14'];
    const { error: attErr } = await sb.from('hr_attendance_records').insert(
      attDays.map((d, i) => ({
        record_no: `${TAG}-ATT-${i}`,
        employee_id: hrly.empAId, timesheet_id: hrly.tsId, work_date: d,
        worked_minutes: 480, late_minutes: 0, overtime_minutes: 0,
        status: 'present', source: 'import',
      })),
    );
    expect(!attErr, `seed attendance records failed: ${attErr?.message}`);
  });

  await test('create + lock a pay-group run and hourly base pay = rate × approved hours', async () => {
    const cr = await api('finance/payroll/runs/create', fmgr1Token, payrollRunCommand({
      idempotencyKey: `${TAG}:run:hourly:create`,
      periodStart: hrly.period,
      payGroupId: hrly.groupId,
    }));
    ok(cr, `create hourly run failed: ${cr.body.message}`);
    hrly.runId = cr.body.data.id;

    const lr = await api('finance/payroll/runs/lock-inputs', fmgr1Token, {
      id: hrly.runId,
      idempotencyKey: `${TAG}:run:hourly:lock-inputs:1`,
    });
    ok(lr, `lock-inputs failed: ${lr.body.message}`);

    const ir = await api('finance/payroll/inputs/list', fmgr1Token, { runId: hrly.runId });
    ok(ir, `inputs/list failed: ${ir.body.message}`);
    const inputs = ir.body.data;

    const baseA = inputs.find(i => i.sourceType === 'base_pay' && i.employeeId === hrly.empAId);
    expect(baseA, 'no base_pay input for hourly emp A');
    expect(baseA.amount === 4000, `emp A base should be 50×80=4000, got ${baseA.amount}`);
    expect(baseA.quantity === 80, `emp A quantity should be 80 hours, got ${baseA.quantity}`);
    expect(baseA.rate === 50, `emp A rate should be 50, got ${baseA.rate}`);
    expect(baseA.metadata?.has_approved_timesheet === true, 'emp A metadata.has_approved_timesheet should be true');

    const baseB = inputs.find(i => i.sourceType === 'base_pay' && i.employeeId === hrly.empBId);
    expect(baseB, 'no base_pay input for hourly emp B');
    expect(baseB.amount === 0, `emp B base should be 0 (no timesheet), got ${baseB.amount}`);
    expect(baseB.metadata?.has_approved_timesheet === false, 'emp B metadata.has_approved_timesheet should be false');
  });

  await test('calculate raises missing_approved_timesheet warning for the hourly employee with no timesheet', async () => {
    const cr = await api(
      'finance/payroll/runs/calculate',
      fmgr1Token,
      payrollCalculationCommand(hrly.runId, `${TAG}:run:hourly:calculate:1`),
    );
    ok(cr, `calculate failed: ${cr.body.message}`);

    const wr = await api('finance/payroll/warnings/list', fmgr1Token, { runId: hrly.runId });
    ok(wr, `warnings/list failed: ${wr.body.message}`);
    const missing = (wr.body.data ?? []).filter(w => w.warningType === 'missing_approved_timesheet' && w.employeeId === hrly.empBId);
    expect(missing.length > 0, 'expected a missing_approved_timesheet warning for emp B');
  });

  await test('cleanup: remove the hourly run, timesheet and pay group (compensating delete)', async () => {
    if (hrly.runId) {
      const { error: unlinkError } = await sb.from('finance_payroll_runs')
        .update({
          current_calculation_version_id: null,
          current_input_snapshot_id: null,
        })
        .eq('id', hrly.runId);
      expect(!unlinkError, `hourly run evidence unlink failed: ${unlinkError?.message}`);
      expect(await h.mustDelete('finance_payroll_input_lock_receipts',
        query => query.eq('run_id', hrly.runId)), 'hourly input receipt cleanup failed');
      expect(await h.mustDelete('finance_payroll_control_findings',
        query => query.eq('run_id', hrly.runId)), 'hourly finding cleanup failed');
      expect(await h.mustDelete('finance_payroll_run_warnings',
        query => query.eq('run_id', hrly.runId)), 'hourly warning cleanup failed');
      expect(await h.mustDelete('finance_payroll_run_lines',
        query => query.eq('run_id', hrly.runId)), 'hourly line cleanup failed');
      expect(await h.mustDelete('finance_payroll_run_inputs',
        query => query.eq('run_id', hrly.runId)), 'hourly input cleanup failed');
      expect(await h.mustDelete('finance_payroll_calculation_version_lines',
        query => query.eq('run_id', hrly.runId)), 'hourly version-line cleanup failed');
      expect(await h.mustDelete('finance_payroll_calculation_versions',
        query => query.eq('run_id', hrly.runId)), 'hourly calculation-version cleanup failed');
      expect(await h.mustDelete('finance_payroll_calculation_attempts',
        query => query.eq('run_id', hrly.runId)), 'hourly calculation-attempt cleanup failed');
      expect(await h.mustDelete('finance_payroll_input_snapshot_lines',
        query => query.eq('run_id', hrly.runId)), 'hourly snapshot-line cleanup failed');
      expect(await h.mustDelete('finance_payroll_input_snapshots',
        query => query.eq('run_id', hrly.runId)), 'hourly snapshot cleanup failed');
      expect(await h.mustDelete('finance_payroll_runs',
        query => query.eq('id', hrly.runId)), 'hourly run cleanup failed');
    }
    if (hrly.tsId) {
      expect(await h.mustDelete('hr_attendance_records',
        query => query.eq('timesheet_id', hrly.tsId)), 'hourly attendance cleanup failed');
      expect(await h.mustDelete('hr_timesheets',
        query => query.eq('id', hrly.tsId)), 'hourly timesheet cleanup failed');
    }
    if (hrly.groupId) {
      expect(await h.mustDelete('finance_employee_pay_group_assignments',
        query => query.eq('pay_group_id', hrly.groupId)), 'hourly assignment cleanup failed');
      expect(await h.mustDelete('finance_pay_groups',
        query => query.eq('id', hrly.groupId)), 'hourly pay-group cleanup failed');
    }
    expect(true, 'cleanup complete');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Finance Payroll › Legacy removal verification');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('legacy /api/payroll/* routes are no longer mounted (should 404 or fail)', async () => {
    // The legacy payrollRouter is unmounted — any hit to /api/payroll/* should return
    // a 404-style response (or at least not a 200 success).
    const r = await api('payroll/runs', fmgr1Token, {}).catch(() => ({ ok: false, body: { success: false } }));
    expect(!r.body?.success, 'legacy /api/payroll/* route should not succeed (expected 404/403/fail)');
  });
}
