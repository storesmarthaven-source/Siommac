/**
 * src/api/finance/accountsPayable.ts
 *
 * TanStack Query hooks for Accounts Payable — bills, vendors, payments, KPIs,
 * aging + the bill lifecycle mutations. Response DTOs mirror
 * netlify/functions/lib/finance/accountsPayable.ts.
 */

import { useQuery, useMutation, useQueryClient, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { financeQueryKeys } from './keys';

export type ApBillStatus = 'draft' | 'submitted' | 'approved' | 'partially_paid' | 'paid' | 'rejected' | 'void';
export type ApVendorStatus = 'active' | 'inactive' | 'on_hold';
export type ApPaymentMethod = 'eft' | 'ach' | 'wire' | 'cheque' | 'cash' | 'card';

export interface ApBill {
  id: string; billNo: string; vendorId: string; vendorName: string;
  billDate: string; dueDate: string | null; description: string | null;
  totalAmount: number; paidAmount: number; balance: number; currency: string;
  status: ApBillStatus; glAccountCode: string | null;
  approvedBy: string | null; createdBy: string | null; rejectReason: string | null;
  voidReason: string | null; workflowId: string | null; createdAt: string; updatedAt: string | null;
}
export interface ApBillLine { id: string; billId: string; lineNo: number; description: string; amount: number; glAccountCode: string | null; costCenterId: string | null; }
export interface ApPayment {
  id: string; billId: string; amount: number; method: ApPaymentMethod;
  paidAt: string; reference: string | null; memo: string | null;
  sourceAccountId: string | null; createdBy: string | null;
}

export interface ApVendor {
  id: string; vendorNo: string; name: string; registrationNo: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  paymentTermsDays: number; defaultGlAccountCode: string | null;
  defaultCostCenterId: string | null; defaultCurrency: string;
  preferredPaymentMethod: ApPaymentMethod | null;
  status: ApVendorStatus;
  createdAt: string; updatedAt: string | null;
}

export interface ApVendorBankAccount {
  id: string; vendorId: string; bankName: string; accountName: string;
  accountNumber: string; routingCode: string | null; iban: string | null;
  swift: string | null; currency: string; isDefault: boolean;
  status: 'active' | 'inactive'; createdAt: string;
}

export interface ApKpis { totalPayable: number; overdue: number; overdueCount: number; dueThisWeek: number; dueThisWeekCount: number; onTimeRatePct: number; openBills: number; vendorCount: number; pendingApprovalCount: number; }
export interface ApAgingBucket { label: string; amount: number; count: number; }
export interface ApTrend { labels: string[]; billed: number[]; paid: number[]; }
export interface ApBillListResult { rows: ApBill[]; total: number; page: number; pageCount: number; pageSize: number; }

export interface ApBillFilters extends Record<string, unknown> { status?: ApBillStatus; vendorId?: string; search?: string; page?: number; pageSize?: number; }

async function post<T>(path: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(path, args, signal ? { signal } : undefined);
  if (!res.success) throw new Error((res as { message?: string }).message ?? 'Request failed');
  return res.data;
}

// ── Queries ────────────────────────────────────────────────────────────────────

export function useApBills(filters: ApBillFilters = {}) {
  return useQuery({
    queryKey: financeQueryKeys.apBills(filters),
    queryFn: ({ signal }: QueryFunctionContext) => post<ApBillListResult>('finance/ap/bills/list', filters, signal),
  });
}

export function useApBillDetail(id: string | null) {
  return useQuery({
    queryKey: financeQueryKeys.apBill(id ?? ''),
    enabled: !!id,
    queryFn: ({ signal }: QueryFunctionContext) =>
      post<{ bill: ApBill; lines: ApBillLine[]; payments: ApPayment[] }>('finance/ap/bills/get', { id }, signal),
  });
}

export function useApVendors(status?: ApVendorStatus) {
  return useQuery({
    queryKey: financeQueryKeys.apVendors(status ? { status } : undefined),
    queryFn: ({ signal }: QueryFunctionContext) =>
      post<ApVendor[]>('finance/ap/vendors/list', status ? { status } : {}, signal),
  });
}

export function useApVendorDetail(id: string | null) {
  return useQuery({
    queryKey: financeQueryKeys.apVendor(id ?? ''),
    enabled: !!id,
    queryFn: ({ signal }: QueryFunctionContext) =>
      post<{ vendor: ApVendor; bankAccounts: ApVendorBankAccount[] }>('finance/ap/vendors/get', { id }, signal),
  });
}

export function useApVendorBills(vendorId: string | null) {
  return useQuery({
    queryKey: financeQueryKeys.apVendorBills(vendorId ?? ''),
    enabled: !!vendorId,
    queryFn: ({ signal }: QueryFunctionContext) =>
      post<ApBill[]>('finance/ap/vendors/bills', { vendorId }, signal),
  });
}

export function useApVendorPayments(vendorId: string | null) {
  return useQuery({
    queryKey: financeQueryKeys.apVendorPayments(vendorId ?? ''),
    enabled: !!vendorId,
    queryFn: ({ signal }: QueryFunctionContext) =>
      post<Array<ApPayment & { billNo: string }>>('finance/ap/vendors/payments', { vendorId }, signal),
  });
}

export function useApPayments() {
  return useQuery({
    queryKey: financeQueryKeys.apPayments(),
    queryFn: ({ signal }: QueryFunctionContext) =>
      post<Array<ApPayment & { billNo: string }>>('finance/ap/payments/list', {}, signal),
  });
}

export function useApKpis() {
  return useQuery({
    queryKey: financeQueryKeys.apKpis(),
    queryFn: ({ signal }: QueryFunctionContext) => post<ApKpis>('finance/ap/kpis', {}, signal),
    staleTime: 60_000,
  });
}

export function useApAging() {
  return useQuery({
    queryKey: financeQueryKeys.apAging(),
    queryFn: ({ signal }: QueryFunctionContext) => post<ApAgingBucket[]>('finance/ap/aging', {}, signal),
    staleTime: 60_000,
  });
}

export function useApTrend() {
  return useQuery({
    queryKey: financeQueryKeys.apTrend(),
    queryFn: ({ signal }: QueryFunctionContext) => post<ApTrend>('finance/ap/trend', {}, signal),
    staleTime: 60_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Invalidates all AP + overview data after a mutation. */
function useApMutation<V>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: V & Record<string, unknown>) => post<ApBill>(path, args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: financeQueryKeys.apBase() });
      void qc.invalidateQueries({ queryKey: financeQueryKeys.overviewBase() });
    },
  });
}

export const useCreateBill = () => useApMutation<{
  vendorId: string; billDate: string; dueDate?: string; description?: string;
  glAccountCode?: string;
  lines: Array<{ description: string; amount: number; glAccountCode?: string; costCenterId?: string | null }>;
}>('finance/ap/bills/create');

export const useSubmitBill = () => useApMutation<{ id: string }>('finance/ap/bills/submit');
export const useApproveBill = () => useApMutation<{ id: string }>('finance/ap/bills/approve');
export const useRejectBill = () => useApMutation<{ id: string; reason: string }>('finance/ap/bills/reject');
export const useVoidBill = () => useApMutation<{ id: string; reason: string }>('finance/ap/bills/void');

export const useRecordPayment = () => useApMutation<{
  id: string; amount: number; method?: ApPaymentMethod;
  paymentDate?: string; reference?: string; memo?: string; sourceAccountId?: string;
}>('finance/ap/bills/record-payment');

export interface VendorBankAccountInput {
  bankName: string; accountName: string; accountNumber: string;
  routingCode?: string; iban?: string; swift?: string; currency?: string;
}

export interface CreateVendorInput {
  name: string; registrationNo?: string; contactName?: string;
  contactEmail?: string; contactPhone?: string; paymentTermsDays?: number;
  defaultGlAccountCode?: string; defaultCostCenterId?: string;
  defaultCurrency?: string; preferredPaymentMethod?: ApPaymentMethod;
  status?: ApVendorStatus; bankAccount?: VendorBankAccountInput;
}

export interface UpdateVendorInput extends Partial<CreateVendorInput> {
  id: string;
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateVendorInput & Record<string, unknown>) =>
      post<ApVendor>('finance/ap/vendors/create', args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: financeQueryKeys.apVendors() });
      void qc.invalidateQueries({ queryKey: financeQueryKeys.pickerVendors() });
    },
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateVendorInput & Record<string, unknown>) =>
      post<ApVendor>('finance/ap/vendors/update', args),
    onSuccess: (_data, args) => {
      void qc.invalidateQueries({ queryKey: financeQueryKeys.apVendors() });
      void qc.invalidateQueries({ queryKey: financeQueryKeys.apVendor(args.id) });
      void qc.invalidateQueries({ queryKey: financeQueryKeys.pickerVendors() });
    },
  });
}
