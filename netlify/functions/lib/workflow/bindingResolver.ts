// ============================================================================
// Central Workflow Engine — binding resolver (Spec §6)
// ============================================================================
// Chooses which workflow template+version a module event uses. Resolution:
// match module_key + workflow_type + trigger_event + active, then scope match,
// then conditions, then most-specific scope (site→dept→role→global), then lowest
// priority number. Returns null when nothing matches (caller decides fallback).
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModuleWorkflowContext } from './definitionTypes';
import { evaluateWorkflowConditions } from './conditionEvaluator';

export interface WorkflowBindingRow {
  id: string;
  module_key: string;
  workflow_type: string;
  trigger_event: string;
  template_id: string;
  template_version_id: string | null;
  scope_type: 'global' | 'site' | 'department' | 'role';
  scope_id: string | null;
  priority: number;
  conditions: { conditions?: unknown[] } | null;
  is_active: boolean;
}

export function scopeRank(scopeType: string): number {
  const order: Record<string, number> = { site: 1, department: 2, role: 3, global: 4 };
  return order[scopeType] ?? 99;
}

export function scopeMatches(binding: WorkflowBindingRow, context: ModuleWorkflowContext): boolean {
  switch (binding.scope_type) {
    case 'global':     return true;
    case 'site':       return !!context.siteId && binding.scope_id === context.siteId;
    case 'department': return !!context.departmentId && binding.scope_id === context.departmentId;
    case 'role':       return !!binding.scope_id && (context.actorRoleIds ?? []).includes(binding.scope_id);
    default:           return false;
  }
}

/** Pure selection over already-fetched candidate bindings — unit-testable. */
export function pickBinding(bindings: WorkflowBindingRow[], context: ModuleWorkflowContext): WorkflowBindingRow | null {
  const candidates = (bindings ?? []).filter((b) => {
    if (!b.is_active) return false;
    if (!scopeMatches(b, context)) return false;
    const conds = (b.conditions?.conditions ?? []) as Parameters<typeof evaluateWorkflowConditions>[0];
    return evaluateWorkflowConditions(conds, { ...context, recordData: context.recordData });
  });
  candidates.sort((a, b) => {
    const s = scopeRank(a.scope_type) - scopeRank(b.scope_type);
    return s !== 0 ? s : a.priority - b.priority;
  });
  return candidates[0] ?? null;
}

export async function selectWorkflowBinding(client: SupabaseClient, context: ModuleWorkflowContext): Promise<WorkflowBindingRow | null> {
  const { data, error } = await client
    .from('module_workflow_bindings')
    .select('*')
    .eq('module_key', context.moduleKey)
    .eq('workflow_type', context.workflowType)
    .eq('trigger_event', context.triggerEvent)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (error) throw new Error(`binding lookup failed: ${error.message}`);
  return pickBinding((data ?? []) as WorkflowBindingRow[], context);
}
