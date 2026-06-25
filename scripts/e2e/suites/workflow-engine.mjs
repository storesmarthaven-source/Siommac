// E2E — Central Workflow Engine (seed template+version+binding → start → decide →
// advance → complete + access control + §2 side-effects). Requires the workflow
// migrations (20260704000000/01/02) applied.

export const title = 'Central Workflow Engine';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), b: mint(b) };

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
      sourceRecordId: recordId, recordData: { supervisorId: b.id },
    });
    ok(r, 'start failed');
    workflowId = r.body.data?.id ?? null;
    expect(!!workflowId, 'no workflow id');
    expect(r.body.data.status === 'in_progress', `expected in_progress, got ${r.body.data.status}`);
    const task = await openTask(workflowId);
    expect(task && task.step_key === 'supervisor', 'first task is not the supervisor step');
    expect(task.assigned_to === b.id, 'supervisor task not assigned to recordData.supervisorId');
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
    const r = await api('workflow-engine/my-tasks', T.b, {});
    ok(r, 'my-tasks failed');
    expect(r.body.data.some(t => t.workflow_id === workflowId), 'assignee does not see the task');
  });

  await test('supervisor approves → advances to HSE step', async () => {
    const task = await openTask(workflowId);
    const r = await api('workflow-engine/decide', T.b, { workflowId, taskId: task.id, decision: 'approved', comment: 'ok' });
    ok(r, 'supervisor approve failed');
    const next = await openTask(workflowId);
    expect(next && next.step_key === 'hse', `expected hse step, got ${next?.step_key}`);
    expect(next.assigned_role === 'admin', 'hse task not assigned to role admin');
  });

  await test('ACCESS: employee cannot decide the HSE (role admin) task', async () => {
    const task = await openTask(workflowId);
    fails(await api('workflow-engine/decide', T.b, { workflowId, taskId: task.id, decision: 'approved' }), 'employee should not decide a role:admin task');
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
}
