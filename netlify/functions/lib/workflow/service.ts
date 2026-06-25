// ============================================================================
// Central Workflow Engine — service (Spec §10-§16)
// ============================================================================
// startWorkflowForRecord / decideTask / advance / return / reject / complete /
// cancel / delegate / reassign + handoff + audit. Uses the spec columns but
// DUAL-WRITES the legacy NOT-NULL columns (ref/source_module/source_entity_*/
// current_step/created_by, tasks.task_type/assigned_user_id) so existing readers
// keep working until the final cutover drops them. Notifications are emitted as
// app_events (existing event_rules → notifications pipeline). Adapter callbacks
// are null-safe so the engine runs before per-module adapters exist.
// ============================================================================

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';
import type {
  ModuleWorkflowContext, WorkflowTemplateDefinition, WorkflowStepDefinition,
} from './definitionTypes';
import { selectWorkflowBinding, type WorkflowBindingRow } from './bindingResolver';
import { resolveStepAssignee } from './assigneeResolver';
import { validateWorkflowDefinition } from './validateDefinition';
import { firstSteps, resolveNext } from './transitions';
import { getWorkflowAdapter } from './adapterRegistry';

export interface WorkflowActor { id: string; role?: string }

const LEGACY_TASK_TYPE: Record<string, string> = {
  review: 'review', approval: 'approve', verification: 'verify', acknowledgement: 'review',
  assignment: 'review', handoff: 'handoff', automation: 'review', closeout: 'review',
};

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

function emitWf(eventType: string, wf: WorkflowRow, actorId: string, payload: Record<string, unknown> = {}): void {
  void emitAppEvent({
    eventType, sourceModule: 'workflow', sourceEntityType: 'workflow', sourceEntityId: wf.workflow_no ?? wf.id,
    actorUserId: actorId, severity: 'info', payload: { workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, ...payload },
  });
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

/** Resolve the definition for a binding: version → published version → legacy template.definition. */
async function resolveDefinition(binding: WorkflowBindingRow): Promise<{ definition: WorkflowTemplateDefinition; versionId: string | null }> {
  if (binding.template_version_id) {
    const { data } = await sb.from('workflow_template_versions').select('id, definition').eq('id', binding.template_version_id).maybeSingle<{ id: string; definition: WorkflowTemplateDefinition }>();
    if (data) return { definition: data.definition, versionId: data.id };
  }
  const { data: ver } = await sb.from('workflow_template_versions').select('id, definition')
    .eq('template_id', binding.template_id).eq('version_status', 'published').order('version_no', { ascending: false }).limit(1).maybeSingle<{ id: string; definition: WorkflowTemplateDefinition }>();
  if (ver) return { definition: ver.definition, versionId: ver.id };
  const { data: tpl } = await sb.from('workflow_templates').select('definition').eq('id', binding.template_id).maybeSingle<{ definition: WorkflowTemplateDefinition }>();
  if (tpl?.definition && Array.isArray((tpl.definition as WorkflowTemplateDefinition).steps)) return { definition: tpl.definition, versionId: null };
  throw new Error('Workflow template has no published version or definition.');
}

async function createTaskForStep(wf: WorkflowRow, step: WorkflowStepDefinition, context: ModuleWorkflowContext): Promise<void> {
  const assignee = resolveStepAssignee(step, context);
  const dueAt = addHoursIso(step.dueDurationHours);
  await sb.from('workflow_tasks').insert({
    workflow_id: wf.id,
    step_key: step.stepKey, step_name: step.stepName, step_type: step.stepType, task_title: step.stepName,
    task_type: LEGACY_TASK_TYPE[step.stepType] ?? 'review',                 // legacy NOT-NULL
    assigned_to: assignee.userId ?? null, assigned_user_id: assignee.userId ?? null, assigned_role: assignee.roleKey ?? null,
    status: 'pending', due_at: dueAt, is_required: step.required,
    metadata: { assignmentType: step.assignment.type },
  });
  emitWf('workflow.task.assigned', wf, wf.requested_by ?? '', { stepKey: step.stepKey, assignedRole: assignee.roleKey, assignedTo: assignee.userId });
}

// ── start ────────────────────────────────────────────────────────────────────
export async function startWorkflowForRecord(params: { context: ModuleWorkflowContext; actor: WorkflowActor }): Promise<WorkflowRow | null> {
  const { context, actor } = params;
  const binding = await selectWorkflowBinding(sb, context);
  if (!binding) return null;                                                // no binding → module proceeds without a workflow

  const { definition, versionId } = await resolveDefinition(binding);
  validateWorkflowDefinition(definition);

  const workflowNo = await nextRef('WF');
  const starts = firstSteps(definition);
  const firstKey = starts[0]?.stepKey ?? null;

  const { data: instance, error } = await sb.from('workflow_instances').insert({
    workflow_no: workflowNo, template_id: binding.template_id, template_version_id: versionId,
    module_key: context.moduleKey, workflow_type: context.workflowType,
    source_record_id: context.sourceRecordId, source_record_ref: context.sourceRecordRef ?? null,
    status: 'in_progress', current_step_key: firstKey, priority: normalizePriority(context.priority),
    site_id: context.siteId ?? null, department_id: context.departmentId ?? null,
    requested_by: context.requestedBy, owner_id: context.ownerId ?? null,
    started_at: new Date().toISOString(),
    template_snapshot: definition, source_snapshot: context.recordData,
    metadata: { bindingId: binding.id, triggerEvent: context.triggerEvent },
    // legacy NOT-NULL columns (dropped at cutover)
    ref: workflowNo, source_module: context.moduleKey, source_entity_type: context.workflowType,
    source_entity_id: context.sourceRecordId, current_step: firstKey ?? 'submitted', created_by: context.requestedBy,
  }).select('*').single<WorkflowRow>();
  if (error || !instance) throw new Error(`Failed to start workflow: ${error?.message}`);

  for (const step of starts) await createTaskForStep(instance, step, context);

  await writeWorkflowAudit({ workflowId: instance.id, moduleKey: instance.module_key, sourceRecordId: instance.source_record_id, actorId: actor.id, action: 'workflow.started', newState: { status: instance.status } });
  emitWf('workflow.started', instance, actor.id);
  await getWorkflowAdapter(context.moduleKey)?.onWorkflowStarted({ workflowId: instance.id, sourceRecordId: context.sourceRecordId });
  return instance;
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
    decision_note: params.comment ?? null, completed_by: params.actor.id, completed_at: new Date().toISOString(), decided_at: new Date().toISOString(),
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
  await sb.from('workflow_instances').update({ current_step_key: nextKey, current_step: nextKey, status: 'in_progress' }).eq('id', wf.id);
  return { ...wf, current_step_key: nextKey, status: 'in_progress' };
}

async function completeWorkflow(wf: WorkflowRow, actor: WorkflowActor): Promise<WorkflowRow> {
  const completedAt = new Date().toISOString();
  await sb.from('workflow_instances').update({ status: 'completed', completed_at: completedAt, closed_at: completedAt }).eq('id', wf.id);
  await getWorkflowAdapter(wf.module_key)?.onWorkflowCompleted({ workflowId: wf.id, sourceRecordId: wf.source_record_id, finalDecision: 'approved' });
  await runWorkflowHandoffs(wf, 'workflow.completed');
  await writeWorkflowAudit({ workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: actor.id, action: 'workflow.completed', newState: { status: 'completed' } });
  emitWf('workflow.completed', wf, actor.id);
  return { ...wf, status: 'completed' };
}

async function returnWorkflow(wf: WorkflowRow, actor: WorkflowActor, comment: string): Promise<WorkflowRow> {
  await sb.from('workflow_instances').update({ status: 'returned' }).eq('id', wf.id);
  await getWorkflowAdapter(wf.module_key)?.onWorkflowReturned({ workflowId: wf.id, sourceRecordId: wf.source_record_id, comment });
  await writeWorkflowAudit({ workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: actor.id, action: 'workflow.returned', reason: comment });
  emitWf('workflow.returned', wf, actor.id);
  return { ...wf, status: 'returned' };
}

async function rejectWorkflow(wf: WorkflowRow, actor: WorkflowActor, comment: string): Promise<WorkflowRow> {
  const at = new Date().toISOString();
  await sb.from('workflow_instances').update({ status: 'rejected', completed_at: at, closed_at: at }).eq('id', wf.id);
  await getWorkflowAdapter(wf.module_key)?.onWorkflowRejected({ workflowId: wf.id, sourceRecordId: wf.source_record_id, comment });
  await writeWorkflowAudit({ workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: actor.id, action: 'workflow.rejected', reason: comment });
  emitWf('workflow.rejected', wf, actor.id);
  return { ...wf, status: 'rejected' };
}

export async function cancelWorkflow(params: { workflowId: string; actor: WorkflowActor; reason: string }): Promise<WorkflowRow> {
  const wf = await getWorkflow(params.workflowId);
  const at = new Date().toISOString();
  await sb.from('workflow_instances').update({ status: 'cancelled', cancelled_at: at, closed_at: at }).eq('id', wf.id);
  await sb.from('workflow_tasks').update({ status: 'cancelled' }).eq('workflow_id', wf.id).in('status', ['pending', 'open', 'in_progress']);
  await getWorkflowAdapter(wf.module_key)?.onWorkflowCancelled({ workflowId: wf.id, sourceRecordId: wf.source_record_id, reason: params.reason });
  await writeWorkflowAudit({ workflowId: wf.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: params.actor.id, action: 'workflow.cancelled', reason: params.reason });
  emitWf('workflow.cancelled', wf, params.actor.id);
  return { ...wf, status: 'cancelled' };
}

// ── delegate / reassign ──────────────────────────────────────────────────────
export async function delegateTask(params: { taskId: string; actor: WorkflowActor; delegateTo: string; reason: string }): Promise<void> {
  const task = await getTask(params.taskId);
  const wf = await getWorkflow(task.workflow_id);
  const step = wf.template_snapshot.steps.find((s) => s.stepKey === task.step_key);
  if (!step?.decisionRules.canDelegate) throw new Error('This task cannot be delegated.');
  await sb.from('workflow_tasks').update({ status: 'delegated', delegated_to: params.delegateTo, assigned_to: params.delegateTo, assigned_user_id: params.delegateTo }).eq('id', task.id);
  await writeWorkflowAudit({ workflowId: wf.id, taskId: task.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: params.actor.id, action: 'workflow.task.delegated', reason: params.reason });
}

export async function reassignTask(params: { taskId: string; actor: WorkflowActor; reassignTo: string; reason: string }): Promise<void> {
  const task = await getTask(params.taskId);
  const wf = await getWorkflow(task.workflow_id);
  await sb.from('workflow_tasks').update({ status: 'reassigned', assigned_to: params.reassignTo, assigned_user_id: params.reassignTo }).eq('id', task.id);
  await writeWorkflowAudit({ workflowId: wf.id, taskId: task.id, moduleKey: wf.module_key, sourceRecordId: wf.source_record_id, actorId: params.actor.id, action: 'workflow.task.reassigned', reason: params.reason });
}

// ── handoffs (records the cross-module action; execution via adapters/intake) ──
async function runWorkflowHandoffs(wf: WorkflowRow, event: string): Promise<void> {
  const handoffs = (wf.template_snapshot.handoffs ?? []).filter((h) => h.event === event);
  for (const h of handoffs) {
    await sb.from('workflow_handoffs').insert({
      workflow_id: wf.id, from_module: wf.module_key, to_module: h.targetModule,
      source_record_id: wf.source_record_id, trigger_event: event, action_key: h.action,
      status: 'pending', payload: wf.source_snapshot, mapped_fields: h.fieldMap ?? {},
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
