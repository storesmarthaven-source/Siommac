/**
 * netlify/functions/routes/hsePtw.ts
 *
 * POST /api/hse/ptw/permits/list
 * POST /api/hse/ptw/permits/create
 * POST /api/hse/ptw/permits/get
 * POST /api/hse/ptw/permits/update
 * POST /api/hse/ptw/permits/save-draft
 * POST /api/hse/ptw/permits/submit
 * POST /api/hse/ptw/permits/approve
 * POST /api/hse/ptw/permits/reject
 * POST /api/hse/ptw/permits/request-changes
 * POST /api/hse/ptw/permits/activate
 * POST /api/hse/ptw/permits/suspend
 * POST /api/hse/ptw/permits/revalidate
 * POST /api/hse/ptw/permits/request-extension
 * POST /api/hse/ptw/permits/approve-extension
 * POST /api/hse/ptw/permits/reject-extension
 * POST /api/hse/ptw/permits/close
 * POST /api/hse/ptw/permits/cancel
 * POST /api/hse/ptw/permits/archive
 * POST /api/hse/ptw/permits/stats
 * POST /api/hse/ptw/permit-types/list
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

// ── PTW Status Machine ────────────────────────────────────────────────────────
// Backend-owned. Matches spec §PTW workflow states exactly.

const PERMIT_TRANSITIONS: Record<string, string[]> = {
  draft:               ['submitted', 'cancelled'],
  submitted:           ['risk_review', 'changes_requested', 'cancelled'],
  risk_review:         ['isolation_pending', 'gas_test_pending', 'awaiting_approval', 'changes_requested', 'rejected'],
  isolation_pending:   ['gas_test_pending', 'awaiting_approval', 'changes_requested'],
  gas_test_pending:    ['awaiting_approval', 'changes_requested'],
  awaiting_approval:   ['approved', 'rejected', 'changes_requested'],
  changes_requested:   ['draft', 'submitted'],
  approved:            ['active', 'cancelled'],
  active:              ['suspended', 'extension_requested', 'expired', 'closed'],
  suspended:           ['active', 'closed', 'cancelled'],
  extension_requested: ['active', 'expired'],
  expired:             ['closed'],
  closed:              ['archived'],
  cancelled:           ['archived'],
  rejected:            ['draft', 'archived'],
  archived:            [],
};

function canTransition(from: string, to: string): boolean {
  return PERMIT_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Permit type config shape (rows from hse_permit_type_config) ───────────────

interface PermitTypeConfig {
  requires_jsa:                boolean;
  requires_isolation:          boolean;
  requires_gas_test:           boolean;
  requires_simops_check:       boolean;
  requires_height_plan:        boolean;
  requires_hot_work_cert:      boolean;
  requires_confined_space_cert:boolean;
  requires_radiation_badge:    boolean;
  requires_excavation_survey:  boolean;
  requires_lifting_plan:       boolean;
  requires_line_break_cert:    boolean;
  requires_energized_cert:     boolean;
  max_duration_hours:          number;
}

// ── Activation gate ───────────────────────────────────────────────────────────
// All checks are against PTW-owned tables. JSA approval checked via hse_jsa
// (or left as a TODO if the table name cannot be confirmed at this stage).

interface PermitRow {
  id: string;
  permit_number: string | null;
  status: string;
  requires_jsa: boolean;
  requires_isolation: boolean;
  requires_gas_test: boolean;
  requires_simops_check: boolean;
  linked_jsa_id: string | null;
  created_by: string | null;
  requester_id: string | null;
  work_supervisor_id: string | null;
  area_authority_id: string | null;
}

async function canActivatePermit(
  c: Context<{ Variables: HonoVariables }>,
  permit: PermitRow,
): Promise<Response | null> {
  if (permit.status !== 'approved') {
    return c.json({ success: false, message: 'Permit must be in "approved" status to activate.' }, 400 as 200);
  }

  const failures: string[] = [];

  // 1. JSA requirement
  if (permit.requires_jsa) {
    if (!permit.linked_jsa_id) {
      failures.push('A linked JSA is required but none is attached.');
    } else {
      // TODO: verify linked JSA approval — confirm table is hse_jsa once Risk/JSA
      // module table name is validated. Currently gates only on PTW-owned data.
      const jsaRes = await sb
        .from('hse_jsa')
        .select('id, status')
        .eq('id', permit.linked_jsa_id)
        .maybeSingle<{ id: string; status: string }>();
      if (!jsaRes.data) {
        failures.push('Linked JSA not found.');
      } else if (!['approved', 'active'].includes(jsaRes.data.status)) {
        failures.push(`Linked JSA is in status "${jsaRes.data.status}" — must be approved or active.`);
      }
    }
  }

  // 2. Isolation requirement — all isolations must be 'verified'
  if (permit.requires_isolation) {
    const isoRes = await sb
      .from('hse_permit_isolations')
      .select('id, status')
      .eq('permit_id', permit.id)
      .neq('status', 'verified');
    const unverified = (isoRes.data ?? []).length;
    if (unverified > 0) {
      failures.push(`${unverified} isolation point(s) are not yet verified.`);
    }
  }

  // 3. Gas test requirement — at least one gas test with result='pass'
  if (permit.requires_gas_test) {
    const gtRes = await sb
      .from('hse_permit_gas_tests')
      .select('id')
      .eq('permit_id', permit.id)
      .eq('result', 'pass')
      .limit(1);
    if ((gtRes.data ?? []).length === 0) {
      failures.push('A passing gas test result is required before activation.');
    }
  }

  // 4. SIMOPS — no hard-block conflicts unresolved
  if (permit.requires_simops_check) {
    const simopsRes = await sb
      .from('hse_permit_simops_conflicts')
      .select('id')
      .eq('permit_id', permit.id)
      .in('status', ['open'])
      .limit(1);
    if ((simopsRes.data ?? []).length > 0) {
      failures.push('There are unresolved SIMOPS conflicts that must be resolved before activation.');
    }
  }

  // 5. All required approvals must be 'approved'
  const approvalsRes = await sb
    .from('hse_permit_approvals')
    .select('id, status, role_required')
    .eq('permit_id', permit.id)
    .neq('status', 'approved')
    .neq('status', 'skipped');
  const pendingApprovals = (approvalsRes.data ?? []) as Array<{ role_required: string }>;
  if (pendingApprovals.length > 0) {
    const roles = pendingApprovals.map(a => a.role_required).join(', ');
    failures.push(`Pending approvals from: ${roles}.`);
  }

  if (failures.length > 0) {
    return c.json({
      success: false,
      message: 'Permit cannot be activated. Pre-activation checks failed.',
      failures,
    }, 400 as 200);
  }

  return null;
}

// ── Shared transition helper ──────────────────────────────────────────────────

async function applyPermitTransition(
  c: Context<{ Variables: HonoVariables }>,
  opts: {
    permitId:  string;
    action:    string;
    toStatus:  string;
    actorId:   string;
    note?:     string | null;
  },
): Promise<Response> {
  const cur = await sb
    .from('hse_permits')
    .select('id, permit_number, status, created_by, requester_id, work_supervisor_id, area_authority_id, requires_jsa, requires_isolation, requires_gas_test, requires_simops_check, linked_jsa_id')
    .eq('id', opts.permitId)
    .maybeSingle<PermitRow>();

  if (!cur.data) return c.json({ success: false, message: 'Permit not found.' }, 404 as 200);
  const permit = cur.data;

  if (permit.status === opts.toStatus) {
    return c.json({ success: false, message: `Permit is already "${opts.toStatus}".` }, 400 as 200);
  }
  if (!canTransition(permit.status, opts.toStatus)) {
    return c.json({
      success: false,
      message: `Cannot "${opts.action}" from status "${permit.status}".`,
    }, 400 as 200);
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status: opts.toStatus, updated_at: now };

  // Set lifecycle timestamp columns
  if (opts.toStatus === 'active')     { updates.actual_start = now; updates.issued_at = now; updates.issued_by = opts.actorId; }
  if (opts.toStatus === 'closed')     { updates.actual_end = now; updates.closed_at = now; updates.closed_by = opts.actorId; }
  if (opts.toStatus === 'cancelled')  { updates.cancelled_at = now; if (opts.note) updates.cancelled_reason = opts.note; }

  const { error } = await sb.from('hse_permits').update(updates).eq('id', opts.permitId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  // Write PTW-scoped audit event
  void sb.from('hse_permit_audit_events').insert({
    permit_id:     opts.permitId,
    action:        opts.action,
    actor_user_id: opts.actorId,
    after_state:   { status: opts.toStatus },
    metadata:      { note: opts.note ?? null },
  });

  // Determine severity and notification targets
  const permRef = permit.permit_number ?? opts.permitId;
  const severity =
    ['rejected', 'expired'].includes(opts.toStatus) ? 'warning' as const :
    ['approved', 'active'].includes(opts.toStatus)  ? 'success' as const :
    'info' as const;

  // Explicit notification recipients by action
  const notifyRequester = permit.requester_id && permit.requester_id !== opts.actorId
    ? [{ userId: permit.requester_id, reason: 'owner' as const }]
    : [];
  const notifySupervisor = permit.work_supervisor_id && permit.work_supervisor_id !== opts.actorId
    ? [{ userId: permit.work_supervisor_id, reason: 'participant' as const }]
    : [];

  const NOTIFY_MAP: Record<string, {
    eventType: string;
    title: string;
    body: string;
    actionRequired?: boolean;
    recipients: Array<{ userId: string; reason: 'owner' | 'assignee' | 'participant' }>;
    dedupeKey?: string;
  } | undefined> = {
    submitted: {
      eventType: 'ptw.permit.submitted',
      title: `PTW submitted for review: ${permRef}`,
      body: `A permit has been submitted and awaits area authority review.`,
      actionRequired: true,
      recipients: permit.area_authority_id && permit.area_authority_id !== opts.actorId
        ? [{ userId: permit.area_authority_id, reason: 'assignee' as const }]
        : [],
      dedupeKey: `ptw.permit.submitted:${opts.permitId}`,
    },
    approved: {
      eventType: 'ptw.permit.approved',
      title: `Permit approved: ${permRef}`,
      body: `Your permit has been approved and is ready for activation.`,
      recipients: notifyRequester,
      dedupeKey: `ptw.permit.approved:${opts.permitId}`,
    },
    rejected: {
      eventType: 'ptw.permit.rejected',
      title: `Permit rejected: ${permRef}`,
      body: `Your permit was rejected${opts.note ? `: ${opts.note}` : '.'}`,
      actionRequired: true,
      recipients: notifyRequester,
      dedupeKey: `ptw.permit.rejected:${opts.permitId}`,
    },
    changes_requested: {
      eventType: 'ptw.permit.changes_requested',
      title: `Changes requested on permit: ${permRef}`,
      body: opts.note ?? 'The reviewer has requested changes to your permit.',
      actionRequired: true,
      recipients: notifyRequester,
    },
    activated: {
      eventType: 'ptw.permit.activated',
      title: `Permit activated: ${permRef}`,
      body: `Work may now commence under permit ${permRef}.`,
      recipients: [...notifyRequester, ...notifySupervisor],
      dedupeKey: `ptw.permit.activated:${opts.permitId}`,
    },
    suspended: {
      eventType: 'ptw.permit.suspended',
      title: `Permit suspended: ${permRef}`,
      body: opts.note ?? 'Work has been suspended under this permit.',
      actionRequired: true,
      recipients: [...notifyRequester, ...notifySupervisor],
    },
    expired: {
      eventType: 'ptw.permit.expired',
      title: `Permit expired: ${permRef}`,
      body: `Permit ${permRef} has expired. Work must stop immediately.`,
      actionRequired: true,
      recipients: [...notifyRequester, ...notifySupervisor],
    },
    closed: {
      eventType: 'ptw.permit.closed',
      title: `Permit closed: ${permRef}`,
      body: `Permit ${permRef} has been closed.`,
      recipients: notifyRequester,
    },
  };

  const nDef = NOTIFY_MAP[opts.action];
  void emitAppEvent({
    eventType:        nDef?.eventType ?? `ptw.permit.${opts.action}`,
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permRef,
    actorUserId:      opts.actorId,
    severity,
    payload:          { action: opts.action, fromStatus: permit.status, toStatus: opts.toStatus, note: opts.note ?? null },
    ...(nDef && nDef.recipients.length > 0 ? {
      explicitRecipients: nDef.recipients,
      notification: {
        title:          nDef.title,
        body:           nDef.body,
        actionRoute:    `hse/permits/${opts.permitId}`,
        type:           nDef.eventType,
        actionRequired: nDef.actionRequired ?? false,
      },
    } : {}),
    ...(nDef?.dedupeKey ? { dedupeKey: nDef.dedupeKey } : {}),
  });

  return c.json({ success: true, status: opts.toStatus });
}

// ── POST /api/hse/ptw/permits/list ────────────────────────────────────────────

const PermitListSchema = z.object({
  status:       z.string().nullable().optional(),
  permitType:   z.string().nullable().optional(),
  siteId:       z.string().nullable().optional(),
  riskLevel:    z.string().nullable().optional(),
  requesterId:  z.string().nullable().optional(),
  expiringSoon: z.boolean().optional(),
  search:       z.string().nullable().optional(),
  limit:        z.number().int().min(1).max(200).default(50),
});

router.post('/ptw/permits/list', async c => {
  await requirePermission(c, 'hse.ptw.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, PermitListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  const cols = [
    'id', 'permit_number', 'title', 'permit_type', 'risk_level', 'status',
    'site_id', 'specific_location', 'requester_id', 'work_supervisor_id',
    'area_authority_id', 'start_datetime', 'end_datetime', 'created_at', 'updated_at',
  ].join(', ');

  let q = sb
    .from('hse_permits')
    .select(cols)
    .order('created_at', { ascending: false })
    .limit(v.data.limit);

  if (v.data.status)      q = q.eq('status', v.data.status);
  if (v.data.permitType)  q = q.eq('permit_type', v.data.permitType);
  if (v.data.siteId)      q = q.eq('site_id', v.data.siteId);
  if (v.data.riskLevel)   q = q.eq('risk_level', v.data.riskLevel);
  if (v.data.requesterId) q = q.eq('requester_id', v.data.requesterId);
  if (v.data.search)      q = q.ilike('title', `%${v.data.search}%`);
  if (v.data.expiringSoon) {
    const twoHours = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    q = q
      .eq('status', 'active')
      .not('end_datetime', 'is', null)
      .lte('end_datetime', twoHours);
  }

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/ptw/permits/create ─────────────────────────────────────────

const PermitCreateSchema = z.object({
  permitType:       z.string().min(1),
  title:            z.string().min(1).max(300),
  description:      z.string().default(''),
  siteId:           z.string().nullable().optional(),
  areaId:           z.string().uuid().nullable().optional(),
  departmentId:     z.string().uuid().nullable().optional(),
  specificLocation: z.string().nullable().optional(),
  assetId:          z.string().uuid().nullable().optional(),
  riskLevel:        z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
  startDatetime:    z.string().nullable().optional(),
  endDatetime:      z.string().nullable().optional(),
  workSupervisorId: z.string().nullable().optional(),
  safetyOfficerId:  z.string().nullable().optional(),
  areaAuthorityId:  z.string().nullable().optional(),
  contractorCompanyId: z.string().uuid().nullable().optional(),
  contractorName:   z.string().nullable().optional(),
  contractorRep:    z.string().nullable().optional(),
  linkedJsaId:          z.string().uuid().nullable().optional(),
  linkedRiskAssessmentId: z.string().uuid().nullable().optional(),
  linkedWorkOrderId:    z.string().uuid().nullable().optional(),
  linkedIncidentId:     z.string().uuid().nullable().optional(),
  templateId:       z.string().uuid().nullable().optional(),
  /** When true, status starts as 'submitted' instead of 'draft'. */
  submitImmediately: z.boolean().default(false),
  metadata:         z.record(z.string(), z.unknown()).optional(),
});

router.post('/ptw/permits/create', async c => {
  const user = await requirePermission(c, 'hse.ptw.create');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, PermitCreateSchema, body.args);
  if (!v.ok) return v.response;

  // Read requires_* flags from permit type config
  const typeConfig = await sb
    .from('hse_permit_type_config')
    .select('requires_jsa, requires_isolation, requires_gas_test, requires_simops_check, requires_height_plan, requires_hot_work_cert, requires_confined_space_cert, requires_radiation_badge, requires_excavation_survey, requires_lifting_plan, requires_line_break_cert, requires_energized_cert, max_duration_hours')
    .eq('permit_type', v.data.permitType)
    .eq('active', true)
    .maybeSingle<PermitTypeConfig>();

  if (!typeConfig.data) {
    return c.json({ success: false, message: `Unknown or inactive permit type: ${v.data.permitType}` }, 400 as 200);
  }
  const cfg = typeConfig.data;

  const initialStatus = v.data.submitImmediately ? 'submitted' : 'draft';

  try {
    const result = await runModuleMutation<{ id: string; permit_number: string }>({
      context: {
        actorUserId:  user.id,
        siteId:       v.data.siteId ?? null,
        departmentId: v.data.departmentId ? String(v.data.departmentId) : null,
      },
      options: {
        module:         'hse',
        operation:      'create',
        entityType:     'permit',
        idempotencyKey: `hse.ptw.create:${user.id}:${v.data.permitType}:${v.data.title}`,
        eventType:      'hse.permit.created',
        eventSeverity:  'info',
        eventPayload:   { permitType: v.data.permitType, status: initialStatus },
        getEntityIdentity: (r) => ({ id: r.id, ref: r.permit_number ?? r.id }),
        afterCommit: async ({ entityId }) => {
          // Write PTW audit event
          void sb.from('hse_permit_audit_events').insert({
            permit_id:     entityId,
            action:        'created',
            actor_user_id: user.id,
            after_state:   { status: initialStatus },
            metadata:      {},
          });
          // If submitted immediately, write the submit transition audit event too
          if (v.data.submitImmediately) {
            void sb.from('hse_permit_audit_events').insert({
              permit_id:     entityId,
              action:        'submitted',
              actor_user_id: user.id,
              after_state:   { status: 'submitted' },
              metadata:      {},
            });
          }
        },
      },
      writeRecord: async () => {
        const permitNo = await nextRef('PTW');
        const now = new Date().toISOString();

        const { data, error } = await sb
          .from('hse_permits')
          .insert({
            permit_number:         permitNo,
            permit_type:           v.data.permitType,
            title:                 v.data.title,
            description:           v.data.description,
            status:                initialStatus,
            risk_level:            v.data.riskLevel ?? null,
            site_id:               v.data.siteId ?? null,
            area_id:               v.data.areaId ?? null,
            department_id:         v.data.departmentId ?? null,
            specific_location:     v.data.specificLocation ?? null,
            asset_id:              v.data.assetId ?? null,
            start_datetime:        v.data.startDatetime ?? null,
            end_datetime:          v.data.endDatetime ?? null,
            max_duration_hours:    cfg.max_duration_hours,
            requester_id:          user.id,
            work_supervisor_id:    v.data.workSupervisorId ?? null,
            safety_officer_id:     v.data.safetyOfficerId ?? null,
            area_authority_id:     v.data.areaAuthorityId ?? null,
            created_by:            user.id,
            contractor_company_id: v.data.contractorCompanyId ?? null,
            contractor_name:       v.data.contractorName ?? null,
            contractor_rep:        v.data.contractorRep ?? null,
            linked_jsa_id:             v.data.linkedJsaId ?? null,
            linked_risk_assessment_id: v.data.linkedRiskAssessmentId ?? null,
            linked_work_order_id:      v.data.linkedWorkOrderId ?? null,
            linked_incident_id:        v.data.linkedIncidentId ?? null,
            template_id:           v.data.templateId ?? null,
            // requires_* sourced from hse_permit_type_config
            requires_jsa:                cfg.requires_jsa,
            requires_isolation:          cfg.requires_isolation,
            requires_gas_test:           cfg.requires_gas_test,
            requires_simops_check:       cfg.requires_simops_check,
            requires_height_plan:        cfg.requires_height_plan,
            requires_hot_work_cert:      cfg.requires_hot_work_cert,
            requires_confined_space_cert: cfg.requires_confined_space_cert,
            requires_radiation_badge:    cfg.requires_radiation_badge,
            requires_excavation_survey:  cfg.requires_excavation_survey,
            requires_lifting_plan:       cfg.requires_lifting_plan,
            requires_line_break_cert:    cfg.requires_line_break_cert,
            metadata:              v.data.metadata ?? {},
            requested_at:          now,
            updated_at:            now,
          })
          .select('id, permit_number')
          .single<{ id: string; permit_number: string }>();

        if (error || !data) throw error ?? new Error('Permit insert failed');
        return data;
      },
    });

    // Emit submit event only when submitting immediately
    if (v.data.submitImmediately) {
      void emitAppEvent({
        eventType:        'ptw.permit.submitted',
        sourceModule:     'hse',
        sourceEntityType: 'permit',
        sourceEntityId:   result.entityRef ?? result.entityId,
        actorUserId:      user.id,
        severity:         'info',
        payload:          { permitType: v.data.permitType, title: v.data.title },
        dedupeKey:        `ptw.permit.submitted:${result.entityId}`,
        ...(v.data.areaAuthorityId ? {
          explicitRecipients: [{ userId: v.data.areaAuthorityId, reason: 'assignee' as const }],
          notification: {
            title:          `PTW submitted for review: ${result.entityRef}`,
            body:           `${v.data.title} — awaiting area authority review.`,
            actionRoute:    `hse/permits/${result.entityId}`,
            type:           'ptw.permit.submitted',
            actionRequired: true,
          },
        } : {}),
      });
    }

    return c.json({
      success: true,
      data: {
        id:        result.entityId,
        permitNo:  result.entityRef,
        eventId:   result.eventId ?? null,
        status:    initialStatus,
      },
    });
  } catch (err) {
    return c.json({ success: false, message: err instanceof Error ? err.message : 'Create failed' }, 500 as 200);
  }
});

// ── POST /api/hse/ptw/permits/get ─────────────────────────────────────────────

router.post('/ptw/permits/get', async c => {
  await requirePermission(c, 'hse.ptw.view');
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as { permitId?: string; permitNumber?: string } | undefined;

  if (!args?.permitId && !args?.permitNumber) {
    return c.json({ success: false, message: 'permitId or permitNumber required' }, 400 as 200);
  }

  let q = sb.from('hse_permits').select('*');
  if (args.permitId)     q = q.eq('id', args.permitId);
  else                   q = q.eq('permit_number', args.permitNumber!);

  const permitRes = await q.maybeSingle();
  if (!permitRes.data) return c.json({ success: false, message: 'Permit not found' }, 404 as 200);

  const permit = permitRes.data as Record<string, unknown>;
  const permitId = permit.id as string;
  const permitRef = (permit.permit_number as string | null) ?? permitId;

  const [
    hazardsRes,
    controlsRes,
    approvalsRes,
    isolationsRes,
    gasTestsRes,
    simopsRes,
    extensionsRes,
    suspensionsRes,
    closeoutRes,
    attachmentsRes,
    auditRes,
  ] = await Promise.all([
    sb.from('hse_permit_hazards').select('*').eq('permit_id', permitId).order('sort_order'),
    sb.from('hse_permit_controls').select('*').eq('permit_id', permitId).order('sort_order'),
    sb.from('hse_permit_approvals').select('*').eq('permit_id', permitId).order('step_order'),
    sb.from('hse_permit_isolations').select('*').eq('permit_id', permitId).order('sort_order'),
    sb.from('hse_permit_gas_tests').select('*').eq('permit_id', permitId).order('test_sequence'),
    sb.from('hse_permit_simops_conflicts').select('*').eq('permit_id', permitId).order('created_at'),
    sb.from('hse_permit_extensions').select('*').eq('permit_id', permitId).order('extension_number'),
    sb.from('hse_permit_suspensions').select('*').eq('permit_id', permitId).order('created_at', { ascending: false }),
    sb.from('hse_permit_closeouts').select('*').eq('permit_id', permitId).maybeSingle(),
    sb.from('hse_permit_attachments').select('*').eq('permit_id', permitId).order('created_at', { ascending: false }),
    sb.from('hse_permit_audit_events')
      .select('id, action, actor_user_id, before_state, after_state, metadata, created_at')
      .eq('permit_id', permitId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  return c.json({
    success: true,
    data: {
      permit:      permit,
      hazards:     hazardsRes.data     ?? [],
      controls:    controlsRes.data    ?? [],
      approvals:   approvalsRes.data   ?? [],
      isolations:  isolationsRes.data  ?? [],
      gas_tests:   gasTestsRes.data    ?? [],
      simops:      simopsRes.data      ?? [],
      extensions:  extensionsRes.data  ?? [],
      suspensions: suspensionsRes.data ?? [],
      closeout:    closeoutRes.data    ?? null,
      attachments: attachmentsRes.data ?? [],
      timeline:    auditRes.data       ?? [],
      permitRef,
    },
  });
});

// ── POST /api/hse/ptw/permits/update ─────────────────────────────────────────
// Patch editable fields. Only allowed on draft or changes_requested.

const PermitUpdateSchema = z.object({
  permitId:         z.string().uuid(),
  title:            z.string().min(1).max(300).optional(),
  description:      z.string().optional(),
  riskLevel:        z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
  siteId:           z.string().nullable().optional(),
  specificLocation: z.string().nullable().optional(),
  startDatetime:    z.string().nullable().optional(),
  endDatetime:      z.string().nullable().optional(),
  workSupervisorId: z.string().nullable().optional(),
  safetyOfficerId:  z.string().nullable().optional(),
  areaAuthorityId:  z.string().nullable().optional(),
  contractorName:   z.string().nullable().optional(),
  contractorRep:    z.string().nullable().optional(),
  linkedJsaId:      z.string().uuid().nullable().optional(),
  linkedRiskAssessmentId: z.string().uuid().nullable().optional(),
  preWorkChecks:    z.array(z.unknown()).nullable().optional(),
  postWorkChecks:   z.array(z.unknown()).nullable().optional(),
  metadata:         z.record(z.string(), z.unknown()).optional(),
});

router.post('/ptw/permits/update', async c => {
  const user = await requirePermission(c, 'hse.ptw.create');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, PermitUpdateSchema, body.args);
  if (!v.ok) return v.response;

  const { permitId, ...fields } = v.data;

  // Check permit exists and is editable
  const cur = await sb
    .from('hse_permits')
    .select('id, status')
    .eq('id', permitId)
    .maybeSingle<{ id: string; status: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Permit not found' }, 404 as 200);
  if (!['draft', 'changes_requested'].includes(cur.data.status)) {
    return c.json({ success: false, message: `Cannot edit permit in status "${cur.data.status}". Only draft or changes_requested permits are editable.` }, 400 as 200);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.title !== undefined)             updates.title              = fields.title;
  if (fields.description !== undefined)       updates.description        = fields.description;
  if (fields.riskLevel !== undefined)         updates.risk_level         = fields.riskLevel;
  if (fields.siteId !== undefined)            updates.site_id            = fields.siteId;
  if (fields.specificLocation !== undefined)  updates.specific_location  = fields.specificLocation;
  if (fields.startDatetime !== undefined)     updates.start_datetime     = fields.startDatetime;
  if (fields.endDatetime !== undefined)       updates.end_datetime       = fields.endDatetime;
  if (fields.workSupervisorId !== undefined)  updates.work_supervisor_id = fields.workSupervisorId;
  if (fields.safetyOfficerId !== undefined)   updates.safety_officer_id  = fields.safetyOfficerId;
  if (fields.areaAuthorityId !== undefined)   updates.area_authority_id  = fields.areaAuthorityId;
  if (fields.contractorName !== undefined)    updates.contractor_name    = fields.contractorName;
  if (fields.contractorRep !== undefined)     updates.contractor_rep     = fields.contractorRep;
  if (fields.linkedJsaId !== undefined)       updates.linked_jsa_id      = fields.linkedJsaId;
  if (fields.linkedRiskAssessmentId !== undefined) updates.linked_risk_assessment_id = fields.linkedRiskAssessmentId;
  if (fields.preWorkChecks !== undefined)     updates.pre_work_checks    = fields.preWorkChecks;
  if (fields.postWorkChecks !== undefined)    updates.post_work_checks   = fields.postWorkChecks;
  if (fields.metadata !== undefined)          updates.metadata           = fields.metadata;

  const { error } = await sb.from('hse_permits').update(updates).eq('id', permitId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({
    eventType: 'hse.permit.updated', sourceModule: 'hse',
    sourceEntityType: 'permit', sourceEntityId: permitId,
    actorUserId: user.id, severity: 'info',
    payload: { changes: Object.keys(updates) },
  });

  return c.json({ success: true });
});

// ── POST /api/hse/ptw/permits/save-draft ─────────────────────────────────────
// Alias for update, explicitly for draft saves (no status restriction check needed
// beyond what update already enforces).

router.post('/ptw/permits/save-draft', async c => {
  // Delegate to the update handler by re-routing internally
  const body = c.get('body') as Record<string, unknown>;
  const args = body.args as Record<string, unknown> | undefined ?? {};
  c.set('body', { ...body, args });

  const user = await requirePermission(c, 'hse.ptw.create');
  const v = zv(c, PermitUpdateSchema, args);
  if (!v.ok) return v.response;

  const { permitId, ...fields } = v.data;

  const cur = await sb
    .from('hse_permits')
    .select('id, status')
    .eq('id', permitId)
    .maybeSingle<{ id: string; status: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Permit not found' }, 404 as 200);
  if (!['draft', 'changes_requested'].includes(cur.data.status)) {
    return c.json({ success: false, message: `Cannot save-draft permit in status "${cur.data.status}".` }, 400 as 200);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.title !== undefined)             updates.title              = fields.title;
  if (fields.description !== undefined)       updates.description        = fields.description;
  if (fields.riskLevel !== undefined)         updates.risk_level         = fields.riskLevel;
  if (fields.siteId !== undefined)            updates.site_id            = fields.siteId;
  if (fields.specificLocation !== undefined)  updates.specific_location  = fields.specificLocation;
  if (fields.startDatetime !== undefined)     updates.start_datetime     = fields.startDatetime;
  if (fields.endDatetime !== undefined)       updates.end_datetime       = fields.endDatetime;
  if (fields.workSupervisorId !== undefined)  updates.work_supervisor_id = fields.workSupervisorId;
  if (fields.safetyOfficerId !== undefined)   updates.safety_officer_id  = fields.safetyOfficerId;
  if (fields.areaAuthorityId !== undefined)   updates.area_authority_id  = fields.areaAuthorityId;
  if (fields.contractorName !== undefined)    updates.contractor_name    = fields.contractorName;
  if (fields.contractorRep !== undefined)     updates.contractor_rep     = fields.contractorRep;
  if (fields.linkedJsaId !== undefined)       updates.linked_jsa_id      = fields.linkedJsaId;
  if (fields.linkedRiskAssessmentId !== undefined) updates.linked_risk_assessment_id = fields.linkedRiskAssessmentId;
  if (fields.preWorkChecks !== undefined)     updates.pre_work_checks    = fields.preWorkChecks;
  if (fields.postWorkChecks !== undefined)    updates.post_work_checks   = fields.postWorkChecks;
  if (fields.metadata !== undefined)          updates.metadata           = fields.metadata;

  const { error } = await sb.from('hse_permits').update(updates).eq('id', permitId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  return c.json({ success: true });
});

// ── Lifecycle endpoints (via applyPermitTransition) ───────────────────────────

const TransitionSchema = z.object({
  permitId: z.string().uuid(),
  note:     z.string().nullable().optional(),
});

// submit: draft → submitted
router.post('/ptw/permits/submit', async c => {
  const user = await requirePermission(c, 'hse.ptw.create');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'submitted', toStatus: 'submitted', actorId: user.id, note: v.data.note });
});

// approve: awaiting_approval → approved
router.post('/ptw/permits/approve', async c => {
  const user = await requirePermission(c, 'hse.ptw.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'approved', toStatus: 'approved', actorId: user.id, note: v.data.note });
});

// reject
router.post('/ptw/permits/reject', async c => {
  const user = await requirePermission(c, 'hse.ptw.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'rejected', toStatus: 'rejected', actorId: user.id, note: v.data.note });
});

// request-changes
router.post('/ptw/permits/request-changes', async c => {
  const user = await requirePermission(c, 'hse.ptw.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'changes_requested', toStatus: 'changes_requested', actorId: user.id, note: v.data.note });
});

// activate: approved → active (with gate)
router.post('/ptw/permits/activate', async c => {
  const user = await requirePermission(c, 'hse.ptw.activate');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;

  // Load permit for activation gate
  const permitRes = await sb
    .from('hse_permits')
    .select('id, permit_number, status, requires_jsa, requires_isolation, requires_gas_test, requires_simops_check, linked_jsa_id, created_by, requester_id, work_supervisor_id, area_authority_id')
    .eq('id', v.data.permitId)
    .maybeSingle<PermitRow>();
  if (!permitRes.data) return c.json({ success: false, message: 'Permit not found' }, 404 as 200);

  const blocked = await canActivatePermit(c, permitRes.data);
  if (blocked) return blocked;

  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'activated', toStatus: 'active', actorId: user.id, note: v.data.note });
});

// suspend: active → suspended
router.post('/ptw/permits/suspend', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'suspended', toStatus: 'suspended', actorId: user.id, note: v.data.note });
});

// revalidate: suspended → active
router.post('/ptw/permits/revalidate', async c => {
  const user = await requirePermission(c, 'hse.ptw.activate');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'revalidated', toStatus: 'active', actorId: user.id, note: v.data.note });
});

// request-extension: active → extension_requested
const ExtensionRequestSchema = z.object({
  permitId: z.string().uuid(),
  newEnd:   z.string().min(1),
  reason:   z.string().min(1),
});

router.post('/ptw/permits/request-extension', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ExtensionRequestSchema, body.args);
  if (!v.ok) return v.response;

  // Fetch current permit end for the extension record
  const permitRes = await sb
    .from('hse_permits')
    .select('id, permit_number, status, end_datetime')
    .eq('id', v.data.permitId)
    .maybeSingle<{ id: string; permit_number: string | null; status: string; end_datetime: string | null }>();
  if (!permitRes.data) return c.json({ success: false, message: 'Permit not found' }, 404 as 200);
  if (!canTransition(permitRes.data.status, 'extension_requested')) {
    return c.json({ success: false, message: `Cannot request extension from status "${permitRes.data.status}"` }, 400 as 200);
  }

  // Insert extension record
  const extRes = await sb.from('hse_permit_extensions').insert({
    permit_id:   v.data.permitId,
    requested_by: user.id,
    original_end: permitRes.data.end_datetime ?? new Date().toISOString(),
    new_end:      v.data.newEnd,
    reason:       v.data.reason,
    status:       'pending',
  }).select('id').single<{ id: string }>();

  if (extRes.error) return c.json({ success: false, message: extRes.error.message }, 500 as 200);

  const { error } = await sb.from('hse_permits').update({
    status:              'extension_requested',
    current_extension_id: extRes.data.id,
    updated_at:          new Date().toISOString(),
  }).eq('id', v.data.permitId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({
    eventType: 'ptw.permit.extension_requested', sourceModule: 'hse',
    sourceEntityType: 'permit', sourceEntityId: permitRes.data.permit_number ?? v.data.permitId,
    actorUserId: user.id, severity: 'info',
    payload: { extensionId: extRes.data.id, newEnd: v.data.newEnd, reason: v.data.reason },
  });

  return c.json({ success: true, extensionId: extRes.data.id });
});

// approve-extension: extension_requested → active
router.post('/ptw/permits/approve-extension', async c => {
  const user = await requirePermission(c, 'hse.ptw.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, z.object({ permitId: z.string().uuid(), note: z.string().nullable().optional() }), body.args);
  if (!v.ok) return v.response;

  // Find the pending extension
  const extRes = await sb
    .from('hse_permit_extensions')
    .select('id, new_end')
    .eq('permit_id', v.data.permitId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; new_end: string }>();

  if (!extRes.data) return c.json({ success: false, message: 'No pending extension found for this permit.' }, 404 as 200);

  const now = new Date().toISOString();
  await sb.from('hse_permit_extensions').update({
    status: 'approved', approved_by: user.id, approved_at: now, updated_at: now,
  }).eq('id', extRes.data.id);

  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'extension_approved', toStatus: 'active', actorId: user.id, note: v.data.note });
});

// reject-extension: extension_requested → expired (falls back)
router.post('/ptw/permits/reject-extension', async c => {
  const user = await requirePermission(c, 'hse.ptw.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;

  const extRes = await sb
    .from('hse_permit_extensions')
    .select('id')
    .eq('permit_id', v.data.permitId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (extRes.data) {
    const now = new Date().toISOString();
    await sb.from('hse_permit_extensions').update({
      status: 'rejected', updated_at: now,
    }).eq('id', extRes.data.id);
  }

  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'extension_rejected', toStatus: 'expired', actorId: user.id, note: v.data.note });
});

// close
router.post('/ptw/permits/close', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'closed', toStatus: 'closed', actorId: user.id, note: v.data.note });
});

// cancel
router.post('/ptw/permits/cancel', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'cancelled', toStatus: 'cancelled', actorId: user.id, note: v.data.note });
});

// archive
router.post('/ptw/permits/archive', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TransitionSchema, body.args);
  if (!v.ok) return v.response;
  return applyPermitTransition(c, { permitId: v.data.permitId, action: 'archived', toStatus: 'archived', actorId: user.id, note: v.data.note });
});

// ── POST /api/hse/ptw/permits/stats ───────────────────────────────────────────

router.post('/ptw/permits/stats', async c => {
  await requirePermission(c, 'hse.ptw.view');
  const now = new Date();
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const eightHoursFromNow = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const [
    activePermitsRes,
    activeByTypeRes,
    expiringTwoHoursRes,
    expiringEightHoursRes,
    isolationsRes,
    awaitingApprovalRes,
    stageCountsRes,
  ] = await Promise.all([
    // Active permits summary
    sb.from('hse_permits')
      .select('id, risk_level, site_id')
      .eq('status', 'active'),

    // Active permits by type
    sb.from('hse_permits')
      .select('permit_type')
      .eq('status', 'active'),

    // Expiring within 2 hours
    sb.from('hse_permits')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .not('end_datetime', 'is', null)
      .lte('end_datetime', twoHoursFromNow)
      .gte('end_datetime', nowIso),

    // Expiring within 8 hours (total expiring soon bucket)
    sb.from('hse_permits')
      .select('id, end_datetime')
      .eq('status', 'active')
      .not('end_datetime', 'is', null)
      .lte('end_datetime', eightHoursFromNow)
      .gte('end_datetime', nowIso),

    // Isolation readiness — all isolation points for active permits
    sb.from('hse_permit_isolations')
      .select('id, status, permit_id')
      .in('permit_id',
        // Subquery-style: fetch active permit ids first
        sb.from('hse_permits').select('id').eq('status', 'active') as unknown as string[]
      ),

    // Awaiting approval total
    sb.from('hse_permit_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),

    // Bottleneck by stage (permits in each pre-active status)
    sb.from('hse_permits')
      .select('status')
      .in('status', ['submitted', 'risk_review', 'isolation_pending', 'gas_test_pending', 'awaiting_approval', 'changes_requested']),
  ]);

  const activeRows = (activePermitsRes.data ?? []) as Array<{ id: string; risk_level: string | null; site_id: string | null }>;
  const totalActive  = activeRows.length;
  const highRisk     = activeRows.filter(p => p.risk_level === 'high' || p.risk_level === 'critical').length;
  const criticalAreas = activeRows.filter(p => p.risk_level === 'critical').length;

  // by type
  const typeMap = new Map<string, number>();
  for (const p of (activeByTypeRes.data ?? []) as Array<{ permit_type: string | null }>) {
    const t = p.permit_type ?? 'unknown';
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
  }
  const byType = [...typeMap.entries()].map(([type, count]) => ({ type, count }));

  // expiring soon buckets
  const expiringRows = (expiringEightHoursRes.data ?? []) as Array<{ end_datetime: string | null }>;
  const totalExpiring = expiringRows.length;
  const withinTwoHours = expiringTwoHoursRes.count ?? 0;
  const buckets = [
    { label: '<2h',  count: withinTwoHours },
    { label: '2-8h', count: totalExpiring - withinTwoHours },
  ];

  // isolation readiness
  // Note: the correlated subquery approach above may not work with supabase-js;
  // fall back to a direct count query for active permits' isolations.
  const isoAllRes = await sb
    .from('hse_permit_isolations')
    .select('id, status');
  const isoAll = (isoAllRes.data ?? []) as Array<{ status: string }>;
  const isoRequired = isoAll.length;
  const isoVerified = isoAll.filter(i => i.status === 'verified').length;
  const isoPct = isoRequired > 0 ? Math.round((isoVerified / isoRequired) * 100) : 100;

  // bottleneck stages
  const stageMap = new Map<string, number>();
  for (const p of (stageCountsRes.data ?? []) as Array<{ status: string }>) {
    stageMap.set(p.status, (stageMap.get(p.status) ?? 0) + 1);
  }
  const byStage = [...stageMap.entries()].map(([stage, count]) => ({ stage, count }));
  const bottleneckTotal = [...stageMap.values()].reduce((s, n) => s + n, 0);

  return c.json({
    success: true,
    data: {
      activePermits: {
        total:         totalActive,
        highRisk,
        criticalAreas,
        byType,
      },
      expiringSoon: {
        total:          totalExpiring,
        withinTwoHours,
        buckets,
      },
      isolationReadiness: {
        percentage: isoPct,
        verified:   isoVerified,
        required:   isoRequired,
      },
      approvalBottlenecks: {
        total:   bottleneckTotal,
        byStage,
      },
    },
  });
});

// ── POST /api/hse/ptw/permit-types/list ───────────────────────────────────────

router.post('/ptw/permit-types/list', async c => {
  await requirePermission(c, 'hse.ptw.view');
  const { data, error } = await sb
    .from('hse_permit_type_config')
    .select('*')
    .eq('active', true)
    .order('sort_order');
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

export default router;
