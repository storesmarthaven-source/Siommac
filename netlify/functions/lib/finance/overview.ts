// ============================================================================
// Finance -- Overview dashboard (read-only aggregation)
// ============================================================================
// Aggregates KPIs, an approvals queue, upcoming deadlines and recent activity
// across the existing finance surface (expenses, budgets, disbursements,
// remittances) plus Accounts Payable. No writes; every number traces to a
// real row -- no placeholder/fake values.
//
// NOTE: "Period close" is a General Ledger concept (journals aren't posted
// yet -- GL ships in a later wave). Rather than fake a close-percentage, this
// surfaces "approvals aging" (share of pending approvals still within the
// 48h SLA) as the rail donut -- real data, honest meaning.

import { sb } from '../db';

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

export interface CostCentreBurn {
  name: string;
  actual: number;
  budgeted: number;
  percentOfTotal: number;
}

export interface ApprovalQueueItem {
  type: 'Bill' | 'Expense' | 'Remittance' | 'Disbursement';
  ref: string;
  party: string;
  amount: number;
  requestedBy: string | null;
  ageDays: number;
  route: string;
  id: string;
}

export interface FinanceDeadline {
  date: string;
  title: string;
  meta: string;
}

export interface FinanceActivityItem {
  icon: string;
  title: string;
  actorLabel: string;
  createdAt: string;
}

export interface ApprovalsAging {
  withinSla: number;
  overdue: number;
  totalPending: number;
  percentWithinSla: number;
}

export interface FinanceOverviewData {
  kpis: FinanceOverviewKpis;
  costCentreBurn: CostCentreBurn[];
  approvalsQueue: ApprovalQueueItem[];
  deadlines: FinanceDeadline[];
  activity: FinanceActivityItem[];
  approvalsAging: ApprovalsAging;
  spendTrend: { labels: string[]; spend: number[]; budget: number[] };
}

const HIGH_VALUE_THRESHOLD = 15000;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthBounds(offsetMonths: number): { start: string; end: string; label: string; year: number; month: number } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offsetMonths;
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: MONTH_LABELS[start.getUTCMonth()]!, year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 };
}

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

async function monthSpend(start: string, end: string): Promise<number> {
  const [expenses, disbursements, bills] = await Promise.all([
    sb.from('finance_expense_claims').select('total_amount')
      .in('status', ['approved', 'reimbursed']).gte('expense_date', start).lt('expense_date', end),
    sb.from('finance_disbursements').select('total_amount')
      .in('status', ['approved', 'file_generated', 'paid']).gte('created_at', start).lt('created_at', end),
    sb.from('finance_ap_bills').select('total_amount')
      .in('status', ['approved', 'partially_paid', 'paid']).gte('bill_date', start).lt('bill_date', end),
  ]);
  const sum = (rows: Array<{ total_amount: string | number | null }> | null): number =>
    (rows ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  return sum(expenses.data as never) + sum(disbursements.data as never) + sum(bills.data as never);
}

export async function getFinanceOverview(): Promise<FinanceOverviewData> {
  const now = new Date();
  const nowIso = now.toISOString();
  const fiscalYear = now.getUTCFullYear();
  const thisMonth = monthBounds(0);
  const lastMonth = monthBounds(-1);

  // 6-month trend window (5 prior months + current)
  const trendWindows = Array.from({ length: 6 }, (_, i) => monthBounds(i - 5));

  const [
    spendThisMonth, spendLastMonth, trendSpend,
    budgetLinesRes,
    disbursementsThisMonth, disbursementsLastMonth,
    submittedExpenses, submittedBills, submittedRemittances, submittedDisbursements,
    upcomingRemittances, upcomingBills,
    recentEvents,
  ] = await Promise.all([
    monthSpend(thisMonth.start, thisMonth.end),
    monthSpend(lastMonth.start, lastMonth.end),
    Promise.all(trendWindows.map(w => monthSpend(w.start, w.end))),
    sb.from('finance_budget_lines').select('actual, budgeted, cost_center_id, finance_cost_centers(name)').eq('fiscal_year', fiscalYear),
    sb.from('finance_disbursements').select('total_amount').in('status', ['approved', 'file_generated', 'paid']).gte('created_at', thisMonth.start).lt('created_at', thisMonth.end),
    sb.from('finance_disbursements').select('total_amount').in('status', ['approved', 'file_generated', 'paid']).gte('created_at', lastMonth.start).lt('created_at', lastMonth.end),
    sb.from('finance_expense_claims').select('id, claim_no, title, total_amount, claimant_id, created_at').eq('status', 'submitted').order('created_at', { ascending: true }).limit(10),
    sb.from('finance_ap_bills').select('id, bill_no, total_amount, created_by, created_at, finance_ap_vendors(name)').eq('status', 'submitted').order('created_at', { ascending: true }).limit(10),
    sb.from('finance_remittances').select('id, remittance_no, total_due, authority, created_by, created_at').eq('status', 'submitted').order('created_at', { ascending: true }).limit(10),
    sb.from('finance_disbursements').select('id, disbursement_no, total_amount, created_by, created_at').eq('status', 'submitted').order('created_at', { ascending: true }).limit(10),
    sb.from('finance_remittances').select('remittance_no, authority, total_due, due_date').not('status', 'in', '(paid,filed,cancelled)').not('due_date', 'is', null).gte('due_date', nowIso.slice(0, 10)).order('due_date', { ascending: true }).limit(6),
    sb.from('finance_ap_bills').select('bill_no, total_amount, due_date, finance_ap_vendors(name)').not('status', 'in', '(paid,void,draft)').not('due_date', 'is', null).order('due_date', { ascending: true }).limit(6),
    sb.from('app_events').select('event_type, source_module, payload, created_at').in('source_module', ['finance', 'finance_ap', 'finance_expenses', 'finance_budgets', 'finance_disbursements', 'finance_remittances']).order('created_at', { ascending: false }).limit(8),
  ]);

  // ── Cost centre burn (top 4) ────────────────────────────────────────────
  const ccRows = (budgetLinesRes.data ?? []) as Array<{ actual: string | number; budgeted: string | number; finance_cost_centers: { name: string } | { name: string }[] | null }>;
  const ccMap = new Map<string, { actual: number; budgeted: number }>();
  for (const r of ccRows) {
    const nameRaw = Array.isArray(r.finance_cost_centers) ? r.finance_cost_centers[0]?.name : r.finance_cost_centers?.name;
    const name = nameRaw ?? 'Unassigned';
    const entry = ccMap.get(name) ?? { actual: 0, budgeted: 0 };
    entry.actual += Number(r.actual ?? 0);
    entry.budgeted += Number(r.budgeted ?? 0);
    ccMap.set(name, entry);
  }
  const totalActual = Array.from(ccMap.values()).reduce((s, v) => s + v.actual, 0);
  const costCentreBurn: CostCentreBurn[] = Array.from(ccMap.entries())
    .map(([name, v]) => ({ name, actual: v.actual, budgeted: v.budgeted, percentOfTotal: totalActual > 0 ? Math.round((v.actual / totalActual) * 100) : 0 }))
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 4);

  const totalBudgeted = ccRows.reduce((s, r) => s + Number(r.budgeted ?? 0), 0);
  const budgetVariance = totalActual - totalBudgeted;

  // ── Approvals queue (merge 4 sources, sort by age, cap 8) ───────────────
  const nowMs = now.getTime();
  const ageDays = (iso: string): number => Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000));

  const queue: ApprovalQueueItem[] = [
    ...((submittedExpenses.data ?? []) as Array<{ id: string; claim_no: string; title: string; total_amount: string | number; claimant_id: string | null; created_at: string }>)
      .map(r => ({ type: 'Expense' as const, ref: r.claim_no, party: r.title, amount: Number(r.total_amount), requestedBy: r.claimant_id, ageDays: ageDays(r.created_at), route: 's-finance-expenses', id: r.id })),
    ...((submittedBills.data ?? []) as Array<{ id: string; bill_no: string; total_amount: string | number; created_by: string | null; created_at: string; finance_ap_vendors: { name: string } | { name: string }[] | null }>)
      .map(r => ({ type: 'Bill' as const, ref: r.bill_no, party: Array.isArray(r.finance_ap_vendors) ? (r.finance_ap_vendors[0]?.name ?? '—') : (r.finance_ap_vendors?.name ?? '—'), amount: Number(r.total_amount), requestedBy: r.created_by, ageDays: ageDays(r.created_at), route: 's-finance-payables', id: r.id })),
    ...((submittedRemittances.data ?? []) as Array<{ id: string; remittance_no: string; total_due: string | number; authority: string; created_by: string | null; created_at: string }>)
      .map(r => ({ type: 'Remittance' as const, ref: r.remittance_no, party: r.authority, amount: Number(r.total_due), requestedBy: r.created_by, ageDays: ageDays(r.created_at), route: 's-finance-remittances', id: r.id })),
    ...((submittedDisbursements.data ?? []) as Array<{ id: string; disbursement_no: string; total_amount: string | number; created_by: string | null; created_at: string }>)
      .map(r => ({ type: 'Disbursement' as const, ref: r.disbursement_no, party: 'Payroll disbursement', amount: Number(r.total_amount), requestedBy: r.created_by, ageDays: ageDays(r.created_at), route: 's-finance-disbursements', id: r.id })),
  ].sort((a, b) => b.ageDays - a.ageDays).slice(0, 8);

  const pendingApprovalsAmount = queue.reduce((s, q) => s + q.amount, 0);
  const pendingApprovalsHighValueCount = queue.filter(q => q.amount >= HIGH_VALUE_THRESHOLD).length;

  // ── Approvals aging (real "period-close"-style donut substitute) ───────
  const withinSla = queue.filter(q => q.ageDays <= 2).length;
  const overdue = queue.length - withinSla;
  const approvalsAging: ApprovalsAging = {
    withinSla, overdue, totalPending: queue.length,
    percentWithinSla: queue.length > 0 ? Math.round((withinSla / queue.length) * 100) : 100,
  };

  // ── Deadlines (remittances + bills due, merged, soonest 4) ──────────────
  const deadlineRows: FinanceDeadline[] = [
    ...((upcomingRemittances.data ?? []) as Array<{ remittance_no: string; authority: string; total_due: string | number; due_date: string }>)
      .map(r => ({ date: r.due_date, title: `${r.authority.replace(/_/g, ' ').toUpperCase()} remittance`, meta: `$${Number(r.total_due).toLocaleString()} · ${r.remittance_no}` })),
    ...((upcomingBills.data ?? []) as Array<{ bill_no: string; total_amount: string | number; due_date: string; finance_ap_vendors: { name: string } | { name: string }[] | null }>)
      .map(r => ({ date: r.due_date, title: `${Array.isArray(r.finance_ap_vendors) ? (r.finance_ap_vendors[0]?.name ?? 'Vendor') : (r.finance_ap_vendors?.name ?? 'Vendor')} due`, meta: `$${Number(r.total_amount).toLocaleString()} · ${r.bill_no}` })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);

  // ── Recent activity ──────────────────────────────────────────────────────
  const activity: FinanceActivityItem[] = ((recentEvents.data ?? []) as Array<{ event_type: string; source_module: string; payload: Record<string, unknown>; created_at: string }>)
    .map(e => ({
      icon: e.event_type.includes('approv') ? 'fa-check' : e.event_type.includes('paid') || e.event_type.includes('payment') ? 'fa-money-check-dollar' : e.event_type.includes('creat') || e.event_type.includes('submit') ? 'fa-file-circle-plus' : 'fa-circle-info',
      title: humanizeEvent(e.event_type, e.payload),
      actorLabel: e.source_module.replace(/_/g, ' '),
      createdAt: e.created_at,
    }));

  return {
    kpis: {
      spendMtd: spendThisMonth,
      spendMtdDeltaPct: pctDelta(spendThisMonth, spendLastMonth),
      pendingApprovalsCount: queue.length,
      pendingApprovalsAmount,
      pendingApprovalsHighValueCount,
      budgetVariance,
      budgetVariancePct: totalBudgeted > 0 ? (budgetVariance / totalBudgeted) * 100 : null,
      cashOutMtd: sumAmount(disbursementsThisMonth.data as never),
      cashOutDeltaPct: pctDelta(sumAmount(disbursementsThisMonth.data as never), sumAmount(disbursementsLastMonth.data as never)),
    },
    costCentreBurn,
    approvalsQueue: queue,
    deadlines: deadlineRows,
    activity,
    approvalsAging,
    spendTrend: {
      labels: trendWindows.map(w => w.label),
      spend: trendSpend,
      budget: trendWindows.map(() => totalBudgeted / 6),
    },
  };
}

function sumAmount(rows: Array<{ total_amount: string | number | null }> | null): number {
  return (rows ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
}

function humanizeEvent(eventType: string, payload: Record<string, unknown>): string {
  const ref = (payload.ref ?? payload.billNo ?? payload.claimNo ?? payload.remittanceNo ?? payload.disbursementNo ?? '') as string;
  const action = eventType.split('.').pop() ?? eventType;
  return `${ref ? ref + ' ' : ''}${action.replace(/_/g, ' ')}`;
}
