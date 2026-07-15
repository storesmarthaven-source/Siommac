/**
 * src/components/sections/Finance/ExpNewClaimWizard.tsx
 *
 * 5-step wizard for creating a new Expense Claim:
 *   Step 0 — Header (claimant, title, date, category, currency, reimbursable)
 *   Step 1 — Expense Lines (cost-centre allocations, must sum to total)
 *   Step 2 — Receipt (upload primary receipt)
 *   Step 3 — Policy Check (server-side issues surfaced before submit)
 *   Step 4 — Review & submit
 *
 * All FK pickers use CostCentrePicker / EmployeePicker — no free-text UUIDs.
 * Receipt upload uses the two-phase presigned-URL flow.
 * Allocation sum is validated client-side; the backend enforces it too.
 */

import { type VNode } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { toast } from '@store';
import { HrfinWizardModal, HrfinIcon } from '@ui';
import {
  financeExpensesApi,
  expenseSubmitKey,
  clearExpenseSubmitKey,
  useExpenseMutation,
  useExpensePolicyCheck,
  type PolicyIssue,
  type ExpenseCategory,
  type AllocationLine,
} from '@api/finance/expenses';
import { useCompleteFinanceAttachment } from '@api/finance/attachments';
import { CostCentrePicker, EmployeePicker } from './_shared/pickers';
import { EmployeeCell } from './_shared/EmployeeCell';
import { fmtMoney, humanize } from './financeShared';
import { money } from './hrfinFormat';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'travel',            label: 'Travel' },
  { value: 'accommodation',     label: 'Accommodation' },
  { value: 'meals',             label: 'Meals' },
  { value: 'equipment',         label: 'Equipment' },
  { value: 'supplies',          label: 'Supplies' },
  { value: 'professional_fees', label: 'Professional Fees' },
  { value: 'utilities',         label: 'Utilities' },
  { value: 'other',             label: 'Other' },
];

const CURRENCIES = ['TTD', 'USD', 'EUR', 'GBP', 'CAD'];

const STEPS = ['Header', 'Lines', 'Receipt', 'Policy', 'Review'];

// ── Line type ─────────────────────────────────────────────────────────────────

interface LineDraft {
  costCenterId:    string;
  amount:          string;
  description:     string;
  /** §14 per-line fields */
  expenseDate:     string;
  category:        string;
  project:         string;
  taxAmount:       string;
  merchant:        string;
  receiptRequired: boolean;
}

const emptyLine = (defaults: Partial<LineDraft> = {}): LineDraft => ({
  costCenterId: '', amount: '', description: '',
  expenseDate: '', category: '', project: '',
  taxAmount: '', merchant: '', receiptRequired: false,
  ...defaults,
});

// ── Validation helpers ────────────────────────────────────────────────────────

interface HeaderErrors {
  claimantId?:  string;
  title?:       string;
  expenseDate?: string;
  totalAmount?: string;
  category?:    string;
}

interface LineErrors {
  sum?:                  string;
  lines?: Record<number, { costCenterId?: string; amount?: string }>;
}

function validateHeader(h: {
  claimantId:  string;
  title:       string;
  expenseDate: string;
  totalAmount: string;
  category:    string;
}): HeaderErrors {
  const e: HeaderErrors = {};
  if (!h.claimantId)         e.claimantId  = 'Claimant is required.';
  if (!h.title.trim())       e.title       = 'Title is required.';
  if (!h.expenseDate)        e.expenseDate = 'Expense date is required.';
  if (!h.category)           e.category    = 'Category is required.';
  const amt = parseFloat(h.totalAmount);
  if (!h.totalAmount || Number.isNaN(amt) || amt <= 0) e.totalAmount = 'Enter a valid positive amount.';
  return e;
}

function validateLines(lines: LineDraft[], totalAmount: number): LineErrors {
  const e: LineErrors = {};
  const lineErrors: Record<number, { costCenterId?: string; amount?: string }> = {};
  let sum = 0;

  lines.forEach((l, i) => {
    const le: { costCenterId?: string; amount?: string } = {};
    if (!l.costCenterId) le.costCenterId = 'Cost centre required.';
    const amt = parseFloat(l.amount);
    if (!l.amount || Number.isNaN(amt) || amt <= 0) {
      le.amount = 'Enter a valid positive amount.';
    } else {
      sum += amt;
    }
    if (Object.keys(le).length) lineErrors[i] = le;
  });

  if (Object.keys(lineErrors).length) e.lines = lineErrors;

  const diff = Math.abs(Math.round(sum * 100) - Math.round(totalAmount * 100));
  if (diff > 1) {
    e.sum = `Line amounts (${money(sum)}) must sum to the claim total (${money(totalAmount)}).`;
  }

  return e;
}

// ── Receipt upload helper ─────────────────────────────────────────────────────

type ReceiptState =
  | { phase: 'idle' }
  | { phase: 'uploading'; pct: number }
  | { phase: 'done'; path: string; name: string; mimeType: string }
  | { phase: 'error'; message: string };

// ── Main wizard ───────────────────────────────────────────────────────────────

export interface ExpNewClaimWizardProps {
  open:      boolean;
  onClose:   () => void;
  onCreated: (claimId: string) => void;
}

export function ExpNewClaimWizard({ open, onClose, onCreated }: ExpNewClaimWizardProps): VNode {
  const today = new Date().toISOString().slice(0, 10);

  // Step index
  const [step, setStep] = useState(0);

  // Step 0 — header fields
  const [claimantId,        setClaimantId]        = useState('');
  const [title,             setTitle]             = useState('');
  const [expenseDate,       setExpenseDate]        = useState(today);
  const [category,          setCategory]          = useState<ExpenseCategory | ''>('');
  const [totalAmount,       setTotalAmount]        = useState('');
  const [currency,          setCurrency]          = useState('TTD');
  const [reimbursable,      setReimbursable]      = useState(true);
  const [purpose,           setPurpose]           = useState('');
  const [departmentId,      setDepartmentId]      = useState('');
  const [defaultCostCentreId, setDefaultCostCentreId] = useState('');
  const [headerErrors,      setHeaderErrors]      = useState<HeaderErrors>({});

  // Step 1 — lines
  const [lines,      setLines]      = useState<LineDraft[]>([emptyLine()]);
  const [lineErrors, setLineErrors] = useState<LineErrors>({});

  // Step 2 — receipt
  const [receipt, setReceipt] = useState<ReceiptState>({ phase: 'idle' });

  // Step 3 — policy (we only fetch after creating the claim)
  const [createdId,    setCreatedId]    = useState<string | null>(null);
  const [policyLoaded, setPolicyLoaded] = useState(false);

  // Submit-for-approval toggle
  const [submitOnCreate, setSubmitOnCreate] = useState(true);

  // Mutations
  const createClaim        = useExpenseMutation((args: Parameters<typeof financeExpensesApi.create>[0]) =>
    financeExpensesApi.create(args),
  );
  const submitClaim        = useExpenseMutation((id: string) => financeExpensesApi.submit({ id, idempotencyKey: expenseSubmitKey(id) }));
  const completeAttachment = useCompleteFinanceAttachment();

  // Policy check only runs once the claim is created (step 3 with createdId)
  const policyQ = useExpensePolicyCheck(step === 3 && createdId ? createdId : null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function reset(): void {
    setStep(0);
    setClaimantId(''); setTitle(''); setExpenseDate(today);
    setCategory(''); setTotalAmount(''); setCurrency('TTD'); setReimbursable(true);
    setPurpose(''); setDepartmentId(''); setDefaultCostCentreId('');
    setHeaderErrors({});
    setLines([emptyLine()]); setLineErrors({});
    setReceipt({ phase: 'idle' });
    setCreatedId(null); setPolicyLoaded(false);
    setSubmitOnCreate(true);
    createClaim.reset();
    submitClaim.reset();
  }

  function close(): void { onClose(); reset(); }

  function setLine(i: number, patch: Partial<LineDraft>): void {
    setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
    setLineErrors(e => {
      if (!e.lines?.[i]) return e;
      const newLines = { ...e.lines };
      Reflect.deleteProperty(newLines, i);
      return { ...e, lines: Object.keys(newLines).length ? newLines : undefined, sum: e.sum };
    });
  }

  // ── Step navigation ────────────────────────────────────────────────────────

  function tryNext(): void {
    if (step === 0) {
      const errs = validateHeader({ claimantId, title, expenseDate, totalAmount, category });
      setHeaderErrors(errs);
      if (Object.keys(errs).length) return;
    }
    if (step === 1) {
      const errs = validateLines(lines, parseFloat(totalAmount));
      setLineErrors(errs);
      if (Object.keys(errs).length) return;
    }
    if (step === 2) {
      // Receipt is optional — skip allowed
    }
    setStep(s => s + 1);
  }

  // ── Receipt upload ─────────────────────────────────────────────────────────

  const handleReceiptFile = useCallback(async (file: File): Promise<void> => {
    setReceipt({ phase: 'uploading', pct: 0 });
    try {
      const { uploadUrl, path } = await financeExpensesApi.receiptUploadUrl({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
      });
      // Direct PUT to presigned URL
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) setReceipt({ phase: 'uploading', pct: Math.round((e.loaded / e.total) * 100) });
        };
        xhr.onload  = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('Network error during upload.'));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
      });
      setReceipt({ phase: 'done', path, name: file.name, mimeType: file.type || 'application/octet-stream' });
    } catch (e) {
      setReceipt({ phase: 'error', message: (e as Error).message });
    }
  }, []);

  // ── Claim creation (at end of step 3 → 4 or on finish) ──────────────────

  async function ensureCreated(): Promise<string | null> {
    if (createdId) return createdId;
    try {
      const allocationLines: AllocationLine[] = lines.map(l => ({
        costCenterId:    l.costCenterId,
        amount:          parseFloat(l.amount),
        description:     l.description.trim() || undefined,
        expenseDate:     l.expenseDate || undefined,
        category:        (l.category as ExpenseCategory) || undefined,
        project:         l.project.trim() || undefined,
        taxAmount:       l.taxAmount ? parseFloat(l.taxAmount) : undefined,
        merchant:        l.merchant.trim() || undefined,
        receiptRequired: l.receiptRequired || undefined,
      }));
      const result = await createClaim.mutateAsync({
        claimantId,
        title:        title.trim(),
        expenseDate,
        category:     category as ExpenseCategory,
        totalAmount:  parseFloat(totalAmount),
        currency,
        reimbursable,
        receiptPath:  receipt.phase === 'done' ? receipt.path : undefined,
        purpose:      purpose.trim() || undefined,
        departmentId: departmentId.trim() || undefined,
        allocationLines,
      });
      setCreatedId(result.id);
      return result.id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create claim.');
      return null;
    }
  }

  // Step 2 → 3: create claim (so policy check has a claim ID)
  async function advanceFromReceipt(): Promise<void> {
    const id = await ensureCreated();
    if (!id) return;
    // If receipt is done and the claim didn't already get the path on creation, commit it now.
    // Both calls are required: receipt-commit updates the claim's receipt_path column,
    // and finance/attachments/complete writes to finance_expense_attachments so the
    // Receipts drawer tab (useFinanceAttachments) can see the file.
    if (receipt.phase === 'done' && !createClaim.data?.receiptPath) {
      try {
        await financeExpensesApi.receiptCommit({ claimId: id, path: receipt.path });
        await completeAttachment.mutateAsync({
          entityType:  'expense_claim',
          entityId:    id,
          fileName:    receipt.name,
          storagePath: receipt.path,
          mimeType:    receipt.mimeType,
        });
      } catch (e) {
        toast.error(`Receipt commit failed: ${(e as Error).message}. You can re-upload from the claim's Receipts tab.`);
        // Continue — the claim itself was created successfully; receipt can be re-attached later.
      }
    }
    setStep(3);
  }

  // Final submit
  async function handleFinish(): Promise<void> {
    const id = createdId ?? await ensureCreated();
    if (!id) return;
    if (submitOnCreate) {
      try { await submitClaim.mutateAsync(id); clearExpenseSubmitKey(id); } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Claim created but submit failed.');
      }
    }
    toast.success(submitOnCreate ? 'Claim created and submitted.' : 'Claim saved as draft.');
    onCreated(id);
    close();
  }

  const busy = createClaim.isPending || submitClaim.isPending;

  // ── Policy issues display ─────────────────────────────────────────────────

  const policyIssues: PolicyIssue[] = policyQ.data?.issues ?? [];
  const hasBlocker = policyIssues.some(i => i.severity === 'error');

  // ── Wizard steps ──────────────────────────────────────────────────────────

  function renderStep(): VNode {
    switch (step) {
      // ── Step 0: Header ──────────────────────────────────────────────────
      case 0: return (
        <div class="wizard-body">
          <div class={`hrfin-field${headerErrors.claimantId ? ' has-error' : ''}`}>
            <EmployeePicker
              label="Claimant"
              value={claimantId || null}
              onChange={v => { setClaimantId(v ?? ''); setHeaderErrors(e => ({ ...e, claimantId: undefined })); }}
              error={headerErrors.claimantId}
              required
            />
          </div>

          <div class={`hrfin-field${headerErrors.title ? ' has-error' : ''}`}>
            <label htmlFor="exp-title">Title <span class="hrfin-req">*</span></label>
            <input
              id="exp-title"
              type="text"
              class="hrfin-input"
              placeholder="Brief description of the expense"
              value={title}
              onInput={e => { setTitle((e.target as HTMLInputElement).value); setHeaderErrors(er => ({ ...er, title: undefined })); }}
            />
            {headerErrors.title && <span class="hrfin-error">{headerErrors.title}</span>}
          </div>

          <div class={`hrfin-field${headerErrors.expenseDate ? ' has-error' : ''}`}>
            <label htmlFor="exp-date">Expense date <span class="hrfin-req">*</span></label>
            <input
              id="exp-date"
              type="date"
              class="hrfin-input"
              value={expenseDate}
              max={today}
              onInput={e => { setExpenseDate((e.target as HTMLInputElement).value); setHeaderErrors(er => ({ ...er, expenseDate: undefined })); }}
              required
            />
            {headerErrors.expenseDate && <span class="hrfin-error">{headerErrors.expenseDate}</span>}
          </div>

          <div class={`hrfin-field${headerErrors.category ? ' has-error' : ''}`}>
            <label htmlFor="exp-cat">Category <span class="hrfin-req">*</span></label>
            <select
              id="exp-cat"
              class="hrfin-input"
              value={category}
              onChange={e => { setCategory((e.target as HTMLSelectElement).value as ExpenseCategory); setHeaderErrors(er => ({ ...er, category: undefined })); }}
              required
            >
              <option value="">Select category…</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            {headerErrors.category && <span class="hrfin-error">{headerErrors.category}</span>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class={`hrfin-field${headerErrors.totalAmount ? ' has-error' : ''}`}>
              <label htmlFor="exp-total">Total amount <span class="hrfin-req">*</span></label>
              <input
                id="exp-total"
                type="number"
                class="hrfin-input"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={totalAmount}
                onInput={e => { setTotalAmount((e.target as HTMLInputElement).value); setHeaderErrors(er => ({ ...er, totalAmount: undefined })); }}
                required
              />
              {headerErrors.totalAmount && <span class="hrfin-error">{headerErrors.totalAmount}</span>}
            </div>
            <div class="hrfin-field">
              <label htmlFor="exp-currency">Currency</label>
              <select id="exp-currency" class="hrfin-input" value={currency} onChange={e => setCurrency((e.target as HTMLSelectElement).value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div class="hrfin-field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="exp-reimbursable"
              type="checkbox"
              checked={reimbursable}
              onChange={e => setReimbursable((e.target as HTMLInputElement).checked)}
              style={{ width: 'auto' }}
            />
            <label htmlFor="exp-reimbursable" style={{ marginBottom: 0 }}>
              Eligible for reimbursement
            </label>
          </div>

          <div class="hrfin-field">
            <label htmlFor="exp-purpose">Business purpose</label>
            <textarea
              id="exp-purpose"
              class="hrfin-input"
              rows={2}
              placeholder="Brief business reason for this expense (optional)"
              value={purpose}
              onInput={e => setPurpose((e.target as HTMLTextAreaElement).value)}
              maxLength={500}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div class="hrfin-field">
              <label htmlFor="exp-dept">Department</label>
              <input
                id="exp-dept"
                type="text"
                class="hrfin-input"
                placeholder="Department name or code (optional)"
                value={departmentId}
                onInput={e => setDepartmentId((e.target as HTMLInputElement).value)}
                maxLength={100}
              />
            </div>
            <div class="hrfin-field">
              <CostCentrePicker
                label="Default cost centre"
                value={defaultCostCentreId || null}
                onChange={v => {
                  setDefaultCostCentreId(v ?? '');
                  // Pre-fill open lines that have no cost centre yet
                  setLines(ls => ls.map(l => l.costCenterId ? l : { ...l, costCenterId: v ?? '' }));
                }}
              />
            </div>
          </div>
        </div>
      );

      // ── Step 1: Lines ────────────────────────────────────────────────────
      case 1: return (
        <div class="wizard-body">
          <p class="hse-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Allocation lines must sum to <b>{fmtMoney(parseFloat(totalAmount) || 0)}</b>.
          </p>
          {lineErrors.sum && <div class="hrfin-alert is-warning" style={{ marginBottom: 10 }}>{lineErrors.sum}</div>}

          {lines.map((l, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <b style={{ fontSize: 13 }}>Line {i + 1}</b>
                {lines.length > 1 && (
                  <button type="button" class="hrfin-action" style={{ padding: '2px 8px', fontSize: 12 }}
                    onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>

              <CostCentrePicker
                label="Cost centre"
                value={l.costCenterId || null}
                onChange={v => setLine(i, { costCenterId: v ?? '' })}
                error={lineErrors.lines?.[i]?.costCenterId}
                required
              />

              <div class={`hrfin-field${lineErrors.lines?.[i]?.amount ? ' has-error' : ''}`} style={{ marginTop: 8 }}>
                <label htmlFor={`exp-line-amt-${i}`}>Amount <span class="hrfin-req">*</span></label>
                <input
                  id={`exp-line-amt-${i}`}
                  type="number"
                  class="hrfin-input"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={l.amount}
                  onInput={e => setLine(i, { amount: (e.target as HTMLInputElement).value })}
                />
                {lineErrors.lines?.[i]?.amount && <span class="hrfin-error">{lineErrors.lines[i].amount}</span>}
              </div>

              <div class="hrfin-field" style={{ marginTop: 8 }}>
                <label htmlFor={`exp-line-desc-${i}`}>Description</label>
                <input
                  id={`exp-line-desc-${i}`}
                  type="text"
                  class="hrfin-input"
                  placeholder="Optional line description"
                  value={l.description}
                  onInput={e => setLine(i, { description: (e.target as HTMLInputElement).value })}
                />
              </div>

              {/* §14 per-line fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <div class="hrfin-field">
                  <label htmlFor={`exp-line-date-${i}`}>Line date</label>
                  <input
                    id={`exp-line-date-${i}`}
                    type="date"
                    class="hrfin-input"
                    value={l.expenseDate}
                    max={today}
                    onInput={e => setLine(i, { expenseDate: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="hrfin-field">
                  <label htmlFor={`exp-line-cat-${i}`}>Category</label>
                  <select
                    id={`exp-line-cat-${i}`}
                    class="hrfin-input"
                    value={l.category}
                    onChange={e => setLine(i, { category: (e.target as HTMLSelectElement).value })}
                  >
                    <option value="">—</option>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div class="hrfin-field">
                  <label htmlFor={`exp-line-merchant-${i}`}>Merchant</label>
                  <input
                    id={`exp-line-merchant-${i}`}
                    type="text"
                    class="hrfin-input"
                    placeholder="Merchant / supplier"
                    value={l.merchant}
                    onInput={e => setLine(i, { merchant: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="hrfin-field">
                  <label htmlFor={`exp-line-project-${i}`}>Project</label>
                  <input
                    id={`exp-line-project-${i}`}
                    type="text"
                    class="hrfin-input"
                    placeholder="Project code (optional)"
                    value={l.project}
                    onInput={e => setLine(i, { project: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="hrfin-field">
                  <label htmlFor={`exp-line-tax-${i}`}>Tax amount</label>
                  <input
                    id={`exp-line-tax-${i}`}
                    type="number"
                    class="hrfin-input"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={l.taxAmount}
                    onInput={e => setLine(i, { taxAmount: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="hrfin-field" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                  <input
                    id={`exp-line-rcpt-${i}`}
                    type="checkbox"
                    checked={l.receiptRequired}
                    onChange={e => setLine(i, { receiptRequired: (e.target as HTMLInputElement).checked })}
                    style={{ width: 'auto' }}
                  />
                  <label htmlFor={`exp-line-rcpt-${i}`} style={{ marginBottom: 0, fontSize: 13 }}>
                    Receipt required
                  </label>
                </div>
              </div>
            </div>
          ))}

          <button type="button" class="hrfin-action" onClick={() => setLines(ls => [...ls, emptyLine({ costCenterId: defaultCostCentreId })])}>
            <HrfinIcon name="plus" /> Add line
          </button>

          <div style={{ marginTop: 12, textAlign: 'right', fontWeight: 600 }}>
            Lines total: {fmtMoney(lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0))}
            {' / '}
            {fmtMoney(parseFloat(totalAmount) || 0)}
          </div>
        </div>
      );

      // ── Step 2: Receipt ──────────────────────────────────────────────────
      case 2: return (
        <div class="wizard-body">
          <p class="hse-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Attach the primary receipt. You can attach additional receipts later. Skip to continue without one.
          </p>

          {receipt.phase === 'idle' && (
            <label class="hrfin-upload-area" style={{ display: 'block', border: '2px dashed var(--border)', borderRadius: 10, padding: 24, textAlign: 'center', cursor: 'pointer' }}>
              <input
                type="file"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) { void handleReceiptFile(file); }
                }}
              />
              <HrfinIcon name="upload" />
              <p style={{ marginTop: 8 }}>Click or drag to upload a receipt (PDF, JPEG, PNG)</p>
            </label>
          )}

          {receipt.phase === 'uploading' && (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div class="hrfin-spinner" style={{ margin: '0 auto 12px' }} />
              <p>Uploading… {receipt.pct}%</p>
            </div>
          )}

          {receipt.phase === 'done' && (
            <div class="hrfin-metric-row" style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 12 }}>
              <span><HrfinIcon name="file" /> {receipt.name}</span>
              <button type="button" class="hrfin-action" onClick={() => setReceipt({ phase: 'idle' })}>Remove</button>
            </div>
          )}

          {receipt.phase === 'error' && (
            <div class="hrfin-alert is-danger">
              Upload failed: {receipt.message}
              <button type="button" class="hrfin-action" style={{ marginLeft: 12 }} onClick={() => setReceipt({ phase: 'idle' })}>Retry</button>
            </div>
          )}
        </div>
      );

      // ── Step 3: Policy check ─────────────────────────────────────────────
      case 3: return (
        <div class="wizard-body">
          {policyQ.isLoading && !policyLoaded && (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div class="hrfin-spinner" style={{ margin: '0 auto 12px' }} />
              <p class="hse-muted">Running policy checks…</p>
            </div>
          )}
          {policyQ.data && (
            <>
              {policyIssues.length === 0 && (
                <div class="hrfin-alert is-success">
                  All policy checks passed. Ready to review.
                </div>
              )}
              {policyIssues.map((issue, i) => (
                <div key={i} class={`hrfin-alert ${issue.severity === 'error' ? 'is-danger' : 'is-warning'}`} style={{ marginBottom: 8 }}>
                  <b>{humanize(issue.type)}:</b> {issue.message}
                </div>
              ))}
              {hasBlocker && (
                <p class="hse-muted" style={{ marginTop: 8, fontSize: 13 }}>
                  Resolve the errors above before proceeding. You may go back to edit the claim.
                </p>
              )}
              {policyQ.data.approvalRoute && (
                <div class="hrfin-metric-row" style={{ marginTop: 12 }}>
                  <span>Approval route</span>
                  <b>{policyQ.data.approvalRoute.label}</b>
                </div>
              )}
            </>
          )}
          {policyQ.isError && (
            <div class="hrfin-alert is-warning">
              Policy check unavailable — you can still proceed.
            </div>
          )}
        </div>
      );

      // ── Step 4: Review ───────────────────────────────────────────────────
      case 4: return (
        <div class="wizard-body">
          <div class="hrfin-metric-list">
            <div class="hrfin-metric-row"><span>Claimant</span>      <b><EmployeeCell employeeId={claimantId || null} /></b></div>
            <div class="hrfin-metric-row"><span>Title</span>         <b>{title}</b></div>
            <div class="hrfin-metric-row"><span>Category</span>      <b>{humanize(category)}</b></div>
            <div class="hrfin-metric-row"><span>Date</span>          <b>{expenseDate}</b></div>
            <div class="hrfin-metric-row"><span>Total</span>         <b>{fmtMoney(parseFloat(totalAmount))} {currency}</b></div>
            <div class="hrfin-metric-row"><span>Reimbursable</span>  <b>{reimbursable ? 'Yes' : 'No'}</b></div>
            {purpose && <div class="hrfin-metric-row"><span>Purpose</span>        <b>{purpose}</b></div>}
            {departmentId && <div class="hrfin-metric-row"><span>Department</span>     <b>{departmentId}</b></div>}
            <div class="hrfin-metric-row"><span>Lines</span>         <b>{lines.length}</b></div>
            <div class="hrfin-metric-row"><span>Receipt</span>       <b>{receipt.phase === 'done' ? receipt.name : 'None'}</b></div>
          </div>

          {hasBlocker && (
            <div class="hrfin-alert is-danger" style={{ marginTop: 12 }}>
              Policy errors must be resolved before submitting.
            </div>
          )}

          <div class="hrfin-field" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <input
              id="exp-submit-on-create"
              type="checkbox"
              checked={submitOnCreate}
              onChange={e => setSubmitOnCreate((e.target as HTMLInputElement).checked)}
              style={{ width: 'auto' }}
              disabled={hasBlocker}
            />
            <label htmlFor="exp-submit-on-create" style={{ marginBottom: 0 }}>
              Submit for approval immediately
            </label>
          </div>
        </div>
      );

      default: return <></>;
    }
  }

  // ── Navigation handlers ───────────────────────────────────────────────────

  function handleBack(): void { setStep(s => Math.max(0, s - 1)); }

  function handleNext(): void {
    if (step < 2)      { tryNext(); return; }
    if (step === 2)    { void advanceFromReceipt(); return; }
    if (step === 3)    { setStep(4); return; }
    if (step === 4)    { void handleFinish(); return; }
  }

  const nextLabel = step === 4
    ? (submitOnCreate ? 'Create & Submit' : 'Save as Draft')
    : step === 2 ? (receipt.phase === 'uploading' ? 'Uploading…' : receipt.phase === 'done' ? 'Next' : 'Skip & Next')
    : 'Next';

  const nextDisabled = busy
    || (step === 2 && receipt.phase === 'uploading')
    || (step === 4 && hasBlocker && submitOnCreate);

  return (
    <HrfinWizardModal
      open={open}
      onClose={close}
      title="New Expense Claim"
      stepCount={STEPS.length}
      activeStep={step}
      onBack={step > 0 ? handleBack : undefined}
      onPrimary={handleNext}
      primaryLabel={nextLabel}
      primaryDisabled={nextDisabled}
      primaryLoading={busy}
    >
      {renderStep()}
    </HrfinWizardModal>
  );
}
