import { sb } from '../db';
import type {
  OnboardingWorkerExperience,
  OnboardingWorkerTask,
  OnboardingWorkerDocumentRequest,
  OnboardingWorkerMessage,
  OnboardingCaseStatus,
  OnboardingTaskStatus,
  OnboardingCommunicationChannel,
} from '../../../../types/hrOnboarding';

const fail = (message: string): Error => Object.assign(new Error(message), { status: 500 });
const DONE = new Set(['completed', 'skipped']);
/** Statuses that mean the case is still being worked. A completed case never outranks one. */
const LIVE_CASE = new Set(['draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation']);
/** The case states that authoritatively mean onboarding is ready for the first day. */
const CASE_READY = new Set(['ready_for_activation', 'completed']);
/** Document-request states that satisfy a required document. */
const DOC_SATISFIED = new Set(['verified', 'use_existing', 'waived']);

interface CaseDb {
  id: string; case_no: string; employee_id: string; package_key: string;
  status: string; owner_id: string | null; target_start_date: string | null;
}

/**
 * The worker portal read model. This never delegates to the HR scope resolver: the
 * subject is always the authenticated actor and every child query is constrained by
 * that actor/case. Internal blockers, routing, audit and other employees are excluded.
 */
export async function getMyOnboarding(actorId: string): Promise<OnboardingWorkerExperience | null> {
  // Which case is "mine" must be DETERMINISTIC. Ordering by started_at alone picked an
  // arbitrary row when a worker has both a live case and an older completed one, and ties
  // on started_at had no defined winner at all. An in-flight case always wins; among equals
  // the most recently started wins; `id` is the final stable tiebreaker.
  const caseResult = await sb.from('hr_onboarding_cases')
    .select('id, case_no, employee_id, package_key, status, owner_id, target_start_date, started_at')
    .eq('employee_id', actorId)
    .neq('status', 'cancelled');
  if (caseResult.error) throw fail(caseResult.error.message);
  const candidates = (caseResult.data ?? []) as Array<CaseDb & { started_at: string | null }>;
  const rank = (status: string): number => (LIVE_CASE.has(status) ? 0 : 1);
  const kase = candidates.slice().sort((a, b) =>
    rank(a.status) - rank(b.status)
    || (b.started_at ?? '').localeCompare(a.started_at ?? '')
    || a.id.localeCompare(b.id),
  )[0];
  if (!kase) return null;

  const [employeeResult, ownerResult, packageResult, taskResult, documentResult, messageResult] = await Promise.all([
    sb.from('app_users').select('id, full_name, profile_image_url, supervisor_id').eq('id', actorId)
      .maybeSingle<{ id: string; full_name: string | null; profile_image_url: string | null; supervisor_id: string | null }>(),
    kase.owner_id
      ? sb.from('app_users').select('id, full_name').eq('id', kase.owner_id).maybeSingle<{ id: string; full_name: string | null }>()
      : Promise.resolve({ data: null, error: null }),
    sb.from('hr_onboarding_packages').select('package_name').eq('package_key', kase.package_key)
      .maybeSingle<{ package_name: string }>(),
    sb.from('hr_onboarding_tasks')
      .select('id, task_title, status, due_at, requires_evidence, is_blocking, module_key')
      .eq('case_id', kase.id).eq('assigned_to', actorId).order('due_at', { ascending: true, nullsFirst: false }),
    sb.from('hr_onboarding_document_requests')
      .select('id, label, document_type, status, is_required, requires_expiry, rejection_reason')
      .eq('case_id', kase.id).eq('employee_id', actorId).order('created_at', { ascending: true }),
    sb.from('hr_onboarding_communications')
      .select('id, subject, body, channel, sent_at, created_at')
      .eq('case_id', kase.id).eq('recipient_user_id', actorId).in('status', ['sent', 'delivered'])
      .order('created_at', { ascending: false }),
  ]);
  const error = employeeResult.error ?? ownerResult.error ?? packageResult.error ?? taskResult.error ?? documentResult.error ?? messageResult.error;
  if (error) throw fail(error.message);
  if (!employeeResult.data) throw fail('The signed-in worker record could not be loaded.');

  const supervisorResult = employeeResult.data.supervisor_id
    ? await sb.from('app_users').select('id, full_name').eq('id', employeeResult.data.supervisor_id)
      .maybeSingle<{ id: string; full_name: string | null }>()
    : { data: null, error: null };
  if (supervisorResult.error) throw fail(supervisorResult.error.message);

  const tasks: OnboardingWorkerTask[] = ((taskResult.data ?? []) as Array<{
    id: string; task_title: string; status: string; due_at: string | null;
    requires_evidence: boolean | null; is_blocking: boolean | null; module_key: string | null;
  }>).map(row => ({
    taskId: row.id, title: row.task_title, status: row.status as OnboardingTaskStatus,
    dueAt: row.due_at, requiresEvidence: !!row.requires_evidence, isBlocking: !!row.is_blocking,
    moduleLabel: row.module_key,
  }));
  const completedTasks = tasks.filter(task => DONE.has(task.status)).length;

  const documentRequests: OnboardingWorkerDocumentRequest[] = ((documentResult.data ?? []) as Array<{
    id: string; label: string; document_type: string; status: OnboardingWorkerDocumentRequest['status'];
    is_required: boolean; requires_expiry: boolean | null; rejection_reason: string | null;
  }>).map(row => ({
    requestId: row.id, label: row.label, documentType: row.document_type, status: row.status,
    isRequired: row.is_required, requiresExpiry: !!row.requires_expiry, rejectionReason: row.rejection_reason,
  }));
  // Progress spans the worker's COMPLETE visible population — assigned tasks plus the
  // required documents they still owe. Counting tasks alone reported 100% to a worker who
  // still had documents outstanding.
  const requiredDocuments = documentRequests.filter(request => request.isRequired);
  const satisfiedDocuments = requiredDocuments.filter(request => DOC_SATISFIED.has(request.status)).length;
  const requiredDocumentsReady = satisfiedDocuments === requiredDocuments.length;

  const totalWorkerItems = tasks.length + requiredDocuments.length;
  const doneWorkerItems = completedTasks + satisfiedDocuments;
  // A worker with nothing assigned is NOT 100% done — they have no actions, which the UI
  // states separately rather than rendering a full progress bar.
  const hasWorkerActions = totalWorkerItems > 0;
  const progressPercent = hasWorkerActions ? Math.round((doneWorkerItems / totalWorkerItems) * 100) : 0;

  const messages: OnboardingWorkerMessage[] = ((messageResult.data ?? []) as Array<{
    id: string; subject: string | null; body: string | null; channel: string; sent_at: string | null;
  }>).map(row => ({
    messageId: row.id, subject: row.subject, body: row.body,
    channel: row.channel as OnboardingCommunicationChannel, sentAt: row.sent_at,
  }));

  return {
    caseId: kase.id, caseNo: kase.case_no,
    employeeName: employeeResult.data.full_name ?? 'Your onboarding',
    employeePhotoUrl: employeeResult.data.profile_image_url,
    packageLabel: packageResult.data?.package_name ?? kase.package_key,
    status: kase.status as OnboardingCaseStatus,
    targetStartDate: kase.target_start_date,
    progressPercent,
    hasWorkerActions,
    // The CASE decides readiness; the worker's own outstanding items can only withhold it.
    // Previously an empty task list made `every()` vacuously true, so a worker with nothing
    // assigned was told they were ready for day one before HR had finished anything.
    dayOneReady: CASE_READY.has(kase.status)
      && tasks.every(task => DONE.has(task.status))
      && requiredDocumentsReady,
    caseOwner: ownerResult.data ? { id: ownerResult.data.id, name: ownerResult.data.full_name } : null,
    supervisor: supervisorResult.data ? { id: supervisorResult.data.id, name: supervisorResult.data.full_name } : null,
    tasks, documentRequests, messages,
  };
}
