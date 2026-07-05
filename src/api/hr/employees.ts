/**
 * src/api/hr/employees.ts
 *
 * TanStack Query hooks for the HR Employee Master (v36). Reads via authenticated
 * POST endpoints (apiPost attaches the JWT); types mirror the canonical backend
 * contract in netlify/functions/routes/hr.ts. Mutations invalidate the register +
 * detail caches so the UI re-fetches.
 */

import { useQuery, useMutation, useQueryClient, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { useRecordQuery } from '@lib/recordQuery';
import { hrEmployeeKeys } from '../queryKeys';

// ── Canonical enums / shapes (match the backend) ──────────────────────────────

export type WorkerType     = 'employee' | 'contractor';
export type TrainingStatus = 'current' | 'due_soon' | 'expired' | 'none';
export type PayrollReadinessStatus = 'pending' | 'ready' | 'blocked';

export interface HrEmployeeRow {
  id:                 string;
  username:           string;
  full_name:          string | null;
  first_name:         string | null;
  last_name:          string | null;
  display_name:       string | null;
  role:               string;
  status:             string;
  employment_type:    string | null;
  department_id:      string | null;
  site_id:            string | null;
  position:           string | null;
  supervisor_id:      string | null;
  email:              string | null;
  personal_email:     string | null;
  date_of_birth:      string | null;
  nationality:        string | null;
  government_id:      string | null;
  probation_end_date: string | null;
  employee_grade:     string | null;
  work_schedule:      string | null;
  cost_center:        string | null;
  phone:              string | null;
  emergency_contact_name:         string | null;
  emergency_contact_phone:        string | null;
  emergency_contact_relationship: string | null;
  employee_number:    string | null;
  start_date:         string | null;
  end_date:           string | null;
  contractor_flag:    boolean | null;
  profile_image_url:  string | null;
  profile_image_pending_thumb_url:    string | null;
  profile_image_pending_submitted_at: string | null;
  departmentName:     string | null;
  siteName:           string | null;
  supervisorName:     string | null;
  workerType:         WorkerType;
  trainingStatus:     TrainingStatus;
}

export interface PayrollReadiness {
  status: PayrollReadinessStatus;
  blockers: string[];
  financeHandoffEligible: boolean;
}

export interface HrStatutoryRow {
  employee_id:              string;
  nis_number:              string | null;
  nis_status:              string;
  nis_effective_date:      string | null;
  bir_file_number:         string | null;
  paye_applicable:         boolean;
  td1_received:            boolean;
  td1_effective_year:      number | null;
  hs_applicable:           boolean;
  hs_exemption_reason:     string | null;
  hs_effective_date:       string | null;
  hs_verification_required: boolean;
  payroll_ready_status:    PayrollReadinessStatus;
  missing_blockers:        string[];
  finance_handoff_eligible: boolean;
  [k: string]: unknown;
}

export interface HrEmployeeDetail {
  employee: HrEmployeeRow & { supervisorName: string | null; departmentName: string | null };
  statusHistory: Array<Record<string, unknown>>;
  currentAssignment: Record<string, unknown> | null;
  statutory: HrStatutoryRow | null;
  payrollReadiness: PayrollReadiness | null;
}

export interface HrDashboardStats {
  active_workforce: { total: number; employees: number; contractors: number; trend: Array<{ period: string; count: number }> };
  hr_work_queue:    { total: number; urgent: number; mix: Array<{ type: string; count: number }> };
  readiness:        { percent: number; payroll_ready: number; training_current: number; blocked: number };
  exceptions:       { total: number; items: Array<{ type: string; count: number }> };
}

export interface HrWorkflowSummary {
  employee_id: string;
  open_count: number;
  urgent_count: number;
  items: Array<{ workflow_id: string; workflow_no: string | null; workflow_type: string; current_step: string | null; status: string; due_at: string | null; urgent: boolean }>;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface HrEmployeeListFilter {
  status?: string; departmentId?: string; employmentType?: string;
  workerType?: WorkerType; search?: string; limit?: number;
}

export function useHrEmployees(filter: HrEmployeeListFilter = {}) {
  const f = filter as Record<string, unknown>;
  return useQuery({
    queryKey: hrEmployeeKeys.list(f),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HrEmployeeRow[] }>('hr/employees/list', f, { signal });
      return res.data ?? [];
    },
  });
}

export type EmployeeSortCol = 'full_name' | 'employee_number' | 'status' | 'employment_type' | 'start_date' | 'department_id';

export interface HrEmployeePageFilter {
  statuses?: string[]; departmentIds?: string[]; employmentTypes?: string[]; trainingStatuses?: TrainingStatus[];
  workerType?: WorkerType; search?: string;
  sortBy?: EmployeeSortCol; sortDir?: 'asc' | 'desc';
  page: number; pageSize: number;
}

export interface HrEmployeePageMeta {
  total: number; page: number; pageSize: number;
  departments: Array<{ id: string; name: string }>;
  statuses: string[]; employmentTypes: string[]; trainingStatuses: TrainingStatus[];
}

export interface HrEmployeePage { rows: HrEmployeeRow[]; meta: HrEmployeePageMeta; }

const EMPTY_PAGE_META: HrEmployeePageMeta = { total: 0, page: 1, pageSize: 0, departments: [], statuses: [], employmentTypes: [], trainingStatuses: [] };

/** Server-backed register query — filters, sort, and pagination are all applied
 *  in Postgres (not client-side over a fetched-everything payload). Returns the
 *  page's rows plus `meta` (true total + filter option lists) for pagination UI. */
export function useHrEmployeesPage(filter: HrEmployeePageFilter) {
  const f = filter as unknown as Record<string, unknown>;
  return useQuery({
    queryKey: hrEmployeeKeys.list({ page: true, ...f }),
    placeholderData: prev => prev,
    queryFn: async ({ signal }: QueryFunctionContext): Promise<HrEmployeePage> => {
      const res = await apiPost<{ success: boolean; data: HrEmployeeRow[]; meta: HrEmployeePageMeta }>('hr/employees/list', f, { signal });
      return { rows: res.data ?? [], meta: res.meta ?? EMPTY_PAGE_META };
    },
  });
}

// Shared fetch — used by the hook AND the hover-prefetch helper (no duplication).
async function fetchHrEmployeeDetail(employeeId: string, signal?: AbortSignal): Promise<HrEmployeeDetail> {
  const res = await apiPost<{ success: boolean; data: HrEmployeeDetail }>('hr/employees/get', { employeeId }, { signal });
  return res.data;
}

// Record-scoped: returns RecordQueryResult — `.data` is surfaced ONLY when it
// belongs to `employeeId` and `.ready` gates the drawer, so a previous employee's
// data can never flash on switch. Instant open via a list-cache placeholder.
export function useHrEmployee(employeeId: string | null) {
  const qc = useQueryClient();
  return useRecordQuery<HrEmployeeDetail>({
    recordId: employeeId,
    queryKey: hrEmployeeKeys.detail(employeeId ?? ''),
    queryFn:  (signal) => fetchHrEmployeeDetail(employeeId as string, signal),
    getId:    d => d.employee.id,
    // INSTANT OPEN: seed from the register row we already hold (real data, not a
    // fake); the full detail (statutory / history / readiness) fills in on fetch.
    placeholder: () => {
      if (!employeeId) return undefined;
      for (const [, rows] of qc.getQueriesData<HrEmployeeRow[]>({ queryKey: hrEmployeeKeys.lists() })) {
        const row = rows?.find(r => r.id === employeeId);
        if (row) return {
          employee: { ...row, supervisorName: row.supervisorName ?? null, departmentName: row.departmentName ?? null },
          statusHistory: [], currentAssignment: null, statutory: null, payrollReadiness: null,
        } satisfies HrEmployeeDetail;
      }
      return undefined;
    },
  });
}

/** Warm the detail cache on row hover/focus so the drawer opens fully-loaded.
 *  prefetchQuery is a no-op when the data is already cached + fresh, so repeated
 *  hovers are cheap. Returns a stable callback: prefetch(employeeId). */
export function usePrefetchHrEmployee() {
  const qc = useQueryClient();
  return (employeeId: string) => {
    if (!employeeId) return;
    void qc.prefetchQuery({
      queryKey: hrEmployeeKeys.detail(employeeId),
      queryFn:  ({ signal }: QueryFunctionContext) => fetchHrEmployeeDetail(employeeId, signal),
      staleTime: 60_000,
    });
  };
}

export function useHrDashboardStats(filter: { siteId?: string; departmentId?: string } = {}) {
  const f = filter as Record<string, unknown>;
  return useQuery({
    queryKey: hrEmployeeKeys.dashboardStats(f),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: { stats: HrDashboardStats } }>('hr/employees/dashboard-stats', f, { signal });
      return res.data.stats;
    },
  });
}

export function useHrWorkflowSummary(employeeId: string | null) {
  return useQuery({
    queryKey: hrEmployeeKeys.workflowSummary(employeeId ?? ''),
    enabled:  !!employeeId,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HrWorkflowSummary }>('hr/employees/workflow-summary', { employeeId }, { signal });
      return res.data;
    },
  });
}

export function useHrStatutory(employeeId: string | null) {
  return useQuery({
    queryKey: hrEmployeeKeys.statutory(employeeId ?? ''),
    enabled:  !!employeeId,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: { statutory: HrStatutoryRow | null; readiness: PayrollReadiness } }>('hr/employees/statutory/get', { employeeId }, { signal });
      return res.data;
    },
  });
}

export interface HrAuditEntry {
  id:             string;
  employee_id:    string | null;
  submodule_key:  string | null;
  actor_id:       string | null;
  actorName:      string | null;
  action:         string;
  reason:         string | null;
  created_at:     string;
  [k: string]: unknown;
}

export interface HrDocument {
  id:              string;
  employee_id:     string;
  document_type:   string;
  title:           string;
  file_name:       string;
  confidentiality: string;
  status:          string;
  expiry_date:     string | null;
  uploaded_at:     string;
  [k: string]: unknown;
}

export interface HrTrainingSummary {
  total: number; current: number; dueSoon: number; expired: number; pending: number;
  certificates: Array<{ status: string; expires_at: string | null; course_name: string }>;
}

export function useHrAudit(employeeId: string | null) {
  return useQuery({
    queryKey: hrEmployeeKeys.audit(employeeId ?? ''),
    enabled:  !!employeeId,
    retry:    false,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HrAuditEntry[] }>('hr/employees/audit', { employeeId }, { signal });
      return res.data;
    },
  });
}

export function useHrDocuments(employeeId: string | null) {
  return useQuery({
    queryKey: hrEmployeeKeys.documents(employeeId ?? ''),
    enabled:  !!employeeId,
    retry:    false,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HrDocument[] }>('hr/employees/documents/list', { employeeId }, { signal });
      return res.data;
    },
  });
}

export function useHrTrainingSummary(employeeId: string | null) {
  return useQuery({
    queryKey: hrEmployeeKeys.trainingSummary(employeeId ?? ''),
    enabled:  !!employeeId,
    retry:    false,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HrTrainingSummary }>('hr/employees/training-summary', { employeeId }, { signal });
      return res.data;
    },
  });
}

export interface HrOrgUnit { id: string; name: string; parent_id: string | null; org_unit_type: string | null; [k: string]: unknown }
export interface HrSite { id: string; name: string }

export function useHrOrgUnits() {
  return useQuery({
    queryKey: hrEmployeeKeys.orgUnits(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HrOrgUnit[] }>('hr/organization/tree', {}, { signal });
      return res.data;
    },
  });
}

export function useHrSites() {
  return useQuery({
    queryKey: hrEmployeeKeys.sites(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HrSite[] }>('hr/sites/list', {}, { signal });
      return res.data;
    },
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface CreateHrEmployeeArgs {
  identity:   { username: string; password: string; fullName: string; firstName?: string; lastName?: string; email?: string; personalEmail?: string; phone?: string; employeeNumber?: string; dateOfBirth?: string; nationality?: string; preferredName?: string; governmentId?: string };
  employment?: { employmentType?: string; contractorFlag?: boolean; startDate?: string; position?: string; positionTitle?: string; probationEndDate?: string; employeeGrade?: string; workSchedule?: string };
  assignment?: { departmentId?: string | null; siteId?: string | null; positionId?: string | null; supervisorId?: string | null; costCenter?: string | null; effectiveDate?: string };
  access?:     { role?: string; permissionProfile?: string; selfServiceProfile?: string; requireMfa?: boolean; onboardingRequirements?: Record<string, boolean> };
  createLogin?: boolean;
  recordStatus?: string;
  statutory?:  Record<string, unknown>;
  onboarding?: { createOnboardingCase?: boolean; packageKey?: string };
}

export function useCreateHrEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateHrEmployeeArgs) =>
      apiPost<{ success: boolean; data: { employee_id: string; employee_no: string; status: string; payroll_readiness: PayrollReadinessStatus; onboarding_case_id: string | null; onboarding_error?: string | null; workflow_id: string | null } }>('hr/employees/create', args as unknown as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrEmployeeKeys.all }),
  });
}

export interface ContactUpdateArgs {
  employeeId: string; mode?: 'direct' | 'request';
  work?:      { email?: string | null; phone?: string | null };
  personal?:  { personalEmail?: string | null };
  emergency?: { name?: string | null; phone?: string | null; relationship?: string | null };
  reason?:    string;
}

export function useUpdateHrContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ContactUpdateArgs) =>
      apiPost<{ success: boolean; data: { mode: string; employee?: HrEmployeeRow; requestId?: string; changeNo?: string } }>('hr/employees/contact/update', args as unknown as Record<string, unknown>),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.lists() });
    },
  });
}

export interface PhotoDecideArgs { employeeId: string; approve: boolean; reason?: string }

export function useDecideHrEmployeePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: PhotoDecideArgs) =>
      apiPost<{ success: boolean; message?: string }>('hr/employees/photo/decide', args as unknown as Record<string, unknown>),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.lists() });
    },
  });
}

export interface StatutoryUpdateArgs {
  employeeId: string;
  nisNumber?: string | null; nisStatus?: string; nisEffectiveDate?: string | null;
  birFileNumber?: string | null; payeApplicable?: boolean; td1Received?: boolean; td1EffectiveYear?: number | null;
  hsApplicable?: boolean; hsExemptionReason?: string | null; hsEffectiveDate?: string | null; hsVerificationRequired?: boolean;
  markVerified?: boolean;
}

export function useUpdateHrStatutory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: StatutoryUpdateArgs) =>
      apiPost<{ success: boolean; data: { payroll_readiness: PayrollReadinessStatus; blockers: string[]; financeHandoffEligible: boolean } }>('hr/employees/statutory/update', args as unknown as Record<string, unknown>),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.statutory(vars.employeeId) });
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
    },
  });
}

export interface StatusChangeArgs { employeeId: string; newStatus: string; reason?: string; effectiveDate?: string }

export function useChangeHrStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: StatusChangeArgs) =>
      apiPost<{ success: boolean; data: { employeeId: string; status: string } }>('hr/employees/status-change', args as unknown as Record<string, unknown>),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.lists() });
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.audit(vars.employeeId) });
    },
  });
}

export interface ChangeRequestArgs { employeeId: string; changeType: string; requestedValue: Record<string, unknown>; reason?: string }

export function useCreateHrChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ChangeRequestArgs) =>
      apiPost<{ success: boolean; data: { id: string; change_no: string } }>('hr/employees/change-request', args as unknown as Record<string, unknown>),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) }),
  });
}

export interface UploadDocArgs { employeeId: string; file: File; documentType: string; title: string; confidentiality: string; expiryDate?: string }

export function useUploadHrDocument() {
  const qc = useQueryClient();
  return useMutation({
    // Presigned-URL → direct PUT → commit (the standard HSE attachment flow): the
    // Lambda never holds the file bytes.
    mutationFn: async (a: UploadDocArgs) => {
      const signed = await apiPost<{ success: boolean; uploadUrl: string; path: string }>(
        'hr/employees/documents/upload-url', { fileName: a.file.name, mimeType: a.file.type || 'application/octet-stream' }, { retryable: false });
      const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': a.file.type || 'application/octet-stream' }, body: a.file });
      if (!put.ok) throw new Error('File upload failed.');
      return apiPost<{ success: boolean; data: { id: string } }>('hr/employees/documents/commit', {
        employeeId: a.employeeId, documentType: a.documentType, title: a.title, filePath: signed.path,
        fileName: a.file.name, mimeType: a.file.type || null, fileSize: a.file.size,
        confidentiality: a.confidentiality, expiryDate: a.expiryDate ?? null,
      });
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: hrEmployeeKeys.documents(vars.employeeId) }),
  });
}

export function useVerifyHrDocument(employeeId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { documentId: string; decision: 'approve' | 'reject'; reason?: string }) =>
      apiPost<{ success: boolean; data: { documentId: string; status: string } }>('hr/documents/verify', a as unknown as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrEmployeeKeys.documents(employeeId ?? '') }),
  });
}

export function useArchiveHrDocument(employeeId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => apiPost<{ success: boolean }>('hr/documents/archive', { documentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrEmployeeKeys.documents(employeeId ?? '') }),
  });
}

/** Audited presigned download — open the returned URL in a new tab. */
export async function getHrDocumentDownloadUrl(documentId: string): Promise<string> {
  const res = await apiPost<{ success: boolean; url: string }>('hr/documents/download-url', { documentId });
  return res.url;
}
