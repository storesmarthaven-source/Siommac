/**
 * netlify/functions/routes/hseRiskJsa.ts
 *
 * POST /api/hse/risk-jsa/summary
 * POST /api/hse/risk-jsa/hazards/list
 * POST /api/hse/risk-jsa/hazards/create
 * POST /api/hse/risk-jsa/hazards/detail
 * POST /api/hse/risk-jsa/hazards/update
 * POST /api/hse/risk-jsa/assessments/list
 * POST /api/hse/risk-jsa/assessments/create
 * POST /api/hse/risk-jsa/assessments/detail
 * POST /api/hse/risk-jsa/assessments/submit
 * POST /api/hse/risk-jsa/jsa/list
 * POST /api/hse/risk-jsa/jsa/create
 * POST /api/hse/risk-jsa/jsa/detail
 * POST /api/hse/risk-jsa/jsa/submit
 * POST /api/hse/risk-jsa/controls/create
 * POST /api/hse/risk-jsa/controls/verify
 * POST /api/hse/risk-jsa/review
 * POST /api/hse/risk-jsa/hazards/submit
 * POST /api/hse/risk-jsa/templates/list
 * POST /api/hse/risk-jsa/templates/duplicate
 */

import { Hono }              from 'hono';
import { z, zv }             from '../lib/validate';
import { requirePermission } from '../lib/auth';
import { sb }                from '../lib/db';
import { nextRef }           from '../lib/refGenerator';
import { emitAppEvent }      from '../lib/appEvents';
import { runModuleMutation } from '../lib/moduleServiceAdapter';
import { createWorkflow }   from '../lib/workflowEngine';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Risk level helper ─────────────────────────────────────────────────────────
// Canonical 5×5 bands (must match src/.../shared/RiskScorePill.ts calculateRiskBand):
//   1–5 low · 6–9 medium · 10–16 high · 17–25 critical

function riskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score <= 5)  return 'low';
  if (score <= 9)  return 'medium';
  if (score <= 16) return 'high';
  return 'critical';
}

// ── POST /api/hse/risk-jsa/summary ────────────────────────────────────────────

router.post('/risk-jsa/summary', async c => {
  await requirePermission(c, 'hse.risk.view');
  const now = new Date().toISOString();

  const [
    hazardCounts,
    highRiskHazards,
    openAssessments,
    pendingReviewRA,
    overdueRA,
    openJsa,
    recentHighRisk,
    overdueAssessmentsDetail,
  ] = await Promise.all([
    sb.from('hse_hazards')
      .select('risk_level, status')
      .not('status', 'eq', 'archived'),

    sb.from('hse_hazards')
      .select('id, ref, title, category, initial_likelihood, initial_severity, initial_score, risk_level, status, site_id')
      .in('risk_level', ['high', 'critical'])
      .not('status', 'eq', 'archived')
      .order('initial_score', { ascending: false })
      .limit(10),

    sb.from('hse_risk_assessments')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '(archived,expired)'),

    sb.from('hse_risk_assessments')
      .select('id', { count: 'exact', head: true })
      .in('status', ['submitted', 'under_review']),

    sb.from('hse_risk_assessments')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '(archived,expired,approved,active)')
      .not('review_due_at', 'is', null)
      .lt('review_due_at', now),

    sb.from('hse_jsa')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '(archived,expired)'),

    sb.from('hse_hazards')
      .select('id, ref, title, category, initial_score, risk_level')
      .in('risk_level', ['high', 'critical'])
      .not('status', 'eq', 'archived')
      .order('initial_score', { ascending: false })
      .limit(5),

    sb.from('hse_risk_assessments')
      .select('id, ref, title, review_due_at, status')
      .not('status', 'in', '(archived,expired,approved,active)')
      .not('review_due_at', 'is', null)
      .lt('review_due_at', now)
      .order('review_due_at', { ascending: true })
      .limit(4),
  ]);

  const hazards = hazardCounts.data ?? [];
  const totalHazards   = hazards.length;
  const highCritical   = hazards.filter(h => h.risk_level === 'high' || h.risk_level === 'critical').length;
  const lowMedium      = hazards.filter(h => h.risk_level === 'low' || h.risk_level === 'medium').length;
  const riskPct        = totalHazards > 0 ? Math.round((lowMedium / totalHazards) * 100) : 0;

  return c.json({
    success: true,
    data: {
      totalHazards,
      highCriticalHazards: highCritical,
      openAssessments:     openAssessments.count     ?? 0,
      pendingReview:       pendingReviewRA.count      ?? 0,
      overdueAssessments:  overdueRA.count            ?? 0,
      openJsa:             openJsa.count              ?? 0,
      riskReductionPct:    riskPct,
      highRiskQueue:       highRiskHazards.data       ?? [],
      recentHighRisk:      recentHighRisk.data        ?? [],
      overdueAssessmentsDetail: overdueAssessmentsDetail.data ?? [],
    },
  });
});

// ── POST /api/hse/risk-jsa/hazards/list ──────────────────────────────────────

const HazardListSchema = z.object({
  search:     z.string().optional(),
  category:   z.string().nullable().optional(),
  siteId:     z.string().nullable().optional(),
  riskLevel:  z.string().nullable().optional(),
  status:     z.string().nullable().optional(),
  limit:      z.number().int().min(1).max(200).default(50),
  cursor:     z.string().nullable().optional(),
});

router.post('/risk-jsa/hazards/list', async c => {
  await requirePermission(c, 'hse.risk.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, HazardListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('hse_hazards')
    .select('id, ref, title, category, site_id, location_text, department_id, initial_likelihood, initial_severity, initial_score, residual_likelihood, residual_severity, residual_score, risk_level, status, owner_user_id, review_due_at, created_at')
    .order('initial_score', { ascending: false })
    .limit(v.data.limit);

  if (v.data.category)  q = q.eq('category', v.data.category);
  if (v.data.siteId)    q = q.eq('site_id', v.data.siteId);
  if (v.data.riskLevel) q = q.eq('risk_level', v.data.riskLevel);
  if (v.data.status)    q = q.eq('status', v.data.status);
  if (v.data.cursor)    q = q.lt('initial_score', parseInt(v.data.cursor, 10));
  if (v.data.search)    q = q.ilike('title', `%${v.data.search}%`);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/risk-jsa/hazards/create ────────────────────────────────────

const HazardCreateSchema = z.object({
  title:               z.string().min(1).max(300),
  description:         z.string().default(''),
  category:            z.string().min(1),
  siteId:              z.string().nullable().optional(),
  departmentId:        z.string().nullable().optional(),
  locationText:        z.string().nullable().optional(),
  ownerUserId:         z.string().nullable().optional(),
  initialLikelihood:   z.number().int().min(1).max(5),
  initialSeverity:     z.number().int().min(1).max(5),
  residualLikelihood:  z.number().int().min(1).max(5).nullable().optional(),
  residualSeverity:    z.number().int().min(1).max(5).nullable().optional(),
  status:              z.enum(['draft','registered']).default('registered'),
  reviewDueAt:         z.string().nullable().optional(),
  controls:            z.array(z.object({
    description:  z.string().min(1),
    controlType:  z.string().default('administrative'),
    ownerUserId:  z.string().nullable().optional(),
    dueAt:        z.string().nullable().optional(),
  })).default([]),
});

router.post('/risk-jsa/hazards/create', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, HazardCreateSchema, body.args);
  if (!v.ok) return v.response;

  const score       = v.data.initialLikelihood * v.data.initialSeverity;
  const level       = riskLevel(score);
  const ownerUserId = v.data.ownerUserId ?? user.id;
  const needsReview = level === 'high' || level === 'critical';

  try {
    const result = await runModuleMutation<{ id: string; ref: string }>({
      context: {
        actorUserId:  user.id,
        siteId:       v.data.siteId ?? null,
        departmentId: v.data.departmentId ?? null,
      },
      options: {
        module:         'hse',
        operation:      'create',
        entityType:     'hazard',
        idempotencyKey: `hse.hazard.create:${user.id}:${v.data.title}:${v.data.category}`,
        eventType:      'hse.hazard.registered',
        eventSeverity:  level === 'critical' ? 'critical' : level === 'high' ? 'high' : 'info',
        eventPayload:   { title: v.data.title, category: v.data.category, score, riskLevel: level },
        notification:   needsReview ? {
          title: `High-risk hazard registered: ${v.data.category}`,
          body:  `${v.data.title} scored ${score} — controls and review required.`,
          actionRoute: 'hse/risk-jsa',
          type:  'hse.hazard.registered',
        } : undefined,
        workflow: needsReview ? {
          templateKey: 'hse_hazard_review',
          priority:    level === 'critical' ? 'critical' : 'high',
          ownerUserId,
          reason:      `High-risk hazard: ${v.data.title} (score ${score})`,
          condition:   true,
          metadata:    { category: v.data.category, score, riskLevel: level },
        } : undefined,
        getEntityIdentity: (r) => ({ id: r.id, ref: r.ref }),
        afterCommit: async ({ entityId, workflowId }) => {
          if (workflowId) {
            await sb.from('hse_hazards')
              .update({ workflow_id: workflowId, status: 'assessment_required' })
              .eq('id', entityId);
          }
        },
      },
      writeRecord: async () => {
        const ref = await nextRef('HAZ');
        const { data, error } = await sb
          .from('hse_hazards')
          .insert({
            ref,
            title:               v.data.title,
            description:         v.data.description,
            category:            v.data.category,
            site_id:             v.data.siteId ?? null,
            department_id:       v.data.departmentId ?? null,
            location_text:       v.data.locationText ?? null,
            owner_user_id:       ownerUserId,
            initial_likelihood:  v.data.initialLikelihood,
            initial_severity:    v.data.initialSeverity,
            residual_likelihood: v.data.residualLikelihood ?? null,
            residual_severity:   v.data.residualSeverity   ?? null,
            risk_level:          level,
            status:              v.data.status,
            review_due_at:       v.data.reviewDueAt ?? null,
            created_by:          user.id,
          })
          .select('id, ref')
          .single<{ id: string; ref: string }>();

        if (error || !data) throw error ?? new Error('Hazard insert failed');

        // Insert initial controls
        if (v.data.controls.length > 0) {
          await sb.from('hse_controls').insert(
            v.data.controls.map(ctrl => ({
              source_type:   'hazard',
              source_id:     data.id,
              hazard_id:     data.id,
              description:   ctrl.description,
              control_type:  ctrl.controlType,
              owner_user_id: ctrl.ownerUserId ?? user.id,
              due_at:        ctrl.dueAt ?? null,
              status:        'planned',
              created_by:    user.id,
            })),
          );
        }

        return data;
      },
    });

    return c.json({
      success: true,
      data: {
        id:         result.entityId,
        ref:        result.entityRef,
        workflowId: result.workflowId  ?? null,
        eventId:    result.eventId     ?? null,
        riskLevel:  level,
        score,
      },
    });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Create failed' }, 500 as 200);
  }
});

// ── POST /api/hse/risk-jsa/hazards/detail ────────────────────────────────────

router.post('/risk-jsa/hazards/detail', async c => {
  await requirePermission(c, 'hse.risk.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { hazardId?: string; ref?: string } | undefined;

  if (!args?.hazardId && !args?.ref) {
    return c.json({ success: false, message: 'hazardId or ref required' }, 400 as 200);
  }

  let q = sb.from('hse_hazards').select('*');
  if (args.hazardId) q = q.eq('id', args.hazardId);
  else               q = q.eq('ref', args.ref!);

  const hazardRes = await q.maybeSingle();
  if (!hazardRes.data) return c.json({ success: false, message: 'Hazard not found' }, 404 as 200);

  const hazardId  = (hazardRes.data as Record<string, unknown>).id as string;
  const hazardRef = (hazardRes.data as Record<string, unknown>).ref as string;
  const workflowId = (hazardRes.data as Record<string, unknown>).workflow_id as string | null;

  const [controlsRes, raRes, capaRes, timelineRes, wfRes] = await Promise.all([
    sb.from('hse_controls').select('*').eq('source_type', 'hazard').eq('source_id', hazardId).order('created_at'),
    sb.from('hse_risk_assessment_hazards')
      .select('assessment_id, initial_score, residual_score, notes, hse_risk_assessments(id, ref, title, status, review_due_at)')
      .eq('hazard_id', hazardId)
      .order('created_at', { ascending: false })
      .limit(10),
    sb.from('hse_capa_actions').select('*').eq('source_type', 'hazard').eq('source_id', hazardRef).order('due_at'),
    sb.from('app_events')
      .select('id, event_type, actor_user_id, severity, payload, created_at')
      .eq('source_entity_id', hazardRef)
      .order('created_at', { ascending: false })
      .limit(30),
    workflowId
      ? sb.from('workflow_instances').select('*, workflow_tasks(*)').eq('id', workflowId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return c.json({
    success: true,
    data: {
      hazard:      hazardRes.data,
      controls:    controlsRes.data   ?? [],
      assessments: raRes.data         ?? [],
      capa:        capaRes.data       ?? [],
      timeline:    timelineRes.data   ?? [],
      workflow:    wfRes.data         ?? null,
    },
  });
});

// ── POST /api/hse/risk-jsa/hazards/update ────────────────────────────────────

const HazardUpdateSchema = z.object({
  hazardId:            z.string().uuid(),
  title:               z.string().min(1).max(300).optional(),
  description:         z.string().optional(),
  category:            z.string().optional(),
  status:              z.enum(['draft','registered','assessment_required','controls_required','under_review','approved','monitoring','archived']).optional(),
  residualLikelihood:  z.number().int().min(1).max(5).nullable().optional(),
  residualSeverity:    z.number().int().min(1).max(5).nullable().optional(),
  ownerUserId:         z.string().nullable().optional(),
  reviewDueAt:         z.string().nullable().optional(),
});

router.post('/risk-jsa/hazards/update', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, HazardUpdateSchema, body.args);
  if (!v.ok) return v.response;

  const { hazardId, ...fields } = v.data;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (fields.title !== undefined)              updates.title              = fields.title;
  if (fields.description !== undefined)        updates.description        = fields.description;
  if (fields.category !== undefined)           updates.category           = fields.category;
  if (fields.status !== undefined)             updates.status             = fields.status;
  if (fields.ownerUserId !== undefined)        updates.owner_user_id      = fields.ownerUserId;
  if (fields.reviewDueAt !== undefined)        updates.review_due_at      = fields.reviewDueAt;
  if (fields.residualLikelihood !== undefined) updates.residual_likelihood = fields.residualLikelihood;
  if (fields.residualSeverity !== undefined)   updates.residual_severity   = fields.residualSeverity;

  if (fields.residualLikelihood != null && fields.residualSeverity != null) {
    updates.residual_score = fields.residualLikelihood * fields.residualSeverity;
  }

  const { error } = await sb.from('hse_hazards').update(updates).eq('id', hazardId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({
    eventType:        'hse.hazard.updated',
    sourceModule:     'hse',
    sourceEntityType: 'hazard',
    sourceEntityId:   hazardId,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { changes: Object.keys(updates) },
  });

  return c.json({ success: true });
});

// ── POST /api/hse/risk-jsa/assessments/list ──────────────────────────────────

const RaListSchema = z.object({
  status:         z.string().nullable().optional(),
  siteId:         z.string().nullable().optional(),
  assessmentType: z.string().nullable().optional(),
  limit:          z.number().int().min(1).max(200).default(50),
});

router.post('/risk-jsa/assessments/list', async c => {
  await requirePermission(c, 'hse.risk.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, RaListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('hse_risk_assessments')
    .select('id, ref, assessment_type, title, site_id, location_text, department_id, owner_user_id, status, initial_score, residual_score, risk_level, review_due_at, created_at')
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  if (v.data.status)         q = q.eq('status', v.data.status);
  if (v.data.siteId)         q = q.eq('site_id', v.data.siteId);
  if (v.data.assessmentType) q = q.eq('assessment_type', v.data.assessmentType);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/risk-jsa/assessments/create ────────────────────────────────

const RaCreateSchema = z.object({
  assessmentType:  z.enum(['general','task','area','equipment','chemical','permit_linked','change']).default('general'),
  title:           z.string().min(1).max(300),
  description:     z.string().default(''),
  siteId:          z.string().nullable().optional(),
  departmentId:    z.string().nullable().optional(),
  locationText:    z.string().nullable().optional(),
  ownerUserId:     z.string().nullable().optional(),
  reviewCycle:     z.enum(['monthly','quarterly','biannual','annual','on_change']).default('annual'),
  reviewDueAt:     z.string().nullable().optional(),
  hazards: z.array(z.object({
    hazardId:           z.string().uuid().nullable().optional(),
    hazardDescription:  z.string().nullable().optional(),
    category:           z.string().nullable().optional(),
    initialLikelihood:  z.number().int().min(1).max(5),
    initialSeverity:    z.number().int().min(1).max(5),
    residualLikelihood: z.number().int().min(1).max(5).nullable().optional(),
    residualSeverity:   z.number().int().min(1).max(5).nullable().optional(),
    notes:              z.string().nullable().optional(),
  })).default([]),
});

router.post('/risk-jsa/assessments/create', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, RaCreateSchema, body.args);
  if (!v.ok) return v.response;

  const ownerUserId = v.data.ownerUserId ?? user.id;
  const maxScore    = v.data.hazards.reduce((m, h) => Math.max(m, h.initialLikelihood * h.initialSeverity), 0);
  const level       = maxScore > 0 ? riskLevel(maxScore) : 'medium';

  try {
    const result = await runModuleMutation<{ id: string; ref: string }>({
      context: {
        actorUserId:  user.id,
        siteId:       v.data.siteId ?? null,
        departmentId: v.data.departmentId ?? null,
      },
      options: {
        module:         'hse',
        operation:      'create',
        entityType:     'risk_assessment',
        idempotencyKey: `hse.ra.create:${user.id}:${v.data.title}:${v.data.assessmentType}`,
        eventType:      'hse.risk_assessment.created',
        eventSeverity:  level === 'critical' ? 'critical' : level === 'high' ? 'high' : 'info',
        eventPayload:   { title: v.data.title, assessmentType: v.data.assessmentType, riskLevel: level, hazardCount: v.data.hazards.length },
        getEntityIdentity: (r) => ({ id: r.id, ref: r.ref }),
        afterCommit: async ({ entityId, workflowId }) => {
          if (workflowId) {
            await sb.from('hse_risk_assessments')
              .update({ workflow_id: workflowId })
              .eq('id', entityId);
          }
        },
      },
      writeRecord: async () => {
        const ref = await nextRef('RA');
        const { data, error } = await sb
          .from('hse_risk_assessments')
          .insert({
            ref,
            assessment_type: v.data.assessmentType,
            title:           v.data.title,
            description:     v.data.description,
            site_id:         v.data.siteId ?? null,
            department_id:   v.data.departmentId ?? null,
            location_text:   v.data.locationText ?? null,
            owner_user_id:   ownerUserId,
            status:          'draft',
            initial_score:   maxScore > 0 ? maxScore : null,
            risk_level:      level,
            review_cycle:    v.data.reviewCycle,
            review_due_at:   v.data.reviewDueAt ?? null,
            created_by:      user.id,
          })
          .select('id, ref')
          .single<{ id: string; ref: string }>();

        if (error || !data) throw error ?? new Error('Risk Assessment insert failed');

        if (v.data.hazards.length > 0) {
          await sb.from('hse_risk_assessment_hazards').insert(
            v.data.hazards.map(h => ({
              assessment_id:      data.id,
              hazard_id:          h.hazardId ?? null,
              hazard_description: h.hazardDescription ?? null,
              category:           h.category ?? null,
              initial_likelihood: h.initialLikelihood,
              initial_severity:   h.initialSeverity,
              residual_likelihood: h.residualLikelihood ?? null,
              residual_severity:   h.residualSeverity   ?? null,
              notes:              h.notes ?? null,
            })),
          );
        }

        return data;
      },
    });

    return c.json({
      success: true,
      data: {
        id:         result.entityId,
        ref:        result.entityRef,
        workflowId: result.workflowId ?? null,
        eventId:    result.eventId    ?? null,
        riskLevel:  level,
      },
    });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Create failed' }, 500 as 200);
  }
});

// ── POST /api/hse/risk-jsa/assessments/detail ────────────────────────────────

router.post('/risk-jsa/assessments/detail', async c => {
  await requirePermission(c, 'hse.risk.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { assessmentId?: string; ref?: string } | undefined;

  if (!args?.assessmentId && !args?.ref) {
    return c.json({ success: false, message: 'assessmentId or ref required' }, 400 as 200);
  }

  let q = sb.from('hse_risk_assessments').select('*');
  if (args.assessmentId) q = q.eq('id', args.assessmentId);
  else                   q = q.eq('ref', args.ref!);

  const raRes = await q.maybeSingle();
  if (!raRes.data) return c.json({ success: false, message: 'Assessment not found' }, 404 as 200);

  const ra = raRes.data as Record<string, unknown>;
  const raId  = ra.id  as string;
  const raRef = ra.ref as string;
  const workflowId = ra.workflow_id as string | null;

  const [hazardsRes, controlsRes, ppeRes, trainingRes, timelineRes, wfRes] = await Promise.all([
    sb.from('hse_risk_assessment_hazards').select('*').eq('assessment_id', raId).order('created_at'),
    sb.from('hse_controls').select('*').eq('source_type', 'assessment').eq('source_id', raId).order('created_at'),
    sb.from('hse_ppe_requirements').select('*').eq('source_type', 'assessment').eq('source_id', raId),
    sb.from('hse_training_links').select('*').eq('source_type', 'assessment').eq('source_id', raId),
    sb.from('app_events')
      .select('id, event_type, actor_user_id, severity, payload, created_at')
      .eq('source_entity_id', raRef)
      .order('created_at', { ascending: false })
      .limit(30),
    workflowId
      ? sb.from('workflow_instances').select('*, workflow_tasks(*)').eq('id', workflowId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return c.json({
    success: true,
    data: {
      assessment: ra,
      hazards:    hazardsRes.data   ?? [],
      controls:   controlsRes.data  ?? [],
      ppe:        ppeRes.data       ?? [],
      training:   trainingRes.data  ?? [],
      timeline:   timelineRes.data  ?? [],
      workflow:   wfRes.data        ?? null,
    },
  });
});

// ── POST /api/hse/risk-jsa/assessments/submit ────────────────────────────────

router.post('/risk-jsa/assessments/submit', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { assessmentId: string; note?: string } | undefined;
  if (!args?.assessmentId) return c.json({ success: false, message: 'assessmentId required' }, 400 as 200);

  const raRes = await sb.from('hse_risk_assessments')
    .select('id, ref, title, status, risk_level, workflow_id, owner_user_id')
    .eq('id', args.assessmentId).maybeSingle<{
      id: string; ref: string; title: string; status: string;
      risk_level: string; workflow_id: string | null; owner_user_id: string | null;
    }>();

  if (!raRes.data) return c.json({ success: false, message: 'Assessment not found' }, 404 as 200);
  const ra = raRes.data;

  if (!['draft','returned'].includes(ra.status)) {
    return c.json({ success: false, message: `Cannot submit from status: ${ra.status}` }, 400 as 200);
  }

  await sb.from('hse_risk_assessments')
    .update({ status: 'submitted', updated_at: new Date().toISOString() })
    .eq('id', ra.id);

  // Create or advance workflow
  let workflowId = ra.workflow_id;
  if (!workflowId) {
    const wfResult = await createWorkflow({
      templateKey:      'hse_risk_assessment_review',
      sourceModule:     'hse',
      sourceEntityType: 'risk_assessment',
      sourceEntityId:   ra.ref,
      priority:         ra.risk_level === 'critical' ? 'critical' : ra.risk_level === 'high' ? 'high' : 'medium',
      ownerUserId:      ra.owner_user_id ?? user.id,
      createdBy:        user.id,
      metadata:         { submittedBy: user.id, note: args.note },
    });
    workflowId = wfResult.workflowId ?? null;
    if (workflowId) {
      await sb.from('hse_risk_assessments').update({ workflow_id: workflowId }).eq('id', ra.id);
    }
  }

  void emitAppEvent({
    eventType:        'hse.risk_assessment.submitted',
    sourceModule:     'hse',
    sourceEntityType: 'risk_assessment',
    sourceEntityId:   ra.ref,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { title: ra.title, note: args.note },
    notification: {
      title: `Risk Assessment submitted for review: ${ra.ref}`,
      body:  ra.title,
      actionRoute: 'hse/risk-jsa',
      type:  'hse.risk_assessment.submitted',
    },
  });

  return c.json({ success: true, workflowId });
});

// ── POST /api/hse/risk-jsa/jsa/list ──────────────────────────────────────────

const JsaListSchema = z.object({
  status:  z.string().nullable().optional(),
  siteId:  z.string().nullable().optional(),
  limit:   z.number().int().min(1).max(200).default(50),
});

router.post('/risk-jsa/jsa/list', async c => {
  await requirePermission(c, 'hse.risk.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, JsaListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('hse_jsa')
    .select('id, ref, title, site_id, location_text, department_id, owner_user_id, status, risk_level, review_due_at, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  if (v.data.status) q = q.eq('status', v.data.status);
  if (v.data.siteId) q = q.eq('site_id', v.data.siteId);

  const [jsaRes, stepCounts] = await Promise.all([
    q,
    sb.from('hse_jsa_steps').select('jsa_id, id').limit(2000),
  ]);

  if (jsaRes.error) return c.json({ success: false, message: jsaRes.error.message }, 500 as 200);

  const countMap = new Map<string, number>();
  for (const s of stepCounts.data ?? []) {
    countMap.set(s.jsa_id as string, (countMap.get(s.jsa_id as string) ?? 0) + 1);
  }

  const data = (jsaRes.data ?? []).map(j => ({
    ...j,
    stepCount: countMap.get((j as Record<string, unknown>).id as string) ?? 0,
  }));

  return c.json({ success: true, data });
});

// ── POST /api/hse/risk-jsa/jsa/create ────────────────────────────────────────

const JsaCreateSchema = z.object({
  title:        z.string().min(1).max(300),
  description:  z.string().default(''),
  siteId:       z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  locationText: z.string().nullable().optional(),
  ownerUserId:  z.string().nullable().optional(),
  reviewDueAt:  z.string().nullable().optional(),
  steps: z.array(z.object({
    stepNumber:         z.number().int().min(1),
    taskStep:           z.string().min(1),
    hazardDescription:  z.string().nullable().optional(),
    initialLikelihood:  z.number().int().min(1).max(5).nullable().optional(),
    initialSeverity:    z.number().int().min(1).max(5).nullable().optional(),
    residualLikelihood: z.number().int().min(1).max(5).nullable().optional(),
    residualSeverity:   z.number().int().min(1).max(5).nullable().optional(),
    controlsSummary:    z.string().nullable().optional(),
  })).default([]),
  ppeItems: z.array(z.object({
    ppeItem:  z.string().min(1),
    required: z.boolean().default(true),
    notes:    z.string().nullable().optional(),
  })).default([]),
  trainingLinks: z.array(z.object({
    requirementDescription:  z.string().min(1),
    certificationRequired:   z.boolean().default(false),
    competencyVerification:  z.boolean().default(false),
    notes:                   z.string().nullable().optional(),
  })).default([]),
});

router.post('/risk-jsa/jsa/create', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, JsaCreateSchema, body.args);
  if (!v.ok) return v.response;

  const ownerUserId = v.data.ownerUserId ?? user.id;
  const maxScore    = v.data.steps.reduce((m, s) => {
    if (s.initialLikelihood && s.initialSeverity) return Math.max(m, s.initialLikelihood * s.initialSeverity);
    return m;
  }, 0);
  const level = maxScore > 0 ? riskLevel(maxScore) : 'medium';

  try {
    const result = await runModuleMutation<{ id: string; ref: string }>({
      context: {
        actorUserId:  user.id,
        siteId:       v.data.siteId ?? null,
        departmentId: v.data.departmentId ?? null,
      },
      options: {
        module:         'hse',
        operation:      'create',
        entityType:     'jsa',
        idempotencyKey: `hse.jsa.create:${user.id}:${v.data.title}`,
        eventType:      'hse.jsa.created',
        eventSeverity:  'info',
        eventPayload:   { title: v.data.title, stepCount: v.data.steps.length, riskLevel: level },
        getEntityIdentity: (r) => ({ id: r.id, ref: r.ref }),
        afterCommit: async ({ entityId, workflowId }) => {
          if (workflowId) {
            await sb.from('hse_jsa').update({ workflow_id: workflowId }).eq('id', entityId);
          }
        },
      },
      writeRecord: async () => {
        const ref = await nextRef('JSA');
        const { data, error } = await sb
          .from('hse_jsa')
          .insert({
            ref,
            title:         v.data.title,
            description:   v.data.description,
            site_id:       v.data.siteId ?? null,
            department_id: v.data.departmentId ?? null,
            location_text: v.data.locationText ?? null,
            owner_user_id: ownerUserId,
            status:        'draft',
            risk_level:    level,
            review_due_at: v.data.reviewDueAt ?? null,
            created_by:    user.id,
          })
          .select('id, ref')
          .single<{ id: string; ref: string }>();

        if (error || !data) throw error ?? new Error('JSA insert failed');

        const ops: PromiseLike<unknown>[] = [];

        if (v.data.steps.length > 0) {
          ops.push(sb.from('hse_jsa_steps').insert(
            v.data.steps.map(s => ({
              jsa_id:             data.id,
              step_number:        s.stepNumber,
              task_step:          s.taskStep,
              hazard_description: s.hazardDescription ?? null,
              initial_likelihood: s.initialLikelihood ?? null,
              initial_severity:   s.initialSeverity   ?? null,
              residual_likelihood: s.residualLikelihood ?? null,
              residual_severity:   s.residualSeverity   ?? null,
              controls_summary:   s.controlsSummary ?? null,
            })),
          ).then(r => r));
        }
        if (v.data.ppeItems.length > 0) {
          ops.push(sb.from('hse_ppe_requirements').insert(
            v.data.ppeItems.map(p => ({
              source_type: 'jsa',
              source_id:   data.id,
              ppe_item:    p.ppeItem,
              required:    p.required,
              notes:       p.notes ?? null,
            })),
          ).then(r => r));
        }
        if (v.data.trainingLinks.length > 0) {
          ops.push(sb.from('hse_training_links').insert(
            v.data.trainingLinks.map(t => ({
              source_type:              'jsa',
              source_id:                data.id,
              requirement_description:  t.requirementDescription,
              certification_required:   t.certificationRequired,
              competency_verification:  t.competencyVerification,
              notes:                    t.notes ?? null,
            })),
          ).then(r => r));
        }

        await Promise.all(ops);
        return data;
      },
    });

    return c.json({
      success: true,
      data: {
        id:         result.entityId,
        ref:        result.entityRef,
        workflowId: result.workflowId ?? null,
        eventId:    result.eventId    ?? null,
        riskLevel:  level,
      },
    });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Create failed' }, 500 as 200);
  }
});

// ── POST /api/hse/risk-jsa/jsa/detail ────────────────────────────────────────

router.post('/risk-jsa/jsa/detail', async c => {
  await requirePermission(c, 'hse.risk.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { jsaId?: string; ref?: string } | undefined;

  if (!args?.jsaId && !args?.ref) {
    return c.json({ success: false, message: 'jsaId or ref required' }, 400 as 200);
  }

  let q = sb.from('hse_jsa').select('*');
  if (args.jsaId) q = q.eq('id', args.jsaId);
  else            q = q.eq('ref', args.ref!);

  const jsaRes = await q.maybeSingle();
  if (!jsaRes.data) return c.json({ success: false, message: 'JSA not found' }, 404 as 200);

  const jsa = jsaRes.data as Record<string, unknown>;
  const jsaId  = jsa.id  as string;
  const jsaRef = jsa.ref as string;
  const workflowId = jsa.workflow_id as string | null;

  const [stepsRes, ppeRes, trainingRes, timelineRes, wfRes] = await Promise.all([
    sb.from('hse_jsa_steps').select('*').eq('jsa_id', jsaId).order('step_number'),
    sb.from('hse_ppe_requirements').select('*').eq('source_type', 'jsa').eq('source_id', jsaId),
    sb.from('hse_training_links').select('*').eq('source_type', 'jsa').eq('source_id', jsaId),
    sb.from('app_events')
      .select('id, event_type, actor_user_id, severity, payload, created_at')
      .eq('source_entity_id', jsaRef)
      .order('created_at', { ascending: false })
      .limit(30),
    workflowId
      ? sb.from('workflow_instances').select('*, workflow_tasks(*)').eq('id', workflowId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return c.json({
    success: true,
    data: {
      jsa,
      steps:    stepsRes.data    ?? [],
      ppe:      ppeRes.data      ?? [],
      training: trainingRes.data ?? [],
      timeline: timelineRes.data ?? [],
      workflow: wfRes.data       ?? null,
    },
  });
});

// ── POST /api/hse/risk-jsa/jsa/submit ────────────────────────────────────────

router.post('/risk-jsa/jsa/submit', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { jsaId: string; note?: string } | undefined;
  if (!args?.jsaId) return c.json({ success: false, message: 'jsaId required' }, 400 as 200);

  const jsaRes = await sb.from('hse_jsa')
    .select('id, ref, title, status, risk_level, workflow_id, owner_user_id')
    .eq('id', args.jsaId)
    .maybeSingle<{ id: string; ref: string; title: string; status: string; risk_level: string; workflow_id: string | null; owner_user_id: string | null }>();

  if (!jsaRes.data) return c.json({ success: false, message: 'JSA not found' }, 404 as 200);
  const jsa = jsaRes.data;

  if (!['draft','returned'].includes(jsa.status)) {
    return c.json({ success: false, message: `Cannot submit from status: ${jsa.status}` }, 400 as 200);
  }

  await sb.from('hse_jsa').update({ status: 'submitted', updated_at: new Date().toISOString() }).eq('id', jsa.id);

  let workflowId = jsa.workflow_id;
  if (!workflowId) {
    const wfResult = await createWorkflow({
      templateKey:      'hse_jsa_review',
      sourceModule:     'hse',
      sourceEntityType: 'jsa',
      sourceEntityId:   jsa.ref,
      priority:         jsa.risk_level === 'critical' ? 'critical' : jsa.risk_level === 'high' ? 'high' : 'medium',
      ownerUserId:      jsa.owner_user_id ?? user.id,
      createdBy:        user.id,
      metadata:         { submittedBy: user.id, note: args.note },
    });
    workflowId = wfResult.workflowId ?? null;
    if (workflowId) {
      await sb.from('hse_jsa').update({ workflow_id: workflowId }).eq('id', jsa.id);
    }
  }

  void emitAppEvent({
    eventType:        'hse.jsa.submitted',
    sourceModule:     'hse',
    sourceEntityType: 'jsa',
    sourceEntityId:   jsa.ref,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { title: jsa.title, note: args.note },
    notification: {
      title: `JSA submitted for review: ${jsa.ref}`,
      body:  jsa.title,
      actionRoute: 'hse/risk-jsa',
      type:  'hse.jsa.submitted',
    },
  });

  return c.json({ success: true, workflowId });
});

// ── POST /api/hse/risk-jsa/controls/create ───────────────────────────────────

const ControlCreateSchema = z.object({
  sourceType:   z.enum(['hazard','assessment','jsa','capa']),
  sourceId:     z.string().min(1),
  hazardId:     z.string().uuid().nullable().optional(),
  description:  z.string().min(1),
  controlType:  z.enum(['elimination','substitution','engineering','administrative','ppe','emergency_response']).default('administrative'),
  ownerUserId:  z.string().nullable().optional(),
  dueAt:        z.string().nullable().optional(),
});

router.post('/risk-jsa/controls/create', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ControlCreateSchema, body.args);
  if (!v.ok) return v.response;

  const { data, error } = await sb
    .from('hse_controls')
    .insert({
      source_type:   v.data.sourceType,
      source_id:     v.data.sourceId,
      hazard_id:     v.data.hazardId ?? null,
      description:   v.data.description,
      control_type:  v.data.controlType,
      owner_user_id: v.data.ownerUserId ?? user.id,
      due_at:        v.data.dueAt ?? null,
      status:        'planned',
      created_by:    user.id,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);

  void emitAppEvent({
    eventType:        'hse.control.added',
    sourceModule:     'hse',
    sourceEntityType: v.data.sourceType,
    sourceEntityId:   v.data.sourceId,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { controlId: data.id, controlType: v.data.controlType, description: v.data.description },
  });

  return c.json({ success: true, controlId: data.id });
});

// ── POST /api/hse/risk-jsa/review ────────────────────────────────────────────

const ReviewSchema = z.object({
  entityType:          z.enum(['hazard','assessment','jsa']),
  entityId:            z.string().uuid(),
  outcome:             z.enum(['approve','return','archive']),
  note:                z.string().nullable().optional(),
  nextReviewDueAt:     z.string().nullable().optional(),
  effectivenessResult: z.enum(['effective','partially_effective','ineffective']).nullable().optional(),
});

router.post('/risk-jsa/review', async c => {
  const user = await requirePermission(c, 'hse.risk.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ReviewSchema, body.args);
  if (!v.ok) return v.response;

  const tableMap = {
    hazard:     'hse_hazards',
    assessment: 'hse_risk_assessments',
    jsa:        'hse_jsa',
  } as const;

  const approvedStatus = {
    hazard:     'approved',
    assessment: 'approved',
    jsa:        'approved',
  } as const;

  const table = tableMap[v.data.entityType];
  const now   = new Date().toISOString();

  const updates: Record<string, unknown> = {
    updated_at: now,
    status: v.data.outcome === 'approve' ? approvedStatus[v.data.entityType]
          : v.data.outcome === 'archive' ? 'archived'
          : 'returned',
  };
  if (v.data.nextReviewDueAt) updates.review_due_at = v.data.nextReviewDueAt;

  const { error } = await sb.from(table as 'hse_hazards').update(updates).eq('id', v.data.entityId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({
    eventType:        `hse.${v.data.entityType}.${v.data.outcome}d`,
    sourceModule:     'hse',
    sourceEntityType: v.data.entityType,
    sourceEntityId:   v.data.entityId,
    actorUserId:      user.id,
    severity:         v.data.outcome === 'approve' ? 'success' : 'info',
    payload:          { outcome: v.data.outcome, note: v.data.note },
  });

  return c.json({ success: true });
});

// ── POST /api/hse/risk-jsa/hazards/submit ────────────────────────────────────
// Submit a hazard for review → status under_review + (create) hazard-review workflow.

router.post('/risk-jsa/hazards/submit', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { hazardId: string; note?: string } | undefined;
  if (!args?.hazardId) return c.json({ success: false, message: 'hazardId required' }, 400 as 200);

  const hzRes = await sb.from('hse_hazards')
    .select('id, ref, title, status, risk_level, workflow_id, owner_user_id')
    .eq('id', args.hazardId).maybeSingle<{
      id: string; ref: string; title: string; status: string;
      risk_level: string; workflow_id: string | null; owner_user_id: string | null;
    }>();

  if (!hzRes.data) return c.json({ success: false, message: 'Hazard not found' }, 404 as 200);
  const hz = hzRes.data;

  if (['under_review','approved','archived'].includes(hz.status)) {
    return c.json({ success: false, message: `Cannot submit from status: ${hz.status}` }, 400 as 200);
  }

  await sb.from('hse_hazards')
    .update({ status: 'under_review', updated_at: new Date().toISOString() })
    .eq('id', hz.id);

  let workflowId = hz.workflow_id;
  if (!workflowId) {
    const wfResult = await createWorkflow({
      templateKey:      'hse_hazard_review',
      sourceModule:     'hse',
      sourceEntityType: 'hazard',
      sourceEntityId:   hz.ref,
      priority:         hz.risk_level === 'critical' ? 'critical' : hz.risk_level === 'high' ? 'high' : 'medium',
      ownerUserId:      hz.owner_user_id ?? user.id,
      createdBy:        user.id,
      metadata:         { submittedBy: user.id, note: args.note },
    });
    workflowId = wfResult.workflowId ?? null;
    if (workflowId) {
      await sb.from('hse_hazards').update({ workflow_id: workflowId }).eq('id', hz.id);
    }
  }

  void emitAppEvent({
    eventType:        'hse.hazard.submitted',
    sourceModule:     'hse',
    sourceEntityType: 'hazard',
    sourceEntityId:   hz.ref,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { title: hz.title, note: args.note },
    notification: {
      title: `Hazard submitted for review: ${hz.ref}`,
      body:  hz.title,
      actionRoute: 'hse/risk-jsa',
      type:  'hse.hazard.submitted',
    },
  });

  return c.json({ success: true, workflowId });
});

// ── POST /api/hse/risk-jsa/controls/verify ───────────────────────────────────
// Mark a control verified with an effectiveness rating.

const ControlVerifySchema = z.object({
  controlId:     z.string().uuid(),
  effectiveness: z.enum(['effective','partially_effective','ineffective']),
  note:          z.string().nullable().optional(),
});

router.post('/risk-jsa/controls/verify', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ControlVerifySchema, body.args);
  if (!v.ok) return v.response;

  const now = new Date().toISOString();
  const status = v.data.effectiveness === 'ineffective' ? 'ineffective' : 'verified';

  const { data, error } = await sb.from('hse_controls')
    .update({
      status,
      effectiveness: v.data.effectiveness,
      verified_by:   user.id,
      verified_at:   now,
      updated_at:    now,
    })
    .eq('id', v.data.controlId)
    .select('id, source_type, source_id, description')
    .single<{ id: string; source_type: string; source_id: string; description: string }>();

  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Control not found' }, 500 as 200);

  void emitAppEvent({
    eventType:        'hse.control.verified',
    sourceModule:     'hse',
    sourceEntityType: data.source_type,
    sourceEntityId:   data.source_id,
    actorUserId:      user.id,
    severity:         v.data.effectiveness === 'ineffective' ? 'warning' : 'success',
    payload:          { controlId: data.id, effectiveness: v.data.effectiveness, note: v.data.note },
  });

  return c.json({ success: true });
});

// ── POST /api/hse/risk-jsa/templates/list ────────────────────────────────────
// HSE workflow templates available for hazard / assessment / JSA flows.

router.post('/risk-jsa/templates/list', async c => {
  await requirePermission(c, 'hse.risk.manage');
  const { data, error } = await sb.from('workflow_templates')
    .select('id, module, key, name, description, is_active, definition, created_at')
    .eq('module', 'hse')
    .order('name');
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/risk-jsa/templates/duplicate ───────────────────────────────
// Clone a workflow template under a new key so it can be customised.

const TemplateDuplicateSchema = z.object({
  templateId: z.string().uuid(),
  newName:    z.string().min(1).max(200).nullable().optional(),
});

router.post('/risk-jsa/templates/duplicate', async c => {
  const user = await requirePermission(c, 'hse.risk.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TemplateDuplicateSchema, body.args);
  if (!v.ok) return v.response;

  const src = await sb.from('workflow_templates')
    .select('module, key, name, description, definition')
    .eq('id', v.data.templateId)
    .maybeSingle<{ module: string; key: string; name: string; description: string; definition: unknown }>();
  if (!src.data) return c.json({ success: false, message: 'Template not found' }, 404 as 200);

  const newKey  = `${src.data.key}_copy_${Date.now().toString(36)}`;
  const newName = v.data.newName ?? `${src.data.name} (copy)`;

  const { data, error } = await sb.from('workflow_templates')
    .insert({
      module:      src.data.module,
      key:         newKey,
      name:        newName,
      description: src.data.description,
      is_active:   false,
      definition:  src.data.definition ?? {},
    })
    .select('id, key, name')
    .single<{ id: string; key: string; name: string }>();

  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Duplicate failed' }, 500 as 200);

  void emitAppEvent({
    eventType:        'hse.workflow_template.duplicated',
    sourceModule:     'hse',
    sourceEntityType: 'workflow_template',
    sourceEntityId:   data.key,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { fromKey: src.data.key, newKey: data.key, name: data.name },
  });

  return c.json({ success: true, data });
});

export default router;
