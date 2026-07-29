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
    accessAssignmentId: null, accessCorrelationId: null,  // access-assignment grant/revoke cycle
    hrStaffCreatedIds: [],                 // real hr_staff for the segregation-of-duties check
    siteId: null, siteName: null, supName: null, createdSiteId: null, accessProfileId: null,
    // The UI-preference tests write against the harness admin's OWN preferences,
    // which cannot be tagged (the key and user are fixed by the contract). Their
    // prior values are captured here and restored in teardown, so running the
    // suite never silently discards a real user's saved views or column choice.
    priorUiPreferences: null,
  };

  // ── teardown (registered up-front so partial runs still clean up) ─────────────
  h.onCleanup(async () => {
    if (ctx.priorUiPreferences) {
      for (const [key, prior] of Object.entries(ctx.priorUiPreferences)) {
        if (prior) {
          await sb.from('ui_user_preferences').upsert({
            user_id: admin.id, preference_key: key,
            preference_value: prior.preference_value, version: prior.version,
            updated_by: admin.id, updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,preference_key' });
        } else {
          await h.mustDelete('ui_user_preferences', q => q.eq('user_id', admin.id).eq('preference_key', key));
        }
      }
    }
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
    // Access assignments cascade from app_users, but the app_events and audit rows
    // they wrote do NOT — remove them explicitly, child-first, so a partial run
    // cannot leave an access event pointing at a deleted assignment.
    if (ctx.accessAssignmentId) {
      await h.mustDelete('hr_employee_access_scopes', q => q.eq('assignment_id', ctx.accessAssignmentId));
      await h.mustDelete('app_events', q => q.eq('source_entity_id', ctx.accessAssignmentId));
      await h.mustDelete('audit_logs', q => q.eq('record_id', ctx.accessAssignmentId));
      await h.mustDelete('hr_audit_log', q => q.eq('record_id', ctx.accessAssignmentId));
      await h.mustDelete('hr_employee_access_assignments', q => q.eq('id', ctx.accessAssignmentId));
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
    if (ctx.hrStaffCreatedIds?.length) { try { await sb.from('app_users').delete().in('id', ctx.hrStaffCreatedIds); } catch { /* ignore */ } }
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

  // ── profile shell + attention (the ONE Employee Profile contract) ──────────
  await test('profile-shell (admin) → exact contract the drawer and page consume', async () => {
    const r = await api('hr/employees/profile-shell', A, { employeeId: ctx.emp1 });
    ok(r, 'profile-shell alpha');
    const d = r.body.data;

    // identity
    expect(d.identity.employeeId === ctx.emp1, 'identity.employeeId echoes the request');
    expect(typeof d.identity.displayName === 'string' && d.identity.displayName.length > 0, 'identity.displayName resolved');
    expect(typeof d.identity.employmentStatus === 'string', 'identity.employmentStatus');
    expect(typeof d.identity.accountStatus === 'string', 'identity.accountStatus is distinct from employment status');
    expect(d.identity.siteName === ctx.siteName, `identity.siteName resolved — got ${d.identity.siteName}`);
    expect('employeeNo' in d.identity && 'profileImageUrl' in d.identity, 'identity carries employeeNo + profileImageUrl');

    // employment facts, including server-computed tenure
    expect('employmentBasis' in d.employment && 'workArrangement' in d.employment, 'employment facts present');
    expect(d.employment.supervisorName === ctx.supName, `employment.supervisorName resolved — got ${d.employment.supervisorName}`);
    expect(d.employment.tenureMonths === null || typeof d.employment.tenureMonths === 'number', 'tenureMonths computed server-side');
    expect('payGroupName' in d.employment, 'payGroupName explicit even when unassigned');

    // Readiness expressed as CONTROLS.
    //
    // `blockers` was the superseded three-factor shape; the typed readiness
    // service (5421ebc3) replaced it with `blockedDomains` counted from real
    // control instances, and `totalControls` is now whatever the control
    // catalogue defines rather than a hard-coded 3. This assertion was left
    // behind and only surfaced once the served build was current — a stale dev
    // build had been answering with the old shape.
    expect(d.readiness && typeof d.readiness.percent === 'number', 'readiness present for a statutory-capable actor');
    expect(typeof d.readiness.totalControls === 'number' && typeof d.readiness.readyControls === 'number',
      'readiness ready/total controls');
    expect(d.readiness.readyControls <= d.readiness.totalControls, 'ready controls cannot exceed the total');
    expect(Array.isArray(d.readiness.blockedDomains), 'readiness.blockedDomains array');
    expect(!('blockers' in d.readiness), 'readiness.blockers is the SUPERSEDED shape and must not be served');
    expect(d.readiness.blockedDomains.includes('assignment'), 'readiness reflects the incomplete assignment');

    // attention + indicators come from ONE source
    expect(Array.isArray(d.attentionPreview), 'attentionPreview array');
    expect(typeof d.attentionTotal === 'number', 'attentionTotal number');
    expect(d.attentionPreview.length <= d.attentionTotal, 'preview never exceeds the total');
    expect(d.attentionPreview.every(i => (
      typeof i.id === 'string' && typeof i.domain === 'string' && typeof i.title === 'string'
      && typeof i.detail === 'string' && ['critical', 'warning', 'info'].includes(i.severity)
      && ['overdue', 'due_soon', 'scheduled', 'none'].includes(i.dueState)
      && 'owner' in i && 'responsibleParty' in i && typeof i.actionLabel === 'string'
      && typeof i.actionTarget === 'string' && 'requiredCapability' in i
    )), 'every attention item carries the full canonical contract');
    expect(Array.isArray(d.tabIndicators), 'tabIndicators array');
    expect(d.tabIndicators.every(t => t.unresolvedCount > 0), 'no zero-count indicator is emitted');

    // The alpha fixture is created with departmentId:null (site + supervisor ARE set),
    // so exactly the department gap must surface — and nothing else from employment.
    expect(d.attentionPreview.some(i => i.id === 'employment.missing:department'),
      'the unassigned department surfaces as an attention item');
    expect(!d.attentionPreview.some(i => i.id === 'employment.missing:supervisor'
      || i.id === 'employment.missing:site'),
      'assigned supervisor/site do NOT produce phantom attention items');
    const employmentTab = d.tabIndicators.find(t => t.tab === 'employment');
    expect(employmentTab && employmentTab.unresolvedCount >= 1, 'employment tab indicator derived from that item');

    // summaries + capability map
    expect(d.contact && 'workEmail' in d.contact && 'mobilePhone' in d.contact, 'contact summary present');
    expect(d.accountHealth && typeof d.accountHealth.openSupportRequests === 'number', 'account health present');
    expect(typeof d.accountHealth.hasLoginIdentity === 'boolean', 'account health reports login identity');
    expect(Array.isArray(d.recentActivity), 'recentActivity array');
    expect(d.capabilities && typeof d.capabilities.viewDocuments === 'boolean', 'capability map present');

    // the shell must NOT carry the heavy per-tab datasets
    expect(!('documents' in d) && !('auditLog' in d) && !('assignmentHistory' in d),
      'shell excludes large per-tab datasets');
  });

  await test('profile-shell → employment facts carry working time and the canonical legal employer', async () => {
    const r = await api('hr/employees/profile-shell', A, { employeeId: ctx.emp1 });
    ok(r, 'profile-shell');
    const emp = r.body.data.employment;
    // Present as explicit fields even when unset — the drawer must be able to show
    // its empty state rather than omit an approved row.
    expect('weeklyHours' in emp && 'fte' in emp && 'legalEmployer' in emp,
      'employment carries weeklyHours, fte and legalEmployer');
    expect(emp.weeklyHours === null || typeof emp.weeklyHours === 'number', 'weeklyHours is numeric or null');
    expect(emp.fte === null || typeof emp.fte === 'number', 'fte is numeric or null');
    expect(emp.legalEmployer === null || typeof emp.legalEmployer === 'string', 'legalEmployer is string or null');

    // Legal Employer must equal the canonical single-tenant employer profile —
    // never a value stored separately for this surface.
    const { data: settingRow } = await sb.from('settings').select('value').eq('key', 'employerProfile').maybeSingle();
    let canonical = null;
    if (settingRow?.value) {
      try { canonical = (JSON.parse(settingRow.value)).legalName || null; } catch { canonical = null; }
    }
    if (!canonical) {
      const { data: legacy } = await sb.from('settings').select('value').eq('key', 'companyName').maybeSingle();
      canonical = legacy?.value ? String(legacy.value).trim() || null : null;
    }
    expect((emp.legalEmployer ?? null) === (canonical ?? null),
      `legalEmployer mirrors the canonical employer profile — shell ${emp.legalEmployer} vs settings ${canonical}`);
  });

  await test('document-health (admin) → grouped tree with counts and percentages', async () => {
    const r = await api('hr/employees/document-health', A, { employeeId: ctx.emp1 });
    ok(r, 'document-health');
    const h = r.body.data;
    for (const k of ['totalDocuments', 'requiredCount', 'verifiedCount', 'expiringCount',
                     'missingCount', 'verifiedPercent', 'expiringPercent', 'missingPercent', 'categoryCount']) {
      expect(typeof h[k] === 'number', `${k} is numeric`);
    }
    expect(Array.isArray(h.groups), 'groups array');
    expect(h.groups.every(g => (
      typeof g.key === 'string' && typeof g.label === 'string' && Array.isArray(g.items)
      && typeof g.currentCount === 'number' && typeof g.expiringCount === 'number'
      && typeof g.missingCount === 'number'
    )), 'every group carries key, label, per-state counts and its items');
    expect(h.groups.flatMap(g => g.items).every(i => (
      'documentId' in i && 'requirementId' in i && typeof i.documentType === 'string'
      && typeof i.title === 'string' && typeof i.detail === 'string'
      && ['verified', 'current', 'expiring', 'expired', 'unverified', 'missing'].includes(i.state)
      && typeof i.required === 'boolean'
    )), 'every item carries the full health contract');
    // Percentages are of the required set and must never be NaN.
    expect([h.verifiedPercent, h.expiringPercent, h.missingPercent].every(p => Number.isFinite(p) && p >= 0 && p <= 100),
      'percentages are finite and within range');
    expect(h.requiredCount === h.groups.flatMap(g => g.items).filter(i => i.required).length,
      'requiredCount equals the number of required rows in the tree');
  });

  await test('document-health (employee, no documents.view) → denied', async () => {
    const r = await api('hr/employees/document-health', ctx.empTok, { employeeId: ctx.emp1 });
    fails(r, 'employee cannot read document health');
  });

  await test('profile-shell → tab indicators agree with the attention endpoint exactly', async () => {
    const shell = await api('hr/employees/profile-shell', A, { employeeId: ctx.emp1 });
    const att = await api('hr/employees/attention', A, { employeeId: ctx.emp1 });
    ok(shell, 'shell'); ok(att, 'attention');
    expect(att.body.data.total === shell.body.data.attentionTotal,
      `attention total agrees — shell ${shell.body.data.attentionTotal} vs attention ${att.body.data.total}`);
    expect(JSON.stringify(att.body.data.tabIndicators) === JSON.stringify(shell.body.data.tabIndicators),
      'tab indicators are byte-identical across both reads (one source of truth)');
    expect(att.body.data.items.length === att.body.data.total, 'attention returns the full list');
    expect(att.body.data.items.length >= shell.body.data.attentionPreview.length, 'full list covers the preview');
  });

  await test('profile-shell (manager, no statutory/readiness) → gated blocks omitted, not blanked', async () => {
    const r = await api('hr/employees/profile-shell', ctx.mgrTok, { employeeId: ctx.emp1 });
    ok(r, 'manager profile-shell');
    const d = r.body.data;
    expect(d.readiness === null, 'readiness withheld without the readiness capability');
    expect(d.capabilities.viewReadiness === false, 'capability map reports the denial');
    // The capability map and the payload must agree — a true capability with a
    // withheld block (or vice versa) is the drift this contract exists to prevent.
    expect((d.capabilities.viewReadiness === false) === (d.readiness === null),
      'capability map matches what the payload actually carries');
    expect(d.capabilities.viewAudit === (d.recentActivity.length > 0 || d.capabilities.viewAudit),
      'activity preview only populated when audit is granted');
    expect(d.attentionPreview.every(i => i.domain !== 'payroll' && i.domain !== 'statutory'),
      'payroll/statutory attention items never leave the server for this actor');
    expect(d.tabIndicators.every(t => t.tab !== 'readiness'),
      'no readiness indicator leaks a hidden blocker count');
    expect(d.identity.employeeId === ctx.emp1, 'identity still resolved for an authorised HR viewer');
  });

  await test('profile-shell (employee, no hr.view) → denied', async () => {
    const r = await api('hr/employees/profile-shell', ctx.empTok, { employeeId: ctx.emp1 });
    fails(r, 'employee cannot read the profile shell');
  });

  await test('attention (employee, no hr.view) → denied', async () => {
    const r = await api('hr/employees/attention', ctx.empTok, { employeeId: ctx.emp1 });
    fails(r, 'employee cannot read the attention list');
  });

  await test('profile-shell → unknown employee is 404, not an empty shell', async () => {
    const r = await api('hr/employees/profile-shell', A, { employeeId: `${TAG}-does-not-exist` });
    fails(r, 'unknown employee rejected');
  });

  await test('profile-shell → switching employees never returns the previous identity', async () => {
    const a = await api('hr/employees/profile-shell', A, { employeeId: ctx.emp1 });
    const b = await api('hr/employees/profile-shell', A, { employeeId: ctx.emp2 });
    ok(a, 'shell alpha'); ok(b, 'shell beta');
    expect(a.body.data.identity.employeeId === ctx.emp1, 'alpha shell is alpha');
    expect(b.body.data.identity.employeeId === ctx.emp2, 'beta shell is beta');
    expect(a.body.data.identity.employeeId !== b.body.data.identity.employeeId,
      'each response is scoped to its own employee');
  });

  // ── access assignments + scopes ────────────────────────────────────────────
  await test('access-assignments grant (admin) → assignment + scopes + event + audit, one correlation id', async () => {
    const r = await api('hr/employees/access-assignments/grant', A, {
      employeeId: ctx.emp1,
      accessProfileId: ctx.accessProfileId,
      assignmentType: 'profile',
      scopes: [{ scopeType: 'organisation' }, { scopeType: 'site', scopeId: ctx.siteId }],
    });
    ok(r, 'grant');
    expect(!!r.body.data.assignmentId, 'assignmentId returned');
    expect(r.body.data.scopeCount === 2, `scopeCount 2 — got ${r.body.data.scopeCount}`);
    expect(!!r.body.data.correlationId, 'correlationId returned');
    ctx.accessAssignmentId = r.body.data.assignmentId;
    ctx.accessCorrelationId = r.body.data.correlationId;

    // The row, its scopes, the event and the audit entry must ALL exist — the
    // whole point of routing this through a transactional command.
    const { data: row } = await sb.from('hr_employee_access_assignments')
      .select('id, employee_id, status, granted_by').eq('id', ctx.accessAssignmentId).maybeSingle();
    expect(row && row.status === 'active' && row.employee_id === ctx.emp1, 'assignment row written and active');

    const { data: scopes } = await sb.from('hr_employee_access_scopes')
      .select('scope_type, scope_id').eq('assignment_id', ctx.accessAssignmentId);
    expect(scopes.length === 2, `2 scope rows persisted — got ${scopes.length}`);
    expect(scopes.some(s => s.scope_type === 'organisation' && s.scope_id === null), 'organisation scope stored with null target');
    expect(scopes.some(s => s.scope_type === 'site' && s.scope_id === ctx.siteId), 'site scope stored against the real site');

    const { data: ev } = await sb.from('app_events')
      .select('event_type, source_entity_id, payload')
      .eq('source_entity_id', ctx.accessAssignmentId).eq('event_type', 'hr.employee.access_assignment.granted');
    expect(ev.length === 1, `exactly one granted event — got ${ev.length}`);
    expect(ev[0].payload.correlationId === ctx.accessCorrelationId, 'event carries the same correlation id');

    // The CANONICAL platform audit record. audit_logs and hr_audit_log are
    // different tables for different readers; the HR log is not a substitute.
    // Route mutations get audit_logs via emitAppEvent, but a command that writes
    // app_events directly in SQL bypasses that and must write it itself.
    const { data: plat } = await sb.from('audit_logs')
      .select('action, table_name, record_id, user_id, changes').eq('record_id', ctx.accessAssignmentId)
      .eq('action', 'hr.employee.access_assignment.granted');
    expect(plat.length === 1, `exactly one canonical audit_logs row — got ${plat.length}`);
    expect(plat[0].table_name === 'employee_access_assignment', 'audit_logs records the entity type');
    expect(plat[0].changes.correlationId === ctx.accessCorrelationId, 'audit_logs carries the same correlation id');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('action, record_id, metadata').eq('record_id', ctx.accessAssignmentId)
      .eq('action', 'hr.employee.access_assignment.granted');
    expect(audit.length === 1, `exactly one granted hr_audit_log row — got ${audit.length}`);
    expect(audit[0].metadata.correlationId === ctx.accessCorrelationId, 'hr audit carries the same correlation id');
  });

  await test('access-assignments list (admin) → scopes resolved to labels, never raw ids', async () => {
    const r = await api('hr/employees/access-assignments', A, { employeeId: ctx.emp1 });
    ok(r, 'list');
    const row = r.body.data.find(a => a.id === ctx.accessAssignmentId);
    expect(!!row, 'granted assignment present');
    expect(typeof row.accessProfileLabel === 'string' && row.accessProfileLabel.length > 0, 'access profile label resolved');
    expect(typeof row.requiresMfa === 'boolean', 'requiresMfa exposed');
    expect(row.scopes.length === 2, 'both scopes returned');
    expect(row.scopes.every(s => typeof s.scopeLabel === 'string' && s.scopeLabel.length > 0), 'every scope carries a resolved label');
    expect(row.scopes.every(s => s.scopeLabel !== s.scopeId), 'scope label is not the raw id');
    expect(row.grantedByName !== null, 'granting actor resolved to a name');
  });

  await test('access-assignments grant → empty scope list is refused (no unbounded grant)', async () => {
    const r = await api('hr/employees/access-assignments/grant', A, {
      employeeId: ctx.emp1, accessProfileId: ctx.accessProfileId, scopes: [],
    });
    fails(r, 'empty scope list rejected');
  });

  await test('access-assignments grant → department scope without a target is refused', async () => {
    const r = await api('hr/employees/access-assignments/grant', A, {
      employeeId: ctx.emp1, accessProfileId: ctx.accessProfileId,
      scopes: [{ scopeType: 'department' }],
    });
    fails(r, 'unscoped department rejected');
  });

  await test('access-assignments: hr_staff may VIEW but not MANAGE (segregation of duties)', async () => {
    // Provisioned as a REAL hr_staff — requireUser resolves the role from the DB,
    // so a forged token would prove nothing, and the admin harness actor is a
    // superadmin (allow-all) which would mask the denial entirely.
    const staffRes = await acquireActors('hr_staff', 1);
    const staff = staffRes.actors[0];
    ctx.hrStaffCreatedIds = staffRes.createdIds;
    if (!staff) { console.error('⚠ no hr_staff available — segregation test would misreport'); return; }
    const staffTok = mint({ id: staff.id, username: staff.username, role: 'hr_staff', department_id: staff.department_id ?? null });

    const view = await api('hr/employees/access-assignments', staffTok, { employeeId: ctx.emp1 });
    ok(view, 'hr_staff may view access assignments');

    const grant = await api('hr/employees/access-assignments/grant', staffTok, {
      employeeId: ctx.emp1, accessProfileId: ctx.accessProfileId, scopes: [{ scopeType: 'organisation' }],
    });
    fails(grant, 'hr_staff cannot GRANT access despite being able to view it');

    const revoke = await api('hr/employees/access-assignments/revoke', staffTok, {
      assignmentId: ctx.accessAssignmentId, reason: 'should not be permitted',
    });
    fails(revoke, 'hr_staff cannot REVOKE access');
  });

  await test('access-assignments (employee) → denied both view and manage', async () => {
    fails(await api('hr/employees/access-assignments', ctx.empTok, { employeeId: ctx.emp1 }), 'employee cannot view');
    fails(await api('hr/employees/access-assignments/grant', ctx.empTok, {
      employeeId: ctx.emp1, accessProfileId: ctx.accessProfileId, scopes: [{ scopeType: 'organisation' }],
    }), 'employee cannot grant');
  });

  await test('access-assignments revoke (admin) → status + event + audit, reason required', async () => {
    fails(await api('hr/employees/access-assignments/revoke', A, { assignmentId: ctx.accessAssignmentId }),
      'revoke without a reason rejected');

    const r = await api('hr/employees/access-assignments/revoke', A, {
      assignmentId: ctx.accessAssignmentId, reason: `${TAG} access no longer required`,
    });
    ok(r, 'revoke');
    expect(r.body.data.status === 'revoked', 'status revoked');

    const { data: row } = await sb.from('hr_employee_access_assignments')
      .select('status, revoked_by, revoked_at, effective_to').eq('id', ctx.accessAssignmentId).maybeSingle();
    expect(row.status === 'revoked' && !!row.revoked_at && !!row.effective_to,
      'revocation stamped status, actor time and effective_to');

    const { data: ev } = await sb.from('app_events')
      .select('event_type').eq('source_entity_id', ctx.accessAssignmentId)
      .eq('event_type', 'hr.employee.access_assignment.revoked');
    expect(ev.length === 1, `exactly one revoked event — got ${ev.length}`);

    const { data: platRev } = await sb.from('audit_logs')
      .select('action, changes').eq('record_id', ctx.accessAssignmentId)
      .eq('action', 'hr.employee.access_assignment.revoked');
    expect(platRev.length === 1, `exactly one canonical audit_logs revoke row — got ${platRev.length}`);
    expect(platRev[0].changes.previousStatus === 'active' && platRev[0].changes.status === 'revoked',
      'audit_logs records the status transition');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('action, previous_state, new_state').eq('record_id', ctx.accessAssignmentId)
      .eq('action', 'hr.employee.access_assignment.revoked');
    expect(audit.length === 1, 'exactly one revoked hr_audit_log row');
    expect(audit[0].previous_state.status === 'active' && audit[0].new_state.status === 'revoked',
      'audit records the before and after state');
  });

  await test('access-assignments revoke → revoking twice is refused (no duplicate access event)', async () => {
    const r = await api('hr/employees/access-assignments/revoke', A, {
      assignmentId: ctx.accessAssignmentId, reason: 'second attempt',
    });
    fails(r, 'already-revoked assignment rejected');
    const { data: ev } = await sb.from('app_events')
      .select('id').eq('source_entity_id', ctx.accessAssignmentId)
      .eq('event_type', 'hr.employee.access_assignment.revoked');
    expect(ev.length === 1, `still exactly one revoked event — got ${ev.length}`);
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

  // ── typed UI preference store (saved views + visible columns) ────────────────
  //
  // Regression cover for a CONTRACT SPLIT, not a code bug: the register saved
  // views under `hr.employee-register.views` while the endpoint's allow-list knew
  // only `hr.employee-register.columns`, so every save was rejected with "Unknown
  // UI preference key" and no saved view ever loaded. These assert both keys
  // round-trip, that each is validated by ITS OWN sanitizer, and that the store
  // still refuses anything it does not declare.

  await test('ui-preferences: capture the actor’s existing preferences for restore', async () => {
    const keys = ['hr.employee-register.columns', 'hr.employee-register.views'];
    const { data } = await sb.from('ui_user_preferences')
      .select('preference_key, preference_value, version')
      .eq('user_id', admin.id).in('preference_key', keys);
    const byKey = Object.fromEntries((data ?? []).map(row => [row.preference_key, row]));
    ctx.priorUiPreferences = Object.fromEntries(keys.map(key => [key, byKey[key] ?? null]));
    expect(ctx.priorUiPreferences !== null, 'captured prior preferences for teardown');
  });

  await test('ui-preferences: BOTH employee-register keys are accepted', async () => {
    for (const key of ['hr.employee-register.columns', 'hr.employee-register.views']) {
      const r = await api('ui-preferences/get', A, { key });
      ok(r, `get ${key} — got ${r.body.message ?? ''}`);
      expect('preference' in r.body.data, `${key}: response must carry a preference envelope`);
    }
  });

  await test('ui-preferences: saved views round-trip through the store', async () => {
    const view = {
      id: `view-${TAG}`,
      name: `E2E ${TAG}`.slice(0, 48),
      filters: { query: 'ari', status: ['active'], department: [], employmentType: ['contract'], training: [] },
      sortBy: 'employee_number',
      sortDir: 'desc',
      pageSize: 50,
      columns: ['employee', 'department', 'employmentType', 'actions'],
    };
    const saved = await api('ui-preferences/save', A, { key: 'hr.employee-register.views', value: [view] });
    ok(saved, `save views — got ${saved.body.message ?? ''}`);
    expect(saved.body.data.preference.version === 1, 'views preference stamped with contract version 1');

    // PERSISTENCE is the point: read it back on a separate request.
    const read = await api('ui-preferences/get', A, { key: 'hr.employee-register.views' });
    ok(read, 'get views back');
    const stored = read.body.data.preference;
    expect(stored && Array.isArray(stored.value) && stored.value.length === 1,
      `one view persisted — got ${JSON.stringify(stored?.value).slice(0, 200)}`);
    const got = stored.value[0];
    expect(got.id === view.id, `view id round-trips — got ${got.id}`);
    expect(got.sortBy === 'employee_number' && got.sortDir === 'desc', `sort round-trips — got ${got.sortBy}/${got.sortDir}`);
    expect(got.pageSize === 50, `page size round-trips — got ${got.pageSize}`);
    expect(JSON.stringify(got.columns) === JSON.stringify(view.columns), `columns round-trip — got ${JSON.stringify(got.columns)}`);
    expect(got.filters.query === 'ari' && got.filters.status[0] === 'active', 'filters round-trip');

    // Stored against the CALLING user, on the declared key.
    const { data: row } = await sb.from('ui_user_preferences')
      .select('preference_key, version').eq('user_id', admin.id)
      .eq('preference_key', 'hr.employee-register.views').maybeSingle();
    expect(row && row.version === 1, 'row persisted for the calling user with its contract version');
  });

  await test('ui-preferences: visible columns round-trip and are normalised', async () => {
    const saved = await api('ui-preferences/save', A, { key: 'hr.employee-register.columns', value: ['status', 'employee', 'actions'] });
    ok(saved, `save columns — got ${saved.body.message ?? ''}`);
    const read = await api('ui-preferences/get', A, { key: 'hr.employee-register.columns' });
    ok(read, 'get columns back');
    // Normalised into contract order — not stored as submitted.
    expect(JSON.stringify(read.body.data.preference.value) === JSON.stringify(['employee', 'status', 'actions']),
      `columns normalised to contract order — got ${JSON.stringify(read.body.data.preference.value)}`);
  });

  await test('ui-preferences: unknown key is refused on BOTH get and save', async () => {
    for (const key of ['hr.employee-register', 'hr.employee-register.viewss', 'anything.at.all']) {
      const g = await api('ui-preferences/get', A, { key });
      fails(g, `get must refuse unknown key ${key}`);
      expect(/unknown ui preference key/i.test(g.body.message ?? ''),
        `get ${key}: message must name the cause — got ${g.body.message}`);
      const p = await api('ui-preferences/save', A, { key, value: [] });
      fails(p, `save must refuse unknown key ${key}`);
    }
  });

  await test('ui-preferences: each key is validated by ITS OWN sanitizer', async () => {
    // A column payload is not a valid view payload, and vice versa — this is what
    // makes it a typed store rather than a generic accept-any one.
    fails(await api('ui-preferences/save', A, { key: 'hr.employee-register.views', value: ['employee', 'actions'] }),
      'views key must reject a column array');
    fails(await api('ui-preferences/save', A, { key: 'hr.employee-register.columns', value: [{ id: 'v', name: 'V' }] }),
      'columns key must reject a view array');
  });

  await test('ui-preferences: malformed values are refused, not coerced', async () => {
    const bad = [
      ['hr.employee-register.columns', 'employee'],
      ['hr.employee-register.columns', { 0: 'employee' }],
      ['hr.employee-register.columns', ['employee', 7]],
      ['hr.employee-register.columns', ['no-such-column']],
      ['hr.employee-register.views', 'views'],
      ['hr.employee-register.views', { id: 'v' }],
      // A non-empty list where nothing is usable: storing [] would silently delete
      // the views the user actually had.
      ['hr.employee-register.views', [null, { id: '', name: '' }]],
    ];
    for (const [key, value] of bad) {
      const r = await api('ui-preferences/save', A, { key, value });
      fails(r, `save must refuse ${key} = ${JSON.stringify(value)}`);
      expect(/invalid ui preference value/i.test(r.body.message ?? ''),
        `${key}: message must name the cause — got ${r.body.message}`);
    }
    // The valid views saved earlier must still be there — a refused write changes nothing.
    const read = await api('ui-preferences/get', A, { key: 'hr.employee-register.views' });
    ok(read, 'views still readable after refused writes');
    expect(read.body.data.preference.value.length === 1, 'refused writes left the stored views intact');
  });

  await test('ui-preferences: requires authentication', async () => {
    fails(await api('ui-preferences/get', null, { key: 'hr.employee-register.views' }), 'anonymous get denied');
    fails(await api('ui-preferences/save', null, { key: 'hr.employee-register.views', value: [] }), 'anonymous save denied');
  });

  // ── Employee Profile read contracts (drawer + full record) ───────────────────
  //
  // The six endpoints both profile surfaces open with. Each asserts the exact
  // fields the frontend consumes — these are the contracts that broke silently
  // when a stale build served the superseded shell shape.

  await test('profile-shell (admin) → identity, employment, readiness, indicators', async () => {
    const r = await api('hr/employees/profile-shell', A, { employeeId: ctx.emp1 });
    ok(r, `profile-shell — got ${r.body.message ?? ''}`);
    const d = r.body.data;
    expect(d.identity.employeeId === ctx.emp1, `shell must be for the requested employee — got ${d.identity.employeeId}`);
    for (const field of ['employeeNo', 'displayName', 'employmentStatus', 'accountStatus', 'position', 'departmentName', 'siteName']) {
      expect(field in d.identity, `identity.${field} missing`);
    }
    for (const field of ['employmentBasis', 'workArrangement', 'workSchedule', 'startDate', 'tenureMonths',
      'supervisorName', 'payGroupName', 'legalEmployer', 'weeklyHours', 'fte', 'costCentre', 'employeeGrade',
      'probationEndDate', 'noticePeriodDays', 'payFrequency', 'workerCategory', 'assignmentEffectiveFrom']) {
      expect(field in d.employment, `employment.${field} missing`);
    }
    if (d.readiness) {
      // The TYPED readiness contract — `blockers` was the superseded shape.
      for (const field of ['percent', 'readyControls', 'totalControls', 'unresolvedWorkItems',
        'payrollStatus', 'trainingStatus', 'blockedDomains', 'lastReviewedAt', 'reviewOwnerLabel', 'nextReviewAt']) {
        expect(field in d.readiness, `readiness.${field} missing — stale contract?`);
      }
      expect(Array.isArray(d.readiness.blockedDomains), 'readiness.blockedDomains must be an array');
      expect(!('blockers' in d.readiness), 'readiness.blockers is the SUPERSEDED shape and must not be served');
    }
    expect(Array.isArray(d.attentionPreview) && typeof d.attentionTotal === 'number', 'attention preview + total');
    expect(Array.isArray(d.tabIndicators), 'tabIndicators array');
    expect(Array.isArray(d.recentActivity), 'recentActivity array');
    expect(d.capabilities && typeof d.capabilities.viewDocuments === 'boolean', 'capabilities present');
  });

  await test('profile-shell (employee) → denied', async () => {
    fails(await api('hr/employees/profile-shell', ctx.empTok, { employeeId: ctx.emp1 }),
      'employee must not read a profile shell');
  });

  await test('attention (admin) → items carry target, owner and severity', async () => {
    const r = await api('hr/employees/attention', A, { employeeId: ctx.emp1 });
    ok(r, `attention — got ${r.body.message ?? ''}`);
    expect(Array.isArray(r.body.data.items) && typeof r.body.data.total === 'number', 'items + total');
    expect(Array.isArray(r.body.data.tabIndicators), 'tabIndicators');
    for (const item of r.body.data.items) {
      for (const field of ['id', 'domain', 'title', 'detail', 'severity', 'dueState', 'actionLabel', 'actionTarget']) {
        expect(field in item, `attention item missing ${field}`);
      }
      expect(['critical', 'warning', 'info'].includes(item.severity), `unknown severity ${item.severity}`);
    }
  });

  await test('document-health (admin) → counts, percentages and grouped tree', async () => {
    const r = await api('hr/employees/document-health', A, { employeeId: ctx.emp1 });
    ok(r, `document-health — got ${r.body.message ?? ''}`);
    const d = r.body.data;
    for (const field of ['totalDocuments', 'requiredCount', 'verifiedCount', 'expiringCount', 'missingCount',
      'verifiedPercent', 'expiringPercent', 'missingPercent', 'categoryCount']) {
      expect(typeof d[field] === 'number', `document-health.${field} must be a number — got ${typeof d[field]}`);
    }
    expect(Array.isArray(d.groups), 'groups array');
    for (const group of d.groups) {
      for (const item of group.items) {
        // `issuedAt` is what the locked table's Issue/Effective Date column reads.
        for (const field of ['documentType', 'title', 'state', 'expiryDate', 'issuedAt', 'detail', 'required']) {
          expect(field in item, `document-health item missing ${field}`);
        }
      }
    }
  });

  await test('employment-detail (admin) → masked bank context + effective-dated history', async () => {
    const r = await api('hr/employees/employment-detail', A, { employeeId: ctx.emp1 });
    ok(r, `employment-detail — got ${r.body.message ?? ''}`);
    expect('bank' in r.body.data, 'bank key present (null when not permitted)');
    expect(Array.isArray(r.body.data.history), 'history array');
    if (r.body.data.bank) {
      for (const field of ['bankName', 'accountNumberMasked', 'accountType', 'hasPrimaryAccount', 'lastVerifiedAt', 'verificationState']) {
        expect(field in r.body.data.bank, `bank.${field} missing`);
      }
      // HR receives the MASKED number only — never the raw account.
      const masked = r.body.data.bank.accountNumberMasked;
      expect(masked === null || /[•*x]/i.test(masked), `account number must be masked — got ${masked}`);
    }
    for (const entry of r.body.data.history) {
      for (const field of ['id', 'kind', 'title', 'detail', 'occurredAt']) {
        expect(field in entry, `history entry missing ${field}`);
      }
    }
  });

  await test('readiness/matrix (admin) → controls with resolved owners and coverage', async () => {
    const r = await api('hr/employees/readiness/matrix', A, { employeeId: ctx.emp1 });
    ok(r, `readiness/matrix — got ${r.body.message ?? ''}`);
    const d = r.body.data;
    expect(d.employeeId === ctx.emp1, `matrix must be for the requested employee — got ${d.employeeId}`);
    for (const field of ['percent', 'readyControls', 'totalControls', 'unresolvedWorkItems', 'blockedDomains']) {
      expect(field in d.coverage, `coverage.${field} missing`);
    }
    expect(Array.isArray(d.controls), 'controls array');
    for (const entry of d.controls) {
      expect(entry.control && typeof entry.control.controlKey === 'string', 'control definition');
      expect(typeof entry.percent === 'number', 'control percent');
      // Fail-closed ownership must be VISIBLE, never a blank.
      expect(['resolved', 'owner_required'].includes(entry.owner.status), `owner.status — got ${entry.owner.status}`);
      if (entry.owner.status === 'owner_required') expect(entry.owner.reason, 'owner_required must explain what is missing');
    }
    expect(d.capabilities && typeof d.capabilities.view === 'boolean', 'capabilities present');
  });

  await test('access-assignments (admin) → labels resolved, never raw ids', async () => {
    const r = await api('hr/employees/access-assignments', A, { employeeId: ctx.emp1, activeOnly: false });
    ok(r, `access-assignments — got ${r.body.message ?? ''}`);
    expect(Array.isArray(r.body.data), 'array of assignments');
    for (const a of r.body.data) {
      for (const field of ['id', 'accessProfileId', 'accessProfileCode', 'accessProfileLabel', 'requiresMfa',
        'assignmentType', 'status', 'effectiveFrom', 'scopes']) {
        expect(field in a, `assignment missing ${field}`);
      }
      expect(typeof a.accessProfileLabel === 'string' && a.accessProfileLabel.length > 0,
        'profile label resolved server-side');
      for (const scope of a.scopes) {
        expect(typeof scope.scopeLabel === 'string' && scope.scopeLabel.length > 0,
          `scope must carry a resolved label, not a raw id — got ${JSON.stringify(scope)}`);
      }
    }
  });

  await test('profile reads (employee) → every one denied', async () => {
    for (const path of ['hr/employees/attention', 'hr/employees/document-health',
      'hr/employees/employment-detail', 'hr/employees/readiness/matrix', 'hr/employees/access-assignments']) {
      fails(await api(path, ctx.empTok, { employeeId: ctx.emp1 }), `${path} must deny a plain employee`);
    }
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
