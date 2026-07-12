/**
 * src/components/sections/Finance/ApRecordPaymentDialog.tsx
 *
 * Full record-payment dialog for AP bills.
 *
 * Shows bill context → balance preview (total / paid / this-payment / after / status)
 * → method, date, reference (required for EFT/ACH/Wire), memo.
 *
 * Replaces the thin HrfinWizardModal inline form in PayablesOverview.
 */

import { type VNode } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { toast } from '@store';
import { HrfinWizardModal, HrfinPill, HrfinIcon, type HrfinTone } from '@ui';
import { useRecordPayment, type ApBill, type ApPaymentMethod } from '@api/finance/accountsPayable';
import { money } from './hrfinFormat';

// ── Constants ─────────────────────────────────────────────────────────────────

const METHODS: { value: ApPaymentMethod; label: string }[] = [
  { value: 'eft',    label: 'EFT / Bank transfer' },
  { value: 'ach',    label: 'ACH' },
  { value: 'wire',   label: 'Wire transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash',   label: 'Cash' },
  { value: 'card',   label: 'Card' },
];

/** Methods that require a payment reference. */
const REQUIRES_REFERENCE: ApPaymentMethod[] = ['eft', 'ach', 'wire'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function resultingStatus(bill: ApBill, thisPayment: number): { status: string; tone: HrfinTone } {
  const remaining = bill.balance - thisPayment;
  if (remaining <= 0.005) return { status: 'Paid', tone: 'ok' };
  if (thisPayment > 0) return { status: 'Partially paid', tone: 'nu' };
  return { status: 'Approved', tone: 'wn' };
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

// ── Form state ─────────────────────────────────────────────────────────────────

interface PayForm {
  amount: string;
  method: ApPaymentMethod;
  paymentDate: string;
  reference: string;
  memo: string;
}

type FieldErrors = Record<string, string | undefined>;

// ── Component ─────────────────────────────────────────────────────────────────

export interface ApRecordPaymentDialogProps {
  open: boolean;
  bill: ApBill | null;
  onClose: () => void;
  onPaid?: (updatedBill: ApBill) => void;
}

export function ApRecordPaymentDialog({ open, bill, onClose, onPaid }: ApRecordPaymentDialogProps): VNode {
  const [form, setForm] = useState<PayForm>({ amount: '', method: 'eft', paymentDate: todayIso(), reference: '', memo: '' });
  const [errors, setErrors] = useState<FieldErrors>({});

  const recordPayment = useRecordPayment();

  // Reset form when dialog opens / bill changes
  useEffect(() => {
    if (open && bill) {
      setForm({ amount: bill.balance.toFixed(2), method: 'eft', paymentDate: todayIso(), reference: '', memo: '' });
      setErrors({});
    }
  }, [open, bill?.id]);

  const set = useCallback(<K extends keyof PayForm>(k: K, v: PayForm[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined }));
  }, []);

  const parsedAmount = Number(form.amount);
  const amountValid = !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const remaining = bill ? bill.balance - (amountValid ? parsedAmount : 0) : 0;
  const resultStatus = bill && amountValid ? resultingStatus(bill, parsedAmount) : null;
  const requiresRef = REQUIRES_REFERENCE.includes(form.method);

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!form.amount || !amountValid)     e.amount = 'Enter a valid positive amount.';
    else if (bill && parsedAmount > bill.balance + 0.005)
                                          e.amount = `Amount (${money(parsedAmount)}) exceeds the outstanding balance (${money(bill.balance)}).`;
    if (requiresRef && !form.reference.trim()) e.reference = `A payment reference is required for ${form.method.toUpperCase()} transfers.`;
    if (form.memo.length > 500)           e.memo = 'Memo must be 500 characters or fewer.';
    return e;
  }

  async function submit(): Promise<void> {
    if (!bill) return;
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    try {
      const updated = await recordPayment.mutateAsync({
        id: bill.id,
        amount: parsedAmount,
        method: form.method,
        paymentDate: form.paymentDate || undefined,
        reference: form.reference.trim() || undefined,
        memo: form.memo.trim() || undefined,
      });
      toast(`Payment of ${money(parsedAmount)} recorded`);
      onPaid?.(updated);
      onClose();
    } catch (err) {
      toast((err as Error).message ?? 'Payment failed');
    }
  }

  return (
    <HrfinWizardModal
      open={open}
      title="Record payment"
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel="Record payment"
      primaryLoading={recordPayment.isPending}
      onPrimary={() => void submit()}
    >
      {bill && (
        <div class="hrfin-dialog-body">
          {/* Bill context header */}
          <div class="hrfin-review-block" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 20 }}>{money(bill.totalAmount)}</span>
              <HrfinPill tone="wn">{bill.billNo}</HrfinPill>
            </div>
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Vendor</span><b>{bill.vendorName}</b></div>
              <div class="hrfin-metric-row"><span>Due date</span><b>{bill.dueDate ? new Date(bill.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</b></div>
              <div class="hrfin-metric-row"><span>Already paid</span><b>{money(bill.paidAmount)}</b></div>
              <div class="hrfin-metric-row" style={{ fontWeight: 600 }}><span>Outstanding balance</span><b style={{ color: 'var(--danger)' }}>{money(bill.balance)}</b></div>
            </div>
          </div>

          {/* Payment form */}
          <div class="hrfin-field">
            <label for="rp-amount">
              Payment amount <span aria-hidden="true" class="ep-required">*</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, color: 'var(--text-2)', minWidth: 32 }}>{bill.currency}</span>
              <input
                id="rp-amount"
                class={`hrfin-input${errors.amount ? ' is-invalid' : ''}`}
                type="number" min={0.01} step={0.01}
                value={form.amount}
                onInput={e => set('amount', (e.target as HTMLInputElement).value)}
                style={{ flex: 1 }}
              />
            </div>
            {errors.amount && <p class="ep-error" role="alert">{errors.amount}</p>}
          </div>

          <div class="hrfin-field">
            <label for="rp-method">Payment method <span aria-hidden="true" class="ep-required">*</span></label>
            <select id="rp-method" class="hrfin-input"
              value={form.method}
              onChange={e => { set('method', (e.target as HTMLSelectElement).value as ApPaymentMethod); }}>
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div class="hrfin-field">
            <label for="rp-date">Payment date <span aria-hidden="true" class="ep-required">*</span></label>
            <input id="rp-date" class="hrfin-input" type="date"
              value={form.paymentDate}
              onInput={e => set('paymentDate', (e.target as HTMLInputElement).value)} />
          </div>

          <div class="hrfin-field">
            <label for="rp-ref">
              Reference {requiresRef && <span aria-hidden="true" class="ep-required">*</span>}
              {!requiresRef && <span class="hrfin-field-hint"> (optional)</span>}
            </label>
            <input id="rp-ref"
              class={`hrfin-input${errors.reference ? ' is-invalid' : ''}`}
              type="text" value={form.reference} maxLength={120}
              placeholder={requiresRef ? `Required for ${form.method.toUpperCase()}` : 'e.g. CHQ-00123'}
              onInput={e => set('reference', (e.target as HTMLInputElement).value)} />
            {errors.reference && <p class="ep-error" role="alert">{errors.reference}</p>}
          </div>

          <div class="hrfin-field">
            <label for="rp-memo">Memo <span class="hrfin-field-hint">(optional)</span></label>
            <input id="rp-memo" class="hrfin-input" type="text"
              value={form.memo} maxLength={500}
              placeholder="Internal note"
              onInput={e => set('memo', (e.target as HTMLInputElement).value)} />
            {errors.memo && <p class="ep-error" role="alert">{errors.memo}</p>}
          </div>

          {/* Live balance preview */}
          {amountValid && parsedAmount > 0 && (
            <div class="hrfin-review-block" style={{ marginTop: 16 }}>
              <p class="hrfin-label-group">Balance preview</p>
              <div class="hrfin-metric-list">
                <div class="hrfin-metric-row"><span>Bill total</span><b>{money(bill.totalAmount)}</b></div>
                <div class="hrfin-metric-row"><span>Previously paid</span><b>{money(bill.paidAmount)}</b></div>
                <div class="hrfin-metric-row"><span>This payment</span><b>−{money(parsedAmount)}</b></div>
                <div class="hrfin-metric-row" style={{ borderTop: '1px solid var(--bd-color)', paddingTop: 6, fontWeight: 600 }}>
                  <span>Remaining after</span>
                  <b style={{ color: remaining > 0.005 ? 'var(--danger)' : 'var(--ok)' }}>
                    {money(Math.max(0, remaining))}
                  </b>
                </div>
                {resultStatus && (
                  <div class="hrfin-metric-row">
                    <span>Resulting status</span>
                    <HrfinPill tone={resultStatus.tone}>{resultStatus.status}</HrfinPill>
                  </div>
                )}
              </div>
              {parsedAmount > bill.balance + 0.005 && (
                <div class="hrfin-sod-note" style={{ marginTop: 8 }}>
                  <HrfinIcon name="alert" /> Payment exceeds outstanding balance — reduce the amount.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </HrfinWizardModal>
  );
}
