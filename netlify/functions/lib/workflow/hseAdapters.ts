// ============================================================================
// HSE module workflow adapters (Spec §8/§9)
// ============================================================================
// The central engine owns the approval/process lifecycle; each module owns its
// record. A registered ModuleWorkflowAdapter is how the engine syncs workflow
// lifecycle events back into the source record's status — using the definition's
// `sourceStatusMap`. The engine never hardcodes a module table; the adapter does
// (module_key → source table).
//
// One status authority per module: a module either drives its own status OR has
// an adapter, never both. incidents/capa: no separate approval route → adapter.
// risk-jsa (M2b): approve/reject/request-changes route through the engine
// (decideTask), so transitionEntity no longer approves records outside the
// engine; these adapters sync the decision back. transitionEntity remains only
// for non-approval lifecycle (activate/close/archive).
// ============================================================================

import { sb } from '../db';
import { registerWorkflowAdapter } from './adapterRegistry';
import type { ModuleWorkflowAdapter, ModuleWorkflowContext, WorkflowSourceStatusMap, WorkflowTemplateDefinition } from './definitionTypes';

/** Build a status-sync adapter: on each lifecycle event, apply definition.sourceStatusMap[event] to the source table. */
function makeStatusSyncAdapter(moduleKey: string, table: string): ModuleWorkflowAdapter {
  const apply = async (workflowId: string, sourceRecordId: string, key: keyof WorkflowSourceStatusMap): Promise<void> => {
    const { data: wf } = await sb.from('workflow_instances')
      .select('template_snapshot')
      .eq('id', workflowId)
      .maybeSingle<{ template_snapshot: WorkflowTemplateDefinition }>();
    const status = wf?.template_snapshot?.sourceStatusMap?.[key];
    if (!status) return;                                   // no mapping for this event → leave the record alone
    await sb.from(table).update({ status, updated_at: new Date().toISOString() }).eq('id', sourceRecordId);
  };

  return {
    moduleKey,
    async buildWorkflowContext(): Promise<ModuleWorkflowContext> {
      throw new Error(`${moduleKey}: workflow context is built at the call site, not via the adapter.`);
    },
    onWorkflowStarted:       ({ workflowId, sourceRecordId }) => apply(workflowId, sourceRecordId, 'onStarted'),
    onWorkflowStepCompleted: async () => {},
    onWorkflowCompleted:     ({ workflowId, sourceRecordId }) => apply(workflowId, sourceRecordId, 'onCompleted'),
    onWorkflowReturned:      ({ workflowId, sourceRecordId }) => apply(workflowId, sourceRecordId, 'onReturned'),
    onWorkflowRejected:      ({ workflowId, sourceRecordId }) => apply(workflowId, sourceRecordId, 'onRejected'),
    onWorkflowCancelled:     ({ workflowId, sourceRecordId }) => apply(workflowId, sourceRecordId, 'onCancelled'),
  };
}

export function registerHseWorkflowAdapters(): void {
  registerWorkflowAdapter(makeStatusSyncAdapter('hse_incidents',        'hse_incidents'));
  registerWorkflowAdapter(makeStatusSyncAdapter('hse_capa',             'hse_capa_actions'));
  // M2b: risk-jsa approvals are engine-driven (approve/reject/return route through
  // decideTask); these adapters sync the decision back to the source record.
  registerWorkflowAdapter(makeStatusSyncAdapter('hse_hazards',          'hse_hazards'));
  registerWorkflowAdapter(makeStatusSyncAdapter('hse_risk_assessments', 'hse_risk_assessments'));
  registerWorkflowAdapter(makeStatusSyncAdapter('hse_jsa',              'hse_jsa'));
}
