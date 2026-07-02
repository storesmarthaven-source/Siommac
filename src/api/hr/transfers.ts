/**
 * src/api/hr/transfers.ts
 *
 * Typed client + TanStack hooks for HR Transfers & Promotions.
 * Routes in routes/hr.ts (POST `hr/transfers/*`, camelCase `body.args`).
 * Decide + cancel reuse the generic /employee-change-requests/* routes.
 *
 * call<T> throws on success:false — mirrors src/api/hr/offboarding.ts exactly.
 * apiPost returns the already-parsed body {success,data,message}; no .json() call.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  TransferRequestRow,
  SubmitTransferArgs,
  SubmitTransferResult,
  DecideTransferArgs,
  DecideTransferResult,
} from '../../../types/hrTransfers';

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const hrTransfersApi = {
  list: (a: { status?: string; employeeId?: string } = {}) =>
    call<TransferRequestRow[]>('hr/transfers/list', a),

  submit: (a: SubmitTransferArgs) =>
    call<SubmitTransferResult>('hr/transfers/request', a),

  /** Reuses the generic decide route — routed by CHANGE_PERM on the backend. */
  decide: (a: DecideTransferArgs) =>
    call<DecideTransferResult>('hr/employee-change-requests/decide', a),

  /** Cancel — reuses the generic cancel route. */
  cancel: (a: { requestId: string }) =>
    call<{ success: boolean }>('hr/employee-change-requests/cancel', a),
};

export const transferKeys = {
  root: ['hr', 'transfers'] as const,
  list: (s?: string) => ['hr', 'transfers', 'list', s ?? 'all'] as const,
};

export function useTransfers(status?: string) {
  return useQuery({
    queryKey:    transferKeys.list(status),
    queryFn:     () => hrTransfersApi.list(status ? { status } : {}),
    placeholderData: (prev) => prev,
  });
}

/** Generic transfers mutation hook — invalidates the transfers tree + employees. */
export function useTransfersMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: transferKeys.root });
      void qc.invalidateQueries({ queryKey: ['hr', 'employees'] });
    },
  });
}
