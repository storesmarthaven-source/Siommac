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
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = {
    empIds: [],          // created employees (app_users) — cascade-clean their satellites
    changeReqIds: [],    // contact change requests
    offboardingCaseIds: [], // seeded hr_offboarding_cases (offboardingActive flag coverage)
    emp1: null, emp1No: null, emp1User: null, emp2: null,
    mgrTok: null, empTok: null,
    hrMgrTok: null, hrMgrCreatedIds: [],   // real hr_manager to decide the engine-driven change request
    siteId: null, siteName: null, supName: null, createdSiteId: null, accessProfileId: null,
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
    // Before the app_users delete that would cascade them away anyway — explicit, so a
    // partial run never leaves an orphan case behind.
    if (ctx.offboardingCaseIds.length) {
      try { await sb.from('hr_offboarding_cases').delete().in('id', ctx.offboardingCaseIds); } catch { /* ignore */ }
    }
    if (ctx.empIds.length) {
      const { data: rows } = await sb.from('app_users').select('auth_id').in('id', ctx.empIds);
      await sb.from('app_users').delete().in('id', ctx.empIds);   // cascades statutory/assignments/history/change_requests
      for (const r of (rows ?? [])) {
        if (r.auth_id) { try { await sb.auth.admin.deleteUser(r.auth_id); } catch { /* ignore */ } }
      }
    }
    if (ctx.createdSiteId) { try { await sb.from('project_sites').delete().eq('id', ctx.createdSiteId); } catch { /* ignore */ } }
    // Best-effort: remove the provisioned hr_manager (may be FK-pinned by the workflow
    // decision it made — the orphan sweeper mops up any remainder).
    if (ctx.hrMgrCreatedIds?.length) { try { await sb.from('app_users').delete().in('id', ctx.hrMgrCreatedIds); } catch { /* ignore */ } }
  });

  // ── identities: REAL active users of each role (permissions come from the genuine
  //    seed — no fabrication). manager = view-only tier; employee = no hr.* at all. ──
  {
    const { data: mgr } = await sb.from('app_users')
      .select('id, username, role, department_id').eq('role', 'manager').eq('status', 'active')
      .neq('id', admin.id).limit(1).maybeSingle();
    if (mgr) ctx.mgrTok = mint(mgr); else console.error('⚠ no active manager — manager-tier tests will misreport');

    // A real hr_manager to decide the change request: it's engine-driven (a workflow
    // is started at submit) and its approval task is assigned to the hr_manager ROLE,
    // so the finding-#1 assignment guard denies the admin harness. Provision one.
    const hrMgrR = await acquireActors('hr_manager', 1);
    const hrMgr = hrMgrR.actors[0];
    ctx.hrMgrCreatedIds = hrMgrR.createdIds;
    ctx.hrMgrTok = mint({ id: hrMgr.id, username: hrMgr.username, role: 'hr_manager', department_id: hrMgr.department_id ?? null });

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

  // The create contract requires an approved accessProfileId (raw roles were removed).
  await test('resolve an active access profile for the create contract', async () => {
    const { data: prof } = await sb.from('hr_access_profiles')
      .select('id, code').eq('is_active', true).eq('code', 'employee').maybeSingle();
    expect(!!prof, 'an active "employee" access profile exists (migration 20260919000741)');
    ctx.accessProfileId = prof.id;
  });

  // ── create ───────────────────────────────────────────────────────────────────
  await test('create employee (admin) → active + payroll READY', async () => {
    const u = `e2e-${TAG}-alpha`.toLowerCase();
    const r = await api('hr/employees/create', A, {
      requestKey: crypto.randomUUID(),
      identity:   { username: u, firstName: `${TAG}`, lastName: 'Alpha One', phone: '555-0001' },
      employment: { employmentType: 'employee', startDate: '2026-01-15', position: 'Technician' },
      assignment: { departmentId: null, siteId: ctx.siteId, supervisorId: admin.id },
      access:     { accessProfileId: ctx.accessProfileId, accountMode: 'no_login' },
      statutory:  { nisStatus: 'registered', nisNumber: 'NIS-1001', payeApplicable: true, birFileNumber: 'BIR-1001', td1Received: true, hsApplicable: true, hsVerificationRequired: false },
    });
    ok(r, 'create alpha');
    expect(!!r.body.data.employee_id, 'employee_id returned');
    expect(/^EMP-\d{4}$/.test(r.body.data.employee_no), `employee_no format — got ${r.body.data.employee_no}`);
    expect(r.body.data.status === 'active', 'status active');
    expect(r.body.data.payroll_readiness === 'ready', `payroll ready — got ${r.body.data.payroll_readiness}`);
    expect(r.body.data.onboarding_case_id === null, 'onboarding_case_id null when not requested');
    expect(r.body.data.onboarding_status === 'not_requested', `onboarding_status — got ${r.body.data.onboarding_status}`);
    // Create NEVER provisions an account: no password is accepted and no Auth user is made.
    expect(r.body.data.account_status === 'not_requested', `account_status — got ${r.body.data.account_status}`);
    ctx.emp1 = r.body.data.employee_id; ctx.emp1No = r.body.data.employee_no; ctx.emp1User = u; ctx.empIds.push(ctx.emp1);
  });

  await test('create side-effects: mutation-run + event + audit + statutory + assignment + auth', async () => {
    // §5 — create goes through runModuleMutation, so an idempotency/observability row exists.
    const { data: run } = await sb.from('module_mutation_runs').select('status')
      .eq('entity_id', ctx.emp1).maybeSingle();
    expect(run && run.status === 'completed', `module_mutation_runs completed — got ${run && run.status}`);
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'hr.employee.created').eq('source_entity_id', ctx.emp1).limit(1);
    expect(ev && ev.length === 1, 'app_event hr.employee.created');
    const { data: au } = await sb.from('hr_audit_log').select('id').eq('employee_id', ctx.emp1).eq('action', 'hr.employee.created').limit(1);
    expect(au && au.length === 1, 'audit hr.employee.created');
    const { data: st } = await sb.from('hr_employee_statutory_profiles').select('payroll_ready_status, finance_handoff_eligible').eq('employee_id', ctx.emp1).eq('jurisdiction', 'TT').maybeSingle();
    expect(st && st.payroll_ready_status === 'ready', 'statutory row READY');
    expect(st && st.finance_handoff_eligible === true, 'finance_handoff_eligible true');
    const { data: asg } = await sb.from('hr_employee_assignments').select('id').eq('employee_id', ctx.emp1).eq('is_current', true).limit(1);
    expect(asg && asg.length === 1, 'current assignment row');
    const { data: hist } = await sb.from('hr_employee_status_history').select('id').eq('employee_id', ctx.emp1).limit(1);
    expect(hist && hist.length === 1, 'initial status-history row');
    const { data: usr } = await sb.from('app_users').select('auth_id').eq('id', ctx.emp1).maybeSingle();
    expect(usr && usr.auth_id === null, 'employee record is created without an Auth account');
  });

  await test('create employee (admin) → payroll BLOCKED (missing BIR/TD1)', async () => {
    const u = `e2e-${TAG}-beta`.toLowerCase();
    const r = await api('hr/employees/create', A, {
      requestKey: crypto.randomUUID(),
      identity:   { username: u, firstName: `${TAG}`, lastName: 'Beta Two' },
      employment: { employmentType: 'contractor', startDate: '2026-02-01' },
      access:     { accessProfileId: ctx.accessProfileId, accountMode: 'no_login' },
      statutory:  { nisStatus: 'registered', nisNumber: 'NIS-2002', payeApplicable: true },
    });
    ok(r, 'create beta');
    expect(r.body.data.payroll_readiness === 'blocked', `payroll blocked — got ${r.body.data.payroll_readiness}`);
    ctx.emp2 = r.body.data.employee_id; ctx.empIds.push(ctx.emp2);
  });

  await test('create duplicate username → rejected', async () => {
    const r = await api('hr/employees/create', A, { requestKey: crypto.randomUUID(), identity: { username: `e2e-${TAG}-alpha`.toLowerCase(), firstName: 'X', lastName: 'dup' }, employment: { employmentType: 'employee', startDate: '2026-01-15' }, access: { accessProfileId: ctx.accessProfileId, accountMode: 'no_login' } });
    fails(r, 'duplicate username rejected');
  });

  await test('create unauthorized (employee role) → denied', async () => {
    const r = await api('hr/employees/create', ctx.empTok, { requestKey: crypto.randomUUID(), identity: { username: `e2e-${TAG}-nope`.toLowerCase(), firstName: 'X', lastName: 'nope' }, employment: { employmentType: 'employee', startDate: '2026-01-15' }, access: { accessProfileId: ctx.accessProfileId, accountMode: 'no_login' } });
    fails(r, 'employee cannot create');
  });

  await test('create unauthorized (manager is view-only) → denied', async () => {
    const r = await api('hr/employees/create', ctx.mgrTok, { requestKey: crypto.randomUUID(), identity: { username: `e2e-${TAG}-nope2`.toLowerCase(), firstName: 'X', lastName: 'nope' }, employment: { employmentType: 'employee', startDate: '2026-01-15' }, access: { accessProfileId: ctx.accessProfileId, accountMode: 'no_login' } });
    fails(r, 'manager cannot create');
  });

  await test('create employee (admin) with onboarding → starts a case + tasks', async () => {
    const u = `e2e-${TAG}-gamma`.toLowerCase();
    const r = await api('hr/employees/create', A, {
      requestKey: crypto.randomUUID(),
      identity:   { username: u, firstName: `${TAG}`, lastName: 'Gamma Three' },
      employment: { employmentType: 'employee', startDate: '2026-03-01' },
      access:     { accessProfileId: ctx.accessProfileId, accountMode: 'no_login' },
      onboarding: { prepareOnboarding: true, packageKey: 'standard_employee' },
    });
    ok(r, 'create gamma + onboarding');
    ctx.empIds.push(r.body.data.employee_id);
    expect(!!r.body.data.onboarding_case_id, `onboarding_case_id returned — got ${r.body.data.onboarding_case_id}`);
    expect(r.body.data.onboarding_status === 'draft_prepared', `onboarding_status draft_prepared — got ${r.body.data.onboarding_status}`);
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status').eq('id', r.body.data.onboarding_case_id).maybeSingle();
    // Create PREPARES a draft; launching is a separate, explicit action.
    expect(kase && kase.status === 'draft', `onboarding case draft — got ${kase && kase.status}`);
    const { count } = await sb.from('hr_onboarding_tasks').select('id', { count: 'exact', head: true }).eq('case_id', r.body.data.onboarding_case_id);
    expect((count ?? 0) === 0, 'draft preparation does not launch onboarding tasks');
  });

  // ── list (extended) ────────────────────────────────────────────────────────
  await test('list (admin) → rows carry resolved names and server-computed readiness', async () => {
    const r = await api('hr/employees/list', A, { search: TAG });
    ok(r, 'list');
    expect(Array.isArray(r.body.data), 'array');
    const e1 = r.body.data.find(x => x.id === ctx.emp1);
    expect(!!e1, 'alpha present');
    expect(e1.workerType === 'employee', `workerType employee — got ${e1 && e1.workerType}`);
    expect(['none', 'current', 'due_soon', 'expired'].includes(e1.trainingStatus), `trainingStatus — got ${e1 && e1.trainingStatus}`);
    expect(e1.readiness && typeof e1.readiness.percent === 'number', 'readiness.percent');
    expect(e1.readiness.assignmentComplete === false, 'readiness assignment derives from missing department');
    expect(e1.readiness.payrollStatus === 'ready', `readiness payrollStatus — got ${e1.readiness.payrollStatus}`);
    expect(Array.isArray(e1.readiness.blockers) && e1.readiness.blockers.includes('assignment'), 'readiness blockers');
    expect(e1.siteName === ctx.siteName, `siteName resolved server-side from project_sites — got ${e1 && e1.siteName}`);
    expect(e1.supervisorName === ctx.supName, `supervisorName resolved server-side from app_users — got ${e1 && e1.supervisorName}`);
    // The register's row menu gates "Start Offboarding" on this flag, so it must always be
    // present and boolean — never undefined, which the UI would read as "not offboarding".
    expect(e1.offboardingActive === false, `offboardingActive false for a fresh employee — got ${e1 && e1.offboardingActive}`);
    expect(r.body.data.every(row => typeof row.offboardingActive === 'boolean'), 'offboardingActive is boolean on every row');
  });

  await test('list → offboardingActive flips once an offboarding case is open', async () => {
    const { data: created, error } = await sb.from('hr_offboarding_cases')
      .insert({
        case_no: `OFF-${TAG}`,
        employee_id: ctx.emp1,
        reason: 'resignation',
        status: 'in_progress',
        started_by: admin.id,
      }).select('id').single();
    expect(!error, `seed offboarding case — ${error && error.message}`);
    ctx.offboardingCaseIds.push(created.id);

    const r = await api('hr/employees/list', A, { search: TAG });
    ok(r, 'list after offboarding case');
    const e1 = r.body.data.find(x => x.id === ctx.emp1);
    expect(e1.offboardingActive === true, `offboardingActive true with an open case — got ${e1 && e1.offboardingActive}`);

    // A completed case must NOT keep the employee flagged.
    const { error: upErr } = await sb.from('hr_offboarding_cases').update({ status: 'completed' }).eq('id', created.id);
    expect(!upErr, `complete offboarding case — ${upErr && upErr.message}`);
    const after = await api('hr/employees/list', A, { search: TAG });
    ok(after, 'list after case completion');
    const e1After = after.body.data.find(x => x.id === ctx.emp1);
    expect(e1After.offboardingActive === false, `offboardingActive false once the case completes — got ${e1After && e1After.offboardingActive}`);
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
    expect(r.body.data.every(row => row.readiness === null), 'readiness hidden without payroll-readiness permission');
  });

  await test('list (employee, no hr.view) → denied', async () => {
    const r = await api('hr/employees/list', ctx.empTok, { search: TAG });
    fails(r, 'employee cannot list');
  });

  // ── get (extended) ───────────────────────────────────────────────────────────
  await test('get (admin) → complete employee-record read model', async () => {
    const r = await api('hr/employees/get', A, { employeeId: ctx.emp1 });
    ok(r, 'get alpha');
    expect(r.body.data.employee.id === ctx.emp1, 'employee');
    expect(r.body.data.employee.workerType === 'employee', 'workerType');
    expect(typeof r.body.data.employee.accountStatus === 'string', 'accountStatus is distinct from employment status');
    expect(r.body.data.employee.siteName === ctx.siteName, `siteName embedded — got ${r.body.data.employee.siteName}`);
    expect(r.body.data.employee.supervisorName === ctx.supName, `supervisorName embedded — got ${r.body.data.employee.supervisorName}`);
    expect(r.body.data.statutory && r.body.data.statutory.payroll_ready_status === 'ready', 'statutory embedded');
    expect(r.body.data.payrollReadiness && r.body.data.payrollReadiness.status === 'ready', 'payrollReadiness present');
    expect(r.body.data.employee.readiness && typeof r.body.data.employee.readiness.percent === 'number', 'employee readiness present');
    expect(r.body.data.employee.readiness.assignmentComplete === false, 'detail readiness matches register assignment rule');
    expect(r.body.data.employee.readiness.payrollStatus === 'ready', 'detail readiness carries payroll status');
    expect(r.body.data.employee.readiness.blockers.includes('assignment'), 'detail readiness carries blockers');
    expect('mobile_phone' in r.body.data.employee, 'employee exposes a distinct mobile_phone field');
    expect(typeof r.body.data.employee.created_at === 'string', 'employee exposes record creation time');
    expect(Array.isArray(r.body.data.assignmentHistory), 'assignmentHistory array');
    expect(r.body.data.assignmentHistory.every(x => (
      'departmentName' in x && 'siteName' in x && 'supervisorName' in x && 'positionTitle' in x
    )), 'assignmentHistory carries resolved display values');
    expect('currentAssignment' in r.body.data, 'currentAssignment field');
    expect('payGroup' in r.body.data, 'payGroup field is explicit even when unassigned');
    expect('accessProfile' in r.body.data, 'accessProfile field is explicit');
  });

  await test('get (manager, no statutory.view) → statutory hidden', async () => {
    const r = await api('hr/employees/get', ctx.mgrTok, { employeeId: ctx.emp1 });
    ok(r, 'manager get');
    expect(r.body.data.statutory === null, 'statutory hidden for manager');
    expect(r.body.data.payrollReadiness === null, 'payrollReadiness hidden for manager');
    expect(r.body.data.employee.readiness === null, 'employee readiness hidden without readiness permission');
    expect(r.body.data.accessProfile === null, 'access profile hidden without auth.security.view');
  });

  // ── dashboard-stats ────────────────────────────────────────────────────────
  await test('dashboard-stats (admin) → complete workspace contract, all computed', async () => {
    const r = await api('hr/employees/dashboard-stats', A, {});
    ok(r, 'dashboard-stats');
    const s = r.body.data.stats;
    expect(s.active_workforce && typeof s.active_workforce.total === 'number', 'active_workforce.total');
    expect(Array.isArray(s.active_workforce.trend) && s.active_workforce.trend.length === 6, 'trend has 6 months');
    expect(s.hr_work_queue && Array.isArray(s.hr_work_queue.mix), 'hr_work_queue.mix');
    expect(typeof s.hr_work_queue.oldest_days === 'number', 'hr_work_queue.oldest_days');
    expect(s.readiness && typeof s.readiness.percent === 'number', 'readiness.percent');
    expect(typeof s.readiness.assignment_complete === 'number', 'readiness.assignment_complete');
    expect(s.exceptions && Array.isArray(s.exceptions.items), 'exceptions.items');
    expect(s.distribution && Array.isArray(s.distribution.departments) && Array.isArray(s.distribution.sites), 'distribution arrays');
    expect(s.distribution.departments.every(x => typeof x.label === 'string' && typeof x.count === 'number' && typeof x.percent === 'number'), 'department distribution envelope');
    expect(s.lifecycle && Array.isArray(s.lifecycle.periods) && s.lifecycle.periods.length === 6, 'lifecycle has 6 months');
    expect(s.lifecycle.periods.every(x => typeof x.hires === 'number' && typeof x.exits === 'number' && typeof x.transfers === 'number' && typeof x.promotions === 'number'), 'lifecycle period envelope');
    expect(['hires', 'exits', 'transfers', 'promotions'].every(key => typeof s.lifecycle.totals[key] === 'number'), 'lifecycle totals envelope');
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
    const { data: st } = await sb.from('hr_employee_statutory_profiles').select('payroll_ready_status, finance_handoff_eligible').eq('employee_id', ctx.emp2).eq('jurisdiction', 'TT').maybeSingle();
    expect(st && st.payroll_ready_status === 'ready' && st.finance_handoff_eligible === true, 'satellite snapshot synced');
  });

  await test('statutory/update (manager) → denied', async () => {
    const r = await api('hr/employees/statutory/update', ctx.mgrTok, { employeeId: ctx.emp2, td1Received: true });
    fails(r, 'manager cannot update statutory');
  });

  // ── contact/update ─────────────────────────────────────────────────────────
  await test('contact/update direct WORK contact (admin)', async () => {
    const r = await api('hr/employees/contact/update', A, {
      employeeId: ctx.emp1,
      mode: 'direct',
      work: { phone: '555-9999', mobilePhone: '555-8888' },
    });
    ok(r, 'contact direct work');
    expect(r.body.data.mode === 'direct', 'mode direct');
    const { data: u } = await sb.from('app_users').select('phone, mobile_phone').eq('id', ctx.emp1).maybeSingle();
    expect(u && u.phone === '555-9999', 'work phone applied');
    expect(u && u.mobile_phone === '555-8888', 'mobile phone applied independently');
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

  await test('contact/update REQUEST mode (manager maker) → change request created (Shape-B atomic)', async () => {
    const r = await api('hr/employees/contact/update', ctx.mgrTok, { employeeId: ctx.emp1, mode: 'request', personal: { personalEmail: `e2e-${TAG}@personal.test` }, reason: 'employee requested email change' });
    ok(r, 'contact request mode');
    expect(r.body.data.mode === 'request' && !!r.body.data.requestId, 'requestId returned');
    ctx.changeReqIds.push(r.body.data.requestId);
    // Shape-B atomic: workflow_create_and_start_tx commits the CR row, workflow_id link,
    // app_event and hr_audit_log in ONE transaction. status must be 'in_review' immediately
    // (not 'submitted'); workflow_id must be set on the same committed row.
    const { data: cr } = await sb.from('hr_employee_change_requests')
      .select('change_type, status, workflow_id').eq('id', r.body.data.requestId).maybeSingle();
    expect(cr && cr.change_type === 'contact_update', `change_type wrong — got ${cr?.change_type}`);
    expect(cr.status === 'in_review', `status must be in_review immediately (atomic) — got ${cr?.status}`);
    expect(!!cr.workflow_id, 'workflow_id must be set in-commit (atomic)');

    // workflow_instance created and in_progress
    const { data: wfi } = await sb.from('workflow_instances')
      .select('id, status').eq('id', cr.workflow_id).maybeSingle();
    expect(wfi && wfi.status === 'in_progress', `workflow_instance not in_progress — got ${wfi?.status}`);

    // first task assigned to hr_manager role
    const { data: tasks } = await sb.from('workflow_tasks')
      .select('id, assigned_role, status').eq('workflow_id', cr.workflow_id).limit(5);
    expect(tasks && tasks.length > 0, 'no workflow_tasks created');
    expect(tasks.some(t => t.assigned_role === 'hr_manager'), `no task assigned to hr_manager — got ${JSON.stringify(tasks?.map(t => t.assigned_role))}`);

    // app_event committed in the same transaction
    const { data: ev } = await sb.from('app_events').select('id')
      .eq('event_type', 'hr.employee.change_requested').eq('source_entity_id', r.body.data.requestId).limit(1);
    expect(ev && ev.length === 1, 'change_requested app_event not written (should be in-commit)');

    // hr_audit_log written in-commit
    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'employees').eq('action', 'hr.employee.change_requested')
      .eq('record_id', r.body.data.requestId).limit(1);
    expect(audit && audit.length > 0, 'hr_audit_log for change_requested not written (should be in-commit)');

    // Idempotent retry — same key must return same record, no duplicate
    const r2 = await api('hr/employees/contact/update', ctx.mgrTok, { employeeId: ctx.emp1, mode: 'request', personal: { personalEmail: `e2e-${TAG}@personal.test` }, reason: 'employee requested email change' });
    ok(r2, 'idempotent retry ok');
    expect(r2.body.data.requestId === r.body.data.requestId, `idempotent retry must return same requestId — got ${r2.body.data.requestId}`);
    const { count: crCount } = await sb.from('hr_employee_change_requests')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', ctx.emp1).eq('change_type', 'contact_update');
    expect((crCount ?? 0) === 1, `duplicate CR created on retry — count: ${crCount}`);
  });

  await test('change-request decide approve (hr_manager) → applies contact_update', async () => {
    // Decided by a real hr_manager (assigned to the role task) — the engine-driven
    // change request routes through decideTask, whose finding-#1 guard denies the
    // non-assigned admin. Single-step approval completes inline → 'applied'.
    const r = await api('hr/employee-change-requests/decide', ctx.hrMgrTok, { requestId: ctx.changeReqIds[0], decision: 'approve' });
    ok(r, `decide approve — got ${r.body.message ?? ''}`);
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
