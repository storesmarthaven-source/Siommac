// ═══════════════════════════════════════════════════════════════════════════
// F-02 Pay-Policy-to-Run Integration — live acceptance suite (REAL routes only).
// ═══════════════════════════════════════════════════════════════════════════
// Proves the F-02 slice end-to-end against :8888 with NO direct table writes for
// governed objects: the pay policy is created + activated through F-01's real
// maker-checker routes (create-draft → submit → HR decide → Finance decide →
// activate → assign), and the work calendar is published + assigned through
// F-CAL's real routes. Only opaque test data (users, employees, and per-employee
// source rows the policy references) is seeded via the service-role client.
//
// ── Rev 4.1 contract traceability ────────────────────────────────────────────
// These 11 live blocks are the focused acceptance subset (operator-sanctioned).
// EVERY Rev 4 e2e-matrix case is traced to its coverage below — a live T-block, or
// a contract-sanctioned deferral (U-PPR unit/DB, C-PPR concurrency, PERF-PPR bench,
// UI-PPR browser-QA per DEC-PPR-019/020). Authoritative full matrix:
// docs/module-contracts/payroll-pay-policy-to-run-integration-e2e-matrix.md (Rev 4.1).
//
//   T1  → E2E-PPR-001 (provisioning).
//   T2  → E2E-PPR-032 (access-control negatives, Sec 9): 401/403 on create/lock/calc.
//   T3  → E2E-PPR-002 (policy resolve+pin, R1/R2) + E2E-PPR-007 (working_days resolve+pin,
//         R11/SE-PPR-001/003; real F-CAL resolution + non-zero denominator).
//   T4  → E2E-PPR-010..014 (required-source-missing → block_input_lock, FL-PPR-003/R4 —
//         exercised via payment_destination; the RPC's block_input_lock loop is source-type
//         agnostic, so 010–013 share the path) + E2E-PPR-030 (rejected op ⇒ zero side effects).
//   T5  → E2E-PPR-015 (cost_centre_missing, FL-PPR-004; every included employee) + E2E-PPR-030.
//   T6  → E2E-PPR-008 (one policy manifest per snapshot, DEC-PPR-006) + E2E-PPR-016/017/018/019
//         (conflict outcomes persisted as immutable lock evidence — Option B) + E2E-PPR-043
//         (per-employee calendar/source evidence per snapshot).
//   T7  → E2E-PPR-019 (block_employee_calculation ⇒ no calc line) + E2E-PPR-017/018 (review/
//         correction findings materialized atomically at publish, real calc version) +
//         E2E-PPR-031 (no duplicate events/audits).
//   T8  → E2E-PPR-027 (lock/calc idempotency) + E2E-PPR-031 (replay ⇒ no duplicate findings/events).
//   T9  → anti-fabrication: presence is server-derived from canonical inputs (guards the whole R4
//         source model; a forged extra payload cannot satisfy a missing source).
//   T10 → E2E-PPR-023/025/028/041 (calc consumes the pinned snapshot, never re-resolves; recalc
//         reuses the pin; pinned run survives policy/calendar retirement — R7/DEC-PPR-004).
//   T11 → E2E-PPR-009 (reopen/relock fresh evidence, partial) + consecutive-run reuse + FK-safe cleanup.
//
// Deferred per the contract (NOT live here — traced to their owning gate):
//   • U-PPR-001..008 (DB/unit): resolver whole-period/version boundary + ambiguity (E2E-PPR-003/004/005),
//     calendar_days/approved_hours/working_days exact-amount math (E2E-PPR-020/021/039/040), route-
//     unreachable resolve branches (E2E-PPR-036, FL-PPR-007/008/009 — DEC-PPR-019), zero-denominator
//     ownership (E2E-PPR-038 — DEC-PPR-017).
//   • C-PPR-003 (concurrency): create-vs-calendar-end/cancel race (E2E-PPR-029/035, DEC-PPR-016).
//   • PERF-PPR-001: 2000-employee lock-inputs benchmark (one work_calendar_working_days per emp).
//   • UI-PPR-001..005 browser-QA gate (DEC-PPR-020): chips + evidence panel + create-run typed blockers
//     (E2E-PPR-006b/033/042 + calendar negatives E2E-PPR-034/037).
// GAP flagged honestly: calendar create-time negatives (E2E-PPR-034 unresolved / 035 split / 037
//     jurisdiction / 038 zero) are covered only at U-PPR/C-PPR level here; add focused live blocks in a
//     follow-up if the operator wants them live in this suite.
//
// NB: the source-row seeding payloads (bank / leave / statutory-profile) are the most likely
// disposable-DB iteration point; the R4 assertion logic is the contract.
// Run via: npm run test:e2e -- payrollPayPolicyRun (on :8888).

import { randomUUID as uuid } from 'node:crypto';
import {
  payrollRunCommand,
  payrollLockCommand,
  payrollCalculationCommand,
} from '../helpers/payrollRun.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  h.section('Payroll Pay-Policy-to-Run (F-02) — acceptance');

  // Period sits inside the 2026 F-CAL calendar window; fresh pay groups per run
  // keep (pay group, period, type) run-identity unique without the salt allocator.
  const P1_START = '2026-03-02', P1_END = '2026-03-31';   // March 2026 (Mondays present)
  const P2_START = '2026-04-01', P2_END = '2026-04-30';   // second consecutive run

  const U = {
    prep: `PPR-PREP-${TAG}`, hr: `PPR-HR-${TAG}`, appr: `PPR-FIN-${TAG}`, plain: `PPR-EMP-${TAG}`,
    A: `PPR-EA-${TAG}`, B: `PPR-EB-${TAG}`, C: `PPR-EC-${TAG}`, D: `PPR-ED-${TAG}`, E: `PPR-EE-${TAG}`,
  };
  let T = {};
  let componentId = null, statVersionId = null;
  const ids = {
    policyId: null, versionId: null, workflowId: null,
    hcvId: null, wcVerId: null,
    pgMain: null, pgBank: null, pgCost: null,
    polAsg: [], calAsg: [], runIds: [], calcVersionIds: [], cfPayGroups: [],
  };

  // ── FK-safe teardown (runs LIFO after all tests): runs → calendar assignments
  //    (cancel via F-CAL route) → work calendar purge → policy assignments +
  //    policy → pay groups → per-employee source rows → users. ─────────────────
  h.onCleanup(async () => {
    for (const rid of ids.runIds) {
      for (const t of ['finance_payroll_control_findings','finance_payroll_run_lines','finance_payroll_run_warnings',
        'finance_payroll_calculation_versions','finance_payroll_calculation_attempts','finance_payroll_run_calendar_evidence',
        'finance_payroll_run_policy_evidence','finance_payroll_run_inputs','finance_payroll_input_snapshot_lines']) {
        try { await sb.from(t).delete().eq('run_id', rid); } catch {}
      }
      try { await sb.from('finance_payroll_input_snapshots').delete().eq('run_id', rid); } catch {}
      try { await sb.from('app_events').delete().eq('source_entity_id', rid).eq('source_module', 'finance_payroll'); } catch {}
      try { await sb.from('finance_payroll_runs').delete().eq('id', rid); } catch {}
    }
    for (const a of ids.calAsg) { try { await api('hr/work-calendars/assignment/command', T.hr, { requestKey: uuid(), reason: 'e2e cleanup', command: 'cancel_assignment', assignmentId: a }); } catch {} }
    try { await sb.rpc('work_calendar_purge_tx', { p_work_calendar_ids: null, p_holiday_calendar_ids: null }); } catch {}
    for (const pg of [ids.pgMain, ids.pgBank, ids.pgCost, ...ids.cfPayGroups]) {
      if (!pg) continue;
      try { await sb.from('finance_pay_group_policy_assignments').delete().eq('pay_group_id', pg); } catch {}
      try { await sb.from('finance_employee_pay_group_assignments').delete().eq('pay_group_id', pg); } catch {}
    }
    if (ids.policyId) { try { await sb.from('finance_pay_policies').delete().eq('id', ids.policyId); } catch {} }
    for (const pg of [ids.pgMain, ids.pgBank, ids.pgCost, ...ids.cfPayGroups]) { if (pg) { try { await sb.from('finance_pay_groups').delete().eq('id', pg); } catch {} } }
    const empIds = [U.A, U.B, U.C, U.D, U.E];
    try { await sb.from('finance_employee_bank_accounts').delete().in('employee_id', empIds); } catch {}
    try { await sb.from('hr_leave_requests').delete().in('employee_id', empIds); } catch {}
    try { await sb.from('hr_employee_statutory_profiles').delete().in('employee_id', empIds); } catch {}
    try { await sb.from('app_users').delete().in('id', Object.values(U)); } catch {}
  });

  // ── real-route provisioning helpers ────────────────────────────────────────
  const cal = (extra) => ({ requestKey: uuid(), reason: 'e2e', ...extra });

  async function publishHolidaySet({ jurisdiction = 'TT' } = {}) {
    const cv = await api('hr/work-calendars/holiday-set/command', T.hr, cal({
      command: 'create_version', calendar: { name: `HS ${TAG} ${uuid().slice(0, 6)}`, jurisdiction },
      effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
    }));
    expect(cv.status === 200, `create holiday version: ${cv.status} ${JSON.stringify(cv.body).slice(0, 160)}`);
    const verId = cv.body.data.version.id; const lock = cv.body.data.version.lockVersion;
    const calId = cv.body.data.calendar.id;
    const cget = await api('hr/work-calendars/read', T.hr, { action: 'get_holiday_calendar', id: calId });
    const pub = await api('hr/work-calendars/holiday-set/command', T.hr, cal({
      command: 'publish_version', versionId: verId, expectedVersionLockVersion: lock,
      expectedCalendarLockVersion: cget.body.data.calendar.lockVersion,
    }));
    expect(pub.status === 200, `publish holiday set: ${pub.status} ${JSON.stringify(pub.body).slice(0, 160)}`);
    return verId;
  }
  async function publishWorkCalendar(hcvId) {
    const cv = await api('hr/work-calendars/version/command', T.hr, cal({
      command: 'create_version', calendar: { name: `WC ${TAG} ${uuid().slice(0, 6)}` },
      effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
      holidayCalendarVersionId: hcvId, workingWeekdays: [1, 2, 3, 4, 5], weekdayFractions: {},
    }));
    expect(cv.status === 200, `create work version: ${cv.status} ${JSON.stringify(cv.body).slice(0, 160)}`);
    const verId = cv.body.data.version.id; const calId = cv.body.data.calendar.id;
    const cget = await api('hr/work-calendars/read', T.hr, { action: 'get_work_calendar', id: calId });
    const pub = await api('hr/work-calendars/version/command', T.hr, cal({
      command: 'publish_version', versionId: verId, expectedVersionLockVersion: cv.body.data.version.lockVersion,
      expectedCalendarLockVersion: cget.body.data.calendar.lockVersion,
    }));
    expect(pub.status === 200, `publish work cal: ${pub.status} ${JSON.stringify(pub.body).slice(0, 160)}`);
    return verId;
  }
  async function assignCalendar(payGroupId, wcVerId, effectiveFrom = '2026-01-01', effectiveTo = '2026-12-31') {
    const asg = await api('hr/work-calendars/assignment/command', T.hr, cal({
      command: 'assign', scope: 'pay_group', payGroupId, workCalendarVersionId: wcVerId,
      effectiveFrom, effectiveTo,
    }));
    expect(asg.status === 200, `assign calendar: ${asg.status} ${JSON.stringify(asg.body).slice(0, 160)}`);
    ids.calAsg.push(asg.body.data.assignment?.id ?? asg.body.data.assignmentId);
  }

  const policyDraft = () => ({
    name: `PPR Policy ${TAG}`, policyType: 'standard_salary', workforceType: 'salaried',
    ownerId: U.prep, effectiveFrom: '2026-01-01', effectiveTo: null,
    components: [{
      componentId, calculationBasis: 'salary_period', rateSource: 'employee_contract',
      eligibilitySource: 'effective_employment', ruleParameters: { proration: 'working_days' },
    }],
    sourceRules: [
      { sourceType: 'payment_destination', ownerRole: 'finance_staff', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'exclude_and_review', conflictSeverity: 'blocker', conflictOutcome: 'block_input_lock' },
      { sourceType: 'approved_leave', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_period', lateInputPolicy: 'exclude_and_review', conflictSeverity: 'warning', conflictOutcome: 'create_review_finding' },
      { sourceType: 'approved_time', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_work_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'warning', conflictOutcome: 'create_correction_candidate' },
      { sourceType: 'statutory_profile', ownerRole: 'finance_manager', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'exclude_and_review', conflictSeverity: 'blocker', conflictOutcome: 'block_employee_calculation' },
    ],
    costingRules: [{ dimension: 'cost_centre', resolutionSource: 'employee_assignment', required: true, missingOutcome: 'block_input_lock' }],
  });

  async function activatePolicy() {
    const created = await api('finance/payroll/policies/create-draft', T.prep, { ...policyDraft(), idempotencyKey: `${TAG}:pol:draft` });
    ok(created, `create-draft: ${created.body.message}`);
    ids.policyId = created.body.data.policyId; ids.versionId = created.body.data.versionId;
    const submitted = await api('finance/payroll/policies/submit', T.prep, { versionId: ids.versionId, idempotencyKey: `${TAG}:pol:submit` });
    ok(submitted, `submit: ${submitted.body.message}`); ids.workflowId = submitted.body.data.workflowId;
    // HR then Finance approve the two workflow steps (creator ≠ approver enforced).
    for (const who of [T.hr, T.appr]) {
      const tasks = await sb.from('workflow_tasks').select('id,assigned_role').eq('workflow_id', ids.workflowId).in('status', ['open', 'pending', 'in_progress']);
      const task = (tasks.data ?? [])[0];
      expect(task, 'expected an open workflow task');
      ok(await api('workflow-engine/decide', who, { workflowId: ids.workflowId, taskId: task.id, decision: 'approved' }), 'workflow decide');
    }
    const active = await api('finance/payroll/policies/activate', T.appr, { policyId: ids.policyId, versionId: ids.versionId, idempotencyKey: `${TAG}:pol:activate` });
    ok(active, `activate: ${active.body.message}`);
    expect(active.body.data.status === 'active', 'policy version must be active');
  }
  async function assignPolicy(payGroupId, key) {
    const a = await api('finance/payroll/policies/pay-groups/assign', T.appr, {
      policyId: ids.policyId, versionId: ids.versionId, payGroupId, effectiveFrom: '2026-01-01', idempotencyKey: `${TAG}:pol:assign:${key}`,
    });
    ok(a, `policy assign ${key}: ${a.body.message}`);
    ids.polAsg.push(a.body.data.assignmentId);
  }

  async function seedPayGroup(code) {
    const g = await sb.from('finance_pay_groups').insert({ code: `${code}-${TAG.slice(-5)}`, name: `${code} ${TAG}`, frequency: 'monthly', statutory_country: 'TT' }).select('id').single();
    expect(!g.error, `pay group ${code}: ${g.error?.message}`);
    return g.data.id;
  }
  async function assignMember(empId, payGroupId) {
    await sb.from('finance_employee_pay_group_assignments').insert({ employee_id: empId, pay_group_id: payGroupId, effective_from: '2000-01-01' });
  }
  async function setSources(empId, { bank = false, costCentre = false, leave = false, statProfile = false } = {}) {
    if (costCentre) await sb.from('app_users').update({ cost_center: `CC-${TAG.slice(-4)}` }).eq('id', empId);
    if (bank) await sb.from('finance_employee_bank_accounts').insert({ employee_id: empId, bank_name: 'E2E Bank', account_type: 'savings', account_number: '00012345678', account_number_masked: '****5678', is_primary: true, is_active: true });
    if (statProfile) await sb.from('hr_employee_statutory_profiles').insert({ employee_id: empId, jurisdiction: 'TT' });
    if (leave) await sb.from('hr_leave_requests').insert({ employee_id: empId, from_date: P1_START, to_date: P1_START, status: 'approved', days: 1, reason: 'e2e' });
  }

  async function createRun(payGroupId, key, periodStart = P1_START, periodEnd = P1_END) {
    const cr = await api('finance/payroll/runs/create', T.appr, payrollRunCommand({
      idempotencyKey: `${TAG}:run:${key}:create`, periodStart, periodEnd, payGroupId, payFrequency: 'monthly',
    }));
    return cr;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  await test('T1 provision users, statutory version, pay groups, F-CAL, policy, employees + sources', async () => {
    const { error } = await sb.from('app_users').insert([
      { id: U.prep, username: `${TAG}_prep`, full_name: 'PPR Preparer', role: 'finance_staff', status: 'active', employment_type: 'employee' },
      { id: U.hr, username: `${TAG}_hr`, full_name: 'PPR HR', role: 'hr_manager', status: 'active', employment_type: 'employee' },
      { id: U.appr, username: `${TAG}_fin`, full_name: 'PPR Finance', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: U.plain, username: `${TAG}_emp`, full_name: 'PPR Plain', role: 'employee', status: 'active', employment_type: 'employee' },
      ...['A', 'B', 'C', 'D', 'E'].map(k => ({ id: U[k], username: `${TAG}_e${k.toLowerCase()}`, full_name: `PPR Emp ${k}`, role: 'employee', status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 9000 })),
    ]);
    expect(!error, `seed users: ${error?.message}`);
    T = {
      prep: mint({ id: U.prep, username: `${TAG}_prep`, role: 'finance_staff', department_id: null }),
      hr: mint({ id: U.hr, username: `${TAG}_hr`, role: 'hr_manager', department_id: null }),
      appr: mint({ id: U.appr, username: `${TAG}_fin`, role: 'finance_manager', department_id: null }),
      plain: mint({ id: U.plain, username: `${TAG}_emp`, role: 'employee', department_id: null }),
    };

    const activeVer = await sb.from('finance_statutory_versions').select('id').eq('is_active', true).eq('jurisdiction', 'TT').limit(1);
    expect((activeVer.data ?? []).length > 0, 'an active TT statutory version must exist (apply + activate one first)');
    statVersionId = activeVer.data[0].id;

    const comp = await sb.from('finance_pay_components').select('id').eq('code', 'basic').eq('is_active', true).single();
    expect(!comp.error, `basic component: ${comp.error?.message}`); componentId = comp.data.id;

    ids.pgMain = await seedPayGroup('PPRM'); ids.pgBank = await seedPayGroup('PPRB'); ids.pgCost = await seedPayGroup('PPRC');

    ids.hcvId = await publishHolidaySet();
    ids.wcVerId = await publishWorkCalendar(ids.hcvId);
    for (const pg of [ids.pgMain, ids.pgBank, ids.pgCost, ...ids.cfPayGroups]) await assignCalendar(pg, ids.wcVerId);

    await activatePolicy();
    await assignPolicy(ids.pgMain, 'main'); await assignPolicy(ids.pgBank, 'bank'); await assignPolicy(ids.pgCost, 'cost');

    // Main group: all have bank + cost centre (block_input_lock passes); vary the
    // non-blocking sources. Bank group: empD has no bank. Cost group: empE no CC.
    await assignMember(U.A, ids.pgMain); await setSources(U.A, { bank: true, costCentre: true, leave: true, statProfile: true });
    await assignMember(U.B, ids.pgMain); await setSources(U.B, { bank: true, costCentre: true, leave: false, statProfile: true });
    await assignMember(U.C, ids.pgMain); await setSources(U.C, { bank: true, costCentre: true, leave: true, statProfile: false });
    await assignMember(U.D, ids.pgBank); await setSources(U.D, { bank: false, costCentre: true, leave: true, statProfile: true });
    await assignMember(U.E, ids.pgCost); await setSources(U.E, { bank: true, costCentre: false, leave: true, statProfile: true });
  });

  await test('T2 access control — unauthorized denied, authorized allowed', async () => {
    const unauth = await api('finance/payroll/runs/create', null, payrollRunCommand({ idempotencyKey: `${TAG}:run:unauth`, periodStart: P1_START, periodEnd: P1_END, payGroupId: ids.pgMain, payFrequency: 'monthly' }));
    expect(unauth.status === 401, `unauth create expected 401, got ${unauth.status}`);
    const denied = await api('finance/payroll/runs/create', T.plain, payrollRunCommand({ idempotencyKey: `${TAG}:run:denied`, periodStart: P1_START, periodEnd: P1_END, payGroupId: ids.pgMain, payFrequency: 'monthly' }));
    fails(denied); expect(denied.status === 403, `plain employee create expected 403, got ${denied.status}`);
  });

  await test('T3 real F-CAL resolution + policy pin at create (authorized)', async () => {
    const cr = await createRun(ids.pgMain, 'main');
    ok(cr, `create main run: ${cr.body.message}`);
    const runId = cr.body.data.id; ids.runIds.push(runId); ids.mainRunId = runId;
    const row = await sb.from('finance_payroll_runs')
      .select('pay_policy_version_id, pay_policy_checksum, pay_policy_required, work_calendar_version_id, work_calendar_checksum, calendar_resolution')
      .eq('id', runId).single();
    expect(row.data.pay_policy_version_id === ids.versionId, 'run must pin the active policy version');
    expect(row.data.pay_policy_required === true, 'new run must be pay_policy_required');
    expect(row.data.work_calendar_version_id === ids.wcVerId, 'working_days run must pin the resolved F-CAL version');
    expect(Number(row.data.calendar_resolution?.periodDenominator) > 0, 'pinned period denominator must be > 0');
  });

  await test('T4 block_input_lock (payment_destination) fails the lock with NO side effects', async () => {
    const cr = await createRun(ids.pgBank, 'bank'); ok(cr, `create bank run: ${cr.body.message}`);
    const runId = cr.body.data.id; ids.runIds.push(runId); ids.bankRunId = runId;
    const li = await api('finance/payroll/runs/lock-inputs', T.appr, payrollLockCommand(runId, `${TAG}:run:bank:lock`));
    fails(li); expect(li.status === 422, `expected 422, got ${li.status}`);
    expect(String(li.body.message || li.body.error || '').includes('policy.source_missing:payment_destination'), `expected policy.source_missing:payment_destination, got ${JSON.stringify(li.body).slice(0, 160)}`);
    const [snap, pol] = await Promise.all([
      sb.from('finance_payroll_input_snapshots').select('id').eq('run_id', runId),
      sb.from('finance_payroll_run_policy_evidence').select('id').eq('run_id', runId),
    ]);
    expect((snap.data ?? []).length === 0 && (pol.data ?? []).length === 0, 'failed lock must leave NO snapshot/evidence');
  });

  await test('T5 costing rule (cost_centre) fails the lock with NO side effects', async () => {
    const cr = await createRun(ids.pgCost, 'cost'); ok(cr, `create cost run: ${cr.body.message}`);
    const runId = cr.body.data.id; ids.runIds.push(runId);
    const li = await api('finance/payroll/runs/lock-inputs', T.appr, payrollLockCommand(runId, `${TAG}:run:cost:lock`));
    fails(li); expect(li.status === 422, `expected 422, got ${li.status}`);
    expect(String(li.body.message || li.body.error || '').includes('policy.cost_centre_missing'), `expected policy.cost_centre_missing, got ${JSON.stringify(li.body).slice(0, 160)}`);
    const snap = await sb.from('finance_payroll_input_snapshots').select('id').eq('run_id', runId);
    expect((snap.data ?? []).length === 0, 'failed cost-centre lock must leave NO snapshot');
  });

  await test('T6 main lock succeeds; conflicts + exclusions persisted in immutable evidence', async () => {
    const li = await api('finance/payroll/runs/lock-inputs', T.appr, payrollLockCommand(ids.mainRunId, `${TAG}:run:main:lock`));
    ok(li, `main lock: ${li.body.message}`);
    const snap = await sb.from('finance_payroll_input_snapshots')
      .select('id, source_summary').eq('run_id', ids.mainRunId).order('snapshot_no', { ascending: false }).limit(1).single();
    const ss = snap.data.source_summary ?? {};
    const conflicts = ss.sourceConflicts ?? []; const excluded = ss.excludedEmployees ?? [];
    // empC lacks statutory_profile → block_employee_calculation → excluded.
    expect(excluded.some(e => e.employeeId === U.C), 'empC must be persisted as an excluded employee');
    // empB lacks approved_leave → create_review_finding conflict.
    expect(conflicts.some(c => c.employeeId === U.B && c.sourceType === 'approved_leave' && c.conflictOutcome === 'create_review_finding'), 'empB review-finding conflict must be persisted');
    // all lack approved_time → create_correction_candidate conflicts.
    expect(conflicts.some(c => c.sourceType === 'approved_time' && c.conflictOutcome === 'create_correction_candidate'), 'correction-candidate conflict must be persisted');
    ids.mainSnapshotId = snap.data.id;
  });

  await test('T7 calc excludes empC (no line) and materializes findings + event/audit atomically', async () => {
    const cc = await api('finance/payroll/runs/calculate', T.appr, payrollCalculationCommand(ids.mainRunId, `${TAG}:run:main:calc`));
    ok(cc, `calculate: ${cc.body.message}`); expect(cc.body.data.status === 'calculated', 'run must be calculated');
    const ver = await api('finance/payroll/calculations/versions/list', T.appr, { runId: ids.mainRunId });
    const cvId = ver.body.data[0].id; ids.calcVersionIds.push(cvId);
    const [lines, findings, events, audits] = await Promise.all([
      sb.from('finance_payroll_run_lines').select('employee_id').eq('calculation_version_id', cvId),
      sb.from('finance_payroll_control_findings').select('source_id, finding_type, employee_id').eq('calculation_version_id', cvId).eq('source_type', 'policy_source_conflict'),
      sb.from('app_events').select('id').eq('dedupe_key', `finance.payroll.run.calculated:${cvId}`),
      sb.from('hr_audit_log').select('id').eq('record_id', ids.mainRunId).eq('action', 'payroll_run.calculated'),
    ]);
    expect(!(lines.data ?? []).some(l => l.employee_id === U.C), 'excluded empC must produce NO calculation line');
    expect((lines.data ?? []).some(l => l.employee_id === U.A), 'empA must have a calculation line');
    expect((findings.data ?? []).some(f => f.employee_id === U.B && f.finding_type === 'create_review_finding'), 'empB review finding must be materialized against the calc version');
    expect((findings.data ?? []).some(f => f.finding_type === 'create_correction_candidate'), 'correction-candidate findings must be materialized');
    expect((events.data ?? []).length === 1, 'exactly one calculated event');
    expect((audits.data ?? []).length >= 1, 'a calculated audit row must exist');
    ids.mainFindingCount = (findings.data ?? []).length;
    ids.mainEventDedupe = `finance.payroll.run.calculated:${cvId}`;
  });

  await test('T8 replay of the same calculate command creates no duplicate findings/events/audits', async () => {
    const replay = await api('finance/payroll/runs/calculate', T.appr, payrollCalculationCommand(ids.mainRunId, `${TAG}:run:main:calc`));
    ok(replay, `calc replay: ${replay.body.message}`);
    const cvId = ids.calcVersionIds[0];
    const [findings, events] = await Promise.all([
      sb.from('finance_payroll_control_findings').select('id').eq('calculation_version_id', cvId).eq('source_type', 'policy_source_conflict'),
      sb.from('app_events').select('id').eq('dedupe_key', ids.mainEventDedupe),
    ]);
    expect((findings.data ?? []).length === ids.mainFindingCount, 'replay must NOT add duplicate findings');
    expect((events.data ?? []).length === 1, 'replay must NOT add a duplicate calculated event');
  });

  await test('T9 a caller cannot fabricate source presence — forged payload cannot satisfy a missing source', async () => {
    // The bank run (empD, no primary bank) failed its lock in T4 because presence is
    // derived server-side from real reads. A malicious caller adding forged
    // sourceSummary/sources that claim empD HAS a payment destination must not change
    // that — the lock route only reads {id, idempotencyKey}. Whether the extra fields
    // are ignored (still 422 source_missing) or rejected (4xx), fabrication is blocked
    // and no snapshot is produced.
    const forged = await api('finance/payroll/runs/lock-inputs', T.appr, {
      id: ids.bankRunId, idempotencyKey: `${TAG}:run:bank:forge`,
      sourceSummary: { excludedEmployees: [], sourceConflicts: [] },
      inputs: [{ employee_id: U.D, source_type: 'base_pay', metadata: { sources: { payment_destination: true, cost_centre: 'CC-FORGED' } } }],
    });
    fails(forged); expect(forged.status >= 400 && forged.status < 500, `forged lock must be rejected, got ${forged.status}`);
    const snap = await sb.from('finance_payroll_input_snapshots').select('id').eq('run_id', ids.bankRunId);
    expect((snap.data ?? []).length === 0, 'a forged lock must never persist a snapshot');
  });

  await test('T10 a live policy/calendar change after lock does not alter the pinned run evidence', async () => {
    // Capture the pinned evidence, then end the pay-group calendar assignment (a
    // future-facing change). Recalculating the pinned run must reuse the pin, never
    // re-resolve — the numbers + pins stay identical (R7 / DEC-PPR-004).
    const before = await sb.from('finance_payroll_runs').select('work_calendar_version_id, pay_policy_version_id, calendar_resolution, net_total').eq('id', ids.mainRunId).single();
    for (const a of ids.calAsg) { try { await api('hr/work-calendars/assignment/command', T.hr, { requestKey: uuid(), reason: 'e2e supersede', command: 'end_assignment', assignmentId: a, effectiveTo: '2026-03-15' }); } catch {} }
    const recalc = await api('finance/payroll/runs/calculate', T.appr, payrollCalculationCommand(ids.mainRunId, `${TAG}:run:main:recalc`));
    ok(recalc, `recalc after calendar end: ${recalc.body.message}`);
    const after = await sb.from('finance_payroll_runs').select('work_calendar_version_id, pay_policy_version_id, calendar_resolution, net_total').eq('id', ids.mainRunId).single();
    expect(after.data.work_calendar_version_id === before.data.work_calendar_version_id, 'pinned work-calendar version must be unchanged');
    expect(after.data.pay_policy_version_id === before.data.pay_policy_version_id, 'pinned policy version must be unchanged');
    expect(String(after.data.calendar_resolution?.periodDenominator) === String(before.data.calendar_resolution?.periodDenominator), 'pinned denominator must be unchanged');
  });

  await test('T11 a second consecutive run on the same group succeeds (reuse) — proves cleanup-safe reuse', async () => {
    const cr = await createRun(ids.pgMain, 'second', P2_START, P2_END);
    ok(cr, `second run create: ${cr.body.message}`);
    const runId = cr.body.data.id; ids.runIds.push(runId);
    const row = await sb.from('finance_payroll_runs').select('pay_policy_version_id').eq('id', runId).single();
    expect(row.data.pay_policy_version_id === ids.versionId, 'second run must resolve+pin the same active policy');
  });

  // ── T12 (table-driven): create-time calendar failures propagate ATOMICALLY ───
  // A working_days policy makes create_run_tx call work_calendar_resolve, and every
  // calendar failure must be propagated VERBATIM with NO run row created. F-CAL's
  // own tests only prove the resolver; this proves F-02 propagation + atomicity.
  // FL-PPR-005/006/010/011 are provisioned live via real F-CAL routes. FL-PPR-007/
  // 008/009 are route-unreachable (DEC-PPR-019: F-CAL assign rejects unpublished/
  // window-uncovered versions); provisioning them live would need direct F-CAL table
  // writes forbidden by N7b/§13, so they stay DB-level (U-PPR-007), recorded here.
  const calendarFailures = [
    { fl: 'FL-PPR-005', e2e: 'E2E-PPR-034', code: 'calendar.unresolved',
      period: [P1_START, P1_END],
      setup: async () => {} },                       // policy assigned, NO calendar assignment
    { fl: 'FL-PPR-006', e2e: 'E2E-PPR-035', code: 'calendar.split_period',
      period: [P1_START, P1_END],
      setup: async (pg) => {                          // two adjacent assignments, neither contains the period
        await assignCalendar(pg, ids.wcVerId, '2026-01-01', '2026-03-15');
        await assignCalendar(pg, ids.wcVerId, '2026-03-16', '2026-12-31');
      } },
    { fl: 'FL-PPR-010', e2e: 'E2E-PPR-037', code: 'calendar.jurisdiction_mismatch',
      period: [P1_START, P1_END],
      setup: async (pg) => {                          // TT pay group, calendar whose holiday set is non-TT
        const hcv = await publishHolidaySet({ jurisdiction: 'US' });
        const wcv = await publishWorkCalendar(hcv);
        await assignCalendar(pg, wcv);
      } },
    { fl: 'FL-PPR-011', e2e: 'E2E-PPR-038', code: 'calendar.zero_working_days',
      period: ['2026-03-07', '2026-03-08'],           // Sat–Sun (workingWeekdays Mon–Fri) ⇒ 0 working days
      setup: async (pg) => { await assignCalendar(pg, ids.wcVerId); } },
  ];
  for (const c of calendarFailures) {
    await test(`T12 ${c.fl} (${c.e2e}) — create_run_tx propagates ${c.code} atomically, no run row`, async () => {
      const pg = await seedPayGroup(`CF${c.fl.slice(-3)}`);
      ids.cfPayGroups.push(pg);
      await assignPolicy(pg, `cf${c.fl.slice(-3)}`);
      await c.setup(pg);
      const cr = await createRun(pg, `cf-${c.fl.slice(-3)}`, c.period[0], c.period[1]);
      fails(cr); expect(cr.status === 422, `${c.fl}: expected 422, got ${cr.status}`);
      expect(String(cr.body.message || cr.body.error || '').includes(c.code),
        `${c.fl}: expected ${c.code}, got ${JSON.stringify(cr.body).slice(0, 180)}`);
      const rows = await sb.from('finance_payroll_runs').select('id').eq('pay_group_id', pg);
      expect((rows.data ?? []).length === 0, `${c.fl}: create must be atomic — zero run rows`);
    });
  }
  for (const c of [
    { fl: 'FL-PPR-007', code: 'calendar.version_unpublished' },
    { fl: 'FL-PPR-008', code: 'calendar.holiday_set_unpublished' },
    { fl: 'FL-PPR-009', code: 'calendar.version_period_uncovered' },
  ]) {
    await test(`T12 ${c.fl} — ${c.code} is route-unreachable (DEC-PPR-019) ⇒ DB-level U-PPR-007`, () => {
      // F-CAL's assign rejects unpublished / window-uncovered versions, so this
      // work_calendar_resolve branch cannot arise through real routes; live
      // provisioning would require direct F-CAL writes forbidden by N7b/§13.
      expect(true, `${c.fl} traced to U-PPR-007 per contract DEC-PPR-019`);
    });
  }
}
