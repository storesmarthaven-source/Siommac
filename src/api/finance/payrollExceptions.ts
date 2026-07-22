// Payroll Exceptions & Approvals work-queue (F-06/F-07, spec §15.3) — frontend API.
// Backend (merged be6dce05): findings/work-queue (keyset union of findings + open
// approval workflow-tasks, tabCounts + optional selected detail), findings/detail,
// findings/escalate, findings/comment, plus the existing findings assign/resolve/
// waive/reopen commands. Shared DTOs live in root types/payrollFindings.
//
// Approval-kind rows are REVIEW-ONLY here (DEC-EXC-004): approve/return/reject go
// through the central workflow decision path (the run workspace / task), never this
// queue — so this client exposes escalate/comment + the finding lifecycle commands,
// and deep-links approval rows via workflowTaskId.

import { useMutation, useQuery, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  PayrollWorkQueueRequest,
  PayrollWorkQueueResult,
  PayrollFindingDetail,
  PayrollFindingEscalateRequest,
  PayrollFindingCommentRequest,
  PayrollFindingCommentResult,
} from '../../../types/payrollFindings';

export type * from '../../../types/payrollFindings';

async function post<T>(path: string, args: object): Promise<T> {
  const r = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!r.success) throw new Error(r.message ?? 'Payroll work-queue request failed.');
  return r.data;
}

// Finding lifecycle command payloads (existing routes; version-guarded + idempotent).
export interface FindingAssignRequest { id: string; expectedVersion: number; idempotencyKey: string; assigneeId: string; note?: string }
export interface FindingResolveRequest { id: string; expectedVersion: number; idempotencyKey: string; note: string; evidence: Record<string, unknown> }
export interface FindingWaiveRequest { id: string; expectedVersion: number; idempotencyKey: string; reason: string; expiresAt?: string }
export interface FindingReopenRequest { id: string; expectedVersion: number; idempotencyKey: string; reason: string }

export interface WorkQueueDetailRequest { findingId: string; activityLimit?: number; activityCursor?: string }

export const workQueueKeys = {
  all:   ['finance', 'payroll', 'work-queue'] as const,
  queue: (req: PayrollWorkQueueRequest) => ['finance', 'payroll', 'work-queue', 'queue', req] as const,
  detail: (id: string, activityCursor?: string) => ['finance', 'payroll', 'work-queue', 'detail', id, activityCursor ?? ''] as const,
};

export const workQueueApi = {
  queue:    (req: PayrollWorkQueueRequest) => post<PayrollWorkQueueResult>('finance/payroll/findings/work-queue', req),
  detail:   (req: WorkQueueDetailRequest) => post<PayrollFindingDetail>('finance/payroll/findings/detail', req),
  escalate: (req: PayrollFindingEscalateRequest) => post<PayrollFindingCommentResult>('finance/payroll/findings/escalate', req),
  comment:  (req: PayrollFindingCommentRequest) => post<PayrollFindingCommentResult>('finance/payroll/findings/comment', req),
  assign:   (req: FindingAssignRequest) => post<unknown>('finance/payroll/findings/assign', req),
  resolve:  (req: FindingResolveRequest) => post<unknown>('finance/payroll/findings/resolve', req),
  waive:    (req: FindingWaiveRequest) => post<unknown>('finance/payroll/findings/waive', req),
  reopen:   (req: FindingReopenRequest) => post<unknown>('finance/payroll/findings/reopen', req),
};

// ── Query hooks ─────────────────────────────────────────────────────────────────

/** The work-queue read authority. One call returns items + tabCounts + (when
 *  selectedId is set) the hydrated detail with its activity feed. Each distinct
 *  request is its own cache key so tab/filter/selection changes refetch cleanly. */
export function useWorkQueue(req: PayrollWorkQueueRequest, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey:        workQueueKeys.queue(req),
    queryFn:         () => workQueueApi.queue(req),
    enabled:         opts.enabled ?? true,
    placeholderData: prev => prev,   // keep the list visible while the next page/selection loads
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────
//
// Every command invalidates the whole work-queue (list counts + the open detail
// change together). Callers surface the toast; hooks just refetch.

export function useWorkQueueMutations() {
  const qc = useQueryClient();
  const invalidate = (): void => void qc.invalidateQueries({ queryKey: workQueueKeys.all });
  return {
    escalate: useMutation({ mutationFn: workQueueApi.escalate, onSuccess: invalidate }),
    comment:  useMutation({ mutationFn: workQueueApi.comment,  onSuccess: invalidate }),
    assign:   useMutation({ mutationFn: workQueueApi.assign,   onSuccess: invalidate }),
    resolve:  useMutation({ mutationFn: workQueueApi.resolve,  onSuccess: invalidate }),
    waive:    useMutation({ mutationFn: workQueueApi.waive,    onSuccess: invalidate }),
    reopen:   useMutation({ mutationFn: workQueueApi.reopen,   onSuccess: invalidate }),
  };
}
