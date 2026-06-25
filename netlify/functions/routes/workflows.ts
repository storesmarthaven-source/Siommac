/**
 * netlify/functions/routes/workflows.ts
 *
 * Platform workflow API — shared by all modules.
 *
 * POST /api/workflows/create   → createWorkflow()
 * POST /api/workflows/list     → list open workflow_instances
 * POST /api/workflows/get      → single workflow + tasks + events
 * POST /api/workflows/tasks    → pending tasks for current user
 * POST /api/workflows/decision → decideWorkflowTask()
 * POST /api/workflows/audit    → workflow_events feed
 */

import { Hono }              from 'hono';
import { z, zv }             from '../lib/validate';
import { requirePermission } from '../lib/auth';
import { sb }                from '../lib/db';
import { createWorkflow, decideWorkflowTask } from '../lib/workflowEngine';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── POST /api/workflows/create ────────────────────────────────────────────────

const CreateWorkflowSchema = z.object({
  templateKey:        z.string().min(1),
  sourceModule:       z.string().min(1),
  sourceEntityType:   z.string().min(1),
  sourceEntityId:     z.string().min(1),
  priority:           z.enum(['low','medium','high','critical']).default('medium'),
  ownerUserId:        z.string().optional().nullable(),
  reason:             z.string().optional(),
  metadata:           z.record(z.string(), z.unknown()).optional(),
});

router.post('/workflows/create', async c => {
  const user = await requirePermission(c, 'workflow.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, CreateWorkflowSchema, body.args);
  if (!v.ok) return v.response;

  const result = await createWorkflow({
    ...v.data,
    createdBy: user.id,
  });

  if (!result.ok) return c.json({ success: false, message: 'Failed to create workflow' }, 500 as 200);
  return c.json({ success: true, workflowId: result.workflowId, ref: result.ref });
});

// ── POST /api/workflows/list ──────────────────────────────────────────────────

const ListWorkflowsSchema = z.object({
  status:       z.string().optional(),
  module:       z.string().optional(),
  assignedToMe: z.boolean().optional(),
  limit:        z.number().int().min(1).max(100).default(50),
  cursor:       z.string().nullable().optional(),
});

router.post('/workflows/list', async c => {
  const user = await requirePermission(c, 'workflow.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ListWorkflowsSchema, body.args);
  if (!v.ok) return v.response;

  // Spec columns aliased back to the stable API field names the frontend uses.
  let q = sb
    .from('workflow_instances')
    .select('id, ref:workflow_no, template_id, source_module:module_key, source_entity_type:workflow_type, source_entity_id:source_record_id, status, priority, current_step:current_step_key, owner_user_id:owner_id, due_at, created_at')
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  if (v.data.status) q = q.eq('status', v.data.status);
  if (v.data.module) q = q.eq('module_key', v.data.module);

  // For non-admin/manager, scope to owned or involved workflows
  if (!['admin','superadmin','manager'].includes(user.role)) {
    q = q.eq('owner_id', user.id);
  }

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/workflows/get ───────────────────────────────────────────────────

router.post('/workflows/get', async c => {
  await requirePermission(c, 'workflow.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as Record<string, unknown> | undefined;
  const workflowId = args?.workflowId as string | undefined;

  if (!workflowId) return c.json({ success: false, message: 'workflowId required' }, 400 as 200);

  const [wfRes, tasksRes, eventsRes] = await Promise.all([
    sb.from('workflow_instances').select('id, ref:workflow_no, template_id, source_module:module_key, source_entity_type:workflow_type, source_entity_id:source_record_id, status, priority, current_step:current_step_key, owner_user_id:owner_id, due_at, created_at, updated_at, closed_at, metadata').eq('id', workflowId).maybeSingle(),
    sb.from('workflow_tasks').select('id, workflow_id, step_key, task_type:step_type, assigned_role, assigned_user_id:assigned_to, status, due_at, decision, decision_note:decision_comment, completed_by, completed_at, created_at').eq('workflow_id', workflowId).order('created_at'),
    sb.from('workflow_events').select('*').eq('workflow_id', workflowId).order('created_at'),
  ]);

  if (!wfRes.data) return c.json({ success: false, message: 'Workflow not found' }, 404 as 200);

  return c.json({
    success: true,
    data: {
      workflow: wfRes.data,
      tasks:    tasksRes.data ?? [],
      events:   eventsRes.data ?? [],
    },
  });
});

// ── POST /api/workflows/tasks ─────────────────────────────────────────────────

router.post('/workflows/tasks', async c => {
  const user = await requirePermission(c, 'workflow.view');

  const { data, error } = await sb
    .from('workflow_tasks')
    .select('id, workflow_id, step_key, task_type:step_type, assigned_role, assigned_user_id:assigned_to, status, due_at, decision, decision_note:decision_comment, completed_at, created_at, workflow_instances(ref:workflow_no, source_module:module_key, source_entity_type:workflow_type, source_entity_id:source_record_id, priority)')
    .in('status', ['open', 'pending', 'in_progress'])
    .or(`assigned_to.eq.${user.id},and(assigned_role.eq.${user.role},assigned_to.is.null)`)
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(50);

  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/workflows/decision ──────────────────────────────────────────────

const DecisionSchema = z.object({
  taskId:   z.string().uuid(),
  decision: z.enum(['approved','rejected','returned','verified','completed']),
  note:     z.string().max(2000).optional(),
});

router.post('/workflows/decision', async c => {
  const user = await requirePermission(c, 'workflow.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, DecisionSchema, body.args);
  if (!v.ok) return v.response;

  const result = await decideWorkflowTask({
    ...v.data,
    actorUserId: user.id,
  });

  if (!result.ok) return c.json({ success: false, message: 'Failed to process decision' }, 500 as 200);
  return c.json({ success: true, workflowId: result.workflowId, status: result.workflowStatus });
});

// ── POST /api/workflows/audit ─────────────────────────────────────────────────

router.post('/workflows/audit', async c => {
  await requirePermission(c, 'workflow.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { workflowId?: string; limit?: number } | undefined;

  if (!args?.workflowId) return c.json({ success: false, message: 'workflowId required' }, 400 as 200);

  const { data, error } = await sb
    .from('workflow_events')
    .select('*')
    .eq('workflow_id', args.workflowId)
    .order('created_at', { ascending: false })
    .limit(args.limit ?? 100);

  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

export default router;
