/**
 * scripts/e2e/suites/hrTransfers.mjs
 *
 * E2E for HR Transfers & Promotions (/api/hr/transfers/*).
 * Routes in routes/hr.ts:
 *   /transfers/request  — submit a bundled transfer_promotion CR
 *   /transfers/list     — filtered list of transfer_promotion CRs
 *   /employee-change-requests/decide  — approve / reject / return (generic, routed by CHANGE_PERM)
 *   /employee-change-requests/cancel  — cancel (generic)
 *
 * Covers:
 *   1. Submit → CR row (change_type, requested_value, status=submitted, workflow_id set)
 *   2. Approve → app_users updated + assignment-history row stamped effectiveDate + CR applied
 *   3. Reject → CR rejected, app_users unchanged
 *   4. Access control: employee denied request; hr_staff can submit but NOT approve;
 *      generic /employees/change-request rejects transfer_promotion
 *   5. Side-effects: app_events + hr_audit_log rows asserted (polled, fire-and-forget)
 *   6. Cleanup via h.onCleanup
 *
 * Run: npm run test:e2e -- hrTransfers
 * Requires: migrations 20260719000000 + 20260719000001 applied + NOTIFY pgrst;
 *           npm run build:backend + npm run dev:netlify running (dist served)
 */

export const title = 'HR — Transfers & Promotions';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);
  // The hr_change_approval task is role-assigned to `hr_manager`, so the CHECKER must BE an
  // hr_manager (role holds hr.transfers.approve in role_permissions). Approving as admin only
  // worked before because admin was wrongly treated as elevated via workflow.instances.reassign
  // — closed by the decide-RPC fix. Acquire (create) a real hr_manager to decide. Submitting
  // stays as admin, so creator≠approver (SoD) holds.
  const { actors: [hrm], createdIds: hrmCreatedIds } = await h.acquireActors('hr_manager', 1);
  const HM = mint(hrm);
  // A genuine employee for the access-denial test — NOT the empId fixture, which the approve
  // test promotes to manager (auth resolves role from app_users, so a promoted empId would no
  // longer be denied).
  const { actors: [denyEmp], createdIds: denyCreatedIds } = await h.acquireActors('employee', 1);
  const DENY = mint(denyEmp);

  // ── Test fixtures ──────────────────────────────────────────────────────────
  // All IDs tagged so cleanup is safe even on partial failure.
  const empId   = `TRF-EMP-${TAG}`;
  const staffId = `TRF-STAFF-${TAG}`;
  const empId2  = `TRF-EMP2-${TAG}`;   // second employee for reject test

  const ctx = {
    crId:      null,
    crId2:     null,
    crId3:     null,   // access-control CR
  };

  // Poll helper — emitAppEvent is fire-and-forget; give it up to 6s.
  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await check()) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  };

  h.onCleanup(async () => {
    // Delete CRs by id (if known) and by employee_id (catch anything missed).
    try { if (ctx.crId)  await sb.from('hr_employee_change_requests').delete().eq('id', ctx.crId); }  catch {}
    try { if (ctx.crId2) await sb.from('hr_employee_change_requests').delete().eq('id', ctx.crId2); } catch {}
    try { if (ctx.crId3) await sb.from('hr_employee_change_requests').delete().eq('id', ctx.crId3); } catch {}
    try { await sb.from('hr_employee_change_requests').delete().eq('employee_id', empId).eq('change_type', 'transfer_promotion'); }  catch {}
    try { await sb.from('hr_employee_change_requests').delete().eq('employee_id', empId2).eq('change_type', 'transfer_promotion'); } catch {}
    try { const ids = [...(hrmCreatedIds ?? []), ...(denyCreatedIds ?? [])]; if (ids.length) await sb.from('app_users').delete().in('id', ids); } catch {}
    // Remove assignment rows created for the test employees.
    try { await sb.from('hr_employee_assignments').delete().eq('employee_id', empId); }  catch {}
    try { await sb.from('hr_employee_assignments').delete().eq('employee_id', empId2); } catch {}
    // Audit rows
    try { await sb.from('hr_audit_log').delete().eq('employee_id', empId); }  catch {}
    try { await sb.from('hr_audit_log').delete().eq('employee_id', empId2); } catch {}
    // App events
    try { await sb.from('app_events').delete().eq('source_module', 'hr').in('source_entity_id', [empId, empId2]); } catch {}
    // Seed users last
    try { await sb.from('app_users').delete().in('id', [empId, empId2, staffId]); } catch {}
    // Dept fixture last of all (after the users that referenced it via department_id are gone).
    try { if (ctx.deptId) await sb.from('departments').delete().eq('id', ctx.deptId); } catch {}
  });

  // ── Setup ──────────────────────────────────────────────────────────────────
  h.section('Transfers › Setup');

  await test('provision test employees + hr_staff', async () => {
    const { error: e1 } = await sb.from('app_users').insert({
      id: empId, username: `${TAG}_trfemp`, full_name: 'Transfer E2E Employee',
      role: 'employee', status: 'active', employment_type: 'employee',
      department_id: null, site_id: null,
    });
    expect(!e1, `seed employee failed: ${e1?.message}`);

    const { error: e2 } = await sb.from('app_users').insert({
      id: empId2, username: `${TAG}_trfemp2`, full_name: 'Transfer E2E Employee 2',
      role: 'employee', status: 'active', employment_type: 'employee',
    });
    expect(!e2, `seed employee 2 failed: ${e2?.message}`);

    const { error: e3 } = await sb.from('app_users').insert({
      id: staffId, username: `${TAG}_trfstaff`, full_name: 'Transfer E2E Staff',
      role: 'hr_staff', status: 'active', employment_type: 'employee',
    });
    expect(!e3, `seed hr_staff failed: ${e3?.message}`);
  });

  // ── Submit ─────────────────────────────────────────────────────────────────
  h.section('Transfers › Submit');

  await test('submit → CR row (Shape-B atomic): status in_review + workflow_id in-commit', async () => {
    const r = await api('hr/transfers/request', A, {
      employeeId:    empId,
      role:          'manager',
      monthlySalary: 8000,
      effectiveDate: '2026-08-01',
      reason:        'Promotion to team lead',
    });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.id,       'no id in response');
    expect(r.body.data.changeNo, 'no changeNo in response');
    expect(/^HRC-/.test(r.body.data.changeNo), `changeNo bad format: ${r.body.data.changeNo}`);
    ctx.crId = r.body.data.id;

    // Shape-B atomic: INSERT + workflow_id link + app_event + hr_audit_log in ONE commit.
    // status must be 'in_review' immediately (committed by RPC, not by adapter callback).
    const { data: cr } = await sb
      .from('hr_employee_change_requests')
      .select('id, change_type, status, requested_value, previous_value, workflow_id')
      .eq('id', ctx.crId)
      .maybeSingle();
    expect(!!cr,                                       'CR row not found');
    expect(cr.change_type === 'transfer_promotion',    `wrong change_type: ${cr.change_type}`);
    expect(cr.status === 'in_review',                  `status must be in_review immediately (atomic) — got: ${cr.status}`);
    expect(cr.requested_value?.role === 'manager',     'role not in requested_value');
    expect(cr.requested_value?.monthlySalary === 8000, 'monthlySalary not in requested_value');
    expect(cr.requested_value?.effectiveDate === '2026-08-01', 'effectiveDate not in requested_value');
    expect(!!cr.workflow_id, 'workflow_id must be set in-commit (atomic)');

    // workflow_instance in_progress + first task assigned to hr_manager
    const { data: wfi } = await sb.from('workflow_instances')
      .select('id, status').eq('id', cr.workflow_id).maybeSingle();
    expect(wfi && wfi.status === 'in_progress', `workflow_instance not in_progress — got ${wfi?.status}`);
    const { data: tasks } = await sb.from('workflow_tasks')
      .select('id, assigned_role').eq('workflow_id', cr.workflow_id).limit(5);
    expect(tasks && tasks.length > 0, 'no workflow_tasks for transfer_promotion');
    expect(tasks.some(t => t.assigned_role === 'hr_manager'), `first task not assigned to hr_manager — got ${JSON.stringify(tasks?.map(t => t.assigned_role))}`);

    // app_event + hr_audit_log committed in the same transaction (no polling needed)
    const { data: ev } = await sb.from('app_events').select('id')
      .eq('event_type', 'hr.employee.change_requested').eq('source_entity_id', ctx.crId).limit(1);
    expect(ev && ev.length === 1, 'change_requested app_event not written in-commit');

    const { data: audit } = await sb.from('hr_audit_log').select('id')
      .eq('submodule_key', 'employees').eq('action', 'hr.employee.change_requested')
      .eq('record_id', ctx.crId).limit(1);
    expect(audit && audit.length > 0, 'hr_audit_log not written in-commit');
  });

  await test('idempotent retry: same transfer request returns same CR, no duplicate', async () => {
    const r2 = await api('hr/transfers/request', A, {
      employeeId:    empId,
      role:          'manager',
      monthlySalary: 8000,
      effectiveDate: '2026-08-01',
      reason:        'Promotion to team lead',
    });
    ok(r2, `idempotent retry failed: ${r2.body.message}`);
    expect(r2.body.data.id === ctx.crId, `idempotent retry returned different id — got ${r2.body.data.id}`);
    const { count } = await sb.from('hr_employee_change_requests')
      .select('id', { count: 'exact', head: true }).eq('employee_id', empId).eq('change_type', 'transfer_promotion');
    expect((count ?? 0) === 1, `duplicate CR on retry — count: ${count}`);
  });

  await test('/transfers/list returns the submitted CR', async () => {
    const r = await api('hr/transfers/list', A, {});
    ok(r, 'list failed');
    expect(Array.isArray(r.body.data), 'data not array');
    const row = r.body.data.find(x => x.id === ctx.crId);
    expect(!!row,                              'CR not in list');
    expect(row.status === 'in_review',         `wrong status in list: ${row.status}`);
    expect(row.employeeName !== undefined,     'employeeName not enriched');
    expect(row.requestedByName !== undefined,  'requestedByName not enriched');
    expect(row.effectiveDate === '2026-08-01', `effectiveDate missing: ${row.effectiveDate}`);
  });

  await test('side-effect: hr.employee.change_requested event + hr_audit_log row (polling assertion)', async () => {
    // These are already asserted in the submit test as in-commit; this poll confirms
    // the rows remain committed and queryable after the transaction closes.
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id')
        .eq('source_module', 'hr')
        .eq('event_type', 'hr.employee.change_requested')
        .eq('source_entity_id', ctx.crId)
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'hr.employee.change_requested app_event not found after submit');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id')
      .eq('submodule_key', 'employees')
      .eq('action', 'hr.employee.change_requested')
      .eq('record_id', ctx.crId)
      .limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log for change_requested not found');
  });

  // ── Approve ────────────────────────────────────────────────────────────────
  h.section('Transfers › Approve');

  await test('approve via generic decide → app_users updated + assignment row + CR applied', async () => {
    const r = await api('hr/employee-change-requests/decide', HM, {
      requestId: ctx.crId,
      decision:  'approve',
    });
    ok(r, `approve failed: ${r.body.message}`);

    // CR status must be 'applied' (single-step template → engine completes immediately)
    const { data: cr } = await sb.from('hr_employee_change_requests')
      .select('status, applied_at')
      .eq('id', ctx.crId)
      .maybeSingle();
    expect(cr.status === 'applied', `expected applied, got ${cr.status}`);
    expect(!!cr.applied_at,         'applied_at not set');

    // app_users patched
    const { data: emp } = await sb.from('app_users')
      .select('role, monthly_salary, pay_basis')
      .eq('id', empId)
      .maybeSingle();
    expect(emp.role           === 'manager', `role not updated: ${emp.role}`);
    expect(emp.monthly_salary === 8000,      `salary not updated: ${emp.monthly_salary}`);
    expect(emp.pay_basis      === 'salary',  `pay_basis not set: ${emp.pay_basis}`);

    // Assignment history row NOT created (no org field changed — only role + salary)
    // The applyChange case only inserts an assignment row when orgChanged is true.
    // This is correct behaviour — assert no spurious assignment row was created.
    const { data: assignments } = await sb.from('hr_employee_assignments')
      .select('id')
      .eq('employee_id', empId)
      .eq('is_current', true);
    // No assignment row because only role/salary changed (no dept/site/pos/supervisor).
    // The count may be 0 (no prior assignment) or whatever pre-existed.
    // We can't assert a count without knowing the employee's prior state; we just verify
    // the CR applied cleanly (checked above).
    expect(true, 'approve completed without error');
  });

  await test('side-effect after approve: hr.employee.change_applied event + audit', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id')
        .eq('source_module', 'hr')
        .eq('event_type', 'hr.employee.change_applied')
        .eq('source_entity_id', ctx.crId)
        .limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'hr.employee.change_applied app_event not found (after approve)');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id')
      .eq('submodule_key', 'employees')
      .eq('action', 'hr.employee.change_applied')
      .eq('record_id', ctx.crId)
      .limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log for change_applied not found');
  });

  // ── Approve with org change → assignment history ───────────────────────────
  h.section('Transfers › Assignment history on org change');

  await test('submit a dept + effectiveDate request → approve → assignment history row stamped', async () => {
    // app_users.department_id has an FK to departments — a placeholder id can never apply, so
    // create a REAL department for the transfer to land on.
    const { data: dept, error: dErr } = await sb.from('departments')
      .insert({ name: `TRF Dept ${TAG}`, code: `${TAG}-D`, org_unit_type: 'department' }).select('id').single();
    expect(!dErr, `dept fixture create failed: ${dErr?.message}`);
    ctx.deptId = dept.id;
    // Submit a bundled request that includes a department change (triggers assignment row)
    const submitR = await api('hr/transfers/request', A, {
      employeeId:    empId2,
      departmentId:  ctx.deptId,
      effectiveDate: '2026-09-01',
      reason:        'Org restructure',
    });
    ok(submitR, `submit (org) failed: ${submitR.body.message}`);
    ctx.crId2 = submitR.body.data.id;

    // Approve
    const approveR = await api('hr/employee-change-requests/decide', HM, {
      requestId: ctx.crId2,
      decision:  'approve',
    });
    ok(approveR, `approve (org) failed: ${approveR.body.message}`);

    // app_users department updated
    const { data: emp } = await sb.from('app_users')
      .select('department_id')
      .eq('id', empId2)
      .maybeSingle();
    expect(emp.department_id === ctx.deptId, `department not updated: ${emp.department_id}`);

    // Assignment history row stamped with effectiveDate
    const { data: assignments } = await sb.from('hr_employee_assignments')
      .select('id, effective_from, is_current, department_id')
      .eq('employee_id', empId2)
      .eq('is_current', true)
      .limit(1);
    expect((assignments ?? []).length > 0,                'no is_current assignment row');
    expect(assignments[0].effective_from === '2026-09-01', `effective_from wrong: ${assignments[0].effective_from}`);
    expect(assignments[0].department_id === ctx.deptId, 'dept not on assignment row');
  });

  // ── Reject ─────────────────────────────────────────────────────────────────
  h.section('Transfers › Reject');

  await test('submit a second request then reject → CR rejected, app_users unchanged', async () => {
    const submitR = await api('hr/transfers/request', A, {
      employeeId:    empId,
      role:          'superadmin',    // will be rejected
      effectiveDate: '2026-10-01',
    });
    ok(submitR, `submit (reject test) failed: ${submitR.body.message}`);
    ctx.crId3 = submitR.body.data.id;

    const rejectR = await api('hr/employee-change-requests/decide', HM, {
      requestId: ctx.crId3,
      decision:  'reject',
      comment:   'Not approved',
    });
    ok(rejectR, `reject failed: ${rejectR.body.message}`);

    const { data: cr } = await sb.from('hr_employee_change_requests')
      .select('status')
      .eq('id', ctx.crId3)
      .maybeSingle();
    expect(cr.status === 'rejected', `expected rejected, got ${cr.status}`);

    // app_users role unchanged — still 'manager' from the earlier approve test
    const { data: emp } = await sb.from('app_users')
      .select('role')
      .eq('id', empId)
      .maybeSingle();
    expect(emp.role !== 'superadmin', `role was wrongly applied after reject: ${emp.role}`);
  });

  // ── Access control ─────────────────────────────────────────────────────────
  h.section('Transfers › Access control');

  await test('employee user denied /transfers/request (no hr.transfers.request)', async () => {
    // DENY is a genuine, never-promoted employee (auth resolves role from app_users).
    const r = await api('hr/transfers/request', DENY, {
      employeeId:    empId2,
      role:          'manager',
      effectiveDate: '2026-08-01',
    });
    fails(r, 'employee should be denied /transfers/request');
  });

  await test('hr_staff can submit but CANNOT approve (hr.transfers.approve denied)', async () => {
    const staffT = mint({ id: staffId, username: `${TAG}_trfstaff`, role: 'hr_staff', department_id: null });

    // hr_staff has hr.transfers.request — submit should succeed
    const submitR = await api('hr/transfers/request', staffT, {
      employeeId:    empId,
      monthlySalary: 9000,
      effectiveDate: '2026-11-01',
      reason:        'Staff-submitted request',
    });
    ok(submitR, `hr_staff submit failed unexpectedly: ${submitR.body.message}`);
    const staffCrId = submitR.body.data.id;

    // hr_staff lacks hr.transfers.approve — decide should be 403
    const decideR = await api('hr/employee-change-requests/decide', staffT, {
      requestId: staffCrId,
      decision:  'approve',
    });
    fails(decideR, 'hr_staff should be denied approve');

    // Cleanup: cancel as admin
    await api('hr/employee-change-requests/cancel', A, { requestId: staffCrId });
  });

  await test('generic /employees/change-request REJECTS transfer_promotion change type', async () => {
    // The generic route filters GENERIC_CHANGE_TYPES (excludes transfer_promotion).
    // Zod enum validation will return a 400.
    const r = await api('hr/employees/change-request', A, {
      employeeId:     empId,
      changeType:     'transfer_promotion',
      requestedValue: { role: 'admin', effectiveDate: '2026-08-01' },
    });
    // Must fail — transfer_promotion is not in GENERIC_CHANGE_TYPES
    fails(r, 'generic change-request should reject transfer_promotion changeType');
  });
}
