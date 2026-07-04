/**
 * src/components/common/actions/actionModalValidation.ts
 *
 * Reason validation for the ActionModal. Confirm stays blocked until a required
 * reason is provided.
 */

import type { ActionModalConfig } from './actionModalTypes';

/** Returns an error string when the reason is required but empty, else null. */
export function validateReason(config: ActionModalConfig, reason: string): string | null {
  if (!config.reason?.required) return null;
  return reason.trim().length === 0 ? `${config.reason.label ?? 'A reason'} is required.` : null;
}

/** Whether the confirm button should be enabled for the current reason value. */
export function canConfirm(config: ActionModalConfig, reason: string): boolean {
  return validateReason(config, reason) === null;
}
