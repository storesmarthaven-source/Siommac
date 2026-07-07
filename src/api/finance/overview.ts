/**
 * src/api/finance/overview.ts
 *
 * TanStack Query hooks for the Finance Overview dashboard.
 * Covers: summary, export (Chunk 9), KPI drill-through (Chunk 10),
 * approvals inbox (Chunk 11), spend-budget series (Chunk 13-chart).
 */

import { useQuery, useMutation, useQueryClient, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { financeQueryKeys } from './keys';

// ── Shared DTOs ───────────────────────────────────────────────────────────────

export interface FinanceOverviewKpis {
  spendMtd: number;
  spendMtdDeltaPct: number | null;
  pendingApprovalsCount: number;
  pendingApprovalsAmount: number;
  pendingApprovalsHighValueCount: number;
  budgetVariance: number;
  budgetVariancePct: number | null;
  cashOutMtd: number;
  cashOutDeltaPct: number | null;
}

export interface CostCentreBurn { name: string; actual: number; budgeted: number; percentOfTotal: number; }

export interface ApprovalQueueItem {
  type: 'Bill' | 'Expense' | 'Remittance' | 'Disbursement';
  ref: string; party: string; amount: number; requestedBy: string | null; ageDays: number; route: string; id: string;
}

export interface FinanceDeadline { date: string; title: string; meta: string; }
export interface FinanceActivityItem { icon: string; title: string; actorLabel: string; createdAt: string; }
export interface ApprovalsAging { withinSla: number; overdue: number; totalPending: number; percentWithinSla: number; }

export interface FinanceOverviewData {
  kpis: FinanceOverviewKpis;
  costCentreBurn: CostCentreBurn[];
  approvalsQueue: ApprovalQueueItem[];
  deadlines: FinanceDeadline[];
  activity: FinanceActivityItem[];
  approvalsAging: ApprovalsAging;
  spendTrend: { labels: string[]; spend: number[]; budget: number[] };
}

// ── Shared post helper ────────────────────────────────────────────────────────

async function post<T>(path: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(path, args, signal ? { signal } : undefined);
  if (!res.success) throw new Error((res as { message?: string }).message ?? 'Request failed');
  return res.data;
}

// ── Overview summary ──────────────────────────────────────────────────────────

export function useFinanceOverview() {
  return useQuery({
    queryKey: financeQueryKeys.overview(),
    queryFn: async ({ signal }: QueryFunctionContext) =>
      post<FinanceOverviewData>('finance/overview/summary', {}, signal),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

// ── Chunk 9 — Export ─────────────────────────────────────────────────────────

export type ExportType = 'dashboard' | 'approvals' | 'spend-budget' | 'cost-centre' | 'all';

export interface ExportResult {
  csv: string;
  filename: string;
  rowCount: number;
}

export function useExportOverview() {
  return useMutation({
    mutationFn: (args: { type?: ExportType }) =>
      post<ExportResult>('finance/overview/export', { type: args.type ?? 'all' }),
  });
}

// ── Chunk 10 — KPI Drill-through ─────────────────────────────────────────────

export type KpiType = 'spend' | 'pending-approvals' | 'budget-variance' | 'cash-out';

export interface KpiDrilldownRow {
  id: string; ref: string; type: string; party: string;
  amount: number; date: string; status: string; module: string; route: string;
}

export interface KpiDrilldownResult {
  kpiType: KpiType;
  period: string;
  title: string;
  rows: KpiDrilldownRow[];
  total: number;
}

export function useKpiDrilldown(kpiType: KpiType | null, period: string = 'mtd') {
  return useQuery({
    queryKey: financeQueryKeys.overviewKpiDrilldown(kpiType ?? '', period),
    enabled: !!kpiType,
    queryFn: ({ signal }: QueryFunctionContext) =>
      post<KpiDrilldownResult>('finance/overview/kpi-drilldown', { kpiType, period }, signal),
    staleTime: 60_000,
  });
}

// ── Chunk 11 — Approvals Inbox ────────────────────────────────────────────────

export interface ApprovalsQueueItemV2 {
  type: 'Bill' | 'Expense' | 'Remittance' | 'Disbursement';
  ref: string; party: string; amount: number; requestedBy: string | null;
  ageDays: number; route: string; id: string;
  userCanApprove: boolean;
  canReject: boolean;
  createdBy: string | null;
}

export interface ApprovalsQueueFilters extends Record<string, unknown> {
  type?: 'Bill' | 'Expense' | 'Remittance' | 'Disbursement';
  minAgeDays?: number;
  minAmount?: number;
  priority?: 'high' | 'normal';
}

export function useApprovalsQueue(filters: ApprovalsQueueFilters = {}) {
  return useQuery({
    queryKey: financeQueryKeys.overviewApprovalsQueue(filters),
    queryFn: ({ signal }: QueryFunctionContext) =>
      post<ApprovalsQueueItemV2[]>('finance/overview/approvals/list', filters, signal),
    staleTime: 30_000,
  });
}

export interface ActOnApprovalArgs extends Record<string, unknown> {
  id: string;
  type: 'Bill' | 'Expense' | 'Remittance' | 'Disbursement';
  action: 'approve' | 'reject';
  reason?: string;
}

export function useActOnApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ActOnApprovalArgs) =>
      post<{ ref: string; status: string }>('finance/overview/approvals/act', args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: financeQueryKeys.overviewBase() });
      void qc.invalidateQueries({ queryKey: financeQueryKeys.apBase() });
    },
  });
}

// ── Chunk 13-chart — Spend vs Budget series ───────────────────────────────────

export type SpendBudgetPeriod = 'MTD' | 'Monthly' | 'Quarterly';

export interface SpendBudgetSeries {
  labels: string[];
  spend: number[];
  budget: number[];
  forecast: number[];
  forecastFromIndex: number;
}

export function useSpendBudgetSeries(period: SpendBudgetPeriod = 'Monthly') {
  return useQuery({
    queryKey: ['finance', 'overview', 'spend-budget-series', period] as const,
    queryFn: ({ signal }: QueryFunctionContext) =>
      post<SpendBudgetSeries>('finance/overview/spend-budget-series', { period }, signal),
    staleTime: 60_000,
  });
}
