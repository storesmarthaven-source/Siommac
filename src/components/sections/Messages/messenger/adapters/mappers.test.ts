import { describe, expect, it } from 'vitest';
import type { MessageThread } from '../../../../../../types/messaging';
import { mapThread } from './mappers';

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
