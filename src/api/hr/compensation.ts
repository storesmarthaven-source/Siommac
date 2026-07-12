/**
 * src/api/hr/compensation.ts
 *
 * Typed client + TanStack hooks for HR Compensation pay-items
 * (routes/hrCompensation.ts — POST `hr/compensation/*`). HR owns compensation
 * *inputs* (recurring earnings/deductions per employee, effective-dated, maker-checker);
 * Finance owns the pay-component catalogue + statutory treatment. `actorId` server-derived.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

export type PayItemStatus = 'draft' | 'pending_approval' | 'approved' | 'active' | 'retired' | 'rejected';

export interface PayItem {
  id: string;
  itemNo: string | null;
  employeeId: string;
  componentId: string;
  amount: number | null;
  percent: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: PayItemStatus;
  workflowId: string | null;
  isActive: boolean;
  note: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePayItemArgs {
  employeeId: string;
  componentId: string;
  amount?: number | null;
  percent?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string | null;
}

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const hrCompensationApi = {
  listPayItems: (a: { employeeId?: string; status?: string; componentId?: string; activeOnly?: boolean } = {}) => call<PayItem[]>('hr/compensation/pay-items/list', a),
  getPayItem:   (a: { id: string })          => call<PayItem>('hr/compensation/pay-items/get', a),
  createPayItem:(a: CreatePayItemArgs)        => call<PayItem>('hr/compensation/pay-items/create', a),
  submitPayItem:(a: { id: string })          => call<PayItem>('hr/compensation/pay-items/submit', a),
  approvePayItem:(a: { id: string })         => call<PayItem>('hr/compensation/pay-items/approve', a),
  rejectPayItem:(a: { id: string; reason?: string }) => call<PayItem>('hr/compensation/pay-items/reject', a),
  retirePayItem:(a: { id: string })          => call<PayItem>('hr/compensation/pay-items/retire', a),
  listReports:  (a: object = {})             => call<Record<string, unknown>[]>('hr/compensation/reports/list', a),
};

export const hrCompensationKeys = {
  payItems: (o: object = {}) => ['hr', 'compensation', 'pay-items', o] as const,
};

export function usePayItems(opts: { employeeId?: string; status?: string; componentId?: string; activeOnly?: boolean } = {}) {
  return useQuery({ queryKey: hrCompensationKeys.payItems(opts), queryFn: () => hrCompensationApi.listPayItems(opts) });
}

export function useCompensationMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['hr', 'compensation'] }); } });
}
