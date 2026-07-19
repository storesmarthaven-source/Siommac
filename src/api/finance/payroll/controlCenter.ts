/**
 * src/api/finance/payroll/controlCenter.ts
 *
 * TanStack Query hook for the Payroll Command Center (approved contract §6).
 * ONE shared camelCase contract lives in `types/payrollControlCenter.ts` and is
 * imported by BOTH the backend service and this FE client — re-exported here so
 * the page/widgets import a single place.
 *
 * Endpoint: POST /api/finance/payroll/control-center/get  (pure read, no mutation).
 */
import { useQuery, keepPreviousData, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  PayrollControlCenterRequest,
  PayrollControlCenterResponse,
  PayrollRunRegisterTab,
} from '../../../../types/payrollControlCenter';

// Re-export the whole contract so page + widgets import from one module.
export type {
  PayrollRunRegisterTab,
  PayrollControlCenterRequest,
  PayrollControlCenterResponse,
  HealthState,
  ReadinessState,
  PayrollRunType,
  MoneyValue,
  PayrollControlCenterCapabilities,
  PayrollPortfolioHealth,
  PayrollCommandCenterKpis,
  PayrollAssignedWork,
  PayrollActivityItem,
  PayrollDeadlineItem,
  PayrollReadinessGate,
  PayrollRunRegisterItem,
  PayrollNextRun,
  PayrollRunRegisterPage,
} from '../../../../types/payrollControlCenter';

// ── Params ──────────────────────────────────────────────────────────────────

export interface PayrollControlCenterParams {
  window: { from: string; to: string };
  payGroupIds?: string[];
  register?: {
    tab?: PayrollRunRegisterTab;
    search?: string;
    cursor?: string;
    limit?: number;
  };
}

/** Default window: first day of the current month → last day of next month (contract §4). */
export function defaultControlCenterWindow(now = new Date()): { from: string; to: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0); // day 0 of month+2 = last day of month+1
  return { from: iso(from), to: iso(to) };
}

// ── Query key (normalized: window, sorted pay groups, tab, search, cursor, limit) ──

export function payrollControlCenterQueryKey(p: PayrollControlCenterParams) {
  const search = p.register?.search?.trim();
  return [
    'finance', 'payroll', 'controlCenter',
    {
      from: p.window.from,
      to: p.window.to,
      payGroupIds: [...new Set(p.payGroupIds ?? [])].sort(),
      tab: p.register?.tab ?? 'all',
      search: search?.length ? search : null,
      cursor: p.register?.cursor ?? null,
      limit: p.register?.limit ?? 10,
    },
  ] as const;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function post<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, body, signal ? { signal } : undefined);
  if (!res.success) throw new Error(res.message ?? 'Request failed');
  return res.data;
}

export async function getPayrollControlCenter(
  params: PayrollControlCenterParams,
  signal?: AbortSignal,
): Promise<PayrollControlCenterResponse> {
  const search = params.register?.search?.trim();
  const body: PayrollControlCenterRequest = {
    window: params.window,
    ...(params.payGroupIds?.length ? { payGroupIds: [...new Set(params.payGroupIds)] } : {}),
    register: {
      tab: params.register?.tab ?? 'all',
      ...(search?.length ? { search } : {}),
      ...(params.register?.cursor ? { cursor: params.register.cursor } : {}),
      limit: params.register?.limit ?? 10,
    },
  };
  return post<PayrollControlCenterResponse>('finance/payroll/control-center/get', body as unknown as Record<string, unknown>, signal);
}

/** True when the query error is a permission denial (drives the denied state). */
export function isControlCenterDenied(error: unknown): boolean {
  return error instanceof Error && /forbidden/i.test(error.message);
}

// Terminal errors we never auto-retry (401/403/422 surface via these messages).
function isTerminalError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /forbidden|unauthorized|session expired|invalid cursor|cursor|must be|may not|window/i.test(error.message);
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function usePayrollControlCenter(params: PayrollControlCenterParams) {
  return useQuery({
    queryKey: payrollControlCenterQueryKey(params),
    queryFn: ({ signal }: QueryFunctionContext) => getPayrollControlCenter(params, signal),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    // Poll every 30s, but ONLY while the document is visible (default background = off).
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    // Keep the prior register page visible while a cursor/tab/search changes.
    placeholderData: keepPreviousData,
    // Do not auto-retry 401 / 403 / 422 (denied or bad request); retry transient once.
    retry: (failureCount, error) => !isTerminalError(error) && failureCount < 1,
  });
}
