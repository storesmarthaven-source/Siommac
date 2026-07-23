/**
 * src/components/sections/Finance/PayNewRunWizard.tsx
 *
 * Full-page "Create Payroll Run" wizard — re-implements
 * mockups/payroll-enterprise/create-run.html to the Siomac standard (scoped
 * .pcrw). Seven steps mirroring the mockup:
 *   1 Run Type · 2 Pay Group · 3 Pay Period & Dates · 4 Statutory Version
 *   5 Employee Population · 6 Input Sources · 7 Review & Create
 *
 * Slice 0 wires every genuinely-backed field to the real createRun contract
 * (runType + periodStart/End + idempotencyKey — the route REQUIRES these; the
 * previous modal sent `periodMonth` and could not create a run). Steps whose
 * data the backend does not yet provide at create-time (input-source readiness,
 * pre-lock financial estimate, per-rule reconciliation, run metadata) render
 * honest "pending" states that Slices 1–4 fill — never fabricated numbers.
 */

import { Fragment, type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useQuery } from '@tanstack/preact-query';
import { toast } from '@store';
import {
  usePayrollMutation,
  usePopulationPreview,
  usePopulationReconciliation,
  useInputReadiness,
  usePayGroups,
  useReasonCodes,
  financePayrollApi,
  PayrollApiError,
  type PayrollRun,
  type PayrollRunType,
  type PopulationReconciliationRule,
  type InputSourceReadiness,
} from '@api/finance/payroll';
import { runsRegisterApi } from '@api/finance/payrollRunsRegister';
import './payrunWizard.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAY_FREQS = [
  { value: 'monthly',      label: 'Monthly (4.33 weeks)' },
  { value: 'semi_monthly', label: 'Semi-monthly (2.17 weeks)' },
  { value: 'fortnightly',  label: 'Fortnightly (2 weeks)' },
  { value: 'weekly',       label: 'Weekly (1 week)' },
];
const WEEKS_MAP: Record<string, number> = { monthly: 4.333, semi_monthly: 52 / 24, fortnightly: 2, weekly: 1 };

const RUN_TYPES: { value: PayrollRunType; title: string; desc: string }[] = [
  { value: 'scheduled',  title: 'Scheduled payroll',  desc: 'Regular run generated from an approved pay group and payroll calendar.' },
  { value: 'off_cycle',  title: 'Off-cycle payroll',  desc: 'Supplementary payment outside the scheduled cycle.' },
  { value: 'correction', title: 'Correction run',     desc: 'Correct a released payroll with traceability to the source run.' },
  { value: 'final_pay',  title: 'Final pay',          desc: 'Termination settlement for one or more employees.' },
];

// Population-reconciliation rule presentation (Slice 2)
const RECON_STATE_PILL: Record<PopulationReconciliationRule['state'], string> = {
  included: 'green', warning: 'amber', review: 'blue', blocker: 'red',
};
const RECON_STATE_LABEL: Record<PopulationReconciliationRule['state'], string> = {
  included: 'Included', warning: 'Warning', review: 'Review', blocker: 'Blocker',
};
const RECON_OWNER_LABEL: Record<PopulationReconciliationRule['ownerRole'], string> = {
  hr: 'HR', finance: 'Finance', payroll: 'Payroll',
};

// Input-source readiness presentation (Slice 3)
const READINESS_RC: Record<InputSourceReadiness['state'], string> = {
  ready: 'ok', pending: 'warn', review: 'bad',
};
const READINESS_ICON: Record<InputSourceReadiness['state'], string> = {
  ready: '✓', pending: '…', review: '!',
};
const READINESS_LABEL: Record<InputSourceReadiness['state'], string> = {
  ready: 'Ready', pending: 'Awaiting approval', review: 'Needs review',
};
const READINESS_PILL: Record<InputSourceReadiness['state'], string> = {
  ready: 'green', pending: 'amber', review: 'red',
};

const STEPS = [
  { key: 'type',       label: 'Run Type',            sub: 'Purpose and ownership' },
  { key: 'paygroup',   label: 'Pay Group',           sub: 'Frequency and membership' },
  { key: 'dates',      label: 'Pay Period & Dates',  sub: 'Calendar and cut-offs' },
  { key: 'statutory',  label: 'Statutory Version',   sub: 'Rules and effective date' },
  { key: 'population', label: 'Employee Population',  sub: 'Reconcile who is paid' },
  { key: 'inputs',     label: 'Input Sources',       sub: 'Readiness and cut-off' },
  { key: 'review',     label: 'Review & Create',     sub: 'Controls and confirmation' },
] as const;

// ── F-02: typed create-time blockers (create_run_tx resolves + pins policy) ─────
interface CreateBlocker { title: string; detail: string; field?: 'payGroupId' }
const CREATE_BLOCKERS: Record<string, CreateBlocker> = {
  'policy.pay_group_required': { title: 'Pay group required', detail: 'Every payroll run must be scoped to a pay group so its governed pay policy can be resolved. Select a pay group and try again.', field: 'payGroupId' },
  'policy.missing':            { title: 'No active pay policy for this pay group and period', detail: 'No approved pay-policy version covers the whole pay period for this pay group. Activate and assign a policy in Payroll Setup → Pay Policy before creating the run.' },
  'policy.ambiguous':          { title: 'More than one active pay policy applies', detail: 'Two or more active policy assignments cover this period for the pay group. Resolve the overlap in Payroll Setup → Pay Policy, then retry.' },
  'calendar.unresolved':       { title: 'No work calendar covers this period', detail: 'This policy prorates by working days, but no work-calendar assignment covers the whole pay period for this pay group. Assign a published work calendar in Work Calendar setup.' },
  'calendar.split_period':     { title: 'Work calendar changes mid-period', detail: 'More than one work-calendar assignment applies within this period and none covers it end-to-end. Align the assignment windows so a single calendar covers the whole period.' },
  'calendar.jurisdiction_mismatch': { title: 'Holiday calendar jurisdiction mismatch', detail: 'The resolved holiday calendar’s jurisdiction does not match the pay group’s statutory country. Assign a work calendar whose holiday set matches the pay group jurisdiction.' },
  'calendar.zero_working_days':{ title: 'No working days in this period', detail: 'The resolved work calendar has zero working days across the whole pay period, so a working-days proration cannot be computed. Check the calendar’s working weekdays and holidays for this period.' },
  'calendar.version_unpublished': { title: 'Work calendar version not published', detail: 'The resolved work-calendar version is not published. Publish it in Work Calendar setup, then retry.' },
  'calendar.holiday_set_unpublished': { title: 'Holiday set not published', detail: 'The resolved holiday set is not published. Publish it in Work Calendar setup, then retry.' },
  'calendar.version_period_uncovered': { title: 'Work calendar does not cover the whole period', detail: 'The resolved work-calendar version’s effective window does not cover the whole pay period. Extend or reassign the calendar version.' },
};

/**
 * Resolve a typed create failure to its blocker card by EXACT error code
 * (P0-5: the code comes from PayrollApiError.code — never parsed out of
 * display text). Codes may carry a `:qualifier` suffix (e.g.
 * 'policy.source_missing:payment_destination'); match on the base token.
 */
export function matchCreateBlocker(code: string | null | undefined): (CreateBlocker & { code: string }) | null {
  if (!code) return null;
  const base = code.split(':', 1)[0]!;
  const hit = CREATE_BLOCKERS[base];
  return hit ? { code: base, ...hit } : null;
}

function lastOfMonth(ym: string): string {
  // ym = YYYY-MM-DD → last calendar day of that month, YYYY-MM-DD
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym.slice(0, 8)}${String(last).padStart(2, '0')}`;
}

// ── Sidebar helpers ─────────────────────────────────────────────────────────────

function SummaryCard({ title, rows }: { title: string; rows: [string, string][] }): VNode {
  return (
    <section class="card">
      <div class="sec-head"><div class="sec-title">{title}</div></div>
      <div class="panel-body summary-rows">
        {rows.map(([k, v]) => <div class="summary-row" key={k}><span>{k}</span><strong>{v}</strong></div>)}
      </div>
    </section>
  );
}

function PendingBlock({ title, detail }: { title: string; detail: string }): VNode {
  return (
    <div class="pcrw-pending">
      <div class="b-ico">◷</div>
      <div><strong>{title}</strong><div style={{ marginTop: 3 }}>{detail}</div></div>
    </div>
  );
}

// ── Main wizard ─────────────────────────────────────────────────────────────────

export function PayNewRunWizard({
  onClose,
  onCreated,
}: {
  onClose:   () => void;
  onCreated: (run: PayrollRun) => void;
}): VNode {
  const [step, setStep]             = useState(0);
  const [runType, setRunType]       = useState<PayrollRunType>('scheduled');
  const [sourceRunId, setSourceRun] = useState('');
  const [payGroupId, setPayGroupId] = useState('');
  const [payGroupName, setPayGroupName] = useState('');
  const [payFrequency, setPayFreq]  = useState('monthly');
  const [weeksInPeriod, setWeeks]   = useState(String(WEEKS_MAP.monthly));
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd]   = useState('');
  const [payDate, setPayDate]       = useState('');
  const [cutOffDate, setCutOffDate] = useState('');
  // Slice 1 run metadata
  const [reasonCode, setReasonCode]                 = useState('');
  const [internalDescription, setInternalDescription] = useState('');
  const [otCutoffAt, setOtCutoffAt]                 = useState('');
  const [approvalDeadlineAt, setApprovalDeadlineAt] = useState('');
  const [fundingDate, setFundingDate]               = useState('');
  const [releaseWindow, setReleaseWindow]           = useState('');
  const [confirms, setConfirms]     = useState<[boolean, boolean, boolean]>([false, false, false]);
  const [blocker, setBlocker]       = useState<(CreateBlocker & { code: string }) | null>(null);

  // Caller-owned idempotency key — stable across retries of one create attempt.
  const [idemKey] = useState(() => crypto.randomUUID());

  const payGroupsQ  = usePayGroups(true);
  const groups      = payGroupsQ.data ?? [];
  const periodMonth = periodStart ? periodStart.slice(0, 7) : undefined;
  const populationQ = usePopulationPreview(periodMonth ? `${periodMonth}-01` : undefined);
  const reconQ      = usePopulationReconciliation(
    payGroupId || undefined, periodStart || undefined, periodEnd || undefined);
  const readinessQ  = useInputReadiness(
    payGroupId || undefined, periodStart || undefined, periodEnd || undefined);
  // Correction source-run picker. runs/list is now the keyset register contract
  // (PayrollRunListResult), so read .items — not an array — and use reference/state.
  const runsQ       = useQuery({
    queryKey: ['finance', 'payroll', 'runs', 'source-picker'],
    queryFn:  () => runsRegisterApi.list({ limit: 50 }),
    enabled:  runType === 'correction',
  });
  const reasonCodesQ = useReasonCodes(runType);
  const reasonCodes  = reasonCodesQ.data ?? [];

  const createMut = usePayrollMutation(financePayrollApi.createRun);

  // ── per-step validation ──
  const wk = parseFloat(weeksInPeriod);
  const errors: Record<string, string> = {};
  if (step === 0 && runType === 'correction' && !sourceRunId) errors.sourceRunId = 'A correction run must reference the source run it corrects.';
  if (step === 1 && !payGroupId) errors.payGroupId = 'Select a pay group — every run is pay-group-scoped.';
  if (step === 2) {
    if (!periodStart) errors.periodStart = 'Period start is required.';
    if (!periodEnd)   errors.periodEnd   = 'Period end is required.';
    if (periodStart && periodEnd && periodStart > periodEnd) errors.periodEnd = 'Period end is before period start.';
    if (isNaN(wk) || wk < 0.5 || wk > 5.5) errors.weeks = 'Weeks in period must be 0.5–5.5.';
    if (payDate && cutOffDate && payDate < cutOffDate) errors.payDate = 'Pay date is before the cut-off date.';
  }
  const stepValid = Object.keys(errors).length === 0;
  const allConfirmed = confirms.every(Boolean);
  const isLast = step === STEPS.length - 1;
  const canCreate = !!payGroupId && !!periodStart && !!periodEnd && wk >= 0.5 && wk <= 5.5 &&
    (runType !== 'correction' || !!sourceRunId) && allConfirmed;

  function selectGroup(id: string): void {
    setPayGroupId(id);
    const g = groups.find(x => x.id === id);
    if (g) { setPayGroupName(g.name); setPayFreq(g.frequency); setWeeks(String(WEEKS_MAP[g.frequency] ?? 4.333)); }
    else setPayGroupName('');
  }

  function goToStep(s: number): void { setBlocker(null); setStep(Math.max(0, Math.min(STEPS.length - 1, s))); }

  async function create(): Promise<void> {
    if (!canCreate) return;
    setBlocker(null);
    try {
      const run = await createMut.mutateAsync({
        idempotencyKey: idemKey,
        runType,
        periodStart,
        periodEnd,
        sourceRunId: runType === 'correction' && sourceRunId ? sourceRunId : undefined,
        payFrequency: payFrequency as 'weekly' | 'fortnightly' | 'semi_monthly' | 'monthly',
        weeksInPeriod: wk,
        payGroupId,
        payDate:    payDate || undefined,
        cutOffDate: cutOffDate || undefined,
        reasonCode:          reasonCode || undefined,
        internalDescription: internalDescription.trim() || undefined,
        otCutoffAt:          otCutoffAt || undefined,
        approvalDeadlineAt:  approvalDeadlineAt || undefined,
        fundingDate:         fundingDate || undefined,
        releaseWindow:       releaseWindow.trim() || undefined,
      });
      toast(`Payroll run ${run.runNo} created as draft.`);
      onCreated(run);
    } catch (e) {
      // P0-5: switch on the typed error code — never match message substrings.
      const code = e instanceof PayrollApiError ? e.code : null;
      const msg = e instanceof Error ? e.message : '';
      const b = matchCreateBlocker(code);
      if (b) { setBlocker(b); toast(b.title); if (b.field === 'payGroupId') setStep(1); }
      else toast(msg || 'Failed to create payroll run.');
    }
  }

  const pop = populationQ.data;
  const recon = reconQ.data;
  const readiness = readinessQ.data;
  const runNumberHint = `PAY-${periodMonth ?? '————-——'}-${runType === 'scheduled' ? 'M01' : runType.slice(0, 3).toUpperCase()}`;

  return (
    <div class="pcrw">
      <div class="pcrw-crumbs"><a onClick={onClose} style={{ cursor: 'pointer' }}>Payroll</a><span class="sep">›</span><b>New payroll run</b></div>
      <div class="pcrw-head">
        <div>
          <h1>Create Payroll Run</h1>
          <p>Configure the run, reconcile the employee population and source inputs, then complete preflight controls before creating the draft.</p>
        </div>
        <div class="pcrw-head-actions"><button type="button" class="btn" onClick={onClose}>Close</button></div>
      </div>

      {/* Step rail */}
      <section class="pcrw-bar" aria-label="Payroll creation steps">
        <div class="pcrw-steps">
          {STEPS.map((s, i) => (
            <Fragment key={s.key}>
              <button
                type="button"
                class={`pcrw-step ${i === step ? 'cur' : i < step ? 'done' : ''}`}
                onClick={() => i <= step && goToStep(i)}
                disabled={i > step}
              >
                <div class="c">{i < step ? '✓' : i + 1}</div>
                <div><div class="l">{s.label}</div><div class="s">{s.sub}</div></div>
              </button>
              {i < STEPS.length - 1 && <div class="pcrw-conn" />}
            </Fragment>
          ))}
        </div>
      </section>

      {/* ── Step 1 · Run Type ── */}
      {step === 0 && (
        <div class="pcrw-content">
          <section class="card">
            <div class="sec-head"><div class="sec-ico">1</div><div><div class="sec-title">Run type and ownership</div><div class="sec-sub">Identify why this payroll is being created and who is accountable for preparation.</div></div></div>
            <div class="panel-body stack">
              <div class="choice-grid">
                {RUN_TYPES.map(rt => (
                  <label key={rt.value} class={`choice ${runType === rt.value ? 'on' : ''}`}>
                    <input type="radio" name="run-type" checked={runType === rt.value} onChange={() => { setRunType(rt.value); setReasonCode(''); setBlocker(null); }} />
                    <span><strong>{rt.title}</strong><small>{rt.desc}</small></span>
                  </label>
                ))}
              </div>
              {runType === 'correction' && (
                <div class="field-group">
                  <label>Source run *</label>
                  <select class={`select ${errors.sourceRunId ? 'err' : ''}`} value={sourceRunId} onChange={e => setSourceRun((e.currentTarget).value)}>
                    <option value="" disabled>Select the run this corrects…</option>
                    {(runsQ.data?.items ?? []).map(r => <option key={r.id} value={r.id}>{r.reference} · {r.state}</option>)}
                  </select>
                  {errors.sourceRunId
                    ? <span class="err-msg">{errors.sourceRunId}</span>
                    : <span class="hint">Correction runs are traceable to the released run they amend.</span>}
                </div>
              )}
              <div class="field-grid">
                <div class="field-group"><label>Run number</label><div class="ro">{runNumberHint}</div><span class="hint">Auto-allocated by the server on creation.</span></div>
                <div class="field-group"><label>Payroll owner</label><div class="ro">You (assigned on creation)</div><span class="hint">The creator owns preparation; approval is a different Finance Manager.</span></div>
                <div class="field-group">
                  <label>Reason code</label>
                  <select class="select" value={reasonCode} onChange={e => setReasonCode((e.currentTarget).value)}>
                    <option value="">— None —</option>
                    {reasonCodes.map(rc => <option key={rc.code} value={rc.code}>{rc.label}</option>)}
                  </select>
                  <span class="hint">Recorded on the run for reporting and audit.</span>
                </div>
                <div class="field-group"><label>Cost entity</label><div class="ro">SIOMAC Trinidad &amp; Tobago</div><span class="hint">Statutory jurisdiction (TT) — fixed for this build.</span></div>
              </div>
              <div class="field-group">
                <label>Internal description</label>
                <textarea class="textarea" value={internalDescription} onInput={e => setInternalDescription((e.currentTarget).value)} placeholder="Optional context recorded on the draft (e.g. Regular monthly payroll for salaried employees)." maxLength={2000} />
              </div>
            </div>
          </section>
          <aside class="pcrw-aside">
            <SummaryCard title="Run impact" rows={[
              ['Run classification', RUN_TYPES.find(r => r.value === runType)?.title ?? '—'],
              ['Expected approvals', '1 (segregated)'],
              ['Correction linkage', runType === 'correction' ? (sourceRunId ? 'Linked' : 'Required') : 'Not applicable'],
            ]} />
            <section class="card"><div class="sec-head"><div class="sec-title">Control reminders</div></div><div class="panel-body stack" style={{ gap: 10 }}>
              <div class="readiness-row"><div class="rc ok">✓</div><div class="rt"><strong>Maker-checker enforced</strong><small>The preparer cannot approve this run.</small></div></div>
              <div class="readiness-row"><div class="rc ok">✓</div><div class="rt"><strong>Statutory version pinned on create</strong><small>The active version is stamped and immutable for this run.</small></div></div>
            </div></section>
          </aside>
        </div>
      )}

      {/* ── Step 2 · Pay Group ── */}
      {step === 1 && (
        <div class="pcrw-content">
          <section class="card">
            <div class="sec-head"><div class="sec-ico">2</div><div><div class="sec-title">Select pay group</div><div class="sec-sub">The group defines frequency, membership and the effective pay policy.</div></div></div>
            {payGroupsQ.isLoading
              ? <div class="panel-body"><span class="pcrw-skel" style={{ width: '100%', height: 44 }} /></div>
              : groups.length === 0
                ? <div class="panel-body"><PendingBlock title="No pay groups configured" detail="Create a pay group in Payroll Setup before creating a run." /></div>
                : (
                  <div class="table-wrap"><table class="data-table">
                    <thead><tr><th /><th>Pay group</th><th>Frequency</th><th class="num">Members</th><th>Default pay day</th></tr></thead>
                    <tbody>
                      {groups.map(g => (
                        <tr key={g.id} class={`selectable ${payGroupId === g.id ? 'on' : ''}`} onClick={() => selectGroup(g.id)}>
                          <td><input type="radio" name="pay-group" checked={payGroupId === g.id} onChange={() => selectGroup(g.id)} /></td>
                          <td><strong>{g.name}</strong><div class="sec-sub">{g.code}</div></td>
                          <td style={{ textTransform: 'capitalize' }}>{g.frequency.replace('_', '-')}</td>
                          <td class="num">{g.memberCount ?? '—'}</td>
                          <td>{g.defaultPayDay != null ? `Day ${g.defaultPayDay}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
            {errors.payGroupId && <div class="panel-body" style={{ paddingTop: 0 }}><span class="err-msg">{errors.payGroupId}</span></div>}
          </section>
          <aside class="pcrw-aside">
            <SummaryCard title="Selected group" rows={payGroupId ? [
              ['Pay group', payGroupName || '—'],
              ['Active members', String(groups.find(g => g.id === payGroupId)?.memberCount ?? '—')],
              ['Frequency', (PAY_FREQS.find(f => f.value === payFrequency)?.label ?? payFrequency)],
            ] : [['Pay group', 'None selected']]} />
            <div class="banner info"><div class="b-ico">i</div><div><div class="b-title">Policy resolves on create</div><div class="b-sub">The group’s approved pay policy (and work calendar for working-days policies) is resolved and pinned when the run is created.</div></div></div>
          </aside>
        </div>
      )}

      {/* ── Step 3 · Pay Period & Dates ── */}
      {step === 2 && (
        <div class="pcrw-content">
          <section class="card">
            <div class="sec-head"><div class="sec-ico">3</div><div><div class="sec-title">Pay period and operational dates</div><div class="sec-sub">Set the period the run covers and the payment and cut-off dates.</div></div></div>
            <div class="panel-body stack">
              <div class="field-grid three">
                <div class="field-group"><label>Period start *</label><input class={`field ${errors.periodStart ? 'err' : ''}`} type="date" value={periodStart} onInput={e => { const v = (e.currentTarget).value; setPeriodStart(v); if (v && !periodEnd) setPeriodEnd(lastOfMonth(v)); }} />{errors.periodStart && <span class="err-msg">{errors.periodStart}</span>}</div>
                <div class="field-group"><label>Period end *</label><input class={`field ${errors.periodEnd ? 'err' : ''}`} type="date" value={periodEnd} onInput={e => setPeriodEnd((e.currentTarget).value)} />{errors.periodEnd && <span class="err-msg">{errors.periodEnd}</span>}</div>
                <div class="field-group"><label>Pay date</label><input class={`field ${errors.payDate ? 'err' : ''}`} type="date" value={payDate} onInput={e => setPayDate((e.currentTarget).value)} />{errors.payDate ? <span class="err-msg">{errors.payDate}</span> : <span class="hint">Date employees are paid.</span>}</div>
              </div>
              <div class="field-grid three">
                <div class="field-group"><label>Pay frequency *</label><select class="select" value={payFrequency} onChange={e => { const v = (e.currentTarget).value; setPayFreq(v); setWeeks(String(WEEKS_MAP[v] ?? 4.333)); }}>{PAY_FREQS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></div>
                <div class="field-group"><label>Weeks in period</label><input class={`field ${errors.weeks ? 'err' : ''}`} type="number" min="0.5" max="5.5" step="0.001" value={weeksInPeriod} onInput={e => setWeeks((e.currentTarget).value)} />{errors.weeks ? <span class="err-msg">{errors.weeks}</span> : <span class="hint">Auto-set from frequency.</span>}</div>
                <div class="field-group"><label>Employee-change cut-off</label><input class="field" type="date" value={cutOffDate} onInput={e => setCutOffDate((e.currentTarget).value)} /><span class="hint">Changes after this date are excluded.</span></div>
              </div>
              <div class="field-grid three">
                <div class="field-group"><label>Time / overtime cut-off</label><input class="field" type="datetime-local" value={otCutoffAt} onInput={e => setOtCutoffAt((e.currentTarget).value)} /><span class="hint">Latest overtime accepted into this run.</span></div>
                <div class="field-group"><label>Approval deadline</label><input class="field" type="datetime-local" value={approvalDeadlineAt} onInput={e => setApprovalDeadlineAt((e.currentTarget).value)} /><span class="hint">Must be on/after the overtime cut-off.</span></div>
                <div class="field-group"><label>Payment funding date</label><input class="field" type="date" value={fundingDate} onInput={e => setFundingDate((e.currentTarget).value)} /><span class="hint">Treasury funds the payroll account by this date.</span></div>
              </div>
              <div class="field-group">
                <label>Release window</label>
                <input class="field" type="text" value={releaseWindow} onInput={e => setReleaseWindow((e.currentTarget).value)} placeholder="e.g. 30 Jul 18:00 – 31 Jul 08:00" maxLength={120} />
              </div>
            </div>
          </section>
          <aside class="pcrw-aside">
            <SummaryCard title="Calendar timeline" rows={[
              ['Period', periodStart && periodEnd ? `${periodStart} → ${periodEnd}` : '—'],
              ['Change cut-off', cutOffDate || '—'],
              ['Pay date', payDate || '—'],
            ]} />
          </aside>
        </div>
      )}

      {/* ── Step 4 · Statutory Version ── */}
      {step === 3 && (
        <div class="pcrw-content">
          <section class="card">
            <div class="sec-head"><div class="sec-ico">4</div><div><div class="sec-title">Statutory configuration snapshot</div><div class="sec-sub">The active statutory version is resolved from the pay date and permanently stamped on the run.</div></div><div class="aux"><span class="pill green">Auto-pinned</span></div></div>
            <div class="panel-body stack">
              <div class="field-grid">
                <div class="field-group"><label>Jurisdiction</label><div class="ro">Trinidad &amp; Tobago</div></div>
                <div class="field-group"><label>Resolved version</label><div class="ro">Active TT statutory version</div><span class="hint">Resolved and stamped server-side at creation from Statutory Configuration.</span></div>
              </div>
              <div class="field-grid three">
                <div class="card panel-body" style={{ borderRadius: 10 }}><span class="pill blue">PAYE</span><div style={{ fontWeight: 700, marginTop: 6 }}>Income tax</div><div class="sec-sub">Personal allowance + band rates.</div></div>
                <div class="card panel-body" style={{ borderRadius: 10 }}><span class="pill blue">NIS</span><div style={{ fontWeight: 700, marginTop: 6 }}>National Insurance</div><div class="sec-sub">Weekly class table, EE/ER rates.</div></div>
                <div class="card panel-body" style={{ borderRadius: 10 }}><span class="pill blue">HS</span><div style={{ fontWeight: 700, marginTop: 6 }}>Health Surcharge</div><div class="sec-sub">Weekly/monthly thresholds.</div></div>
              </div>
              <div class="banner info"><div class="b-ico">i</div><div><div class="b-title">Version is immutable once stamped</div><div class="b-sub">To change the basis, activate a different statutory version in Statutory Configuration before creating this run.</div></div></div>
            </div>
          </section>
          <aside class="pcrw-aside">
            <PendingBlock title="Version impact (Slice 2)" detail="Employees covered, missing statutory profiles and component-mapping counts render once the population-reconciliation endpoint lands." />
          </aside>
        </div>
      )}

      {/* ── Step 5 · Employee Population ── */}
      {step === 4 && (
        <div class="pcrw-content">
          <section class="card">
            <div class="sec-head"><div class="sec-ico">5</div><div><div class="sec-title">Employee population</div><div class="sec-sub">Active employees who will be included{periodMonth ? ` for ${periodMonth}` : ''}. Final membership freezes at Lock Inputs.</div></div></div>
            {populationQ.isLoading
              ? <div class="panel-body"><span class="pcrw-skel" style={{ width: '100%', height: 40 }} /></div>
              : (
                <div class="metrics">
                  <div class="metric"><div class="m-ico">#</div><div><div class="k">Total active</div><div class="v">{pop?.total ?? '—'}</div><div class="s">{payGroupName || 'all groups'}</div></div></div>
                  <div class="metric"><div class="m-ico">$</div><div><div class="k">Salaried</div><div class="v">{pop?.salaried ?? '—'}</div></div></div>
                  <div class="metric"><div class="m-ico">⏱</div><div><div class="k">Hourly</div><div class="v">{pop?.hourly ?? '—'}</div></div></div>
                  <div class="metric"><div class="m-ico green">+</div><div><div class="k">New hires</div><div class="v">{pop?.newHires ?? '—'}</div></div></div>
                  <div class="metric"><div class="m-ico amber">−</div><div><div class="k">Terminations</div><div class="v">{pop?.terminations ?? '—'}</div></div></div>
                </div>
              )}
            <div class="panel-body stack">
              {(!payGroupId || !periodStart || !periodEnd)
                ? <PendingBlock title="Select a pay group and period to reconcile" detail="The per-rule reconciliation, department distribution and prior-run comparison are scoped to the chosen pay group and run period. Set them in the earlier steps." />
                : reconQ.isLoading
                  ? <span class="pcrw-skel" style={{ width: '100%', height: 160 }} />
                  : reconQ.isError
                    ? <div class="banner danger"><div class="b-ico">!</div><div><div class="b-title">Reconciliation unavailable</div><div class="b-sub">Could not load the population reconciliation. Retry, or continue — final membership still freezes at Lock Inputs.</div></div></div>
                    : recon && (
                      <>
                        <div class="table-wrap">
                          <table class="data-table">
                            <thead><tr><th>Rule</th><th class="num">Count</th><th>Owner</th><th>State</th><th>Action</th></tr></thead>
                            <tbody>
                              {recon.rules.map(r => (
                                <tr key={r.key}>
                                  <td><strong>{r.label}</strong><div class="cell-sub">{r.rule}</div></td>
                                  <td class="num">{r.count}</td>
                                  <td>{RECON_OWNER_LABEL[r.ownerRole]}</td>
                                  <td><span class={`pill ${RECON_STATE_PILL[r.state]}`}>{RECON_STATE_LABEL[r.state]}</span></td>
                                  <td>{r.count > 0 && r.action ? r.action : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div>
                          <div class="mini-head">Department distribution</div>
                          {recon.departments.length === 0
                            ? <div class="cell-sub" style={{ padding: '4px 2px' }}>No active employees in this pay group for the period.</div>
                            : (
                              <div class="table-wrap">
                                <table class="data-table">
                                  <thead><tr><th>Department</th><th class="num">Employees</th></tr></thead>
                                  <tbody>
                                    {recon.departments.map(d => (
                                      <tr key={d.departmentId ?? 'unassigned'}><td>{d.name}</td><td class="num">{d.count}</td></tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                        </div>
                      </>
                    )}
            </div>
          </section>
          <aside class="pcrw-aside">
            <SummaryCard title="Snapshot" rows={[
              ['Population source', payGroupName || 'Pay group members'],
              ['Frozen at', 'Lock Inputs'],
              ['Preview basis', periodMonth ?? 'set a period'],
            ]} />
            {recon && (
              <SummaryCard title="Vs last released run" rows={[
                ['Last released', recon.priorRun.runId ? `${recon.priorRun.releasedPopulation} paid` : 'None found'],
                ['Proposed now', `${recon.priorRun.proposed} employees`],
                ['Added', `+${recon.priorRun.added}`],
                ['Removed', `−${recon.priorRun.removed}`],
              ]} />
            )}
          </aside>
        </div>
      )}

      {/* ── Step 6 · Input Sources ── */}
      {step === 5 && (
        <div class="pcrw-content single">
          <section class="card">
            <div class="sec-head"><div class="sec-ico">6</div><div><div class="sec-title">Input-source readiness</div><div class="sec-sub">Freshness, approval state and ownership across every payroll input source.</div></div></div>
            <div class="panel-body">
              {(!payGroupId || !periodStart || !periodEnd)
                ? <PendingBlock title="Select a pay group and period" detail="Input-source readiness is scoped to the chosen pay group and run period. Set them in the earlier steps." />
                : readinessQ.isLoading
                  ? <span class="pcrw-skel" style={{ width: '100%', height: 200 }} />
                  : readinessQ.isError
                    ? <div class="banner danger"><div class="b-ico">!</div><div><div class="b-title">Readiness unavailable</div><div class="b-sub">Could not load input-source readiness. Retry, or continue — inputs still freeze at Lock Inputs.</div></div></div>
                    : readiness?.sources.map(s => (
                      <div class="readiness-row" key={s.key}>
                        <div class={`rc ${READINESS_RC[s.state]}`}>{READINESS_ICON[s.state]}</div>
                        <div class="rt">
                          <strong>{s.label}</strong>
                          <small>{s.records} record{s.records === 1 ? '' : 's'} · {RECON_OWNER_LABEL[s.ownerRole]} · {s.freshnessAt ? `updated ${s.freshnessAt.slice(0, 10)}` : 'no dated feed'}</small>
                        </div>
                        <span class={`pill ${READINESS_PILL[s.state]}`}>{READINESS_LABEL[s.state]}</span>
                      </div>
                    ))}
            </div>
          </section>
        </div>
      )}

      {/* ── Step 7 · Review & Create ── */}
      {step === 6 && (
        <div class="pcrw-content">
          <div class="stack">
            <section class="card">
              <div class="sec-head"><div class="sec-ico">7</div><div><div class="sec-title">Run configuration</div><div class="sec-sub">Final configuration recorded on the draft.</div></div><div class="aux"><button type="button" class="btn" style={{ height: 30, fontSize: 12 }} onClick={() => goToStep(0)}>Edit</button></div></div>
              <div class="panel-body field-grid three" style={{ gap: 20 }}>
                <div class="summary-rows">
                  <div class="summary-row"><span>Run type</span><strong>{RUN_TYPES.find(r => r.value === runType)?.title}</strong></div>
                  <div class="summary-row"><span>Pay group</span><strong>{payGroupName || '—'}</strong></div>
                  <div class="summary-row"><span>Population</span><strong>{pop?.total != null ? `${pop.total} active` : '—'}</strong></div>
                </div>
                <div class="summary-rows">
                  <div class="summary-row"><span>Period</span><strong>{periodStart && periodEnd ? `${periodStart} → ${periodEnd}` : '—'}</strong></div>
                  <div class="summary-row"><span>Pay date</span><strong>{payDate || '—'}</strong></div>
                  <div class="summary-row"><span>Cut-off</span><strong>{cutOffDate || '—'}</strong></div>
                </div>
                <div class="summary-rows">
                  <div class="summary-row"><span>Frequency</span><strong>{PAY_FREQS.find(f => f.value === payFrequency)?.label ?? payFrequency}</strong></div>
                  <div class="summary-row"><span>Weeks</span><strong>{weeksInPeriod}</strong></div>
                  <div class="summary-row"><span>Statutory</span><strong>Auto-pinned</strong></div>
                </div>
              </div>
            </section>

            {blocker && (
              <section class="card"><div class="panel-body">
                <div class="banner danger" role="alert"><div class="b-ico">!</div><div><div class="b-title">Can’t create this run — {blocker.title}</div><div class="b-sub">{blocker.detail}</div><div class="b-sub" style={{ fontFamily: 'var(--font-mono, monospace)', marginTop: 4 }}>{blocker.code}</div></div></div>
              </div></section>
            )}

            <section class="card">
              <div class="sec-head"><div><div class="sec-title">Confirmation</div><div class="sec-sub">These attestations gate creation and are recorded in the audit history server-side.</div></div></div>
              <div class="panel-body">
                {[
                  ['The run purpose, pay group and dates are correct', 'I reviewed the scheduled calendar and expected population.'],
                  ['I understand any unresolved preflight findings', 'The draft cannot lock inputs until blocking findings are resolved.'],
                  ['Segregation of duties applies', 'A different authorized Finance Manager must approve the payroll.'],
                ].map(([t, s], i) => (
                  <label class="check-row" key={t}>
                    <input type="checkbox" checked={confirms[i]} onChange={e => { const next = [...confirms] as [boolean, boolean, boolean]; next[i] = (e.currentTarget).checked; setConfirms(next); }} />
                    <div><strong>{t}</strong><small>{s}</small></div>
                  </label>
                ))}
              </div>
            </section>
          </div>
          <aside class="pcrw-aside">
            <SummaryCard title="On creation" rows={[
              ['Status', 'Draft'],
              ['Statutory snapshot', 'Pinned'],
              ['Audit event', 'Recorded'],
              ['Next action', 'Lock Inputs'],
            ]} />
            <PendingBlock title="Financial estimate (Slice 4)" detail="Estimated gross/net/employer cost and prior-month deltas need a pre-lock preview-calc engine. Real figures are available one step later, after Calculate." />
          </aside>
        </div>
      )}

      {/* Footer */}
      <footer class="pcrw-footer">
        {step > 0 && <button type="button" class="btn" onClick={() => goToStep(step - 1)}>Back</button>}
        <div class="right">
          {!isLast
            ? <button type="button" class="btn primary" disabled={!stepValid} onClick={() => stepValid && goToStep(step + 1)}>Next: {STEPS[step + 1]?.label}</button>
            : <button type="button" class="btn primary" disabled={!canCreate || createMut.isPending} onClick={() => void create()}>{createMut.isPending ? 'Creating…' : 'Create Draft Run'}</button>}
        </div>
      </footer>
    </div>
  );
}
