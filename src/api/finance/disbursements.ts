/**
 * src/api/finance/disbursements.ts
 *
 * Typed client + TanStack hooks for the Finance Payroll Bank Disbursements backend.
 * Lifecycle: draft -> submitted -> approved -> file_generated -> paid
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

export type DisbursementStatus =
  | 'draft' | 'submitted' | 'approved' | 'file_generated' | 'paid' | 'cancelled';

export interface Disbursement {
  id: string;
  disbursementNo: string;
  payrollRunId: string;
  status: DisbursementStatus;
  totalAmount: number;
  employeeCount: number;
  bankFilePath: string | null;
  currency: string;
  approvedBy: string | null;
  createdBy: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  workflowId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DisbursementLine {
  id: string;
  disbursementId: string;
  employeeId: string;
  bankAccountId: string | null;
  netAmount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ComputedDisbursement {
  payrollRunId: string;
  totalAmount: number;
  employeeCount: number;
  lines: Array<{
    employeeId: string;
    bankAccountId: string | null;
    accountNumberMasked: string | null;
    bankName: string | null;
    netAmount: number;
    hasBankAccount: boolean;
  }>;
  missingBankAccounts: string[];
}

export interface DisbursementReportRow {
  id: string;
  disbursementNo: string;
  payrollRunId: string;
  status: string;
  totalAmount: number;
  employeeCount: number;
  currency: string;
  createdAt: string;
}

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const financeDisbursementsApi = {
  list:         (a: { payrollRunId?: string; status?: DisbursementStatus } = {}) =>
                  call<Disbursement[]>('finance/disbursements/list', a),
  get:          (a: { id: string }) => call<Disbursement>('finance/disbursements/get', a),
  lines:        (a: { disbursementId: string }) =>
                  call<DisbursementLine[]>('finance/disbursements/lines/list', a),
  compute:      (a: { payrollRunId: string }) =>
                  call<ComputedDisbursement>('finance/disbursements/compute', a),
  create:       (a: { payrollRunId: string; metadata?: Record<string, unknown> }) =>
                  call<Disbursement>('finance/disbursements/create', a),
  submit:       (a: { id: string }) => call<Disbursement>('finance/disbursements/submit', a),
  approve:      (a: { id: string }) => call<Disbursement>('finance/disbursements/approve', a),
  generateFile: (a: { id: string }) => call<Disbursement & { filePath: string }>('finance/disbursements/generate-file', a),
  markPaid:     (a: { id: string }) => call<Disbursement>('finance/disbursements/mark-paid', a),
  cancel:       (a: { id: string; reason: string }) =>
                  call<Disbursement>('finance/disbursements/cancel', a),
  listReport:   (a: { status?: DisbursementStatus } = {}) =>
                  call<DisbursementReportRow[]>('finance/disbursements/reports/list', a),
};

export const financeDisbursementsKeys = {
  list:    (opts: object = {}) => ['finance', 'disbursements', 'list', opts] as const,
  single:  (id: string)        => ['finance', 'disbursements', 'single', id] as const,
  lines:   (id: string)        => ['finance', 'disbursements', 'lines', id] as const,
  compute: (runId: string)     => ['finance', 'disbursements', 'compute', runId] as const,
  report:  (opts: object = {}) => ['finance', 'disbursements', 'report', opts] as const,
};

export function useDisbursements(opts: { payrollRunId?: string; status?: DisbursementStatus } = {}) {
  return useQuery({
    queryKey: financeDisbursementsKeys.list(opts),
    queryFn:  () => financeDisbursementsApi.list(opts),
  });
}

export function useDisbursement(id: string | null) {
  return useQuery({
    queryKey: financeDisbursementsKeys.single(id ?? ''),
    queryFn:  () => financeDisbursementsApi.get({ id: id! }),
    enabled:  !!id,
  });
}

export function useDisbursementLines(disbursementId: string | null) {
  return useQuery({
    queryKey: financeDisbursementsKeys.lines(disbursementId ?? ''),
    queryFn:  () => financeDisbursementsApi.lines({ disbursementId: disbursementId! }),
    enabled:  !!disbursementId,
  });
}

export function useComputedDisbursement(payrollRunId: string | null) {
  return useQuery({
    queryKey: financeDisbursementsKeys.compute(payrollRunId ?? ''),
    queryFn:  () => financeDisbursementsApi.compute({ payrollRunId: payrollRunId! }),
    enabled:  !!payrollRunId,
  });
}

export function useDisbursementMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'disbursements'] });
    },
  });
}
