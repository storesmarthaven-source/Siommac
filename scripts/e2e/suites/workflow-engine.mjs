// E2E — Central Workflow Engine (seed template+version+binding → start → decide →
// advance → complete + access control + §2 side-effects). Requires the workflow
// migrations (20260704000000/01/02) applied.

export const title = 'Central Workflow Engine';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const T = { admin: mint(admin) };

  // The lifecycle needs a DETERMINISTIC non-elevated actor as the first approver.
  // h.users.b is roster-random and is often a manager (elevated via
  // workflow.instances.reassign) — which would let it decide a role-scoped task it was
  // never assigned, breaking the "non-assignee cannot decide" assertions. Acquire a
  // real `employee` (created only if the roster has none) instead.
  const { actors: [supEmp], createdIds: supCreatedIds } = await h.acquireActors('employee', 1);
  const tSupEmp = mint(supEmp);
  h.onCleanup(async () => { if (supCreatedIds?.length) { try { await sb.from('app_users').delete().in('id', supCreatedIds); } catch {} } });

  const waitFor = async (check, ms = 5000) => {
    const start = Date.now();
    while (Date.now() - start < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 250)); }
    return false;
  };

  const tplKey  = `e2e_wf_${TAG}`;
  const trigger = `ptw.submitted.e2e.${TAG}`;
  const recordId = `PTW-E2E-${TAG}`;

  const DEF = {
    schemaVersion: 1,
    steps: [
      { stepKey: 'supervisor', stepName: 'Supervisor Review', stepType: 'approval', sequenceNo: 1, assignment: { type: 'supervisor' }, required: true,
        decisionRules: { canApprove: true, canReturn: true, canReject: true, canDelegate: false, requireCommentOnApprove: false, requireCommentOnReturn: true, requireCommentOnReject: true, requireAttachment: false } },
      { stepKey: 'hse', stepName: 'HSE Approval', stepType: 'approval', sequenceNo: 2, assignment: { type: 'role', value: 'admin' }, required: true,
        decisionRules: { canApprove: true, canReturn: true, canReject: true, canDelegate: false, requireCommentOnApprove: false, requireCommentOnReturn: true, requireCommentOnReject: true, requireAttachment: false } },
    ],
    transitions: [
      { fromStep: 'supervisor', onDecision: 'approved', toStep: 'hse' },
      { fromStep: 'hse', onDecision: 'approved', completeWorkflow: true },
    ],
    notifications: [], handoffs: [], sourceStatusMap: { onStarted: 'pending_approval', onCompleted: 'approved' },
    settings: { allowReturn: true, allowReject: true, allowDelegate: false, allowAdminOverride: true, requireAuditAllTransitions: true },
  };

  let tplId = null;
  h.onCleanup(async () => {
    try { await sb.from('workflow_audit_log').delete().eq('source_record_id', recordId); } catch {}
    try { await sb.from('workflow_instances').delete().eq('source_record_id', recordId); } catch {}
    try { await sb.from('module_workflow_bindings').delete().eq('trigger_event', trigger); } catch {}
    try { if (tplId) await sb.from('workflow_templates').delete().eq('id', tplId); } catch {}
  });

  // ── Seed template + published version + binding ───────────────────────────────
  h.section('Workflow › Setup');
  await test('seed template + version + binding', async () => {
    const { data: tpl, error: e1 } = await sb.from('workflow_templates').insert({
      name: `E2E WF ${TAG}`, definition: {},
      template_key: tplKey, module_key: 'ptw', workflow_type: 'permit_approval', status: 'active',
    }).select('id').single();
    expect(!e1 && !!tpl, `template insert failed: ${e1?.message}`);
    tplId = tpl.id;
    const { data: ver, error: e2 } = await sb.from('workflow_template_versions').insert({
      template_id: tplId, version_no: 1, version_status: 'published', definition: DEF, published_at: new Date().toISOString(),
    }).select('id').single();
    expect(!e2 && !!ver, `version insert failed: ${e2?.message}`);
    const { error: e3 } = await sb.from('module_workflow_bindings').insert({
      module_key: 'ptw', workflow_type: 'permit_approval', trigger_event: trigger,
      template_id: tplId, template_version_id: ver.id, scope_type: 'global', is_active: true, priority: 100,
    });
    expect(!e3, `binding insert failed: ${e3?.message}`);
  });

  const openTask = async (workflowId) => {
    const r = await api('workflow-engine/get', T.admin, { workflowId });
    return (r.body.data?.tasks ?? []).find(t => ['pending', 'open', 'in_progress'].includes(t.status)) ?? null;
  };

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  h.section('Workflow › Lifecycle');
  let workflowId = null;

  await test('start → instance in_progress + first task assigned to supervisor', async () => {
    const r = await api('workflow-engine/start', T.admin, {
      moduleKey: 'ptw', workflowType: 'permit_approval', triggerEvent: trigger,
      sourceRecordId: recordId, recordData: { supervisorId: supEmp.id },
    });
    ok(r, 'start failed');
    workflowId = r.body.data?.id ?? null;
    expect(!!workflowId, 'no workflow id');
    expect(r.body.data.status === 'in_progress', `expected in_progress, got ${r.body.data.status}`);
    const task = await openTask(workflowId);
    expect(task && task.step_key === 'supervisor', 'first task is not the supervisor step');
    expect(task.assigned_to === supEmp.id, 'supervisor task not assigned to recordData.supervisorId');
  });

  await test('started event + audit written (§2)', async () => {
    const ev = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'workflow.started').eq('source_entity_id', (await sb.from('workflow_instances').select('workflow_no').eq('id', workflowId).single()).data.workflow_no).limit(1);
      return (data?.length ?? 0) > 0;
    });
    expect(ev, 'workflow.started app_event not emitted');
    const { data: audit } = await sb.from('workflow_audit_log').select('action').eq('workflow_id', workflowId).eq('action', 'workflow.started');
    expect((audit?.length ?? 0) > 0, 'workflow.started audit row missing');
  });

  await test('my-tasks shows the supervisor the assigned task', async () => {
    const r = await api('workflow-engine/my-tasks', tSupEmp, {});
    ok(r, 'my-tasks failed');
    expect(r.body.data.some(t => t.workflow_id === workflowId), 'assignee does not see the task');
  });

  await test('supervisor approves → advances to HSE step', async () => {
    const task = await openTask(workflowId);
    const r = await api('workflow-engine/decide', tSupEmp, { workflowId, taskId: task.id, decision: 'approved', comment: 'ok' });
    ok(r, 'supervisor approve failed');
    const next = await openTask(workflowId);
    expect(next && next.step_key === 'hse', `expected hse step, got ${next?.step_key}`);
    expect(next.assigned_role === 'admin', 'hse task not assigned to role admin');
  });

  await test('ACCESS: employee cannot decide the HSE (role admin) task', async () => {
    const task = await openTask(workflowId);
    const r = await api('workflow-engine/decide', tSupEmp, { workflowId, taskId: task.id, decision: 'approved' });
    fails(r, 'employee should not decide a role:admin task');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('HSE (admin) approves → workflow completed + event', async () => {
    const task = await openTask(workflowId);
    const r = await api('workflow-engine/decide', T.admin, { workflowId, taskId: task.id, decision: 'approved', comment: 'approved' });
    ok(r, 'hse approve failed');
    const { data: wf } = await sb.from('workflow_instances').select('status').eq('id', workflowId).single();
    expect(wf?.status === 'completed', `expected completed, got ${wf?.status}`);
    const { data: dec } = await sb.from('workflow_decisions').select('id').eq('workflow_id', workflowId);
    expect((dec?.length ?? 0) >= 2, 'expected >=2 decision rows');
  });

  // ── Access control — horizontal decision-bypass regression (audit finding #1) ─
  // A non-assigned, non-elevated approver must NOT be able to decide someone else's
  // task via EITHER decision endpoint. The new /workflow-engine/decide guards this at
  // the ROUTE; the legacy /workflows/decision has NO route-level assignment check, so
  // the ONLY thing standing between a `workflow.approve` holder and ANY task is the
  // shared decideTask() authorization guard. Both endpoints are asserted here:
  // 403 + "not assigned" + the decision is NOT applied (task stays pending, zero
  // decision rows). Positive controls prove authz is closing the bypass, not blanket-
  // blocking the routes. Without the shared guard, the legacy-route case would SUCCEED.
  h.section('Workflow › Access — decision bypass');

  const bypassRecordId = `PTW-E2E-BYPASS-${TAG}`;
  let bypass = null;   // { supervisor, intruder, createdIds }
  let bypassWfId = null, bypassTaskId = null, tSup = null, tIntruder = null;

  h.onCleanup(async () => {
    try { await sb.from('workflow_audit_log').delete().eq('source_record_id', bypassRecordId); } catch {}
    try { await sb.from('workflow_instances').delete().eq('source_record_id', bypassRecordId); } catch {}
    if (bypass) {
      try { await sb.from('user_permissions').delete().eq('user_id', bypass.intruder.id).eq('permission', 'workflow.approve'); } catch {}
      if (bypass.createdIds?.length) { try { await sb.from('app_users').delete().in('id', bypass.createdIds); } catch {} }
    }
  });

  await test('setup: intruder holds workflow.approve but is NOT the assignee', async () => {
    const { actors: [supervisor, intruder], createdIds } = await h.acquireActors('employee', 2);
    bypass = { supervisor, intruder, createdIds };
    tSup = mint(supervisor); tIntruder = mint(intruder);
    // Grant the intruder the coarse legacy approve perm via a per-user override so they
    // clear the /workflows/decision permission gate — leaving the assignment guard as the
    // ONLY line of defence (exactly the hole audit finding #1 flagged).
    const { error } = await sb.from('user_permissions').upsert(
      { user_id: intruder.id, permission: 'workflow.approve', granted: true, set_by: TAG },
      { onConflict: 'user_id,permission' },
    );
    expect(!error, `override upsert failed: ${error?.message}`);
    // Fresh workflow whose first task is assigned to the SUPERVISOR (not the intruder).
    const r = await api('workflow-engine/start', T.admin, {
      moduleKey: 'ptw', workflowType: 'permit_approval', triggerEvent: trigger,
      sourceRecordId: bypassRecordId, recordData: { supervisorId: supervisor.id },
    });
    ok(r, 'bypass workflow start failed');
    bypassWfId = r.body.data?.id ?? null;
    expect(!!bypassWfId, 'no bypass workflow id');
    const task = await openTask(bypassWfId);
    expect(task && task.step_key === 'supervisor', 'bypass first task is not the supervisor step');
    expect(task.assigned_to === supervisor.id, 'supervisor task not assigned to the supervisor actor');
    bypassTaskId = task.id;
  });

  await test('DENY (new engine): non-assignee approver → 403 on /workflow-engine/decide', async () => {
    const r = await api('workflow-engine/decide', tIntruder, { workflowId: bypassWfId, taskId: bypassTaskId, decision: 'approved', comment: 'bypass attempt' });
    fails(r, 'intruder decision unexpectedly succeeded (new engine)');
    expect(r.status === 403, `expected 403, got ${r.status}`);
    expect(/not assigned/i.test(r.body.message ?? ''), `expected an assignment-denial message, got: ${r.body.message}`);
  });

  await test('DENY (legacy route): non-assignee approver → 403 on /workflows/decision', async () => {
    const r = await api('workflows/decision', tIntruder, { taskId: bypassTaskId, decision: 'approved', note: 'bypass attempt' });
    fails(r, 'intruder decision unexpectedly succeeded (legacy route) — shared decideTask guard is missing');
    expect(r.status === 403, `expected 403, got ${r.status}`);
    // Pin the 403 to the ASSIGNMENT guard (my fix), not the perm gate ('Forbidden'):
    // the intruder cleared the perm gate via the override, so this must be the authz guard.
    expect(/not assigned/i.test(r.body.message ?? ''), `expected an assignment-denial message, got: ${r.body.message}`);
  });

  await test('bypass attempts left NO trace — task still pending, zero decisions', async () => {
    const task = await openTask(bypassWfId);
    expect(task && task.step_key === 'supervisor' && ['pending','open','in_progress'].includes(task.status),
      `supervisor task no longer pending after denied attempts (got ${task?.step_key}/${task?.status})`);
    const { data: decs } = await sb.from('workflow_decisions').select('id').eq('workflow_id', bypassWfId);
    expect((decs?.length ?? 0) === 0, `expected 0 decisions after denied attempts, found ${decs?.length}`);
    const { data: wf } = await sb.from('workflow_instances').select('status').eq('id', bypassWfId).single();
    expect(wf?.status === 'in_progress', `expected still in_progress, got ${wf?.status}`);
  });

  await test('POSITIVE control: the real assignee CAN decide (new engine)', async () => {
    const r = await api('workflow-engine/decide', tSup, { workflowId: bypassWfId, taskId: bypassTaskId, decision: 'approved', comment: 'ok' });
    ok(r, 'assignee decision failed — authz is over-blocking, not just closing the bypass');
    const next = await openTask(bypassWfId);
    expect(next && next.step_key === 'hse', `expected advance to hse, got ${next?.step_key}`);
  });

  await test('POSITIVE control: legacy route works for an elevated approver', async () => {
    const task = await openTask(bypassWfId);   // hse step, assigned_role admin
    const r = await api('workflows/decision', T.admin, { taskId: task.id, decision: 'approved', note: 'approve via legacy route' });
    ok(r, 'legacy-route decision by an elevated admin failed');
    const { data: wf } = await sb.from('workflow_instances').select('status').eq('id', bypassWfId).single();
    expect(wf?.status === 'completed', `expected completed, got ${wf?.status}`);
  });
}
