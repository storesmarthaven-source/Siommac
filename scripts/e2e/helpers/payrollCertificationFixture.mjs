// ═══════════════════════════════════════════════════════════════════════════
// §7 — Canonical payroll certification fixture (PAYROLL_SYSTEM_CERTIFICATION §7).
// ═══════════════════════════════════════════════════════════════════════════
// ONE provisioning path for the cross-domain certification suite:
//   • 8 distinct STAGE ACTORS (never one superadmin): preparer, independent
//     certifier, approver, funding confirmer/releaser, exporter/GL/payslip
//     distributor, ESS employee, unauthorized employee, explicitly-denied user
//     (+ an HR-operations actor used only to provision governed config).
//   • Governed config through REAL routes (pay groups, F-CAL calendar publish +
//     assignment, F-01 policy draft→submit→workflow decisions→activate→assign).
//   • Opaque identity/reference/test-input rows (users, statutory profiles,
//     banks, timesheets+attendance, OT, leave, loans) by service role.
//   • 12 employee cases E1–E12 (doc §7 list), each tagged with h.TAG.
//   • FK-safe cleanup registered BEFORE the first mutation; §7 requires the
//     focused certification to pass twice consecutively to prove it.
// Anything the environment cannot honestly provision is recorded in
// ctx.limitations[] — never silently skipped.

import { randomUUID as uuid } from 'node:crypto';
import { attachActivePolicy } from './payPolicyFixture.mjs';

/**
 * Strict, FK-ordered purge of EVERY artifact hanging off a set of payroll runs.
 * Every delete is CHECKED (h.mustDelete logs any failure loudly — no `catch {}`
 * swallowing); the caller learns via the return value whether anything leaked.
 *
 * Order matters:
 *   1. UNLINK the runs' circular FKs (current_input_snapshot_id → snapshots,
 *      current_calculation_version_id, certificates, GL) — without this the
 *      snapshot delete FK-fails, which cascades into the policy-evidence rows
 *      surviving, which RESTRICT-blocks the governed policy delete. That chain
 *      was exactly the leak that made the certification suite exit non-zero.
 *   2. Command receipts + release chain (remittances→certificates→funding).
 *   3. Disbursement chain (bank files → lines → disbursements).
 *   4. Payslips, exports, GL journals (by run_no source_ref).
 *   5. Findings (+ receipts), warnings, lines, calc versions/attempts.
 *   6. Snapshot lines → snapshots (cascades run policy/calendar evidence).
 *   7. Platform side effects (notifications, handoffs, audit, events) → runs.
 */
export async function purgeRunArtifacts(h, runIds) {
  const { sb, mustDelete } = h;
  const ids = runIds.filter(Boolean);
  if (ids.length === 0) return true;
  let clean = true;
  const del = async (table, build) => { if (!(await mustDelete(table, build))) clean = false; };

  const { data: runRows, error: runErr } = await sb.from('finance_payroll_runs')
    .select('id, run_no').in('id', ids);
  if (runErr) { console.warn(`[cleanup] run lookup failed: ${runErr.message}`); return false; }
  const runNos = (runRows ?? []).map(r => r.run_no).filter(Boolean);

  // 1. unlink circular FKs
  const { error: unlinkErr } = await sb.from('finance_payroll_runs')
    .update({
      current_input_snapshot_id: null, current_calculation_version_id: null,
      release_certificate_id: null, approval_certification_id: null,
      gl_journal_id: null, gl_posted_at: null,
    })
    .in('id', ids);
  if (unlinkErr) { console.warn(`[cleanup] run unlink failed: ${unlinkErr.message}`); clean = false; }

  // 2. receipts + release chain
  for (const t of ['finance_payroll_export_command_receipts', 'finance_payroll_release_command_receipts',
    'finance_payroll_gl_command_receipts', 'finance_payroll_lifecycle_command_receipts',
    'finance_payroll_input_lock_receipts']) {
    await del(t, q => q.in('run_id', ids));
  }
  {
    const { data: certs } = await sb.from('finance_payroll_release_certificates').select('id').in('run_id', ids);
    const certIds = (certs ?? []).map(c => c.id);
    if (certIds.length) await del('finance_payroll_release_remittances', q => q.in('release_certificate_id', certIds));
  }
  await del('finance_remittances', q => q.in('payroll_run_id', ids));
  await del('finance_payroll_release_certificates', q => q.in('run_id', ids));
  await del('finance_payroll_funding_confirmations', q => q.in('run_id', ids));
  await del('finance_payroll_certifications', q => q.in('run_id', ids));

  // 3. disbursement chain
  {
    const { data: disb } = await sb.from('finance_disbursements').select('id').in('payroll_run_id', ids);
    const dIds = (disb ?? []).map(d => d.id);
    if (dIds.length) {
      await del('finance_disbursement_bank_files', q => q.in('disbursement_id', dIds));
      await del('finance_disbursement_lines', q => q.in('disbursement_id', dIds));
      await del('finance_disbursements', q => q.in('id', dIds));
    }
  }

  // 4. payslips, exports, GL
  await del('finance_payslip_deliveries', q => q.in('run_id', ids));
  await del('finance_payslips', q => q.in('run_id', ids));
  await del('finance_payroll_exports', q => q.in('run_id', ids));
  if (runNos.length) {
    await del('finance_gl_journals', q => q.eq('source_module', 'finance_payroll').in('source_ref', runNos));
  }

  // 5. findings, warnings, lines, calc artifacts
  {
    const { data: findings } = await sb.from('finance_payroll_control_findings').select('id').in('run_id', ids);
    const fIds = (findings ?? []).map(f => f.id);
    if (fIds.length) await del('finance_payroll_finding_command_receipts', q => q.in('finding_id', fIds));
  }
  await del('finance_payroll_control_findings', q => q.in('run_id', ids));
  await del('finance_payroll_run_warnings', q => q.in('run_id', ids));
  await del('finance_payroll_run_lines', q => q.in('run_id', ids));
  await del('finance_payroll_calculation_version_lines', q => q.in('run_id', ids));
  await del('finance_payroll_calculation_versions', q => q.in('run_id', ids));
  await del('finance_payroll_calculation_attempts', q => q.in('run_id', ids));

  // 6. snapshots (cascade run policy/calendar evidence)
  await del('finance_payroll_input_snapshot_lines', q => q.in('run_id', ids));
  await del('finance_payroll_run_inputs', q => q.in('run_id', ids));
  await del('finance_payroll_input_snapshots', q => q.in('run_id', ids));

  // 7. platform side effects, workflows, then the runs
  {
    const { error } = await sb.from('workflow_instances')
      .update({ status: 'cancelled' }).in('source_record_id', ids)
      .in('status', ['pending', 'open', 'in_progress']);
    if (error) { console.warn(`[cleanup] workflow cancel failed: ${error.message}`); clean = false; }
  }
  await del('notifications', q => q.in('source_id', ids));
  await del('handoff_outbox', q => q.in('source_entity_id', ids));
  await del('hr_audit_log', q => q.in('record_id', ids));
  await del('app_events', q => q.in('source_entity_id', ids));
  await del('finance_payroll_runs', q => q.in('id', ids));
  return clean;
}

export async function provisionPayrollCertification(h) {
  const { api, expect, ok, mint, sb, TAG } = h;
  const short = TAG.slice(-8);

  // ── identities ──────────────────────────────────────────────────────────────
  const U = {
    prep:   `CERT-PREP-${TAG}`,   // payroll preparer          (finance_staff)
    cert:   `CERT-CERT-${TAG}`,   // independent certifier      (finance_manager)
    appr:   `CERT-APPR-${TAG}`,   // payroll approver           (finance_manager)
    fund:   `CERT-FUND-${TAG}`,   // funding confirmer/releaser (finance_manager)
    dist:   `CERT-DIST-${TAG}`,   // exporter / GL / payslips   (finance_manager)
    hrops:  `CERT-HR-${TAG}`,     // HR ops (provisioning + workflow decisions)
    ess:    `CERT-E01-${TAG}`,    // ESS user = employee E1
    outs:   `CERT-OUT-${TAG}`,    // unauthorized employee (no payroll grants)
    deny:   `CERT-DENY-${TAG}`,   // finance_staff with an EXPLICIT deny override
  };
  const EMP = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`E${i + 1}`, i === 0 ? U.ess : `CERT-E${String(i + 1).padStart(2, '0')}-${TAG}`]),
  );
  const empIds = Object.values(EMP);

  const ctx = {
    U, EMP, T: {}, limitations: [],
    payGroups: {},           // monthly|weekly|fortnightly|semi_monthly → id
    policies: {},            // salary|hourly → { policyId, versionId }
    calendar: { hcvId: null, wcVerId: null, hcCalIds: [], wcCalIds: [], asgIds: [] },
    period: { start: '2026-03-02', end: '2026-03-31', month: '2026-03' },
    templateId: null, templateCreated: false,
    polAsgIds: [], denyRowId: null,
  };

  // ── FK-safe cleanup — registered BEFORE any mutation (§7) ────────────────────
  // STRICT: every delete is checked (h.mustDelete logs failures loudly); no
  // `catch {}` swallowing anywhere. The §7 double-run is the proof it holds.
  h.onCleanup(async () => {
    const users = [...Object.values(U), ...empIds];
    const del = (t, build) => h.mustDelete(t, build);

    // SELF-SUFFICIENT: purge any runs created by fixture actors FIRST — cleanup
    // callback ordering across suite/fixture is not guaranteed, and a surviving
    // run (or its un-unlinked snapshot evidence) RESTRICT-blocks the governed
    // policy delete, which then blocks user deletion. purgeRunArtifacts owns the
    // full FK order including the circular current_input_snapshot_id unlink.
    const { data: leftRuns, error: lrErr } = await sb.from('finance_payroll_runs')
      .select('id').in('created_by', users);
    if (lrErr) console.warn(`[cleanup] fixture run lookup failed: ${lrErr.message}`);
    await purgeRunArtifacts(h, (leftRuns ?? []).map(r => r.id));

    // Governed teardown through the REAL surfaces where they exist.
    for (const a of ctx.calendar.asgIds.filter(Boolean)) {
      const r = await api('hr/work-calendars/assignment/command', ctx.T.hrops,
        { requestKey: uuid(), reason: 'cert cleanup', command: 'cancel_assignment', assignmentId: a });
      if (!r.body?.success) console.warn(`[cleanup] calendar assignment ${a} cancel failed: ${r.body?.message}`);
    }
    {
      const { error } = await sb.rpc('work_calendar_purge_tx',
        { p_work_calendar_ids: ctx.calendar.wcCalIds, p_holiday_calendar_ids: ctx.calendar.hcCalIds });
      if (error) console.warn(`[cleanup] work_calendar_purge_tx failed: ${error.message}`);
    }
    const groupIds = Object.values(ctx.payGroups).filter(Boolean);
    if (groupIds.length) {
      await del('finance_pay_group_policy_assignments', q => q.in('pay_group_id', groupIds));
      await del('finance_employee_pay_group_assignments', q => q.in('pay_group_id', groupIds));
    }
    const policyIds = Object.values(ctx.policies).map(p => p?.policyId).filter(Boolean);
    if (policyIds.length) {
      // A directly-attached fixture policy may hold assignments on other groups.
      await del('finance_pay_group_policy_assignments', q => q.in('policy_id', policyIds));
      await del('finance_pay_policy_command_receipts', q => q.in('policy_id', policyIds));
      await del('finance_pay_policies', q => q.in('id', policyIds));
    }
    if (groupIds.length) await del('finance_pay_groups', q => q.in('id', groupIds));

    for (const t of ['hr_attendance_records', 'hr_timesheets', 'hr_overtime_entries', 'hr_leave_requests',
      'finance_employee_loans', 'finance_employee_bank_accounts', 'hr_employee_statutory_profiles']) {
      await del(t, q => q.in('employee_id', empIds));
    }
    if (ctx.templateCreated && ctx.templateId) await del('payroll_payslip_templates', q => q.eq('id', ctx.templateId));
    if (ctx.unpaidLeaveTypeId) await del('hr_leave_types', q => q.eq('id', ctx.unpaidLeaveTypeId));

    // Workflow instances raised by fixture actors (policy approvals) — decisions
    // FK tasks FK instances, and instances FK the users. All three leak classes
    // were observed blocking user deletion in the live sweep.
    {
      const inList = `("${users.join('","')}")`;
      const { data: wf } = await sb.from('workflow_instances').select('id')
        .or(`requested_by.in.${inList},owner_id.in.${inList}`);
      const wfIds = (wf ?? []).map(w => w.id);
      if (wfIds.length) {
        const { data: tasks } = await sb.from('workflow_tasks').select('id').in('workflow_id', wfIds);
        const taskIds = (tasks ?? []).map(t => t.id);
        if (taskIds.length) await del('workflow_decisions', q => q.in('task_id', taskIds));
        await del('workflow_audit_log', q => q.in('workflow_id', wfIds));
        await del('workflow_tasks', q => q.in('workflow_id', wfIds));
        await del('workflow_instances', q => q.in('id', wfIds));
      }
    }
    // Tickets raised BY fixture actors (payroll event rules can open tickets).
    {
      const { data: tk } = await sb.from('tickets').select('id').in('created_by_user_id', users);
      const tkIds = (tk ?? []).map(t => t.id);
      if (tkIds.length) {
        await del('ticket_comments', q => q.in('ticket_id', tkIds));
        await del('ticket_events', q => q.in('ticket_id', tkIds));
        await del('notifications', q => q.in('source_id', tkIds));
        await del('tickets', q => q.in('id', tkIds));
      }
    }
    await del('user_permissions', q => q.in('user_id', users));
    await del('work_calendar_command_receipts', q => q.in('actor_id', users));
    await del('workflow_audit_log', q => q.in('actor_id', users));
    await del('notifications', q => q.in('user_id', users));
    await del('app_events', q => q.in('actor_user_id', users));
    await del('hr_audit_log', q => q.in('actor_id', users));
    await del('hr_audit_log', q => q.in('employee_id', users));
    await del('audit_logs', q => q.in('user_id', users));
    await del('ui_layout', q => q.in('user_id', users));
    await del('app_users', q => q.in('id', users));
  });

  // ── 1. actors + employees (opaque identity rows) ─────────────────────────────
  const P = ctx.period;
  const userRows = [
    { id: U.prep,  role: 'finance_staff',   name: 'Cert Preparer' },
    { id: U.cert,  role: 'finance_manager', name: 'Cert Certifier' },
    { id: U.appr,  role: 'finance_manager', name: 'Cert Approver' },
    { id: U.fund,  role: 'finance_manager', name: 'Cert Funder' },
    { id: U.dist,  role: 'finance_manager', name: 'Cert Distributor' },
    { id: U.hrops, role: 'hr_manager',      name: 'Cert HR Ops' },
    { id: U.outs,  role: 'employee',        name: 'Cert Outsider' },
    { id: U.deny,  role: 'finance_staff',   name: 'Cert Denied' },
  ].map((u, i) => ({
    id: u.id, username: `${TAG}_cert_${i}_${u.id.slice(5, 9).toLowerCase()}`,
    full_name: u.name, role: u.role, status: 'active', employment_type: 'employee',
  }));
  // 12 case employees: salaried unless stated; E2/E3 hourly (weekly group).
  // UNIFORM keys on every row — supabase-js bulk insert null-fills missing keys
  // across the row set, which violates NOT NULL pay columns otherwise.
  const empRows = empIds.map((id, i) => {
    const n = i + 1;
    const hourly = n === 2 || n === 3;
    return {
      id, username: `${TAG}_cert_e${String(n).padStart(2, '0')}`,
      full_name: `Cert Employee ${n}`, role: 'employee', status: 'active',
      employment_type: 'employee',
      pay_basis: hourly ? 'hourly' : 'salary',
      hourly_rate: hourly ? 85 : 0,
      monthly_salary: hourly ? 0 : 9000 + n * 250,
      // E4 — new hire mid-period.
      start_date: n === 4 ? '2026-03-16' : '2025-01-06',
      cost_center: `CC-${short}`,
    };
  });
  {
    // Separate inserts: actor rows must not be unioned with employee pay columns.
    const a = await sb.from('app_users').insert(userRows);
    expect(!a.error, `cert fixture actors: ${a.error?.message}`);
    const e = await sb.from('app_users').insert(empRows);
    expect(!e.error, `cert fixture employees: ${e.error?.message}`);
  }
  ctx.T = Object.fromEntries(Object.entries(U).map(([k, id]) => {
    const row = [...userRows, ...empRows].find(r => r.id === id);
    return [k, mint({ id, username: row.username, role: row.role ?? 'employee', department_id: null })];
  }));

  // Explicit deny override (§7 actor 8): role grants view_all, the override denies it.
  {
    const { error } = await sb.from('user_permissions')
      .insert({ user_id: U.deny, permission: 'finance.payroll.view_all', granted: false, set_by: U.appr, set_at: new Date().toISOString() });
    expect(!error, `deny override seed: ${error?.message}`);
    ctx.denyRowId = U.deny; // cleaned by user_id sweep in onCleanup
  }

  // ── 2. pay groups ×4 (real route; certifier holds paygroups.manage) ─────────
  for (const [key, freq] of [['monthly', 'monthly'], ['weekly', 'weekly'], ['fortnightly', 'fortnightly'], ['semi_monthly', 'semi_monthly']]) {
    const g = await api('finance/payroll/pay-groups/create', ctx.T.cert, {
      code: `CT${key.slice(0, 2).toUpperCase()}-${short}`, name: `Cert ${key} ${TAG}`,
      frequency: freq, statutoryCountry: 'TT',
    });
    ok(g, `cert pay group ${key}: ${g.body.message}`);
    ctx.payGroups[key] = g.body.data.id;
  }

  // ── 3. F-CAL: holiday set + work calendar published, assigned to all groups ──
  const cal = extra => ({ requestKey: uuid(), reason: 'cert fixture', ...extra });
  {
    const cv = await api('hr/work-calendars/holiday-set/command', ctx.T.hrops, cal({
      command: 'create_version', calendar: { name: `CERT HS ${TAG}`, jurisdiction: 'TT' },
      effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
    }));
    ok(cv, `holiday set: ${cv.body.message}`);
    const hverId = cv.body.data.version.id;
    if (cv.body.data.calendar?.id) ctx.calendar.hcCalIds.push(cv.body.data.calendar.id);
    const add = await api('hr/work-calendars/holiday-set/command', ctx.T.hrops, cal({
      command: 'add_holiday', versionId: hverId, expectedLockVersion: cv.body.data.version.lockVersion,
      holiday: { holidayDate: '2026-01-01', nameStatutory: "New Year's Day", nameCommon: 'New Year',
        holidayType: 'statutory', sourceReference: 'cert-fixture', sourcePublishedDate: '2025-12-01',
        provenanceNote: 'certification fixture holiday' },
    }));
    ok(add, `holiday add: ${add.body.message}`);
    const pub = await api('hr/work-calendars/holiday-set/command', ctx.T.hrops, cal({
      command: 'publish_version', versionId: hverId,
      expectedVersionLockVersion: add.body.data.version.lockVersion,
      expectedCalendarLockVersion: add.body.data.calendar.lockVersion,
    }));
    ok(pub, `holiday publish: ${pub.body.message}`);
    ctx.calendar.hcvId = hverId;

    const wc = await api('hr/work-calendars/version/command', ctx.T.hrops, cal({
      command: 'create_version', calendar: { name: `CERT WC ${TAG}` },
      effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
      holidayCalendarVersionId: hverId, workingWeekdays: [1, 2, 3, 4, 5], weekdayFractions: {},
    }));
    ok(wc, `work calendar: ${wc.body.message}`);
    const wcVerId = wc.body.data.version.id; const wcCalId = wc.body.data.calendar.id;
    ctx.calendar.wcCalIds.push(wcCalId);
    const cget = await api('hr/work-calendars/read', ctx.T.hrops, { action: 'get_work_calendar', id: wcCalId });
    const wpub = await api('hr/work-calendars/version/command', ctx.T.hrops, cal({
      command: 'publish_version', versionId: wcVerId, expectedVersionLockVersion: wc.body.data.version.lockVersion,
      expectedCalendarLockVersion: cget.body.data.calendar.lockVersion,
    }));
    ok(wpub, `work calendar publish: ${wpub.body.message}`);
    ctx.calendar.wcVerId = wcVerId;

    for (const g of Object.values(ctx.payGroups)) {
      const asg = await api('hr/work-calendars/assignment/command', ctx.T.hrops, cal({
        command: 'assign', scope: 'pay_group', payGroupId: g, workCalendarVersionId: wcVerId,
        effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
      }));
      ok(asg, `calendar assign: ${asg.body.message}`);
      ctx.calendar.asgIds.push(asg.body.data.assignment?.id ?? asg.body.data.assignmentId);
    }
  }

  // ── 4. governed pay policies via REAL F-01 flow (draft→submit→decide×2→activate) ──
  const comp = await sb.from('finance_pay_components').select('id').eq('code', 'basic').eq('is_active', true).single();
  expect(!comp.error, `basic component: ${comp.error?.message}`);
  const basicId = comp.data.id;

  async function activatePolicy(kind) {
    const salary = kind === 'salary';
    const draft = {
      code: `CT${salary ? 'SAL' : 'HRL'}${short.replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase()}`,
      name: `Cert ${salary ? 'Salaried' : 'Hourly'} Policy ${TAG}`,
      description: 'Certification fixture governed policy.',
      policyType: salary ? 'standard_salary' : 'hourly_shift',
      ownerId: U.prep, effectiveFrom: '2026-01-05', effectiveTo: null,
      changeSummary: 'Certification fixture policy', dayBoundary: 'calendar_day',
      components: [{
        componentId: basicId,
        calculationBasis: salary ? 'salary_period' : 'approved_hours',
        rateSource: 'employee_contract', eligibilitySource: 'effective_employment',
        ruleParameters: salary ? { proration: 'working_days' } : {},
        required: true, sortOrder: 0,
      }],
      sourceRules: [
        { sourceType: 'payment_destination', ownerRole: 'finance_staff', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'exclude_and_review', conflictSeverity: 'blocker', conflictOutcome: 'block_input_lock' },
        { sourceType: 'approved_leave', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_period', lateInputPolicy: 'exclude_and_review', conflictSeverity: 'warning', conflictOutcome: 'create_review_finding' },
        { sourceType: 'approved_time', ownerRole: 'hr_manager', required: true, reconciliationKey: 'employee_work_date', lateInputPolicy: 'correction_candidate', conflictSeverity: 'warning', conflictOutcome: 'create_correction_candidate' },
        { sourceType: 'statutory_profile', ownerRole: 'finance_manager', required: true, reconciliationKey: 'employee_effective_date', lateInputPolicy: 'exclude_and_review', conflictSeverity: 'blocker', conflictOutcome: 'block_employee_calculation' },
      ],
    };
    const created = await api('finance/payroll/policies/create-draft', ctx.T.prep, { ...draft, idempotencyKey: `${TAG}:cert:${kind}:draft` });
    ok(created, `${kind} create-draft: ${created.body.message}`);
    const { policyId, versionId } = created.body.data;
    const submitted = await api('finance/payroll/policies/submit', ctx.T.prep, {
      versionId, idempotencyKey: `${TAG}:cert:${kind}:submit`,
      certifications: { rulesReviewed: true, sourcesOwned: true, statutoryPaymentReady: true },
    });
    ok(submitted, `${kind} submit: ${submitted.body.message}`);
    const workflowId = submitted.body.data.workflowId;
    for (const who of [ctx.T.hrops, ctx.T.appr]) {
      const tasks = await sb.from('workflow_tasks').select('id').eq('workflow_id', workflowId).in('status', ['open', 'pending', 'in_progress']);
      const task = (tasks.data ?? [])[0];
      expect(task, `${kind}: expected an open workflow task`);
      ok(await api('workflow-engine/decide', who, { workflowId, taskId: task.id, decision: 'approved' }), `${kind} decide`);
    }
    const active = await api('finance/payroll/policies/activate', ctx.T.appr, { policyId, versionId, idempotencyKey: `${TAG}:cert:${kind}:activate` });
    ok(active, `${kind} activate: ${active.body.message}`);
    return { policyId, versionId };
  }

  ctx.policies.salary = await activatePolicy('salary');
  // Hourly policy is provisioned with graceful surfacing: if the approved_hours
  // combination is rejected by preflight in this environment, fall back to the
  // direct fixture attach and RECORD the limitation (never silently skip).
  try {
    ctx.policies.hourly = await activatePolicy('hourly');
  } catch (e) {
    ctx.limitations.push(`hourly policy via F-01 failed (${e instanceof Error ? e.message.slice(0, 120) : e}); using direct fixture attach`);
    const fx = await attachActivePolicy({ sb, payGroupId: ctx.payGroups.weekly, actorId: U.appr, tag: TAG });
    ctx.policies.hourly = { policyId: fx.policyId ?? null, versionId: fx.versionId ?? null, directFixture: fx };
  }

  async function assignPolicy(kind, groupKey) {
    const p = ctx.policies[kind];
    if (!p?.policyId || !p?.versionId) return;
    const a = await api('finance/payroll/policies/pay-groups/assign', ctx.T.appr, {
      policyId: p.policyId, versionId: p.versionId, payGroupId: ctx.payGroups[groupKey],
      effectiveFrom: '2026-01-01', idempotencyKey: `${TAG}:cert:asg:${kind}:${groupKey}`,
    });
    ok(a, `assign ${kind}→${groupKey}: ${a.body.message}`);
    ctx.polAsgIds.push(a.body.data.assignmentId);
  }
  await assignPolicy('salary', 'monthly');
  await assignPolicy('salary', 'fortnightly');
  await assignPolicy('salary', 'semi_monthly');
  if (!ctx.policies.hourly?.directFixture) await assignPolicy('hourly', 'weekly');

  // ── 5. employee case rows (opaque test inputs, all tagged by id prefix) ──────
  const groupFor = n => (n === 2 || n === 3 ? ctx.payGroups.weekly : ctx.payGroups.monthly);
  for (let n = 1; n <= 12; n++) {
    await sb.from('finance_employee_pay_group_assignments').insert({
      employee_id: EMP[`E${n}`], pay_group_id: groupFor(n), effective_from: '2000-01-01',
    });
  }
  // statutory profiles + banks for everyone EXCEPT E12 (missing bank = its case).
  await sb.from('hr_employee_statutory_profiles').insert(empIds.map(id => ({ employee_id: id, jurisdiction: 'TT' })));
  {
    const { error } = await sb.from('finance_employee_bank_accounts').insert(
      empIds.filter(id => id !== EMP.E12).map(id => ({
        employee_id: id, bank_name: 'Cert Bank', account_type: 'savings',
        account_number: '00099887766', account_number_masked: '****7766', is_primary: true, is_active: true,
      })));
    expect(!error, `banks: ${error?.message}`);
  }
  // E2 — approved timesheet WITH linked attendance (lock guard requires the link).
  {
    const { data: tsRow, error } = await sb.from('hr_timesheets').insert({
      timesheet_no: `TS-${short}-E2`, employee_id: EMP.E2, period_start: P.start, period_end: P.end,
      total_worked_minutes: 4800, days_present: 10, status: 'approved', approved_by: U.hrops,
    }).select('id').single();
    expect(!error, `E2 timesheet: ${error?.message}`);
    const att = [];
    for (let d = 2; d <= 13; d++) {
      const day = `2026-03-${String(d).padStart(2, '0')}`;
      if (['2026-03-07', '2026-03-08'].includes(day)) continue; // weekend
      att.push({ record_no: `AT-${short}-E2-${d}`, employee_id: EMP.E2, work_date: day, status: 'present', worked_minutes: 480, timesheet_id: tsRow.id });
    }
    const r = await sb.from('hr_attendance_records').insert(att);
    expect(!r.error, `E2 attendance: ${r.error?.message}`);
  }
  // E3 — UNAPPROVED timesheet (submitted) → hourly employee with missing approved time.
  {
    const { error } = await sb.from('hr_timesheets').insert({
      timesheet_no: `TS-${short}-E3`, employee_id: EMP.E3, period_start: P.start, period_end: P.end,
      total_worked_minutes: 2400, days_present: 5, status: 'submitted',
    });
    expect(!error, `E3 timesheet: ${error?.message}`);
  }
  // E6 — approved PAID leave; E7 — approved UNPAID leave (typed via hr_leave_types).
  {
    const paid = await sb.from('hr_leave_types').select('id').eq('paid', true).limit(1);
    let unpaid = await sb.from('hr_leave_types').select('id').eq('paid', false).limit(1);
    expect(paid.data?.length, 'a paid hr_leave_type must exist');
    if (!unpaid.data?.length) {
      // Seed a tagged unpaid type only if the catalogue lacks one (cleaned below).
      const ins = await sb.from('hr_leave_types').insert({ code: `CERT-UNPAID-${short}`, name: `Cert Unpaid ${short}`, paid: false }).select('id').single();
      expect(!ins.error, `unpaid leave type: ${ins.error?.message}`);
      ctx.unpaidLeaveTypeId = ins.data.id;
      unpaid = { data: [ins.data] };
    }
    const base = { status: 'approved', from_date: '2026-03-09', to_date: '2026-03-11', days: 3, reason: 'cert fixture leave' };
    const r6 = await sb.from('hr_leave_requests').insert({ employee_id: EMP.E6, case_no: `LV-${short}-E6`, leave_type_id: paid.data[0].id, ...base });
    expect(!r6.error, `E6 leave: ${r6.error?.message}`);
    const r7 = await sb.from('hr_leave_requests').insert({ employee_id: EMP.E7, case_no: `LV-${short}-E7`, leave_type_id: unpaid.data[0].id, ...base });
    expect(!r7.error, `E7 leave: ${r7.error?.message}`);
  }
  // E8 — approved overtime entry.
  {
    const { error } = await sb.from('hr_overtime_entries').insert({
      overtime_no: `OT-${short}-E8`, employee_id: EMP.E8, work_date: '2026-03-10',
      hours: 6, multiplier: 1.5, reason: 'cert fixture OT', status: 'approved', approved_by: U.hrops,
    });
    expect(!error, `E8 overtime: ${error?.message}`);
  }
  // E9 — active loan auto-deducting an installment.
  {
    const { error } = await sb.from('finance_employee_loans').insert({
      employee_id: EMP.E9, loan_type: 'loan', principal: 5000, total_repayable: 5000,
      installment_amount: 500, balance: 4000, status: 'active', reference: `LN-${short}-E9`,
      created_by: U.cert,
    });
    if (error) ctx.limitations.push(`E9 loan seed failed (${error.message.slice(0, 100)}) — loan-deduction case unavailable`);
  }
  // E10 back pay + E11 override are RUN-SCOPED inputs — created during the §8
  // lifecycle via the real backPayAdd / addOverride routes; the fixture only
  // designates the employees. E5 is the final-pay designee; E12 has no bank.

  // ── 6. payslip template (ensure one active default exists) ───────────────────
  {
    const { data } = await sb.from('payroll_payslip_templates').select('id').eq('status', 'active').limit(1);
    if (data?.length) ctx.templateId = data[0].id;
    else {
      const ins = await sb.from('payroll_payslip_templates')
        .insert({ name: `Cert Default ${TAG}`, is_default: true, status: 'active' }).select('id').single();
      if (ins.error) ctx.limitations.push(`payslip template seed failed: ${ins.error.message.slice(0, 80)}`);
      else { ctx.templateId = ins.data.id; ctx.templateCreated = true; }
    }
  }
  // GL mappings are a global config surface — PROBE, never blind-seed.
  {
    const { count } = await sb.from('finance_payroll_gl_mappings').select('*', { head: true, count: 'exact' });
    if (!count) ctx.limitations.push('finance_payroll_gl_mappings is empty — GL post cases will report blocked-by-config');
  }

  return ctx;
}
