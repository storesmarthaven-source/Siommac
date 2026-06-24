/**
 * netlify/functions/routes/hseInspections.ts
 *
 * Mounted at /api/hse. All POST-only, all permission-gated.
 *
 * Inspections (schedule + lifecycle):
 *   POST /inspections/list
 *   POST /inspections/get
 *   POST /inspections/create
 *   POST /inspections/update
 *   POST /inspections/start
 *   POST /inspections/submit
 *   POST /inspections/review        (under_review → completed)
 *   POST /inspections/reschedule
 *   POST /inspections/cancel
 *   POST /inspections/stats
 *   POST /inspections/dashboard
 *
 * Checklist execution:
 *   POST /inspections/responses/save
 *   POST /inspections/responses/create-finding
 *
 * Findings + corrective actions:
 *   POST /inspection-findings/list
 *   POST /inspection-findings/get
 *   POST /inspection-findings/create
 *   POST /inspection-findings/assign-action
 *   POST /inspection-findings/actions/update
 *   POST /inspection-findings/close
 *   POST /inspection-findings/reopen
 *   POST /inspection-findings/escalate
 *
 * Evidence:
 *   POST /inspections/evidence/add
 *
 * Templates:
 *   POST /inspection-templates/list
 *   POST /inspection-templates/get
 *   POST /inspection-templates/create
 *   POST /inspection-templates/update
 *   POST /inspection-templates/archive
 */

import { Hono }              from 'hono';
import type { Context }      from 'hono';
import { z, zv }             from '../lib/validate';
import { requirePermission } from '../lib/auth';
import { sb }                from '../lib/db';
import { nextRef }           from '../lib/refGenerator';
import { emitAppEvent }      from '../lib/appEvents';
import { runModuleMutation } from '../lib/moduleServiceAdapter';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Status machines (backend-owned) ───────────────────────────────────────────

const INSPECTION_TRANSITIONS: Record<string, string[]> = {
  draft:        ['scheduled', 'cancelled'],
  scheduled:    ['in_progress', 'rescheduled', 'cancelled', 'due_soon', 'overdue'],
  due_soon:     ['in_progress', 'overdue', 'rescheduled', 'cancelled'],
  overdue:      ['in_progress', 'rescheduled', 'cancelled'],
  rescheduled:  ['scheduled', 'in_progress', 'cancelled'],
  in_progress:  ['submitted', 'cancelled'],
  submitted:    ['under_review', 'in_progress'],
  under_review: ['completed', 'in_progress'],
  completed:    [],
  cancelled:    [],
};

function canInspectionTransition(from: string, to: string): boolean {
  return INSPECTION_TRANSITIONS[from]?.includes(to) ?? false;
}

const FINDING_TRANSITIONS: Record<string, string[]> = {
  open:           ['assigned', 'in_progress', 'cancelled', 'overdue'],
  assigned:       ['in_progress', 'awaiting_review', 'cancelled', 'overdue'],
  in_progress:    ['awaiting_review', 'cancelled', 'overdue'],
  awaiting_review:['closed', 'in_progress'],
  overdue:        ['in_progress', 'awaiting_review', 'closed', 'cancelled'],
  closed:         ['reopened'],
  reopened:       ['in_progress', 'awaiting_review', 'assigned', 'closed'],
  cancelled:      [],
};

function canFindingTransition(from: string, to: string): boolean {
  return FINDING_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Shared audit helper ───────────────────────────────────────────────────────

type AuditEntity = 'inspection' | 'finding' | 'finding_action' | 'evidence' | 'template';

function writeAudit(entityType: AuditEntity, entityId: string, action: string, actorId: string, after?: Record<string, unknown>, before?: Record<string, unknown>): void {
  void sb.from('hse_inspection_audit_events').insert({
    entity_type:   entityType,
    entity_id:     entityId,
    action,
    actor_user_id: actorId,
    before_state:  before ?? null,
    after_state:   after ?? null,
    metadata:      {},
  });
}

// ── Inspection list ───────────────────────────────────────────────────────────

const InspectionListSchema = z.object({
  status:         z.string().optional(),
  inspectionType: z.string().optional(),
  siteId:         z.string().optional(),
  assigneeId:     z.string().optional(),
  priority:       z.enum(['low', 'medium', 'high', 'critical']).optional(),
  search:         z.string().optional(),
  overdueOnly:    z.boolean().optional(),
  limit:          z.number().int().min(1).max(500).default(200),
});

const INSPECTION_COLS = [
  'id', 'inspection_no', 'ref', 'title', 'inspection_type', 'type', 'priority', 'status',
  'site_id', 'site_name', 'area', 'asset_name', 'assignee_id', 'reviewer_id',
  'due_at', 'scheduled_at', 'scheduled_date', 'started_at', 'submitted_at', 'completed_at',
  'created_at', 'updated_at',
].join(', ');

router.post('/inspections/list', async c => {
  await requirePermission(c, 'hse.inspections.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, InspectionListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('hse_inspections')
    .select(INSPECTION_COLS)
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  if (v.data.status)         q = q.eq('status', v.data.status);
  if (v.data.inspectionType) q = q.eq('inspection_type', v.data.inspectionType);
  if (v.data.siteId)         q = q.eq('site_id', v.data.siteId);
  if (v.data.assigneeId)     q = q.eq('assignee_id', v.data.assigneeId);
  if (v.data.priority)       q = q.eq('priority', v.data.priority);
  if (v.data.search)         q = q.ilike('title', `%${v.data.search}%`);
  if (v.data.overdueOnly) {
    q = q.lte('due_at', new Date().toISOString()).not('status', 'in', '("completed","cancelled")');
  }

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── Inspection get (with checklist responses, findings, evidence, timeline) ────

const GetInspectionSchema = z.object({ inspectionId: z.string().uuid() });

router.post('/inspections/get', async c => {
  await requirePermission(c, 'hse.inspections.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, GetInspectionSchema, body.args);
  if (!v.ok) return v.response;
  const id = v.data.inspectionId;

  const insp = await sb.from('hse_inspections').select('*').eq('id', id).maybeSingle();
  if (!insp.data) return c.json({ success: false, message: 'Inspection not found.' }, 404 as 200);

  const [responses, findings, evidence, audit] = await Promise.all([
    sb.from('hse_inspection_responses').select('*').eq('inspection_id', id),
    sb.from('hse_inspection_findings').select('*').eq('inspection_id', id).order('created_at', { ascending: false }),
    sb.from('hse_inspection_evidence').select('*').eq('inspection_id', id).order('uploaded_at', { ascending: false }),
    sb.from('hse_inspection_audit_events').select('*').eq('entity_type', 'inspection').eq('entity_id', id).order('created_at', { ascending: false }).limit(100),
  ]);

  // Load the template checklist items when the inspection has a template
  let checklist: unknown[] = [];
  if (insp.data.template_id) {
    const items = await sb
      .from('hse_inspection_template_items')
      .select('*')
      .eq('template_id', insp.data.template_id)
      .order('sort_order', { ascending: true });
    checklist = items.data ?? [];
  }

  return c.json({
    success: true,
    data: {
      inspection: insp.data,
      checklist,
      responses: responses.data ?? [],
      findings:  findings.data ?? [],
      evidence:  evidence.data ?? [],
      audit:     audit.data ?? [],
    },
  });
});

// ── Inspection create ─────────────────────────────────────────────────────────

const InspectionCreateSchema = z.object({
  title:          z.string().min(1).max(300),
  description:    z.string().default(''),
  inspectionType: z.string().min(1),
  priority:       z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  siteId:         z.string().nullable().optional(),
  siteName:       z.string().nullable().optional(),
  area:           z.string().nullable().optional(),
  assetId:        z.string().uuid().nullable().optional(),
  assetName:      z.string().nullable().optional(),
  departmentId:   z.string().uuid().nullable().optional(),
  templateId:     z.string().uuid().nullable().optional(),
  assigneeId:     z.string().nullable().optional(),
  reviewerId:     z.string().nullable().optional(),
  dueAt:          z.string().min(1),
  scheduledAt:    z.string().nullable().optional(),
  /** When true the inspection is created 'scheduled' instead of 'draft'. */
  scheduleImmediately: z.boolean().default(true),
  metadata:       z.record(z.string(), z.unknown()).optional(),
});

router.post('/inspections/create', async c => {
  const user = await requirePermission(c, 'hse.inspections.create');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, InspectionCreateSchema, body.args);
  if (!v.ok) return v.response;

  const initialStatus = v.data.scheduleImmediately ? 'scheduled' : 'draft';

  try {
    const result = await runModuleMutation<{ id: string; inspection_no: string }>({
      context: {
        actorUserId:  user.id,
        siteId:       v.data.siteId ?? null,
        departmentId: v.data.departmentId ? String(v.data.departmentId) : null,
      },
      options: {
        module:         'hse',
        operation:      'create',
        entityType:     'inspection',
        idempotencyKey: `hse.inspection.create:${user.id}:${v.data.inspectionType}:${v.data.title}:${v.data.dueAt}`,
        eventType:      'hse.inspection.created',
        eventSeverity:  'info',
        eventPayload:   { inspectionType: v.data.inspectionType, status: initialStatus },
        getEntityIdentity: (r) => ({ id: r.id, ref: r.inspection_no ?? r.id }),
        ...(v.data.assigneeId && v.data.assigneeId !== user.id ? {
          explicitRecipients: [{ userId: v.data.assigneeId, reason: 'assignee' as const }],
          notification: {
            title:          `Inspection assigned: ${v.data.title}`,
            body:           `A ${v.data.inspectionType} inspection is due ${v.data.dueAt}.`,
            actionRoute:    'hse/inspections',
            type:           'hse.inspection.assigned',
            actionRequired: true,
            dueAt:          v.data.dueAt,
          },
        } : {}),
        afterCommit: async ({ entityId }) => {
          writeAudit('inspection', entityId, 'created', user.id, { status: initialStatus });
        },
      },
      writeRecord: async () => {
        const inspectionNo = await nextRef('INSP');
        const now = new Date().toISOString();
        const { data, error } = await sb
          .from('hse_inspections')
          .insert({
            inspection_no:   inspectionNo,
            ref:             inspectionNo,                 // satisfy NOT NULL unique skeleton column
            title:           v.data.title,
            description:     v.data.description,
            inspection_type: v.data.inspectionType,
            type:            v.data.inspectionType,        // skeleton NOT NULL column
            priority:        v.data.priority,
            status:          initialStatus,
            site_id:         v.data.siteId ?? null,
            site_name:       v.data.siteName ?? null,
            area:            v.data.area ?? null,
            asset_id:        v.data.assetId ?? null,
            asset_name:      v.data.assetName ?? null,
            department_id:   v.data.departmentId ?? null,
            template_id:     v.data.templateId ?? null,
            assignee_id:     v.data.assigneeId ?? null,
            inspector_id:    v.data.assigneeId ?? null,    // skeleton alias
            reviewer_id:     v.data.reviewerId ?? null,
            due_at:          v.data.dueAt,
            scheduled_at:    v.data.scheduledAt ?? now,
            created_by:      user.id,
            metadata:        v.data.metadata ?? {},
            created_at:      now,
            updated_at:      now,
          })
          .select('id, inspection_no')
          .single<{ id: string; inspection_no: string }>();
        if (error || !data) throw new Error(error?.message ?? 'Insert failed');
        return data;
      },
    });

    return c.json({ success: true, data: { id: result.entityId, inspectionNo: result.entityRef } });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : 'Create failed' }, 500 as 200);
  }
});

// ── Inspection update (draft/scheduled metadata edits) ─────────────────────────

const InspectionUpdateSchema = z.object({
  inspectionId: z.string().uuid(),
  title:        z.string().min(1).max(300).optional(),
  description:  z.string().optional(),
  priority:     z.enum(['low', 'medium', 'high', 'critical']).optional(),
  area:         z.string().nullable().optional(),
  assigneeId:   z.string().nullable().optional(),
  reviewerId:   z.string().nullable().optional(),
  dueAt:        z.string().optional(),
  metadata:     z.record(z.string(), z.unknown()).optional(),
});

router.post('/inspections/update', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, InspectionUpdateSchema, body.args);
  if (!v.ok) return v.response;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.title !== undefined)       updates.title = v.data.title;
  if (v.data.description !== undefined) updates.description = v.data.description;
  if (v.data.priority !== undefined)    updates.priority = v.data.priority;
  if (v.data.area !== undefined)        updates.area = v.data.area;
  if (v.data.assigneeId !== undefined)  { updates.assignee_id = v.data.assigneeId; updates.inspector_id = v.data.assigneeId; }
  if (v.data.reviewerId !== undefined)  updates.reviewer_id = v.data.reviewerId;
  if (v.data.dueAt !== undefined)       updates.due_at = v.data.dueAt;
  if (v.data.metadata !== undefined)    updates.metadata = v.data.metadata;

  const { error } = await sb.from('hse_inspections').update(updates).eq('id', v.data.inspectionId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  writeAudit('inspection', v.data.inspectionId, 'updated', user.id, updates);
  return c.json({ success: true });
});

// ── Inspection lifecycle transitions ──────────────────────────────────────────

const TransitionSchema = z.object({
  inspectionId: z.string().uuid(),
  note:         z.string().nullable().optional(),
});

async function applyInspectionTransition(
  c: Context<{ Variables: HonoVariables }>,
  opts: { inspectionId: string; action: string; toStatus: string; actorId: string; note?: string | null },
): Promise<Response> {
  const cur = await sb
    .from('hse_inspections')
    .select('id, inspection_no, status, assignee_id, reviewer_id, created_by')
    .eq('id', opts.inspectionId)
    .maybeSingle<{ id: string; inspection_no: string | null; status: string; assignee_id: string | null; reviewer_id: string | null; created_by: string | null }>();
  if (!cur.data) return c.json({ success: false, message: 'Inspection not found.' }, 404 as 200);

  const insp = cur.data;
  if (!canInspectionTransition(insp.status, opts.toStatus)) {
    return c.json({ success: false, message: `Cannot "${opts.action}" from status "${insp.status}".` }, 400 as 200);
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status: opts.toStatus, updated_at: now };
  if (opts.toStatus === 'in_progress') updates.started_at = now;
  if (opts.toStatus === 'submitted')   updates.submitted_at = now;
  if (opts.toStatus === 'under_review')updates.reviewed_at = now;
  if (opts.toStatus === 'completed')   { updates.completed_at = now; updates.completed_date = now; }
  if (opts.toStatus === 'cancelled')   updates.cancelled_at = now;

  const { error } = await sb.from('hse_inspections').update(updates).eq('id', opts.inspectionId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  writeAudit('inspection', opts.inspectionId, opts.action, opts.actorId, { status: opts.toStatus, note: opts.note ?? null }, { status: insp.status });

  const ref = insp.inspection_no ?? opts.inspectionId;
  const severity = opts.toStatus === 'completed' ? 'success' as const : opts.toStatus === 'cancelled' ? 'warning' as const : 'info' as const;
  void emitAppEvent({
    eventType:        `hse.inspection.${opts.action}`,
    sourceModule:     'hse',
    sourceEntityType: 'inspection',
    sourceEntityId:   ref,
    actorUserId:      opts.actorId,
    severity,
    payload:          { action: opts.action, fromStatus: insp.status, toStatus: opts.toStatus, note: opts.note ?? null },
  });

  return c.json({ success: true, data: { status: opts.toStatus } });
}

router.post('/inspections/start', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, TransitionSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  return applyInspectionTransition(c, { inspectionId: v.data.inspectionId, action: 'started', toStatus: 'in_progress', actorId: user.id, note: v.data.note });
});

router.post('/inspections/submit', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, TransitionSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  // Guard: every required checklist item must be answered before submit
  const blocked = await requiredItemsAnswered(c, v.data.inspectionId);
  if (blocked) return blocked;
  return applyInspectionTransition(c, { inspectionId: v.data.inspectionId, action: 'submitted', toStatus: 'submitted', actorId: user.id, note: v.data.note });
});

router.post('/inspections/review', async c => {
  const user = await requirePermission(c, 'hse.inspections.review');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  // submitted → under_review → completed in one reviewer action; first move to under_review if needed
  const cur = await sb.from('hse_inspections').select('status').eq('id', v.data.inspectionId).maybeSingle<{ status: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Inspection not found.' }, 404 as 200);
  if (cur.data.status === 'submitted') {
    const step = await applyInspectionTransition(c, { inspectionId: v.data.inspectionId, action: 'under_review', toStatus: 'under_review', actorId: user.id, note: v.data.note });
    const sj = await step.clone().json() as { success: boolean };
    if (!sj.success) return step;
  }
  return applyInspectionTransition(c, { inspectionId: v.data.inspectionId, action: 'completed', toStatus: 'completed', actorId: user.id, note: v.data.note });
});

const RescheduleSchema = z.object({
  inspectionId: z.string().uuid(),
  newDueAt:     z.string().min(1),
  reason:       z.string().min(1),
});

router.post('/inspections/reschedule', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, RescheduleSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;

  const cur = await sb.from('hse_inspections').select('id, status, due_at').eq('id', v.data.inspectionId).maybeSingle<{ id: string; status: string; due_at: string | null }>();
  if (!cur.data) return c.json({ success: false, message: 'Inspection not found.' }, 404 as 200);
  if (['completed', 'cancelled'].includes(cur.data.status)) {
    return c.json({ success: false, message: `Cannot reschedule a ${cur.data.status} inspection.` }, 400 as 200);
  }

  const now = new Date().toISOString();
  const { error } = await sb.from('hse_inspections')
    .update({ due_at: v.data.newDueAt, status: 'scheduled', updated_at: now })
    .eq('id', v.data.inspectionId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  writeAudit('inspection', v.data.inspectionId, 'rescheduled', user.id, { newDueAt: v.data.newDueAt, reason: v.data.reason }, { dueAt: cur.data.due_at });
  return c.json({ success: true });
});

router.post('/inspections/cancel', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, TransitionSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  return applyInspectionTransition(c, { inspectionId: v.data.inspectionId, action: 'cancelled', toStatus: 'cancelled', actorId: user.id, note: v.data.note });
});

// Guard helper: required checklist items answered
async function requiredItemsAnswered(c: Context<{ Variables: HonoVariables }>, inspectionId: string): Promise<Response | null> {
  const insp = await sb.from('hse_inspections').select('template_id').eq('id', inspectionId).maybeSingle<{ template_id: string | null }>();
  if (!insp.data?.template_id) return null; // no template → nothing to enforce
  const [items, responses] = await Promise.all([
    sb.from('hse_inspection_template_items').select('id, is_required').eq('template_id', insp.data.template_id).eq('is_required', true),
    sb.from('hse_inspection_responses').select('template_item_id, response_status').eq('inspection_id', inspectionId),
  ]);
  const answered = new Set((responses.data ?? [])
    .filter(r => r.response_status && r.response_status !== 'unanswered')
    .map(r => r.template_item_id as string));
  const missing = (items.data ?? []).filter(i => !answered.has(i.id as string)).length;
  if (missing > 0) {
    return c.json({ success: false, message: `${missing} required checklist item(s) are unanswered.` }, 400 as 200);
  }
  return null;
}

// ── Checklist responses ───────────────────────────────────────────────────────

const ResponseSaveSchema = z.object({
  inspectionId:   z.string().uuid(),
  templateItemId: z.string().uuid(),
  responseStatus: z.enum(['unanswered', 'passed', 'failed', 'not_applicable', 'requires_follow_up']),
  responseValue:  z.string().nullable().optional(),
  comment:        z.string().nullable().optional(),
});

router.post('/inspections/responses/save', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, ResponseSaveSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('hse_inspection_responses')
    .upsert({
      inspection_id:    v.data.inspectionId,
      template_item_id: v.data.templateItemId,
      response_status:  v.data.responseStatus,
      response_value:   v.data.responseValue ?? null,
      comment:          v.data.comment ?? null,
      answered_by:      user.id,
      answered_at:      now,
    }, { onConflict: 'inspection_id,template_item_id' })
    .select('id, finding_id')
    .single<{ id: string; finding_id: string | null }>();
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Save failed' }, 500 as 200);

  // Auto-create a finding when a critical item fails and the template asks for it
  let autoFindingId: string | null = data.finding_id;
  if (v.data.responseStatus === 'failed' && !data.finding_id) {
    const item = await sb
      .from('hse_inspection_template_items')
      .select('question, is_critical, auto_create_finding_on_fail')
      .eq('id', v.data.templateItemId)
      .maybeSingle<{ question: string; is_critical: boolean; auto_create_finding_on_fail: boolean }>();
    if (item.data?.auto_create_finding_on_fail) {
      autoFindingId = await createFindingRecord({
        inspectionId: v.data.inspectionId,
        responseId:   data.id,
        title:        `Failed: ${item.data.question}`.slice(0, 280),
        description:  v.data.comment ?? null,
        severity:     item.data.is_critical ? 'critical' : 'medium',
        actorId:      user.id,
      });
      if (autoFindingId) {
        await sb.from('hse_inspection_responses').update({ finding_id: autoFindingId }).eq('id', data.id);
      }
    }
  }

  return c.json({ success: true, data: { id: data.id, findingId: autoFindingId } });
});

// Shared finding-creation routine (used by manual create + auto-create on fail)
async function createFindingRecord(args: {
  inspectionId: string | null;
  responseId?:  string | null;
  title:        string;
  description?: string | null;
  severity:     'critical' | 'high' | 'medium' | 'low' | 'observation';
  category?:    string | null;
  ownerId?:     string | null;
  dueAt?:       string | null;
  siteId?:      string | null;
  area?:        string | null;
  actorId:      string;
}): Promise<string | null> {
  const findingNo = await nextRef('FND');
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('hse_inspection_findings')
    .insert({
      finding_no:    findingNo,
      inspection_id: args.inspectionId,
      response_id:   args.responseId ?? null,
      title:         args.title,
      description:   args.description ?? args.title,
      severity:      args.severity,
      status:        args.ownerId ? 'assigned' : 'open',
      category:      args.category ?? null,
      owner_id:      args.ownerId ?? null,
      due_at:        args.dueAt ?? null,
      site_id:       args.siteId ?? null,
      area:          args.area ?? null,
      created_by:    args.actorId,
      created_at:    now,
      updated_at:    now,
    })
    .select('id, finding_no')
    .single<{ id: string; finding_no: string }>();
  if (error || !data) return null;

  writeAudit('finding', data.id, 'created', args.actorId, { severity: args.severity, status: args.ownerId ? 'assigned' : 'open' });
  void emitAppEvent({
    eventType:        'hse.inspection_finding.created',
    sourceModule:     'hse',
    sourceEntityType: 'inspection_finding',
    sourceEntityId:   data.finding_no,
    actorUserId:      args.actorId,
    severity:         args.severity === 'critical' ? 'warning' : 'info',
    payload:          { inspectionId: args.inspectionId, severity: args.severity },
    ...(args.ownerId && args.ownerId !== args.actorId ? {
      explicitRecipients: [{ userId: args.ownerId, reason: 'owner' as const }],
      notification: {
        title:          `Finding assigned: ${args.title}`.slice(0, 120),
        actionRoute:    'hse/inspections',
        type:           'hse.inspection_finding.assigned',
        actionRequired: true,
      },
    } : {}),
  });
  return data.id;
}

const CreateFindingSchema = z.object({
  inspectionId: z.string().uuid(),
  responseId:   z.string().uuid().nullable().optional(),
  title:        z.string().min(1).max(280),
  description:  z.string().nullable().optional(),
  severity:     z.enum(['critical', 'high', 'medium', 'low', 'observation']),
  category:     z.string().nullable().optional(),
  ownerId:      z.string().nullable().optional(),
  dueAt:        z.string().nullable().optional(),
  siteId:       z.string().nullable().optional(),
  area:         z.string().nullable().optional(),
});

router.post('/inspections/responses/create-finding', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, CreateFindingSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const id = await createFindingRecord({ ...v.data, actorId: user.id });
  if (!id) return c.json({ success: false, message: 'Finding creation failed.' }, 500 as 200);
  if (v.data.responseId) await sb.from('hse_inspection_responses').update({ finding_id: id }).eq('id', v.data.responseId);
  return c.json({ success: true, data: { id } });
});

// ── Findings ──────────────────────────────────────────────────────────────────

const FindingListSchema = z.object({
  status:       z.string().optional(),
  severity:     z.string().optional(),
  ownerId:      z.string().optional(),
  inspectionId: z.string().uuid().optional(),
  openOnly:     z.boolean().optional(),
  limit:        z.number().int().min(1).max(500).default(200),
});

router.post('/inspection-findings/list', async c => {
  await requirePermission(c, 'hse.inspections.view');
  const v = zv(c, FindingListSchema, (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;

  let q = sb.from('hse_inspection_findings')
    .select('id, finding_no, inspection_id, title, description, category, severity, status, site_name, area, owner_id, reviewer_id, due_at, closed_at, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(v.data.limit);
  if (v.data.status)       q = q.eq('status', v.data.status);
  if (v.data.severity)     q = q.eq('severity', v.data.severity);
  if (v.data.ownerId)      q = q.eq('owner_id', v.data.ownerId);
  if (v.data.inspectionId) q = q.eq('inspection_id', v.data.inspectionId);
  if (v.data.openOnly)     q = q.not('status', 'in', '("closed","cancelled")');

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

router.post('/inspection-findings/get', async c => {
  await requirePermission(c, 'hse.inspections.view');
  const v = zv(c, z.object({ findingId: z.string().uuid() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const id = v.data.findingId;

  const finding = await sb.from('hse_inspection_findings').select('*').eq('id', id).maybeSingle();
  if (!finding.data) return c.json({ success: false, message: 'Finding not found.' }, 404 as 200);

  const [actions, evidence, audit] = await Promise.all([
    sb.from('hse_inspection_finding_actions').select('*').eq('finding_id', id).order('created_at', { ascending: false }),
    sb.from('hse_inspection_evidence').select('*').eq('finding_id', id).order('uploaded_at', { ascending: false }),
    sb.from('hse_inspection_audit_events').select('*').eq('entity_type', 'finding').eq('entity_id', id).order('created_at', { ascending: false }).limit(100),
  ]);

  return c.json({ success: true, data: { finding: finding.data, actions: actions.data ?? [], evidence: evidence.data ?? [], audit: audit.data ?? [] } });
});

router.post('/inspection-findings/create', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, CreateFindingSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const id = await createFindingRecord({ ...v.data, actorId: user.id });
  if (!id) return c.json({ success: false, message: 'Finding creation failed.' }, 500 as 200);
  return c.json({ success: true, data: { id } });
});

const AssignActionSchema = z.object({
  findingId:         z.string().uuid(),
  actionDescription: z.string().min(1),
  ownerId:           z.string().nullable().optional(),
  dueAt:             z.string().nullable().optional(),
});

router.post('/inspection-findings/assign-action', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, AssignActionSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;

  const cur = await sb.from('hse_inspection_findings').select('id, status').eq('id', v.data.findingId).maybeSingle<{ id: string; status: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Finding not found.' }, 404 as 200);

  const now = new Date().toISOString();
  const { data, error } = await sb.from('hse_inspection_finding_actions').insert({
    finding_id:         v.data.findingId,
    action_description: v.data.actionDescription,
    owner_id:           v.data.ownerId ?? null,
    due_at:             v.data.dueAt ?? null,
    status:             'open',
    created_by:         user.id,
    created_at:         now,
    updated_at:         now,
  }).select('id').single<{ id: string }>();
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);

  // Move the finding forward to assigned/in_progress
  if (canFindingTransition(cur.data.status, 'assigned')) {
    await sb.from('hse_inspection_findings').update({ status: 'assigned', updated_at: now }).eq('id', v.data.findingId);
  }
  writeAudit('finding', v.data.findingId, 'action_assigned', user.id, { actionId: data.id, ownerId: v.data.ownerId ?? null });
  return c.json({ success: true, data: { id: data.id } });
});

const ActionUpdateSchema = z.object({
  actionId: z.string().uuid(),
  status:   z.enum(['open', 'in_progress', 'awaiting_review', 'completed', 'rejected', 'cancelled']),
  note:     z.string().nullable().optional(),
});

router.post('/inspection-findings/actions/update', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, ActionUpdateSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status: v.data.status, updated_at: now };
  if (v.data.status === 'completed') updates.completed_at = now;
  const { error } = await sb.from('hse_inspection_finding_actions').update(updates).eq('id', v.data.actionId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  writeAudit('finding_action', v.data.actionId, `action_${v.data.status}`, user.id, { status: v.data.status, note: v.data.note ?? null });
  return c.json({ success: true });
});

async function applyFindingTransition(
  c: Context<{ Variables: HonoVariables }>,
  opts: { findingId: string; action: string; toStatus: string; actorId: string; note?: string | null },
): Promise<Response> {
  const cur = await sb.from('hse_inspection_findings').select('id, finding_no, status, severity').eq('id', opts.findingId).maybeSingle<{ id: string; finding_no: string | null; status: string; severity: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Finding not found.' }, 404 as 200);
  if (!canFindingTransition(cur.data.status, opts.toStatus)) {
    return c.json({ success: false, message: `Cannot "${opts.action}" from status "${cur.data.status}".` }, 400 as 200);
  }
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status: opts.toStatus, updated_at: now };
  if (opts.toStatus === 'closed')   updates.closed_at = now;
  if (opts.toStatus === 'reopened') updates.closed_at = null;
  const { error } = await sb.from('hse_inspection_findings').update(updates).eq('id', opts.findingId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  writeAudit('finding', opts.findingId, opts.action, opts.actorId, { status: opts.toStatus, note: opts.note ?? null }, { status: cur.data.status });
  void emitAppEvent({
    eventType:        `hse.inspection_finding.${opts.action}`,
    sourceModule:     'hse',
    sourceEntityType: 'inspection_finding',
    sourceEntityId:   cur.data.finding_no ?? opts.findingId,
    actorUserId:      opts.actorId,
    severity:         opts.toStatus === 'closed' ? 'success' : 'info',
    payload:          { action: opts.action, toStatus: opts.toStatus, note: opts.note ?? null },
  });
  return c.json({ success: true, data: { status: opts.toStatus } });
}

const FindingTransitionSchema = z.object({ findingId: z.string().uuid(), note: z.string().nullable().optional() });

router.post('/inspection-findings/close', async c => {
  const user = await requirePermission(c, 'hse.inspections.review');
  const v = zv(c, FindingTransitionSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  // Move through awaiting_review if currently in_progress/assigned/open/overdue
  const cur = await sb.from('hse_inspection_findings').select('status').eq('id', v.data.findingId).maybeSingle<{ status: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Finding not found.' }, 404 as 200);
  if (cur.data.status !== 'awaiting_review' && canFindingTransition(cur.data.status, 'awaiting_review')) {
    const step = await applyFindingTransition(c, { findingId: v.data.findingId, action: 'submitted_for_review', toStatus: 'awaiting_review', actorId: user.id, note: v.data.note });
    const sj = await step.clone().json() as { success: boolean };
    if (!sj.success) return step;
  }
  return applyFindingTransition(c, { findingId: v.data.findingId, action: 'closed', toStatus: 'closed', actorId: user.id, note: v.data.note });
});

router.post('/inspection-findings/reopen', async c => {
  const user = await requirePermission(c, 'hse.inspections.review');
  const v = zv(c, FindingTransitionSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  return applyFindingTransition(c, { findingId: v.data.findingId, action: 'reopened', toStatus: 'reopened', actorId: user.id, note: v.data.note });
});

router.post('/inspection-findings/escalate', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, FindingTransitionSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const cur = await sb.from('hse_inspection_findings').select('id, finding_no, severity, status').eq('id', v.data.findingId).maybeSingle<{ id: string; finding_no: string | null; severity: string; status: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Finding not found.' }, 404 as 200);
  await sb.from('hse_inspection_findings').update({ severity: 'critical', updated_at: new Date().toISOString() }).eq('id', v.data.findingId);
  writeAudit('finding', v.data.findingId, 'escalated', user.id, { severity: 'critical', note: v.data.note ?? null }, { severity: cur.data.severity });
  void emitAppEvent({
    eventType:        'hse.inspection_finding.escalated',
    sourceModule:     'hse',
    sourceEntityType: 'inspection_finding',
    sourceEntityId:   cur.data.finding_no ?? v.data.findingId,
    actorUserId:      user.id,
    severity:         'warning',
    payload:          { note: v.data.note ?? null },
  });
  return c.json({ success: true });
});

// ── Evidence (metadata record; file already uploaded to storage) ──────────────

const EvidenceSchema = z.object({
  inspectionId: z.string().uuid().nullable().optional(),
  findingId:    z.string().uuid().nullable().optional(),
  responseId:   z.string().uuid().nullable().optional(),
  fileName:     z.string().min(1),
  filePath:     z.string().min(1),
  fileUrl:      z.string().nullable().optional(),
  fileType:     z.string().nullable().optional(),
  fileSize:     z.number().int().nullable().optional(),
  evidenceType: z.enum(['photo', 'document', 'signature', 'checklist', 'corrective_action', 'other']).default('document'),
});

router.post('/inspections/evidence/add', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, EvidenceSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  if (!v.data.inspectionId && !v.data.findingId) {
    return c.json({ success: false, message: 'Evidence must link to an inspection or a finding.' }, 400 as 200);
  }
  const { data, error } = await sb.from('hse_inspection_evidence').insert({
    inspection_id: v.data.inspectionId ?? null,
    finding_id:    v.data.findingId ?? null,
    response_id:   v.data.responseId ?? null,
    file_name:     v.data.fileName,
    file_path:     v.data.filePath,
    file_url:      v.data.fileUrl ?? null,
    file_type:     v.data.fileType ?? null,
    file_size:     v.data.fileSize ?? null,
    evidence_type: v.data.evidenceType,
    uploaded_by:   user.id,
  }).select('id').single<{ id: string }>();
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);
  writeAudit('evidence', data.id, 'uploaded', user.id, { evidenceType: v.data.evidenceType });
  return c.json({ success: true, data: { id: data.id } });
});

// ── Templates ─────────────────────────────────────────────────────────────────

router.post('/inspection-templates/list', async c => {
  await requirePermission(c, 'hse.inspections.view');
  const v = zv(c, z.object({ inspectionType: z.string().optional(), activeOnly: z.boolean().default(true) }), (c.get('body') as Record<string, unknown>).args ?? {});
  if (!v.ok) return v.response;
  let q = sb.from('hse_inspection_templates').select('id, name, inspection_type, description, is_active, created_at').order('name', { ascending: true });
  if (v.data.inspectionType) q = q.eq('inspection_type', v.data.inspectionType);
  if (v.data.activeOnly)     q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

router.post('/inspection-templates/get', async c => {
  await requirePermission(c, 'hse.inspections.view');
  const v = zv(c, z.object({ templateId: z.string().uuid() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const id = v.data.templateId;
  const tpl = await sb.from('hse_inspection_templates').select('*').eq('id', id).maybeSingle();
  if (!tpl.data) return c.json({ success: false, message: 'Template not found.' }, 404 as 200);
  const [sections, items] = await Promise.all([
    sb.from('hse_inspection_template_sections').select('*').eq('template_id', id).order('sort_order', { ascending: true }),
    sb.from('hse_inspection_template_items').select('*').eq('template_id', id).order('sort_order', { ascending: true }),
  ]);
  return c.json({ success: true, data: { template: tpl.data, sections: sections.data ?? [], items: items.data ?? [] } });
});

const TemplateItemSchema = z.object({
  question:                 z.string().min(1),
  helpText:                 z.string().nullable().optional(),
  responseType:             z.enum(['pass_fail_na', 'yes_no_na', 'numeric', 'text', 'photo_required', 'signature', 'multi_select']),
  isRequired:               z.boolean().default(true),
  isCritical:               z.boolean().default(false),
  requiresEvidenceOnFail:   z.boolean().default(false),
  autoCreateFindingOnFail:  z.boolean().default(false),
  sortOrder:                z.number().int().default(0),
});

const TemplateCreateSchema = z.object({
  name:           z.string().min(1),
  inspectionType: z.string().min(1),
  description:    z.string().nullable().optional(),
  items:          z.array(TemplateItemSchema).default([]),
});

router.post('/inspection-templates/create', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, TemplateCreateSchema, (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;

  const now = new Date().toISOString();
  const { data, error } = await sb.from('hse_inspection_templates').insert({
    name:            v.data.name,
    inspection_type: v.data.inspectionType,
    description:     v.data.description ?? null,
    is_active:       true,
    created_by:      user.id,
    created_at:      now,
    updated_at:      now,
  }).select('id').single<{ id: string }>();
  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);

  if (v.data.items.length > 0) {
    const rows = v.data.items.map((it, idx) => ({
      template_id:                 data.id,
      question:                    it.question,
      help_text:                   it.helpText ?? null,
      response_type:               it.responseType,
      is_required:                 it.isRequired,
      is_critical:                 it.isCritical,
      requires_evidence_on_fail:   it.requiresEvidenceOnFail,
      auto_create_finding_on_fail: it.autoCreateFindingOnFail,
      sort_order:                  it.sortOrder || idx,
    }));
    await sb.from('hse_inspection_template_items').insert(rows);
  }
  writeAudit('template', data.id, 'created', user.id, { name: v.data.name });
  return c.json({ success: true, data: { id: data.id } });
});

router.post('/inspection-templates/update', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, z.object({
    templateId:  z.string().uuid(),
    name:        z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    isActive:    z.boolean().optional(),
  }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.data.name !== undefined)        updates.name = v.data.name;
  if (v.data.description !== undefined) updates.description = v.data.description;
  if (v.data.isActive !== undefined)    updates.is_active = v.data.isActive;
  const { error } = await sb.from('hse_inspection_templates').update(updates).eq('id', v.data.templateId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  writeAudit('template', v.data.templateId, 'updated', user.id, updates);
  return c.json({ success: true });
});

router.post('/inspection-templates/archive', async c => {
  const user = await requirePermission(c, 'hse.inspections.manage');
  const v = zv(c, z.object({ templateId: z.string().uuid() }), (c.get('body') as Record<string, unknown>).args);
  if (!v.ok) return v.response;
  const { error } = await sb.from('hse_inspection_templates').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', v.data.templateId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  writeAudit('template', v.data.templateId, 'archived', user.id);
  return c.json({ success: true });
});

// ── Stats + dashboard ─────────────────────────────────────────────────────────

router.post('/inspections/stats', async c => {
  await requirePermission(c, 'hse.inspections.view');
  return c.json({ success: true, data: await computeStats() });
});

router.post('/inspections/dashboard', async c => {
  await requirePermission(c, 'hse.inspections.view');
  return c.json({ success: true, data: await computeStats() });
});

async function computeStats() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const yearStart  = new Date(now.getFullYear(), 0, 1).toISOString();
  const nowIso     = now.toISOString();
  const soon       = new Date(now.getTime() + 7 * 86400000).toISOString();

  const openStatuses = '("draft","scheduled","due_soon","overdue","in_progress","submitted","under_review","rescheduled")';

  const [scheduledThisMonth, overdue, dueThisWeek, completedYtd, totalYtd, openFindings, criticalFindings, closedFindingsYtd] = await Promise.all([
    sb.from('hse_inspections').select('id', { count: 'exact', head: true }).gte('due_at', monthStart).lt('due_at', monthEnd).not('status', 'in', '("completed","cancelled")'),
    sb.from('hse_inspections').select('id', { count: 'exact', head: true }).lte('due_at', nowIso).not('status', 'in', '("completed","cancelled")'),
    sb.from('hse_inspections').select('id', { count: 'exact', head: true }).gte('due_at', nowIso).lte('due_at', soon).not('status', 'in', '("completed","cancelled")'),
    sb.from('hse_inspections').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', yearStart),
    sb.from('hse_inspections').select('id', { count: 'exact', head: true }).gte('created_at', yearStart),
    sb.from('hse_inspection_findings').select('id', { count: 'exact', head: true }).not('status', 'in', '("closed","cancelled")'),
    sb.from('hse_inspection_findings').select('id', { count: 'exact', head: true }).eq('severity', 'critical').not('status', 'in', '("closed","cancelled")'),
    sb.from('hse_inspection_findings').select('id', { count: 'exact', head: true }).eq('status', 'closed').gte('created_at', yearStart),
  ]);

  const completed = completedYtd.count ?? 0;
  const total = totalYtd.count ?? 0;
  const openF = openFindings.count ?? 0;
  const closedF = closedFindingsYtd.count ?? 0;
  void openStatuses;

  return {
    scheduledThisMonth: scheduledThisMonth.count ?? 0,
    overdue:            overdue.count ?? 0,
    dueThisWeek:        dueThisWeek.count ?? 0,
    completedYtd:       completed,
    completionRate:     total > 0 ? Math.round((completed / total) * 100) : 0,
    openFindings:       openF,
    criticalFindings:   criticalFindings.count ?? 0,
    closedFindingsYtd:  closedF,
    closureRate:        (openF + closedF) > 0 ? Math.round((closedF / (openF + closedF)) * 100) : 0,
  };
}

export default router;
