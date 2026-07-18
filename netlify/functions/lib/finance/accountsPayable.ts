// ============================================================================
// Finance -- Accounts Payable (vendors, bills, lines, payments)
// ============================================================================
// Thin routes delegate here. Lifecycle: draft → submitted → approved →
// partially_paid|paid (also rejected, void). SoD: creator ≠ approver.
// Every mutation emits an app_event + an audit row; submit starts the approval
// workflow when a binding exists (null = no binding → direct approve allowed).
// Mirrors lib/finance/expenses.ts.

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { nextRef } from '../refGenerator';
import { startWorkflowForRecord } from '../workflow/service';
import { assertDifferentApprover } from './statutoryConfig';
import type { ModuleWorkflowContext } from '../workflow/definitionTypes';

export type ApBillStatus = 'draft' | 'submitted' | 'approved' | 'partially_paid' | 'paid' | 'rejected' | 'void';
export type ApPaymentMethod = 'eft' | 'ach' | 'wire' | 'cheque' | 'cash' | 'card';
export type ApVendorStatus = 'active' | 'inactive' | 'on_hold';

const SUBMODULE = 'finance_ap';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface ApVendorDto {
  id: string; vendorNo: string; name: string; registrationNo: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  paymentTermsDays: number; defaultGlAccountCode: string | null;
  defaultCostCenterId: string | null; defaultCurrency: string;
  preferredPaymentMethod: ApPaymentMethod | null;
  status: ApVendorStatus;
  createdAt: string; updatedAt: string | null;
}

export interface ApVendorBankAccountDto {
  id: string; vendorId: string; bankName: string; accountName: string;
  accountNumber: string; routingCode: string | null; iban: string | null;
  swift: string | null; currency: string; isDefault: boolean;
  status: 'active' | 'inactive'; createdAt: string;
}

export interface ApBillDto {
  id: string; billNo: string; vendorId: string; vendorName: string;
  billDate: string; dueDate: string | null; description: string | null;
  totalAmount: number; paidAmount: number; balance: number; currency: string;
  status: ApBillStatus; glAccountCode: string | null;
  approvedBy: string | null; createdBy: string | null; rejectReason: string | null;
  voidReason: string | null; workflowId: string | null;
  createdAt: string; updatedAt: string | null;
}

export interface ApBillLineDto { id: string; billId: string; lineNo: number; description: string; amount: number; glAccountCode: string | null; costCenterId: string | null; }
export interface ApPaymentDto {
  id: string; billId: string; amount: number; method: ApPaymentMethod;
  paidAt: string; reference: string | null; memo: string | null;
  sourceAccountId: string | null; createdBy: string | null;
}

interface DbVendorRow {
  id: string; vendor_no: string; name: string; registration_no: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  payment_terms_days: number; default_gl_account_code: string | null;
  default_cost_center_id: string | null; default_currency: string;
  preferred_payment_method: string | null;
  status: ApVendorStatus; created_at: string; updated_at: string | null;
}
interface DbVendorBankAccountRow {
  id: string; vendor_id: string; bank_name: string; account_name: string;
  account_number: string; routing_code: string | null; iban: string | null;
  swift: string | null; currency: string; is_default: boolean;
  status: 'active' | 'inactive'; created_at: string;
}
interface DbBillRow { id: string; bill_no: string; vendor_id: string; bill_date: string; due_date: string | null; description: string | null; total_amount: string; paid_amount: string; currency: string; status: ApBillStatus; gl_account_code: string | null; approved_by: string | null; created_by: string | null; reject_reason: string | null; void_reason: string | null; workflow_id: string | null; created_at: string; updated_at: string | null; finance_ap_vendors?: { name: string } | { name: string }[] | null; }
interface DbLineRow { id: string; bill_id: string; line_no: number; description: string; amount: string; gl_account_code: string | null; cost_center_id: string | null; }
interface DbPaymentRow {
  id: string; bill_id: string; amount: string; method: ApPaymentMethod;
  paid_at: string; reference: string | null; memo: string | null;
  source_account_id: string | null; created_by: string | null;
}

const vendorName = (r: DbBillRow): string => Array.isArray(r.finance_ap_vendors) ? (r.finance_ap_vendors[0]?.name ?? '—') : (r.finance_ap_vendors?.name ?? '—');

function toVendorDto(r: DbVendorRow): ApVendorDto {
  return {
    id: r.id, vendorNo: r.vendor_no, name: r.name, registrationNo: r.registration_no,
    contactName: r.contact_name, contactEmail: r.contact_email, contactPhone: r.contact_phone,
    paymentTermsDays: r.payment_terms_days, defaultGlAccountCode: r.default_gl_account_code,
    defaultCostCenterId: r.default_cost_center_id ?? null,
    defaultCurrency: r.default_currency ?? 'TTD',
    preferredPaymentMethod: (r.preferred_payment_method as ApPaymentMethod | null) ?? null,
    status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function toVendorBankAccountDto(r: DbVendorBankAccountRow): ApVendorBankAccountDto {
  return {
    id: r.id, vendorId: r.vendor_id, bankName: r.bank_name, accountName: r.account_name,
    accountNumber: r.account_number, routingCode: r.routing_code, iban: r.iban,
    swift: r.swift, currency: r.currency, isDefault: r.is_default,
    status: r.status, createdAt: r.created_at,
  };
}
function toBillDto(r: DbBillRow): ApBillDto {
  const total = Number(r.total_amount), paid = Number(r.paid_amount);
  return { id: r.id, billNo: r.bill_no, vendorId: r.vendor_id, vendorName: vendorName(r), billDate: r.bill_date, dueDate: r.due_date, description: r.description, totalAmount: total, paidAmount: paid, balance: total - paid, currency: r.currency, status: r.status, glAccountCode: r.gl_account_code, approvedBy: r.approved_by, createdBy: r.created_by, rejectReason: r.reject_reason, voidReason: r.void_reason, workflowId: r.workflow_id, createdAt: r.created_at, updatedAt: r.updated_at };
}
const toLineDto = (r: DbLineRow): ApBillLineDto => ({ id: r.id, billId: r.bill_id, lineNo: r.line_no, description: r.description, amount: Number(r.amount), glAccountCode: r.gl_account_code, costCenterId: r.cost_center_id });
const toPaymentDto = (r: DbPaymentRow): ApPaymentDto => ({
  id: r.id, billId: r.bill_id, amount: Number(r.amount), method: r.method,
  paidAt: r.paid_at, reference: r.reference,
  memo: r.memo ?? null, sourceAccountId: r.source_account_id ?? null,
  createdBy: r.created_by,
});

const err = (msg: string, status = 500): Error & { status: number } => Object.assign(new Error(msg), { status });

// ── Queries ─────────────────────────────────────────────────────────────────

export interface BillListOpts {
  status?: ApBillStatus | 'overdue'; vendorId?: string; search?: string;
  dueFrom?: string; dueTo?: string; amountMin?: number; amountMax?: number;
  glAccountCode?: string; approverId?: string; page?: number; pageSize?: number;
}
export interface BillListResult { rows: ApBillDto[]; total: number; page: number; pageCount: number; pageSize: number; }

export async function listBills(opts: BillListOpts = {}): Promise<BillListResult> {
  const page = Math.max(0, opts.page ?? 0);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 10));
  const today = new Date().toISOString().slice(0, 10);
  let q = sb.from('finance_ap_bills').select('*, finance_ap_vendors(name)', { count: 'exact' }).order('bill_date', { ascending: false });
  if (opts.status === 'overdue') q = q.in('status', ['approved', 'partially_paid']).lt('due_date', today);
  else if (opts.status) q = q.eq('status', opts.status);
  if (opts.vendorId) q = q.eq('vendor_id', opts.vendorId);
  if (opts.glAccountCode) q = q.eq('gl_account_code', opts.glAccountCode);
  if (opts.approverId) q = q.eq('approved_by', opts.approverId);
  if (opts.dueFrom) q = q.gte('due_date', opts.dueFrom);
  if (opts.dueTo) q = q.lte('due_date', opts.dueTo);
  if (opts.amountMin != null) q = q.gte('total_amount', opts.amountMin);
  if (opts.amountMax != null) q = q.lte('total_amount', opts.amountMax);
  if (opts.search) q = q.or(`bill_no.ilike.%${opts.search}%,description.ilike.%${opts.search}%`);
  const { data, error, count } = await q.range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw err('listBills: ' + error.message);
  const total = count ?? 0;
  return { rows: ((data ?? []) as DbBillRow[]).map(toBillDto), total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)), pageSize };
}

export async function getBillDetail(id: string): Promise<{ bill: ApBillDto; lines: ApBillLineDto[]; payments: ApPaymentDto[] } | null> {
  const { data, error } = await sb.from('finance_ap_bills').select('*, finance_ap_vendors(name)').eq('id', id).maybeSingle<DbBillRow>();
  if (error) throw err('getBillDetail: ' + error.message);
  if (!data) return null;
  const [lines, payments] = await Promise.all([
    sb.from('finance_ap_bill_lines').select('*').eq('bill_id', id).order('line_no'),
    sb.from('finance_ap_payments').select('*').eq('bill_id', id).order('paid_at', { ascending: false }),
  ]);
  return { bill: toBillDto(data), lines: ((lines.data ?? []) as DbLineRow[]).map(toLineDto), payments: ((payments.data ?? []) as DbPaymentRow[]).map(toPaymentDto) };
}

export async function listVendors(opts: { status?: ApVendorStatus } = {}): Promise<ApVendorDto[]> {
  let q = sb.from('finance_ap_vendors').select('*').order('name');
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw err('listVendors: ' + error.message);
  return ((data ?? []) as DbVendorRow[]).map(toVendorDto);
}

export async function listPayments(): Promise<Array<ApPaymentDto & { billNo: string }>> {
  const { data, error } = await sb.from('finance_ap_payments').select('*, finance_ap_bills(bill_no)').order('paid_at', { ascending: false }).limit(50);
  if (error) throw err('listPayments: ' + error.message);
  return ((data ?? []) as Array<DbPaymentRow & { finance_ap_bills?: { bill_no: string } | { bill_no: string }[] | null }>).map(r => ({ ...toPaymentDto(r), billNo: Array.isArray(r.finance_ap_bills) ? (r.finance_ap_bills[0]?.bill_no ?? '—') : (r.finance_ap_bills?.bill_no ?? '—') }));
}

export interface ApKpis {
  totalPayable: number; overdue: number; overdueCount: number;
  dueThisWeek: number; dueThisWeekCount: number;
  onTimeRatePct: number; openBills: number; vendorCount: number; pendingApprovalCount: number;
}

export async function getApKpis(): Promise<ApKpis> {
  const today = new Date().toISOString().slice(0, 10);
  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [open, vendors, pending, paidRecent] = await Promise.all([
    sb.from('finance_ap_bills').select('total_amount, paid_amount, due_date, status').in('status', ['approved', 'partially_paid']),
    sb.from('finance_ap_vendors').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('finance_ap_bills').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    sb.from('finance_ap_bills').select('due_date, updated_at').eq('status', 'paid').gte('bill_date', new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)),
  ]);
  const openRows = (open.data ?? []) as Array<{ total_amount: string; paid_amount: string; due_date: string | null; status: string }>;
  let totalPayable = 0, overdue = 0, overdueCount = 0, dueThisWeek = 0, dueThisWeekCount = 0, openBills = 0;
  for (const r of openRows) {
    const bal = Number(r.total_amount) - Number(r.paid_amount);
    if (bal <= 0) continue;
    openBills++; totalPayable += bal;
    if (r.due_date && r.due_date < today) { overdue += bal; overdueCount++; }
    else if (r.due_date && r.due_date <= weekAhead) { dueThisWeek += bal; dueThisWeekCount++; }
  }
  const paidRows = (paidRecent.data ?? []) as Array<{ due_date: string | null; updated_at: string | null }>;
  const onTime = paidRows.filter(r => !r.due_date || !r.updated_at || r.updated_at.slice(0, 10) <= r.due_date).length;
  const onTimeRatePct = paidRows.length > 0 ? Math.round((onTime / paidRows.length) * 100) : 100;
  return { totalPayable, overdue, overdueCount, dueThisWeek, dueThisWeekCount, onTimeRatePct, openBills, vendorCount: vendors.count ?? 0, pendingApprovalCount: pending.count ?? 0 };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface ApTrend { labels: string[]; billed: number[]; paid: number[]; }

/** Last 6 months: billed = bills by bill_date; paid = payments by paid_at. Real rows only. */
export async function getApTrend(): Promise<ApTrend> {
  const now = new Date();
  const windows = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i) + 1, 1));
    return { startIso: start.toISOString(), endIso: end.toISOString(), startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), label: MONTH_LABELS[start.getUTCMonth()]! };
  });
  const [bills, payments] = await Promise.all([
    sb.from('finance_ap_bills').select('bill_date, total_amount').not('status', 'in', '(draft,void,rejected)').gte('bill_date', windows[0]!.startDate),
    sb.from('finance_ap_payments').select('paid_at, amount').gte('paid_at', windows[0]!.startIso),
  ]);
  const billed = windows.map(() => 0), paid = windows.map(() => 0);
  for (const r of (bills.data ?? []) as Array<{ bill_date: string; total_amount: string }>) {
    const idx = windows.findIndex(w => r.bill_date >= w.startDate && r.bill_date < w.endDate);
    if (idx >= 0) billed[idx]! += Number(r.total_amount);
  }
  for (const r of (payments.data ?? []) as Array<{ paid_at: string; amount: string }>) {
    const idx = windows.findIndex(w => r.paid_at >= w.startIso && r.paid_at < w.endIso);
    if (idx >= 0) paid[idx]! += Number(r.amount);
  }
  return { labels: windows.map(w => w.label), billed, paid };
}

export interface AgingBucket { label: string; amount: number; count: number; }
export async function getAging(): Promise<AgingBucket[]> {
  const today = Date.now();
  const { data, error } = await sb.from('finance_ap_bills').select('total_amount, paid_amount, due_date').in('status', ['approved', 'partially_paid']);
  if (error) throw err('getAging: ' + error.message);
  const buckets: AgingBucket[] = [
    { label: 'Current', amount: 0, count: 0 }, { label: '1–30 days', amount: 0, count: 0 },
    { label: '31–60 days', amount: 0, count: 0 }, { label: '60+ days', amount: 0, count: 0 },
  ];
  for (const r of (data ?? []) as Array<{ total_amount: string; paid_amount: string; due_date: string | null }>) {
    const bal = Number(r.total_amount) - Number(r.paid_amount);
    if (bal <= 0) continue;
    const daysOverdue = r.due_date ? Math.floor((today - new Date(r.due_date).getTime()) / 86_400_000) : -1;
    const idx = daysOverdue <= 0 ? 0 : daysOverdue <= 30 ? 1 : daysOverdue <= 60 ? 2 : 3;
    buckets[idx]!.amount += bal; buckets[idx]!.count++;
  }
  return buckets;
}

// ── Vendors ─────────────────────────────────────────────────────────────────

export interface CreateVendorInput {
  name: string; registrationNo?: string; contactName?: string;
  contactEmail?: string; contactPhone?: string; paymentTermsDays?: number;
  defaultGlAccountCode?: string; defaultCostCenterId?: string;
  defaultCurrency?: string; preferredPaymentMethod?: ApPaymentMethod;
  status?: ApVendorStatus;
  bankAccount?: {
    bankName: string; accountName: string; accountNumber: string;
    routingCode?: string; iban?: string; swift?: string; currency?: string;
  };
  actorId: string;
}

export async function createVendor(input: CreateVendorInput): Promise<ApVendorDto> {
  // Check name uniqueness
  const { count } = await sb.from('finance_ap_vendors').select('id', { count: 'exact', head: true }).ilike('name', input.name);
  if ((count ?? 0) > 0) throw err(`A vendor named "${input.name}" already exists.`, 409);

  const vendorNo = await nextRef('APV');
  const { data, error } = await sb.from('finance_ap_vendors').insert({
    vendor_no: vendorNo, name: input.name,
    registration_no:        input.registrationNo ?? null,
    contact_name:           input.contactName ?? null,
    contact_email:          input.contactEmail ?? null,
    contact_phone:          input.contactPhone ?? null,
    payment_terms_days:     input.paymentTermsDays ?? 30,
    default_gl_account_code: input.defaultGlAccountCode ?? null,
    default_cost_center_id: input.defaultCostCenterId ?? null,
    default_currency:       input.defaultCurrency ?? 'TTD',
    preferred_payment_method: input.preferredPaymentMethod ?? null,
    status:                 input.status ?? 'active',
    created_by:             input.actorId,
  }).select().single<DbVendorRow>();
  if (error) throw err('createVendor: ' + error.message);
  const row = toVendorDto(data);

  // Optionally create a bank account in the same operation
  if (input.bankAccount) {
    const { error: baErr } = await sb.from('finance_ap_vendor_bank_accounts').insert({
      vendor_id:      row.id,
      bank_name:      input.bankAccount.bankName,
      account_name:   input.bankAccount.accountName,
      account_number: input.bankAccount.accountNumber,
      routing_code:   input.bankAccount.routingCode ?? null,
      iban:           input.bankAccount.iban ?? null,
      swift:          input.bankAccount.swift ?? null,
      currency:       input.bankAccount.currency ?? row.defaultCurrency,
      is_default:     true,
      created_by:     input.actorId,
    });
    if (baErr) {
      // Compensating rollback: delete the vendor we just created
      await sb.from('finance_ap_vendors').delete().eq('id', row.id);
      throw err('createVendor bank account: ' + baErr.message + ' — vendor rolled back.');
    }
  }

  void emitAppEvent({ eventType: 'finance.vendor.created', sourceModule: SUBMODULE, sourceEntityType: 'vendor', sourceEntityId: row.id, actorUserId: input.actorId, severity: 'info', payload: { vendorNo: row.vendorNo, name: row.name } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: row.id, actorId: input.actorId, action: 'vendor.created', previousState: null, newState: { vendorNo: row.vendorNo, name: row.name, status: row.status } });
  return row;
}

export interface UpdateVendorInput {
  id: string; name?: string; registrationNo?: string | null; contactName?: string | null;
  contactEmail?: string | null; contactPhone?: string | null; paymentTermsDays?: number;
  defaultGlAccountCode?: string | null; defaultCostCenterId?: string | null;
  defaultCurrency?: string; preferredPaymentMethod?: ApPaymentMethod | null;
  status?: ApVendorStatus; actorId: string;
}

export async function updateVendor(input: UpdateVendorInput): Promise<ApVendorDto> {
  const { id, actorId, ...fields } = input;
  const existing = await sb.from('finance_ap_vendors').select('*').eq('id', id).maybeSingle<DbVendorRow>();
  if (!existing.data) throw err('Vendor not found.', 404);
  const prev = toVendorDto(existing.data);

  // Name uniqueness check (if name is changing)
  if (fields.name && fields.name !== prev.name) {
    const { count } = await sb.from('finance_ap_vendors').select('id', { count: 'exact', head: true }).ilike('name', fields.name).neq('id', id);
    if ((count ?? 0) > 0) throw err(`A vendor named "${fields.name}" already exists.`, 409);
  }

  const updates: Record<string, unknown> = {};
  if (fields.name           !== undefined) updates['name']                    = fields.name;
  if (fields.registrationNo !== undefined) updates['registration_no']         = fields.registrationNo;
  if (fields.contactName    !== undefined) updates['contact_name']            = fields.contactName;
  if (fields.contactEmail   !== undefined) updates['contact_email']           = fields.contactEmail;
  if (fields.contactPhone   !== undefined) updates['contact_phone']           = fields.contactPhone;
  if (fields.paymentTermsDays !== undefined) updates['payment_terms_days']    = fields.paymentTermsDays;
  if (fields.defaultGlAccountCode !== undefined) updates['default_gl_account_code'] = fields.defaultGlAccountCode;
  if (fields.defaultCostCenterId !== undefined) updates['default_cost_center_id'] = fields.defaultCostCenterId;
  if (fields.defaultCurrency !== undefined) updates['default_currency']       = fields.defaultCurrency;
  if (fields.preferredPaymentMethod !== undefined) updates['preferred_payment_method'] = fields.preferredPaymentMethod;
  if (fields.status         !== undefined) updates['status']                  = fields.status;

  const { data, error } = await sb.from('finance_ap_vendors').update(updates).eq('id', id).select().single<DbVendorRow>();
  if (error) throw err('updateVendor: ' + error.message);
  const row = toVendorDto(data);

  void emitAppEvent({ eventType: 'finance.vendor.updated', sourceModule: SUBMODULE, sourceEntityType: 'vendor', sourceEntityId: id, actorUserId: actorId, severity: 'info', payload: { vendorNo: row.vendorNo, changes: Object.keys(updates) } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: id, actorId, action: 'vendor.updated', previousState: prev, newState: row });
  return row;
}

export async function getVendorDetail(id: string): Promise<{ vendor: ApVendorDto; bankAccounts: ApVendorBankAccountDto[] } | null> {
  const [vendorRes, bankRes] = await Promise.all([
    sb.from('finance_ap_vendors').select('*').eq('id', id).maybeSingle<DbVendorRow>(),
    sb.from('finance_ap_vendor_bank_accounts').select('*').eq('vendor_id', id).order('is_default', { ascending: false }),
  ]);
  if (vendorRes.error) throw err('getVendorDetail: ' + vendorRes.error.message);
  if (!vendorRes.data) return null;
  return {
    vendor: toVendorDto(vendorRes.data),
    bankAccounts: ((bankRes.data ?? []) as DbVendorBankAccountRow[]).map(toVendorBankAccountDto),
  };
}

export async function listVendorBills(vendorId: string): Promise<ApBillDto[]> {
  const { data, error } = await sb.from('finance_ap_bills').select('*, finance_ap_vendors(name)').eq('vendor_id', vendorId).order('bill_date', { ascending: false }).limit(50);
  if (error) throw err('listVendorBills: ' + error.message);
  return ((data ?? []) as DbBillRow[]).map(toBillDto);
}

export async function listVendorPayments(vendorId: string): Promise<Array<ApPaymentDto & { billNo: string }>> {
  // Payments joined via their bill to the vendor
  const { data, error } = await sb
    .from('finance_ap_payments')
    .select('*, finance_ap_bills!inner(bill_no, vendor_id)')
    .eq('finance_ap_bills.vendor_id', vendorId)
    .order('paid_at', { ascending: false })
    .limit(50);
  if (error) throw err('listVendorPayments: ' + error.message);
  return ((data ?? []) as Array<DbPaymentRow & { finance_ap_bills?: { bill_no: string } | { bill_no: string }[] | null }>).map(r => ({
    ...toPaymentDto(r),
    billNo: Array.isArray(r.finance_ap_bills) ? (r.finance_ap_bills[0]?.bill_no ?? '—') : (r.finance_ap_bills?.bill_no ?? '—'),
  }));
}

// ── Bills ───────────────────────────────────────────────────────────────────

export interface BillLineInput {
  description: string; quantity?: number; unitPrice?: number; amount?: number;
  glAccountCode?: string; costCenterId?: string | null; taxCode?: string; projectId?: string | null;
}
export interface CreateBillInput {
  vendorId: string; billDate: string; dueDate?: string; description?: string;
  vendorInvoiceNo?: string; reference?: string; currency?: string; paymentTermsDays?: number;
  glAccountCode?: string; lines: BillLineInput[];
  taxIncluded?: boolean; taxAmount?: number; withholdingTaxCode?: string;
  submitForApproval?: boolean; duplicateOverrideReason?: string; actorId: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
/** A line's amount = explicit amount, else quantity × unit price. */
const lineAmount = (l: BillLineInput): number => (l.amount != null ? l.amount : round2((l.quantity ?? 1) * (l.unitPrice ?? 0)));

export interface DuplicateMatch {
  billId: string; billNo: string; vendorInvoiceNo: string | null; totalAmount: number;
  billDate: string; status: ApBillStatus; reason: 'invoice_no' | 'amount_date';
}

/** Possible duplicate bills for a vendor: same invoice number, or same amount + date.
 *  Read-only — powers the wizard's duplicate-check step and createBill's pre-commit guard. */
export async function checkBillDuplicate(input: { vendorId: string; vendorInvoiceNo?: string; totalAmount?: number; billDate?: string }): Promise<DuplicateMatch[]> {
  type R = { id: string; bill_no: string; vendor_invoice_no: string | null; total_amount: string; bill_date: string; status: ApBillStatus };
  const matches = new Map<string, DuplicateMatch>();
  const add = (r: R, reason: DuplicateMatch['reason']): void => {
    if (!matches.has(r.id)) matches.set(r.id, { billId: r.id, billNo: r.bill_no, vendorInvoiceNo: r.vendor_invoice_no, totalAmount: Number(r.total_amount), billDate: r.bill_date, status: r.status, reason });
  };
  if (input.vendorInvoiceNo?.trim()) {
    const { data } = await sb.from('finance_ap_bills').select('id, bill_no, vendor_invoice_no, total_amount, bill_date, status')
      .eq('vendor_id', input.vendorId).eq('vendor_invoice_no', input.vendorInvoiceNo.trim()).not('status', 'in', '(void,rejected)');
    for (const r of (data ?? []) as R[]) add(r, 'invoice_no');
  }
  if (input.totalAmount != null && input.billDate) {
    const { data } = await sb.from('finance_ap_bills').select('id, bill_no, vendor_invoice_no, total_amount, bill_date, status')
      .eq('vendor_id', input.vendorId).eq('bill_date', input.billDate).eq('total_amount', input.totalAmount).not('status', 'in', '(void,rejected)');
    for (const r of (data ?? []) as R[]) add(r, 'amount_date');
  }
  return [...matches.values()];
}

export async function createBill(input: CreateBillInput): Promise<ApBillDto> {
  if (!input.lines.length) throw err('At least one bill line is required.', 422);
  if (input.lines.some(l => !l.description?.trim())) throw err('Every line needs a description.', 422);
  const subtotal = round2(input.lines.reduce((s, l) => s + lineAmount(l), 0));
  if (subtotal <= 0) throw err('Bill total must be greater than zero.', 422);
  const taxAmount = round2(input.taxAmount ?? 0);
  const total = round2(subtotal + taxAmount);

  // Pre-commit duplicate guard — blocks unless an override reason is supplied.
  let overrideDupes: DuplicateMatch[] = [];
  if (!input.duplicateOverrideReason?.trim()) {
    const dupes = await checkBillDuplicate({ vendorId: input.vendorId, vendorInvoiceNo: input.vendorInvoiceNo, totalAmount: total, billDate: input.billDate });
    if (dupes.length) throw err(`Possible duplicate: bill ${dupes[0]!.billNo} already exists for this vendor (${dupes[0]!.reason === 'invoice_no' ? 'same invoice number' : 'same amount + date'}). Supply an override reason to proceed.`, 409);
  } else {
    // Record what we're overriding so it appears in the review queue
    overrideDupes = await checkBillDuplicate({ vendorId: input.vendorId, vendorInvoiceNo: input.vendorInvoiceNo, totalAmount: total, billDate: input.billDate });
  }

  const billNo = await nextRef('BILL');
  const { data, error } = await sb.from('finance_ap_bills').insert({
    bill_no: billNo, vendor_id: input.vendorId, bill_date: input.billDate, due_date: input.dueDate ?? null,
    description: input.description ?? null, total_amount: total, subtotal_amount: subtotal, tax_amount: taxAmount,
    tax_included: input.taxIncluded ?? false, withholding_tax_code: input.withholdingTaxCode ?? null,
    vendor_invoice_no: input.vendorInvoiceNo?.trim() || null, reference: input.reference?.trim() || null,
    currency: input.currency ?? 'TTD', payment_terms_days: input.paymentTermsDays ?? null,
    status: 'draft', gl_account_code: input.glAccountCode ?? null, created_by: input.actorId,
  }).select('*, finance_ap_vendors(name)').single<DbBillRow>();
  if (error) throw err('createBill: ' + error.message);
  const row = toBillDto(data);

  const { error: lineErr } = await sb.from('finance_ap_bill_lines').insert(
    input.lines.map((l, i) => ({
      bill_id: row.id, line_no: i + 1, description: l.description.trim(), amount: lineAmount(l),
      quantity: l.quantity ?? 1, unit_price: l.unitPrice ?? lineAmount(l),
      gl_account_code: l.glAccountCode ?? input.glAccountCode ?? null, cost_center_id: l.costCenterId ?? null,
      tax_code: l.taxCode ?? null, project_id: l.projectId ?? null,
    })),
  );
  if (lineErr) {
    await sb.from('finance_ap_bills').delete().eq('id', row.id);   // compensating rollback
    throw err('createBill lines: ' + lineErr.message + ' — bill rolled back.');
  }

  void emitAppEvent({ eventType: 'finance.ap.bill.created', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: row.id, actorUserId: input.actorId, severity: 'info', payload: { billNo: row.billNo, vendorName: row.vendorName, totalAmount: row.totalAmount, lineCount: input.lines.length } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: row.id, actorId: input.actorId, action: 'bill.created', previousState: null, newState: { billNo: row.billNo, status: 'draft', totalAmount: row.totalAmount, lineCount: input.lines.length } });

  // Persist duplicate override reviews so they appear in the review queue
  if (overrideDupes.length && input.duplicateOverrideReason?.trim()) {
    for (const dupe of overrideDupes) {
      void persistDuplicateOverride({
        originalBillId: row.id, duplicateBillId: dupe.billId,
        matchType: dupe.reason === 'invoice_no' ? 'exact_invoice' : 'amount_date',
        actorId: input.actorId, reason: input.duplicateOverrideReason.trim(),
      });
    }
  }

  // Submit-on-create (perm-checked at the route) — routes through the workflow.
  if (input.submitForApproval) return submitBill(row.id, input.actorId);
  return row;
}

async function requireBill(id: string): Promise<ApBillDto> {
  const { data, error } = await sb.from('finance_ap_bills').select('*, finance_ap_vendors(name)').eq('id', id).maybeSingle<DbBillRow>();
  if (error) throw err('bill lookup: ' + error.message);
  if (!data) throw err('Bill not found.', 404);
  return toBillDto(data);
}

export async function submitBill(id: string, actorId: string): Promise<ApBillDto> {
  const existing = await requireBill(id);
  if (existing.status !== 'draft') throw err('Only draft bills can be submitted for approval.', 422);
  const { data, error } = await sb.from('finance_ap_bills').update({ status: 'submitted' }).eq('id', id).select('*, finance_ap_vendors(name)').single<DbBillRow>();
  if (error) throw err('submitBill: ' + error.message);
  const row = toBillDto(data);
  void emitAppEvent({ eventType: 'finance.ap.bill.submitted', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: id, actorUserId: actorId, severity: 'info', payload: { billNo: row.billNo, totalAmount: row.totalAmount } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: id, actorId, action: 'bill.submitted', previousState: { status: 'draft' }, newState: { status: 'submitted' } });

  const ctx: ModuleWorkflowContext = { moduleKey: 'finance_ap', workflowType: 'finance_ap_approval', triggerEvent: 'finance.ap.bill.submitted', sourceRecordId: id, sourceRecordRef: row.billNo, requestedBy: actorId, priority: 'normal', recordData: { billNo: row.billNo, vendorName: row.vendorName, totalAmount: row.totalAmount } };
  try {
    const wf = await startWorkflowForRecord({ context: ctx, actor: { id: actorId } });
    if (wf?.id) await sb.from('finance_ap_bills').update({ workflow_id: wf.id }).eq('id', id);
  } catch (wfErr) {
    await sb.from('finance_ap_bills').update({ status: 'draft' }).eq('id', id);
    throw err('Workflow start failed — bill rolled back to draft: ' + String(wfErr));
  }
  return row;
}

export async function approveBill(id: string, actorId: string): Promise<ApBillDto> {
  const existing = await requireBill(id);
  if (existing.status !== 'submitted') throw err('Only submitted bills can be approved.', 422);
  assertDifferentApprover({ actorId, createdBy: existing.createdBy, action: 'approve a bill they created' });
  const { data, error } = await sb.from('finance_ap_bills').update({ status: 'approved', approved_by: actorId }).eq('id', id).select('*, finance_ap_vendors(name)').single<DbBillRow>();
  if (error) throw err('approveBill: ' + error.message);
  const row = toBillDto(data);
  void emitAppEvent({ eventType: 'finance.ap.bill.approved', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { billNo: row.billNo, totalAmount: row.totalAmount } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: id, actorId, action: 'bill.approved', previousState: { status: 'submitted' }, newState: { status: 'approved' } });
  return row;
}

export async function rejectBill(id: string, actorId: string, reason: string): Promise<ApBillDto> {
  if (!reason?.trim()) throw err('A reason is required to reject a bill.', 422);
  const existing = await requireBill(id);
  if (existing.status !== 'submitted') throw err('Only submitted bills can be rejected.', 422);
  const { data, error } = await sb.from('finance_ap_bills').update({ status: 'rejected', reject_reason: reason.trim() }).eq('id', id).select('*, finance_ap_vendors(name)').single<DbBillRow>();
  if (error) throw err('rejectBill: ' + error.message);
  const row = toBillDto(data);
  void emitAppEvent({ eventType: 'finance.ap.bill.rejected', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: id, actorUserId: actorId, severity: 'warning', payload: { billNo: row.billNo, reason } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: id, actorId, action: 'bill.rejected', previousState: { status: 'submitted' }, newState: { status: 'rejected' }, reason });
  return row;
}

export interface RecordPaymentInput {
  amount: number;
  method?: ApPaymentMethod;
  /** ISO-8601 date string (YYYY-MM-DD); defaults to today. */
  paymentDate?: string;
  /** Required for EFT / ACH / wire transfers. */
  reference?: string;
  memo?: string;
  /** UUID of the source bank account (requires migration 000030). */
  sourceAccountId?: string;
}

const REQUIRES_REFERENCE: ApPaymentMethod[] = ['eft', 'ach', 'wire'];

export async function recordPayment(id: string, actorId: string, input: RecordPaymentInput): Promise<ApBillDto> {
  const existing = await requireBill(id);
  if (!['approved', 'partially_paid'].includes(existing.status)) throw err('Only approved bills can be paid.', 422);
  if (input.amount <= 0) throw err('Payment amount must be greater than zero.', 422);
  if (input.amount > existing.balance + 0.005) throw err(`Payment ($${input.amount.toFixed(2)}) exceeds the outstanding balance ($${existing.balance.toFixed(2)}).`, 422);

  const method: ApPaymentMethod = input.method ?? 'eft';
  if (REQUIRES_REFERENCE.includes(method) && !input.reference?.trim()) {
    throw err(`A payment reference is required for ${method.toUpperCase()} transfers.`, 422);
  }

  const paidAt = input.paymentDate
    ? new Date(input.paymentDate).toISOString()
    : new Date().toISOString();

  // Build the insert payload. Extra columns (memo, source_account_id) are
  // added by migration 000030; they are omitted here to avoid PostgREST errors
  // on un-migrated environments. Once migration 000030 is applied the operator
  // should restart and re-run the E2E gate which will exercise these fields.
  const insertPayload: Record<string, unknown> = {
    bill_id: id, amount: input.amount, method, paid_at: paidAt,
    reference: input.reference?.trim() ?? null, created_by: actorId,
  };
  // Include extended fields only when provided (safe on both pre- and post-migration)
  if (input.memo)            insertPayload['memo']              = input.memo.trim();
  if (input.sourceAccountId) insertPayload['source_account_id'] = input.sourceAccountId;

  const { error: payErr } = await sb.from('finance_ap_payments').insert(insertPayload);
  if (payErr) throw err('recordPayment: ' + payErr.message);

  const newPaid = existing.paidAmount + input.amount;
  const newStatus: ApBillStatus = newPaid + 0.005 >= existing.totalAmount ? 'paid' : 'partially_paid';
  const { data, error } = await sb.from('finance_ap_bills').update({ paid_amount: newPaid, status: newStatus }).eq('id', id).select('*, finance_ap_vendors(name)').single<DbBillRow>();
  if (error) throw err('recordPayment update: ' + error.message);
  const row = toBillDto(data);
  void emitAppEvent({ eventType: 'finance.ap.bill.payment_recorded', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { billNo: row.billNo, amount: input.amount, status: newStatus } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: id, actorId, action: 'bill.payment_recorded', previousState: { status: existing.status, paidAmount: existing.paidAmount }, newState: { status: newStatus, paidAmount: newPaid } });
  return row;
}

export async function voidBill(id: string, actorId: string, reason: string): Promise<ApBillDto> {
  if (!reason?.trim()) throw err('A reason is required to void a bill.', 422);
  const existing = await requireBill(id);
  if (['paid', 'void'].includes(existing.status)) throw err('Paid or already-void bills cannot be voided.', 422);
  const { data, error } = await sb.from('finance_ap_bills').update({ status: 'void', void_reason: reason.trim() }).eq('id', id).select('*, finance_ap_vendors(name)').single<DbBillRow>();
  if (error) throw err('voidBill: ' + error.message);
  const row = toBillDto(data);
  void emitAppEvent({ eventType: 'finance.ap.bill.voided', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: id, actorUserId: actorId, severity: 'warning', payload: { billNo: row.billNo, reason } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: id, actorId, action: 'bill.voided', previousState: { status: existing.status }, newState: { status: 'void' }, reason });
  return row;
}

// ── Drawer detail: audit trail + comments ─────────────────────────────────────

/** Resolve app_users.id → full_name for actor/author display (never raw ids). */
async function resolveUserNames(ids: Array<string | null>): Promise<Map<string, string | null>> {
  const uniq = [...new Set(ids)].filter((x): x is string => !!x);
  if (!uniq.length) return new Map();
  const { data } = await sb.from('app_users').select('id, full_name').in('id', uniq);
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name]));
}

export interface ApAuditEntry {
  id: string; action: string; actorId: string | null; actorName: string | null;
  previousState: unknown; newState: unknown; reason: string | null; createdAt: string;
}

/** Immutable audit trail for a bill (from hr_audit_log, submodule finance_ap). */
export async function listBillAudit(billId: string): Promise<ApAuditEntry[]> {
  const { data, error } = await sb.from('hr_audit_log')
    .select('id, action, actor_id, previous_state, new_state, reason, created_at')
    .eq('submodule_key', SUBMODULE).eq('record_id', billId)
    .order('created_at', { ascending: false });
  if (error) throw err('listBillAudit: ' + error.message);
  const rows = (data ?? []) as Array<{ id: string; action: string; actor_id: string | null; previous_state: unknown; new_state: unknown; reason: string | null; created_at: string }>;
  const names = await resolveUserNames(rows.map(r => r.actor_id));
  return rows.map(r => ({ id: r.id, action: r.action, actorId: r.actor_id, actorName: r.actor_id ? (names.get(r.actor_id) ?? null) : null, previousState: r.previous_state, newState: r.new_state, reason: r.reason, createdAt: r.created_at }));
}

export interface ApCommentDto { id: string; billId: string; body: string; authorId: string; authorName: string | null; isInternal: boolean; createdAt: string; }

interface DbCommentRow { id: string; bill_id: string; body: string; author_id: string; is_internal: boolean; created_at: string; }
const toCommentDto = (r: DbCommentRow, names: Map<string, string | null>): ApCommentDto =>
  ({ id: r.id, billId: r.bill_id, body: r.body, authorId: r.author_id, authorName: names.get(r.author_id) ?? null, isInternal: r.is_internal, createdAt: r.created_at });

export async function listBillComments(billId: string): Promise<ApCommentDto[]> {
  const { data, error } = await sb.from('finance_ap_comments')
    .select('id, bill_id, body, author_id, is_internal, created_at')
    .eq('bill_id', billId).order('created_at', { ascending: true });
  if (error) throw err('listBillComments: ' + error.message);
  const rows = (data ?? []) as DbCommentRow[];
  const names = await resolveUserNames(rows.map(r => r.author_id));
  return rows.map(r => toCommentDto(r, names));
}

export async function createBillComment(billId: string, actorId: string, body: string, isInternal = false): Promise<ApCommentDto> {
  if (!body?.trim()) throw err('A comment cannot be empty.', 422);
  await requireBill(billId);   // 404 if the bill is missing
  const { data, error } = await sb.from('finance_ap_comments')
    .insert({ bill_id: billId, body: body.trim(), author_id: actorId, is_internal: isInternal })
    .select('id, bill_id, body, author_id, is_internal, created_at').single<DbCommentRow>();
  if (error) throw err('createBillComment: ' + error.message);
  void emitAppEvent({ eventType: 'finance.ap.bill.comment_added', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: billId, actorUserId: actorId, severity: 'info', payload: { commentId: data.id, isInternal } });
  const names = await resolveUserNames([actorId]);
  return toCommentDto(data, names);
}

// ── Chunk 7 — Duplicate Reviews ───────────────────────────────────────────────

export interface ApDuplicateReviewDto {
  id: string;
  originalBillId: string; originalBillNo: string | null;
  duplicateBillId: string | null; duplicateBillNo: string | null;
  matchType: 'exact_invoice' | 'amount_date' | 'similar_invoice' | 'attachment_hash';
  confidence: 'high' | 'medium' | 'low';
  status: 'pending' | 'resolved_duplicate' | 'resolved_distinct';
  resolutionNote: string | null; resolvedBy: string | null; resolvedAt: string | null;
  createdAt: string;
}

interface DbDupReviewRow {
  id: string; original_bill_id: string; duplicate_bill_id: string | null;
  match_type: string; confidence: string; status: string;
  resolution_note: string | null; resolved_by: string | null; resolved_at: string | null;
  created_at: string;
  original_bill?: { bill_no: string } | { bill_no: string }[] | null;
  duplicate_bill?: { bill_no: string } | { bill_no: string }[] | null;
}

function toDupReviewDto(r: DbDupReviewRow): ApDuplicateReviewDto {
  const origNo = Array.isArray(r.original_bill) ? (r.original_bill[0]?.bill_no ?? null) : (r.original_bill?.bill_no ?? null);
  const dupNo  = Array.isArray(r.duplicate_bill) ? (r.duplicate_bill[0]?.bill_no ?? null) : (r.duplicate_bill?.bill_no ?? null);
  return {
    id: r.id, originalBillId: r.original_bill_id, originalBillNo: origNo,
    duplicateBillId: r.duplicate_bill_id, duplicateBillNo: dupNo,
    matchType: r.match_type as ApDuplicateReviewDto['matchType'],
    confidence: r.confidence as ApDuplicateReviewDto['confidence'],
    status: r.status as ApDuplicateReviewDto['status'],
    resolutionNote: r.resolution_note, resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at, createdAt: r.created_at,
  };
}

/** List pending duplicate risk reviews (for the banner and queue). */
export async function listDuplicateReviews(billId?: string): Promise<ApDuplicateReviewDto[]> {
  let q = sb.from('finance_ap_duplicate_reviews')
    .select('*, original_bill:original_bill_id(bill_no), duplicate_bill:duplicate_bill_id(bill_no)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (billId) q = q.eq('original_bill_id', billId);
  const { data, error } = await q;
  if (error) throw err('listDuplicateReviews: ' + error.message);
  return ((data ?? []) as DbDupReviewRow[]).map(toDupReviewDto);
}

export interface ResolveDuplicateRiskInput {
  reviewId: string;
  resolution: 'resolved_duplicate' | 'resolved_distinct';
  resolutionNote?: string;
  actorId: string;
}

/** Resolve a duplicate review.
 *  - resolved_duplicate: voids the DUPLICATE (newer) bill (not the original).
 *  - resolved_distinct: marks distinct (keeps both).
 *  Emits `finance.ap.bill.duplicate_reviewed`. */
export async function resolveDuplicateRisk(input: ResolveDuplicateRiskInput): Promise<ApDuplicateReviewDto> {
  if (!input.resolutionNote?.trim() && input.resolution === 'resolved_duplicate') {
    throw err('A resolution note is required when marking a bill as duplicate.', 422);
  }
  const { data: existing, error: lookupErr } = await sb.from('finance_ap_duplicate_reviews')
    .select('*, original_bill:original_bill_id(bill_no), duplicate_bill:duplicate_bill_id(bill_no)')
    .eq('id', input.reviewId).maybeSingle<DbDupReviewRow>();
  if (lookupErr) throw err('resolveDuplicateRisk: ' + lookupErr.message);
  if (!existing) throw err('Duplicate review not found.', 404);
  if (existing.status !== 'pending') throw err('This review has already been resolved.', 422);

  // When marking as duplicate: void the newer (duplicate) bill.
  if (input.resolution === 'resolved_duplicate' && existing.duplicate_bill_id) {
    const { error: voidErr } = await sb.from('finance_ap_bills')
      .update({ status: 'void', void_reason: `Voided by duplicate review: ${input.resolutionNote?.trim()}` })
      .eq('id', existing.duplicate_bill_id)
      .not('status', 'in', '(paid,void)');
    if (voidErr) throw err('resolveDuplicateRisk void: ' + voidErr.message);
  }

  const now = new Date().toISOString();
  const { data, error } = await sb.from('finance_ap_duplicate_reviews')
    .update({ status: input.resolution, resolution_note: input.resolutionNote?.trim() ?? null, resolved_by: input.actorId, resolved_at: now })
    .eq('id', input.reviewId)
    .select('*, original_bill:original_bill_id(bill_no), duplicate_bill:duplicate_bill_id(bill_no)')
    .single<DbDupReviewRow>();
  if (error) throw err('resolveDuplicateRisk update: ' + error.message);
  const row = toDupReviewDto(data);

  void emitAppEvent({ eventType: 'finance.ap.bill.duplicate_reviewed', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: existing.original_bill_id, actorUserId: input.actorId, severity: 'info', payload: { reviewId: row.id, resolution: input.resolution, duplicateBillId: existing.duplicate_bill_id } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: existing.original_bill_id, actorId: input.actorId, action: 'bill.duplicate_reviewed', previousState: { status: 'pending' }, newState: { status: input.resolution, resolution: input.resolution }, reason: input.resolutionNote });
  return row;
}

/** Persist a duplicate override review row when createBill is called with a duplicateOverrideReason. */
export async function persistDuplicateOverride(input: {
  originalBillId: string; duplicateBillId: string;
  matchType: 'exact_invoice' | 'amount_date'; actorId: string; reason: string;
}): Promise<void> {
  await sb.from('finance_ap_duplicate_reviews').insert({
    original_bill_id:  input.duplicateBillId, // the OLDER bill is "original"
    duplicate_bill_id: input.originalBillId,  // the NEW bill we just created is the "duplicate"
    match_type:        input.matchType,
    confidence:        'high',
    status:            'resolved_distinct',   // operator chose to proceed
    resolution_note:   input.reason,
    resolved_by:       input.actorId,
    resolved_at:       new Date().toISOString(),
  });
}

// ── Chunk 8 — Bulk Approval Queue ─────────────────────────────────────────────

export interface BulkApproveResult {
  approved: ApBillDto[];
  blocked: Array<{ bill: ApBillDto; reason: string }>;
}

/** Bulk-approve a list of submitted bills.
 *  Per-item SoD check: creator ≠ approver (blocks that item, does NOT abort the whole batch).
 *  Only 'submitted' bills are eligible; others are blocked before submit.
 *  Emits individual events per approved bill. */
export async function bulkApproveBills(billIds: string[], actorId: string): Promise<BulkApproveResult> {
  if (!billIds.length) throw err('No bills selected.', 422);

  // Load all requested bills in one query
  const { data: rows, error } = await sb.from('finance_ap_bills')
    .select('*, finance_ap_vendors(name)').in('id', billIds);
  if (error) throw err('bulkApproveBills lookup: ' + error.message);

  const bills = ((rows ?? []) as DbBillRow[]).map(toBillDto);
  const approved: ApBillDto[] = [];
  const blocked: BulkApproveResult['blocked'] = [];

  for (const bill of bills) {
    // Eligibility checks — block ineligible BEFORE writing anything
    if (bill.status !== 'submitted') { blocked.push({ bill, reason: `Bill is ${bill.status}, not submitted.` }); continue; }
    if (bill.createdBy === actorId) { blocked.push({ bill, reason: 'Segregation of duties: you submitted this bill.' }); continue; }

    const { data: updated, error: upErr } = await sb.from('finance_ap_bills')
      .update({ status: 'approved', approved_by: actorId })
      .eq('id', bill.id).eq('status', 'submitted')  // idempotent guard
      .select('*, finance_ap_vendors(name)').single<DbBillRow>();
    if (upErr || !updated) {
      blocked.push({ bill, reason: upErr?.message ?? 'Concurrent update conflict — retry.' }); continue;
    }
    const approvedBill = toBillDto(updated);
    approved.push(approvedBill);

    void emitAppEvent({ eventType: 'finance.ap.bill.approved', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: bill.id, actorUserId: actorId, severity: 'success', payload: { billNo: bill.billNo, totalAmount: bill.totalAmount, bulk: true } });
    await writeHrAudit({ submoduleKey: SUBMODULE, recordId: bill.id, actorId, action: 'bill.bulk_approved', previousState: { status: 'submitted' }, newState: { status: 'approved' } });
  }

  return { approved, blocked };
}

// ── Chunk 12 — Payment Runs ───────────────────────────────────────────────────

export type ApPaymentRunStatus = 'draft' | 'pending' | 'processing' | 'complete' | 'void';

export interface ApPaymentRunItemDto {
  id: string; runId: string; billId: string; billNo: string | null;
  vendorName: string | null; amount: number; status: 'pending' | 'paid' | 'failed';
  createdAt: string;
}

export interface ApPaymentRunDto {
  id: string; runNo: string; status: ApPaymentRunStatus;
  paymentMethod: ApPaymentMethod; payDate: string;
  totalAmount: number; currency: string; notes: string | null;
  sourceAccountId: string | null; createdBy: string | null;
  processedBy: string | null; voidedBy: string | null; voidReason: string | null;
  createdAt: string; updatedAt: string | null;
}

interface DbPaymentRunRow {
  id: string; run_no: string; status: ApPaymentRunStatus;
  payment_method: string; pay_date: string; total_amount: string; currency: string;
  notes: string | null; source_account_id: string | null;
  created_by: string | null; processed_by: string | null; voided_by: string | null;
  void_reason: string | null; created_at: string; updated_at: string | null;
}
interface DbPaymentRunItemRow {
  id: string; run_id: string; bill_id: string; amount: string; status: string; created_at: string;
  finance_ap_bills?: { bill_no: string; finance_ap_vendors?: { name: string } | { name: string }[] | null } | Array<{ bill_no: string; finance_ap_vendors?: { name: string } | { name: string }[] | null }> | null;
}

function toRunDto(r: DbPaymentRunRow): ApPaymentRunDto {
  return {
    id: r.id, runNo: r.run_no, status: r.status,
    paymentMethod: r.payment_method as ApPaymentMethod,
    payDate: r.pay_date, totalAmount: Number(r.total_amount), currency: r.currency,
    notes: r.notes, sourceAccountId: r.source_account_id,
    createdBy: r.created_by, processedBy: r.processed_by, voidedBy: r.voided_by,
    voidReason: r.void_reason, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toRunItemDto(r: DbPaymentRunItemRow): ApPaymentRunItemDto {
  const bill = Array.isArray(r.finance_ap_bills) ? r.finance_ap_bills[0] : r.finance_ap_bills;
  const vendorRaw = bill?.finance_ap_vendors;
  const vendorName = Array.isArray(vendorRaw) ? (vendorRaw[0]?.name ?? null) : (vendorRaw?.name ?? null);
  return {
    id: r.id, runId: r.run_id, billId: r.bill_id,
    billNo: bill?.bill_no ?? null, vendorName,
    amount: Number(r.amount), status: r.status as ApPaymentRunItemDto['status'],
    createdAt: r.created_at,
  };
}

export interface CreatePaymentRunInput {
  billIds: string[];
  paymentMethod: ApPaymentMethod;
  payDate: string;
  currency?: string;
  notes?: string;
  sourceAccountId?: string;
  actorId: string;
}

export async function createPaymentRun(input: CreatePaymentRunInput): Promise<ApPaymentRunDto & { items: ApPaymentRunItemDto[] }> {
  if (!input.billIds.length) throw err('Select at least one bill.', 422);

  // Load the selected bills — must all be approved (or partially_paid)
  const { data: bills, error: billsErr } = await sb.from('finance_ap_bills')
    .select('id, bill_no, total_amount, paid_amount, status, currency').in('id', input.billIds);
  if (billsErr) throw err('createPaymentRun bills: ' + billsErr.message);

  const eligible = (bills ?? []) as Array<{ id: string; bill_no: string; total_amount: string; paid_amount: string; status: string; currency: string }>;
  const ineligible = eligible.filter(b => !['approved', 'partially_paid'].includes(b.status));
  if (ineligible.length) throw err(`${ineligible.length} bill(s) are not in an approved state: ${ineligible.map(b => b.bill_no).join(', ')}.`, 422);

  const totalAmount = round2(eligible.reduce((s, b) => s + (Number(b.total_amount) - Number(b.paid_amount)), 0));
  const runNo = await nextRef('PRUN');

  const { data: run, error: runErr } = await sb.from('finance_ap_payment_runs').insert({
    run_no: runNo, status: 'pending', payment_method: input.paymentMethod,
    pay_date: input.payDate, total_amount: totalAmount,
    currency: input.currency ?? 'TTD', notes: input.notes ?? null,
    source_account_id: input.sourceAccountId ?? null, created_by: input.actorId,
  }).select().single<DbPaymentRunRow>();
  if (runErr) throw err('createPaymentRun insert: ' + runErr.message);

  // Insert run items
  const items = eligible.map(b => ({
    run_id: run.id, bill_id: b.id,
    amount: round2(Number(b.total_amount) - Number(b.paid_amount)),
    status: 'pending' as const,
  }));
  const { error: itemsErr } = await sb.from('finance_ap_payment_run_items').insert(items);
  if (itemsErr) {
    // Compensating rollback
    await sb.from('finance_ap_payment_runs').delete().eq('id', run.id);
    throw err('createPaymentRun items: ' + itemsErr.message + ' — run rolled back.');
  }

  void emitAppEvent({ eventType: 'finance.ap.payment_run.created', sourceModule: SUBMODULE, sourceEntityType: 'payment_run', sourceEntityId: run.id, actorUserId: input.actorId, severity: 'info', payload: { runNo, billCount: input.billIds.length, totalAmount } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: run.id, actorId: input.actorId, action: 'payment_run.created', previousState: null, newState: { runNo, status: 'pending', totalAmount, billCount: input.billIds.length } });

  const runDto = toRunDto(run);
  const { data: itemRows } = await sb.from('finance_ap_payment_run_items')
    .select('*, finance_ap_bills(bill_no, finance_ap_vendors(name))').eq('run_id', run.id);
  return { ...runDto, items: ((itemRows ?? []) as DbPaymentRunItemRow[]).map(toRunItemDto) };
}

export async function listPaymentRuns(opts: { status?: ApPaymentRunStatus } = {}): Promise<ApPaymentRunDto[]> {
  let q = sb.from('finance_ap_payment_runs').select('*').order('created_at', { ascending: false }).limit(50);
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw err('listPaymentRuns: ' + error.message);
  return ((data ?? []) as DbPaymentRunRow[]).map(toRunDto);
}

export async function getPaymentRunDetail(id: string): Promise<(ApPaymentRunDto & { items: ApPaymentRunItemDto[] }) | null> {
  const { data: run, error: runErr } = await sb.from('finance_ap_payment_runs').select('*').eq('id', id).maybeSingle<DbPaymentRunRow>();
  if (runErr) throw err('getPaymentRunDetail: ' + runErr.message);
  if (!run) return null;
  const { data: itemRows, error: itemsErr } = await sb.from('finance_ap_payment_run_items')
    .select('*, finance_ap_bills(bill_no, finance_ap_vendors(name))').eq('run_id', id).order('created_at');
  if (itemsErr) throw err('getPaymentRunDetail items: ' + itemsErr.message);
  return { ...toRunDto(run), items: ((itemRows ?? []) as DbPaymentRunItemRow[]).map(toRunItemDto) };
}

export async function processPaymentRun(id: string, actorId: string): Promise<ApPaymentRunDto & { items: ApPaymentRunItemDto[] }> {
  const run = await getPaymentRunDetail(id);
  if (!run) throw err('Payment run not found.', 404);
  if (run.status !== 'pending') throw err('Only pending runs can be processed.', 422);
  // SoD: creator ≠ processor
  assertDifferentApprover({ actorId, createdBy: run.createdBy, action: 'process a payment run they created' });

  // Mark run as processing
  await sb.from('finance_ap_payment_runs').update({ status: 'processing' }).eq('id', id);

  // Process each item: record a payment + mark bill paid
  for (const item of run.items) {
    const { error: payErr } = await sb.from('finance_ap_payments').insert({
      bill_id: item.billId, amount: item.amount,
      method: run.paymentMethod, paid_at: new Date(run.payDate).toISOString(),
      payment_run_id: id, created_by: actorId,
    });
    if (payErr) {
      // Non-fatal: mark item failed, continue with others
      await sb.from('finance_ap_payment_run_items').update({ status: 'failed' }).eq('id', item.id);
      continue;
    }

    // Update bill paid amount + status
    const { data: bill } = await sb.from('finance_ap_bills').select('total_amount, paid_amount').eq('id', item.billId).maybeSingle<{ total_amount: string; paid_amount: string }>();
    if (bill) {
      const newPaid = Number(bill.paid_amount) + item.amount;
      const newStatus: ApBillStatus = newPaid + 0.005 >= Number(bill.total_amount) ? 'paid' : 'partially_paid';
      await sb.from('finance_ap_bills').update({ paid_amount: newPaid, status: newStatus }).eq('id', item.billId);
    }
    await sb.from('finance_ap_payment_run_items').update({ status: 'paid' }).eq('id', item.id);
  }

  // Complete the run
  const { data: updated, error: updErr } = await sb.from('finance_ap_payment_runs')
    .update({ status: 'complete', processed_by: actorId }).eq('id', id).select().single<DbPaymentRunRow>();
  if (updErr) throw err('processPaymentRun complete: ' + updErr.message);

  void emitAppEvent({ eventType: 'finance.ap.payment_run.processed', sourceModule: SUBMODULE, sourceEntityType: 'payment_run', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { runNo: run.runNo, itemCount: run.items.length } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: id, actorId, action: 'payment_run.processed', previousState: { status: 'pending' }, newState: { status: 'complete' } });

  const detail = await getPaymentRunDetail(id);
  return detail!;
}

export async function voidPaymentRun(id: string, actorId: string, reason: string): Promise<ApPaymentRunDto> {
  if (!reason?.trim()) throw err('A reason is required to void a payment run.', 422);
  const { data: run, error: lookupErr } = await sb.from('finance_ap_payment_runs').select('*').eq('id', id).maybeSingle<DbPaymentRunRow>();
  if (lookupErr) throw err('voidPaymentRun: ' + lookupErr.message);
  if (!run) throw err('Payment run not found.', 404);
  if (run.status === 'void') throw err('Run is already voided.', 422);
  if (run.status === 'complete') throw err('Completed runs cannot be voided — reverse the payments individually.', 422);

  const { data, error } = await sb.from('finance_ap_payment_runs')
    .update({ status: 'void', voided_by: actorId, void_reason: reason.trim() })
    .eq('id', id).select().single<DbPaymentRunRow>();
  if (error) throw err('voidPaymentRun: ' + error.message);
  const row = toRunDto(data);

  void emitAppEvent({ eventType: 'finance.ap.payment_run.voided', sourceModule: SUBMODULE, sourceEntityType: 'payment_run', sourceEntityId: id, actorUserId: actorId, severity: 'warning', payload: { runNo: row.runNo, reason } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: id, actorId, action: 'payment_run.voided', previousState: { status: run.status }, newState: { status: 'void' }, reason });
  return row;
}

// ── Chunk 13 — Bill Import ────────────────────────────────────────────────────

export interface ImportBillRow {
  rowIndex: number;
  vendorName: string; vendorInvoiceNo: string; billDate: string; dueDate: string;
  description: string; amount: string; glAccountCode: string; currency: string;
}

export interface ImportValidationResult {
  rowIndex: number; valid: boolean;
  errors: string[];
  data: Partial<ImportBillRow>;
}

export interface ImportBillsResult {
  imported: number; skipped: number; errors: ImportValidationResult[];
  billIds: string[];
}

/** Parse + validate + import bills from CSV rows.
 *  Each row: vendorName, vendorInvoiceNo, billDate (YYYY-MM-DD), dueDate (opt),
 *  description, amount, glAccountCode (opt), currency (opt).
 *  Emits `finance.ap.bill.imported` per-batch. */
export async function importBills(rows: ImportBillRow[], actorId: string): Promise<ImportBillsResult> {
  if (!rows.length) throw err('No rows to import.', 422);

  // Load all vendors in one pass for efficient name→id lookup
  const { data: vendors } = await sb.from('finance_ap_vendors').select('id, name').eq('status', 'active');
  const vendorMap = new Map<string, string>(
    ((vendors ?? []) as Array<{ id: string; name: string }>).map(v => [v.name.toLowerCase().trim(), v.id]),
  );

  const validationResults: ImportValidationResult[] = [];
  const billIds: string[] = [];
  let imported = 0, skipped = 0;

  for (const row of rows) {
    const errors: string[] = [];
    const data: Partial<ImportBillRow> = { ...row };

    // Validate required fields
    if (!row.vendorName?.trim()) errors.push('vendorName is required');
    if (!row.billDate?.match(/^\d{4}-\d{2}-\d{2}$/)) errors.push('billDate must be YYYY-MM-DD');
    if (!row.description?.trim()) errors.push('description is required');
    const amount = Number(row.amount);
    if (isNaN(amount) || amount <= 0) errors.push('amount must be a positive number');

    const vendorId = row.vendorName ? vendorMap.get(row.vendorName.toLowerCase().trim()) : undefined;
    if (row.vendorName && !vendorId) errors.push(`Vendor "${row.vendorName}" not found or inactive`);

    if (errors.length) {
      validationResults.push({ rowIndex: row.rowIndex, valid: false, errors, data });
      skipped++;
      continue;
    }

    try {
      const bill = await createBill({
        vendorId: vendorId!, billDate: row.billDate,
        dueDate: row.dueDate || undefined,
        description: row.description.trim(),
        vendorInvoiceNo: row.vendorInvoiceNo?.trim() || undefined,
        glAccountCode: row.glAccountCode?.trim() || undefined,
        currency: row.currency?.trim() || 'TTD',
        lines: [{ description: row.description.trim(), amount }],
        actorId,
        // Import skips duplicate guard — duplicates tracked separately
        duplicateOverrideReason: 'Imported from CSV batch',
      });
      billIds.push(bill.id);
      imported++;
      validationResults.push({ rowIndex: row.rowIndex, valid: true, errors: [], data });
    } catch (e) {
      const msg = (e as Error).message;
      validationResults.push({ rowIndex: row.rowIndex, valid: false, errors: [msg], data });
      skipped++;
    }
  }

  if (imported > 0) {
    void emitAppEvent({ eventType: 'finance.ap.bill.imported', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: 'batch', actorUserId: actorId, severity: 'info', payload: { imported, skipped, billIds } });
    await writeHrAudit({ submoduleKey: SUBMODULE, recordId: 'batch', actorId, action: 'bill.imported', previousState: null, newState: { imported, skipped } });
  }

  return { imported, skipped, errors: validationResults.filter(r => !r.valid), billIds };
}
