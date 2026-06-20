/**
 * src/api/hse/incidents.ts
 *
 * TanStack Query hooks for the HSE Incident → Investigation → CAPA vertical slice.
 * All mutations call authenticated POST endpoints via apiPost (JWT attached automatically).
 *
 * Phase 1A: replaces mockIncidents, mockInvestigations, mockCapa in Incidents.tsx.
 */

import { useQuery, useMutation, useQueryClient, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { hseIncidentKeys } from '../queryKeys';

// ── Types (API response shapes) ───────────────────────────────────────────────

export type IncidentSeverity = 'critical' | 'major' | 'moderate' | 'minor';
export type IncidentStatus   = 'reported' | 'under-investigation' | 'capa-raised' | 'closed';
export type IncidentType     = 'injury' | 'near-miss' | 'property-damage' | 'environmental' | 'unsafe-act' | 'unsafe-condition';

export type OshClass =
  | 'first-aid' | 'medical-treatment' | 'restricted-duty' | 'lost-time'
  | 'fatality' | 'property-damage' | 'environmental' | 'near-miss' | 'dangerous-occurrence';

export interface PersonInvolved {
  name: string; employeeId?: string; role?: string; contractor?: boolean;
}
export interface Witness {
  name: string; employeeId?: string; statement?: string;
}

export interface HseIncident {
  id:                   string;
  ref:                  string;
  type:                 IncidentType;
  severity:             IncidentSeverity;
  classification:       OshClass | null;
  injury_type:          string | null;
  body_part:            string | null;
  lost_days:            number;
  return_to_work:       string | null;
  site_id:              string | null;
  site_name:            string | null;
  status:               IncidentStatus;
  reporter_id:          string | null;
  reporter_name:        string | null;
  description:          string | null;
  immediate_actions:    string | null;
  occurred_at:          string;
  people_involved:      PersonInvolved[];
  witnesses:            Witness[];
  osh_notification_due: string | null;
  osh_notified_at:      string | null;
  osh_written_due:      string | null;
  osh_written_at:       string | null;
  osh_class:            string | null;
  workflow_id:          string | null;
  created_at:           string;
  updated_at:           string;
}

export interface HseInvestigation {
  id:          string;
  incident_id: string;
  method:      string;
  findings:    Array<{ why: string; because: string }>;
  root_cause:  string | null;
  lead_id:     string | null;
  lead_name:   string | null;
  status:      'open' | 'in-progress' | 'closed';
  closed_at:   string | null;
  created_at:  string;
  updated_at:  string;
}

export interface HseCapa {
  id:               string;
  ref:              string;
  source_ref:       string;
  source_type:      string;
  title:            string;
  description:      string;
  owner_id:         string | null;
  owner_name:       string | null;
  due_date:         string;
  priority:         'critical' | 'high' | 'medium' | 'low';
  status:           'open' | 'in-progress' | 'overdue' | 'closed' | 'verified';
  verification_note: string | null;
  closed_at:        string | null;
  workflow_id:      string | null;
  created_at:       string;
  updated_at:       string;
}

export interface HseDashboardKpis {
  incidentsMtd:            number;
  openIncidents:           number;
  openCapas:               number;
  overdueCapas:            number;
  openWorkflows:           number;
  oshNotificationsOverdue: number;
  ltiCasesYtd:            number;
  totalLostDays:          number;
  ltiFreeDays:            number | null;
}

// ── Filter types ──────────────────────────────────────────────────────────────

export interface IncidentListFilters extends Record<string, unknown> {
  status?:     IncidentStatus;
  severity?:   IncidentSeverity;
  siteId?:     string;
  reporterId?: string;
  from?:       string;
  to?:         string;
  limit?:      number;
  offset?:     number;
}

export interface CapaListFilters extends Record<string, unknown> {
  status?:    'open' | 'in-progress' | 'overdue' | 'closed' | 'verified';
  ownerId?:   string;
  priority?:  'critical' | 'high' | 'medium' | 'low';
  sourceRef?: string;
  limit?:     number;
  offset?:    number;
}

// ── Incidents ─────────────────────────────────────────────────────────────────

export function useHseIncidents(filters: IncidentListFilters = {}) {
  return useQuery({
    queryKey: hseIncidentKeys.list(filters),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HseIncident[]; total: number }>(
        'hse/incidents/list', filters, { signal },
      );
      if (!res.success) throw new Error((res as { message?: string }).message ?? 'Failed to load incidents');
      return res.data;
    },
  });
}

export function useHseIncident(id: string) {
  return useQuery({
    queryKey: hseIncidentKeys.detail(id),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: { incident: HseIncident; investigations: HseInvestigation[]; capas: HseCapa[] } }>(
        'hse/incidents/get', { id }, { signal },
      );
      if (!res.success) throw new Error((res as { message?: string }).message ?? 'Failed to load incident');
      return res.data;
    },
    enabled: !!id,
  });
}

export interface CreateIncidentArgs extends Record<string, unknown> {
  type: IncidentType;
  severity: IncidentSeverity;
  classification?: OshClass;
  injuryType?: string;
  bodyPart?: string;
  lostDays?: number;
  returnToWork?: string;
  siteId?: string;
  siteName?: string;
  description?: string;
  immediateActions?: string;
  occurredAt?: string;
  peopleInvolved?: PersonInvolved[];
  witnesses?: Witness[];
  oshClass?: string;
  workflowId?: string;
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateIncidentArgs) =>
      apiPost<{ success: boolean; id: string; ref: string }>('hse/incidents/create', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

export interface UpdateIncidentArgs extends Record<string, unknown> {
  id: string;
  status?: IncidentStatus;
  classification?: OshClass;
  injuryType?: string;
  bodyPart?: string;
  lostDays?: number;
  returnToWork?: string;
  description?: string;
  immediateActions?: string;
  peopleInvolved?: PersonInvolved[];
  witnesses?: Witness[];
  oshNotifiedAt?: string;
  oshWrittenAt?: string;
  oshClass?: string;
  workflowId?: string;
}

export function useUpdateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateIncidentArgs) =>
      apiPost<{ success: boolean }>('hse/incidents/update', args, { retryable: false }),
    onSuccess: (_r: unknown, vars: UpdateIncidentArgs) => {
      qc.invalidateQueries({ queryKey: hseIncidentKeys.all });
      qc.invalidateQueries({ queryKey: hseIncidentKeys.detail(vars.id) });
    },
  });
}

// ── Investigations ────────────────────────────────────────────────────────────

export function useHseInvestigations(incidentId?: string) {
  return useQuery({
    queryKey: hseIncidentKeys.investigations(incidentId ?? ''),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HseInvestigation[] }>(
        'hse/investigations/list', { incidentId, limit: 100 }, { signal },
      );
      if (!res.success) throw new Error((res as { message?: string }).message ?? 'Failed to load investigations');
      return res.data;
    },
    enabled: !!incidentId,
  });
}

export function useCreateInvestigation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { incidentId: string; method?: string; leadId?: string; leadName?: string }) =>
      apiPost<{ success: boolean; id: string }>('hse/investigations/create', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

export function useUpdateInvestigation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      findings?: Array<{ why: string; because: string }>;
      rootCause?: string;
      status?: 'open' | 'in-progress' | 'closed';
    }) => apiPost<{ success: boolean }>('hse/investigations/update', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

// ── CAPA ──────────────────────────────────────────────────────────────────────

export function useHseCapa(filters: CapaListFilters = {}) {
  return useQuery({
    queryKey: hseIncidentKeys.capaList(filters),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HseCapa[] }>(
        'hse/capa/list', { ...filters, limit: filters.limit ?? 100 }, { signal },
      );
      if (!res.success) throw new Error((res as { message?: string }).message ?? 'Failed to load CAPA');
      return res.data;
    },
  });
}

export function useCreateCapa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      sourceRef: string;
      sourceType: string;
      title: string;
      description: string;
      ownerId?: string;
      ownerName?: string;
      dueDate: string;
      priority?: 'critical' | 'high' | 'medium' | 'low';
    }) => apiPost<{ success: boolean; id: string; ref: string }>('hse/capa/create', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

export function useUpdateCapa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      status?: 'open' | 'in-progress' | 'overdue' | 'closed' | 'verified';
      verificationNote?: string;
      ownerId?: string;
      dueDate?: string;
    }) => apiPost<{ success: boolean }>('hse/capa/update', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

// ── Dashboard KPIs ────────────────────────────────────────────────────────────

export function useHseDashboardKpis() {
  return useQuery({
    queryKey: hseIncidentKeys.kpis(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HseDashboardKpis }>(
        'hse/dashboard/kpis', {}, { signal },
      );
      if (!res.success) throw new Error((res as { message?: string }).message ?? 'Failed to load KPIs');
      return res.data;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
