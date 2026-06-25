// ============================================================================
// Central Workflow Engine — step assignee resolver (Spec §11)
// ============================================================================
// Resolves a step's assignee from the workflow context. Common resolver types
// are handled here; module-specific dynamic fields read from recordData. Returns
// { userId? , roleKey? }; an empty result means the caller must apply the
// unresolved-assignee policy (block / assign module admin / escalate).
// ============================================================================

import type { ModuleWorkflowContext, WorkflowStepDefinition } from './definitionTypes';
import { getPathValue } from './conditionEvaluator';

export interface ResolvedAssignee { userId?: string; roleKey?: string }

export function resolveStepAssignee(step: WorkflowStepDefinition, context: ModuleWorkflowContext): ResolvedAssignee {
  const rd = context.recordData;
  const str = (v: unknown): string | undefined => {
    const s = v == null ? '' : String(v);
    return s.length ? s : undefined;
  };

  switch (step.assignment.type) {
    case 'fixed_user':         return { userId: step.assignment.value };
    case 'role':               return { roleKey: step.assignment.value };
    case 'supervisor':         return { userId: str(rd['supervisorId']) };
    case 'department_manager': return { userId: str(rd['departmentManagerId']) };
    case 'site_manager':       return { userId: str(rd['siteManagerId']) };
    case 'hse_manager':        return { userId: str(rd['hseManagerId']) };
    case 'document_owner':     return { userId: str(rd['ownerId']) };
    case 'permit_area_owner':  return { userId: str(rd['areaOwnerId']) };
    case 'record_owner':       return { userId: context.ownerId ?? undefined };
    case 'requester_manager':  return { userId: str(rd['requesterManagerId']) };
    case 'dynamic_field':      return { userId: str(getPathValue(context as unknown as Record<string, unknown>, step.assignment.dynamicField ?? '')) };
    default:                   return {};
  }
}
