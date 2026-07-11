/**
 * src/api/hr/overtime.ts
 *
 * Typed client + TanStack hooks for HR Overtime entries
 * (routes/hrOvertime.ts — POST `hr/overtime/*`). Employees submit their own OT;
 * managers/HR approve. Approved OT feeds payroll; paid entries are immutable.
 * `actorId`/self-scope are enforced server-side.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

export type OvertimeStatus = 'submitted' | 'approved' | 'rejected' | 'paid' | 'cancelled';

/** Structured overtime classification — mirrors finance_overtime_rules.event_type. */
export type OvertimeType =
  | 'regular_overtime' | 'public_holiday' | 'rest_day' | 'callout' | 'night_shift';

export interface OvertimeEntry {
  id: string;
  overtimeNo: string | null;
  employeeId: string;
  workDate: string;
  hours: number;
  multiplier: number;
  otType: OvertimeType | null;
  reason: string | null;
  status: OvertimeStatus;
  workflowId: string | null;
  payrollRunId: string | null;
  payrollRunLineId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitOvertimeArgs {
  workDate: string;
  hours: number;
  multiplier?: number;
  otType?: OvertimeType | null;
  reason?: string | null;
}

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

export const hrOvertimeApi = {
  listOvertime: (a: { employeeId?: string; status?: string; workDateFrom?: string; workDateTo?: string; payrollRunId?: string } = {}) => call<OvertimeEntry[]>('hr/overtime/list', a),
  getOvertime:  (a: { id: string })                  => call<OvertimeEntry>('hr/overtime/get', a),
  submitOvertime:(a: SubmitOvertimeArgs)             => call<OvertimeEntry>('hr/overtime/submit', a),
  approveOvertime:(a: { id: string })                => call<OvertimeEntry>('hr/overtime/approve', a),
  rejectOvertime:(a: { id: string; reason?: string })=> call<OvertimeEntry>('hr/overtime/reject', a),
  cancelOvertime:(a: { id: string })                 => call<OvertimeEntry>('hr/overtime/cancel', a),
  listReports:  (a: object = {})                     => call<Array<Record<string, unknown>>>('hr/overtime/reports/list', a),
};

export const hrOvertimeKeys = {
  entries: (o: object = {}) => ['hr', 'overtime', 'entries', o] as const,
};

export function useOvertimeEntries(opts: { employeeId?: string; status?: string; workDateFrom?: string; workDateTo?: string; payrollRunId?: string } = {}) {
  return useQuery({ queryKey: hrOvertimeKeys.entries(opts), queryFn: () => hrOvertimeApi.listOvertime(opts) });
}

export function useOvertimeMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['hr', 'overtime'] }); } });
}
