/**
 * src/components/sections/Finance/ApVendorDialog.tsx
 *
 * Full vendor create / edit form in a two-step wizard modal.
 *
 * Step 0 — Core details:   name · registration no · contact (name/email/phone)
 *                           payment terms · preferred payment method · status
 * Step 1 — Defaults:       default GL account (EntityPicker) · cost centre · currency
 * Step 2 (create only) — Bank account (optional first bank account)
 *
 * Used from PayablesOverview.tsx:
 *   <ApVendorDialog open={open} onClose={close} vendor={null}         />  ← create
 *   <ApVendorDialog open={open} onClose={close} vendor={existingDto}  />  ← edit
 */

import { type VNode } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { HrfinWizardModal, EntityPicker, HrfinIcon, type EntityOption } from '@ui';
import { useCreateVendor, useUpdateVendor, type ApVendor, type ApPaymentMethod, type ApVendorStatus } from '@api/finance/accountsPayable';
import { useGlAccounts, useCostCentres, usePaymentTerms } from '@api/finance/pickers';
import { money } from './hrfinFormat';

// ── helpers ───────────────────────────────────────────────────────────────────

function validateEmail(v: string): boolean { return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function validatePhone(v: string): boolean { return !v || /^[\d\s+\-().]{6,20}$/.test(v); }

const CURRENCIES = ['TTD', 'USD', 'EUR', 'GBP', 'CAD', 'JMD', 'XCD'];
const METHODS: { value: ApPaymentMethod; label: string }[] = [
  { value: 'eft',    label: 'EFT / Bank transfer' },
  { value: 'ach',    label: 'ACH' },
  { value: 'wire',   label: 'Wire transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash',   label: 'Cash' },
  { value: 'card',   label: 'Card' },
];
const STATUSES: { value: ApVendorStatus; label: string }[] = [
  { value: 'active',   label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'on_hold',  label: 'On hold' },
];

// ── Form state ─────────────────────────────────────────────────────────────────

interface VendorForm {
  name: string;
  registrationNo: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  paymentTermsDays: string;
  preferredPaymentMethod: ApPaymentMethod | '';
  status: ApVendorStatus;
  defaultGlAccountCode: string | null;
  defaultCostCenterId: string | null;
  defaultCurrency: string;
  // Bank account (create only)
  hasBankAccount: boolean;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankRoutingCode: string;
  bankIban: string;
  bankSwift: string;
  bankCurrency: string;
}

const EMPTY_FORM: VendorForm = {
  name: '', registrationNo: '', contactName: '', contactEmail: '', contactPhone: '',
  paymentTermsDays: '30', preferredPaymentMethod: '', status: 'active',
  defaultGlAccountCode: null, defaultCostCenterId: null, defaultCurrency: 'TTD',
  hasBankAccount: false, bankName: '', bankAccountName: '', bankAccountNumber: '',
  bankRoutingCode: '', bankIban: '', bankSwift: '', bankCurrency: 'TTD',
};

function fromVendor(v: ApVendor): VendorForm {
  return {
    name: v.name, registrationNo: v.registrationNo ?? '',
    contactName: v.contactName ?? '', contactEmail: v.contactEmail ?? '', contactPhone: v.contactPhone ?? '',
    paymentTermsDays: String(v.paymentTermsDays), preferredPaymentMethod: v.preferredPaymentMethod ?? '',
    status: v.status, defaultGlAccountCode: v.defaultGlAccountCode, defaultCostCenterId: v.defaultCostCenterId,
    defaultCurrency: v.defaultCurrency,
    // bank account not available on edit (managed in drawer)
    hasBankAccount: false, bankName: '', bankAccountName: '', bankAccountNumber: '',
    bankRoutingCode: '', bankIban: '', bankSwift: '', bankCurrency: v.defaultCurrency,
  };
}

type FieldErrors = Record<string, string | undefined>;

// ── Component ─────────────────────────────────────────────────────────────────

export interface ApVendorDialogProps {
  open: boolean;
  onClose: () => void;
  /** null = create; non-null = edit */
  vendor: ApVendor | null;
  onSaved?: (vendor: ApVendor) => void;
}

export function ApVendorDialog({ open, onClose, vendor, onSaved }: ApVendorDialogProps): VNode {
  const isCreate = !vendor;
  const stepCount = isCreate ? 3 : 2;

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<VendorForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Pickers
  const [glSearch, setGlSearch] = useState('');
  const [ccSearch, setCcSearch] = useState('');
  const glQ = useGlAccounts(glSearch || undefined);
  const ccQ = useCostCentres(ccSearch || undefined);
  const termsQ = usePaymentTerms();

  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();
  const isPending = createVendor.isPending || updateVendor.isPending;

  // Reset on open/vendor change
  useEffect(() => {
    if (open) {
      setForm(vendor ? fromVendor(vendor) : EMPTY_FORM);
      setErrors({});
      setStep(0);
    }
  }, [open, vendor]);

  const set = useCallback(<K extends keyof VendorForm>(k: K, v: VendorForm[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined }));
  }, []);

  const glOptions: EntityOption[] = (glQ.data ?? []).map(g => ({
    value: g.code, label: g.name, sub: `${g.code} · ${g.category}`,
  }));
  const ccOptions: EntityOption[] = (ccQ.data ?? []).map(c => ({
    value: c.id, label: c.name, sub: c.code,
  }));
  const termsOptions: EntityOption[] = (termsQ.data ?? []).map(t => ({
    value: String(t.days), label: t.label,
  }));

  // ── Validation ──────────────────────────────────────────────────────────────

  function validateStep(s: number): FieldErrors {
    const e: FieldErrors = {};
    if (s === 0) {
      if (!form.name.trim())                        e.name = 'Name is required.';
      if (form.name.trim().length > 200)            e.name = 'Name must be 200 characters or fewer.';
      if (!validateEmail(form.contactEmail))        e.contactEmail = 'Enter a valid email address.';
      if (!validatePhone(form.contactPhone))        e.contactPhone = 'Enter a valid phone number.';
      const td = Number(form.paymentTermsDays);
      if (!Number.isInteger(td) || td < 0 || td > 365) e.paymentTermsDays = 'Enter a whole number between 0 and 365.';
    }
    if (s === 2 && form.hasBankAccount) {
      if (!form.bankName.trim())          e.bankName = 'Bank name is required.';
      if (!form.bankAccountName.trim())   e.bankAccountName = 'Account name is required.';
      if (!form.bankAccountNumber.trim()) e.bankAccountNumber = 'Account number is required.';
    }
    return e;
  }

  function goNext(): void {
    const e = validateStep(step);
    if (Object.keys(e).length) { setErrors(e); return; }
    setStep(s => s + 1);
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function submit(): Promise<void> {
    const e = validateStep(step);
    if (Object.keys(e).length) { setErrors(e); return; }

    const base = {
      name: form.name.trim(),
      registrationNo: form.registrationNo.trim() || undefined,
      contactName: form.contactName.trim() || undefined,
      contactEmail: form.contactEmail.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      paymentTermsDays: Number(form.paymentTermsDays),
      preferredPaymentMethod: (form.preferredPaymentMethod || undefined),
      status: form.status,
      defaultGlAccountCode: form.defaultGlAccountCode ?? undefined,
      defaultCostCenterId: form.defaultCostCenterId ?? undefined,
      defaultCurrency: form.defaultCurrency,
    };

    try {
      let saved: ApVendor;
      if (isCreate) {
        saved = await createVendor.mutateAsync({
          ...base,
          ...(form.hasBankAccount && form.bankName && form.bankAccountName && form.bankAccountNumber ? {
            bankAccount: {
              bankName: form.bankName.trim(),
              accountName: form.bankAccountName.trim(),
              accountNumber: form.bankAccountNumber.trim(),
              routingCode: form.bankRoutingCode.trim() || undefined,
              iban: form.bankIban.trim() || undefined,
              swift: form.bankSwift.trim() || undefined,
              currency: form.bankCurrency || base.defaultCurrency,
            },
          } : {}),
        });
        toast(`Vendor ${saved.vendorNo} created`);
      } else {
        saved = await updateVendor.mutateAsync({ id: vendor.id, ...base });
        toast('Vendor updated');
      }
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const msg = (err as Error).message ?? 'Save failed';
      toast(msg);
    }
  }

  const canCreate = can('finance.ap.vendors.create');
  const canUpdate = can('finance.ap.vendors.update');
  const canAct = isCreate ? canCreate : canUpdate;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <HrfinWizardModal
      open={open}
      title={isCreate ? 'New vendor' : `Edit vendor — ${vendor?.name ?? ''}`}
      stepCount={stepCount}
      activeStep={step}
      onClose={onClose}
      onBack={step > 0 ? () => setStep(s => s - 1) : undefined}
      primaryLabel={step === stepCount - 1 ? (isCreate ? 'Create vendor' : 'Save changes') : 'Next'}
      primaryLoading={isPending}
      onPrimary={step === stepCount - 1 ? () => void submit() : goNext}
      primaryDisabled={!canAct}
    >
      {/* ── Step 0 — Core details ── */}
      {step === 0 && (
        <div class="hrfin-dialog-body">
          <div class="hrfin-field">
            <label for="vd-name">Vendor name <span aria-hidden="true" class="ep-required">*</span></label>
            <input id="vd-name" class={`hrfin-input${errors.name ? ' is-invalid' : ''}`} value={form.name}
              placeholder="e.g. Atlas Cement Ltd." maxLength={200}
              onInput={e => set('name', (e.target as HTMLInputElement).value)} />
            {errors.name && <p class="ep-error" role="alert">{errors.name}</p>}
          </div>

          <div class="hrfin-field">
            <label for="vd-regno">Registration / tax number</label>
            <input id="vd-regno" class="hrfin-input" value={form.registrationNo} maxLength={80}
              placeholder="e.g. 123456789"
              onInput={e => set('registrationNo', (e.target as HTMLInputElement).value)} />
          </div>

          <hr class="hrfin-divider" />
          <p class="hrfin-label-group">Contact information</p>

          <div class="hrfin-field">
            <label for="vd-cname">Contact name</label>
            <input id="vd-cname" class="hrfin-input" value={form.contactName} maxLength={150}
              onInput={e => set('contactName', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="hrfin-field">
            <label for="vd-cemail">Contact email</label>
            <input id="vd-cemail" class={`hrfin-input${errors.contactEmail ? ' is-invalid' : ''}`}
              type="email" value={form.contactEmail}
              onInput={e => set('contactEmail', (e.target as HTMLInputElement).value)} />
            {errors.contactEmail && <p class="ep-error" role="alert">{errors.contactEmail}</p>}
          </div>
          <div class="hrfin-field">
            <label for="vd-cphone">Contact phone</label>
            <input id="vd-cphone" class={`hrfin-input${errors.contactPhone ? ' is-invalid' : ''}`}
              type="tel" value={form.contactPhone}
              onInput={e => set('contactPhone', (e.target as HTMLInputElement).value)} />
            {errors.contactPhone && <p class="ep-error" role="alert">{errors.contactPhone}</p>}
          </div>

          <hr class="hrfin-divider" />
          <p class="hrfin-label-group">Payment settings</p>

          <div class="hrfin-field">
            {termsOptions.length > 0
              ? (
                <EntityPicker
                  id="vd-terms"
                  label="Payment terms"
                  options={termsOptions}
                  value={form.paymentTermsDays}
                  onChange={v => set('paymentTermsDays', v ?? '30')}
                  error={errors.paymentTermsDays}
                />
              )
              : (
                <>
                  <label for="vd-terms-i">Payment terms (days)</label>
                  <input id="vd-terms-i" class={`hrfin-input${errors.paymentTermsDays ? ' is-invalid' : ''}`}
                    type="number" min={0} max={365} value={form.paymentTermsDays}
                    onInput={e => set('paymentTermsDays', (e.target as HTMLInputElement).value)} />
                  {errors.paymentTermsDays && <p class="ep-error" role="alert">{errors.paymentTermsDays}</p>}
                </>
              )
            }
          </div>

          <div class="hrfin-field">
            <label for="vd-method">Preferred payment method</label>
            <select id="vd-method" class="hrfin-input"
              value={form.preferredPaymentMethod}
              onChange={e => set('preferredPaymentMethod', (e.target as HTMLSelectElement).value as ApPaymentMethod | '')}>
              <option value="">— Not specified —</option>
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div class="hrfin-field">
            <label for="vd-status">Status</label>
            <select id="vd-status" class="hrfin-input"
              value={form.status}
              onChange={e => set('status', (e.target as HTMLSelectElement).value as ApVendorStatus)}>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ── Step 1 — Defaults ── */}
      {step === 1 && (
        <div class="hrfin-dialog-body">
          <p class="hrfin-field-hint" style={{ marginBottom: 16 }}>
            These defaults pre-fill new bills raised for this vendor. You can override them on each bill.
          </p>

          <EntityPicker
            label="Default GL account"
            options={glOptions}
            value={form.defaultGlAccountCode}
            onChange={v => set('defaultGlAccountCode', v)}
            loading={glQ.isLoading}
            onSearch={setGlSearch}
            placeholder="Search GL accounts…"
          />

          <EntityPicker
            label="Default cost centre"
            options={ccOptions}
            value={form.defaultCostCenterId}
            onChange={v => set('defaultCostCenterId', v)}
            loading={ccQ.isLoading}
            onSearch={setCcSearch}
            placeholder="Search cost centres…"
          />

          <div class="hrfin-field" style={{ marginTop: 16 }}>
            <label for="vd-currency">Default currency</label>
            <select id="vd-currency" class="hrfin-input"
              value={form.defaultCurrency}
              onChange={e => set('defaultCurrency', (e.target as HTMLSelectElement).value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ── Step 2 — Bank account (create only) ── */}
      {step === 2 && isCreate && (
        <div class="hrfin-dialog-body">
          <label class="hrfin-checkbox-row" style={{ marginBottom: 16 }}>
            <input type="checkbox" checked={form.hasBankAccount}
              onChange={e => set('hasBankAccount', (e.target as HTMLInputElement).checked)} />
            <span>Add a default bank account now</span>
          </label>

          {form.hasBankAccount && (
            <>
              <div class="hrfin-field">
                <label for="ba-bank">Bank name <span aria-hidden="true" class="ep-required">*</span></label>
                <input id="ba-bank" class={`hrfin-input${errors.bankName ? ' is-invalid' : ''}`}
                  value={form.bankName} maxLength={150}
                  onInput={e => set('bankName', (e.target as HTMLInputElement).value)} />
                {errors.bankName && <p class="ep-error" role="alert">{errors.bankName}</p>}
              </div>
              <div class="hrfin-field">
                <label for="ba-acctname">Account name <span aria-hidden="true" class="ep-required">*</span></label>
                <input id="ba-acctname" class={`hrfin-input${errors.bankAccountName ? ' is-invalid' : ''}`}
                  value={form.bankAccountName} maxLength={150}
                  onInput={e => set('bankAccountName', (e.target as HTMLInputElement).value)} />
                {errors.bankAccountName && <p class="ep-error" role="alert">{errors.bankAccountName}</p>}
              </div>
              <div class="hrfin-field">
                <label for="ba-acctno">Account number <span aria-hidden="true" class="ep-required">*</span></label>
                <input id="ba-acctno" class={`hrfin-input${errors.bankAccountNumber ? ' is-invalid' : ''}`}
                  value={form.bankAccountNumber} maxLength={50}
                  onInput={e => set('bankAccountNumber', (e.target as HTMLInputElement).value)} />
                {errors.bankAccountNumber && <p class="ep-error" role="alert">{errors.bankAccountNumber}</p>}
              </div>
              <div class="hrfin-field">
                <label for="ba-routing">Routing / sort code</label>
                <input id="ba-routing" class="hrfin-input" value={form.bankRoutingCode} maxLength={30}
                  onInput={e => set('bankRoutingCode', (e.target as HTMLInputElement).value)} />
              </div>
              <div class="hrfin-field">
                <label for="ba-iban">IBAN</label>
                <input id="ba-iban" class="hrfin-input" value={form.bankIban} maxLength={40}
                  onInput={e => set('bankIban', (e.target as HTMLInputElement).value)} />
              </div>
              <div class="hrfin-field">
                <label for="ba-swift">SWIFT / BIC</label>
                <input id="ba-swift" class="hrfin-input" value={form.bankSwift} maxLength={15}
                  onInput={e => set('bankSwift', (e.target as HTMLInputElement).value)} />
              </div>
              <div class="hrfin-field">
                <label for="ba-curr">Currency</label>
                <select id="ba-curr" class="hrfin-input" value={form.bankCurrency}
                  onChange={e => set('bankCurrency', (e.target as HTMLSelectElement).value)}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </>
          )}

          {!form.hasBankAccount && (
            <div class="hrfin-sod-note">
              <HrfinIcon name="bank" />
              You can add bank accounts later from the vendor detail drawer.
            </div>
          )}

          {/* Summary */}
          <div class="hrfin-review-block" style={{ marginTop: 20 }}>
            <p class="hrfin-label-group">Review</p>
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Vendor name</span><b>{form.name}</b></div>
              <div class="hrfin-metric-row"><span>Contact</span><b>{form.contactEmail || form.contactName || '—'}</b></div>
              <div class="hrfin-metric-row"><span>Payment terms</span><b>Net {form.paymentTermsDays}</b></div>
              <div class="hrfin-metric-row"><span>Currency</span><b>{form.defaultCurrency}</b></div>
              {form.defaultGlAccountCode && <div class="hrfin-metric-row"><span>Default GL</span><b>{form.defaultGlAccountCode}</b></div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit step 1 — Review & save ── */}
      {step === 1 && !isCreate && (
        <div class="hrfin-dialog-body">
          <div class="hrfin-review-block">
            <p class="hrfin-label-group">Review changes</p>
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Vendor name</span><b>{form.name}</b></div>
              <div class="hrfin-metric-row"><span>Contact</span><b>{form.contactEmail || form.contactName || '—'}</b></div>
              <div class="hrfin-metric-row"><span>Payment terms</span><b>Net {form.paymentTermsDays}</b></div>
              <div class="hrfin-metric-row"><span>Currency</span><b>{form.defaultCurrency}</b></div>
              <div class="hrfin-metric-row"><span>Status</span><b>{STATUSES.find(s => s.value === form.status)?.label ?? form.status}</b></div>
              {form.defaultGlAccountCode && <div class="hrfin-metric-row"><span>Default GL</span><b>{form.defaultGlAccountCode}</b></div>}
            </div>
          </div>
        </div>
      )}
    </HrfinWizardModal>
  );
}
