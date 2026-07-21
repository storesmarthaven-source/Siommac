/**
 * Placement coverage for the read receipt (not formatting — MessageStatus has
 * content tests). Proves an OUTGOING, TEXT-LESS, attachment-only message still
 * renders the sender's receipt row: the receipt lives OUTSIDE the body-bubble
 * branch, so a message with no body must not lose it.
 *
 * Minimal harness: only useMessaging is mocked (a small snapshot + no-op
 * actions) — MessagingProvider is not refactored.
 */
import { render } from '@testing-library/preact';
import { describe, it, expect, vi } from 'vitest';
import type { Attachment, Message, User } from '../../domain/models';

const me: User = { id: 'me', name: 'Me', title: '', avatarUrl: '', presence: 'offline' };

vi.mock('../../app/MessagingProvider', () => ({
  useMessaging: () => ({
    snapshot: { currentUserId: 'me', users: [me], threads: [], messages: [], activity: [] },
    actions: { download: vi.fn(), togglePin: vi.fn(), toggleReaction: vi.fn(), remove: vi.fn() },
  }),
}));

import { MessageRow } from './MessageThread';

const attachment: Attachment = {
  id: 'A1', kind: 'pdf', name: 'report.pdf', mimeType: 'application/pdf',
  sizeBytes: 2048, transferState: 'available', progress: 100,
};

// An outgoing message with NO text body, only an attachment, read by 2.
const attachmentOnly: Message = {
  id: 'M1', threadId: 'T1', authorId: 'me', body: '', html: '',
  createdAt: '2026-07-21T10:00:00.000Z',
  attachments: [attachment], reactions: [], delivery: 'sent', readByCount: 2,
  pinned: false, pinActions: [], deleted: false,
};

function renderRow(message: Message) {
  return render(
    <MessageRow
      message={message} currentUserId="me"
      onReply={vi.fn()} onPreview={vi.fn()} onActivity={vi.fn()}
      onOpenCollaboration={vi.fn()} onJump={vi.fn()}
    />,
  );
}

describe('MessageRow — receipt placement for attachment-only outgoing messages', () => {
  it('renders the sender receipt row with the read text, even with no text bubble', () => {
    const { container } = renderRow(attachmentOnly);
    // No text bubble was rendered…
    expect(container.querySelector('.sm-bubble')).toBeNull();
    // …but the receipt row IS present, outside the bubble branch.
    const receipt = container.querySelector('.sm-message__receipt');
    expect(receipt).toBeTruthy();
    expect(receipt?.textContent).toBe('Read by 2');
  });

  it('does not render the receipt row for an INCOMING attachment-only message', () => {
    const { container } = renderRow({ ...attachmentOnly, authorId: 'someone-else' });
    expect(container.querySelector('.sm-message__receipt')).toBeNull();
  });
});
