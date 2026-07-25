/**
 * src/components/sections/Finance/payRunDetail/CertifySubmitModal.tsx
 *
 * The processor certification captured "at submission" (run.html control-cert row
 * "Approval certified — Certified at submission"). Opened by the workspace header's
 * Submit For Approval action. Collects the six processor attestations, calls
 * finance/payroll/runs/certify (perm finance.payroll.certify) to freeze the
 * evidence against the current calculation version, and — only on success —
 * invokes the caller's real submit (runs/submit), which the backend RPC otherwise
 * rejects with PR422 ("certify the current calculation before submission").
 *
 * The two calls stay distinct governed steps: certification is idempotent and
 * legitimately stands on its own, so if submit later fails the run is still
 * correctly certified and the user simply retries submission.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useMutation } from '@tanstack/preact-query';
import { financePayrollApi, PayrollApiError, type PayrollRun } from '@api/finance/payroll';
import { toast } from '@store';
import { Modal } from '@ui/components/Modal';

type AttestKey =
  | 'populationReconciled' | 'inputsReviewed' | 'statutoryReviewed'
  | 'variancesReviewed' | 'paymentReadinessReviewed' | 'glReadinessReviewed';

const ATTESTATIONS: { key: AttestKey; label: string; detail: string }[] = [
  { key: 'populationReconciled',     label: 'Population reconciled',        detail: 'Every eligible employee is included, and no one who should not be paid is on the run.' },
  { key: 'inputsReviewed',           label: 'Inputs reviewed',             detail: 'Earnings, deductions, overtime and time inputs are complete and correct for the period.' },
  { key: 'statutoryReviewed',        label: 'Statutory results reviewed',  detail: 'PAYE, NIS and Health Surcharge were computed against the pinned statutory version.' },
  { key: 'variancesReviewed',        label: 'Variances reviewed',          detail: 'Movements versus the prior period have been explained or are expected.' },
  { key: 'paymentReadinessReviewed', label: 'Payment readiness reviewed',  detail: 'Every payee has a valid primary bank account for disbursement.' },
  { key: 'glReadinessReviewed',      label: 'GL readiness reviewed',       detail: 'The accounting mapping is complete and the journal preview balances.' },
];

export function CertifySubmitModal({ run, canCertify, resubmit, onClose, onCertified }: {
  run: PayrollRun;
  /** actor holds finance.payroll.certify (segregation-of-duties gate) */
  canCertify: boolean;
  /** returned run → "Recertify & resubmit" wording */
  resubmit: boolean;
  onClose: () => void;
  /** certification committed — proceed to the caller's real submit */
  onCertified: () => void;
}): VNode {
  const [checked, setChecked] = useState<Record<AttestKey, boolean>>({
    populationReconciled: false, inputsReviewed: false, statutoryReviewed: false,
    variancesReviewed: false, paymentReadinessReviewed: false, glReadinessReviewed: false,
  });
  const [note, setNote] = useState('');
  const allChecked = ATTESTATIONS.every(a => checked[a.key]);

  const mut = useMutation({
    mutationFn: () => financePayrollApi.certifyRun({
      runId: run.id,
      idempotencyKey: crypto.randomUUID(),
      // All six are literally true — the button is disabled until every box is ticked.
      attestations: {
        populationReconciled: true, inputsReviewed: true, statutoryReviewed: true,
        variancesReviewed: true, paymentReadinessReviewed: true, glReadinessReviewed: true,
      },
      note: note.trim() || undefined,
    }),
    onSuccess: () => { toast('Calculation certified.'); onCertified(); },
    onError: (e) => toast(e instanceof PayrollApiError || e instanceof Error ? e.message : 'Certification failed.'),
  });

  const submit = (): void => { if (allChecked && canCertify && !mut.isPending) mut.mutate(); };
  const label = mut.isPending
    ? 'Certifying…'
    : resubmit ? 'Recertify & resubmit' : 'Certify & submit for approval';

  return (
    <Modal open title={resubmit ? 'Recertify & resubmit for approval' : 'Certify & submit for approval'}
      sub={run.runNo} icon="fa-clipboard-check" onClose={onClose}
      onSubmit={submit} submitLabel={label} submitDisabled={!allChecked || !canCertify || mut.isPending}>
      <div class="cert-modal">
        <p class="prw-hint" style={{ marginTop: 0 }}>
          You are certifying the current calculation package as processor. Every control must be
          reviewed before this run can enter approval — the certification is frozen against
          calculation version and cannot be altered afterward.
        </p>
        <div class="cert-attest">
          {ATTESTATIONS.map(a => (
            <label class="attestation" key={a.key}>
              <input type="checkbox" checked={checked[a.key]} disabled={!canCertify || mut.isPending}
                onChange={e => setChecked(c => ({ ...c, [a.key]: (e.target as HTMLInputElement).checked }))} />
              <span><strong>{a.label}</strong><small>{a.detail}</small></span>
            </label>
          ))}
        </div>
        <label class="cert-note"><span>Certification note <em>(optional)</em></span>
          <textarea rows={2} value={note} maxLength={2000}
            placeholder="e.g. Population, inputs, statutory results and variances reviewed."
            onInput={e => setNote((e.target as HTMLTextAreaElement).value)} /></label>
        {!canCertify && (
          <small class="prw-hint">You do not have the payroll certification permission (segregation of duties).</small>
        )}
      </div>
    </Modal>
  );
}
