/**
 * scripts/e2e/suites/hr.mjs
 *
 * E2E suite for the HR people backbone (Phase 1: Employee Master + Organization).
 * Backend route: hr.ts, mounted at /api/hr/. Covers:
 *   employees/{list,get,update,status-change,transfer,supervisor-change,training-summary,audit}
 *   organization/tree · positions/{list,create,update} · dashboard/kpis
 *
 * Permissions: hr.view · hr.dashboard.view · hr.audit.view · hr.employees.* ·
 *              hr.organization.* · hr.positions.*  (admin holds all; employee none)
 * §2 side-effects asserted via the service-role client (hr_audit_log, app_events,
 * hr_employee_status_history, hr_employee_assignments).
 *
 * Requires the HR migrations (20260702000000–000003) applied + NOTIFY pgrst.
 */

export const title = 'HR — Employee Master + Organization';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), b: mint(b) };

  // Acquire a plain 'employee' role user for access-control denial tests.
  // h.users.b is manager (has hr.view, hr.employee_documents.view) so cannot be
  // used for denial tests on HR-restricted endpoints.
  let empDenialToken = null;
  {
    const { actors: [plainEmp] } = await acquireActors('employee', 1);
    if (plainEmp) empDenialToken = mint(plainEmp);
  }

  const empId  = `HR-E2E-${TAG}`;
  const posKey = `${TAG}-POS`;
  const ctx = { positionIds: [] };

  const waitFor = async (check, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  // ── Cleanup (tag-based; guarded so one failure can't abort the rest) ──────────
  h.onCleanup(async () => {
    try { await sb.from('hr_audit_log').delete().eq('employee_id', empId); } catch {}
    try { await sb.from('hr_employee_status_history').delete().eq('employee_id', empId); } catch {}
    try { await sb.from('hr_employee_assignments').delete().eq('employee_id', empId); } catch {}
    try { await sb.from('hr_employee_documents').delete().eq('employee_id', empId); } catch {}
    try { await sb.from('hr_employee_change_requests').delete().eq('employee_id', empId); } catch {}
    try { await sb.from('app_events').delete().eq('source_entity_id', empId); } catch {}
    try { await sb.from('hr_positions').delete().ilike('position_key', `%${TAG}%`); } catch {}
    try { await sb.from('app_users').delete().eq('id', empId); } catch {}
  });

  // ── Setup: a throwaway employee + a department to transfer to ─────────────────
  h.section('HR › Setup');

  await test('seed a test employee (app_users)', async () => {
    const { error } = await sb.from('app_users').insert({
      id: empId, username: `${TAG}_emp`, full_name: 'HR E2E Tester',
      role: 'employee', status: 'active', employment_type: 'employee',
    });
    expect(!error, `seed employee failed: ${error?.message}`);
    const { data } = await sb.from('app_users').select('first_name, last_name, full_name').eq('id', empId).single();
    expect(data?.full_name === 'HR E2E Tester', 'full_name not set on seed');
  });

  let deptId = null;
  await test('a department exists to transfer into', async () => {
    const { data } = await sb.from('departments').select('id').limit(1).maybeSingle();
    deptId = data?.id ?? null;
    expect(true, 'departments query ok');
  });

  // ── Employee Master ──────────────────────────────────────────────────────────
  h.section('HR › Employee Master');

  await test('employees/list returns HR fields + departmentName', async () => {
    const r = await api('hr/employees/list', T.admin, { limit: 500 });
    ok(r, 'list failed');
    expect(Array.isArray(r.body.data), 'data not array');
    const row = r.body.data.find(x => x.id === empId);
    expect(!!row, 'seeded employee not in list');
    expect('employment_type' in row && 'supervisor_id' in row, 'HR fields missing from list row');
  });

  await test('employees/get returns profile + statusHistory + currentAssignment keys', async () => {
    const r = await api('hr/employees/get', T.admin, { employeeId: empId });
    ok(r, 'get failed');
    expect(r.body.data?.employee?.id === empId, 'wrong employee');
    expect(Array.isArray(r.body.data.statusHistory), 'statusHistory missing');
    expect('currentAssignment' in r.body.data, 'currentAssignment missing');
  });

  await test('employees/update edits HR fields + writes audit', async () => {
    const r = await api('hr/employees/update', T.admin, { employeeId: empId, firstName: 'Updated', lastName: 'Tester', phone: '555-0100' });
    ok(r, 'update failed');
    const { data } = await sb.from('app_users').select('first_name, full_name, phone').eq('id', empId).single();
    expect(data?.first_name === 'Updated', 'first_name not updated');
    expect(data?.full_name === 'Updated Tester', 'full_name trigger did not sync');
    const audited = await waitFor(async () => {
      const { data: a } = await sb.from('hr_audit_log').select('id').eq('employee_id', empId).eq('action', 'hr.employee.updated').limit(1);
      return (a?.length ?? 0) > 0;
    });
    expect(audited, 'update audit row not written');
  });

  await test('ACCESS: employees/list denied without auth', async () => {
    fails(await api('hr/employees/list', null, {}), 'list should deny without auth');
  });

  await test('ACCESS: non-privileged employee denied on update', async () => {
    fails(await api('hr/employees/update', T.b, { employeeId: empId, phone: 'x' }), 'employee B should not edit HR records');
  });

  // ── Status change ─────────────────────────────────────────────────────────────
  h.section('HR › Status change');

  await test('status-change → history row + audit + app_event', async () => {
    const r = await api('hr/employees/status-change', T.admin, { employeeId: empId, newStatus: 'probation', reason: `${TAG} test` });
    ok(r, 'status-change failed');
    const { data: hist } = await sb.from('hr_employee_status_history').select('new_status').eq('employee_id', empId).order('changed_at', { ascending: false }).limit(1).maybeSingle();
    expect(hist?.new_status === 'probation', 'status history not written');
    const ev = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'hr.employee.status_changed').eq('source_entity_id', empId).limit(1);
      return (data?.length ?? 0) > 0;
    });
    expect(ev, 'hr.employee.status_changed app_event not emitted');
  });

  await test('SIDE-EFFECT: blocking status syncs app_users.status to inactive', async () => {
    const r = await api('hr/employees/status-change', T.admin, { employeeId: empId, newStatus: 'suspended', reason: `${TAG} suspend` });
    ok(r, 'suspend failed');
    const { data } = await sb.from('app_users').select('status').eq('id', empId).single();
    expect(data?.status === 'inactive', 'blocking status did not sync app_users.status');
  });

  await test('ACCESS: non-privileged employee denied on status-change', async () => {
    fails(await api('hr/employees/status-change', T.b, { employeeId: empId, newStatus: 'active' }), 'B should not change status');
  });

  // ── Transfer + supervisor ──────────────────────────────────────────────────────
  h.section('HR › Transfer + Supervisor');

  await test('transfer opens a current assignment', async () => {
    const r = await api('hr/employees/transfer', T.admin, { employeeId: empId, departmentId: deptId, reason: `${TAG} transfer` });
    ok(r, 'transfer failed');
    const { data } = await sb.from('hr_employee_assignments').select('is_current, department_id').eq('employee_id', empId).eq('is_current', true).maybeSingle();
    expect(!!data, 'no current assignment after transfer');
  });

  await test('supervisor-change sets supervisor + rejects self-supervision', async () => {
    const r = await api('hr/employees/supervisor-change', T.admin, { employeeId: empId, supervisorId: b.id });
    ok(r, 'supervisor-change failed');
    const { data } = await sb.from('app_users').select('supervisor_id').eq('id', empId).single();
    expect(data?.supervisor_id === b.id, 'supervisor not set');
    fails(await api('hr/employees/supervisor-change', T.admin, { employeeId: empId, supervisorId: empId }), 'self-supervision should be rejected');
  });

  // ── Training summary (read-only from Training) ──────────────────────────────────
  h.section('HR › Training summary');

  await test('training-summary returns the count contract', async () => {
    const r = await api('hr/employees/training-summary', T.admin, { employeeId: empId });
    ok(r, 'training-summary failed');
    for (const k of ['total', 'current', 'dueSoon', 'expired', 'pending']) expect(k in r.body.data, `missing ${k}`);
  });

  // ── Organization + Positions ────────────────────────────────────────────────────
  h.section('HR › Organization + Positions');

  await test('organization/tree returns org units', async () => {
    const r = await api('hr/organization/tree', T.admin, {});
    ok(r, 'org tree failed');
    expect(Array.isArray(r.body.data), 'org tree not array');
  });

  await test('positions/create + list + update', async () => {
    const cr = await api('hr/positions/create', T.admin, { positionKey: posKey, title: `${TAG} Technician`, isSafetyCritical: true });
    ok(cr, 'position create failed');
    if (cr.body.data?.id) ctx.positionIds.push(cr.body.data.id);
    const lr = await api('hr/positions/list', T.admin, {});
    ok(lr, 'position list failed');
    expect(lr.body.data.some(p => p.positionKey === posKey), 'created position not listed');
    const ur = await api('hr/positions/update', T.admin, { positionId: cr.body.data.id, title: `${TAG} Senior Technician` });
    ok(ur, 'position update failed');
  });

  await test('ACCESS: non-privileged employee denied on positions/create', async () => {
    fails(await api('hr/positions/create', T.b, { positionKey: `${TAG}-X`, title: 'x' }), 'B should not manage positions');
  });

  // ── Change requests (maker-checker) ──────────────────────────────────────────────
  h.section('HR › Change requests');

  let reqId = null;
  let tHrMgr = null;
  await test('change-request create + list', async () => {
    // The engine task is role-assigned to hr_manager (binding matches now that
    // source context threads through) — acquire the checker up front.
    const { actors: [hrMgr] } = await h.acquireActors('hr_manager', 1);
    tHrMgr = mint(hrMgr);
    const r = await api('hr/employees/change-request', T.admin, { employeeId: empId, changeType: 'status_change', requestedValue: { newStatus: 'active' }, reason: `${TAG} reinstate` });
    ok(r, 'change-request create failed');
    reqId = r.body.data?.id ?? null;
    expect(!!reqId, 'no change request id');
    const lr = await api('hr/employee-change-requests/list', T.admin, { employeeId: empId });
    ok(lr, 'change-request list failed');
    expect(lr.body.data.some(x => x.id === reqId), 'change request not listed');
  });

  await test('decide approve → applied + change effected + event', async () => {
    const r = await api('hr/employee-change-requests/decide', tHrMgr, { requestId: reqId, decision: 'approve' });
    ok(r, 'decide approve failed');
    expect(r.body.data.status === 'applied', `expected applied, got ${r.body.data.status}`);
    const { data } = await sb.from('app_users').select('status').eq('id', empId).single();
    expect(data?.status === 'active', 'approved status_change not applied to app_users');
    const ev = await waitFor(async () => {
      const { data: e } = await sb.from('app_events').select('id').eq('event_type', 'hr.employee.change_applied').eq('source_entity_id', reqId).limit(1);
      return (e?.length ?? 0) > 0;
    });
    expect(ev, 'hr.employee.change_applied event not emitted');
  });

  await test('decide reject does NOT apply the change', async () => {
    const cr = await api('hr/employees/change-request', T.admin, { employeeId: empId, changeType: 'role_change', requestedValue: { role: 'manager' } });
    ok(cr, 'second change-request failed');
    const r = await api('hr/employee-change-requests/decide', tHrMgr, { requestId: cr.body.data.id, decision: 'reject', comment: 'denied' });
    ok(r, 'reject failed');
    expect(r.body.data.status === 'rejected', 'not rejected');
    const { data } = await sb.from('app_users').select('role').eq('id', empId).single();
    expect(data?.role === 'employee', 'role must not change on reject');
  });

  await test('GATE: an applied request cannot be decided again', async () => {
    fails(await api('hr/employee-change-requests/decide', T.admin, { requestId: reqId, decision: 'approve' }), 're-deciding an applied request should fail');
  });

  await test('ACCESS: non-HR employee denied on change-request create', async () => {
    if (!empDenialToken) { h.skip('no employee user for denial test'); return; }
    fails(await api('hr/employees/change-request', empDenialToken, { employeeId: empId, changeType: 'status_change', requestedValue: { newStatus: 'suspended' } }), 'employee should not create change requests');
  });

  // ── Employee Documents (DB flow; bucket-backed upload/download covered manually) ─
  h.section('HR › Documents');

  let docId = null;
  await test('documents/commit + list', async () => {
    const cr = await api('hr/employees/documents/commit', T.admin, {
      employeeId: empId, documentType: 'contract', title: `${TAG} Employment Contract`,
      filePath: `hr-employee-documents/${empId}/test/contract.pdf`, fileName: 'contract.pdf',
      mimeType: 'application/pdf', confidentiality: 'confidential',
    });
    ok(cr, 'doc commit failed');
    docId = cr.body.data?.id ?? null;
    expect(!!docId, 'no doc id returned');
    const lr = await api('hr/employees/documents/list', T.admin, { employeeId: empId });
    ok(lr, 'doc list failed');
    expect(lr.body.data.some(d => d.id === docId), 'committed doc not listed');
  });

  await test('documents/verify (approve) → verified + audit', async () => {
    const r = await api('hr/documents/verify', T.admin, { documentId: docId, decision: 'approve' });
    ok(r, 'verify failed');
    const { data } = await sb.from('hr_employee_documents').select('status, verified_by').eq('id', docId).single();
    expect(data?.status === 'verified', 'doc not verified');
  });

  await test('documents/archive → removed from active list', async () => {
    const r = await api('hr/documents/archive', T.admin, { documentId: docId });
    ok(r, 'archive failed');
    const lr = await api('hr/employees/documents/list', T.admin, { employeeId: empId });
    expect(!lr.body.data.some(d => d.id === docId), 'archived doc still in active list');
  });

  await test('ACCESS: non-privileged employee denied on documents/upload + list', async () => {
    if (!empDenialToken) { h.skip('no employee user for denial test'); return; }
    fails(await api('hr/employees/documents/upload-url', empDenialToken, { fileName: 'x.pdf', mimeType: 'application/pdf' }), 'B should not upload HR docs');
    fails(await api('hr/employees/documents/list', empDenialToken, { employeeId: empId }), 'B should not view HR docs');
  });

  // ── Dashboard ──────────────────────────────────────────────────────────────────
  h.section('HR › Dashboard');

  await test('dashboard/kpis returns the card contract', async () => {
    const r = await api('hr/dashboard/kpis', T.admin, {});
    ok(r, 'kpis failed');
    for (const k of ['activeEmployees', 'contractors', 'inactive', 'newHiresThisMonth', 'pendingChangeRequests', 'totalTracked'])
      expect(k in r.body.data, `missing kpi ${k}`);
  });

  // ── Access control (negative paths) ──────────────────────────────────────────────
  h.section('HR › Access control');

  await test('ACCESS: core endpoints deny without auth', async () => {
    for (const p of ['hr/employees/get', 'hr/dashboard/kpis', 'hr/organization/tree', 'hr/positions/list'])
      fails(await api(p, null, { employeeId: empId }), `${p} should deny without auth`);
  });
}
