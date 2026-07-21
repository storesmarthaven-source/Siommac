/**
 * scripts/e2e/suites/payrollControlCenter.mjs
 *
 * E2E for the Payroll Command Center read model: POST /api/finance/payroll/control-center/get.
 *
 * Coverage:
 *   - REAL payroll lifecycle for BOTH workflow-bearing states:
 *       · run A1 → pending_approval (real approval task → assignedToYou),
 *       · run A2 → RELEASED via the full lifecycle (approve → lock → payslips → GL → funding → release),
 *         asserting the Ready tab BEFORE release (cert+funding+GL+bank) and Released AFTER (F3, F7).
 *   - Direct-seeded immutable evidence in pay group B for exact deterministic aggregation
 *     (KPIs, funding, blocker findings vs blocker runs, current-version-only, register keyset).
 *   - F5: an inactive (cancelled) run's blocker finding is never the primary intervention.
 *   - F7 read-only: a get writes NO app_events / audit / workflow tasks / notifications / handoffs.
 */
import {
  payrollRunSeed, payrollPeriod, payrollRunCommand,
  payrollCalculationCommand, payrollLockCommand, payrollCertificationCommand,
  payrollFundingCommand, payrollReleaseCommand,
} from '../helpers/payrollRun.mjs';
import { attachActivePolicy } from '../helpers/payPolicyFixture.mjs';

export const title = 'Finance — Payroll Command Center (control-center/get)';

const BASE_GL_MAPPINGS = [
  ['salary_expense', '5200'], ['overtime_expense', '5120'], ['allowance_expense', '5220'],
  ['employer_nis_expense', '5210'], ['net_pay_clearing', '2110'], ['paye_payable', '2310'],
  ['nis_employee_payable', '2320'], ['nis_employer_payable', '2320'],
  ['health_surcharge_payable', '2300'], ['deductions_payable', '2500'],
];

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  const mgrR = await acquireActors('finance_manager', 2, { pay_basis: 'salary', monthly_salary: 10000 });
  const stfR = await acquireActors('finance_staff', 1, { pay_basis: 'salary', monthly_salary: 8000 });
  const empR = await acquireActors('employee', 2, { pay_basis: 'salary', monthly_salary: 6000 }, {}, { forceSynthetic: true });
  const [fmgr1, fmgr2] = mgrR.actors, [fstaff1] = stfR.actors, [emp1, emp2] = empR.actors;
  const createdUserIds = [...mgrR.createdIds, ...stfR.createdIds, ...empR.createdIds];
  const T = {
    fmgr1: mint({ id: fmgr1.id, username: fmgr1.username, role: 'finance_manager', department_id: fmgr1.department_id ?? null }),
    fmgr2: mint({ id: fmgr2.id, username: fmgr2.username, role: 'finance_manager', department_id: fmgr2.department_id ?? null }),
    fstaff: mint({ id: fstaff1.id, username: fstaff1.username, role: 'finance_staff', department_id: fstaff1.department_id ?? null }),
    emp: mint({ id: emp1.id, username: emp1.username, role: 'employee', department_id: emp1.department_id ?? null }),
  };

  const ctx = {
    versionId: null, payGroupA: null, payGroupB: null,
    a1RunId: null, a1WorkflowId: null, a2RunId: null, a2WorkflowId: null,
    bRuns: {}, runIds: [], workflowIds: [], bankAccountIds: [],
    snapIds: [], cvIds: [], findingIds: [], fundingIds: [],
  };

  const waitFor = async (check, ms = 9000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    const runIds = ctx.runIds;
    if (runIds.length) {
      await sb.from('finance_payroll_runs').update({
        release_certificate_id: null, approval_certification_id: null, gl_journal_id: null,
        current_calculation_version_id: null, current_input_snapshot_id: null,
      }).in('id', runIds);
      for (const t of ['finance_payroll_export_command_receipts', 'finance_payroll_exports',
        'finance_payroll_release_command_receipts', 'finance_payroll_gl_command_receipts',
        'finance_payroll_lifecycle_command_receipts', 'finance_payroll_input_lock_receipts'])
        await h.mustDelete(t, q => q.in('run_id', runIds));
      // release satellites
      await h.mustDelete('finance_payroll_release_remittances', q => q.in('release_certificate_id', ctx.releaseCertIds ?? []));
      await h.mustDelete('finance_payroll_release_certificates', q => q.in('run_id', runIds));
      await h.mustDelete('finance_remittances', q => q.in('payroll_run_id', runIds));
      const { data: disb } = await sb.from('finance_disbursements').select('id').in('payroll_run_id', runIds);
      const disbIds = (disb ?? []).map(r => r.id);
      if (disbIds.length) {
        await h.mustDelete('finance_disbursement_bank_files', q => q.in('disbursement_id', disbIds));
        await h.mustDelete('finance_disbursement_lines', q => q.in('disbursement_id', disbIds));
        await h.mustDelete('finance_disbursements', q => q.in('id', disbIds));
      }
      if (ctx.fundingIds.length) await h.mustDelete('finance_payroll_funding_confirmations', q => q.in('id', ctx.fundingIds));
      await h.mustDelete('finance_payroll_funding_confirmations', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_certifications', q => q.in('run_id', runIds));
      await h.mustDelete('finance_gl_journals', q => q.eq('source_module', 'finance_payroll').in('source_ref', ctx.runNos ?? []));
      await h.mustDelete('finance_payslip_deliveries', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payslips', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_control_findings', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_run_warnings', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_run_lines', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_run_inputs', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_calculation_version_lines', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_calculation_versions', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_calculation_attempts', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_input_snapshot_lines', q => q.in('run_id', runIds));
      await h.mustDelete('finance_payroll_input_snapshots', q => q.in('run_id', runIds));
    }
    if (ctx.workflowIds.length) {
      await h.mustDelete('workflow_decisions', q => q.in('workflow_id', ctx.workflowIds));
      await h.mustDelete('workflow_audit_log', q => q.in('workflow_id', ctx.workflowIds));
      await h.mustDelete('workflow_tasks', q => q.in('workflow_id', ctx.workflowIds));
      await h.mustDelete('workflow_instances', q => q.in('id', ctx.workflowIds));
    }
    if (runIds.length) {
      await h.mustDelete('notifications', q => q.in('source_id', runIds));
      await h.mustDelete('handoff_outbox', q => q.in('source_entity_id', runIds));
      await h.mustDelete('hr_audit_log', q => q.in('record_id', runIds));
      await h.mustDelete('app_events', q => q.in('source_entity_id', runIds));
      await h.mustDelete('finance_payroll_runs', q => q.in('id', runIds));
    }
    if (ctx.bankAccountIds.length) await h.mustDelete('finance_employee_bank_accounts', q => q.in('id', ctx.bankAccountIds));
    if (ctx.policyFixtureA) await ctx.policyFixtureA.cleanup();
    const pgs = [ctx.payGroupA, ctx.payGroupB].filter(Boolean);
    if (pgs.length) {
      await h.mustDelete('finance_employee_pay_group_assignments', q => q.in('pay_group_id', pgs));
      await h.mustDelete('finance_pay_groups', q => q.in('id', pgs));
    }
    if (createdUserIds.length) await h.mustDelete('app_users', q => q.in('id', createdUserIds));
  });
  ctx.releaseCertIds = []; ctx.runNos = [];

  // ── Direct-seed helpers (immutable evidence in pay group B) ──────────────────
  async function seedRun({ key, runType, status, gross, net, emp, periodStart }) {
    const row = payrollRunSeed({
      run_no: `${TAG}-CC-${key}`, periodMonth: periodStart, runType, statutory_version_id: ctx.versionId,
      status, pay_group_id: ctx.payGroupB, pay_group: 'CC E2E Group B',
      gross_total: gross, net_total: net, deduction_total: Math.max(0, gross - net),
      employee_count: emp, cut_off_date: periodStart, created_by: fstaff1.id,
    });
    const { data, error } = await sb.from('finance_payroll_runs').insert(row).select('id').single();
    expect(!error, `seed run ${key}: ${error?.message}`);
    ctx.bRuns[key] = data.id; ctx.runIds.push(data.id);
    return data.id;
  }
  async function seedCalcChain(runId, { gross, net, emp, snapshotNo, versionNo, makeCurrent }) {
    const { data: snap, error: se } = await sb.from('finance_payroll_input_snapshots').insert({
      run_id: runId, snapshot_no: snapshotNo, checksum: `cc-snap-${runId}-${snapshotNo}`, employee_count: emp, input_count: emp,
    }).select('id').single();
    expect(!se, `snapshot: ${se?.message}`); ctx.snapIds.push(snap.id);
    const { data: cv, error: ce } = await sb.from('finance_payroll_calculation_versions').insert({
      run_id: runId, input_snapshot_id: snap.id, version_no: versionNo, checksum: `cc-cv-${runId}-${versionNo}`,
      employee_count: emp, gross_total: gross, deduction_total: Math.max(0, gross - net), net_total: net,
      nis_employer_total: 0, statutory_version_id: ctx.versionId, published_by: fstaff1.id,
    }).select('id').single();
    expect(!ce, `calc version: ${ce?.message}`); ctx.cvIds.push(cv.id);
    if (makeCurrent) await sb.from('finance_payroll_runs').update({ current_calculation_version_id: cv.id, current_input_snapshot_id: snap.id }).eq('id', runId);
    return cv.id;
  }
  async function seedFinding(runId, cvId, { severity, domain, tag }) {
    const { data, error } = await sb.from('finance_payroll_control_findings').insert({
      run_id: runId, calculation_version_id: cvId, source_type: 'e2e_cc', source_id: `${TAG}:${tag}`,
      finding_type: 'e2e_control', domain, severity, state: 'open', title: `CC ${severity} ${domain}`, detail: 'e2e',
    }).select('id').single();
    expect(!error, `finding ${tag}: ${error?.message}`); ctx.findingIds.push(data.id); return data.id;
  }
  async function seedFunding(runId, cvId, amount) {
    const { data, error } = await sb.from('finance_payroll_funding_confirmations').insert({
      run_id: runId, calculation_version_id: cvId, confirmation_no: 1, confirmed_amount: amount,
      confirmation_reference: `${TAG}-fund`, checksum: `cc-fund-${runId}`, confirmed_by: fmgr1.id,
    }).select('id').single();
    expect(!error, `funding: ${error?.message}`); ctx.fundingIds.push(data.id);
  }

  // Drive a fresh run through create → lock-inputs → calculate → certify → submit.
  async function driveToPendingApproval(key, period) {
    const cr = await api('finance/payroll/runs/create', T.fstaff, payrollRunCommand({ idempotencyKey: `${TAG}:${key}:create`, periodStart: period, payGroupId: ctx.payGroupA }));
    ok(cr, `[${key}] create: ${cr.body.message}`);
    const runId = cr.body.data.id; ctx.runIds.push(runId); ctx.runNos.push(cr.body.data.runNo);
    ok(await api('finance/payroll/runs/lock-inputs', T.fmgr1, payrollLockCommand(runId, `${TAG}:${key}:lock-in`)), `[${key}] lock-inputs`);
    ok(await api('finance/payroll/runs/calculate', T.fmgr1, payrollCalculationCommand(runId, `${TAG}:${key}:calc`)), `[${key}] calculate`);
    const ver = await api('finance/payroll/calculations/versions/list', T.fmgr1, { runId });
    const cvId = ver.body.data[0].id;
    const fl = await api('finance/payroll/findings/list', T.fmgr1, { runId, calculationVersionId: cvId });
    for (const f of (fl.body.data ?? []).filter(x => x.severity === 'blocker' && ['open', 'in_progress'].includes(x.state)))
      ok(await api('finance/payroll/findings/resolve', T.fmgr1, { id: f.id, expectedVersion: f.version, idempotencyKey: `${TAG}:${key}:res:${f.id}`, note: 'e2e', evidence: { source: TAG } }), `[${key}] resolve`);
    ok(await api('finance/payroll/runs/certify', T.fstaff, payrollCertificationCommand(runId, `${TAG}:${key}:certify`, 'Reviewed.')), `[${key}] certify`);
    const sub = await api('finance/payroll/runs/submit', T.fstaff, { id: runId, idempotencyKey: `${TAG}:${key}:submit` });
    ok(sub, `[${key}] submit: ${sub.body.message}`);
    expect(sub.body.data.status === 'pending_approval', `[${key}] expected pending_approval, got ${sub.body.data.status}`);
    const wfId = sub.body.data.workflowId; expect(!!wfId, `[${key}] no workflow`); ctx.workflowIds.push(wfId);
    return { runId, cvId, workflowId: wfId };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Command Center › setup');
  // ═══════════════════════════════════════════════════════════════════════════
  let YR;
  await test('active statutory version + payroll GL mappings exist', async () => {
    const { data } = await sb.from('finance_statutory_versions').select('id').eq('is_active', true).limit(1);
    expect((data ?? []).length > 0, 'no active statutory version'); ctx.versionId = data[0].id;
    for (const [mappingKey, code] of BASE_GL_MAPPINGS) {
      const { data: ex } = await sb.from('finance_payroll_gl_mappings').select('id, active').eq('mapping_key', mappingKey).is('component_id', null).is('department_id', null).maybeSingle();
      if (!ex) await sb.from('finance_payroll_gl_mappings').insert({ mapping_key: mappingKey, account_code: code, active: true });
    }
  });
  await test('create pay groups A (lifecycle) and B (aggregation)', async () => {
    const a = await api('finance/payroll/pay-groups/create', T.fmgr1, { code: `CCA-${TAG.slice(-8)}`, name: `CC E2E Group A ${TAG}`, frequency: 'monthly', statutoryCountry: 'TT' });
    ok(a, `pay group A: ${a.body.message}`); ctx.payGroupA = a.body.data.id;
    const b = await api('finance/payroll/pay-groups/create', T.fmgr1, { code: `CCB-${TAG.slice(-8)}`, name: `CC E2E Group B ${TAG}`, frequency: 'monthly', statutoryCountry: 'TT' });
    ok(b, `pay group B: ${b.body.message}`); ctx.payGroupB = b.body.data.id;
    for (const e of [emp1.id, emp2.id]) ok(await api('finance/payroll/pay-groups/assign', T.fmgr1, { employeeId: e, payGroupId: ctx.payGroupA, effectiveFrom: '2000-01-01' }), `assign ${e}`);
    // F-02: group A's runs go through create_run_tx (driveToPendingApproval) → seed
    // its active policy. Group B is direct-seeded (legacy, pay_policy_required=false).
    ctx.policyFixtureA = await attachActivePolicy({ sb, payGroupId: ctx.payGroupA, actorId: fmgr1.id, tag: TAG });
  });

  // ── A1: real lifecycle → pending_approval (assigned work) ───────────────────
  await test('A1: real lifecycle to pending_approval (real approval task)', async () => {
    const period = payrollPeriod('payrollControlCenter', 'run', TAG); YR = period.slice(0, 4);
    const r = await driveToPendingApproval('a1', period);
    ctx.a1RunId = r.runId; ctx.a1WorkflowId = r.workflowId;
  });

  // ── A2: real FULL lifecycle → RELEASED (also passes through Ready) ──────────
  await test('A2: real lifecycle approve → lock → payslips → GL → funding → (Ready)', async () => {
    const period = `${YR}-11-01`;
    const r = await driveToPendingApproval('a2', period);
    ctx.a2RunId = r.runId; ctx.a2WorkflowId = r.workflowId;

    // approve via the workflow engine (fmgr1 ≠ creator fstaff)
    const { data: tasks } = await sb.from('workflow_tasks').select('id').eq('workflow_id', r.workflowId).in('status', ['pending', 'open', 'in_progress']).limit(1);
    ok(await api('workflow-engine/decide', T.fmgr1, { workflowId: r.workflowId, taskId: tasks[0].id, decision: 'approved' }), 'decide approved');
    expect(await waitFor(async () => (await sb.from('finance_payroll_runs').select('status').eq('id', r.runId).maybeSingle()).data?.status === 'approved'), 'A2 did not reach approved');

    ok(await api('finance/payroll/runs/lock', T.fmgr2, payrollLockCommand(r.runId, `${TAG}:a2:lock`)), 'A2 lock');
    ok(await api('finance/payroll/payslips/generate', T.fmgr2, { runId: r.runId }), 'A2 payslips generate');
    const rr = await api('finance/payroll/payslips/render-run', T.fstaff, { runId: r.runId }); ok(rr, 'A2 render');
    for (const [i, e] of [emp1.id, emp2.id].entries()) {
      const { data: ba } = await sb.from('finance_employee_bank_accounts').insert({
        employee_id: e, bank_name: 'E2E Bank', branch: 'PoS', account_type: 'savings',
        account_number: `12345678${i}0`, account_number_masked: `****${i}0`, is_primary: true, is_active: true,
        created_by: fmgr2.id, metadata: { transitNumber: `0010${i}` },
      }).select('id').single();
      if (ba) ctx.bankAccountIds.push(ba.id);
    }
    ok(await api('finance/payroll/gl/post', T.fstaff, { runId: r.runId, idempotencyKey: `${TAG}:a2:gl` }), 'A2 gl post');
    const pf = await api('finance/payroll/releases/preflight', T.fmgr1, { runId: r.runId });
    ok(pf, 'A2 preflight'); const net = pf.body.data.netPayroll;
    const fund = await api('finance/payroll/releases/confirm-funding', T.fmgr2, payrollFundingCommand({ runId: r.runId, idempotencyKey: `${TAG}:a2:fund`, confirmedAmount: net, confirmationReference: `${TAG}-A2` }));
    ok(fund, `A2 funding: ${fund.body.message}`);
  });

  const getA = (extra = {}) => api('finance/payroll/control-center/get', T.fmgr1, { window: { from: `${YR}-01-01`, to: `${YR}-12-31` }, payGroupIds: [ctx.payGroupA], ...extra });
  const WIN = () => ({ from: `${YR}-01-01`, to: `${YR}-12-31` });
  const getB = (extra = {}) => api('finance/payroll/control-center/get', T.fmgr1, { window: WIN(), payGroupIds: [ctx.payGroupB], ...extra });

  await test('A2 is release-ready → Ready tab (cert + funding + GL + bank); A1 is in Approval', async () => {
    const d = (await getA({ register: { tab: 'all', limit: 25 } })).body.data;
    expect(d.runRegister.tabCounts.ready === 1, `A ready ${d.runRegister.tabCounts.ready} !== 1 (A2 fully release-ready)`);
    expect(d.runRegister.tabCounts.approval === 1, `A approval ${d.runRegister.tabCounts.approval} !== 1 (A1)`);
    const a2 = d.runRegister.items.find(i => i.id === ctx.a2RunId);
    expect(a2 && a2.status === 'locked', 'A2 should be locked/ready before release');
  });

  await test('A2: release → Released tab; excluded from active KPIs', async () => {
    const before = (await getA()).body.data.kpis.activeRuns;
    // Release SoD: releaser ≠ preparer (fstaff) and ≠ approver (fmgr1). fmgr2 (funder) qualifies.
    const rel = await api('finance/payroll/releases/release', T.fmgr2, payrollReleaseCommand(ctx.a2RunId, `${TAG}:a2:release`));
    ok(rel, `A2 release: ${rel.body.message}`);
    if (rel.body.data?.releaseCertificate?.id) ctx.releaseCertIds.push(rel.body.data.releaseCertificate.id);
    expect(await waitFor(async () => (await sb.from('finance_payroll_runs').select('status').eq('id', ctx.a2RunId).maybeSingle()).data?.status === 'released'), 'A2 not released');
    const d = (await getA()).body.data;
    expect(d.runRegister.tabCounts.released >= 1, 'released tab should include A2');
    expect(d.kpis.activeRuns === before - 1, `active runs should drop by 1 after release (${before} → ${d.kpis.activeRuns})`);
    expect(d.runRegister.tabCounts.ready === 0, 'A2 left the Ready tab after release');
  });

  // ── B direct-seed for exact aggregation ─────────────────────────────────────
  await test('seed pay-group-B evidence runs', async () => {
    await seedRun({ key: 'draft', runType: 'off_cycle', status: 'draft', gross: 1000, net: 900, emp: 3, periodStart: `${YR}-03-01` });
    const calcId = await seedRun({ key: 'calc', runType: 'scheduled', status: 'calculated', gross: 0, net: 0, emp: 0, periodStart: `${YR}-04-01` });
    const cvCur = await seedCalcChain(calcId, { gross: 5000, net: 4200, emp: 10, snapshotNo: 1, versionNo: 1, makeCurrent: true });
    const cvStale = await seedCalcChain(calcId, { gross: 9999, net: 9999, emp: 99, snapshotNo: 2, versionNo: 2, makeCurrent: false });
    await seedFinding(calcId, cvCur, { severity: 'blocker', domain: 'statutory', tag: 'calc-cur-b1' });
    await seedFinding(calcId, cvCur, { severity: 'blocker', domain: 'payment', tag: 'calc-cur-b2' }); // 2 findings, 1 run
    await seedFinding(calcId, cvStale, { severity: 'blocker', domain: 'statutory', tag: 'calc-stale' });   // must NOT count
    const fundedId = await seedRun({ key: 'funded', runType: 'scheduled', status: 'approved', gross: 0, net: 0, emp: 0, periodStart: `${YR}-05-01` });
    const cvF = await seedCalcChain(fundedId, { gross: 8000, net: 6800, emp: 20, snapshotNo: 1, versionNo: 1, makeCurrent: true });
    await seedFunding(fundedId, cvF, 6800);
    const unfundedId = await seedRun({ key: 'unfunded', runType: 'scheduled', status: 'approved', gross: 0, net: 0, emp: 0, periodStart: `${YR}-06-01` });
    await seedCalcChain(unfundedId, { gross: 3000, net: 2500, emp: 8, snapshotNo: 1, versionNo: 1, makeCurrent: true });
    const cancelledId = await seedRun({ key: 'cancelled', runType: 'off_cycle', status: 'cancelled', gross: 500, net: 400, emp: 2, periodStart: `${YR}-08-01` });
    const cvC = await seedCalcChain(cancelledId, { gross: 500, net: 400, emp: 2, snapshotNo: 1, versionNo: 1, makeCurrent: true });
    await seedFinding(cancelledId, cvC, { severity: 'blocker', domain: 'statutory', tag: 'cancelled-blocker' }); // F5: inactive
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Command Center › access control');
  // ═══════════════════════════════════════════════════════════════════════════
  await test('unauthenticated → rejected', async () => fails(await api('finance/payroll/control-center/get', null, { window: WIN() }), 'auth'));
  await test('plain employee → 403', async () => { const r = await api('finance/payroll/control-center/get', T.emp, { window: WIN() }); fails(r, 'emp'); expect(r.status === 403, `403 got ${r.status}`); });
  await test('finance_manager → 200 + full shape + capabilities', async () => {
    const d = (await getB()).body.data;
    for (const k of ['asOf', 'window', 'appliedFilters', 'capabilities', 'portfolioHealth', 'kpis', 'assignedToYou', 'recentActivity', 'upcomingDeadlines', 'nextScheduledRun', 'runRegister']) expect(k in d, `missing ${k}`);
    expect(typeof d.asOf === 'string' && !Number.isNaN(Date.parse(d.asOf)), 'asOf ISO');
    for (const c of ['canCreateRun', 'canManageRun', 'canApprove', 'canConfirmFunding', 'canRelease', 'canExport']) expect(typeof d.capabilities[c] === 'boolean', `cap ${c}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Command Center › KPI + funding + blocker metrics (pay group B, exact)');
  // ═══════════════════════════════════════════════════════════════════════════
  await test('KPIs reconcile to calc versions; released/cancelled excluded', async () => {
    const k = (await getB()).body.data.kpis;
    expect(k.activeRuns === 4, `activeRuns ${k.activeRuns} !== 4`);
    expect(k.employeesDue === 41, `employeesDue ${k.employeesDue} !== 41`);
    expect(k.grossPayroll.amount === 17000, `gross ${k.grossPayroll.amount} !== 17000`);
    expect(k.netPayroll.amount === 14400, `net ${k.netPayroll.amount} !== 14400`);
  });
  await test('funding required/confirmed/gap reconcile', async () => {
    const f = (await getB()).body.data.kpis.funding;
    expect(f.required.amount === 13500 && f.confirmed.amount === 6800 && f.gap.amount === 6700 && f.state === 'partial',
      `funding ${JSON.stringify(f)}`);
  });
  await test('F2: openBlockerCount = blocker FINDINGS (2), not blocker runs; one at-risk run', async () => {
    const p = (await getB()).body.data.portfolioHealth;
    expect(p.openBlockerCount === 2, `openBlockerCount ${p.openBlockerCount} !== 2 (findings on current version)`);
    // The single blocker run has NO calculation attempt and is not due-soon → it must classify as
    // at-risk (regression lock: `att.status = 'failed'` is NULL for a no-attempt run and once poisoned
    // the criticalCount/atRiskCount filters, so a blocker run silently counted as neither).
    expect(p.atRiskCount === 1, `atRiskCount ${p.atRiskCount} !== 1 (no-attempt blocker run must be at-risk)`);
    expect(p.criticalCount === 0, `criticalCount ${p.criticalCount} !== 0 (not failed, not due-soon)`);
    expect(p.score === 80, `score ${p.score} !== 80 (1 at-risk RUN → −20)`);
    // State is count-driven, so it can never contradict the counts the band shows: 1 at-risk run → at_risk.
    expect(p.state === 'at_risk', `state ${p.state} !== at_risk`);
    expect(p.primaryIntervention && p.primaryIntervention.kind === 'finding', 'primaryIntervention finding');
  });
  await test('F5: an inactive (cancelled) run blocker is NOT the primary intervention', async () => {
    const pi = (await getB()).body.data.portfolioHealth.primaryIntervention;
    expect(pi.runId === ctx.bRuns.calc, `primaryIntervention.runId ${pi.runId} should be the active calc run, not the cancelled run`);
  });
  await test('register row counts only current-version blockers', async () => {
    const d = (await getB({ register: { tab: 'attention', limit: 25 } })).body.data;
    const calcRow = d.runRegister.items.find(i => i.id === ctx.bRuns.calc);
    expect(calcRow && calcRow.readiness.blockerCount === 2, `blockerCount ${calcRow?.readiness.blockerCount} !== 2 (stale version leaked?)`);
    expect(calcRow.readiness.state === 'blocked', 'state blocked');
    // Pay-group column resolves to the group NAME (via pay_group_id), not the stored code.
    expect(calcRow.payGroup.name === `CC E2E Group B ${TAG}`, `payGroup.name ${calcRow.payGroup?.name} (expected group NAME)`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Command Center › register tabs, keyset, cursor 422');
  // ═══════════════════════════════════════════════════════════════════════════
  await test('tab counts exact (B: no ready/released — those are proven on real run A2)', async () => {
    const tc = (await getB()).body.data.runRegister.tabCounts;
    expect(tc.all === 4, `all ${tc.all} !== 4 (cancelled excluded)`);
    expect(tc.attention === 1, `attention ${tc.attention} !== 1`);
    expect(tc.ready === 0, `ready ${tc.ready} !== 0 (no GL/bank on direct seeds)`);
  });
  await test('keyset pagination: no duplicate/missing rows', async () => {
    const seen = new Set(); let cursor = null, pages = 0;
    do {
      const d = (await getB({ register: { tab: 'all', limit: 2, ...(cursor ? { cursor } : {}) } })).body.data;
      for (const i of d.runRegister.items) { expect(!seen.has(i.id), `dup ${i.id}`); seen.add(i.id); }
      cursor = d.runRegister.nextCursor; expect(++pages <= 5, 'no termination');
    } while (cursor);
    expect(seen.size === 4, `paged ${seen.size} !== 4`);
  });
  await test('malformed cursor → 422', async () => { const r = await getB({ register: { tab: 'all', limit: 2, cursor: '!!!bad!!!' } }); fails(r, 'malformed'); expect(r.status === 422, `422 got ${r.status}`); });
  await test('cursor with different filters → 422', async () => {
    const c = (await getB({ register: { tab: 'all', limit: 2 } })).body.data.runRegister.nextCursor; expect(!!c, 'need cursor');
    const r = await getB({ register: { tab: 'attention', limit: 2, cursor: c } }); fails(r, 'filter mismatch'); expect(r.status === 422, `422 got ${r.status}`);
  });
  await test('limit above max → 400', async () => fails(await api('finance/payroll/control-center/get', T.fmgr1, { window: WIN(), payGroupIds: [ctx.payGroupB], register: { limit: 99 } }), 'limit'));

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Command Center › next run readiness = preflight; deadlines');
  // ═══════════════════════════════════════════════════════════════════════════
  await test('next scheduled run readiness is a projection of the preflight (blocked, 7 gates)', async () => {
    const nr = (await getB()).body.data.nextScheduledRun;
    expect(nr && nr.run.id === ctx.bRuns.calc, `nextScheduledRun ${nr?.run?.id} !== calc run`);
    expect(nr.readiness.gates.length === 7, `gates ${nr.readiness.gates.length}`);
    expect(nr.readiness.state === 'blocked', `readiness ${nr.readiness.state}`);
    expect(nr.readiness.gates.find(g => g.key === 'findings_clear').state === 'fail', 'findings gate fail');
    expect(nr.releaseImpact.net.amount === 4200, `net exposed ${nr.releaseImpact.net.amount}`);
  });
  await test('deadlines are persisted-date driven (≤5, classified)', async () => {
    const dl = (await getB()).body.data.upcomingDeadlines;
    expect(dl.length > 0 && dl.length <= 5, `deadlines ${dl.length}`);
    for (const d of dl) { expect(['cutoff', 'pay_date', 'approval', 'funding', 'release'].includes(d.kind), `kind ${d.kind}`); expect(!!d.runId && !!d.dueAt, 'ids'); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Command Center › assigned work (real task) + isolation');
  // ═══════════════════════════════════════════════════════════════════════════
  await test('finance_manager sees the real A1 approval task', async () => {
    const d = (await getA()).body.data;
    const at = d.assignedToYou;
    expect(at && at.runId === ctx.a1RunId, `assignedToYou ${at?.runId} !== A1`);
    expect(at.action === 'review_approval', 'action');
    // The card resolves the run to human values (pay-group NAME via pay_group_id, population, net) instead
    // of leaking the raw run id / group code (mockup: "Weekly Field · 84 employees · Net TTD …").
    expect(at.payGroupName === `CC E2E Group A ${TAG}`, `payGroupName ${at.payGroupName} (expected group NAME)`);
    expect(at.payGroupName !== at.runNo, 'pay-group slot must not be the raw run number');
    expect(typeof at.employeeCount === 'number' && at.employeeCount >= 0, `employeeCount ${at.employeeCount}`);
    expect(at.netPayroll && typeof at.netPayroll.amount === 'number' && at.netPayroll.currency === 'TTD', `netPayroll ${JSON.stringify(at.netPayroll)}`);
  });
  await test("finance_staff does not see the finance_manager task", async () => {
    const d = (await api('finance/payroll/control-center/get', T.fstaff, { window: WIN(), payGroupIds: [ctx.payGroupA] })).body.data;
    expect(d.assignedToYou === null, 'staff must not see the manager task');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Command Center › validation, empty window, read-only');
  // ═══════════════════════════════════════════════════════════════════════════
  await test('window from>to and >366d rejected (400)', async () => {
    fails(await api('finance/payroll/control-center/get', T.fmgr1, { window: { from: `${YR}-12-31`, to: `${YR}-01-01` } }), 'from>to');
    fails(await api('finance/payroll/control-center/get', T.fmgr1, { window: { from: '2027-01-01', to: '2029-12-31' } }), '>366');
  });
  await test('empty window → valid empty projection', async () => {
    const d = (await api('finance/payroll/control-center/get', T.fmgr1, { window: { from: '2099-01-01', to: '2099-12-31' } })).body.data;
    expect(d.kpis.activeRuns === 0 && d.runRegister.total === 0 && d.nextScheduledRun === null, 'not empty');
    expect(d.portfolioHealth.state === 'healthy' && d.portfolioHealth.score === 100, 'not healthy/100');
  });
  await test('F7: the read writes NO business/event/audit/task/notification/handoff rows', async () => {
    const snap = async () => ({
      events: (await sb.from('app_events').select('id', { count: 'exact', head: true }).eq('source_module', 'finance_payroll')).count ?? 0,
      audit: (await sb.from('hr_audit_log').select('id', { count: 'exact', head: true }).in('record_id', ctx.runIds)).count ?? 0,
      tasks: (await sb.from('workflow_tasks').select('id', { count: 'exact', head: true }).in('workflow_id', ctx.workflowIds.length ? ctx.workflowIds : ['none'])).count ?? 0,
      notes: (await sb.from('notifications').select('id', { count: 'exact', head: true }).in('source_id', ctx.runIds)).count ?? 0,
      handoffs: (await sb.from('handoff_outbox').select('id', { count: 'exact', head: true }).in('source_entity_id', ctx.runIds)).count ?? 0,
    });
    const before = await snap();
    await getB(); await getA(); await api('finance/payroll/control-center/get', T.fmgr1, { window: WIN() });
    const after = await snap();
    for (const key of Object.keys(before)) expect(after[key] === before[key], `read mutated ${key}: ${before[key]} → ${after[key]}`);
  });
}
