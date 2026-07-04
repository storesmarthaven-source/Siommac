/**
 * src/api/finance/remittances.ts
 *
 * Typed client + TanStack hooks for the Finance Statutory Remittances & Filing
 * backend (routes/financeRemittances.ts — POST `finance/remittances/*`).
 *
 * Lifecycle: draft → submitted → approved → paid → filed
 * SoD: creator ≠ approver (enforced server-side).
 * `actorId` is derived server-side from auth — clients never send it.
 *
 * `call<T>` throws on `success:false`; callers surface errors via @lib/dialog or toast.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// ── DTOs (mirror the backend lib return shapes exactly) ─────────────────────────

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

export interface RemittanceReportRow {
  id: string;
  remittanceNo: string;
  periodYear: number;
  periodMonth: number;
  authority: string;
  status: string;
  totalDue: number;
  paidDate: string | null;
  filedDate: string | null;
  authorityReference: string | null;
  createdAt: string;
}

// ── Create input types ──────────────────────────────────────────────────────────

export interface CreateRemittanceArgs {
  payrollRunId: string;
  authority: RemittanceAuthority;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

// ── Core call helper ────────────────────────────────────────────────────────────

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

// ── API object ──────────────────────────────────────────────────────────────────

export const financeRemittancesApi = {
  list:    (a: { payrollRunId?: string; authority?: RemittanceAuthority; status?: RemittanceStatus; periodYear?: number; periodMonth?: number } = {}) =>
             call<Remittance[]>('finance/remittances/list', a),
  get:     (a: { id: string })                              => call<Remittance>('finance/remittances/get', a),
  lines:   (a: { remittanceId: string })                   => call<RemittanceLine[]>('finance/remittances/lines/list', a),
  compute: (a: { payrollRunId: string; authority: RemittanceAuthority }) =>
             call<ComputedRemittance>('finance/remittances/compute', a),
  create:  (a: CreateRemittanceArgs)                       => call<Remittance>('finance/remittances/create', a),
  submit:  (a: { id: string })                             => call<Remittance>('finance/remittances/submit', a),
  approve: (a: { id: string })                             => call<Remittance>('finance/remittances/approve', a),
  markPaid:(a: { id: string; paidDate?: string; authorityReference?: string }) =>
             call<Remittance>('finance/remittances/mark-paid', a),
  markFiled:(a: { id: string; filedDate?: string; authorityReference?: string }) =>
             call<Remittance>('finance/remittances/mark-filed', a),
  cancel:  (a: { id: string; reason: string })             => call<Remittance>('finance/remittances/cancel', a),

  // Reports
  listReport: (a: { periodYear?: number; authority?: RemittanceAuthority; status?: RemittanceStatus } = {}) =>
                call<RemittanceReportRow[]>('finance/remittances/reports/list', a),
};

// ── Query keys ────────────────────────────────────────────────────────────────

export const financeRemittancesKeys = {
  list:   (o: object = {}) => ['finance', 'remittances', 'list', o] as const,
  single: (id: string)     => ['finance', 'remittances', 'single', id] as const,
  lines:  (id: string)     => ['finance', 'remittances', 'lines', id] as const,
  compute:(a: object)      => ['finance', 'remittances', 'compute', a] as const,
  report: (o: object = {}) => ['finance', 'remittances', 'report', o] as const,
};

// ── Query hooks ─────────────────────────────────────────────────────────────────

export function useRemittances(opts: {
  payrollRunId?: string;
  authority?: RemittanceAuthority;
  status?: RemittanceStatus;
  periodYear?: number;
  periodMonth?: number;
} = {}) {
  return useQuery({
    queryKey: financeRemittancesKeys.list(opts),
    queryFn:  () => financeRemittancesApi.list(opts),
  });
}

export function useRemittance(id: string | null) {
  return useQuery({
    queryKey: financeRemittancesKeys.single(id ?? ''),
    queryFn:  () => financeRemittancesApi.get({ id: id! }),
    enabled:  !!id,
  });
}

export function useRemittanceLines(remittanceId: string | null) {
  return useQuery({
    queryKey: financeRemittancesKeys.lines(remittanceId ?? ''),
    queryFn:  () => financeRemittancesApi.lines({ remittanceId: remittanceId! }),
    enabled:  !!remittanceId,
  });
}

export function useComputedRemittance(payrollRunId: string | null, authority: RemittanceAuthority | null) {
  return useQuery({
    queryKey: financeRemittancesKeys.compute({ payrollRunId, authority }),
    queryFn:  () => financeRemittancesApi.compute({ payrollRunId: payrollRunId!, authority: authority! }),
    enabled:  !!payrollRunId && !!authority,
  });
}

export function useRemittancesReport(opts: {
  periodYear?: number;
  authority?: RemittanceAuthority;
  status?: RemittanceStatus;
} = {}) {
  return useQuery({
    queryKey: financeRemittancesKeys.report(opts),
    queryFn:  () => financeRemittancesApi.listReport(opts),
  });
}

// ── Mutation hook (invalidates the whole finance-remittances subtree) ───────────

export function useRemittanceMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'remittances'] });
    },
  });
}
