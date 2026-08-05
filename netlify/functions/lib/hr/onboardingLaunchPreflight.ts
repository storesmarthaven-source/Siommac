import { sb } from '../db';
import { getOnboardingIntakePreview } from './onboardingIntake';
import { getAccountProvisioningPreflight } from './accountProvisioning';
import { listActionTemplates } from './onboardingCustomActions';
import { loadPackagePlan } from './onboardingPackageService';
import type { OnboardingLaunchPreflight, OnboardingLaunchPreflightArgs } from '../../../../types/hrOnboarding';

const fail = (status: number, message: string): Error => Object.assign(new Error(message), { status });

export async function getOnboardingLaunchPreflight(
  actorId: string,
  args: OnboardingLaunchPreflightArgs,
  authority: { canWaiveDocuments: boolean; canCreateOneOff: boolean },
): Promise<OnboardingLaunchPreflight> {
  const ownerId = args.ownerId ?? actorId;
  const [plan, intake, templates, accountPolicy, ownerResult] = await Promise.all([
    loadPackagePlan(args.packageKey),
    getOnboardingIntakePreview({ employeeId: args.employeeId, packageKey: args.packageKey, targetStartDate: args.targetStartDate }),
    listActionTemplates(args.packageKey),
    getAccountProvisioningPreflight({ employeeId: args.employeeId, packageKey: args.packageKey, ownerId }),
    sb.from('app_users').select('id, full_name').eq('id', ownerId).maybeSingle<{ id: string; full_name: string | null }>(),
  ]);
  if (!plan || plan.status !== 'active') throw fail(400, 'Choose an active onboarding package.');
  if (ownerResult.error) throw fail(500, ownerResult.error.message);
  if (!ownerResult.data) throw fail(409, 'Choose a valid accountable case owner.');

  const blockers: OnboardingLaunchPreflight['blockers'] = [];
  if (!args.targetStartDate) blockers.push({ step: 'worker', message: 'Set the target start date.' });
  for (const check of intake.verification.filter(item => item.critical && item.status !== 'verified')) {
    blockers.push({ step: 'worker', message: check.label });
  }
  if (intake.duplicate.hasDuplicate) blockers.push({ step: 'worker', message: 'This employee already has an active onboarding case.' });
  if (accountPolicy.required && !accountPolicy.ready) {
    accountPolicy.blockers.forEach(message => blockers.push({ step: 'optional', message }));
  }

  const templateById = new Map(templates.map(template => [template.id, template]));
  const requestedIds = [...new Set(args.includeActionTemplateIds ?? [])];
  if (requestedIds.some(id => !templateById.has(id))) blockers.push({ step: 'optional', message: 'An optional action is no longer available for this package.' });
  if ((args.oneOffActions?.length ?? 0) > 0 && !authority.canCreateOneOff) {
    blockers.push({ step: 'optional', message: 'One-off onboarding action permission is required.' });
  }
  for (const action of args.oneOffActions ?? []) {
    if (!action.ownerRole && !action.ownerDepartmentId && !action.ownerEmployeeId && !action.externalSystemKey) {
      blockers.push({ step: 'optional', message: `Choose an owning team for ${action.actionName}.` });
    }
  }
  const selectedTemplates = [...new Set([
    ...templates.filter(template => template.isRequired).map(template => template.id),
    ...requestedIds,
  ])].map(id => templateById.get(id)).filter((value): value is NonNullable<typeof value> => !!value);
  for (const template of selectedTemplates.filter(item => item.actionType === 'custom_approval')) {
    blockers.push({ step: 'optional', message: `${template.actionName} needs a published workflow binding before launch.` });
  }

  const selections = new Map((args.documentSelections ?? []).map(selection => [selection.requirementId, selection]));
  const followUps: OnboardingLaunchPreflight['followUps'] = [];
  for (const document of intake.documents.items) {
    if (document.state === 'present_verified') continue;
    const selection = selections.get(document.requirementId);
    if (!selection || selection.action === 'none') {
      blockers.push({ step: 'documents', message: `Choose how ${document.label} will be resolved.` });
      continue;
    }
    if (selection.action === 'waive' && (!document.canWaive || !authority.canWaiveDocuments || !selection.waiverReason?.trim())) {
      blockers.push({ step: 'documents', message: `An authorised waiver reason is required for ${document.label}.` });
      continue;
    }
    if (selection.action === 'use_existing') {
      blockers.push({ step: 'documents', message: `${document.label} does not have eligible verified evidence.` });
      continue;
    }
    if (document.isBlocking && selection.action !== 'waive') {
      blockers.push({ step: 'documents', message: `${document.label} requires verified evidence or an authorised waiver.` });
      continue;
    }
    if (selection.action === 'request_from_worker') {
      followUps.push({ step: 'documents', label: document.label, owner: ownerResult.data.full_name ?? 'Case owner', dueAt: null });
    }
  }

  const actionTypes = [...selectedTemplates, ...(args.oneOffActions ?? [])].map(action => action.actionType);
  const actionTaskCount = actionTypes.filter(type => ['custom_task','custom_checklist_item','custom_external_action','custom_document_request','custom_training_request'].includes(type)).length;
  const actionHandoffCount = actionTypes.filter(type => ['custom_handoff','custom_document_request','custom_training_request'].includes(type)).length;
  const documentFollowUpCount = [...selections.values()].filter(selection => selection.action === 'request_from_worker').length;
  return {
    ready: blockers.length === 0,
    validatedAt: new Date().toISOString(),
    blockers,
    followUps,
    package: { id: plan.id, key: plan.key, label: plan.label, versionNo: plan.versionNo },
    counts: {
      tasks: plan.tasks.length + actionTaskCount + documentFollowUpCount,
      handoffs: plan.handoffs.length + actionHandoffCount,
      documentRequests: intake.documents.items.length,
      actions: selectedTemplates.length + (args.oneOffActions?.length ?? 0),
    },
    owner: { id: ownerResult.data.id, name: ownerResult.data.full_name },
    accountPolicy,
  };
}
