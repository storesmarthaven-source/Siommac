// ============================================================================
// Central Workflow Engine — template definition validator (Spec §10.1 step 6)
// ============================================================================
// Structural validation run before a template version is published and before a
// workflow starts. Throws with all errors joined; returns true when valid.
// ============================================================================

import type { WorkflowTemplateDefinition } from './definitionTypes';

export function validateWorkflowDefinition(def: WorkflowTemplateDefinition): true {
  const errors: string[] = [];

  if (def.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (!Array.isArray(def.steps) || def.steps.length === 0) errors.push('A workflow must have at least one step.');

  const stepKeys = new Set<string>();
  for (const step of def.steps ?? []) {
    if (!step.stepKey) { errors.push('Every step needs a stepKey.'); continue; }
    if (stepKeys.has(step.stepKey)) errors.push(`Duplicate stepKey: ${step.stepKey}.`);
    stepKeys.add(step.stepKey);
    if (!step.stepName) errors.push(`${step.stepKey}: stepName is required.`);
    if (typeof step.sequenceNo !== 'number') errors.push(`${step.stepKey}: sequenceNo must be a number.`);
    if (!step.assignment?.type) errors.push(`${step.stepKey}: assignment.type is required.`);
    if (step.assignment?.type === 'fixed_user' && !step.assignment.value) errors.push(`${step.stepKey}: fixed_user assignment needs a value.`);
    if (step.assignment?.type === 'role' && !step.assignment.value) errors.push(`${step.stepKey}: role assignment needs a value.`);
    if (step.assignment?.type === 'dynamic_field' && !step.assignment.dynamicField) errors.push(`${step.stepKey}: dynamic_field assignment needs a dynamicField.`);
  }

  // Transitions must reference real steps.
  for (const t of def.transitions ?? []) {
    if (!stepKeys.has(t.fromStep)) errors.push(`Transition fromStep "${t.fromStep}" is not a defined step.`);
    if (t.toStep && !stepKeys.has(t.toStep)) errors.push(`Transition toStep "${t.toStep}" is not a defined step.`);
    if (!t.toStep && !t.completeWorkflow) errors.push(`Transition from "${t.fromStep}" must set toStep or completeWorkflow.`);
  }

  // Notification rules with workflow_required+ criticality must not be mutable.
  for (const n of def.notifications ?? []) {
    const locked = ['workflow_required', 'safety_critical', 'compliance_required', 'emergency'].includes(n.criticality);
    if (locked && n.canBeMuted) errors.push(`Notification "${n.event}" is ${n.criticality} and cannot be mutable (canBeMuted must be false).`);
  }

  if (!def.settings) errors.push('settings block is required.');

  if (errors.length) throw new Error(errors.join('\n'));
  return true;
}
