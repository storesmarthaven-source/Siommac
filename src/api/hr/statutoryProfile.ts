/**
 * src/api/hr/statutoryProfile.ts
 *
 * Typed client + TanStack hooks for the Employee Statutory (NIS continuity) Profile
 * (routes/hrStatutoryProfile.ts — POST `hr/employee-statutory/*`). HR *captures* the
 * NIS continuity data and submits it; Finance *verifies* it (see finance/payroll `nis/*`).
 * HR can never mark a profile verified. `actorId` server-derived.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

export type NisStatus = 'pending_verification' | 'verified' | 'not_available' | 'not_applicable' | 'exempt';

export interface StatutoryProfile {
  id: string;
  employeeId: string;
  jurisdiction: string;
  currency: string;
  nisNumber: string | null;
  nisStatus: NisStatus;
  nisApplicable: boolean;
  previousEmployerName: string | null;
  previousEmployerEndDate: string | null;
  openingYtdInsurableEarnings: number;
  openingYtdNisEmployee: number;
  openingYtdNisEmployer: number;
  openingBalanceAsOf: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  workflowId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureStatutoryProfileArgs {
  employeeId: string;
  jurisdiction?: string;
  currency?: string;
  nisNumber?: string | null;
  nisApplicable?: boolean;
  previousEmployerName?: string | null;
  previousEmployerEndDate?: string | null;
  openingYtdInsurableEarnings?: number;
  openingYtdNisEmployee?: number;
  openingYtdNisEmployer?: number;
  openingBalanceAsOf?: string | null;
}

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const hrStatutoryProfileApi = {
  get:     (a: { employeeId: string })          => call<StatutoryProfile | null>('hr/employee-statutory/get', a),
  capture: (a: CaptureStatutoryProfileArgs)     => call<StatutoryProfile>('hr/employee-statutory/capture', a),
  submit:  (a: { id: string })                  => call<StatutoryProfile>('hr/employee-statutory/submit', a),
};

export const hrStatutoryProfileKeys = {
  profile: (employeeId: string) => ['hr', 'employee-statutory', employeeId] as const,
};

export function useStatutoryProfile(employeeId: string | null) {
  return useQuery({
    queryKey: hrStatutoryProfileKeys.profile(employeeId ?? ''),
    queryFn: () => hrStatutoryProfileApi.get({ employeeId: employeeId! }),
    enabled: !!employeeId,
  });
}

export function useStatutoryProfileMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['hr', 'employee-statutory'] }); } });
}
