/**
 * scripts/e2e/suites/workflowAdmin.mjs
 *
 * E2E for the central Workflow Engine ADMIN/config surface (coverage-gate debt):
 *   routes/workflowEngine.ts —
 *     templates/version/{create,publish}, bindings/{create,list,set-active},
 *     register, get, audit/list, my-tasks, delegate, reassign, cancel.
 *
 * The engine's own decision path (/decide) is already covered by financePayroll
 * / payrollLoans. This suite covers CONFIGURATION (template versions + bindings)
 * and instance ADMIN actions, plus the access-control negatives.
 *
 * Instances/tasks are seeded directly (a full /start needs a matching active
 * binding + valid trigger; delegate/reassign/cancel only need the rows to exist).
 * Every seeded row + synthetic user is cleaned up; the definition is CLONED from
 * a real published version so validateWorkflowDefinition accepts it.
 */
import { randomUUID } from 'node:crypto';

export const title = 'Workflow Engine — admin / configuration';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const admin = h.users.admin;                 // superadmin (allow-all for workflow.*)
  const adminT = mint(admin);

  const emp      = { id: `WFA-EMP-${TAG.slice(-8)}`,  username: `wfa_emp_${TAG.slice(-6)}`,  role: 'employee', department_id: null };
  const assignee = { id: `WFA-ASG-${TAG.slice(-8)}`,  username: `wfa_asg_${TAG.slice(-6)}`,  role: 'employee', department_id: null };
  const empT = mint(emp);

  const ctx = {
    templateId: randomUUID(),
    versionId:  null,
    bindingId:  null,
    workflowId: randomUUID(),
    taskId:     randomUUID(),
    definition: null,
  };

  h.onCleanup(async () => {
    try { await sb.from('workflow_tasks').delete().eq('workflow_id', ctx.workflowId); } catch {}
    try { await sb.from('workflow_audit_log').delete().eq('workflow_id', ctx.workflowId); } catch {}
    try { await sb.from('workflow_decisions').delete().eq('workflow_id', ctx.workflowId); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'workflow').eq('source_entity_id', ctx.workflowId); } catch {}
    try { await sb.from('notifications').delete().eq('source_id', ctx.workflowId); } catch {}
    try { await sb.from('workflow_instances').delete().eq('id', ctx.workflowId); } catch {}
    try { await sb.from('module_workflow_bindings').delete().eq('template_id', ctx.templateId); } catch {}
    try { await sb.from('workflow_template_versions').delete().eq('template_id', ctx.templateId); } catch {}
    try { await sb.from('workflow_templates').delete().eq('id', ctx.templateId); } catch {}
    try { await sb.from('app_users').delete().in('id', [emp.id, assignee.id]); } catch {}
  });

  const waitFor = async (check, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  // ── Setup ────────────────────────────────────────────────────────────────────
  h.section('Workflow Admin > Setup');

  await test('provision synthetic users + a draft template + clone a real definition', async () => {
    const { error: uErr } = await sb.from('app_users').insert([emp, assignee].map(u => ({
      id: u.id, username: u.username, full_name: `${u.username} (E2E)`, role: 'employee', status: 'active', employment_type: 'employee',
    })));
    expect(!uErr, `seed users failed: ${uErr?.message}`);

    // Clone a real, valid definition (so validateWorkflowDefinition passes).
    const { data: v } = await sb.from('workflow_template_versions').select('definition').not('definition', 'is', null).limit(1).maybeSingle();
    expect(v?.definition, 'no existing workflow definition to clone');
    ctx.definition = v.definition;

    const { error: tErr } = await sb.from('workflow_templates').insert({
      id: ctx.templateId, name: `E2E WF ${TAG}`, template_key: `e2e_wf_${TAG.slice(-6)}`,
      module_key: 'e2e_wf', workflow_type: 'e2e_approval', status: 'draft', current_version: 0,
      definition: ctx.definition, is_active: false, created_by: admin.id,
    });
    expect(!tErr, `seed template failed: ${tErr?.message}`);
  });

  // ── Template versions ──────────────────────────────────────────────────────────
  h.section('Workflow Admin > Template versions');

  await test('templates/version/create makes a draft version (v1)', async () => {
    const r = await api('workflow-engine/templates/version/create', adminT, { templateId: ctx.templateId, definition: ctx.definition, changeSummary: 'E2E v1' });
    ok(r, `version/create failed: ${r.body.message}`);
    expect(r.body.data.versionNo ?? r.body.data.version_no, 'version number missing');
    ctx.versionId = r.body.data.id;
  });

  await test('version/create with an INVALID definition is rejected (400)', async () => {
    const r = await api('workflow-engine/templates/version/create', adminT, { templateId: ctx.templateId, definition: { not: 'valid' } });
    fails(r, 'invalid workflow definition should be rejected');
  });

  await test('employee is DENIED templates/version/create', async () => {
    fails(await api('workflow-engine/templates/version/create', empT, { templateId: ctx.templateId, definition: ctx.definition }), 'employee denied version/create');
  });

  await test('templates/version/publish activates the version + template', async () => {
    const r = await api('workflow-engine/templates/version/publish', adminT, { versionId: ctx.versionId });
    ok(r, `version/publish failed: ${r.body.message}`);
    const { data: ver } = await sb.from('workflow_template_versions').select('version_status').eq('id', ctx.versionId).maybeSingle();
    expect(ver?.version_status === 'published', `version should be published, got ${ver?.version_status}`);
    const { data: tpl } = await sb.from('workflow_templates').select('status, current_version').eq('id', ctx.templateId).maybeSingle();
    expect(tpl?.status === 'active' && tpl?.current_version >= 1, 'template should be active with current_version bumped');
  });

  await test('employee is DENIED templates/version/publish', async () => {
    fails(await api('workflow-engine/templates/version/publish', empT, { versionId: ctx.versionId }), 'employee denied publish');
  });

  // ── Bindings ─────────────────────────────────────────────────────────────────
  h.section('Workflow Admin > Bindings');

  await test('bindings/create binds the module trigger to the template', async () => {
    const r = await api('workflow-engine/bindings/create', adminT, {
      moduleKey: 'e2e_wf', workflowType: 'e2e_approval', triggerEvent: 'e2e.submitted',
      templateId: ctx.templateId, templateVersionId: ctx.versionId, scopeType: 'global', priority: 100, isActive: true,
    });
    ok(r, `bindings/create failed: ${r.body.message}`);
    ctx.bindingId = r.body.data.id;
  });

  await test('bindings/list returns the binding (filtered by module)', async () => {
    const r = await api('workflow-engine/bindings/list', adminT, { moduleKey: 'e2e_wf' });
    ok(r, `bindings/list failed: ${r.body.message}`);
    expect(r.body.data.some(b => b.id === ctx.bindingId), 'created binding not in list');
  });

  await test('bindings/set-active toggles is_active (deactivate then activate)', async () => {
    const off = await api('workflow-engine/bindings/set-active', adminT, { bindingId: ctx.bindingId, active: false });
    ok(off, `deactivate failed: ${off.body.message}`);
    let { data } = await sb.from('module_workflow_bindings').select('is_active').eq('id', ctx.bindingId).maybeSingle();
    expect(data?.is_active === false, 'binding should be inactive');
    const on = await api('workflow-engine/bindings/set-active', adminT, { bindingId: ctx.bindingId, active: true });
    ok(on, `activate failed: ${on.body.message}`);
    ({ data } = await sb.from('module_workflow_bindings').select('is_active').eq('id', ctx.bindingId).maybeSingle());
    expect(data?.is_active === true, 'binding should be active again');
  });

  await test('employee is DENIED bindings/create + bindings/list', async () => {
    fails(await api('workflow-engine/bindings/create', empT, { moduleKey: 'e2e_wf', workflowType: 'x', triggerEvent: 'y', templateId: ctx.templateId }), 'employee denied bindings/create');
    fails(await api('workflow-engine/bindings/list', empT, {}), 'employee denied bindings/list');
  });

  // ── Instances + tasks (admin actions) ──────────────────────────────────────────
  h.section('Workflow Admin > Instance admin');

  await test('seed a running workflow instance + task', async () => {
    // The instance's snapshot must contain the task's step (delegateTask matches
    // by step_key + reads decisionRules.canDelegate). Purpose-built so the admin
    // actions (delegate/reassign/cancel) exercise their success path.
    const seedSnapshot = {
      schemaVersion: 1,
      steps: [{
        stepKey: 'step1', stepName: 'Step 1', stepType: 'approval', sequenceNo: 1, required: true,
        assignment: { type: 'role', value: 'employee' },
        decisionRules: { canApprove: true, canReject: true, canReturn: true, canDelegate: true, requireAttachment: false, requireCommentOnApprove: false, requireCommentOnReject: false, requireCommentOnReturn: false },
      }],
      handoffs: [], transitions: [], notifications: [], settings: { allowDelegate: true }, sourceStatusMap: {},
    };
    const { error: iErr } = await sb.from('workflow_instances').insert({
      id: ctx.workflowId, template_id: ctx.templateId, template_version_id: ctx.versionId,
      module_key: 'e2e_wf', workflow_type: 'e2e_approval', source_record_id: randomUUID(),
      status: 'in_progress', priority: 'medium', workflow_no: `WF-E2E-${TAG.slice(-6)}`,
      started_at: new Date().toISOString(), template_snapshot: seedSnapshot, source_snapshot: {}, current_step_key: 'step1',
      requested_by: admin.id,
    });
    expect(!iErr, `seed instance failed: ${iErr?.message}`);
    const { error: kErr } = await sb.from('workflow_tasks').insert({
      id: ctx.taskId, workflow_id: ctx.workflowId, step_key: 'step1', status: 'pending',
      assigned_to: assignee.id, step_name: 'Step 1', step_type: 'approval', task_title: 'E2E task', is_required: true,
    });
    expect(!kErr, `seed task failed: ${kErr?.message}`);
  });

  await test('register lists instances (filtered by module)', async () => {
    const r = await api('workflow-engine/register', adminT, { moduleKey: 'e2e_wf' });
    ok(r, `register failed: ${r.body.message}`);
    expect(r.body.data.some(w => w.id === ctx.workflowId), 'seeded instance not in register');
  });

  await test('get returns the workflow + tasks + decisions', async () => {
    const r = await api('workflow-engine/get', adminT, { workflowId: ctx.workflowId });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data.workflow?.id === ctx.workflowId, 'wrong workflow returned');
    expect(Array.isArray(r.body.data.tasks) && r.body.data.tasks.some(t => t.id === ctx.taskId), 'task not in get');
  });

  await test('my-tasks returns an array for the caller', async () => {
    const r = await api('workflow-engine/my-tasks', adminT, {});
    ok(r, `my-tasks failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'my-tasks data must be an array');
  });

  await test('delegate the task to another user', async () => {
    const r = await api('workflow-engine/delegate', adminT, { taskId: ctx.taskId, delegateTo: assignee.id, reason: 'E2E delegate' });
    ok(r, `delegate failed: ${r.body.message}`);
    const { data } = await sb.from('workflow_tasks').select('delegated_to, status').eq('id', ctx.taskId).maybeSingle();
    expect(data?.delegated_to === assignee.id, `delegated_to should be set, got ${data?.delegated_to}`);
  });

  await test('reassign the task to another user', async () => {
    const r = await api('workflow-engine/reassign', adminT, { taskId: ctx.taskId, reassignTo: emp.id, reason: 'E2E reassign' });
    ok(r, `reassign failed: ${r.body.message}`);
    const { data } = await sb.from('workflow_tasks').select('assigned_to').eq('id', ctx.taskId).maybeSingle();
    expect(data?.assigned_to === emp.id, `assigned_to should be reassigned, got ${data?.assigned_to}`);
  });

  await test('cancel the workflow → status cancelled + audit written', async () => {
    const r = await api('workflow-engine/cancel', adminT, { workflowId: ctx.workflowId, reason: 'E2E cancel' });
    ok(r, `cancel failed: ${r.body.message}`);
    const { data } = await sb.from('workflow_instances').select('status').eq('id', ctx.workflowId).maybeSingle();
    expect(data?.status === 'cancelled', `instance should be cancelled, got ${data?.status}`);
    const gotAudit = await waitFor(async () => {
      const { data: a } = await sb.from('workflow_audit_log').select('id').eq('workflow_id', ctx.workflowId).eq('action', 'workflow.cancelled').limit(1);
      return (a ?? []).length > 0;
    });
    expect(gotAudit, 'workflow.cancelled audit row not found');
  });

  await test('audit/list returns the workflow audit trail', async () => {
    const r = await api('workflow-engine/audit/list', adminT, { workflowId: ctx.workflowId });
    ok(r, `audit/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'audit list should have entries after cancel');
  });

  await test('employee is DENIED register / get / audit / delegate / reassign / cancel', async () => {
    fails(await api('workflow-engine/register', empT, {}), 'employee denied register');
    fails(await api('workflow-engine/get', empT, { workflowId: ctx.workflowId }), 'employee denied get');
    fails(await api('workflow-engine/audit/list', empT, {}), 'employee denied audit/list');
    fails(await api('workflow-engine/delegate', empT, { taskId: ctx.taskId, delegateTo: assignee.id, reason: 'x' }), 'employee denied delegate');
    fails(await api('workflow-engine/reassign', empT, { taskId: ctx.taskId, reassignTo: assignee.id, reason: 'x' }), 'employee denied reassign');
    fails(await api('workflow-engine/cancel', empT, { workflowId: ctx.workflowId, reason: 'x' }), 'employee denied cancel');
  });
}
