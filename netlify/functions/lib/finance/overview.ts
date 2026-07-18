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
import { emitAppEvent } from '../appEvents';
import { approveBill, rejectBill } from './accountsPayable';
import { approveExpenseClaim, rejectExpenseClaim } from './expenses';
import { approveRemittance } from './remittances';
import { approveDisbursement } from './disbursements';

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

// ============================================================================
// Chunk 9 — Export
// ============================================================================

export type ExportType = 'dashboard' | 'approvals' | 'spend-budget' | 'cost-centre' | 'all';

export interface ExportResult {
  csv: string;
  filename: string;
  rowCount: number;
}

function escCsv(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(','), ...rows.map(r => r.map(escCsv).join(','))].join('\n');
}

export async function exportFinanceOverview(
  type: ExportType,
  actorId: string,
): Promise<ExportResult> {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const data = await getFinanceOverview();

  let csv = '';
  let rowCount = 0;

  if (type === 'approvals' || type === 'all') {
    const headers = ['Type', 'Reference', 'Vendor/Claimant', 'Amount', 'Requested By', 'Age (Days)'];
    const rows = data.approvalsQueue.map(q => [q.type, q.ref, q.party, q.amount.toFixed(2), q.requestedBy ?? '', q.ageDays]);
    csv += (type === 'all' ? 'APPROVALS QUEUE\n' : '') + toCsv(headers, rows) + '\n\n';
    rowCount += rows.length;
  }
  if (type === 'spend-budget' || type === 'all') {
    const headers = ['Month', 'Spend', 'Budget'];
    const rows = data.spendTrend.labels.map((label, i) => [label, (data.spendTrend.spend[i] ?? 0).toFixed(2), (data.spendTrend.budget[i] ?? 0).toFixed(2)]);
    csv += (type === 'all' ? 'SPEND VS BUDGET\n' : '') + toCsv(headers, rows) + '\n\n';
    rowCount += rows.length;
  }
  if (type === 'cost-centre' || type === 'all') {
    const headers = ['Cost Centre', 'Actual', 'Budgeted', '% of Total'];
    const rows = data.costCentreBurn.map(cc => [cc.name, cc.actual.toFixed(2), cc.budgeted.toFixed(2), cc.percentOfTotal]);
    csv += (type === 'all' ? 'COST CENTRE BURN\n' : '') + toCsv(headers, rows) + '\n\n';
    rowCount += rows.length;
  }
  if (type === 'dashboard' || type === 'all') {
    const k = data.kpis;
    const headers = ['Metric', 'Value'];
    const rows: unknown[][] = [
      ['Spend MTD', k.spendMtd.toFixed(2)],
      ['Pending Approvals Count', k.pendingApprovalsCount],
      ['Pending Approvals Amount', k.pendingApprovalsAmount.toFixed(2)],
      ['Budget Variance', k.budgetVariance.toFixed(2)],
      ['Cash Out MTD', k.cashOutMtd.toFixed(2)],
    ];
    csv += (type === 'all' ? 'DASHBOARD SUMMARY\n' : '') + toCsv(headers, rows) + '\n\n';
    rowCount += rows.length;
  }

  const filename = `finance-overview-${type}-${date}.csv`;

  void emitAppEvent({
    eventType: 'finance.dashboard.exported',
    sourceModule: 'finance',
    sourceEntityType: 'finance_overview',
    sourceEntityId: `export-${date}`,
    actorUserId: actorId,
    severity: 'info',
    payload: { type, rowCount, filename },
  });

  return { csv: csv.trim(), filename, rowCount };
}

// ============================================================================
// Chunk 10 — KPI Drill-through
// ============================================================================

export type KpiType = 'spend' | 'pending-approvals' | 'budget-variance' | 'cash-out';

export interface KpiDrilldownRow {
  id: string;
  ref: string;
  type: string;
  party: string;
  amount: number;
  date: string;
  status: string;
  module: string;
  route: string;
}

export interface KpiDrilldownResult {
  kpiType: KpiType;
  period: string;
  title: string;
  rows: KpiDrilldownRow[];
  total: number;
}

export async function getFinanceKpiDrilldown(
  kpiType: KpiType,
  period: string = 'mtd',
  actorId: string,
): Promise<KpiDrilldownResult> {
  const now = new Date();
  const thisMonth = monthBounds(0);
  const lastMonth = monthBounds(-1);
  const fiscalYear = now.getUTCFullYear();

  let title = '';
  const rows: KpiDrilldownRow[] = [];

  if (kpiType === 'spend') {
    title = 'Spend MTD — All sources';
    const start = period === 'mtd' ? thisMonth.start : lastMonth.start;
    const end   = period === 'mtd' ? thisMonth.end   : lastMonth.end;

    const [expenses, disbursements, bills] = await Promise.all([
      sb.from('finance_expense_claims').select('id, claim_no, title, total_amount, status, expense_date, claimant_id')
        .in('status', ['approved', 'reimbursed']).gte('expense_date', start).lt('expense_date', end).limit(50),
      sb.from('finance_disbursements').select('id, disbursement_no, total_amount, status, created_at')
        .in('status', ['approved', 'file_generated', 'paid']).gte('created_at', start).lt('created_at', end).limit(50),
      sb.from('finance_ap_bills').select('id, bill_no, total_amount, status, bill_date, finance_ap_vendors(name)')
        .in('status', ['approved', 'partially_paid', 'paid']).gte('bill_date', start).lt('bill_date', end).limit(50),
    ]);

    for (const r of (expenses.data ?? []) as Array<{ id: string; claim_no: string; title: string; total_amount: string; status: string; expense_date: string; claimant_id: string | null }>) {
      rows.push({ id: r.id, ref: r.claim_no, type: 'Expense', party: r.title, amount: Number(r.total_amount), date: r.expense_date, status: r.status, module: 'Expenses', route: 's-finance-expenses' });
    }
    for (const r of (disbursements.data ?? []) as Array<{ id: string; disbursement_no: string; total_amount: string; status: string; created_at: string }>) {
      rows.push({ id: r.id, ref: r.disbursement_no, type: 'Disbursement', party: 'Payroll disbursement', amount: Number(r.total_amount), date: r.created_at.slice(0, 10), status: r.status, module: 'Disbursements', route: 's-finance-disbursements' });
    }
    for (const r of (bills.data ?? []) as Array<{ id: string; bill_no: string; total_amount: string; status: string; bill_date: string; finance_ap_vendors: { name: string } | { name: string }[] | null }>) {
      const vendorName = Array.isArray(r.finance_ap_vendors) ? (r.finance_ap_vendors[0]?.name ?? '—') : (r.finance_ap_vendors?.name ?? '—');
      rows.push({ id: r.id, ref: r.bill_no, type: 'Bill', party: vendorName, amount: Number(r.total_amount), date: r.bill_date, status: r.status, module: 'Payables', route: 's-finance-payables' });
    }

  } else if (kpiType === 'pending-approvals') {
    title = 'Pending Approvals';
    const [submittedExpenses, submittedBills, submittedRemittances, submittedDisbursements] = await Promise.all([
      sb.from('finance_expense_claims').select('id, claim_no, title, total_amount, claimant_id, created_at').eq('status', 'submitted').limit(50),
      sb.from('finance_ap_bills').select('id, bill_no, total_amount, created_by, created_at, finance_ap_vendors(name)').eq('status', 'submitted').limit(50),
      sb.from('finance_remittances').select('id, remittance_no, total_due, authority, created_by, created_at').eq('status', 'submitted').limit(50),
      sb.from('finance_disbursements').select('id, disbursement_no, total_amount, created_by, created_at').eq('status', 'submitted').limit(50),
    ]);
    for (const r of (submittedExpenses.data ?? []) as Array<{ id: string; claim_no: string; title: string; total_amount: string; created_at: string }>) {
      rows.push({ id: r.id, ref: r.claim_no, type: 'Expense', party: r.title, amount: Number(r.total_amount), date: r.created_at.slice(0, 10), status: 'submitted', module: 'Expenses', route: 's-finance-expenses' });
    }
    for (const r of (submittedBills.data ?? []) as Array<{ id: string; bill_no: string; total_amount: string; created_at: string; finance_ap_vendors: { name: string } | { name: string }[] | null }>) {
      const vn = Array.isArray(r.finance_ap_vendors) ? (r.finance_ap_vendors[0]?.name ?? '—') : (r.finance_ap_vendors?.name ?? '—');
      rows.push({ id: r.id, ref: r.bill_no, type: 'Bill', party: vn, amount: Number(r.total_amount), date: r.created_at.slice(0, 10), status: 'submitted', module: 'Payables', route: 's-finance-payables' });
    }
    for (const r of (submittedRemittances.data ?? []) as Array<{ id: string; remittance_no: string; total_due: string; authority: string; created_at: string }>) {
      rows.push({ id: r.id, ref: r.remittance_no, type: 'Remittance', party: r.authority, amount: Number(r.total_due), date: r.created_at.slice(0, 10), status: 'submitted', module: 'Remittances', route: 's-finance-remittances' });
    }
    for (const r of (submittedDisbursements.data ?? []) as Array<{ id: string; disbursement_no: string; total_amount: string; created_at: string }>) {
      rows.push({ id: r.id, ref: r.disbursement_no, type: 'Disbursement', party: 'Payroll disbursement', amount: Number(r.total_amount), date: r.created_at.slice(0, 10), status: 'submitted', module: 'Disbursements', route: 's-finance-disbursements' });
    }

  } else if (kpiType === 'budget-variance') {
    title = 'Budget Variance — Cost Centres';
    const { data: budgetLines } = await sb.from('finance_budget_lines')
      .select('id, actual, budgeted, cost_center_id, finance_cost_centers(name)')
      .eq('fiscal_year', fiscalYear).limit(50);
    for (const r of (budgetLines ?? []) as Array<{ id: string; actual: string; budgeted: string; finance_cost_centers: { name: string } | { name: string }[] | null }>) {
      const name = Array.isArray(r.finance_cost_centers) ? (r.finance_cost_centers[0]?.name ?? 'Unassigned') : (r.finance_cost_centers?.name ?? 'Unassigned');
      const variance = Number(r.actual) - Number(r.budgeted);
      rows.push({ id: r.id, ref: r.id, type: 'Budget Line', party: name, amount: variance, date: `${fiscalYear}`, status: variance > 0 ? 'over' : 'under', module: 'Budgets', route: 's-finance-budgets' });
    }

  } else if (kpiType === 'cash-out') {
    title = 'Cash Out MTD — Disbursements';
    const { data } = await sb.from('finance_disbursements')
      .select('id, disbursement_no, total_amount, status, created_at')
      .in('status', ['approved', 'file_generated', 'paid'])
      .gte('created_at', thisMonth.start).lt('created_at', thisMonth.end).limit(50);
    for (const r of (data ?? []) as Array<{ id: string; disbursement_no: string; total_amount: string; status: string; created_at: string }>) {
      rows.push({ id: r.id, ref: r.disbursement_no, type: 'Disbursement', party: 'Payroll disbursement', amount: Number(r.total_amount), date: r.created_at.slice(0, 10), status: r.status, module: 'Disbursements', route: 's-finance-disbursements' });
    }
  }

  void emitAppEvent({
    eventType: 'finance.kpi.drilled',
    sourceModule: 'finance',
    sourceEntityType: 'finance_kpi',
    sourceEntityId: kpiType,
    actorUserId: actorId,
    severity: 'info',
    payload: { kpiType, period, rowCount: rows.length },
  });

  rows.sort((a, b) => b.amount - a.amount);
  return { kpiType, period, title, rows, total: rows.length };
}

// ============================================================================
// Chunk 11 — Approvals Inbox (cross-module)
// ============================================================================

export interface ApprovalQueueItemV2 {
  type: 'Bill' | 'Expense' | 'Remittance' | 'Disbursement';
  ref: string;
  party: string;
  amount: number;
  requestedBy: string | null;
  ageDays: number;
  route: string;
  id: string;
  /** Current actor can approve (SoD check: actor !== createdBy). */
  userCanApprove: boolean;
  /** Inline reject is available for this type. */
  canReject: boolean;
  createdBy: string | null;
}

export interface ApprovalsQueueFilters {
  type?: 'Bill' | 'Expense' | 'Remittance' | 'Disbursement';
  minAgeDays?: number;
  minAmount?: number;
  priority?: 'high' | 'normal';
}

export async function getApprovalsQueueV2(
  filters: ApprovalsQueueFilters,
  actorId: string,
): Promise<ApprovalQueueItemV2[]> {
  const [submittedExpenses, submittedBills, submittedRemittances, submittedDisbursements] = await Promise.all([
    sb.from('finance_expense_claims').select('id, claim_no, title, total_amount, claimant_id, created_at').eq('status', 'submitted').order('created_at', { ascending: true }).limit(20),
    sb.from('finance_ap_bills').select('id, bill_no, total_amount, created_by, created_at, finance_ap_vendors(name)').eq('status', 'submitted').order('created_at', { ascending: true }).limit(20),
    sb.from('finance_remittances').select('id, remittance_no, total_due, authority, created_by, created_at').eq('status', 'submitted').order('created_at', { ascending: true }).limit(20),
    sb.from('finance_disbursements').select('id, disbursement_no, total_amount, created_by, created_at').eq('status', 'submitted').order('created_at', { ascending: true }).limit(20),
  ]);

  const nowMs = Date.now();
  const ageDays = (iso: string): number => Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000));

  const queue: ApprovalQueueItemV2[] = [];

  if (!filters.type || filters.type === 'Expense') {
    for (const r of (submittedExpenses.data ?? []) as Array<{ id: string; claim_no: string; title: string; total_amount: string; claimant_id: string | null; created_at: string }>) {
      const age = ageDays(r.created_at);
      if ((filters.minAgeDays ?? 0) > age) continue;
      if ((filters.minAmount ?? 0) > Number(r.total_amount)) continue;
      if (filters.priority === 'high' && Number(r.total_amount) < HIGH_VALUE_THRESHOLD) continue;
      queue.push({ type: 'Expense', ref: r.claim_no, party: r.title, amount: Number(r.total_amount), requestedBy: r.claimant_id, ageDays: age, route: 's-finance-expenses', id: r.id, userCanApprove: r.claimant_id !== actorId, canReject: true, createdBy: r.claimant_id });
    }
  }
  if (!filters.type || filters.type === 'Bill') {
    for (const r of (submittedBills.data ?? []) as Array<{ id: string; bill_no: string; total_amount: string; created_by: string | null; created_at: string; finance_ap_vendors: { name: string } | { name: string }[] | null }>) {
      const age = ageDays(r.created_at);
      if ((filters.minAgeDays ?? 0) > age) continue;
      if ((filters.minAmount ?? 0) > Number(r.total_amount)) continue;
      if (filters.priority === 'high' && Number(r.total_amount) < HIGH_VALUE_THRESHOLD) continue;
      const vn = Array.isArray(r.finance_ap_vendors) ? (r.finance_ap_vendors[0]?.name ?? '—') : (r.finance_ap_vendors?.name ?? '—');
      queue.push({ type: 'Bill', ref: r.bill_no, party: vn, amount: Number(r.total_amount), requestedBy: r.created_by, ageDays: age, route: 's-finance-payables', id: r.id, userCanApprove: r.created_by !== actorId, canReject: true, createdBy: r.created_by });
    }
  }
  if (!filters.type || filters.type === 'Remittance') {
    for (const r of (submittedRemittances.data ?? []) as Array<{ id: string; remittance_no: string; total_due: string; authority: string; created_by: string | null; created_at: string }>) {
      const age = ageDays(r.created_at);
      if ((filters.minAgeDays ?? 0) > age) continue;
      if ((filters.minAmount ?? 0) > Number(r.total_due)) continue;
      if (filters.priority === 'high' && Number(r.total_due) < HIGH_VALUE_THRESHOLD) continue;
      queue.push({ type: 'Remittance', ref: r.remittance_no, party: r.authority, amount: Number(r.total_due), requestedBy: r.created_by, ageDays: age, route: 's-finance-remittances', id: r.id, userCanApprove: r.created_by !== actorId, canReject: false, createdBy: r.created_by });
    }
  }
  if (!filters.type || filters.type === 'Disbursement') {
    for (const r of (submittedDisbursements.data ?? []) as Array<{ id: string; disbursement_no: string; total_amount: string; created_by: string | null; created_at: string }>) {
      const age = ageDays(r.created_at);
      if ((filters.minAgeDays ?? 0) > age) continue;
      if ((filters.minAmount ?? 0) > Number(r.total_amount)) continue;
      if (filters.priority === 'high' && Number(r.total_amount) < HIGH_VALUE_THRESHOLD) continue;
      queue.push({ type: 'Disbursement', ref: r.disbursement_no, party: 'Payroll disbursement', amount: Number(r.total_amount), requestedBy: r.created_by, ageDays: age, route: 's-finance-disbursements', id: r.id, userCanApprove: r.created_by !== actorId, canReject: false, createdBy: r.created_by });
    }
  }

  return queue.sort((a, b) => b.ageDays - a.ageDays);
}

export type QueueItemType = 'Bill' | 'Expense' | 'Remittance' | 'Disbursement';

export async function approveFinanceQueueItem(
  id: string,
  type: QueueItemType,
  actorId: string,
): Promise<{ ref: string; status: string }> {
  switch (type) {
    case 'Bill': {
      const result = await approveBill(id, actorId);
      return { ref: result.billNo, status: result.status };
    }
    case 'Expense': {
      const result = await approveExpenseClaim(id, actorId);
      return { ref: result.claimNo, status: result.status };
    }
    case 'Remittance': {
      const result = await approveRemittance(id, actorId);
      return { ref: result.remittanceNo, status: result.status };
    }
    case 'Disbursement': {
      const result = await approveDisbursement(id, actorId);
      return { ref: result.disbursementNo, status: result.status };
    }
  }
}

export async function rejectFinanceQueueItem(
  id: string,
  type: QueueItemType,
  reason: string,
  actorId: string,
): Promise<{ ref: string; status: string }> {
  switch (type) {
    case 'Bill': {
      const result = await rejectBill(id, actorId, reason);
      return { ref: result.billNo, status: result.status };
    }
    case 'Expense': {
      const result = await rejectExpenseClaim(id, actorId, reason);
      return { ref: result.claimNo, status: result.status };
    }
    case 'Remittance':
    case 'Disbursement':
      throw Object.assign(
        new Error(`Inline reject is not available for ${type}. Please open the module to reject.`),
        { status: 422 },
      );
  }
}

// ============================================================================
// Chunk 13-chart — Spend vs Budget series by period
// ============================================================================

export type SpendBudgetPeriod = 'MTD' | 'Monthly' | 'Quarterly';

export interface SpendBudgetSeries {
  labels: string[];
  spend: number[];
  budget: number[];
  forecast: number[];        // NaN for actuals, number for forecast points
  forecastFromIndex: number; // first index that is a forecast (all >= this are forecast)
}

export async function getSpendBudgetSeries(period: SpendBudgetPeriod = 'Monthly'): Promise<SpendBudgetSeries> {
  const now = new Date();
  const fiscalYear = now.getUTCFullYear();
  const todayIso = now.toISOString().slice(0, 10);

  const { data: budgetLinesRes } = await sb.from('finance_budget_lines')
    .select('actual, budgeted').eq('fiscal_year', fiscalYear);
  const totalBudgeted = (budgetLinesRes ?? []).reduce((s, r) => s + Number((r as { budgeted: string }).budgeted ?? 0), 0);

  if (period === 'MTD') {
    // Daily points for the current month
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const todayDay = now.getUTCDate();
    const labels: string[] = [];
    const spend: number[] = [];
    const forecast: number[] = [];
    const dailyBudget = totalBudgeted / 12 / daysInMonth;

    for (let d = 1; d <= daysInMonth; d++) {
      labels.push(String(d));
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (d <= todayDay) {
        spend.push(0); // will be filled below
        forecast.push(Number.NaN);
      } else {
        spend.push(0);
        forecast.push(d * dailyBudget); // projected spend at daily budget rate
      }
    }

    // Fill actual spend per day
    const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const monthEnd = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
    const [expenses, disb, bills] = await Promise.all([
      sb.from('finance_expense_claims').select('total_amount, expense_date').in('status', ['approved', 'reimbursed']).gte('expense_date', monthStart).lt('expense_date', monthEnd),
      sb.from('finance_disbursements').select('total_amount, created_at').in('status', ['approved', 'file_generated', 'paid']).gte('created_at', monthStart).lt('created_at', monthEnd),
      sb.from('finance_ap_bills').select('total_amount, bill_date').in('status', ['approved', 'partially_paid', 'paid']).gte('bill_date', monthStart).lt('bill_date', monthEnd),
    ]);
    for (const r of (expenses.data ?? []) as Array<{ total_amount: string; expense_date: string }>) {
      const d = parseInt(r.expense_date.slice(8, 10), 10) - 1;
      if (d >= 0 && d < spend.length) spend[d]! += Number(r.total_amount);
    }
    for (const r of (disb.data ?? []) as Array<{ total_amount: string; created_at: string }>) {
      const d = parseInt(r.created_at.slice(8, 10), 10) - 1;
      if (d >= 0 && d < spend.length) spend[d]! += Number(r.total_amount);
    }
    for (const r of (bills.data ?? []) as Array<{ total_amount: string; bill_date: string }>) {
      const d = parseInt(r.bill_date.slice(8, 10), 10) - 1;
      if (d >= 0 && d < spend.length) spend[d]! += Number(r.total_amount);
    }

    return { labels, spend, budget: labels.map(() => dailyBudget), forecast, forecastFromIndex: todayDay };

  } else if (period === 'Quarterly') {
    // 4 quarters of current fiscal year
    const quarters = ['Q1 Jan-Mar', 'Q2 Apr-Jun', 'Q3 Jul-Sep', 'Q4 Oct-Dec'];
    const qStarts = [0, 3, 6, 9]; // month offsets (0-indexed)
    const spend: number[] = [0, 0, 0, 0];
    const forecast: number[] = [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
    const currentQ = Math.floor(now.getUTCMonth() / 3);

    const windows = qStarts.map((ms, i) => ({
      start: new Date(Date.UTC(fiscalYear, ms, 1)).toISOString().slice(0, 10),
      end: new Date(Date.UTC(fiscalYear, ms + 3, 1)).toISOString().slice(0, 10),
      isFuture: i > currentQ,
    }));

    for (let qi = 0; qi < 4; qi++) {
      const w = windows[qi]!;
      if (w.isFuture) {
        forecast[qi] = totalBudgeted / 4;
      } else {
        spend[qi] = await monthSpend(w.start, w.end);
      }
    }

    return { labels: quarters, spend, budget: [totalBudgeted / 4, totalBudgeted / 4, totalBudgeted / 4, totalBudgeted / 4], forecast, forecastFromIndex: currentQ + 1 };

  } else {
    // Monthly — 6-month window (default)
    const trendWindows = Array.from({ length: 6 }, (_, i) => monthBounds(i - 5));
    const trendSpend = await Promise.all(trendWindows.map(w => monthSpend(w.start, w.end)));
    const forecastFromIndex = trendWindows.findIndex(w => w.start > todayIso.slice(0, 7) + '-01');
    const forecast = trendWindows.map((w, i) => (i >= (forecastFromIndex < 0 ? 6 : forecastFromIndex) ? totalBudgeted / 6 : Number.NaN));

    return {
      labels: trendWindows.map(w => w.label),
      spend: trendSpend,
      budget: trendWindows.map(() => totalBudgeted / 6),
      forecast,
      forecastFromIndex: forecastFromIndex < 0 ? 6 : forecastFromIndex,
    };
  }
}
