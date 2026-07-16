// ============================================================================
// Central Workflow Engine — service (Spec §10-§16)
// ============================================================================
// startWorkflowForRecord / startWorkflowExplicit / startWorkflowByTemplate /
// decideTask / advance / return / reject / complete / cancel / delegate /
// reassign + handoff + audit. Writes the spec columns only (legacy columns
// dropped in 20260704000003). Notifications are emitted as app_events
// (existing event_rules -> notifications pipeline). Adapter callbacks are
// null-safe so the engine runs before per-module adapters exist.
//
// E1/E2/E3 explicit-start auth guards:
//   MODULE_START_PERMISSION -- minimum permission key per module for explicit
//     starts; routes check this BEFORE calling startWorkflowExplicit.
//   MODULE_SOURCE_TABLE -- source table per module for existence checks.
//   validateModuleSourceExists -- UUID-aware existence check (service-role read).
//   getModuleStartPermission -- exported helper for route-layer checks.
// ============================================================================

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';
import type {
  ModuleWorkflowContext, WorkflowTemplateDefinition, WorkflowStepDefinition,
} from './definitionTypes';
import { selectWorkflowBinding, type WorkflowBindingRow } from './bindingResolver';
import { resolveStepAssignee, type ResolvedAssignee } from './assigneeResolver';
import { validateWorkflowDefinition } from './validateDefinition';
import { firstSteps } from './transitions';
import { getWorkflowAdapter } from './adapterRegistry';

// ── Module -> permission mapping (explicit-start auth gate, finding #3 §7) ──
// Minimum permission an actor must hold to start a workflow for a given module.
// Routes call getModuleStartPermission() and check via userCan() before the RPC.
// Unknown module keys return null -> routes DENY (safe default).
const MODULE_START_PERMISSION: Record<string, string> = {
  hr:                   'hr.view',
  hr_onboarding:        'hr.onboarding.view',
  hr_employee_master:   'hr.employees.view',
  hr_requests:          'hr.requests.manage',
  hr_attendance:        'hr.attendance.view_all',
  hr_leave:             'hr.leave.view_all',
  hse_incidents:        'hse.incidents.view',
  hse_risk_assessments: 'hse.risk.view',
  hse_jsa:              'hse.risk.view',
  hse_hazards:          'hse.risk.view',
  hse_capa:             'hse.capa.view',
  ptw:                  'hse.ptw.view',
  finance_payroll:      'finance.payroll.view_all',
  finance_statutory:    'finance.statutory.view',
  finance_ap:           'finance.ap.view',
  finance_expenses:     'finance.expenses.view',
  finance_remittances:  'finance.remittances.view',
};

// ── Module -> source table mapping (UUID-based existence check) ──────────────
// Only modules whose source records have a UUID primary key (`id`) are listed.
// Non-UUID ref keys (e.g. permit refs like PTW-2026-001) are skipped by the
// UUID format guard in validateModuleSourceExists.
const MODULE_SOURCE_TABLE: Record<string, string> = {
  hr_onboarding:        'hr_onboarding_cases',
  hr_employee_master:   'app_users',
  hse_incidents:        'hse_incidents',
  hse_risk_assessments: 'hse_risk_assessments',
  hse_jsa:              'hse_jsa',
  hse_hazards:          'hse_hazards',
  hse_capa:             'hse_capa',
  finance_payroll:      'finance_payroll_runs',
  finance_expenses:     'finance_expense_claims',
  finance_remittances:  'finance_remittances',
};

const UUID_RE_STRICT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minimum permission key for explicit starts on a given module. Null = unknown module (deny). */
export function getModuleStartPermission(moduleKey: string): string | null {
  return MODULE_START_PERMISSION[moduleKey] ?? null;
}

/**
 * Check that a source record exists in the modules table.
 * Skips the check when: (a) the module has no known table, or (b) the
 * sourceRecordId is not UUID format (text refs like PTW-2026-001 are allowed).
 * Returns true when the record exists or the check is skipped; false when the
 * UUID-format id is not found (caller should 404).
 */
export async function validateModuleSourceExists(moduleKey: string, sourceRecordId: string): Promise<boolean> {
  const table = MODULE_SOURCE_TABLE[moduleKey];
  if (!table) return true;
  if (!UUID_RE_STRICT.test(sourceRecordId)) return true;
  const { data } = await (sb as unknown as { from: (t: string) => { select: (c: string) => { eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> } } } })
    .from(table).select('id').eq('id', sourceRecordId).maybeSingle();
  return data !== null;
}

export interface WorkflowActor { id: string; role?: string }


function addHoursIso(hours: number | undefined | null): string | null {
  if (!hours) return null;
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

// The workflow_instances priority CHECK is (low/medium/high/critical); the spec's
// 'normal' maps to 'medium'.
function normalizePriority(p: string | undefined | null): string {
  return !p || p === 'normal' ? 'medium' : p;
}

async function writeWorkflowAudit(p: {
  workflowId: string; taskId?: string | null; moduleKey: string; sourceRecordId: string;
  actorId: string; action: string; previousState?: unknown; newState?: unknown; reason?: string | null;
}): Promise<void> {
  await sb.from('workflow_audit_log').insert({
    workflow_id: p.workflowId, task_id: p.taskId ?? null, module_key: p.moduleKey,
    source_record_id: p.sourceRecordId, actor_id: p.actorId, action: p.action,
    previous_state: p.previousState ?? null, new_state: p.newState ?? null, reason: p.reason ?? null,
  });
}

type WfRecipient = { userId: string; reason: 'assignee' | 'owner' | 'reporter' };

interface EmitWfOpts {
  payload?: Record<string, unknown>;
  severity?: 'info' | 'success' | 'warning' | 'critical';
  notification?: { title: string; body?: string; actionRoute?: string; type?: string; actionRequired?: boolean };
  explicitRecipients?: WfRecipient[];
}

function emitWf(eventType: string, wf: WorkflowRow, actorId: string, opts: EmitWfOpts = {}): void {
  void emitAppEvent({
    eventType, sourceModule: 'workflow', sourceEntityType: 'workflow', sourceEntityId: wf.workflow_no ?? wf.id,
    actorUserId: actorId, severity: opts.severity ?? 'info',
    payload: { workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, ...(opts.payload ?? {}) },
    ...(opts.notification ? { notification: opts.notification } : {}),
    ...(opts.explicitRecipients && opts.explicitRecipients.length ? { explicitRecipients: opts.explicitRecipients } : {}),
  } as Parameters<typeof emitAppEvent>[0]);
}

/** Resolve a step assignee ({userId?|roleKey?}) to notification recipients (role → active users). */
async function assigneeRecipients(assignee: { userId?: string; roleKey?: string }): Promise<WfRecipient[]> {
  if (assignee.userId) return [{ userId: assignee.userId, reason: 'assignee' }];
  if (assignee.roleKey) {
    const { data } = await sb.from('app_users').select('id').eq('role', assignee.roleKey).eq('status', 'active');
    return (data ?? []).map((u) => ({ userId: (u as { id: string }).id, reason: 'assignee' as const }));
  }
  return [];
}

// Workflow-owning module_key → frontend section route for notification deep-links.
// The FE resolver (notifAction.ts) accepts `s-…` ids or `hse/<area>` paths.
const MODULE_ROUTE: Record<string, string> = {
  hse_incidents:        'hse/incidents',
  hse_capa:             'hse/capa',
  hse_hazards:          'hse/risk-jsa',
  hse_risk_assessments: 'hse/risk-jsa',
  hse_jsa:              'hse/risk-jsa',
  ptw:                  'hse/ptw',
  hr_employee_master:         's-hr',   // bare section id (resolver uses s-… as-is)
  hr_requests:                's-hr-requests',
  finance_payroll_templates:  's-finance-payslip-designer',
};
export function moduleRoute(moduleKey: string): string {
  if (MODULE_ROUTE[moduleKey]) return MODULE_ROUTE[moduleKey];
  // Derive an hse/<area> path the FE resolver can navigate (never a bare section).
  const area = moduleKey.replace(/^hse_/, '').replace(/_/g, '-') || 'incidents';
  return `hse/${area}`;
}

/** Requester + owner recipients for terminal workflow events. */
export function ownerRecipients(wf: WorkflowRow): WfRecipient[] {
  const out: WfRecipient[] = [];
  if (wf.requested_by) out.push({ userId: wf.requested_by, reason: 'reporter' });
  if (wf.owner_id && wf.owner_id !== wf.requested_by) out.push({ userId: wf.owner_id, reason: 'owner' });
  return out;
}

export interface WorkflowRow {
  id: string; workflow_no: string | null; module_key: string; workflow_type: string;
  source_record_id: string; source_record_ref: string | null; status: string; current_step_key: string | null;
  priority: string; site_id: string | null; department_id: string | null; requested_by: string | null;
  owner_id: string | null; template_id: string; template_version_id: string | null;
  template_snapshot: WorkflowTemplateDefinition; source_snapshot: Record<string, unknown>;
  active_transition_id: string | null;
}
interface TaskRow {
  id: string; workflow_id: string; step_key: string; status: string; is_required: boolean;
}

async function getWorkflow(id: string): Promise<WorkflowRow> {
  const { data, error } = await sb.from('workflow_instances').select('*').eq('id', id).single<WorkflowRow>();
  if (error || !data) throw new Error('Workflow not found.');
  return data;
}
async function getTask(id: string): Promise<TaskRow & Record<string, unknown>> {
  const { data, error } = await sb.from('workflow_tasks').select('*').eq('id', id).single<TaskRow & Record<string, unknown>>();
  if (error || !data) throw new Error('Workflow task not found.');
  return data;
}

/** Resolve the definition for a binding: bound version → newest published version. No legacy fallback. */
async function resolveDefinition(binding: WorkflowBindingRow): Promise<{ definition: WorkflowTemplateDefinition; versionId: string }> {
  if (binding.template_version_id) {
    const { data } = await sb.from('workflow_template_versions').select('id, definition').eq('id', binding.template_version_id).maybeSingle<{ id: string; definition: WorkflowTemplateDefinition }>();
    if (data) return { definition: data.definition, versionId: data.id };
  }
  const { data: ver } = await sb.from('workflow_template_versions').select('id, definition')
    .eq('template_id', binding.template_id).eq('version_status', 'published').order('version_no', { ascending: false }).limit(1).maybeSingle<{ id: string; definition: WorkflowTemplateDefinition }>();
  if (ver) return { definition: ver.definition, versionId: ver.id };
  throw new Error('Workflow binding has no published template version.');
}

/** Pure task-row builder (no workflow_id — the caller/finalize-RPC supplies it).
 *  Shared by the start path (direct insert) and the outbox worker (jsonb rows
 *  passed to workflow_finalize_transition_tx, which inserts them atomically). */
export function buildTaskRowForStep(step: WorkflowStepDefinition, context: ModuleWorkflowContext): Record<string, unknown> {
  const assignee = resolveStepAssignee(step, context);
  return {
    step_key: step.stepKey, step_name: step.stepName, step_type: step.stepType, task_title: step.stepName,
    assigned_to: assignee.userId ?? null, assigned_role: assignee.roleKey ?? null,
    due_at: addHoursIso(step.dueDurationHours), is_required: step.required,
    metadata: { assignmentType: step.assignment.type },
  };
}

/** "Action required" fan-out to a step's assignee(s) — fired after the task row
 *  is committed (start path inserts directly; worker calls this post-finalize).
 *  Idempotent per user via the notify() dedupe pipeline. */
export function notifyTaskAssigned(wf: WorkflowRow, step: WorkflowStepDefinition, context: ModuleWorkflowContext): void {
  const assignee = resolveStepAssignee(step, context);
  void assigneeRecipients(assignee).then(recipients => {
    emitWf('workflow.task.assigned', wf, wf.requested_by ?? '', {
      payload: { stepKey: step.stepKey, assignedRole: assignee.roleKey, assignedTo: assignee.userId },
      explicitRecipients: recipients,
      notification: recipients.length ? {
        title: `Action required: ${step.stepName}`,
        body: `${wf.workflow_no ?? ''} — ${wf.source_record_ref ?? wf.source_record_id} needs ${step.stepName.toLowerCase()}.`,
        actionRoute: moduleRoute(wf.module_key),
        type: 'workflow.task.assigned',
        actionRequired: true,
      } : undefined,
    });
  });
}

async function createTaskForStep(wf: WorkflowRow, step: WorkflowStepDefinition, context: ModuleWorkflowContext): Promise<void> {
  await sb.from('workflow_tasks').insert({ workflow_id: wf.id, status: 'pending', ...buildTaskRowForStep(step, context) });
  notifyTaskAssigned(wf, step, context);
}

// ── start ────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a published definition for an explicit start by template reference (template_key OR id).
 * Requires a published version — no runtime translation of legacy definitions.
 */
async function resolveDefinitionByTemplateRef(ref: string): Promise<{ templateId: string; definition: WorkflowTemplateDefinition; versionId: string }> {
  const col = UUID_RE.test(ref) ? 'id' : 'template_key';
  const { data: tpl } = await sb.from('workflow_templates').select('id').eq(col, ref).maybeSingle<{ id: string }>();
  if (!tpl) throw new Error(`Workflow template not found: ${ref}`);
  const { data: ver } = await sb.from('workflow_template_versions').select('id, definition')
    .eq('template_id', tpl.id).eq('version_status', 'published').order('version_no', { ascending: false }).limit(1)
    .maybeSingle<{ id: string; definition: WorkflowTemplateDefinition }>();
  if (!ver) throw new Error(`Workflow template has no published version: ${ref}`);
  return { templateId: tpl.id, definition: ver.definition, versionId: ver.id };
}

/** Shared instance creation — insert the workflow_instance, spawn first task(s), audit + notify. */
async function instantiateWorkflow(p: {
  templateId: string; versionId: string | null; definition: WorkflowTemplateDefinition;
  bindingId: string | null; context: ModuleWorkflowContext; actor: WorkflowActor;
}): Promise<WorkflowRow> {
  validateWorkflowDefinition(p.definition);
  const workflowNo = await nextRef('WF');
  const starts = firstSteps(p.definition);
  const firstKey = starts[0]?.stepKey ?? null;

  const { data: instance, error } = await sb.from('workflow_instances').insert({
    workflow_no: workflowNo, template_id: p.templateId, template_version_id: p.versionId,
    module_key: p.context.moduleKey, workflow_type: p.context.workflowType,
    source_record_id: p.context.sourceRecordId, source_record_ref: p.context.sourceRecordRef ?? null,
    status: 'in_progress', current_step_key: firstKey, priority: normalizePriority(p.context.priority),
    site_id: p.context.siteId ?? null, department_id: p.context.departmentId ?? null,
    requested_by: p.context.requestedBy, owner_id: p.context.ownerId ?? null,
    started_at: new Date().toISOString(),
    template_snapshot: p.definition, source_snapshot: p.context.recordData,
    metadata: { bindingId: p.bindingId, triggerEvent: p.context.triggerEvent },
  }).select('*').single<WorkflowRow>();
  if (error || !instance) throw new Error(`Failed to start workflow: ${error?.message}`);

  for (const step of starts) await createTaskForStep(instance, step, p.context);

  await writeWorkflowAudit({ workflowId: instance.id, moduleKey: instance.module_key, sourceRecordId: instance.source_record_id, actorId: p.actor.id, action: 'workflow.started', newState: { status: instance.status } });
  emitWf('workflow.started', instance, p.actor.id);
  await getWorkflowAdapter(p.context.moduleKey, p.context.workflowType)?.onWorkflowStarted({ workflowId: instance.id, sourceRecordId: instance.source_record_id });
  return instance;
}

/** Module-event-driven start: resolve the active binding for the context, then instantiate. */
export async function startWorkflowForRecord(params: { context: ModuleWorkflowContext; actor: WorkflowActor }): Promise<WorkflowRow | null> {
  const binding = await selectWorkflowBinding(sb, params.context);
  if (!binding) return null;                                                // no binding → module proceeds without a workflow
  const { definition, versionId } = await resolveDefinition(binding);
  return instantiateWorkflow({ templateId: binding.template_id, versionId, definition, bindingId: binding.id, context: params.context, actor: params.actor });
}

/**
 * Core explicit-start via the workflow_start_instance_tx RPC.
 * Resolves first-step assignees from context (or accepts pre-resolved ones),
 * calls the RPC atomically, and returns the committed WorkflowRow.
 * Auth (source-existence + module-authz) is the CALLER's responsibility per
 * START_INSTANCE_CONTRACT.md §4 -- this function trusts its inputs.
 */
export async function startWorkflowExplicit(params: {
  templateId?: string;
  versionId: string;
  context: ModuleWorkflowContext;
  actor: WorkflowActor;
  idempotencyKey?: string;
  preResolvedAssignees?: Record<string, ResolvedAssignee>;
}): Promise<WorkflowRow> {
  // Load definition to resolve first-step assignees (if not pre-resolved).
  let assignees: Record<string, ResolvedAssignee>;
  if (params.preResolvedAssignees) {
    assignees = params.preResolvedAssignees;
  } else {
    const { data: ver } = await sb.from('workflow_template_versions')
      .select('definition')
      .eq('id', params.versionId)
      .maybeSingle<{ definition: WorkflowTemplateDefinition }>();
    if (!ver) throw Object.assign(new Error('Workflow template version not found.'), { status: 404 });
    assignees = {};
    for (const step of firstSteps(ver.definition)) {
      const a = resolveStepAssignee(step, params.context);
      assignees[step.stepKey] = {
        ...(a.userId  ? { userId:  a.userId  } : {}),
        ...(a.roleKey ? { roleKey: a.roleKey } : {}),
      };
    }
  }

  const { data, error } = await sb.rpc('workflow_start_instance_tx', {
    p_template_version_id: params.versionId,
    p_module_key:          params.context.moduleKey,
    p_workflow_type:       params.context.workflowType,
    p_source_record_id:    params.context.sourceRecordId,
    p_source_record_ref:   params.context.sourceRecordRef ?? null,
    p_trigger_event:       params.context.triggerEvent ?? 'manual.start',
    p_requested_by:        params.context.requestedBy,
    p_owner_id:            params.context.ownerId ?? null,
    p_site_id:             params.context.siteId ?? null,
    p_department_id:       params.context.departmentId ?? null,
    p_priority:            normalizePriority(params.context.priority),
    p_source_snapshot:     (params.context.recordData ?? {}) as Record<string, unknown>,
    p_assignees:           assignees as Record<string, unknown>,
    p_request_key:         params.idempotencyKey ?? '',
  });
  if (error) throw rpcHttpError(error as { code?: string | null; message: string });

  const result = data as { workflowId: string };
  return getWorkflow(result.workflowId);
}

/**
 * Explicit start by template reference (key or id) -- manual "start workflow"
 * actions; no binding required. Now routes through startWorkflowExplicit ->
 * workflow_start_instance_tx (the atomic primitive) instead of the legacy
 * non-atomic instantiateWorkflow path.
 */
export async function startWorkflowByTemplate(params: {
  templateKey: string;
  context: ModuleWorkflowContext;
  actor: WorkflowActor;
  idempotencyKey?: string;
}): Promise<WorkflowRow> {
  const { templateId, versionId } = await resolveDefinitionByTemplateRef(params.templateKey);
  return startWorkflowExplicit({
    templateId,
    versionId,
    context: params.context,
    actor: params.actor,
    idempotencyKey: params.idempotencyKey,
  });
}

// ── decide ───────────────────────────────────────────────────────────────────
// The decision is committed by the workflow_decide_task_tx RPC — ONE atomic
// transaction that locks instance→task, resolves authorization from canonical
// tables (never the caller), re-validates the step's decision rules against the
// immutable template snapshot, records task/decision/audit/event, and enqueues
// the transition + outbox job. This shared entry point covers EVERY caller
// (workflow-engine route, legacy /workflows/decision, adapters), so the
// horizontal-bypass fix (0ed1ea8a) now lives in the database itself.
//
// Custom SQLSTATEs from the RPC map to HTTP: WF403 not-assigned · WF409
// concurrent/already-decided/mid-transition · WF400 requirement · WF422
// override-reason · WF404 not-found.

const WF_SQLSTATE_HTTP: Record<string, number> = { WF400: 400, WF403: 403, WF404: 404, WF409: 409, WF422: 422 };

/** Convert a supabase-js RPC error into a status-tagged Error the routes honor.
 *  Shared by every WF*-SQLSTATE RPC caller (decideTask + the Shape-A/B submit
 *  wrappers) — maps WF400/403/404/409/422 → HTTP and strips the plpgsql prefix. */
export function rpcHttpError(error: { code?: string | null; message: string }): Error & { status?: number } {
  const status = error.code ? WF_SQLSTATE_HTTP[error.code] : undefined;
  // Strip the plpgsql function prefix ('workflow_decide: …') for user-facing text.
  const message = error.message.replace(/^workflow_[a-z_]+:\s*/i, '');
  return Object.assign(new Error(message), status ? { status } : {});
}

export async function decideTask(params: {
  workflowId: string; taskId: string; actor: WorkflowActor;
  decision: 'approved' | 'returned' | 'rejected'; comment?: string; attachmentIds?: string[];
  overrideReason?: string;
}): Promise<WorkflowRow & { pendingTransition?: boolean }> {
  const { data, error } = await sb.rpc('workflow_decide_task_tx', {
    p_workflow_id:     params.workflowId,
    p_task_id:         params.taskId,
    p_actor_id:        params.actor.id,
    p_decision:        params.decision,
    p_comment:         params.comment ?? null,
    p_attachment_ids:  params.attachmentIds ?? [],
    p_override_reason: params.overrideReason ?? null,
  });
  if (error) throw rpcHttpError(error as { code?: string | null; message: string });

  const r = (data ?? {}) as { outcome?: string; transitionId?: string };

  // Happy path: run the enqueued transition's side-effects in-request so the
  // caller sees the finalized state. A failure here is NOT an error — the
  // decision is already committed; the scheduled recovery worker finishes the
  // transition. The caller gets pendingTransition (routes map it to 202).
  let pending = false;
  if (r.outcome === 'transition_enqueued' && r.transitionId) {
    try {
      const { processTransitionInline } = await import('./outboxWorker.js');
      pending = !(await processTransitionInline(r.transitionId));
    } catch (e) {
      console.error('[workflow] inline transition processing failed (recovery worker will retry):', e instanceof Error ? e.message : e);
      pending = true;
    }
  }

  const wf = await getWorkflow(params.workflowId);
  return pending ? { ...wf, pendingTransition: true } : wf;
}

export async function cancelWorkflow(params: { workflowId: string; actor: WorkflowActor; reason: string }): Promise<WorkflowRow> {
  const wf = await getWorkflow(params.workflowId);
  // Competing-command gate (§3 of DECIDE_TX_DESIGN): no command may race a
  // committed-but-unfinalized decision, and only an active workflow can be
  // cancelled. (TS-side guard; the full instance-first-locking cancel RPC is the
  // next migration in this package.)
  if (wf.active_transition_id) throw Object.assign(new Error('Workflow has a decision mid-transition — retry shortly.'), { status: 409 });
  if (wf.status !== 'in_progress') throw Object.assign(new Error(`Workflow is already ${wf.status}.`), { status: 409 });
  const at = new Date().toISOString();
  await sb.from('workflow_instances').update({ status: 'cancelled', cancelled_at: at, closed_at: at }).eq('id', wf.id);
  await sb.from('workflow_tasks').update({ status: 'cancelled' }).eq('workflow_id', wf.id).in('status', ['pending', 'open', 'in_progress']);
  await getWorkflowAdapter(wf.module_key, wf.workflow_type)?.onWorkflowCancelled({ workflowId: wf.id, sourceRecordId: wf.source_record_id, reason: params.reason, actorId: params.actor.id ?? null });
  await writeWorkflowAudit({ workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: params.actor.id, action: 'workflow.cancelled', reason: params.reason });
  emitWf('workflow.cancelled', wf, params.actor.id, {
    severity: 'warning',
    explicitRecipients: ownerRecipients(wf),
    notification: { title: 'Workflow cancelled', body: `${wf.workflow_no ?? ''} — ${wf.source_record_ref ?? wf.source_record_id} was cancelled${params.reason ? `: ${params.reason}` : ''}.`, actionRoute: moduleRoute(wf.module_key), type: 'workflow.cancelled' },
  });
  return { ...wf, status: 'cancelled' };
}

// ── delegate / reassign ──────────────────────────────────────────────────────
export async function delegateTask(params: { taskId: string; actor: WorkflowActor; delegateTo: string; reason: string }): Promise<void> {
  const task = await getTask(params.taskId);
  const wf = await getWorkflow(task.workflow_id);
  if (wf.active_transition_id) throw Object.assign(new Error('Workflow has a decision mid-transition — retry shortly.'), { status: 409 });
  // Open-for-action statuses (a delegated/reassigned task is still awaiting a decision).
  if (!['pending', 'open', 'in_progress', 'delegated', 'reassigned'].includes(task.status)) throw Object.assign(new Error(`Task already ${task.status}.`), { status: 409 });
  const step = wf.template_snapshot.steps.find((s) => s.stepKey === task.step_key);
  if (!step?.decisionRules.canDelegate) throw new Error('This task cannot be delegated.');
  await sb.from('workflow_tasks').update({ status: 'delegated', delegated_to: params.delegateTo, assigned_to: params.delegateTo }).eq('id', task.id);
  await writeWorkflowAudit({ workflowId: wf.id, taskId: task.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: params.actor.id, action: 'workflow.task.delegated', reason: params.reason });
}

export async function reassignTask(params: { taskId: string; actor: WorkflowActor; reassignTo: string; reason: string }): Promise<void> {
  const task = await getTask(params.taskId);
  const wf = await getWorkflow(task.workflow_id);
  if (wf.active_transition_id) throw Object.assign(new Error('Workflow has a decision mid-transition — retry shortly.'), { status: 409 });
  // Open-for-action statuses (a delegated/reassigned task is still awaiting a decision).
  if (!['pending', 'open', 'in_progress', 'delegated', 'reassigned'].includes(task.status)) throw Object.assign(new Error(`Task already ${task.status}.`), { status: 409 });
  await sb.from('workflow_tasks').update({ status: 'reassigned', assigned_to: params.reassignTo }).eq('id', task.id);
  await writeWorkflowAudit({ workflowId: wf.id, taskId: task.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: params.actor.id, action: 'workflow.task.reassigned', reason: params.reason });
}

// ── context ───────────────────────────────────────────────────────────────────
// (Template-declared handoffs now commit as durable intent INSIDE
// workflow_finalize_transition_tx — handoff_outbox + workflow_handoffs rows in
// the same transaction as the terminal status. Delivery stays async on the bus.)
export function workflowToContext(wf: WorkflowRow): ModuleWorkflowContext {
  return {
    moduleKey: wf.module_key, workflowType: wf.workflow_type, triggerEvent: 'workflow.step.completed',
    sourceRecordId: wf.source_record_id, sourceRecordRef: wf.source_record_ref ?? undefined,
    siteId: wf.site_id, departmentId: wf.department_id, requestedBy: wf.requested_by ?? '', ownerId: wf.owner_id,
    priority: wf.priority as ModuleWorkflowContext['priority'], recordData: wf.source_snapshot,
  };
}
