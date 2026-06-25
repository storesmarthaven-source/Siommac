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
  phone:              string | null;
  employee_number:    string | null;
  start_date:         string | null;
  end_date:           string | null;
  contractor_flag:    boolean | null;
  profile_image_url:  string | null;
  departmentName:     string | null;
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
      return res.data;
    },
  });
}

export function useHrEmployee(employeeId: string | null) {
  return useQuery({
    queryKey: hrEmployeeKeys.detail(employeeId ?? ''),
    enabled:  !!employeeId,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HrEmployeeDetail }>('hr/employees/get', { employeeId }, { signal });
      return res.data;
    },
  });
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

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface CreateHrEmployeeArgs {
  identity:   { username: string; password: string; fullName: string; firstName?: string; lastName?: string; email?: string; personalEmail?: string; phone?: string; employeeNumber?: string };
  employment?: { employmentType?: string; contractorFlag?: boolean; startDate?: string; position?: string };
  assignment?: { departmentId?: string | null; siteId?: string | null; positionId?: string | null; supervisorId?: string | null };
  access?:     { role?: string };
  statutory?:  Record<string, unknown>;
}

export function useCreateHrEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateHrEmployeeArgs) =>
      apiPost<{ success: boolean; data: { employee_id: string; employee_no: string; status: string; payroll_readiness: PayrollReadinessStatus; onboarding_case_id: string | null; workflow_id: string | null } }>('hr/employees/create', args as unknown as Record<string, unknown>),
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
