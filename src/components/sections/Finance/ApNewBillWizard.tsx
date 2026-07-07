/**
 * src/components/sections/Finance/ApNewBillWizard.tsx
 *
 * The enterprise new-bill wizard (replaces the basic single-line form). 5 steps:
 *   1 Vendor & header  2 Line items  3 Tax & accounting  4 Duplicate check  5 Review & submit
 * Multi-line editor with per-line GL / cost-centre / tax PICKERS (no free-text FKs),
 * qty×price, vendor terms/GL auto-fill, a pre-submit duplicate check with override,
 * and submit-on-create. Attachments become a 6th step in a follow-up (need storage).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { HrfinWizardModal, HrfinIcon } from '@ui';
import { useVendorPicker, useGlAccounts, useCostCentres, useTaxCodes } from '@api/finance/pickers';
import { useCreateBill, useCheckBillDuplicate, type DuplicateMatch } from '@api/finance/accountsPayable';
import { money } from './hrfinFormat';

interface LineDraft { description: string; quantity: number; unitPrice: number; glAccountCode: string; costCenterId: string; taxCode: string; }
const emptyLine = (): LineDraft => ({ description: '', quantity: 1, unitPrice: 0, glAccountCode: '', costCenterId: '', taxCode: '' });
const lineTotal = (l: LineDraft): number => Math.round((l.quantity || 0) * (l.unitPrice || 0) * 100) / 100;
const num = (v: string): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function LineEditor({ lines, onChange }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void }): VNode {
  const gl = useGlAccounts();
  const cc = useCostCentres();
  const tax = useTaxCodes();
  const set = (i: number, patch: Partial<LineDraft>): void => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cellLabel = { fontSize: 11, color: 'var(--muted)', display: 'block' } as const;
  return (
    <div>
      {lines.map((l, i) => (
        <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <input class="hrfin-input" placeholder="Line description" value={l.description} onInput={e => set(i, { description: (e.target as HTMLInputElement).value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
            <label style={cellLabel}>Qty<input class="hrfin-input" type="number" min="0" step="0.01" value={l.quantity} onInput={e => set(i, { quantity: num((e.target as HTMLInputElement).value) })} /></label>
            <label style={cellLabel}>Unit price<input class="hrfin-input" type="number" min="0" step="0.01" value={l.unitPrice} onInput={e => set(i, { unitPrice: num((e.target as HTMLInputElement).value) })} /></label>
            <label style={cellLabel}>Amount<input class="hrfin-input" type="text" readOnly value={lineTotal(l).toFixed(2)} /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
            <select class="hrfin-input" value={l.glAccountCode} onChange={e => set(i, { glAccountCode: (e.target as HTMLSelectElement).value })}><option value="">GL account…</option>{(gl.data ?? []).map(g => <option key={g.code} value={g.code}>{g.code} — {g.name}</option>)}</select>
            <select class="hrfin-input" value={l.costCenterId} onChange={e => set(i, { costCenterId: (e.target as HTMLSelectElement).value })}><option value="">Cost centre…</option>{(cc.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select class="hrfin-input" value={l.taxCode} onChange={e => set(i, { taxCode: (e.target as HTMLSelectElement).value })}><option value="">No tax</option>{(tax.data ?? []).map(t => <option key={t.code} value={t.code}>{t.code}</option>)}</select>
          </div>
          {lines.length > 1 && <button type="button" class="hrfin-action" style={{ marginTop: 8 }} onClick={() => onChange(lines.filter((_, j) => j !== i))}>Remove line</button>}
        </div>
      ))}
      <button type="button" class="hrfin-action" onClick={() => onChange([...lines, emptyLine()])}><HrfinIcon name="plus" /> Add line</button>
    </div>
  );
}

export function ApNewBillWizard({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }): VNode {
  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState(0);
  const [header, setHeader] = useState({ vendorId: '', vendorInvoiceNo: '', billDate: today, dueDate: '', reference: '', description: '', currency: 'TTD', paymentTermsDays: undefined as number | undefined, glAccountCode: '' });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [tax, setTax] = useState({ taxIncluded: false, taxAmount: 0, withholdingTaxCode: '' });
  const [dupOverride, setDupOverride] = useState('');
  const [submitForApproval, setSubmitForApproval] = useState(false);
  const [dupes, setDupes] = useState<DuplicateMatch[]>([]);

  const vendors = useVendorPicker();
  const createBill = useCreateBill();
  const dupCheck = useCheckBillDuplicate();

  const subtotal = Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100;
  const total = Math.round((subtotal + (Number(tax.taxAmount) || 0)) * 100) / 100;

  const H = (patch: Partial<typeof header>): void => setHeader(h => ({ ...h, ...patch }));
  function reset(): void { setStep(0); setHeader({ vendorId: '', vendorInvoiceNo: '', billDate: today, dueDate: '', reference: '', description: '', currency: 'TTD', paymentTermsDays: undefined, glAccountCode: '' }); setLines([emptyLine()]); setTax({ taxIncluded: false, taxAmount: 0, withholdingTaxCode: '' }); setDupOverride(''); setSubmitForApproval(false); setDupes([]); }
  function close(): void { onClose(); reset(); }
  function pickVendor(id: string): void { const v = (vendors.data ?? []).find(x => x.id === id); H({ vendorId: id, paymentTermsDays: v?.paymentTermsDays, glAccountCode: v?.defaultGlAccountCode ?? '' }); }

  const linesValid = lines.length > 0 && lines.every(l => l.description.trim().length > 0) && subtotal > 0;
  const stepValid = step === 0 ? (!!header.vendorId && !!header.billDate)
    : step === 1 ? linesValid
      : step === 3 ? (dupes.length === 0 || dupOverride.trim().length > 0)
        : true;

  async function next(): Promise<void> {
    if (step < 2) { setStep(step + 1); return; }
    if (step === 2) {   // entering the duplicate step → run the check
      try { setDupes(await dupCheck.mutateAsync({ vendorId: header.vendorId, vendorInvoiceNo: header.vendorInvoiceNo || undefined, totalAmount: total, billDate: header.billDate })); }
      catch { setDupes([]); }
      setStep(3); return;
    }
    if (step === 3) { setStep(4); return; }
    try {
      await createBill.mutateAsync({
        vendorId: header.vendorId, billDate: header.billDate, dueDate: header.dueDate || undefined,
        description: header.description || undefined, vendorInvoiceNo: header.vendorInvoiceNo || undefined,
        reference: header.reference || undefined, currency: header.currency || undefined, paymentTermsDays: header.paymentTermsDays,
        glAccountCode: header.glAccountCode || undefined,
        lines: lines.map(l => ({ description: l.description.trim(), quantity: l.quantity, unitPrice: l.unitPrice, glAccountCode: l.glAccountCode || undefined, costCenterId: l.costCenterId || null, taxCode: l.taxCode || undefined })),
        taxIncluded: tax.taxIncluded, taxAmount: Number(tax.taxAmount) || 0, withholdingTaxCode: tax.withholdingTaxCode || undefined,
        submitForApproval, duplicateOverrideReason: dupOverride.trim() || undefined,
      });
      toast(submitForApproval ? 'Bill created and submitted for approval' : 'Bill created as draft');
      onCreated(); close();
    } catch (e) { toast((e as Error).message); }
  }

  const primaryLabel = step < 4 ? 'Next' : submitForApproval ? 'Create & submit' : 'Create draft';
  const vendorName = (vendors.data ?? []).find(v => v.id === header.vendorId)?.name ?? '—';

  return (
    <HrfinWizardModal
      open={open} title="New bill" stepCount={5} activeStep={step} onClose={close}
      onBack={step > 0 ? () => setStep(step - 1) : undefined}
      primaryLabel={primaryLabel} primaryDisabled={!stepValid} primaryLoading={createBill.isPending || dupCheck.isPending}
      onPrimary={() => void next()}
    >
      {step === 0 && (
        <>
          <div class="hrfin-field"><label>Vendor</label>
            <select class="hrfin-input" value={header.vendorId} onChange={e => pickVendor((e.target as HTMLSelectElement).value)}>
              <option value="">Select a vendor…</option>{(vendors.data ?? []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div class="hrfin-field"><label>Vendor invoice no.</label><input class="hrfin-input" placeholder="e.g. INV-10293" value={header.vendorInvoiceNo} onInput={e => H({ vendorInvoiceNo: (e.target as HTMLInputElement).value })} /></div>
          <div class="hrfin-field"><label>Bill date</label><input class="hrfin-input" type="date" value={header.billDate} onInput={e => H({ billDate: (e.target as HTMLInputElement).value })} /></div>
          <div class="hrfin-field"><label>Due date</label><input class="hrfin-input" type="date" value={header.dueDate} onInput={e => H({ dueDate: (e.target as HTMLInputElement).value })} /></div>
          <div class="hrfin-field"><label>Reference (optional)</label><input class="hrfin-input" value={header.reference} onInput={e => H({ reference: (e.target as HTMLInputElement).value })} /></div>
          {header.paymentTermsDays != null && <div class="hrfin-sod-note"><HrfinIcon name="check" /> Auto-filled from vendor: Net {header.paymentTermsDays}{header.glAccountCode ? ` · default GL ${header.glAccountCode}` : ''}.</div>}
        </>
      )}

      {step === 1 && (
        <>
          <LineEditor lines={lines} onChange={setLines} />
          <div class="hrfin-metric-row" style={{ marginTop: 12 }}><span>Subtotal</span><b>{money(subtotal)}</b></div>
        </>
      )}

      {step === 2 && (
        <>
          <label class="hrfin-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={tax.taxIncluded} onChange={e => setTax(t => ({ ...t, taxIncluded: (e.target as HTMLInputElement).checked }))} /> <span>Tax is included in the line amounts</span></label>
          <div class="hrfin-field"><label>Tax / VAT amount</label><input class="hrfin-input" type="number" min="0" step="0.01" value={tax.taxAmount} onInput={e => setTax(t => ({ ...t, taxAmount: num((e.target as HTMLInputElement).value) }))} /></div>
          <div class="hrfin-field"><label>Withholding tax code (optional)</label><input class="hrfin-input" value={tax.withholdingTaxCode} onInput={e => setTax(t => ({ ...t, withholdingTaxCode: (e.target as HTMLInputElement).value }))} /></div>
          <div class="hrfin-metric-list" style={{ marginTop: 10 }}>
            <div class="hrfin-metric-row"><span>Subtotal</span><b>{money(subtotal)}</b></div>
            <div class="hrfin-metric-row"><span>Tax</span><b>{money(Number(tax.taxAmount) || 0)}</b></div>
            <div class="hrfin-metric-row"><span>Total</span><b>{money(total)}</b></div>
          </div>
        </>
      )}

      {step === 3 && (
        dupCheck.isPending ? <div class="hrfin-empty">Checking for duplicates…</div> :
          dupes.length === 0 ? <div class="hrfin-sod-note"><HrfinIcon name="check" /> No duplicate bills found for this vendor.</div> :
            <>
              <div class="hrfin-sod-note" style={{ borderColor: 'var(--danger)' }}><HrfinIcon name="alert" /> {dupes.length} possible duplicate{dupes.length === 1 ? '' : 's'} found — review before proceeding.</div>
              <div class="hrfin-metric-list">{dupes.map(d => <div class="hrfin-metric-row" key={d.billId}><span>{d.billNo} · {d.reason === 'invoice_no' ? 'same invoice no.' : 'same amount + date'}</span><b>{money(d.totalAmount)}</b></div>)}</div>
              <div class="hrfin-field"><label>Override reason (required to proceed)</label><input class="hrfin-input" value={dupOverride} onInput={e => setDupOverride((e.target as HTMLInputElement).value)} /></div>
            </>
      )}

      {step === 4 && (
        <>
          <div class="hrfin-metric-list">
            <div class="hrfin-metric-row"><span>Vendor</span><b>{vendorName}</b></div>
            <div class="hrfin-metric-row"><span>Invoice no.</span><b>{header.vendorInvoiceNo || '—'}</b></div>
            <div class="hrfin-metric-row"><span>Lines</span><b>{lines.length}</b></div>
            <div class="hrfin-metric-row"><span>Subtotal</span><b>{money(subtotal)}</b></div>
            <div class="hrfin-metric-row"><span>Tax</span><b>{money(Number(tax.taxAmount) || 0)}</b></div>
            <div class="hrfin-metric-row"><span>Total</span><b>{money(total)}</b></div>
          </div>
          <label class="hrfin-field" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}><input type="checkbox" checked={submitForApproval} onChange={e => setSubmitForApproval((e.target as HTMLInputElement).checked)} /> <span>Submit for approval on create</span></label>
          <div class="hrfin-sod-note"><HrfinIcon name="alert" /> Creating writes an audit record + app event. {submitForApproval ? 'It routes for approval (a different approver — SoD).' : 'Submit it later from the bill drawer.'}</div>
        </>
      )}
    </HrfinWizardModal>
  );
}
