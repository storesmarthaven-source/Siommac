/**
 * src/components/sections/Finance/BudCopyLastYearDialog.tsx
 *
 * Aurora dialog for copying budget lines from one fiscal year to another.
 * Fields: source FY, target FY, cost-centre scope (CostCentrePicker),
 *         category scope (BudgetCategoryPicker), adjustment %, rounding rule.
 * Shows a preview of how many lines will be copied before confirming.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Dialog, Wizard, type WizardStep } from '@ui';
import { CostCentrePicker, BudgetCategoryPicker } from './_shared/pickers';
import {
  financeBudgetsApi,
  useBudgetMutation,
  useBudgets,
  type CopyLastYearArgs,
} from '@api/finance/budgets';
import { money } from './hrfinFormat';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - 4 + i);

interface DialogState {
  sourceFiscalYear: number;
  targetFiscalYear: number;
  costCentreId: string | null;
  categoryFilter: string | null;
  adjustmentPct: string;
  roundingRule: 'none' | 'hundred' | 'thousand';
  // Step tracking
  step: 0 | 1; // 0=form, 1=confirm
}

const EMPTY: DialogState = {
  sourceFiscalYear: CURRENT_YEAR - 1,
  targetFiscalYear: CURRENT_YEAR,
  costCentreId: null,
  categoryFilter: null,
  adjustmentPct: '0',
  roundingRule: 'none',
  step: 0,
};

// ── Preview ───────────────────────────────────────────────────────────────────

function PreviewStep({ state }: { state: DialogState }): VNode {
  const sourceLinesQ = useBudgets({
    fiscalYear: state.sourceFiscalYear,
    costCenterId: state.costCentreId ?? undefined,
    category: state.categoryFilter ?? undefined,
  });
  const targetLinesQ = useBudgets({
    fiscalYear: state.targetFiscalYear,
    costCenterId: state.costCentreId ?? undefined,
    category: state.categoryFilter ?? undefined,
  });

  const sourceLines = sourceLinesQ.data ?? [];
  const targetLines = targetLinesQ.data ?? [];

  const targetKeys = new Set(targetLines.map(l => `${l.costCenterId}::${l.category}`));
  const willCopy = sourceLines.filter(l => !targetKeys.has(`${l.costCenterId}::${l.category}`));
  const willSkip = sourceLines.filter(l => targetKeys.has(`${l.costCenterId}::${l.category}`));

  const adj = parseFloat(state.adjustmentPct) || 0;
  const adjFactor = 1 + adj / 100;
  const totalNew = willCopy.reduce((s, l) => s + l.budgeted * adjFactor, 0);
  const totalSource = willCopy.reduce((s, l) => s + l.budgeted, 0);

  if (sourceLinesQ.isLoading || targetLinesQ.isLoading) {
    return <div class="hrfin-empty">Loading preview…</div>;
  }

  return (
    <div>
      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Will copy', value: String(willCopy.length), tone: 'success' as const },
          { label: 'Will skip (exist)', value: String(willSkip.length), tone: 'muted' as const },
          { label: 'Total (new FY)', value: money(totalNew), tone: 'accent' as const },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, padding: '10px 12px', background: 'var(--hrfin-surface-2)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--hrfin-muted)', marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontWeight: 500 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Copy preview table */}
      {willCopy.length > 0 ? (
        <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--hrfin-border)', position: 'sticky', top: 0, background: 'var(--hrfin-surface)' }}>
                <th style={{ textAlign: 'left', padding: '5px 8px 5px 0', color: 'var(--hrfin-muted)', fontWeight: 600 }}>Category</th>
                <th style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--hrfin-muted)', fontWeight: 600 }}>FY {state.sourceFiscalYear}</th>
                <th style={{ textAlign: 'right', padding: '5px 0 5px 8px', color: 'var(--hrfin-muted)', fontWeight: 600 }}>FY {state.targetFiscalYear} ({adj >= 0 ? '+' : ''}{adj}%)</th>
              </tr>
            </thead>
            <tbody>
              {willCopy.map(l => (
                <tr key={`${l.costCenterId}::${l.category}`} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
                  <td style={{ padding: '6px 8px 6px 0' }}>{l.category}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--hrfin-muted)' }}>{money(l.budgeted)}</td>
                  <td style={{ padding: '6px 0 6px 8px', textAlign: 'right', fontWeight: 500 }}>{money(l.budgeted * adjFactor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 500 }}>
                <td style={{ padding: '8px 8px 4px 0' }}>Total</td>
                <td style={{ padding: '8px 8px 4px', textAlign: 'right', color: 'var(--hrfin-muted)' }}>{money(totalSource)}</td>
                <td style={{ padding: '8px 0 4px 8px', textAlign: 'right' }}>{money(totalNew)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div class="hrfin-empty">
          {sourceLines.length === 0
            ? `No budget lines found in FY ${state.sourceFiscalYear}.`
            : `All ${sourceLines.length} line${sourceLines.length > 1 ? 's' : ''} already exist in FY ${state.targetFiscalYear}.`}
        </div>
      )}
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export interface BudCopyLastYearDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (result: { copied: number }) => void;
}

export function BudCopyLastYearDialog({ open, onClose, onSuccess }: BudCopyLastYearDialogProps): VNode {
  const [state, setState] = useState<DialogState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const copyMut = useBudgetMutation(financeBudgetsApi.copyLastYear);

  function patch(p: Partial<DialogState>): void {
    setState(s => ({ ...s, ...p }));
  }

  function validate(): string | null {
    if (state.sourceFiscalYear === state.targetFiscalYear)
      return 'Source and target fiscal years must be different.';
    const adj = parseFloat(state.adjustmentPct);
    if (isNaN(adj) || adj < -99 || adj > 200)
      return 'Adjustment % must be between -99 and 200.';
    return null;
  }

  async function handleSubmit(): Promise<void> {
    const err = validate();
    if (err) { setError(err); return; }
    setSubmitting(true);
    setError(null);

    const args: CopyLastYearArgs = {
      sourceFiscalYear: state.sourceFiscalYear,
      targetFiscalYear: state.targetFiscalYear,
      costCenterId:     state.costCentreId,
      category:         state.categoryFilter,
      adjustmentPct:    parseFloat(state.adjustmentPct) || 0,
      roundingRule:     state.roundingRule,
    };

    try {
      const result = await copyMut.mutateAsync(args);
      onSuccess?.({ copied: result.copied });
      onClose();
      setState(EMPTY);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Copy failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const stepContent = (
      <div class="hrfin">
        {error && (
          <div style={{
            marginBottom: 12, padding: '8px 12px',
            background: 'var(--hrfin-danger-10)', color: 'var(--hrfin-danger)',
            borderRadius: 6, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {state.step === 0 && (
          <div class="hrfin-wiz-fields">
            {/* Source + Target year */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div class="hrfin-field">
                <label class="hrfin-label">Source Fiscal Year <span style={{ color: 'var(--hrfin-danger)' }}>*</span></label>
                <select
                  class="hrfin-select"
                  value={state.sourceFiscalYear}
                  onChange={e => patch({ sourceFiscalYear: Number((e.target as HTMLSelectElement).value) })}
                >
                  {YEAR_OPTS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div class="hrfin-field">
                <label class="hrfin-label">Target Fiscal Year <span style={{ color: 'var(--hrfin-danger)' }}>*</span></label>
                <select
                  class="hrfin-select"
                  value={state.targetFiscalYear}
                  onChange={e => patch({ targetFiscalYear: Number((e.target as HTMLSelectElement).value) })}
                >
                  {YEAR_OPTS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            {/* Scope filters */}
            <CostCentrePicker
              label="Cost Centre Scope (optional)"
              value={state.costCentreId}
              onChange={v => patch({ costCentreId: v })}
              placeholder="All cost centres"
            />
            <BudgetCategoryPicker
              label="Category Scope (optional)"
              value={state.categoryFilter}
              onChange={v => patch({ categoryFilter: v })}
              placeholder="All categories"
            />

            {/* Adjustment */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div class="hrfin-field">
                <label class="hrfin-label">Adjustment %</label>
                <input
                  class="hrfin-input"
                  type="number"
                  step="0.1"
                  min="-99"
                  max="200"
                  placeholder="0"
                  value={state.adjustmentPct}
                  onInput={e => patch({ adjustmentPct: (e.target as HTMLInputElement).value })}
                />
                <div class="hrfin-field-hint">Apply a percentage increase/decrease. 0 = exact copy.</div>
              </div>
              <div class="hrfin-field">
                <label class="hrfin-label">Rounding Rule</label>
                <select
                  class="hrfin-select"
                  value={state.roundingRule}
                  onChange={e => patch({ roundingRule: (e.target as HTMLSelectElement).value as DialogState['roundingRule'] })}
                >
                  <option value="none">No rounding</option>
                  <option value="hundred">Nearest $100</option>
                  <option value="thousand">Nearest $1,000</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {state.step === 1 && <PreviewStep state={state} />}
      </div>
  );

  const steps: WizardStep[] = [
    {
      id: 'settings',
      label: 'Settings',
      description: 'Years, scope and adjustment',
      validate,
      render: () => stepContent,
    },
    {
      id: 'preview',
      label: 'Preview & confirm',
      description: 'Review lines before copying',
      render: () => stepContent,
    },
  ];

  const close = (): void => { onClose(); setState(EMPTY); };

  return (
    <Dialog open={open} onClose={close} size="lg" variant="workspace" busy={submitting} class="hrfin">
      <Dialog.Header title="Copy Budget" sub="Copy eligible budget lines into a new fiscal year." onClose={close} />
      <Dialog.Body>
        <Wizard
          id="copy-budget-wizard"
          label="Copy budget steps"
          steps={steps}
          value={state.step === 0 ? 'settings' : 'preview'}
          onChange={id => patch({ step: id === 'settings' ? 0 : 1 })}
          onSubmit={handleSubmit}
          submitLabel="Copy Budget Lines"
          busy={submitting}
          onCancel={close}
        />
      </Dialog.Body>
    </Dialog>
  );
}
