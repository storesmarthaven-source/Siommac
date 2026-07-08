/**
 * netlify/functions/lib/finance/pickers.ts
 *
 * List endpoints for Finance pickers: GL-account (Chart of Accounts), cost-centre,
 * tax-code, payment-terms, and vendor search.
 *
 * GL / cost-centre / tax are backed by seeded finance config (no hard FK to a GL
 * module that isn't built yet). When the GL module ships a real CoA endpoint, swap
 * the picker source here — schema is unchanged (still stores gl_account_code text).
 *
 * All list functions return lightweight DTOs sized for autocomplete use.
 */

import { sb } from '../db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GlAccountOption {
  code: string;
  name: string;
  category: string; // e.g. 'Expense', 'Asset', 'Liability'
}

export interface CostCentreOption {
  id: string;
  code: string;
  name: string;
  department?: string | null;
}

export interface TaxCodeOption {
  code: string;
  name: string;
  rate: number; // percentage, e.g. 12.5
  description: string;
}

export interface PaymentTermsOption {
  days: number;
  label: string; // e.g. 'Net 30', 'Due on receipt'
}

export interface VendorPickerOption {
  id: string;
  vendorNo: string;
  name: string;
  status: 'active' | 'inactive' | 'on_hold';
  paymentTermsDays: number;
  defaultGlAccountCode: string | null;
}

// ── GL Accounts (seeded config until GL module ships) ────────────────────────

/**
 * Return GL account options filtered by optional search string.
 * Source: finance_config table key='gl_chart_of_accounts' (seeded).
 * Falls back to a built-in mini-chart if the config row is missing.
 */
export async function listGlAccounts(search?: string): Promise<GlAccountOption[]> {
  const { data } = await sb
    .from('finance_config')
    .select('value')
    .eq('key', 'gl_chart_of_accounts')
    .maybeSingle();

  let accounts: GlAccountOption[] = [];
  if (data?.value) {
    try { accounts = data.value as GlAccountOption[]; } catch { /* use fallback */ }
  }

  if (!accounts.length) {
    // Built-in fallback chart — enough to demo AP workflows
    accounts = [
      { code: '5000', name: 'Cost of Goods Sold',        category: 'Expense' },
      { code: '5100', name: 'General & Administrative',   category: 'Expense' },
      { code: '5200', name: 'Salaries & Wages',           category: 'Expense' },
      { code: '5300', name: 'Rent & Occupancy',           category: 'Expense' },
      { code: '5400', name: 'Professional Services',      category: 'Expense' },
      { code: '5500', name: 'Utilities',                  category: 'Expense' },
      { code: '5600', name: 'Travel & Entertainment',     category: 'Expense' },
      { code: '5700', name: 'Marketing & Advertising',    category: 'Expense' },
      { code: '5800', name: 'Repairs & Maintenance',      category: 'Expense' },
      { code: '5900', name: 'Depreciation & Amortisation',category: 'Expense' },
      { code: '2000', name: 'Accounts Payable',           category: 'Liability' },
      { code: '2100', name: 'Accrued Liabilities',        category: 'Liability' },
      { code: '1000', name: 'Cash & Bank',                category: 'Asset' },
      { code: '1100', name: 'Accounts Receivable',        category: 'Asset' },
      { code: '1200', name: 'Inventory',                  category: 'Asset' },
      { code: '1300', name: 'Prepaid Expenses',           category: 'Asset' },
    ];
  }

  if (search) {
    const q = search.toLowerCase();
    accounts = accounts.filter(a =>
      a.code.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q),
    );
  }

  return accounts.slice(0, 50);
}

// ── Cost Centres ─────────────────────────────────────────────────────────────

/**
 * Return cost-centre options from finance_cost_centers — the shared cost-centre
 * registry (created in 20260621100003, extended with code/is_active by the HR Org
 * Structure migration 20260715000000; HR manages it until Finance lands). Only
 * active centres are offered as picker options.
 */
export async function listCostCentres(search?: string): Promise<CostCentreOption[]> {
  let query = sb
    .from('finance_cost_centers')
    .select('id, code, name, department_id')
    .eq('is_active', true)
    .order('code', { nullsFirst: false });

  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(50);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  return (data ?? []).map(r => ({
    id:         r.id as string,
    code:       (r.code ?? '') as string,
    name:       r.name as string,
    department: (r.department_id ?? null) as string | null,
  }));
}

// ── Tax Codes (seeded config) ─────────────────────────────────────────────────

/**
 * Return tax-code options from finance_config (seeded) or built-in TT defaults.
 */
export async function listTaxCodes(): Promise<TaxCodeOption[]> {
  const { data } = await sb
    .from('finance_config')
    .select('value')
    .eq('key', 'ap_tax_codes')
    .maybeSingle();

  if (data?.value) {
    try { return data.value as TaxCodeOption[]; } catch { /* use fallback */ }
  }

  // Built-in TT tax codes
  return [
    { code: 'VAT12.5', name: 'VAT 12.5%',         rate: 12.5,  description: 'Trinidad & Tobago standard VAT rate' },
    { code: 'WHT10',   name: 'Withholding Tax 10%', rate: 10.0, description: 'WHT on professional/service fees' },
    { code: 'WHT15',   name: 'Withholding Tax 15%', rate: 15.0, description: 'WHT on management charges' },
    { code: 'ZERO',    name: 'Zero-rated',           rate: 0,    description: 'Zero-rated supply (VAT exempt)' },
    { code: 'EXEMPT',  name: 'Exempt',               rate: 0,    description: 'Exempt supply (no VAT)' },
  ];
}

// ── Payment Terms (seeded config) ────────────────────────────────────────────

/**
 * Return payment terms options from finance_config (seeded) or built-in defaults.
 */
export async function listPaymentTerms(): Promise<PaymentTermsOption[]> {
  const { data } = await sb
    .from('finance_config')
    .select('value')
    .eq('key', 'ap_payment_terms')
    .maybeSingle();

  if (data?.value) {
    try { return data.value as PaymentTermsOption[]; } catch { /* use fallback */ }
  }

  return [
    { days: 0,   label: 'Due on receipt' },
    { days: 7,   label: 'Net 7' },
    { days: 14,  label: 'Net 14' },
    { days: 30,  label: 'Net 30' },
    { days: 45,  label: 'Net 45' },
    { days: 60,  label: 'Net 60' },
    { days: 90,  label: 'Net 90' },
  ];
}

// ── Vendor Picker ────────────────────────────────────────────────────────────

/**
 * Lightweight vendor list for the vendor combobox picker.
 * Only returns active and on_hold vendors (not inactive — can't create bills against them).
 */
export async function listVendorsForPicker(search?: string): Promise<VendorPickerOption[]> {
  let query = sb
    .from('finance_ap_vendors')
    .select('id, vendor_no, name, status, payment_terms_days, default_gl_account_code')
    .in('status', ['active', 'on_hold'])
    .order('name');

  if (search) {
    query = query.or(`name.ilike.%${search}%,vendor_no.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(50);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  return (data ?? []).map(r => ({
    id:                   r.id as string,
    vendorNo:             (r.vendor_no ?? '') as string,
    name:                 r.name as string,
    status:               r.status as 'active' | 'inactive' | 'on_hold',
    paymentTermsDays:     (r.payment_terms_days ?? 30) as number,
    defaultGlAccountCode: (r.default_gl_account_code ?? null) as string | null,
  }));
}
