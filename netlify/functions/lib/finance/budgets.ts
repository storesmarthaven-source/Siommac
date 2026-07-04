// ============================================================================
// Finance -- Budgeting & Budget-vs-Actual (F5)
// ============================================================================
// Manages finance_budget_lines: upsert per cost_centre/fiscal_year/category,
// compute actuals from finance_cost_entries (READ-ONLY), variance reporting.
//
// Actuals: SUM of finance_cost_entries.amount WHERE cost_center_id matches
// and period year (metadata.period_year or created_at year) = fiscal year.
// Statuses 'rejected' and 'cancelled' are excluded.
// This module does NOT write to finance_cost_entries.
//
// Permissions: finance.budgets.{view,manage,reports.view,reports.export}
// ============================================================================

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';

// -- DTOs

export interface BudgetLineDto {
  id: string; costCenterId: string; costCenterName: string | null;
  fiscalYear: number; category: string; label: string | null; notes: string | null;
  budgeted: number; actual: number; variance: number; variancePct: number | null;
  currency: string; createdBy: string | null; createdAt: string; updatedAt: string | null;
}

export interface BudgetVarianceRow {
  costCenterId: string; costCenterName: string | null; category: string; fiscalYear: number;
  budgeted: number; actual: number; variance: number; variancePct: number | null; currency: string;
}

export interface BudgetReportCatalogRow { key: string; label: string; description: string; }

interface DbBudgetRow {
  id: string; cost_center_id: string; fiscal_year: number; category: string;
  label: string | null; notes: string | null; budgeted: string | number; actual: string | number;
  currency: string; created_by: string | null; created_at: string; updated_at: string | null;
  cc_name?: string | null;
}

// Aggregate finance_cost_entries.amount for a fiscal year per cost_center_id.
// Period year = metadata.period_year (int/string) if present, else created_at year.
// Excludes entries with status in (rejected, cancelled).
async function fetchActuals(fiscalYear: number, costCenterIds?: string[]): Promise<Map<string, number>> {
  let q = sb
    .from('finance_cost_entries')
    .select('cost_center_id, amount, created_at, metadata, status')
    .not('status', 'in', '("rejected","cancelled")');
  if (costCenterIds && costCenterIds.length > 0) q = q.in('cost_center_id', costCenterIds);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('fetchActuals: ' + error.message), { status: 500 });
  const map = new Map<string, number>();
  for (const row of (data ?? []) as Array<{
    cost_center_id: string | null; amount: string | number;
    created_at: string; metadata: Record<string, unknown> | null; status: string;
  }>) {
    if (!row.cost_center_id) continue;
    let rowYear: number;
    const metaYear = row.metadata?.['period_year'];
    if (typeof metaYear === 'number') { rowYear = metaYear; }
    else if (typeof metaYear === 'string' && /^\d{4}$/.test(metaYear)) { rowYear = parseInt(metaYear, 10); }
    else { rowYear = new Date(row.created_at).getFullYear(); }
    if (rowYear !== fiscalYear) continue;
    map.set(row.cost_center_id, (map.get(row.cost_center_id) ?? 0) + Number(row.amount));
  }
  return map;
}

function toDto(row: DbBudgetRow, actualsMap: Map<string, number>): BudgetLineDto {
  const budgeted = Number(row.budgeted);
  const actual = actualsMap.get(row.cost_center_id) ?? 0;
  const variance = budgeted - actual;
  const variancePct = budgeted !== 0 ? (variance / budgeted) * 100 : null;
  return { id: row.id, costCenterId: row.cost_center_id, costCenterName: row.cc_name ?? null,
    fiscalYear: row.fiscal_year, category: row.category, label: row.label, notes: row.notes,
    budgeted, actual, variance, variancePct, currency: row.currency,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

export interface ListBudgetsOpts { costCenterId?: string; fiscalYear?: number; category?: string; }

export async function listBudgets(opts: ListBudgetsOpts = {}): Promise<BudgetLineDto[]> {
  let q = sb.from('finance_budget_lines').select('*, finance_cost_centers(name)')
    .order('fiscal_year', { ascending: false }).order('category');
  if (opts.costCenterId) q = q.eq('cost_center_id', opts.costCenterId);
  if (opts.fiscalYear)   q = q.eq('fiscal_year',    opts.fiscalYear);
  if (opts.category)     q = q.eq('category',       opts.category);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listBudgets: ' + error.message), { status: 500 });
  const rows = (data ?? []) as Array<DbBudgetRow & { finance_cost_centers: { name: string } | null }>;
  const yearCcPairs = new Map<number, Set<string>>();
  for (const r of rows) {
    const s = yearCcPairs.get(r.fiscal_year) ?? new Set<string>();
    s.add(r.cost_center_id); yearCcPairs.set(r.fiscal_year, s);
  }
  const cache = new Map<string, number>();
  for (const [yr, ccIds] of yearCcPairs) {
    const m = await fetchActuals(yr, [...ccIds]);
    for (const [ccId, tot] of m) cache.set(`${ccId}::${yr}`, tot);
  }
  return rows.map(r => {
    const flat = new Map<string, number>();
    const c = cache.get(`${r.cost_center_id}::${r.fiscal_year}`);
    if (c !== undefined) flat.set(r.cost_center_id, c);
    return toDto({ ...r, cc_name: r.finance_cost_centers?.name ?? null }, flat);
  });
}

export async function getBudgetLine(id: string): Promise<BudgetLineDto | null> {
  const { data, error } = await sb.from('finance_budget_lines')
    .select('*, finance_cost_centers(name)').eq('id', id)
    .maybeSingle<DbBudgetRow & { finance_cost_centers: { name: string } | null }>();
  if (error) throw Object.assign(new Error('getBudgetLine: ' + error.message), { status: 500 });
  if (!data) return null;
  const am = await fetchActuals(data.fiscal_year, [data.cost_center_id]);
  return toDto({ ...data, cc_name: data.finance_cost_centers?.name ?? null }, am);
}

export interface UpsertBudgetLineInput {
  costCenterId: string; fiscalYear: number; category: string;
  label?: string | null; notes?: string | null; budgeted: number;
  currency?: string; actorId: string;
}

export async function upsertBudgetLine(input: UpsertBudgetLineInput): Promise<BudgetLineDto> {
  if (input.budgeted < 0)
    throw Object.assign(new Error('Budgeted amount cannot be negative.'), { status: 422 });
  if (input.fiscalYear < 2000 || input.fiscalYear > 2100)
    throw Object.assign(new Error('Fiscal year must be between 2000 and 2100.'), { status: 422 });

  const { data: cc, error: ccErr } = await sb.from('finance_cost_centers')
    .select('id, name').eq('id', input.costCenterId)
    .maybeSingle<{ id: string; name: string }>();
  if (ccErr) throw Object.assign(new Error('upsertBudgetLine (cc lookup): ' + ccErr.message), { status: 500 });
  if (!cc) throw Object.assign(new Error('Cost centre not found.'), { status: 404 });

  const patch = {
    cost_center_id: input.costCenterId, fiscal_year: input.fiscalYear, category: input.category,
    label: input.label ?? null, notes: input.notes ?? null, budgeted: input.budgeted,
    currency: input.currency ?? 'TTD', created_by: input.actorId,
  };

  const { data, error } = await sb.from('finance_budget_lines')
    .upsert(patch, { onConflict: 'cost_center_id,fiscal_year,category' })
    .select('*, finance_cost_centers(name)')
    .single<DbBudgetRow & { finance_cost_centers: { name: string } | null }>();

  if (error) {
    if (error.code === '23505')
      throw Object.assign(new Error('A budget line for this cost centre, fiscal year, and category already exists.'), { status: 409 });
    throw Object.assign(new Error('upsertBudgetLine: ' + error.message), { status: 500 });
  }

  const am = await fetchActuals(input.fiscalYear, [input.costCenterId]);
  const row = toDto({ ...data, cc_name: data.finance_cost_centers?.name ?? null }, am);

  // S2 side-effects: emitAppEvent THEN writeHrAudit (both awaited, throw on failure)
  await emitAppEvent({
    eventType: 'finance.budgets.line.upserted', sourceModule: 'finance_budgets',
    sourceEntityType: 'budget_line', sourceEntityId: row.id, actorUserId: input.actorId,
    severity: 'info',
    payload: { costCenterId: row.costCenterId, fiscalYear: row.fiscalYear, category: row.category, budgeted: row.budgeted },
  });
  await writeHrAudit({
    submoduleKey: 'finance_budgets', recordId: row.id, actorId: input.actorId,
    action: 'budget_line.upserted', previousState: null,
    newState: { costCenterId: row.costCenterId, fiscalYear: row.fiscalYear, category: row.category, budgeted: row.budgeted },
  });
  return row;
}

export async function deleteBudgetLine(id: string, actorId: string): Promise<void> {
  const existing = await getBudgetLine(id);
  if (!existing) throw Object.assign(new Error('Budget line not found.'), { status: 404 });
  const { error } = await sb.from('finance_budget_lines').delete().eq('id', id);
  if (error) throw Object.assign(new Error('deleteBudgetLine: ' + error.message), { status: 500 });
  await emitAppEvent({
    eventType: 'finance.budgets.line.deleted', sourceModule: 'finance_budgets',
    sourceEntityType: 'budget_line', sourceEntityId: id, actorUserId: actorId, severity: 'info',
    payload: { costCenterId: existing.costCenterId, fiscalYear: existing.fiscalYear, category: existing.category },
  });
  await writeHrAudit({
    submoduleKey: 'finance_budgets', recordId: id, actorId,
    action: 'budget_line.deleted', previousState: existing, newState: null,
  });
}

export async function getBudgetVarianceReport(fiscalYear: number, costCenterId?: string): Promise<BudgetVarianceRow[]> {
  let q = sb.from('finance_budget_lines').select('*, finance_cost_centers(name)')
    .eq('fiscal_year', fiscalYear).order('category');
  if (costCenterId) q = q.eq('cost_center_id', costCenterId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('getBudgetVarianceReport: ' + error.message), { status: 500 });
  const rows = (data ?? []) as Array<DbBudgetRow & { finance_cost_centers: { name: string } | null }>;
  const ccIds = [...new Set(rows.map(r => r.cost_center_id))];
  const am = await fetchActuals(fiscalYear, ccIds);
  return rows.map(r => {
    const budgeted = Number(r.budgeted);
    const actual = am.get(r.cost_center_id) ?? 0;
    const variance = budgeted - actual;
    const variancePct = budgeted !== 0 ? (variance / budgeted) * 100 : null;
    return { costCenterId: r.cost_center_id, costCenterName: r.finance_cost_centers?.name ?? null,
      category: r.category, fiscalYear: r.fiscal_year, budgeted, actual, variance, variancePct, currency: r.currency };
  });
}

export function listBudgetReports(): BudgetReportCatalogRow[] {
  return [
    { key: 'budget_variance', label: 'Budget vs Actual Variance',
      description: 'Budgeted vs actual spend per cost centre and category for a fiscal year.' },
    { key: 'budget_summary', label: 'Budget Summary',
      description: 'All budget lines with budgeted amounts by fiscal year.' },
  ];
}

export async function runBudgetReport(
  reportKey: string,
  params: { fiscalYear?: number; costCenterId?: string },
): Promise<BudgetLineDto[] | BudgetVarianceRow[]> {
  const fiscalYear = params.fiscalYear ?? new Date().getFullYear();
  if (reportKey === 'budget_variance') return getBudgetVarianceReport(fiscalYear, params.costCenterId);
  if (reportKey === 'budget_summary')  return listBudgets({ fiscalYear, costCenterId: params.costCenterId });
  throw Object.assign(new Error(`Unknown report key: ${reportKey}`), { status: 400 });
}
