// Atomic HR onboarding launch. All user-visible launch records and required side
// effects commit in public.hr_onboarding_launch_tx or none of them do.
import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { resolveSettingValue } from '../settings/resolveSetting';
import { loadPackagePlan, requireCompatiblePackage, resolveDueAt } from './onboardingPackageService';
import { listActionTemplates } from './onboardingCustomActions';
import { getComplianceForEmployee } from './documentsCompliance';
import { listRequirements } from './documentsRequirements';
import { getAccountProvisioningPreflight } from './accountProvisioning';
import { getOnboardingLaunchPreflight } from './onboardingLaunchPreflight';
import type { OnboardingCaseStatus, OnboardingDocumentLaunchSelection, OnboardingLaunchOneOffAction } from '../../../../types/hrOnboarding';

export interface StartOnboardingArgs {
  requestId: string;
  employeeId: string;
  packageKey: string;
  ownerId?: string | null;
  reason?: string | null;
  priority?: string | null;
  targetStartDate?: string | null;
  includeActionTemplateIds?: string[] | null;
  oneOffActions?: OnboardingLaunchOneOffAction[] | null;
  documentSelections?: OnboardingDocumentLaunchSelection[] | null;
}

export interface StartOnboardingResult {
  caseId: string;
  caseNo: string;
  taskCount: number;
  handoffCount: number;
}

const ACTIVE_CASE_STATUSES: OnboardingCaseStatus[] = [
  'draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation',
];

const fail = (status: number, message: string): Error => Object.assign(new Error(message), { status });

async function validateLaunchGates(employeeId: string): Promise<void> {
  const [duplicateResult, employeeResult] = await Promise.all([
    sb.from('hr_onboarding_cases').select('case_no, status').eq('employee_id', employeeId).in('status', ACTIVE_CASE_STATUSES).limit(1),
    sb.from('app_users').select('id, employment_type').eq('id', employeeId).maybeSingle<{ id: string; employment_type: string | null }>(),
  ]);
  if (duplicateResult.error) throw fail(500, duplicateResult.error.message);
  if (employeeResult.error) throw fail(500, employeeResult.error.message);
  const duplicate = duplicateResult.data?.[0] as { case_no: string; status: string } | undefined;
  if (duplicate) throw fail(400, `This employee already has an active onboarding case (${duplicate.case_no}, status: ${duplicate.status}).`);
  if (!employeeResult.data) throw fail(404, 'Employee not found.');
  if (!employeeResult.data.employment_type) throw fail(400, 'Right to work is not verified for this worker. Set the employment type before launching.');
}

function validateWorkerType(effectiveWorkerType: string, workerTypes: string[], packageLabel: string): void {
  const allowed = workerTypes.length ? workerTypes : ['employee'];
  if (!allowed.includes(effectiveWorkerType)) throw fail(400, `The "${packageLabel}" package is not available for ${effectiveWorkerType} onboarding.`);
}

async function findLaunchReplay(requestId: string): Promise<StartOnboardingResult | null> {
  const { data: existing, error } = await sb.from('hr_onboarding_cases')
    .select('id, case_no')
    .eq('launch_request_id', requestId)
    .maybeSingle<{ id: string; case_no: string }>();
  if (error) throw fail(500, error.message);
  if (!existing) return null;
  const [tasks, handoffs] = await Promise.all([
    sb.from('hr_onboarding_tasks').select('id', { count: 'exact', head: true }).eq('case_id', existing.id),
    sb.from('hr_onboarding_handoffs').select('id', { count: 'exact', head: true }).eq('case_id', existing.id),
  ]);
  if (tasks.error) throw fail(500, tasks.error.message);
  if (handoffs.error) throw fail(500, handoffs.error.message);
  return { caseId: existing.id, caseNo: existing.case_no, taskCount: tasks.count ?? 0, handoffCount: handoffs.count ?? 0 };
}

export async function startOnboardingCase(
  actorId: string,
  args: StartOnboardingArgs,
  authority: { canWaiveDocuments: boolean; canCreateOneOff: boolean },
): Promise<StartOnboardingResult> {
  const replay = await findLaunchReplay(args.requestId);
  if (replay) return replay;

  const preflight = await getOnboardingLaunchPreflight(actorId, args, authority);
  if (!preflight.ready) throw fail(409, preflight.blockers[0]?.message ?? 'Onboarding launch is blocked.');

  const settingsScope = { moduleKey: 'hr_onboarding' };
  const enabled = await resolveSettingValue<unknown>(sb, 'hr_onboarding.enabled', settingsScope, true);
  if (enabled === false || enabled === 'false') throw fail(403, 'Onboarding is disabled in settings.');

  const ownerId = args.ownerId ?? actorId;
  const requireOwner = await resolveSettingValue<unknown>(sb, 'hr_onboarding.require_owner_on_start', settingsScope, true);
  if ((requireOwner === true || requireOwner === 'true') && !ownerId) throw fail(400, 'A case owner is required to start onboarding.');

  const plan = await loadPackagePlan(args.packageKey);
  if (!plan || plan.status !== 'active') throw fail(400, 'Choose an active onboarding package.');
  await requireCompatiblePackage(args.employeeId, args.packageKey);

  const activeTemplates = await listActionTemplates(args.packageKey);
  const templateById = new Map(activeTemplates.map(template => [template.id, template]));
  const requestedTemplateIds = [...new Set(args.includeActionTemplateIds ?? [])];
  if (requestedTemplateIds.some(id => !templateById.has(id))) throw fail(409, 'An optional action is inactive or belongs to another package. Refresh the generated plan.');
  const selectedTemplateIds = [...new Set([
    ...activeTemplates.filter(template => template.isRequired).map(template => template.id),
    ...requestedTemplateIds,
  ])];

  const { data: employee, error: employeeError } = await sb.from('app_users')
    .select('id, supervisor_id, contractor_flag')
    .eq('id', args.employeeId)
    .maybeSingle<{ id: string; supervisor_id: string | null; contractor_flag: boolean | null }>();
  if (employeeError) throw fail(500, employeeError.message);
  if (!employee) throw fail(404, 'Employee not found.');
  const workerType = employee.contractor_flag ? 'contractor' : 'employee';
  validateWorkerType(workerType, plan.workerTypes, plan.label);
  await validateLaunchGates(args.employeeId);

  const accountPreflight = await getAccountProvisioningPreflight({
    employeeId: args.employeeId,
    packageKey: args.packageKey,
    ownerId,
  });
  if (accountPreflight.required && !accountPreflight.ready) {
    throw fail(409, accountPreflight.blockers.join(' ') || 'Account setup policy is not ready.');
  }

  const [compliance, requirements] = await Promise.all([
    getComplianceForEmployee(true, args.employeeId),
    listRequirements(true),
  ]);
  const requirementById = new Map(requirements.map(requirement => [requirement.id, requirement]));
  const selectionByRequirement = new Map((args.documentSelections ?? []).map(selection => [selection.requirementId, selection]));
  const startDate = args.targetStartDate || null;
  for (const selection of args.documentSelections ?? []) {
    if (!requirementById.has(selection.requirementId)) throw fail(409, 'A document requirement is no longer active. Refresh the intake preview.');
  }

  const documentRows = compliance.map(item => {
    const requirement = requirementById.get(item.requirementId);
    const selection = selectionByRequirement.get(item.requirementId);
    const expiresBeforeStart = !!startDate && !!item.expiryDate
      && new Date(`${item.expiryDate.slice(0, 10)}T00:00:00.000Z`).getTime()
        < new Date(`${startDate.slice(0, 10)}T00:00:00.000Z`).getTime();
    const eligibleExisting = item.state === 'present_verified' && !expiresBeforeStart;
    if (!eligibleExisting && (!selection || selection.action === 'none')) {
      throw fail(400, `Choose how ${item.label} will be resolved before launch.`);
    }
    if (selection?.action === 'use_existing' && (!eligibleExisting || !item.documentId || selection.existingDocumentId !== item.documentId)) {
      throw fail(409, `The selected ${item.label} document is no longer valid for this employee.`);
    }
    if (selection?.action === 'waive') {
      if (!requirement?.canWaive) throw fail(403, `${item.label} cannot be waived.`);
      if (!selection.waiverReason?.trim()) throw fail(400, `A waiver reason is required for ${item.label}.`);
    }
    const status = selection?.action === 'waive' ? 'waived' : eligibleExisting || selection?.action === 'use_existing' ? 'use_existing' : 'pending';
    if (requirement?.blocksOnboarding && !eligibleExisting && status !== 'use_existing' && status !== 'waived') {
      throw fail(400, `${item.label} must be attached or waived before launch.`);
    }
    return {
      id: crypto.randomUUID(), requirementId: item.requirementId, documentType: item.requiredType,
      label: item.label, status, documentId: status === 'use_existing' ? item.documentId : null,
      waiverReason: selection?.action === 'waive' ? selection.waiverReason!.trim() : null,
      blocksOnboarding: requirement?.blocksOnboarding ?? false, canWaive: requirement?.canWaive ?? false,
      requiresExpiry: requirement?.requiresExpiry ?? false,
      metadata: { disposition: selection?.action ?? (eligibleExisting ? 'use_existing' : 'request_from_worker') },
    };
  });

  const caseId = crypto.randomUUID();
  const prefixValue = await resolveSettingValue<unknown>(sb, 'hr_onboarding.case_no_prefix', settingsScope, 'ONB');
  const caseNo = await nextRef(typeof prefixValue === 'string' && prefixValue.trim() ? prefixValue.trim() : 'ONB');
  const taskRows: Record<string, unknown>[] = plan.tasks.map(task => ({
    id: crypto.randomUUID(), taskKey: task.taskKey, taskTitle: task.taskTitle, ownerRole: task.ownerRole,
    moduleKey: task.moduleKey, assignedTo: task.ownerRole === 'hr' ? ownerId : task.ownerRole === 'supervisor' ? employee.supervisor_id : null,
    isBlocking: task.isBlocking, requiresEvidence: task.requiresEvidence, sortOrder: task.sortOrder,
    dependencyKeys: task.dependencyKeys, dueAt: resolveDueAt(startDate, task.dueOffsetDays),
  }));
  const handoffRows: Record<string, unknown>[] = plan.handoffs.map(handoff => ({
    id: crypto.randomUUID(), handoffKey: handoff.handoffKey, targetModule: handoff.targetModule,
    handoffType: handoff.handoffType, ownerId: null, dueAt: resolveDueAt(startDate, handoff.dueOffsetDays),
    payload: { ...handoff.payloadTemplate, employeeId: employee.id, caseNo },
  }));
  const actionRows: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];

  for (const document of documentRows.filter(row => row.status === 'pending')) {
    const taskId = crypto.randomUUID();
    taskRows.push({
      id: taskId,
      taskKey: `document_request_${document.id}`,
      taskTitle: `Collect ${document.label}`,
      ownerRole: 'hr', assignedTo: ownerId, moduleKey: 'documents',
      isBlocking: false, requiresEvidence: true, sortOrder: 900,
      dependencyKeys: [], dueAt: resolveDueAt(startDate, -7),
      priority: 'normal',
      metadata: { documentRequestId: document.id, requirementId: document.requirementId, workerFollowUp: true },
    });
    notifications.push({
      userId: employee.id,
      type: 'hr.onboarding.document_requested',
      title: `Document required: ${document.label}`,
      body: `Upload ${document.label} for onboarding case ${caseNo}.`,
      actionRoute: `hr/onboarding/worker/${caseId}`,
      actionRequired: true,
      dedupeKey: `hr.onboarding.launch:${args.requestId}:document:${document.id}:${employee.id}`,
    });
  }

  const launchActions = [
    ...selectedTemplateIds.map(templateId => {
      const template = templateById.get(templateId)!;
      return { ...template, sourceTemplateId: template.id };
    }),
    ...(args.oneOffActions ?? []).map((action, index) => ({
      ...action,
      sourceTemplateId: null,
      ownerDepartmentId: action.ownerDepartmentId ?? null,
      ownerEmployeeId: action.ownerEmployeeId ?? null,
      ownerRole: action.ownerRole ?? null,
      dueOffsetDays: action.dueOffsetDays ?? null,
      priority: action.priority ?? 'normal' as const,
      blocksOnboarding: action.blocksOnboarding ?? false,
      requiresEvidence: action.requiresEvidence ?? false,
      description: action.description ?? null,
      instructions: action.instructions ?? null,
      externalSystemKey: action.externalSystemKey ?? null,
      externalActionUrl: action.externalActionUrl ?? null,
      displayOrder: 1000 + index,
    })),
  ];

  for (const action of launchActions) {
    if (action.actionType === 'custom_approval') {
      throw fail(409, `The action "${action.actionName}" requires a workflow binding that is not launch-safe.`);
    }
    if (!action.ownerRole && !action.ownerDepartmentId && !action.ownerEmployeeId && !action.externalSystemKey) {
      throw fail(409, `Choose an owning team or accountable person for "${action.actionName}".`);
    }
    const actionId = crypto.randomUUID();
    const dueAt = resolveDueAt(startDate, action.dueOffsetDays);
    const assignedTo = action.ownerEmployeeId
      ?? (action.ownerRole === 'hr' ? ownerId : action.ownerRole === 'supervisor' ? employee.supervisor_id : null);
    let linkedTaskId: string | null = null;
    let linkedHandoffId: string | null = null;

    if (['custom_task', 'custom_checklist_item', 'custom_external_action', 'custom_document_request', 'custom_training_request'].includes(action.actionType)) {
      linkedTaskId = crypto.randomUUID();
      taskRows.push({
        id: linkedTaskId, taskKey: `action_${actionId}`, taskTitle: action.actionName,
        ownerRole: action.ownerRole, assignedTo,
        moduleKey: action.actionType === 'custom_training_request' ? 'training' : action.actionType === 'custom_document_request' ? 'documents' : null,
        isBlocking: action.blocksOnboarding, requiresEvidence: action.requiresEvidence,
        sortOrder: action.displayOrder, dependencyKeys: [], dueAt, priority: action.priority,
        metadata: { customAction: true, actionType: action.actionType, instructions: action.instructions, ownerDepartmentId: action.ownerDepartmentId, externalSystemKey: action.externalSystemKey, externalActionUrl: action.externalActionUrl },
      });
    }
    if (['custom_handoff', 'custom_document_request', 'custom_training_request'].includes(action.actionType)) {
      linkedHandoffId = crypto.randomUUID();
      const targetModule = action.actionType === 'custom_training_request' ? 'training' : action.actionType === 'custom_document_request' ? 'documents' : action.ownerRole ?? action.externalSystemKey ?? 'hr';
      handoffRows.push({
        id: linkedHandoffId, handoffKey: `action_${actionId}`, targetModule,
        handoffType: action.actionType, ownerId: assignedTo, dueAt,
        payload: { customAction: true, actionName: action.actionName, instructions: action.instructions, ownerDepartmentId: action.ownerDepartmentId, employeeId: employee.id, caseNo },
      });
    }
    if (action.actionType === 'custom_notification') {
      const recipient = assignedTo ?? ownerId;
      if (!recipient) throw fail(409, `The notification action "${action.actionName}" has no accountable recipient.`);
      notifications.push({
        userId: recipient,
        type: 'hr.onboarding.action_required',
        title: action.actionName,
        body: action.instructions ?? action.description ?? '',
        actionRoute: `hr/onboarding/${caseId}`,
        actionRequired: true,
        dedupeKey: `hr.onboarding.launch:${args.requestId}:action:${actionId}:${recipient}`,
      });
    }
    actionRows.push({
      id: actionId, sourceTemplateId: action.sourceTemplateId, actionName: action.actionName,
      actionType: action.actionType, status: action.actionType === 'custom_notification' ? 'completed' : 'open',
      linkedTaskId, linkedHandoffId, metadata: { ownerDepartmentId: action.ownerDepartmentId },
    });
  }

  const recipients = new Set<string>();
  if (ownerId && ownerId !== actorId) recipients.add(ownerId);
  if (employee.supervisor_id && employee.supervisor_id !== actorId) recipients.add(employee.supervisor_id);
  for (const userId of recipients) {
    notifications.push({
      userId, title: `Onboarding case ${caseNo} started`,
      type: 'hr.onboarding.started',
      body: `A new onboarding case has been launched for employee ${args.employeeId} using the ${plan.label} package.`,
      actionRoute: `hr/onboarding/${caseId}`,
      actionRequired: true,
      dedupeKey: `hr.onboarding.launch:${args.requestId}:started:${userId}`,
    });
  }

  const probationEndDate = (() => {
    if (!startDate || !plan.probationDays) return null;
    const date = new Date(`${startDate.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + plan.probationDays);
    return date.toISOString().slice(0, 10);
  })();
  const launchSnapshot = {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    package: { id: plan.id, key: plan.key, label: plan.label, versionNo: plan.versionNo },
    employeeId: employee.id, targetStartDate: startDate, ownerId,
    accountPolicy: accountPreflight,
    tasks: taskRows, handoffs: handoffRows, documents: documentRows, actions: actionRows,
  };

  const { data, error } = await sb.rpc('hr_onboarding_launch_tx', {
    p_request_id: args.requestId,
    p_actor_id: actorId,
    p_case: {
      id: caseId, caseNo, employeeId: employee.id, workerType, packageKey: plan.key,
      packageId: plan.id, packageVersionNo: plan.versionNo, launchSnapshot, ownerId,
      reason: args.reason?.trim() || null, priority: args.priority?.trim() || null,
      targetStartDate: startDate,
    },
    p_tasks: taskRows,
    p_handoffs: handoffRows,
    p_documents: documentRows,
    p_actions: actionRows,
    p_notifications: notifications,
    p_probation_end_date: probationEndDate,
  });
  if (error) {
    const duplicate = error.code === '23505' || error.message.includes('already has an active onboarding case');
    throw fail(duplicate ? 409 : 500, duplicate ? 'This employee already has an active onboarding case.' : `Onboarding launch failed atomically: ${error.message}`);
  }
  const result = data as StartOnboardingResult | null;
  if (!result?.caseId || !result.caseNo) throw fail(500, 'Onboarding launch returned an invalid result.');
  return result;
}
