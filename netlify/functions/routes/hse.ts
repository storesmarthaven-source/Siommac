/**
 * netlify/functions/routes/hse.ts
 *
 * HSE module API — POST-only (matches CORS config in api.ts).
 *
 * Phase 1A routes:
 *   POST /api/hse/incidents/list
 *   POST /api/hse/incidents/get
 *   POST /api/hse/incidents/create
 *   POST /api/hse/incidents/update
 *   POST /api/hse/investigations/list
 *   POST /api/hse/investigations/create
 *   POST /api/hse/investigations/update
 *   POST /api/hse/capa/list
 *   POST /api/hse/capa/create
 *   POST /api/hse/capa/update
 *   POST /api/hse/dashboard/kpis
 */

import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requirePermission, log_ } from '../lib/auth';
import { zv, z, zShortStr, zOptStr, zDateStr } from '../lib/validate';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Tiny ID helper ────────────────────────────────────────────────────────────

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Ref counter helpers ───────────────────────────────────────────────────────

async function nextRef(prefix: string, table: string): Promise<string> {
  const year = new Date().getFullYear();
  const { count } = await sb.from(table).select('id', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01T00:00:00Z`);
  const n = String((count ?? 0) + 1).padStart(3, '0');
  return `${prefix}-${year}-${n}`;
}

// ── OSH Act 2004 T&T statutory deadline helper ───────────────────────────────
// Verbal notification: 24 h from occurrence (critical/major injuries only)
// Written report:       7 days from occurrence (critical/major injuries only)
// Accident register retention: 5 years from occurrence
// Source: OSH Act 2004, s.19 and s.47 (T&T). Timeframes are configurable via
// the hse_legal_obligations table — hardcoded defaults used here as a safe baseline.

function oshDeadlines(occurredAt: string, severity: string): {
  osh_notification_due: string | null;
  osh_written_due:      string | null;
  retain_until:         string;
} {
  const occ = new Date(occurredAt).getTime();
  const notifiable = severity === 'critical' || severity === 'major';
  return {
    osh_notification_due: notifiable ? new Date(occ + 24 * 60 * 60 * 1000).toISOString() : null,
    osh_written_due:      notifiable ? new Date(occ + 7  * 24 * 60 * 60 * 1000).toISOString() : null,
    retain_until:                      new Date(occ + 5  * 365.25 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const zIncidentType = z.enum(['injury','near-miss','property-damage','environmental','unsafe-act','unsafe-condition']);
const zSeverity     = z.enum(['critical','major','moderate','minor']);
const zIncidentStatus = z.enum(['reported','under-investigation','capa-raised','closed']);

const IncidentListSchema = z.object({
  status:    zIncidentStatus.optional(),
  severity:  zSeverity.optional(),
  siteId:    z.string().optional(),
  reporterId: z.string().uuid().optional(),
  from:      zDateStr.optional(),
  to:        zDateStr.optional(),
  limit:     z.number().int().min(1).max(200).default(50),
  offset:    z.number().int().min(0).default(0),
});

const IncidentGetSchema = z.object({
  id: zShortStr(100),
});

const zPerson = z.object({
  name:       z.string().max(200),
  employeeId: z.string().optional(),
  role:       z.string().max(100).optional(),
  contractor: z.boolean().optional(),
});

const zWitness = z.object({
  name:       z.string().max(200),
  employeeId: z.string().optional(),
  statement:  z.string().max(2000).optional(),
});

const zOshClass = z.enum([
  'first-aid','medical-treatment','restricted-duty',
  'lost-time','fatality','property-damage','environmental',
  'near-miss','dangerous-occurrence',
]).optional();

const IncidentCreateSchema = z.object({
  type:             zIncidentType,
  severity:         zSeverity,
  classification:   zOshClass,
  injuryType:       zOptStr(200),
  bodyPart:         zOptStr(100),
  lostDays:         z.number().int().min(0).default(0),
  returnToWork:     zDateStr.optional(),
  siteId:           z.string().optional(),
  siteName:         zOptStr(255),
  description:      z.string().max(5000).optional(),
  immediateActions: z.string().max(5000).optional(),
  occurredAt:       z.string().datetime().optional(),
  peopleInvolved:   z.array(zPerson).default([]),
  witnesses:        z.array(zWitness).default([]),
  oshClass:         zOptStr(100),
  workflowId:       z.string().optional(),
});

const IncidentUpdateSchema = z.object({
  id:               zShortStr(100),
  status:           zIncidentStatus.optional(),
  classification:   zOshClass,
  injuryType:       zOptStr(200),
  bodyPart:         zOptStr(100),
  lostDays:         z.number().int().min(0).optional(),
  returnToWork:     zDateStr.optional(),
  description:      z.string().max(5000).optional(),
  immediateActions: z.string().max(5000).optional(),
  peopleInvolved:   z.array(zPerson).optional(),
  witnesses:        z.array(zWitness).optional(),
  oshNotifiedAt:    z.string().datetime().optional(),
  oshWrittenAt:     z.string().datetime().optional(),
  oshClass:         zOptStr(100),
  workflowId:       z.string().optional(),
});

const InvestigationListSchema = z.object({
  incidentId: zShortStr(100).optional(),
  status:     z.enum(['open','in-progress','closed']).optional(),
  limit:      z.number().int().min(1).max(200).default(50),
  offset:     z.number().int().min(0).default(0),
});

const InvestigationCreateSchema = z.object({
  incidentId: zShortStr(100),
  method:     z.enum(['5-whys','rca','bowtie','fault-tree','incident-mapping']).default('5-whys'),
  leadId:     z.string().uuid().optional(),
  leadName:   zOptStr(255),
});

const InvestigationUpdateSchema = z.object({
  id:        zShortStr(100),
  findings:  z.array(z.object({ why: z.string(), because: z.string() })).optional(),
  rootCause: z.string().max(3000).optional(),
  status:    z.enum(['open','in-progress','closed']).optional(),
});

const CapaListSchema = z.object({
  status:     z.enum(['open','in-progress','overdue','closed','verified']).optional(),
  ownerId:    z.string().uuid().optional(),
  priority:   z.enum(['critical','high','medium','low']).optional(),
  sourceRef:  z.string().optional(),
  limit:      z.number().int().min(1).max(200).default(50),
  offset:     z.number().int().min(0).default(0),
});

const CapaCreateSchema = z.object({
  sourceRef:   zShortStr(100),
  sourceType:  z.enum(['incident','finding','audit','inspection','toolbox']),
  title:       zShortStr(255),
  description: z.string().max(3000),
  ownerId:     z.string().uuid().optional(),
  ownerName:   zOptStr(255),
  dueDate:     zDateStr,
  priority:    z.enum(['critical','high','medium','low']).default('medium'),
});

const CapaUpdateSchema = z.object({
  id:               zShortStr(100),
  status:           z.enum(['open','in-progress','overdue','closed','verified']).optional(),
  verificationNote: z.string().max(2000).optional(),
  ownerId:          z.string().uuid().optional(),
  dueDate:          zDateStr.optional(),
});

// ── POST /api/hse/incidents/list ──────────────────────────────────────────────

router.post('/incidents/list', async c => {
  await requirePermission(c, 'hse.incidents.view');
  const v = zv(c, IncidentListSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { status, severity, siteId, reporterId, from, to, limit, offset } = v.data;

  let q = sb.from('hse_incidents')
    .select('id,ref,type,severity,site_id,site_name,status,reporter_id,reporter_name,description,occurred_at,osh_notification_due,osh_notified_at,workflow_id,created_at,updated_at')
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status)     q = q.eq('status', status);
  if (severity)   q = q.eq('severity', severity);
  if (siteId)     q = q.eq('site_id', siteId);
  if (reporterId) q = q.eq('reporter_id', reporterId);
  if (from)       q = q.gte('occurred_at', from);
  if (to)         q = q.lte('occurred_at', to + 'T23:59:59Z');

  const { data, error, count } = await q;
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [], total: count ?? 0 });
});

// ── POST /api/hse/incidents/get ───────────────────────────────────────────────

router.post('/incidents/get', async c => {
  await requirePermission(c, 'hse.incidents.view');
  const v = zv(c, IncidentGetSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;

  const { data: incident } = await sb.from('hse_incidents').select('*').eq('id', v.data.id).maybeSingle();
  if (!incident) return c.json({ success: false, message: 'Incident not found' }, 404);

  const [{ data: investigations }, { data: capas }] = await Promise.all([
    sb.from('hse_investigations').select('*').eq('incident_id', v.data.id).order('created_at'),
    sb.from('hse_capa').select('*').eq('source_ref', (incident as { ref: string }).ref).order('created_at'),
  ]);

  return c.json({ success: true, data: { incident, investigations: investigations ?? [], capas: capas ?? [] } });
});

// ── POST /api/hse/incidents/create ────────────────────────────────────────────

router.post('/incidents/create', async c => {
  const actor = await requirePermission(c, 'hse.incidents.manage');
  const v = zv(c, IncidentCreateSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const {
    type, severity, classification, injuryType, bodyPart, lostDays, returnToWork,
    siteId, siteName, description, immediateActions, occurredAt,
    peopleInvolved, witnesses, oshClass, workflowId,
  } = v.data;

  const id  = uid('INC');
  const ref = await nextRef('INC', 'hse_incidents');
  const occ = occurredAt ?? new Date().toISOString();
  const deadlines = oshDeadlines(occ, severity);

  const { error } = await sb.from('hse_incidents').insert({
    id, ref, type, severity,
    classification:    classification ?? null,
    injury_type:       injuryType     ?? null,
    body_part:         bodyPart       ?? null,
    lost_days:         lostDays       ?? 0,
    return_to_work:    returnToWork   ?? null,
    site_id:           siteId         ?? null,
    site_name:         siteName       ?? null,
    reporter_id:       actor.id,
    reporter_name:     actor.username,
    description:       description    ?? null,
    immediate_actions: immediateActions ?? null,
    occurred_at:       occ,
    people_involved:   peopleInvolved ?? [],
    witnesses:         witnesses      ?? [],
    osh_class:         oshClass       ?? null,
    workflow_id:       workflowId     ?? null,
    ...deadlines,
  });
  if (error) return c.json({ success: false, message: error.message });

  await log_(actor, 'create', 'hse_incident', id, ref);
  return c.json({ success: true, id, ref });
});

// ── POST /api/hse/incidents/update ────────────────────────────────────────────

router.post('/incidents/update', async c => {
  const actor = await requirePermission(c, 'hse.incidents.manage');
  const v = zv(c, IncidentUpdateSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const {
    id, status, classification, injuryType, bodyPart, lostDays, returnToWork,
    description, immediateActions, peopleInvolved, witnesses,
    oshNotifiedAt, oshWrittenAt, oshClass, workflowId,
  } = v.data;

  const patch: Record<string, unknown> = {};
  if (status           !== undefined) patch.status            = status;
  if (classification   !== undefined) patch.classification    = classification;
  if (injuryType       !== undefined) patch.injury_type       = injuryType;
  if (bodyPart         !== undefined) patch.body_part         = bodyPart;
  if (lostDays         !== undefined) patch.lost_days         = lostDays;
  if (returnToWork     !== undefined) patch.return_to_work    = returnToWork;
  if (description      !== undefined) patch.description       = description;
  if (immediateActions !== undefined) patch.immediate_actions = immediateActions;
  if (peopleInvolved   !== undefined) patch.people_involved   = peopleInvolved;
  if (witnesses        !== undefined) patch.witnesses         = witnesses;
  if (oshNotifiedAt    !== undefined) patch.osh_notified_at   = oshNotifiedAt;
  if (oshWrittenAt     !== undefined) patch.osh_written_at    = oshWrittenAt;
  if (oshClass         !== undefined) patch.osh_class         = oshClass;
  if (workflowId       !== undefined) patch.workflow_id       = workflowId;

  const { error } = await sb.from('hse_incidents').update(patch).eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'update', 'hse_incident', id, status ?? 'updated');
  return c.json({ success: true });
});

// ── POST /api/hse/investigations/list ─────────────────────────────────────────

router.post('/investigations/list', async c => {
  await requirePermission(c, 'hse.incidents.view');
  const v = zv(c, InvestigationListSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { incidentId, status, limit, offset } = v.data;

  let q = sb.from('hse_investigations')
    .select('id,incident_id,method,findings,root_cause,lead_id,lead_name,status,closed_at,created_at,updated_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (incidentId) q = q.eq('incident_id', incidentId);
  if (status)     q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/investigations/create ───────────────────────────────────────

router.post('/investigations/create', async c => {
  const actor = await requirePermission(c, 'hse.incidents.manage');
  const v = zv(c, InvestigationCreateSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { incidentId, method, leadId, leadName } = v.data;

  const id = uid('INV');
  const { error } = await sb.from('hse_investigations').insert({
    id, incident_id: incidentId, method,
    lead_id:   leadId   ?? actor.id,
    lead_name: leadName ?? actor.username,
  });
  if (error) return c.json({ success: false, message: error.message });

  // Advance incident status
  await sb.from('hse_incidents').update({ status: 'under-investigation' }).eq('id', incidentId);

  await log_(actor, 'create', 'hse_investigation', id, incidentId);
  return c.json({ success: true, id });
});

// ── POST /api/hse/investigations/update ───────────────────────────────────────

router.post('/investigations/update', async c => {
  const actor = await requirePermission(c, 'hse.incidents.manage');
  const v = zv(c, InvestigationUpdateSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { id, findings, rootCause, status } = v.data;

  const patch: Record<string, unknown> = {};
  if (findings  !== undefined) patch.findings   = findings;
  if (rootCause !== undefined) patch.root_cause = rootCause;
  if (status    !== undefined) {
    patch.status = status;
    if (status === 'closed') patch.closed_at = new Date().toISOString();
  }

  const { error } = await sb.from('hse_investigations').update(patch).eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'update', 'hse_investigation', id, status ?? 'updated');
  return c.json({ success: true });
});

// ── POST /api/hse/capa/list ───────────────────────────────────────────────────

router.post('/capa/list', async c => {
  await requirePermission(c, 'hse.incidents.view');
  const v = zv(c, CapaListSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { status, ownerId, priority, sourceRef, limit, offset } = v.data;

  let q = sb.from('hse_capa')
    .select('id,ref,source_ref,source_type,title,description,owner_id,owner_name,due_date,priority,status,verification_note,closed_at,workflow_id,created_at,updated_at')
    .order('due_date', { ascending: true })
    .range(offset, offset + limit - 1);

  if (status)    q = q.eq('status', status);
  if (ownerId)   q = q.eq('owner_id', ownerId);
  if (priority)  q = q.eq('priority', priority);
  if (sourceRef) q = q.eq('source_ref', sourceRef);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/capa/create ─────────────────────────────────────────────────

router.post('/capa/create', async c => {
  const actor = await requirePermission(c, 'hse.incidents.manage');
  const v = zv(c, CapaCreateSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { sourceRef, sourceType, title, description, ownerId, ownerName, dueDate, priority } = v.data;

  const id  = uid('CAPA');
  const ref = await nextRef('CAPA', 'hse_capa');

  const { error } = await sb.from('hse_capa').insert({
    id, ref, source_ref: sourceRef, source_type: sourceType,
    title, description,
    owner_id:   ownerId   ?? null,
    owner_name: ownerName ?? null,
    due_date:   dueDate,
    priority,
  });
  if (error) return c.json({ success: false, message: error.message });

  // If source is an incident, advance its status
  if (sourceType === 'incident') {
    await sb.from('hse_incidents').update({ status: 'capa-raised' }).eq('ref', sourceRef);
  }

  await log_(actor, 'create', 'hse_capa', id, ref);
  return c.json({ success: true, id, ref });
});

// ── POST /api/hse/capa/update ─────────────────────────────────────────────────

router.post('/capa/update', async c => {
  const actor = await requirePermission(c, 'hse.incidents.manage');
  const v = zv(c, CapaUpdateSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { id, status, verificationNote, ownerId, dueDate } = v.data;

  const patch: Record<string, unknown> = {};
  if (status           !== undefined) {
    patch.status = status;
    if (status === 'closed' || status === 'verified') patch.closed_at = new Date().toISOString();
  }
  if (verificationNote !== undefined) patch.verification_note = verificationNote;
  if (ownerId          !== undefined) patch.owner_id          = ownerId;
  if (dueDate          !== undefined) patch.due_date          = dueDate;

  const { error } = await sb.from('hse_capa').update(patch).eq('id', id);
  if (error) return c.json({ success: false, message: error.message });
  await log_(actor, 'update', 'hse_capa', id, status ?? 'updated');
  return c.json({ success: true });
});

// ── POST /api/hse/dashboard/kpis ─────────────────────────────────────────────

router.post('/dashboard/kpis', async c => {
  await requirePermission(c, 'hse.dashboard.view');

  const now       = new Date().toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [
    incidentsMtd,
    openIncidents,
    openCapas,
    overdueCapas,
    openWorkflows,
    oshOverdue,
    ltiResult,
    lastLtiResult,
  ] = await Promise.all([
    sb.from('hse_incidents').select('id', { count: 'exact', head: true }).gte('occurred_at', monthStart),
    sb.from('hse_incidents').select('id', { count: 'exact', head: true }).not('status', 'eq', 'closed'),
    sb.from('hse_capa').select('id', { count: 'exact', head: true }).not('status', 'in', '(closed,verified)'),
    sb.from('hse_capa').select('id', { count: 'exact', head: true })
      .not('status', 'in', '(closed,verified)').lt('due_date', now.slice(0, 10)),
    sb.from('workflow_instances').select('id', { count: 'exact', head: true })
      .eq('source_module', 'hse').not('status', 'in', '(approved,rejected,closed)'),
    sb.from('hse_incidents').select('id', { count: 'exact', head: true })
      .not('osh_notification_due', 'is', null)
      .is('osh_notified_at', null)
      .lt('osh_notification_due', now),
    // LTI cases YTD
    sb.from('hse_incidents').select('id,lost_days', { count: 'exact' })
      .eq('classification', 'lost-time').gte('occurred_at', `${new Date().getFullYear()}-01-01T00:00:00Z`),
    // Last LTI date (for LTI-free days counter)
    sb.from('hse_incidents').select('occurred_at')
      .eq('classification', 'lost-time').order('occurred_at', { ascending: false }).limit(1),
  ]);

  const totalLostDays = (ltiResult.data ?? []).reduce((s: number, r: { lost_days?: number }) => s + (r.lost_days ?? 0), 0);
  const lastLtiDate   = (lastLtiResult.data ?? [])[0]?.occurred_at as string | undefined;
  const ltiFreeDays   = lastLtiDate
    ? Math.floor((Date.now() - new Date(lastLtiDate).getTime()) / 86_400_000)
    : null;

  return c.json({
    success: true,
    data: {
      incidentsMtd:            incidentsMtd.count    ?? 0,
      openIncidents:           openIncidents.count   ?? 0,
      openCapas:               openCapas.count       ?? 0,
      overdueCapas:            overdueCapas.count    ?? 0,
      openWorkflows:           openWorkflows.count   ?? 0,
      oshNotificationsOverdue: oshOverdue.count      ?? 0,
      ltiCasesYtd:             ltiResult.count       ?? 0,
      totalLostDays,
      ltiFreeDays,
    },
  });
});

export default router;
