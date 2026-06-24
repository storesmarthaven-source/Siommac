/**
 * src/api/hse/training.ts
 *
 * TanStack Query hooks for the HSE Training / Competency module.
 * All data goes through the authenticated Netlify API. Mirrors hse/inspections.ts.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { trainingKeys } from '@api/queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CertificateStatus =
  | 'draft' | 'pending_verification' | 'current' | 'due_soon'
  | 'expired' | 'rejected' | 'revoked' | 'archived';
export type CellStatus = 'ok' | 'due_soon' | 'expired' | 'missing' | 'pending_verification' | 'not_required';
export type WorkerStatus = 'compliant' | 'due_soon' | 'non_compliant' | 'pending_verification' | 'not_applicable';
export type AssignmentStatus = 'assigned' | 'scheduled' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';

export interface MatrixCompetency {
  competencyId: string; competencyName: string; status: CellStatus;
  certificateId: string | null; expiresAt: string | null; requirementLevel: string;
}
export interface MatrixRow {
  workerId: string; workerName: string; roleName: string | null; siteName: string | null; departmentName: string | null;
  overallStatus: WorkerStatus;
  requiredCount: number; compliantCount: number; dueSoonCount: number; expiredCount: number; missingCount: number; pendingCount: number;
  competencies: MatrixCompetency[];
}
export interface TrainingStats {
  overallCompliancePercent: number; compliantSlots: number; totalRequiredSlots: number; targetPercent: number;
  currentCerts: number; dueForRenewal: number; expired: number; totalCertificates: number; trackedWorkers: number;
}
export interface CompetencyRow {
  id: string; name: string; code: string | null; category: string | null; description: string | null;
  default_renewal_window_days: number; requires_verification: boolean; requires_evidence: boolean; is_active: boolean;
}
export interface CourseRow { id: string; competency_id: string | null; name: string; provider: string | null; is_active: boolean }
export interface RequirementRow {
  id: string; role_name: string | null; site_name: string | null; department_name: string | null;
  competency_id: string; requirement_level: string; mandatory_before_work: boolean; is_active: boolean;
}
export interface CertificateRow {
  id: string; certificate_no: string; worker_id: string; worker_name: string | null;
  competency_id: string | null; course_id: string | null; course_name: string; provider: string | null;
  certificate_number: string | null; issued_at: string; expires_at: string; status: string;
  verification_required: boolean; verified_by: string | null; verified_at: string | null; created_at: string;
}
export interface EvidenceRow { id: string; file_name: string; evidence_type: string | null; uploaded_at: string; url?: string }
export interface VerificationRow { id: string; decision: string; comments: string | null; verified_by: string | null; verified_at: string }
export interface AuditEvent { id: string; entity_type: string; action: string; created_at: string }
export interface CertificateDetail {
  certificate: CertificateRow & Record<string, unknown>;
  evidence: EvidenceRow[]; verifications: VerificationRow[]; audit: AuditEvent[];
}
export interface AssignmentRow {
  id: string; assignment_no: string; worker_id: string; competency_id: string | null; course_id: string | null;
  reason: string | null; priority: string; provider: string | null; due_at: string; status: string; completed_at: string | null;
}

export interface MatrixFilter { siteId?: string; departmentId?: string; roleId?: string; status?: string; competencyId?: string; workerSearch?: string }
export interface CertFilter { workerId?: string; competencyId?: string; status?: string; limit?: number }

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useCompetencyMatrix(filter: MatrixFilter = {}) {
  return useQuery({
    queryKey: trainingKeys.matrix(filter as Record<string, unknown>),
    queryFn:  () => apiPost<{ success: boolean; data: MatrixRow[] }>('hse/training/competency-matrix', filter as Record<string, unknown>),
    staleTime: 30_000,
  });
}
export function useTrainingStats() {
  return useQuery({
    queryKey: trainingKeys.stats(),
    queryFn:  () => apiPost<{ success: boolean; data: TrainingStats }>('hse/training/stats', {}),
    staleTime: 30_000,
  });
}
export function useCertificates(filter: CertFilter = {}) {
  return useQuery({
    queryKey: trainingKeys.certList(filter as Record<string, unknown>),
    queryFn:  () => apiPost<{ success: boolean; data: CertificateRow[] }>('hse/training/certificates/list', filter as Record<string, unknown>),
    staleTime: 30_000,
  });
}
export function useCertificate(id: string | null) {
  return useQuery({
    queryKey: trainingKeys.certDetail(id ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: CertificateDetail }>('hse/training/certificates/get', { certificateId: id }),
    enabled:  !!id, staleTime: 15_000,
  });
}
export function useCompetencies(activeOnly = true) {
  return useQuery({
    queryKey: trainingKeys.competencies({ activeOnly }),
    queryFn:  () => apiPost<{ success: boolean; data: CompetencyRow[] }>('hse/training/competencies/list', { activeOnly }),
    staleTime: 5 * 60_000,
  });
}
export function useCourses(competencyId?: string) {
  const args = competencyId ? { competencyId } : {};
  return useQuery({
    queryKey: trainingKeys.courses(args),
    queryFn:  () => apiPost<{ success: boolean; data: CourseRow[] }>('hse/training/courses/list', args),
    staleTime: 5 * 60_000,
  });
}
export function useRequirements(filter: { roleName?: string; competencyId?: string } = {}) {
  return useQuery({
    queryKey: trainingKeys.requirements(filter),
    queryFn:  () => apiPost<{ success: boolean; data: RequirementRow[] }>('hse/training/requirements/list', filter),
    staleTime: 60_000,
  });
}
export function useAssignments(filter: { workerId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: trainingKeys.assignments(filter),
    queryFn:  () => apiPost<{ success: boolean; data: AssignmentRow[] }>('hse/training/assignments/list', filter),
    staleTime: 30_000,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: trainingKeys.all });
}

export interface CreateCertificateArgs {
  workerId: string; competencyId?: string | null; courseId?: string | null; courseName: string;
  provider?: string | null; certificateNumber?: string | null; issuedAt: string; expiresAt: string;
  verificationRequired?: boolean; asDraft?: boolean;
}
export function useCreateCertificate() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: CreateCertificateArgs) => apiPost<{ success: boolean; data: { id: string; certificateNo: string } }>('hse/training/certificates/create', args as unknown as Record<string, unknown>, { retryable: false }),
    onSuccess: inv,
  });
}
export function useRenewCertificate() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { certificateId: string; issuedAt: string; expiresAt: string; certificateNumber?: string | null; provider?: string | null }) =>
      apiPost<{ success: boolean; data: { id: string } }>('hse/training/certificates/renew', args),
    onSuccess: inv,
  });
}
export type CertVerifyAction = 'verify' | 'reject' | 'revoke' | 'archive';
export function useCertificateAction() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ action, certificateId, comments, reason }: { action: CertVerifyAction; certificateId: string; comments?: string; reason?: string }) =>
      apiPost<{ success: boolean }>(`hse/training/certificates/${action}`, { certificateId, comments, reason }),
    onSuccess: inv,
  });
}
export function useAddCertEvidence() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { certificateId: string; fileName: string; filePath: string; fileType?: string | null; fileSize?: number | null; evidenceType?: string }) =>
      apiPost<{ success: boolean; data: { id: string } }>('hse/training/certificates/evidence/add', args),
    onSuccess: inv,
  });
}
/** Full evidence upload: presigned URL → PUT → record. */
export function useUploadCertEvidence() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async ({ file, certificateId, evidenceType }: { file: File; certificateId: string; evidenceType?: string }) => {
      const signed = await apiPost<{ success: boolean; uploadUrl?: string; path?: string; message?: string }>('hse/training/certificates/evidence/upload-url', { fileName: file.name, mimeType: file.type }, { retryable: false });
      if (!signed.success || !signed.uploadUrl || !signed.path) throw new Error(signed.message ?? 'Could not start upload');
      const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);
      return apiPost<{ success: boolean; data: { id: string } }>('hse/training/certificates/evidence/add', { certificateId, fileName: file.name, filePath: signed.path, fileType: file.type, fileSize: file.size, evidenceType: evidenceType ?? 'certificate' });
    },
    onSuccess: inv,
  });
}
export function useCreateCompetency() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { name: string; code?: string | null; category?: string | null; defaultRenewalWindowDays?: number; requiresVerification?: boolean }) =>
      apiPost<{ success: boolean; data: { id: string } }>('hse/training/competencies/create', args),
    onSuccess: inv,
  });
}
export function useCreateRequirement() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: { competencyId: string; roleName?: string | null; departmentId?: string | null; departmentName?: string | null; requirementLevel?: string; mandatoryBeforeWork?: boolean }) =>
      apiPost<{ success: boolean; data: { id: string } }>('hse/training/requirements/create', args),
    onSuccess: inv,
  });
}
export function useDeleteRequirement() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (requirementId: string) => apiPost<{ success: boolean }>('hse/training/requirements/delete', { requirementId }),
    onSuccess: inv,
  });
}
export interface AssignTrainingArgs {
  workerId: string; competencyId?: string | null; courseId?: string | null; reason?: string | null;
  priority?: string; provider?: string | null; scheduledAt?: string | null; dueAt: string;
}
export function useAssignTraining() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (args: AssignTrainingArgs) => apiPost<{ success: boolean; data: { id: string; assignmentNo: string } }>('hse/training/assignments/create', args as unknown as Record<string, unknown>),
    onSuccess: inv,
  });
}
export function useAssignmentAction() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ action, assignmentId, note }: { action: 'complete' | 'cancel'; assignmentId: string; note?: string }) =>
      apiPost<{ success: boolean }>(`hse/training/assignments/${action}`, { assignmentId, note }),
    onSuccess: inv,
  });
}
