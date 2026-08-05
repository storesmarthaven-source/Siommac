/**
 * src/api/hr/onboarding.ts
 *
 * Typed client for the HR Employee Master onboarding backend (routes/hrOnboarding.ts,
 * v36 §10) via the shared apiPost. Real endpoints (POST `hr/onboarding/*`, camelCase
 * `body.args`) — no new backend. The Start Onboarding wizard uses preview-package
 * (read) + start (create case + tasks + handoff intents).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  OnboardingReadScope,
  OnboardingCaseListArgs, OnboardingCaseListResult,
  OnboardingDashboardStats, OnboardingDashboardStatsArgs,
  OnboardingTaskListArgs,
  OnboardingWorkQueueArgs,
  OnboardingWorkQueueResult,
  ReviewEvidenceArgs, OnboardingTaskRow, OnboardingTaskDetail, AddTaskNoteArgs,
  OnboardingHandoffListArgs, OnboardingHandoffRow, OnboardingHandoffActionArgs, OnboardingHandoffActionResult,
  OnboardingBlockerListArgs, OnboardingBlockerRow, NotifyBlockerOwnerArgs, NotifyBlockerOwnerResult,
  OnboardingAuditRow, OnboardingPackageSummary, OnboardingPackageDetail, OnboardingPackageReferenceData,
  OnboardingCommunicationRow, OnboardingCommunicationPreview, PreviewCommunicationArgs, SendCommunicationArgs,
  OnboardingReportMeta, OnboardingReportResult, RunOnboardingReportArgs,
  OnboardingActionTemplate, OnboardingCaseAction, OnboardingActionType, OnboardingOwnerType, OnboardingActionPriority,
  CreatePackageArgs, UpdatePackageArgs, SetPackageStatusArgs,
  CreateTaskTemplateArgs, UpdateTaskTemplateArgs, CreateHandoffTemplateArgs, UpdateHandoffTemplateArgs,
  OnboardingIntakePreview, OnboardingIntakePreviewArgs, OnboardingAccountPreflight,
  OnboardingLaunchPreflight, OnboardingLaunchPreflightArgs,
  OnboardingWorkerExperience,
} from '../../../types/hrOnboarding';

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export interface OnboardingTaskTemplate { taskKey: string; taskTitle: string; ownerRole: string; moduleKey: string | null }
export interface OnboardingHandoffTemplate { targetModule: string; handoffType: string }
export interface OnboardingPreview { package: string; label: string; tasks: OnboardingTaskTemplate[]; handoffs: OnboardingHandoffTemplate[]; taskCount: number }
export interface OnboardingStartResult { caseId: string; caseNo: string; status: string; taskCount: number; handoffCount: number }

/** One row of the case timeline — mirrors the orchestration TimelineItem projection
 *  (snake_case, since it comes from the generic /orchestration/timeline/get endpoint,
 *  which predates the camelCase onboarding contract). */
export interface OnboardingTimelineItem {
  id: string;
  item_type: 'event' | 'audit' | 'handoff' | 'workflow' | 'message' | 'ticket';
  title: string;
  description?: string;
  actor_id?: string | null;
  actor_name?: string;
  severity?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

// Packages are DB-driven (Phase 4) — fetch via useOnboardingPackages() / packages/list.
// The former hardcoded ONBOARDING_PACKAGES constant was removed (no dual source).

export const hrOnboardingApi = {
  myOnboarding: () => call<OnboardingWorkerExperience | null>('hr/onboarding/my', {}),
  preview: (a: { packageKey: string }) => call<OnboardingPreview>('hr/onboarding/preview-package', a),
  intakePreview: (a: OnboardingIntakePreviewArgs) => call<OnboardingIntakePreview>('hr/onboarding/intake-preview', a),
  accountPreflight: (a: { employeeId: string; packageKey: string; ownerId?: string | null }) =>
    call<OnboardingAccountPreflight>('hr/onboarding/account-preflight', a),
  launchPreflight: (a: OnboardingLaunchPreflightArgs) =>
    call<OnboardingLaunchPreflight>('hr/onboarding/launch-preflight', a),
  start:   (a: {
    requestId: string; employeeId: string; packageKey: string; ownerId?: string | null;
    reason?: string | null; priority?: string | null; targetStartDate?: string | null;
    includeActionTemplateIds?: string[] | null;
    documentSelections?: import('../../../types/hrOnboarding').OnboardingDocumentLaunchSelection[] | null;
    oneOffActions?: import('../../../types/hrOnboarding').OnboardingLaunchOneOffAction[] | null;
  }) => call<OnboardingStartResult>('hr/onboarding/start', a),
  get:     (a: { caseId?: string; employeeId?: string }) =>
    call<{ case: Record<string, unknown>; tasks: Record<string, unknown>[]; handoffs: Record<string, unknown>[] }>('hr/onboarding/get', a),
  completeTask: (a: { taskId: string }) => call<{ taskId: string; status: string; caseCompleted: boolean }>('hr/onboarding/task/complete', a),
  reassignTask: (a: { taskId: string; assignedTo: string | null }) => call<{ taskId: string; assignedTo: string | null }>('hr/onboarding/task/reassign', a),
  getTask:      (a: { taskId: string }) => call<OnboardingTaskDetail>('hr/onboarding/task/get', a),
  addTaskNote:  (a: AddTaskNoteArgs)    => call<{ taskId: string; noteId: string }>('hr/onboarding/task/add-note', a),
  /** Presigned-URL → direct PUT → attach (the standard attachment flow): the Lambda
   *  never holds the file bytes. */
  attachTaskEvidence: async (a: { taskId: string; file: File }) => {
    const signed = await apiPost<{ success: boolean; message?: string; uploadUrl: string; path: string }>(
      'hr/onboarding/task/evidence-upload-url',
      { taskId: a.taskId, fileName: a.file.name, mimeType: a.file.type || 'application/octet-stream' },
      { retryable: false });
    if (!signed.success) throw new Error(signed.message ?? 'Upload URL failed.');
    const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': a.file.type || 'application/octet-stream' }, body: a.file });
    if (!put.ok) throw new Error('File upload failed.');
    return call<{ taskId: string; evidenceId: string }>('hr/onboarding/task/attach-evidence', {
      taskId: a.taskId, fileName: a.file.name, filePath: signed.path,
      mimeType: a.file.type || null, fileSize: a.file.size,
    });
  },
  cancel:  (a: { caseId: string; reason?: string }) => call<{ caseId: string; status: string }>('hr/onboarding/cancel', a),

  // ── Management module (Phase 2 reads) ───────────────────────────────────────────
  dashboardStats: (a: OnboardingDashboardStatsArgs = {}) => call<OnboardingDashboardStats>('hr/onboarding/dashboard-stats', a),
  listCases:      (a: OnboardingCaseListArgs = {})       => call<OnboardingCaseListResult>('hr/onboarding/list', a),
  listTasks:      (a: OnboardingTaskListArgs = {})       => call<OnboardingTaskRow[]>('hr/onboarding/tasks/list', a),
  workerDocumentUploadUrl: (a: { requestId: string; fileName: string; mimeType: string; fileSize: number }) =>
    call<{ uploadUrl: string; token: string; path: string; maxBytes: number }>('hr/onboarding/my/document/upload-url', a),
  workerDocumentCommit: (a: { requestId: string; path: string; fileName: string; mimeType: string; fileSize: number; expiryDate?: string | null }) =>
    call<{ requestId: string; documentId: string; status: string }>('hr/onboarding/my/document/commit', a),
  listWorkQueue:  (a: OnboardingWorkQueueArgs = {})       => call<OnboardingWorkQueueResult>('hr/onboarding/work-queue/list', a),
  reviewEvidence: (a: ReviewEvidenceArgs)                => call<{ evidenceId: string; taskId: string; reviewStatus: string }>('hr/onboarding/task/review-evidence', a),
  listHandoffs:   (a: OnboardingHandoffListArgs = {})    => call<OnboardingHandoffRow[]>('hr/onboarding/handoffs/list', a),
  retryHandoff:    (a: OnboardingHandoffActionArgs) => call<OnboardingHandoffActionResult>('hr/onboarding/handoff/retry', a),
  acceptHandoff:   (a: OnboardingHandoffActionArgs) => call<OnboardingHandoffActionResult>('hr/onboarding/handoff/accept', a),
  completeHandoff: (a: OnboardingHandoffActionArgs) => call<OnboardingHandoffActionResult>('hr/onboarding/handoff/complete', a),
  cancelHandoff:   (a: OnboardingHandoffActionArgs) => call<OnboardingHandoffActionResult>('hr/onboarding/handoff/cancel', a),
  listBlockers:   (a: OnboardingBlockerListArgs = {})    => call<OnboardingBlockerRow[]>('hr/onboarding/blockers/list', a),

  // ── Management module (Phase 3 writes) ──────────────────────────────────────────
  addTask:         (a: { caseId: string; taskTitle: string; ownerRole?: string | null; moduleKey?: string | null; assignedTo?: string | null; dueAt?: string | null; isBlocking?: boolean; requiresEvidence?: boolean; priority?: string | null; taskKey?: string | null }) => call<{ taskId: string; taskKey: string }>('hr/onboarding/task/add', a),
  blockTask:       (a: { taskId: string; reason?: string | null; severity?: 'low' | 'medium' | 'high' | 'critical' }) => call<{ taskId: string; status: string }>('hr/onboarding/task/block', a),
  unblockTask:     (a: { taskId: string; reason?: string | null }) => call<{ taskId: string; status: string }>('hr/onboarding/task/unblock', a),
  completeCase:    (a: { caseId: string }) => call<{ caseId: string; status: string }>('hr/onboarding/complete', a),
  pauseCase:       (a: { caseId: string; reason?: string | null }) => call<{ caseId: string; status: string }>('hr/onboarding/pause', a),
  resumeCase:      (a: { caseId: string }) => call<{ caseId: string; status: string }>('hr/onboarding/resume', a),
  reassignOwner:   (a: { caseId: string; ownerId: string | null }) => call<{ caseId: string; ownerId: string | null }>('hr/onboarding/reassign-owner', a),
  markReady:       (a: { caseId: string }) => call<{ caseId: string; status: string }>('hr/onboarding/ready', a),
  resolveBlocker:  (a: { blockerId: string; note?: string | null }) => call<{ blockerId: string; status: string }>('hr/onboarding/blocker/resolve', a),
  escalateBlocker: (a: { blockerId: string; note?: string | null; newOwnerId?: string | null }) => call<{ blockerId: string; status: string }>('hr/onboarding/blocker/escalate', a),
  waiveBlocker:    (a: { blockerId: string; reason: string }) => call<{ blockerId: string; status: string }>('hr/onboarding/blocker/waive', a),
  notifyBlockerOwner: (a: NotifyBlockerOwnerArgs) => call<NotifyBlockerOwnerResult>('hr/onboarding/blocker/notify-owner', a),
  audit:           (a: { caseId: string }) => call<OnboardingAuditRow[]>('hr/onboarding/audit', a),

  // ── Packages (Phase 4) ──────────────────────────────────────────────────────────
  listPackages:    (a: { includeRetired?: boolean; employeeId?: string } = {}) => call<OnboardingPackageSummary[]>('hr/onboarding/packages/list', a),

  // ── Package Manager (packages + task/handoff templates) ────────────────────────
  getPackageDetail:       (a: { packageKey: string })  => call<OnboardingPackageDetail>('hr/onboarding/packages/get', a),
  getPackageReferenceData: () => call<OnboardingPackageReferenceData>('hr/onboarding/packages/reference-data', {}),
  createPackage:          (a: CreatePackageArgs)        => call<{ id: string; key: string }>('hr/onboarding/packages/create', a),
  updatePackage:          (a: UpdatePackageArgs)        => call<{ id: string }>('hr/onboarding/packages/update', a),
  setPackageStatus:       (a: SetPackageStatusArgs)     => call<{ id: string; status: string }>('hr/onboarding/packages/set-status', a),
  createTaskTemplate:     (a: CreateTaskTemplateArgs)   => call<{ id: string }>('hr/onboarding/packages/task-templates/create', a),
  updateTaskTemplate:     (a: UpdateTaskTemplateArgs)   => call<{ id: string }>('hr/onboarding/packages/task-templates/update', a),
  deleteTaskTemplate:     (a: { id: string })           => call<{ id: string }>('hr/onboarding/packages/task-templates/delete', a),
  createHandoffTemplate:  (a: CreateHandoffTemplateArgs) => call<{ id: string }>('hr/onboarding/packages/handoff-templates/create', a),
  updateHandoffTemplate:  (a: UpdateHandoffTemplateArgs) => call<{ id: string }>('hr/onboarding/packages/handoff-templates/update', a),
  deleteHandoffTemplate:  (a: { id: string })           => call<{ id: string }>('hr/onboarding/packages/handoff-templates/delete', a),

  // ── Overview analytics ───────────────────────────────────────────────────────────
  recentActivity: (a: { limit?: number; scope?: OnboardingReadScope } = {}) => call<OnboardingAuditRow[]>('hr/onboarding/activity/recent', a),

  // ── Case communications (Phase 5) ─────────────────────────────────────────────────
  listCommunications:    (a: { caseId: string })        => call<OnboardingCommunicationRow[]>('hr/onboarding/communications/list', a),
  previewCommunication:  (a: PreviewCommunicationArgs)  => call<OnboardingCommunicationPreview>('hr/onboarding/communications/preview', a),
  sendCommunication:     (a: SendCommunicationArgs)     => call<{ id: string; status: string; recipientUserId: string | null }>('hr/onboarding/communications/send', a),
  resendCommunication:   (a: { id: string })            => call<{ id: string; status: string }>('hr/onboarding/communications/resend', a),

  // ── Case timeline — reuses the generic cross-module orchestration timeline (no
  // onboarding-specific endpoint; one query already spans events/audit/handoffs/wf).
  // Audit has its own permission-gated tab. Keeping it out of the readable Timeline avoids
  // rendering the same mutation twice (once from app_events and once from audit_logs).
  timeline: (a: { caseId: string }) => call<OnboardingTimelineItem[]>('orchestration/timeline/get', { module: 'hr', recordType: 'onboarding_case', recordId: a.caseId, includeAudit: false }),

  // ── Reports (Phase 6) ──────────────────────────────────────────────────────────
  listReports: () => call<OnboardingReportMeta[]>('hr/onboarding/reports/list', {}),
  runReport:    (a: RunOnboardingReportArgs) => call<OnboardingReportResult>('hr/onboarding/reports/run', a),
  exportReport: (a: RunOnboardingReportArgs) => call<OnboardingReportResult>('hr/onboarding/reports/export', a),

  // ── Custom Onboarding Actions (Phase 5) ─────────────────────────────────────────
  listActionTemplates:  (a: { packageKey: string; includeInactive?: boolean }) => call<OnboardingActionTemplate[]>('hr/onboarding/actions/templates/list', a),
  createActionTemplate: (a: ActionTemplateArgs)         => call<{ templateId: string }>('hr/onboarding/actions/templates/create', a),
  updateActionTemplate: (a: { id: string } & Partial<ActionTemplateArgs>) => call<{ templateId: string }>('hr/onboarding/actions/templates/update', a),
  retireActionTemplate: (a: { id: string })            => call<{ templateId: string }>('hr/onboarding/actions/templates/retire', a),
  listCaseActions:      (a: { caseId: string })        => call<OnboardingCaseAction[]>('hr/onboarding/actions/case/list', a),
  addCaseAction:        (a: CaseActionArgs)            => call<{ caseActionId: string; actionType: string; status: string }>('hr/onboarding/actions/case/add', a),
  updateCaseAction:     (a: { id: string; status?: string }) => call<{ id: string; status: string }>('hr/onboarding/actions/case/update', a),
  completeCaseAction:   (a: { id: string })            => call<{ id: string; status: string }>('hr/onboarding/actions/case/complete', a),
  cancelCaseAction:     (a: { id: string; reason?: string | null }) => call<{ id: string; status: string }>('hr/onboarding/actions/case/cancel', a),

  // ── Account / work-email provisioning (Phase 6) ─────────────────────────────────
  provisionAccount: (a: { employeeId: string; sendInvite?: boolean }) => call<{ employeeId: string; workEmail: string; accountStatus: string; inviteSent: boolean; inviteLink: string | null }>('hr/onboarding/provision-account', a),
  acceptInvite:     (a: { token: string; password: string }) => call<{ ok: boolean }>('hr/onboarding/accept-invite', a),
};

export function useMyOnboarding() {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'my'],
    queryFn: () => hrOnboardingApi.myOnboarding(),
  });
}

export interface ActionTemplateArgs {
  packageKey: string; actionName: string; actionType: OnboardingActionType; description?: string | null; instructions?: string | null;
  ownerType?: OnboardingOwnerType; ownerRole?: string | null; ownerEmployeeId?: string | null; ownerDepartmentId?: string | null;
  dueOffsetDays?: number; priority?: OnboardingActionPriority; isRequired?: boolean; blocksOnboarding?: boolean; requiresEvidence?: boolean;
  documentTypeId?: string | null; trainingRequirementId?: string | null; workflowTemplateId?: string | null; notificationTemplateId?: string | null;
  externalSystemKey?: string | null; externalActionUrl?: string | null; displayOrder?: number;
}
export interface CaseActionArgs {
  caseId: string; sourceTemplateId?: string | null;
  actionName?: string; actionType?: OnboardingActionType; description?: string | null; instructions?: string | null;
  ownerType?: OnboardingOwnerType; ownerRole?: string | null; ownerEmployeeId?: string | null;
  dueDate?: string | null; priority?: OnboardingActionPriority; blocksOnboarding?: boolean; requiresEvidence?: boolean;
  documentTypeId?: string | null; trainingRequirementId?: string | null; workflowTemplateId?: string | null; notificationTemplateId?: string | null;
  externalSystemKey?: string | null; externalActionUrl?: string | null;
}

// ── hooks (management module — Phase 2 reads) ────────────────────────────────────
// placeholderData keeps the previous page rendered while a new filter set loads
// (instant-from-cache per the loading-state standard), instead of flashing a spinner.

export function useOnboardingDashboard(filters: OnboardingDashboardStatsArgs = {}) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'dashboard', filters],
    queryFn:  () => hrOnboardingApi.dashboardStats(filters),
  });
}

export function useOnboardingCases(filters: OnboardingCaseListArgs = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey:        ['hr', 'onboarding', 'cases', filters],
    queryFn:         () => hrOnboardingApi.listCases(filters),
    placeholderData: prev => prev,
    enabled:         options.enabled,
  });
}

/**
 * The unified Work Queue. `filters` participates in the query key, so a scope, filter,
 * sort or page change refetches rather than reusing a stale page. `placeholderData: prev`
 * keeps the previous page on screen while the next one loads, so paging does not flash an
 * empty table.
 */
export function useOnboardingWorkQueue(filters: OnboardingWorkQueueArgs = {}) {
  return useQuery({
    queryKey:        ['hr', 'onboarding', 'work-queue', filters],
    queryFn:         () => hrOnboardingApi.listWorkQueue(filters),
    placeholderData: prev => prev,
  });
}

export function useOnboardingTasksList(filters: OnboardingTaskListArgs = {}) {
  return useQuery({
    queryKey:        ['hr', 'onboarding', 'tasks', filters],
    queryFn:         () => hrOnboardingApi.listTasks(filters),
    placeholderData: prev => prev,
  });
}

export function useOnboardingHandoffsList(filters: OnboardingHandoffListArgs = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey:        ['hr', 'onboarding', 'handoffs', filters],
    queryFn:         () => hrOnboardingApi.listHandoffs(filters),
    placeholderData: prev => prev,
    enabled:         options.enabled,
  });
}

export function useOnboardingBlockersList(filters: OnboardingBlockerListArgs = {}) {
  return useQuery({
    queryKey:        ['hr', 'onboarding', 'blockers', filters],
    queryFn:         () => hrOnboardingApi.listBlockers(filters),
    placeholderData: prev => prev,
  });
}

export function useOnboardingPackages(includeRetired = false, employeeId?: string | null) {
  return useQuery({
    queryKey:  ['hr', 'onboarding', 'packages', includeRetired, employeeId ?? null],
    queryFn:   () => hrOnboardingApi.listPackages({ includeRetired, ...(employeeId ? { employeeId } : {}) }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Start Onboarding wizard live panels — verification + documents + duplicate + task/handoff preview
 *  for the chosen worker + package. Enabled only once both are selected. */
export function useOnboardingIntakePreview(employeeId: string | null, packageKey: string | null, targetStartDate?: string | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'intake-preview', employeeId, packageKey, targetStartDate ?? null],
    queryFn:  () => hrOnboardingApi.intakePreview({ employeeId: employeeId!, packageKey: packageKey!, targetStartDate: targetStartDate ?? null }),
    enabled:  !!employeeId && !!packageKey,
  });
}

export function useOnboardingAccountPreflight(employeeId: string | null, packageKey: string | null, ownerId?: string | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'account-preflight', employeeId, packageKey, ownerId ?? null],
    queryFn: () => hrOnboardingApi.accountPreflight({ employeeId: employeeId!, packageKey: packageKey!, ownerId: ownerId ?? null }),
    enabled: !!employeeId && !!packageKey,
  });
}

export function useOnboardingLaunchPreflight(args: OnboardingLaunchPreflightArgs | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'launch-preflight', args],
    queryFn: () => hrOnboardingApi.launchPreflight(args!),
    enabled: !!args?.employeeId && !!args.packageKey,
  });
}

export function useOnboardingAudit(caseId: string | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'audit', caseId ?? ''],
    enabled:  !!caseId,
    queryFn:  () => hrOnboardingApi.audit({ caseId: caseId! }),
  });
}

export function useOnboardingRecentActivity(limit = 15, scope?: OnboardingReadScope) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'activity', limit, scope ?? 'my'],
    queryFn:  () => hrOnboardingApi.recentActivity({ limit, scope }),
  });
}

export function useOnboardingPackageDetail(packageKey: string | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'package-detail', packageKey ?? ''],
    enabled:  !!packageKey,
    queryFn:  () => hrOnboardingApi.getPackageDetail({ packageKey: packageKey! }),
  });
}

export function useOnboardingTaskDetail(taskId: string | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'task-detail', taskId ?? ''],
    enabled:  !!taskId,
    queryFn:  () => hrOnboardingApi.getTask({ taskId: taskId! }),
  });
}

export function useOnboardingCommunications(caseId: string | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'communications', caseId ?? ''],
    enabled:  !!caseId,
    queryFn:  () => hrOnboardingApi.listCommunications({ caseId: caseId! }),
  });
}

export function useOnboardingTimeline(caseId: string | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'timeline', caseId ?? ''],
    enabled:  !!caseId,
    queryFn:  () => hrOnboardingApi.timeline({ caseId: caseId! }),
  });
}

export function useOnboardingReportList() {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'report-list'],
    queryFn:  () => hrOnboardingApi.listReports(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useOnboardingReport(args: RunOnboardingReportArgs | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'report', args],
    enabled:  !!args,
    placeholderData: prev => prev,
    queryFn:  () => hrOnboardingApi.runReport(args!),
  });
}

// ── hooks (management module — Phase 3 mutations) ────────────────────────────────
// Each mutation invalidates ALL onboarding queries (dashboard / cases / tasks /
// handoffs / blockers / case / audit) so every open view reflects the new state.
function useOnboardingMutation<TArgs, TRes>(fn: (a: TArgs) => Promise<TRes>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['hr', 'onboarding'] }) });
}

export const useOnboardingCompleteTask   = () => useOnboardingMutation(hrOnboardingApi.completeTask);
export const useOnboardingAddTask        = () => useOnboardingMutation(hrOnboardingApi.addTask);
export const useOnboardingReassignTask   = () => useOnboardingMutation(hrOnboardingApi.reassignTask);
export const useOnboardingAddTaskNote    = () => useOnboardingMutation(hrOnboardingApi.addTaskNote);
export const useOnboardingAttachTaskEvidence = () => useOnboardingMutation(hrOnboardingApi.attachTaskEvidence);
export const useOnboardingRetryHandoff    = () => useOnboardingMutation(hrOnboardingApi.retryHandoff);
export const useOnboardingAcceptHandoff   = () => useOnboardingMutation(hrOnboardingApi.acceptHandoff);
export const useOnboardingCompleteHandoff = () => useOnboardingMutation(hrOnboardingApi.completeHandoff);
export const useOnboardingCancelHandoff   = () => useOnboardingMutation(hrOnboardingApi.cancelHandoff);
export const useOnboardingBlockTask      = () => useOnboardingMutation(hrOnboardingApi.blockTask);
export const useOnboardingUnblockTask    = () => useOnboardingMutation(hrOnboardingApi.unblockTask);
export const useOnboardingCompleteCase   = () => useOnboardingMutation(hrOnboardingApi.completeCase);
export const useOnboardingCancelCase     = () => useOnboardingMutation(hrOnboardingApi.cancel);
export const useOnboardingPauseCase      = () => useOnboardingMutation(hrOnboardingApi.pauseCase);
export const useOnboardingResumeCase     = () => useOnboardingMutation(hrOnboardingApi.resumeCase);
export const useOnboardingReassignOwner  = () => useOnboardingMutation(hrOnboardingApi.reassignOwner);
export const useOnboardingMarkReady      = () => useOnboardingMutation(hrOnboardingApi.markReady);
export const useOnboardingResolveBlocker = () => useOnboardingMutation(hrOnboardingApi.resolveBlocker);
export const useOnboardingEscalateBlocker = () => useOnboardingMutation(hrOnboardingApi.escalateBlocker);
export const useOnboardingWaiveBlocker   = () => useOnboardingMutation(hrOnboardingApi.waiveBlocker);
export const useOnboardingNotifyBlockerOwner = () => useOnboardingMutation(hrOnboardingApi.notifyBlockerOwner);
export const useOnboardingSendCommunication   = () => useOnboardingMutation(hrOnboardingApi.sendCommunication);
export const useOnboardingResendCommunication = () => useOnboardingMutation(hrOnboardingApi.resendCommunication);

// ── hooks (custom onboarding actions — Phase 5) ──────────────────────────────────
export function useOnboardingActionTemplates(packageKey: string | null, includeInactive = false) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'action-templates', packageKey ?? '', includeInactive],
    enabled:  !!packageKey,
    queryFn:  () => hrOnboardingApi.listActionTemplates({ packageKey: packageKey!, includeInactive }),
  });
}

export function useOnboardingCaseActions(caseId: string | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'case-actions', caseId ?? ''],
    enabled:  !!caseId,
    queryFn:  () => hrOnboardingApi.listCaseActions({ caseId: caseId! }),
  });
}

export const useOnboardingCreateActionTemplate = () => useOnboardingMutation(hrOnboardingApi.createActionTemplate);
export const useOnboardingUpdateActionTemplate = () => useOnboardingMutation(hrOnboardingApi.updateActionTemplate);
export const useOnboardingRetireActionTemplate = () => useOnboardingMutation(hrOnboardingApi.retireActionTemplate);
export const useOnboardingAddCaseAction        = () => useOnboardingMutation(hrOnboardingApi.addCaseAction);
export const useOnboardingUpdateCaseAction     = () => useOnboardingMutation(hrOnboardingApi.updateCaseAction);
export const useOnboardingCompleteCaseAction   = () => useOnboardingMutation(hrOnboardingApi.completeCaseAction);
export const useOnboardingCancelCaseAction     = () => useOnboardingMutation(hrOnboardingApi.cancelCaseAction);
export const useOnboardingProvisionAccount     = () => useOnboardingMutation(hrOnboardingApi.provisionAccount);

// ── hooks (Package Manager mutations) ────────────────────────────────────────────
export const useOnboardingCreatePackage         = () => useOnboardingMutation(hrOnboardingApi.createPackage);
export function useOnboardingPackageReferenceData(enabled = true) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'packages', 'reference-data'],
    queryFn: hrOnboardingApi.getPackageReferenceData,
    enabled,
    staleTime: 60_000,
  });
}
export const useOnboardingUpdatePackage         = () => useOnboardingMutation(hrOnboardingApi.updatePackage);
export const useOnboardingSetPackageStatus      = () => useOnboardingMutation(hrOnboardingApi.setPackageStatus);
export const useOnboardingCreateTaskTemplate    = () => useOnboardingMutation(hrOnboardingApi.createTaskTemplate);
export const useOnboardingUpdateTaskTemplate    = () => useOnboardingMutation(hrOnboardingApi.updateTaskTemplate);
export const useOnboardingDeleteTaskTemplate    = () => useOnboardingMutation(hrOnboardingApi.deleteTaskTemplate);
export const useOnboardingCreateHandoffTemplate = () => useOnboardingMutation(hrOnboardingApi.createHandoffTemplate);
export const useOnboardingUpdateHandoffTemplate = () => useOnboardingMutation(hrOnboardingApi.updateHandoffTemplate);
export const useOnboardingDeleteHandoffTemplate = () => useOnboardingMutation(hrOnboardingApi.deleteHandoffTemplate);
