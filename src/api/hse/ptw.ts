/**
 * src/api/hse/ptw.ts
 *
 * TanStack Query hooks for the HSE Permit-to-Work (PTW) module.
 * All data comes through authenticated Netlify API — no direct Supabase reads.
 * Mirrors the shape of src/api/hse/riskJsa.ts exactly.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { ptwKeys } from '@api/queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PermitRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type PermitStatus =
  | 'draft'
  | 'submitted'
  | 'risk_review'
  | 'isolation_pending'
  | 'awaiting_approval'
  | 'changes_requested'
  | 'approved'
  | 'active'
  | 'suspended'
  | 'extension_requested'
  | 'expired'
  | 'closed'
  | 'cancelled'
  | 'rejected'
  | 'archived';

/** Row returned by /hse/ptw/permits/list */
export interface PermitListRow {
  id:                string;
  permit_number:     string | null;
  title:             string;
  permit_type:       string;
  risk_level:        PermitRiskLevel | null;
  status:            PermitStatus;
  site_id:           string | null;
  specific_location: string | null;
  requester_id:      string | null;
  work_supervisor_id:string | null;
  area_authority_id: string | null;
  start_datetime:    string | null;
  end_datetime:      string | null;
  created_at:        string;
  updated_at:        string;
}

/** Full permit + related records returned by /hse/ptw/permits/get */
export interface PermitDetail {
  permit:      Record<string, unknown>;
  hazards:     unknown[];
  controls:    unknown[];
  approvals:   unknown[];
  isolations:  unknown[];
  simops:      unknown[];
  extensions:  unknown[];
  suspensions: unknown[];
  closeout:    unknown | null;
  attachments: unknown[];
  timeline:    unknown[];
  permitRef:   string;
}

/** Stats response from /hse/ptw/permits/stats */
export interface PermitStats {
  activePermits: {
    total:        number;
    highRisk:     number;
    criticalAreas:number;
    byType:       Array<{ type: string; count: number }>;
  };
  expiringSoon: {
    total:          number;
    withinTwoHours: number;
    buckets:        Array<{ label: string; count: number }>;
  };
  isolationReadiness: {
    percentage: number;
    verified:   number;
    required:   number;
  };
  approvalBottlenecks: {
    total:   number;
    byStage: Array<{ stage: string; count: number }>;
  };
}

/** Row from hse_permit_type_config */
export interface PermitTypeConfig {
  id:                         string;
  permit_type:                string;
  display_name:               string;
  requires_jsa:               boolean;
  requires_isolation:         boolean;
  requires_simops_check:      boolean;
  requires_height_plan:       boolean;
  requires_hot_work_cert:     boolean;
  requires_confined_space_cert: boolean;
  requires_radiation_badge:   boolean;
  requires_excavation_survey: boolean;
  requires_lifting_plan:      boolean;
  requires_line_break_cert:   boolean;
  requires_energized_cert:    boolean;
  max_duration_hours:         number;
  active:                     boolean;
  sort_order:                 number | null;
  created_at:                 string;
}

// ── Filter types ──────────────────────────────────────────────────────────────

export interface PermitFilter extends Record<string, unknown> {
  status?:       string | null;
  permitType?:   string | null;
  siteId?:       string | null;
  riskLevel?:    string | null;
  requesterId?:  string | null;
  expiringSoon?: boolean;
  search?:       string | null;
  limit?:        number;
}

// ── Arg types for create / update ─────────────────────────────────────────────

// ── Child record types for create payload ─────────────────────────────────────

export interface CreatePermitHazardControl {
  description:         string;
  responsibleUserId?:  string | null;
  verificationRequired?: boolean;
  evidenceRequired?:   boolean;
}

export interface CreatePermitHazard {
  category:    string;
  name:        string;
  description?: string;
  consequence?: string;
  riskLevel?:  string | null;
  controls:    CreatePermitHazardControl[];
}

export interface CreatePermitIsolation {
  isolationType:  string;
  isolationPoint: string;
  tagNumber?:     string | null;
}

// ── Create args ───────────────────────────────────────────────────────────────

export interface CreatePermitArgs extends Record<string, unknown> {
  permitType:        string;
  title:             string;
  description?:      string;
  siteId?:           string | null;
  specificLocation?: string | null;
  riskLevel?:        PermitRiskLevel | null;
  startDatetime?:    string | null;
  endDatetime?:      string | null;
  workSupervisorId?: string | null;
  areaAuthorityId?:  string | null;
  linkedJsaId?:      string | null;
  linkedRiskAssessmentId?: string | null;
  /** When true, creates as 'submitted' instead of 'draft'. */
  submitImmediately?: boolean;
  /** Hazards + controls to insert after permit creation. */
  hazards?:          CreatePermitHazard[];
  /** Isolation points to insert (status='planned'). */
  isolations?:       CreatePermitIsolation[];
  /** SIMOPS note. */
  simopsNote?:       string | null;
}

export interface UpdatePermitArgs extends Record<string, unknown> {
  permitId:          string;
  title?:            string;
  description?:      string;
  riskLevel?:        PermitRiskLevel | null;
  siteId?:           string | null;
  specificLocation?: string | null;
  startDatetime?:    string | null;
  endDatetime?:      string | null;
  workSupervisorId?: string | null;
  areaAuthorityId?:  string | null;
  linkedJsaId?:      string | null;
  linkedRiskAssessmentId?: string | null;
}

// ── Lifecycle action type ─────────────────────────────────────────────────────

export type PermitLifecycleAction =
  | 'submit'
  | 'advance'
  | 'approve'
  | 'reject'
  | 'request-changes'
  | 'activate'
  | 'suspend'
  | 'revalidate'
  | 'request-extension'
  | 'approve-extension'
  | 'reject-extension'
  | 'close'
  | 'cancel'
  | 'archive';

// ── Query hooks ───────────────────────────────────────────────────────────────

export function usePermits(filter: PermitFilter = {}) {
  return useQuery({
    queryKey: ptwKeys.list(filter as Record<string, unknown>),
    queryFn:  () => apiPost<{ success: boolean; data: PermitListRow[] }>(
      'hse/ptw/permits/list', { args: filter },
    ),
    staleTime: 30_000,
  });
}

export function usePermit(id: string | null) {
  return useQuery({
    queryKey: ptwKeys.detail(id ?? ''),
    queryFn:  () => apiPost<{ success: boolean; data: PermitDetail }>(
      'hse/ptw/permits/get', { args: { permitId: id } },
    ),
    enabled:  !!id,
    staleTime: 15_000,
  });
}

export function usePermitStats() {
  return useQuery({
    queryKey: ptwKeys.stats(),
    queryFn:  () => apiPost<{ success: boolean; data: PermitStats }>(
      'hse/ptw/permits/stats', {},
    ),
    staleTime: 30_000,
  });
}

export function usePermitTypes() {
  return useQuery({
    queryKey: ptwKeys.types(),
    queryFn:  () => apiPost<{ success: boolean; data: PermitTypeConfig[] }>(
      'hse/ptw/permit-types/list', {},
    ),
    staleTime: 5 * 60_000,
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useCreatePermit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreatePermitArgs) =>
      apiPost<{ success: boolean; data: { id: string; permitNo: string; status: string; eventId: string | null } }>(
        'hse/ptw/permits/create', { args }, { retryable: false },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ptwKeys.all }),
  });
}

export function useUpdatePermit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdatePermitArgs) =>
      apiPost<{ success: boolean }>('hse/ptw/permits/update', { args }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ptwKeys.all }),
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdatePermitArgs) =>
      apiPost<{ success: boolean }>('hse/ptw/permits/save-draft', { args }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ptwKeys.all }),
  });
}

/** Drive a lifecycle transition (submit / approve / reject / activate / …). */
export function usePermitTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, permitId, note }: { action: PermitLifecycleAction; permitId: string; note?: string }) =>
      apiPost<{ success: boolean; status?: string }>(
        `hse/ptw/permits/${action}`, { args: { permitId, note: note ?? null } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ptwKeys.all }),
  });
}

// ── Sub-register types ────────────────────────────────────────────────────────

export interface PermitIsolation {
  id:              string;
  permit_id:       string;
  isolation_type:  string;
  description:     string;
  equipment_tag:   string | null;
  location:        string | null;
  responsible_person_id: string | null;
  status:          string;
  applied_at:      string | null;
  verified_at:     string | null;
  removed_at:      string | null;
  notes:           string | null;
  created_at:      string;
}

export interface PermitSimops {
  id:              string;
  permit_id:       string;
  conflicting_permit_id: string | null;
  conflict_type:   string;
  description:     string;
  risk_assessment: string | null;
  status:          string;
  resolved_by:     string | null;
  resolved_at:     string | null;
  override_approved_by: string | null;
  override_approved_at: string | null;
  override_justification: string | null;
  created_at:      string;
}

export interface PermitApproval {
  id:              string;
  permit_id:       string;
  approval_type:   string;
  approver_id:     string | null;
  approver_name:   string | null;
  required:        boolean;
  status:          string;
  notes:           string | null;
  decided_at:      string | null;
  sequence_order:  number | null;
  created_at:      string;
}

// ── Sub-register arg types ─────────────────────────────────────────────────────

export interface CreateIsolationArgs extends Record<string, unknown> {
  permitId:           string;
  isolationType:      string;
  description:        string;
  equipmentTag?:      string | null;
  location?:          string | null;
  responsiblePersonId?: string | null;
  notes?:             string | null;
}

export interface IsolationActionArgs extends Record<string, unknown> {
  isolationId: string;
  permitId:    string;
  note?:       string | null;
}

export interface SimopsCheckArgs extends Record<string, unknown> {
  permitId: string;
}

export interface SimopsActionArgs extends Record<string, unknown> {
  simopsId:              string;
  permitId:              string;
  note?:                 string | null;
  overrideJustification?: string | null;
}

export interface DecideApprovalArgs extends Record<string, unknown> {
  approvalId: string;
  permitId:   string;
  decision:   'approve' | 'reject';
  notes?:     string | null;
}

// ── Sub-register query hooks ──────────────────────────────────────────────────

export function usePermitIsolations(permitId: string | null) {
  return useQuery({
    queryKey: [...ptwKeys.detail(permitId ?? ''), 'isolations'],
    queryFn:  () => apiPost<{ success: boolean; data: PermitIsolation[] }>(
      'hse/ptw/permits/isolations/list', { args: { permitId } },
    ),
    enabled:   !!permitId,
    staleTime: 15_000,
  });
}

export function usePermitSimops(permitId: string | null) {
  return useQuery({
    queryKey: [...ptwKeys.detail(permitId ?? ''), 'simops'],
    queryFn:  () => apiPost<{ success: boolean; data: PermitSimops[] }>(
      'hse/ptw/permits/simops/list', { args: { permitId } },
    ),
    enabled:   !!permitId,
    staleTime: 15_000,
  });
}

export function usePermitApprovals(permitId: string | null) {
  return useQuery({
    queryKey: [...ptwKeys.detail(permitId ?? ''), 'approvals'],
    queryFn:  () => apiPost<{ success: boolean; data: PermitApproval[] }>(
      'hse/ptw/permits/approvals/list', { args: { permitId } },
    ),
    enabled:   !!permitId,
    staleTime: 15_000,
  });
}

// ── Sub-register mutation hooks ───────────────────────────────────────────────

export function useCreateIsolation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateIsolationArgs) =>
      apiPost<{ success: boolean; data: { id: string } }>(
        'hse/ptw/permits/isolations/create', { args }, { retryable: false },
      ),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ptwKeys.detail(vars.permitId) });
      void qc.invalidateQueries({ queryKey: ptwKeys.stats() });
    },
  });
}

export function useIsolationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...args }: IsolationActionArgs & { action: 'apply' | 'verify' | 'reject' | 'remove' }) =>
      apiPost<{ success: boolean }>(
        `hse/ptw/permits/isolations/${action}`, { args }, { retryable: false },
      ),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ptwKeys.detail(vars.permitId) });
      void qc.invalidateQueries({ queryKey: ptwKeys.stats() });
    },
  });
}

export function useSimopsCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: SimopsCheckArgs) =>
      apiPost<{ success: boolean; data: { conflictsFound: number } }>(
        'hse/ptw/permits/simops/check', { args }, { retryable: false },
      ),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ptwKeys.detail(vars.permitId) });
    },
  });
}

export function useSimopsAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...args }: SimopsActionArgs & { action: 'resolve' | 'approve-override' }) =>
      apiPost<{ success: boolean }>(
        `hse/ptw/permits/simops/${action}`, { args }, { retryable: false },
      ),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ptwKeys.detail(vars.permitId) });
    },
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: DecideApprovalArgs) =>
      apiPost<{ success: boolean }>(
        'hse/ptw/permits/approvals/decide', { args }, { retryable: false },
      ),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ptwKeys.detail(vars.permitId) });
      void qc.invalidateQueries({ queryKey: ptwKeys.all });
    },
  });
}

// ── Permit Template types ─────────────────────────────────────────────────────

export interface PermitTemplate {
  id:                 string;
  name:               string;
  description:        string | null;
  permit_type:        string;
  risk_level:         PermitRiskLevel | null;
  requires_jsa:       boolean;
  requires_isolation: boolean;
  approval_route:     unknown[];
  hazards:            unknown[];
  controls:           unknown[];
  pre_work_checks:    unknown[];
  post_work_checks:   unknown[];
  active:             boolean;
  config:             Record<string, unknown>;
  created_by:         string | null;
  created_at:         string;
  updated_at:         string | null;
}

export interface CreateTemplateArgs extends Record<string, unknown> {
  name:               string;
  permitType:         string;
  description?:       string;
  riskLevel?:         PermitRiskLevel | null;
  requiresJsa?:       boolean;
  requiresIsolation?: boolean;
  hazards?:           string;
  controls?:          string;
}

export interface UpdateTemplateArgs extends Record<string, unknown> {
  templateId:         string;
  name?:              string;
  permitType?:        string;
  description?:       string | null;
  riskLevel?:         PermitRiskLevel | null;
  requiresJsa?:       boolean;
  requiresIsolation?: boolean;
  hazards?:           string;
  controls?:          string;
}

// ── Permit Template query hooks ───────────────────────────────────────────────

export function usePermitTemplates(activeOnly?: boolean) {
  const filter = activeOnly !== undefined ? { activeOnly } : {};
  return useQuery({
    queryKey: ptwKeys.templates(filter),
    queryFn:  () => apiPost<{ success: boolean; data: PermitTemplate[] }>(
      'hse/ptw/permit-templates/list', { args: activeOnly !== undefined ? { activeOnly } : {} },
    ),
    staleTime: 60_000,
  });
}

// ── Permit Template mutation hooks ────────────────────────────────────────────

/** Parse freeform hazards/controls text into a jsonb array of simple objects. */
function parseTextList(raw: string | undefined): unknown[] {
  if (!raw?.trim()) return [];
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(text => ({ text }));
}

export function useCreatePermitTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hazards, controls, ...rest }: CreateTemplateArgs) =>
      apiPost<{ success: boolean; data: { id: string } }>(
        'hse/ptw/permit-templates/create',
        { args: { ...rest, hazards: parseTextList(hazards as string | undefined), controls: parseTextList(controls as string | undefined) } },
        { retryable: false },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ptwKeys.templates() }),
  });
}

export function useUpdatePermitTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hazards, controls, ...rest }: UpdateTemplateArgs) =>
      apiPost<{ success: boolean }>(
        'hse/ptw/permit-templates/update',
        { args: { ...rest, hazards: parseTextList(hazards as string | undefined), controls: parseTextList(controls as string | undefined) } },
        { retryable: false },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ptwKeys.templates() }),
  });
}

export function useDuplicatePermitTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { templateId: string }) =>
      apiPost<{ success: boolean; data: { id: string } }>(
        'hse/ptw/permit-templates/duplicate', { args }, { retryable: false },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ptwKeys.templates() }),
  });
}

export function useDeactivatePermitTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { templateId: string; active: boolean }) =>
      apiPost<{ success: boolean }>(
        'hse/ptw/permit-templates/deactivate', { args }, { retryable: false },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ptwKeys.templates() }),
  });
}

// ── JSA / RA search for wizard Step 3 ────────────────────────────────────────
// Thin wrappers around the Risk/JSA list endpoints, filtered to approved/active.
// These are read-only lookups used by the PTW wizard only.

export interface JsaSearchRow {
  id:     string;
  ref:    string;
  title:  string;
  status: string;
}

export interface RaSearchRow {
  id:     string;
  ref:    string;
  title:  string;
  status: string;
}

/**
 * Search approved/active JSAs by keyword.
 * Enabled only when query is non-empty (min 2 chars).
 */
export function useApprovedJsaSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['ptw', 'jsa-search', q] as const,
    queryFn:  () => apiPost<{ success: boolean; data: JsaSearchRow[] }>(
      'hse/risk-jsa/jsa/list',
      { args: { status: 'approved', limit: 30 } },
    ).then(res => {
      // Client-side keyword filter (title / ref match)
      const lower = q.toLowerCase();
      return {
        ...res,
        data: (res.data ?? []).filter(
          r => r.ref.toLowerCase().includes(lower) || r.title.toLowerCase().includes(lower),
        ),
      };
    }),
    enabled:   q.length >= 2,
    staleTime: 60_000,
  });
}

/**
 * Search approved/active Risk Assessments by keyword.
 * Enabled only when query is non-empty (min 2 chars).
 */
export function useApprovedRaSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['ptw', 'ra-search', q] as const,
    queryFn:  () => apiPost<{ success: boolean; data: RaSearchRow[] }>(
      'hse/risk-jsa/assessments/list',
      { args: { status: 'approved', limit: 30 } },
    ).then(res => {
      const lower = q.toLowerCase();
      return {
        ...res,
        data: (res.data ?? []).filter(
          r => r.ref.toLowerCase().includes(lower) || r.title.toLowerCase().includes(lower),
        ),
      };
    }),
    enabled:   q.length >= 2,
    staleTime: 60_000,
  });
}
