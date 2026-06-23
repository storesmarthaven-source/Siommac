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
 *
 * Sub-register routes:
 * POST /api/hse/ptw/permits/isolations/list
 * POST /api/hse/ptw/permits/isolations/create
 * POST /api/hse/ptw/permits/isolations/apply
 * POST /api/hse/ptw/permits/isolations/verify
 * POST /api/hse/ptw/permits/isolations/reject
 * POST /api/hse/ptw/permits/isolations/remove
 * POST /api/hse/ptw/permits/gas-tests/list
 * POST /api/hse/ptw/permits/gas-tests/create
 * POST /api/hse/ptw/permits/gas-tests/retest
 * POST /api/hse/ptw/permits/gas-tests/mark-invalid
 * POST /api/hse/ptw/permits/simops/list
 * POST /api/hse/ptw/permits/simops/check
 * POST /api/hse/ptw/permits/simops/resolve
 * POST /api/hse/ptw/permits/simops/approve-override
 * POST /api/hse/ptw/permits/approvals/list
 * POST /api/hse/ptw/permits/approvals/decide
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

const PermitControlSchema = z.object({
  description:          z.string().min(1),
  responsibleUserId:    z.string().nullable().optional(),
  verificationRequired: z.boolean().optional(),
  evidenceRequired:     z.boolean().optional(),
});

const PermitHazardSchema = z.object({
  category:    z.string().min(1),
  name:        z.string().min(1),
  description: z.string().optional(),
  consequence: z.string().optional(),
  riskLevel:   z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
  controls:    z.array(PermitControlSchema).default([]),
});

const PermitIsolationSchema = z.object({
  isolationType:  z.string().min(1),
  isolationPoint: z.string().min(1),
  tagNumber:      z.string().nullable().optional(),
});

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
  /** Child hazards + controls to insert after permit creation (best-effort). */
  hazards:          z.array(PermitHazardSchema).optional(),
  /** Isolation points (status='planned') to insert after creation (best-effort). */
  isolations:       z.array(PermitIsolationSchema).optional(),
  /** Gas test planned flag — stored in permit metadata. */
  gasTestRequired:  z.boolean().optional(),
  gasTestNote:      z.string().nullable().optional(),
  /** SIMOPS note — stored in permit metadata. */
  simopsNote:       z.string().nullable().optional(),
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

    // ── Insert child records (best-effort, non-fatal) ────────────────────────
    const permitId = result.entityId;

    // Hazards + controls
    const hazardRows = v.data.hazards ?? [];
    if (hazardRows.length > 0) {
      for (const h of hazardRows) {
        try {
          const hazardInsert = await sb
            .from('hse_permit_hazards')
            .insert({
              permit_id:   permitId,
              hazard_type: h.category,
              description: [h.name, h.description].filter(Boolean).join(' — '),
              risk_level:  h.riskLevel ?? null,
              metadata:    { name: h.name, consequence: h.consequence ?? null },
            })
            .select('id')
            .single<{ id: string }>();

          if (hazardInsert.data && h.controls.length > 0) {
            const hazardId = hazardInsert.data.id;
            await sb.from('hse_permit_controls').insert(
              h.controls.map((ctrl, idx) => ({
                permit_id:            permitId,
                hazard_id:            hazardId,
                control_type:         'administrative',
                description:          ctrl.description,
                is_mandatory:         ctrl.verificationRequired ?? false,
                sort_order:           idx,
                metadata: {
                  responsible_user_id:  ctrl.responsibleUserId ?? null,
                  evidence_required:    ctrl.evidenceRequired ?? false,
                },
              })),
            );
          }
        } catch (childErr) {
          console.error('[PTW create] hazard child insert error:', childErr);
        }
      }
    }

    // Isolation points
    const isolationRows = v.data.isolations ?? [];
    if (isolationRows.length > 0) {
      try {
        await sb.from('hse_permit_isolations').insert(
          isolationRows.map((iso, idx) => ({
            permit_id:       permitId,
            isolation_type:  iso.isolationType,
            isolation_point: iso.isolationPoint,
            tag_number:      iso.tagNumber ?? null,
            status:          'pending',
            sort_order:      idx,
          })),
        );
      } catch (childErr) {
        console.error('[PTW create] isolation child insert error:', childErr);
      }
    }

    // Gas test / SIMOPS flags stored in metadata update (best-effort)
    if (v.data.gasTestRequired !== undefined || v.data.simopsNote) {
      void sb.from('hse_permits').update({
        metadata: {
          gas_test_planned: v.data.gasTestRequired ?? false,
          gas_test_note:    v.data.gasTestNote ?? null,
          simops_note:      v.data.simopsNote ?? null,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', permitId);
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

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Helper: load a permit's identity for notifications ────────────────────────

interface PermitMeta {
  id: string;
  permit_number: string | null;
  requester_id: string | null;
  work_supervisor_id: string | null;
  site_id: string | null;
  area_id: string | null;
  start_datetime: string | null;
  end_datetime: string | null;
}

async function getPermitMeta(permitId: string): Promise<PermitMeta | null> {
  const { data } = await sb
    .from('hse_permits')
    .select('id, permit_number, requester_id, work_supervisor_id, site_id, area_id, start_datetime, end_datetime')
    .eq('id', permitId)
    .maybeSingle<PermitMeta>();
  return data;
}

// ── POST /api/hse/ptw/permits/isolations/list ─────────────────────────────────
// hse.ptw.view — list isolation points for a permit

const IsolationListSchema = z.object({
  permitId: z.string().uuid(),
});

router.post('/ptw/permits/isolations/list', async c => {
  await requirePermission(c, 'hse.ptw.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, IsolationListSchema, body.args);
  if (!v.ok) return v.response;

  const { data, error } = await sb
    .from('hse_permit_isolations')
    .select('*')
    .eq('permit_id', v.data.permitId)
    .order('sort_order');
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/ptw/permits/isolations/create ───────────────────────────────
// hse.ptw.manage — insert a new isolation point (status: 'pending')

const IsolationCreateSchema = z.object({
  permitId:        z.string().uuid(),
  isolationType:   z.string().min(1),
  isolationPoint:  z.string().min(1),
  energySource:    z.string().nullable().optional(),
  tagNumber:       z.string().nullable().optional(),
  lockNumber:      z.string().nullable().optional(),
  assetId:         z.string().uuid().nullable().optional(),
  isolationMethod: z.string().nullable().optional(),
  metadata:        z.record(z.string(), z.unknown()).optional(),
});

router.post('/ptw/permits/isolations/create', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, IsolationCreateSchema, body.args);
  if (!v.ok) return v.response;

  // Verify permit exists
  const permit = await getPermitMeta(v.data.permitId);
  if (!permit) return c.json({ success: false, message: 'Permit not found.' }, 404 as 200);

  const { data, error } = await sb
    .from('hse_permit_isolations')
    .insert({
      permit_id:        v.data.permitId,
      isolation_type:   v.data.isolationType,
      isolation_point:  v.data.isolationPoint,
      energy_source:    v.data.energySource ?? null,
      tag_number:       v.data.tagNumber ?? null,
      asset_id:         v.data.assetId ?? null,
      isolation_method: v.data.isolationMethod ?? null,
      status:           'pending',
      metadata:         v.data.metadata ?? {},
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Insert failed' }, 500 as 200);

  void sb.from('hse_permit_audit_events').insert({
    permit_id:     v.data.permitId,
    action:        'isolation_created',
    actor_user_id: user.id,
    after_state:   { isolation_id: data.id, status: 'pending', isolation_point: v.data.isolationPoint },
    metadata:      { isolation_type: v.data.isolationType },
  });

  void emitAppEvent({
    eventType:        'ptw.isolation.created',
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permit.permit_number ?? v.data.permitId,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { isolationId: data.id, isolationPoint: v.data.isolationPoint, isolationType: v.data.isolationType },
  });

  return c.json({ success: true, data: { id: data.id } });
});

// ── POST /api/hse/ptw/permits/isolations/apply ────────────────────────────────
// hse.ptw.manage — set status 'applied', record actor + timestamp

const IsolationIdSchema = z.object({
  isolationId: z.string().uuid(),
});

router.post('/ptw/permits/isolations/apply', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, IsolationIdSchema, body.args);
  if (!v.ok) return v.response;

  const cur = await sb
    .from('hse_permit_isolations')
    .select('id, permit_id, isolation_point, status')
    .eq('id', v.data.isolationId)
    .maybeSingle<{ id: string; permit_id: string; isolation_point: string; status: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Isolation point not found.' }, 404 as 200);
  if (cur.data.status !== 'pending') {
    return c.json({ success: false, message: `Cannot apply isolation in status "${cur.data.status}". Must be pending.` }, 400 as 200);
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from('hse_permit_isolations')
    .update({ status: 'applied', applied_by: user.id, applied_at: now, updated_at: now })
    .eq('id', v.data.isolationId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  const permit = await getPermitMeta(cur.data.permit_id);
  void sb.from('hse_permit_audit_events').insert({
    permit_id:     cur.data.permit_id,
    action:        'isolation_applied',
    actor_user_id: user.id,
    after_state:   { isolation_id: v.data.isolationId, status: 'applied' },
    metadata:      {},
  });

  void emitAppEvent({
    eventType:        'ptw.isolation.applied',
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permit?.permit_number ?? cur.data.permit_id,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { isolationId: v.data.isolationId, isolationPoint: cur.data.isolation_point },
  });

  return c.json({ success: true });
});

// ── POST /api/hse/ptw/permits/isolations/verify ───────────────────────────────
// hse.ptw.activate — verify isolation. Guard: applied_by !== actor (same-person block).

router.post('/ptw/permits/isolations/verify', async c => {
  const user = await requirePermission(c, 'hse.ptw.activate');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, IsolationIdSchema, body.args);
  if (!v.ok) return v.response;

  const cur = await sb
    .from('hse_permit_isolations')
    .select('id, permit_id, isolation_point, status, applied_by')
    .eq('id', v.data.isolationId)
    .maybeSingle<{ id: string; permit_id: string; isolation_point: string; status: string; applied_by: string | null }>();
  if (!cur.data) return c.json({ success: false, message: 'Isolation point not found.' }, 404 as 200);
  if (cur.data.status !== 'applied') {
    return c.json({ success: false, message: `Cannot verify isolation in status "${cur.data.status}". Must be applied first.` }, 400 as 200);
  }

  // Same-person guard: the person who applied may not verify
  if (cur.data.applied_by && cur.data.applied_by === user.id) {
    return c.json({
      success: false,
      message: 'Apply and verify must be different people. The person who applied this isolation cannot also verify it.',
    }, 400 as 200);
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from('hse_permit_isolations')
    .update({ status: 'verified', verified_by: user.id, verified_at: now, updated_at: now })
    .eq('id', v.data.isolationId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  const permit = await getPermitMeta(cur.data.permit_id);
  void sb.from('hse_permit_audit_events').insert({
    permit_id:     cur.data.permit_id,
    action:        'isolation_verified',
    actor_user_id: user.id,
    after_state:   { isolation_id: v.data.isolationId, status: 'verified' },
    metadata:      {},
  });

  void emitAppEvent({
    eventType:        'ptw.isolation.verified',
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permit?.permit_number ?? cur.data.permit_id,
    actorUserId:      user.id,
    severity:         'success',
    payload:          { isolationId: v.data.isolationId, isolationPoint: cur.data.isolation_point },
  });

  return c.json({ success: true });
});

// ── POST /api/hse/ptw/permits/isolations/reject ───────────────────────────────
// hse.ptw.activate — reject a pending/applied isolation; reset to 'pending'.
// Note: DB status CHECK is ('pending'|'applied'|'verified'|'removed'); there is
// no 'rejected' status. Rejection resets the point to 'pending' so it can be
// re-applied. The rejection reason is persisted in the audit event.

const IsolationRejectSchema = z.object({
  isolationId: z.string().uuid(),
  reason:      z.string().nullable().optional(),
});

router.post('/ptw/permits/isolations/reject', async c => {
  const user = await requirePermission(c, 'hse.ptw.activate');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, IsolationRejectSchema, body.args);
  if (!v.ok) return v.response;

  const cur = await sb
    .from('hse_permit_isolations')
    .select('id, permit_id, isolation_point, status, applied_by')
    .eq('id', v.data.isolationId)
    .maybeSingle<{ id: string; permit_id: string; isolation_point: string; status: string; applied_by: string | null }>();
  if (!cur.data) return c.json({ success: false, message: 'Isolation point not found.' }, 404 as 200);
  if (!['applied', 'pending'].includes(cur.data.status)) {
    return c.json({ success: false, message: `Cannot reject isolation in status "${cur.data.status}".` }, 400 as 200);
  }

  // Reset to pending so it can be re-applied; store rejection reason in metadata
  const now = new Date().toISOString();
  const { error } = await sb
    .from('hse_permit_isolations')
    .update({
      status:     'pending',
      applied_by: null,
      applied_at: null,
      updated_at: now,
      metadata:   { rejection_reason: v.data.reason ?? null, rejected_by: user.id, rejected_at: now },
    })
    .eq('id', v.data.isolationId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  const permit = await getPermitMeta(cur.data.permit_id);
  void sb.from('hse_permit_audit_events').insert({
    permit_id:     cur.data.permit_id,
    action:        'isolation_rejected',
    actor_user_id: user.id,
    after_state:   { isolation_id: v.data.isolationId, status: 'pending', reason: v.data.reason ?? null },
    metadata:      { from_status: cur.data.status },
  });

  // Notify the requester so they know the isolation was rejected
  void emitAppEvent({
    eventType:        'ptw.isolation.rejected',
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permit?.permit_number ?? cur.data.permit_id,
    actorUserId:      user.id,
    severity:         'warning',
    payload:          { isolationId: v.data.isolationId, isolationPoint: cur.data.isolation_point, reason: v.data.reason ?? null },
    ...(permit?.requester_id && permit.requester_id !== user.id ? {
      explicitRecipients: [{ userId: permit.requester_id, reason: 'owner' as const }],
      notification: {
        title:          `Isolation rejected on permit ${permit.permit_number ?? cur.data.permit_id}`,
        body:           `Isolation point "${cur.data.isolation_point}" was rejected${v.data.reason ? `: ${v.data.reason}` : '.'}`,
        actionRoute:    `hse/permits/${cur.data.permit_id}`,
        type:           'ptw.isolation.rejected',
        actionRequired: true,
      },
    } : {}),
  });

  return c.json({ success: true });
});

// ── POST /api/hse/ptw/permits/isolations/remove ───────────────────────────────
// hse.ptw.manage — mark isolation as removed (permit closeout / de-energisation)

router.post('/ptw/permits/isolations/remove', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, IsolationIdSchema, body.args);
  if (!v.ok) return v.response;

  const cur = await sb
    .from('hse_permit_isolations')
    .select('id, permit_id, isolation_point, status')
    .eq('id', v.data.isolationId)
    .maybeSingle<{ id: string; permit_id: string; isolation_point: string; status: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Isolation point not found.' }, 404 as 200);
  if (cur.data.status === 'removed') {
    return c.json({ success: false, message: 'Isolation already removed.' }, 400 as 200);
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from('hse_permit_isolations')
    .update({ status: 'removed', removed_by: user.id, removed_at: now, updated_at: now })
    .eq('id', v.data.isolationId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  const permit = await getPermitMeta(cur.data.permit_id);
  void sb.from('hse_permit_audit_events').insert({
    permit_id:     cur.data.permit_id,
    action:        'isolation_removed',
    actor_user_id: user.id,
    after_state:   { isolation_id: v.data.isolationId, status: 'removed' },
    metadata:      {},
  });

  void emitAppEvent({
    eventType:        'ptw.isolation.removed',
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permit?.permit_number ?? cur.data.permit_id,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { isolationId: v.data.isolationId, isolationPoint: cur.data.isolation_point },
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GAS TESTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── POST /api/hse/ptw/permits/gas-tests/list ──────────────────────────────────
// hse.ptw.view

const GasTestListSchema = z.object({
  permitId: z.string().uuid(),
});

router.post('/ptw/permits/gas-tests/list', async c => {
  await requirePermission(c, 'hse.ptw.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, GasTestListSchema, body.args);
  if (!v.ok) return v.response;

  const { data, error } = await sb
    .from('hse_permit_gas_tests')
    .select('*')
    .eq('permit_id', v.data.permitId)
    .order('test_sequence');
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── Shared gas test insert helper ─────────────────────────────────────────────

const GasTestCreateSchema = z.object({
  permitId:               z.string().uuid(),
  testLocation:           z.string().nullable().optional(),
  instrumentId:           z.string().nullable().optional(),
  oxygenPct:              z.number().nullable().optional(),
  lelPct:                 z.number().nullable().optional(),
  h2sPpm:                 z.number().nullable().optional(),
  coPpm:                  z.number().nullable().optional(),
  so2Ppm:                 z.number().nullable().optional(),
  result:                 z.enum(['pass', 'fail', 'retest', 'pending']).default('pending'),
  notes:                  z.string().nullable().optional(),
  instrumentCalDate:      z.string().nullable().optional(),
  metadata:               z.record(z.string(), z.unknown()).optional(),
});

async function insertGasTest(
  c: Context<{ Variables: HonoVariables }>,
  actorId: string,
  args: z.infer<typeof GasTestCreateSchema>,
): Promise<Response> {
  // Verify permit exists
  const permit = await getPermitMeta(args.permitId);
  if (!permit) return c.json({ success: false, message: 'Permit not found.' }, 404 as 200);

  // Determine next sequence number
  const seqRes = await sb
    .from('hse_permit_gas_tests')
    .select('test_sequence')
    .eq('permit_id', args.permitId)
    .order('test_sequence', { ascending: false })
    .limit(1)
    .maybeSingle<{ test_sequence: number }>();
  const nextSeq = (seqRes.data?.test_sequence ?? 0) + 1;

  const now = new Date().toISOString();

  const { data, error } = await sb
    .from('hse_permit_gas_tests')
    .insert({
      permit_id:          args.permitId,
      test_sequence:      nextSeq,
      tested_at:          now,
      tester_id:          actorId,
      location:           args.testLocation ?? null,
      instrument_id:      args.instrumentId ?? null,
      oxygen_pct:         args.oxygenPct ?? null,
      lel_pct:            args.lelPct ?? null,
      h2s_ppm:            args.h2sPpm ?? null,
      co_ppm:             args.coPpm ?? null,
      so2_ppm:            args.so2Ppm ?? null,
      result:             args.result,
      notes:              args.notes ?? null,
      instrument_cal_date: args.instrumentCalDate ?? null,
      metadata:           args.metadata ?? {},
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Gas test insert failed' }, 500 as 200);

  void sb.from('hse_permit_audit_events').insert({
    permit_id:     args.permitId,
    action:        'gas_test_recorded',
    actor_user_id: actorId,
    after_state:   { gas_test_id: data.id, test_sequence: nextSeq, result: args.result },
    metadata:      { location: args.testLocation ?? null, oxygen_pct: args.oxygenPct ?? null, lel_pct: args.lelPct ?? null },
  });

  const isFail = args.result === 'fail';

  void emitAppEvent({
    eventType:        isFail ? 'ptw.permit.gas_test_failed' : 'ptw.gas_test.recorded',
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permit.permit_number ?? args.permitId,
    actorUserId:      actorId,
    severity:         isFail ? 'critical' : 'info',
    payload:          { gasTestId: data.id, testSequence: nextSeq, result: args.result, location: args.testLocation ?? null },
    // Notify requester + supervisor on gas test failure (critical safety event)
    ...(isFail ? {
      explicitRecipients: [
        ...(permit.requester_id && permit.requester_id !== actorId
          ? [{ userId: permit.requester_id, reason: 'owner' as const }] : []),
        ...(permit.work_supervisor_id && permit.work_supervisor_id !== actorId
          ? [{ userId: permit.work_supervisor_id, reason: 'participant' as const }] : []),
      ].filter(r => r.userId),
      notification: {
        title:          `Gas test FAILED on permit ${permit.permit_number ?? args.permitId}`,
        body:           `Test #${nextSeq} recorded a FAIL result. Work must stop until safe atmospheric conditions are confirmed.`,
        actionRoute:    `hse/permits/${args.permitId}`,
        type:           'ptw.permit.gas_test_failed',
        actionRequired: true,
      },
      dedupeKey: null,
    } : {}),
  });

  return c.json({ success: true, data: { id: data.id, testSequence: nextSeq, result: args.result } });
}

// ── POST /api/hse/ptw/permits/gas-tests/create ───────────────────────────────
// hse.ptw.manage

router.post('/ptw/permits/gas-tests/create', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, GasTestCreateSchema, body.args);
  if (!v.ok) return v.response;
  return insertGasTest(c, user.id, v.data);
});

// ── POST /api/hse/ptw/permits/gas-tests/retest ───────────────────────────────
// hse.ptw.manage — record a re-test (inserts a new row, incrementing sequence)

router.post('/ptw/permits/gas-tests/retest', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, GasTestCreateSchema, body.args);
  if (!v.ok) return v.response;
  return insertGasTest(c, user.id, v.data);
});

// ── POST /api/hse/ptw/permits/gas-tests/mark-invalid ─────────────────────────
// hse.ptw.manage — invalidate a specific gas test result (e.g. instrument fault)
// Note: hse_permit_gas_tests has no status column. We record the invalidation
// via metadata update and an audit event, and set result to 'pending' to
// exclude it from the passing gate. This is the most schema-safe approach.

const GasTestInvalidateSchema = z.object({
  gasTestId: z.string().uuid(),
  reason:    z.string().nullable().optional(),
});

router.post('/ptw/permits/gas-tests/mark-invalid', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, GasTestInvalidateSchema, body.args);
  if (!v.ok) return v.response;

  const cur = await sb
    .from('hse_permit_gas_tests')
    .select('id, permit_id, test_sequence, result')
    .eq('id', v.data.gasTestId)
    .maybeSingle<{ id: string; permit_id: string; test_sequence: number; result: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Gas test not found.' }, 404 as 200);

  const now = new Date().toISOString();
  // Mark result as 'pending' to neutralise the result + store invalidation in metadata
  const { error } = await sb
    .from('hse_permit_gas_tests')
    .update({
      result:   'pending',
      notes:    `[INVALIDATED ${now}]${v.data.reason ? ` Reason: ${v.data.reason}` : ''}`,
      metadata: { invalidated: true, invalidated_by: user.id, invalidated_at: now, invalidation_reason: v.data.reason ?? null, original_result: cur.data.result },
    })
    .eq('id', v.data.gasTestId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  const permit = await getPermitMeta(cur.data.permit_id);
  void sb.from('hse_permit_audit_events').insert({
    permit_id:     cur.data.permit_id,
    action:        'gas_test_invalidated',
    actor_user_id: user.id,
    after_state:   { gas_test_id: v.data.gasTestId, test_sequence: cur.data.test_sequence, original_result: cur.data.result },
    metadata:      { reason: v.data.reason ?? null },
  });

  void emitAppEvent({
    eventType:        'ptw.gas_test.invalidated',
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permit?.permit_number ?? cur.data.permit_id,
    actorUserId:      user.id,
    severity:         'warning',
    payload:          { gasTestId: v.data.gasTestId, testSequence: cur.data.test_sequence, originalResult: cur.data.result, reason: v.data.reason ?? null },
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SIMOPS
// ═══════════════════════════════════════════════════════════════════════════════

// ── POST /api/hse/ptw/permits/simops/list ─────────────────────────────────────
// hse.ptw.view

const SimopsListSchema = z.object({
  permitId: z.string().uuid(),
});

router.post('/ptw/permits/simops/list', async c => {
  await requirePermission(c, 'hse.ptw.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, SimopsListSchema, body.args);
  if (!v.ok) return v.response;

  const { data, error } = await sb
    .from('hse_permit_simops_conflicts')
    .select('*')
    .eq('permit_id', v.data.permitId)
    .order('created_at');
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/ptw/permits/simops/check ────────────────────────────────────
// hse.ptw.manage — detect overlapping permits at same site/area, insert conflicts.

const SimopsCheckSchema = z.object({
  permitId: z.string().uuid(),
});

router.post('/ptw/permits/simops/check', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, SimopsCheckSchema, body.args);
  if (!v.ok) return v.response;

  // Load the permit being checked
  const permitRes = await sb
    .from('hse_permits')
    .select('id, permit_number, site_id, area_id, start_datetime, end_datetime, status')
    .eq('id', v.data.permitId)
    .maybeSingle<{
      id: string;
      permit_number: string | null;
      site_id: string | null;
      area_id: string | null;
      start_datetime: string | null;
      end_datetime: string | null;
      status: string;
    }>();
  if (!permitRes.data) return c.json({ success: false, message: 'Permit not found.' }, 404 as 200);
  const permit = permitRes.data;

  // Find other active/approved permits that could overlap in time and share location
  // A conflict exists when: same site_id OR same area_id, AND time windows overlap.
  // Overlap condition: !(other.end < permit.start || other.start > permit.end)
  // We fetch candidates and filter; for large datasets a DB function is preferred
  // but this matches existing project patterns of fetching + JS filtering.
  const CONFLICTING_STATUSES = ['submitted', 'risk_review', 'isolation_pending', 'gas_test_pending', 'awaiting_approval', 'approved', 'active'];
  const conflictCandidatesRes = await sb
    .from('hse_permits')
    .select('id, permit_number, status, site_id, area_id, start_datetime, end_datetime')
    .neq('id', v.data.permitId)
    .in('status', CONFLICTING_STATUSES);

  const candidates = (conflictCandidatesRes.data ?? []) as Array<{
    id: string;
    permit_number: string | null;
    status: string;
    site_id: string | null;
    area_id: string | null;
    start_datetime: string | null;
    end_datetime: string | null;
  }>;

  const permitStart = permit.start_datetime ? new Date(permit.start_datetime).getTime() : null;
  const permitEnd   = permit.end_datetime   ? new Date(permit.end_datetime).getTime()   : null;

  const conflicts: Array<{ conflictingPermitId: string; conflictType: string; description: string }> = [];

  for (const candidate of candidates) {
    // Location overlap check
    const sameLocation =
      (permit.site_id && candidate.site_id && permit.site_id === candidate.site_id) ||
      (permit.area_id && candidate.area_id && permit.area_id === candidate.area_id);
    if (!sameLocation) continue;

    // Time window overlap check (null = open-ended, always overlaps on that end)
    let timeOverlap = true;
    if (permitStart !== null && candidate.end_datetime !== null) {
      if (permitStart >= new Date(candidate.end_datetime).getTime()) timeOverlap = false;
    }
    if (permitEnd !== null && candidate.start_datetime !== null) {
      if (permitEnd <= new Date(candidate.start_datetime).getTime()) timeOverlap = false;
    }
    if (!timeOverlap) continue;

    // Determine conflict type
    const conflictType = permit.area_id && candidate.area_id && permit.area_id === candidate.area_id
      ? 'location'
      : 'location'; // Both site and area conflicts map to 'location'; extend to 'time' type if needed.

    conflicts.push({
      conflictingPermitId: candidate.id,
      conflictType,
      description: `Concurrent work detected with permit ${candidate.permit_number ?? candidate.id} (status: ${candidate.status}) at the same ${permit.area_id === candidate.area_id ? 'area' : 'site'}.`,
    });
  }

  // Insert detected conflicts (skip ones that already exist for this permit pair)
  const existingRes = await sb
    .from('hse_permit_simops_conflicts')
    .select('conflicting_permit_id')
    .eq('permit_id', v.data.permitId);
  const existingConflictIds = new Set(
    ((existingRes.data ?? []) as Array<{ conflicting_permit_id: string | null }>)
      .map(r => r.conflicting_permit_id)
      .filter(Boolean),
  );

  const newConflicts = conflicts.filter(cf => !existingConflictIds.has(cf.conflictingPermitId));

  if (newConflicts.length > 0) {
    const rows = newConflicts.map(cf => ({
      permit_id:            v.data.permitId,
      conflicting_permit_id: cf.conflictingPermitId,
      conflict_type:        cf.conflictType,
      description:          cf.description,
      status:               'open',
    }));
    await sb.from('hse_permit_simops_conflicts').insert(rows);

    void sb.from('hse_permit_audit_events').insert({
      permit_id:     v.data.permitId,
      action:        'simops_check_performed',
      actor_user_id: user.id,
      after_state:   { conflicts_found: newConflicts.length, total_candidates: candidates.length },
      metadata:      { new_conflicts: newConflicts },
    });

    void emitAppEvent({
      eventType:        'ptw.simops.conflicts_detected',
      sourceModule:     'hse',
      sourceEntityType: 'permit',
      sourceEntityId:   permit.permit_number ?? v.data.permitId,
      actorUserId:      user.id,
      severity:         'warning',
      payload:          { conflictsFound: newConflicts.length, permitId: v.data.permitId },
    });
  }

  return c.json({
    success: true,
    data: {
      conflictsFound:  conflicts.length,
      newConflicts:    newConflicts.length,
      existingConflicts: conflicts.length - newConflicts.length,
      conflicts,
    },
  });
});

// ── POST /api/hse/ptw/permits/simops/resolve ──────────────────────────────────
// hse.ptw.manage — mark a SIMOPS conflict as resolved
// DB status: 'resolved' maps to spec's 'resolved'.

const SimopsConflictActionSchema = z.object({
  conflictId: z.string().uuid(),
  notes:      z.string().nullable().optional(),
});

router.post('/ptw/permits/simops/resolve', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, SimopsConflictActionSchema, body.args);
  if (!v.ok) return v.response;

  const cur = await sb
    .from('hse_permit_simops_conflicts')
    .select('id, permit_id, status, conflict_type, conflicting_permit_id')
    .eq('id', v.data.conflictId)
    .maybeSingle<{ id: string; permit_id: string; status: string; conflict_type: string; conflicting_permit_id: string | null }>();
  if (!cur.data) return c.json({ success: false, message: 'SIMOPS conflict not found.' }, 404 as 200);
  if (cur.data.status === 'resolved') {
    return c.json({ success: false, message: 'Conflict is already resolved.' }, 400 as 200);
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from('hse_permit_simops_conflicts')
    .update({
      status:      'resolved',
      resolved_by: user.id,
      resolved_at: now,
      resolution:  v.data.notes ?? null,
      updated_at:  now,
    })
    .eq('id', v.data.conflictId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  const permit = await getPermitMeta(cur.data.permit_id);
  void sb.from('hse_permit_audit_events').insert({
    permit_id:     cur.data.permit_id,
    action:        'simops_conflict_resolved',
    actor_user_id: user.id,
    after_state:   { conflict_id: v.data.conflictId, status: 'resolved' },
    metadata:      { notes: v.data.notes ?? null, conflicting_permit_id: cur.data.conflicting_permit_id },
  });

  void emitAppEvent({
    eventType:        'ptw.simops.conflict_resolved',
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permit?.permit_number ?? cur.data.permit_id,
    actorUserId:      user.id,
    severity:         'success',
    payload:          { conflictId: v.data.conflictId, conflictType: cur.data.conflict_type },
  });

  return c.json({ success: true });
});

// ── POST /api/hse/ptw/permits/simops/approve-override ────────────────────────
// hse.ptw.approve — approve an override for a SIMOPS conflict (elevated permission)
// DB status: 'accepted' maps to spec's 'override_approved'.

router.post('/ptw/permits/simops/approve-override', async c => {
  const user = await requirePermission(c, 'hse.ptw.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, SimopsConflictActionSchema, body.args);
  if (!v.ok) return v.response;

  const cur = await sb
    .from('hse_permit_simops_conflicts')
    .select('id, permit_id, status, conflict_type, conflicting_permit_id')
    .eq('id', v.data.conflictId)
    .maybeSingle<{ id: string; permit_id: string; status: string; conflict_type: string; conflicting_permit_id: string | null }>();
  if (!cur.data) return c.json({ success: false, message: 'SIMOPS conflict not found.' }, 404 as 200);
  if (!['open', 'mitigated'].includes(cur.data.status)) {
    return c.json({ success: false, message: `Cannot approve override for conflict in status "${cur.data.status}".` }, 400 as 200);
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from('hse_permit_simops_conflicts')
    .update({
      status:      'accepted',   // DB status: 'accepted' = override approved
      resolved_by: user.id,
      resolved_at: now,
      resolution:  v.data.notes ? `[OVERRIDE APPROVED] ${v.data.notes}` : '[OVERRIDE APPROVED]',
      updated_at:  now,
    })
    .eq('id', v.data.conflictId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  const permit = await getPermitMeta(cur.data.permit_id);
  void sb.from('hse_permit_audit_events').insert({
    permit_id:     cur.data.permit_id,
    action:        'simops_override_approved',
    actor_user_id: user.id,
    after_state:   { conflict_id: v.data.conflictId, status: 'accepted', override: true },
    metadata:      { notes: v.data.notes ?? null, conflicting_permit_id: cur.data.conflicting_permit_id },
  });

  void emitAppEvent({
    eventType:        'ptw.simops.override_approved',
    sourceModule:     'hse',
    sourceEntityType: 'permit',
    sourceEntityId:   permit?.permit_number ?? cur.data.permit_id,
    actorUserId:      user.id,
    severity:         'warning',  // Override is elevated risk — use warning severity
    payload:          { conflictId: v.data.conflictId, conflictType: cur.data.conflict_type, notes: v.data.notes ?? null },
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVALS
// ═══════════════════════════════════════════════════════════════════════════════

// ── POST /api/hse/ptw/permits/approvals/list ──────────────────────────────────
// hse.ptw.view — ordered by step_order

const ApprovalListSchema = z.object({
  permitId: z.string().uuid(),
});

router.post('/ptw/permits/approvals/list', async c => {
  await requirePermission(c, 'hse.ptw.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ApprovalListSchema, body.args);
  if (!v.ok) return v.response;

  const { data, error } = await sb
    .from('hse_permit_approvals')
    .select('*')
    .eq('permit_id', v.data.permitId)
    .order('step_order');
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/ptw/permits/approvals/decide ────────────────────────────────
// hse.ptw.approve — approve, reject, or request changes on a specific approval step.

const ApprovalDecideSchema = z.object({
  approvalId: z.string().uuid(),
  decision:   z.enum(['approved', 'rejected', 'changes_requested']),
  comments:   z.string().nullable().optional(),
});

router.post('/ptw/permits/approvals/decide', async c => {
  const user = await requirePermission(c, 'hse.ptw.approve');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, ApprovalDecideSchema, body.args);
  if (!v.ok) return v.response;

  // Load the approval step + its permit
  const approvalRes = await sb
    .from('hse_permit_approvals')
    .select('id, permit_id, step_order, role_required, approver_user_id, status')
    .eq('id', v.data.approvalId)
    .maybeSingle<{
      id: string;
      permit_id: string;
      step_order: number;
      role_required: string;
      approver_user_id: string | null;
      status: string;
    }>();
  if (!approvalRes.data) return c.json({ success: false, message: 'Approval step not found.' }, 404 as 200);
  const approval = approvalRes.data;

  if (!['pending', 'delegated'].includes(approval.status)) {
    return c.json({ success: false, message: `Approval step is already "${approval.status}" and cannot be decided again.` }, 400 as 200);
  }

  const now = new Date().toISOString();
  // Map decision to DB status values — 'changes_requested' doesn't exist in DB enum:
  // status check: ('pending','approved','rejected','delegated','skipped')
  // For changes_requested: use 'rejected' with a comment note, OR we store it in
  // comments only. Since 'changes_requested' is not a valid DB status we map to 'pending'
  // and store the intent in comments. Actually the cleanest approach: map to 'rejected'
  // for the step (it wasn't approved), and trigger changes_requested on the permit level.
  const dbStatus: Record<string, string> = {
    approved:           'approved',
    rejected:           'rejected',
    changes_requested:  'rejected',   // step-level rejection; permit gets changes_requested
  };

  const { error } = await sb
    .from('hse_permit_approvals')
    .update({
      status:           dbStatus[v.data.decision] ?? 'rejected',
      approver_user_id: approval.approver_user_id ?? user.id,  // set if not pre-assigned
      decision_at:      now,
      comments:         v.data.comments ?? null,
      updated_at:       now,
    })
    .eq('id', v.data.approvalId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  // Load all approvals for this permit to determine terminal state
  const allApprovalsRes = await sb
    .from('hse_permit_approvals')
    .select('id, step_order, status, approver_user_id, role_required')
    .eq('permit_id', approval.permit_id)
    .order('step_order');
  const allApprovals = (allApprovalsRes.data ?? []) as Array<{
    id: string;
    step_order: number;
    status: string;
    approver_user_id: string | null;
    role_required: string;
  }>;

  // Re-read the updated step
  const updatedApprovals = allApprovals.map(a =>
    a.id === v.data.approvalId ? { ...a, status: dbStatus[v.data.decision] ?? 'rejected' } : a,
  );

  const permit = await getPermitMeta(approval.permit_id);
  const permRef = permit?.permit_number ?? approval.permit_id;

  // Find the next pending approver (for notification)
  const nextPending = updatedApprovals
    .filter(a => a.status === 'pending' && a.id !== v.data.approvalId)
    .sort((a, b) => a.step_order - b.step_order)[0];

  // Terminal checks
  const allApproved = updatedApprovals.every(a => ['approved', 'skipped'].includes(a.status));
  const anyRejected = updatedApprovals.some(a => a.status === 'rejected');

  void sb.from('hse_permit_audit_events').insert({
    permit_id:     approval.permit_id,
    action:        `approval_${v.data.decision}`,
    actor_user_id: user.id,
    after_state:   { approval_id: v.data.approvalId, step_order: approval.step_order, decision: v.data.decision },
    metadata:      { comments: v.data.comments ?? null, role_required: approval.role_required },
  });

  if (v.data.decision === 'approved') {
    if (allApproved) {
      // All steps approved — notify requester
      void emitAppEvent({
        eventType:        'ptw.permit.approved',
        sourceModule:     'hse',
        sourceEntityType: 'permit',
        sourceEntityId:   permRef,
        actorUserId:      user.id,
        severity:         'success',
        payload:          { approvalId: v.data.approvalId, allStepsComplete: true },
        dedupeKey:        `ptw.approval.all_approved:${approval.permit_id}`,
        ...(permit?.requester_id && permit.requester_id !== user.id ? {
          explicitRecipients: [{ userId: permit.requester_id, reason: 'owner' as const }],
          notification: {
            title:          `All approvals complete: ${permRef}`,
            body:           `Your permit has received all required approvals and is ready for activation.`,
            actionRoute:    `hse/permits/${approval.permit_id}`,
            type:           'ptw.permit.approved',
            actionRequired: false,
          },
        } : {}),
      });
    } else if (nextPending?.approver_user_id) {
      // Notify next approver
      void emitAppEvent({
        eventType:        'ptw.permit.approval_required',
        sourceModule:     'hse',
        sourceEntityType: 'permit',
        sourceEntityId:   permRef,
        actorUserId:      user.id,
        severity:         'info',
        payload:          { approvalId: nextPending.id, stepOrder: nextPending.step_order, roleRequired: nextPending.role_required },
        explicitRecipients: [{ userId: nextPending.approver_user_id, reason: 'assignee' as const }],
        notification: {
          title:          `Approval required for permit: ${permRef}`,
          body:           `Your approval is required as ${nextPending.role_required}.`,
          actionRoute:    `hse/permits/${approval.permit_id}`,
          type:           'ptw.permit.approval_required',
          actionRequired: true,
        },
      });
    }
  } else if (v.data.decision === 'rejected' || v.data.decision === 'changes_requested') {
    // Notify requester of rejection / changes requested
    const eventType = v.data.decision === 'rejected'
      ? 'ptw.permit.rejected'
      : 'ptw.permit.changes_requested';
    const title = v.data.decision === 'rejected'
      ? `Permit approval rejected: ${permRef}`
      : `Changes requested on permit: ${permRef}`;
    const bodyText = v.data.comments
      ? `${v.data.decision === 'rejected' ? 'Rejected' : 'Changes requested'} by ${approval.role_required}: ${v.data.comments}`
      : `${v.data.decision === 'rejected' ? 'Rejected' : 'Changes requested'} by ${approval.role_required}.`;

    void emitAppEvent({
      eventType,
      sourceModule:     'hse',
      sourceEntityType: 'permit',
      sourceEntityId:   permRef,
      actorUserId:      user.id,
      severity:         'warning',
      payload:          { approvalId: v.data.approvalId, decision: v.data.decision, comments: v.data.comments ?? null, roleRequired: approval.role_required },
      ...(permit?.requester_id && permit.requester_id !== user.id ? {
        explicitRecipients: [{ userId: permit.requester_id, reason: 'owner' as const }],
        notification: {
          title,
          body:           bodyText,
          actionRoute:    `hse/permits/${approval.permit_id}`,
          type:           eventType,
          actionRequired: true,
        },
      } : {}),
    });
  }

  return c.json({
    success: true,
    data: {
      decision:      v.data.decision,
      allApproved,
      anyRejected,
      nextPendingStep: nextPending ? { id: nextPending.id, stepOrder: nextPending.step_order, roleRequired: nextPending.role_required } : null,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERMIT TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

// ── POST /api/hse/ptw/permit-templates/list ───────────────────────────────────
// hse.ptw.view — list permit templates, optionally filtering by active status.

const TemplateListSchema = z.object({
  activeOnly: z.boolean().optional(),
});

router.post('/ptw/permit-templates/list', async c => {
  await requirePermission(c, 'hse.ptw.view');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TemplateListSchema, body.args ?? {});
  if (!v.ok) return v.response;

  let q = sb
    .from('hse_permit_templates')
    .select('id, name, description, permit_type, risk_level, requires_jsa, requires_isolation, requires_gas_test, approval_route, hazards, controls, pre_work_checks, post_work_checks, active, config, created_by, created_at, updated_at')
    .order('name');

  if (v.data.activeOnly === true) q = q.eq('active', true);

  const { data, error } = await q;
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  return c.json({ success: true, data: data ?? [] });
});

// ── POST /api/hse/ptw/permit-templates/create ─────────────────────────────────
// hse.ptw.manage — insert a new permit template (active=true by default).

const TemplateCreateSchema = z.object({
  name:              z.string().min(1).max(200),
  description:       z.string().optional(),
  permitType:        z.string().min(1),
  riskLevel:         z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
  requiresJsa:       z.boolean().optional(),
  requiresIsolation: z.boolean().optional(),
  requiresGasTest:   z.boolean().optional(),
  approvalRoute:     z.array(z.unknown()).optional(),
  hazards:           z.array(z.unknown()).optional(),
  controls:          z.array(z.unknown()).optional(),
  preWorkChecks:     z.array(z.unknown()).optional(),
  postWorkChecks:    z.array(z.unknown()).optional(),
  config:            z.record(z.string(), z.unknown()).optional(),
});

router.post('/ptw/permit-templates/create', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TemplateCreateSchema, body.args);
  if (!v.ok) return v.response;

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('hse_permit_templates')
    .insert({
      name:              v.data.name,
      description:       v.data.description ?? null,
      permit_type:       v.data.permitType,
      risk_level:        v.data.riskLevel ?? null,
      requires_jsa:      v.data.requiresJsa       ?? false,
      requires_isolation:v.data.requiresIsolation ?? false,
      requires_gas_test: v.data.requiresGasTest   ?? false,
      approval_route:    v.data.approvalRoute      ?? [],
      hazards:           v.data.hazards            ?? [],
      controls:          v.data.controls           ?? [],
      pre_work_checks:   v.data.preWorkChecks      ?? [],
      post_work_checks:  v.data.postWorkChecks     ?? [],
      active:            true,
      config:            v.data.config             ?? {},
      created_by:        user.id,
      updated_at:        now,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Template insert failed' }, 500 as 200);

  void emitAppEvent({
    eventType:        'hse.permit_template.created',
    sourceModule:     'hse',
    sourceEntityType: 'permit_template',
    sourceEntityId:   data.id,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { name: v.data.name, permitType: v.data.permitType },
  });

  return c.json({ success: true, data: { id: data.id } });
});

// ── POST /api/hse/ptw/permit-templates/update ─────────────────────────────────
// hse.ptw.manage — patch any mutable field of a template.

const TemplateUpdateSchema = z.object({
  templateId:        z.string().uuid(),
  name:              z.string().min(1).max(200).optional(),
  description:       z.string().nullable().optional(),
  permitType:        z.string().min(1).optional(),
  riskLevel:         z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
  requiresJsa:       z.boolean().optional(),
  requiresIsolation: z.boolean().optional(),
  requiresGasTest:   z.boolean().optional(),
  approvalRoute:     z.array(z.unknown()).optional(),
  hazards:           z.array(z.unknown()).optional(),
  controls:          z.array(z.unknown()).optional(),
  preWorkChecks:     z.array(z.unknown()).optional(),
  postWorkChecks:    z.array(z.unknown()).optional(),
  config:            z.record(z.string(), z.unknown()).optional(),
});

router.post('/ptw/permit-templates/update', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TemplateUpdateSchema, body.args);
  if (!v.ok) return v.response;

  const { templateId, ...fields } = v.data;

  // Verify template exists
  const cur = await sb
    .from('hse_permit_templates')
    .select('id')
    .eq('id', templateId)
    .maybeSingle<{ id: string }>();
  if (!cur.data) return c.json({ success: false, message: 'Template not found.' }, 404 as 200);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.name              !== undefined) updates.name               = fields.name;
  if (fields.description       !== undefined) updates.description        = fields.description;
  if (fields.permitType        !== undefined) updates.permit_type        = fields.permitType;
  if (fields.riskLevel         !== undefined) updates.risk_level         = fields.riskLevel;
  if (fields.requiresJsa       !== undefined) updates.requires_jsa       = fields.requiresJsa;
  if (fields.requiresIsolation !== undefined) updates.requires_isolation = fields.requiresIsolation;
  if (fields.requiresGasTest   !== undefined) updates.requires_gas_test  = fields.requiresGasTest;
  if (fields.approvalRoute     !== undefined) updates.approval_route     = fields.approvalRoute;
  if (fields.hazards           !== undefined) updates.hazards            = fields.hazards;
  if (fields.controls          !== undefined) updates.controls           = fields.controls;
  if (fields.preWorkChecks     !== undefined) updates.pre_work_checks    = fields.preWorkChecks;
  if (fields.postWorkChecks    !== undefined) updates.post_work_checks   = fields.postWorkChecks;
  if (fields.config            !== undefined) updates.config             = fields.config;

  const { error } = await sb.from('hse_permit_templates').update(updates).eq('id', templateId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({
    eventType:        'hse.permit_template.updated',
    sourceModule:     'hse',
    sourceEntityType: 'permit_template',
    sourceEntityId:   templateId,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { changes: Object.keys(updates).filter(k => k !== 'updated_at') },
  });

  return c.json({ success: true });
});

// ── POST /api/hse/ptw/permit-templates/duplicate ──────────────────────────────
// hse.ptw.manage — copy a template row, appending " (copy)" to the name.

const TemplateDuplicateSchema = z.object({
  templateId: z.string().uuid(),
});

router.post('/ptw/permit-templates/duplicate', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TemplateDuplicateSchema, body.args);
  if (!v.ok) return v.response;

  // Load source template
  const src = await sb
    .from('hse_permit_templates')
    .select('name, description, permit_type, risk_level, requires_jsa, requires_isolation, requires_gas_test, approval_route, hazards, controls, pre_work_checks, post_work_checks, config')
    .eq('id', v.data.templateId)
    .maybeSingle<{
      name: string;
      description: string | null;
      permit_type: string;
      risk_level: string | null;
      requires_jsa: boolean;
      requires_isolation: boolean;
      requires_gas_test: boolean;
      approval_route: unknown;
      hazards: unknown;
      controls: unknown;
      pre_work_checks: unknown;
      post_work_checks: unknown;
      config: unknown;
    }>();

  if (!src.data) return c.json({ success: false, message: 'Template not found.' }, 404 as 200);
  const s = src.data;

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('hse_permit_templates')
    .insert({
      name:               `${s.name} (copy)`,
      description:        s.description,
      permit_type:        s.permit_type,
      risk_level:         s.risk_level,
      requires_jsa:       s.requires_jsa,
      requires_isolation: s.requires_isolation,
      requires_gas_test:  s.requires_gas_test,
      approval_route:     s.approval_route,
      hazards:            s.hazards,
      controls:           s.controls,
      pre_work_checks:    s.pre_work_checks,
      post_work_checks:   s.post_work_checks,
      active:             true,
      config:             s.config,
      created_by:         user.id,
      updated_at:         now,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) return c.json({ success: false, message: error?.message ?? 'Duplicate failed' }, 500 as 200);

  void emitAppEvent({
    eventType:        'hse.permit_template.duplicated',
    sourceModule:     'hse',
    sourceEntityType: 'permit_template',
    sourceEntityId:   data.id,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { sourceTemplateId: v.data.templateId, newTemplateId: data.id, name: `${s.name} (copy)` },
  });

  return c.json({ success: true, data: { id: data.id } });
});

// ── POST /api/hse/ptw/permit-templates/deactivate ────────────────────────────
// hse.ptw.manage — toggle active flag (activate or deactivate).

const TemplateDeactivateSchema = z.object({
  templateId: z.string().uuid(),
  active:     z.boolean(),
});

router.post('/ptw/permit-templates/deactivate', async c => {
  const user = await requirePermission(c, 'hse.ptw.manage');
  const body = c.get('body') as Record<string, unknown>;
  const v = zv(c, TemplateDeactivateSchema, body.args);
  if (!v.ok) return v.response;

  const cur = await sb
    .from('hse_permit_templates')
    .select('id, name, active')
    .eq('id', v.data.templateId)
    .maybeSingle<{ id: string; name: string; active: boolean }>();
  if (!cur.data) return c.json({ success: false, message: 'Template not found.' }, 404 as 200);

  const { error } = await sb
    .from('hse_permit_templates')
    .update({ active: v.data.active, updated_at: new Date().toISOString() })
    .eq('id', v.data.templateId);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);

  void emitAppEvent({
    eventType:        v.data.active ? 'hse.permit_template.activated' : 'hse.permit_template.deactivated',
    sourceModule:     'hse',
    sourceEntityType: 'permit_template',
    sourceEntityId:   v.data.templateId,
    actorUserId:      user.id,
    severity:         'info',
    payload:          { templateId: v.data.templateId, name: cur.data.name, active: v.data.active },
  });

  return c.json({ success: true });
});

export default router;

