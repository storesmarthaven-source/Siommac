// lib/hr/onboardingCustomActions.ts — Custom Onboarding Actions (Phase 5).
//
// Package-level reusable action TEMPLATES + per-case one-off ACTIONS, each
// instantiated into the NORMAL onboarding lifecycle — never a disconnected system:
//   custom_task / checklist / external → hr_onboarding_tasks
//   custom_handoff                     → hr_onboarding_handoffs
//   custom_document_request            → task + PENDING handoff (no doc receiver yet)
//   custom_training_request            → task + PENDING handoff (training not built)
//   custom_approval                    → central workflow (startWorkflowByTemplate)
//   custom_notification                → app_event + notification (emitAppEvent)
// A hr_onboarding_case_actions row links each action to the real record it created.
// Backend-only (service-role). writeHrAudit throws on failure (no swallow).

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { recomputeCaseStatus } from './onboardingMutations';
import { startWorkflowByTemplate } from '../workflow/service';
import type {
  OnboardingActionTemplate, OnboardingActionType, OnboardingOwnerType, OnboardingActionPriority,
  OnboardingCaseAction, OnboardingCaseActionStatus,
} from '../../../../types/hrOnboarding';

const err = (status: number, message: string): Error => Object.assign(new Error(message), { status });
const nowISO = (): string => new Date().toISOString();
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
const TERMINAL = ['completed', 'cancelled'];

interface CaseRow { id: string; status: string; case_no: string; employee_id: string | null; owner_id: string | null }
async function loadCase(caseId: string): Promise<CaseRow> {
  const { data } = await sb.from('hr_onboarding_cases').select('id, status, case_no, employee_id, owner_id').eq('id', caseId).maybeSingle<CaseRow>();
  if (!data) throw err(404, 'Onboarding case not found.');
  return data;
}

// ── template DB row ⇄ DTO ─────────────────────────────────────────────────────--
interface TemplateDB {
  id: string; package_id: string; action_name: string; action_type: string; description: string | null; instructions: string | null;
  owner_type: string; owner_role: string | null; owner_employee_id: string | null; owner_department_id: string | null;
  due_offset_days: number | null; priority: string; is_required: boolean; is_active: boolean; blocks_onboarding: boolean; requires_evidence: boolean;
  document_type_id: string | null; training_requirement_id: string | null; workflow_template_id: string | null; notification_template_id: string | null;
  external_system_key: string | null; external_action_url: string | null; display_order: number;
}
const TEMPLATE_COLS = 'id, package_id, action_name, action_type, description, instructions, owner_type, owner_role, owner_employee_id, owner_department_id, due_offset_days, priority, is_required, is_active, blocks_onboarding, requires_evidence, document_type_id, training_requirement_id, workflow_template_id, notification_template_id, external_system_key, external_action_url, display_order';

function toTemplateDTO(t: TemplateDB, packageKey: string): OnboardingActionTemplate {
  return {
    id: t.id, packageKey, actionName: t.action_name, actionType: t.action_type as OnboardingActionType,
    description: t.description ?? null, instructions: t.instructions ?? null,
    ownerType: t.owner_type as OnboardingOwnerType, ownerRole: t.owner_role ?? null, ownerEmployeeId: t.owner_employee_id ?? null, ownerDepartmentId: t.owner_department_id ?? null,
    dueOffsetDays: t.due_offset_days ?? null, priority: t.priority as OnboardingActionPriority,
    isRequired: t.is_required, isActive: t.is_active, blocksOnboarding: t.blocks_onboarding, requiresEvidence: t.requires_evidence,
    documentTypeId: t.document_type_id ?? null, trainingRequirementId: t.training_requirement_id ?? null,
    workflowTemplateId: t.workflow_template_id ?? null, notificationTemplateId: t.notification_template_id ?? null,
    externalSystemKey: t.external_system_key ?? null, externalActionUrl: t.external_action_url ?? null, displayOrder: t.display_order,
  };
}

// ── the resolved spec the dispatcher acts on (from a template or a one-off) ──────
interface ActionSpec {
  actionName: string; actionType: OnboardingActionType; description: string | null; instructions: string | null;
  ownerType: OnboardingOwnerType; ownerRole: string | null; ownerEmployeeId: string | null;
  dueAt: string | null; priority: OnboardingActionPriority; blocksOnboarding: boolean; requiresEvidence: boolean;
  documentTypeId: string | null; trainingRequirementId: string | null; workflowTemplateId: string | null; notificationTemplateId: string | null;
  externalSystemKey: string | null; externalActionUrl: string | null;
}

const addDays = (days: number): string => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString(); };

function specFromTemplate(t: OnboardingActionTemplate): ActionSpec {
  return {
    actionName: t.actionName, actionType: t.actionType, description: t.description, instructions: t.instructions,
    ownerType: t.ownerType, ownerRole: t.ownerRole, ownerEmployeeId: t.ownerEmployeeId,
    dueAt: t.dueOffsetDays != null ? addDays(t.dueOffsetDays) : null, priority: t.priority, blocksOnboarding: t.blocksOnboarding, requiresEvidence: t.requiresEvidence,
    documentTypeId: t.documentTypeId, trainingRequirementId: t.trainingRequirementId, workflowTemplateId: t.workflowTemplateId, notificationTemplateId: t.notificationTemplateId,
    externalSystemKey: t.externalSystemKey, externalActionUrl: t.externalActionUrl,
  };
}

interface InstantiateResult { linkedTaskId: string | null; linkedHandoffId: string | null; linkedWorkflowInstanceId: string | null; status: OnboardingCaseActionStatus }

/** Materialise one action into the normal lifecycle. THROWS on a missing prerequisite. */
async function instantiate(actorId: string, kase: CaseRow, spec: ActionSpec): Promise<InstantiateResult> {
  const assignee = spec.ownerEmployeeId ?? (spec.ownerRole === 'hr' ? kase.owner_id : null);
  const key = slug(spec.actionName) || 'custom_action';

  const createTask = async (moduleKey: string | null, meta: Record<string, unknown>): Promise<string> => {
    const { data, error } = await sb.from('hr_onboarding_tasks').insert({
      case_id: kase.id, task_key: key, task_title: spec.actionName, owner_role: spec.ownerRole ?? null, module_key: moduleKey,
      assigned_to: assignee, status: 'pending', due_at: spec.dueAt, is_blocking: spec.blocksOnboarding, requires_evidence: spec.requiresEvidence, priority: spec.priority,
      metadata: { custom_action: true, action_type: spec.actionType, instructions: spec.instructions ?? null, ...meta },
    }).select('id').single<{ id: string }>();
    if (error) throw err(500, error.message);
    return data.id;
  };
  const createHandoff = async (targetModule: string, handoffType: string, payload: Record<string, unknown>): Promise<string> => {
    const { data, error } = await sb.from('hr_onboarding_handoffs').insert({
      case_id: kase.id, handoff_key: key, target_module: targetModule, handoff_type: handoffType, status: 'pending',
      payload: { custom_action: true, actionName: spec.actionName, caseNo: kase.case_no, ...payload },
    }).select('id').single<{ id: string }>();
    if (error) throw err(500, error.message);
    return data.id;
  };

  switch (spec.actionType) {
    case 'custom_task':
    case 'custom_checklist_item':
    case 'custom_external_action': {
      const taskId = await createTask(null, spec.actionType === 'custom_external_action'
        ? { external_system_key: spec.externalSystemKey, external_action_url: spec.externalActionUrl, manual_completion: true }
        : { checklist: spec.actionType === 'custom_checklist_item' });
      return { linkedTaskId: taskId, linkedHandoffId: null, linkedWorkflowInstanceId: null, status: 'open' };
    }
    case 'custom_handoff': {
      const target = spec.ownerRole || spec.externalSystemKey || 'hr';
      const handoffId = await createHandoff(target, `custom_${key}`, { instructions: spec.instructions ?? null });
      return { linkedTaskId: null, linkedHandoffId: handoffId, linkedWorkflowInstanceId: null, status: 'open' };
    }
    case 'custom_document_request': {
      const taskId = await createTask('documents', { document_type_id: spec.documentTypeId ?? null });
      const handoffId = await createHandoff('documents', 'onboarding_document_request', { documentTypeId: spec.documentTypeId ?? null });
      return { linkedTaskId: taskId, linkedHandoffId: handoffId, linkedWorkflowInstanceId: null, status: 'open' };
    }
    case 'custom_training_request': {
      const taskId = await createTask('training', { training_requirement_id: spec.trainingRequirementId ?? null });
      const handoffId = await createHandoff('training', 'onboarding_training_request', { trainingRequirementId: spec.trainingRequirementId ?? null });
      return { linkedTaskId: taskId, linkedHandoffId: handoffId, linkedWorkflowInstanceId: null, status: 'open' };
    }
    case 'custom_approval': {
      if (!spec.workflowTemplateId) throw err(400, 'A workflow template is required for a custom approval action.');
      const wf = await startWorkflowByTemplate({
        templateKey: spec.workflowTemplateId,
        idempotencyKey: crypto.randomUUID(),
        context: {
          moduleKey: 'hr_onboarding', workflowType: 'onboarding_custom_approval', triggerEvent: 'onboarding.custom_action.approval',
          sourceRecordId: kase.id, sourceRecordRef: kase.case_no, requestedBy: actorId, ownerId: assignee, priority: spec.priority,
          recordData: { caseId: kase.id, caseNo: kase.case_no, employeeId: kase.employee_id, actionName: spec.actionName },
        },
        actor: { id: actorId },
      });
      return { linkedTaskId: null, linkedHandoffId: null, linkedWorkflowInstanceId: wf.id, status: 'in_progress' };
    }
    case 'custom_notification': {
      const recipient = assignee ?? kase.owner_id;
      await emitAppEvent({
        eventType: 'onboarding.custom_action.notification', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id,
        actorUserId: actorId, severity: 'info', payload: { actionName: spec.actionName, caseNo: kase.case_no },
        explicitRecipients: recipient ? [{ userId: recipient, reason: 'assignee' }] : [],
        notification: { title: spec.actionName, body: spec.instructions ?? spec.description ?? undefined, actionRoute: `hr/onboarding/${kase.id}`, type: 'onboarding_custom_notification' },
      });
      return { linkedTaskId: null, linkedHandoffId: null, linkedWorkflowInstanceId: null, status: 'completed' };
    }
    default:
      throw err(400, `Unsupported custom action type: ${spec.actionType as string}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// Template CRUD
// ════════════════════════════════════════════════════════════════════════════════
async function packageIdByKey(packageKey: string): Promise<string> {
  const { data } = await sb.from('hr_onboarding_packages').select('id').eq('package_key', packageKey).maybeSingle<{ id: string }>();
  if (!data) throw err(404, 'Onboarding package not found.');
  return data.id;
}

export async function listActionTemplates(packageKey: string, includeInactive = false): Promise<OnboardingActionTemplate[]> {
  const pkgId = await packageIdByKey(packageKey);
  let q = sb.from('hr_onboarding_action_templates').select(TEMPLATE_COLS).eq('package_id', pkgId).order('display_order');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data } = await q;
  return ((data ?? []) as TemplateDB[]).map(t => toTemplateDTO(t, packageKey));
}

export interface ActionTemplateInput {
  packageKey: string; actionName: string; actionType: OnboardingActionType; description?: string | null; instructions?: string | null;
  ownerType?: OnboardingOwnerType; ownerRole?: string | null; ownerEmployeeId?: string | null; ownerDepartmentId?: string | null;
  dueOffsetDays?: number | null; priority?: OnboardingActionPriority; isRequired?: boolean; blocksOnboarding?: boolean; requiresEvidence?: boolean;
  documentTypeId?: string | null; trainingRequirementId?: string | null; workflowTemplateId?: string | null; notificationTemplateId?: string | null;
  externalSystemKey?: string | null; externalActionUrl?: string | null; displayOrder?: number;
}
export async function createActionTemplate(actorId: string, a: ActionTemplateInput): Promise<{ templateId: string }> {
  const pkgId = await packageIdByKey(a.packageKey);
  if (a.actionType === 'custom_approval' && !a.workflowTemplateId) throw err(400, 'A custom approval template needs a workflow template.');
  const { data, error } = await sb.from('hr_onboarding_action_templates').insert({
    package_id: pkgId, action_name: a.actionName, action_type: a.actionType, description: a.description ?? null, instructions: a.instructions ?? null,
    owner_type: a.ownerType ?? 'role', owner_role: a.ownerRole ?? null, owner_employee_id: a.ownerEmployeeId ?? null, owner_department_id: a.ownerDepartmentId ?? null,
    due_offset_days: a.dueOffsetDays ?? null, priority: a.priority ?? 'normal', is_required: a.isRequired ?? true, blocks_onboarding: a.blocksOnboarding ?? false, requires_evidence: a.requiresEvidence ?? false,
    document_type_id: a.documentTypeId ?? null, training_requirement_id: a.trainingRequirementId ?? null, workflow_template_id: a.workflowTemplateId ?? null, notification_template_id: a.notificationTemplateId ?? null,
    external_system_key: a.externalSystemKey ?? null, external_action_url: a.externalActionUrl ?? null, display_order: a.displayOrder ?? 100, created_by: actorId,
  }).select('id').single<{ id: string }>();
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.custom_action_template.created', sourceModule: 'hr', sourceEntityType: 'onboarding_package', sourceEntityId: pkgId, actorUserId: actorId, severity: 'info', payload: { actionName: a.actionName, actionType: a.actionType, packageKey: a.packageKey } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: pkgId, actorId, action: 'hr.onboarding.custom_action_template_created', newState: { actionName: a.actionName, actionType: a.actionType, packageKey: a.packageKey } });
  return { templateId: data.id };
}

export async function updateActionTemplate(actorId: string, a: Partial<ActionTemplateInput> & { id: string }): Promise<{ templateId: string }> {
  const patch: Record<string, unknown> = { updated_by: actorId, updated_at: nowISO() };
  const set = (k: string, v: unknown) => { if (v !== undefined) patch[k] = v; };
  set('action_name', a.actionName); set('action_type', a.actionType); set('description', a.description); set('instructions', a.instructions);
  set('owner_type', a.ownerType); set('owner_role', a.ownerRole); set('owner_employee_id', a.ownerEmployeeId); set('owner_department_id', a.ownerDepartmentId);
  set('due_offset_days', a.dueOffsetDays); set('priority', a.priority); set('is_required', a.isRequired); set('blocks_onboarding', a.blocksOnboarding); set('requires_evidence', a.requiresEvidence);
  set('document_type_id', a.documentTypeId); set('training_requirement_id', a.trainingRequirementId); set('workflow_template_id', a.workflowTemplateId); set('notification_template_id', a.notificationTemplateId);
  set('external_system_key', a.externalSystemKey); set('external_action_url', a.externalActionUrl); set('display_order', a.displayOrder);
  const { error } = await sb.from('hr_onboarding_action_templates').update(patch).eq('id', a.id);
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.custom_action_template.updated', sourceModule: 'hr', sourceEntityType: 'onboarding_action_template', sourceEntityId: a.id, actorUserId: actorId, severity: 'info', payload: { templateId: a.id } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: a.id, actorId, action: 'hr.onboarding.custom_action_template_updated', newState: patch });
  return { templateId: a.id };
}

export async function retireActionTemplate(actorId: string, a: { id: string }): Promise<{ templateId: string }> {
  const { error } = await sb.from('hr_onboarding_action_templates').update({ is_active: false, retired_by: actorId, retired_at: nowISO() }).eq('id', a.id);
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.custom_action_template.retired', sourceModule: 'hr', sourceEntityType: 'onboarding_action_template', sourceEntityId: a.id, actorUserId: actorId, severity: 'info', payload: { templateId: a.id } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: a.id, actorId, action: 'hr.onboarding.custom_action_template_retired', newState: { templateId: a.id } });
  return { templateId: a.id };
}

// ════════════════════════════════════════════════════════════════════════════════
// Case actions
// ════════════════════════════════════════════════════════════════════════════════
export async function listCaseActions(caseId: string): Promise<OnboardingCaseAction[]> {
  const { data } = await sb.from('hr_onboarding_case_actions')
    .select('id, case_id, source_template_id, action_name, action_type, status, linked_task_id, linked_handoff_id, linked_workflow_instance_id, added_by, added_at, completed_at')
    .eq('case_id', caseId).order('added_at', { ascending: false });
  const rows = (data ?? []) as { id: string; case_id: string; source_template_id: string | null; action_name: string; action_type: string; status: string; linked_task_id: string | null; linked_handoff_id: string | null; linked_workflow_instance_id: string | null; added_by: string | null; added_at: string; completed_at: string | null }[];
  const ids = [...new Set(rows.map(r => r.added_by).filter((x): x is string => !!x))];
  const names: Record<string, string | null> = ids.length
    ? Object.fromEntries((((await sb.from('app_users').select('id, full_name').in('id', ids)).data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name]))
    : {};
  return rows.map(r => ({
    id: r.id, caseId: r.case_id, sourceTemplateId: r.source_template_id ?? null, actionName: r.action_name, actionType: r.action_type as OnboardingActionType,
    status: r.status as OnboardingCaseActionStatus, linkedTaskId: r.linked_task_id ?? null, linkedHandoffId: r.linked_handoff_id ?? null, linkedWorkflowInstanceId: r.linked_workflow_instance_id ?? null,
    addedBy: r.added_by ?? null, addedByName: r.added_by ? names[r.added_by] ?? null : null, addedAt: r.added_at, completedAt: r.completed_at ?? null,
  }));
}

export interface AddCaseActionInput {
  caseId: string; sourceTemplateId?: string | null;
  actionName?: string; actionType?: OnboardingActionType; description?: string | null; instructions?: string | null;
  ownerType?: OnboardingOwnerType; ownerRole?: string | null; ownerEmployeeId?: string | null;
  dueDate?: string | null; priority?: OnboardingActionPriority; blocksOnboarding?: boolean; requiresEvidence?: boolean;
  documentTypeId?: string | null; trainingRequirementId?: string | null; workflowTemplateId?: string | null; notificationTemplateId?: string | null;
  externalSystemKey?: string | null; externalActionUrl?: string | null;
}

export async function addCaseAction(actorId: string, a: AddCaseActionInput): Promise<{ caseActionId: string; actionType: OnboardingActionType; status: OnboardingCaseActionStatus; linkedTaskId: string | null; linkedHandoffId: string | null; linkedWorkflowInstanceId: string | null }> {
  const kase = await loadCase(a.caseId);
  if (TERMINAL.includes(kase.status)) throw err(400, `Case already ${kase.status}.`);

  let spec: ActionSpec;
  if (a.sourceTemplateId) {
    const { data: tpl } = await sb.from('hr_onboarding_action_templates').select(TEMPLATE_COLS).eq('id', a.sourceTemplateId).maybeSingle<TemplateDB>();
    if (!tpl) throw err(404, 'Custom action template not found.');
    spec = specFromTemplate(toTemplateDTO(tpl, ''));
    if (a.dueDate !== undefined) spec.dueAt = a.dueDate;          // allow per-case due override
  } else {
    if (!a.actionName || !a.actionType) throw err(400, 'actionName and actionType are required for a one-off custom action.');
    spec = {
      actionName: a.actionName, actionType: a.actionType, description: a.description ?? null, instructions: a.instructions ?? null,
      ownerType: a.ownerType ?? 'role', ownerRole: a.ownerRole ?? null, ownerEmployeeId: a.ownerEmployeeId ?? null,
      dueAt: a.dueDate ?? null, priority: a.priority ?? 'normal', blocksOnboarding: a.blocksOnboarding ?? false, requiresEvidence: a.requiresEvidence ?? false,
      documentTypeId: a.documentTypeId ?? null, trainingRequirementId: a.trainingRequirementId ?? null, workflowTemplateId: a.workflowTemplateId ?? null, notificationTemplateId: a.notificationTemplateId ?? null,
      externalSystemKey: a.externalSystemKey ?? null, externalActionUrl: a.externalActionUrl ?? null,
    };
  }

  const r = await instantiate(actorId, kase, spec);

  const { data: ca, error } = await sb.from('hr_onboarding_case_actions').insert({
    case_id: kase.id, source_template_id: a.sourceTemplateId ?? null, action_name: spec.actionName, action_type: spec.actionType, status: r.status,
    linked_task_id: r.linkedTaskId, linked_handoff_id: r.linkedHandoffId, linked_workflow_instance_id: r.linkedWorkflowInstanceId,
    added_by: actorId, metadata: { instructions: spec.instructions ?? null, blocksOnboarding: spec.blocksOnboarding },
    completed_by: r.status === 'completed' ? actorId : null, completed_at: r.status === 'completed' ? nowISO() : null,
  }).select('id').single<{ id: string }>();
  if (error) throw err(500, error.message);

  if (spec.blocksOnboarding && r.linkedTaskId) await recomputeCaseStatus(kase.id);

  void emitAppEvent({ eventType: 'onboarding.custom_action.added_to_case', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { actionName: spec.actionName, actionType: spec.actionType } });
  void emitAppEvent({ eventType: 'onboarding.custom_action.instantiated', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { actionName: spec.actionName, actionType: spec.actionType, linkedTaskId: r.linkedTaskId, linkedHandoffId: r.linkedHandoffId, linkedWorkflowInstanceId: r.linkedWorkflowInstanceId } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.custom_action_added', newState: { actionName: spec.actionName, actionType: spec.actionType } });

  return { caseActionId: ca.id, actionType: spec.actionType, status: r.status, linkedTaskId: r.linkedTaskId, linkedHandoffId: r.linkedHandoffId, linkedWorkflowInstanceId: r.linkedWorkflowInstanceId };
}

interface CaseActionRow { id: string; case_id: string; action_name: string; status: string; linked_task_id: string | null; linked_handoff_id: string | null }
async function loadCaseAction(id: string): Promise<CaseActionRow> {
  const { data } = await sb.from('hr_onboarding_case_actions').select('id, case_id, action_name, status, linked_task_id, linked_handoff_id').eq('id', id).maybeSingle<CaseActionRow>();
  if (!data) throw err(404, 'Custom action not found.');
  return data;
}

export async function updateCaseAction(actorId: string, a: { id: string; status?: OnboardingCaseActionStatus }): Promise<{ id: string; status: string }> {
  const ca = await loadCaseAction(a.id);
  const status = a.status ?? ca.status;
  const { error } = await sb.from('hr_onboarding_case_actions').update({ status }).eq('id', ca.id);
  if (error) throw err(500, error.message);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: ca.case_id, actorId, action: 'hr.onboarding.custom_action_updated', newState: { id: ca.id, status } });
  return { id: ca.id, status };
}

export async function completeCaseAction(actorId: string, a: { id: string }): Promise<{ id: string; status: string }> {
  const ca = await loadCaseAction(a.id);
  if (['completed', 'cancelled'].includes(ca.status)) throw err(400, `Action already ${ca.status}.`);
  const { error } = await sb.from('hr_onboarding_case_actions').update({ status: 'completed', completed_by: actorId, completed_at: nowISO() }).eq('id', ca.id);
  if (error) throw err(500, error.message);
  // Close the linked task so case progress reflects it.
  if (ca.linked_task_id) await sb.from('hr_onboarding_tasks').update({ status: 'completed', completed_by: actorId, completed_at: nowISO() }).eq('id', ca.linked_task_id).not('status', 'in', '("completed","skipped","cancelled")');
  void emitAppEvent({ eventType: 'onboarding.custom_action.completed', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: ca.case_id, actorUserId: actorId, severity: 'info', payload: { actionName: ca.action_name } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: ca.case_id, actorId, action: 'hr.onboarding.custom_action_completed', newState: { id: ca.id, actionName: ca.action_name } });
  await recomputeCaseStatus(ca.case_id);
  return { id: ca.id, status: 'completed' };
}

export async function cancelCaseAction(actorId: string, a: { id: string; reason?: string | null }): Promise<{ id: string; status: string }> {
  const ca = await loadCaseAction(a.id);
  if (['completed', 'cancelled'].includes(ca.status)) throw err(400, `Action already ${ca.status}.`);
  const { error } = await sb.from('hr_onboarding_case_actions').update({ status: 'cancelled', cancelled_by: actorId, cancelled_at: nowISO() }).eq('id', ca.id);
  if (error) throw err(500, error.message);
  if (ca.linked_task_id) await sb.from('hr_onboarding_tasks').update({ status: 'cancelled' }).eq('id', ca.linked_task_id).not('status', 'in', '("completed","skipped","cancelled")');
  if (ca.linked_handoff_id) await sb.from('hr_onboarding_handoffs').update({ status: 'cancelled' }).eq('id', ca.linked_handoff_id).eq('status', 'pending');
  void emitAppEvent({ eventType: 'onboarding.custom_action.cancelled', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: ca.case_id, actorUserId: actorId, severity: 'warning', payload: { actionName: ca.action_name, reason: a.reason ?? null } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: ca.case_id, actorId, action: 'hr.onboarding.custom_action_cancelled', newState: { id: ca.id }, reason: a.reason ?? null });
  await recomputeCaseStatus(ca.case_id);
  return { id: ca.id, status: 'cancelled' };
}
