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

export interface DisbursementLineDetail extends DisbursementLine {
  accountNumberMasked: string | null;
  bankName: string | null;
}

export interface DisbursementKpis {
  pending: number;
  approved: number;
  fileGenerated: number;
  paidMtd: number;
  totalMtdAmount: number;
  missingBankAccountCount: number;
  failedLineCount: number;
  trend: Array<{ month: string; total: number; count: number }>;
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

export interface DisbursementAuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

export interface BankFileStatusRow {
  id: string;
  disbursementNo: string;
  status: string;
  totalAmount: number;
  employeeCount: number;
  currency: string;
  bankFilePath: string;
  fileGeneratedAt: string | null;
  fileGeneratedBy: string | null;
  createdAt: string;
}

export interface BankAccountReadinessRow {
  employeeId: string;
  fullName: string | null;
  email: string;
  hasPrimaryBankAccount: boolean;
}

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const financeDisbursementsApi = {
  list:           (a: { payrollRunId?: string; status?: DisbursementStatus } = {}) =>
                    call<Disbursement[]>('finance/disbursements/list', a),
  get:            (a: { id: string }) => call<Disbursement>('finance/disbursements/get', a),
  lines:          (a: { disbursementId: string }) =>
                    call<DisbursementLine[]>('finance/disbursements/lines/list', a),
  linesDetail:    (a: { disbursementId: string }) =>
                    call<DisbursementLineDetail[]>('finance/disbursements/lines/list-detail', a),
  compute:        (a: { payrollRunId: string }) =>
                    call<ComputedDisbursement>('finance/disbursements/compute', a),
  create:         (a: { payrollRunId: string; currency?: string; metadata?: Record<string, unknown> }) =>
                    call<Disbursement>('finance/disbursements/create', a),
  /** Idempotent bridge create — returns existing disbursement on duplicate run-id (no 409).
   *  Also emits finance.payroll.bridge.disbursement.created + notifies Payment Ops + handoff. */
  createFromRun:  (a: { payrollRunId: string; currency?: string; metadata?: Record<string, unknown> }) =>
                    call<Disbursement & { created: boolean }>('finance/disbursements/create-from-run', a),
  submit:         (a: { id: string }) => call<Disbursement>('finance/disbursements/submit', a),
  approve:        (a: { id: string }) => call<Disbursement>('finance/disbursements/approve', a),
  generateFile:   (a: { id: string }) => call<Disbursement & { filePath: string }>('finance/disbursements/generate-file', a),
  markPaid:       (a: { id: string }) => call<Disbursement>('finance/disbursements/mark-paid', a),
  cancel:         (a: { id: string; reason: string }) =>
                    call<Disbursement>('finance/disbursements/cancel', a),
  bankFileUrl:    (a: { disbursementId: string }) =>
                    call<{ signedUrl: string; disbursement: Disbursement }>('finance/disbursements/bank-file/signed-url', a),
  kpis:           () => call<DisbursementKpis>('finance/disbursements/kpis'),
  listReport:     (a: { status?: DisbursementStatus } = {}) =>
                    call<DisbursementReportRow[]>('finance/disbursements/reports/list', a),
  auditLog:         (a: { disbursementId: string }) =>
                      call<DisbursementAuditEntry[]>('finance/disbursements/audit-log', a),
  financeAuditLog:  (a: { submoduleKey: string; recordId: string }) =>
                      call<DisbursementAuditEntry[]>('finance/disbursements/finance-audit-log', a),
  bankFileStatusReport: () =>
                    call<BankFileStatusRow[]>('finance/disbursements/reports/bank-file-status'),
  bankAccountReadinessReport: () =>
                    call<BankAccountReadinessRow[]>('finance/disbursements/reports/bank-account-readiness'),
};

export const financeDisbursementsKeys = {
  list:                      (opts: object = {}) => ['finance', 'disbursements', 'list', opts] as const,
  single:                    (id: string)        => ['finance', 'disbursements', 'single', id] as const,
  lines:                     (id: string)        => ['finance', 'disbursements', 'lines', id] as const,
  linesDetail:               (id: string)        => ['finance', 'disbursements', 'lines-detail', id] as const,
  compute:                   (runId: string)     => ['finance', 'disbursements', 'compute', runId] as const,
  kpis:                      ()                  => ['finance', 'disbursements', 'kpis'] as const,
  report:                    (opts: object = {}) => ['finance', 'disbursements', 'report', opts] as const,
  auditLog:                  (id: string)        => ['finance', 'disbursements', 'audit-log', id] as const,
  financeAuditLog:           (sub: string, id: string) => ['finance', 'audit-log', sub, id] as const,
  bankFileStatusReport:      ()                  => ['finance', 'disbursements', 'report', 'bank-file-status'] as const,
  bankAccountReadinessReport:()                  => ['finance', 'disbursements', 'report', 'bank-account-readiness'] as const,
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

export function useDisbursementLinesDetail(disbursementId: string | null) {
  return useQuery({
    queryKey: financeDisbursementsKeys.linesDetail(disbursementId ?? ''),
    queryFn:  () => financeDisbursementsApi.linesDetail({ disbursementId: disbursementId! }),
    enabled:  !!disbursementId,
  });
}

export function useDisbursementKpis() {
  return useQuery({
    queryKey: financeDisbursementsKeys.kpis(),
    queryFn:  financeDisbursementsApi.kpis,
    staleTime: 60_000,
  });
}

export function useDisbursementReport(opts: { status?: DisbursementStatus } = {}) {
  return useQuery({
    queryKey: financeDisbursementsKeys.report(opts),
    queryFn:  () => financeDisbursementsApi.listReport(opts),
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

export function useDisbursementAuditLog(disbursementId: string | null) {
  return useQuery({
    queryKey: financeDisbursementsKeys.auditLog(disbursementId ?? ''),
    queryFn:  () => financeDisbursementsApi.auditLog({ disbursementId: disbursementId! }),
    enabled:  !!disbursementId,
  });
}

export function useFinanceAuditLog(submoduleKey: string | null, recordId: string | null) {
  return useQuery({
    queryKey: financeDisbursementsKeys.financeAuditLog(submoduleKey ?? '', recordId ?? ''),
    queryFn:  () => financeDisbursementsApi.financeAuditLog({ submoduleKey: submoduleKey!, recordId: recordId! }),
    enabled:  !!(submoduleKey && recordId),
  });
}

export function useBankFileStatusReport() {
  return useQuery({
    queryKey: financeDisbursementsKeys.bankFileStatusReport(),
    queryFn:  financeDisbursementsApi.bankFileStatusReport,
  });
}

export function useBankAccountReadinessReport() {
  return useQuery({
    queryKey: financeDisbursementsKeys.bankAccountReadinessReport(),
    queryFn:  financeDisbursementsApi.bankAccountReadinessReport,
  });
}
