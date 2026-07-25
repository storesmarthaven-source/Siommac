/**
 * Pay Policy creation / edit wizard — full-page, 7-step, re-implemented from the
 * payroll-enterprise mockup `create-crew-package.html` to the Siomac standard (scoped
 * `.ppw-*`). Every editable field maps to the real `PayPolicyDraftInput` contract; the
 * governed/fixed parts of the contract (timezone America/Port_of_Spain, currency TTD,
 * statutory binding `approved_by_pay_date`, payment destination `primary_bank_account`,
 * cost-centre from the employee assignment) are shown READ-ONLY — never accept-and-drop
 * inputs. Completing the wizard creates/updates a server-side draft; the optional
 * "Submit for approval" runs the real preflight and, when ready, submits into the central
 * maker-checker workflow with the recorded certifications.
 */
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { usePayComponents } from '@api/finance/statutory';
import {
  payPoliciesApi, usePayPolicyMutation,
  type PayPolicyDraftInput, type PayPolicySourceRuleInput, type PayPolicyType, type PayPolicyWorkspace,
} from '@api/finance/payPolicies';
import { useHrEmployees, type HrEmployeeRow } from '@api/hr/employees';
import {
  buildPayPolicySources, defaultComponentBinding, isCrewPolicyType,
  PAY_POLICY_WIZARD_STEPS, payPolicyDraftStepInvalid,
} from './payPolicyRules';
import './payPolicyWizard.css';

const today = (): string => new Date().toISOString().slice(0, 10);
const reqKey = (): string => crypto.randomUUID();
const title = (v: string): string => v.replace(/_/g, ' ').replace(/\b\w/g, x => x.toUpperCase());
const empName = (e: HrEmployeeRow): string =>
  (e.display_name ?? e.full_name ?? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()) || e.username || e.id;

const STEPS: { key: string; label: string; sub: string }[] = [
  { key: 'identity',     label: 'Identity',      sub: 'Purpose and workforce' },
  { key: 'work-pattern', label: 'Work Pattern',  sub: 'Calendar and payable time' },
  { key: 'pay',          label: 'Pay Components', sub: 'Basis and eligibility' },
  { key: 'sources',      label: 'Source Controls', sub: 'HR, time and leave' },
  { key: 'statutory',    label: 'Statutory',     sub: 'Eligibility and treatment' },
  { key: 'costing',      label: 'Cost & Payment', sub: 'Accounting and disbursement' },
  { key: 'governance',   label: 'Governance',    sub: 'Approval and activation' },
];

const STARTERS: { value: PayPolicyType; label: string; blurb: string }[] = [
  { value: 'standard_salary',   label: 'Monthly Salaried',            blurb: 'Salary, recurring allowances, leave and the monthly calendar.' },
  { value: 'hourly_shift',      label: 'Hourly / Shift',              blurb: 'Approved ordinary and overtime hours using effective employee rates.' },
  { value: 'offshore_rotation', label: 'Offshore Rotation (Day Rate)', blurb: 'Rotation roster with qualifying-day pay from crew movements.' },
  { value: 'marine_voyage',     label: 'Marine / Voyage (Day Rate)',  blurb: 'Voyage / vessel roster with qualifying sea-day pay.' },
];

const OWNER_ROLES: { value: PayPolicySourceRuleInput['ownerRole']; label: string }[] = [
  { value: 'hr_manager',     label: 'HR Manager' },
  { value: 'manager',        label: 'Line Manager' },
  { value: 'finance_staff',  label: 'Finance Staff' },
  { value: 'finance_manager', label: 'Finance Manager' },
];

const initialDraft = (): PayPolicyDraftInput => ({
  code: '', name: '', description: '', policyType: 'standard_salary', ownerId: null,
  effectiveFrom: today(), effectiveTo: null, changeSummary: 'Initial governed policy',
  dayBoundary: 'calendar_day', components: [], sourceRules: buildPayPolicySources(false),
});

const draftFromWorkspace = (ws: PayPolicyWorkspace): PayPolicyDraftInput => ({
  code: ws.policy.code, name: ws.policy.name, description: ws.policy.description,
  policyType: ws.policy.policyType, ownerId: ws.policy.ownerId,
  effectiveFrom: ws.version?.effectiveFrom ?? today(), effectiveTo: ws.version?.effectiveTo ?? null,
  changeSummary: ws.version?.changeSummary ?? '', dayBoundary: ws.version?.dayBoundary ?? 'calendar_day',
  components: ws.components.map(({ componentId, calculationBasis, rateSource, eligibilitySource, ruleParameters, required, sortOrder }) => ({
    componentId, calculationBasis, rateSource, eligibilitySource, ruleParameters, required, sortOrder,
  })),
  sourceRules: ws.sourceRules.map(({ sourceType, ownerRole, required, reconciliationKey, lateInputPolicy, conflictSeverity, conflictOutcome }) => ({
    sourceType, ownerRole, required, reconciliationKey, lateInputPolicy, conflictSeverity, conflictOutcome,
  })),
});

export function PayPolicyWizard({ onClose, onCreated, workspace }: {
  onClose: () => void; onCreated: (id: string) => void; workspace?: PayPolicyWorkspace;
}): VNode {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<PayPolicyDraftInput>(() => workspace ? draftFromWorkspace(workspace) : initialDraft());
  const [selectedComponent, setSelectedComponent] = useState('');
  const [certs, setCerts] = useState<[boolean, boolean, boolean]>([false, false, false]);
  const components = usePayComponents({ activeOnly: true });
  const employees = useHrEmployees({ limit: 500 });
  const create = usePayPolicyMutation(payPoliciesApi.createDraft);
  const update = usePayPolicyMutation(payPoliciesApi.updateDraft);
  const [busy, setBusy] = useState(false);

  const componentMap = useMemo(() => new Map((components.data ?? []).map(c => [c.id, c])), [components.data]);
  const crew = isCrewPolicyType(draft.policyType);
  const invalidStep = payPolicyDraftStepInvalid(draft, step);
  const draftValid = ![0, 2, 3, 6].some(s => payPolicyDraftStepInvalid(draft, s));
  const certsAll = certs.every(Boolean);

  const setPolicyType = (policyType: PayPolicyType): void => setDraft(d => ({
    ...d, policyType,
    dayBoundary: policyType === 'standard_salary' ? 'calendar_day' : 'shift_start',
    sourceRules: buildPayPolicySources(policyType === 'hourly_shift'),
    components: [], // component bindings are policy-type-specific — reset so they are re-authored
  }));

  const addComponent = (): void => {
    if (!selectedComponent || draft.components.some(x => x.componentId === selectedComponent)) return;
    setDraft(d => ({ ...d, components: [...d.components, defaultComponentBinding(d.policyType, selectedComponent, d.components.length)] }));
    setSelectedComponent('');
  };

  // Save the draft, then (when submitting) run the real preflight and submit into the workflow.
  const save = async (submit: boolean): Promise<void> => {
    if (!draftValid) return;
    setBusy(true);
    try {
      const clean = { ...draft, code: draft.code.trim().toUpperCase(), name: draft.name.trim(), description: draft.description.trim() };
      const result = workspace?.version
        ? await update.mutateAsync({ ...clean, policyId: workspace.policy.id, versionId: workspace.version.id, expectedLockVersion: workspace.version.lockVersion, idempotencyKey: reqKey() })
        : await create.mutateAsync({ ...clean, idempotencyKey: reqKey() });
      toast(workspace ? 'Pay policy draft updated.' : 'Pay policy draft saved.');
      if (submit) {
        const pf = await payPoliciesApi.preflight(result.versionId);
        if (!pf.ready) {
          await dialog.error(`This draft cannot be submitted yet:\n\n${pf.blockers.map(b => `• ${b.message}`).join('\n')}\n\nIt has been saved — resolve the blockers from the policy workspace.`);
          onCreated(result.policyId);
          return;
        }
        await payPoliciesApi.submit(result.versionId, reqKey());
        toast('Pay policy submitted for approval.');
      }
      onCreated(result.policyId);
    } catch (e) {
      void dialog.error(e instanceof Error ? e.message : 'Pay policy could not be saved.');
    } finally { setBusy(false); }
  };

  return (
    <div class="ppw">
      <div class="ppw-head">
        <div class="ppw-crumbs"><button type="button" onClick={onClose}>Payroll Setup</button><span>›</span><b>{workspace ? 'Edit pay policy' : 'New pay policy'}</b></div>
        <div class="ppw-intro">
          <div>
            <h1>{workspace ? 'Edit Pay Policy' : 'Create Pay Policy'}</h1>
            <p>Build an effective-dated policy for pay basis, work patterns, earnings, statutory handling, source controls, costing and approval.</p>
          </div>
          <div><button type="button" onClick={onClose}>Close</button></div>
        </div>
      </div>

      <section class="ppw-bar" aria-label="Pay policy creation steps">
        <div class="ppw-steps">
          {STEPS.map((s, i) => (
            <>
              <button key={s.key} type="button" class={`ppw-step${step === i ? ' on' : i < step ? ' done' : ''}`}
                disabled={i > step && !draftValid} onClick={() => (i <= step || draftValid) && setStep(i)}>
                <span class="ppw-c">{i < step ? '✓' : i + 1}</span>
                <span class="t"><span class="l">{s.label}</span><span class="s">{s.sub}</span></span>
              </button>
              {i < STEPS.length - 1 && <span class="ppw-conn" />}
            </>
          ))}
        </div>
      </section>

      <div class="ppw-content">
        <div class="ppw-col">{renderStep(step)}</div>
        <aside class="ppw-col">{renderSidebar(step)}</aside>
      </div>

      <footer class="ppw-footer">
        <button type="button" onClick={() => step ? setStep(s => s - 1) : onClose()}>{step ? 'Back' : 'Cancel'}</button>
        <div class="right">
          {step < STEPS.length - 1
            ? <button type="button" class="is-primary" disabled={invalidStep} onClick={() => setStep(s => s + 1)}>Next step</button>
            : <>
                <button type="button" disabled={!draftValid || busy} onClick={() => void save(false)}>{workspace ? 'Update draft' : 'Save draft'}</button>
                <button type="button" class="is-primary" disabled={!draftValid || !certsAll || busy} onClick={() => void save(true)}>Submit for approval</button>
              </>}
        </div>
      </footer>
    </div>
  );

  // ── Step content ──────────────────────────────────────────────────────────
  function renderStep(s: number): VNode {
    switch (s) {
      case 0: return stepIdentity();
      case 1: return stepWorkPattern();
      case 2: return stepComponents();
      case 3: return stepSources();
      case 4: return stepStatutory();
      case 5: return stepCosting();
      default: return stepGovernance();
    }
  }

  function stepIdentity(): VNode {
    const err = { code: draft.code.trim().length < 2, name: draft.name.trim().length < 3 };
    return (
      <section class="ppw-card">
        <div class="ppw-sechead"><div class="ppw-sico">1</div><div><strong>Policy identity and workforce classification</strong><span>Start from a governed configuration, then record the policy's legal and operational scope.</span></div></div>
        <div class="ppw-body">
          <div class="ppw-field"><label>Start from</label>
            <div class="ppw-choice-grid">
              {STARTERS.map(st => (
                <label key={st.value} class={`ppw-choice${draft.policyType === st.value ? ' on' : ''}`}>
                  <input type="radio" name="ppw-starter" checked={draft.policyType === st.value} onChange={() => setPolicyType(st.value)} />
                  <span><strong>{st.label}</strong><small>{st.blurb}</small></span>
                </label>
              ))}
            </div>
          </div>
          <div class="ppw-grid">
            <div class="ppw-field"><label>Policy name</label>
              <input maxLength={120} value={draft.name} onInput={e => setDraft(d => ({ ...d, name: e.currentTarget.value }))} placeholder="e.g. Monthly Salaried" />
              {err.name ? <small class="err">Name must be at least 3 characters.</small> : <small>Use a name payroll administrators and HR teams can identify quickly.</small>}
            </div>
            <div class="ppw-field"><label>Policy code</label>
              <input maxLength={20} value={draft.code} onInput={e => setDraft(d => ({ ...d, code: e.currentTarget.value }))} placeholder="POL-TT-MONTHLY" />
              {err.code && <small class="err">Code must be at least 2 characters.</small>}
            </div>
          </div>
          <div class="ppw-grid three">
            <div class="ppw-field"><label>Legal entity</label>
              <select disabled><option>SIOMAC Trinidad and Tobago</option></select>
            </div>
            <div class="ppw-field"><label>Worker relationship</label>
              <select disabled><option>Employee</option></select>
            </div>
            <div class="ppw-field"><label>Workforce group</label>
              <select disabled><option>All employees</option></select>
            </div>
          </div>
          <div class="ppw-grid">
            <div class="ppw-field"><label>Default pay frequency</label>
              <select disabled><option>Set by assigned pay group</option></select>
              <small>Frequency is inherited from the pay group a run is scoped to.</small>
            </div>
            <div class="ppw-field"><label>Policy owner</label>
              <select value={draft.ownerId ?? ''} onChange={e => setDraft(d => ({ ...d, ownerId: e.currentTarget.value || null }))}>
                <option value="">{employees.isLoading ? 'Loading…' : 'Unassigned'}</option>
                {(employees.data ?? []).map(e => <option key={e.id} value={e.id}>{empName(e)}</option>)}
              </select>
            </div>
          </div>
          <div class="ppw-field"><label>Business purpose</label>
            <textarea maxLength={1000} value={draft.description} onInput={e => setDraft(d => ({ ...d, description: e.currentTarget.value }))}
              placeholder="Describe what this policy governs (employees, earnings, statutory handling)…" />
          </div>
        </div>
      </section>
    );
  }

  function stepWorkPattern(): VNode {
    const days = crew
      ? ['MOB', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'DEM']
      : ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const dayClass = (d: string): string =>
      crew ? (d === 'MOB' || d === 'DEM' ? 'travel' : 'on') : (d === 'SAT' || d === 'SUN' ? 'off' : 'on');
    return (
      <section class="ppw-card">
        <div class="ppw-sechead"><div class="ppw-sico">2</div><div><strong>{crew ? 'Rotation and qualifying-day rules' : 'Work schedule and payable-time rules'}</strong><span>Choose the boundary that determines ordinary work, absences and variable earnings.</span></div></div>
        <div class="ppw-body">
          <div class="ppw-field"><label>Payable-day boundary</label>
            <select value={draft.dayBoundary} onChange={e => setDraft(d => ({ ...d, dayBoundary: e.currentTarget.value as PayPolicyDraftInput['dayBoundary'] }))}
              disabled={draft.policyType === 'standard_salary'}>
              <option value="calendar_day">Calendar day (payroll timezone)</option>
              <option value="shift_start">Scheduled shift / rotation start</option>
            </select>
            <small>Versioned and applied consistently for every component. Standard salary is fixed to the calendar-day boundary.</small>
          </div>
          <div class="ppw-rot">
            <div class="ppw-rot-head"><strong>{crew ? 'Example 14-day work segment' : 'Standard work week'}</strong><span>{crew ? 'Movement and rest days remain separate source events' : 'Calendar exceptions are resolved for each pay period'}</span></div>
            <div class="ppw-days">{days.map(d => <div key={d} class={`ppw-day ${dayClass(d)}`}>{d}</div>)}</div>
          </div>
          <div class="ppw-note"><div class="i">i</div><div><strong>Payroll timezone is America/Port_of_Spain</strong><span>The work calendar, public holidays and approved leave are resolved for each pay period from the governed T&amp;T calendar.</span></div></div>
        </div>
      </section>
    );
  }

  function stepComponents(): VNode {
    const options = (components.data ?? []).filter(c => !c.isStatutory && !draft.components.some(x => x.componentId === c.id));
    return (
      <section class="ppw-card">
        <div class="ppw-sechead"><div class="ppw-sico">3</div><div><strong>{crew ? 'Crew pay basis and components' : 'Pay basis and components'}</strong><span>Governed catalogue components with a typed basis, rate source and eligibility. No free-form formulas.</span></div></div>
        <div class="ppw-body">
          <div class="ppw-note"><div class="i">i</div><div><strong>{crew ? 'Crew day-rate model' : `Pay basis: ${title(draft.policyType)}`}</strong><span>{crew ? 'Each component prices per qualifying crew day; the rate comes from the employee contract and eligibility from approved crew movements.' : 'Employee rates stay effective-dated contract data — the policy only defines how an approved rate is applied.'}</span></div></div>
          <div class="ppw-add">
            <select aria-label="Pay component" value={selectedComponent} onChange={e => setSelectedComponent(e.currentTarget.value)}>
              <option value="">{components.isLoading ? 'Loading components…' : 'Select an active component'}</option>
              {options.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
            <button type="button" class="is-primary" disabled={!selectedComponent} onClick={addComponent}>+ Add component</button>
          </div>
          <div class="ppw-row header ppw-comp"><span>Component</span><span>Basis</span><span>Rate source</span><span>Eligibility</span><span /></div>
          {draft.components.length === 0
            ? <div class="ppw-state">No components yet — add at least one governed earning.</div>
            : draft.components.map((c, i) => {
              const cat = componentMap.get(c.componentId);
              return (
                <div class="ppw-row ppw-comp" key={c.componentId}>
                  <div><strong>{cat?.name ?? 'Component'}</strong><small>{cat?.code}</small></div>
                  <span>{title(c.calculationBasis)}</span>
                  <span>{title(c.rateSource)}</span>
                  <span>{title(c.eligibilitySource)}</span>
                  <button type="button" class="rm" onClick={() => setDraft(d => ({ ...d, components: d.components.filter((_, n) => n !== i) }))}>Remove</button>
                </div>
              );
            })}
        </div>
      </section>
    );
  }

  function stepSources(): VNode {
    return (
      <section class="ppw-card">
        <div class="ppw-sechead"><div class="ppw-sico">4</div><div><strong>Source and reconciliation policy</strong><span>Declare which records are authoritative and who owns each source.</span></div></div>
        <div class="ppw-body">
          <div class="ppw-row header ppw-src"><span>Source</span><span>Owner</span><span>Conflict outcome</span><span /></div>
          {draft.sourceRules.map((r, i) => (
            <div class="ppw-row ppw-src" key={r.sourceType}>
              <div><strong>{title(r.sourceType)}</strong><small>{title(r.reconciliationKey)} · {title(r.lateInputPolicy)}</small></div>
              <select aria-label={`${title(r.sourceType)} owner`} value={r.ownerRole}
                onChange={e => setDraft(d => ({ ...d, sourceRules: d.sourceRules.map((x, n) => n === i ? { ...x, ownerRole: e.currentTarget.value as PayPolicySourceRuleInput['ownerRole'] } : x) }))}>
                {OWNER_ROLES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span style={{ color: r.conflictSeverity === 'blocker' ? 'var(--rd)' : 'var(--am-ink)' }}>{title(r.conflictOutcome)}</span>
              <span />
            </div>
          ))}
          <div class="ppw-note"><div class="i">i</div><div><strong>Statutory profile and payment destination are always required</strong><span>The governed source set is fixed by pay basis; hourly policies additionally require an approved-time source.</span></div></div>
        </div>
      </section>
    );
  }

  function stepStatutory(): VNode {
    return (
      <section class="ppw-card">
        <div class="ppw-sechead"><div class="ppw-sico">5</div><div><strong>Statutory and employee eligibility</strong><span>Trinidad &amp; Tobago statutory handling is resolved per employee at the run pay date.</span></div></div>
        <div class="ppw-body">
          <div class="ppw-gov">
            <div class="ppw-govitem"><div class="k">Home jurisdiction</div><div class="v">Trinidad &amp; Tobago (TTD)</div><div class="s">Fixed scope for this build.</div></div>
            <div class="ppw-govitem"><div class="k">Statutory binding</div><div class="v">Approved version by pay date</div><div class="s">The run snapshots the resolved approved PAYE / NIS / Health Surcharge version.</div></div>
            <div class="ppw-govitem"><div class="k">PAYE / NIS / Health Surcharge</div><div class="v">Employee profile required</div><div class="s">Resolved from each employee's approved local statutory profile.</div></div>
            <div class="ppw-govitem"><div class="k">Incomplete statutory setup</div><div class="v">Blocks calculation</div><div class="s">A missing profile raises an HR-owned blocker before input lock.</div></div>
          </div>
          <div class="ppw-note"><div class="i">TT</div><div><strong>This policy applies to employees on the Trinidad &amp; Tobago payroll</strong><span>Statutory treatment is governed platform-wide — it is not authored per policy, so there is nothing to configure here.</span></div></div>
        </div>
      </section>
    );
  }

  function stepCosting(): VNode {
    return (
      <section class="ppw-card">
        <div class="ppw-sechead"><div class="ppw-sico">6</div><div><strong>Cost allocation and payment controls</strong><span>Governed finance dimensions and controlled TTD disbursement.</span></div></div>
        <div class="ppw-body">
          <div class="ppw-gov">
            <div class="ppw-govitem"><div class="k">Payroll currency</div><div class="v">TTD</div><div class="s">Trinidad &amp; Tobago Dollar.</div></div>
            <div class="ppw-govitem"><div class="k">Payment destination</div><div class="v">Primary bank account</div><div class="s">A missing or unverified account blocks release.</div></div>
            <div class="ppw-govitem"><div class="k">Primary dimension</div><div class="v">Cost centre</div><div class="s">Resolved from the employee's effective assignment.</div></div>
            <div class="ppw-govitem"><div class="k">Missing dimension</div><div class="v">Blocks input lock</div><div class="s">Cost-centre resolution is validated before activation and release.</div></div>
          </div>
          <div class="ppw-note"><div class="i">i</div><div><strong>Costing and disbursement controls are governed</strong><span>Currency, destination and the cost-centre dimension are fixed by the platform contract — there is nothing to author per policy.</span></div></div>
        </div>
      </section>
    );
  }

  function stepGovernance(): VNode {
    const dateErr = !!draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom;
    const CERT_LABELS = [
      { t: 'Work schedule, payable-time and source-conflict rules are correct', s: 'Reviewed against the HR, time, leave and adjustment processes.' },
      { t: 'Pay components use governed rate and eligibility sources', s: 'No input is accepted without a calculation or control purpose.' },
      { t: 'Statutory, accounting and payment safeguards are complete', s: 'Every worker requires an approved statutory profile and TTD payment destination.' },
    ];
    return (
      <section class="ppw-card">
        <div class="ppw-sechead"><div class="ppw-sico">7</div><div><strong>Version, approval and activation</strong><span>Publish a controlled version without changing existing payroll runs.</span></div></div>
        <div class="ppw-body">
          <div class="ppw-grid three">
            <div class="ppw-field"><label>Effective from</label>
              <input type="date" value={draft.effectiveFrom} onInput={e => setDraft(d => ({ ...d, effectiveFrom: e.currentTarget.value }))} />
            </div>
            <div class="ppw-field"><label>Effective to (optional)</label>
              <input type="date" min={draft.effectiveFrom} value={draft.effectiveTo ?? ''} onInput={e => setDraft(d => ({ ...d, effectiveTo: e.currentTarget.value || null }))} />
              {dateErr && <small class="err">Effective-to cannot precede effective-from.</small>}
            </div>
            <div class="ppw-field"><label>Change reason</label>
              <input maxLength={500} value={draft.changeSummary} onInput={e => setDraft(d => ({ ...d, changeSummary: e.currentTarget.value }))} placeholder="e.g. Initial governed policy" />
              {draft.changeSummary.trim().length < 3 && <small class="err">A change reason of at least 3 characters is required.</small>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#14213a', margin: '4px 0 8px' }}>Configuration certification</div>
            {CERT_LABELS.map((c, i) => (
              <label class="ppw-check" key={i}>
                <input type="checkbox" checked={certs[i]} onChange={e => setCerts(p => { const n = [...p] as [boolean, boolean, boolean]; n[i] = e.currentTarget.checked; return n; })} />
                <div><strong>{c.t}</strong><small>{c.s}</small></div>
              </label>
            ))}
          </div>
          <div class="ppw-note"><div class="i">i</div><div><strong>Approval creates a new effective version — existing runs are immutable</strong><span>Save the draft, or submit it into the sequential maker-checker route (HR source review → Finance statutory review) recorded with the version checksum.</span></div></div>
        </div>
      </section>
    );
  }

  // ── Step sidebar ──────────────────────────────────────────────────────────
  function renderSidebar(s: number): VNode {
    const required = draft.sourceRules.filter(x => x.required).length;
    const earnings = draft.components.length;
    if (s === 2) return sidebar('Component controls', [
      ['Catalogue components', String(components.data?.length ?? 0)],
      ['Bound to this policy', String(earnings)],
      ['Rate model', crew ? 'Per qualifying day' : draft.policyType === 'hourly_shift' ? 'Approved hours' : 'Salary period'],
      ['Statutory mappings', 'Resolved at run'],
    ]);
    if (s === 3) return sidebar('Reconciliation result', [
      ['Source rules', String(draft.sourceRules.length)],
      ['Required sources', String(required)],
      ['Statutory profile', draft.sourceRules.some(x => x.sourceType === 'statutory_profile' && x.required) ? 'Required' : 'Missing'],
      ['Payment destination', draft.sourceRules.some(x => x.sourceType === 'payment_destination' && x.required) ? 'Required' : 'Missing'],
    ]);
    if (s === 4) return sidebar('Statutory readiness', [
      ['Home profile', 'Per employee'], ['Binding', 'By pay date'], ['Expired evidence', 'Blocks run'], ['Owner', 'Finance / HR'],
    ]);
    if (s === 5) return sidebar('Accounting readiness', [
      ['Payment currency', 'TTD'], ['Destination', 'Primary bank'], ['Primary dimension', 'Cost centre'], ['Missing dimension', 'Blocks lock'],
    ]);
    if (s === 6) return sidebar('Version summary', [
      ['Policy', draft.code.trim().toUpperCase() || '—'],
      ['Effective from', draft.effectiveFrom || '—'],
      ['Components', `${earnings} configured`],
      ['Required sources', String(required)],
      ['Certifications', `${certs.filter(Boolean).length} of 3`],
      ['Run behavior', 'Snapshot version'],
    ]);
    // Identity / Work Pattern → draft position + governance note (matches the mockup aside).
    return (
      <>
        {sidebar('Draft position', [
          ['New version', workspace?.version ? `v${workspace.version.versionNo} draft` : 'v1 draft'],
          ['Worker relationship', 'Employee'],
          ['Home jurisdiction', 'Trinidad & Tobago'],
          ['Pay frequency', 'Set by pay group'],
          ['Approval required', 'Yes'],
        ])}
        <div class="ppw-note"><div class="i">i</div><div><strong>Starter configurations are not legal certification</strong><span>Activation still requires statutory, accounting and approval validation for the selected entity and effective date.</span></div></div>
      </>
    );
  }

  function sidebar(heading: string, rows: [string, string][]): VNode {
    return (
      <section class="ppw-card">
        <div class="ppw-sechead ppw-sechead--plain" style={{ padding: '15px 18px' }}><strong>{heading}</strong></div>
        <div class="ppw-summary">
          {rows.map(([k, v]) => <div class="ppw-srow" key={k}><span>{k}</span><strong>{v}</strong></div>)}
        </div>
      </section>
    );
  }
}

export { PAY_POLICY_WIZARD_STEPS };
