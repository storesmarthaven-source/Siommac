/**
 * src/components/sections/Finance/payroll/setup/SodChangeWizard.tsx
 *
 * Guided change to the payroll segregation-of-duties level. Three steps, each
 * carrying information the old inline form could not show:
 *
 *   1. Choose   — every level annotated with whether the org can actually STAFF it.
 *                 An unachievable level is disabled here and refused by the server,
 *                 because approving one would strand future runs at funding (PR403).
 *   2. Impact   — the exact separations gained/lost, from server-supplied rules
 *                 (never re-derived here), plus the in-flight-run guarantee.
 *   3. Justify  — audited reason + an explicit attestation, then submit for approval.
 *
 * Submitting only OPENS a proposal: a different authorised approver still has to
 * approve it before anything changes.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import './sodChain.css';
import { Modal } from '@ui/components/Modal';
import { Button } from '@ui/components/Button';
import type { PayrollSodChainStep, PayrollSodLevelFeasibility } from '@api/finance/payroll';

const SEAT_SHORT: Record<PayrollSodChainStep['key'], string> = {
  prepare: 'Prepare', certify: 'Certify', approve: 'Approve',
  fund: 'Fund', release: 'Release',
};

const LEVEL_TITLE: Record<number, string> = { 2: '2-person', 3: '3-person', 4: '4-person' };
const LEVEL_DETAIL: Record<number, string> = {
  2: 'Whoever funds and releases must differ from the preparer.',
  3: 'Also separates the approver — the approver cannot fund or release.',
  4: 'Strictest: also separates the certifier from funding and release.',
};

type Step = 1 | 2 | 3;

export function SodChangeWizard({ activeLevel, feasibility, busy, onSubmit, onClose }: {
  activeLevel: number;
  feasibility: PayrollSodLevelFeasibility[];
  busy: boolean;
  onSubmit: (level: 2 | 3 | 4, reason: string) => void;
  onClose: () => void;
}): VNode {
  const [step, setStep] = useState<Step>(1);
  const [level, setLevel] = useState<2 | 3 | 4 | null>(null);
  const [reason, setReason] = useState('');
  const [attested, setAttested] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fitFor = (l: number): PayrollSodLevelFeasibility | undefined => feasibility.find(f => f.level === l);
  const activeSep = fitFor(activeLevel)?.separations ?? [];
  const targetSep = level ? (fitFor(level)?.separations ?? []) : [];

  // Diff the two rule sets — added/removed separations, per seat.
  const changes = targetSep.map(t => {
    const before = activeSep.find(a => a.seat === t.seat)?.mustDifferFrom ?? [];
    return {
      seat: t.seat,
      added: t.mustDifferFrom.filter(k => !before.includes(k)),
      removed: before.filter(k => !t.mustDifferFrom.includes(k)),
    };
  }).filter(c => c.added.length || c.removed.length);

  const next = (): void => {
    if (step === 1) {
      if (!level) { setErrors({ level: 'Choose the level you want.' }); return; }
      setErrors({}); setStep(2); return;
    }
    if (step === 2) { setStep(3); return; }
    const e: Record<string, string> = {};
    if (reason.trim().length < 10) e.reason = 'Give a reason of at least 10 characters (this is audited).';
    if (!attested) e.attested = 'Confirm you have reviewed the impact.';
    setErrors(e);
    if (Object.keys(e).length === 0 && level) onSubmit(level, reason.trim());
  };

  const footer = (
    <>
      {step > 1 && <Button variant="outline" onClick={() => setStep((step - 1) as Step)}>Back</Button>}
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={next} disabled={busy}>
        {step < 3 ? 'Continue' : busy ? 'Submitting…' : 'Submit for approval'}
      </Button>
    </>
  );

  return (
    <Modal open size="lg" icon="fa-shield-halved" onClose={onClose} footer={footer}
      title="Change segregation of duties"
      sub={`Step ${step} of 3 · ${step === 1 ? 'Choose the level' : step === 2 ? 'Review the impact' : 'Justify the change'}`}>
      <div class="sodw">
        <ol class="sodw-steps" aria-label="Progress">
          {['Choose', 'Impact', 'Justify'].map((label, i) => (
            <li key={label} class={i + 1 === step ? 'is-current' : i + 1 < step ? 'is-done' : ''}>
              <span>{i + 1 < step ? '✓' : i + 1}</span>{label}
            </li>
          ))}
        </ol>

        {/* ── 1. choose ── */}
        {step === 1 && (
          <div class="sodw-body">
            <p class="sodw-lead">
              How many <strong>different people</strong> must the payroll chain involve before money moves?
            </p>
            <div class="sodw-levels">
              {[2, 3, 4].map(l => {
                const fit = fitFor(l);
                const isCurrent = l === activeLevel;
                const blocked = fit ? !fit.feasible : false;
                return (
                  <label key={l}
                    class={`sodw-level${level === l ? ' is-picked' : ''}${blocked ? ' is-blocked' : ''}${isCurrent ? ' is-current' : ''}`}>
                    <input type="radio" name="sodw-level" checked={level === l}
                      disabled={isCurrent || blocked}
                      onChange={() => { setLevel(l as 2 | 3 | 4); setErrors({}); }} />
                    <span class="sodw-level-main">
                      <span class="sodw-level-title">
                        {LEVEL_TITLE[l]}{isCurrent && <em> — current</em>}
                      </span>
                      <span class="sodw-level-detail">{LEVEL_DETAIL[l]}</span>
                      {fit && (
                        <span class={`sodw-fit${fit.feasible ? '' : ' is-bad'}`}>
                          {fit.feasible
                            ? `✓ ${fit.available} different people can cover this`
                            : `⚠ Only ${fit.available} of ${fit.required} seats can be staffed by different people — `
                              + `nobody is left to ${fit.shortfallSeats.map(s => SEAT_SHORT[s].toLowerCase()).join(' or ')}`}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.level && <small class="sodw-err">{errors.level}</small>}
            <p class="sodw-hint">
              A level you cannot staff is disabled — enforcing it would stop every future run at funding.
              Grant the missing capability to another active user to unlock it.
            </p>
          </div>
        )}

        {/* ── 2. impact ── */}
        {step === 2 && level && (
          <div class="sodw-body">
            <p class="sodw-lead">
              Moving from <strong>{LEVEL_TITLE[activeLevel]}</strong> to <strong>{LEVEL_TITLE[level]}</strong>.
            </p>
            {changes.length === 0 ? (
              <p class="sodw-hint">No separation rules change.</p>
            ) : (
              <ul class="sodw-diff">
                {changes.map(c => (
                  <li key={c.seat}>
                    <strong>{SEAT_SHORT[c.seat]}</strong>
                    {c.added.map(k => (
                      <span class="sodw-chip is-add" key={`a${k}`}>+ must differ from {SEAT_SHORT[k]}</span>
                    ))}
                    {c.removed.map(k => (
                      <span class="sodw-chip is-rm" key={`r${k}`}>− no longer must differ from {SEAT_SHORT[k]}</span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <p class="sodw-note">
              <strong>Runs already in progress are unaffected.</strong> Each run keeps the level it was
              created under, so this applies only to runs created after the change is approved.
            </p>
          </div>
        )}

        {/* ── 3. justify ── */}
        {step === 3 && level && (
          <div class="sodw-body">
            <p class="sodw-lead">
              This is recorded against your name and cannot take effect until a{' '}
              <strong>different authorised approver</strong> approves it.
            </p>
            <label class="sodw-field">
              <span>Reason <em>(audited)</em></span>
              <textarea rows={3} value={reason} maxLength={2000}
                placeholder="e.g. Finance team is three people; a fourth approver is not available."
                onInput={e => setReason((e.target as HTMLTextAreaElement).value)} />
              {errors.reason && <small class="sodw-err">{errors.reason}</small>}
            </label>
            <label class="sodw-attest">
              <input type="checkbox" checked={attested}
                onChange={e => setAttested((e.target as HTMLInputElement).checked)} />
              <span>
                I have reviewed the impact of moving to <strong>{LEVEL_TITLE[level]}</strong> and confirm
                the payroll chain can still be staffed by different people.
              </span>
            </label>
            {errors.attested && <small class="sodw-err">{errors.attested}</small>}
          </div>
        )}
      </div>
    </Modal>
  );
}
