/**
 * src/api/finance/lookups.ts
 *
 * TanStack Query hooks for Finance Wave 2B shared lookup endpoints.
 *
 * Hooks exported:
 *   useEmployeeNames(ids)      — bulk-resolve employee IDs → display info (Map)
 *   useEmployeePicker(search)  — employee combobox search
 *   useCostCentrePicker(search)— re-export from pickers.ts (avoids duplication)
 *   useApprovedRunPicker(s)    — approved payroll run combobox
 *   useAuthorityPicker()       — static remittance authority list
 *
 * Picker lists: 5 min staleTime (config changes rarely).
 * Name resolution: 1 min staleTime (names change rarely but can change).
 */

import { useQuery, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { financeQueryKeys } from './keys';

// Re-export cost-centres from existing pickers hook — no duplication.
export { useCostCentres as useCostCentrePicker } from './pickers';

const STALE_5M = 5 * 60_000;
const STALE_1M = 1 * 60_000;

// ── DTO types (mirror backend lib/finance/lookups.ts exactly) ─────────────────

export interface EmployeeResolved {
  /** TEXT (app_users.id) */
  id: string;
  fullName: string;
  employeeNo: string | null;
  department: string | null;
  position: string | null;
  /** Public avatar URL, or null → the cell renders initials. */
  imageUrl: string | null;
}

export interface EmployeePickerOption {
  /** TEXT (app_users.id) */
  id: string;
  fullName: string;
  employeeNo: string | null;
  position: string | null;
  status: string;
}

export interface PayrollRunPickerOption {
  id: string;
  runNo: string;
  periodMonth: string; // YYYY-MM-DD
  payFrequency: string;
  status: string;
  employeeCount: number;
  netTotal: number;
}

export interface AuthorityOption {
  value: 'paye_bir' | 'nis_nibtt' | 'health_surcharge';
  label: string;
  description: string;
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function post<T>(
  path: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(
    path,
    args,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error((res as { message?: string }).message ?? 'Request failed');
  return res.data;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Bulk-resolve employee IDs (TEXT, app_users.id) to display info.
 *
 * Returns an object with `data` (Map<id, EmployeeResolved> | undefined).
 * When ids is empty, the query is disabled and data is an empty Map.
 *
 * Usage in a table — batch all IDs at the table level:
 *   const { data: nameMap } = useEmployeeNames(rows.map(r => r.employeeId));
 *   // Then per row:
 *   const resolved = nameMap?.get(row.employeeId);
 */
export function useEmployeeNames(ids: string[]): {
  data: Map<string, EmployeeResolved> | undefined;
  isLoading: boolean;
  error: unknown;
} {
  // Sort once so the same logical set always maps to the same cache key
  const sorted = [...ids].sort();

  const query = useQuery({
    queryKey:  financeQueryKeys.lookupEmployeeNames(sorted),
    queryFn:   async ({ signal }: QueryFunctionContext) => {
      if (sorted.length === 0) return [] as EmployeeResolved[];
      return post<EmployeeResolved[]>(
        'finance/lookups/resolve-employees',
        { ids: sorted },
        signal,
      );
    },
    staleTime: STALE_1M,
    enabled:   ids.length > 0,
  });

  const data: Map<string, EmployeeResolved> | undefined = query.data
    ? new Map(query.data.map(e => [e.id, e]))
    : undefined;

  return { data, isLoading: query.isLoading, error: query.error };
}

/** Employee combobox search — used in bank-account forms, expense allocation, etc. */
export function useEmployeePicker(search?: string) {
  return useQuery({
    queryKey: financeQueryKeys.pickerEmployees(search),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<EmployeePickerOption[]>(
        'finance/lookups/employees',
        search ? { search } : {},
        signal,
      ),
    staleTime: STALE_5M,
  });
}

/** Approved/locked/exported payroll runs for the run-picker in Remittances + Disbursements. */
export function useApprovedRunPicker(search?: string) {
  return useQuery({
    queryKey: financeQueryKeys.pickerApprovedRuns(search),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<PayrollRunPickerOption[]>(
        'finance/lookups/approved-payroll-runs',
        search ? { search } : {},
        signal,
      ),
    staleTime: STALE_5M,
  });
}

/** Static remittance authority list (PAYE-BIR / NIS-NIBTT / Health Surcharge). */
export function useAuthorityPicker() {
  return useQuery({
    queryKey: financeQueryKeys.pickerAuthorities(),
    queryFn:  ({ signal }: QueryFunctionContext) =>
      post<AuthorityOption[]>('finance/lookups/authorities', {}, signal),
    staleTime: STALE_5M,
  });
}
