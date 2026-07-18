/**
 * src/api/finance/pickers.ts
 *
 * TanStack Query hook for the shared Finance cost-centre picker.
 *
 * Results are stale-while-revalidate (5 min staleTime) since cost-centre
 * configuration changes infrequently.
 */

import { useQuery, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { financeQueryKeys } from './keys';

const STALE_5M = 5 * 60_000;

// ── DTO types (mirror backend pickers.ts) ─────────────────────────────────────

export interface CostCentreOption {
  id: string;
  code: string;
  name: string;
  department?: string | null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function post<T>(path: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(path, args, signal ? { signal } : undefined);
  if (!res.success) throw new Error((res as { message?: string }).message ?? 'Request failed');
  return res.data;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** Cost centres, optionally filtered by search string. */
export function useCostCentres(search?: string) {
  return useQuery({
    queryKey: financeQueryKeys.pickerCostCentres(search),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<CostCentreOption[]>('finance/pickers/cost-centres', search ? { search } : {}, signal),
    staleTime: STALE_5M,
  });
}
