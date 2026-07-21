/**
 * src/api/hr/documents.ts
 *
 * TanStack Query hooks for the HR Documents module.
 *
 * Reuses upload/verify/archive/download hooks from employees.ts — no duplication.
 * All new hooks here cover the cross-employee register, expiry, requirements, compliance.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { requireHrSuccess } from './client';
import type {
  HrDocumentRow, DocumentFilters, DocumentsStats,
  DocumentRequirement, CreateRequirementArgs, UpdateRequirementArgs,
  EmployeeComplianceRow, ComplianceOverviewRow, ExpirySweepResult,
} from '../../../types/hrDocuments';

// Re-export hooks from employees.ts so the Documents page only imports from this file.
export type { HrDocument, UploadDocArgs } from './employees';
export {
  useHrDocuments,
  useUploadHrDocument,
  useVerifyHrDocument,
  useArchiveHrDocument,
  getHrDocumentDownloadUrl,
} from './employees';

// ── Query keys ────────────────────────────────────────────────────────────────

const docsKeys = {
  all:          ['hr', 'documents'] as const,
  list:         (f: DocumentFilters) => ['hr', 'documents', 'list', f] as const,
  stats:        () => ['hr', 'documents', 'stats'] as const,
  expiring:     (days?: number) => ['hr', 'documents', 'expiring', days] as const,
  requirements: () => ['hr', 'documents', 'requirements'] as const,
  compliance:   (empId?: string) => ['hr', 'documents', 'compliance', empId] as const,
  complianceOverview: (deptId?: string) => ['hr', 'documents', 'compliance-overview', deptId] as const,
};

// ── Helper ────────────────────────────────────────────────────────────────────

async function call<T>(path: string, args: unknown): Promise<T> {
  const res = await apiPost<{ success: boolean; data?: T; message?: string }>(path, args as Record<string, unknown>);
  return requireHrSuccess(res, path).data as T;
}

// ── Cross-employee register ───────────────────────────────────────────────────

export function useDocumentsList(filters: DocumentFilters = {}) {
  return useQuery({
    queryKey: docsKeys.list(filters),
    queryFn: () => call<{ rows: HrDocumentRow[]; total: number }>('hr/documents/list', filters),
    placeholderData: (prev) => prev,
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function useDocumentsStats() {
  return useQuery({
    queryKey: docsKeys.stats(),
    queryFn: () => call<DocumentsStats>('hr/documents/stats', {}),
    placeholderData: (prev) => prev,
  });
}

// ── Expiring ──────────────────────────────────────────────────────────────────

export function useDocumentsExpiring(withinDays?: number) {
  return useQuery({
    queryKey: docsKeys.expiring(withinDays),
    queryFn: () => call<HrDocumentRow[]>('hr/documents/expiring', withinDays ? { withinDays } : {}),
    placeholderData: (prev) => prev,
  });
}

// ── Requirements ──────────────────────────────────────────────────────────────

export function useDocumentRequirements(activeOnly = true) {
  return useQuery({
    queryKey: docsKeys.requirements(),
    queryFn: () => call<DocumentRequirement[]>('hr/documents/requirements/list', { activeOnly }),
    placeholderData: (prev) => prev,
  });
}

export function useCreateRequirement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateRequirementArgs) =>
      call<DocumentRequirement>('hr/documents/requirements/create', args),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: docsKeys.all }); },
  });
}

export function useUpdateRequirement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateRequirementArgs) =>
      call<DocumentRequirement>('hr/documents/requirements/update', args),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: docsKeys.all }); },
  });
}

export function useRetireRequirement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requirementId: string) =>
      call<undefined>('hr/documents/requirements/retire', { requirementId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: docsKeys.all }); },
  });
}

// ── Compliance ────────────────────────────────────────────────────────────────

export function useComplianceForEmployee(employeeId: string | null) {
  return useQuery({
    queryKey: docsKeys.compliance(employeeId ?? undefined),
    enabled: !!employeeId,
    queryFn: () => call<EmployeeComplianceRow[]>('hr/documents/compliance', { employeeId }),
    placeholderData: (prev) => prev,
  });
}

export function useComplianceOverview(departmentId?: string) {
  return useQuery({
    queryKey: docsKeys.complianceOverview(departmentId),
    queryFn: () => call<ComplianceOverviewRow[]>('hr/documents/compliance', { overview: true, departmentId }),
    placeholderData: (prev) => prev,
  });
}

// ── Expiry sweep (oversight) ─────────────────────────────────────────────────

export function useRunExpirySweep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const path = 'hr/documents/expiry/run-sweep';
      return requireHrSuccess(
        await apiPost<{ success: boolean; data?: ExpirySweepResult; message?: string }>(path, {}),
        path,
      );
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: docsKeys.all }); },
  });
}
