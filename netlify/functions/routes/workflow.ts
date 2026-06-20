/**
 * netlify/functions/routes/workflow.ts
 *
 * Platform-level workflow + handoff API. POST-only (matches CORS config in api.ts).
 * All modules (HSE, HR, Finance, Operations, Payroll) use these shared endpoints.
 *
 * Routes:
 *   POST /api/workflow/submit       → create workflow_instance + first approval_task + submitted event
 *   POST /api/workflow/decide       → update approval_task + append event + trigger handoff_outbox
 *   POST /api/workflow/list         → open workflows visible to the current user
 *   POST /api/workflow/approvals    → pending approval tasks for the current user's role
 *   POST /api/workflow/audit        → workflow_events feed (paginated, newest-first)
 *   POST /api/workflow/handoffs/out → handoff_outbox rows for a source module
 *   POST /api/workflow/handoffs/in  → handoff_inbox rows for a target module; mark processed
 */

import { Hono }  from 'hono';
import { sb }    from '../lib/db';
import { requirePermission, log_ } from '../lib/auth';
import { zv, z, zShortStr } from '../lib/validate';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Tiny ID helpers (no external dep) ────────────────────────────────────────

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const SubmitSchema = z.object({
  templateId:   zShortStr(100),
  recordRef:    zShortStr(100),
  sourceModule: z.enum(['hse','hr','finance','operations','payroll']),
  targetModule: z.enum(['hse','hr','finance','operations','payroll']).optional(),
  approverRole: z.string().min(1).max(64).default('manager'),
  priority:     z.enum(['low','normal','high','critical']).default('normal'),
  dueDate:      z.string().optional(),
  reason:       z.string().max(1000).optional(),
  metadata:     z.record(z.string(), z.unknown()).default({}),
});

const DecideSchema = z.object({
  taskId:   zShortStr(100),
  decision: z.enum(['approved','returned','rejected']),
  comment:  z.string().max(1000).optional(),
  handoffs: z.array(z.object({
    targetModule:  z.enum(['hse','hr','finance','operations','payroll']),
    handoffType:   z.string().min(1).max(64),
    payload:       z.record(z.string(), z.unknown()),
  })).default([]),
});

const ListSchema = z.object({
  sourceModule: z.enum(['hse','hr','finance','operations','payroll']).optional(),
  status:       z.string().optional(),
  limit:        z.number().int().min(1).max(200).default(50),
  offset:       z.number().int().min(0).default(0),
});

const ApprovalsSchema = z.object({
  status: z.enum(['pending','approved','returned','rejected']).default('pending'),
  limit:  z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const AuditSchema = z.object({
  workflowId: zShortStr(100).optional(),
  limit:      z.number().int().min(1).max(200).default(50),
  offset:     z.number().int().min(0).default(0),
});

const HandoffsOutSchema = z.object({
  sourceModule: z.enum(['hse','hr','finance','operations','payroll']).optional(),
  status:       z.enum(['pending','delivered','failed']).optional(),
  limit:        z.number().int().min(1).max(200).default(50),
  offset:       z.number().int().min(0).default(0),
});

const HandoffsInSchema = z.object({
  targetModule: z.enum(['hse','hr','finance','operations','payroll']),
  processed:    z.boolean().optional(),
  limit:        z.number().int().min(1).max(200).default(50),
  offset:       z.number().int().min(0).default(0),
});

const MarkProcessedSchema = z.object({
  inboxId: zShortStr(100),
});

// ── POST /api/workflow/submit ─────────────────────────────────────────────────

router.post('/submit', async c => {
  const actor = await requirePermission(c, 'workflow.submit');
  const v = zv(c, SubmitSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { templateId, recordRef, sourceModule, targetModule, approverRole, priority, dueDate, reason, metadata } = v.data;

  const wfId  = uid('wf');
  const aprId = uid('apr');
  const evtId = uid('wfe');

  const { error: wfErr } = await sb.from('workflow_instances').insert({
    id: wfId, template_id: templateId, record_ref: recordRef,
    source_module: sourceModule, target_module: targetModule ?? null,
    status: 'pending', stage_key: 'submitted', priority,
    due_date: dueDate ?? null,
    created_by: actor.id,
    metadata: { reason, ...metadata },
  });
  if (wfErr) return c.json({ success: false, message: wfErr.message });

  const { error: aprErr } = await sb.from('approval_tasks').insert({
    id: aprId, workflow_id: wfId, approver_role: approverRole, status: 'pending',
  });
  if (aprErr) return c.json({ success: false, message: aprErr.message });

  await sb.from('workflow_events').insert({
    id: evtId, workflow_id: wfId, actor_id: actor.id,
    event: 'submitted', detail: { recordRef, templateId, reason },
  });

  await log_(actor, 'create', 'workflow', wfId, recordRef);
  return c.json({ success: true, workflowId: wfId, taskId: aprId });
});

// ── POST /api/workflow/decide ─────────────────────────────────────────────────

router.post('/decide', async c => {
  const actor = await requirePermission(c, 'workflow.approve');
  const v = zv(c, DecideSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { taskId, decision, comment, handoffs } = v.data;

  const { data: task } = await sb.from('approval_tasks')
    .select('id,workflow_id,approver_role,status')
    .eq('id', taskId)
    .maybeSingle<{ id: string; workflow_id: string; approver_role: string; status: string }>();

  if (!task)               return c.json({ success: false, message: 'Task not found' }, 404);
  if (task.status !== 'pending') return c.json({ success: false, message: 'Task already decided' });

  const wfStatus = decision === 'approved' ? 'approved'
                 : decision === 'rejected' ? 'rejected'
                 : 'returned';

  await Promise.all([
    sb.from('approval_tasks').update({
      status: decision, comment: comment ?? null,
      approver_id: actor.id, decided_at: new Date().toISOString(),
    }).eq('id', taskId),
    sb.from('workflow_instances').update({ status: wfStatus }).eq('id', task.workflow_id),
  ]);

  await sb.from('workflow_events').insert({
    id: uid('wfe'), workflow_id: task.workflow_id, actor_id: actor.id,
    event: decision, detail: { comment, taskId },
  });

  // Cross-module handoffs
  if (decision === 'approved' && handoffs.length > 0) {
    const { data: wf } = await sb.from('workflow_instances')
      .select('source_module,record_ref')
      .eq('id', task.workflow_id)
      .maybeSingle<{ source_module: string; record_ref: string }>();

    if (wf) {
      const outboxRows = handoffs.map(h => ({
        id: uid('hox'),
        source_module: wf.source_module,
        target_module: h.targetModule,
        record_ref: wf.record_ref,
        handoff_type: h.handoffType,
        payload: h.payload,
        status: 'pending',
      }));
      await sb.from('handoff_outbox').insert(outboxRows);

      // Write inbox side immediately (at-least-once pattern)
      const inboxRows = outboxRows.map(o => ({
        id: uid('hin'),
        outbox_id: o.id,
        source_module: o.source_module,
        handoff_type: o.handoff_type,
        record_ref: o.record_ref,
        payload: o.payload,
      }));
      await sb.from('handoff_inbox').insert(inboxRows);

      // Mark outbox rows as delivered
      await sb.from('handoff_outbox')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .in('id', outboxRows.map(o => o.id));
    }
  }

  await log_(actor, 'update', 'workflow', task.workflow_id, decision);
  return c.json({ success: true });
});

// ── POST /api/workflow/list ───────────────────────────────────────────────────

router.post('/list', async c => {
  const actor = await requirePermission(c, 'workflow.audit');
  const v = zv(c, ListSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { sourceModule, status, limit, offset } = v.data;

  let q = sb.from('workflow_instances')
    .select('id,template_id,record_ref,source_module,target_module,status,stage_key,priority,due_date,created_by,created_at,updated_at,metadata')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sourceModule) q = q.eq('source_module', sourceModule);
  if (status)       q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/workflow/approvals ──────────────────────────────────────────────

router.post('/approvals', async c => {
  const actor = await requirePermission(c, 'workflow.approve');
  const v = zv(c, ApprovalsSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { status, limit, offset } = v.data;

  const { data, error } = await sb.from('approval_tasks')
    .select('id,workflow_id,approver_role,status,comment,decided_at,created_at,updated_at,workflow_instances(record_ref,source_module,template_id,priority,created_by)')
    .eq('approver_role', actor.role)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/workflow/audit ──────────────────────────────────────────────────

router.post('/audit', async c => {
  await requirePermission(c, 'workflow.audit');
  const v = zv(c, AuditSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { workflowId, limit, offset } = v.data;

  let q = sb.from('workflow_events')
    .select('id,workflow_id,at,actor_id,event,detail,app_users(username,full_name)')
    .order('at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (workflowId) q = q.eq('workflow_id', workflowId);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/workflow/handoffs/out ──────────────────────────────────────────

router.post('/handoffs/out', async c => {
  await requirePermission(c, 'workflow.audit');
  const v = zv(c, HandoffsOutSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { sourceModule, status, limit, offset } = v.data;

  let q = sb.from('handoff_outbox')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sourceModule) q = q.eq('source_module', sourceModule);
  if (status)       q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/workflow/handoffs/in ───────────────────────────────────────────

router.post('/handoffs/in', async c => {
  await requirePermission(c, 'workflow.approve');
  const v = zv(c, HandoffsInSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { targetModule: _tm, processed, limit, offset } = v.data;

  let q = sb.from('handoff_inbox')
    .select('*')
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (processed !== undefined) q = q.eq('processed', processed);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/workflow/handoffs/processed ─────────────────────────────────────

router.post('/handoffs/processed', async c => {
  await requirePermission(c, 'workflow.approve');
  const v = zv(c, MarkProcessedSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const { error } = await sb.from('handoff_inbox')
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq('id', v.data.inboxId);

  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true });
});

export default router;
