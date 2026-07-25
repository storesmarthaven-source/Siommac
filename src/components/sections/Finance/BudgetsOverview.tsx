/**
 * src/components/sections/Finance/BudgetsOverview.tsx
 *
 * Finance ▸ Budgeting & Budget-vs-Actual (nav id `s-finance-budgets`).
 * Aurora `.hrfin` rebuild — Wave 2B.
 *
 * Tabs: Budget Lines · Variance · Actuals · Reports · Imports
 * KPI cards: Total Budget, Actual Spend, Variance, Over-budget Lines,
 *            Remaining Budget, Reports Ready
 * Chart: HorizontalBars (budget vs actual per line; click → drawer)
 * Register: HrfinTable with search, filter, sort, pager, row ⋮ menu, CSV export
 * Drawer: BudLineDrawer (Summary · Actuals Composition · Variance Trend ·
 *         Related Transactions · Timeline · Audit)
 * Dialogs: BudBulkUpsertWizard, BudCopyLastYearDialog (single-upsert via drawer Edit)
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { useCan } from '@lib/permissions';
import { toast } from '@store';
import { exportCsv } from '@ui';
import {
  HrfinPageHeader,
  QuickActionStrip,
  KpiCard,
  HrfinTable,
  HrfinPill,
  HorizontalBars,
  type HrfinTone,
  type HBarItem,
  type HrfinColumn,
} from '@ui';
import { ReportPanel, type ReportColumn, type ReportResult, type ReportRow } from './_shared/reports';
import { CostCentrePicker } from './_shared/pickers';
import {
  useBudgets,
  useBudgetVariance,
  useBudgetActuals,
  useBudgetReports,
  useBudgetMutation,
  financeBudgetsApi,
  type BudgetLine,
  type CostEntryRow,
  type BudgetVarianceRow,
  type UpsertBudgetLineArgs,
} from '@api/finance/budgets';
import { BudLineDrawer } from './BudLineDrawer';
import { BudBulkUpsertWizard } from './BudBulkUpsertWizard';
import { BudCopyLastYearDialog } from './BudCopyLastYearDialog';
import { money, moneyCompact } from './hrfinFormat';
import './finance.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - 2 + i);
const PAGE_SIZE = 20;

type Tab = 'lines' | 'variance' | 'actuals' | 'reports' | 'imports';
const TABS = [
  { key: 'lines'    as Tab, label: 'Budget Lines' },
  { key: 'variance' as Tab, label: 'Variance' },
  { key: 'actuals'  as Tab, label: 'Actuals' },
  { key: 'reports'  as Tab, label: 'Reports' },
  { key: 'imports'  as Tab, label: 'Imports' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function varianceTone(line: BudgetLine): HrfinTone {
  if (!line.budgeted) return 'nu';
  const pct = line.variancePct ?? 0;
  if (pct >= 0) return 'ok';
  if (pct >= -10) return 'wn';
  return 'bad';
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

const SOURCE_MODULE_LABELS: Record<string, string> = {
  finance_expenses:     'Expenses',
  finance_payroll:      'Payroll',
  finance_ap:           'AP',
  finance_disbursements:'Disbursements',
  test:                 'Test / Seeded',
};

function humanModule(key: string): string {
  return SOURCE_MODULE_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

// ── Edit form (single upsert via drawer) ──────────────────────────────────────

interface EditForm extends UpsertBudgetLineArgs {
  id?: string;
}

const EMPTY_FORM: EditForm = {
  costCenterId: '',
  fiscalYear:   CURRENT_YEAR,
  category:     '',
  label:        null,
  notes:        null,
  budgeted:     0,
  currency:     'TTD',
};

interface EditModalState { open: boolean; form: EditForm; busy: boolean; errors: Record<string, string> }

// ── Budget Lines Tab ──────────────────────────────────────────────────────────

function LinesTab({ fiscalYear, costCentreFilter, canManage }: {
  fiscalYear: number;
  costCentreFilter: string | null;
  canManage: boolean;
}): VNode {
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(0);
  const [sortField, setSortField] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc');
  const [drawerLineId, setDrawerLineId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [editModal, setEditModal]       = useState<EditModalState>({
    open: false, form: EMPTY_FORM, busy: false, errors: {},
  });

  const budgetsQ   = useBudgets({ fiscalYear, costCenterId: costCentreFilter ?? undefined });
  const budgets    = budgetsQ.data ?? [];
  const upsertMut  = useBudgetMutation(financeBudgetsApi.upsert);
  const deleteMut  = useBudgetMutation(financeBudgetsApi.delete);

  function handleSort(field: string, dir: 'asc' | 'desc'): void {
    setSortField(field); setSortDir(dir); setPage(0);
  }

  // Client-side search + sort
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? budgets.filter(b =>
          b.category.toLowerCase().includes(q) ||
          (b.label ?? '').toLowerCase().includes(q) ||
          (b.costCenterName ?? '').toLowerCase().includes(q),
        )
      : budgets;
    if (sortField) {
      rows = [...rows].sort((a, b) => {
        let av: string | number, bv: string | number;
        if (sortField === 'category')   { av = a.category;  bv = b.category; }
        else if (sortField === 'costCentre') { av = a.costCenterName ?? ''; bv = b.costCenterName ?? ''; }
        else if (sortField === 'fiscalYear') { av = a.fiscalYear; bv = b.fiscalYear; }
        else if (sortField === 'budgeted')   { av = a.budgeted;   bv = b.budgeted; }
        else if (sortField === 'actual')     { av = a.actual;      bv = b.actual; }
        else if (sortField === 'variance')   { av = a.variance;    bv = b.variance; }
        else { return 0; }
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }, [budgets, search, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function openDrawer(line: BudgetLine): void {
    setDrawerLineId(line.id);
    setDrawerOpen(true);
  }

  function openEdit(line: BudgetLine): void {
    setEditModal({
      open: true, busy: false, errors: {},
      form: {
        id:           line.id,
        costCenterId: line.costCenterId,
        fiscalYear:   line.fiscalYear,
        category:     line.category,
        label:        line.label,
        notes:        line.notes,
        budgeted:     line.budgeted,
        currency:     'TTD',
      },
    });
  }

  async function onEditSubmit(): Promise<void> {
    const f = editModal.form;
    const errors: Record<string, string> = {};
    if (!f.costCenterId) errors.costCenterId = 'Cost centre is required.';
    if (!f.category)     errors.category     = 'Category is required.';
    if (f.budgeted < 0)  errors.budgeted     = 'Amount cannot be negative.';
    if (Object.keys(errors).length) { setEditModal(m => ({ ...m, errors })); return; }

    setEditModal(m => ({ ...m, busy: true, errors: {} }));
    try {
      await upsertMut.mutateAsync({
        costCenterId: f.costCenterId,
        fiscalYear:   f.fiscalYear,
        category:     f.category,
        label:        f.label ?? null,
        notes:        f.notes ?? null,
        budgeted:     f.budgeted,
        currency:     'TTD',
      });
      toast('Budget line saved.');
      setEditModal(m => ({ ...m, open: false }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed.');
      setEditModal(m => ({ ...m, busy: false }));
    }
  }

  async function onDelete(line: BudgetLine): Promise<void> {
    const ok = await dialog.confirm({
      title:       'Delete budget line?',
      text:        `Delete "${line.category}" for ${line.costCenterName ?? 'cost centre'} FY ${line.fiscalYear}? This cannot be undone.`,
      confirmText: 'Delete',
      danger:      true,
    });
    if (!ok) return;
    try {
      await deleteMut.mutateAsync({ id: line.id });
      toast('Budget line deleted.');
      if (drawerOpen && drawerLineId === line.id) setDrawerOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  function handleExportCsv(): void {
    exportCsv(filtered, [
      { header: 'Category',       value: r => r.category },
      { header: 'Label',          value: r => r.label ?? '' },
      { header: 'Cost Centre',    value: r => r.costCenterName ?? r.costCenterId },
      { header: 'Fiscal Year',    value: r => String(r.fiscalYear) },
      { header: 'Budgeted (TTD)', value: r => String(r.budgeted) },
      { header: 'Actual (TTD)',   value: r => String(r.actual) },
      { header: 'Variance (TTD)', value: r => String(r.variance) },
      { header: 'Variance %',     value: r => r.variancePct != null ? r.variancePct.toFixed(2) : '' },
    ], `budget-lines-fy${fiscalYear}`);
  }

  const columns: HrfinColumn<BudgetLine>[] = [
    {
      key: 'category',
      label: 'Category',
      sortable: true,
      render: b => (
        <div>
          <div style={{ fontWeight: 600 }}>{b.category}</div>
          {b.label && <div style={{ fontSize: 11, color: 'var(--hrfin-muted)', marginTop: 1 }}>{b.label}</div>}
        </div>
      ),
    },
    {
      key: 'costCentre',
      label: 'Cost Centre',
      sortable: true,
      render: b => b.costCenterName ?? b.costCenterId,
    },
    {
      key: 'fiscalYear',
      label: 'FY',
      sortable: true,
      render: b => String(b.fiscalYear),
    },
    {
      key: 'budgeted',
      label: 'Budget',
      sortable: true,
      render: b => <strong style={{ fontFamily: 'monospace' }}>{money(b.budgeted)}</strong>,
    },
    {
      key: 'actual',
      label: 'Actual',
      sortable: true,
      render: b => <span style={{ fontFamily: 'monospace' }}>{money(b.actual)}</span>,
    },
    {
      key: 'variance',
      label: 'Variance',
      sortable: true,
      render: b => (
        <HrfinPill tone={varianceTone(b)}>
          {money(b.variance)} ({fmtPct(b.variancePct)})
        </HrfinPill>
      ),
    },
  ];

  return (
    <>
      <HrfinTable
        columns={columns}
        rows={pageRows}
        rowKey={r => r.id}
        onRowClick={openDrawer}
        rowActions={canManage ? (b => [
          { key: 'view',   label: 'View details',  icon: 'book',    onClick: () => openDrawer(b) },
          { key: 'edit',   label: 'Edit line',      icon: 'plus',    onClick: () => openEdit(b) },
          { key: 'export', label: 'Export CSV',     icon: 'download',onClick: handleExportCsv },
          { key: 'delete', label: 'Delete',         icon: 'alert',   danger: true, onClick: () => void onDelete(b) },
        ]) : (b => [
          { key: 'view',   label: 'View details',  icon: 'book',    onClick: () => openDrawer(b) },
        ])}
        searchValue={search}
        onSearch={q => { setSearch(q); setPage(0); }}
        searchPlaceholder="Search category, cost centre…"
        filters={[
          { label: 'Export CSV', icon: 'download', onClick: handleExportCsv },
        ]}
        page={page}
        pageCount={pageCount}
        total={filtered.length}
        pageSize={PAGE_SIZE}
        onPage={p => setPage(p)}
        noun="lines"
        loading={budgetsQ.isLoading && !budgets.length}
        error={budgetsQ.error?.message}
        emptyMessage={`No budget lines for FY ${fiscalYear}.`}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
      />

      {/* Drawer */}
      <BudLineDrawer
        lineId={drawerLineId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onEdit={canManage ? (line => { setDrawerOpen(false); openEdit(line); }) : undefined}
        onDelete={canManage ? (line => void onDelete(line)) : undefined}
      />

      {/* Edit single-line modal */}
      {editModal.open && (
        <div class="hrfin hrfin-wiz-backdrop" onClick={e => { if (e.target === e.currentTarget) setEditModal(m => ({ ...m, open: false })); }}>
          <div class="hrfin-wiz-modal" role="dialog" aria-modal="true" aria-label="Edit budget line">
            <div class="hrfin-wiz-head">
              <strong>Edit Budget Line</strong>
              <button type="button" class="hrfin-wiz-close" onClick={() => setEditModal(m => ({ ...m, open: false }))} aria-label="Close">×</button>
            </div>
            <div class="hrfin-wiz-body hrfin-wiz-fields">
              {/* Category (read-only when editing) */}
              <div class="hrfin-field">
                <label class="hrfin-label">Category</label>
                <input class="hrfin-input" type="text" value={editModal.form.category} readOnly style={{ opacity: .7 }} />
                <div class="hrfin-field-hint">Category cannot be changed — delete this line and create a new one.</div>
              </div>
              {/* Fiscal year (read-only when editing) */}
              <div class="hrfin-field">
                <label class="hrfin-label">Fiscal Year</label>
                <input class="hrfin-input" type="text" value={`FY ${editModal.form.fiscalYear}`} readOnly style={{ opacity: .7 }} />
              </div>
              {/* Budgeted */}
              <div class="hrfin-field">
                <label class="hrfin-label">Budgeted Amount (TTD) <span style={{ color: 'var(--hrfin-danger)' }}>*</span></label>
                <input
                  class={`hrfin-input${editModal.errors.budgeted ? ' is-error' : ''}`}
                  type="number" min="0" step="0.01"
                  value={editModal.form.budgeted}
                  onInput={e => setEditModal(m => ({ ...m, form: { ...m.form, budgeted: Number((e.target as HTMLInputElement).value) }, errors: { ...m.errors, budgeted: '' } }))}
                />
                {editModal.errors.budgeted && <div class="hrfin-field-error">{editModal.errors.budgeted}</div>}
              </div>
              {/* Label */}
              <div class="hrfin-field">
                <label class="hrfin-label">Label</label>
                <input
                  class="hrfin-input" type="text" maxLength={200}
                  value={editModal.form.label ?? ''}
                  onInput={e => setEditModal(m => ({ ...m, form: { ...m.form, label: (e.target as HTMLInputElement).value || null } }))}
                />
              </div>
              {/* Notes */}
              <div class="hrfin-field">
                <label class="hrfin-label">Notes</label>
                <textarea
                  class="hrfin-input" rows={3}
                  value={editModal.form.notes ?? ''}
                  onInput={e => setEditModal(m => ({ ...m, form: { ...m.form, notes: (e.target as HTMLTextAreaElement).value || null } }))}
                />
              </div>
            </div>
            <div class="hrfin-wiz-foot">
              <button type="button" class="hrfin-action" onClick={() => setEditModal(m => ({ ...m, open: false }))}>Cancel</button>
              <button type="button" class="hrfin-action is-primary" disabled={editModal.busy} onClick={() => void onEditSubmit()}>
                {editModal.busy ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Variance Tab ──────────────────────────────────────────────────────────────

function VarianceTab({ fiscalYear, costCentreFilter, onDrill }: {
  fiscalYear: number;
  costCentreFilter: string | null;
  onDrill?: (line: BudgetVarianceRow) => void;
}): VNode {
  const varQ   = useBudgetVariance(fiscalYear, costCentreFilter ?? undefined);
  const rows   = varQ.data ?? [];
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(0);
  const [sortField, setSortField] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc');

  function handleSort(field: string, dir: 'asc' | 'desc'): void {
    setSortField(field); setSortDir(dir); setPage(0);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = q
      ? rows.filter(r => r.category.toLowerCase().includes(q) || (r.costCenterName ?? '').toLowerCase().includes(q))
      : rows;
    if (sortField) {
      out = [...out].sort((a, b) => {
        let av: string | number, bv: string | number;
        if (sortField === 'cc')       { av = a.costCenterName ?? ''; bv = b.costCenterName ?? ''; }
        else if (sortField === 'category') { av = a.category;   bv = b.category; }
        else if (sortField === 'budgeted') { av = a.budgeted;   bv = b.budgeted; }
        else if (sortField === 'actual')   { av = a.actual;     bv = b.actual; }
        else if (sortField === 'variance') { av = a.variance;   bv = b.variance; }
        else if (sortField === 'varPct')   { av = a.variancePct ?? 0; bv = b.variancePct ?? 0; }
        else { return 0; }
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return out;
  }, [rows, search, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Chart data — top 12 by budget amount; each bar drills into the matching budget line
  const chartItems: HBarItem[] = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.budgeted - a.budgeted).slice(0, 12);
    const maxBudgeted = sorted[0]?.budgeted ?? 1;
    return sorted.map(r => {
      const isOver = r.actual > r.budgeted;
      return {
        label:   `${r.category} · ${r.costCenterName ?? ''}`,
        value:   moneyCompact(r.actual),
        percent: maxBudgeted > 0 ? Math.min(100, Math.round((r.actual / maxBudgeted) * 100)) : 0,
        tone:    isOver ? ('danger' as const) : (r.variancePct != null && r.variancePct < 10 ? ('warning' as const) : ('success' as const)),
        note:    `${fmtPct(r.variancePct)} vs ${moneyCompact(r.budgeted)} budget`,
        // §15: click bar → budget-line drawer
        onClick: onDrill ? () => onDrill(r) : undefined,
      };
    });
  }, [rows, onDrill]);

  function handleExport(): void {
    exportCsv(filtered, [
      { header: 'Cost Centre',    value: r => r.costCenterName ?? r.costCenterId },
      { header: 'Category',       value: r => r.category },
      { header: 'FY',             value: r => String(r.fiscalYear) },
      { header: 'Budgeted (TTD)', value: r => String(r.budgeted) },
      { header: 'Actual (TTD)',   value: r => String(r.actual) },
      { header: 'Variance (TTD)', value: r => String(r.variance) },
      { header: 'Variance %',     value: r => r.variancePct != null ? r.variancePct.toFixed(2) : '' },
    ], `budget-variance-fy${fiscalYear}`);
  }

  const columns: HrfinColumn<BudgetVarianceRow>[] = [
    { key: 'cc',       label: 'Cost Centre', sortable: true, render: r => r.costCenterName ?? r.costCenterId },
    { key: 'category', label: 'Category',    sortable: true, render: r => <strong>{r.category}</strong> },
    { key: 'budgeted', label: 'Budget',      sortable: true, render: r => <span style={{ fontFamily: 'monospace' }}>{money(r.budgeted)}</span> },
    { key: 'actual',   label: 'Actual',      sortable: true, render: r => <span style={{ fontFamily: 'monospace' }}>{money(r.actual)}</span> },
    {
      key: 'variance',
      label: 'Variance',
      sortable: true,
      render: r => {
        const tone: HrfinTone = r.variance >= 0 ? 'ok' : (r.variancePct != null && r.variancePct >= -10 ? 'wn' : 'bad');
        return <HrfinPill tone={tone}>{money(r.variance)}</HrfinPill>;
      },
    },
    { key: 'varPct', label: 'Var %', sortable: true, render: r => fmtPct(r.variancePct) },
  ];

  return (
    <div>
      {/* Chart — §15: click bar → budget-line drawer */}
      {chartItems.length > 0 && (
        <section class="hrfin-kpi-row" style={{ marginBottom: 16 }}>
          <article class="hrfin-kpi-card" style={{ flex: '1 1 100%', paddingBottom: 18 }}>
            <div class="hrfin-kpi-head"><span>Budget vs Actual — FY {fiscalYear} (top lines by budget; click a bar to drill in)</span></div>
            <HorizontalBars items={chartItems} />
          </article>
        </section>
      )}

      <HrfinTable
        columns={columns}
        rows={pageRows}
        rowKey={r => `${r.costCenterId}::${r.category}`}
        onRowClick={onDrill ? (r => onDrill(r)) : undefined}
        rowActions={_r => [
          { key: 'export', label: 'Export CSV', icon: 'download', onClick: handleExport },
        ]}
        searchValue={search}
        onSearch={q => { setSearch(q); setPage(0); }}
        searchPlaceholder="Search category, cost centre…"
        filters={[
          { label: 'Export CSV', icon: 'download', onClick: handleExport },
        ]}
        page={page}
        pageCount={pageCount}
        total={filtered.length}
        pageSize={PAGE_SIZE}
        onPage={p => setPage(p)}
        noun="variance rows"
        loading={varQ.isLoading && !rows.length}
        error={varQ.error?.message}
        emptyMessage={`No budget data for FY ${fiscalYear}.`}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
      />
    </div>
  );
}

// ── Actuals Tab ───────────────────────────────────────────────────────────────

function ActualsTab({ fiscalYear, costCentreFilter }: {
  fiscalYear: number;
  costCentreFilter: string | null;
}): VNode {
  const actualsQ = useBudgetActuals(fiscalYear, costCentreFilter ?? undefined);
  const entries  = actualsQ.data ?? [];
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(0);
  const [sortField, setSortField] = useState<string | undefined>(undefined);
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc');

  function handleSort(field: string, dir: 'asc' | 'desc'): void {
    setSortField(field); setSortDir(dir); setPage(0);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = q
      ? entries.filter(e =>
          (e.ref ?? '').toLowerCase().includes(q) ||
          e.sourceModule.toLowerCase().includes(q) ||
          e.sourceEntityType.toLowerCase().includes(q),
        )
      : entries;
    if (sortField) {
      out = [...out].sort((a, b) => {
        let av: string | number, bv: string | number;
        if (sortField === 'ref')    { av = a.ref ?? ''; bv = b.ref ?? ''; }
        else if (sortField === 'module') { av = a.sourceModule; bv = b.sourceModule; }
        else if (sortField === 'type')   { av = a.sourceEntityType; bv = b.sourceEntityType; }
        else if (sortField === 'amount') { av = a.amount; bv = b.amount; }
        else if (sortField === 'status') { av = a.status; bv = b.status; }
        else if (sortField === 'date')   { av = a.createdAt; bv = b.createdAt; }
        else { return 0; }
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return out;
  }, [entries, search, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleExport(): void {
    exportCsv(filtered, [
      { header: 'Ref',          value: r => r.ref ?? '' },
      { header: 'Source Module', value: r => r.sourceModule },
      { header: 'Entity Type',  value: r => r.sourceEntityType },
      { header: 'Entity ID',    value: r => r.sourceEntityId },
      { header: 'Amount (TTD)', value: r => String((r).amount) },
      { header: 'Status',       value: r => r.status },
      { header: 'Created At',   value: r => r.createdAt },
    ], `budget-actuals-fy${fiscalYear}`);
  }

  const columns: HrfinColumn<CostEntryRow>[] = [
    { key: 'ref',    label: 'Ref',    sortable: true, render: r => <code style={{ fontSize: 11 }}>{r.ref ?? r.id.slice(0, 10)}</code> },
    { key: 'module', label: 'Module', sortable: true, render: r => humanModule(r.sourceModule) },
    { key: 'type',   label: 'Type',   sortable: true, render: r => r.sourceEntityType.replace(/_/g, ' ') },
    { key: 'amount', label: 'Amount', sortable: true, render: r => <strong style={{ fontFamily: 'monospace' }}>{money(r.amount)}</strong> },
    { key: 'status', label: 'Status', sortable: true, render: r => <HrfinPill tone="ok">{r.status}</HrfinPill> },
    { key: 'date',   label: 'Date',   sortable: true, render: r => new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) },
  ];

  return (
    <HrfinTable
      columns={columns}
      rows={pageRows}
      rowKey={r => r.id}
      rowActions={_r => [
        { key: 'export', label: 'Export CSV', icon: 'download', onClick: handleExport },
      ]}
      searchValue={search}
      onSearch={q => { setSearch(q); setPage(0); }}
      searchPlaceholder="Search ref, module, type…"
      filters={[
        { label: 'Export CSV', icon: 'download', onClick: handleExport },
      ]}
      page={page}
      pageCount={pageCount}
      total={filtered.length}
      pageSize={PAGE_SIZE}
      onPage={p => setPage(p)}
      noun="cost entries"
      loading={actualsQ.isLoading && !entries.length}
      error={actualsQ.error?.message}
      emptyMessage={`No approved cost entries for FY ${fiscalYear}.`}
      sortField={sortField}
      sortDir={sortDir}
      onSort={handleSort}
    />
  );
}

// ── Reports Tab ───────────────────────────────────────────────────────────────

const BUDGET_VARIANCE_COLS: ReportColumn[] = [
  { header: 'Cost Centre',  key: 'costCenterName' },
  { header: 'Category',     key: 'category' },
  { header: 'FY',           key: 'fiscalYear' },
  { header: 'Budgeted',     key: 'budgeted',    format: 'currency' },
  { header: 'Actual',       key: 'actual',      format: 'currency' },
  { header: 'Variance',     key: 'variance',    format: 'currency' },
  { header: 'Variance %',   value: r => (r.variancePct != null ? Number(r.variancePct).toFixed(2) + '%' : '—') },
];

const BUDGET_ACTUALS_COLS: ReportColumn[] = [
  { header: 'Ref',          key: 'ref' },
  { header: 'Module',       value: r => humanModule((r.sourceModule as string | undefined) ?? '') },
  { header: 'Amount',       key: 'amount', format: 'currency' },
  { header: 'Status',       key: 'status' },
  { header: 'Date',         key: 'createdAt', format: 'date' },
];

function ReportsTab({ fiscalYear, costCentreFilter }: {
  fiscalYear: number;
  costCentreFilter: string | null;
}): VNode {
  const reportsQ = useBudgetReports();
  const reports  = (reportsQ.data ?? []).map(r => ({ key: r.key, label: r.label, description: r.description }));

  const [selectedKey, setSelectedKey]  = useState<string | null>(null);
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError]   = useState<string | null>(null);

  async function runReport(key: string): Promise<void> {
    setSelectedKey(key);
    setReportResult(null);
    setReportError(null);
    setReportLoading(true);
    try {
      const rows = await financeBudgetsApi.runReport({
        reportKey:    key,
        fiscalYear,
        costCenterId: costCentreFilter ?? undefined,
      });
      setReportResult({ report: key, generatedAt: new Date().toISOString(), rows: rows as unknown as ReportRow[] });
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Report failed.');
    } finally {
      setReportLoading(false);
    }
  }

  const cols = selectedKey === 'budget_actuals' ? BUDGET_ACTUALS_COLS : BUDGET_VARIANCE_COLS;

  return (
    <ReportPanel
      reports={reports}
      selectedReport={selectedKey}
      onSelectReport={k => void runReport(k)}
      result={reportResult}
      columns={cols}
      exportFilename={`budget-report-fy${fiscalYear}`}
      loading={reportLoading}
      error={reportError}
      params={
        <div style={{ fontSize: 12, color: 'var(--hrfin-muted)', padding: '4px 0 8px' }}>
          FY {fiscalYear}{costCentreFilter ? ` · filtered by cost centre` : ''}
        </div>
      }
    />
  );
}

// ── Imports Tab ───────────────────────────────────────────────────────────────

function ImportsTab({ fiscalYear, costCentreId, canManage }: {
  fiscalYear: number;
  costCentreId: string | null;
  canManage: boolean;
}): VNode {
  const [file, setFile]           = useState<File | null>(null);
  const [preview, setPreview]     = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importOk, setImportOk]   = useState<string | null>(null);

  const bulkMut = useBudgetMutation(financeBudgetsApi.bulkUpsert);

  function parseCsv(text: string): Record<string, string>[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = (lines[0] ?? '').split(',').map(h => h.trim().toLowerCase());
    return lines.slice(1).map(l => {
      const vals = l.split(',');
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim(); });
      return row;
    });
  }

  async function onFileChange(e: Event): Promise<void> {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    setFile(f);
    setImportErr(null);
    setImportOk(null);
    const text = await f.text();
    const rows = parseCsv(text);
    setPreview(rows.slice(0, 5));
  }

  async function onImport(): Promise<void> {
    if (!file || !costCentreId) {
      setImportErr('Please select a file and a cost centre.');
      return;
    }
    setImporting(true);
    setImportErr(null);
    setImportOk(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const lines = rows.map(r => ({
        costCenterId: costCentreId,
        fiscalYear,
        category: r.category ?? '',
        label:    r.label ?? null,
        notes:    r.notes ?? null,
        budgeted: parseFloat(r.budgeted ?? r.amount ?? '0') || 0,
        currency: 'TTD' as const,
      })).filter(l => l.category && l.budgeted >= 0);

      if (!lines.length) { setImportErr('No valid rows found. Check that CSV has category and budgeted columns.'); setImporting(false); return; }

      const result = await bulkMut.mutateAsync({ lines });
      setImportOk(`${result.count} budget line${result.count !== 1 ? 's' : ''} imported.${result.overBudgetCount > 0 ? ` ⚠ ${result.overBudgetCount} line${result.overBudgetCount > 1 ? 's' : ''} are over budget.` : ''}`);
      setFile(null);
      setPreview([]);
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div class="hrfin-wiz-fields" style={{ maxWidth: 680 }}>
      {!canManage && (
        <div style={{ padding: '10px 14px', background: 'var(--hrfin-surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--hrfin-muted)' }}>
          You do not have permission to import budget lines.
        </div>
      )}
      {canManage && (
        <>
          <div style={{ padding: '12px 14px', background: 'var(--hrfin-surface-2)', borderRadius: 8, fontSize: 12, marginBottom: 14 }}>
            <div style={{ fontWeight: 500, marginBottom: 6 }}>CSV Format</div>
            <code style={{ display: 'block', fontSize: 11, background: 'var(--hrfin-surface)', padding: '6px 8px', borderRadius: 4 }}>
              category,budgeted,label,notes
            </code>
            <div style={{ marginTop: 6, color: 'var(--hrfin-muted)' }}>
              Required: <strong>category</strong>, <strong>budgeted</strong>. The cost centre and fiscal year are taken from the current filter selection.
            </div>
          </div>

          {/* Cost centre must be selected */}
          {!costCentreId && (
            <div style={{ padding: '10px 14px', background: 'var(--hrfin-danger-10)', color: 'var(--hrfin-danger)', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
              Select a cost centre in the page filter before importing.
            </div>
          )}

          <div class="hrfin-field">
            <label class="hrfin-label">Upload CSV file</label>
            <input
              class="hrfin-input"
              type="file"
              accept=".csv,text/csv"
              onChange={e => void onFileChange(e)}
              disabled={!costCentreId}
            />
          </div>

          {preview.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Preview (first 5 rows)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {Object.keys(preview[0] ?? {}).map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '4px 8px 4px 0', borderBottom: '2px solid var(--hrfin-border)', color: 'var(--hrfin-muted)', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
                      {Object.values(r).map((v, j) => (
                        <td key={j} style={{ padding: '5px 8px 5px 0' }}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importErr && (
            <div style={{ padding: '8px 12px', background: 'var(--hrfin-danger-10)', color: 'var(--hrfin-danger)', borderRadius: 6, fontSize: 13 }}>
              {importErr}
            </div>
          )}
          {importOk && (
            <div style={{ padding: '8px 12px', background: 'var(--hrfin-success-10)', color: 'var(--hrfin-success)', borderRadius: 6, fontSize: 13 }}>
              {importOk}
            </div>
          )}

          <button
            type="button"
            class="hrfin-action is-primary"
            onClick={() => void onImport()}
            disabled={!file || !costCentreId || importing}
          >
            {importing ? 'Importing…' : 'Import Budget Lines'}
          </button>
        </>
      )}
    </div>
  );
}

// ── Root page ─────────────────────────────────────────────────────────────────

export function BudgetsOverview(): VNode {
  const [tab, setTab]                   = useState<Tab>('lines');
  const [fiscalYear, setFiscalYear]     = useState(CURRENT_YEAR);
  const [costCentreId, setCostCentreId] = useState<string | null>(null);
  const [bulkWizOpen, setBulkWizOpen]   = useState(false);
  const [copyDlgOpen, setCopyDlgOpen]   = useState(false);

  // For variance chart drill-through — open drawer
  const [drillLineId, setDrillLineId]   = useState<string | null>(null);
  const [drillOpen, setDrillOpen]       = useState(false);

  // KPIs
  const budgetsQ = useBudgets({ fiscalYear, costCenterId: costCentreId ?? undefined });
  const budgets  = budgetsQ.data ?? [];
  const reportsQ = useBudgetReports();

  const totalBudgeted   = budgets.reduce((s, b) => s + b.budgeted, 0);
  const totalActual     = budgets.reduce((s, b) => s + b.actual, 0);
  const totalVariance   = totalBudgeted - totalActual;
  const overBudgetCount = budgets.filter(b => b.actual > b.budgeted).length;
  const remainingBudget = Math.max(0, totalBudgeted - totalActual);
  const reportsCount    = reportsQ.data?.length ?? 0;
  const isLoading       = budgetsQ.isLoading && !budgets.length;

  const canManage  = useCan('finance.budgets.manage');
  const canView    = useCan('finance.budgets.view') || canManage;

  // Page-level export — exports all budget lines for the current FY/cost-centre filter
  function handlePageExport(): void {
    exportCsv(budgets, [
      { header: 'Category',       value: r => r.category },
      { header: 'Label',          value: r => r.label ?? '' },
      { header: 'Cost Centre',    value: r => r.costCenterName ?? r.costCenterId },
      { header: 'Fiscal Year',    value: r => String(r.fiscalYear) },
      { header: 'Period',         value: r => r.period ?? '' },
      { header: 'Budgeted (TTD)', value: r => String(r.budgeted) },
      { header: 'Actual (TTD)',   value: r => String(r.actual) },
      { header: 'Variance (TTD)', value: r => String(r.variance) },
      { header: 'Variance %',     value: r => r.variancePct != null ? r.variancePct.toFixed(2) : '' },
    ], `budget-lines-fy${fiscalYear}`);
  }

  // Variance drill — find the line by category+cc for the clicked row
  function handleVarianceDrill(_r: BudgetVarianceRow): void {
    // Try to find the budget line matching this variance row
    const line = budgets.find(b => b.costCenterId === _r.costCenterId && b.category === _r.category);
    if (line) {
      setDrillLineId(line.id);
      setDrillOpen(true);
    }
  }

  return (
    <div class="hrfin">
      {/* Page header */}
      <HrfinPageHeader
        icon="book"
        title="Budgeting & Budget-vs-Actual"
        sub="Set budgets per cost centre, fiscal year and category. Compare against actual spend from approved cost entries."
        chips={[
          ...(overBudgetCount > 0 ? [{ icon: 'alert' as const, label: `${overBudgetCount} over budget`, tone: 'danger' as const }] : []),
          ...(budgets.length > 0 ? [{ label: `FY ${fiscalYear}` }] : []),
        ]}
      />

      {/* Quick actions */}
      <QuickActionStrip
        actions={[
          ...(canManage ? [
            { key: 'bulk',  label: 'Bulk Budget Entry',  icon: 'plus'     as const, variant: 'primary'    as const, onClick: () => setBulkWizOpen(true) },
            { key: 'copy',  label: 'Copy Last Year',      icon: 'refresh'  as const,                                onClick: () => setCopyDlgOpen(true) },
            { key: 'export',label: 'Export CSV',          icon: 'download' as const,                                onClick: handlePageExport },
          ] : []),
          ...(!canManage && canView ? [
            { key: 'export', label: 'Export CSV', icon: 'download' as const, onClick: handlePageExport },
          ] : []),
        ]}
      />

      {/* Global filter bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Fiscal year:</div>
        <select
          class="hrfin-select"
          value={fiscalYear}
          onChange={e => setFiscalYear(Number((e.target as HTMLSelectElement).value))}
          style={{ width: 100 }}
        >
          {YEAR_OPTS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <div style={{ minWidth: 260 }}>
          <CostCentrePicker
            label=""
            value={costCentreId}
            onChange={v => setCostCentreId(v)}
            placeholder="All cost centres"
          />
        </div>
        {costCentreId && (
          <button class="hrfin-action" onClick={() => setCostCentreId(null)} style={{ fontSize: 12 }}>
            Clear ×
          </button>
        )}
      </div>

      {/* KPI strip */}
      <section class="hrfin-kpi-row">
        <KpiCard
          label="Total Budget"
          value={isLoading ? undefined : money(totalBudgeted)}
          support={`FY ${fiscalYear}`}
          visual="bars"
          values={budgets.slice(0, 8).map(b => b.budgeted / Math.max(1, totalBudgeted) * 100)}
          loading={isLoading}
        />
        <KpiCard
          label="Actual Spend"
          value={isLoading ? undefined : money(totalActual)}
          support={`${Math.round(totalBudgeted > 0 ? (totalActual / totalBudgeted) * 100 : 0)}% of budget`}
          visual="progress"
          percent={totalBudgeted > 0 ? Math.min(100, Math.round((totalActual / totalBudgeted) * 100)) : 0}
          tone={totalActual > totalBudgeted ? 'danger' : 'accent'}
          loading={isLoading}
        />
        <KpiCard
          label="Variance"
          value={isLoading ? undefined : money(totalVariance)}
          badge={totalVariance >= 0 ? 'Under budget' : 'Over budget'}
          badgeTone={totalVariance >= 0 ? 'success' : 'danger'}
          tone={totalVariance >= 0 ? 'success' : 'danger'}
          loading={isLoading}
        />
        <KpiCard
          label="Over-budget Lines"
          value={isLoading ? undefined : String(overBudgetCount)}
          badge={overBudgetCount > 0 ? 'Needs attention' : undefined}
          badgeTone="danger"
          tone={overBudgetCount > 0 ? 'danger' : 'success'}
          support={`of ${budgets.length} total lines`}
          loading={isLoading}
        />
        <KpiCard
          label="Remaining Budget"
          value={isLoading ? undefined : money(remainingBudget)}
          support="After current spend"
          tone="accent"
          loading={isLoading}
        />
        <KpiCard
          label="Reports Ready"
          value={isLoading ? undefined : String(reportsCount)}
          support="Report types available"
          loading={reportsQ.isLoading}
        />
      </section>

      {/* Main content table card with tabs */}
      <article class="hrfin-table-card">
        <div class="hrfin-tabs">
          {TABS.map(t => (
            <button key={t.key} type="button" class={t.key === tab ? 'is-active' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          {tab === 'lines'    && <LinesTab fiscalYear={fiscalYear} costCentreFilter={costCentreId} canManage={canManage} />}
          {tab === 'variance' && <VarianceTab fiscalYear={fiscalYear} costCentreFilter={costCentreId} onDrill={handleVarianceDrill} />}
          {tab === 'actuals'  && <ActualsTab fiscalYear={fiscalYear} costCentreFilter={costCentreId} />}
          {tab === 'reports'  && <ReportsTab fiscalYear={fiscalYear} costCentreFilter={costCentreId} />}
          {tab === 'imports'  && <ImportsTab fiscalYear={fiscalYear} costCentreId={costCentreId} canManage={canManage} />}
        </div>
      </article>

      {/* Variance drill drawer */}
      <BudLineDrawer
        lineId={drillLineId}
        open={drillOpen}
        onClose={() => setDrillOpen(false)}
      />

      {/* Bulk entry wizard */}
      <BudBulkUpsertWizard
        open={bulkWizOpen}
        onClose={() => setBulkWizOpen(false)}
        onSuccess={() => toast('Budget lines saved.')}
      />

      {/* Copy last year dialog */}
      <BudCopyLastYearDialog
        open={copyDlgOpen}
        onClose={() => setCopyDlgOpen(false)}
        onSuccess={({ copied }) => toast(`${copied} budget line${copied !== 1 ? 's' : ''} copied.`)}
      />
    </div>
  );
}
