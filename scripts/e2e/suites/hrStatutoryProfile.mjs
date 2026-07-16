/**
 * scripts/e2e/suites/hrStatutoryProfile.mjs
 *
 * E2E for HR Phase 2.5 / Finance Phase 2.5:
 * Employee Statutory Profile — NIS Continuity Capture (HR) + Verification (Finance).
 *
 * Routes under test:
 *   POST /api/hr/employee-statutory/get
 *   POST /api/hr/employee-statutory/capture
 *   POST /api/hr/employee-statutory/submit
 *   POST /api/finance/payroll/nis/list
 *   POST /api/finance/payroll/nis/get
 *   POST /api/finance/payroll/nis/verify
 *   POST /api/finance/payroll/nis/reject
 *
 * Covers:
 *   • HR can view + capture NIS profile data.
 *   • HR cannot set nis_status='verified' (DENIED via route permission).
 *   • Capture is idempotent — second call updates the existing profile.
 *   • HR submits → workflow starts → profile workflow_id is set.
 *   • Finance Staff can view the pending profile.
 *   • Finance Manager can verify → nis_status becomes 'verified'.
 *   • Finance Manager can reject → nis_status becomes 'not_available'.
 *   • HR role attempting verify is DENIED with the correct code.
 *   • Employee role is DENIED all NIS endpoints.
 *   • §2 side-effects: app_events + hr_audit_log written after capture + verify.
 *   • Cleanup via h.TAG.
 *
 * Prerequisites:
 *   Migrations 20260802000010–20260802000012 + NOTIFY pgrst must be applied.
 */

export const title = 'HR/Finance — Employee Statutory Profile / NIS Verification (Phase 2.5)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;

  // ── Test user IDs ─────────────────────────────────────────────────────────────
  const hrStaffId    = `NSP-HRST-${TAG}`;
  const hrMgrId      = `NSP-HRMG-${TAG}`;
  const finStaffId   = `NSP-FIST-${TAG}`;
  const finMgrId     = `NSP-FIMG-${TAG}`;
  const empId        = `NSP-EMP-${TAG}`;
  const emp2Id       = `NSP-EM2-${TAG}`;

  // Cross-test context
  const ctx = {
    profile1Id:  null,   // first employee's profile (submit→verify flow)
    profile2Id:  null,   // second employee's profile (reject flow)
  };

  let hrStaffToken, hrMgrToken, finStaffToken, finMgrToken, empToken;

  const waitFor = async (check, ms = 7000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 400)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('hr_employee_statutory_profiles').delete().like('employee_id', 'NSP-%'); } catch {}
    try { await sb.from('hr_audit_log').delete().in('actor_id', [hrStaffId, hrMgrId, finStaffId, finMgrId, empId, emp2Id]); } catch {}
    try {
      await sb.from('app_events')
        .delete()
        .like('actor_user_id', 'NSP-%');
    } catch {}
    try { await sb.from('app_users').delete().in('id', [hrStaffId, hrMgrId, finStaffId, finMgrId, empId, emp2Id]); } catch {}
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('NIS Profile › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('provision test users', async () => {
    const users = [
      { id: hrStaffId, username: `${TAG}_nsp_hrst`, full_name: 'HR Staff (NSP E2E)', role: 'hr_staff', status: 'active', employment_type: 'employee' },
      { id: hrMgrId,   username: `${TAG}_nsp_hrmg`, full_name: 'HR Manager (NSP E2E)', role: 'hr_manager', status: 'active', employment_type: 'employee' },
      { id: finStaffId, username: `${TAG}_nsp_fist`, full_name: 'Finance Staff (NSP E2E)', role: 'finance_staff', status: 'active', employment_type: 'employee' },
      { id: finMgrId,  username: `${TAG}_nsp_fimg`, full_name: 'Finance Manager (NSP E2E)', role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: empId,     username: `${TAG}_nsp_emp`,  full_name: 'Employee (NSP E2E)', role: 'employee', status: 'active', employment_type: 'employee' },
      { id: emp2Id,    username: `${TAG}_nsp_em2`,  full_name: 'Employee 2 (NSP E2E)', role: 'employee', status: 'active', employment_type: 'employee' },
    ];
    const { error } = await sb.from('app_users').insert(users);
    expect(!error, `seed failed: ${error?.message}`);

    hrStaffToken  = mint({ id: hrStaffId,  username: `${TAG}_nsp_hrst`, role: 'hr_staff',      department_id: null });
    hrMgrToken    = mint({ id: hrMgrId,    username: `${TAG}_nsp_hrmg`, role: 'hr_manager',    department_id: null });
    finStaffToken = mint({ id: finStaffId, username: `${TAG}_nsp_fist`, role: 'finance_staff', department_id: null });
    finMgrToken   = mint({ id: finMgrId,   username: `${TAG}_nsp_fimg`, role: 'finance_manager', department_id: null });
    empToken      = mint({ id: empId,      username: `${TAG}_nsp_emp`,  role: 'employee',      department_id: null });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('NIS Profile › HR Capture');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('GET returns null for an employee with no profile yet', async () => {
    const r = await api('hr/employee-statutory/get', hrStaffToken, { employeeId: empId });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data === null, 'expected null for new employee');
  });

  await test('employee is DENIED viewing statutory profile', async () => {
    const r = await api('hr/employee-statutory/get', empToken, { employeeId: empId });
    fails(r, 'employee should not view statutory profile');
  });

  await test('hr_staff can capture a statutory profile (create)', async () => {
    const r = await api('hr/employee-statutory/capture', hrStaffToken, {
      employeeId:                  empId,
      nisNumber:                   'NIS-123456',
      nisApplicable:               true,
      previousEmployerName:        'ACME Corp',
      previousEmployerEndDate:     '2025-12-31',
      openingYtdInsurableEarnings: 48000.00,
      openingYtdNisEmployee:       960.00,
      openingYtdNisEmployer:       1344.00,
      openingBalanceAsOf:          '2025-12-31',
    });
    ok(r, `capture failed: ${r.body.message}`);
    const d = r.body.data;
    // Response shape assertions
    expect(d.id, 'missing id');
    expect(d.employeeId === empId, 'employeeId mismatch');
    expect(d.jurisdiction === 'TT', 'expected TT jurisdiction');
    expect(d.currency === 'TTD', 'expected TTD currency');
    expect(d.nisNumber === 'NIS-123456', 'nisNumber mismatch');
    expect(d.nisStatus === 'pending_verification', 'new profile should be pending_verification');
    expect(d.nisApplicable === true, 'nisApplicable mismatch');
    expect(d.previousEmployerName === 'ACME Corp', 'previousEmployerName mismatch');
    expect(d.openingYtdInsurableEarnings === 48000, 'openingYtdInsurableEarnings mismatch');
    expect(d.openingYtdNisEmployee === 960, 'openingYtdNisEmployee mismatch');
    expect(d.openingYtdNisEmployer === 1344, 'openingYtdNisEmployer mismatch');
    expect(d.verifiedBy === null, 'verifiedBy should be null before Finance review');
    expect(d.verifiedAt === null, 'verifiedAt should be null before Finance review');
    expect(d.createdBy === hrStaffId, 'createdBy mismatch');
    ctx.profile1Id = d.id;
  });

  await test('GET now returns the captured profile', async () => {
    const r = await api('hr/employee-statutory/get', hrStaffToken, { employeeId: empId });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data !== null, 'profile should exist now');
    expect(r.body.data.id === ctx.profile1Id, 'profile id mismatch');
    expect(r.body.data.nisStatus === 'pending_verification', 'status mismatch');
  });

  await test('capture is idempotent — second call updates the profile', async () => {
    const r = await api('hr/employee-statutory/capture', hrStaffToken, {
      employeeId: empId,
      nisNumber:  'NIS-654321',
    });
    ok(r, `update failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.profile1Id, 'id should be the same profile');
    expect(r.body.data.nisNumber === 'NIS-654321', 'nisNumber should be updated');
    expect(r.body.data.nisStatus === 'pending_verification', 'status should remain pending_verification');
  });

  await test('employee is DENIED capturing a statutory profile', async () => {
    const r = await api('hr/employee-statutory/capture', empToken, {
      employeeId: empId,
      nisNumber:  'NIS-NOPE',
    });
    fails(r, 'employee should be denied capture');
  });

  await test('§2 side-effects — app_events written after capture', async () => {
    const ok2 = await waitFor(async () => {
      const { data } = await sb
        .from('app_events')
        .select('id')
        .eq('source_module', 'hr_statutory')
        .eq('source_entity_id', ctx.profile1Id)
        .limit(1);
      return (data?.length ?? 0) > 0;
    });
    expect(ok2, 'app_events not written for statutory profile capture');
  });

  await test('§2 side-effects — hr_audit_log written after capture', async () => {
    const ok2 = await waitFor(async () => {
      const { data } = await sb
        .from('hr_audit_log')
        .select('id')
        .eq('submodule_key', 'hr_statutory')
        .eq('record_id', ctx.profile1Id)
        .limit(1);
      return (data?.length ?? 0) > 0;
    });
    expect(ok2, 'hr_audit_log not written for statutory profile capture');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('NIS Profile › HR Submit → Workflow');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('hr_staff can submit the profile for Finance verification', async () => {
    const r = await api('hr/employee-statutory/submit', hrStaffToken, { id: ctx.profile1Id, idempotencyKey: `${TAG}-sub1` });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.profile1Id, 'id mismatch after submit');
    // After submit the workflow engine may change the status or set workflow_id
    // Either way, the profile should not have been moved to 'verified' by HR
    expect(r.body.data.nisStatus !== 'verified', 'HR submit must NOT set nisStatus to verified');
  });

  await test('workflow_id is set after submit', async () => {
    const ok2 = await waitFor(async () => {
      const { data } = await sb
        .from('hr_employee_statutory_profiles')
        .select('workflow_id')
        .eq('id', ctx.profile1Id)
        .single();
      return data?.workflow_id != null;
    });
    expect(ok2, 'workflow_id not set after submit');
  });

  // ── Finding #3: atomic submit-on-existing (workflow_submit_for_record_tx) ──────
  const nisBindingId = async () =>
    (await sb.from('module_workflow_bindings').select('id')
      .eq('workflow_type', 'finance_nis_profile_verification').eq('is_active', true).limit(1)).data?.[0]?.id;

  await test('ATOMIC submit: workflow linked in-commit + finance_staff task + exactly-one event/audit', async () => {
    const { data: row } = await sb.from('hr_employee_statutory_profiles')
      .select('nis_status, workflow_id').eq('id', ctx.profile1Id).single();
    expect(row?.workflow_id != null, 'workflow_id not stamped atomically at submit');
    expect(row?.nis_status !== 'verified', 'HR submit must not verify');
    const { data: inst } = await sb.from('workflow_instances').select('status').eq('id', row.workflow_id).maybeSingle();
    expect(inst && inst.status === 'in_progress', `workflow instance missing/not in_progress: ${JSON.stringify(inst)}`);
    const { data: tasks } = await sb.from('workflow_tasks').select('assigned_role').eq('workflow_id', row.workflow_id);
    expect((tasks ?? []).some(t => t.assigned_role === 'finance_staff'), `no finance_staff first task: ${JSON.stringify(tasks)}`);
    const { data: evs } = await sb.from('app_events').select('id')
      .eq('event_type', 'finance.nis.profile.submitted').eq('source_entity_id', ctx.profile1Id);
    expect((evs ?? []).length === 1, `expected exactly 1 submitted event, got ${(evs ?? []).length}`);
    const { data: aud } = await sb.from('hr_audit_log').select('id')
      .eq('action', 'statutory_profile.submitted').eq('record_id', ctx.profile1Id);
    expect((aud ?? []).length === 1, `expected exactly 1 submitted audit, got ${(aud ?? []).length}`);
  });

  await test('ATOMIC idempotent replay: same key → no 2nd workflow or event', async () => {
    const { data: before } = await sb.from('hr_employee_statutory_profiles').select('workflow_id').eq('id', ctx.profile1Id).single();
    const r = await api('hr/employee-statutory/submit', hrStaffToken, { id: ctx.profile1Id, idempotencyKey: `${TAG}-sub1` });
    ok(r, `replay failed: ${r.body.message}`);
    const { data: after } = await sb.from('hr_employee_statutory_profiles').select('workflow_id').eq('id', ctx.profile1Id).single();
    expect(after.workflow_id === before.workflow_id, `replay changed workflow_id (${before.workflow_id} -> ${after.workflow_id})`);
    const { data: evs } = await sb.from('app_events').select('id')
      .eq('event_type', 'finance.nis.profile.submitted').eq('source_entity_id', ctx.profile1Id);
    expect((evs ?? []).length === 1, `replay emitted a 2nd event (${(evs ?? []).length})`);
  });

  await test('CHANGED-PAYLOAD guard: same key + divergent payload → WF409', async () => {
    const { error } = await sb.rpc('workflow_submit_for_record_tx', {
      p_source_table: 'hr_employee_statutory_profiles', p_source_id: ctx.profile1Id, p_actor_id: hrStaffId,
      p_binding_id: await nisBindingId(), p_request_key: `${TAG}-sub1`, p_business: { changed: true },
    });
    expect(error && error.code === 'WF409', `expected WF409 on divergent payload, got ${JSON.stringify(error)}`);
  });

  await test('CONCURRENT submit: same key resolves to exactly one workflow', async () => {
    // Throwaway employee + profile so concurrency is isolated from the verify/reject flows.
    const concEmp = `NSP-CONC-${TAG}`;
    await sb.from('app_users').insert({ id: concEmp, username: `${TAG}_nsp_conc`, full_name: 'Conc (NSP E2E)', role: 'employee', status: 'active', employment_type: 'employee' });
    const { data: p } = await sb.from('hr_employee_statutory_profiles')
      .insert({ employee_id: concEmp, jurisdiction: 'TT', nis_status: 'pending_verification', created_by: hrStaffId })
      .select('id').single();
    const bindingId = await nisBindingId();
    const key = `${TAG}-conc`;
    const res = await Promise.all(Array.from({ length: 5 }, () => sb.rpc('workflow_submit_for_record_tx', {
      p_source_table: 'hr_employee_statutory_profiles', p_source_id: p.id, p_actor_id: hrStaffId,
      p_binding_id: bindingId, p_request_key: key, p_business: {},
    })));
    const wfIds = new Set(res.map(r => r.data?.workflowId).filter(Boolean));
    expect(wfIds.size === 1, `expected 1 workflow from 5 concurrent submits, got ${wfIds.size} (errors: ${JSON.stringify(res.map(r => r.error?.code).filter(Boolean))})`);
    // cleanup throwaway
    await sb.from('hr_employee_statutory_profiles').delete().eq('id', p.id);
    await sb.from('app_users').delete().eq('id', concEmp);
  });

  await test('employee is DENIED submitting a statutory profile', async () => {
    const r = await api('hr/employee-statutory/submit', empToken, { id: ctx.profile1Id, idempotencyKey: `${TAG}-subDenied` });
    fails(r, 'employee should be denied submit');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('NIS Profile › Finance View');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_staff can list NIS profiles', async () => {
    const r = await api('finance/payroll/nis/list', finStaffToken, {});
    ok(r, `list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data not array');
  });

  await test('finance_staff can view a specific NIS profile', async () => {
    const r = await api('finance/payroll/nis/get', finStaffToken, { id: ctx.profile1Id });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.profile1Id, 'profile id mismatch');
    expect(r.body.data.employeeId === empId, 'employeeId mismatch');
  });

  await test('employee is DENIED viewing Finance NIS list', async () => {
    const r = await api('finance/payroll/nis/list', empToken, {});
    fails(r, 'employee should be denied Finance NIS list');
  });

  await test('hr_staff is DENIED the Finance NIS list', async () => {
    const r = await api('finance/payroll/nis/list', hrStaffToken, {});
    fails(r, 'hr_staff should be denied Finance NIS list');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('NIS Profile › Finance Verify (happy path)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager can verify a NIS profile', async () => {
    const r = await api('finance/payroll/nis/verify', finMgrToken, {
      id:               ctx.profile1Id,
      verificationNote: 'Verified against NIBTT records.',
    });
    ok(r, `verify failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.nisStatus === 'verified', `nisStatus should be verified, got: ${d.nisStatus}`);
    expect(d.verifiedBy === finMgrId, 'verifiedBy mismatch');
    expect(d.verifiedAt !== null, 'verifiedAt should be set');
    expect(d.verificationNote === 'Verified against NIBTT records.', 'verificationNote mismatch');
  });

  await test('attempting to verify an already-verified profile is rejected', async () => {
    const r = await api('finance/payroll/nis/verify', finMgrToken, { id: ctx.profile1Id });
    fails(r, 're-verifying a verified profile should fail');
  });

  await test('HR cannot capture (update) a verified profile', async () => {
    const r = await api('hr/employee-statutory/capture', hrStaffToken, {
      employeeId: empId,
      nisNumber:  'NIS-NEWNUMBER',
    });
    fails(r, 'HR should not be able to update a verified profile');
  });

  await test('§2 side-effects — app_events written after verify', async () => {
    const ok2 = await waitFor(async () => {
      const { data } = await sb
        .from('app_events')
        .select('id')
        .eq('source_module', 'finance_payroll')
        .eq('source_entity_id', ctx.profile1Id)
        .in('event_type', ['finance.nis.profile.verified', 'finance.nis.profile.submitted'])
        .limit(1);
      return (data?.length ?? 0) > 0;
    });
    expect(ok2, 'app_events not written for NIS verify');
  });

  await test('§2 side-effects — hr_audit_log written after verify', async () => {
    const ok2 = await waitFor(async () => {
      const { data } = await sb
        .from('hr_audit_log')
        .select('id')
        .eq('submodule_key', 'finance_payroll_nis')
        .eq('record_id', ctx.profile1Id)
        .limit(1);
      return (data?.length ?? 0) > 0;
    });
    expect(ok2, 'hr_audit_log not written for NIS verify');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('NIS Profile › HR Role CANNOT Verify');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('setup second employee profile for reject test', async () => {
    const r = await api('hr/employee-statutory/capture', hrMgrToken, {
      employeeId:    emp2Id,
      nisNumber:     'NIS-REJECT-TEST',
      nisApplicable: true,
    });
    ok(r, `capture failed: ${r.body.message}`);
    ctx.profile2Id = r.body.data.id;
  });

  await test('hr_staff is DENIED the verify endpoint (no finance.payroll.nis.verify)', async () => {
    const r = await api('finance/payroll/nis/verify', hrStaffToken, {
      id: ctx.profile2Id,
      verificationNote: 'HR trying to verify — should fail',
    });
    fails(r, 'hr_staff must be denied finance/payroll/nis/verify');
    // Confirm the profile was NOT modified
    const { data } = await sb
      .from('hr_employee_statutory_profiles')
      .select('nis_status')
      .eq('id', ctx.profile2Id)
      .single();
    expect(data?.nis_status !== 'verified', 'profile was illegitimately verified by HR');
  });

  await test('hr_manager is DENIED the verify endpoint (no finance.payroll.nis.verify)', async () => {
    const r = await api('finance/payroll/nis/verify', hrMgrToken, { id: ctx.profile2Id });
    fails(r, 'hr_manager must be denied finance/payroll/nis/verify');
  });

  await test('finance_staff is DENIED the verify endpoint (view-only)', async () => {
    const r = await api('finance/payroll/nis/verify', finStaffToken, { id: ctx.profile2Id });
    fails(r, 'finance_staff must be denied finance/payroll/nis/verify (view only)');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('NIS Profile › Finance Reject');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager can reject a profile (nis_status → not_available)', async () => {
    const r = await api('finance/payroll/nis/reject', finMgrToken, {
      id:     ctx.profile2Id,
      reason: 'NIS number could not be confirmed with NIBTT. Please correct and resubmit.',
    });
    ok(r, `reject failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.nisStatus === 'not_available', `expected not_available, got: ${d.nisStatus}`);
    expect(d.verificationNote.includes('NIBTT'), 'verificationNote mismatch');
  });

  await test('hr_staff is DENIED the reject endpoint', async () => {
    const r = await api('finance/payroll/nis/reject', hrStaffToken, {
      id:     ctx.profile2Id,
      reason: 'HR trying to reject',
    });
    fails(r, 'hr_staff must be denied reject');
  });

  await test('§2 side-effects — app_events written after reject', async () => {
    const ok2 = await waitFor(async () => {
      const { data } = await sb
        .from('app_events')
        .select('id')
        .eq('source_module', 'finance_payroll')
        .eq('source_entity_id', ctx.profile2Id)
        .eq('event_type', 'finance.nis.profile.rejected')
        .limit(1);
      return (data?.length ?? 0) > 0;
    });
    expect(ok2, 'app_events not written for NIS reject');
  });

  await test('§2 side-effects — hr_audit_log written after reject', async () => {
    const ok2 = await waitFor(async () => {
      const { data } = await sb
        .from('hr_audit_log')
        .select('id')
        .eq('submodule_key', 'finance_payroll_nis')
        .eq('record_id', ctx.profile2Id)
        .in('action', ['nis_profile.rejected'])
        .limit(1);
      return (data?.length ?? 0) > 0;
    });
    expect(ok2, 'hr_audit_log not written for NIS reject');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('NIS Profile › Finance NIS List — filters');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager can filter list by nis_status', async () => {
    const r = await api('finance/payroll/nis/list', finMgrToken, { nisStatus: 'verified' });
    ok(r, `filtered list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'data not array');
    const profile = r.body.data.find(p => p.id === ctx.profile1Id);
    expect(!!profile, 'verified profile not in filtered list');
    expect(r.body.data.every(p => p.nisStatus === 'verified'), 'list contains non-verified profiles');
  });

  await test('finance_manager can filter list by employeeId', async () => {
    const r = await api('finance/payroll/nis/list', finMgrToken, { employeeId: empId });
    ok(r, `filtered list by employee failed: ${r.body.message}`);
    expect(r.body.data.every(p => p.employeeId === empId), 'list contains other employees');
  });
}
