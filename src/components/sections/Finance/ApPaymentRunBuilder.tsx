/**
 * src/components/sections/Finance/ApPaymentRunBuilder.tsx
 *
 * Payment-run builder wizard: select approved bills → review batch →
 * method/source → generate / mark manual → process run.
 *
 * Steps:
 *   0 Select bills    — approved + partially_paid bills, checkbox multi-select.
 *   1 Run details     — payDate, paymentMethod, notes, sourceAccountId.
 *   2 Review & submit — batch totals, create the run (status = pending).
 *   3 Process         — SoD-gated process action (creator ≠ processor).
 *
 * Perms: finance.ap.payment.run.manage (create/list/void) + finance.ap.payment.run.process.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { HrfinWizardModal, HrfinPill, HrfinIcon } from '@ui';
import {
  useApBills, useCreatePaymentRun, useProcessPaymentRun, useVoidPaymentRun,
  type ApBill, type ApPaymentRun, type ApPaymentRunItem, type ApPaymentMethod,
} from '@api/finance/accountsPayable';
import { openActionModal } from '@/components/common/actions';
import { money } from './hrfinFormat';

const METHODS: Array<{ value: ApPaymentMethod; label: string }> = [
  { value: 'eft', label: 'EFT' }, { value: 'ach', label: 'ACH' },
  { value: 'wire', label: 'Wire Transfer' }, { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' },
];

const fmtDue = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';

const STEPS = ['Select bills', 'Run details', 'Review', 'Process'];

interface Props {
  open: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

export function ApPaymentRunBuilder({ open, onClose, onComplete }: Props): VNode {
  const canManage  = can('finance.ap.payment.run.manage');
  const canProcess = can('finance.ap.payment.run.process');

  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState({
    paymentMethod: 'eft' as ApPaymentMethod,
    payDate: today,
    notes: '',
    sourceAccountId: '',
  });
  const [run, setRun] = useState<(ApPaymentRun & { items: ApPaymentRunItem[] }) | null>(null);
  const [busy, setBusy] = useState(false);

  const billsQ = useApBills({ status: 'approved', pageSize: 100 });
  const partialQ = useApBills({ status: 'partially_paid', pageSize: 100 });
  const createRun = useCreatePaymentRun();
  const processRun = useProcessPaymentRun();
  const voidRun = useVoidPaymentRun();

  const eligibleBills: ApBill[] = useMemo(() => [
    ...(billsQ.data?.rows ?? []),
    ...(partialQ.data?.rows ?? []),
  ], [billsQ.data, partialQ.data]);

  const selectedBills = eligibleBills.filter(b => selected.has(b.id));
  const runTotal = selectedBills.reduce((s, b) => s + b.balance, 0);

  function toggle(id: string): void {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll(): void {
    setSelected(selected.size === eligibleBills.length ? new Set() : new Set(eligibleBills.map(b => b.id)));
  }

  function reset(): void {
    setStep(0); setSelected(new Set()); setRun(null); setBusy(false);
    setDetails({ paymentMethod: 'eft', payDate: today, notes: '', sourceAccountId: '' });
  }
  function close(): void { onClose(); reset(); }

  async function doCreate(): Promise<void> {
    setBusy(true);
    try {
      const result = await createRun.mutateAsync({
        billIds: [...selected],
        paymentMethod: details.paymentMethod,
        payDate: details.payDate,
        notes: details.notes.trim() || undefined,
        sourceAccountId: details.sourceAccountId.trim() || undefined,
      });
      setRun(result);
      setStep(3);
      toast(`Payment run ${result.runNo} created.`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doProcess(): Promise<void> {
    if (!run) return;
    const r = await openActionModal({
      title: 'Process payment run', subtitle: run.runNo,
      tone: 'success', icon: 'receipt',
      record: { title: `${run.items.length} bills · ${money(run.totalAmount)}`, subtitle: `Method: ${run.paymentMethod.toUpperCase()}` },
      warning: 'Each bill will be marked as paid. SoD: you cannot process a run you created.',
      confirmLabel: 'Process',
    });
    if (!r.confirmed) return;
    setBusy(true);
    try {
      const result = await processRun.mutateAsync({ id: run.id });
      setRun(result);
      toast(`Run ${run.runNo} processed — ${result.items.filter(i => i.status === 'paid').length} bills paid.`);
      onComplete?.();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doVoid(): Promise<void> {
    if (!run) return;
    const r = await openActionModal({
      title: 'Void payment run', subtitle: run.runNo,
      tone: 'danger', icon: 'alert',
      record: { title: run.runNo, subtitle: money(run.totalAmount) },
      reason: { required: true, label: 'Reason', type: 'textarea' },
      confirmLabel: 'Void run',
    });
    if (!r.confirmed) return;
    setBusy(true);
    try {
      await voidRun.mutateAsync({ id: run.id, reason: r.reason ?? '' });
      toast(`Run ${run.runNo} voided.`);
      close();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const stepValid = step === 0 ? selected.size > 0
    : step === 1 ? !!details.payDate && !!details.paymentMethod
      : true;

  async function onNext(): Promise<void> {
    if (step === 2) { await doCreate(); }
    else if (step < STEPS.length - 1) setStep(s => s + 1);
  }

  // In step 3 (process) the footer is replaced by inline controls, so we hide the modal footer.
  const showFooter = step < 3;
  const primaryLabel = step === 2 ? 'Create run' : 'Next';

  return (
    <HrfinWizardModal
      open={open} onClose={close} stepCount={STEPS.length} activeStep={step}
      title="Payment run"
      onPrimary={showFooter ? () => void onNext() : () => undefined}
      onBack={step > 0 && step < 3 ? () => setStep(s => s - 1) : undefined}
      primaryLabel={primaryLabel}
      primaryDisabled={!stepValid || busy || !showFooter}
      primaryLoading={busy && step === 2}
    >
      {/* Step 0: Select bills */}
      {step === 0 && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
            Select approved bills to include in this payment run.
          </p>
          {(billsQ.isLoading || partialQ.isLoading) && <div class="hrfin-empty">Loading...</div>}
          {!billsQ.isLoading && eligibleBills.length === 0 && (
            <div class="hrfin-empty">No approved bills available for payment.</div>
          )}
          {eligibleBills.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" checked={selected.size === eligibleBills.length} onChange={toggleAll} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {selected.size} of {eligibleBills.length} selected · {money(runTotal)} total
                </span>
              </div>
              {eligibleBills.map(b => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{b.billNo}</span>
                      <HrfinPill tone={b.status === 'partially_paid' ? 'nu' : 'ok'}>
                        {b.status === 'partially_paid' ? 'Partial' : 'Approved'}
                      </HrfinPill>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.vendorName} · Due {fmtDue(b.dueDate)}</div>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, textAlign: 'right' }}>
                    {money(b.balance)}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Step 1: Run details */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Payment method *</span>
            <select class="hrfin-input" value={details.paymentMethod} onChange={e => setDetails(d => ({ ...d, paymentMethod: (e.target as HTMLSelectElement).value as ApPaymentMethod }))}>
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Pay date *</span>
            <input class="hrfin-input" type="date" value={details.payDate} min={today} onInput={e => setDetails(d => ({ ...d, payDate: (e.target as HTMLInputElement).value }))} />
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Source account (optional)</span>
            <input class="hrfin-input" type="text" placeholder="Bank account UUID or reference" value={details.sourceAccountId} onInput={e => setDetails(d => ({ ...d, sourceAccountId: (e.target as HTMLInputElement).value }))} />
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Notes</span>
            <textarea class="hrfin-input" rows={3} placeholder="Internal notes for this run…" value={details.notes} onInput={e => setDetails(d => ({ ...d, notes: (e.target as HTMLTextAreaElement).value }))} style={{ resize: 'vertical', width: '100%' }} />
          </label>
        </div>
      )}

      {/* Step 2: Review & create */}
      {step === 2 && (
        <div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div class="hrfin-metric-row"><span>Bills selected</span><b>{selectedBills.length}</b></div>
            <div class="hrfin-metric-row"><span>Total amount</span><b style={{ fontSize: 18 }}>{money(runTotal)}</b></div>
            <div class="hrfin-metric-row"><span>Payment method</span><b>{details.paymentMethod.toUpperCase()}</b></div>
            <div class="hrfin-metric-row"><span>Pay date</span><b>{details.payDate}</b></div>
          </div>
          {selectedBills.map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
              <span>{b.billNo} — {b.vendorName}</span>
              <span style={{ fontWeight: 600 }}>{money(b.balance)}</span>
            </div>
          ))}
          {details.notes && <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>Notes: {details.notes}</p>}
        </div>
      )}

      {/* Step 3: Process (after run is created) */}
      {step === 3 && run && (
        <div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div class="hrfin-metric-row"><span>Run reference</span><b>{run.runNo}</b></div>
            <div class="hrfin-metric-row"><span>Status</span><HrfinPill tone={run.status === 'complete' ? 'ok' : run.status === 'void' ? 'dr' : 'wn'}>{run.status}</HrfinPill></div>
            <div class="hrfin-metric-row"><span>Total</span><b>{money(run.totalAmount)}</b></div>
            <div class="hrfin-metric-row"><span>Method</span><b>{run.paymentMethod.toUpperCase()}</b></div>
            <div class="hrfin-metric-row"><span>Pay date</span><b>{run.payDate}</b></div>
          </div>

          {run.status === 'pending' && (
            <>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                The run is ready to process. A different user from the creator must approve (SoD).
                Processing marks all bills as paid and creates payment records.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {canProcess && (
                  <button type="button" class="hrfin-action is-primary" disabled={busy} onClick={() => void doProcess()}>
                    <HrfinIcon name="receipt" /> Process run
                  </button>
                )}
                <button type="button" class="hrfin-action is-danger" disabled={busy} onClick={() => void doVoid()}>
                  <HrfinIcon name="alert" /> Void run
                </button>
              </div>
              {!canProcess && (
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                  You do not have permission to process payment runs, or SoD requires a different user.
                </p>
              )}
            </>
          )}

          {run.status === 'complete' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--ok)', marginBottom: 12, fontWeight: 500 }}>
                <HrfinIcon name="check" /> Run processed successfully.
              </p>
              {run.items.map(item => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
                  <span>{item.billNo ?? item.billId.slice(0, 8)} — {item.vendorName ?? '—'}</span>
                  <HrfinPill tone={item.status === 'paid' ? 'ok' : 'bad'}>{item.status}</HrfinPill>
                </div>
              ))}
              <button type="button" class="hrfin-action is-primary" style={{ marginTop: 14, width: '100%', justifyContent: 'center' }} onClick={close}>Done</button>
            </div>
          )}

          {run.status === 'void' && (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>This run has been voided.</p>
          )}
        </div>
      )}
    </HrfinWizardModal>
  );
}
