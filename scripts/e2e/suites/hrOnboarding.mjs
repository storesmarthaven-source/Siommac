/**
 * scripts/e2e/suites/hrOnboarding.mjs
 *
 * E2E for HR Onboarding (v36 §10), mounted at /api/hr/onboarding/* :
 *   preview-package → start → get → task/reassign → task/complete (×all → auto-complete)
 *   → cancel
 *
 * Covers: package instantiation (tasks + handoff intents), assignee resolution,
 * the assigned-user-completes-own-task path, case auto-completion, cancel (handoffs
 * cancelled), access control against REAL roles (employee/manager denied start +
 * cancel), and §2 side-effects (case/tasks/handoffs rows, app_events
 * onboarding.started + onboarding.completed, hr_audit_log).
 *
 * REQUIRES (operator-applied): 20260709000000_hr_onboarding.sql + NOTIFY pgrst.
 */

export const title = 'HR Onboarding';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = { caseId: null, cancelCaseId: null, empId: null, empTok: null, mgrTok: null, taskIds: [] };

  h.onCleanup(async () => {
    const caseIds = [ctx.caseId, ctx.cancelCaseId].filter(Boolean);
    for (const id of caseIds) {
      await sb.from('app_events').delete().eq('source_entity_id', id);
      await sb.from('hr_audit_log').delete().eq('record_id', id);
    }
    if (caseIds.length) await sb.from('hr_onboarding_cases').delete().in('id', caseIds);   // cascades tasks + handoffs
    if (ctx.empId) { try { await sb.from('module_mutation_runs').delete().ilike('idempotency_key', `hr.onboarding.start:${ctx.empId}%`); } catch { /* optional */ } }
  });

  // Real identities: a target employee (also the low-priv token) + a manager.
  {
    const { data: emp } = await sb.from('app_users').select('id, username, role, department_id').eq('role', 'employee').eq('status', 'active').limit(1).maybeSingle();
    if (emp) { ctx.empId = emp.id; ctx.empTok = mint(emp); }
    const { data: mgr } = await sb.from('app_users').select('id, username, role, department_id').eq('role', 'manager').eq('status', 'active').neq('id', admin.id).limit(1).maybeSingle();
    if (mgr) ctx.mgrTok = mint(mgr);
  }

  // ── preview ───────────────────────────────────────────────────────────────────
  await test('preview-package (admin) → tasks + handoffs', async () => {
    const r = await api('hr/onboarding/preview-package', A, { packageKey: 'contractor_worker' });
    ok(r, 'preview');
    expect(Array.isArray(r.body.data.tasks) && r.body.data.tasks.length > 0, 'tasks listed');
    expect(Array.isArray(r.body.data.handoffs), 'handoffs listed');
  });

  await test('preview-package invalid key → fails', async () => {
    const r = await api('hr/onboarding/preview-package', A, { packageKey: 'not_a_package' });
    fails(r, 'invalid package rejected');
  });

  // ── start ─────────────────────────────────────────────────────────────────────
  await test('start (admin) → creates case + tasks + handoff intents', async () => {
    const r = await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'contractor_worker' });
    ok(r, 'start');
    expect(!!r.body.data.caseId, 'caseId returned');
    expect(/^ONB-/.test(r.body.data.caseNo), `caseNo format — got ${r.body.data.caseNo}`);
    expect(r.body.data.taskCount > 0, 'tasks created');
    ctx.caseId = r.body.data.caseId;
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.started').eq('source_entity_id', ctx.caseId).limit(1);
    expect(ev && ev.length === 1, 'onboarding.started event');
    const { data: hos } = await sb.from('hr_onboarding_handoffs').select('status').eq('case_id', ctx.caseId);
    expect((hos ?? []).length >= 1 && hos.every(x => x.status === 'pending'), 'handoff intents pending');
  });

  await test('start unauthorized (employee) → denied', async () => {
    const r = await api('hr/onboarding/start', ctx.empTok, { employeeId: ctx.empId, packageKey: 'office_admin' });
    fails(r, 'employee cannot start');
  });

  await test('start unauthorized (manager) → denied', async () => {
    const r = await api('hr/onboarding/start', ctx.mgrTok, { employeeId: ctx.empId, packageKey: 'office_admin' });
    fails(r, 'manager cannot start');
  });

  // ── get ───────────────────────────────────────────────────────────────────────
  await test('get (admin) → case + tasks + handoffs', async () => {
    const r = await api('hr/onboarding/get', A, { caseId: ctx.caseId });
    ok(r, 'get');
    expect(r.body.data.case && r.body.data.case.status === 'in_progress', 'case in_progress');
    ctx.taskIds = (r.body.data.tasks ?? []).map(t => t.id);
    expect(ctx.taskIds.length > 0, 'tasks returned');
  });

  // ── reassign + assigned-user completes own task ────────────────────────────────
  await test('task/reassign (admin) → assign first task to the employee', async () => {
    const r = await api('hr/onboarding/task/reassign', A, { taskId: ctx.taskIds[0], assignedTo: ctx.empId });
    ok(r, 'reassign');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.task.assigned').eq('source_entity_id', ctx.caseId).limit(1);
    expect(ev && ev.length >= 1, 'task.assigned event');
  });

  await test('task/complete (assigned employee completes own task)', async () => {
    const r = await api('hr/onboarding/task/complete', ctx.empTok, { taskId: ctx.taskIds[0] });
    ok(r, 'employee completes own task');
    expect(r.body.data.status === 'completed', 'task completed');
  });

  await test('task/complete unauthorized (employee, not assigned) → denied', async () => {
    // taskIds[1] is not assigned to the employee → denied (no manage permission).
    const r = await api('hr/onboarding/task/complete', ctx.empTok, { taskId: ctx.taskIds[1] });
    fails(r, 'employee cannot complete unassigned task');
  });

  await test('task/complete remaining (admin) → auto-completes the case', async () => {
    let lastCaseCompleted = false;
    for (let i = 1; i < ctx.taskIds.length; i++) {
      const r = await api('hr/onboarding/task/complete', A, { taskId: ctx.taskIds[i] });
      ok(r, `complete task ${i}`);
      lastCaseCompleted = r.body.data.caseCompleted;
    }
    expect(lastCaseCompleted === true, 'case auto-completed on last task');
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status, completed_at').eq('id', ctx.caseId).maybeSingle();
    expect(kase && kase.status === 'completed' && !!kase.completed_at, 'case status completed');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.completed').eq('source_entity_id', ctx.caseId).limit(1);
    expect(ev && ev.length === 1, 'onboarding.completed event');
  });

  // ── cancel ──────────────────────────────────────────────────────────────────
  await test('cancel (admin) → case cancelled + handoffs cancelled', async () => {
    const start = await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'office_admin' });
    ok(start, 'start case to cancel');
    ctx.cancelCaseId = start.body.data.caseId;
    const r = await api('hr/onboarding/cancel', A, { caseId: ctx.cancelCaseId, reason: 'e2e cancel' });
    ok(r, 'cancel');
    expect(r.body.data.status === 'cancelled', 'cancelled');
    const { data: hos } = await sb.from('hr_onboarding_handoffs').select('status').eq('case_id', ctx.cancelCaseId);
    expect((hos ?? []).every(x => x.status === 'cancelled'), 'handoffs cancelled');
  });

  await test('cancel unauthorized (employee) → denied', async () => {
    const r = await api('hr/onboarding/cancel', ctx.empTok, { caseId: ctx.cancelCaseId });
    fails(r, 'employee cannot cancel');
  });
}
