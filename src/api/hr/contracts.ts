/**
 * src/api/hr/contracts.ts
 *
 * Typed client + TanStack hooks for the HR Contract Management backend
 * (routes/hrContracts.ts — POST `hr/contracts/*`, camelCase `body.args`).
 * `call<T>` throws on `success:false`. ONE shared DTO from types/hrContracts.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  Contract, ContractTemplate, ContractDetail, ContractDashboardStats,
  CreateContractArgs, CreateContractResult, IssueContractArgs, RecordSignatureArgs,
  RenewContractArgs, RenewContractResult, TerminateContractArgs, CancelContractArgs,
  ContractLifecycleResult, CreateTemplateArgs, UpdateTemplateArgs, ExpireContractsResult,
} from '../../../types/hrContracts';

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export interface ContractFilters { status?: string; employeeId?: string; contractType?: string }

export const hrContractsApi = {
  list:      (a: ContractFilters = {})                => call<Contract[]>('hr/contracts/list', a),
  get:       (contractId: string)                     => call<ContractDetail>('hr/contracts/get', { contractId }),
  stats:     ()                                       => call<ContractDashboardStats>('hr/contracts/dashboard-stats', {}),
  templates: (a: { status?: string; contractType?: string } = {}) => call<ContractTemplate[]>('hr/contracts/templates/list', a),

  create:    (a: CreateContractArgs)                  => call<CreateContractResult>('hr/contracts/create', a),
  issue:     (a: IssueContractArgs)                   => call<ContractLifecycleResult>('hr/contracts/issue', a),
  sign:      (a: RecordSignatureArgs)                 => call<{ signatoryRowId: string; status: string; contractStatus: string }>('hr/contracts/sign', a),
  activate:  (a: { contractId: string })              => call<ContractLifecycleResult>('hr/contracts/activate', a),
  renew:     (a: RenewContractArgs)                   => call<RenewContractResult>('hr/contracts/renew', a),
  terminate: (a: TerminateContractArgs)               => call<ContractLifecycleResult>('hr/contracts/terminate', a),
  cancel:    (a: CancelContractArgs)                  => call<ContractLifecycleResult>('hr/contracts/cancel', a),
  expireSweep: ()                                     => call<ExpireContractsResult>('hr/contracts/expire-sweep', {}),

  templateCreate: (a: CreateTemplateArgs)             => call<{ templateId: string; templateKey: string }>('hr/contracts/templates/create', a),
  templateUpdate: (a: UpdateTemplateArgs)             => call<{ templateId: string }>('hr/contracts/templates/update', a),
  templateRetire: (a: { templateId: string })         => call<{ templateId: string; status: 'retired' }>('hr/contracts/templates/retire', a),
};

export const contractKeys = {
  root:      ['hr', 'contracts'] as const,
  list:      (f: ContractFilters = {}) => ['hr', 'contracts', 'list', f] as const,
  contract:  (id: string)              => ['hr', 'contracts', 'contract', id] as const,
  stats:     ['hr', 'contracts', 'stats'] as const,
  templates: (o: object = {})          => ['hr', 'contracts', 'templates', o] as const,
};

export function useContracts(filters: ContractFilters = {}) {
  return useQuery({ queryKey: contractKeys.list(filters), queryFn: () => hrContractsApi.list(filters) });
}
export function useContract(contractId: string | null) {
  return useQuery({ queryKey: contractKeys.contract(contractId ?? ''), queryFn: () => hrContractsApi.get(contractId as string), enabled: !!contractId });
}
export function useContractStats() {
  return useQuery({ queryKey: contractKeys.stats, queryFn: () => hrContractsApi.stats() });
}
export function useContractTemplates(opts: { status?: string; contractType?: string } = {}) {
  return useQuery({ queryKey: contractKeys.templates(opts), queryFn: () => hrContractsApi.templates(opts) });
}

/** Generic contracts mutation hook — invalidates the whole contracts tree. */
export function useContractMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractKeys.root });
      void qc.invalidateQueries({ queryKey: ['hr', 'employees'] });
    },
  });
}
