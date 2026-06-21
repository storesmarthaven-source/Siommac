/**
 * src/lib/workflow/tone.ts
 *
 * Maps engine statuses/priorities to the app's `.vt-pill` tone classes, so every
 * workflow surface renders status chips consistently.
 *
 * These now delegate to the single source of truth in
 * `src/ui/status/statusTokens.ts` — this file is kept as the workflow-typed
 * entry point (it narrows to WorkflowStatus / Priority) so existing imports
 * keep working unchanged.
 */

import type { WorkflowStatus, Priority } from './types';
import {
  toneClass,
  toneFromWorkflowStatus,
  toneFromPriority,
  statusLabel as statusLabelShared,
} from '@ui/status/statusTokens';

/** Workflow/approval status → .vt-pill variant. */
export function statusPill(status: WorkflowStatus): string {
  return toneClass(toneFromWorkflowStatus(status));
}

/** Priority → .vt-pill variant. */
export function priorityPill(p: Priority): string {
  return toneClass(toneFromPriority(p));
}

/** Human label for a status. */
export function statusLabel(status: WorkflowStatus): string {
  return statusLabelShared(status);
}
