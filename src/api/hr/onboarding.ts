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

async function call<T>(path: string, args: Record<string, unknown>): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(path, args);
  return res.data;
}

export interface OnboardingTaskTemplate { taskKey: string; taskTitle: string; ownerRole: string; moduleKey: string | null }
export interface OnboardingHandoffTemplate { targetModule: string; handoffType: string }
export interface OnboardingPreview { package: string; label: string; tasks: OnboardingTaskTemplate[]; handoffs: OnboardingHandoffTemplate[]; taskCount: number }
export interface OnboardingStartResult { caseId: string; caseNo: string; status: string; taskCount: number; handoffCount: number }

/** Package keys + labels (mirror lib/hr/onboardingPackages.ts; no list endpoint). */
export interface OnboardingPackageOption { key: string; label: string; owners: string; desc: string }
export const ONBOARDING_PACKAGES: OnboardingPackageOption[] = [
  { key: 'standard_employee',        label: 'Standard Employee',     owners: 'HR, Supervisor, IT, Payroll',  desc: 'Best for ordinary employees' },
  { key: 'safety_critical_employee', label: 'Safety-Critical Role',  owners: 'HR, HSE, Training, Operations', desc: 'Adds induction, PTW/JSA, competency, medical' },
  { key: 'contractor_worker',        label: 'Contractor Worker',     owners: 'HR, HSE, Security, Sponsor',    desc: 'No payroll; strong access and HSE gate' },
  { key: 'supervisor_manager',       label: 'Manager / Supervisor',  owners: 'HR, IT, Workflow, Training',    desc: 'Adds approval rights and management policy pack' },
  { key: 'office_admin',             label: 'Office / Admin',        owners: 'HR, IT, Facilities',            desc: 'Standard office onboarding' },
];

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
};

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
