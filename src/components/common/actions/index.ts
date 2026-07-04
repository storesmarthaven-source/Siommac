/**
 * src/components/common/actions/index.ts — public surface of the ActionModal system.
 */
export { ActionModal } from './ActionModal';
export { ActionModalHost, openActionModal } from './ActionModalProvider';
export { validateReason, canConfirm } from './actionModalValidation';
export { toActionRecord, statusBadge } from './actionModalAdapters';
export {
  rejectAction, cancelAction, archiveAction, verifyAction, lockAction, reopenAction, retireAction,
} from './actionModalPresets';
export type {
  ActionTone, ActionRecordField, ActionRecordBadge, ActionRecord,
  ActionReasonConfig, ActionModalConfig, ActionModalResult,
} from './actionModalTypes';
