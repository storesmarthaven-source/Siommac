/**
 * src/api/hse/riskJsa.ts
 *
 * TanStack Query hooks for the HSE Risk & JSA module.
 * All data comes through authenticated Netlify API — no direct Supabase reads.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// ── Query keys ────────────────────────────────────────────────────────────────

export const hseRiskJsaKeys = {
  all:        ['hse', 'risk-jsa'] as const,
  summary:    ()          => ['hse', 'risk-jsa', 'summary']         as const,
  hazards:    (f: unknown) => ['hse', 'risk-jsa', 'hazards', f]     as const,
  hazard:     (id: string) => ['hse', 'risk-jsa', 'hazard', id]     as const,
  assessments: (f: unknown) => ['hse', 'risk-jsa', 'assessments', f] as const,
  assessment: (id: string) => ['hse', 'risk-jsa', 'assessment', id] as const,
  jsa:        (f: unknown) => ['hse', 'risk-jsa', 'jsa', f]         as const,
  jsaDetail:  (id: string) => ['hse', 'risk-jsa', 'jsa-detail', id] as const,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type HazardStatus =
  | 'draft' | 'registered' | 'assessment_required' | 'controls_required'
  | 'under_review' | 'approved' | 'monitoring' | 'archived'
  | 'changes_requested' | 'rejected' | 'closed';

export type AssessmentStatus =
  | 'draft' | 'submitted' | 'under_review' | 'returned' | 'approved' | 'active' | 'expired' | 'archived'
  | 'changes_requested' | 'rejected' | 'closed';

export type JsaStatus =
  | 'draft' | 'submitted' | 'hse_review' | 'returned' | 'approved' | 'active' | 'expired' | 'archived'
  | 'changes_requested' | 'rejected' | 'closed';

/** A row in the cross-entity Pending Approval / Archive queue. */
export interface QueueRow {
  entityType:    'hazard' | 'assessment' | 'jsa';
  id:            string;
  ref:           string;
  title:         string;
  risk_level:    RiskLevel;
  status:        string;
  site_id:       string | null;
  location_text: string | null;
  review_due_at: string | null;
  created_at:    string;
  updated_at:    string;
}

export type ControlType =
  | 'elimination' | 'substitution' | 'engineering' | 'administrative' | 'ppe' | 'emergency_response';

export interface HazardRow {
  id:                  string;
  ref:                 string;
  title:               string;
  category:            string;
  site_id:             string | null;
  location_text:       string | null;
  department_id:       string | null;
  initial_likelihood:  number;
  initial_severity:    number;
  initial_score:       number;
  residual_likelihood: number | null;
  residual_severity:   number | null;
  residual_score:      number | null;
  risk_level:          RiskLevel;
  status:              HazardStatus;
  owner_user_id:       string | null;
  review_due_at:       string | null;
  created_at:          string;
}

export interface AssessmentRow {
  id:              string;
  ref:             string;
  assessment_type: string;
  title:           string;
  site_id:         string | null;
  location_text:   string | null;
  department_id:   string | null;
  owner_user_id:   string | null;
  status:          AssessmentStatus;
  initial_score:   number | null;
  residual_score:  number | null;
  risk_level:      RiskLevel;
  review_due_at:   string | null;
  created_at:      string;
}

export interface JsaRow {
  id:            string;
  ref:           string;
  title:         string;
  site_id:       string | null;
  location_text: string | null;
  department_id: string | null;
  owner_user_id: string | null;
  status:        JsaStatus;
  risk_level:    RiskLevel;
  review_due_at: string | null;
  created_at:    string;
  stepCount:     number;
}

export interface RiskJsaSummary {
  totalHazards:            number;
  highCriticalHazards:     number;
  openAssessments:         number;
  pendingReview:           number;
  overdueAssessments:      number;
  openJsa:                 number;
  riskReductionPct:        number;
  highRiskQueue:           HazardRow[];
  recentHighRisk:          Array<{ id: string; ref: string; title: string; category: string; initial_score: number; risk_level: RiskLevel }>;
  overdueAssessmentsDetail: Array<{ id: string; ref: string; title: string; review_due_at: string; status: string }>;
}

export interface ControlRow {
  id:            string;
  source_type:   string;
  source_id:     string;
  description:   string;
  control_type:  ControlType;
  owner_user_id: string | null;
  status:        string;
  effectiveness: string | null;
  due_at:        string | null;
  verified_at:   string | null;
  created_at:    string;
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function useRiskJsaSummary() {
  return useQuery({
    queryKey: hseRiskJsaKeys.summary(),
    queryFn:  () => apiPost<{ success: boolean; data: RiskJsaSummary }>('hse/risk-jsa/summary', {}),
    staleTime: 30_000,
  });
}

// ── Hazards ───────────────────────────────────────────────────────────────────

export interface HazardFilter extends Record<string, unknown> {
  search?:    string;
  category?:  string | null;
  siteId?:    string | null;
  riskLevel?: string | null;
  status?:    string | null;
  limit?:     number;
}

export function useHazards(filter: HazardFilter = {}) {
  return useQuery({
    queryKey: hseRiskJsaKeys.hazards(filter),
    queryFn:  () => apiPost<{ success: boolean; data: HazardRow[] }>('hse/risk-jsa/hazards/list', filter),
    staleTime: 30_000,
  });
}

export function useHazardDetail(hazardId: string | null) {
  return useQuery({
    queryKey: hseRiskJsaKeys.hazard(hazardId ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: unknown }>('hse/risk-jsa/hazards/detail', { hazardId }),
    enabled:  !!hazardId,
    staleTime: 15_000,
  });
}

export interface CreateHazardArgs extends Record<string, unknown> {
  title:               string;
  description?:        string;
  category:            string;
  siteId?:             string | null;
  departmentId?:       string | null;
  locationText?:       string | null;
  ownerUserId?:        string | null;
  initialLikelihood:   number;
  initialSeverity:     number;
  residualLikelihood?: number | null;
  residualSeverity?:   number | null;
  status?:             'draft' | 'registered';
  reviewDueAt?:        string | null;
  controls?: Array<{
    description:  string;
    controlType?: string;
    ownerUserId?: string | null;
    dueAt?:       string | null;
  }>;
}

export function useCreateHazard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateHazardArgs) =>
      apiPost<{ success: boolean; data: { id: string; ref: string; workflowId: string | null; riskLevel: RiskLevel; score: number } }>(
        'hse/risk-jsa/hazards/create', args, { retryable: false },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

export interface UpdateHazardArgs extends Record<string, unknown> {
  hazardId:            string;
  title?:              string;
  description?:        string;
  category?:           string;
  status?:             HazardStatus;
  residualLikelihood?: number | null;
  residualSeverity?:   number | null;
  ownerUserId?:        string | null;
  reviewDueAt?:        string | null;
}

export function useUpdateHazard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateHazardArgs) =>
      apiPost<{ success: boolean }>('hse/risk-jsa/hazards/update', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

// ── Risk Assessments ──────────────────────────────────────────────────────────

export interface AssessmentFilter extends Record<string, unknown> {
  status?:         string | null;
  siteId?:         string | null;
  assessmentType?: string | null;
  limit?:          number;
}

export function useAssessments(filter: AssessmentFilter = {}) {
  return useQuery({
    queryKey: hseRiskJsaKeys.assessments(filter),
    queryFn:  () => apiPost<{ success: boolean; data: AssessmentRow[] }>('hse/risk-jsa/assessments/list', filter),
    staleTime: 30_000,
  });
}

export function useAssessmentDetail(assessmentId: string | null) {
  return useQuery({
    queryKey: hseRiskJsaKeys.assessment(assessmentId ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: unknown }>('hse/risk-jsa/assessments/detail', { assessmentId }),
    enabled:  !!assessmentId,
    staleTime: 15_000,
  });
}

export interface CreateAssessmentArgs extends Record<string, unknown> {
  assessmentType?: string;
  title:           string;
  description?:    string;
  siteId?:         string | null;
  departmentId?:   string | null;
  locationText?:   string | null;
  ownerUserId?:    string | null;
  reviewCycle?:    string;
  reviewDueAt?:    string | null;
  hazards?: Array<{
    hazardId?:           string | null;
    hazardDescription?:  string | null;
    category?:           string | null;
    initialLikelihood:   number;
    initialSeverity:     number;
    residualLikelihood?: number | null;
    residualSeverity?:   number | null;
    notes?:              string | null;
  }>;
}

export function useCreateAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateAssessmentArgs) =>
      apiPost<{ success: boolean; data: { id: string; ref: string; workflowId: string | null; riskLevel: RiskLevel } }>(
        'hse/risk-jsa/assessments/create', args, { retryable: false },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

export function useSubmitAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { assessmentId: string; note?: string }) =>
      apiPost<{ success: boolean; workflowId: string | null }>('hse/risk-jsa/assessments/submit', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

// ── JSA ───────────────────────────────────────────────────────────────────────

export interface JsaFilter extends Record<string, unknown> {
  status?: string | null;
  siteId?: string | null;
  limit?:  number;
}

export function useJsaList(filter: JsaFilter = {}) {
  return useQuery({
    queryKey: hseRiskJsaKeys.jsa(filter),
    queryFn:  () => apiPost<{ success: boolean; data: JsaRow[] }>('hse/risk-jsa/jsa/list', filter),
    staleTime: 30_000,
  });
}

export function useJsaDetail(jsaId: string | null) {
  return useQuery({
    queryKey: hseRiskJsaKeys.jsaDetail(jsaId ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: unknown }>('hse/risk-jsa/jsa/detail', { jsaId }),
    enabled:  !!jsaId,
    staleTime: 15_000,
  });
}

export interface JsaStep {
  stepNumber:          number;
  taskStep:            string;
  hazardDescription?:  string | null;
  initialLikelihood?:  number | null;
  initialSeverity?:    number | null;
  residualLikelihood?: number | null;
  residualSeverity?:   number | null;
  controlsSummary?:    string | null;
}

export interface CreateJsaArgs extends Record<string, unknown> {
  title:          string;
  description?:   string;
  siteId?:        string | null;
  departmentId?:  string | null;
  locationText?:  string | null;
  ownerUserId?:   string | null;
  reviewDueAt?:   string | null;
  /** Source RA id when this JSA was generated from a risk assessment. */
  linkedRiskAssessmentId?: string | null;
  steps?:         JsaStep[];
  ppeItems?: Array<{ ppeItem: string; required?: boolean; notes?: string | null }>;
  trainingLinks?: Array<{
    requirementDescription:  string;
    certificationRequired?:  boolean;
    competencyVerification?: boolean;
    notes?:                  string | null;
  }>;
  crewMembers?: Array<{
    userId?:             string | null;
    crewName:            string;
    roleTitle?:          string | null;
    required?:           boolean;
    competencyVerified?: boolean;
  }>;
}

export interface JsaCrewMember {
  id:                  string;
  jsa_id:              string;
  user_id:             string | null;
  crew_name:           string;
  role_title:          string | null;
  required:            boolean;
  competency_verified: boolean;
  acknowledged:        boolean;
  acknowledged_at:     string | null;
}

export function useCreateJsa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateJsaArgs) =>
      apiPost<{ success: boolean; data: { id: string; ref: string; workflowId: string | null; riskLevel: RiskLevel } }>(
        'hse/risk-jsa/jsa/create', args, { retryable: false },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

export function useSubmitJsa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { jsaId: string; note?: string }) =>
      apiPost<{ success: boolean; workflowId: string | null }>('hse/risk-jsa/jsa/submit', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

// ── Generate JSA from a risk assessment (prefill, not persisted) ─────────────────

export interface JsaSuggestedHazard {
  description:         string;
  category:            string | null;
  initialLikelihood:   number | null;
  initialSeverity:     number | null;
  residualLikelihood:  number | null;
  residualSeverity:    number | null;
  notes:               string | null;
}

export interface JsaPrefill {
  title:                  string;
  siteId:                 string | null;
  departmentId:           string | null;
  locationText:           string | null;
  reviewDueAt:            string | null;
  linkedRiskAssessmentId: string;
  sourceRef:              string;
  suggestedHazards:       JsaSuggestedHazard[];
}

/** Fetch a JSA-draft prefill derived from a risk assessment (spec §15). */
export function useGenerateJsaFromAssessment() {
  return useMutation({
    mutationFn: (assessmentId: string) =>
      apiPost<{ success: boolean; data: JsaPrefill }>('hse/risk-jsa/jsa/from-assessment', { assessmentId }),
  });
}

// ── Controls ──────────────────────────────────────────────────────────────────

export interface CreateControlArgs extends Record<string, unknown> {
  sourceType:   'hazard' | 'assessment' | 'jsa' | 'capa';
  sourceId:     string;
  hazardId?:    string | null;
  description:  string;
  controlType?: ControlType;
  ownerUserId?: string | null;
  dueAt?:       string | null;
}

export function useCreateControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateControlArgs) =>
      apiPost<{ success: boolean; controlId: string }>('hse/risk-jsa/controls/create', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

// ── Review ────────────────────────────────────────────────────────────────────

export interface ReviewArgs extends Record<string, unknown> {
  entityType:           'hazard' | 'assessment' | 'jsa';
  entityId:             string;
  outcome:              'approve' | 'return' | 'archive';
  note?:                string | null;
  nextReviewDueAt?:     string | null;
  effectivenessResult?: 'effective' | 'partially_effective' | 'ineffective' | null;
}

export function useRiskJsaReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ReviewArgs) =>
      apiPost<{ success: boolean }>('hse/risk-jsa/review', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

// ── Lifecycle actions (status-transition engine) ─────────────────────────────────

export type LifecycleAction =
  | 'approve' | 'reject' | 'request-changes' | 'activate' | 'close' | 'archive';

export interface LifecycleArgs extends Record<string, unknown> {
  entityType:      'hazard' | 'assessment' | 'jsa';
  entityId:        string;
  note?:           string | null;
  nextReviewDueAt?: string | null;
  /** Override the JSA crew competency gate when activating. */
  override?:       boolean;
}

/** Drive one lifecycle transition (approve/reject/request-changes/activate/close/archive). */
export function useRiskJsaLifecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...args }: LifecycleArgs & { action: LifecycleAction }) =>
      apiPost<{ success: boolean; status?: string; requiresOverride?: boolean; message?: string }>(`hse/risk-jsa/${action}`, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

/** A crew member acknowledges a JSA (optionally confirming competency). */
export function useAcknowledgeJsa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { jsaId: string; crewId: string; competencyVerified?: boolean }) =>
      apiPost<{ success: boolean }>('hse/risk-jsa/jsa/acknowledge', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

// ── Pending Approval / Archive queue ─────────────────────────────────────────────

export function useRiskJsaQueue(scope: 'pending' | 'archived') {
  return useQuery({
    queryKey: ['hse', 'risk-jsa', 'queue', scope] as const,
    queryFn:  () => apiPost<{ success: boolean; data: QueueRow[] }>('hse/risk-jsa/queue', { scope }),
    staleTime: 20_000,
  });
}

// ── Submit for review ───────────────────────────────────────────────────────────

/** Submit a hazard for review (registered → under_review + workflow). */
export function useSubmitHazard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { hazardId: string; note?: string }) =>
      apiPost<{ success: boolean; workflowId: string | null }>('hse/risk-jsa/hazards/submit', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

// ── Verify control ──────────────────────────────────────────────────────────────

export interface VerifyControlArgs extends Record<string, unknown> {
  controlId:     string;
  effectiveness: 'effective' | 'partially_effective' | 'ineffective';
  note?:         string | null;
}

export function useVerifyControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: VerifyControlArgs) =>
      apiPost<{ success: boolean }>('hse/risk-jsa/controls/verify', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

// ── Link CAPA (reuses the canonical CAPA create endpoint) ────────────────────────

export interface LinkCapaArgs extends Record<string, unknown> {
  sourceType:  'hazard' | 'assessment' | 'jsa';
  sourceId:    string;
  title:       string;
  description: string;
  priority?:   'low' | 'medium' | 'high' | 'critical';
  dueAt?:      string | null;
  ownerUserId?: string | null;
}

export function useLinkCapa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: LinkCapaArgs) =>
      apiPost<{ success: boolean; capaId: string; ref: string }>('hse/capa/create', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseRiskJsaKeys.all }),
  });
}

// ── Attachments ──────────────────────────────────────────────────────────────────

export type AttachEntityType = 'hazard' | 'assessment' | 'jsa';

export interface AttachmentRow {
  id:           string;
  file_name:    string;
  mime_type:    string;
  storage_path: string;
  uploaded_by:  string | null;
  created_at:   string;
  url:          string;
}

export function useAttachments(entityType: AttachEntityType, entityId: string | null) {
  return useQuery({
    queryKey: ['hse', 'risk-jsa', 'attachments', entityType, entityId] as const,
    queryFn:  () => apiPost<{ success: boolean; data: AttachmentRow[] }>('hse/risk-jsa/attachments/list', { entityType, entityId }),
    enabled:  !!entityId,
    staleTime: 15_000,
  });
}

/** Full upload: presigned URL → PUT the file → record metadata. */
export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entityType, entityId, file }: { entityType: AttachEntityType; entityId: string; file: File }) => {
      const signed = await apiPost<{ success: boolean; uploadUrl?: string; path?: string; message?: string }>(
        'hse/risk-jsa/attachments/upload-url', { fileName: file.name, mimeType: file.type }, { retryable: false });
      if (!signed.success || !signed.uploadUrl || !signed.path) throw new Error(signed.message ?? 'Could not start upload');

      const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);

      return apiPost<{ success: boolean; attachmentId: string }>(
        'hse/risk-jsa/attachments/create',
        { entityType, entityId, fileName: file.name, mimeType: file.type, storagePath: signed.path },
        { retryable: false },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hse', 'risk-jsa', 'attachments'] }),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      apiPost<{ success: boolean }>('hse/risk-jsa/attachments/delete', { attachmentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hse', 'risk-jsa', 'attachments'] }),
  });
}

// ── Reference libraries (standard hazards / controls) ────────────────────────────

export interface HazardLibraryItem {
  id:                  string;
  code:                string;
  category:            string;
  title:               string;
  description:         string;
  typical_consequence: string;
  default_likelihood:  number | null;
  default_severity:    number | null;
  work_types:          string[];
}

export interface ControlLibraryItem {
  id:              string;
  code:            string;
  control_type:    ControlType;
  title:           string;
  description:     string;
  hazard_category: string | null;
  effectiveness:   'high' | 'medium' | 'low' | null;
}

export interface HazardLibraryFilter extends Record<string, unknown> {
  search?:   string | null;
  category?: string | null;
  workType?: string | null;
}

export function useHazardLibrary(filter: HazardLibraryFilter = {}, enabled = true) {
  return useQuery({
    queryKey: ['hse', 'risk-jsa', 'lib-hazards', filter] as const,
    queryFn:  () => apiPost<{ success: boolean; data: HazardLibraryItem[] }>('hse/risk-jsa/library/hazards', filter),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface ControlLibraryFilter extends Record<string, unknown> {
  search?:         string | null;
  controlType?:    string | null;
  hazardCategory?: string | null;
}

export function useControlLibrary(filter: ControlLibraryFilter = {}, enabled = true) {
  return useQuery({
    queryKey: ['hse', 'risk-jsa', 'lib-controls', filter] as const,
    queryFn:  () => apiPost<{ success: boolean; data: ControlLibraryItem[] }>('hse/risk-jsa/library/controls', filter),
    enabled,
    staleTime: 5 * 60_000,
  });
}

// ── Workflow templates ───────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  id:          string;
  module:      string;
  key:         string;
  name:        string;
  description: string;
  is_active:   boolean;
  definition:  { steps?: Array<{ key: string; label: string; role?: string; action?: string }> };
  created_at:  string;
}

export function useWorkflowTemplates(enabled = true) {
  return useQuery({
    queryKey: ['hse', 'risk-jsa', 'templates'],
    queryFn:  () => apiPost<{ success: boolean; data: WorkflowTemplate[] }>('hse/risk-jsa/templates/list', {}),
    enabled,
    staleTime: 60_000,
  });
}

export function useDuplicateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { templateId: string; newName?: string }) =>
      apiPost<{ success: boolean; data: { id: string; key: string; name: string } }>('hse/risk-jsa/templates/duplicate', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hse', 'risk-jsa', 'templates'] }),
  });
}
