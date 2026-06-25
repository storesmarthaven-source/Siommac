// ============================================================================
// Central Workflow Engine — condition evaluator (Spec §5)
// ============================================================================
// Evaluates a binding/step/handoff/transition condition set against a context
// object (e.g. { recordData, workflow }). ALL conditions must pass (AND).
// ============================================================================

import type { WorkflowCondition } from './definitionTypes';

export function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || value === undefined) return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

export function evaluateWorkflowConditions(
  conditions: WorkflowCondition[] = [],
  context: Record<string, unknown>,
): boolean {
  return conditions.every((condition) => {
    const actual = getPathValue(context, condition.field);
    const expected = condition.value;

    switch (condition.operator) {
      case 'equals':                 return actual === expected;
      case 'not_equals':             return actual !== expected;
      case 'in':                     return Array.isArray(expected) && expected.includes(actual);
      case 'not_in':                 return Array.isArray(expected) && !expected.includes(actual);
      case 'greater_than':           return Number(actual) > Number(expected);
      case 'greater_than_or_equal':  return Number(actual) >= Number(expected);
      case 'less_than':              return Number(actual) < Number(expected);
      case 'less_than_or_equal':     return Number(actual) <= Number(expected);
      case 'exists':                 return actual !== undefined && actual !== null;
      case 'not_exists':             return actual === undefined || actual === null;
      case 'contains':               return Array.isArray(actual) && actual.includes(expected);
      case 'date_before':            return new Date(String(actual)) < new Date(String(expected));
      case 'date_after':             return new Date(String(actual)) > new Date(String(expected));
      default:                       return false;
    }
  });
}
