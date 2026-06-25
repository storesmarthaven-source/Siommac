/**
 * src/components/sections/Messages/DiscussionButton.tsx
 *
 * Reusable "Discussion" deep-link for any business record (PTW permit, incident,
 * CAPA, …). Find-or-creates the record-linked message thread (joining the caller),
 * then navigates to the Message Center and opens it.
 *
 * Access: the backend requires communications.thread_create AND view access to
 * the record, so this button is safe to render on any record a user can already
 * see. Record discussions are collaborative for authorized record-viewers; the
 * compliance gate continues to protect private (non-record) threads.
 *
 * Usage:
 *   <DiscussionButton module="hse" entityType="permit" entityId={permit.id} recordRef={permit.ref} />
 */

import type { VNode } from 'preact';
import { showSection } from '@components/nav/navCore';
import { useResolveRecordThread } from '@api/communications';

export function DiscussionButton({ module, entityType, entityId, recordRef, subject, label = 'Discussion', variant = 'ghost' }: {
  module:     string;
  entityType: string;
  entityId:   string;
  recordRef?: string | null;
  subject?:   string | null;
  label?:     string;
  variant?:   'ghost' | 'primary';
}): VNode {
  const resolve = useResolveRecordThread();

  function open() {
    resolve.mutate(
      { sourceModule: module, sourceEntityType: entityType, sourceEntityId: entityId, recordRef: recordRef ?? null, subject: subject ?? null },
      {
        onSuccess: (raw: unknown) => {
          const res = raw as { success: boolean; data?: { threadId: string } };
          if (!res.success || !res.data?.threadId) return;
          const threadId = res.data.threadId;
          showSection('s-messages');
          // Let the thread list refetch (the caller was just joined) before selecting.
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('siomac:openThread', { detail: { threadId } }));
          }, 350);
        },
      },
    );
  }

  return (
    <button
      class={variant === 'primary' ? 'hse-btn primary' : 'hse-btn'}
      onClick={open}
      disabled={resolve.isPending}
      title="Open the discussion thread for this record">
      <i class={`fas ${resolve.isPending ? 'fa-spinner fa-spin' : 'fa-comments'}`} /> {label}
    </button>
  );
}
