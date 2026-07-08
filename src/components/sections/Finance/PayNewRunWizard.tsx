/**
 * src/components/sections/Finance/PayNewRunWizard.tsx
 *
 * 6-step New Payroll Run Wizard:
 *   Step 0 — Period / frequency configuration
 *   Step 1 — Employee population preview (active salaried/hourly counts)
 *   Step 2 — Inputs preview note (available after lock-inputs lifecycle action)
 *   Step 3 — Statutory version preview (active statutory version info)
 *   Step 4 — Pre-check summary (validation of step 0 fields)
 *   Step 5 — Review & create
 *
 * On submit (step 5): calls financePayrollApi.createRun, emitting the
 * full backbone (app_event + audit + notification) server-side.
 *
 * Steps 2 (inputs preview) and 3 (pre-check warnings) require running
 * lock-inputs + calculate first; the wizard notes this and links to the
 * lifecycle actions available in the run drawer after creation.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { HrfinWizardModal } from '@ui';
import {
  usePayrollMutation,
  usePopulationPreview,
  financePayrollApi,
  type PayrollRun,
} from '@api/finance/payroll';


// ── Helpers ───────────────────────────────────────────────────────────────────

const PAY_FREQS = [
  { value: 'monthly',    label: 'Monthly (4.33 weeks)' },
  { value: 'bi_weekly',  label: 'Bi-weekly (2 weeks)' },
  { value: 'weekly',     label: 'Weekly (1 week)' },
];

const PAY_GROUPS = [
  'General Staff',
  'Executive / Senior Management',
  'Contract / Fixed-Term',
  'Part-time',
  'Casual',
];

const WEEKS_MAP: Record<string, number> = { monthly: 4.333, bi_weekly: 2, weekly: 1 };

function iso8601Month(ym: string): string {
  return ym.length === 7 ? `${ym}-01` : ym;
}

const FIELD_STYLE = {
  fontSize: 13, padding: '8px 10px',
  background: 'var(--hrfin-surface-2)',
  border: '1px solid var(--hrfin-border)',
  borderRadius: 6, color: 'var(--hrfin-text-primary)',
  width: '100%', boxSizing: 'border-box' as const,
};

// ── Step sub-components ───────────────────────────────────────────────────────

function Step0Fields({
  periodMonth, setPeriodMonth,
  payFrequency, setPayFrequency,
  weeksInPeriod, setWeeksInPeriod,
  payGroup, setPayGroup,
  payDate, setPayDate,
  cutOffDate, setCutOffDate,
  errors,
}: {
  periodMonth:    string; setPeriodMonth:    (v: string) => void;
  payFrequency:   string; setPayFrequency:   (v: string) => void;
  weeksInPeriod:  string; setWeeksInPeriod:  (v: string) => void;
  payGroup:       string; setPayGroup:       (v: string) => void;
  payDate:        string; setPayDate:        (v: string) => void;
  cutOffDate:     string; setCutOffDate:     (v: string) => void;
  errors:         Record<string, string>;
}): VNode {
  return (
    <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
        Define the period, frequency, and scheduling details for this payroll run.
        The active statutory version is automatically applied at creation time.
      </p>

      {/* Row 1: Pay month + Pay group */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Pay month *</span>
          <input
            type="month"
            value={periodMonth}
            onInput={e => setPeriodMonth((e.currentTarget as HTMLInputElement).value)}
            style={{ ...FIELD_STYLE, borderColor: errors['periodMonth'] ? 'var(--danger)' : 'var(--hrfin-border)' }}
          />
          {errors['periodMonth'] && (
            <span style={{ fontSize: 11, color: 'var(--danger)' }}>{errors['periodMonth']}</span>
          )}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Pay group</span>
          <input
            type="text"
            list="pay-group-list"
            value={payGroup}
            placeholder="e.g. General Staff"
            onInput={e => setPayGroup((e.currentTarget as HTMLInputElement).value)}
            style={FIELD_STYLE}
          />
          <datalist id="pay-group-list">
            {PAY_GROUPS.map(g => <option key={g} value={g} />)}
          </datalist>
          <span style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)' }}>Optional label for this group.</span>
        </label>
      </div>

      {/* Row 2: Pay frequency + Weeks in period */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Pay frequency *</span>
          <select
            value={payFrequency}
            onChange={e => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              setPayFrequency(v);
              setWeeksInPeriod(String(WEEKS_MAP[v] ?? 4.333));
            }}
            style={FIELD_STYLE}
          >
            {PAY_FREQS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Weeks in period</span>
          <input
            type="number"
            value={weeksInPeriod}
            onInput={e => setWeeksInPeriod((e.currentTarget as HTMLInputElement).value)}
            min="0.5" max="5.5" step="0.001"
            style={{ ...FIELD_STYLE, borderColor: errors['weeks'] ? 'var(--danger)' : 'var(--hrfin-border)' }}
          />
          {errors['weeks']
            ? <span style={{ fontSize: 11, color: 'var(--danger)' }}>{errors['weeks']}</span>
            : <span style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)' }}>Auto-set from frequency.</span>}
        </label>
      </div>

      {/* Row 3: Pay date + Cut-off date */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Pay date</span>
          <input
            type="date"
            value={payDate}
            onInput={e => setPayDate((e.currentTarget as HTMLInputElement).value)}
            style={{ ...FIELD_STYLE, borderColor: errors['payDate'] ? 'var(--danger)' : 'var(--hrfin-border)' }}
          />
          {errors['payDate']
            ? <span style={{ fontSize: 11, color: 'var(--danger)' }}>{errors['payDate']}</span>
            : <span style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)' }}>Date employees are paid.</span>}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Cut-off date</span>
          <input
            type="date"
            value={cutOffDate}
            onInput={e => setCutOffDate((e.currentTarget as HTMLInputElement).value)}
            style={{ ...FIELD_STYLE, borderColor: errors['cutOffDate'] ? 'var(--danger)' : 'var(--hrfin-border)' }}
          />
          {errors['cutOffDate']
            ? <span style={{ fontSize: 11, color: 'var(--danger)' }}>{errors['cutOffDate']}</span>
            : <span style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)' }}>Changes after this date excluded.</span>}
        </label>
      </div>
    </div>
  );
}

function Step1Population({ periodMonth }: { periodMonth: string }): VNode {
  // Convert YYYY-MM (from <input type="month">) to YYYY-MM-01
  const isoMonth = periodMonth ? iso8601Month(periodMonth) : undefined;
  const { data: pop, isLoading } = usePopulationPreview(isoMonth);

  if (isLoading) {
    return (
      <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span class="hrfin-skel" style={{ width: '60%', height: 14 }} />
        <span class="hrfin-skel" style={{ width: '80%', height: 14 }} />
        <span class="hrfin-skel" style={{ width: '50%', height: 14 }} />
        <span class="hrfin-skel" style={{ width: '70%', height: 14 }} />
      </div>
    );
  }

  const hasWarnings = (pop?.missingPayBasis ?? 0) > 0 || (pop?.missingStatutoryProfile ?? 0) > 0;

  return (
    <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
        Active employees who will be included in this payroll run
        {isoMonth ? ` for period ${isoMonth.slice(0, 7)}` : ''}.
      </p>

      {/* Core population counts */}
      <div class="hrfin-metric-list">
        <div class="hrfin-metric-row">
          <span>Total active employees</span>
          <b>{pop?.total ?? '—'}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Salaried</span>
          <b>{pop?.salaried ?? '—'}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Hourly</span>
          <b>{pop?.hourly ?? '—'}</b>
        </div>
      </div>

      {/* Period-specific counts */}
      <div class="hrfin-metric-list">
        <div class="hrfin-metric-row">
          <span style={{ color: 'var(--hrfin-text-secondary)' }}>New hires this period</span>
          <b style={{ color: (pop?.newHires ?? 0) > 0 ? 'var(--hrfin-accent)' : undefined }}>
            {pop?.newHires ?? '—'}
          </b>
        </div>
        <div class="hrfin-metric-row">
          <span style={{ color: 'var(--hrfin-text-secondary)' }}>Terminations this period</span>
          <b style={{ color: (pop?.terminations ?? 0) > 0 ? 'var(--hrfin-accent)' : undefined }}>
            {pop?.terminations ?? '—'}
          </b>
        </div>
      </div>

      {/* Warnings */}
      {hasWarnings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(pop?.missingPayBasis ?? 0) > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                          borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
              <strong style={{ color: 'var(--danger)' }}>
                {pop?.missingPayBasis} employee(s) missing pay basis
              </strong>
              <p style={{ margin: '4px 0 0', color: 'var(--hrfin-text-secondary)' }}>
                These employees have no pay_basis configured and will be excluded from this run.
                Set their pay basis in the HR Employee profile before locking inputs.
              </p>
            </div>
          )}
          {(pop?.missingStatutoryProfile ?? 0) > 0 && (
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                          borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
              <strong style={{ color: 'var(--danger)' }}>
                {pop?.missingStatutoryProfile} employee(s) missing statutory profile
              </strong>
              <p style={{ margin: '4px 0 0', color: 'var(--hrfin-text-secondary)' }}>
                No NIS/statutory profile found. NIS deductions will not be calculated for these employees.
                Create their statutory profile in the HR module before locking inputs.
              </p>
            </div>
          )}
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
        Final population snapshot is taken when you run <strong>Lock Inputs</strong> after creation.
        New hires and terminations processed before lock-inputs are reflected in the actual run.
      </p>
    </div>
  );
}

function Step2InputsPreview(): VNode {
  return (
    <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
        Input preview shows approved pay items, overtime entries, and deductions that
        will be snapshotted for each employee.
      </p>
      <div style={{ background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                    borderRadius: 8, padding: '14px 16px', fontSize: 13 }}>
        <strong>Available after Lock Inputs</strong>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>
          After creating this draft run, use the <strong>Lock Inputs</strong> lifecycle action
          in the run drawer to snapshot:
        </p>
        <ul style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', margin: '8px 0 0', paddingLeft: 18 }}>
          <li>Base pay (monthly salary or hourly rate)</li>
          <li>Approved active pay items (allowances, bonuses, deductions)</li>
          <li>Approved overtime entries for this period</li>
          <li>Retro adjustments (if any)</li>
        </ul>
      </div>
    </div>
  );
}

function Step3StatutoryPreview(): VNode {
  return (
    <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
        The currently active statutory configuration version will be applied to this run.
      </p>
      <div style={{ background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                    borderRadius: 8, padding: '14px 16px', fontSize: 13 }}>
        <strong>Active statutory version</strong>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>
          The statutory version is resolved and stamped on the run at creation time from the
          Statutory Configuration module. It includes:
        </p>
        <ul style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', margin: '8px 0 0', paddingLeft: 18 }}>
          <li>PAYE personal allowance + band rates</li>
          <li>NIS class table (weekly insurable income brackets)</li>
          <li>Health Surcharge weekly/monthly thresholds</li>
          <li>Pay component mappings (taxable / NIS-applicable)</li>
        </ul>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>
          To change the statutory version: go to <strong>Statutory Configuration</strong> and activate
          a different version before creating this run.
        </p>
      </div>
    </div>
  );
}

function Step4PreCheck({
  periodMonth,
  payFrequency,
  weeksInPeriod,
  payGroup,
  payDate,
  cutOffDate,
}: {
  periodMonth:   string;
  payFrequency:  string;
  weeksInPeriod: string;
  payGroup:      string;
  payDate:       string;
  cutOffDate:    string;
}): VNode {
  const issues: string[] = [];
  if (!periodMonth) issues.push('Pay month is required.');
  const wk = parseFloat(weeksInPeriod);
  if (isNaN(wk) || wk < 0.5 || wk > 5.5) {
    issues.push('Weeks in period must be between 0.5 and 5.5.');
  }
  if (payDate && cutOffDate && payDate < cutOffDate) {
    issues.push('Pay date is before cut-off date — employees may not be paid before changes are cut off.');
  }

  return (
    <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
        Pre-check validation for this run configuration.
      </p>

      {issues.length === 0 ? (
        <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)',
                      borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
          ✅ <strong>All checks passed.</strong> This run configuration is valid.
        </div>
      ) : (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                      borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
          <strong style={{ color: 'var(--danger)' }}>Issues to fix before proceeding:</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--danger)' }}>
            {issues.map(i => <li key={i}>{i}</li>)}
          </ul>
        </div>
      )}

      <div class="hrfin-metric-list" style={{ marginTop: 4 }}>
        <div class="hrfin-metric-row">
          <span>Pay month</span>
          <b>{periodMonth ? periodMonth.slice(0, 7) : '—'}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Pay group</span>
          <b>{payGroup || '—'}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Frequency</span>
          <b>{PAY_FREQS.find(f => f.value === payFrequency)?.label ?? payFrequency}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Weeks in period</span>
          <b>{weeksInPeriod}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Pay date</span>
          <b>{payDate || '—'}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Cut-off date</span>
          <b>{cutOffDate || '—'}</b>
        </div>
      </div>

      <div style={{ background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                    borderRadius: 8, padding: '12px 14px', fontSize: 12,
                    color: 'var(--hrfin-text-secondary)' }}>
        <strong>Post-creation checklist (run drawer):</strong>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li>Lock Inputs → review input snapshot</li>
          <li>Calculate → review run lines + warnings</li>
          <li>Submit for Approval → SoD approval by different Finance Manager</li>
          <li>Lock Run → generate payslips + create export</li>
        </ul>
      </div>
    </div>
  );
}

function Step5Review({
  periodMonth,
  payFrequency,
  weeksInPeriod,
  payGroup,
  payDate,
  cutOffDate,
}: {
  periodMonth:   string;
  payFrequency:  string;
  weeksInPeriod: string;
  payGroup:      string;
  payDate:       string;
  cutOffDate:    string;
}): VNode {
  return (
    <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 13, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
        Review the run details before creating.
      </p>
      <div class="hrfin-metric-list">
        <div class="hrfin-metric-row">
          <span>Pay month</span><b>{periodMonth.slice(0, 7)}</b>
        </div>
        {payGroup && (
          <div class="hrfin-metric-row">
            <span>Pay group</span><b>{payGroup}</b>
          </div>
        )}
        <div class="hrfin-metric-row">
          <span>Frequency</span>
          <b>{PAY_FREQS.find(f => f.value === payFrequency)?.label ?? payFrequency}</b>
        </div>
        <div class="hrfin-metric-row">
          <span>Weeks in period</span><b>{weeksInPeriod}</b>
        </div>
        {payDate && (
          <div class="hrfin-metric-row">
            <span>Pay date</span><b>{payDate}</b>
          </div>
        )}
        {cutOffDate && (
          <div class="hrfin-metric-row">
            <span>Cut-off date</span><b>{cutOffDate}</b>
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
        The run will be created in <strong>draft</strong> status. The full lifecycle
        (lock-inputs → calculate → submit → approve → lock) is managed from the run detail drawer.
        The active statutory version is stamped automatically.
      </p>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

const STEP_LABELS = [
  'Period & Frequency',
  'Employee Population',
  'Inputs Preview',
  'Statutory Version',
  'Pre-check',
  'Review & Create',
];

export function PayNewRunWizard({
  onClose,
  onCreated,
}: {
  onClose:   () => void;
  onCreated: (run: PayrollRun) => void;
}): VNode {
  const [step, setStep]               = useState(0);
  const [periodMonth, setPeriodMonth] = useState('');
  const [payFrequency, setPayFreq]    = useState('monthly');
  const [weeksInPeriod, setWeeks]     = useState(String(WEEKS_MAP['monthly']));
  const [payGroup, setPayGroup]       = useState('');
  const [payDate, setPayDate]         = useState('');
  const [cutOffDate, setCutOffDate]   = useState('');

  const createMut = usePayrollMutation(financePayrollApi.createRun);

  const errors: Record<string, string> = {};
  if (step === 0) {
    if (!periodMonth) errors['periodMonth'] = 'Pay month is required.';
    const wk = parseFloat(weeksInPeriod);
    if (isNaN(wk) || wk < 0.5 || wk > 5.5) errors['weeks'] = 'Weeks must be 0.5–5.5.';
    if (payDate && cutOffDate && payDate < cutOffDate) {
      errors['payDate'] = 'Pay date is before cut-off date.';
    }
  }

  const canProceed = step !== 0 || (!!periodMonth && !errors['weeks'] && !errors['payDate']);
  const isLastStep = step === STEP_LABELS.length - 1;

  async function handlePrimary(): Promise<void> {
    if (!isLastStep) {
      if (step === 0 && !canProceed) return;
      setStep(s => s + 1);
      return;
    }

    // Final step: create the run
    if (!periodMonth) { toast('Pay month is required.'); return; }
    try {
      const run = await createMut.mutateAsync({
        periodMonth:   iso8601Month(periodMonth),
        payFrequency,
        weeksInPeriod: parseFloat(weeksInPeriod),
        payGroup:      payGroup.trim() || undefined,
        payDate:       payDate || undefined,
        cutOffDate:    cutOffDate || undefined,
      });
      toast(`Payroll run ${run.runNo} created as draft.`);
      onCreated(run);
    } catch (e) {
      toast((e as Error).message ?? 'Failed to create payroll run.');
    }
  }

  return (
    <HrfinWizardModal
      open
      title="New Payroll Run"
      stepCount={STEP_LABELS.length}
      activeStep={step}
      onClose={onClose}
      onBack={step > 0 ? () => setStep(s => s - 1) : undefined}
      primaryLabel={
        createMut.isPending ? 'Creating…'
          : isLastStep ? 'Create Draft Run'
          : `Next: ${STEP_LABELS[step + 1] ?? 'Continue'}`
      }
      onPrimary={() => void handlePrimary()}
      primaryDisabled={!canProceed || createMut.isPending}
      primaryLoading={createMut.isPending}
    >
      {step === 0 && (
        <Step0Fields
          periodMonth={periodMonth}     setPeriodMonth={setPeriodMonth}
          payFrequency={payFrequency}   setPayFrequency={setPayFreq}
          weeksInPeriod={weeksInPeriod} setWeeksInPeriod={setWeeks}
          payGroup={payGroup}           setPayGroup={setPayGroup}
          payDate={payDate}             setPayDate={setPayDate}
          cutOffDate={cutOffDate}       setCutOffDate={setCutOffDate}
          errors={errors}
        />
      )}
      {step === 1 && <Step1Population periodMonth={periodMonth} />}
      {step === 2 && <Step2InputsPreview />}
      {step === 3 && <Step3StatutoryPreview />}
      {step === 4 && (
        <Step4PreCheck
          periodMonth={periodMonth}
          payFrequency={payFrequency}
          weeksInPeriod={weeksInPeriod}
          payGroup={payGroup}
          payDate={payDate}
          cutOffDate={cutOffDate}
        />
      )}
      {step === 5 && (
        <Step5Review
          periodMonth={periodMonth}
          payFrequency={payFrequency}
          weeksInPeriod={weeksInPeriod}
          payGroup={payGroup}
          payDate={payDate}
          cutOffDate={cutOffDate}
        />
      )}
    </HrfinWizardModal>
  );
}
