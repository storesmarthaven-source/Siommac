/**
 * src/components/sections/Finance/StatNewVersionPage.tsx
 *
 * Finance ▸ Statutory Configuration ▸ New Rate Version — FULL PAGE WIZARD.
 *
 * Design pivot (2026-07-08): replaces the old `StatNewVersionWizard` modal with the
 * full-page wizard from new-rate-version.html, in the .sfp design language. Steps:
 *   1. Metadata            — label, effective date, jurisdiction, currency, based-on
 *   2. PAYE Bands          — allowance, band-1 ceiling, band-1/2 rates (%)
 *   3. Health Surcharge    — monthly threshold, weekly high/low
 *   4. NIS Ceiling & Bands — monthly ceiling + EDITABLE bands table (real T&T model)
 *   5. Review & Submit
 *
 * The mockup's "Component Mappings" step is intentionally omitted: pay components are
 * GLOBAL in our model (not version-linked), so a per-version mapping would be a fake
 * (memory statutory-nis-model-reconciliation). NIS bands use the 5 real fields — class
 * no, weekly min/max, employee/employer weekly — NOT the mockup's percentage rates.
 *
 * Create sequence: createVersion (draft) → importNisClasses(bands). Both are wired to
 * the backbone server-side; a partial (version created, bands failed) is surfaced, not
 * swallowed.
 */

import { type VNode } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import { toast } from '@store';
import {
  useStatutoryVersions, useStatutoryMutation, financeStatutoryApi,
  type CreateStatutoryVersionArgs,
} from '@api/finance/statutory';
import { Stepper, type StepperStep } from '@ui';
import { fmtMoney, fmtDate, fmtPercent, toRoman } from './financeShared';
import {
  IconOk, IconOkBadge, IconClose, IconAlert, IconArrow, IconInfo, IconFile, IconSpark,
  TextField, MoneyField, SelectField, StatFormShell, minLenError,
} from './_shared/sfpKit';
import './statutoryForms.css';

const STEPS: StepperStep[] = [
  { key: 'meta',   label: 'Metadata',            description: 'Label, date & source' },
  { key: 'paye',   label: 'PAYE Bands',          description: 'Allowance, ceiling & rates' },
  { key: 'hs',     label: 'Health Surcharge',    description: 'Threshold & weekly rates' },
  { key: 'nis',    label: 'NIS Ceiling & Bands', description: 'Ceiling & contribution bands' },
  { key: 'review', label: 'Review & Submit',     description: 'Confirm & create the version' },
];
const n = (s: string): number => { const x = Number(s.trim()); return Number.isFinite(x) ? x : NaN; };

interface BandRow { classNo: string; weeklyMin: string; weeklyMax: string; assumedAvgWeekly: string; employeeWeekly: string; employerWeekly: string; classZWeekly: string; }
const emptyBand = (classNo: number): BandRow => ({ classNo: String(classNo), weeklyMin: '', weeklyMax: '', assumedAvgWeekly: '', employeeWeekly: '', employerWeekly: '', classZWeekly: '' });
const bandHasData = (b: BandRow): boolean => !!(b.classNo || b.weeklyMin || b.weeklyMax || b.assumedAvgWeekly || b.employeeWeekly || b.employerWeekly || b.classZWeekly);

interface Donut { percent: number; }
function ProgressDonut({ percent }: Donut): VNode {
  const r = 32, c = 2 * Math.PI * r, off = c * (1 - percent / 100);
  return (
    <svg width="86" height="86" viewBox="0 0 86 86" style={{ flex: '0 0 auto' }}>
      <circle cx="43" cy="43" r={r} fill="none" stroke="#e6eaf1" stroke-width="9" />
      <circle cx="43" cy="43" r={r} fill="none" stroke="var(--sfp-primary-600)" stroke-width="9" stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={off} transform="rotate(-90 43 43)" />
      <text x="43" y="48" text-anchor="middle" font-size="17" font-weight="700" fill="var(--sfp-ink-strong)">{percent}%</text>
    </svg>
  );
}

export function StatNewVersionPage({ onClose }: { onClose: () => void }): VNode {
  const versionsQ = useStatutoryVersions();
  const createMut = useStatutoryMutation(financeStatutoryApi.createVersion);
  const importMut = useStatutoryMutation(financeStatutoryApi.importNisClasses);
  // Bands from the "based-on" version, fetched on demand for the copy-bands action.
  const [basedOnId, setBasedOnId] = useState('');

  const [step, setStep] = useState(0);
  // Furthest step reached — any step up to here is clickable in the stepper, so
  // going Back doesn't lock the already-filled later steps (jump freely between them).
  const [maxStep, setMaxStep] = useState(0);
  useEffect(() => { setMaxStep(m => Math.max(m, step)); }, [step]);
  // Pre-filled with the CURRENT T&T statutory defaults (2026) so creating a new
  // version is "tweak the numbers", not "define a schema": PAYE allowance $90,000 /
  // 25% up to $1,000,000 / 30% above; Health Surcharge $8.25 (>$469.99/mo) & $4.80;
  // NIS max insurable $13,600/mo. Verify against the current NIBTT/BIR schedules.
  const [f, setF] = useState({
    label: '', effectiveFrom: '',
    payePersonalAllowance: '90000', payeBand1Ceiling: '1000000', payeBand1RatePct: '25', payeBand2RatePct: '30',
    hsMonthlyThreshold: '469.99', hsWeeklyHigh: '8.25', hsWeeklyLow: '4.80', nisMonthlyCeiling: '13600',
  });
  const set = <K extends keyof typeof f>(k: K) => (v: string) => setF(p => ({ ...p, [k]: v }));
  const [bands, setBands] = useState<BandRow[]>([emptyBand(1)]);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const versions = versionsQ.data ?? [];

  const copyFrom = (id: string): void => {
    setBasedOnId(id);
    const v = versions.find(x => x.id === id);
    if (!v) return;
    setF(p => ({
      ...p,
      payePersonalAllowance: String(v.payePersonalAllowance),
      payeBand1Ceiling: String(v.payeBand1Ceiling),
      payeBand1RatePct: String(+(v.payeBand1Rate * 100).toFixed(4)),
      payeBand2RatePct: String(+(v.payeBand2Rate * 100).toFixed(4)),
      hsMonthlyThreshold: String(v.hsMonthlyThreshold),
      hsWeeklyHigh: String(v.hsWeeklyHigh),
      hsWeeklyLow: String(v.hsWeeklyLow),
      nisMonthlyCeiling: v.nisMonthyCeiling != null ? String(v.nisMonthyCeiling) : '',
    }));
  };

  const copyBands = async (): Promise<void> => {
    if (!basedOnId) return;
    try {
      const rows = await financeStatutoryApi.listNisClasses({ statutoryVersionId: basedOnId });
      if (!rows.length) { toast('That version has no NIS bands to copy.'); return; }
      setBands(rows.map(r => ({
        classNo: String(r.classNo), weeklyMin: String(r.weeklyMin),
        weeklyMax: r.weeklyMax != null ? String(r.weeklyMax) : '',
        assumedAvgWeekly: r.assumedAverageWeekly != null ? String(r.assumedAverageWeekly) : '',
        employeeWeekly: String(r.employeeWeekly), employerWeekly: String(r.employerWeekly),
        classZWeekly: r.classZWeekly != null ? String(r.classZWeekly) : '',
      })));
      toast(`Copied ${rows.length} band(s).`);
    } catch (e) { toast.error((e as Error).message); }
  };

  // ── Band validation ────────────────────────────────────────────────────────
  const bandVal = useMemo(() => {
    const data = bands.map((b, i) => ({ b, i })).filter(x => bandHasData(x.b));
    const errs = new Map<number, string>();
    const seen = new Map<number, number>();
    const parsed = data.map(({ b, i }) => {
      const classNo = /^\d+$/.test(b.classNo.trim()) ? parseInt(b.classNo, 10) : NaN;
      const min = n(b.weeklyMin);
      const maxBlank = b.weeklyMax.trim() === '';
      const max = maxBlank ? null : n(b.weeklyMax);
      const emp = n(b.employeeWeekly), er = n(b.employerWeekly);
      const assumed = b.assumedAvgWeekly.trim() === '' ? null : n(b.assumedAvgWeekly);
      const classZ  = b.classZWeekly.trim() === '' ? null : n(b.classZWeekly);
      let e = '';
      if (!Number.isInteger(classNo) || classNo < 1) e = 'Class number must be a whole number ≥ 1.';
      else if (seen.has(classNo)) e = `Duplicate class number ${classNo}.`;
      else seen.set(classNo, i);
      if (!e && (isNaN(min) || min < 0)) e = 'Weekly minimum must be ≥ 0.';
      if (!e && !maxBlank && (max == null || isNaN(max))) e = 'Weekly maximum must be a number or blank.';
      if (!e && max != null && !isNaN(min) && max <= min) e = 'Weekly maximum must exceed the minimum.';
      if (!e && (isNaN(emp) || emp < 0)) e = 'Employee weekly must be ≥ 0.';
      if (!e && (isNaN(er) || er < 0)) e = 'Employer weekly must be ≥ 0.';
      if (!e && assumed != null && (isNaN(assumed) || assumed < 0)) e = 'Assumed average must be ≥ 0 or blank.';
      if (!e && classZ != null && (isNaN(classZ) || classZ < 0)) e = 'Class Z weekly must be ≥ 0 or blank.';
      if (e) errs.set(i, e);
      return { i, classNo, min, max, assumed, emp, er, classZ, ok: !e };
    });
    // overlap (warnings)
    let overlaps = 0;
    for (const a of parsed) {
      if (!a.ok) continue;
      const aMax = a.max ?? Number.POSITIVE_INFINITY;
      for (const o of parsed) {
        if (o === a || !o.ok) continue;
        const oMax = o.max ?? Number.POSITIVE_INFINITY;
        if (a.min < oMax && o.min < aMax) { overlaps++; break; }
      }
    }
    const payload = parsed.filter(p => p.ok).map(p => ({ classNo: p.classNo, weeklyMin: p.min, weeklyMax: p.max, assumedAverageWeekly: p.assumed, employeeWeekly: p.emp, employerWeekly: p.er, classZWeekly: p.classZ }));
    return { errs, count: data.length, errorCount: errs.size, overlaps, payload };
  }, [bands]);

  // ── Checklist ────────────────────────────────────────────────────────────────
  const rate1 = n(f.payeBand1RatePct), rate2 = n(f.payeBand2RatePct);
  const checks: { label: string; state: 'ok' | 'pend' | 'warn' }[] = [
    { label: 'Version label & effective date', state: f.label.trim().length >= 3 && f.effectiveFrom ? 'ok' : 'pend' },
    { label: 'PAYE allowance & band-1 ceiling', state: n(f.payePersonalAllowance) > 0 && n(f.payeBand1Ceiling) > 0 ? 'ok' : 'pend' },
    { label: 'PAYE rates within 0–100%', state: (!isNaN(rate1) && !isNaN(rate2) && rate1 >= 0 && rate1 <= 100 && rate2 >= 0 && rate2 <= 100) ? 'ok' : 'pend' },
    { label: 'Health Surcharge configured', state: n(f.hsMonthlyThreshold) > 0 && n(f.hsWeeklyHigh) >= 0 && n(f.hsWeeklyLow) >= 0 ? 'ok' : 'pend' },
    { label: 'At least one NIS band', state: bandVal.count >= 1 ? 'ok' : 'pend' },
    { label: 'NIS bands valid (no errors)', state: bandVal.count === 0 ? 'pend' : bandVal.errorCount > 0 ? 'pend' : 'ok' },
    { label: 'No overlapping bands', state: bandVal.count === 0 ? 'pend' : bandVal.overlaps > 0 ? 'warn' : 'ok' },
  ];
  const okChecks = checks.filter(c => c.state === 'ok').length;
  const percent = Math.round((okChecks / checks.length) * 100);
  const requiredOk = checks.slice(0, 6).every(c => c.state === 'ok'); // overlaps are warnings, non-blocking
  const canCreate = requiredOk && bandVal.errorCount === 0;

  // ── Create ───────────────────────────────────────────────────────────────────
  const submit = async (): Promise<void> => {
    setSubmitAttempted(true);
    if (!canCreate) return;
    const args: CreateStatutoryVersionArgs = {
      effectiveFrom: f.effectiveFrom, label: f.label.trim(), jurisdiction: 'TT', currency: 'TTD',
      payePersonalAllowance: n(f.payePersonalAllowance), payeBand1Ceiling: n(f.payeBand1Ceiling),
      payeBand1Rate: rate1 / 100, payeBand2Rate: rate2 / 100,
      hsMonthlyThreshold: n(f.hsMonthlyThreshold), hsWeeklyHigh: n(f.hsWeeklyHigh), hsWeeklyLow: n(f.hsWeeklyLow),
      nisMonthyCeiling: f.nisMonthlyCeiling.trim() === '' ? null : n(f.nisMonthlyCeiling),
    };
    try {
      const version = await createMut.mutateAsync(args);
      if (bandVal.payload.length) {
        try {
          const res = await importMut.mutateAsync({ statutoryVersionId: version.id, rows: bandVal.payload });
          if (res.errors.length) toast.error(`Version "${args.label}" created; ${res.errors.length} band(s) rejected — review in the NIS Bands tab.`);
          else toast(`Rate version "${args.label}" created as draft with ${res.imported} band(s).`);
        } catch (be) {
          toast.error(`Version "${args.label}" created, but band import failed: ${(be as Error).message}. Add bands in the NIS Bands tab.`);
        }
      } else {
        toast(`Rate version "${args.label}" created as draft.`);
      }
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  const busy = createMut.isPending || importMut.isPending;
  const setBand = (i: number, k: keyof BandRow) => (v: string) => setBands(p => p.map((b, ix) => ix === i ? { ...b, [k]: v } : b));
  const canNext = step === 0 ? !!(f.label.trim().length >= 3 && f.effectiveFrom) : true;

  return (
    <StatFormShell
      icon={<IconFile size={20} />}
      title="New Rate Version"
      sub="Create a new statutory rate version — PAYE, Health Surcharge, and the NIS contribution-band table."
      onBack={onClose}
      stepper={<Stepper steps={STEPS} activeIndex={step} onStep={setStep} reachableIndex={maxStep} ariaLabel="New rate version steps" />}
    >
          <div class="sfp-body">
            {/* Step content */}
            <div>
              {step === 0 && (
                <div class="sfp-form">
                  <TextField label="Version Label" required show={submitAttempted} value={f.label} onInput={set('label')} minLength={3}
                    error={!f.label.trim() ? 'A clear, unique label is required.' : minLenError(f.label, 3)} hint="e.g. TT 2026 Statutory" wide />
                  <div class="sfp-field">
                    <label class="sfp-lab">Effective From <span class="sfp-req">*</span> <span class="sfp-info" data-tip="The date this rate version starts applying to payroll calculations." tabIndex={0} role="img" aria-label="The date this rate version starts applying to payroll calculations."><IconInfo /></span></label>
                    <div class="sfp-ctl">
                      <input class={`sfp-inp${submitAttempted && !f.effectiveFrom ? ' is-bad' : f.effectiveFrom ? ' is-ok' : ''}`} type="date" value={f.effectiveFrom}
                        onInput={e => set('effectiveFrom')((e.currentTarget).value)} />
                    </div>
                    {submitAttempted && !f.effectiveFrom ? <span class="sfp-err-msg">Effective date is required.</span> : <span class="sfp-hint">Rates apply from this date.</span>}
                  </div>
                  <SelectField label="Jurisdiction" show={false} value="TT" onChange={() => { /* noop */ }} options={[{ value: 'TT', label: 'Trinidad & Tobago (TT)' }]} disabled />
                  <SelectField label="Currency" show={false} value="TTD" onChange={() => { /* noop */ }} options={[{ value: 'TTD', label: 'TTD' }]} disabled />
                  <SelectField label="Based On Previous Version" show={false} value={basedOnId}
                    onChange={copyFrom} hint="Optional — copy PAYE / HS / NIS-ceiling values from an existing version."
                    options={[{ value: '', label: '— None (start blank) —' }, ...versions.map(v => ({ value: v.id, label: `${v.label} (${fmtDate(v.effectiveFrom)})` }))]} />
                </div>
              )}

              {step === 1 && (
                <div class="sfp-form">
                  <MoneyField label="Personal Allowance (annual)" required show={submitAttempted} value={f.payePersonalAllowance} onInput={set('payePersonalAllowance')}
                    error={n(f.payePersonalAllowance) > 0 ? undefined : 'Required, must be greater than 0.'} hint="Annual PAYE personal allowance." />
                  <MoneyField label="Band 1 Ceiling (annual)" required show={submitAttempted} value={f.payeBand1Ceiling} onInput={set('payeBand1Ceiling')}
                    error={n(f.payeBand1Ceiling) > 0 ? undefined : 'Required, must be greater than 0.'} hint="Annual chargeable ceiling for band 1." />
                  <TextField label="Band 1 Rate (%)" required show={submitAttempted} value={f.payeBand1RatePct} onInput={set('payeBand1RatePct')}
                    error={!isNaN(rate1) && rate1 >= 0 && rate1 <= 100 ? undefined : 'Enter a percentage between 0 and 100.'} hint="e.g. 25 = 25%" />
                  <TextField label="Band 2 Rate (%)" required show={submitAttempted} value={f.payeBand2RatePct} onInput={set('payeBand2RatePct')}
                    error={!isNaN(rate2) && rate2 >= 0 && rate2 <= 100 ? undefined : 'Enter a percentage between 0 and 100.'} hint="Rate above the band-1 ceiling." />
                </div>
              )}

              {step === 2 && (
                <div class="sfp-form">
                  <MoneyField label="Monthly Threshold" required show={submitAttempted} value={f.hsMonthlyThreshold} onInput={set('hsMonthlyThreshold')}
                    error={n(f.hsMonthlyThreshold) > 0 ? undefined : 'Required, must be greater than 0.'} hint="Monthly income boundary between low & high rate." />
                  <MoneyField label="Weekly Rate — High" required show={submitAttempted} value={f.hsWeeklyHigh} onInput={set('hsWeeklyHigh')}
                    error={n(f.hsWeeklyHigh) >= 0 ? undefined : 'Required, must be ≥ 0.'} hint="Weekly HS when income is above threshold." />
                  <MoneyField label="Weekly Rate — Low" required show={submitAttempted} value={f.hsWeeklyLow} onInput={set('hsWeeklyLow')}
                    error={n(f.hsWeeklyLow) >= 0 ? undefined : 'Required, must be ≥ 0.'} hint="Weekly HS when income is at/below threshold." />
                </div>
              )}

              {step === 3 && (
                <div>
                  <div class="sfp-form" style={{ marginBottom: 18 }}>
                    <MoneyField label="NIS Monthly Ceiling" show={submitAttempted} value={f.nisMonthlyCeiling} onInput={set('nisMonthlyCeiling')}
                      hint="Optional — maximum insurable monthly earnings. Blank = no ceiling." placeholder="Optional" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 500, color: 'var(--sfp-ink-strong)' }}>NIS Contribution Bands</h3>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      {basedOnId && <button type="button" class="sfp-browse" onClick={() => void copyBands()}>Copy bands from source</button>}
                      <button type="button" class="sfp-browse" onClick={() => setBands(p => [...p, emptyBand(p.length + 1)])}>+ Add band</button>
                    </div>
                  </div>
                  <table class="sfp-vtable">
                    <thead><tr><th style={{ width: 64 }}>Class</th><th>Weekly Min</th><th>Weekly Max</th><th>Assumed Avg</th><th>Employee /wk</th><th>Employer /wk</th><th>Class Z /wk</th><th style={{ width: 44 }} /></tr></thead>
                    <tbody>
                      {bands.map((b, i) => {
                        const e = bandVal.errs.get(i);
                        const badCls = submitAttempted && e ? ' bad' : '';
                        const roman = /^\d+$/.test(b.classNo.trim()) ? toRoman(parseInt(b.classNo, 10)) : '';
                        return (
                          <tr key={i}>
                            <td><input class={`sfp-cellinp${badCls}`} type="number" title={roman ? `Class ${roman}` : undefined} value={b.classNo} onInput={e2 => setBand(i, 'classNo')((e2.currentTarget).value)} /></td>
                            <td><input class={`sfp-cellinp${badCls}`} type="number" step="0.01" value={b.weeklyMin} onInput={e2 => setBand(i, 'weeklyMin')((e2.currentTarget).value)} /></td>
                            <td><input class={`sfp-cellinp${badCls}`} type="number" step="0.01" placeholder="∞" value={b.weeklyMax} onInput={e2 => setBand(i, 'weeklyMax')((e2.currentTarget).value)} /></td>
                            <td><input class={`sfp-cellinp${badCls}`} type="number" step="0.01" value={b.assumedAvgWeekly} onInput={e2 => setBand(i, 'assumedAvgWeekly')((e2.currentTarget).value)} /></td>
                            <td><input class={`sfp-cellinp${badCls}`} type="number" step="0.01" value={b.employeeWeekly} onInput={e2 => setBand(i, 'employeeWeekly')((e2.currentTarget).value)} /></td>
                            <td><input class={`sfp-cellinp${badCls}`} type="number" step="0.01" value={b.employerWeekly} onInput={e2 => setBand(i, 'employerWeekly')((e2.currentTarget).value)} /></td>
                            <td><input class={`sfp-cellinp${badCls}`} type="number" step="0.01" value={b.classZWeekly} onInput={e2 => setBand(i, 'classZWeekly')((e2.currentTarget).value)} /></td>
                            <td><button type="button" class="sfp-iconbtn del" disabled={bands.length === 1} aria-label="Remove band" onClick={() => setBands(p => p.filter((_, ix) => ix !== i))}><IconClose size={15} /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {submitAttempted && bandVal.errorCount > 0 && <p class="sfp-err-msg" style={{ marginTop: 8 }}>{bandVal.errorCount} band row(s) have errors — fix the highlighted cells.</p>}
                  <p class="sfp-hint" style={{ marginTop: 8 }}>Weekly amounts are fixed T&T NIS contributions (not percentages). Leave the top band’s Weekly Max blank for an open-ended band.</p>
                </div>
              )}

              {step === 4 && (
                <div>
                  <div class="sfp-scard">
                    <h3 class="sub">Review</h3>
                    <div class="sfp-mrow"><span class="k">Label</span><span class="v">{f.label || '—'}</span></div>
                    <div class="sfp-mrow"><span class="k">Effective from</span><span class="v">{f.effectiveFrom ? fmtDate(f.effectiveFrom) : '—'}</span></div>
                    <div class="sfp-mrow"><span class="k">Jurisdiction / currency</span><span class="v">TT · TTD</span></div>
                    <div class="sfp-mrow"><span class="k">PAYE allowance / band-1 ceiling</span><span class="v">{fmtMoney(n(f.payePersonalAllowance))} · {fmtMoney(n(f.payeBand1Ceiling))}</span></div>
                    <div class="sfp-mrow"><span class="k">PAYE rates (band 1 / 2)</span><span class="v">{fmtPercent(rate1 / 100)} / {fmtPercent(rate2 / 100)}</span></div>
                    <div class="sfp-mrow"><span class="k">Health Surcharge (threshold · high / low)</span><span class="v">{fmtMoney(n(f.hsMonthlyThreshold))} · {fmtMoney(n(f.hsWeeklyHigh))} / {fmtMoney(n(f.hsWeeklyLow))}</span></div>
                    <div class="sfp-mrow"><span class="k">NIS monthly ceiling</span><span class="v">{f.nisMonthlyCeiling.trim() ? fmtMoney(n(f.nisMonthlyCeiling)) : 'None'}</span></div>
                    <div class="sfp-mrow"><span class="k">NIS bands</span><span class="v">{bandVal.payload.length}{bandVal.overlaps > 0 ? ` · ${bandVal.overlaps} overlap warning(s)` : ''}</span></div>
                  </div>
                  <p class="sfp-hint" style={{ marginTop: 12 }}>The version is created as <b>Draft</b>. Submit it for approval afterwards; a different finance manager must approve before it can be activated.</p>
                </div>
              )}
            </div>

            {/* Rail: progress + validation checklist */}
            <div class="sfp-aside">
              <div class="sfp-panel sfp-panel-ring">
                <div class="sfp-panel-head"><span class="ic"><IconSpark /></span>Configuration Progress</div>
                <div class="sfp-donut-wrap" style={{ marginTop: 8 }}>
                  <ProgressDonut percent={percent} />
                  <div class="sfp-donut-txt"><div class="big">{okChecks} of {checks.length} checks</div><div class="sm">{percent === 100 ? 'Ready to create' : 'In progress'}</div></div>
                </div>
              </div>
              <div class="sfp-panel">
                <div class="sfp-panel-head"><span class="ic"><IconOk size={16} /></span>Validation Checklist</div>
                {checks.map(c => (
                  <div class="sfp-check" key={c.label}>
                    <span key={c.state} class={`ci ${c.state}`}>{c.state === 'warn' ? <IconAlert size={12} /> : <IconOk size={13} />}</span>
                    <span class="ct">{c.label}</span>
                    <span class={`cv ${c.state}`}>{c.state === 'ok' ? 'Valid' : c.state === 'warn' ? 'Review' : 'Pending'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div class="sfp-footer">
            {step > 0 && <button type="button" class="sfp-btn sfp-btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>}
            <div class="right">
              <button type="button" class="sfp-btn sfp-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
              {step < STEPS.length - 1
                ? <button type="button" class="sfp-btn sfp-btn-primary" onClick={() => setStep(step + 1)} disabled={!canNext}>Continue<IconArrow /></button>
                : <button type="button" class="sfp-btn sfp-btn-primary" onClick={() => void submit()} disabled={busy || (submitAttempted && !canCreate)}>{busy ? <span class="sfp-spin" /> : <IconOkBadge />}Create version</button>}
            </div>
          </div>
    </StatFormShell>
  );
}
