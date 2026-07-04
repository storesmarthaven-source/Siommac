/**
 * src/api/finance/budgets.ts
 *
 * Typed client + TanStack hooks for Finance Budgeting & Budget-vs-Actual (F5).
 * Routes: POST finance/budgets/{list,get,upsert,delete,variance,reports/list,reports/run}
 * Envelope: body.args (apiPost wrapper). actorId derived server-side from JWT.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// -- DTOs

export interface BudgetLine {
  id: string;
  costCenterId: string;
  costCenterName: string | null;
  fiscalYear: number;
  category: string;
  label: string | null;
  notes: string | null;
  budgeted: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  currency: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface BudgetVarianceRow {
  costCenterId: string;
  costCenterName: string | null;
  category: string;
  fiscalYear: number;
  budgeted: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  currency: string;
}

export interface BudgetReportCatalogRow {
  key: string;
  label: string;
  description: string;
}

export interface UpsertBudgetLineArgs {
  costCenterId: string;
  fiscalYear: number;
  category: string;
  label?: string | null;
  notes?: string | null;
  budgeted: number;
  currency?: 'TTD';
}

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const financeBudgetsApi = {
  list:        (a: { costCenterId?: string; fiscalYear?: number; category?: string } = {}) =>
                 call<BudgetLine[]>('finance/budgets/list', a),
  get:         (a: { id: string }) => call<BudgetLine>('finance/budgets/get', a),
  upsert:      (a: UpsertBudgetLineArgs) => call<BudgetLine>('finance/budgets/upsert', a),
  delete:      (a: { id: string }) => call<{ id: string }>('finance/budgets/delete', a),
  variance:    (a: { fiscalYear: number; costCenterId?: string }) =>
                 call<BudgetVarianceRow[]>('finance/budgets/variance', a),
  listReports: () => call<BudgetReportCatalogRow[]>('finance/budgets/reports/list'),
  runReport:   (a: { reportKey: string; fiscalYear?: number; costCenterId?: string }) =>
                 call<BudgetLine[] | BudgetVarianceRow[]>('finance/budgets/reports/run', a),
};

export const financeBudgetsKeys = {
  list:     (o: object = {}) => ['finance', 'budgets', 'list', o] as const,
  line:     (id: string)     => ['finance', 'budgets', 'line', id] as const,
  variance: (o: object)      => ['finance', 'budgets', 'variance', o] as const,
  reports:  ()               => ['finance', 'budgets', 'reports'] as const,
};

export function useBudgets(opts: { costCenterId?: string; fiscalYear?: number; category?: string } = {}) {
  return useQuery({
    queryKey: financeBudgetsKeys.list(opts),
    queryFn:  () => financeBudgetsApi.list(opts),
  });
}

export function useBudgetVariance(fiscalYear: number, costCenterId?: string) {
  return useQuery({
    queryKey: financeBudgetsKeys.variance({ fiscalYear, costCenterId }),
    queryFn:  () => financeBudgetsApi.variance({ fiscalYear, costCenterId }),
  });
}

export function useBudgetReports() {
  return useQuery({
    queryKey: financeBudgetsKeys.reports(),
    queryFn:  () => financeBudgetsApi.listReports(),
  });
}

export function useBudgetMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance', 'budgets'] }); },
  });
}
