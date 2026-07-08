/**
 * src/components/sections/Finance/BudBulkUpsertWizard.tsx
 *
 * 6-step Aurora wizard for bulk budget entry.
 * Step 0: Fiscal year + description
 * Step 1: Cost centre (CostCentrePicker)
 * Step 2: Category selection (BudgetCategoryPicker — multi-select)
 * Step 3: Multi-line entry (amount + label + notes per category)
 * Step 4: Review vs prior year
 * Step 5: Confirm & submit
 */

import { type VNode } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { HrfinWizardModal } from '@ui';
import { CostCentrePicker, BudgetCategoryPicker, EmployeePicker } from './_shared/pickers';
import {
  financeBudgetsApi,
  useBudgetMutation,
  useBudgets,
  type BulkBudgetLineArg,
} from '@api/finance/budgets';
import { money } from './hrfinFormat';

// ── Constants ─────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - 2 + i);

const PERIOD_OPTIONS = ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'Full-Year'] as const;

interface LineEntry {
  category: string;
  label: string;
  notes: string;
  budgeted: string; // string for the input, converted on submit
  period: string;   // e.g. 'Q1', 'H2', 'Full-Year'
  ownerId: string;  // app_users.id TEXT (blank = no owner)
  error?: string;
}

interface WizardState {
  fiscalYear: number;
  description: string;
  costCentreId: string | null;
  costCentreName: string;
  selectedCategories: string[];
  lines: LineEntry[];
}

const EMPTY_STATE: WizardState = {
  fiscalYear: CURRENT_YEAR,
  description: '',
  costCentreId: null,
  costCentreName: '',
  selectedCategories: [],
  lines: [],
};

// ── Step panels ───────────────────────────────────────────────────────────────

function Step0FiscalYear({ state, patch }: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
}): VNode {
  return (
    <div class="hrfin-wiz-fields">
      <div class="hrfin-field">
        <label class="hrfin-label">Fiscal Year <span style={{ color: 'var(--hrfin-danger)' }}>*</span></label>
        <select
          class="hrfin-select"
          value={state.fiscalYear}
          onChange={e => patch({ fiscalYear: Number((e.target as HTMLSelectElement).value) })}
        >
          {YEAR_OPTS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div class="hrfin-field-hint">Select the fiscal year for this budget entry batch.</div>
      </div>
      <div class="hrfin-field">
        <label class="hrfin-label">Batch Description</label>
        <input
          class="hrfin-input"
          type="text"
          placeholder="e.g. Q1 2026 Labour & Materials"
          maxLength={200}
          value={state.description}
          onInput={e => patch({ description: (e.target as HTMLInputElement).value })}
        />
        <div class="hrfin-field-hint">Optional label for this batch (used in audit trail).</div>
      </div>
    </div>
  );
}

function Step1CostCentre({ state, patch }: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
}): VNode {
  return (
    <div class="hrfin-wiz-fields">
      <CostCentrePicker
        label="Cost Centre"
        value={state.costCentreId}
        onChange={v => patch({ costCentreId: v })}
        required
        placeholder="Search cost centres…"
      />
      <div class="hrfin-field-hint" style={{ marginTop: 6 }}>
        All budget lines in this batch will be assigned to the selected cost centre.
      </div>
    </div>
  );
}

function Step2Categories({ state, patch }: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
}): VNode {
  const [pendingCat, setPendingCat] = useState<string | null>(null);

  function addCategory(cat: string | null): void {
    if (!cat || state.selectedCategories.includes(cat)) return;
    patch({ selectedCategories: [...state.selectedCategories, cat] });
    setPendingCat(null);
  }

  function removeCategory(cat: string): void {
    patch({ selectedCategories: state.selectedCategories.filter(c => c !== cat) });
  }

  return (
    <div class="hrfin-wiz-fields">
      <div style={{ marginBottom: 12 }}>
        <BudgetCategoryPicker
          label="Add Category"
          value={pendingCat}
          onChange={cat => addCategory(cat)}
          placeholder="Search and select a category…"
        />
      </div>

      {state.selectedCategories.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--hrfin-muted)', marginBottom: 8 }}>
            Selected Categories ({state.selectedCategories.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {state.selectedCategories.map(cat => (
              <span key={cat} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 20,
                background: 'var(--hrfin-accent-10)', color: 'var(--hrfin-accent)',
                fontSize: 12, fontWeight: 600,
              }}>
                {cat}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 1, color: 'inherit' }}
                  onClick={() => removeCategory(cat)}
                  aria-label={`Remove ${cat}`}
                >×</button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div class="hrfin-empty" style={{ fontSize: 13 }}>
          No categories selected yet. Use the picker above to add categories.
        </div>
      )}
    </div>
  );
}

function Step3LineEntry({ state, patch }: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
}): VNode {
  function patchLine(i: number, field: Partial<LineEntry>): void {
    const next = [...state.lines];
    next[i] = { ...next[i]!, ...field };
    patch({ lines: next });
  }

  return (
    <div class="hrfin-wiz-fields">
      <div style={{ fontSize: 12, color: 'var(--hrfin-muted)', marginBottom: 12 }}>
        Enter the budgeted amount (TTD) for each category. All lines are for FY {state.fiscalYear}.
      </div>

      {state.lines.map((line, i) => (
        <div key={line.category} style={{
          padding: '12px 14px', border: '1px solid var(--hrfin-border)', borderRadius: 8,
          marginBottom: 10, background: 'var(--hrfin-surface-2)',
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{line.category}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="hrfin-field">
              <label class="hrfin-label">Budgeted Amount (TTD) <span style={{ color: 'var(--hrfin-danger)' }}>*</span></label>
              <input
                class={`hrfin-input${line.error ? ' is-error' : ''}`}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={line.budgeted}
                onInput={e => patchLine(i, { budgeted: (e.target as HTMLInputElement).value, error: undefined })}
              />
              {line.error && <div class="hrfin-field-error">{line.error}</div>}
            </div>
            <div class="hrfin-field">
              <label class="hrfin-label">Label</label>
              <input
                class="hrfin-input"
                type="text"
                placeholder="Optional short label"
                maxLength={200}
                value={line.label}
                onInput={e => patchLine(i, { label: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
            <div class="hrfin-field">
              <label class="hrfin-label">Period</label>
              <select
                class="hrfin-select"
                value={line.period}
                onChange={e => patchLine(i, { period: (e.target as HTMLSelectElement).value })}
              >
                {PERIOD_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div class="hrfin-field-hint">Fiscal sub-period this line covers.</div>
            </div>
            <div class="hrfin-field">
              <EmployeePicker
                label="Budget Owner"
                value={line.ownerId || null}
                onChange={v => patchLine(i, { ownerId: v ?? '' })}
                placeholder="Search employees…"
              />
              <div class="hrfin-field-hint">Optional responsible owner for this budget line.</div>
            </div>
          </div>
          <div class="hrfin-field" style={{ marginTop: 8 }}>
            <label class="hrfin-label">Notes</label>
            <textarea
              class="hrfin-input"
              rows={2}
              placeholder="Optional justification or notes"
              value={line.notes}
              onInput={e => patchLine(i, { notes: (e.target as HTMLTextAreaElement).value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Step4Review({ state, priorYearBudgets }: {
  state: WizardState;
  priorYearBudgets: Array<{ category: string; budgeted: number }>;
}): VNode {
  const priorMap = new Map(priorYearBudgets.map(p => [p.category, p.budgeted]));
  const totalNew = state.lines.reduce((s, l) => s + (parseFloat(l.budgeted) || 0), 0);
  const totalPrior = priorYearBudgets.reduce((s, p) => s + p.budgeted, 0);

  return (
    <div class="hrfin-wiz-fields">
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, padding: '10px 14px', background: 'var(--hrfin-surface-2)', borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--hrfin-muted)', marginBottom: 4 }}>FY {state.fiscalYear} total</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{money(totalNew)}</div>
        </div>
        {totalPrior > 0 && (
          <div style={{ flex: 1, padding: '10px 14px', background: 'var(--hrfin-surface-2)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--hrfin-muted)', marginBottom: 4 }}>FY {state.fiscalYear - 1} total</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--hrfin-muted)' }}>{money(totalPrior)}</div>
          </div>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--hrfin-border)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', fontWeight: 600, fontSize: 11, color: 'var(--hrfin-muted)', textTransform: 'uppercase' }}>Category</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600, fontSize: 11, color: 'var(--hrfin-muted)', textTransform: 'uppercase' }}>FY {state.fiscalYear}</th>
            <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', fontWeight: 600, fontSize: 11, color: 'var(--hrfin-muted)', textTransform: 'uppercase' }}>FY {state.fiscalYear - 1}</th>
          </tr>
        </thead>
        <tbody>
          {state.lines.map(line => {
            const newAmt = parseFloat(line.budgeted) || 0;
            const priorAmt = priorMap.get(line.category) ?? null;
            const delta = priorAmt !== null ? newAmt - priorAmt : null;
            return (
              <tr key={line.category} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
                <td style={{ padding: '7px 8px 7px 0', fontWeight: 500 }}>
                  {line.category}
                  {line.label && <div style={{ fontSize: 11, color: 'var(--hrfin-muted)' }}>{line.label}</div>}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>{money(newAmt)}</td>
                <td style={{ padding: '7px 0 7px 8px', textAlign: 'right', color: 'var(--hrfin-muted)' }}>
                  {priorAmt !== null ? money(priorAmt) : <em>—</em>}
                  {delta !== null && (
                    <span style={{ fontSize: 11, marginLeft: 6, color: delta >= 0 ? 'var(--hrfin-success)' : 'var(--hrfin-danger)' }}>
                      {delta >= 0 ? '+' : ''}{money(delta)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Step5Confirm({ state }: { state: WizardState }): VNode {
  const total = state.lines.reduce((s, l) => s + (parseFloat(l.budgeted) || 0), 0);
  return (
    <div class="hrfin-wiz-fields">
      <div style={{ padding: '14px', background: 'var(--hrfin-accent-10)', borderRadius: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Ready to submit</div>
        <div style={{ fontSize: 12, color: 'var(--hrfin-muted)' }}>
          {state.lines.length} budget line{state.lines.length !== 1 ? 's' : ''} for FY {state.fiscalYear} · Total: {money(total)}
        </div>
      </div>
      <div class="hrfin-metric-list">
        <div class="hrfin-metric-row"><span>Fiscal Year</span><b>FY {state.fiscalYear}</b></div>
        <div class="hrfin-metric-row"><span>Lines</span><b>{state.lines.length}</b></div>
        <div class="hrfin-metric-row"><span>Total Budget</span><b>{money(total)}</b></div>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--hrfin-muted)' }}>
        Existing lines with the same (cost centre, fiscal year, category) key will be updated in place.
        New lines will be created. The mutation backbone will emit an audit event.
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

const STEP_TITLES = [
  'Fiscal Year',
  'Cost Centre',
  'Categories',
  'Budget Amounts',
  'Review vs Prior Year',
  'Confirm & Submit',
];

export interface BudBulkUpsertWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function BudBulkUpsertWizard({ open, onClose, onSuccess }: BudBulkUpsertWizardProps): VNode {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(EMPTY_STATE);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prior year budgets for the review step
  const priorYearQ = useBudgets({
    fiscalYear: state.fiscalYear - 1,
    costCenterId: state.costCentreId ?? undefined,
  });
  const priorYearBudgets = (priorYearQ.data ?? [])
    .filter(b => state.selectedCategories.includes(b.category))
    .map(b => ({ category: b.category, budgeted: b.budgeted }));

  const bulkMut = useBudgetMutation(financeBudgetsApi.bulkUpsert);

  function patch(p: Partial<WizardState>): void {
    setState(s => ({ ...s, ...p }));
  }

  // Sync lines whenever categories change (step 2 → step 3)
  function syncLines(categories: string[]): void {
    const existingMap = new Map(state.lines.map(l => [l.category, l]));
    const next = categories.map(cat => existingMap.get(cat) ?? {
      category: cat, label: '', notes: '', budgeted: '', period: 'Full-Year', ownerId: '',
    });
    patch({ selectedCategories: categories, lines: next });
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (!state.fiscalYear) return 'Please select a fiscal year.';
    }
    if (step === 1) {
      if (!state.costCentreId) return 'Please select a cost centre.';
    }
    if (step === 2) {
      if (!state.selectedCategories.length) return 'Please select at least one category.';
    }
    if (step === 3) {
      for (const l of state.lines) {
        const amt = parseFloat(l.budgeted);
        if (isNaN(amt) || amt < 0) return `Invalid amount for category "${l.category}".`;
      }
    }
    return null;
  }

  function handleNext(): void {
    const err = validateStep();
    if (err) { setSubmitError(err); return; }
    setSubmitError(null);
    // Sync line entries when advancing from step 2
    if (step === 2) {
      syncLines(state.selectedCategories);
    }
    setStep(s => Math.min(5, s + 1));
  }

  function handleBack(): void {
    setSubmitError(null);
    setStep(s => Math.max(0, s - 1));
  }

  async function handleSubmit(): Promise<void> {
    const err = validateStep();
    if (err) { setSubmitError(err); return; }
    if (!state.costCentreId) { setSubmitError('Cost centre is required.'); return; }

    setSubmitting(true);
    setSubmitError(null);

    const lines: BulkBudgetLineArg[] = state.lines.map(l => ({
      costCenterId: state.costCentreId!,
      fiscalYear:   state.fiscalYear,
      category:     l.category,
      label:        l.label || null,
      notes:        l.notes || null,
      budgeted:     parseFloat(l.budgeted) || 0,
      currency:     'TTD',
      period:       l.period || null,
      ownerId:      l.ownerId || null,
    }));

    try {
      await bulkMut.mutateAsync({ lines });
      onSuccess?.();
      onClose();
      // Reset state
      setStep(0);
      setState(EMPTY_STATE);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Bulk upsert failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const isLastStep = step === 5;
  const primaryLabel = isLastStep ? 'Submit Budget Lines' : 'Next →';

  function handlePrimary(): void {
    if (isLastStep) { void handleSubmit(); }
    else handleNext();
  }

  return (
    <HrfinWizardModal
      open={open}
      title={`Bulk Budget Entry — ${STEP_TITLES[step] ?? ''}`}
      stepCount={6}
      activeStep={step}
      onClose={onClose}
      onBack={step > 0 ? handleBack : undefined}
      primaryLabel={primaryLabel}
      onPrimary={handlePrimary}
      primaryLoading={submitting}
      primaryDisabled={submitting}
    >
      <div class="hrfin">
        {submitError && (
          <div style={{
            marginBottom: 12, padding: '8px 12px',
            background: 'var(--hrfin-danger-10)', color: 'var(--hrfin-danger)',
            borderRadius: 6, fontSize: 13,
          }}>
            {submitError}
          </div>
        )}

        {step === 0 && <Step0FiscalYear state={state} patch={patch} />}
        {step === 1 && <Step1CostCentre state={state} patch={patch} />}
        {step === 2 && <Step2Categories state={state} patch={p => {
          if ('selectedCategories' in p) syncLines(p.selectedCategories as string[]);
          else patch(p);
        }} />}
        {step === 3 && <Step3LineEntry state={state} patch={patch} />}
        {step === 4 && <Step4Review state={state} priorYearBudgets={priorYearBudgets} />}
        {step === 5 && <Step5Confirm state={state} />}
      </div>
    </HrfinWizardModal>
  );
}
