/**
 * src/api/finance/bankAccounts.ts
 *
 * Typed client + TanStack hooks for the Finance Employee Bank Accounts backend.
 * The full account number is NEVER returned by the backend; only accountNumberMasked.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// DTOs (masked -- no account_number field)

export interface BankAccount {
  id: string;
  employeeId: string;
  bankName: string;
  branch: string | null;
  accountType: 'savings' | 'chequing';
  accountNumberMasked: string;
  transitNumber: string | null;
  isPrimary: boolean;
  isActive: boolean;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBankAccountArgs {
  id?: string;
  employeeId?: string;
  bankName: string;
  branch?: string | null;
  accountType: 'savings' | 'chequing';
  accountNumber: string;
  transitNumber?: string | null;
  isPrimary?: boolean;
  metadata?: Record<string, unknown>;
}

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const financeBankAccountsApi = {
  list:       (a: { employeeId?: string; includeInactive?: boolean } = {}) =>
                call<BankAccount[]>('finance/bank-accounts/list', a),
  get:        (a: { id: string })   => call<BankAccount>('finance/bank-accounts/get', a),
  upsert:     (a: UpsertBankAccountArgs) => call<BankAccount>('finance/bank-accounts/upsert', a),
  deactivate: (a: { id: string })   => call<BankAccount>('finance/bank-accounts/deactivate', a),
};

export const financeBankAccountsKeys = {
  list:   (opts: object = {}) => ['finance', 'bank-accounts', 'list', opts] as const,
  single: (id: string)        => ['finance', 'bank-accounts', 'single', id] as const,
};

export function useBankAccounts(opts: { employeeId?: string; includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: financeBankAccountsKeys.list(opts),
    queryFn:  () => financeBankAccountsApi.list(opts),
  });
}

export function useBankAccount(id: string | null) {
  return useQuery({
    queryKey: financeBankAccountsKeys.single(id ?? ''),
    queryFn:  () => financeBankAccountsApi.get({ id: id! }),
    enabled:  !!id,
  });
}

export function useBankAccountMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'bank-accounts'] });
    },
  });
}
