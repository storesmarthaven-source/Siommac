/**
 * src/components/sections/HR/OnboardingWizard.tsx
 *
 * HR ▸ Employee Master — Start Onboarding wizard (v36 §10), wired to the EXISTING
 * backend (routes/hrOnboarding.ts) via src/api/hr/onboarding.ts. No new backend.
 * Steps: Worker → Package → Plan (preview) → Options → Review & Start. Only fields
 * the `start` endpoint accepts are collected (employeeId, packageKey, ownerId, dueAt);
 * the task plan + handoffs are a read-only preview, not fabricated inputs.
 *
 * Optionally pre-targets an employee (from the profile drawer) via `employeeId`.
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { hrOnboardingApi, ONBOARDING_PACKAGES, type OnboardingPreview } from '@api/hr/onboarding';
import { useHrEmployees } from '@api/hr/employees';
import { hrEmployeeKeys } from '@api/queryKeys';
import { rowName } from './shared';

const STEPS = [
  { label: 'Worker',  sub: 'Who is onboarding', icon: 'fa-user' },
  { label: 'Package', sub: 'Onboarding plan',   icon: 'fa-box-open' },
  { label: 'Plan',    sub: 'Tasks & handoffs',  icon: 'fa-list-check' },
  { label: 'Options', sub: 'Owner & due date',  icon: 'fa-sliders' },
  { label: 'Review',  sub: 'Confirm & start',   icon: 'fa-circle-check' },
];
const cap = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function OnboardingWizard(
  { onClose, onToast, employeeId: preset }:
  { onClose: () => void; onToast: (m: string) => void; employeeId?: string | null },
): VNode {
  const qc = useQueryClient();
  const empQ = useHrEmployees({ limit: 500 });
  const employees = useMemo(() => (empQ.data ?? []).map(r => ({ id: r.id, name: rowName(r) })), [empQ.data]);

  const [step, setStep] = useState(preset ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState(preset ?? '');
  const [packageKey, setPackageKey] = useState('standard_employee');
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [ownerId, setOwnerId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [done, setDone] = useState<{ caseNo: string; taskCount: number } | null>(null);

  async function guard(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); } finally { setBusy(false); }
  }

  function toPlan() {
    if (!employeeId) { setError('Select the employee to onboard.'); return; }
    void guard(async () => { const p = await hrOnboardingApi.preview({ packageKey }); setPreview(p); setStep(2); });
  }
  function start() {
    void guard(async () => {
      const r = await hrOnboardingApi.start({ employeeId, packageKey, ownerId: ownerId || null, dueAt: dueAt || null });
      setDone({ caseNo: r.caseNo, taskCount: r.taskCount });
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.all });
      onToast(`Onboarding started — ${r.caseNo} (${r.taskCount} tasks)`);
    });
  }

  const empName = employees.find(e => e.id === employeeId)?.name ?? '—';

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal lg employee-wizard-modal" onClick={e => e.stopPropagation()}>
        <div class="modal-head"><h3>Start Onboarding</h3><button class="modal-close" type="button" onClick={onClose} aria-label="Close">×</button></div>
        <div class="modal-body wizard-body">
          <div class="wizard-shell">
            <aside class="wizard-rail">
              <div class="wizard-rail-head"><span class="wizard-head-dot" /><div><strong>Onboarding</strong><span>{empName !== '—' ? empName : 'New hire setup'}</span></div></div>
              <div class="wizard-rail-menu">
                {STEPS.map((s, i) => (
                  <button type="button" class={`wizard-step ${step === i ? 'active' : ''}`} disabled={i > step && !done} onClick={() => (i <= step) && setStep(i)}>
                    <span class="wizard-step-ico"><i class={`fas ${s.icon}`} /></span><div><strong>{s.label}</strong><span>{s.sub}</span></div>
                  </button>
                ))}
              </div>
            </aside>

            <div class="wizard-content">
              {error && <div class="warning-card">{error}</div>}

              {step === 0 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>1. Worker</h4><p>Select the employee to onboard.</p></div></div>
                  <div class="form-grid">
                    <div class="form-field full"><label>Employee</label>
                      <select value={employeeId} onChange={e => setEmployeeId(e.currentTarget.value)}>
                        <option value="">Select employee…</option>
                        {employees.map(e => <option value={e.id}>{e.name}</option>)}
                      </select>
                    </div>
                  </div>
                </section>
              )}

              {step === 1 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>2. Package</h4><p>Pick the onboarding plan. The task set + handoffs preview on the next step.</p></div></div>
                  <div class="form-grid">
                    <div class="form-field full"><label>Onboarding package</label>
                      <select value={packageKey} onChange={e => setPackageKey(e.currentTarget.value)}>
                        {ONBOARDING_PACKAGES.map(p => <option value={p.key}>{p.label}</option>)}
                      </select>
                    </div>
                  </div>
                </section>
              )}

              {step === 2 && preview && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>3. Task Plan &amp; Handoffs</h4><p>{preview.label} — {preview.taskCount} tasks. Created when you start onboarding.</p></div></div>
                  <table class="mini-table"><thead><tr><th>Task</th><th>Owner</th><th>Module</th></tr></thead><tbody>
                    {preview.tasks.map(t => <tr><td>{t.taskTitle}</td><td>{cap(t.ownerRole)}</td><td>{t.moduleKey ? cap(t.moduleKey) : 'HR'}</td></tr>)}
                  </tbody></table>
                  {preview.handoffs.length > 0 && <>
                    <div class="form-section-head" style={{ marginTop: '6px' }}><div><h4 style={{ fontSize: '13px' }}>Cross-module handoffs</h4></div></div>
                    <table class="mini-table"><thead><tr><th>Target module</th><th>Handoff</th></tr></thead><tbody>
                      {preview.handoffs.map(h => <tr><td>{cap(h.targetModule)}</td><td>{cap(h.handoffType)}</td></tr>)}
                    </tbody></table>
                  </>}
                  <div class="info-strip">Handoffs are recorded as intents + emit events; delivery to HSE/Training/Payroll is a later phase.</div>
                </section>
              )}

              {step === 3 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>4. Options</h4><p>Case owner and target due date (optional).</p></div></div>
                  <div class="form-grid">
                    <div class="form-field"><label>Case Owner</label>
                      <select value={ownerId} onChange={e => setOwnerId(e.currentTarget.value)}>
                        <option value="">Me (default)</option>
                        {employees.map(e => <option value={e.id}>{e.name}</option>)}
                      </select>
                    </div>
                    <div class="form-field"><label>Due Date</label><input type="date" value={dueAt} onInput={e => setDueAt(e.currentTarget.value)} /></div>
                  </div>
                </section>
              )}

              {step === 4 && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>5. Review &amp; Start</h4><p>Creates the onboarding case, its tasks, and the handoff intents.</p></div></div>
                  {done
                    ? <div class="summary-list">
                        <div class="summary-item"><span>Case</span><strong>{done.caseNo}</strong></div>
                        <div class="summary-item"><span>Tasks created</span><strong>{done.taskCount}</strong></div>
                      </div>
                    : <div class="summary-list">
                        <div class="summary-item"><span>Employee</span><strong>{empName}</strong></div>
                        <div class="summary-item"><span>Package</span><strong>{preview?.label ?? cap(packageKey)}</strong></div>
                        <div class="summary-item"><span>Tasks</span><strong>{preview?.taskCount ?? '—'}</strong></div>
                        <div class="summary-item"><span>Owner</span><strong>{ownerId ? (employees.find(e => e.id === ownerId)?.name ?? '—') : 'Me'}</strong></div>
                        <div class="summary-item"><span>Due</span><strong>{dueAt || '—'}</strong></div>
                      </div>}
                </section>
              )}
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <span class="left-note">{`Step ${step + 1} of ${STEPS.length}`}</span>
          {step > 0 && !done && <button class="secondary-btn" type="button" onClick={() => setStep(step - 1)}>Back</button>}
          {step === 0 && <button class="primary-btn" type="button" onClick={() => employeeId ? setStep(1) : setError('Select the employee to onboard.')}>Next</button>}
          {step === 1 && <button class="primary-btn" type="button" disabled={busy} onClick={toPlan}>{busy ? 'Loading…' : 'Preview Plan'}</button>}
          {step === 2 && <button class="primary-btn" type="button" onClick={() => setStep(3)}>Continue</button>}
          {step === 3 && <button class="primary-btn" type="button" onClick={() => setStep(4)}>Review</button>}
          {step === 4 && (done
            ? <button class="primary-btn" type="button" onClick={onClose}>Done</button>
            : <button class="primary-btn" type="button" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start Onboarding'}</button>)}
        </div>
      </div>
    </div>
  );
}
