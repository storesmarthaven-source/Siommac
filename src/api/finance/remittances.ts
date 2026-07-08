/**
 * src/api/finance/remittances.ts
 *
 * Typed client + TanStack hooks for Finance Statutory Remittances & Filing
 * (routes/financeRemittances.ts — POST `finance/remittances/*`).
 *
 * Lifecycle: draft → submitted → approved → paid → filed
 * SoD: creator ≠ approver (enforced server-side).
 * `actorId` is derived server-side from auth — clients never send it.
 *
 * Local query keys:
 *   remittanceComputeKey — compute preview (not in keys.ts)
 *   remittanceLinesAllKey — cross-remittance lines list (not in keys.ts)
 *
 * Keys from financeQueryKeys (keys.ts):
 *   remittancesBase(), remittances(), remittance(), remittanceLines(), remittanceAttachments()
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { financeQueryKeys } from './keys';

// ── Local query key factories (report to orchestrator for keys.ts) ─────────────

const remittanceComputeKey = (a: object) =>
  ['finance', 'remittances', 'compute', a] as const;

const remittanceLinesAllKey = (f: object = {}) =>
  ['finance', 'remittances', 'lines-all', f] as const;

const remittanceReportKey = (report: string, f: object = {}) =>
  ['finance', 'remittances', 'report', report, f] as const;

// ── DTOs (mirror the backend lib return shapes exactly) ────────────────────────

export type RemittanceAuthority = 'paye_bir' | 'nis_nibtt' | 'health_surcharge';
export type RemittanceStatus    = 'draft' | 'submitted' | 'approved' | 'paid' | 'filed' | 'cancelled';

export interface Remittance {
  id: string;
  remittanceNo: string;
  periodYear: number;
  periodMonth: number;
  authority: RemittanceAuthority;
  payrollRunId: string;
  employeePortion: number;
  employerPortion: number;
  totalDue: number;
  currency: string;
  status: RemittanceStatus;
  dueDate: string | null;
  paidDate: string | null;
  filedDate: string | null;
  authorityReference: string | null;
  filingMethod: string | null;
  receiptReference: string | null;
  filedNotes: string | null;
  workflowId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RemittanceLine {
  id: string;
  remittanceId: string;
  employeeId: string;
  employeePortion: number;
  employerPortion: number;
  lineTotal: number;
  sourceLineId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RemittanceLineWithContext extends RemittanceLine {
  authority: RemittanceAuthority;
  periodYear: number;
  periodMonth: number;
  remittanceNo: string;
}

export interface ComputedRemittance {
  payrollRunId: string;
  periodYear: number;
  periodMonth: number;
  authority: RemittanceAuthority;
  employeePortion: number;
  employerPortion: number;
  totalDue: number;
  lineCount: number;
  lines: Array<{
    employeeId: string;
    sourceLineId: string;
    employeePortion: number;
    employerPortion: number;
    lineTotal: number;
  }>;
}

/** ReportResult shape returned by /reports/run (for ReportPanel). */
export interface ReportResult {
  report: string;
  generatedAt: string;
  rows: Record<string, unknown>[];
}

// ── Create / mutation input types ──────────────────────────────────────────────

export interface CreateRemittanceArgs {
  payrollRunId: string;
  authority: RemittanceAuthority;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MarkPaidArgs {
  id: string;
  paidDate?: string;
  authorityReference?: string;
}

export interface MarkFiledArgs {
  id: string;
  filedDate?: string;
  authorityReference?: string;
  filingMethod?: string;
  receiptReference?: string;
  filedNotes?: string;
}

// ── Core call helper ────────────────────────────────────────────────────────────

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

// ── API object ──────────────────────────────────────────────────────────────────

export const financeRemittancesApi = {
  list:     (a: { payrollRunId?: string; authority?: RemittanceAuthority; status?: RemittanceStatus; periodYear?: number; periodMonth?: number; search?: string } = {}) =>
              call<Remittance[]>('finance/remittances/list', a),
  get:      (a: { id: string })                              => call<Remittance>('finance/remittances/get', a),
  lines:    (a: { remittanceId: string })                   => call<RemittanceLine[]>('finance/remittances/lines/list', a),
  linesAll: (a: { authority?: RemittanceAuthority; periodYear?: number; periodMonth?: number; limit?: number } = {}) =>
              call<RemittanceLineWithContext[]>('finance/remittances/lines/list-all', a),
  compute:  (a: { payrollRunId: string; authority: RemittanceAuthority }) =>
              call<ComputedRemittance>('finance/remittances/compute', a),
  create:   (a: CreateRemittanceArgs)                       => call<Remittance>('finance/remittances/create', a),
  submit:   (a: { id: string })                             => call<Remittance>('finance/remittances/submit', a),
  approve:  (a: { id: string })                             => call<Remittance>('finance/remittances/approve', a),
  markPaid: (a: MarkPaidArgs)                               => call<Remittance>('finance/remittances/mark-paid', a),
  markFiled:(a: MarkFiledArgs)                              => call<Remittance>('finance/remittances/mark-filed', a),
  cancel:   (a: { id: string; reason: string })             => call<Remittance>('finance/remittances/cancel', a),

  // Reports
  listReport: (a: { periodYear?: number; authority?: RemittanceAuthority; status?: RemittanceStatus } = {}) =>
                call<Record<string, unknown>[]>('finance/remittances/reports/list', a),
  runReport:  (a: { report: string; periodYear?: number; authority?: RemittanceAuthority; status?: RemittanceStatus }) =>
                call<ReportResult>('finance/remittances/reports/run', a),
};

// ── Query hooks ─────────────────────────────────────────────────────────────────

export function useRemittances(opts: {
  payrollRunId?: string;
  authority?: RemittanceAuthority;
  status?: RemittanceStatus;
  periodYear?: number;
  periodMonth?: number;
  search?: string;
} = {}) {
  return useQuery({
    queryKey: financeQueryKeys.remittances(opts),
    queryFn:  () => financeRemittancesApi.list(opts),
    placeholderData: (prev) => prev,
  });
}

export function useRemittance(id: string | null) {
  return useQuery({
    queryKey: financeQueryKeys.remittance(id ?? ''),
    queryFn:  () => financeRemittancesApi.get({ id: id! }),
    enabled:  !!id,
  });
}

export function useRemittanceLines(remittanceId: string | null, enabled = true) {
  return useQuery({
    queryKey: financeQueryKeys.remittanceLines(remittanceId ?? ''),
    queryFn:  () => financeRemittancesApi.lines({ remittanceId: remittanceId! }),
    enabled:  enabled && !!remittanceId,
  });
}

export function useRemittanceLinesAll(opts: {
  authority?: RemittanceAuthority;
  periodYear?: number;
  periodMonth?: number;
  limit?: number;
} = {}) {
  return useQuery({
    queryKey: remittanceLinesAllKey(opts),
    queryFn:  () => financeRemittancesApi.linesAll(opts),
    placeholderData: (prev) => prev,
  });
}

export function useComputedRemittance(payrollRunId: string | null, authority: RemittanceAuthority | null) {
  return useQuery({
    queryKey: remittanceComputeKey({ payrollRunId, authority }),
    queryFn:  () => financeRemittancesApi.compute({ payrollRunId: payrollRunId!, authority: authority! }),
    enabled:  !!payrollRunId && !!authority,
  });
}

export function useRemittancesReport(opts: {
  report: string;
  periodYear?: number;
  authority?: RemittanceAuthority;
  status?: RemittanceStatus;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: remittanceReportKey(opts.report, { periodYear: opts.periodYear, authority: opts.authority, status: opts.status }),
    queryFn:  () => financeRemittancesApi.runReport({ report: opts.report, periodYear: opts.periodYear, authority: opts.authority, status: opts.status }),
    enabled:  opts.enabled !== false && !!opts.report,
  });
}

// ── Mutation hook (invalidates the remittances subtree) ────────────────────────

export function useRemittanceMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: financeQueryKeys.remittancesBase() });
    },
  });
}

/** Typed convenience mutation hooks */
export const useSubmitRemittance   = () => useRemittanceMutation(financeRemittancesApi.submit);
export const useApproveRemittance  = () => useRemittanceMutation(financeRemittancesApi.approve);
export const useMarkPaidRemittance = () => useRemittanceMutation((a: MarkPaidArgs)  => financeRemittancesApi.markPaid(a));
export const useMarkFiledRemittance= () => useRemittanceMutation((a: MarkFiledArgs) => financeRemittancesApi.markFiled(a));
export const useCancelRemittance   = () => useRemittanceMutation((a: { id: string; reason: string }) => financeRemittancesApi.cancel(a));
export const useCreateRemittance   = () => useRemittanceMutation((a: CreateRemittanceArgs) => financeRemittancesApi.create(a));

// ── Audit log ──────────────────────────────────────────────────────────────────

export interface RemittanceAuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  previousState: unknown;
  newState: unknown;
  reason: string | null;
  createdAt: string;
}

export function useRemittanceAudit(remittanceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'remittances', remittanceId ?? '', 'audit'],
    queryFn:  () => call<RemittanceAuditEntry[]>('finance/remittances/audit/list', { id: remittanceId! }),
    enabled:  enabled && !!remittanceId,
    staleTime: 30_000,
  });
}
