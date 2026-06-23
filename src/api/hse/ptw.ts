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
  | 'gas_test_pending'
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
  gas_tests:   unknown[];
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
  requires_gas_test:          boolean;
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
  | 'approve'
  | 'reject'
  | 'request-changes'
  | 'activate'
  | 'suspend'
  | 'revalidate'
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
