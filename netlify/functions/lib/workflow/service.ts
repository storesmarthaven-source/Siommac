// ============================================================================
// Central Workflow Engine — service (Spec §10-§16)
// ============================================================================
// startWorkflowForRecord / decideTask / advance / return / reject / complete /
// cancel / delegate / reassign + handoff + audit. Writes the spec columns only
// (legacy columns dropped in 20260704000003). Notifications are emitted as
// app_events (existing event_rules → notifications pipeline). Adapter callbacks
// are null-safe so the engine runs before per-module adapters exist.
// ============================================================================

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';
import { createHandoff } from '../handoffBus';
import type {
  ModuleWorkflowContext, WorkflowTemplateDefinition, WorkflowStepDefinition,
} from './definitionTypes';
import { selectWorkflowBinding, type WorkflowBindingRow } from './bindingResolver';
import { resolveStepAssignee } from './assigneeResolver';
import { validateWorkflowDefinition } from './validateDefinition';
import { firstSteps, resolveNext } from './transitions';
import { getWorkflowAdapter } from './adapterRegistry';

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
function moduleRoute(moduleKey: string): string {
  if (MODULE_ROUTE[moduleKey]) return MODULE_ROUTE[moduleKey];
  // Derive an hse/<area> path the FE resolver can navigate (never a bare section).
  const area = moduleKey.replace(/^hse_/, '').replace(/_/g, '-') || 'incidents';
  return `hse/${area}`;
}

/** Requester + owner recipients for terminal workflow events. */
function ownerRecipients(wf: WorkflowRow): WfRecipient[] {
  const out: WfRecipient[] = [];
  if (wf.requested_by) out.push({ userId: wf.requested_by, reason: 'reporter' });
  if (wf.owner_id && wf.owner_id !== wf.requested_by) out.push({ userId: wf.owner_id, reason: 'owner' });
  return out;
}

interface WorkflowRow {
  id: string; workflow_no: string | null; module_key: string; workflow_type: string;
  source_record_id: string; source_record_ref: string | null; status: string; current_step_key: string | null;
  priority: string; site_id: string | null; department_id: string | null; requested_by: string | null;
  owner_id: string | null; template_id: string; template_version_id: string | null;
  template_snapshot: WorkflowTemplateDefinition; source_snapshot: Record<string, unknown>;
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

async function createTaskForStep(wf: WorkflowRow, step: WorkflowStepDefinition, context: ModuleWorkflowContext): Promise<void> {
  const assignee = resolveStepAssignee(step, context);
  const dueAt = addHoursIso(step.dueDurationHours);
  await sb.from('workflow_tasks').insert({
    workflow_id: wf.id,
    step_key: step.stepKey, step_name: step.stepName, step_type: step.stepType, task_title: step.stepName,
    assigned_to: assignee.userId ?? null, assigned_role: assignee.roleKey ?? null,
    status: 'pending', due_at: dueAt, is_required: step.required,
    metadata: { assignmentType: step.assignment.type },
  });
  const recipients = await assigneeRecipients(assignee);
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

/** Explicit start by template reference (key or id) — manual "start workflow" actions; no binding required. */
export async function startWorkflowByTemplate(params: { templateKey: string; context: ModuleWorkflowContext; actor: WorkflowActor }): Promise<WorkflowRow> {
  const { templateId, definition, versionId } = await resolveDefinitionByTemplateRef(params.templateKey);
  return instantiateWorkflow({ templateId, versionId, definition, bindingId: null, context: params.context, actor: params.actor });
}

// ── decide ───────────────────────────────────────────────────────────────────
function validateDecisionRequirements(step: WorkflowStepDefinition, decision: string, comment: string | undefined, attachmentIds: string[]): void {
  const r = step.decisionRules;
  if (decision === 'approved' && r.requireCommentOnApprove && !comment) throw new Error('Comment is required to approve this task.');
  if (decision === 'returned' && r.requireCommentOnReturn && !comment) throw new Error('Comment is required to return this task.');
  if (decision === 'rejected' && r.requireCommentOnReject && !comment) throw new Error('Comment is required to reject this task.');
  if (r.requireAttachment && attachmentIds.length === 0) throw new Error('An attachment is required for this decision.');
}

export async function decideTask(params: {
  workflowId: string; taskId: string; actor: WorkflowActor;
  decision: 'approved' | 'returned' | 'rejected'; comment?: string; attachmentIds?: string[];
}): Promise<WorkflowRow> {
  const wf = await getWorkflow(params.workflowId);
  const task = await getTask(params.taskId);
  if (task.workflow_id !== wf.id) throw new Error('Task does not belong to this workflow.');
  if (!['pending', 'open', 'in_progress'].includes(task.status)) throw new Error(`Task already ${task.status}.`);

  const definition = wf.template_snapshot;
  const step = definition.steps.find((s) => s.stepKey === task.step_key);
  if (!step) throw new Error('Workflow step definition not found.');
  validateDecisionRequirements(step, params.decision, params.comment, params.attachmentIds ?? []);

  await sb.from('workflow_tasks').update({
    status: params.decision, decision: params.decision, decision_comment: params.comment ?? null,
    completed_by: params.actor.id, completed_at: new Date().toISOString(), decided_at: new Date().toISOString(),
  }).eq('id', task.id);

  await sb.from('workflow_decisions').insert({
    workflow_id: wf.id, task_id: task.id, actor_id: params.actor.id, decision: params.decision,
    comment: params.comment ?? null, attachment_ids: params.attachmentIds ?? [], previous_status: task.status, new_status: params.decision,
  });
  await writeWorkflowAudit({ workflowId: wf.id, taskId: task.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: params.actor.id, action: `workflow.task.${params.decision}`, reason: params.comment ?? null });

  if (params.decision === 'returned') return returnWorkflow(wf, params.actor, params.comment ?? '');
  if (params.decision === 'rejected') return rejectWorkflow(wf, params.actor, params.comment ?? '');
  return advanceWorkflow(wf, task.step_key, params.actor);
}

async function advanceWorkflow(wf: WorkflowRow, completedStepKey: string, actor: WorkflowActor): Promise<WorkflowRow> {
  // Parallel: wait for siblings in the same step.
  const { data: pending } = await sb.from('workflow_tasks').select('id').eq('workflow_id', wf.id).eq('step_key', completedStepKey).in('status', ['pending', 'open', 'in_progress']);
  if ((pending?.length ?? 0) > 0) return wf;

  const { nextSteps, complete } = resolveNext(wf.template_snapshot, completedStepKey, 'approved', { workflow: wf, recordData: wf.source_snapshot });
  if (complete || nextSteps.length === 0) return completeWorkflow(wf, actor);

  const context = workflowToContext(wf);
  for (const step of nextSteps) await createTaskForStep(wf, step, context);
  const nextKey = nextSteps[0]!.stepKey;
  await sb.from('workflow_instances').update({ current_step_key: nextKey, status: 'in_progress' }).eq('id', wf.id);
  return { ...wf, current_step_key: nextKey, status: 'in_progress' };
}

async function completeWorkflow(wf: WorkflowRow, actor: WorkflowActor): Promise<WorkflowRow> {
  const completedAt = new Date().toISOString();
  await sb.from('workflow_instances').update({ status: 'completed', completed_at: completedAt, closed_at: completedAt }).eq('id', wf.id);
  await getWorkflowAdapter(wf.module_key, wf.workflow_type)?.onWorkflowCompleted({ workflowId: wf.id, sourceRecordId: wf.source_record_id, finalDecision: 'approved' });
  await runWorkflowHandoffs(wf, 'workflow.completed', actor.id);
  await writeWorkflowAudit({ workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: actor.id, action: 'workflow.completed', newState: { status: 'completed' } });
  emitWf('workflow.completed', wf, actor.id, {
    severity: 'success',
    explicitRecipients: ownerRecipients(wf),
    notification: { title: 'Workflow approved', body: `${wf.workflow_no ?? ''} — ${wf.source_record_ref ?? wf.source_record_id} was approved.`, actionRoute: moduleRoute(wf.module_key), type: 'workflow.completed' },
  });
  return { ...wf, status: 'completed' };
}

async function returnWorkflow(wf: WorkflowRow, actor: WorkflowActor, comment: string): Promise<WorkflowRow> {
  await sb.from('workflow_instances').update({ status: 'returned' }).eq('id', wf.id);
  await getWorkflowAdapter(wf.module_key, wf.workflow_type)?.onWorkflowReturned({ workflowId: wf.id, sourceRecordId: wf.source_record_id, comment });
  await writeWorkflowAudit({ workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: actor.id, action: 'workflow.returned', reason: comment });
  emitWf('workflow.returned', wf, actor.id, {
    severity: 'warning',
    explicitRecipients: ownerRecipients(wf),
    notification: { title: 'Workflow returned', body: `${wf.workflow_no ?? ''} — ${wf.source_record_ref ?? wf.source_record_id} was returned${comment ? `: ${comment}` : ''}.`, actionRoute: moduleRoute(wf.module_key), type: 'workflow.returned', actionRequired: true },
  });
  return { ...wf, status: 'returned' };
}

async function rejectWorkflow(wf: WorkflowRow, actor: WorkflowActor, comment: string): Promise<WorkflowRow> {
  const at = new Date().toISOString();
  await sb.from('workflow_instances').update({ status: 'rejected', completed_at: at, closed_at: at }).eq('id', wf.id);
  await getWorkflowAdapter(wf.module_key, wf.workflow_type)?.onWorkflowRejected({ workflowId: wf.id, sourceRecordId: wf.source_record_id, comment });
  await writeWorkflowAudit({ workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: actor.id, action: 'workflow.rejected', reason: comment });
  emitWf('workflow.rejected', wf, actor.id, {
    severity: 'warning',
    explicitRecipients: ownerRecipients(wf),
    notification: { title: 'Workflow rejected', body: `${wf.workflow_no ?? ''} — ${wf.source_record_ref ?? wf.source_record_id} was rejected${comment ? `: ${comment}` : ''}.`, actionRoute: moduleRoute(wf.module_key), type: 'workflow.rejected' },
  });
  return { ...wf, status: 'rejected' };
}

export async function cancelWorkflow(params: { workflowId: string; actor: WorkflowActor; reason: string }): Promise<WorkflowRow> {
  const wf = await getWorkflow(params.workflowId);
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
  const step = wf.template_snapshot.steps.find((s) => s.stepKey === task.step_key);
  if (!step?.decisionRules.canDelegate) throw new Error('This task cannot be delegated.');
  await sb.from('workflow_tasks').update({ status: 'delegated', delegated_to: params.delegateTo, assigned_to: params.delegateTo }).eq('id', task.id);
  await writeWorkflowAudit({ workflowId: wf.id, taskId: task.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: params.actor.id, action: 'workflow.task.delegated', reason: params.reason });
}

export async function reassignTask(params: { taskId: string; actor: WorkflowActor; reassignTo: string; reason: string }): Promise<void> {
  const task = await getTask(params.taskId);
  const wf = await getWorkflow(task.workflow_id);
  await sb.from('workflow_tasks').update({ status: 'reassigned', assigned_to: params.reassignTo }).eq('id', task.id);
  await writeWorkflowAudit({ workflowId: wf.id, taskId: task.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: params.actor.id, action: 'workflow.task.reassigned', reason: params.reason });
}

// ── handoffs ──────────────────────────────────────────────────────────────────
// Canonical cross-module delivery uses the shared handoff_outbox bus (createHandoff →
// module receivers). workflow_handoffs is kept only as an audit/projection row so a
// workflow's handoffs are queryable from the workflow. (No second delivery mechanism.)
async function runWorkflowHandoffs(wf: WorkflowRow, event: string, actorId: string): Promise<void> {
  const handoffs = (wf.template_snapshot.handoffs ?? []).filter((h) => h.event === event);
  for (const h of handoffs) {
    const res = await createHandoff({
      sourceModule:     wf.module_key,
      targetModule:     h.targetModule,
      sourceEntityType: wf.workflow_type,
      sourceEntityId:   wf.source_record_id,
      payload:          { ...wf.source_snapshot, action: h.action, mappedFields: h.fieldMap ?? {} },
      createdBy:        actorId,
    });
    await sb.from('workflow_handoffs').insert({
      workflow_id: wf.id, from_module: wf.module_key, to_module: h.targetModule,
      source_record_id: wf.source_record_id, trigger_event: event, action_key: h.action,
      status: res.ok ? 'completed' : 'failed', payload: wf.source_snapshot, mapped_fields: h.fieldMap ?? {},
    });
  }
}

function workflowToContext(wf: WorkflowRow): ModuleWorkflowContext {
  return {
    moduleKey: wf.module_key, workflowType: wf.workflow_type, triggerEvent: 'workflow.step.completed',
    sourceRecordId: wf.source_record_id, sourceRecordRef: wf.source_record_ref ?? undefined,
    siteId: wf.site_id, departmentId: wf.department_id, requestedBy: wf.requested_by ?? '', ownerId: wf.owner_id,
    priority: wf.priority as ModuleWorkflowContext['priority'], recordData: wf.source_snapshot,
  };
}
