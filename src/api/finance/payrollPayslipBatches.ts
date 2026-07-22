// Payslip Batches register (F-10, spec §15.5) — frontend API.
// Backend: finance/payroll/payslip-batches/list (read model over per-run payslips;
// a batch = a locked run's payslip set). Shared DTOs in root types/payrollPayslipBatches.

import { useQuery } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  PayslipBatchListRequest,
  PayslipBatchListResult,
} from '../../../types/payrollPayslipBatches';

export type * from '../../../types/payrollPayslipBatches';

async function post<T>(path: string, args: object): Promise<T> {
  const r = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!r.success) throw new Error(r.message ?? 'Payslip batches request failed.');
  return r.data;
}

export const payslipBatchesKeys = {
  all:  ['finance', 'payroll', 'payslip-batches'] as const,
  list: (req: PayslipBatchListRequest) => ['finance', 'payroll', 'payslip-batches', 'list', req] as const,
};

export const payslipBatchesApi = {
  list: (req: PayslipBatchListRequest) => post<PayslipBatchListResult>('finance/payroll/payslip-batches/list', req),
};

/** The batch register list. Each distinct request is its own cache key; keep the current
 *  page visible while the next loads. */
export function usePayslipBatches(req: PayslipBatchListRequest, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey:        payslipBatchesKeys.list(req),
    queryFn:         () => payslipBatchesApi.list(req),
    enabled:         opts.enabled ?? true,
    placeholderData: prev => prev,
  });
}
