/**
 * src/api/communicationsCompliance.ts
 *
 * TanStack Query hooks for the Messenger Compliance V1 workspace. All routes are
 * POST /api/communications/compliance/* (auth JWT via apiPost) and return the
 * shared envelope `{ success, data }`. Request/response DTOs come from the
 * backend-owned frozen contract (types/messagingCompliance.ts); this layer does
 * not define its own shapes.
 *
 * Invalidation is scoped to compliance keys only — never the whole communications
 * snapshot (contract §7). Mutations do not auto-retry.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  ComplianceSummary,
  ComplianceCasesListRequest, ComplianceCasesListResponse,
  ComplianceCaseDetail,
  ComplianceCaseRequest,
  ComplianceCaseDecisionRequest,
  ComplianceCaseCloseRequest,
  ComplianceConversationSearchRequest, ComplianceConversationSearchResponse,
  ComplianceConversationReadRequest, ComplianceMessagePage,
  ComplianceGrant, ComplianceGrantRevokeRequest,
  ComplianceAccessEventsListRequest, ComplianceAccessEventsListResponse,
  ComplianceExportsListResponse, ComplianceExport,
  ComplianceExportCreateRequest,
  ComplianceExportDownloadResponse,
} from '../../types/messagingCompliance';

/** apiPost's body is typed `Record<string, unknown>`; our request DTOs are named
 *  interfaces (assignable to `object`, which safely narrows to the Record). */
const asArgs = (body: object): Record<string, unknown> => body as Record<string, unknown>;

// ── Query keys (compliance-scoped; local per contract §7) ────────────────────────
export const complianceKeys = {
  all:     ['communications', 'compliance'] as const,
  summary: () => [...complianceKeys.all, 'summary'] as const,
  cases:   (filters: ComplianceCasesListRequest) => [...complianceKeys.all, 'cases', filters] as const,
  case:    (caseId: string) => [...complianceKeys.all, 'case', caseId] as const,
  conversationSearch: (filters: ComplianceConversationSearchRequest) =>
    [...complianceKeys.all, 'conversation-search', filters] as const,
  conversation: (caseId: string, threadId: string, cursor?: string | null) =>
    [...complianceKeys.all, 'conversation', caseId, threadId, cursor ?? null] as const,
  events:  (filters: ComplianceAccessEventsListRequest) => [...complianceKeys.all, 'events', filters] as const,
  exports: (caseId: string) => [...complianceKeys.all, 'exports', caseId] as const,
} as const;

// ── Reads ────────────────────────────────────────────────────────────────────

/** Complete-dataset operational counts for the four summary cards. */
export function useComplianceSummary() {
  return useQuery({
    queryKey: complianceKeys.summary(),
    queryFn: async (): Promise<ComplianceSummary> => {
      const res = await apiPost<{ success: boolean; data: ComplianceSummary }>(
        'communications/compliance/summary/get', {});
      return res.data;
    },
  });
}

export function useComplianceCases(filters: ComplianceCasesListRequest = {}) {
  return useQuery({
    queryKey: complianceKeys.cases(filters),
    queryFn: async (): Promise<ComplianceCasesListResponse> => {
      const res = await apiPost<{ success: boolean; data: ComplianceCasesListResponse }>(
        'communications/compliance/cases/list', asArgs(filters));
      return res.data;
    },
  });
}

export function useComplianceCase(caseId: string | null) {
  return useQuery({
    queryKey: complianceKeys.case(caseId ?? ''),
    enabled:  Boolean(caseId),
    queryFn: async (): Promise<ComplianceCaseDetail> => {
      const res = await apiPost<{ success: boolean; data: ComplianceCaseDetail }>(
        'communications/compliance/cases/get', { caseId });
      return res.data;
    },
  });
}

export function useComplianceConversationSearch(filters: ComplianceConversationSearchRequest, enabled = true) {
  return useQuery({
    queryKey: complianceKeys.conversationSearch(filters),
    enabled,
    queryFn: async (): Promise<ComplianceConversationSearchResponse> => {
      const res = await apiPost<{ success: boolean; data: ComplianceConversationSearchResponse }>(
        'communications/compliance/conversations/search', asArgs(filters));
      return res.data;
    },
  });
}

/** Read-only conversation page. The read records an audited `page_read`, so the
 *  request is idempotency-keyed (stable per case+thread+cursor). */
export function useComplianceConversation(caseId: string | null, threadId: string | null, cursor?: string | null) {
  return useQuery({
    queryKey: complianceKeys.conversation(caseId ?? '', threadId ?? '', cursor),
    enabled:  Boolean(caseId && threadId),
    queryFn: async (): Promise<ComplianceMessagePage> => {
      const req: ComplianceConversationReadRequest = {
        caseId: caseId!, threadId: threadId!, cursor,
        idempotencyKey: `read:${caseId}:${threadId}:${cursor ?? 'first'}`,
      };
      const res = await apiPost<{ success: boolean; data: ComplianceMessagePage }>(
        'communications/compliance/conversations/read', asArgs(req));
      return res.data;
    },
  });
}

export function useComplianceAccessEvents(filters: ComplianceAccessEventsListRequest = {}) {
  return useQuery({
    queryKey: complianceKeys.events(filters),
    queryFn: async (): Promise<ComplianceAccessEventsListResponse> => {
      const res = await apiPost<{ success: boolean; data: ComplianceAccessEventsListResponse }>(
        'communications/compliance/access-events/list', asArgs(filters));
      return res.data;
    },
  });
}

export function useComplianceExports(caseId: string | null) {
  return useQuery({
    queryKey: complianceKeys.exports(caseId ?? ''),
    enabled:  Boolean(caseId),
    queryFn: async (): Promise<ComplianceExport[]> => {
      const res = await apiPost<{ success: boolean; data: ComplianceExportsListResponse }>(
        'communications/compliance/exports/list', { caseId });
      return res.data.items;
    },
  });
}

// ── Mutations (no auto-retry; scoped invalidation) ──────────────────────────────

export function useRequestComplianceCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ComplianceCaseRequest) =>
      apiPost<{ success: boolean; data: ComplianceCaseDetail }>(
        'communications/compliance/cases/request', asArgs(input), { retryable: false }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: complianceKeys.all });
      void qc.invalidateQueries({ queryKey: complianceKeys.summary() });
    },
  });
}

export function useDecideComplianceCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ComplianceCaseDecisionRequest) =>
      apiPost<{ success: boolean; data: ComplianceCaseDetail }>(
        'communications/compliance/cases/decide', asArgs(input), { retryable: false }),
    onSuccess: (_res, input) => {
      void qc.invalidateQueries({ queryKey: complianceKeys.case(input.caseId) });
      void qc.invalidateQueries({ queryKey: complianceKeys.all });
      void qc.invalidateQueries({ queryKey: complianceKeys.summary() });
    },
  });
}

export function useCloseComplianceCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ComplianceCaseCloseRequest) =>
      apiPost<{ success: boolean; data: ComplianceCaseDetail }>(
        'communications/compliance/cases/close', asArgs(input), { retryable: false }),
    onSuccess: (_res, input) => {
      void qc.invalidateQueries({ queryKey: complianceKeys.case(input.caseId) });
      void qc.invalidateQueries({ queryKey: complianceKeys.all });
      void qc.invalidateQueries({ queryKey: complianceKeys.summary() });
    },
  });
}

export function useRevokeComplianceGrant() {
  const qc = useQueryClient();
  return useMutation({
    // Revoke targets a grant id (not a case), so invalidate compliance broadly.
    mutationFn: (input: ComplianceGrantRevokeRequest) =>
      apiPost<{ success: boolean; data: ComplianceGrant }>(
        'communications/compliance/grants/revoke', asArgs(input), { retryable: false }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: complianceKeys.all }); },
  });
}

export function useCreateComplianceExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ComplianceExportCreateRequest) =>
      apiPost<{ success: boolean; data: ComplianceExport }>(
        'communications/compliance/exports/create', asArgs(input), { retryable: false }),
    onSuccess: (_res, input) => {
      void qc.invalidateQueries({ queryKey: complianceKeys.exports(input.caseId) });
      void qc.invalidateQueries({ queryKey: complianceKeys.case(input.caseId) });
      void qc.invalidateQueries({ queryKey: complianceKeys.summary() });
    },
  });
}

/** Imperative: obtain a short-lived signed URL for a ready export, then hand off
 *  to the browser. Never stores a permanent storage path. */
export async function downloadComplianceExport(exportId: string): Promise<ComplianceExportDownloadResponse> {
  const res = await apiPost<{ success: boolean; data: ComplianceExportDownloadResponse }>(
    'communications/compliance/exports/download',
    { exportId, idempotencyKey: `download:${exportId}` },
    { retryable: false });
  return res.data;
}
