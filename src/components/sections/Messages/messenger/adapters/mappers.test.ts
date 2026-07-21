import { describe, expect, it } from 'vitest';
import type { MessageThread, MessagePost } from '../../../../../../types/messaging';
import { mapThread, mapPost } from './mappers';

function thread(overrides: Partial<MessageThread> = {}): MessageThread {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    threadType: 'group',
    subject: 'Payroll close',
    sourceModule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    createdBy: 'USR-1',
    createdAt: '2026-07-20T10:00:00.000Z',
    lastPostAt: '2026-07-20T11:00:00.000Z',
    lastPostPreview: 'Please review the final register',
    lastPostBy: 'USR-1',
    unreadCount: 2,
    participantCount: 1,
    participants: [{
      userId: 'USR-1',
      displayName: 'Payroll Admin',
      email: 'payroll@example.test',
      role: 'owner',
    }],
    isArchived: false,
    myRole: 'owner',
    ...overrides,
  };
}

function post(overrides: Partial<MessagePost> = {}): MessagePost {
  return {
    id:              'POST-1',
    threadId:        '00000000-0000-4000-8000-000000000001',
    authorUserId:    'USR-1',
    authorName:      'Payroll Admin',
    authorEmail:     'payroll@example.test',
    body:            'ordinary message body',
    isSystem:        false,
    attachmentCount: 0,
    editedAt:        null,
    deletedAt:       null,
    createdAt:       '2026-07-20T11:00:00.000Z',
    attachments:     [],
    postType:        'message',
    ...overrides,
  };
}

describe('mapPost — internal notes are author-only, affordance-free', () => {
  it('sets isInternal and strips every interactive affordance', () => {
    const m = mapPost(post({
      id: 'NOTE-1',
      isInternal: true,
      // Even if the backend ever leaked these, the mapper must not surface them.
      allowedPinActions: ['pin'],
      reactions: [{ emoji: '👍', userIds: ['USR-2'] }],
      isPinned: false,
    }));
    expect(m.isInternal).toBe(true);
    expect(m.pinActions).toEqual([]);        // no pin/unpin command on a note
    expect(m.attachments).toEqual([]);       // text-only
  });

  it('leaves ordinary messages untouched (isInternal absent, pin command present)', () => {
    const m = mapPost(post());
    expect(m.isInternal).toBeUndefined();
    expect(m.pinActions).toEqual(['pin']);   // default pin command for an unpinned post
  });
});

describe('mapThread list summaries', () => {
  it('keeps the server preview before message history is loaded', () => {
    expect(mapThread(thread(), 'USR-1').lastMessagePreview)
      .toBe('Please review the final register');
  });

  it('uses authoritative authoredByMe from the canonical list row', () => {
    expect(mapThread(thread({ authoredByMe: true }), 'USR-1', false).authoredByMe).toBe(true);
    expect(mapThread(thread({ authoredByMe: false }), 'USR-1', true).authoredByMe).toBe(false);
  });
});
