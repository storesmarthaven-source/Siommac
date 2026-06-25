// ============================================================================
// Central Workflow Engine — adapter registry (Spec §9)
// ============================================================================
// Modules register a ModuleWorkflowAdapter so the engine can call back into them
// (status sync, handoffs). Null-safe: the engine runs before adapters exist, so
// missing adapters degrade gracefully (the engine just skips the callbacks).
// ============================================================================

import type { ModuleWorkflowAdapter } from './definitionTypes';

const registry = new Map<string, ModuleWorkflowAdapter>();

export function registerWorkflowAdapter(adapter: ModuleWorkflowAdapter): void {
  registry.set(adapter.moduleKey, adapter);
}

export function getWorkflowAdapter(moduleKey: string): ModuleWorkflowAdapter | null {
  return registry.get(moduleKey) ?? null;
}
