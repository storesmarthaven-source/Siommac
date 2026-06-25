// ============================================================================
// HSE module workflow adapters (Spec §8/§9)
// ============================================================================
// The central engine owns the approval/process lifecycle; each module owns its
// record. A registered ModuleWorkflowAdapter is how the engine syncs workflow
// lifecycle events back into the source record's status — using the definition's
// `sourceStatusMap`. The engine never hardcodes a module table; the adapter does
// (module_key → source table).
//
// MILESTONE 1: only modules that have NO separate approval state machine get an
// adapter (incidents, capa) — so there is exactly one status authority and no
// dual-authority drift. The risk-jsa adapters (hazards/assessments/jsa) land in
// Milestone 2, together with retiring `transitionEntity` as an approval
// authority (it currently approves/returns records outside the engine).
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
  registerWorkflowAdapter(makeStatusSyncAdapter('hse_incidents', 'hse_incidents'));
  registerWorkflowAdapter(makeStatusSyncAdapter('hse_capa',      'hse_capa_actions'));
}
