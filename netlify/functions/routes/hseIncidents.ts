/**
 * netlify/functions/routes/hseIncidents.ts
 *
 * HSE Incident management — first production backend slice.
 *
 * POST /api/hse/incidents/list
 * POST /api/hse/incidents/get
 * POST /api/hse/incidents/create
 * POST /api/hse/incidents/update
 */

import { Hono }              from 'hono';
import { z, zv }             from '../lib/validate';
import { requirePermission } from '../lib/auth';
import { sb }                from '../lib/db';
import { nextRef }           from '../lib/refGenerator';
import { emitAppEvent }      from '../lib/appEvents';
import { createWorkflow }    from '../lib/workflowEngine';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── POST /api/hse/incidents/list ──────────────────────────────────────────────

const ListSchema = z.object({
  siteId:     z.string().nullable().optional(),
  status:     z.string().nullable().optional(),
  severity:   z.string().nullable().optional(),
  dateFrom:   z.string().nullable().optional(),
  dateTo:     z.string().nullable().optional(),
  limit:      z.number().int().min(1).max(200).default(50),
  cursor:     z.string().nullable().optional(),
});

router.post('/incidents/list', async c => {
  const user = await requirePermission(c, 'hse.incidents.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('hse_incidents')
    .select('id, ref, title, incident_date, incident_type, severity, status, site_id, department_id, reported_by, recordable, lost_time, workflow_id, created_at')
    .order('incident_date', { ascending: false })
    .limit(v.data.limit);

  if (v.data.siteId)   q = q.eq('site_id', v.data.siteId);
  if (v.data.status)   q = q.eq('status', v.data.status);
  if (v.data.severity) q = q.eq('severity', v.data.severity);
  if (v.data.dateFrom) q = q.gte('incident_date', v.data.dateFrom);
  if (v.data.dateTo)   q = q.lte('incident_date', v.data.dateTo);
  if (v.data.cursor)   q = q.lt('incident_date', v.data.cursor);

  // Employees see only their own reports unless they have manage access
  if (!['admin','superadmin','manager'].includes(user.role)) {
    q = q.eq('reported_by', user.id);
  }

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/incidents/get ───────────────────────────────────────────────

router.post('/incidents/get', async c => {
  await requirePermission(c, 'hse.incidents.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { incidentId?: string; ref?: string } | undefined;

  if (!args?.incidentId && !args?.ref) {
    return c.json({ success: false, message: 'incidentId or ref required' }, 400 as 200);
  }

  let q = sb
    .from('hse_incidents')
    .select('*');
  if (args.incidentId) q = q.eq('id', args.incidentId);
  else q = q.eq('ref', args.ref!);

  const [incidentRes, peopleRes] = await Promise.all([
    q.maybeSingle(),
    args.incidentId
      ? sb.from('hse_incident_people').select('*').eq('incident_id', args.incidentId!)
      : Promise.resolve({ data: [] }),
  ]);

  if (!incidentRes.data) return c.json({ success: false, message: 'Incident not found' }, 404 as 200);
  return c.json({ success: true, data: { incident: incidentRes.data, people: peopleRes.data ?? [] } });
});

// ── POST /api/hse/incidents/create ────────────────────────────────────────────

const PersonSchema = z.object({
  personType:        z.enum(['injured','witness','reporter','supervisor','contractor','visitor']),
  userId:            z.string().nullable().optional(),
  fullName:          z.string().min(1).max(200),
  roleOrCompany:     z.string().nullable().optional(),
  injuryDescription: z.string().nullable().optional(),
});

const CreateSchema = z.object({
  title:          z.string().min(1).max(300),
  description:    z.string().default(''),
  incidentDate:   z.string().min(1),
  siteId:         z.string().nullable().optional(),
  departmentId:   z.string().nullable().optional(),
  locationText:   z.string().nullable().optional(),
  incidentType:   z.string().min(1),
  severity:       z.enum(['minor','moderate','high','critical']),
  immediateAction: z.string().nullable().optional(),
  regulatoryClass: z.string().nullable().optional(),
  recordable:     z.boolean().default(false),
  lostTime:       z.boolean().default(false),
  people:         z.array(PersonSchema).default([]),
  metadata:       z.record(z.string(), z.unknown()).optional(),
});

router.post('/incidents/create', async c => {
  const user = await requirePermission(c, 'hse.incidents.create');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, CreateSchema, body.args);
  if (!v.ok) return v.response;

  const ref = await nextRef('INC');

  const { data: incident, error: incErr } = await sb
    .from('hse_incidents')
    .insert({
      ref,
      title:           v.data.title,
      description:     v.data.description,
      incident_date:   v.data.incidentDate,
      reported_by:     user.id,
      site_id:         v.data.siteId ?? null,
      department_id:   v.data.departmentId ?? null,
      location_text:   v.data.locationText ?? null,
      incident_type:   v.data.incidentType,
      severity:        v.data.severity,
      status:          'open',
      immediate_action: v.data.immediateAction ?? null,
      regulatory_class: v.data.regulatoryClass ?? null,
      recordable:      v.data.recordable,
      lost_time:       v.data.lostTime,
      metadata:        v.data.metadata ?? {},
    })
    .select('id')
    .single<{ id: string }>();

  if (incErr || !incident) {
    return c.json({ success: false, message: incErr?.message ?? 'Insert failed' }, 500 as 200);
  }

  const incidentId = incident.id;

  // Insert people (witnesses, injured parties)
  if (v.data.people.length > 0) {
    await sb.from('hse_incident_people').insert(
      v.data.people.map(p => ({
        incident_id:         incidentId,
        person_type:         p.personType,
        user_id:             p.userId ?? null,
        full_name:           p.fullName,
        role_or_company:     p.roleOrCompany ?? null,
        injury_description:  p.injuryDescription ?? null,
      })),
    );
  }

  // Create investigation workflow
  const wfResult = await createWorkflow({
    templateKey:       'hse_incident_investigation',
    sourceModule:      'hse',
    sourceEntityType:  'incident',
    sourceEntityId:    ref,
    priority:          v.data.severity === 'critical' ? 'critical' : v.data.severity === 'high' ? 'high' : 'medium',
    ownerUserId:       user.id,
    createdBy:         user.id,
    reason:            `Incident ${ref} reported: ${v.data.title}`,
    metadata:          {
      lostTime:     v.data.lostTime,
      recordable:   v.data.recordable,
      severity:     v.data.severity,
      incidentType: v.data.incidentType,
      employeeId:   v.data.people.find(p => p.personType === 'injured')?.userId ?? null,
    },
  });

  // Link workflow to incident
  if (wfResult.ok && wfResult.workflowId) {
    await sb.from('hse_incidents')
      .update({ workflow_id: wfResult.workflowId, status: 'triage' })
      .eq('id', incidentId);
  }

  // Emit incident submitted event → notifies HSE managers
  await emitAppEvent({
    eventType:        'hse.incident.submitted',
    sourceModule:     'hse',
    sourceEntityType: 'incident',
    sourceEntityId:   ref,
    actorUserId:      user.id,
    siteId:           v.data.siteId ?? null,
    departmentId:     v.data.departmentId ?? null,
    severity:         v.data.severity === 'critical' ? 'critical' : v.data.severity === 'high' ? 'high' : 'info',
    payload:          { ref, title: v.data.title, severity: v.data.severity, lostTime: v.data.lostTime },
    dedupeKey:        `hse.incident.submitted:${ref}`,
    notification: {
      title: `New incident reported: ${ref}`,
      body:  `${v.data.severity.toUpperCase()} — ${v.data.title}`,
      actionRoute: `hse/incidents/${ref}`,
      type:  'hse.incident.submitted',
    },
  });

  return c.json({
    success: true,
    incidentId,
    ref,
    workflowId: wfResult.workflowId ?? null,
  });
});

// ── POST /api/hse/incidents/update ────────────────────────────────────────────

const UpdateSchema = z.object({
  incidentId:      z.string().uuid(),
  title:           z.string().min(1).max(300).optional(),
  description:     z.string().optional(),
  status:          z.enum(['open','triage','investigation','capa','awaiting_closure','closed','cancelled']).optional(),
  severity:        z.enum(['minor','moderate','high','critical']).optional(),
  immediateAction: z.string().nullable().optional(),
  regulatoryClass: z.string().nullable().optional(),
  recordable:      z.boolean().optional(),
  lostTime:        z.boolean().optional(),
  metadata:        z.record(z.string(), z.unknown()).optional(),
});

router.post('/incidents/update', async c => {
  const user = await requirePermission(c, 'hse.incidents.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, UpdateSchema, body.args);
  if (!v.ok) return v.response;

  const { incidentId, ...fields } = v.data;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (fields.title !== undefined)           updates.title           = fields.title;
  if (fields.description !== undefined)     updates.description     = fields.description;
  if (fields.status !== undefined)          updates.status          = fields.status;
  if (fields.severity !== undefined)        updates.severity        = fields.severity;
  if (fields.immediateAction !== undefined) updates.immediate_action = fields.immediateAction;
  if (fields.regulatoryClass !== undefined) updates.regulatory_class = fields.regulatoryClass;
  if (fields.recordable !== undefined)      updates.recordable      = fields.recordable;
  if (fields.lostTime !== undefined)        updates.lost_time       = fields.lostTime;
  if (fields.metadata !== undefined)        updates.metadata        = fields.metadata;

  const { error } = await sb.from('hse_incidents').update(updates).eq('id', incidentId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  // Emit update event (silent — no notification)
  void emitAppEvent({
    eventType:        'hse.incident.updated',
    sourceModule:     'hse',
    sourceEntityType: 'incident',
    sourceEntityId:   incidentId,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { changes: Object.keys(updates) },
  });

  return c.json({ success: true });
});

export default router;
