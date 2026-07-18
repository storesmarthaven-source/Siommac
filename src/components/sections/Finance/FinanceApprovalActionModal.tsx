/**
 * src/components/sections/Finance/FinanceApprovalActionModal.tsx
 *
 * Chunk 11 — Imperative action-modal wrapper for inline approve/reject from the
 * Finance approvals inbox. Uses `openActionModal` (the shared ActionModal system).
 * Called by FinanceApprovalsInbox; result drives useActOnApproval mutation.
 *
 * Only exports the two helper functions — callers get a result and handle the
 * mutation themselves (no component to render; ActionModalHost already mounted
 * in AppShell).
 */

import { openActionModal } from '@components/common/actions';
import type { ActionModalResult } from '@components/common/actions';
import type { ApprovalsQueueItemV2 } from '@api/finance/overview';
import { money } from './hrfinFormat';

export async function openApproveModal(item: ApprovalsQueueItemV2): Promise<ActionModalResult> {
  return openActionModal({
    title: `Approve ${item.type}`,
    subtitle: `${item.ref} — ${item.party}`,
    icon: 'fa-check-circle',
    tone: 'success',
    record: {
      title: item.ref,
      subtitle: item.party,
      badges: [{ label: item.type, tone: 'default' }],
      fields: [
        { label: 'Amount',    value: money(item.amount) },
        { label: 'Age',       value: `${item.ageDays}d` },
        { label: 'Submitted by', value: item.requestedBy ?? '—' },
      ],
    },
    whatNext: [
      'The record will be marked approved.',
      'The submitter will receive a notification.',
      'Finance data will be refreshed.',
    ],
    confirmLabel: 'Approve',
    cancelLabel:  'Cancel',
  });
}

export async function openRejectModal(item: ApprovalsQueueItemV2): Promise<ActionModalResult> {
  return openActionModal({
    title: `Reject ${item.type}`,
    subtitle: `${item.ref} — ${item.party}`,
    icon: 'fa-times-circle',
    tone: 'danger',
    record: {
      title: item.ref,
      subtitle: item.party,
      badges: [{ label: item.type, tone: 'default' }],
      fields: [
        { label: 'Amount',    value: money(item.amount) },
        { label: 'Age',       value: `${item.ageDays}d` },
        { label: 'Submitted by', value: item.requestedBy ?? '—' },
      ],
    },
    warning: 'The submitter will be notified of the rejection.',
    reason: {
      label:       'Rejection reason',
      required:    true,
      placeholder: 'Explain why this is being rejected…',
      type:        'textarea',
    },
    whatNext: [
      'The record will be marked rejected.',
      'The submitter will receive a notification with your reason.',
    ],
    confirmLabel: 'Reject',
    cancelLabel:  'Cancel',
  });
}
