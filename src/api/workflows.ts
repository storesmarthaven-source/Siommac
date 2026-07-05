/**
 * src/api/workflows.ts
 *
 * TanStack Query hooks for the platform workflow backbone and handoff outbox.
 * All routes: POST /api/workflows/* and POST /api/handoffs/*
 * No direct Supabase reads — backend scopes all queries to the JWT actor.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryFunctionContext,
} from '@tanstack/preact-query';
import { apiPost }               from '@lib/api';
import {
  workflowKeys,
  handoffKeys,
  communicationKeys,
} from './queryKeys';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkflowInstance {
  id:                 string;
  ref:                string;
  template_id:        string;
  source_module:      string;
  source_entity_type: string;
  source_entity_id:   string;
  status:             string;
  priority:           string;
  current_step:       string;
  owner_user_id:      string | null;
  due_at:             string | null;
  created_at:         string;
}

export interface WorkflowTask {
  id:                  string;
  workflow_id:         string;
  step_key:            string;
  task_type:           string;
  assigned_role:       string | null;
  assigned_user_id:    string | null;
  assigned_department_id: string | null;
  status:              string;
  due_at:              string | null;
  completed_by:        string | null;
  decision:            string | null;
  decision_note:       string | null;
  created_at:          string;
  completed_at:        string | null;
  workflow_instances?: {
    ref:                string;
    source_module:      string;
    source_entity_type: string;
    source_entity_id:   string;
    priority:           string;
  };
}

export interface WorkflowEvent {
  id:            string;
  workflow_id:   string;
  event_type:    string;
  actor_user_id: string | null;
  note:          string | null;
  payload:       Record<string, unknown>;
  created_at:    string;
}

export interface WorkflowDetail {
  workflow: WorkflowInstance;
  tasks:    WorkflowTask[];
  events:   WorkflowEvent[];
}

export interface HandoffRow {
  id:                 string;
  source_module:      string;
  target_module:      string;
  source_entity_type: string;
  source_entity_id:   string;
  status:             string;
  attempts:           number;
  error:              string | null;
  created_at:         string;
  processed_at:       string | null;
}

// ── List filters ──────────────────────────────────────────────────────────────

export interface WorkflowListFilters extends Record<string, unknown> {
  status?:       string;
  module?:       string | string[];
  assignedToMe?: boolean;
  limit?:        number;
}

export interface HandoffListFilters extends Record<string, unknown> {
  status?:       string;
  targetModule?: string;
  sourceModule?: string;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function useWorkflowList(filters: WorkflowListFilters = {}) {
  return useQuery({
    queryKey: workflowKeys.list(filters),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: WorkflowInstance[] }>(
        'workflows/list',
        { limit: 50, ...filters },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load workflows');
      return res.data;
    },
  });
}

export function useWorkflow(workflowId: string) {
  return useQuery({
    queryKey: workflowKeys.detail(workflowId),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: WorkflowDetail }>(
        'workflows/get',
        { workflowId },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load workflow');
      return res.data;
    },
    enabled: !!workflowId,
  });
}

export function useMyWorkflowTasks() {
  return useQuery({
    queryKey: workflowKeys.tasks(),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: WorkflowTask[] }>(
        'workflows/tasks',
        {},
        { signal },
      );
      if (!res.success) throw new Error('Failed to load workflow tasks');
      return res.data;
    },
  });
}

export function useHandoffList(filters: HandoffListFilters = {}) {
  return useQuery({
    queryKey: handoffKeys.list(filters),
    queryFn:  async ({ signal }: QueryFunctionContext) => {
      const res = await apiPost<{ success: boolean; data: HandoffRow[] }>(
        'handoffs/list',
        { limit: 50, ...filters },
        { signal },
      );
      if (!res.success) throw new Error('Failed to load handoffs');
      return res.data;
    },
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface CreateWorkflowArgs extends Record<string, unknown> {
  templateKey:      string;
  sourceModule:     string;
  sourceEntityType: string;
  sourceEntityId:   string;
  priority?:        'low' | 'medium' | 'high' | 'critical';
  reason?:          string;
  ownerUserId?:     string | null;
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: CreateWorkflowArgs) =>
      apiPost<{ success: boolean; workflowId: string; ref: string }>(
        'workflows/create', args, { retryable: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      qc.invalidateQueries({ queryKey: workflowKeys.tasks() });
    },
  });
}

export interface DecideWorkflowTaskArgs extends Record<string, unknown> {
  taskId:   string;
  decision: 'approved' | 'rejected' | 'returned' | 'verified' | 'completed';
  note?:    string;
}

export function useDecideWorkflowTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: DecideWorkflowTaskArgs) =>
      apiPost<{ success: boolean; workflowId: string; status: string }>(
        'workflows/decision', args, { retryable: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.tasks() });
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      qc.invalidateQueries({ queryKey: communicationKeys.summary() });
    },
  });
}

export function useRetryHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (handoffId: string) =>
      apiPost<{ success: boolean }>(
        'handoffs/retry', { handoffId }, { retryable: false },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: handoffKeys.all });
    },
  });
}
