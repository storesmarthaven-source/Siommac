/**
 * netlify/functions/routes/hseInvestigations.ts
 *
 * POST /api/hse/investigations/list
 * POST /api/hse/investigations/get
 * POST /api/hse/investigations/create
 * POST /api/hse/investigations/update
 * POST /api/hse/investigations/addEvidence
 * POST /api/hse/investigations/addRootCause
 */

import { Hono }              from 'hono';
import { z, zv }             from '../lib/validate';
import { requirePermission } from '../lib/auth';
import { sb }                from '../lib/db';
import { nextRef }           from '../lib/refGenerator';
import { emitAppEvent }      from '../lib/appEvents';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── POST /api/hse/investigations/list ─────────────────────────────────────────

router.post('/investigations/list', async c => {
  const user = await requirePermission(c, 'hse.investigations.manage');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { incidentId?: string; status?: string; limit?: number } | undefined;

  let q = sb
    .from('hse_investigations')
    .select('id, ref, incident_id, investigator_user_id, status, due_at, root_cause_method, created_at, closed_at')
    .order('created_at', { ascending: false })
    .limit(args?.limit ?? 50);

  if (args?.incidentId) q = q.eq('incident_id', args.incidentId);
  if (args?.status)     q = q.eq('status', args.status);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/investigations/get ──────────────────────────────────────────

router.post('/investigations/get', async c => {
  await requirePermission(c, 'hse.investigations.manage');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { investigationId?: string } | undefined;

  if (!args?.investigationId) return c.json({ success: false, message: 'investigationId required' }, 400 as 200);

  const [invRes, evidenceRes, rootCausesRes] = await Promise.all([
    sb.from('hse_investigations').select('*').eq('id', args.investigationId).maybeSingle(),
    sb.from('hse_investigation_evidence').select('*').eq('investigation_id', args.investigationId).order('created_at'),
    sb.from('hse_root_causes').select('*').eq('investigation_id', args.investigationId),
  ]);

  if (!invRes.data) return c.json({ success: false, message: 'Investigation not found' }, 404 as 200);

  return c.json({
    success: true,
    data: {
      investigation: invRes.data,
      evidence:      evidenceRes.data ?? [],
      rootCauses:    rootCausesRes.data ?? [],
    },
  });
});

// ── POST /api/hse/investigations/create ───────────────────────────────────────

const CreateInvSchema = z.object({
  incidentId:         z.string().uuid(),
  investigatorUserId: z.string().min(1).optional().nullable(),
  rootCauseMethod:    z.enum(['5why','fishbone','taproot','other']).optional().nullable(),
  dueAt:              z.string().nullable().optional(),
});

router.post('/investigations/create', async c => {
  const user = await requirePermission(c, 'hse.investigations.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, CreateInvSchema, body.args);
  if (!v.ok) return v.response;

  const ref = await nextRef('INV');

  const { data: inv, error } = await sb
    .from('hse_investigations')
    .insert({
      ref,
      incident_id:          v.data.incidentId,
      investigator_user_id: v.data.investigatorUserId ?? user.id,
      status:               'assigned',
      due_at:               v.data.dueAt ?? null,
      root_cause_method:    v.data.rootCauseMethod ?? null,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !inv) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);

  // Update parent incident status
  await sb.from('hse_incidents').update({ status: 'investigation', updated_at: new Date().toISOString() }).eq('id', v.data.incidentId);

  const investigatorId = v.data.investigatorUserId ?? user.id;
  await emitAppEvent({
    eventType:        'hse.investigation.assigned',
    sourceModule:     'hse',
    sourceEntityType: 'investigation',
    sourceEntityId:   ref,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { investigationId: inv.id, investigatorId, incidentId: v.data.incidentId },
    dedupeKey:        `hse.investigation.assigned:${ref}`,
    explicitRecipients: [{ userId: investigatorId, reason: 'assignee' as const }],
    notification: {
      title: `Investigation assigned: ${ref}`,
      body:  `You have been assigned to investigate ${ref}.`,
      actionRoute: `hse/investigations/${ref}`,
      type:  'hse.investigation.assigned',
    },
  } as Parameters<typeof emitAppEvent>[0]);

  return c.json({ success: true, investigationId: inv.id, ref });
});

// ── POST /api/hse/investigations/update ───────────────────────────────────────

const UpdateInvSchema = z.object({
  investigationId:  z.string().uuid(),
  status:           z.enum(['assigned','collecting_evidence','root_cause','findings','review','closed','overdue']).optional(),
  summary:          z.string().nullable().optional(),
  findings:         z.string().nullable().optional(),
  recommendations:  z.string().nullable().optional(),
  rootCauseMethod:  z.enum(['5why','fishbone','taproot','other']).nullable().optional(),
  dueAt:            z.string().nullable().optional(),
});

router.post('/investigations/update', async c => {
  const user = await requirePermission(c, 'hse.investigations.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, UpdateInvSchema, body.args);
  if (!v.ok) return v.response;

  const { investigationId, ...fields } = v.data;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (fields.status !== undefined)          updates.status           = fields.status;
  if (fields.summary !== undefined)         updates.summary          = fields.summary;
  if (fields.findings !== undefined)        updates.findings         = fields.findings;
  if (fields.recommendations !== undefined) updates.recommendations  = fields.recommendations;
  if (fields.rootCauseMethod !== undefined) updates.root_cause_method = fields.rootCauseMethod;
  if (fields.dueAt !== undefined)           updates.due_at           = fields.dueAt;
  if (fields.status === 'closed')           updates.closed_at        = new Date().toISOString();

  const { error } = await sb.from('hse_investigations').update(updates).eq('id', investigationId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({
    eventType:        'hse.investigation.updated',
    sourceModule:     'hse',
    sourceEntityType: 'investigation',
    sourceEntityId:   investigationId,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { changes: Object.keys(updates) },
  });

  return c.json({ success: true });
});

// ── POST /api/hse/investigations/addEvidence ──────────────────────────────────

const AddEvidenceSchema = z.object({
  investigationId: z.string().uuid(),
  evidenceType:    z.enum(['photo','document','statement','inspection','measurement','other']),
  title:           z.string().min(1).max(200),
  description:     z.string().nullable().optional(),
  attachmentId:    z.string().uuid().nullable().optional(),
  collectedAt:     z.string().nullable().optional(),
});

router.post('/investigations/addEvidence', async c => {
  const user = await requirePermission(c, 'hse.investigations.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, AddEvidenceSchema, body.args);
  if (!v.ok) return v.response;

  const { data, error } = await sb
    .from('hse_investigation_evidence')
    .insert({
      investigation_id: v.data.investigationId,
      evidence_type:    v.data.evidenceType,
      title:            v.data.title,
      description:      v.data.description ?? null,
      attachment_id:    v.data.attachmentId ?? null,
      collected_by:     user.id,
      collected_at:     v.data.collectedAt ?? null,
      status:           'collected',
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Failed' }, 500 as 200);
  return c.json({ success: true, evidenceId: data.id });
});

// ── POST /api/hse/investigations/addRootCause ─────────────────────────────────

const AddRootCauseSchema = z.object({
  investigationId:    z.string().uuid(),
  category:           z.string().min(1).max(200),
  cause:              z.string().min(1),
  contributingFactor: z.boolean().default(false),
});

router.post('/investigations/addRootCause', async c => {
  await requirePermission(c, 'hse.investigations.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, AddRootCauseSchema, body.args);
  if (!v.ok) return v.response;

  const { data, error } = await sb
    .from('hse_root_causes')
    .insert({
      investigation_id:   v.data.investigationId,
      category:           v.data.category,
      cause:              v.data.cause,
      contributing_factor: v.data.contributingFactor,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Failed' }, 500 as 200);
  return c.json({ success: true, rootCauseId: data.id });
});

export default router;
