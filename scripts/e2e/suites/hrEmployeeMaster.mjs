/**
 * scripts/e2e/suites/hrEmployeeMaster.mjs
 *
 * End-to-end suite for the HR Employee Master v36 core APIs (Phase 1b), all
 * mounted at /api/hr/ (routes/hr.ts):
 *
 *   /employees/create            — wizard create (app_user + Supabase Auth + assignment + statutory)
 *   /employees/list   (extended) — workerType + trainingStatus + workerType filter
 *   /employees/get    (extended) — embedded statutory + payrollReadiness (permission-gated)
 *   /employees/dashboard-stats   — the 4 KPI cards (§4.3)
 *   /employees/workflow-summary  — open engine workflows about an employee (§5.2)
 *   /employees/statutory/get     — sensitive statutory read
 *   /employees/statutory/update  — statutory write + payroll-readiness recompute (+ handoff signal)
 *   /employees/contact/update    — work/personal/emergency contact (direct + request modes, §6.3)
 *   /employee-change-requests/decide — maker-checker apply of a contact_update request
 *
 * ACCESS CONTROL is tested against the REAL seeded role model (no per-user
 * permission overrides — those would test a synthetic model, not reality):
 *   • admin    — full Employee Master (create/update/statutory/restricted_contact)
 *   • manager  — view-only (hr.view + hr.employees.view) — every write denied
 *   • employee — no hr.* at all — every Employee-Master call denied
 *
 * REQUIRES (operator-applied) migrations:
 *   20260707000000_hr_employee_statutory.sql
 *   20260707000001_hr_employee_master_permissions.sql   (grants admin/hr_manager the keys)
 *   then  NOTIFY pgrst, 'reload schema';
 * If the picked admin is role 'admin' (not 'superadmin'), the create/statutory
 * tests need 20260707000001 applied; a 403 there means it has not been applied.
 *
 * Side-effects asserted per Spec §2 (via the service-role client): app_events,
 * hr_audit_log, hr_employee_statutory/assignments, hr_employee_change_requests.
 * All rows are tagged with h.TAG and removed in onCleanup (incl. Supabase Auth users).
 */

export const title = 'HR Employee Master';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = {
    empIds: [],          // created employees (app_users) — cascade-clean their satellites
    changeReqIds: [],    // contact change requests
    emp1: null, emp1No: null, emp1User: null, emp2: null,
    mgrTok: null, empTok: null,
    siteId: null, siteName: null, supName: null, createdSiteId: null,
  };

  // ── teardown (registered up-front so partial runs still clean up) ─────────────
  h.onCleanup(async () => {
    try { await sb.from('module_mutation_runs').delete().ilike('idempotency_key', `%${TAG}%`); } catch { /* table optional */ }
    for (const id of [...ctx.empIds, ...ctx.changeReqIds]) {
      await sb.from('app_events').delete().eq('source_entity_id', id);
    }
    for (const id of ctx.empIds) {
      await sb.from('hr_audit_log').delete().eq('employee_id', id);
    }
    if (ctx.empIds.length) {
      const { data: rows } = await sb.from('app_users').select('auth_id').in('id', ctx.empIds);
      await sb.from('app_users').delete().in('id', ctx.empIds);   // cascades statutory/assignments/history/change_requests
      for (const r of (rows ?? [])) {
        if (r.auth_id) { try { await sb.auth.admin.deleteUser(r.auth_id); } catch { /* ignore */ } }
      }
    }
    if (ctx.createdSiteId) { try { await sb.from('project_sites').delete().eq('id', ctx.createdSiteId); } catch { /* ignore */ } }
  });

  // ── identities: REAL active users of each role (permissions come from the genuine
  //    seed — no fabrication). manager = view-only tier; employee = no hr.* at all. ──
  {
    const { data: mgr } = await sb.from('app_users')
      .select('id, username, role, department_id').eq('role', 'manager').eq('status', 'active')
      .neq('id', admin.id).limit(1).maybeSingle();
    if (mgr) ctx.mgrTok = mint(mgr); else console.error('⚠ no active manager — manager-tier tests will misreport');

    const { data: emp } = await sb.from('app_users')
      .select('id, username, role, department_id').eq('role', 'employee').eq('status', 'active')
      .limit(1).maybeSingle();
    if (emp) ctx.empTok = mint(emp); else console.error('⚠ no active employee — employee-tier tests will misreport');
  }

  // ── site + supervisor for the resolution assertions. Site/Supervisor are REAL,
  //    resolved server-side (project_sites / app_users) — not client shortcuts. ──
  {
    const { data: s } = await sb.from('project_sites').select('id, name').limit(1).maybeSingle();
    if (s) { ctx.siteId = s.id; ctx.siteName = s.name; }
    else {
      const { data: ns } = await sb.from('project_sites')
        .insert({ name: `${TAG} Site`, latitude: 0, longitude: 0 }).select('id, name').maybeSingle();
      if (ns) { ctx.siteId = ns.id; ctx.siteName = ns.name; ctx.createdSiteId = ns.id; }
    }
    const { data: adminRow } = await sb.from('app_users').select('full_name').eq('id', admin.id).maybeSingle();
    ctx.supName = adminRow?.full_name ?? null;
  }

  // ── create ───────────────────────────────────────────────────────────────────
  await test('create employee (admin) → active + payroll READY', async () => {
    const u = `e2e-${TAG}-alpha`.toLowerCase();
    const r = await api('hr/employees/create', A, {
      identity:   { username: u, password: 'Passw0rd!23', fullName: `${TAG} Alpha One`, phone: '555-0001' },
      employment: { employmentType: 'employee', startDate: '2026-01-15', position: 'Technician' },
      assignment: { departmentId: null, siteId: ctx.siteId, supervisorId: admin.id },
      access:     { role: 'employee' },
      statutory:  { nisStatus: 'registered', nisNumber: 'NIS-1001', payeApplicable: true, birFileNumber: 'BIR-1001', td1Received: true, hsApplicable: true, hsVerificationRequired: false },
    });
    ok(r, 'create alpha');
    expect(!!r.body.data.employee_id, 'employee_id returned');
    expect(/^EMP-\d{4}$/.test(r.body.data.employee_no), `employee_no format — got ${r.body.data.employee_no}`);
    expect(r.body.data.status === 'active', 'status active');
    expect(r.body.data.payroll_readiness === 'ready', `payroll ready — got ${r.body.data.payroll_readiness}`);
    expect(r.body.data.onboarding_case_id === null, 'onboarding_case_id null (onboarding is a later phase)');
    expect(r.body.data.workflow_id === null, 'workflow_id null');
    ctx.emp1 = r.body.data.employee_id; ctx.emp1No = r.body.data.employee_no; ctx.emp1User = u; ctx.empIds.push(ctx.emp1);
  });

  await test('create side-effects: mutation-run + event + audit + statutory + assignment + auth', async () => {
    // §5 — create goes through runModuleMutation, so an idempotency/observability row exists.
    const { data: run } = await sb.from('module_mutation_runs').select('status')
      .ilike('idempotency_key', `%${ctx.emp1User}%`).maybeSingle();
    expect(run && run.status === 'completed', `module_mutation_runs completed — got ${run && run.status}`);
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'hr.employee.created').eq('source_entity_id', ctx.emp1).limit(1);
    expect(ev && ev.length === 1, 'app_event hr.employee.created');
    const { data: au } = await sb.from('hr_audit_log').select('id').eq('employee_id', ctx.emp1).eq('action', 'hr.employee.created').limit(1);
    expect(au && au.length === 1, 'audit hr.employee.created');
    const { data: st } = await sb.from('hr_employee_statutory').select('payroll_ready_status, finance_handoff_eligible').eq('employee_id', ctx.emp1).maybeSingle();
    expect(st && st.payroll_ready_status === 'ready', 'statutory row READY');
    expect(st && st.finance_handoff_eligible === true, 'finance_handoff_eligible true');
    const { data: asg } = await sb.from('hr_employee_assignments').select('id').eq('employee_id', ctx.emp1).eq('is_current', true).limit(1);
    expect(asg && asg.length === 1, 'current assignment row');
    const { data: hist } = await sb.from('hr_employee_status_history').select('id').eq('employee_id', ctx.emp1).limit(1);
    expect(hist && hist.length === 1, 'initial status-history row');
    const { data: usr } = await sb.from('app_users').select('auth_id').eq('id', ctx.emp1).maybeSingle();
    expect(usr && !!usr.auth_id, 'Supabase Auth account linked (auth_id)');
  });

  await test('create employee (admin) → payroll BLOCKED (missing BIR/TD1)', async () => {
    const u = `e2e-${TAG}-beta`.toLowerCase();
    const r = await api('hr/employees/create', A, {
      identity:   { username: u, password: 'Passw0rd!23', fullName: `${TAG} Beta Two` },
      employment: { employmentType: 'contractor' },
      statutory:  { nisStatus: 'registered', nisNumber: 'NIS-2002', payeApplicable: true },
    });
    ok(r, 'create beta');
    expect(r.body.data.payroll_readiness === 'blocked', `payroll blocked — got ${r.body.data.payroll_readiness}`);
    ctx.emp2 = r.body.data.employee_id; ctx.empIds.push(ctx.emp2);
  });

  await test('create duplicate username → rejected', async () => {
    const r = await api('hr/employees/create', A, { identity: { username: `e2e-${TAG}-alpha`.toLowerCase(), password: 'Passw0rd!23', fullName: 'dup' } });
    fails(r, 'duplicate username rejected');
  });

  await test('create unauthorized (employee role) → denied', async () => {
    const r = await api('hr/employees/create', ctx.empTok, { identity: { username: `e2e-${TAG}-nope`.toLowerCase(), password: 'Passw0rd!23', fullName: 'nope' } });
    fails(r, 'employee cannot create');
  });

  await test('create unauthorized (manager is view-only) → denied', async () => {
    const r = await api('hr/employees/create', ctx.mgrTok, { identity: { username: `e2e-${TAG}-nope2`.toLowerCase(), password: 'Passw0rd!23', fullName: 'nope' } });
    fails(r, 'manager cannot create');
  });

  await test('create employee (admin) with onboarding → starts a case + tasks', async () => {
    const u = `e2e-${TAG}-gamma`.toLowerCase();
    const r = await api('hr/employees/create', A, {
      identity:   { username: u, password: 'Passw0rd!23', fullName: `${TAG} Gamma Three` },
      employment: { employmentType: 'employee' },
      onboarding: { createOnboardingCase: true, packageKey: 'standard_employee' },
    });
    ok(r, 'create gamma + onboarding');
    ctx.empIds.push(r.body.data.employee_id);
    expect(!!r.body.data.onboarding_case_id, `onboarding_case_id returned — got ${r.body.data.onboarding_case_id}`);
    expect(!r.body.data.onboarding_error, `no onboarding error — got ${r.body.data.onboarding_error}`);
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status').eq('id', r.body.data.onboarding_case_id).maybeSingle();
    expect(kase && kase.status === 'in_progress', 'onboarding case in_progress');
    const { count } = await sb.from('hr_onboarding_tasks').select('id', { count: 'exact', head: true }).eq('case_id', r.body.data.onboarding_case_id);
    expect((count ?? 0) > 0, 'onboarding tasks generated');
  });

  // ── list (extended) ────────────────────────────────────────────────────────
  await test('list (admin) → rows carry workerType + trainingStatus + siteName + supervisorName', async () => {
    const r = await api('hr/employees/list', A, { search: TAG });
    ok(r, 'list');
    expect(Array.isArray(r.body.data), 'array');
    const e1 = r.body.data.find(x => x.id === ctx.emp1);
    expect(!!e1, 'alpha present');
    expect(e1.workerType === 'employee', `workerType employee — got ${e1 && e1.workerType}`);
    expect(['none', 'current', 'due_soon', 'expired'].includes(e1.trainingStatus), `trainingStatus — got ${e1 && e1.trainingStatus}`);
    expect(e1.siteName === ctx.siteName, `siteName resolved server-side from project_sites — got ${e1 && e1.siteName}`);
    expect(e1.supervisorName === ctx.supName, `supervisorName resolved server-side from app_users — got ${e1 && e1.supervisorName}`);
  });

  await test('list workerType=contractor filter', async () => {
    const r = await api('hr/employees/list', A, { workerType: 'contractor', search: TAG });
    ok(r, 'list contractors');
    const ids = r.body.data.map(x => x.id);
    expect(ids.includes(ctx.emp2), 'beta (contractor) present');
    expect(!ids.includes(ctx.emp1), 'alpha (employee) excluded');
  });

  await test('list (manager hr.view) → allowed', async () => {
    const r = await api('hr/employees/list', ctx.mgrTok, { search: TAG });
    ok(r, 'manager list');
  });

  await test('list (employee, no hr.view) → denied', async () => {
    const r = await api('hr/employees/list', ctx.empTok, { search: TAG });
    fails(r, 'employee cannot list');
  });

  // ── get (extended) ───────────────────────────────────────────────────────────
  await test('get (admin) → embeds statutory + payrollReadiness + workerType', async () => {
    const r = await api('hr/employees/get', A, { employeeId: ctx.emp1 });
    ok(r, 'get alpha');
    expect(r.body.data.employee.id === ctx.emp1, 'employee');
    expect(r.body.data.employee.workerType === 'employee', 'workerType');
    expect(r.body.data.employee.siteName === ctx.siteName, `siteName embedded — got ${r.body.data.employee.siteName}`);
    expect(r.body.data.employee.supervisorName === ctx.supName, `supervisorName embedded — got ${r.body.data.employee.supervisorName}`);
    expect(r.body.data.statutory && r.body.data.statutory.payroll_ready_status === 'ready', 'statutory embedded');
    expect(r.body.data.payrollReadiness && r.body.data.payrollReadiness.status === 'ready', 'payrollReadiness present');
  });

  await test('get (manager, no statutory.view) → statutory hidden', async () => {
    const r = await api('hr/employees/get', ctx.mgrTok, { employeeId: ctx.emp1 });
    ok(r, 'manager get');
    expect(r.body.data.statutory === null, 'statutory hidden for manager');
    expect(r.body.data.payrollReadiness === null, 'payrollReadiness hidden for manager');
  });

  // ── dashboard-stats ────────────────────────────────────────────────────────
  await test('dashboard-stats (admin) → 4 cards, all computed', async () => {
    const r = await api('hr/employees/dashboard-stats', A, {});
    ok(r, 'dashboard-stats');
    const s = r.body.data.stats;
    expect(s.active_workforce && typeof s.active_workforce.total === 'number', 'active_workforce.total');
    expect(Array.isArray(s.active_workforce.trend) && s.active_workforce.trend.length === 6, 'trend has 6 months');
    expect(s.hr_work_queue && Array.isArray(s.hr_work_queue.mix), 'hr_work_queue.mix');
    expect(s.readiness && typeof s.readiness.percent === 'number', 'readiness.percent');
    expect(s.exceptions && Array.isArray(s.exceptions.items), 'exceptions.items');
    expect(s.active_workforce.total >= 1, 'at least one active worker');
  });

  await test('dashboard-stats (manager hr.employees.view) → allowed', async () => {
    const r = await api('hr/employees/dashboard-stats', ctx.mgrTok, {});
    ok(r, 'manager dashboard-stats');
  });

  await test('dashboard-stats (employee) → denied', async () => {
    const r = await api('hr/employees/dashboard-stats', ctx.empTok, {});
    fails(r, 'employee cannot read dashboard-stats');
  });

  // ── workflow-summary ───────────────────────────────────────────────────────
  await test('workflow-summary (admin) → reads central engine', async () => {
    const r = await api('hr/employees/workflow-summary', A, { employeeId: ctx.emp1 });
    ok(r, 'workflow-summary');
    expect(r.body.data.employee_id === ctx.emp1, 'employee_id echoed');
    expect(typeof r.body.data.open_count === 'number', 'open_count');
    expect(typeof r.body.data.urgent_count === 'number', 'urgent_count');
    expect(Array.isArray(r.body.data.items), 'items array');
  });

  await test('workflow-summary (employee) → denied', async () => {
    const r = await api('hr/employees/workflow-summary', ctx.empTok, { employeeId: ctx.emp1 });
    fails(r, 'employee cannot read workflow-summary');
  });

  // ── drawer read sources (audit actor resolution / training-summary / documents) ──
  await test('audit (admin) → entries with actor names resolved server-side', async () => {
    const r = await api('hr/employees/audit', A, { employeeId: ctx.emp1 });
    ok(r, 'audit');
    expect(Array.isArray(r.body.data), 'array');
    const created = r.body.data.find(x => x.action === 'hr.employee.created');
    expect(!!created, 'created audit entry present');
    expect(created.actorName === ctx.supName, `actorName resolved (not raw id) — got ${created && created.actorName}`);
  });

  await test('training-summary (admin) → counts + certificates shape', async () => {
    const r = await api('hr/employees/training-summary', A, { employeeId: ctx.emp1 });
    ok(r, 'training-summary');
    const t = r.body.data;
    expect(typeof t.total === 'number' && typeof t.current === 'number' && Array.isArray(t.certificates), 'counts + certificates');
  });

  await test('documents/list (admin) → array', async () => {
    const r = await api('hr/employees/documents/list', A, { employeeId: ctx.emp1 });
    ok(r, 'documents/list');
    expect(Array.isArray(r.body.data), 'array');
  });

  await test('sites/list (admin) → array (Create wizard option source)', async () => {
    const r = await api('hr/sites/list', A, {});
    ok(r, 'sites/list');
    expect(Array.isArray(r.body.data), 'array');
  });

  // ── statutory ──────────────────────────────────────────────────────────────
  await test('statutory/get (admin) → statutory + readiness', async () => {
    const r = await api('hr/employees/statutory/get', A, { employeeId: ctx.emp2 });
    ok(r, 'statutory/get');
    expect(r.body.data.readiness && r.body.data.readiness.status === 'blocked', `blocked — got ${r.body.data.readiness && r.body.data.readiness.status}`);
  });

  await test('statutory/get (manager) → denied', async () => {
    const r = await api('hr/employees/statutory/get', ctx.mgrTok, { employeeId: ctx.emp2 });
    fails(r, 'manager cannot read statutory');
  });

  await test('statutory/update (admin) blocked→READY + finance handoff signal', async () => {
    const r = await api('hr/employees/statutory/update', A, { employeeId: ctx.emp2, birFileNumber: 'BIR-2002', td1Received: true });
    ok(r, 'statutory/update');
    expect(r.body.data.payroll_readiness === 'ready', `ready — got ${r.body.data.payroll_readiness}`);
    expect(r.body.data.financeHandoffEligible === true, 'finance handoff eligible');
    const { data: ev } = await sb.from('app_events').select('event_type').eq('source_entity_id', ctx.emp2).in('event_type', ['hr.employee.statutory_updated', 'hr.employee.payroll_ready']);
    const types = (ev ?? []).map(x => x.event_type);
    expect(types.includes('hr.employee.statutory_updated'), 'statutory_updated event');
    expect(types.includes('hr.employee.payroll_ready'), 'payroll_ready handoff event (crossed to ready)');
    const { data: st } = await sb.from('hr_employee_statutory').select('payroll_ready_status, finance_handoff_eligible').eq('employee_id', ctx.emp2).maybeSingle();
    expect(st && st.payroll_ready_status === 'ready' && st.finance_handoff_eligible === true, 'satellite snapshot synced');
  });

  await test('statutory/update (manager) → denied', async () => {
    const r = await api('hr/employees/statutory/update', ctx.mgrTok, { employeeId: ctx.emp2, td1Received: true });
    fails(r, 'manager cannot update statutory');
  });

  // ── contact/update ─────────────────────────────────────────────────────────
  await test('contact/update direct WORK contact (admin)', async () => {
    const r = await api('hr/employees/contact/update', A, { employeeId: ctx.emp1, mode: 'direct', work: { phone: '555-9999' } });
    ok(r, 'contact direct work');
    expect(r.body.data.mode === 'direct', 'mode direct');
    const { data: u } = await sb.from('app_users').select('phone').eq('id', ctx.emp1).maybeSingle();
    expect(u && u.phone === '555-9999', 'work phone applied');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'hr.employee.contact_updated').eq('source_entity_id', ctx.emp1).limit(1);
    expect(ev && ev.length >= 1, 'contact_updated event');
  });

  await test('contact/update direct EMERGENCY contact (admin, restricted)', async () => {
    const r = await api('hr/employees/contact/update', A, { employeeId: ctx.emp1, mode: 'direct', emergency: { name: `${TAG} Kin`, phone: '555-7777', relationship: 'Spouse' } });
    ok(r, 'contact direct emergency');
    const { data: u } = await sb.from('app_users').select('emergency_contact_name').eq('id', ctx.emp1).maybeSingle();
    expect(u && u.emergency_contact_name === `${TAG} Kin`, 'emergency name applied');
    // get now returns emergency_contact_* (HR_COLS extended) so the Edit Contact modal can pre-fill
    const g = await api('hr/employees/get', A, { employeeId: ctx.emp1 });
    expect(g.body.data.employee.emergency_contact_name === `${TAG} Kin`, 'get returns emergency_contact_name for pre-fill');
  });

  await test('contact/update WORK direct (manager lacks hr.employees.update) → denied', async () => {
    const r = await api('hr/employees/contact/update', ctx.mgrTok, { employeeId: ctx.emp1, mode: 'direct', work: { phone: '555-1111' } });
    fails(r, 'manager cannot direct-update work contact');
  });

  await test('contact/update EMERGENCY direct (manager lacks restricted_contact.update) → denied', async () => {
    const r = await api('hr/employees/contact/update', ctx.mgrTok, { employeeId: ctx.emp1, mode: 'direct', emergency: { phone: '555-0000' } });
    fails(r, 'manager cannot direct-update restricted contact');
  });

  await test('contact/update REQUEST mode (manager maker) → change request created', async () => {
    const r = await api('hr/employees/contact/update', ctx.mgrTok, { employeeId: ctx.emp1, mode: 'request', personal: { personalEmail: `e2e-${TAG}@personal.test` }, reason: 'employee requested email change' });
    ok(r, 'contact request mode');
    expect(r.body.data.mode === 'request' && !!r.body.data.requestId, 'requestId returned');
    ctx.changeReqIds.push(r.body.data.requestId);
    // Engine-wired (Spec §14): createChangeRequest starts a workflow_instance and the
    // hr_employee_master adapter moves the request to in_review on start.
    const { data: cr } = await sb.from('hr_employee_change_requests').select('change_type, status, workflow_id').eq('id', r.body.data.requestId).maybeSingle();
    expect(cr && cr.change_type === 'contact_update' && ['submitted', 'in_review'].includes(cr.status), `change request row (contact_update) — got ${cr?.status}`);
    expect(!!cr.workflow_id, 'change request linked to a workflow_instance (central engine)');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'hr.employee.change_requested').eq('source_entity_id', r.body.data.requestId).limit(1);
    expect(ev && ev.length === 1, 'change_requested event');
  });

  await test('change-request decide approve (admin) → applies contact_update', async () => {
    const r = await api('hr/employee-change-requests/decide', A, { requestId: ctx.changeReqIds[0], decision: 'approve' });
    ok(r, 'decide approve');
    expect(r.body.data.status === 'applied', `applied — got ${r.body.data.status}`);
    const { data: u } = await sb.from('app_users').select('personal_email').eq('id', ctx.emp1).maybeSingle();
    expect(u && u.personal_email === `e2e-${TAG}@personal.test`, 'personal_email applied to record');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'hr.employee.change_applied').eq('source_entity_id', ctx.changeReqIds[0]).limit(1);
    expect(ev && ev.length === 1, 'change_applied event');
  });

  // ── status-change (Change Status / Offboarding dialogs) ──────────────────────
  await test('status-change (admin) → status applied + history row', async () => {
    const r = await api('hr/employees/status-change', A, { employeeId: ctx.emp2, newStatus: 'on_leave', reason: `${TAG} status test` });
    ok(r, 'status-change');
    expect(r.body.data.status === 'on_leave', `status applied — got ${r.body.data.status}`);
    const { data: hist } = await sb.from('hr_employee_status_history').select('new_status').eq('employee_id', ctx.emp2).order('changed_at', { ascending: false }).limit(1).maybeSingle();
    expect(hist && hist.new_status === 'on_leave', 'status history row written');
  });
}
