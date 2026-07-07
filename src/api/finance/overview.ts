/**
 * src/api/finance/overview.ts
 *
 * TanStack Query hook for the Finance Overview dashboard summary.
 */

import { useQuery, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

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

export function useFinanceOverview() {
  return useQuery({
    queryKey: ['finance', 'overview'] as const,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: FinanceOverviewData }>('finance/overview/summary', {}, { signal });
      if (!res.success) throw new Error((res as { message?: string }).message ?? 'Failed to load finance overview');
      return res.data;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
