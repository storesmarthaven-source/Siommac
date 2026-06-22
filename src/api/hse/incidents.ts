/**
 * src/api/hse/incidents.ts
 *
 * TanStack Query hooks for the HSE Incident → Investigation → CAPA vertical slice.
 * All mutations call authenticated POST endpoints via apiPost (JWT attached automatically).
 *
 * Types and request/response shapes mirror the canonical backend contract:
 *   netlify/functions/routes/hseIncidents.ts
 *   netlify/functions/routes/hseInvestigations.ts
 *   netlify/functions/routes/hseCapa.ts
 *
 * Mock fallback (Incidents.tsx) renders when the live query returns an empty set.
 */

import { useQuery, useMutation, useQueryClient, type QueryFunctionContext } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { hseIncidentKeys } from '../queryKeys';

// ── Canonical enums (match DB CHECK constraints) ──────────────────────────────

export type IncidentSeverity = 'minor' | 'moderate' | 'high' | 'critical';
export type IncidentStatus   =
  | 'open' | 'triage' | 'investigation' | 'capa'
  | 'awaiting_closure' | 'closed' | 'cancelled';
export type IncidentType     =
  | 'injury' | 'near_miss' | 'property_damage' | 'environmental' | 'other';

export type PersonType = 'injured' | 'witness' | 'reporter' | 'supervisor' | 'contractor' | 'visitor';

export type OshClassification =
  | 'first-aid' | 'medical-treatment' | 'restricted-duty' | 'lost-time'
  | 'fatality' | 'property-damage' | 'environmental' | 'near-miss' | 'dangerous-occurrence';

export type InvestigationStatus =
  | 'assigned' | 'collecting_evidence' | 'root_cause'
  | 'findings' | 'review' | 'closed' | 'overdue';
export type RootCauseMethod = '5why' | 'fishbone' | 'taproot' | 'other';

export type CapaPriority = 'low' | 'medium' | 'high' | 'critical';
export type CapaStatus   =
  | 'open' | 'in_progress' | 'implemented' | 'verification'
  | 'returned' | 'closed' | 'overdue' | 'cancelled';

// ── Response shapes (DB row columns) ──────────────────────────────────────────

export interface IncidentPerson {
  id:                 string;
  incident_id:        string;
  person_type:        PersonType;
  user_id:            string | null;
  full_name:          string;
  role_or_company:    string | null;
  injury_description: string | null;
  created_at:         string;
}

export interface HseIncident {
  id:               string;
  ref:              string;
  title:            string;
  description:      string;
  incident_date:    string;
  reported_at:      string;
  reported_by:      string | null;
  site_id:          string | null;
  department_id:    string | null;
  location_text:    string | null;
  incident_type:    IncidentType;
  severity:         IncidentSeverity;
  status:           IncidentStatus;
  immediate_action: string | null;
  regulatory_class: string | null;
  osh_classification:   OshClassification | null;
  injury_type:          string | null;
  body_part:            string | null;
  lost_days:            number;
  return_to_work:       string | null;
  osh_notification_due: string | null;
  osh_notified_at:      string | null;
  osh_written_due:      string | null;
  osh_written_at:       string | null;
  recordable:       boolean;
  lost_time:        boolean;
  workflow_id:      string | null;
  metadata:         Record<string, unknown>;
  created_at:       string;
  updated_at:       string | null;
}

export interface HseInvestigation {
  id:                   string;
  ref:                  string;
  incident_id:          string;
  investigator_user_id: string | null;
  status:               InvestigationStatus;
  due_at:               string | null;
  root_cause_method:    RootCauseMethod | null;
  summary?:             string | null;
  findings?:            string | null;
  recommendations?:     string | null;
  created_at:           string;
  closed_at:            string | null;
  updated_at?:          string | null;
}

export interface HseRootCause {
  id:                  string;
  investigation_id:    string;
  category:            string;
  cause:               string;
  contributing_factor: boolean;
}

export interface HseEvidence {
  id:               string;
  investigation_id: string;
  evidence_type:    string;
  title:            string;
  description:      string | null;
  attachment_id:    string | null;
  collected_by:     string | null;
  collected_at:     string | null;
  status:           string;
}

export interface HseCapa {
  id:                   string;
  ref:                  string;
  source_type:          string;
  source_id:            string;
  title:                string;
  description:          string;
  owner_user_id:        string | null;
  priority:             CapaPriority;
  status:               CapaStatus;
  due_at:               string | null;
  completed_at:         string | null;
  verified_by:          string | null;
  verified_at:          string | null;
  effectiveness_result: 'effective' | 'partially_effective' | 'ineffective' | null;
  workflow_id:          string | null;
  created_by:           string | null;
  metadata:             Record<string, unknown>;
  created_at:           string;
  updated_at:           string | null;
}

export interface HseDashboardKpis {
  incidentsMtd:            number;
  openIncidents:           number;
  openCapas:               number;
  overdueCapas:            number;
  openWorkflows:           number;
  oshNotificationsOverdue: number;
  ltiCasesYtd:             number;
  totalLostDays:           number;
  ltiFreeDays:             number | null;
}

// ── Filter types ──────────────────────────────────────────────────────────────

export interface IncidentListFilters extends Record<string, unknown> {
  siteId?:   string;
  status?:   IncidentStatus;
  severity?: IncidentSeverity;
  dateFrom?: string;
  dateTo?:   string;
  limit?:    number;
  cursor?:   string;
}

export interface CapaListFilters extends Record<string, unknown> {
  status?:   CapaStatus;
  ownerId?:  string;
  priority?: CapaPriority;
  overdue?:  boolean;
  limit?:    number;
  cursor?:   string;
}

// ── Incidents ─────────────────────────────────────────────────────────────────

export function useHseIncidents(filters: IncidentListFilters = {}) {
  return useQuery({
    queryKey: hseIncidentKeys.list(filters),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HseIncident[] }>(
        'hse/incidents/list', filters, { signal },
      );
      if (!res.success) throw new Error((res as { message?: string }).message ?? 'Failed to load incidents');
      return res.data;
    },
  });
}

export function useHseIncident(incidentId: string) {
  return useQuery({
    queryKey: hseIncidentKeys.detail(incidentId),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: { incident: HseIncident; people: IncidentPerson[] } }>(
        'hse/incidents/get', { incidentId }, { signal },
      );
      if (!res.success) throw new Error((res as { message?: string }).message ?? 'Failed to load incident');
      return res.data;
    },
    enabled: !!incidentId,
  });
}

export interface IncidentPersonInput {
  personType:         PersonType;
  userId?:            string | null;
  fullName:           string;
  roleOrCompany?:     string | null;
  injuryDescription?: string | null;
}

export interface CreateIncidentArgs extends Record<string, unknown> {
  title:             string;
  description?:       string;
  incidentDate:       string;
  siteId?:            string | null;
  departmentId?:      string | null;
  locationText?:      string | null;
  incidentType:       IncidentType;
  severity:           IncidentSeverity;
  immediateAction?:   string | null;
  regulatoryClass?:   string | null;
  oshClassification?: OshClassification | null;
  injuryType?:        string | null;
  bodyPart?:          string | null;
  lostDays?:          number;
  returnToWork?:      string | null;
  recordable?:        boolean;
  lostTime?:          boolean;
  people?:            IncidentPersonInput[];
  metadata?:          Record<string, unknown>;
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateIncidentArgs) =>
      apiPost<{ success: boolean; incidentId: string; ref: string; workflowId: string | null }>(
        'hse/incidents/create', args, { retryable: false },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

export interface UpdateIncidentArgs extends Record<string, unknown> {
  incidentId:         string;
  title?:             string;
  description?:        string;
  status?:            IncidentStatus;
  severity?:          IncidentSeverity;
  immediateAction?:   string | null;
  regulatoryClass?:   string | null;
  oshClassification?: OshClassification | null;
  injuryType?:        string | null;
  bodyPart?:          string | null;
  lostDays?:          number;
  returnToWork?:      string | null;
  oshNotifiedAt?:     string | null;
  oshWrittenAt?:      string | null;
  recordable?:        boolean;
  lostTime?:          boolean;
  metadata?:          Record<string, unknown>;
}

export function useUpdateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateIncidentArgs) =>
      apiPost<{ success: boolean }>('hse/incidents/update', args, { retryable: false }),
    onSuccess: (_r: unknown, vars: UpdateIncidentArgs) => {
      qc.invalidateQueries({ queryKey: hseIncidentKeys.all });
      qc.invalidateQueries({ queryKey: hseIncidentKeys.detail(vars.incidentId) });
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
    // List all when no incidentId; scoped list when one is provided.
    enabled: incidentId === undefined || !!incidentId,
  });
}

export interface CreateInvestigationArgs extends Record<string, unknown> {
  incidentId:          string;
  investigatorUserId?: string | null;
  rootCauseMethod?:    RootCauseMethod | null;
  dueAt?:              string | null;
}

export function useCreateInvestigation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateInvestigationArgs) =>
      apiPost<{ success: boolean; investigationId: string; ref: string }>(
        'hse/investigations/create', args, { retryable: false },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

export interface UpdateInvestigationArgs extends Record<string, unknown> {
  investigationId:  string;
  status?:          InvestigationStatus;
  summary?:         string | null;
  findings?:        string | null;
  recommendations?: string | null;
  rootCauseMethod?: RootCauseMethod | null;
  dueAt?:           string | null;
}

export function useUpdateInvestigation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateInvestigationArgs) =>
      apiPost<{ success: boolean }>('hse/investigations/update', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

export interface AddRootCauseArgs extends Record<string, unknown> {
  investigationId:     string;
  category:            string;
  cause:               string;
  contributingFactor?: boolean;
}

export function useAddRootCause() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: AddRootCauseArgs) =>
      apiPost<{ success: boolean; rootCauseId: string }>('hse/investigations/addRootCause', args, { retryable: false }),
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

export interface CreateCapaArgs extends Record<string, unknown> {
  sourceType:   string;
  sourceId:     string;
  title:        string;
  description:  string;
  ownerUserId?: string | null;
  priority?:    CapaPriority;
  dueAt?:       string | null;
  metadata?:    Record<string, unknown>;
}

export function useCreateCapa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateCapaArgs) =>
      apiPost<{ success: boolean; capaId: string; ref: string; workflowId: string | null }>(
        'hse/capa/create', args, { retryable: false },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

export interface UpdateCapaArgs extends Record<string, unknown> {
  capaId:               string;
  status?:              CapaStatus;
  priority?:            CapaPriority;
  dueAt?:               string | null;
  ownerUserId?:         string | null;
  verifiedBy?:          string | null;
  effectivenessResult?: 'effective' | 'partially_effective' | 'ineffective' | null;
  metadata?:            Record<string, unknown>;
}

export function useUpdateCapa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: UpdateCapaArgs) =>
      apiPost<{ success: boolean }>('hse/capa/update', args, { retryable: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: hseIncidentKeys.all }),
  });
}

// ── Incident detail (all-in-one drawer payload) ───────────────────────────────

export interface HseWorkflowInstance {
  id:                 string;
  ref:                string;
  template_id:        string;
  source_module:      string;
  source_entity_type: string;
  source_entity_id:   string;
  status:             string;
  priority:           string;
  current_step:       string | null;
  owner_user_id:      string | null;
  due_at:             string | null;
  created_at:         string;
  updated_at:         string | null;
}

export interface HseWorkflowTask {
  id:               string;
  workflow_id:      string;
  task_type:        string;
  title:            string;
  assigned_role:    string | null;
  assigned_user_id: string | null;
  status:           string;
  due_at:           string | null;
  completed_at:     string | null;
  note:             string | null;
  created_at:       string;
}

export interface HseTimelineEvent {
  id:                 string;
  event_type:         string;
  source_entity_type: string;
  source_entity_id:   string;
  actor_user_id:      string | null;
  severity:           string;
  payload:            Record<string, unknown>;
  created_at:         string;
}

export interface HseIncidentDetailData {
  incident:      HseIncident;
  people:        IncidentPerson[];
  investigation: HseInvestigation | null;
  evidence:      HseEvidence[];
  rootCauses:    HseRootCause[];
  capa:          HseCapa[];
  workflow:      HseWorkflowInstance | null;
  workflowTasks: HseWorkflowTask[];
  timeline:      HseTimelineEvent[];
}

export function useHseIncidentDetail(incidentId: string) {
  return useQuery({
    queryKey: hseIncidentKeys.fullDetail(incidentId),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HseIncidentDetailData }>(
        'hse/incidents/detail', { incidentId }, { signal },
      );
      if (!res.success) throw new Error((res as { message?: string }).message ?? 'Failed to load incident detail');
      return res.data;
    },
    enabled: !!incidentId,
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
