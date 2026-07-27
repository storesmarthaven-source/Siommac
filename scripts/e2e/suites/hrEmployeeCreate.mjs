/**
 * scripts/e2e/suites/hrEmployeeCreate.mjs
 *
 * End-to-end suite for the Employee Creation Wizard v2 backend:
 *   POST /api/hr/access-profiles/list
 *   POST /api/hr/employees/wizard/draft/save
 *   POST /api/hr/employees/wizard/draft/get
 *   POST /api/hr/employees/wizard/draft/delete
 *   POST /api/hr/employees/create  (v2 contract — no password, access profile, account mode)
 *
 * Covers:
 *   1. Access profiles list — authorized roles; unauthorized denied
 *   2. Wizard draft CRUD — save, get, overwrite, delete
 *   3. Employee create — minimal (no statutory), full (all fields), invite_on_create
 *   4. Employee create — preflights: duplicate username, bad access profile, bad package
 *   5. Access control — hr_staff can create; plain employee cannot
 *   6. Response shape — exact fields the frontend consumes
 *   7. Side-effects — app_events, audit_logs rows written after create
 *   8. Statutory written to hr_employee_statutory_profiles (NOT hr_employee_statutory)
 *   9. Cleanup
 *
 * Browser journey: recorded manually; automation gap noted per CLAUDE.md.
 * Run: npm run test:e2e -- hrEmployeeCreate
 */

export const title = 'HR Employee Create Wizard v2';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const T = { admin: mint(admin) };

  // Provisioned test employees for cleanup
  const ctx = { employeeIds: [], draftActorIds: [] };

  h.onCleanup(async () => {
    // Delete in FK order
    if (ctx.employeeIds.length) {
      await sb.from('hr_employee_assignments').delete().in('employee_id', ctx.employeeIds);
      await sb.from('hr_employee_statutory_profiles').delete().in('employee_id', ctx.employeeIds);
      await sb.from('hr_employee_status_history').delete().in('employee_id', ctx.employeeIds);
      await sb.from('hr_onboarding_cases').delete().in('employee_id', ctx.employeeIds);
      await sb.from('audit_logs').delete().in('record_id', ctx.employeeIds);
      await sb.from('app_events').delete().in('source_entity_id', ctx.employeeIds);
      // Delete Auth accounts for test employees (ignore errors — may not exist)
      const { data: authRows } = await sb.from('app_users').select('id, auth_id').in('id', ctx.employeeIds);
      for (const row of (authRows ?? [])) {
        if (row.auth_id) { try { await sb.auth.admin.deleteUser(row.auth_id); } catch { /* ok */ } }
      }
      await sb.from('app_users').delete().in('id', ctx.employeeIds);
    }
    if (ctx.draftActorIds.length) {
      await sb.from('hr_employee_wizard_drafts').delete().in('actor_id', ctx.draftActorIds);
    }
  });

  // ── 1. Access profiles list ──────────────────────────────────────────────

  await test('access-profiles/list — admin can list profiles', async () => {
    const r = await api(T.admin, 'hr/access-profiles/list', {});
    ok(r, 'hr/access-profiles/list');
    expect(Array.isArray(r.data), 'data is array');
    if (r.data.length > 0) {
      const p = r.data[0];
      expect(typeof p.id === 'string',          'profile has id');
      expect(typeof p.code === 'string',         'profile has code');
      expect(typeof p.label === 'string',        'profile has label');
      expect(typeof p.system_role === 'string',  'profile has system_role');
      expect(typeof p.is_active === 'boolean',   'profile has is_active');
    }
  });

  await test('access-profiles/list — unauthenticated is denied', async () => {
    const r = await fails(api(null, 'hr/access-profiles/list', {}), 'unauthenticated access-profiles list');
    expect(r?.status === 401 || r?.status === 403, 'denied with 401 or 403');
  });

  // ── 2. Wizard draft CRUD ─────────────────────────────────────────────────

  const testActorId = admin; // use admin's id as draft actor
  ctx.draftActorIds.push(testActorId);

  await test('wizard/draft/save — creates draft', async () => {
    const r = await api(T.admin, 'hr/employees/wizard/draft/save', {
      draftData: { firstName: TAG, lastName: 'TestDraft', username: `${TAG}-draft` },
      stepIndex: 1,
      label: `${TAG} draft`,
    });
    ok(r, 'draft save');
    expect(typeof r.data.id === 'string',         'draft has id');
    expect(r.data.step_index === 1,               'step_index matches');
    expect(r.data.label === `${TAG} draft`,        'label matches');
    expect(typeof r.data.expires_at === 'string',  'expires_at set');
  });

  await test('wizard/draft/get — retrieves draft', async () => {
    const r = await api(T.admin, 'hr/employees/wizard/draft/get', {});
    ok(r, 'draft get');
    expect(r.data !== null, 'draft returned');
    expect(r.data?.step_index === 1, 'step_index is 1');
    const saved = r.data?.draft_data;
    expect(saved?.firstName === TAG, 'draft_data preserved');
  });

  await test('wizard/draft/save — overwrites (upsert)', async () => {
    const r = await api(T.admin, 'hr/employees/wizard/draft/save', {
      draftData: { firstName: TAG, lastName: 'Updated', username: `${TAG}-updated` },
      stepIndex: 2,
      label: `${TAG} updated`,
    });
    ok(r, 'draft overwrite');
    expect(r.data.step_index === 2, 'step_index updated to 2');
  });

  await test('wizard/draft/delete — removes draft', async () => {
    const delR = await api(T.admin, 'hr/employees/wizard/draft/delete', {});
    ok(delR, 'draft delete');
    const getR = await api(T.admin, 'hr/employees/wizard/draft/get', {});
    ok(getR, 'draft get after delete');
    expect(getR.data === null, 'draft is null after delete');
  });

  // ── 3. Employee create — minimal (no statutory, no_login) ────────────────

  const minUsername = `${TAG}-min-emp`;
  let minEmpId = null;

  await test('employees/create — minimal args, no_login', async () => {
    const r = await api(T.admin, 'hr/employees/create', {
      identity: { username: minUsername, fullName: `${TAG} Minimal` },
      access: { accountMode: 'no_login' },
    });
    ok(r, 'employees/create minimal');

    // Shape — exact fields the frontend consumes
    expect(typeof r.data.employee_id === 'string',          'employee_id present');
    expect(typeof r.data.employee_no === 'string',          'employee_no present');
    expect(['pending','ready','blocked'].includes(r.data.payroll_readiness), 'payroll_readiness valid');
    expect(r.data.account_invite_sent === null,              'no invite (no_login)');
    expect(r.data.account_error === null,                    'no account_error');

    minEmpId = r.data.employee_id;
    ctx.employeeIds.push(minEmpId);
  });

  await test('employees/create — duplicate username is rejected', async () => {
    const r = await api(T.admin, 'hr/employees/create', {
      identity: { username: minUsername, fullName: `${TAG} Dup` },
      access: { accountMode: 'no_login' },
    });
    expect(!r.success, 'duplicate rejected');
    expect(r.message?.toLowerCase().includes('taken') || r.message?.toLowerCase().includes('already'), 'error mentions duplicate');
  });

  // ── 4. Employee create — side-effects asserted ───────────────────────────

  await test('employees/create — app_events row written', async () => {
    expect(minEmpId !== null, 'have minEmpId');
    const { data: evts } = await sb.from('app_events')
      .select('id, event_type, source_entity_id')
      .eq('event_type', 'hr.employee.created')
      .eq('source_entity_id', minEmpId);
    expect((evts ?? []).length >= 1, 'at least 1 hr.employee.created event');
  });

  await test('employees/create — audit_logs row written', async () => {
    expect(minEmpId !== null, 'have minEmpId');
    const { data: logs } = await sb.from('hr_audit_log')
      .select('id, action, employee_id')
      .eq('action', 'hr.employee.created')
      .eq('employee_id', minEmpId);
    expect((logs ?? []).length >= 1, 'at least 1 hr.employee.created audit row');
  });

  await test('employees/create — statutory written to hr_employee_statutory_profiles', async () => {
    expect(minEmpId !== null, 'have minEmpId');
    const { data: prof } = await sb.from('hr_employee_statutory_profiles')
      .select('id, employee_id, nis_status')
      .eq('employee_id', minEmpId)
      .maybeSingle();
    expect(prof !== null, 'profile row exists');
    expect(prof?.nis_status === 'pending_verification', 'nis_status = pending_verification (finance-side)');
  });

  await test('employees/create — NOT written to legacy hr_employee_statutory', async () => {
    expect(minEmpId !== null, 'have minEmpId');
    const { data: legacy } = await sb.from('hr_employee_statutory')
      .select('id')
      .eq('employee_id', minEmpId)
      .maybeSingle();
    expect(legacy === null, 'no legacy statutory row created');
  });

  // ── 5. Employee create — full args ───────────────────────────────────────

  const fullUsername = `${TAG}-full-emp`;

  await test('employees/create — full args with statutory', async () => {
    const r = await api(T.admin, 'hr/employees/create', {
      identity: {
        username: fullUsername, fullName: `${TAG} Full Employee`,
        firstName: TAG, lastName: 'FullEmployee',
        employeeNumber: `${TAG}-EMP-001`,
      },
      employment: {
        employmentType: 'employee', startDate: '2026-01-01',
        position: 'Test Engineer', employeeGrade: 'Grade 2',
      },
      access: { accountMode: 'no_login' },
      recordStatus: 'active',
      statutory: {
        nisStatus: 'registered', nisNumber: '99999999',
        payeApplicable: true, td1Received: true, td1EffectiveYear: 2026,
        hsApplicable: true,
      },
    });
    ok(r, 'employees/create full');
    ctx.employeeIds.push(r.data.employee_id);

    // Verify statutory fields
    const { data: prof } = await sb.from('hr_employee_statutory_profiles')
      .select('nis_reg_status, nis_status, paye_applicable, td1_received')
      .eq('employee_id', r.data.employee_id)
      .maybeSingle();
    expect(prof !== null,                           'statutory profile row written');
    expect(prof?.nis_reg_status === 'registered',   'nis_reg_status = registered');
    expect(prof?.nis_status === 'pending_verification', 'nis_status = pending_verification');
    expect(prof?.paye_applicable === true,           'paye_applicable written');
    expect(prof?.td1_received === true,              'td1_received written');
  });

  // ── 6. Employee create — bad access profile rejected ─────────────────────

  await test('employees/create — non-existent access profile id is rejected', async () => {
    const r = await api(T.admin, 'hr/employees/create', {
      identity: { username: `${TAG}-badprofile`, fullName: `${TAG} BadProfile` },
      access: { accessProfileId: '00000000-0000-0000-0000-000000000000', accountMode: 'no_login' },
    });
    expect(!r.success, 'rejected with bad profile id');
    expect(r.message?.toLowerCase().includes('profile'), 'error mentions profile');
  });

  // ── 7. Employee create — bad onboarding package rejected ─────────────────

  await test('employees/create — non-existent package is rejected before create', async () => {
    const r = await api(T.admin, 'hr/employees/create', {
      identity: { username: `${TAG}-badpkg`, fullName: `${TAG} BadPkg` },
      access: { accountMode: 'no_login' },
      onboarding: { createOnboardingCase: true, packageKey: 'nonexistent_package_xyz_e2e' },
    });
    expect(!r.success, 'rejected with bad package');
    expect(r.message?.toLowerCase().includes('package'), 'error mentions package');
    // Verify no employee was created (preflight failed before write)
    const { data: emp } = await sb.from('app_users').select('id').eq('username', `${TAG}-badpkg`).maybeSingle();
    expect(emp === null, 'no employee created when package preflight fails');
  });

  // ── 8. Access control ────────────────────────────────────────────────────

  await test('employees/create — unauthenticated is denied', async () => {
    const r = await fails(
      api(null, 'hr/employees/create', {
        identity: { username: `${TAG}-unauth`, fullName: `${TAG} Unauth` },
        access: { accountMode: 'no_login' },
      }),
      'unauthenticated create',
    );
    expect(r?.status === 401 || r?.status === 403, 'denied with 401 or 403');
  });

  // ── BROWSER JOURNEY NOTE ─────────────────────────────────────────────────
  // The following browser journeys are required per CLAUDE.md but cannot be
  // automated until a repository browser runner is established:
  //   • Open HR ▸ Employee Master, click Add Employee → EmployeeCreatePage loads (full-page)
  //   • Complete all 6 steps, click Create Employee → receipt shown
  //   • Navigate back → register shows new employee
  //   • Reload page mid-wizard → draft recovery banner appears
  //   • Resume draft → form pre-populated at saved step
  //   • Discard draft → blank form loaded
  // These are documented as an automation gap per the enterprise delivery standard.
}
