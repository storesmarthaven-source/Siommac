// Payroll Runs Register (F-03, spec §15.2) — frontend API.
// Backend: financePayroll routes runs/list (keyset+tabs+filters), run-views/*,
// runs/calendar (all live + E2E-verified). Shared DTOs live in root types/payrollRuns.

import { useMutation, useQuery, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  PayrollRunListPageRequest,
  PayrollRunListResult,
  PayrollRunView,
  PayrollRunViewCreateRequest,
  PayrollRunViewUpdateRequest,
  PayrollRunCalendarRequest,
  PayrollRunCalendarResult,
} from '../../../types/payrollRuns';

export type * from '../../../types/payrollRuns';

async function post<T>(path: string, args: object): Promise<T> {
  const r = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!r.success) throw new Error(r.message ?? 'Payroll runs register request failed.');
  return r.data;
}

export const runsRegisterKeys = {
  all:      ['finance', 'payroll', 'runs-register'] as const,
  list:     (req: PayrollRunListPageRequest) => ['finance', 'payroll', 'runs-register', 'list', req] as const,
  views:    ['finance', 'payroll', 'runs-register', 'views'] as const,
  calendar: (req: PayrollRunCalendarRequest) => ['finance', 'payroll', 'runs-register', 'calendar', req] as const,
};

export const runsRegisterApi = {
  list:       (req: PayrollRunListPageRequest) => post<PayrollRunListResult>('finance/payroll/runs/list', req),
  viewsList:  () => post<PayrollRunView[]>('finance/payroll/run-views/list', {}),
  viewCreate: (req: PayrollRunViewCreateRequest) => post<PayrollRunView>('finance/payroll/run-views/create', req),
  viewUpdate: (req: PayrollRunViewUpdateRequest) => post<PayrollRunView>('finance/payroll/run-views/update', req),
  viewDelete: (id: string) => post<{ id: string }>('finance/payroll/run-views/delete', { id }),
  calendar:   (req: PayrollRunCalendarRequest) => post<PayrollRunCalendarResult>('finance/payroll/runs/calendar', req),
};

// ── Query hooks ─────────────────────────────────────────────────────────────────

/** Keyset register list. Pass the full request (filters + tab + cursor); each distinct
 *  request is its own cache key, so tab/filter changes refetch cleanly. */
export function useRunsRegister(req: PayrollRunListPageRequest, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey:       runsRegisterKeys.list(req),
    queryFn:        () => runsRegisterApi.list(req),
    enabled:        opts.enabled ?? true,
    placeholderData: prev => prev,   // keep the current page visible while the next loads
  });
}

export function useRunViews() {
  return useQuery({ queryKey: runsRegisterKeys.views, queryFn: () => runsRegisterApi.viewsList() });
}

export function useRunCalendar(req: PayrollRunCalendarRequest, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: runsRegisterKeys.calendar(req),
    queryFn:  () => runsRegisterApi.calendar(req),
    enabled:  opts.enabled ?? true,
  });
}

// ── Saved-view mutations (invalidate the views list) ────────────────────────────

export function useRunViewMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: runsRegisterKeys.views });
  return {
    create: useMutation({ mutationFn: runsRegisterApi.viewCreate, onSuccess: invalidate }),
    update: useMutation({ mutationFn: runsRegisterApi.viewUpdate, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: runsRegisterApi.viewDelete, onSuccess: invalidate }),
  };
}
