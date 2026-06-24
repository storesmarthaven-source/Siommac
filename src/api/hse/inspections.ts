/**
 * src/api/hse/inspections.ts
 *
 * TanStack Query hooks for the HSE Inspections module.
 * All data goes through the authenticated Netlify API — no direct Supabase reads.
 * Mirrors src/api/hse/ptw.ts.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { inspectionKeys } from '@api/queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export type InspectionPriority = 'low' | 'medium' | 'high' | 'critical';

export type InspectionStatus =
  | 'draft' | 'scheduled' | 'due_soon' | 'overdue' | 'in_progress'
  | 'submitted' | 'under_review' | 'completed' | 'cancelled' | 'rescheduled';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'observation';

export type FindingStatus =
  | 'open' | 'assigned' | 'in_progress' | 'awaiting_review'
  | 'closed' | 'reopened' | 'overdue' | 'cancelled';

export type ResponseStatus = 'unanswered' | 'passed' | 'failed' | 'not_applicable' | 'requires_follow_up';

export type ChecklistResponseType =
  | 'pass_fail_na' | 'yes_no_na' | 'numeric' | 'text' | 'photo_required' | 'signature' | 'multi_select';

/** Row returned by /hse/inspections/list */
export interface InspectionRow {
  id:              string;
  inspection_no:   string | null;
  ref:             string | null;
  title:           string | null;
  inspection_type: string | null;
  type:            string | null;
  priority:        InspectionPriority;
  status:          string;
  site_id:         string | null;
  site_name:       string | null;
  area:            string | null;
  asset_name:      string | null;
  assignee_id:     string | null;
  reviewer_id:     string | null;
  due_at:          string | null;
  scheduled_at:    string | null;
  started_at:      string | null;
  submitted_at:    string | null;
  completed_at:    string | null;
  created_at:      string;
  updated_at:      string | null;
}

export interface ChecklistItem {
  id:                            string;
  template_id:                   string;
  section_id:                    string | null;
  question:                      string;
  help_text:                     string | null;
  response_type:                 ChecklistResponseType;
  is_required:                   boolean;
  is_critical:                   boolean;
  requires_evidence_on_fail:     boolean;
  auto_create_finding_on_fail:   boolean;
  sort_order:                    number;
}

export interface InspectionResponse {
  id:               string;
  inspection_id:    string;
  template_item_id: string;
  response_status:  ResponseStatus | null;
  response_value:   string | null;
  comment:          string | null;
  finding_id:       string | null;
  answered_by:      string | null;
  answered_at:      string | null;
}

export interface FindingRow {
  id:           string;
  finding_no:   string | null;
  inspection_id:string | null;
  title:        string | null;
  description:  string | null;
  category:     string | null;
  severity:     string;
  status:       string;
  site_name:    string | null;
  area:         string | null;
  owner_id:     string | null;
  reviewer_id:  string | null;
  due_at:       string | null;
  closed_at:    string | null;
  created_at:   string;
  updated_at:   string | null;
}

export interface FindingAction {
  id:                 string;
  finding_id:         string;
  action_description: string;
  owner_id:           string | null;
  due_at:             string | null;
  status:             string;
  completed_at:       string | null;
  created_at:         string;
}

export interface EvidenceRow {
  id:            string;
  inspection_id: string | null;
  finding_id:    string | null;
  file_name:     string;
  file_path:     string;
  file_url:      string | null;
  evidence_type: string | null;
  uploaded_by:   string | null;
  uploaded_at:   string;
  /** Signed download URL, added by the get endpoints. */
  url?:          string;
}

export interface AuditEvent {
  id:            string;
  entity_type:   string;
  entity_id:     string;
  action:        string;
  actor_user_id: string | null;
  after_state:   Record<string, unknown> | null;
  created_at:    string;
}

export interface InspectionDetail {
  inspection: InspectionRow & Record<string, unknown>;
  checklist:  ChecklistItem[];
  responses:  InspectionResponse[];
  findings:   FindingRow[];
  evidence:   EvidenceRow[];
  audit:      AuditEvent[];
}

export interface FindingDetail {
  finding:  FindingRow & Record<string, unknown>;
  actions:  FindingAction[];
  evidence: EvidenceRow[];
  audit:    AuditEvent[];
}

export interface InspectionStats {
  scheduledThisMonth: number;
  overdue:            number;
  dueThisWeek:        number;
  completedYtd:       number;
  completionRate:     number;
  openFindings:       number;
  criticalFindings:   number;
  closedFindingsYtd:  number;
  closureRate:        number;
}

export interface TemplateRow {
  id:              string;
  name:            string;
  inspection_type: string;
  description:     string | null;
  is_active:       boolean;
  created_at:      string;
}

export interface InspectionFilter {
  status?:         string;
  inspectionType?: string;
  siteId?:         string;
  assigneeId?:     string;
  priority?:       InspectionPriority;
  search?:         string;
  overdueOnly?:    boolean;
  limit?:          number;
}

export interface FindingFilter {
  status?:       string;
  severity?:     string;
  ownerId?:      string;
  inspectionId?: string;
  openOnly?:     boolean;
  limit?:        number;
}

export type InspectionLifecycleAction = 'start' | 'submit' | 'review' | 'cancel';
export type FindingLifecycleAction = 'close' | 'reopen' | 'escalate';

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useInspections(filter: InspectionFilter = {}) {
  return useQuery({
    queryKey: inspectionKeys.list(filter as Record<string, unknown>),
    queryFn:  () => apiPost<{ success: boolean; data: InspectionRow[] }>('hse/inspections/list', filter as Record<string, unknown>),
    staleTime: 30_000,
  });
}

export function useInspection(id: string | null) {
  return useQuery({
    queryKey: inspectionKeys.detail(id ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: InspectionDetail }>('hse/inspections/get', { inspectionId: id }),
    enabled:  !!id,
    staleTime: 15_000,
  });
}

export function useInspectionStats() {
  return useQuery({
    queryKey: inspectionKeys.stats(),
    queryFn:  () => apiPost<{ success: boolean; data: InspectionStats }>('hse/inspections/stats', {}),
    staleTime: 30_000,
  });
}

export function useFindings(filter: FindingFilter = {}) {
  return useQuery({
    queryKey: inspectionKeys.findingList(filter as Record<string, unknown>),
    queryFn:  () => apiPost<{ success: boolean; data: FindingRow[] }>('hse/inspection-findings/list', filter as Record<string, unknown>),
    staleTime: 30_000,
  });
}

export function useFinding(id: string | null) {
  return useQuery({
    queryKey: inspectionKeys.findingDetail(id ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: FindingDetail }>('hse/inspection-findings/get', { findingId: id }),
    enabled:  !!id,
    staleTime: 15_000,
  });
}

export function useInspectionTemplates(inspectionType?: string) {
  const args = inspectionType ? { inspectionType } : {};
  return useQuery({
    queryKey: inspectionKeys.templates(args),
    queryFn:  () => apiPost<{ success: boolean; data: TemplateRow[] }>('hse/inspection-templates/list', args),
    staleTime: 5 * 60_000,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export interface CreateInspectionArgs {
  title:          string;
  description?:   string;
  inspectionType: string;
  priority?:      InspectionPriority;
  siteId?:        string | null;
  siteName?:      string | null;
  area?:          string | null;
  assetId?:       string | null;
  assetName?:     string | null;
  departmentId?:  string | null;
  templateId?:    string | null;
  assigneeId?:    string | null;
  reviewerId?:    string | null;
  dueAt:          string;
  scheduledAt?:   string | null;
  scheduleImmediately?: boolean;
}

export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateInspectionArgs) =>
      apiPost<{ success: boolean; data: { id: string; inspectionNo: string } }>('hse/inspections/create', args as unknown as Record<string, unknown>, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export function useUpdateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { inspectionId: string } & Partial<CreateInspectionArgs>) =>
      apiPost<{ success: boolean }>('hse/inspections/update', args as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export function useInspectionTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, inspectionId, note }: { action: InspectionLifecycleAction; inspectionId: string; note?: string }) =>
      apiPost<{ success: boolean; data?: { status: string } }>(`hse/inspections/${action}`, { inspectionId, note: note ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export function useRescheduleInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { inspectionId: string; newDueAt: string; reason: string }) =>
      apiPost<{ success: boolean }>('hse/inspections/reschedule', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export function useSaveResponse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { inspectionId: string; templateItemId: string; responseStatus: ResponseStatus; responseValue?: string | null; comment?: string | null }) =>
      apiPost<{ success: boolean; data: { id: string; findingId: string | null } }>('hse/inspections/responses/save', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export interface CreateFindingArgs {
  inspectionId: string;
  responseId?:  string | null;
  title:        string;
  description?: string | null;
  severity:     FindingSeverity;
  category?:    string | null;
  ownerId?:     string | null;
  dueAt?:       string | null;
  siteId?:      string | null;
  area?:        string | null;
}

export function useCreateFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateFindingArgs) =>
      apiPost<{ success: boolean; data: { id: string } }>('hse/inspections/responses/create-finding', args as unknown as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export function useAssignFindingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { findingId: string; actionDescription: string; ownerId?: string | null; dueAt?: string | null }) =>
      apiPost<{ success: boolean; data: { id: string } }>('hse/inspection-findings/assign-action', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export function useUpdateFindingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { actionId: string; status: string; note?: string | null }) =>
      apiPost<{ success: boolean }>('hse/inspection-findings/actions/update', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export function useFindingTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, findingId, note }: { action: FindingLifecycleAction; findingId: string; note?: string }) =>
      apiPost<{ success: boolean }>(`hse/inspection-findings/${action}`, { findingId, note: note ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export interface CreateTemplateArgs {
  name: string;
  inspectionType: string;
  description?: string | null;
  items: Array<{
    question: string;
    helpText?: string | null;
    responseType: string;
    isRequired?: boolean;
    isCritical?: boolean;
    requiresEvidenceOnFail?: boolean;
    autoCreateFindingOnFail?: boolean;
    sortOrder?: number;
  }>;
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateTemplateArgs) =>
      apiPost<{ success: boolean; data: { id: string } }>('hse/inspection-templates/create', args as unknown as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

export function useAddEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { inspectionId?: string | null; findingId?: string | null; responseId?: string | null; fileName: string; filePath: string; fileUrl?: string | null; fileType?: string | null; fileSize?: number | null; evidenceType?: string }) =>
      apiPost<{ success: boolean; data: { id: string } }>('hse/inspections/evidence/add', args),
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}

/** Full evidence upload: presigned URL → PUT the file → record the metadata row. */
export function useUploadEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, inspectionId, findingId, evidenceType }: {
      file: File; inspectionId?: string | null; findingId?: string | null; evidenceType?: string;
    }) => {
      const signed = await apiPost<{ success: boolean; uploadUrl?: string; path?: string; message?: string }>(
        'hse/inspections/evidence/upload-url', { fileName: file.name, mimeType: file.type }, { retryable: false });
      if (!signed.success || !signed.uploadUrl || !signed.path) throw new Error(signed.message ?? 'Could not start upload');

      const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);

      return apiPost<{ success: boolean; data: { id: string } }>('hse/inspections/evidence/add', {
        inspectionId: inspectionId ?? null, findingId: findingId ?? null,
        fileName: file.name, filePath: signed.path, fileType: file.type, fileSize: file.size,
        evidenceType: evidenceType ?? (file.type.startsWith('image/') ? 'photo' : 'document'),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: inspectionKeys.all }),
  });
}
