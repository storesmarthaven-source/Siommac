/**
 * src/components/common/actions/actionModalPresets.ts
 *
 * Builders for the common lifecycle actions, so every reject/cancel/archive/verify/
 * lock/reopen/retire dialog is consistent. Each takes the affected record (+ options)
 * and returns an ActionModalConfig for openActionModal().
 */

import type { ActionModalConfig, ActionRecord } from './actionModalTypes';

interface Base { record: ActionRecord; title?: string; subtitle?: string; whatNext?: string[] }

export function rejectAction({ record, title, subtitle, whatNext, noun = 'item' }: Base & { noun?: string }): ActionModalConfig {
  return {
    title: title ?? `Reject ${noun}`,
    subtitle, icon: 'fa-ban', tone: 'danger', record,
    warning: `Rejecting returns this ${noun} to the requester / draft.`,
    reason: { required: true, label: 'Reason for rejection', type: 'textarea', placeholder: 'Explain why this is being rejected…' },
    whatNext, confirmLabel: 'Reject', cancelLabel: 'Keep',
  };
}

export function cancelAction({ record, title, subtitle, whatNext, noun = 'record', reasonRequired = true }: Base & { noun?: string; reasonRequired?: boolean }): ActionModalConfig {
  return {
    title: title ?? `Cancel ${noun}`,
    subtitle, icon: 'fa-xmark', tone: 'danger', record,
    warning: `Cancelling this ${noun} cannot be undone.`,
    reason: { required: reasonRequired, label: 'Reason for cancelling', type: 'textarea', placeholder: 'Why is this being cancelled?' },
    whatNext, confirmLabel: 'Cancel it', cancelLabel: 'Keep',
  };
}

export function archiveAction({ record, title, subtitle, whatNext, noun = 'record' }: Base & { noun?: string }): ActionModalConfig {
  return {
    title: title ?? `Archive ${noun}`,
    subtitle, icon: 'fa-box-archive', tone: 'warning', record,
    warning: `Archiving hides this ${noun} from the active register. It can be restored by an admin.`,
    whatNext, confirmLabel: 'Archive', cancelLabel: 'Cancel',
  };
}

export function verifyAction({ record, title, subtitle, whatNext, noun = 'record', note = true }: Base & { noun?: string; note?: boolean }): ActionModalConfig {
  return {
    title: title ?? `Verify ${noun}`,
    subtitle, icon: 'fa-circle-check', tone: 'success', record,
    reason: note ? { required: false, label: 'Verification note', type: 'text', placeholder: 'Optional note' } : undefined,
    whatNext, confirmLabel: 'Verify', cancelLabel: 'Cancel',
  };
}

export function lockAction({ record, title, subtitle, whatNext, noun = 'record' }: Base & { noun?: string }): ActionModalConfig {
  return {
    title: title ?? `Lock ${noun}`,
    subtitle, icon: 'fa-lock', tone: 'warning', record,
    warning: `Locking makes the figures immutable. Reopening later clears calculated results.`,
    whatNext, confirmLabel: 'Lock', cancelLabel: 'Cancel',
  };
}

export function reopenAction({ record, title, subtitle, whatNext, noun = 'record' }: Base & { noun?: string }): ActionModalConfig {
  return {
    title: title ?? `Reopen ${noun}`,
    subtitle, icon: 'fa-lock-open', tone: 'warning', record,
    warning: `Reopening returns this ${noun} to an editable state and may clear derived data.`,
    reason: { required: false, label: 'Reason for reopening', type: 'text', placeholder: 'Optional reason' },
    whatNext, confirmLabel: 'Reopen', cancelLabel: 'Cancel',
  };
}

export function retireAction({ record, title, subtitle, whatNext, noun = 'record' }: Base & { noun?: string }): ActionModalConfig {
  return {
    title: title ?? `Retire ${noun}`,
    subtitle, icon: 'fa-power-off', tone: 'danger', record,
    warning: `Retiring stops this ${noun} from being used on new records. Existing usage is unaffected.`,
    whatNext, confirmLabel: 'Retire', cancelLabel: 'Cancel',
  };
}
