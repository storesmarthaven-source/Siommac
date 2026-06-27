/**
 * scripts/e2e/suites/hrOnboarding.mjs
 *
 * E2E for HR Onboarding (v36 §10) + the management module (Phases 2–5), mounted at
 * /api/hr/onboarding/* :
 *   LAUNCH:  preview-package → start → get → task/reassign → task/complete → cancel
 *   PKGS:    packages/list (DB-driven)
 *   MGMT:    reassign-owner / pause / resume / task block-unblock / blocker escalate-
 *            waive-resolve / task/add / ready / complete / audit  + reads (dashboard-
 *            stats / list / tasks/list / handoffs/list / timeline reuse)
 *   CUSTOM:  actions/templates create-list-update-retire + actions/case add (from
 *            template + one-off document_request) / list / complete / cancel
 *
 * Covers package instantiation, assignee resolution, auto-completion, the case state
 * machine + blocker lifecycle, custom-action instantiation into the REAL lifecycle
 * (task + pending handoff; approval-without-template rejected), access control against
 * REAL roles (employee denied), and §2 side-effects (rows + app_events + hr_audit_log).
 *
 * REQUIRES (operator-applied, in order):
 *   20260709000000_hr_onboarding.sql, 20260710000001, 20260711000002,
 *   20260714000000_hr_onboarding_management.sql, 20260714000001 (perms),
 *   20260714000002 + 20260714000003 (packages + seed),
 *   20260714000004 + 20260714000005 (custom actions + perms)   then NOTIFY pgrst.
 */

export const title = 'HR Onboarding';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ctx = { caseId: null, cancelCaseId: null, mCaseId: null, cCaseId: null, templateId: null, tplName: `${TAG}-ca-tpl`, empId: null, empTok: null, mgrTok: null, taskIds: [], mTaskIds: [] };

  h.onCleanup(async () => {
    const caseIds = [ctx.caseId, ctx.cancelCaseId, ctx.mCaseId, ctx.cCaseId].filter(Boolean);
    for (const id of caseIds) {
      await sb.from('app_events').delete().eq('source_entity_id', id);
      await sb.from('hr_audit_log').delete().eq('record_id', id);
    }
    if (caseIds.length) await sb.from('hr_onboarding_cases').delete().in('id', caseIds);   // cascades tasks + handoffs + case_actions
    // Custom-action template lives on a seeded package → remove it + its events/audit.
    if (ctx.templateId) {
      await sb.from('app_events').delete().eq('source_entity_id', ctx.templateId);
      await sb.from('hr_audit_log').delete().eq('record_id', ctx.templateId);
      await sb.from('app_events').delete().eq('event_type', 'onboarding.custom_action_template.created').eq('payload->>actionName', ctx.tplName);
      await sb.from('hr_onboarding_action_templates').delete().eq('id', ctx.templateId);
    }
    if (ctx.empId) { try { await sb.from('module_mutation_runs').delete().ilike('idempotency_key', `hr.onboarding.start:${ctx.empId}%`); } catch { /* optional */ } }
    // Remove the global setting overrides this suite set (revert to catalog defaults).
    for (const k of (ctx.settingKeys ?? [])) {
      try { await sb.from('app_setting_values').delete().eq('setting_key', k).eq('scope_type', 'global').is('scope_id', null); } catch { /* optional */ }
    }
  });

  // Real identities: a target employee (also the low-priv token) + a manager.
  {
    const { data: emp } = await sb.from('app_users').select('id, username, role, department_id').eq('role', 'employee').eq('status', 'active').limit(1).maybeSingle();
    if (emp) { ctx.empId = emp.id; ctx.empTok = mint(emp); }
    const { data: mgr } = await sb.from('app_users').select('id, username, role, department_id').eq('role', 'manager').eq('status', 'active').neq('id', admin.id).limit(1).maybeSingle();
    if (mgr) ctx.mgrTok = mint(mgr);
  }

  // ── Phase 7 settings: publish the onboarding catalog, then pin the gates +
  // require-owner OFF globally so the lifecycle tests below are deterministic
  // regardless of the catalog defaults (which are ON). 7b flips them on/off to prove
  // the wiring; cleanup deletes these overrides. ───────────────────────────────────
  ctx.settingKeys = [
    'hr_onboarding.block_activation_until_documents_complete',
    'hr_onboarding.block_activation_until_training_complete',
    'hr_onboarding.block_activation_until_hse_complete',
    'hr_onboarding.block_activation_until_payroll_complete',
    'hr_onboarding.require_owner_on_start',
  ];
  await test('settings: catalog sync + pin gates/owner off (setup)', async () => {
    ok(await api('settings/catalog/sync', A, {}), 'catalog sync');
    for (const k of ctx.settingKeys) {
      ok(await api('settings/values/set', A, { settingKey: k, scopeType: 'global', scopeId: null, value: false }), `pin ${k}=false`);
    }
  });

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

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 4 — packages/list (DB-driven picker)
  // ════════════════════════════════════════════════════════════════════════════
  await test('packages/list → seeded packages with derived owners', async () => {
    const r = await api('hr/onboarding/packages/list', A, {});
    ok(r, 'packages/list');
    const keys = (r.body.data ?? []).map(p => p.key);
    expect(keys.includes('standard_employee') && keys.includes('contractor_worker'), 'seeded packages present');
    const std = r.body.data.find(p => p.key === 'standard_employee');
    expect(std && std.taskCount > 0 && typeof std.owners === 'string', 'package summary has taskCount + owners');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 3 — management case lifecycle (dedicated case M, package supervisor_manager)
  // ════════════════════════════════════════════════════════════════════════════
  await test('start case M (admin) → for management-write tests', async () => {
    const r = await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'supervisor_manager' });
    ok(r, 'start M');
    ctx.mCaseId = r.body.data.caseId;
    const g = await api('hr/onboarding/get', A, { caseId: ctx.mCaseId });
    ctx.mTaskIds = (g.body.data.tasks ?? []).map(t => t.id);
    expect(ctx.mTaskIds.length >= 3, 'case M has tasks');
  });

  await test('reassign-owner (admin) → owner changed + event', async () => {
    const r = await api('hr/onboarding/reassign-owner', A, { caseId: ctx.mCaseId, ownerId: ctx.empId });
    ok(r, 'reassign-owner');
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.case.owner_changed').eq('source_entity_id', ctx.mCaseId).limit(1);
    expect(ev && ev.length >= 1, 'owner_changed event');
  });

  await test('pause → resume (admin)', async () => {
    const p = await api('hr/onboarding/pause', A, { caseId: ctx.mCaseId, reason: 'e2e pause' });
    ok(p, 'pause'); expect(p.body.data.status === 'paused', 'paused');
    const r = await api('hr/onboarding/resume', A, { caseId: ctx.mCaseId });
    ok(r, 'resume'); expect(r.body.data.status === 'in_progress', 'resumed to in_progress');
  });

  await test('task/block → blocker row created + case blocked', async () => {
    const r = await api('hr/onboarding/task/block', A, { taskId: ctx.mTaskIds[0], reason: 'e2e block', severity: 'high' });
    ok(r, 'block');
    const { data: tk } = await sb.from('hr_onboarding_tasks').select('status').eq('id', ctx.mTaskIds[0]).maybeSingle();
    expect(tk && tk.status === 'blocked', 'task blocked');
    const { data: bl } = await sb.from('hr_onboarding_blockers').select('id, status').eq('task_id', ctx.mTaskIds[0]).eq('status', 'active');
    expect((bl ?? []).length === 1, 'one active blocker for task');
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status').eq('id', ctx.mCaseId).maybeSingle();
    expect(kase && kase.status === 'blocked', 'case recomputed to blocked');
  });

  await test('blockers/list → surfaces the blocker', async () => {
    const r = await api('hr/onboarding/blockers/list', A, { caseId: ctx.mCaseId });
    ok(r, 'blockers/list');
    expect(r.body.data.some(b => b.taskId === ctx.mTaskIds[0] && b.status === 'active'), 'blocker listed');
  });

  await test('task/unblock → task pending + blocker resolved + case in_progress', async () => {
    const r = await api('hr/onboarding/task/unblock', A, { taskId: ctx.mTaskIds[0] });
    ok(r, 'unblock');
    const { data: bl } = await sb.from('hr_onboarding_blockers').select('status').eq('task_id', ctx.mTaskIds[0]);
    expect((bl ?? []).every(b => b.status === 'resolved'), 'blocker resolved');
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status').eq('id', ctx.mCaseId).maybeSingle();
    expect(kase && kase.status === 'in_progress', 'case back to in_progress');
  });

  await test('blocker escalate → waive (admin) unblocks linked task', async () => {
    await api('hr/onboarding/task/block', A, { taskId: ctx.mTaskIds[1], reason: 'e2e block 2' });
    const list = await api('hr/onboarding/blockers/list', A, { caseId: ctx.mCaseId });
    const b = list.body.data.find(x => x.taskId === ctx.mTaskIds[1] && x.status === 'active');
    expect(!!b, 'active blocker found');
    const esc = await api('hr/onboarding/blocker/escalate', A, { blockerId: b.blockerId, note: 'e2e escalate' });
    ok(esc, 'escalate'); expect(esc.body.data.status === 'escalated', 'escalated');
    const wv = await api('hr/onboarding/blocker/waive', A, { blockerId: b.blockerId, reason: 'e2e waiver' });
    ok(wv, 'waive'); expect(wv.body.data.status === 'waived', 'waived');
    const { data: tk } = await sb.from('hr_onboarding_tasks').select('status').eq('id', ctx.mTaskIds[1]).maybeSingle();
    expect(tk && tk.status === 'pending', 'waived blocker unblocked the task');
  });

  await test('blocker/waive without reason → fails', async () => {
    await api('hr/onboarding/task/block', A, { taskId: ctx.mTaskIds[2], reason: 'e2e block 3' });
    const list = await api('hr/onboarding/blockers/list', A, { caseId: ctx.mCaseId });
    const b = list.body.data.find(x => x.taskId === ctx.mTaskIds[2] && x.status === 'active');
    const r = await api('hr/onboarding/blocker/waive', A, { blockerId: b.blockerId, reason: '' });
    fails(r, 'waiver requires a reason');
    await api('hr/onboarding/blocker/resolve', A, { blockerId: b.blockerId, note: 'cleanup' });   // clear for ready test
  });

  await test('task/add (admin) → blocking task + case re-blocked', async () => {
    const r = await api('hr/onboarding/task/add', A, { caseId: ctx.mCaseId, taskTitle: `${TAG} extra gate`, ownerRole: 'hr', isBlocking: true });
    ok(r, 'task/add'); ctx.addedTaskId = r.body.data.taskId;
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.task.added').eq('source_entity_id', ctx.mCaseId).limit(1);
    expect(ev && ev.length >= 1, 'task.added event');
    const { data: kase } = await sb.from('hr_onboarding_cases').select('status').eq('id', ctx.mCaseId).maybeSingle();
    expect(kase && kase.status === 'blocked', 'open blocking task → case blocked');
  });

  await test('ready while a blocking task is open → fails', async () => {
    const r = await api('hr/onboarding/ready', A, { caseId: ctx.mCaseId });
    fails(r, 'cannot mark ready with blocking work open');
  });

  await test('ready after clearing blocking work → ready_for_activation', async () => {
    await api('hr/onboarding/task/complete', A, { taskId: ctx.addedTaskId });   // clear the blocking task
    const r = await api('hr/onboarding/ready', A, { caseId: ctx.mCaseId });
    ok(r, 'ready'); expect(r.body.data.status === 'ready_for_activation', 'ready_for_activation');
  });

  await test('complete case while open tasks remain → fails', async () => {
    const r = await api('hr/onboarding/complete', A, { caseId: ctx.mCaseId });
    fails(r, 'complete blocked by open tasks');
  });

  await test('audit (admin) → case audit trail populated', async () => {
    const r = await api('hr/onboarding/audit', A, { caseId: ctx.mCaseId });
    ok(r, 'audit');
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'audit rows');
    expect(r.body.data.every(a => !!a.action && !!a.createdAt), 'audit shape');
  });

  // access control — management writes
  await test('task/block unauthorized (employee) → denied', async () => {
    fails(await api('hr/onboarding/task/block', ctx.empTok, { taskId: ctx.mTaskIds[0] }), 'employee cannot block');
  });
  await test('pause unauthorized (employee) → denied', async () => {
    fails(await api('hr/onboarding/pause', ctx.empTok, { caseId: ctx.mCaseId }), 'employee cannot pause');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 2 — management reads
  // ════════════════════════════════════════════════════════════════════════════
  await test('dashboard-stats (admin) → KPI shape', async () => {
    const r = await api('hr/onboarding/dashboard-stats', A, {});
    ok(r, 'dashboard-stats');
    const d = r.body.data;
    expect(d.activeCases && typeof d.activeCases.total === 'number', 'activeCases.total');
    expect(d.blockingTasks && d.dueThisWeek && d.activationReadiness, 'all KPI groups present');
  });

  await test('list (admin) → case M present with computed fields', async () => {
    const r = await api('hr/onboarding/list', A, { statuses: ['ready_for_activation', 'in_progress', 'blocked'] });
    ok(r, 'list');
    const row = (r.body.data.rows ?? []).find(x => x.caseId === ctx.mCaseId);
    expect(!!row, 'case M in list');
    expect(typeof row.progressPercent === 'number' && typeof row.openTasks === 'number', 'computed fields');
  });

  await test('tasks/list (caseId M) → tasks for the case', async () => {
    const r = await api('hr/onboarding/tasks/list', A, { caseId: ctx.mCaseId });
    ok(r, 'tasks/list');
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'tasks returned');
  });

  await test('timeline reuse (orchestration) gated to hr.onboarding.view', async () => {
    const r = await api('orchestration/timeline/get', A, { module: 'hr', recordType: 'onboarding_case', recordId: ctx.mCaseId });
    ok(r, 'timeline');
    expect(Array.isArray(r.body.data), 'timeline items array');
    const denied = await api('orchestration/timeline/get', ctx.empTok, { module: 'hr', recordType: 'onboarding_case', recordId: ctx.mCaseId });
    fails(denied, 'employee cannot view onboarding timeline');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 5 — Custom Onboarding Actions (dedicated case C, package standard_employee)
  // ════════════════════════════════════════════════════════════════════════════
  await test('start case C (admin) → for custom-action tests', async () => {
    const r = await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'standard_employee' });
    ok(r, 'start C'); ctx.cCaseId = r.body.data.caseId;
  });

  await test('actions/templates/create (admin) → package custom-action template', async () => {
    const r = await api('hr/onboarding/actions/templates/create', A, { packageKey: 'office_admin', actionName: ctx.tplName, actionType: 'custom_task', instructions: 'tagged e2e template' });
    ok(r, 'template create'); ctx.templateId = r.body.data.templateId;
    const list = await api('hr/onboarding/actions/templates/list', A, { packageKey: 'office_admin' });
    expect(list.body.data.some(t => t.id === ctx.templateId), 'template listed');
  });

  await test('actions/case/add from template → instantiates a real task', async () => {
    const r = await api('hr/onboarding/actions/case/add', A, { caseId: ctx.cCaseId, sourceTemplateId: ctx.templateId });
    ok(r, 'case add from template');
    expect(!!r.body.data.linkedTaskId, 'task created'); ctx.caTaskActionId = r.body.data.caseActionId; ctx.caTaskId = r.body.data.linkedTaskId;
    const { data: ev } = await sb.from('app_events').select('id').eq('event_type', 'onboarding.custom_action.instantiated').eq('source_entity_id', ctx.cCaseId).limit(1);
    expect(ev && ev.length >= 1, 'instantiated event');
  });

  await test('actions/case/add one-off document_request → task + pending handoff', async () => {
    const r = await api('hr/onboarding/actions/case/add', A, { caseId: ctx.cCaseId, actionName: `${TAG} doc`, actionType: 'custom_document_request', requiresEvidence: true });
    ok(r, 'doc request'); ctx.caDocActionId = r.body.data.caseActionId; ctx.caDocHandoffId = r.body.data.linkedHandoffId;
    expect(!!r.body.data.linkedTaskId && !!r.body.data.linkedHandoffId, 'task + handoff created');
    const { data: ho } = await sb.from('hr_onboarding_handoffs').select('target_module, status').eq('id', ctx.caDocHandoffId).maybeSingle();
    expect(ho && ho.target_module === 'documents' && ho.status === 'pending', 'pending documents handoff (not faked)');
  });

  await test('actions/case/add custom_approval without workflow template → fails', async () => {
    const r = await api('hr/onboarding/actions/case/add', A, { caseId: ctx.cCaseId, actionName: `${TAG} appr`, actionType: 'custom_approval' });
    fails(r, 'approval needs a workflow template');
  });

  await test('actions/case/list → lists the case actions', async () => {
    const r = await api('hr/onboarding/actions/case/list', A, { caseId: ctx.cCaseId });
    ok(r, 'case action list');
    expect(r.body.data.length >= 2, 'two case actions');
  });

  await test('actions/case/complete → completes action + linked task', async () => {
    const r = await api('hr/onboarding/actions/case/complete', A, { id: ctx.caTaskActionId });
    ok(r, 'complete'); expect(r.body.data.status === 'completed', 'action completed');
    const { data: tk } = await sb.from('hr_onboarding_tasks').select('status').eq('id', ctx.caTaskId).maybeSingle();
    expect(tk && tk.status === 'completed', 'linked task completed');
  });

  await test('actions/case/cancel → cancels action + linked handoff', async () => {
    const r = await api('hr/onboarding/actions/case/cancel', A, { id: ctx.caDocActionId, reason: 'e2e' });
    ok(r, 'cancel'); expect(r.body.data.status === 'cancelled', 'action cancelled');
    const { data: ho } = await sb.from('hr_onboarding_handoffs').select('status').eq('id', ctx.caDocHandoffId).maybeSingle();
    expect(ho && ho.status === 'cancelled', 'linked handoff cancelled');
  });

  await test('handoffs/list (caseId C) → includes the custom handoff', async () => {
    const r = await api('hr/onboarding/handoffs/list', A, { caseId: ctx.cCaseId });
    ok(r, 'handoffs/list');
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'handoffs returned');
  });

  await test('actions/templates update → retire (admin)', async () => {
    ok(await api('hr/onboarding/actions/templates/update', A, { id: ctx.templateId, displayOrder: 5 }), 'update');
    ok(await api('hr/onboarding/actions/templates/retire', A, { id: ctx.templateId }), 'retire');
    const active = await api('hr/onboarding/actions/templates/list', A, { packageKey: 'office_admin' });
    expect(!active.body.data.some(t => t.id === ctx.templateId), 'retired template hidden by default');
    const all = await api('hr/onboarding/actions/templates/list', A, { packageKey: 'office_admin', includeInactive: true });
    expect(all.body.data.some(t => t.id === ctx.templateId), 'retired template shown with includeInactive');
  });

  // access control — custom actions
  await test('actions/templates/create unauthorized (employee) → denied', async () => {
    fails(await api('hr/onboarding/actions/templates/create', ctx.empTok, { packageKey: 'office_admin', actionName: 'x', actionType: 'custom_task' }), 'employee cannot create template');
  });
  await test('actions/case/add unauthorized (employee) → denied', async () => {
    fails(await api('hr/onboarding/actions/case/add', ctx.empTok, { caseId: ctx.cCaseId, actionName: 'x', actionType: 'custom_task' }), 'employee cannot add case action');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 7b — settings-gated behaviour (drives real settings, then reverts)
  // ════════════════════════════════════════════════════════════════════════════
  await test('activation gate (documents) blocks ready — 7b', async () => {
    ok(await api('settings/values/set', A, { settingKey: 'hr_onboarding.block_activation_until_documents_complete', scopeType: 'global', scopeId: null, value: true }), 'documents gate on');
    fails(await api('hr/onboarding/ready', A, { caseId: ctx.cCaseId }), 'ready blocked while documents incomplete');
    ok(await api('settings/values/set', A, { settingKey: 'hr_onboarding.block_activation_until_documents_complete', scopeType: 'global', scopeId: null, value: false }), 'documents gate off');
  });

  await test('require_owner_on_start blocks an ownerless start — 7b', async () => {
    ok(await api('settings/values/set', A, { settingKey: 'hr_onboarding.require_owner_on_start', scopeType: 'global', scopeId: null, value: true }), 'require owner on');
    fails(await api('hr/onboarding/start', A, { employeeId: ctx.empId, packageKey: 'safety_critical_employee' }), 'ownerless start blocked');
    ok(await api('settings/values/set', A, { settingKey: 'hr_onboarding.require_owner_on_start', scopeType: 'global', scopeId: null, value: false }), 'require owner off');
  });
}
