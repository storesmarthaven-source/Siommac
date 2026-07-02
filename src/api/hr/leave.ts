/**
 * src/api/hr/leave.ts
 *
 * Typed client + TanStack hooks for the HR Leave & Absence backend.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  LeaveType, LeaveRequest, LeaveBalance, LeaveCalendarEntry, LeaveStats,
  LeaveListArgs, LeaveListResult, CalendarArgs, RunAccrualsArgs, LeaveReportArgs,
  SubmitLeaveRequestArgs, UpdateLeaveRequestArgs, CancelLeaveRequestArgs,
  ApproveLeaveArgs, RejectLeaveArgs, AdjustBalanceArgs, SubmitLeaveResult,
} from '../../../types/hrLeave';

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to  failed.`);
  return res.data;
}
export const hrLeaveApi = {
  listTypes:           (includeInactive?: boolean)      => call<LeaveType[]>('hr/leave/types/list', { includeInactive }),
  getType:             (id: string)                     => call<LeaveType>('hr/leave/types/get', { id }),
  createType:          (a: Partial<LeaveType> & { code: string; label: string }) => call<LeaveType>('hr/leave/types/create', a),
  updateType:          (id: string, a: Partial<LeaveType>) => call<LeaveType>('hr/leave/types/update', { id, ...a }),
  retireType:          (id: string)                     => call<void>('hr/leave/types/retire', { id }),

  submitRequest:       (a: SubmitLeaveRequestArgs)      => call<SubmitLeaveResult>('hr/leave/request/submit', a),
  listMyRequests:      (a?: LeaveListArgs)              => call<LeaveListResult>('hr/leave/request/list', a ?? {}),
  listAllRequests:     (a?: LeaveListArgs)              => call<LeaveListResult>('hr/leave/request/list-all', a ?? {}),
  getRequest:          (requestId: string)              => call<LeaveRequest>('hr/leave/request/get', { requestId }),
  updateRequest:       (a: UpdateLeaveRequestArgs)      => call<void>('hr/leave/request/update', a),
  cancelRequest:       (a: CancelLeaveRequestArgs)      => call<void>('hr/leave/request/cancel', a),
  approveRequest:      (a: ApproveLeaveArgs)            => call<void>('hr/leave/request/approve', a),
  rejectRequest:       (a: RejectLeaveArgs)             => call<void>('hr/leave/request/reject', a),

  getBalances:         (employeeId?: string, year?: number) => call<LeaveBalance[]>('hr/leave/balances/get', { employeeId, year }),
  adjustBalance:       (a: AdjustBalanceArgs)           => call<void>('hr/leave/balances/adjust', a),

  runAccruals:         (a: RunAccrualsArgs)             => call<{ processed: number; skipped: number }>('hr/leave/accruals/run', a),

  getCalendar:         (a: CalendarArgs)                => call<LeaveCalendarEntry[]>('hr/leave/calendar/get', a),
  getStats:            ()                               => call<LeaveStats>('hr/leave/stats', {}),

  listReports:         ()                               => call<unknown[]>('hr/leave/reports/list', {}),
  runReport:           (a: LeaveReportArgs)             => call<{ rows: unknown[]; total: number }>('hr/leave/reports/run', a),
  exportReport:        (a: LeaveReportArgs)             => call<{ rows: unknown[]; total: number }>('hr/leave/reports/export', a),
};

export function useLeaveTypes(includeInactive = false) {
  return useQuery({ queryKey: ['hr-leave-types', includeInactive], queryFn: () => hrLeaveApi.listTypes(includeInactive) });
}

export function useMyLeaveRequests(args?: LeaveListArgs) {
  return useQuery({ queryKey: ['hr-leave-my', args], queryFn: () => hrLeaveApi.listMyRequests(args) });
}

export function useAllLeaveRequests(args?: LeaveListArgs) {
  return useQuery({ queryKey: ['hr-leave-all', args], queryFn: () => hrLeaveApi.listAllRequests(args) });
}

export function useLeaveBalances(employeeId?: string, year?: number) {
  return useQuery({ queryKey: ['hr-leave-balances', employeeId, year], queryFn: () => hrLeaveApi.getBalances(employeeId, year) });
}

export function useLeaveCalendar(args: CalendarArgs) {
  return useQuery({
    queryKey: ['hr-leave-calendar', args.fromDate, args.toDate, args.departmentId],
    queryFn:  () => hrLeaveApi.getCalendar(args),
    enabled:  !!(args.fromDate && args.toDate),
  });
}

export function useLeaveStats() {
  return useQuery({ queryKey: ['hr-leave-stats'], queryFn: () => hrLeaveApi.getStats() });
}

export function useLeaveReports() {
  return useQuery({ queryKey: ['hr-leave-reports-list'], queryFn: () => hrLeaveApi.listReports() });
}
export function useSubmitLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: SubmitLeaveRequestArgs) => hrLeaveApi.submitRequest(a),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['hr-leave-my'] }); void qc.invalidateQueries({ queryKey: ['hr-leave-all'] }); void qc.invalidateQueries({ queryKey: ['hr-leave-stats'] }); },
  });
}

export function useApproveLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: ApproveLeaveArgs) => hrLeaveApi.approveRequest(a),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['hr-leave-all'] }); void qc.invalidateQueries({ queryKey: ['hr-leave-stats'] }); void qc.invalidateQueries({ queryKey: ['hr-leave-balances'] }); },
  });
}

export function useRejectLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: RejectLeaveArgs) => hrLeaveApi.rejectRequest(a),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['hr-leave-all'] }); void qc.invalidateQueries({ queryKey: ['hr-leave-stats'] }); },
  });
}

export function useCancelLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: CancelLeaveRequestArgs) => hrLeaveApi.cancelRequest(a),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['hr-leave-my'] }); void qc.invalidateQueries({ queryKey: ['hr-leave-all'] }); void qc.invalidateQueries({ queryKey: ['hr-leave-stats'] }); },
  });
}

export function useRunAccruals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: RunAccrualsArgs) => hrLeaveApi.runAccruals(a),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['hr-leave-balances'] }); },
  });
}

export function useAdjustBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: AdjustBalanceArgs) => hrLeaveApi.adjustBalance(a),
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['hr-leave-balances'] }); },
  });
}
