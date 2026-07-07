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
export type ApPaymentMethod = 'eft' | 'cheque' | 'cash' | 'card';

const SUBMODULE = 'finance_ap';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface ApVendorDto {
  id: string; vendorNo: string; name: string; registrationNo: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  paymentTermsDays: number; defaultGlAccountCode: string | null; status: 'active' | 'inactive';
  createdAt: string; updatedAt: string | null;
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
export interface ApPaymentDto { id: string; billId: string; amount: number; method: ApPaymentMethod; paidAt: string; reference: string | null; createdBy: string | null; }

interface DbVendorRow { id: string; vendor_no: string; name: string; registration_no: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; payment_terms_days: number; default_gl_account_code: string | null; status: 'active' | 'inactive'; created_at: string; updated_at: string | null; }
interface DbBillRow { id: string; bill_no: string; vendor_id: string; bill_date: string; due_date: string | null; description: string | null; total_amount: string; paid_amount: string; currency: string; status: ApBillStatus; gl_account_code: string | null; approved_by: string | null; created_by: string | null; reject_reason: string | null; void_reason: string | null; workflow_id: string | null; created_at: string; updated_at: string | null; finance_ap_vendors?: { name: string } | { name: string }[] | null; }
interface DbLineRow { id: string; bill_id: string; line_no: number; description: string; amount: string; gl_account_code: string | null; cost_center_id: string | null; }
interface DbPaymentRow { id: string; bill_id: string; amount: string; method: ApPaymentMethod; paid_at: string; reference: string | null; created_by: string | null; }

const vendorName = (r: DbBillRow): string => Array.isArray(r.finance_ap_vendors) ? (r.finance_ap_vendors[0]?.name ?? '—') : (r.finance_ap_vendors?.name ?? '—');

function toVendorDto(r: DbVendorRow): ApVendorDto {
  return { id: r.id, vendorNo: r.vendor_no, name: r.name, registrationNo: r.registration_no, contactName: r.contact_name, contactEmail: r.contact_email, contactPhone: r.contact_phone, paymentTermsDays: r.payment_terms_days, defaultGlAccountCode: r.default_gl_account_code, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}
function toBillDto(r: DbBillRow): ApBillDto {
  const total = Number(r.total_amount), paid = Number(r.paid_amount);
  return { id: r.id, billNo: r.bill_no, vendorId: r.vendor_id, vendorName: vendorName(r), billDate: r.bill_date, dueDate: r.due_date, description: r.description, totalAmount: total, paidAmount: paid, balance: total - paid, currency: r.currency, status: r.status, glAccountCode: r.gl_account_code, approvedBy: r.approved_by, createdBy: r.created_by, rejectReason: r.reject_reason, voidReason: r.void_reason, workflowId: r.workflow_id, createdAt: r.created_at, updatedAt: r.updated_at };
}
const toLineDto = (r: DbLineRow): ApBillLineDto => ({ id: r.id, billId: r.bill_id, lineNo: r.line_no, description: r.description, amount: Number(r.amount), glAccountCode: r.gl_account_code, costCenterId: r.cost_center_id });
const toPaymentDto = (r: DbPaymentRow): ApPaymentDto => ({ id: r.id, billId: r.bill_id, amount: Number(r.amount), method: r.method, paidAt: r.paid_at, reference: r.reference, createdBy: r.created_by });

const err = (msg: string, status = 500): Error & { status: number } => Object.assign(new Error(msg), { status });

// ── Queries ─────────────────────────────────────────────────────────────────

export interface BillListOpts { status?: ApBillStatus; vendorId?: string; search?: string; page?: number; pageSize?: number; }
export interface BillListResult { rows: ApBillDto[]; total: number; page: number; pageCount: number; pageSize: number; }

export async function listBills(opts: BillListOpts = {}): Promise<BillListResult> {
  const page = Math.max(0, opts.page ?? 0);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 10));
  let q = sb.from('finance_ap_bills').select('*, finance_ap_vendors(name)', { count: 'exact' }).order('bill_date', { ascending: false });
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.vendorId) q = q.eq('vendor_id', opts.vendorId);
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

export async function listVendors(opts: { status?: 'active' | 'inactive' } = {}): Promise<ApVendorDto[]> {
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

export interface CreateVendorInput { name: string; registrationNo?: string; contactName?: string; contactEmail?: string; contactPhone?: string; paymentTermsDays?: number; defaultGlAccountCode?: string; actorId: string; }
export async function createVendor(input: CreateVendorInput): Promise<ApVendorDto> {
  const vendorNo = await nextRef('APV');
  const { data, error } = await sb.from('finance_ap_vendors').insert({
    vendor_no: vendorNo, name: input.name, registration_no: input.registrationNo ?? null, contact_name: input.contactName ?? null,
    contact_email: input.contactEmail ?? null, contact_phone: input.contactPhone ?? null, payment_terms_days: input.paymentTermsDays ?? 30,
    default_gl_account_code: input.defaultGlAccountCode ?? null, created_by: input.actorId,
  }).select().single<DbVendorRow>();
  if (error) throw err('createVendor: ' + error.message);
  const row = toVendorDto(data);
  void emitAppEvent({ eventType: 'finance.ap.vendor.created', sourceModule: SUBMODULE, sourceEntityType: 'vendor', sourceEntityId: row.id, actorUserId: input.actorId, severity: 'info', payload: { vendorNo: row.vendorNo, name: row.name } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: row.id, actorId: input.actorId, action: 'vendor.created', previousState: null, newState: { vendorNo: row.vendorNo, name: row.name } });
  return row;
}

// ── Bills ───────────────────────────────────────────────────────────────────

export interface BillLineInput { description: string; amount: number; glAccountCode?: string; costCenterId?: string | null; }
export interface CreateBillInput { vendorId: string; billDate: string; dueDate?: string; description?: string; glAccountCode?: string; lines: BillLineInput[]; actorId: string; }

export async function createBill(input: CreateBillInput): Promise<ApBillDto> {
  if (!input.lines.length) throw err('At least one bill line is required.', 422);
  const total = input.lines.reduce((s, l) => s + l.amount, 0);
  if (total <= 0) throw err('Bill total must be greater than zero.', 422);
  const billNo = await nextRef('BILL');
  const { data, error } = await sb.from('finance_ap_bills').insert({
    bill_no: billNo, vendor_id: input.vendorId, bill_date: input.billDate, due_date: input.dueDate ?? null,
    description: input.description ?? null, total_amount: total, status: 'draft', gl_account_code: input.glAccountCode ?? null, created_by: input.actorId,
  }).select('*, finance_ap_vendors(name)').single<DbBillRow>();
  if (error) throw err('createBill: ' + error.message);
  const row = toBillDto(data);

  const { error: lineErr } = await sb.from('finance_ap_bill_lines').insert(
    input.lines.map((l, i) => ({ bill_id: row.id, line_no: i + 1, description: l.description, amount: l.amount, gl_account_code: l.glAccountCode ?? input.glAccountCode ?? null, cost_center_id: l.costCenterId ?? null })),
  );
  if (lineErr) {
    await sb.from('finance_ap_bills').delete().eq('id', row.id);   // compensating rollback
    throw err('createBill lines: ' + lineErr.message + ' — bill rolled back.');
  }

  void emitAppEvent({ eventType: 'finance.ap.bill.created', sourceModule: SUBMODULE, sourceEntityType: 'bill', sourceEntityId: row.id, actorUserId: input.actorId, severity: 'info', payload: { billNo: row.billNo, vendorName: row.vendorName, totalAmount: row.totalAmount } });
  await writeHrAudit({ submoduleKey: SUBMODULE, recordId: row.id, actorId: input.actorId, action: 'bill.created', previousState: null, newState: { billNo: row.billNo, status: 'draft', totalAmount: row.totalAmount } });
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

export async function recordPayment(id: string, actorId: string, input: { amount: number; method?: ApPaymentMethod; reference?: string }): Promise<ApBillDto> {
  const existing = await requireBill(id);
  if (!['approved', 'partially_paid'].includes(existing.status)) throw err('Only approved bills can be paid.', 422);
  if (input.amount <= 0) throw err('Payment amount must be greater than zero.', 422);
  if (input.amount > existing.balance + 0.005) throw err(`Payment ($${input.amount.toFixed(2)}) exceeds the outstanding balance ($${existing.balance.toFixed(2)}).`, 422);

  const { error: payErr } = await sb.from('finance_ap_payments').insert({ bill_id: id, amount: input.amount, method: input.method ?? 'eft', reference: input.reference ?? null, created_by: actorId });
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
