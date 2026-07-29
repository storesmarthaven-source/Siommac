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
import { requireHrSuccess } from './client';
import { useRecordQuery } from '@lib/recordQuery';
import { hrEmployeeKeys } from '../queryKeys';

async function hrPost<T extends { success: boolean; message?: string }>(
  path: string,
  args: Record<string, unknown>,
  options?: Parameters<typeof apiPost>[2],
): Promise<T> {
  return requireHrSuccess(await apiPost<T>(path, args, options), path);
}

// ── Canonical enums / shapes (match the backend) ──────────────────────────────

export type WorkerType     = 'employee' | 'contractor';
export type TrainingStatus = 'current' | 'due_soon' | 'expired' | 'none';
export type PayrollReadinessStatus = 'pending' | 'ready' | 'blocked';

export interface EmployeeReadinessSummary {
  percent: number;
  assignmentComplete: boolean;
  payrollStatus: PayrollReadinessStatus;
  trainingStatus: TrainingStatus;
  blockers: ('assignment' | 'payroll' | 'training')[];
}

export interface HrEmployeeRow {
  id:                 string;
  username:           string;
  full_name:          string | null;
  first_name:         string | null;
  last_name:          string | null;
  display_name:       string | null;
  role:               string;
  status:             string;
  accountStatus:      string;
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
  mobile_phone:       string | null;
  created_at:         string | null;
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
  readiness:          EmployeeReadinessSummary | null;
  /** An offboarding case is already open for this employee (not completed/cancelled). */
  offboardingActive:  boolean;
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
  statusHistory: Record<string, unknown>[];
  currentAssignment: HrEmployeeAssignment | null;
  assignmentHistory: HrEmployeeAssignment[];
  payGroup: HrEmployeePayGroup | null;
  accessProfile: HrEmployeeAccessProfile | null;
  statutory: HrStatutoryRow | null;
  payrollReadiness: PayrollReadiness | null;
}

export interface HrEmployeeAssignment {
  id: string;
  employee_id: string;
  position_id: string | null;
  department_id: string | null;
  site_id: string | null;
  supervisor_id: string | null;
  assignment_type: string;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  departmentName: string | null;
  siteName: string | null;
  supervisorName: string | null;
  positionTitle: string | null;
}

export interface HrEmployeePayGroup {
  id: string;
  code: string;
  name: string;
  frequency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface HrEmployeeAccessProfile {
  id: string;
  code: string;
  label: string;
  description: string | null;
  requiresMfa: boolean;
}

/** Assignment fields the register can filter on being ABSENT. */
export type EmployeeMissingField = 'supervisor' | 'department' | 'site';

export interface HrDashboardStats {
  active_workforce: { total: number; employees: number; contractors: number; trend: { period: string; count: number }[] };
  hr_work_queue:    { total: number; urgent: number; oldest_days: number; mix: { type: string; count: number }[] };
  readiness:        { percent: number; assignment_complete: number; payroll_ready: number; training_current: number; blocked: number };
  exceptions:       { total: number; items: { type: string; count: number }[] };
  distribution: {
    departments: { id: string; label: string; count: number; percent: number }[];
    sites: { id: string; label: string; count: number; percent: number }[];
  };
  lifecycle: {
    periods: { period: string; hires: number; exits: number; transfers: number; promotions: number; records_updated: number }[];
    totals: { hires: number; exits: number; transfers: number; promotions: number; records_updated: number };
  };
}

export interface HrWorkflowSummary {
  employee_id: string;
  open_count: number;
  urgent_count: number;
  items: { workflow_id: string; workflow_no: string | null; workflow_type: string; current_step: string | null; status: string; due_at: string | null; urgent: boolean }[];
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
      const res = await hrPost<{ success: boolean; data: HrEmployeeRow[] }>('hr/employees/list', f, { signal });
      return res.data;
    },
  });
}

export type EmployeeSortCol = 'full_name' | 'employee_number' | 'status' | 'employment_type' | 'start_date' | 'department_id';

export interface HrEmployeePageFilter {
  statuses?: string[]; departmentIds?: string[]; employmentTypes?: string[]; trainingStatuses?: TrainingStatus[];
  /** Records missing a required assignment field — backs the Exceptions KPI drill-down. */
  missing?: EmployeeMissingField[];
  workerType?: WorkerType; search?: string;
  sortBy?: EmployeeSortCol; sortDir?: 'asc' | 'desc';
  page: number; pageSize: number;
}

export interface HrEmployeePageMeta {
  total: number; page: number; pageSize: number;
  departments: { id: string; name: string }[];
  statuses: string[]; employmentTypes: string[]; trainingStatuses: TrainingStatus[];
}

export interface HrEmployeePage { rows: HrEmployeeRow[]; meta: HrEmployeePageMeta; }

type HrEmployeeListCache = HrEmployeeRow[] | HrEmployeePage;

/**
 * Resolve a real register row from either HR list-cache shape.
 *
 * The legacy list hook caches `HrEmployeeRow[]`; the server-paginated Employee
 * Master caches `{ rows, meta }`. Detail drawers must support both or the current
 * page cannot seed an immediate, record-safe placeholder.
 */
export function findCachedHrEmployeeRow(
  cached: HrEmployeeListCache | undefined,
  employeeId: string,
): HrEmployeeRow | undefined {
  const rows = Array.isArray(cached) ? cached : cached?.rows;
  return rows?.find(row => row.id === employeeId);
}


/** Server-backed register query — filters, sort, and pagination are all applied
 *  in Postgres (not client-side over a fetched-everything payload). Returns the
 *  page's rows plus `meta` (true total + filter option lists) for pagination UI. */
export function useHrEmployeesPage(filter: HrEmployeePageFilter) {
  const f = filter as unknown as Record<string, unknown>;
  return useQuery({
    queryKey: hrEmployeeKeys.list({ page: true, ...f }),
    placeholderData: prev => prev,
    queryFn: async ({ signal }: QueryFunctionContext): Promise<HrEmployeePage> => {
      const res = await hrPost<{ success: boolean; data: HrEmployeeRow[]; meta: HrEmployeePageMeta }>('hr/employees/list', f, { signal });
      return { rows: res.data, meta: res.meta };
    },
  });
}

// Shared fetch — used by the hook AND the hover-prefetch helper (no duplication).
async function fetchHrEmployeeDetail(employeeId: string, signal?: AbortSignal): Promise<HrEmployeeDetail> {
  const res = await hrPost<{ success: boolean; data: HrEmployeeDetail }>('hr/employees/get', { employeeId }, { signal });
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
    queryFn:  (signal) => fetchHrEmployeeDetail(employeeId!, signal),
    getId:    d => d.employee.id,
    // INSTANT OPEN: seed from the register row we already hold (real data, not a
    // fake); the full detail (statutory / history / readiness) fills in on fetch.
    placeholder: () => {
      if (!employeeId) return undefined;
      for (const [, cached] of qc.getQueriesData<HrEmployeeListCache>({ queryKey: hrEmployeeKeys.lists() })) {
        const row = findCachedHrEmployeeRow(cached, employeeId);
        if (row) return {
          employee: { ...row, supervisorName: row.supervisorName ?? null, departmentName: row.departmentName ?? null },
          statusHistory: [], currentAssignment: null, assignmentHistory: [],
          payGroup: null, accessProfile: null, statutory: null, payrollReadiness: null,
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

/** `granularity` buckets the lifecycle series (Workforce Activity's Day/Week/Month control).
 *  It is part of the query key, so each granularity caches separately and switching is instant
 *  once seen. Omitted = 'month', the historical behaviour. */
export function useHrDashboardStats(
  filter: { siteId?: string; departmentId?: string; granularity?: 'day' | 'week' | 'month' } = {},
) {
  const f = filter as Record<string, unknown>;
  return useQuery({
    queryKey: hrEmployeeKeys.dashboardStats(f),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await hrPost<{ success: boolean; data: { stats: HrDashboardStats } }>('hr/employees/dashboard-stats', f, { signal });
      return res.data.stats;
    },
  });
}

export function useHrWorkflowSummary(employeeId: string | null) {
  return useQuery({
    queryKey: hrEmployeeKeys.workflowSummary(employeeId ?? ''),
    enabled:  !!employeeId,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await hrPost<{ success: boolean; data: HrWorkflowSummary }>('hr/employees/workflow-summary', { employeeId }, { signal });
      return res.data;
    },
  });
}

export function useHrStatutory(employeeId: string | null) {
  return useQuery({
    queryKey: hrEmployeeKeys.statutory(employeeId ?? ''),
    enabled:  !!employeeId,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await hrPost<{ success: boolean; data: { statutory: HrStatutoryRow | null; readiness: PayrollReadiness } }>('hr/employees/statutory/get', { employeeId }, { signal });
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
  /** The row the change was recorded against — the "related record" reference. */
  record_id?:     string | null;
  /** Snapshots the audit writer stored. Absent on rows written without them. */
  previous_state?: Record<string, unknown> | null;
  new_state?:      Record<string, unknown> | null;
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
  certificates: { status: string; expires_at: string | null; course_name: string }[];
}

export function useHrAudit(employeeId: string | null) {
  return useQuery({
    queryKey: hrEmployeeKeys.audit(employeeId ?? ''),
    enabled:  !!employeeId,
    retry:    false,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await hrPost<{ success: boolean; data: HrAuditEntry[] }>('hr/employees/audit', { employeeId }, { signal });
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
      const res = await hrPost<{ success: boolean; data: HrDocument[] }>('hr/employees/documents/list', { employeeId }, { signal });
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
      const res = await hrPost<{ success: boolean; data: HrTrainingSummary }>('hr/employees/training-summary', { employeeId }, { signal });
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
      const res = await hrPost<{ success: boolean; data: HrOrgUnit[] }>('hr/organization/tree', {}, { signal });
      return res.data;
    },
  });
}

export function useHrSites() {
  return useQuery({
    queryKey: hrEmployeeKeys.sites(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await hrPost<{ success: boolean; data: HrSite[] }>('hr/sites/list', {}, { signal });
      return res.data;
    },
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface ContactUpdateArgs {
  employeeId: string; mode?: 'direct' | 'request';
  work?:      { email?: string | null; phone?: string | null; mobilePhone?: string | null };
  personal?:  { personalEmail?: string | null };
  emergency?: { name?: string | null; phone?: string | null; relationship?: string | null };
  reason?:    string;
}

export function useUpdateHrContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ContactUpdateArgs) =>
      hrPost<{ success: boolean; data: { mode: string; employee?: HrEmployeeRow; requestId?: string; changeNo?: string } }>('hr/employees/contact/update', args as unknown as Record<string, unknown>),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.lists() });
    },
  });
}

export interface PhotoDecideArgs { employeeId: string; approve: boolean; reason?: string }

export function useDecideHrEmployeePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: PhotoDecideArgs) =>
      hrPost<{ success: boolean; message?: string }>('hr/employees/photo/decide', args as unknown as Record<string, unknown>),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.lists() });
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
      hrPost<{ success: boolean; data: { payroll_readiness: PayrollReadinessStatus; blockers: string[]; financeHandoffEligible: boolean } }>('hr/employees/statutory/update', args as unknown as Record<string, unknown>),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.statutory(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
    },
  });
}

/**
 * Employee-record attributes that are NOT effective-dated.
 *
 * Every key is optional: an omitted key leaves the column untouched, and `null`
 * clears it. Sending `''` would write an empty string where the record means
 * "not recorded", so callers normalise a cleared control to `null`.
 */
export interface EmployeeRecordUpdateArgs {
  employeeId: string;
  firstName?: string;
  lastName?: string | null;
  displayName?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  position?: string | null;
  employmentType?: string;
  startDate?: string | null;
  endDate?: string | null;
  contractorFlag?: boolean;
  costCenter?: string | null;
  employeeGrade?: string | null;
  workSchedule?: string | null;
  probationEndDate?: string | null;
}

export function useUpdateHrEmployeeRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: EmployeeRecordUpdateArgs) =>
      hrPost<{ success: boolean; data: HrEmployeeRow }>(
        'hr/employees/update', args as unknown as Record<string, unknown>, { retryable: false },
      ),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.profileShell(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.audit(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.lists() });
    },
  });
}

/**
 * Effective-dated assignment change.
 *
 * Every field is optional-and-nullable because the backend distinguishes
 * "omitted" (carry the current period's value forward) from `null` (clear it).
 * Sending a blank string for an unset picker would be a THIRD meaning the route
 * does not have, so the caller must send `null` or omit the key.
 */
export interface AssignmentApplyArgs {
  employeeId: string;
  positionId?: string | null;
  departmentId?: string | null;
  siteId?: string | null;
  supervisorId?: string | null;
  effectiveFrom?: string | null;
  conditions?: { weeklyHours?: number | null; fte?: number | null; noticePeriodDays?: number | null };
  reason?: string;
}

/** Mirrors `ApplyAssignmentResult` in netlify/functions/lib/hr/employmentDetail.ts. */
export interface AssignmentApplyResult {
  assignmentId: string;
  employeeId: string;
  /** True when this opened the employee's FIRST effective period. */
  isFirstAssignment: boolean;
  supersededAssignmentId: string | null;
  effectiveFrom: string;
  weeklyHours: number | null;
  fte: number | null;
  noticePeriodDays: number | null;
  correlationId: string;
}

/**
 * Apply an assignment change through the transactional command.
 *
 * `hr_employee_assignment_apply_tx` closes the outgoing period and opens the
 * incoming one in ONE commit, and CREATES the first period when the employee has
 * none — which is the normal case in this build. Not retryable: a replay would
 * open a second period for the same effective date.
 */
export function useApplyHrAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: AssignmentApplyArgs) =>
      hrPost<{ success: boolean; data: AssignmentApplyResult }>(
        'hr/employees/assignment/apply', args as unknown as Record<string, unknown>, { retryable: false },
      ),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.profileShell(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.employmentDetail(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.attention(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.audit(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.lists() });
    },
  });
}

export interface StatusChangeArgs { employeeId: string; newStatus: string; reason?: string; effectiveDate?: string }

export function useChangeHrStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: StatusChangeArgs) =>
      hrPost<{ success: boolean; data: { employeeId: string; status: string } }>('hr/employees/status-change', args as unknown as Record<string, unknown>),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(vars.employeeId) });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.lists() });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.audit(vars.employeeId) });
    },
  });
}

export interface ChangeRequestArgs { employeeId: string; changeType: string; requestedValue: Record<string, unknown>; reason?: string }

export function useCreateHrChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ChangeRequestArgs) =>
      hrPost<{ success: boolean; data: { id: string; change_no: string } }>('hr/employees/change-request', args as unknown as Record<string, unknown>),
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
      const signed = await hrPost<{ success: boolean; uploadUrl: string; path: string }>(
        'hr/employees/documents/upload-url', { fileName: a.file.name, mimeType: a.file.type || 'application/octet-stream' }, { retryable: false });
      const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': a.file.type || 'application/octet-stream' }, body: a.file });
      if (!put.ok) throw new Error('File upload failed.');
      return hrPost<{ success: boolean; data: { id: string } }>('hr/employees/documents/commit', {
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
      hrPost<{ success: boolean; data: { documentId: string; status: string } }>('hr/documents/verify', a as unknown as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrEmployeeKeys.documents(employeeId ?? '') }),
  });
}

export function useArchiveHrDocument(employeeId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => hrPost<{ success: boolean }>('hr/documents/archive', { documentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrEmployeeKeys.documents(employeeId ?? '') }),
  });
}

/** Audited presigned download — open the returned URL in a new tab. */
export async function getHrDocumentDownloadUrl(documentId: string): Promise<string> {
  const res = await hrPost<{ success: boolean; url: string }>('hr/documents/download-url', { documentId });
  return res.url;
}

// ── Access Profiles ────────────────────────────────────────────────────────────

export interface HrAccessProfile {
  id:           string;
  code:         string;
  label:        string;
  description:  string | null;
  requires_mfa: boolean;
  is_active:    boolean;
  sort_order:   number;
}

export function useHrAccessProfiles() {
  return useQuery({
    queryKey: ['hr', 'access-profiles'],
    staleTime: 5 * 60 * 1000,  // profiles rarely change; 5-minute cache
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await hrPost<{ success: boolean; data: HrAccessProfile[] }>('hr/access-profiles/list', {}, { signal });
      return res.data;
    },
  });
}

// ── Employee Creation Wizard V2 ────────────────────────────────────────────────
// New contract: no password, access-profile-ID instead of raw role,
// account mode selection, statutory writes to canonical profile table.

export type WizardAccountMode = 'no_login';

export interface CreateHrEmployeeArgsV2 {
  requestKey: string;
  identity: {
    username:       string;
    firstName:      string;
    lastName:       string;
    email?:         string;
    personalEmail?: string;
    phone?:         string;
    employeeNumber?: string;
    dateOfBirth?:   string;
    nationality?:   string;
    preferredName?: string;
    governmentId?:  string;
  };
  employment: {
    employmentType:    string;
    startDate:         string;
    position?:         string;
    probationEndDate?: string;
    employeeGrade?:    string;
    workSchedule?:     string;
  };
  assignment?: {
    departmentId?:  string | null;
    siteId?:        string | null;
    supervisorId?:  string | null;
    effectiveDate?: string;
  };
  access: {
    accessProfileId: string;
    accountMode:     WizardAccountMode;
  };
  recordStatus?: string;
  statutory?: {
    nisNumber?:               string | null;
    nisStatus?:               string;
    nisApplicable?:           boolean;
    nisEffectiveDate?:        string | null;
    birFileNumber?:           string | null;
    payeApplicable?:          boolean;
    td1Received?:             boolean;
    td1EffectiveYear?:        number | null;
    hsApplicable?:            boolean;
    hsExemptionReason?:       string | null;
    hsEffectiveDate?:         string | null;
    hsVerificationRequired?:  boolean;
  };
  onboarding?: {
    prepareOnboarding?: boolean;
    packageKey?:        string;
  };
}

export interface CreateEmployeeReceiptV2 {
  employee_id:          string;
  employee_no:          string;
  status:               string;
  payroll_readiness:    PayrollReadinessStatus;
  onboarding_case_id:   string | null;
  onboarding_case_no:   string | null;
  onboarding_status:    'draft_prepared' | 'not_requested';
  account_status:       'not_requested';
  event_id:             string;
}

export function useCreateHrEmployeeV2() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateHrEmployeeArgsV2) =>
      hrPost<{ success: boolean; data: CreateEmployeeReceiptV2 }>('hr/employees/create', args as unknown as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: hrEmployeeKeys.all }),
  });
}

// ── Wizard Drafts ──────────────────────────────────────────────────────────────

export interface WizardDraftRecord {
  id:         string;
  actor_id:   string;
  draft_data: unknown;
  step_index: number;
  label:      string | null;
  expires_at: string;
  updated_at: string | null;
}

export function useWizardDraftGet() {
  return useQuery({
    queryKey: ['hr', 'employee-wizard-draft'],
    staleTime: 0,   // always re-check on mount — draft may have expired or been deleted
    retry:    false,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await hrPost<{ success: boolean; data: WizardDraftRecord | null }>('hr/employees/wizard/draft/get', {}, { signal });
      return res.data;
    },
  });
}

export function useWizardDraftSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { draftData: unknown; stepIndex: number; label?: string }) =>
      hrPost<{ success: boolean; data: WizardDraftRecord }>('hr/employees/wizard/draft/save', args as unknown as Record<string, unknown>),
    onSuccess: (d) => {
      qc.setQueryData(['hr', 'employee-wizard-draft'], d.data);
    },
  });
}

export function useWizardDraftDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      hrPost<{ success: boolean }>('hr/employees/wizard/draft/delete', {}),
    onSuccess: () => {
      qc.setQueryData(['hr', 'employee-wizard-draft'], null);
    },
  });
}
