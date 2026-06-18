/**
 * src/lib/workflow/index.ts
 *
 * Public barrel for the workflow engine. Import from '@lib/workflow'.
 */

export * from './types';
export * from './templates';
export * from './tone';
export {
  getWorkflowState, subscribeWorkflow, submitWorkflow, decide, toggleEvidence,
  emitHandoff, addAudit, clearNotifications, resetWorkflow,
} from './store';
export { useWorkflow, type UseWorkflow } from './useWorkflow';
