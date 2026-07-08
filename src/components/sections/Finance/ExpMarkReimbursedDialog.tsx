/**
 * src/components/sections/Finance/ExpMarkReimbursedDialog.tsx
 *
 * "Mark Reimbursed" dialog — captures full payment details before transitioning
 * an approved expense claim to the reimbursed state.
 *
 * Fields: payment method picker, reference, date, paid amount, source disbursement,
 * notes. All wired to the extended mark-reimbursed backend endpoint.
 *
 * Usage:
 *   <ExpMarkReimbursedDialog
 *     claim={selectedClaim}
 *     open={dialogOpen}
 *     onClose={() => setDialogOpen(false)}
 *     onSuccess={() => { ... }}
 *   />
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { toast } from '@store';
import { financeExpensesApi, useExpenseMutation, type ExpenseClaim } from '@api/finance/expenses';
import { fmtMoney } from './financeShared';

const PAYMENT_METHODS = [
  { value: 'eft',    label: 'Electronic Funds Transfer (EFT)' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash',   label: 'Cash' },
  { value: 'wire',   label: 'Wire Transfer' },
  { value: 'other',  label: 'Other' },
] as const;

type PaymentMethod = 'eft' | 'cheque' | 'cash' | 'wire' | 'other';

interface FieldErrors {
  paymentMethod?: string;
  reference?: string;
  reimbursedAt?: string;
  paidAmount?: string;
}

function validate(f: {
  paymentMethod: string;
  reference: string;
  reimbursedAt: string;
  paidAmount: string;
  claimTotal: number;
}): FieldErrors {
  const errs: FieldErrors = {};
  if (!f.paymentMethod) errs.paymentMethod = 'Payment method is required.';
  if (!f.reimbursedAt)  errs.reimbursedAt  = 'Payment date is required.';
  const amt = parseFloat(f.paidAmount);
  if (f.paidAmount && (Number.isNaN(amt) || amt <= 0)) {
    errs.paidAmount = 'Enter a valid positive amount.';
  }
  return errs;
}

export interface ExpMarkReimbursedDialogProps {
  claim:     ExpenseClaim | null;
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
}

export function ExpMarkReimbursedDialog({
  claim,
  open,
  onClose,
  onSuccess,
}: ExpMarkReimbursedDialogProps): VNode {
  const today = new Date().toISOString().slice(0, 10);

  const [paymentMethod,      setPaymentMethod]      = useState<PaymentMethod | ''>('');
  const [reference,          setReference]          = useState('');
  const [reimbursedAt,       setReimbursedAt]       = useState(today);
  const [paidAmount,         setPaidAmount]         = useState('');
  const [sourceDisbursement, setSourceDisbursement] = useState('');
  const [notes,              setNotes]              = useState('');
  const [errors,             setErrors]             = useState<FieldErrors>({});

  const markReimbursed = useExpenseMutation((args: Parameters<typeof financeExpensesApi.markReimbursed>[0]) =>
    financeExpensesApi.markReimbursed(args),
  );

  // Reset form when dialog opens / claim changes
  useEffect(() => {
    if (open) {
      setPaymentMethod('');
      setReference('');
      setReimbursedAt(today);
      setPaidAmount(claim ? String(claim.totalAmount) : '');
      setSourceDisbursement('');
      setNotes('');
      setErrors({});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, claim?.id]);

  if (!open || !claim) return <></>;

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const errs = validate({
      paymentMethod,
      reference,
      reimbursedAt,
      paidAmount,
      claimTotal: claim!.totalAmount,
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    try {
      await markReimbursed.mutateAsync({
        id:                claim!.id,
        reimbursedAt:      reimbursedAt || undefined,
        paymentMethod:     (paymentMethod as PaymentMethod) || undefined,
        reference:         reference.trim() || undefined,
        paidAmount:        paidAmount ? parseFloat(paidAmount) : undefined,
        sourceDisbursement: sourceDisbursement.trim() || undefined,
        notes:             notes.trim() || undefined,
      });
      toast.success('Claim marked reimbursed.');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error((err as Error).message ?? 'Failed to mark reimbursed.');
    }
  }

  const busy = markReimbursed.isPending;

  return (
    <div
      class="hrfin-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Mark Reimbursed"
      onClick={e => { if ((e.target as HTMLElement).classList.contains('hrfin-dialog-backdrop')) onClose(); }}
    >
      <div class="hrfin-dialog">
        <div class="hrfin-dialog-head">
          <h2>Mark Reimbursed</h2>
          <button type="button" class="hrfin-dialog-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div class="hrfin-dialog-meta">
          <span><b>{claim.claimNo}</b></span>
          <span class="hse-muted">{claim.title}</span>
          <span>Total: <b>{fmtMoney(claim.totalAmount)}</b></span>
        </div>

        <form onSubmit={handleSubmit} noValidate class="hrfin-dialog-body">

          {/* Payment method */}
          <div class={`hrfin-field${errors.paymentMethod ? ' has-error' : ''}`}>
            <label htmlFor="exp-pay-method">Payment method <span class="hrfin-req">*</span></label>
            <select
              id="exp-pay-method"
              class="hrfin-input"
              value={paymentMethod}
              onChange={e => { setPaymentMethod((e.target as HTMLSelectElement).value as PaymentMethod); setErrors(x => ({ ...x, paymentMethod: undefined })); }}
              required
              disabled={busy}
            >
              <option value="">Select method…</option>
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {errors.paymentMethod && <span class="hrfin-error">{errors.paymentMethod}</span>}
          </div>

          {/* Reference */}
          <div class="hrfin-field">
            <label htmlFor="exp-pay-ref">Payment reference</label>
            <input
              id="exp-pay-ref"
              type="text"
              class="hrfin-input"
              placeholder="Cheque no., EFT ref, etc."
              value={reference}
              onInput={e => setReference((e.target as HTMLInputElement).value)}
              disabled={busy}
            />
          </div>

          {/* Date */}
          <div class={`hrfin-field${errors.reimbursedAt ? ' has-error' : ''}`}>
            <label htmlFor="exp-pay-date">Payment date <span class="hrfin-req">*</span></label>
            <input
              id="exp-pay-date"
              type="date"
              class="hrfin-input"
              value={reimbursedAt}
              max={today}
              onInput={e => { setReimbursedAt((e.target as HTMLInputElement).value); setErrors(x => ({ ...x, reimbursedAt: undefined })); }}
              required
              disabled={busy}
            />
            {errors.reimbursedAt && <span class="hrfin-error">{errors.reimbursedAt}</span>}
          </div>

          {/* Paid amount */}
          <div class={`hrfin-field${errors.paidAmount ? ' has-error' : ''}`}>
            <label htmlFor="exp-pay-amt">Amount paid</label>
            <input
              id="exp-pay-amt"
              type="number"
              class="hrfin-input"
              min="0.01"
              step="0.01"
              placeholder={String(claim.totalAmount)}
              value={paidAmount}
              onInput={e => { setPaidAmount((e.target as HTMLInputElement).value); setErrors(x => ({ ...x, paidAmount: undefined })); }}
              disabled={busy}
            />
            {errors.paidAmount && <span class="hrfin-error">{errors.paidAmount}</span>}
          </div>

          {/* Source disbursement */}
          <div class="hrfin-field">
            <label htmlFor="exp-pay-disb">Source disbursement ID</label>
            <input
              id="exp-pay-disb"
              type="text"
              class="hrfin-input"
              placeholder="Linked payroll disbursement ID (optional)"
              value={sourceDisbursement}
              onInput={e => setSourceDisbursement((e.target as HTMLInputElement).value)}
              disabled={busy}
            />
          </div>

          {/* Notes */}
          <div class="hrfin-field">
            <label htmlFor="exp-pay-notes">Notes</label>
            <textarea
              id="exp-pay-notes"
              class="hrfin-input"
              rows={3}
              placeholder="Additional payment notes…"
              value={notes}
              onInput={e => setNotes((e.target as HTMLTextAreaElement).value)}
              disabled={busy}
            />
          </div>

          <div class="hrfin-dialog-foot">
            <button type="button" class="hrfin-action" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" class="hrfin-action is-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Mark reimbursed'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
