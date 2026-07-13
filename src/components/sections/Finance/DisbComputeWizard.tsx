/**
 * src/components/sections/Finance/DisbComputeWizard.tsx
 *
 * Compute & Create Disbursement wizard (5 steps):
 *   0  ApprovedRunPicker — pick an approved / locked / exported payroll run
 *   1  Bank-readiness preview — list employees + bank-account status
 *   2  Totals preview — net pay per employee, grand total
 *   3  Payment settings — currency, effective date, notes
 *   4  Review & Create — confirm and create draft disbursement
 *
 * Replaces the old single-field free-text UUID input (accepted but ignored).
 * Uses ApprovedRunPicker from _shared/pickers.tsx so no raw UUID is ever entered.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { HrfinWizardModal, HrfinIcon, HrfinPill } from '@ui';
import {
  useComputedDisbursement,
  useDisbursementMutation,
  financeDisbursementsApi,
  type ComputedDisbursement,
  type Disbursement,
} from '@api/finance/disbursements';
import { ApprovedRunPicker } from './_shared/pickers';
import { EmployeeCellResolved } from './_shared/EmployeeCell';
import { useEmployeeNames } from '@api/finance/lookups';
import { money } from './hrfinFormat';

const STEPS = [
  'Select Run',
  'Bank Readiness',
  'Totals Preview',
  'Payment Settings',
  'Review & Create',
];

interface PaymentSettings {
  currency: string;
  effectiveDate: string;
  notes: string;
}

const CURRENCIES = ['TTD', 'USD', 'EUR', 'GBP', 'CAD'];

function BankReadinessStep({ computed }: { computed: ComputedDisbursement }): VNode {
  const allIds = computed.lines.map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);
  const missing = computed.lines.filter(l => !l.hasBankAccount);
  const ready = computed.lines.filter(l => l.hasBankAccount);

  return (
    <div class="hrfin-wizard-step">
      <p class="hrfin-wiz-label" style={{ marginBottom: 12 }}>
        Bank account readiness for this payroll run
      </p>

      {missing.length > 0 && (
        <div class="hrfin-callout is-warning" style={{ marginBottom: 12 }}>
          <HrfinIcon name="alert" />
          <span>
            <strong>{missing.length} employee{missing.length !== 1 ? 's' : ''}</strong> have no
            primary bank account. The disbursement cannot be created until all employees have
            bank accounts. Add them in the Bank Accounts tab first.
          </span>
        </div>
      )}

      <div class="hrfin-metric-list" style={{ marginBottom: 12 }}>
        <div class="hrfin-metric-row">
          <span>Total employees</span>
          <b>{computed.employeeCount}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Bank account ready</span>
          <b style={{ color: 'var(--ok, #2c9e5b)' }}>{ready.length}</b>
        </div>
        {missing.length > 0 && (
          <div class="hrfin-metric-row">
            <span>Missing bank account</span>
            <b style={{ color: 'var(--danger, #d33)' }}>{missing.length}</b>
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <>
          <p class="hrfin-wiz-label" style={{ marginBottom: 6 }}>Employees without bank accounts</p>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {missing.map(l => (
              <div key={l.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                <HrfinIcon name="alert" />
                <EmployeeCellResolved resolved={nameMap?.get(l.employeeId)} fallbackId={l.employeeId} />
                <HrfinPill tone="bad">No bank account</HrfinPill>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TotalsPreviewStep({ computed }: { computed: ComputedDisbursement }): VNode {
  const allIds = computed.lines.map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);

  return (
    <div class="hrfin-wizard-step">
      <div class="hrfin-metric-list" style={{ marginBottom: 12 }}>
        <div class="hrfin-metric-row">
          <span>Total net pay</span>
          <b style={{ fontSize: 18, fontWeight: 500 }}>{money(computed.totalAmount)}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Employees</span>
          <b>{computed.employeeCount}</b>
        </div>
      </div>

      <p class="hrfin-wiz-label" style={{ marginBottom: 6 }}>Per-employee breakdown</p>
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-alt, rgba(255,255,255,.04))' }}>
              <th style={{ padding: '6px 12px', textAlign: 'left' }}>Employee</th>
              <th style={{ padding: '6px 12px', textAlign: 'left' }}>Bank</th>
              <th style={{ padding: '6px 12px', textAlign: 'right' }}>Net Pay</th>
            </tr>
          </thead>
          <tbody>
            {computed.lines.map(l => (
              <tr key={l.employeeId} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px' }}>
                  <EmployeeCellResolved resolved={nameMap?.get(l.employeeId)} fallbackId={l.employeeId} />
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 12 }}>
                  {l.bankName ? `${l.bankName} ${l.accountNumberMasked ?? ''}` : (
                    <span style={{ color: 'var(--danger, #d33)' }}>No account</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                  {money(l.netAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaymentSettingsStep({
  settings,
  onChange,
}: {
  settings: PaymentSettings;
  onChange: (patch: Partial<PaymentSettings>) => void;
}): VNode {
  return (
    <div class="hrfin-wizard-step">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label>
          <span class="hrfin-wiz-label">Currency</span>
          <select
            class="hrfin-input"
            value={settings.currency}
            onChange={e => onChange({ currency: (e.currentTarget).value })}
          >
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label>
          <span class="hrfin-wiz-label">Effective payment date</span>
          <input
            type="date"
            class="hrfin-input"
            value={settings.effectiveDate}
            onInput={e => onChange({ effectiveDate: (e.currentTarget).value })}
          />
        </label>

        <label>
          <span class="hrfin-wiz-label">Notes (optional)</span>
          <textarea
            class="hrfin-input"
            rows={3}
            placeholder="Internal notes for this disbursement…"
            value={settings.notes}
            onInput={e => onChange({ notes: (e.currentTarget).value })}
          />
        </label>
      </div>
    </div>
  );
}

function ReviewStep({
  runId,
  computed,
  settings,
}: {
  runId: string;
  computed: ComputedDisbursement;
  settings: PaymentSettings;
}): VNode {
  return (
    <div class="hrfin-wizard-step">
      <div class="hrfin-callout is-info" style={{ marginBottom: 14 }}>
        <HrfinIcon name="check" />
        <span>
          Creating as <strong>draft</strong>. After creation, submit for approval — a
          different finance_manager must approve (Separation of Duties). Only then can
          you generate the bank file and mark it paid.
        </span>
      </div>

      <div class="hrfin-metric-list">
        <div class="hrfin-metric-row"><span>Payroll run ID</span><b style={{ fontSize: 11, fontFamily: 'monospace' }}>{runId.slice(0, 8)}…</b></div>
        <div class="hrfin-metric-row"><span>Employees</span><b>{computed.employeeCount}</b></div>
        <div class="hrfin-metric-row"><span>Total net pay</span><b>{money(computed.totalAmount)}</b></div>
        <div class="hrfin-metric-row"><span>Currency</span><b>{settings.currency}</b></div>
        <div class="hrfin-metric-row"><span>Effective date</span><b>{settings.effectiveDate || '—'}</b></div>
        {settings.notes && (
          <div class="hrfin-metric-row"><span>Notes</span><b>{settings.notes}</b></div>
        )}
      </div>
    </div>
  );
}

export interface DisbComputeWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function DisbComputeWizard({ open, onClose, onCreated }: DisbComputeWizardProps): VNode {
  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [settings, setSettings] = useState<PaymentSettings>({
    currency: 'TTD',
    effectiveDate: today,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const computeQ = useComputedDisbursement(step >= 1 && runId ? runId : null);
  const computed = computeQ.data ?? null;
  // Use the idempotent bridge route: duplicate requests return the existing
  // disbursement (not 409), and the route emits finance.payroll.bridge.disbursement.created
  // + Payment Ops notification + handoff per §8.1.
  const createMut = useDisbursementMutation(
    (a: { payrollRunId: string; currency?: string; metadata?: Record<string, unknown> }) =>
      financeDisbursementsApi.createFromRun(a) as Promise<Disbursement>,
  );

  const canProceed = (): boolean => {
    if (step === 0) return !!runId;
    if (step === 1) return !!computed && computed.missingBankAccounts.length === 0;
    if (step === 2) return !!computed;
    if (step === 3) return !!settings.effectiveDate;
    if (step === 4) return !!computed && !!runId;
    return true;
  };

  const stepLabel = (): string => {
    if (step === STEPS.length - 1) return 'Create Draft';
    return 'Next';
  };

  const next = async (): Promise<void> => {
    if (step === 0) {
      if (!runId) { setErrors({ runId: 'Select a payroll run.' }); return; }
      setErrors({});
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!computed || computed.missingBankAccounts.length > 0) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    if (step === 3) {
      if (!settings.effectiveDate) { setErrors({ effectiveDate: 'Effective date is required.' }); return; }
      setErrors({});
      setStep(4);
      return;
    }
    // Step 4: create via idempotent bridge (duplicate → returns existing, not 409)
    if (!runId) return;
    try {
      await createMut.mutateAsync({
        payrollRunId: runId,
        currency: settings.currency,
        metadata: {
          effectiveDate: settings.effectiveDate,
          notes: settings.notes,
        },
      });
      toast('Disbursement created as draft.');
      onCreated();
      handleClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to create disbursement.');
    }
  };

  const handleClose = (): void => {
    setStep(0);
    setRunId(null);
    setSettings({ currency: 'TTD', effectiveDate: today, notes: '' });
    setErrors({});
    onClose();
  };

  const back = step > 0 ? () => setStep(s => s - 1) : undefined;

  return (
    <HrfinWizardModal
      open={open}
      title="Compute & Create Disbursement"
      stepCount={STEPS.length}
      activeStep={step}
      onClose={handleClose}
      onBack={back}
      primaryLabel={stepLabel()}
      onPrimary={() => void next()}
      primaryDisabled={!canProceed()}
      primaryLoading={createMut.isPending || (step === 1 && computeQ.isLoading)}
    >
      <div class="hrfin">
        <div class="hrfin-wiz-step-label">{STEPS[step]}</div>

        {step === 0 && (
          <div class="hrfin-wizard-step">
            <ApprovedRunPicker
              label="Approved payroll run"
              value={runId}
              onChange={v => { setRunId(v); setErrors({}); }}
              error={errors.runId ?? null}
              required
              placeholder="Search approved / locked runs…"
            />
            <p class="hrfin-wiz-sub hse-muted" style={{ marginTop: 8, fontSize: 12 }}>
              Only approved, locked, or exported runs are eligible for disbursement.
            </p>
          </div>
        )}

        {step === 1 && (
          computeQ.isLoading
            ? <div class="hrfin-empty">Computing bank readiness…</div>
            : computeQ.error
              ? <div class="hrfin-callout is-danger"><HrfinIcon name="alert" /><span>{(computeQ.error).message}</span></div>
              : computed
                ? <BankReadinessStep computed={computed} />
                : <div class="hrfin-empty">No data available.</div>
        )}

        {step === 2 && computed && <TotalsPreviewStep computed={computed} />}

        {step === 3 && (
          <PaymentSettingsStep
            settings={settings}
            onChange={patch => {
              setSettings(s => ({ ...s, ...patch }));
              if (patch.effectiveDate) setErrors(e => { const n = { ...e }; delete n.effectiveDate; return n; });
            }}
          />
        )}

        {step === 4 && computed && runId && (
          <ReviewStep runId={runId} computed={computed} settings={settings} />
        )}
      </div>
    </HrfinWizardModal>
  );
}
