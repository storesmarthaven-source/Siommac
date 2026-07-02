/**
 * src/api/hr/offboarding.ts
 *
 * Typed client + TanStack hooks for the HR Offboarding backend
 * (routes/hrOffboarding.ts — POST `hr/offboarding/*`, camelCase `body.args`).
 * `call<T>` throws on `success:false`.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  OffboardingCaseRow, OffboardingCaseDetail, OffboardingDashboardStats,
  StartOffboardingArgs, StartOffboardingResult, FinalizeOffboardingResult,
} from '../../../types/hrOffboarding';

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const hrOffboardingApi = {
  list:  (a: { status?: string } = {}) => call<OffboardingCaseRow[]>('hr/offboarding/list', a),
  get:   (caseId: string)              => call<OffboardingCaseDetail>('hr/offboarding/get', { caseId }),
  stats: ()                            => call<OffboardingDashboardStats>('hr/offboarding/dashboard-stats', {}),
  start: (a: StartOffboardingArgs)     => call<StartOffboardingResult>('hr/offboarding/start', a),

  completeTask:   (a: { taskId: string })                 => call<{ taskId: string; status: string }>('hr/offboarding/task/complete', a),
  pause:          (a: { caseId: string; reason?: string }) => call<{ caseId: string; status: string }>('hr/offboarding/pause', a),
  resume:         (a: { caseId: string })                 => call<{ caseId: string; status: string }>('hr/offboarding/resume', a),
  markReady:      (a: { caseId: string })                 => call<{ caseId: string; status: string }>('hr/offboarding/mark-ready', a),
  complete:       (a: { caseId: string })                 => call<{ caseId: string; status: string }>('hr/offboarding/complete', a),
  cancel:         (a: { caseId: string; reason?: string }) => call<{ caseId: string; status: string }>('hr/offboarding/cancel', a),
  reassignOwner:  (a: { caseId: string; ownerId: string | null }) => call<{ caseId: string; ownerId: string | null }>('hr/offboarding/reassign-owner', a),
  finalize:       (a: { caseId: string; exitDate?: string | null }) => call<FinalizeOffboardingResult>('hr/offboarding/finalize', a),
};

export const offbKeys = {
  root:  ['hr', 'offboarding'] as const,
  list:  (s?: string) => ['hr', 'offboarding', 'list', s ?? 'all'] as const,
  case:  (id: string) => ['hr', 'offboarding', 'case', id] as const,
  stats: ['hr', 'offboarding', 'stats'] as const,
};

export function useOffboardingCases(status?: string) {
  return useQuery({ queryKey: offbKeys.list(status), queryFn: () => hrOffboardingApi.list(status ? { status } : {}) });
}
export function useOffboardingCase(caseId: string | null) {
  return useQuery({ queryKey: offbKeys.case(caseId ?? ''), queryFn: () => hrOffboardingApi.get(caseId as string), enabled: !!caseId });
}
export function useOffboardingStats() {
  return useQuery({ queryKey: offbKeys.stats, queryFn: () => hrOffboardingApi.stats() });
}

/** Generic offboarding mutation hook — invalidates the whole offboarding tree. */
export function useOffboardingMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: offbKeys.root }); void qc.invalidateQueries({ queryKey: ['hr', 'employees'] }); } });
}
