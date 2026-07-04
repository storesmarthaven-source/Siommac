/**
 * src/components/sections/Finance/BudgetsOverview.tsx
 *
 * Finance ▸ Budgeting & Budget-vs-Actual (nav id `s-finance-budgets`).
 * Surfaces: Budget Lines · Budget-vs-Actual Variance · Reports.
 *
 * This module only READS finance_cost_entries for actuals — it does NOT mutate them.
 * All mutations operate on finance_budget_lines exclusively.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, EmptyState } from '@ui';
import {
  useBudgets,
  useBudgetVariance,
  useBudgetMutation,
  financeBudgetsApi,
  type BudgetLine,
  type BudgetVarianceRow,
  type UpsertBudgetLineArgs,
} from '@api/finance/budgets';
import { fmtMoney } from './financeShared';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import './finance.css';

type Surface = 'lines' | 'variance' | 'reports';

const SURFACES: { id: Surface; label: string }[] = [
  { id: 'lines',    label: 'Budget Lines' },
  { id: 'variance', label: 'Budget vs Actual' },
  { id: 'reports',  label: 'Reports' },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - 2 + i);

function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(1) + '%';
}

function varianceClass(v: number): string {
  if (v > 0) return 'fin-var-pos';  // under budget
  if (v < 0) return 'fin-var-neg';  // over budget
  return '';
}

export function BudgetsOverview(): VNode {
  const [surface, setSurface] = useState<Surface>('lines');
  const [yearFilter, setYearFilter] = useState<number>(CURRENT_YEAR);

  const budgetsQ  = useBudgets({ fiscalYear: yearFilter });
  const budgets    = budgetsQ.data ?? [];

  const totalBudgeted = budgets.reduce((s, b) => s + b.budgeted, 0);
  const totalActual   = budgets.reduce((s, b) => s + b.actual,   0);
  const totalVariance = totalBudgeted - totalActual;

  const canManage = can('finance.budgets.manage');

  const STAT_ROW = [
    { label: 'Budget lines',   val: budgets.length },
    { label: 'Total budgeted', val: fmtMoney(totalBudgeted) },
    { label: 'Total actuals',  val: fmtMoney(totalActual) },
    { label: 'Net variance',   val: fmtMoney(totalVariance) },
  ];

  return (
    <div class="hr-offboarding fin-page">
      <PageHeader
        icon="fa-chart-pie"
        module="Finance · Budgeting"
        title="Budgeting & Budget-vs-Actual"
        sub="Set budgets per cost centre, fiscal year and category. Compare against actual spend from cost entries."
      />

      <div class="obx-repstats" style={{ margin: '4px 0 12px' }}>
        {STAT_ROW.map(s => (
          <div class="obx-repstat" key={s.label}>
            <div class="obx-repstat-val">{s.val}</div>
            <div class="obx-repstat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, margin: '6px 0 10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontWeight: 600, fontSize: 13 }}>Fiscal year:</label>
        <select
          class="obx-select"
          value={yearFilter}
          onChange={e => setYearFilter(Number((e.target as HTMLSelectElement).value))}
        >
          {YEAR_OPTS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div class="obx-viewswitch" style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        {SURFACES.map(s => (
          <button key={s.id} class={`obx-view-btn${surface === s.id ? ' active' : ''}`} onClick={() => setSurface(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {surface === 'lines'    && (
        <LinesSurface
          budgets={budgets}
          loading={budgetsQ.isLoading}
          canManage={canManage}
          fiscalYear={yearFilter}
        />
      )}
      {surface === 'variance' && <VarianceSurface fiscalYear={yearFilter} />}
      {surface === 'reports'  && <ReportsSurface />}
    </div>
  );
}

// ── Budget Lines Surface ────────────────────────────────────────────────────────

interface UpsertForm extends UpsertBudgetLineArgs {
  id?: string;
}

const EMPTY_FORM: UpsertForm = {
  costCenterId: '',
  fiscalYear: CURRENT_YEAR,
  category: '',
  label: '',
  notes: '',
  budgeted: 0,
  currency: 'TTD',
};

function LinesSurface({ budgets, loading, canManage, fiscalYear }: {
  budgets: BudgetLine[];
  loading: boolean;
  canManage: boolean;
  fiscalYear: number;
}): VNode {
  const [modal, setModal] = useState<{ open: boolean; form: UpsertForm; busy: boolean }>(
    { open: false, form: EMPTY_FORM, busy: false },
  );

  const upsertMut = useBudgetMutation(financeBudgetsApi.upsert);
  const deleteMut = useBudgetMutation(financeBudgetsApi.delete);

  function openNew(): void {
    setModal({ open: true, form: { ...EMPTY_FORM, fiscalYear }, busy: false });
  }

  function openEdit(b: BudgetLine): void {
    setModal({
      open: true,
      busy: false,
      form: {
        id: b.id,
        costCenterId: b.costCenterId,
        fiscalYear:   b.fiscalYear,
        category:     b.category,
        label:        b.label ?? '',
        notes:        b.notes ?? '',
        budgeted:     b.budgeted,
        currency:     'TTD',
      },
    });
  }

  async function onSubmit(): Promise<void> {
    const f = modal.form;
    if (!f.costCenterId) { dialog.error('Cost centre is required.'); return; }
    if (!f.category)     { dialog.error('Category is required.'); return; }
    if (f.budgeted < 0)  { dialog.error('Budgeted amount cannot be negative.'); return; }
    setModal(m => ({ ...m, busy: true }));
    try {
      await upsertMut.mutateAsync({
        costCenterId: f.costCenterId,
        fiscalYear:   f.fiscalYear,
        category:     f.category,
        label:        f.label || null,
        notes:        f.notes || null,
        budgeted:     f.budgeted,
        currency:     'TTD',
      });
      dialog.success('Budget line saved.');
      setModal(m => ({ ...m, open: false }));
    } catch (e) {
      dialog.error(e instanceof Error ? e.message : 'Failed to save budget line.');
      setModal(m => ({ ...m, busy: false }));
    }
  }

  async function onDelete(b: BudgetLine): Promise<void> {
    const ok = await dialog.confirm({
      title:   'Delete budget line?',
      text: `Delete the ${b.category} budget for ${b.costCenterName ?? b.costCenterId} (FY ${b.fiscalYear})? This cannot be undone.`,
      confirmText: 'Delete', danger: true,
    });
    if (!ok) return;
    try {
      await deleteMut.mutateAsync({ id: b.id });
      dialog.success('Budget line deleted.');
    } catch (e) {
      dialog.error(e instanceof Error ? e.message : 'Failed to delete budget line.');
    }
  }

  const ctx: DialogContextPanelConfig = {
    eyebrow: 'Finance · Budgeting',
    title: 'Budget Line',
    description: 'Set the budgeted amount for a cost centre, fiscal year and category. Actuals are computed from approved finance cost entries.',
    preview: {
      icon: 'BGT', title: 'Budget Line',
      subtitle: 'Finance · Budgeting',
      badges: [],
    },
    metrics: [
      { label: 'Currency', value: 'TTD (fixed)', tone: 'default' },
    ],
  };

  function patchForm(patch: Partial<UpsertForm>): void {
    setModal(m => ({ ...m, form: { ...m.form, ...patch } }));
  }

  return (
    <>
      <div class="obx-section"><div class="obx-section-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Budget Lines — FY {fiscalYear}</span>
          {canManage && (
            <button class="obx-btn obx-btn-primary" onClick={openNew}>
              <i class="fa fa-plus" /> Set / Update Budget
            </button>
          )}
        </div>

        {loading ? <div class="obx-empty">Loading…</div>
          : !budgets.length ? (
            <EmptyState
              icon="fa-chart-pie"
              title="No budget lines"
              text={`No budget lines found for FY ${fiscalYear}. ${canManage ? 'Click \"Set / Update Budget\" to add one.' : ''}`}
            />
          ) : (
            <table class="obx-table">
              <thead>
                <tr>
                  <th>Cost Centre</th>
                  <th>Category</th>
                  <th>FY</th>
                  <th style={{ textAlign: 'right' }}>Budgeted</th>
                  <th style={{ textAlign: 'right' }}>Actual</th>
                  <th style={{ textAlign: 'right' }}>Variance</th>
                  <th style={{ textAlign: 'right' }}>Var%</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {budgets.map(b => (
                  <tr key={b.id}>
                    <td>{b.costCenterName ?? b.costCenterId}</td>
                    <td>{b.label ? <><strong>{b.category}</strong> <span class="vt-cell-subtext">{b.label}</span></> : b.category}</td>
                    <td>{b.fiscalYear}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(b.budgeted)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(b.actual)}</td>
                    <td style={{ textAlign: 'right' }} class={varianceClass(b.variance)}>{fmtMoney(b.variance)}</td>
                    <td style={{ textAlign: 'right' }} class={varianceClass(b.variance)}>{fmtPct(b.variancePct)}</td>
                    {canManage && (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button class="obx-btn obx-btn-sm" onClick={() => openEdit(b)}>Edit</button>
                        {' '}
                        <button class="obx-btn obx-btn-sm obx-btn-danger" onClick={() => void onDelete(b)}>Del</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div></div>

      <EnterpriseFormModal
        open={modal.open}
        title={modal.form.id ? 'Edit Budget Line' : 'Set / Update Budget'}
        subtitle={`FY ${modal.form.fiscalYear} — enter the budgeted amount for a cost centre and category.`}
        icon="fa-chart-pie"
        context={ctx}
        primaryLabel={modal.form.id ? 'Save Changes' : 'Set Budget'}
        loading={modal.busy}
        disabled={modal.busy}
        onCancel={() => setModal(m => ({ ...m, open: false }))}
        onSubmit={() => void onSubmit()}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div class="obx-field">
            <label class="obx-label">Cost Centre ID <span class="obx-req">*</span></label>
            <input
              class="obx-input"
              type="text"
              placeholder="UUID of the cost centre"
              value={modal.form.costCenterId}
              onInput={e => patchForm({ costCenterId: (e.target as HTMLInputElement).value.trim() })}
            />
            <div class="obx-field-help">Paste the UUID from HR ▸ Organisation ▸ Cost Centres.</div>
          </div>
          <div class="obx-field">
            <label class="obx-label">Fiscal Year <span class="obx-req">*</span></label>
            <select
              class="obx-select"
              value={modal.form.fiscalYear}
              onChange={e => patchForm({ fiscalYear: Number((e.target as HTMLSelectElement).value) })}
            >
              {YEAR_OPTS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div class="obx-field">
            <label class="obx-label">Category <span class="obx-req">*</span></label>
            <input
              class="obx-input"
              type="text"
              placeholder="e.g. Labour, Materials, Equipment"
              value={modal.form.category}
              onInput={e => patchForm({ category: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="obx-field">
            <label class="obx-label">Label / Description</label>
            <input
              class="obx-input"
              type="text"
              placeholder="Optional short label for display"
              value={modal.form.label ?? ''}
              onInput={e => patchForm({ label: (e.target as HTMLInputElement).value || null })}
            />
          </div>
          <div class="obx-field">
            <label class="obx-label">Budgeted Amount (TTD) <span class="obx-req">*</span></label>
            <input
              class="obx-input"
              type="number"
              min="0"
              step="0.01"
              value={modal.form.budgeted}
              onInput={e => patchForm({ budgeted: Number((e.target as HTMLInputElement).value) })}
            />
          </div>
          <div class="obx-field">
            <label class="obx-label">Notes</label>
            <textarea
              class="obx-input"
              rows={3}
              placeholder="Optional notes"
              value={modal.form.notes ?? ''}
              onInput={e => patchForm({ notes: (e.target as HTMLTextAreaElement).value || null })}
            />
          </div>
        </div>
      </EnterpriseFormModal>
    </>
  );
}

// ── Variance Surface ────────────────────────────────────────────────────────────

function VarianceSurface({ fiscalYear }: { fiscalYear: number }): VNode {
  const varQ = useBudgetVariance(fiscalYear);
  const rows = varQ.data ?? [];

  if (varQ.isLoading) return <div class="obx-empty">Loading variance data…</div>;
  if (!rows.length) {
    return <EmptyState icon="fa-chart-bar" title="No budget data" text={`No budget lines for FY ${fiscalYear}.`} />;
  }

  return (
    <div class="obx-section"><div class="obx-section-body">
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Budget vs Actual — FY {fiscalYear}</div>
      <table class="obx-table">
        <thead>
          <tr>
            <th>Cost Centre</th>
            <th>Category</th>
            <th style={{ textAlign: 'right' }}>Budgeted</th>
            <th style={{ textAlign: 'right' }}>Actual</th>
            <th style={{ textAlign: 'right' }}>Variance</th>
            <th style={{ textAlign: 'right' }}>Var %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: BudgetVarianceRow) => (
            <tr key={`${r.costCenterId}-${r.category}`}>
              <td>{r.costCenterName ?? r.costCenterId}</td>
              <td>{r.category}</td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(r.budgeted)}</td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(r.actual)}</td>
              <td style={{ textAlign: 'right' }} class={varianceClass(r.variance)}>{fmtMoney(r.variance)}</td>
              <td style={{ textAlign: 'right' }} class={varianceClass(r.variance)}>{fmtPct(r.variancePct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div></div>
  );
}

// ── Reports Surface ─────────────────────────────────────────────────────────────

function ReportsSurface(): VNode {
  const repsQ = (() => {
    const [fiscalYear] = useState<number>(CURRENT_YEAR);
    return { fiscalYear };
  })();

  return (
    <div class="obx-section"><div class="obx-section-body">
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Budget Reports</div>
      <div class="obx-empty" style={{ color: '#888', fontSize: 13, padding: 20 }}>
        Reports are generated via the API. Use the Budget vs Actual tab for live variance data.
        <br />
        <em>Available reports: budget_variance, budget_summary</em>
        <br />
        <small>FY: {repsQ.fiscalYear}</small>
      </div>
    </div></div>
  );
}
