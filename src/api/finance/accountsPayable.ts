/**
 * src/api/finance/accountsPayable.ts
 *
 * TanStack Query hooks for Accounts Payable — bills, vendors, payments, KPIs,
 * aging + the bill lifecycle mutations. Response DTOs mirror
 * netlify/functions/lib/finance/accountsPayable.ts.
 */

import { useQuery, useMutation, useQueryClient, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

export type ApBillStatus = 'draft' | 'submitted' | 'approved' | 'partially_paid' | 'paid' | 'rejected' | 'void';

export interface ApBill {
  id: string; billNo: string; vendorId: string; vendorName: string;
  billDate: string; dueDate: string | null; description: string | null;
  totalAmount: number; paidAmount: number; balance: number; currency: string;
  status: ApBillStatus; glAccountCode: string | null;
  approvedBy: string | null; createdBy: string | null; rejectReason: string | null;
  voidReason: string | null; workflowId: string | null; createdAt: string; updatedAt: string | null;
}
export interface ApBillLine { id: string; billId: string; lineNo: number; description: string; amount: number; glAccountCode: string | null; costCenterId: string | null; }
export interface ApPayment { id: string; billId: string; amount: number; method: string; paidAt: string; reference: string | null; createdBy: string | null; }
export interface ApVendor { id: string; vendorNo: string; name: string; registrationNo: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; paymentTermsDays: number; defaultGlAccountCode: string | null; status: 'active' | 'inactive'; createdAt: string; updatedAt: string | null; }
export interface ApKpis { totalPayable: number; overdue: number; overdueCount: number; dueThisWeek: number; dueThisWeekCount: number; onTimeRatePct: number; openBills: number; vendorCount: number; pendingApprovalCount: number; }
export interface ApAgingBucket { label: string; amount: number; count: number; }
export interface ApTrend { labels: string[]; billed: number[]; paid: number[]; }
export interface ApBillListResult { rows: ApBill[]; total: number; page: number; pageCount: number; pageSize: number; }

export interface ApBillFilters extends Record<string, unknown> { status?: ApBillStatus; vendorId?: string; search?: string; page?: number; pageSize?: number; }

const key = {
  bills: (f: ApBillFilters) => ['finance', 'ap', 'bills', f] as const,
  bill: (id: string) => ['finance', 'ap', 'bill', id] as const,
  vendors: () => ['finance', 'ap', 'vendors'] as const,
  payments: () => ['finance', 'ap', 'payments'] as const,
  kpis: () => ['finance', 'ap', 'kpis'] as const,
  aging: () => ['finance', 'ap', 'aging'] as const,
  trend: () => ['finance', 'ap', 'trend'] as const,
};

async function post<T>(path: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(path, args, signal ? { signal } : undefined);
  if (!res.success) throw new Error((res as { message?: string }).message ?? 'Request failed');
  return res.data;
}

export function useApBills(filters: ApBillFilters = {}) {
  return useQuery({ queryKey: key.bills(filters), queryFn: ({ signal }: QueryFunctionContext) => post<ApBillListResult>('finance/ap/bills/list', filters, signal) });
}
export function useApBillDetail(id: string | null) {
  return useQuery({ queryKey: key.bill(id ?? ''), enabled: !!id, queryFn: ({ signal }: QueryFunctionContext) => post<{ bill: ApBill; lines: ApBillLine[]; payments: ApPayment[] }>('finance/ap/bills/get', { id }, signal) });
}
export function useApVendors() {
  return useQuery({ queryKey: key.vendors(), queryFn: ({ signal }: QueryFunctionContext) => post<ApVendor[]>('finance/ap/vendors/list', {}, signal) });
}
export function useApPayments() {
  return useQuery({ queryKey: key.payments(), queryFn: ({ signal }: QueryFunctionContext) => post<Array<ApPayment & { billNo: string }>>('finance/ap/payments/list', {}, signal) });
}
export function useApKpis() {
  return useQuery({ queryKey: key.kpis(), queryFn: ({ signal }: QueryFunctionContext) => post<ApKpis>('finance/ap/kpis', {}, signal), staleTime: 60_000 });
}
export function useApAging() {
  return useQuery({ queryKey: key.aging(), queryFn: ({ signal }: QueryFunctionContext) => post<ApAgingBucket[]>('finance/ap/aging', {}, signal), staleTime: 60_000 });
}
export function useApTrend() {
  return useQuery({ queryKey: key.trend(), queryFn: ({ signal }: QueryFunctionContext) => post<ApTrend>('finance/ap/trend', {}, signal), staleTime: 60_000 });
}

function useApMutation<V>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: V & Record<string, unknown>) => post<ApBill>(path, args),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance', 'ap'] }); void qc.invalidateQueries({ queryKey: ['finance', 'overview'] }); },
  });
}

export const useCreateBill = () => useApMutation<{ vendorId: string; billDate: string; dueDate?: string; description?: string; glAccountCode?: string; lines: Array<{ description: string; amount: number; glAccountCode?: string }> }>('finance/ap/bills/create');
export const useSubmitBill = () => useApMutation<{ id: string }>('finance/ap/bills/submit');
export const useApproveBill = () => useApMutation<{ id: string }>('finance/ap/bills/approve');
export const useRejectBill = () => useApMutation<{ id: string; reason: string }>('finance/ap/bills/reject');
export const useRecordPayment = () => useApMutation<{ id: string; amount: number; method?: string; reference?: string }>('finance/ap/bills/record-payment');
export const useVoidBill = () => useApMutation<{ id: string; reason: string }>('finance/ap/bills/void');

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; registrationNo?: string; contactEmail?: string; paymentTermsDays?: number; defaultGlAccountCode?: string } & Record<string, unknown>) => post<ApVendor>('finance/ap/vendors/create', args),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key.vendors() }); },
  });
}
