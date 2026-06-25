// ============================================================================
// Central Workflow Engine — API routes (Spec §21)
// ============================================================================
// Mounted at /api/workflow-engine to coexist with the legacy /api/workflow(s)
// routes during cutover. POST-only (body.args); gated by the §22 workflow.* perms.
// ============================================================================

import { Hono }       from 'hono';
import { sb }         from '../lib/db';
import { requireUser, requirePermission, userCan } from '../lib/auth';
import { z, zv }      from '../lib/validate';
import { nextRef }    from '../lib/refGenerator';
import { startWorkflowForRecord, decideTask, delegateTask, reassignTask, cancelWorkflow } from '../lib/workflow/service';
import { validateWorkflowDefinition } from '../lib/workflow/validateDefinition';
import type { WorkflowTemplateDefinition } from '../lib/workflow/definitionTypes';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const body = (c: { get: (k: 'body') => Record<string, unknown> }) => (c.get('body') as Record<string, unknown>).args ?? {};
const actorOf = (u: { id: string; role?: string }) => ({ id: u.id, role: u.role });

// ── Lifecycle ────────────────────────────────────────────────────────────────

// POST /api/workflow-engine/start — usually called by a module adapter
router.post('/start', async c => {
  const user = await requirePermission(c, 'workflow.submit');
  const v = zv(c, z.object({
    moduleKey: z.string().min(1), workflowType: z.string().min(1), triggerEvent: z.string().min(1),
    sourceRecordId: z.string().min(1), sourceRecordRef: z.string().optional(),
    siteId: z.string().nullable().optional(), departmentId: z.string().nullable().optional(),
    ownerId: z.string().nullable().optional(), priority: z.enum(['low','normal','medium','high','critical']).optional(),
    recordData: z.record(z.string(), z.unknown()).default({}),
  }), body(c));
  if (!v.ok) return v.response;
  try {
    const wf = await startWorkflowForRecord({
      actor: actorOf(user as { id: string; role?: string }),
      context: { ...v.data, requestedBy: (user as { id: string }).id, actorRoleIds: [(user as { role?: string }).role ?? ''] },
    });
    if (!wf) return c.json({ success: true, data: null, message: 'No active workflow binding — record proceeds without a workflow.' });
    return c.json({ success: true, data: wf });
  } catch (err) { return c.json({ success: false, message: err instanceof Error ? err.message : 'Start failed' }, 400 as 200); }
});

// POST /api/workflow-engine/decide — approve | return | reject (assignee or elevated)
router.post('/decide', async c => {
  const user = await requireUser(c);
  const v = zv(c, z.object({
    workflowId: z.string().uuid(), taskId: z.string().uuid(),
    decision: z.enum(['approved','returned','rejected']), comment: z.string().max(2000).optional(),
    attachmentIds: z.array(z.string()).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  const permKey = `workflow.tasks.${v.data.decision === 'approved' ? 'approve' : v.data.decision === 'returned' ? 'return' : 'reject'}`;
  if (!(await userCan(user, permKey))) return c.json({ success: false, message: 'Forbidden' }, 403 as 200);
  // Assignee-or-elevated check.
  const { data: task } = await sb.from('workflow_tasks').select('assigned_to, assigned_role').eq('id', v.data.taskId).maybeSingle<{ assigned_to: string | null; assigned_role: string | null }>();
  if (!task) return c.json({ success: false, message: 'Task not found.' }, 404 as 200);
  const elevated = user.role === 'superadmin' || await userCan(user, 'workflow.instances.admin_override') || await userCan(user, 'workflow.instances.reassign');
  const assigned = task.assigned_to === user.id || (!!task.assigned_role && task.assigned_role === user.role);
  if (!assigned && !elevated) return c.json({ success: false, message: 'This task is not assigned to you.' }, 403 as 200);
  try {
    const wf = await decideTask({ workflowId: v.data.workflowId, taskId: v.data.taskId, actor: actorOf(user), decision: v.data.decision, comment: v.data.comment, attachmentIds: v.data.attachmentIds });
    return c.json({ success: true, data: wf });
  } catch (err) { return c.json({ success: false, message: err instanceof Error ? err.message : 'Decision failed' }, 400 as 200); }
});

// POST /api/workflow-engine/delegate
router.post('/delegate', async c => {
  const user = await requirePermission(c, 'workflow.tasks.delegate');
  const v = zv(c, z.object({ taskId: z.string().uuid(), delegateTo: z.string().min(1), reason: z.string().max(500) }), body(c));
  if (!v.ok) return v.response;
  try { await delegateTask({ taskId: v.data.taskId, actor: actorOf(user as { id: string; role?: string }), delegateTo: v.data.delegateTo, reason: v.data.reason }); return c.json({ success: true }); }
  catch (err) { return c.json({ success: false, message: err instanceof Error ? err.message : 'Delegate failed' }, 400 as 200); }
});

// POST /api/workflow-engine/reassign
router.post('/reassign', async c => {
  const user = await requirePermission(c, 'workflow.instances.reassign');
  const v = zv(c, z.object({ taskId: z.string().uuid(), reassignTo: z.string().min(1), reason: z.string().max(500) }), body(c));
  if (!v.ok) return v.response;
  await reassignTask({ taskId: v.data.taskId, actor: actorOf(user as { id: string; role?: string }), reassignTo: v.data.reassignTo, reason: v.data.reason });
  return c.json({ success: true });
});

// POST /api/workflow-engine/cancel
router.post('/cancel', async c => {
  const user = await requirePermission(c, 'workflow.instances.cancel');
  const v = zv(c, z.object({ workflowId: z.string().uuid(), reason: z.string().min(1).max(500) }), body(c));
  if (!v.ok) return v.response;
  await cancelWorkflow({ workflowId: v.data.workflowId, actor: actorOf(user as { id: string; role?: string }), reason: v.data.reason });
  return c.json({ success: true });
});

// ── Reads ────────────────────────────────────────────────────────────────────

// POST /api/workflow-engine/my-tasks
router.post('/my-tasks', async c => {
  const user = await requirePermission(c, 'workflow.my_tasks.view');
  const { data } = await sb.from('workflow_tasks').select('*').eq('assigned_to', user.id).in('status', ['pending','open','in_progress']).order('due_at', { ascending: true }).limit(200);
  return c.json({ success: true, data: data ?? [] });
});

// POST /api/workflow-engine/register
router.post('/register', async c => {
  await requirePermission(c, 'workflow.register.view');
  const v = zv(c, z.object({ moduleKey: z.string().optional(), status: z.string().optional() }), body(c));
  if (!v.ok) return v.response;
  let q = sb.from('workflow_instances').select('*').order('started_at', { ascending: false }).limit(200);
  if (v.data.moduleKey) q = q.eq('module_key', v.data.moduleKey);
  if (v.data.status) q = q.eq('status', v.data.status);
  const { data } = await q;
  return c.json({ success: true, data: data ?? [] });
});

// POST /api/workflow-engine/get
router.post('/get', async c => {
  await requirePermission(c, 'workflow.instances.view');
  const v = zv(c, z.object({ workflowId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  const { data: wf } = await sb.from('workflow_instances').select('*').eq('id', v.data.workflowId).maybeSingle<{ id: string }>();
  if (!wf) return c.json({ success: false, message: 'Workflow not found.' }, 404 as 200);
  const [{ data: tasks }, { data: decisions }] = await Promise.all([
    sb.from('workflow_tasks').select('*').eq('workflow_id', wf.id).order('created_at'),
    sb.from('workflow_decisions').select('*').eq('workflow_id', wf.id).order('created_at', { ascending: false }),
  ]);
  return c.json({ success: true, data: { workflow: wf, tasks: tasks ?? [], decisions: decisions ?? [] } });
});

// POST /api/workflow-engine/audit/list
router.post('/audit/list', async c => {
  await requirePermission(c, 'workflow.audit.view');
  const v = zv(c, z.object({ workflowId: z.string().uuid().optional(), moduleKey: z.string().optional() }), body(c));
  if (!v.ok) return v.response;
  let q = sb.from('workflow_audit_log').select('*').order('created_at', { ascending: false }).limit(300);
  if (v.data.workflowId) q = q.eq('workflow_id', v.data.workflowId);
  if (v.data.moduleKey) q = q.eq('module_key', v.data.moduleKey);
  const { data } = await q;
  return c.json({ success: true, data: data ?? [] });
});

// ── Template versions + bindings (configure a workflow) ──────────────────────

// POST /api/workflow-engine/templates/version/create — new draft version
router.post('/templates/version/create', async c => {
  const user = await requirePermission(c, 'workflow.templates.update');
  const v = zv(c, z.object({ templateId: z.string().uuid(), definition: z.record(z.string(), z.unknown()), changeSummary: z.string().max(500).optional() }), body(c));
  if (!v.ok) return v.response;
  try { validateWorkflowDefinition(v.data.definition as unknown as WorkflowTemplateDefinition); }
  catch (err) { return c.json({ success: false, message: err instanceof Error ? err.message : 'Invalid definition' }, 400 as 200); }
  const { data: last } = await sb.from('workflow_template_versions').select('version_no').eq('template_id', v.data.templateId).order('version_no', { ascending: false }).limit(1).maybeSingle<{ version_no: number }>();
  const nextNo = (last?.version_no ?? 0) + 1;
  const { data, error } = await sb.from('workflow_template_versions').insert({
    template_id: v.data.templateId, version_no: nextNo, version_status: 'draft', definition: v.data.definition,
    change_summary: v.data.changeSummary ?? null, created_by: (user as { id: string }).id,
  }).select('id, version_no').single<{ id: string; version_no: number }>();
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data });
});

// POST /api/workflow-engine/templates/version/publish
router.post('/templates/version/publish', async c => {
  const user = await requirePermission(c, 'workflow.templates.publish');
  const v = zv(c, z.object({ versionId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  const { data: ver } = await sb.from('workflow_template_versions').select('id, template_id, version_no').eq('id', v.data.versionId).maybeSingle<{ id: string; template_id: string; version_no: number }>();
  if (!ver) return c.json({ success: false, message: 'Version not found.' }, 404 as 200);
  await sb.from('workflow_template_versions').update({ version_status: 'published', published_by: (user as { id: string }).id, published_at: new Date().toISOString() }).eq('id', ver.id);
  await sb.from('workflow_templates').update({ current_version: ver.version_no, status: 'active', updated_by: (user as { id: string }).id, updated_at: new Date().toISOString() }).eq('id', ver.template_id);
  return c.json({ success: true, data: { versionId: ver.id, versionNo: ver.version_no } });
});

// POST /api/workflow-engine/bindings/list
router.post('/bindings/list', async c => {
  await requirePermission(c, 'workflow.bindings.view');
  const v = zv(c, z.object({ moduleKey: z.string().optional() }), body(c));
  if (!v.ok) return v.response;
  let q = sb.from('module_workflow_bindings').select('*').order('priority');
  if (v.data.moduleKey) q = q.eq('module_key', v.data.moduleKey);
  const { data } = await q;
  return c.json({ success: true, data: data ?? [] });
});

// POST /api/workflow-engine/bindings/create
router.post('/bindings/create', async c => {
  const user = await requirePermission(c, 'workflow.bindings.create');
  const v = zv(c, z.object({
    moduleKey: z.string().min(1), workflowType: z.string().min(1), triggerEvent: z.string().min(1),
    templateId: z.string().uuid(), templateVersionId: z.string().uuid().nullable().optional(),
    scopeType: z.enum(['global','site','department','role']).default('global'), scopeId: z.string().nullable().optional(),
    priority: z.number().int().default(100), conditions: z.record(z.string(), z.unknown()).optional(), isActive: z.boolean().default(true),
  }), body(c));
  if (!v.ok) return v.response;
  const { data, error } = await sb.from('module_workflow_bindings').insert({
    module_key: v.data.moduleKey, workflow_type: v.data.workflowType, trigger_event: v.data.triggerEvent,
    template_id: v.data.templateId, template_version_id: v.data.templateVersionId ?? null,
    scope_type: v.data.scopeType, scope_id: v.data.scopeId ?? null, priority: v.data.priority,
    conditions: v.data.conditions ?? {}, is_active: v.data.isActive, created_by: (user as { id: string }).id,
  }).select('id').single<{ id: string }>();
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data });
});

// POST /api/workflow-engine/bindings/set-active  (activate | deactivate)
router.post('/bindings/set-active', async c => {
  const v = zv(c, z.object({ bindingId: z.string().uuid(), active: z.boolean() }), body(c));
  await requirePermission(c, v.ok && v.data.active ? 'workflow.bindings.activate' : 'workflow.bindings.deactivate');
  if (!v.ok) return v.response;
  const { error } = await sb.from('module_workflow_bindings').update({ is_active: v.data.active, updated_at: new Date().toISOString() }).eq('id', v.data.bindingId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true });
});

export default router;
