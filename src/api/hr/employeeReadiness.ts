/**
 * src/api/hr/employeeReadiness.ts — typed client for the readiness control
 * matrix, work-item detail and the two transition routes.
 *
 * Mirrors the backend's separation exactly: coordination (`follow-up`) and
 * specialist review (`review`) are different endpoints with different
 * permissions, so they are different mutations here too. Collapsing them into
 * one client call would have re-introduced in the UI the authority blur the
 * backend deliberately prevents.
 *
 * The server returns the actions the CURRENT actor may take on each work item;
 * the UI renders those and never derives its own action list.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { hrEmployeeKeys } from '../queryKeys';
import type {
  EmployeeReadinessMatrix, ReadinessWorkItemDetail, ReadinessControlMatrixEntry,
  ReadinessOwnerResolution, ReadinessWorkItemAction, ReadinessActionKey,
  ReadinessCoverage, ReadinessState, ReadinessDomain, ReadinessResolutionType,
  DocumentHealthSummary, DocumentHealthGroup, DocumentHealthItem, DocumentHealthState,
  EmployeeAccessAssignment,
} from '../../../types/hrEmployeeProfile';

export type {
  EmployeeReadinessMatrix, ReadinessWorkItemDetail, ReadinessControlMatrixEntry,
  ReadinessOwnerResolution, ReadinessWorkItemAction, ReadinessActionKey,
  ReadinessCoverage, ReadinessState, ReadinessDomain, ReadinessResolutionType,
  DocumentHealthSummary, DocumentHealthGroup, DocumentHealthItem, DocumentHealthState,
  EmployeeAccessAssignment,
};

/** Result the transition routes return — used to confirm side effects fired. */
export interface ReadinessTransitionResult {
  workItemId: string;
  status: ReadinessState;
  domain: ReadinessDomain;
  workflowId: string | null;
  handoffId: string | null;
  notified: number;
  coverage: ReadinessCoverage;
  correlationId: string;
}

/**
 * A refusal carrying the server's machine-readable code.
 *
 * `owner_required` must stay distinguishable from a generic failure: the UI
 * renders it as **Owner Required** and points an administrator at Settings,
 * rather than showing it as an error the current user could retry away.
 */
export class ReadinessRequestError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = 'ReadinessRequestError';
  }
  get isOwnerRequired(): boolean { return this.code === 'owner_required'; }
}

async function call<T>(path: string, args: Record<string, unknown>): Promise<T> {
  const res = await apiPost<{ success: boolean; message?: string; code?: string; data: T }>(path, args);
  if (!res.success) throw new ReadinessRequestError(res.message ?? 'Request failed.', res.code ?? null);
  return res.data;
}

/** The Readiness tab's dataset: controls, states, resolved owners, work items. */
export function useReadinessMatrix(employeeId: string | null, enabled = true) {
  return useQuery({
    queryKey: hrEmployeeKeys.readinessMatrix(employeeId ?? ''),
    enabled: !!employeeId && enabled,
    queryFn: async () => {
      const matrix = await call<EmployeeReadinessMatrix>('hr/employees/readiness/matrix', { employeeId });
      // Same stale-switch backstop as the profile shell: a late response for a
      // previously selected employee must never render under the current one.
      if (employeeId && matrix.employeeId !== employeeId) {
        throw new Error(`Readiness matrix mismatch: received ${matrix.employeeId} while ${employeeId} is selected.`);
      }
      return matrix;
    },
    staleTime: 30_000,
  });
}

/** Full work-item detail behind **Open Work Item**. Loaded only when opened. */
export function useReadinessWorkItem(workItemId: string | null, enabled = true) {
  return useQuery({
    queryKey: hrEmployeeKeys.readinessWorkItem(workItemId ?? ''),
    enabled: !!workItemId && enabled,
    queryFn: () => call<ReadinessWorkItemDetail>('hr/employees/readiness/work-item', { workItemId }),
    staleTime: 15_000,
  });
}

/**
 * Invalidate everything a readiness transition can change.
 *
 * A transition recalculates coverage, so the shell gauge and the tab indicators
 * move too — but nothing outside this employee does, so the register list is
 * deliberately left alone.
 */
function useInvalidateReadiness() {
  const qc = useQueryClient();
  return (employeeId: string, workItemId?: string | null) => {
    void qc.invalidateQueries({ queryKey: hrEmployeeKeys.readinessMatrix(employeeId) });
    void qc.invalidateQueries({ queryKey: hrEmployeeKeys.profileShell(employeeId) });
    void qc.invalidateQueries({ queryKey: hrEmployeeKeys.attention(employeeId) });
    if (workItemId) void qc.invalidateQueries({ queryKey: hrEmployeeKeys.readinessWorkItem(workItemId) });
  };
}

export interface ReadinessFollowUpInput {
  employeeId: string;
  controlKey: string;
  workItemId?: string | null;
  action: 'send_reminder' | 'request_information';
  note?: string;
  dueDate?: string | null;
  severity?: 'critical' | 'warning' | 'info' | null;
}

/** HR coordination. Never confers specialist resolution authority. */
export function useReadinessFollowUp() {
  const invalidate = useInvalidateReadiness();
  return useMutation({
    mutationFn: (input: ReadinessFollowUpInput) =>
      call<ReadinessTransitionResult>('hr/employees/readiness/follow-up', { ...input }),
    onSuccess: (_result, input) => invalidate(input.employeeId, input.workItemId ?? null),
  });
}

export interface ReadinessReviewInput {
  employeeId: string;
  controlKey: string;
  workItemId?: string | null;
  action: 'approve' | 'return' | 'approve_exception' | 'mark_not_applicable';
  reason?: string;
}

/** Authorised review transitions. `return` is NOT terminal. */
export function useReadinessReview() {
  const invalidate = useInvalidateReadiness();
  return useMutation({
    mutationFn: (input: ReadinessReviewInput) =>
      call<ReadinessTransitionResult>('hr/employees/readiness/review', { ...input }),
    onSuccess: (_result, input) => invalidate(input.employeeId, input.workItemId ?? null),
  });
}

// ── Document health ─────────────────────────────────────────────────────────

/**
 * Per-employee document health: required/verified/expiring/missing counts and
 * percentages plus the real grouped tree.
 *
 * TAB-SCOPED on purpose — it is not part of the profile shell, so opening the
 * drawer never pulls the document tree. This replaces the page's former
 * client-side derivation from a document list, which could not know what was
 * REQUIRED and therefore could not report anything missing.
 */
export function useEmployeeDocumentHealth(employeeId: string | null, enabled = true) {
  return useQuery({
    queryKey: hrEmployeeKeys.documentHealth(employeeId ?? ''),
    enabled: !!employeeId && enabled,
    queryFn: () => call<DocumentHealthSummary>('hr/employees/document-health', { employeeId }),
    staleTime: 60_000,
  });
}

// ── Access assignments ──────────────────────────────────────────────────────

/**
 * An employee's access assignments with their STORED scopes.
 *
 * Every id is resolved to a label server-side, so the Access tab renders names
 * rather than raw uuids.
 */
export function useEmployeeAccessAssignments(
  employeeId: string | null, activeOnly = false, enabled = true,
) {
  return useQuery({
    queryKey: [...hrEmployeeKeys.accessAssignments(employeeId ?? ''), activeOnly],
    enabled: !!employeeId && enabled,
    queryFn: () => call<EmployeeAccessAssignment[]>('hr/employees/access-assignments', { employeeId, activeOnly }),
    staleTime: 60_000,
  });
}
