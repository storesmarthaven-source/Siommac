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

import { Hono }               from 'hono';
import { z, zv }              from '../lib/validate';
import { requirePermission }  from '../lib/auth';
import { sb }                 from '../lib/db';
import { nextRef }            from '../lib/refGenerator';
import { emitAppEvent, deliverEventNotifications } from '../lib/appEvents';
import { runModuleMutation }  from '../lib/moduleServiceAdapter';
import { createHandoff }      from '../lib/handoffBus';
import { selectWorkflowBinding } from '../lib/workflow/bindingResolver';
import { rpcHttpError }       from '../lib/workflow/service';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

// ── OSH Act 2004 (T&T) statutory notification deadlines ───────────────────────
// Notifiable incidents (severity high|critical) require verbal notification to
// the OSH Authority within 24h and a written report within 7 days of the event.
// Source: OSH Act 2004 s.19. Non-notifiable incidents carry no deadline.

function oshDeadlines(incidentDate: string, severity: string): {
  osh_notification_due: string | null;
  osh_written_due:      string | null;
} {
  const notifiable = severity === 'high' || severity === 'critical';
  if (!notifiable) return { osh_notification_due: null, osh_written_due: null };
  const t = new Date(incidentDate).getTime();
  return {
    osh_notification_due: new Date(t + 24 * 3600_000).toISOString(),
    osh_written_due:      new Date(t + 7 * 24 * 3600_000).toISOString(),
  };
}

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
    .select('id, ref, title, description, incident_date, incident_type, severity, status, site_id, department_id, location_text, reported_by, immediate_action, regulatory_class, osh_classification, injury_type, body_part, lost_days, return_to_work, osh_notification_due, osh_notified_at, osh_written_due, osh_written_at, recordable, lost_time, workflow_id, metadata, created_at, updated_at')
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

const OSH_CLASSES = [
  'first-aid','medical-treatment','restricted-duty','lost-time',
  'fatality','property-damage','environmental','near-miss','dangerous-occurrence',
] as const;

const CreateSchema = z.object({
  title:           z.string().min(1).max(300),
  description:     z.string().default(''),
  incidentDate:    z.string().min(1),
  siteId:          z.string().nullable().optional(),
  departmentId:    z.string().nullable().optional(),
  locationText:    z.string().nullable().optional(),
  incidentType:    z.string().min(1),
  severity:        z.enum(['minor','moderate','high','critical']),
  immediateAction: z.string().nullable().optional(),
  regulatoryClass: z.string().nullable().optional(),
  oshClassification: z.enum(OSH_CLASSES).nullable().optional(),
  injuryType:      z.string().nullable().optional(),
  bodyPart:        z.string().nullable().optional(),
  lostDays:        z.number().int().min(0).default(0),
  returnToWork:    z.string().nullable().optional(),
  recordable:      z.boolean().default(false),
  lostTime:        z.boolean().default(false),
  costImpact:      z.boolean().default(false),
  equipmentDamage: z.boolean().default(false),
  people:          z.array(PersonSchema).default([]),
  metadata:        z.record(z.string(), z.unknown()).optional(),
});

router.post('/incidents/create', async c => {
  const user = await requirePermission(c, 'hse.incidents.create');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, CreateSchema, body.args);
  if (!v.ok) return v.response;

  const injuredEmployeeId = v.data.people.find(p => p.personType === 'injured')?.userId ?? null;
  const evSeverity = v.data.severity === 'critical' ? 'critical' as const
    : v.data.severity === 'high' ? 'high' as const : 'info' as const;

  const contentKey = `hse.incident.create:${user.id}:${v.data.incidentDate}:${v.data.title}`;
  // The 3 conditional cross-module handoffs (parity with the former Stage-4).
  const buildHandoffs = (entityId: string, entityRef: string, eventId: string | null) => {
    const defs = [
      {
        targetModule: 'hr', condition: v.data.lostTime,
        payload: {
          reason: 'lost_time_incident', severity: v.data.severity,
          incidentType: v.data.incidentType, employeeId: injuredEmployeeId,
          lostDays: v.data.lostDays, title: v.data.title,
        },
      },
      {
        targetModule: 'finance', condition: v.data.costImpact,
        payload: {
          reason: 'incident_cost_impact', severity: v.data.severity,
          incidentType: v.data.incidentType, title: v.data.title,
          siteId: v.data.siteId ?? null,
        },
      },
      {
        targetModule: 'operations', condition: v.data.equipmentDamage,
        payload: {
          reason: 'equipment_damage', severity: v.data.severity,
          incidentType: v.data.incidentType,
          title: `Equipment inspection: ${v.data.title}`,
          description: 'Equipment damage reported in incident. Immediate inspection and repair assessment required.',
          siteId: v.data.siteId ?? null,
          priority: v.data.severity === 'critical' ? 'critical' : 'medium',
        },
      },
    ];
    return defs.filter(d => d.condition).map(d => createHandoff({
      sourceModule: 'hse', targetModule: d.targetModule,
      sourceEntityType: 'incident', sourceEntityId: entityId,
      payload: { ...d.payload, sourceRef: entityRef, sourceEventId: eventId },
      createdBy: user.id,
    }));
  };

  try {
    // ATOMIC (finding #3, slice D1): with an investigation binding, the incident
    // INSERT (status 'triage', the former adapter onStarted) + people rows +
    // workflow start + workflow_id link + business event + audit row commit in
    // ONE transaction (hse_incidents branch of workflow_create_and_start_tx).
    // Notifications + cross-module handoffs are post-commit (parity with the
    // former Stage-2/Stage-4 semantics — separate writes then, separate now).
    const binding = await selectWorkflowBinding(sb, {
      moduleKey: 'hse_incidents', workflowType: 'incident_investigation',
      triggerEvent: 'incident.reported', sourceRecordId: '', requestedBy: user.id, recordData: {},
    });

    if (binding) {
      const { osh_notification_due, osh_written_due } = oshDeadlines(v.data.incidentDate, v.data.severity);
      const { data, error } = await sb.rpc('workflow_create_and_start_tx', {
        p_source_table: 'hse_incidents', p_actor_id: user.id,
        p_binding_id: binding.id, p_request_key: contentKey,
        p_business: {
          title:              v.data.title,
          description:        v.data.description,
          incidentDate:       v.data.incidentDate,
          siteId:             v.data.siteId ?? null,
          departmentId:       v.data.departmentId ?? null,
          locationText:       v.data.locationText ?? null,
          incidentType:       v.data.incidentType,
          severity:           v.data.severity,
          immediateAction:    v.data.immediateAction ?? null,
          regulatoryClass:    v.data.regulatoryClass ?? null,
          oshClassification:  v.data.oshClassification ?? null,
          injuryType:         v.data.injuryType ?? null,
          bodyPart:           v.data.bodyPart ?? null,
          lostDays:           v.data.lostDays,
          returnToWork:       v.data.returnToWork ?? null,
          oshNotificationDue: osh_notification_due,
          oshWrittenDue:      osh_written_due,
          recordable:         v.data.recordable,
          lostTime:           v.data.lostTime,
          metadata:           v.data.metadata ?? {},
          people:             v.data.people,
        },
      });
      if (error) throw rpcHttpError(error as { code?: string | null; message: string });
      const rpc = (data ?? {}) as { recordId?: string; ref?: string; workflowId?: string; eventId?: string };

      void deliverEventNotifications({
        eventType: 'hse.incident.submitted', sourceModule: 'hse', sourceEntityType: 'incident',
        sourceEntityId: rpc.recordId ?? '', actorUserId: user.id,
        severity: evSeverity,
        notification: {
          title: `New incident reported`,
          body:  `${v.data.severity.toUpperCase()} — ${v.data.title}`,
          actionRoute: 'hse/incidents',
          type:  'hse.incident.submitted',
        },
        dedupeKey: `${contentKey}:notify`,
      }, rpc.eventId ?? null);

      const handoffResults = await Promise.all(buildHandoffs(rpc.recordId ?? '', rpc.ref ?? '', rpc.eventId ?? null));
      const handoffIds = handoffResults.filter(h => h.ok && h.handoffId).map(h => h.handoffId as string);

      return c.json({
        success: true,
        data: {
          id:         rpc.recordId,
          ref:        rpc.ref,
          workflowId: rpc.workflowId ?? null,
          eventId:    rpc.eventId ?? null,
          handoffIds,
        },
      });
    }

    // No investigation binding — create-only via the module adapter (incident
    // stays 'open'; audit + event + notification + handoffs preserved, no workflow).
    const result = await runModuleMutation<{ id: string; ref: string }>({
      context: {
        actorUserId:  user.id,
        siteId:       v.data.siteId ?? null,
        departmentId: v.data.departmentId ?? null,
      },
      options: {
        module:         'hse',
        operation:      'create',
        entityType:     'incident',
        idempotencyKey: contentKey,
        eventType:      'hse.incident.submitted',
        eventSeverity:  evSeverity,
        eventPayload:   { title: v.data.title, severity: v.data.severity, lostTime: v.data.lostTime },
        notification: {
          title: `New incident reported`,
          body:  `${v.data.severity.toUpperCase()} — ${v.data.title}`,
          actionRoute: 'hse/incidents',
          type:  'hse.incident.submitted',
        },
        handoffs: [
          {
            targetModule: 'hr',
            condition:    v.data.lostTime,
            payload: {
              reason:       'lost_time_incident',
              severity:     v.data.severity,
              incidentType: v.data.incidentType,
              employeeId:   injuredEmployeeId,
              lostDays:     v.data.lostDays,
              title:        v.data.title,
            },
          },
          {
            targetModule: 'finance',
            condition:    v.data.costImpact,
            payload: {
              reason:       'incident_cost_impact',
              severity:     v.data.severity,
              incidentType: v.data.incidentType,
              title:        v.data.title,
              siteId:       v.data.siteId ?? null,
            },
          },
          {
            targetModule: 'operations',
            condition:    v.data.equipmentDamage,
            payload: {
              reason:       'equipment_damage',
              severity:     v.data.severity,
              incidentType: v.data.incidentType,
              title:        `Equipment inspection: ${v.data.title}`,
              description:  'Equipment damage reported in incident. Immediate inspection and repair assessment required.',
              siteId:       v.data.siteId ?? null,
              priority:     v.data.severity === 'critical' ? 'critical' : 'medium',
            },
          },
        ],
        getEntityIdentity: (record) => ({ id: record.id, ref: record.ref }),
      },
      writeRecord: async () => {
        const ref = await nextRef('INC');
        const { osh_notification_due, osh_written_due } = oshDeadlines(v.data.incidentDate, v.data.severity);

        const { data: incident, error: incErr } = await sb
          .from('hse_incidents')
          .insert({
            ref,
            title:              v.data.title,
            description:        v.data.description,
            incident_date:      v.data.incidentDate,
            reported_by:        user.id,
            site_id:            v.data.siteId ?? null,
            department_id:      v.data.departmentId ?? null,
            location_text:      v.data.locationText ?? null,
            incident_type:      v.data.incidentType,
            severity:           v.data.severity,
            status:             'open',
            immediate_action:   v.data.immediateAction ?? null,
            regulatory_class:   v.data.regulatoryClass ?? null,
            osh_classification: v.data.oshClassification ?? null,
            injury_type:        v.data.injuryType ?? null,
            body_part:          v.data.bodyPart ?? null,
            lost_days:          v.data.lostDays,
            return_to_work:     v.data.returnToWork ?? null,
            osh_notification_due,
            osh_written_due,
            recordable:         v.data.recordable,
            lost_time:          v.data.lostTime,
            metadata:           v.data.metadata ?? {},
          })
          .select('id, ref')
          .single<{ id: string; ref: string }>();

        if (incErr || !incident) throw incErr ?? new Error('Incident insert failed');

        if (v.data.people.length > 0) {
          const { error: peopleErr } = await sb.from('hse_incident_people').insert(
            v.data.people.map(p => ({
              incident_id:        incident.id,
              person_type:        p.personType,
              user_id:            p.userId ?? null,
              full_name:          p.fullName,
              role_or_company:    p.roleOrCompany ?? null,
              injury_description: p.injuryDescription ?? null,
            })),
          );
          if (peopleErr) {
            // Compensating rollback — never leave an incident without its people.
            await sb.from('hse_incidents').delete().eq('id', incident.id);
            throw peopleErr;
          }
        }

        return incident;
      },
    });

    return c.json({
      success: true,
      data: {
        id:         result.entityId,
        ref:        result.entityRef,
        workflowId: null,
        eventId:    result.eventId     ?? null,
        handoffIds: result.handoffIds,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const msg = err instanceof Error ? err.message : 'Create failed';
    return c.json({ success: false, message: msg }, status as 200);
  }
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
  oshClassification: z.enum(OSH_CLASSES).nullable().optional(),
  injuryType:      z.string().nullable().optional(),
  bodyPart:        z.string().nullable().optional(),
  lostDays:        z.number().int().min(0).optional(),
  returnToWork:    z.string().nullable().optional(),
  oshNotifiedAt:   z.string().nullable().optional(),
  oshWrittenAt:    z.string().nullable().optional(),
  recordable:      z.boolean().optional(),
  lostTime:        z.boolean().optional(),
  costImpact:      z.boolean().optional(),
  equipmentDamage: z.boolean().optional(),
  metadata:        z.record(z.string(), z.unknown()).optional(),
});

router.post('/incidents/update', async c => {
  const user = await requirePermission(c, 'hse.incidents.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, UpdateSchema, body.args);
  if (!v.ok) return v.response;

  const { incidentId, ...fields } = v.data;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (fields.title !== undefined)             updates.title             = fields.title;
  if (fields.description !== undefined)       updates.description       = fields.description;
  if (fields.status !== undefined)            updates.status            = fields.status;
  if (fields.severity !== undefined)          updates.severity          = fields.severity;
  if (fields.immediateAction !== undefined)   updates.immediate_action  = fields.immediateAction;
  if (fields.regulatoryClass !== undefined)   updates.regulatory_class  = fields.regulatoryClass;
  if (fields.oshClassification !== undefined) updates.osh_classification = fields.oshClassification;
  if (fields.injuryType !== undefined)        updates.injury_type       = fields.injuryType;
  if (fields.bodyPart !== undefined)          updates.body_part         = fields.bodyPart;
  if (fields.lostDays !== undefined)          updates.lost_days         = fields.lostDays;
  if (fields.returnToWork !== undefined)      updates.return_to_work    = fields.returnToWork;
  if (fields.oshNotifiedAt !== undefined)     updates.osh_notified_at   = fields.oshNotifiedAt;
  if (fields.oshWrittenAt !== undefined)      updates.osh_written_at    = fields.oshWrittenAt;
  if (fields.recordable !== undefined)        updates.recordable        = fields.recordable;
  if (fields.lostTime !== undefined)          updates.lost_time         = fields.lostTime;
  if (fields.metadata !== undefined)          updates.metadata          = fields.metadata;

  const { error } = await sb.from('hse_incidents').update(updates).eq('id', incidentId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  // Closing an incident notifies the original reporter (a confirmation, not an
  // action). Every other status change is a silent audit-only event.
  if (fields.status === 'closed') {
    const closed = await sb.from('hse_incidents')
      .select('ref, reported_by').eq('id', incidentId)
      .maybeSingle<{ ref: string; reported_by: string | null }>();
    const reporter = closed.data?.reported_by;
    void emitAppEvent({
      eventType:        'hse.incident.closed',
      sourceModule:     'hse',
      sourceEntityType: 'incident',
      sourceEntityId:   incidentId,
      actorUserId:      user.id,
      severity:         'success',
      payload:          { status: 'closed' },
      ...(reporter && reporter !== user.id ? {
        explicitRecipients: [{ userId: reporter, reason: 'owner' as const }],
        notification: {
          title:       'Incident closed',
          body:        `${closed.data?.ref ?? 'Your reported incident'} was investigated and closed.`,
          actionRoute: 'hse/incidents',
        },
      } : {}),
    });
  } else {
    // Silent audit event for all other field/status changes.
    void emitAppEvent({
      eventType:        'hse.incident.updated',
      sourceModule:     'hse',
      sourceEntityType: 'incident',
      sourceEntityId:   incidentId,
      actorUserId:      user.id,
      severity:         'info',
      payload:          { changes: Object.keys(updates) },
    });
  }

  return c.json({ success: true });
});

// ── POST /api/hse/dashboard/kpis ──────────────────────────────────────────────
//
// Aggregate HSE command-view KPIs from canonical tables.
// LTI-free days = days since the most recent lost_time incident.

router.post('/dashboard/kpis', async c => {
  await requirePermission(c, 'hse.dashboard.view');

  const now        = new Date().toISOString();
  const yearStart  = `${new Date().getFullYear()}-01-01T00:00:00Z`;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [
    incidentsMtd,
    openIncidents,
    openCapas,
    overdueCapas,
    openWorkflows,
    oshOverdue,
    ltiResult,
    lostDaysResult,
    lastLtiResult,
  ] = await Promise.all([
    sb.from('hse_incidents').select('id', { count: 'exact', head: true })
      .gte('incident_date', monthStart),
    sb.from('hse_incidents').select('id', { count: 'exact', head: true })
      .not('status', 'in', '(closed,cancelled)'),
    sb.from('hse_capa_actions').select('id', { count: 'exact', head: true })
      .not('status', 'in', '(closed,cancelled)'),
    sb.from('hse_capa_actions').select('id', { count: 'exact', head: true })
      .not('status', 'in', '(closed,cancelled)').lt('due_at', now),
    sb.from('workflow_instances').select('id', { count: 'exact', head: true })
      .in('module_key', ['hse_incidents','hse_capa','hse_hazards','hse_risk_assessments','hse_jsa'])
      .not('status', 'in', '(approved,rejected,closed,completed,cancelled)'),
    // OSH verbal notifications past their statutory deadline and still unfulfilled
    sb.from('hse_incidents').select('id', { count: 'exact', head: true })
      .not('osh_notification_due', 'is', null)
      .is('osh_notified_at', null)
      .lt('osh_notification_due', now),
    // Lost-time incidents YTD
    sb.from('hse_incidents').select('id', { count: 'exact', head: true })
      .eq('lost_time', true).gte('incident_date', yearStart),
    // Sum of lost days YTD
    sb.from('hse_incidents').select('lost_days')
      .gte('incident_date', yearStart),
    // Most recent lost-time incident (for LTI-free-days counter)
    sb.from('hse_incidents').select('incident_date')
      .eq('lost_time', true).order('incident_date', { ascending: false }).limit(1),
  ]);

  const lastLtiDate = (lastLtiResult.data ?? [])[0]?.incident_date as string | undefined;
  const ltiFreeDays = lastLtiDate
    ? Math.floor((Date.now() - new Date(lastLtiDate).getTime()) / 86_400_000)
    : null;
  const totalLostDays = ((lostDaysResult.data ?? []) as Array<{ lost_days: number | null }>)
    .reduce((s, r) => s + (r.lost_days ?? 0), 0);

  return c.json({
    success: true,
    data: {
      incidentsMtd:            incidentsMtd.count  ?? 0,
      openIncidents:           openIncidents.count ?? 0,
      openCapas:               openCapas.count     ?? 0,
      overdueCapas:            overdueCapas.count  ?? 0,
      openWorkflows:           openWorkflows.count ?? 0,
      oshNotificationsOverdue: oshOverdue.count    ?? 0,
      ltiCasesYtd:             ltiResult.count     ?? 0,
      totalLostDays,
      ltiFreeDays,
    },
  });
});

// ── POST /api/hse/incidents/detail ───────────────────────────────────────────
// Returns all drawer data for one incident in 3 async phases:
//   Phase 1: incident row
//   Phase 2: people, investigations, incident-level CAPA, workflow, timeline
//   Phase 3: evidence, root causes, inv-level CAPA, workflow tasks

router.post('/incidents/detail', async c => {
  await requirePermission(c, 'hse.incidents.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { incidentId?: string; ref?: string } | undefined;

  if (!args?.incidentId && !args?.ref) {
    return c.json({ success: false, message: 'incidentId or ref required' }, 400 as 200);
  }

  // Phase 1 — fetch the incident
  let incQ = sb.from('hse_incidents').select('*');
  if (args.incidentId) incQ = incQ.eq('id', args.incidentId);
  else                 incQ = incQ.eq('ref', args.ref!);

  const incRes = await incQ.maybeSingle();
  if (!incRes.data) return c.json({ success: false, message: 'Incident not found' }, 404 as 200);

  const incident   = incRes.data as Record<string, unknown>;
  const incidentId = incident.id as string;
  const incidentRef = incident.ref as string;

  // Phase 2 — all data queryable from incidentId / incidentRef
  const [peopleRes, invRes, incCapaRes, wfRes, timelineRes] = await Promise.all([
    sb.from('hse_incident_people')
      .select('*')
      .eq('incident_id', incidentId)
      .order('created_at'),
    sb.from('hse_investigations')
      .select('*')
      .eq('incident_id', incidentId)
      .order('created_at', { ascending: false })
      .limit(1),
    sb.from('hse_capa_actions')
      .select('*')
      .eq('source_type', 'incident')
      .eq('source_id', incidentRef)
      .order('due_at', { ascending: true, nullsFirst: false }),
    incident.workflow_id
      ? sb.from('workflow_instances')
          .select('id, ref:workflow_no, template_id, source_module:module_key, source_entity_type:workflow_type, source_entity_id:source_record_id, status, priority, current_step:current_step_key, owner_user_id:owner_id, due_at, created_at, updated_at, closed_at, metadata')
          .eq('id', incident.workflow_id as string)
          .limit(1)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    sb.from('app_events')
      .select('id, event_type, source_entity_type, source_entity_id, actor_user_id, severity, payload, created_at')
      .eq('source_entity_id', incidentId)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  const investigation = ((invRes.data ?? []) as Record<string, unknown>[])[0] ?? null;
  const workflow      = ((wfRes.data ?? []) as Record<string, unknown>[])[0] ?? null;

  // Phase 3 — data that needs investigation.id or workflow.id
  let evidence:      unknown[] = [];
  let rootCauses:    unknown[] = [];
  let invCapa:       unknown[] = [];
  let workflowTasks: unknown[] = [];

  const phase3: Promise<void>[] = [];

  if (investigation) {
    const invId  = investigation.id  as string;
    const invRef = investigation.ref as string | undefined;
    phase3.push(
      (async () => { const r = await sb.from('hse_investigation_evidence').select('*').eq('investigation_id', invId).order('created_at'); evidence = r.data ?? []; })(),
      (async () => { const r = await sb.from('hse_root_causes').select('*').eq('investigation_id', invId); rootCauses = r.data ?? []; })(),
    );
    if (invRef) {
      phase3.push(
        (async () => { const r = await sb.from('hse_capa_actions').select('*').eq('source_type', 'investigation').eq('source_id', invRef).order('due_at', { ascending: true, nullsFirst: false }); invCapa = r.data ?? []; })(),
      );
    }
  }

  if (workflow) {
    const wfId = workflow.id as string;
    phase3.push(
      (async () => { const r = await sb.from('workflow_tasks').select('*').eq('workflow_id', wfId).order('created_at'); workflowTasks = r.data ?? []; })(),
    );
  }

  await Promise.all(phase3);

  return c.json({
    success: true,
    data: {
      incident,
      people:        peopleRes.data    ?? [],
      investigation: investigation     ?? null,
      evidence,
      rootCauses,
      capa:          [...(incCapaRes.data ?? []), ...invCapa],
      workflow:      workflow           ?? null,
      workflowTasks,
      timeline:      timelineRes.data  ?? [],
    },
  });
});

export default router;
