/**
 * netlify/functions/lib/workflowEngine.ts
 *
 * Platform workflow engine — creates and advances workflow_instances.
 *
 * Workflow lifecycle:
 *   draft → submitted → triage → in_review → awaiting_evidence →
 *   awaiting_approval → [returned|approved|rejected] → closed
 *
 * All transitions emit app_events and write workflow_events. Final
 * approval triggers handoffs (via handoffBus) and notifications.
 *
 * NEVER throws — returns { ok, workflowId } on failure.
 */

import { sb }             from './db';
import { nextRef }        from './refGenerator';
import { emitAppEvent }   from './appEvents';
import { createHandoff }  from './handoffBus';

// Old definition step.type → spec workflow_tasks.step_type enum.
const STEP_TYPE: Record<string, string> = {
  review: 'review', approve: 'approval', verify: 'verification', evidence: 'verification', handoff: 'handoff',
};

export interface CreateWorkflowInput {
  templateKey: string;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  ownerUserId?: string | null;
  createdBy: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateWorkflowResult {
  ok: boolean;
  workflowId?: string;
  ref?: string;
  taskId?: string;
}

export async function createWorkflow(input: CreateWorkflowInput): Promise<CreateWorkflowResult> {
  try {
    // Load template
    const { data: tpl, error: tplErr } = await sb
      .from('workflow_templates')
      .select('id, definition')
      .eq('template_key', input.templateKey)
      .eq('is_active', true)
      .maybeSingle<{ id: string; definition: WorkflowDefinition }>();

    if (tplErr || !tpl) {
      console.error('[workflowEngine] template not found:', input.templateKey, tplErr?.message);
      return { ok: false };
    }

    const ref = await nextRef('WF');
    const firstStep = tpl.definition.steps?.[0];
    if (!firstStep) {
      console.error('[workflowEngine] template has no steps:', input.templateKey);
      return { ok: false };
    }

    // Create workflow instance
    const { data: wf, error: wfErr } = await sb
      .from('workflow_instances')
      .insert({
        workflow_no:        ref,
        template_id:        tpl.id,
        module_key:         input.sourceModule,
        workflow_type:      input.sourceEntityType,
        source_record_id:   input.sourceEntityId,
        status:             'submitted',
        priority:           input.priority ?? 'medium',
        current_step_key:   firstStep.key,
        owner_id:           input.ownerUserId ?? null,
        requested_by:       input.createdBy,
        started_at:         new Date().toISOString(),
        metadata:           input.metadata ?? {},
      })
      .select('id')
      .single<{ id: string }>();

    if (wfErr || !wf) {
      console.error('[workflowEngine] create instance failed:', wfErr?.message);
      return { ok: false };
    }

    const workflowId = wf.id;

    // Create first task
    const dueAt = firstStep.due_hours
      ? new Date(Date.now() + firstStep.due_hours * 3600_000).toISOString()
      : null;

    const { data: task, error: taskErr } = await sb
      .from('workflow_tasks')
      .insert({
        workflow_id:    workflowId,
        step_key:       firstStep.key,
        step_name:      firstStep.name,
        step_type:      STEP_TYPE[firstStep.type] ?? 'review',
        task_title:     firstStep.name,
        assigned_role:  firstStep.assigned_role ?? null,
        status:         'open',
        due_at:         dueAt,
      })
      .select('id')
      .single<{ id: string }>();

    if (taskErr) {
      console.warn('[workflowEngine] task insert failed:', taskErr.message);
    }

    // Workflow created event
    await emitAppEvent({
      eventType:        'workflow.created',
      sourceModule:     input.sourceModule,
      sourceEntityType: 'workflow',
      sourceEntityId:   ref,
      actorUserId:      input.createdBy,
      severity:         'info',
      payload:          { templateKey: input.templateKey, sourceEntityId: input.sourceEntityId, reason: input.reason },
    });

    // Task assigned event (separate — triggers notification to assignee role)
    if (task) {
      await emitAppEvent({
        eventType:        'workflow.task.assigned',
        sourceModule:     input.sourceModule,
        sourceEntityType: 'workflow_task',
        sourceEntityId:   ref,
        actorUserId:      input.createdBy,
        severity:         'info',
        payload:          { taskId: task.id, stepKey: firstStep.key, assignedRole: firstStep.assigned_role },
        notification: {
          title: `Action required: ${firstStep.name}`,
          body:  `${ref} — ${input.sourceEntityId} needs ${firstStep.name.toLowerCase()}.`,
          actionRoute: `${input.sourceModule}/workflows/${ref}`,
          type:  'workflow.task.assigned',
        },
      });
    }

    return { ok: true, workflowId, ref, taskId: task?.id };
  } catch (e) {
    console.error('[workflowEngine] createWorkflow failed:', e);
    return { ok: false };
  }
}

export interface DecideWorkflowTaskInput {
  taskId: string;
  actorUserId: string;
  decision: 'approved' | 'rejected' | 'returned' | 'verified' | 'completed';
  note?: string;
}

export interface DecideWorkflowTaskResult {
  ok: boolean;
  workflowId?: string;
  workflowStatus?: string;
}

export async function decideWorkflowTask(input: DecideWorkflowTaskInput): Promise<DecideWorkflowTaskResult> {
  try {
    // Load task + workflow in one query
    const { data: task, error: taskErr } = await sb
      .from('workflow_tasks')
      .select('id, workflow_id, step_key, step_type, assigned_role, assigned_to')
      .eq('id', input.taskId)
      .eq('status', 'open')
      .maybeSingle<WorkflowTask>();

    if (taskErr || !task) {
      console.error('[workflowEngine] task not found or not open:', input.taskId, taskErr?.message);
      return { ok: false };
    }

    const { data: wf, error: wfErr } = await sb
      .from('workflow_instances')
      .select('id, workflow_no, template_id, status, module_key, workflow_type, source_record_id, owner_id, current_step_key, metadata')
      .eq('id', task.workflow_id)
      .maybeSingle<WorkflowInstance>();

    if (wfErr || !wf) {
      console.error('[workflowEngine] workflow not found:', task.workflow_id, wfErr?.message);
      return { ok: false };
    }

    // Load template for next-step resolution
    const { data: tpl } = await sb
      .from('workflow_templates')
      .select('definition')
      .eq('id', wf.template_id)
      .maybeSingle<{ definition: WorkflowDefinition }>();

    const steps = tpl?.definition.steps ?? [];
    const currentIdx = steps.findIndex(s => s.key === task.step_key);
    const nextStep = steps[currentIdx + 1] ?? null;

    // Determine new workflow status
    let newStatus: string;
    let nextStepKey: string = wf.current_step_key;

    if (input.decision === 'rejected') {
      newStatus = 'rejected';
    } else if (input.decision === 'returned') {
      newStatus = 'returned';
    } else if (!nextStep) {
      // Last step complete → approved/closed
      newStatus = input.decision === 'approved' ? 'approved' : 'closed';
    } else {
      newStatus = 'in_review';
      nextStepKey = nextStep.key;
    }

    const now = new Date().toISOString();

    // Update task
    await sb.from('workflow_tasks').update({
      status:       'completed',
      completed_by: input.actorUserId,
      decision:     input.decision,
      decision_comment: input.note ?? null,
      decided_at:   now,
      completed_at: now,
    }).eq('id', input.taskId);

    // Update workflow instance
    await sb.from('workflow_instances').update({
      status:           newStatus,
      current_step_key: nextStepKey,
      updated_at:       now,
      closed_at:        ['approved','rejected','closed'].includes(newStatus) ? now : null,
    }).eq('id', wf.id);

    // Write workflow_events row
    await sb.from('workflow_events').insert({
      workflow_id:    wf.id,
      event_type:     input.decision,
      actor_user_id:  input.actorUserId,
      note:           input.note ?? null,
      payload:        { taskId: input.taskId, stepKey: task.step_key },
    });

    // If terminal approval, create next task OR trigger handoffs
    if (nextStep && ['in_review','awaiting_approval','awaiting_evidence'].includes(newStatus)) {
      const dueAt = nextStep.due_hours
        ? new Date(Date.now() + nextStep.due_hours * 3600_000).toISOString()
        : null;

      await sb.from('workflow_tasks').insert({
        workflow_id:   wf.id,
        step_key:      nextStep.key,
        step_name:     nextStep.name,
        step_type:     STEP_TYPE[nextStep.type] ?? 'review',
        task_title:    nextStep.name,
        assigned_role: nextStep.assigned_role ?? null,
        status:        'open',
        due_at:        dueAt,
      });

      await emitAppEvent({
        eventType:        'workflow.task.assigned',
        sourceModule:     wf.module_key,
        sourceEntityType: 'workflow_task',
        sourceEntityId:   wf.workflow_no,
        actorUserId:      input.actorUserId,
        severity:         'info',
        payload:          { stepKey: nextStep.key, assignedRole: nextStep.assigned_role },
        notification: {
          title: `Action required: ${nextStep.name}`,
          body:  `${wf.workflow_no} — ${wf.source_record_id} needs ${nextStep.name.toLowerCase()}.`,
          actionRoute: `${wf.module_key}/workflows/${wf.workflow_no}`,
          type:  'workflow.task.assigned',
        },
      });
    }

    // On approval: trigger cross-module handoffs defined in template
    if (newStatus === 'approved' && tpl?.definition.handoffs_on_approval) {
      for (const handoffType of tpl.definition.handoffs_on_approval) {
        await _triggerHandoffIfNeeded(handoffType, wf, input.actorUserId);
      }
    }

    // Emit terminal events
    if (['approved','rejected','returned'].includes(newStatus)) {
      await emitAppEvent({
        eventType:        `workflow.${newStatus}`,
        sourceModule:     wf.module_key,
        sourceEntityType: 'workflow',
        sourceEntityId:   wf.workflow_no,
        actorUserId:      input.actorUserId,
        severity:         newStatus === 'approved' ? 'success' : 'warning',
        payload:          { note: input.note, sourceEntityId: wf.source_record_id },
        explicitRecipients: wf.owner_id
          ? [{ userId: wf.owner_id, reason: 'owner' as const }]
          : [],
        notification: {
          title: `Workflow ${newStatus}: ${wf.workflow_no}`,
          body:  input.note ?? `${wf.source_record_id} has been ${newStatus}.`,
          actionRoute: `${wf.module_key}/workflows/${wf.workflow_no}`,
          type:  `workflow.${newStatus}`,
        },
      } as Parameters<typeof emitAppEvent>[0]);
    }

    return { ok: true, workflowId: wf.id, workflowStatus: newStatus };
  } catch (e) {
    console.error('[workflowEngine] decideWorkflowTask failed:', e);
    return { ok: false };
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function _triggerHandoffIfNeeded(
  handoffType: string,
  wf:          WorkflowInstance,
  actorUserId: string,
): Promise<void> {
  const meta = wf.metadata as Record<string, unknown>;

  if (handoffType === 'hr_injury_record' && meta.lostTime) {
    await createHandoff({
      sourceModule:      wf.module_key,
      targetModule:      'hr',
      sourceEntityType:  wf.workflow_type,
      sourceEntityId:    wf.source_record_id,
      payload:           { employeeId: meta.employeeId, incidentRef: wf.source_record_id, severity: meta.severity, lostDays: meta.lostDays },
      createdBy:         actorUserId,
    });
  }

  if (handoffType === 'finance_cost_claim' && meta.costImpact) {
    await createHandoff({
      sourceModule:      wf.module_key,
      targetModule:      'finance',
      sourceEntityType:  wf.workflow_type,
      sourceEntityId:    wf.source_record_id,
      payload:           { incidentRef: wf.source_record_id, estimatedCost: meta.estimatedCost, costCenter: meta.costCenter },
      createdBy:         actorUserId,
    });
  }

  if (handoffType === 'ops_equipment_damage' && meta.equipmentDamage) {
    await createHandoff({
      sourceModule:      wf.module_key,
      targetModule:      'operations',
      sourceEntityType:  wf.workflow_type,
      sourceEntityId:    wf.source_record_id,
      payload:           { incidentRef: wf.source_record_id, assetId: meta.assetId, description: meta.damageDescription },
      createdBy:         actorUserId,
    });
  }
}

// ── Local types ───────────────────────────────────────────────────────────────

interface WorkflowStep {
  key:           string;
  name:          string;
  type:          'review' | 'approve' | 'verify' | 'evidence' | 'handoff';
  assigned_role?: string;
  due_hours?:    number | null;
}

interface WorkflowDefinition {
  steps?: WorkflowStep[];
  handoffs_on_approval?: string[];
  overdue_escalation_hours?: number;
}

interface WorkflowTask {
  id:               string;
  workflow_id:      string;
  step_key:         string;
  step_type:        string;
  assigned_role:    string | null;
  assigned_to:      string | null;
}

interface WorkflowInstance {
  id:                 string;
  workflow_no:        string;
  template_id:        string;
  status:             string;
  module_key:         string;
  workflow_type:      string;
  source_record_id:   string;
  owner_id:           string | null;
  current_step_key:   string;
  metadata:           unknown;
}
