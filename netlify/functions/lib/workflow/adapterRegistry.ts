// ============================================================================
// Central Workflow Engine — adapter registry (Spec §9)
// ============================================================================
// Modules register a ModuleWorkflowAdapter so the engine can call back into them
// (status sync, handoffs). Null-safe: the engine runs before adapters exist, so
// missing adapters degrade gracefully (the engine just skips the callbacks).
//
// Keying: when an adapter declares a workflowType the registry stores it under
// the compound key `moduleKey:workflowType`.  getWorkflowAdapter(moduleKey, wfType)
// prefers the specific match, then falls back to the bare `moduleKey` entry.
// This lets multiple workflow types share the same moduleKey without collision
// (e.g. finance_payroll has both nis_profile_verification and payroll_approval).
// ============================================================================

import type { ModuleWorkflowAdapter } from './definitionTypes';

const registry = new Map<string, ModuleWorkflowAdapter>();

export function registerWorkflowAdapter(adapter: ModuleWorkflowAdapter): void {
  if (adapter.workflowType) {
    // Specific entry — takes priority for callers that pass the workflow type.
    registry.set(`${adapter.moduleKey}:${adapter.workflowType}`, adapter);
  } else {
    // Fallback entry (legacy adapters with no workflowType).
    registry.set(adapter.moduleKey, adapter);
  }
}

export function getWorkflowAdapter(
  moduleKey: string,
  workflowType?: string | null,
): ModuleWorkflowAdapter | null {
  if (workflowType) {
    const specific = registry.get(`${moduleKey}:${workflowType}`);
    if (specific) return specific;
  }
  return registry.get(moduleKey) ?? null;
}
