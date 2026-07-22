/**
 * src/components/sections/Finance/payRunDetail/CloseReleaseCard.tsx
 *
 * F-08 Close & Release — the governed close-out surface inside the Run Workspace's
 * Release & Accounting tab (faithful to mockups/payroll-enterprise/close-run.html,
 * scoped `.prw`). Wired to the real releases/* backend:
 *   · confirm-funding  → releases/confirm-funding (finance.payroll.funding.approve)
 *   · issue certificate → releases/release (finance.payroll.release) — attestation-gated
 *   · issued cert       → releases/get-certificate (view_all)
 * The Close & Lock (approved→locked) action stays in the workspace header (onLockRun).
 * No sensitive value takes effect without: all preflight controls green + the close
 * owner's explicit attestation + the segregated `finance.payroll.release` permission.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useMutation, useQueryClient } from '@tanstack/preact-query';
import { financePayrollApi, useReleaseCertificate, type PayrollRun, type PayrollReleasePreflight } from '@api/finance/payroll';
import { can } from '@lib/permissions';
import { toast } from '@store';
import { fmtMoney } from '../financeShared';
import { EmployeeCell } from '../_shared/EmployeeCell';
import { Modal } from '@ui/components/Modal';

const RELEASED = new Set(['released', 'exported']);

export function CloseReleaseCard({ run, preflight }: {
  run: PayrollRun; preflight: PayrollReleasePreflight | undefined;
}): VNode {
  const qc = useQueryClient();
  const released = RELEASED.has(run.status) || (preflight?.alreadyReleased ?? false);
  const locked = run.status === 'locked' || released;
  const pf = preflight;

  const certQ = useReleaseCertificate(run.id, { enabled: released });
  const cert = certQ.data;

  const [attested, setAttested] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['finance', 'payroll'] });
  };
  const releaseMut = useMutation({
    mutationFn: () => financePayrollApi.releaseRun({ runId: run.id, idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => { invalidate(); toast('Release certificate issued.'); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Release failed.'),
  });

  // Governance controls, derived from the real preflight (no fabricated statuses).
  const controls = pf ? [
    { ok: pf.certificationId != null, warn: false, title: 'Approval package complete',
      detail: 'Maker-checker and threshold decisions recorded against the approved calculation version.' },
    { ok: pf.fundingConfirmationId != null, warn: (pf.missingBankAccountCount) > 0, title: 'Funding evidence confirmed',
      detail: `Net disbursement ${fmtMoney(pf.netPayroll)} confirmed against the payroll account.` },
    { ok: pf.invalidNisPeriodCount === 0, warn: false, title: 'Employee & statutory totals reconciled',
      detail: 'PAYE, NIS and Health Surcharge agree from employee line to authority totals.' },
    { ok: pf.glJournalId != null && pf.invalidGlAccountCount === 0, warn: (pf.invalidGlAccountCount) > 0, title: 'Accounting preview balanced',
      detail: `Debit ${fmtMoney(pf.glDebit)} / credit ${fmtMoney(pf.glCredit)} across approved accounts and dimensions.` },
  ] : [];

  const canRelease = can('finance.payroll.release');
  const canFund = can('finance.payroll.funding.approve');
  const readyToIssue = !released && run.status === 'locked' && (pf?.ready ?? false) && canRelease;

  return (
    <div class="stack">
      {/* ── Close controls ── */}
      <section class="card">
        <div class="sec-head">
          <div class="sec-ico">✓</div>
          <div><div class="sec-title">Close controls</div><div class="sec-sub">Every control must pass before the release certificate can be issued.</div></div>
          <div class="aux"><span class={`pill ${pf?.ready ? 'green' : 'amber'}`}>{controls.filter(c => c.ok).length}/{controls.length} passed</span></div>
        </div>
        <div class="panel-body">
          {pf ? controls.map(c => (
            <div class="close-control" key={c.title}>
              <span class={`control-state${c.ok ? '' : c.warn ? ' warn' : ' pend'}`}>{c.ok ? '✓' : '!'}</span>
              <div><strong>{c.title}</strong><small>{c.detail}</small></div>
              <span class={`pill ${c.ok ? 'green' : c.warn ? 'red' : 'amber'}`}>{c.ok ? 'Passed' : c.warn ? 'Blocked' : 'Pending'}</span>
            </div>
          )) : <div class="prw-empty">Awaiting the approved, locked calculation version.</div>}

          {!released && locked && pf?.fundingConfirmationId == null && canFund && (
            <div class="close-control">
              <span class="control-state warn">!</span>
              <div><strong>Funding confirmation required</strong><small>Record the confirmed payroll funding before release.</small></div>
              <button type="button" class="btn sm primary" onClick={() => setFundingOpen(true)}>Confirm funding</button>
            </div>
          )}
        </div>
      </section>

      {/* ── Release certificate ── */}
      <section class="card">
        <div class="sec-head">
          <div><div class="sec-title">Payroll release certificate</div><div class="sec-sub">Issued only after every control passes and the close owner attests.</div></div>
          <span class={`pill ${released ? 'green' : 'grey'}`}>{released ? 'Issued' : 'Draft'}</span>
        </div>
        <div class="panel-body">
          <div class="certificate">
            <div class="summary-row"><span>Run</span><strong>{run.runNo}</strong></div>
            <div class="summary-row"><span>Net control total</span><strong>{fmtMoney(pf?.netPayroll ?? run.netTotal)}</strong></div>
            <div class="summary-row"><span>Employees</span><strong>{pf?.employeeCount ?? run.employeeCount}</strong></div>
            {cert ? (
              <>
                <div class="summary-row"><span>Manifest checksum</span><strong>{cert.checksum.slice(0, 12)}…</strong></div>
                <div class="summary-row"><span>Released by</span><strong><EmployeeCell employeeId={cert.releasedBy} /></strong></div>
                <div class="summary-row"><span>Released at</span><strong>{new Date(cert.releasedAt).toLocaleString('en-GB')}</strong></div>
                {cert.remittances && cert.remittances.length > 0 && (
                  <div class="summary-row"><span>Statutory drafts</span><strong>{cert.remittances.map(r => r.authority).join(', ')}</strong></div>
                )}
              </>
            ) : (
              <div class="summary-row"><span>Status</span><strong>{readyToIssue ? 'Ready to issue' : 'Locked until controls pass'}</strong></div>
            )}
          </div>

          {!released && (
            <>
              <label class="attestation">
                <input type="checkbox" checked={attested} disabled={!readyToIssue}
                  onChange={e => setAttested((e.target as HTMLInputElement).checked)} />
                <span>I confirm the approved calculation version, control totals and downstream handoff population are complete and correct.</span>
              </label>
              <div class="close-actions">
                <button type="button" class="btn primary" disabled={!readyToIssue || !attested || releaseMut.isPending}
                  onClick={() => releaseMut.mutate()}>
                  <i class="fa-solid fa-certificate" /> {releaseMut.isPending ? 'Issuing…' : 'Issue release certificate'}
                </button>
              </div>
              {!canRelease && <small class="prw-hint">You do not have the payroll release permission (segregation of duties).</small>}
              {!readyToIssue && canRelease && run.status === 'locked' && pf && !pf.ready && (
                <small class="prw-hint">Resolve the outstanding close controls above to enable release.</small>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Correction boundary (governance guidance) ── */}
      <section class="card">
        <div class="sec-head"><div class="sec-title">Correction boundary</div></div>
        <div class="panel-body correction-grid">
          <div class="summary-block"><span>Before lock</span><strong>Return to processor</strong><small>Approval is reopened and a new calculation version is required.</small></div>
          <div class="summary-block"><span>After lock</span><strong>Controlled reopen with reason</strong><small>Allowed only before an irreversible export or downstream settlement.</small></div>
          <div class="summary-block"><span>After release</span><strong>New correction run</strong><small>Never edit the released run or replace its evidence.</small></div>
        </div>
      </section>

      {fundingOpen && <ConfirmFundingModal run={run} defaultAmount={pf?.netPayroll ?? run.netTotal} onClose={() => setFundingOpen(false)} onDone={() => { invalidate(); setFundingOpen(false); }} />}
    </div>
  );
}

function ConfirmFundingModal({ run, defaultAmount, onClose, onDone }: {
  run: PayrollRun; defaultAmount: number; onClose: () => void; onDone: () => void;
}): VNode {
  const [amount, setAmount] = useState(String(Math.round(defaultAmount * 100) / 100));
  const [reference, setReference] = useState('');
  const [account, setAccount] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});

  const mut = useMutation({
    mutationFn: () => financePayrollApi.confirmFunding({
      runId: run.id, idempotencyKey: crypto.randomUUID(),
      confirmedAmount: Number(amount), confirmationReference: reference.trim(),
      accountReference: account.trim() || undefined, note: note.trim() || undefined,
    }),
    onSuccess: () => { toast('Payroll funding confirmed.'); onDone(); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Funding confirmation failed.'),
  });

  const submit = (): void => {
    const e: Record<string, string> = {};
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) e.amount = 'Enter a valid confirmed amount.';
    if (reference.trim().length < 1) e.reference = 'A confirmation reference is required.';
    setErr(e);
    if (Object.keys(e).length === 0) mut.mutate();
  };

  return (
    <Modal open title="Confirm payroll funding" sub={run.runNo} icon="fa-solid fa-building-columns"
      onClose={onClose} onSubmit={submit} submitLabel="Confirm funding" submitDisabled={mut.isPending}>
      <div class="pxq-form">
        <label class="pxq-field"><span>Confirmed amount (TTD)</span>
          <input type="number" min={0} step="0.01" value={amount} onInput={e => setAmount((e.target as HTMLInputElement).value)} />
          {err.amount && <small class="pxq-err">{err.amount}</small>}</label>
        <label class="pxq-field"><span>Confirmation reference</span>
          <input type="text" value={reference} maxLength={200} placeholder="e.g. bank evidence FND-0730-18"
            onInput={e => setReference((e.target as HTMLInputElement).value)} />
          {err.reference && <small class="pxq-err">{err.reference}</small>}</label>
        <label class="pxq-field"><span>Account reference <em>(optional)</em></span>
          <input type="text" value={account} maxLength={100} onInput={e => setAccount((e.target as HTMLInputElement).value)} /></label>
        <label class="pxq-field"><span>Note <em>(optional)</em></span>
          <textarea rows={3} value={note} maxLength={2000} onInput={e => setNote((e.target as HTMLTextAreaElement).value)} /></label>
      </div>
    </Modal>
  );
}
