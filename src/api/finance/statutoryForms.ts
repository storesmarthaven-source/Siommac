/**
 * src/api/finance/statutoryForms.ts
 *
 * Typed client + TanStack hooks for Payroll statutory forms (Wave 7):
 * employer profile + generated TD4/TD4 Summary/NI184/NI187 forms.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

export type StatutoryFormType = 'td4' | 'td4_summary' | 'ni184' | 'ni187';

export interface EmployerProfile {
  legalName: string;
  tradingName: string | null;
  birFileNumber: string | null;
  nisEmployerNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string;
  phone: string | null;
  email: string | null;
}

export interface StatutoryForm {
  id: string;
  formType: StatutoryFormType;
  taxYear: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  employeeId: string | null;
  runId: string | null;
  scope: 'employee' | 'employer';
  format: string;
  filePath: string;
  dataFilePath: string | null;
  totals: Record<string, unknown>;
  checksum: string | null;
  status: 'generated' | 'superseded';
  generatedBy: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const financeStatutoryFormsApi = {
  employerProfileGet:    () => call<EmployerProfile>('finance/statutory-forms/employer-profile/get'),
  employerProfileUpdate: (a: Partial<EmployerProfile>) =>
                           call<EmployerProfile>('finance/statutory-forms/employer-profile/update', a),
  list:       (a: { formType?: StatutoryFormType; taxYear?: number; employeeId?: string } = {}) =>
                call<StatutoryForm[]>('finance/statutory-forms/list', a),
  signedUrl:  (a: { id: string; which?: 'pdf' | 'data' }) =>
                call<{ signedUrl: string; form: StatutoryForm }>('finance/statutory-forms/signed-url', a),
  td4Generate:     (a: { employeeId: string; taxYear: number }) =>
                     call<StatutoryForm>('finance/statutory-forms/td4/generate', a),
  td4GenerateYear: (a: { taxYear: number }) =>
                     call<{ taxYear: number; employeeForms: number; summary: StatutoryForm }>('finance/statutory-forms/td4/generate-year', a),
};

export const financeStatutoryFormsKeys = {
  employerProfile: () => ['finance', 'statutory-forms', 'employer-profile'] as const,
  list: (opts: object = {}) => ['finance', 'statutory-forms', 'list', opts] as const,
};

export function useEmployerProfile() {
  return useQuery({
    queryKey: financeStatutoryFormsKeys.employerProfile(),
    queryFn:  financeStatutoryFormsApi.employerProfileGet,
    staleTime: 60_000,
  });
}

export function useStatutoryForms(opts: { formType?: StatutoryFormType; taxYear?: number; employeeId?: string } = {}) {
  return useQuery({
    queryKey: financeStatutoryFormsKeys.list(opts),
    queryFn:  () => financeStatutoryFormsApi.list(opts),
  });
}

export function useStatutoryFormMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance', 'statutory-forms'] }); },
  });
}
