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
// Permissions: finance.budgets.{view,manage,reports.view,reports.export,
//              bulkUpsert,copyLastYear}
// ============================================================================

import { sb } from '../db';
import { emitFinanceMutationBackbone } from './backbone';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface BudgetLineDto {
  id: string; costCenterId: string; costCenterName: string | null;
  fiscalYear: number; category: string; label: string | null; notes: string | null;
  budgeted: number; actual: number; variance: number; variancePct: number | null;
  currency: string; createdBy: string | null; createdAt: string; updatedAt: string | null;
  /** Fiscal period within year — e.g. 'Q1', 'Jan'. Null = full-year allocation. */
  period: string | null;
  /** Budget owner user ID (app_users.id TEXT). */
  ownerId: string | null;
}

export interface BudgetVarianceRow {
  costCenterId: string; costCenterName: string | null; category: string; fiscalYear: number;
  budgeted: number; actual: number; variance: number; variancePct: number | null; currency: string;
}

export interface BudgetReportCatalogRow { key: string; label: string; description: string; }

export interface CostEntryRow {
  id: string;
  ref: string | null;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  periodYear: number | null;
}

export interface BudgetActualsResult {
  budgetLine: BudgetLineDto;
  entries: CostEntryRow[];
  totalActual: number;
  byMonth: { month: number; amount: number }[];
}

export interface BulkBudgetLineInput {
  costCenterId: string;
  fiscalYear: number;
  category: string;
  label?: string | null;
  notes?: string | null;
  budgeted: number;
  currency?: string;
  /** Fiscal period within the year — e.g. 'Q1', 'Q2', 'H1', 'Jan', '01'. Null = full-year. */
  period?: string | null;
  /** Budget owner / responsible manager (app_users.id TEXT). */
  ownerId?: string | null;
}

export interface BulkUpsertResult {
  count: number;
  ids: string[];
  overBudgetCount: number;
}

export interface CopyLastYearInput {
  sourceFiscalYear: number;
  targetFiscalYear: number;
  costCenterId?: string | null;
  category?: string | null;
  adjustmentPct?: number;
  roundingRule?: 'none' | 'hundred' | 'thousand';
  actorId: string;
}

export interface CopyLastYearResult {
  copied: number;
  skipped: number;
  ids: string[];
}

// ── Internal DB row type ──────────────────────────────────────────────────────

interface DbBudgetRow {
  id: string; cost_center_id: string; fiscal_year: number; category: string;
  label: string | null; notes: string | null; budgeted: string | number; actual: string | number;
  currency: string; created_by: string | null; created_at: string; updated_at: string | null;
  cc_name?: string | null;
  period: string | null;
  owner_id: string | null;
}

// ── Actuals aggregation ───────────────────────────────────────────────────────

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
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    period: row.period ?? null, ownerId: row.owner_id ?? null };
}

function applyRounding(amount: number, rule: 'none' | 'hundred' | 'thousand'): number {
  if (rule === 'hundred') return Math.round(amount / 100) * 100;
  if (rule === 'thousand') return Math.round(amount / 1000) * 1000;
  return Math.round(amount * 100) / 100;
}

// ── List / Get ────────────────────────────────────────────────────────────────

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

// ── Upsert (single) ───────────────────────────────────────────────────────────

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

  // Variance threshold check — notify if actual > budgeted (over budget)
  const isOverBudget = row.actual > row.budgeted && row.budgeted > 0;

  try {
    // 1. Emit the primary upsert event + mandatory audit log
    await emitFinanceMutationBackbone({
      actorUserId:   input.actorId,
      module:        'finance_budgets',
      entityType:    'budget_line',
      entityId:      row.id,
      eventType:     'finance.budgets.line.upserted',
      auditAction:   'budget_line.upserted',
      previousState: null,
      newState:      { costCenterId: row.costCenterId, fiscalYear: row.fiscalYear, category: row.category, budgeted: row.budgeted, period: row.period, ownerId: row.ownerId },
    });

    // 2. If over budget: emit a SEPARATE variance breach event per §8.1 with correct
    //    event type and recipients (Cost-centre Owner + Finance Lead / finance_manager role).
    if (isOverBudget) {
      const { data: fmUsers } = await sb.from('app_users')
        .select('id')
        .in('role', ['finance_manager', 'finance_lead'])
        .eq('status', 'active');
      const recipientUserIds = (fmUsers ?? []).map((u: { id: string }) => u.id);
      // §8.1: also notify the cost-centre owner (budget line's ownerId)
      if (row.ownerId && !recipientUserIds.includes(row.ownerId)) {
        recipientUserIds.push(row.ownerId);
      }

      const breachSubject = `Budget review: ${row.costCenterName ?? row.costCenterId} · ${row.category} FY ${row.fiscalYear}`;
      const breachBody    = `Actual spend ($${Math.round(row.actual).toLocaleString()}) exceeds budget ($${Math.round(row.budgeted).toLocaleString()}) for FY ${row.fiscalYear}. Category: ${row.category}. Please review.`;

      await emitFinanceMutationBackbone({
        actorUserId:   input.actorId,
        module:        'finance_budgets',
        entityType:    'budget_line',
        entityId:      row.id,
        eventType:     'finance.budget.variance.threshold_breached',
        auditAction:   'budget_line.variance.threshold_breached',
        severity:      'warning',
        previousState: null,
        newState:      { actual: row.actual, budgeted: row.budgeted, variancePct: row.variancePct },
        notification: {
          title:           `Budget variance alert: ${row.costCenterName ?? row.costCenterId} · ${row.category}`,
          body:            breachBody,
          severity:        'warning',
          actionRoute:     '/finance/budgets',
          recipientUserIds,
        },
        // §8.1: open a budget review thread so Finance Lead + Cost-centre Owner can discuss
        messageThread: {
          subject:            breachSubject,
          participantUserIds: recipientUserIds,
          body:               breachBody,
        },
      });
    }
  } catch (backboneErr) {
    // Backbone failed (audit write) — compensating rollback for the newly created record.
    // For an upsert we cannot know if it was a create or update without tracking the old state;
    // we rethrow so the caller surfaces the error rather than silently swallowing it.
    throw backboneErr;
  }

  return row;
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteBudgetLine(id: string, actorId: string): Promise<void> {
  const existing = await getBudgetLine(id);
  if (!existing) throw Object.assign(new Error('Budget line not found.'), { status: 404 });

  const { error } = await sb.from('finance_budget_lines').delete().eq('id', id);
  if (error) throw Object.assign(new Error('deleteBudgetLine: ' + error.message), { status: 500 });

  // Backbone — on failure we've already deleted the business row; rethrow for visibility
  await emitFinanceMutationBackbone({
    actorUserId:   actorId,
    module:        'finance_budgets',
    entityType:    'budget_line',
    entityId:      id,
    eventType:     'finance.budgets.line.deleted',
    auditAction:   'budget_line.deleted',
    previousState: existing,
    newState:      null,
  });
}

// ── Bulk Upsert ───────────────────────────────────────────────────────────────

export async function bulkUpsertBudgetLines(
  lines: BulkBudgetLineInput[],
  actorId: string,
): Promise<BulkUpsertResult> {
  if (!lines.length) throw Object.assign(new Error('No lines provided.'), { status: 422 });

  // Validate all inputs before any writes
  for (const l of lines) {
    if (l.budgeted < 0)
      throw Object.assign(new Error(`Budgeted amount cannot be negative (category: ${l.category}).`), { status: 422 });
    if (l.fiscalYear < 2000 || l.fiscalYear > 2100)
      throw Object.assign(new Error(`Fiscal year must be between 2000 and 2100 (category: ${l.category}).`), { status: 422 });
    if (!l.costCenterId)
      throw Object.assign(new Error('costCenterId is required on every line.'), { status: 422 });
  }

  // Verify all cost centres exist (unique set)
  const uniqueCcIds = [...new Set(lines.map(l => l.costCenterId))];
  for (const ccId of uniqueCcIds) {
    const { data: cc, error: ccErr } = await sb.from('finance_cost_centers')
      .select('id').eq('id', ccId).maybeSingle<{ id: string }>();
    if (ccErr) throw Object.assign(new Error('bulkUpsertBudgetLines (cc lookup): ' + ccErr.message), { status: 500 });
    if (!cc) throw Object.assign(new Error(`Cost centre not found: ${ccId}`), { status: 404 });
  }

  const patches = lines.map(l => ({
    cost_center_id: l.costCenterId,
    fiscal_year:    l.fiscalYear,
    category:       l.category,
    label:          l.label ?? null,
    notes:          l.notes ?? null,
    budgeted:       l.budgeted,
    currency:       l.currency ?? 'TTD',
    created_by:     actorId,
    period:         l.period ?? null,
    owner_id:       l.ownerId ?? null,
  }));

  const { data: upserted, error } = await sb
    .from('finance_budget_lines')
    .upsert(patches, { onConflict: 'cost_center_id,fiscal_year,category' })
    .select('id, cost_center_id, fiscal_year, category, budgeted');
  if (error) throw Object.assign(new Error('bulkUpsertBudgetLines: ' + error.message), { status: 500 });

  const rows = (upserted ?? []) as Array<{
    id: string; cost_center_id: string; fiscal_year: number; category: string; budgeted: string | number;
  }>;
  const ids = rows.map(r => r.id);

  // Check variance threshold across all affected lines
  const fiscalYears = [...new Set(lines.map(l => l.fiscalYear))];
  let overBudgetCount = 0;
  for (const fy of fiscalYears) {
    const fyRows = rows.filter(r => r.fiscal_year === fy);
    const ccIds = [...new Set(fyRows.map(r => r.cost_center_id))];
    const actualsMap = await fetchActuals(fy, ccIds);
    for (const r of fyRows) {
      const actual = actualsMap.get(r.cost_center_id) ?? 0;
      if (actual > Number(r.budgeted) && Number(r.budgeted) > 0) overBudgetCount++;
    }
  }

  try {
    // 1. Primary bulk upsert event
    await emitFinanceMutationBackbone({
      actorUserId:  actorId,
      module:       'finance_budgets',
      entityType:   'budget_line_batch',
      entityId:     ids[0] ?? 'batch',
      eventType:    'finance.budgets.lines.bulk_upserted',
      auditAction:  'budget_lines.bulk_upserted',
      previousState: null,
      newState:     { count: rows.length, lineIds: ids },
    });

    // 2. If any lines are over budget: emit a SEPARATE variance breach event per §8.1.
    if (overBudgetCount > 0) {
      const { data: fmUsers } = await sb.from('app_users')
        .select('id')
        .in('role', ['finance_manager', 'finance_lead'])
        .eq('status', 'active');
      const recipientUserIds = (fmUsers ?? []).map((u: { id: string }) => u.id);
      // §8.1: also notify the cost-centre owners of the over-budget lines
      for (const l of lines) {
        if (l.ownerId && !recipientUserIds.includes(l.ownerId)) {
          recipientUserIds.push(l.ownerId);
        }
      }

      const bulkBreachTitle = `Budget variance alert: ${overBudgetCount} line${overBudgetCount > 1 ? 's' : ''} over budget`;
      const bulkBreachBody  = `After bulk entry, ${overBudgetCount} budget line${overBudgetCount > 1 ? 's are' : ' is'} exceeded by actual spend. Review required.`;

      await emitFinanceMutationBackbone({
        actorUserId:  actorId,
        module:       'finance_budgets',
        entityType:   'budget_line_batch',
        entityId:     ids[0] ?? 'batch',
        eventType:    'finance.budget.variance.threshold_breached',
        auditAction:  'budget_lines.variance.threshold_breached',
        severity:     'warning',
        previousState: null,
        newState:     { overBudgetCount, lineIds: ids },
        notification: {
          title:           bulkBreachTitle,
          body:            bulkBreachBody,
          severity:        'warning',
          actionRoute:     '/finance/budgets',
          recipientUserIds,
        },
        // §8.1: open a budget review thread
        messageThread: {
          subject:            bulkBreachTitle,
          participantUserIds: recipientUserIds,
          body:               bulkBreachBody,
        },
      });
    }
  } catch (backboneErr) {
    // Backbone failed — rethrow; the business rows are in a valid state
    throw backboneErr;
  }

  return { count: rows.length, ids, overBudgetCount };
}

// ── Copy Last Year ────────────────────────────────────────────────────────────

export async function copyLastYearBudget(input: CopyLastYearInput): Promise<CopyLastYearResult> {
  if (input.sourceFiscalYear === input.targetFiscalYear)
    throw Object.assign(new Error('Source and target fiscal years must be different.'), { status: 422 });
  if (input.targetFiscalYear < 2000 || input.targetFiscalYear > 2100)
    throw Object.assign(new Error('Target fiscal year must be between 2000 and 2100.'), { status: 422 });

  // Fetch source lines
  let srcQ = sb.from('finance_budget_lines')
    .select('*, finance_cost_centers(name)')
    .eq('fiscal_year', input.sourceFiscalYear);
  if (input.costCenterId) srcQ = srcQ.eq('cost_center_id', input.costCenterId);
  if (input.category)     srcQ = srcQ.eq('category', input.category);
  const { data: srcRows, error: srcErr } = await srcQ;
  if (srcErr) throw Object.assign(new Error('copyLastYearBudget (fetch source): ' + srcErr.message), { status: 500 });

  const sources = (srcRows ?? []) as Array<DbBudgetRow & { finance_cost_centers: { name: string } | null }>;
  if (!sources.length) throw Object.assign(new Error('No budget lines found in the source fiscal year.'), { status: 404 });

  // Fetch existing target lines to detect conflicts
  const { data: targetRows, error: tErr } = await sb.from('finance_budget_lines')
    .select('cost_center_id, category')
    .eq('fiscal_year', input.targetFiscalYear);
  if (tErr) throw Object.assign(new Error('copyLastYearBudget (fetch target): ' + tErr.message), { status: 500 });
  const existingKeys = new Set((targetRows ?? []).map(r => `${r.cost_center_id}::${r.category}`));

  const adjFactor = 1 + (input.adjustmentPct ?? 0) / 100;
  const roundRule = input.roundingRule ?? 'none';

  const patches: Array<{
    cost_center_id: string; fiscal_year: number; category: string;
    label: string | null; notes: string | null; budgeted: number;
    currency: string; created_by: string;
  }> = [];
  let skipped = 0;

  for (const src of sources) {
    const key = `${src.cost_center_id}::${src.category}`;
    if (existingKeys.has(key)) { skipped++; continue; }
    const rawBudgeted = Number(src.budgeted) * adjFactor;
    patches.push({
      cost_center_id: src.cost_center_id,
      fiscal_year:    input.targetFiscalYear,
      category:       src.category,
      label:          src.label,
      notes:          src.notes ? `[Copied from FY ${input.sourceFiscalYear}] ${src.notes}` : `Copied from FY ${input.sourceFiscalYear}`,
      budgeted:       applyRounding(rawBudgeted, roundRule),
      currency:       src.currency,
      created_by:     input.actorId,
    });
  }

  if (!patches.length) {
    return { copied: 0, skipped, ids: [] };
  }

  const { data: inserted, error: insErr } = await sb
    .from('finance_budget_lines')
    .insert(patches)
    .select('id');
  if (insErr) throw Object.assign(new Error('copyLastYearBudget (insert): ' + insErr.message), { status: 500 });

  const ids = (inserted ?? []).map((r: { id: string }) => r.id);

  try {
    await emitFinanceMutationBackbone({
      actorUserId:  input.actorId,
      module:       'finance_budgets',
      entityType:   'budget_line_batch',
      entityId:     ids[0] ?? 'copy',
      eventType:    'finance.budgets.lines.copied',
      auditAction:  'budget_lines.copied',
      previousState: null,
      newState:     {
        sourceFiscalYear: input.sourceFiscalYear,
        targetFiscalYear: input.targetFiscalYear,
        copied: ids.length, skipped,
        adjustmentPct: input.adjustmentPct ?? 0,
        lineIds: ids,
      },
    });
  } catch (backboneErr) {
    // Compensating rollback — delete the copied lines if backbone (audit) fails.
    // Swallowing the delete error here is intentional: the primary failure is
    // backboneErr and we want to surface it. A dangling row is the lesser evil
    // vs masking the root cause; the operator can clean up via the manage UI.
    const { error: rollbackErr } = await sb.from('finance_budget_lines').delete().in('id', ids);
    if (rollbackErr) {
      console.error('[copyLastYearBudget] compensating rollback failed:', rollbackErr.message, 'ids:', ids);
    }
    throw backboneErr;
  }

  return { copied: ids.length, skipped, ids };
}

// ── Actuals Composition (for drawer) ──────────────────────────────────────────

export async function getBudgetLineActuals(id: string): Promise<BudgetActualsResult> {
  const line = await getBudgetLine(id);
  if (!line) throw Object.assign(new Error('Budget line not found.'), { status: 404 });

  const { data, error } = await sb
    .from('finance_cost_entries')
    .select('id, ref, source_module, source_entity_type, source_entity_id, amount, currency, status, created_at, metadata')
    .eq('cost_center_id', line.costCenterId)
    .not('status', 'in', '("rejected","cancelled")')
    .order('created_at', { ascending: false });

  if (error) throw Object.assign(new Error('getBudgetLineActuals: ' + error.message), { status: 500 });

  const entries: CostEntryRow[] = [];
  const monthlyMap = new Map<number, number>();

  for (const row of (data ?? []) as Array<{
    id: string; ref: string | null; source_module: string; source_entity_type: string;
    source_entity_id: string; amount: string | number; currency: string; status: string;
    created_at: string; metadata: Record<string, unknown> | null;
  }>) {
    // Determine fiscal year for this entry
    const metaYear = row.metadata?.['period_year'];
    let rowYear: number;
    if (typeof metaYear === 'number') { rowYear = metaYear; }
    else if (typeof metaYear === 'string' && /^\d{4}$/.test(metaYear)) { rowYear = parseInt(metaYear, 10); }
    else { rowYear = new Date(row.created_at).getFullYear(); }
    if (rowYear !== line.fiscalYear) continue;

    const amount = Number(row.amount);
    const month  = new Date(row.created_at).getMonth() + 1; // 1–12
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + amount);

    entries.push({
      id:               row.id,
      ref:              row.ref,
      sourceModule:     row.source_module,
      sourceEntityType: row.source_entity_type,
      sourceEntityId:   row.source_entity_id,
      amount,
      currency:         row.currency,
      status:           row.status,
      createdAt:        row.created_at,
      periodYear:       rowYear,
    });
  }

  const totalActual = entries.reduce((s, e) => s + e.amount, 0);
  const byMonth = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([month, amount]) => ({ month, amount }));

  return { budgetLine: line, entries, totalActual, byMonth };
}

// ── Actuals list (for page Actuals tab) ───────────────────────────────────────

export async function listCostEntriesForYear(
  fiscalYear: number,
  costCenterId?: string,
): Promise<CostEntryRow[]> {
  let q = sb
    .from('finance_cost_entries')
    .select('id, ref, source_module, source_entity_type, source_entity_id, amount, currency, status, created_at, metadata, cost_center_id')
    .not('status', 'in', '("rejected","cancelled")')
    .order('created_at', { ascending: false });
  if (costCenterId) q = q.eq('cost_center_id', costCenterId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listCostEntriesForYear: ' + error.message), { status: 500 });

  const result: CostEntryRow[] = [];
  for (const row of (data ?? []) as Array<{
    id: string; ref: string | null; source_module: string; source_entity_type: string;
    source_entity_id: string; amount: string | number; currency: string; status: string;
    created_at: string; metadata: Record<string, unknown> | null; cost_center_id: string | null;
  }>) {
    const metaYear = row.metadata?.['period_year'];
    let rowYear: number;
    if (typeof metaYear === 'number') { rowYear = metaYear; }
    else if (typeof metaYear === 'string' && /^\d{4}$/.test(metaYear)) { rowYear = parseInt(metaYear, 10); }
    else { rowYear = new Date(row.created_at).getFullYear(); }
    if (rowYear !== fiscalYear) continue;
    result.push({
      id:               row.id,
      ref:              row.ref,
      sourceModule:     row.source_module,
      sourceEntityType: row.source_entity_type,
      sourceEntityId:   row.source_entity_id,
      amount:           Number(row.amount),
      currency:         row.currency,
      status:           row.status,
      createdAt:        row.created_at,
      periodYear:       rowYear,
    });
  }
  return result;
}

// ── Budget Approvals (workflow tasks for a budget line) ───────────────────────

export interface BudgetApprovalTask {
  id: string;
  stepKey: string;
  stepName: string | null;
  status: string;
  assignedTo: string | null;
  assignedRole: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export async function getBudgetLineApprovals(budgetLineId: string): Promise<BudgetApprovalTask[]> {
  // Find workflow instances linked to this budget line, then return their tasks.
  const { data: instances, error: wiErr } = await sb
    .from('workflow_instances')
    .select('id')
    .eq('source_record_id', budgetLineId)
    .eq('module_key', 'finance_budgets');
  if (wiErr) throw Object.assign(new Error('getBudgetLineApprovals (instances): ' + wiErr.message), { status: 500 });

  const instanceIds = (instances ?? []).map((r: { id: string }) => r.id);
  if (!instanceIds.length) return [];

  const { data: tasks, error: taskErr } = await sb
    .from('workflow_tasks')
    .select('id, step_key, step_name, status, assigned_to, assigned_role, due_at, created_at, updated_at')
    .in('workflow_id', instanceIds)
    .order('created_at', { ascending: true });
  if (taskErr) throw Object.assign(new Error('getBudgetLineApprovals (tasks): ' + taskErr.message), { status: 500 });

  return (tasks ?? []).map((t: {
    id: string; step_key: string; step_name: string | null; status: string;
    assigned_to: string | null; assigned_role: string | null; due_at: string | null;
    created_at: string; updated_at: string | null;
  }) => ({
    id:           t.id,
    stepKey:      t.step_key,
    stepName:     t.step_name,
    status:       t.status,
    assignedTo:   t.assigned_to,
    assignedRole: t.assigned_role,
    dueAt:        t.due_at,
    createdAt:    t.created_at,
    updatedAt:    t.updated_at,
  }));
}

// ── Budget Audit Log ──────────────────────────────────────────────────────────

export interface BudgetAuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  previousState: unknown;
  newState: unknown;
  reason: string | null;
  createdAt: string;
}

export async function getBudgetLineAuditLog(budgetLineId: string): Promise<BudgetAuditEntry[]> {
  const { data, error } = await sb
    .from('hr_audit_log')
    .select('id, action, actor_id, previous_state, new_state, reason, created_at')
    .eq('submodule_key', 'finance_budgets')
    .eq('record_id', budgetLineId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw Object.assign(new Error('getBudgetLineAuditLog: ' + error.message), { status: 500 });

  return (data ?? []).map((r: {
    id: string; action: string; actor_id: string | null;
    previous_state: unknown; new_state: unknown;
    reason: string | null; created_at: string;
  }) => ({
    id:            r.id,
    action:        r.action,
    actorId:       r.actor_id,
    previousState: r.previous_state,
    newState:      r.new_state,
    reason:        r.reason,
    createdAt:     r.created_at,
  }));
}

// ── Variance Reports ──────────────────────────────────────────────────────────

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

// ── Report catalog ────────────────────────────────────────────────────────────

export function listBudgetReports(): BudgetReportCatalogRow[] {
  return [
    { key: 'budget_variance', label: 'Budget vs Actual Variance',
      description: 'Budgeted vs actual spend per cost centre and category for a fiscal year.' },
    { key: 'budget_summary', label: 'Budget Summary',
      description: 'All budget lines with budgeted amounts by fiscal year.' },
    { key: 'budget_actuals', label: 'Cost Entry Actuals',
      description: 'All approved cost entries contributing to actuals for a fiscal year.' },
  ];
}

export async function runBudgetReport(
  reportKey: string,
  params: { fiscalYear?: number; costCenterId?: string },
): Promise<BudgetLineDto[] | BudgetVarianceRow[] | CostEntryRow[]> {
  const fiscalYear = params.fiscalYear ?? new Date().getFullYear();
  if (reportKey === 'budget_variance') return getBudgetVarianceReport(fiscalYear, params.costCenterId);
  if (reportKey === 'budget_summary')  return listBudgets({ fiscalYear, costCenterId: params.costCenterId });
  if (reportKey === 'budget_actuals')  return listCostEntriesForYear(fiscalYear, params.costCenterId);
  throw Object.assign(new Error(`Unknown report key: ${reportKey}`), { status: 400 });
}
