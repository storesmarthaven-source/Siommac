import { useMutation, useQuery, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  PayPolicyDraftInput, PayPolicyPreflight, PayPolicySummary, PayPolicyWorkspace,
} from '../../../types/payrollPayPolicies';

export type * from '../../../types/payrollPayPolicies';

async function post<T>(path: string, args: object): Promise<T> {
  const r = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!r.success) throw new Error(r.message ?? 'Pay-policy request failed.');
  return r.data;
}

export interface PayPolicyListResult { items: PayPolicySummary[]; total: number; nextCursor: string | null }
export const payPolicyKeys = {
  all: ['finance', 'payroll', 'pay-policies'] as const,
  list: (args: object) => ['finance', 'payroll', 'pay-policies', 'list', args] as const,
  detail: (id: string, versionId?: string) => ['finance', 'payroll', 'pay-policies', id, versionId ?? 'current'] as const,
};

export const payPoliciesApi = {
  list: (args: { search?: string; status?: string; cursor?: string; limit?: number }) =>
    post<PayPolicyListResult>('finance/payroll/policies/list', args),
  get: (policyId: string, versionId?: string) =>
    post<PayPolicyWorkspace>('finance/payroll/policies/get', { policyId, ...(versionId ? { versionId } : {}) }),
  createDraft: (input: PayPolicyDraftInput & { idempotencyKey: string }) =>
    post<{ policyId: string; versionId: string; lockVersion: number }>('finance/payroll/policies/create-draft', input),
  updateDraft: (input: PayPolicyDraftInput & { policyId: string; versionId: string; expectedLockVersion: number; idempotencyKey: string }) =>
    post<{ policyId: string; versionId: string; lockVersion: number }>('finance/payroll/policies/update-draft', input),
  copyVersion: (input: { policyId: string; sourceVersionId: string; effectiveFrom: string; changeSummary: string; idempotencyKey: string }) =>
    post<{ policyId: string; versionId: string; versionNo: number; lockVersion: number; status: 'draft' }>(
      'finance/payroll/policies/copy-version', input,
    ),
  preflight: (versionId: string) =>
    post<PayPolicyPreflight>('finance/payroll/policies/preflight', { versionId }),
  submit: (versionId: string, idempotencyKey: string) =>
    post<{ policyId: string; versionId: string; workflowId: string; status: string }>('finance/payroll/policies/submit', {
      versionId, idempotencyKey,
      certifications: { rulesReviewed: true, sourcesOwned: true, statutoryPaymentReady: true },
    }),
  activate: (policyId: string, versionId: string, idempotencyKey: string) =>
    post('finance/payroll/policies/activate', { policyId, versionId, idempotencyKey }),
  assign: (args: { policyId: string; versionId: string; payGroupId: string; effectiveFrom: string; effectiveTo?: string | null; idempotencyKey: string }) =>
    post('finance/payroll/policies/pay-groups/assign', args),
  endAssignment: (args: { policyId: string; assignmentId: string; effectiveTo: string; reason: string; idempotencyKey: string }) =>
    post('finance/payroll/policies/pay-groups/end-assignment', args),
  retire: (args: { policyId: string; effectiveTo: string; reason: string; idempotencyKey: string }) =>
    post('finance/payroll/policies/retire', args),
  compare: (policyId: string, fromVersionId: string, toVersionId: string) =>
    post<{ policyId: string; fromVersionId: string; toVersionId: string; changes: Array<{ field: string; from: unknown; to: unknown }> }>(
      'finance/payroll/policies/versions/compare', { policyId, fromVersionId, toVersionId },
    ),
};

export function usePayPolicies(args: { search?: string; status?: string; cursor?: string; limit?: number }) {
  return useQuery({ queryKey: payPolicyKeys.list(args), queryFn: () => payPoliciesApi.list(args), placeholderData: p => p });
}
export function usePayPolicy(policyId: string | null, versionId?: string) {
  return useQuery({
    queryKey: payPolicyKeys.detail(policyId ?? '', versionId),
    queryFn: () => payPoliciesApi.get(policyId!, versionId), enabled: !!policyId,
  });
}
export function usePayPolicyMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: payPolicyKeys.all }); },
  });
}
