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
  OnboardingCaseListArgs, OnboardingCaseListResult,
  OnboardingDashboardStats, OnboardingDashboardStatsArgs,
  OnboardingTaskListArgs, OnboardingTaskRow,
  OnboardingHandoffListArgs, OnboardingHandoffRow,
  OnboardingBlockerListArgs, OnboardingBlockerRow,
  OnboardingAuditRow, OnboardingPackageSummary,
  OnboardingActionTemplate, OnboardingCaseAction, OnboardingActionType, OnboardingOwnerType, OnboardingActionPriority,
} from '../../../types/hrOnboarding';

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(path, args as Record<string, unknown>);
  return res.data;
}

export interface OnboardingTaskTemplate { taskKey: string; taskTitle: string; ownerRole: string; moduleKey: string | null }
export interface OnboardingHandoffTemplate { targetModule: string; handoffType: string }
export interface OnboardingPreview { package: string; label: string; tasks: OnboardingTaskTemplate[]; handoffs: OnboardingHandoffTemplate[]; taskCount: number }
export interface OnboardingStartResult { caseId: string; caseNo: string; status: string; taskCount: number; handoffCount: number }

// Packages are DB-driven (Phase 4) — fetch via useOnboardingPackages() / packages/list.
// The former hardcoded ONBOARDING_PACKAGES constant was removed (no dual source).

export const hrOnboardingApi = {
  preview: (a: { packageKey: string }) => call<OnboardingPreview>('hr/onboarding/preview-package', a),
  start:   (a: {
    employeeId: string; packageKey: string; ownerId?: string | null; dueAt?: string | null;
    reason?: string | null; priority?: string | null; targetStartDate?: string | null;
    launchMode?: string | null; caseOwner?: string | null; workerType?: string | null;
  }) => call<OnboardingStartResult>('hr/onboarding/start', a),
  get:     (a: { caseId?: string; employeeId?: string }) =>
    call<{ case: Record<string, unknown>; tasks: Record<string, unknown>[]; handoffs: Record<string, unknown>[] }>('hr/onboarding/get', a),
  completeTask: (a: { taskId: string }) => call<{ taskId: string; status: string; caseCompleted: boolean }>('hr/onboarding/task/complete', a),
  reassignTask: (a: { taskId: string; assignedTo: string | null }) => call<{ taskId: string; assignedTo: string | null }>('hr/onboarding/task/reassign', a),
  cancel:  (a: { caseId: string; reason?: string }) => call<{ caseId: string; status: string }>('hr/onboarding/cancel', a),

  // ── Management module (Phase 2 reads) ───────────────────────────────────────────
  dashboardStats: (a: OnboardingDashboardStatsArgs = {}) => call<OnboardingDashboardStats>('hr/onboarding/dashboard-stats', a),
  listCases:      (a: OnboardingCaseListArgs = {})       => call<OnboardingCaseListResult>('hr/onboarding/list', a),
  listTasks:      (a: OnboardingTaskListArgs = {})       => call<OnboardingTaskRow[]>('hr/onboarding/tasks/list', a),
  listHandoffs:   (a: OnboardingHandoffListArgs = {})    => call<OnboardingHandoffRow[]>('hr/onboarding/handoffs/list', a),
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
  audit:           (a: { caseId: string }) => call<OnboardingAuditRow[]>('hr/onboarding/audit', a),

  // ── Packages (Phase 4) ──────────────────────────────────────────────────────────
  listPackages:    (a: { includeRetired?: boolean } = {}) => call<OnboardingPackageSummary[]>('hr/onboarding/packages/list', a),

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

// ── hooks (case management) ─────────────────────────────────────────────────────

const caseKey = (employeeId: string | null) => ['hr', 'onboarding', 'case', employeeId ?? ''] as const;

export function useHrOnboardingCase(employeeId: string | null) {
  return useQuery({
    queryKey: caseKey(employeeId),
    enabled:  !!employeeId,
    retry:    false,
    queryFn:  () => hrOnboardingApi.get({ employeeId: employeeId! }),
  });
}

export function useCompleteOnboardingTask(employeeId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => hrOnboardingApi.completeTask({ taskId }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: caseKey(employeeId) }),
  });
}

export function useCancelOnboarding(employeeId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { caseId: string; reason?: string }) => hrOnboardingApi.cancel(a),
    onSuccess:  () => qc.invalidateQueries({ queryKey: caseKey(employeeId) }),
  });
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

export function useOnboardingCases(filters: OnboardingCaseListArgs = {}) {
  return useQuery({
    queryKey:        ['hr', 'onboarding', 'cases', filters],
    queryFn:         () => hrOnboardingApi.listCases(filters),
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

export function useOnboardingHandoffsList(filters: OnboardingHandoffListArgs = {}) {
  return useQuery({
    queryKey:        ['hr', 'onboarding', 'handoffs', filters],
    queryFn:         () => hrOnboardingApi.listHandoffs(filters),
    placeholderData: prev => prev,
  });
}

export function useOnboardingBlockersList(filters: OnboardingBlockerListArgs = {}) {
  return useQuery({
    queryKey:        ['hr', 'onboarding', 'blockers', filters],
    queryFn:         () => hrOnboardingApi.listBlockers(filters),
    placeholderData: prev => prev,
  });
}

export function useOnboardingPackages(includeRetired = false) {
  return useQuery({
    queryKey:  ['hr', 'onboarding', 'packages', includeRetired],
    queryFn:   () => hrOnboardingApi.listPackages({ includeRetired }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useOnboardingAudit(caseId: string | null) {
  return useQuery({
    queryKey: ['hr', 'onboarding', 'audit', caseId ?? ''],
    enabled:  !!caseId,
    queryFn:  () => hrOnboardingApi.audit({ caseId: caseId! }),
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
