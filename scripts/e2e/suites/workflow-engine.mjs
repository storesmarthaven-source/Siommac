// E2E — Central Workflow Engine (seed template+version+binding → start → decide →
// advance → complete + access control + §2 side-effects + atomic decide-tx).
// Requires the workflow migrations (20260704000000/01/02) AND the decide-tx
// migrations (20260919000150/160/170/180) applied.

import crypto from 'node:crypto';

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
    // overrideReason: required by the atomic RPC when the harness admin is a
    // superadmin (elevated-not-assigned); ignored when the role matches.
    const r = await api('workflow-engine/decide', T.admin, { workflowId, taskId: task.id, decision: 'approved', comment: 'approved', overrideReason: 'E2E elevated decision' });
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

  await test('DENY (review finding): a manager holding only workflow.instances.reassign cannot decide a non-assigned task', async () => {
    // `reassign` is a ROUTING power (admin/manager hold it to move a task to the right
    // person); it MUST NOT grant authority to DECIDE a task you are not assigned. Only
    // `workflow.instances.admin_override` bypasses assignment. Before the mig-160 fix the
    // manager was treated as elevated and could approve ANY pending workflow (horizontal
    // escalation across payroll/HR/finance). This goes green after the operator re-applies
    // 20260919000160 + NOTIFY pgrst.
    const { actors: [mgr], createdIds } = await h.acquireActors('manager', 1);
    bypass.createdIds.push(...createdIds);
    const tMgr = mint(mgr);
    const r = await api('workflow-engine/decide', tMgr, { workflowId: bypassWfId, taskId: bypassTaskId, decision: 'approved', comment: 'reassign-holder attempt' });
    fails(r, 'a reassign-holding manager must not decide a task assigned to someone else (new engine)');
    expect(r.status === 403, `expected 403, got ${r.status}`);
    expect(/not assigned/i.test(r.body.message ?? ''), `expected assignment denial, got: ${r.body.message}`);
    const r2 = await api('workflows/decision', tMgr, { taskId: bypassTaskId, decision: 'approved', note: 'reassign-holder attempt' });
    fails(r2, 'a reassign-holding manager must be denied on the legacy route too');
    expect(r2.status === 403, `expected 403, got ${r2.status}`);
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
    const r = await api('workflows/decision', T.admin, { taskId: task.id, decision: 'approved', note: 'approve via legacy route', overrideReason: 'E2E elevated decision' });
    ok(r, 'legacy-route decision by an elevated admin failed');
    const { data: wf } = await sb.from('workflow_instances').select('status').eq('id', bypassWfId).single();
    expect(wf?.status === 'completed', `expected completed, got ${wf?.status}`);
  });

  // ── Atomic decisions — transition/outbox/idempotency (finding #2) ─────────────
  // The decide path now commits through workflow_decide_task_tx + a transactional
  // outbox. Assert the machinery end-to-end: §2 rows, semantic idempotency (exact
  // retry = original result, different payload = 409), concurrency (one 200 + one
  // 409), record_only on parallel siblings, terminal sibling-close, lease fencing,
  // dead-letter + gated instance + admin replay.
  h.section('Workflow › Atomic decisions');

  const atomRecord  = `PTW-E2E-ATOM-${TAG}`;
  const concRecord  = `PTW-E2E-CONC-${TAG}`;
  const rejRecord   = `PTW-E2E-REJ-${TAG}`;
  const dlRecord    = `${crypto.randomUUID()}`;   // finance receipt RPC needs a uuid source id
  const parTplKey   = `e2e_wfpar_${TAG}`;
  const parTrigger  = `ptw.par.e2e.${TAG}`;
  const finTplKey   = `e2e_wffin_${TAG}`;
  const finTrigger  = `fin.e2e.${TAG}`;
  let parTplId = null, finTplId = null;

  h.onCleanup(async () => {
    for (const rec of [atomRecord, concRecord, rejRecord, dlRecord]) {
      try {
        const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', rec);
        const ids = (wfs ?? []).map(w => w.id);
        if (ids.length) {
          // active_transition_id → transitions is FK'd; clear the gate before deleting.
          await sb.from('workflow_instances').update({ active_transition_id: null }).in('id', ids);
          await sb.from('workflow_transitions').delete().in('workflow_id', ids);
          await sb.from('workflow_audit_log').delete().in('workflow_id', ids);
          await sb.from('workflow_instances').delete().in('id', ids);
        }
      } catch {}
    }
    try { await sb.from('module_workflow_bindings').delete().in('trigger_event', [parTrigger, finTrigger]); } catch {}
    try { if (parTplId) await sb.from('workflow_templates').delete().eq('id', parTplId); } catch {}
    try { if (finTplId) await sb.from('workflow_templates').delete().eq('id', finTplId); } catch {}
  });

  const seedTemplate = async (key, moduleKey, wfType, trigger, definition) => {
    const { data: tpl, error: e1 } = await sb.from('workflow_templates').insert({
      name: `E2E ${key}`, definition: {}, template_key: key, module_key: moduleKey, workflow_type: wfType, status: 'active',
    }).select('id').single();
    expect(!e1 && !!tpl, `template ${key} insert failed: ${e1?.message}`);
    const { data: ver, error: e2 } = await sb.from('workflow_template_versions').insert({
      template_id: tpl.id, version_no: 1, version_status: 'published', definition, published_at: new Date().toISOString(),
    }).select('id').single();
    expect(!e2 && !!ver, `version ${key} insert failed: ${e2?.message}`);
    const { error: e3 } = await sb.from('module_workflow_bindings').insert({
      module_key: moduleKey, workflow_type: wfType, trigger_event: trigger,
      template_id: tpl.id, template_version_id: ver.id, scope_type: 'global', is_active: true, priority: 100,
    });
    expect(!e3, `binding ${key} insert failed: ${e3?.message}`);
    return tpl.id;
  };

  const startWf = async (trigger, moduleKey, wfType, recordId, recordData) => {
    const r = await api('workflow-engine/start', T.admin, {
      moduleKey, workflowType: wfType, triggerEvent: trigger, sourceRecordId: recordId, recordData,
    });
    ok(r, `start ${recordId} failed`);
    return r.body.data.id;
  };

  let atomWfId = null, atomTaskId = null;

  await test('decide commits transition + outbox + §2 rows atomically', async () => {
    atomWfId = await startWf(trigger, 'ptw', 'permit_approval', atomRecord, { supervisorId: bypass.supervisor.id });
    const task = await openTask(atomWfId);
    atomTaskId = task.id;
    const r = await api('workflow-engine/decide', tSup, { workflowId: atomWfId, taskId: task.id, decision: 'approved', comment: 'atomic ok' });
    ok(r, 'decide failed');
    expect(r.status === 200, `expected 200 (finalized in-request), got ${r.status}`);
    // Transition committed + finalized; instance not gated.
    const { data: tr } = await sb.from('workflow_transitions').select('*').eq('task_id', task.id).single();
    expect(tr && tr.kind === 'resolve_approved_step' && tr.status === 'completed', `transition wrong: ${tr?.kind}/${tr?.status}`);
    const { data: ob } = await sb.from('workflow_outbox').select('status').eq('transition_id', tr.id).single();
    expect(ob?.status === 'completed', `outbox not completed: ${ob?.status}`);
    const { data: wf } = await sb.from('workflow_instances').select('status, current_step_key, active_transition_id').eq('id', atomWfId).single();
    expect(wf.status === 'in_progress' && wf.current_step_key === 'hse' && !wf.active_transition_id,
      `instance wrong after advance: ${wf.status}/${wf.current_step_key}/gated=${!!wf.active_transition_id}`);
    // §2: decision + audit + dedupe-keyed event.
    const { data: decs } = await sb.from('workflow_decisions').select('id').eq('task_id', task.id);
    expect(decs?.length === 1, `expected 1 decision, got ${decs?.length}`);
    const { data: audit } = await sb.from('workflow_audit_log').select('id').eq('workflow_id', atomWfId).eq('action', 'workflow.task.approved');
    expect((audit?.length ?? 0) >= 1, 'decision audit row missing');
    const { data: ev } = await sb.from('app_events').select('id').eq('dedupe_key', `wf.task.approved:${task.id}`);
    expect(ev?.length === 1, `expected 1 dedupe-keyed decision event, got ${ev?.length}`);
  });

  await test('IDEMPOTENCY: exact retry returns success and writes nothing new', async () => {
    const before = await sb.from('workflow_tasks').select('id').eq('workflow_id', atomWfId);
    const r = await api('workflow-engine/decide', tSup, { workflowId: atomWfId, taskId: atomTaskId, decision: 'approved', comment: 'atomic ok' });
    ok(r, 'exact retry should return the original success');
    const { data: decs } = await sb.from('workflow_decisions').select('id').eq('task_id', atomTaskId);
    expect(decs?.length === 1, `retry duplicated the decision: ${decs?.length}`);
    const after = await sb.from('workflow_tasks').select('id').eq('workflow_id', atomWfId);
    expect(after.data?.length === before.data?.length, `retry created tasks: ${before.data?.length} → ${after.data?.length}`);
  });

  await test('IDEMPOTENCY: different payload for a decided task → 409', async () => {
    const r = await api('workflow-engine/decide', tSup, { workflowId: atomWfId, taskId: atomTaskId, decision: 'approved', comment: 'DIFFERENT comment' });
    fails(r, 'different-payload retry should fail');
    expect(r.status === 409, `expected 409, got ${r.status}`);
  });

  await test('CONCURRENCY: two simultaneous decides → one success + one 409, one decision row', async () => {
    // Linear DEF (supervisor → hse); both racers hit the supervisor task.
    const wfId = await startWf(trigger, 'ptw', 'permit_approval', concRecord, { supervisorId: bypass.supervisor.id });
    const task = await openTask(wfId);
    const [r1, r2] = await Promise.all([
      api('workflow-engine/decide', tSup, { workflowId: wfId, taskId: task.id, decision: 'approved', comment: 'racer one' }),
      api('workflow-engine/decide', tSup, { workflowId: wfId, taskId: task.id, decision: 'approved', comment: 'racer two' }),
    ]);
    const oks   = [r1, r2].filter(r => r.body.success === true);
    const confs = [r1, r2].filter(r => r.status === 409);
    expect(oks.length === 1 && confs.length === 1, `expected 1 success + 1 conflict, got ${r1.status}/${r2.status}`);
    const { data: decs } = await sb.from('workflow_decisions').select('id').eq('task_id', task.id);
    expect(decs?.length === 1, `race produced ${decs?.length} decision rows`);
    // The winner advanced the workflow to the hse step.
    const { data: wf } = await sb.from('workflow_instances').select('current_step_key, active_transition_id').eq('id', wfId).single();
    expect(wf.current_step_key === 'hse' && !wf.active_transition_id, `winner should advance to hse+ungated, got ${wf.current_step_key}`);
  });

  await test('TERMINAL: rejection closes open siblings atomically', async () => {
    // Parallel first steps a + b (both sequenceNo 1 → firstSteps returns both).
    parTplId = await seedTemplate(parTplKey, 'ptw', 'permit_approval', parTrigger, {
      ...DEF,
      steps: [
        { ...DEF.steps[0], stepKey: 'a', stepName: 'A', assignment: { type: 'supervisor' } },
        { ...DEF.steps[0], stepKey: 'b', stepName: 'B', sequenceNo: 1, assignment: { type: 'role', value: 'admin' } },
      ],
      transitions: [
        { fromStep: 'a', onDecision: 'approved', completeWorkflow: true },
        { fromStep: 'b', onDecision: 'approved', completeWorkflow: true },
      ],
    });
    const rejWfId = await startWf(parTrigger, 'ptw', 'permit_approval', rejRecord, { supervisorId: bypass.supervisor.id });
    const { data: aTask } = await sb.from('workflow_tasks').select('id').eq('workflow_id', rejWfId).eq('step_key', 'a').single();
    const r = await api('workflow-engine/decide', tSup, { workflowId: rejWfId, taskId: aTask.id, decision: 'rejected', comment: 'not acceptable' });
    ok(r, 'reject failed');
    const { data: wf } = await sb.from('workflow_instances').select('status, active_transition_id').eq('id', rejWfId).single();
    expect(wf.status === 'rejected' && !wf.active_transition_id, `expected rejected+ungated, got ${wf.status}`);
    const { data: bTask } = await sb.from('workflow_tasks').select('status').eq('workflow_id', rejWfId).eq('step_key', 'b').single();
    expect(bTask.status === 'cancelled', `sibling b should be cancelled, got ${bTask.status}`);
  });

  // ── Failure path: fencing, dead-letter, gated instance, admin replay ─────────
  // A finance_payroll workflow whose source run doesn't exist → the receipt RPC
  // fails on every attempt → controlled, repeatable transition failure.
  let dlWfId = null, dlTransitionId = null;

  await test('FAILURE: source-RPC failure leaves instance GATED, never completed (202)', async () => {
    finTplId = await seedTemplate(finTplKey, 'finance_payroll', 'finance_payroll_approval', finTrigger, {
      ...DEF,
      steps: [{ ...DEF.steps[0], stepKey: 'approve', stepName: 'Approve', assignment: { type: 'supervisor' } }],
      transitions: [{ fromStep: 'approve', onDecision: 'approved', completeWorkflow: true }],
    });
    dlWfId = await startWf(finTrigger, 'finance_payroll', 'finance_payroll_approval', dlRecord, { supervisorId: bypass.supervisor.id });
    const task = await openTask(dlWfId);
    const r = await api('workflow-engine/decide', tSup, { workflowId: dlWfId, taskId: task.id, decision: 'approved', comment: 'approve missing run' });
    expect(r.body.success === true, `decision should commit even when finalization fails — got ${JSON.stringify(r.body).slice(0, 200)}`);
    expect(r.status === 202, `expected 202 (committed, finalization pending), got ${r.status}`);
    const { data: wf } = await sb.from('workflow_instances').select('status, active_transition_id').eq('id', dlWfId).single();
    expect(wf.status === 'in_progress' && !!wf.active_transition_id, `instance must stay gated + non-terminal: ${wf.status}/gated=${!!wf.active_transition_id}`);
    dlTransitionId = wf.active_transition_id;
    const { data: run } = await sb.from('finance_payroll_runs').select('id').eq('id', dlRecord).maybeSingle();
    expect(!run, 'sanity: source run must not exist');
  });

  await test('FENCING: a stale lease cannot complete or fail a reclaimed job', async () => {
    // Make the job claimable now, claim as worker A…
    await sb.from('workflow_outbox').update({ status: 'pending', next_attempt_at: new Date(0).toISOString(), lease_token: null, lease_expires_at: null }).eq('transition_id', dlTransitionId);
    const { data: claimedA } = await sb.rpc('workflow_outbox_claim', { p_worker_id: 'e2e-A', p_limit: 5 });
    const jobA = (claimedA ?? []).find(j => j.transition_id === dlTransitionId);
    expect(!!jobA, 'worker A failed to claim the job');
    // …expire A's lease, reclaim as worker B (fresh token)…
    await sb.from('workflow_outbox').update({ lease_expires_at: new Date(0).toISOString() }).eq('transition_id', dlTransitionId);
    const { data: claimedB } = await sb.rpc('workflow_outbox_claim', { p_worker_id: 'e2e-B', p_limit: 5 });
    const jobB = (claimedB ?? []).find(j => j.transition_id === dlTransitionId);
    expect(!!jobB && jobB.lease_token !== jobA.lease_token, 'worker B should reclaim with a fresh lease');
    // …then A (stale) must be rejected on both complete and fail.
    const { error: e1 } = await sb.rpc('workflow_outbox_complete', { p_transition_id: dlTransitionId, p_lease_token: jobA.lease_token });
    expect(e1 && e1.code === 'WF409', `stale complete should be WF409, got ${e1?.code ?? 'success'}`);
    const { error: e2 } = await sb.rpc('workflow_outbox_fail', { p_transition_id: dlTransitionId, p_lease_token: jobA.lease_token, p_error: 'stale' });
    expect(e2 && e2.code === 'WF409', `stale fail should be WF409, got ${e2?.code ?? 'success'}`);
    // B's fail is honored (releases the job back to pending with backoff).
    const { error: e3 } = await sb.rpc('workflow_outbox_fail', { p_transition_id: dlTransitionId, p_lease_token: jobB.lease_token, p_error: 'e2e fencing test' });
    expect(!e3, `current-lease fail should succeed: ${e3?.message}`);
  });

  await test('DEAD-LETTER: exhausted retries → dead_letter + critical event + instance still gated', async () => {
    // Force the next failure to exhaust the budget, then drain via the ops route.
    await sb.from('workflow_outbox').update({ max_attempts: 1, status: 'pending', next_attempt_at: new Date(0).toISOString() }).eq('transition_id', dlTransitionId);
    const r = await api('workflow-engine/outbox/process', T.admin, {});
    ok(r, 'outbox process route failed');
    const { data: ob } = await sb.from('workflow_outbox').select('status, last_error').eq('transition_id', dlTransitionId).single();
    expect(ob.status === 'dead_letter', `expected dead_letter, got ${ob.status} (${ob.last_error})`);
    const { data: tr } = await sb.from('workflow_transitions').select('status').eq('id', dlTransitionId).single();
    expect(tr.status === 'dead_letter', `transition should be dead_letter, got ${tr.status}`);
    const { data: wf } = await sb.from('workflow_instances').select('status, active_transition_id').eq('id', dlWfId).single();
    expect(wf.status === 'in_progress' && wf.active_transition_id === dlTransitionId, 'dead-letter must NOT clear the gate');
    const { data: ev } = await sb.from('app_events').select('id').eq('dedupe_key', `workflow.transition_failed:${dlTransitionId}`);
    expect(ev?.length === 1, 'critical transition_failed event missing');
  });

  await test('REPLAY: admin replay resets the job for a fresh cycle (audited)', async () => {
    const r = await api('workflow-engine/outbox/replay', T.admin, { transitionId: dlTransitionId, reason: 'E2E replay test' });
    ok(r, 'replay route failed');
    const { data: audit } = await sb.from('workflow_audit_log').select('id').eq('workflow_id', dlWfId).eq('action', 'workflow.transition.replayed');
    expect((audit?.length ?? 0) >= 1, 'replay audit row missing');
    // Source still missing → it fails again, but the job is back in the retry loop (not lost).
    const { data: ob } = await sb.from('workflow_outbox').select('status, attempts, max_attempts').eq('transition_id', dlTransitionId).single();
    expect(['pending','processing','dead_letter'].includes(ob.status), `job should be cycling, got ${ob.status}`);
  });
}
