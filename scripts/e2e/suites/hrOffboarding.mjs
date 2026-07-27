/**
 * scripts/e2e/suites/hrOffboarding.mjs
 *
 * E2E for HR Offboarding. Backend routes in hrOffboarding.ts (/api/hr/offboarding):
 *   start · list · get · dashboard-stats · task/complete · pause · resume ·
 *   mark-ready · reassign-owner · complete · cancel · finalize
 *
 * Covers: start-from-plan (tasks + handoffs) · task complete · the full lifecycle
 * incl. FINALIZE → employee status terminated → auth disabled (asserted via the
 * service-role sb client) + IT access-removal handoff present · access control
 * (employee denied start; hr_staff allowed) · §2 side-effects (app_events +
 * hr_audit_log, polled). Requires migration 20260717000000 applied + NOTIFY pgrst.
 */

export const title = 'HR — Offboarding';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const empId   = `OFB-EMP-${TAG}`;
  const staffId = `OFB-STAFF-${TAG}`;
  const ctx = { caseId: null, staffT: null };

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { if (ctx.caseId) await sb.from('hr_offboarding_cases').delete().eq('id', ctx.caseId); } catch {}
    try { await sb.from('hr_offboarding_cases').delete().eq('employee_id', empId); } catch {}
    try { await sb.from('hr_employee_status_history').delete().eq('employee_id', empId); } catch {}
    // Events are emitted against BOTH the employee id and the CASE id — clean both
    // (the suite's own assertions read the case-id events; deleting only by empId leaked them).
    try { await sb.from('app_events').delete().eq('source_module', 'hr').eq('source_entity_id', empId); } catch {}
    try { if (ctx.caseId) await sb.from('app_events').delete().eq('source_entity_id', ctx.caseId); } catch {}
    try { if (ctx.caseId) await sb.from('hr_audit_log').delete().eq('record_id', ctx.caseId); } catch {}
    try { await sb.from('app_users').delete().in('id', [empId, staffId]); } catch {}
  });

  // ── Setup ──────────────────────────────────────────────────────────────────
  h.section('Offboarding › Setup');

  await test('provision an active employee + hr_staff user', async () => {
    const { error: e1 } = await sb.from('app_users').insert({ id: empId, username: `${TAG}_ofb_emp`, full_name: 'Offboarding E2E Tester', role: 'employee', status: 'active', employment_type: 'employee' });
    expect(!e1, `seed employee failed: ${e1?.message}`);
    const { error: e2 } = await sb.from('app_users').insert({ id: staffId, username: `${TAG}_ofb_staff`, full_name: 'Offboarding E2E Staff', role: 'hr_staff', status: 'active', employment_type: 'employee' });
    expect(!e2, `seed hr_staff failed: ${e2?.message}`);
    ctx.staffT = mint({ id: staffId, username: `${TAG}_ofb_staff`, role: 'hr_staff', department_id: null });
  });

  // ── Start ──────────────────────────────────────────────────────────────────
  h.section('Offboarding › Start');

  await test('start → case + tasks + handoffs (OFB case_no)', async () => {
    const r = await api('hr/offboarding/start', A, { employeeId: empId, reason: 'resignation', lastWorkingDay: '2026-08-31' });
    ok(r, `start failed: ${r.body.message}`);
    expect(/^OFB-/.test(r.body.data.caseNo), `expected OFB case_no, got ${r.body.data.caseNo}`);
    expect(r.body.data.taskCount > 0, 'no tasks created');
    expect(r.body.data.handoffCount > 0, 'no handoffs created');
    ctx.caseId = r.body.data.caseId;
  });

  await test('side-effects: offboarding.started event + hr_audit_log', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('source_module', 'hr').eq('event_type', 'offboarding.started').eq('source_entity_id', ctx.caseId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'offboarding.started app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id').eq('submodule_key', 'offboarding').eq('action', 'hr.offboarding.started').eq('record_id', ctx.caseId).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log for offboarding.started not found');
  });

  await test('get returns case + tasks + handoffs', async () => {
    const r = await api('hr/offboarding/get', A, { caseId: ctx.caseId });
    ok(r, 'get failed');
    expect(r.body.data.case.caseNo?.startsWith('OFB-'), 'wrong case');
    expect(Array.isArray(r.body.data.tasks) && r.body.data.tasks.length > 0, 'tasks missing');
    expect(r.body.data.handoffs.some(x => x.handoffKey === 'it_access_removal'), 'IT access-removal handoff missing');
  });

  await test('list + dashboard-stats include the case', async () => {
    const l = await api('hr/offboarding/list', A, {});
    ok(l, 'list failed');
    expect(l.body.data.some(x => x.id === ctx.caseId), 'case not in list');
    const employeeList = await api('hr/offboarding/list', A, { employeeId: empId });
    ok(employeeList, 'employee-scoped list failed');
    expect(employeeList.body.data.length > 0, 'employee-scoped list is empty');
    expect(employeeList.body.data.every(x => x.employeeId === empId), 'employee-scoped list leaked another employee');
    const s = await api('hr/offboarding/dashboard-stats', A, {});
    ok(s, 'stats failed');
    const d = s.body.data;
    expect('activeCases' in d && 'byReason' in d, 'stats shape wrong');
    // enriched aggregates the dashboard widgets consume — all real, no faked numbers
    for (const k of ['totalCases', 'byStatus', 'taskClearance', 'blockingTasksOpen', 'openBlockers', 'criticalBlockers', 'handoffs', 'handoffsByModule', 'pendingAccessRemovals', 'avgClearanceDays'])
      expect(k in d, `stats missing enriched field: ${k}`);
    expect(Array.isArray(d.byStatus) && d.byStatus.some(x => x.status === 'in_progress' && x.count >= 1), 'byStatus missing in_progress');
    // our fresh case contributes 7 exit tasks (4 blocking) + it/finance/hse handoffs incl. a pending IT access-removal
    expect(d.taskClearance.total >= 7, `taskClearance.total too low: ${d.taskClearance.total}`);
    expect(d.blockingTasksOpen >= 4, `blockingTasksOpen too low: ${d.blockingTasksOpen}`);
    expect(d.handoffs.pending >= 3 && d.handoffs.total >= 3, 'handoffs aggregate too low');
    expect(d.handoffsByModule.some(m => m.module === 'it'), 'handoffsByModule missing it lane');
    expect(d.pendingAccessRemovals >= 1, 'pendingAccessRemovals should count the fresh IT access-removal handoff');
  });

  // ── Tasks + lifecycle ────────────────────────────────────────────────────────
  h.section('Offboarding › Lifecycle');

  await test('task/complete marks a task completed', async () => {
    const detail = await api('hr/offboarding/get', A, { caseId: ctx.caseId });
    const task = detail.body.data.tasks[0];
    const r = await api('hr/offboarding/task/complete', A, { taskId: task.id });
    ok(r, `task complete failed: ${r.body.message}`);
    const { data } = await sb.from('hr_offboarding_tasks').select('status').eq('id', task.id).maybeSingle();
    expect(data?.status === 'completed', 'task not completed');
  });

  await test('pause → resume → mark-ready transitions', async () => {
    ok(await api('hr/offboarding/pause', A, { caseId: ctx.caseId, reason: 'awaiting clearance' }), 'pause failed');
    ok(await api('hr/offboarding/resume', A, { caseId: ctx.caseId }), 'resume failed');
    const r = await api('hr/offboarding/mark-ready', A, { caseId: ctx.caseId });
    ok(r, 'mark-ready failed');
    const { data } = await sb.from('hr_offboarding_cases').select('status').eq('id', ctx.caseId).maybeSingle();
    expect(data?.status === 'ready_for_exit', `expected ready_for_exit, got ${data?.status}`);
  });

  // ── Finalize (the inverse piece) ──────────────────────────────────────────────
  h.section('Offboarding › Finalize');

  await test('finalize → employee terminated + auth disabled + IT handoff + case completed', async () => {
    const r = await api('hr/offboarding/finalize', A, { caseId: ctx.caseId, exitDate: '2026-08-31' });
    ok(r, `finalize failed: ${r.body.message}`);
    expect(r.body.data.employeeStatus === 'terminated', 'employee not terminated');
    // app_users.status synced to inactive (login disabled)
    const { data: emp } = await sb.from('app_users').select('status').eq('id', empId).maybeSingle();
    expect(emp?.status === 'inactive', `expected app_users.status inactive, got ${emp?.status}`);
    // status history recorded terminated
    const { data: hist } = await sb.from('hr_employee_status_history').select('new_status').eq('employee_id', empId).eq('new_status', 'terminated').limit(1);
    expect((hist ?? []).length > 0, 'terminated status-history row missing');
    // IT access-removal handoff present (pending — never faked-delivered)
    const { data: ho } = await sb.from('hr_offboarding_handoffs').select('status').eq('case_id', ctx.caseId).eq('handoff_key', 'it_access_removal').maybeSingle();
    expect(!!ho, 'IT access-removal handoff missing after finalize');
    // case completed
    const { data: kase } = await sb.from('hr_offboarding_cases').select('status').eq('id', ctx.caseId).maybeSingle();
    expect(kase?.status === 'completed', `expected completed, got ${kase?.status}`);
  });

  await test('finalize side-effects: offboarding.finalized event + employee status audit', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('source_module', 'hr').eq('event_type', 'offboarding.finalized').eq('source_entity_id', ctx.caseId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'offboarding.finalized app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id').eq('employee_id', empId).eq('action', 'hr.employee.status_changed').limit(1);
    expect((audit ?? []).length > 0, 'employee status_changed audit not written by finalize');
  });

  // ── Access control ─────────────────────────────────────────────────────────
  h.section('Offboarding › Access control');

  await test('employee denied start; hr_staff allowed view', async () => {
    fails(await api('hr/offboarding/start', ctx.staffT ? mint({ id: empId, username: `${TAG}_ofb_emp`, role: 'employee', department_id: null }) : null, { employeeId: empId, reason: 'resignation' }), 'employee should not start offboarding');
    ok(await api('hr/offboarding/list', ctx.staffT, {}), 'hr_staff should be allowed to view offboarding');
  });
}
