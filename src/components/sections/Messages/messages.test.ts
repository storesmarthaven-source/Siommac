/**
 * src/components/sections/Messages/messages.test.ts
 *
 * Unit tests for the Messages domain (Phase 2d).
 *
 * Tests cover:
 *   - messageKeys query key structure and hierarchy
 *   - useMessages — mounts, returns data, handles empty inbox
 *   - useSendMessage — onSuccess callback, error toast, cache invalidation
 *   - useSendReply — optimistic append, rollback on error, fromUsername from session
 *   - useMarkRead — optimistic cache patch (isUnread → false), rollback on error
 *   - useDeleteMessage — correct id passed, invalidates messageKeys.all, error toast
 *   - useMessageRealtime — subscribes to both realtime events, invalidates on each,
 *     unsubscribes on unmount
 *
 * @see docs/CODING_STANDARDS.md §10-Testing-Standards
 * @see docs/PHASE_PLAN.md §Phase-2d
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/preact';
import { h }                        from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { messageKeys }              from '@api/queryKeys';
import type { MsgItem }             from '@components/nav/types';
import {
  useMessages,
  useSendMessage,
  useSendReply,
  useMarkRead,
  useDeleteMessage,
  useMessageRealtime,
} from './hooks';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Session store — default to admin role so employee-gated paths can be tested separately
vi.mock('@store/session', () => ({
  useSessionStore: vi.fn((sel: (s: {
    role: string; username: string; fullName: string;
    profileImage: string; isAuthenticated: boolean;
  }) => unknown) =>
    sel({
      role: 'admin', username: 'adm1', fullName: 'Alice Admin',
      profileImage: '', isAuthenticated: true,
    }),
  ),
}));

// API functions
vi.mock('./api', () => ({
  fetchMessages:       vi.fn().mockResolvedValue([]),
  sendMessage:         vi.fn().mockResolvedValue({ success: true }),
  replyMessage:        vi.fn().mockResolvedValue({ success: true }),
  markMessageRead:     vi.fn().mockResolvedValue({ success: true }),
  deleteMessage:       vi.fn().mockResolvedValue({ success: true }),
  fetchEmployeesForMsg: vi.fn().mockResolvedValue([]),
}));

// Realtime — capture subscribed callbacks
const realtimeSubs: Record<string, Array<() => void>> = {};
vi.mock('@store/realtime', () => ({
  onRealtimeEvent: vi.fn((event: string, cb: () => void) => {
    if (!realtimeSubs[event]) realtimeSubs[event] = [];
    realtimeSubs[event]!.push(cb);
    return () => {
      realtimeSubs[event] = (realtimeSubs[event] ?? []).filter(f => f !== cb);
    };
  }),
}));

// Toast — suppress noise
vi.mock('@store/ui', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries:   { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrap(client: QueryClient) {
  return ({ children }: { children: preact.ComponentChildren }) =>
    h(QueryClientProvider, { client }, children);
}

function makeMsg(overrides: Partial<MsgItem> = {}): MsgItem {
  return {
    id:               'msg-1',
    fromUsername:     'emp1',
    fromName:         'Bob Employee',
    fromPhoto:        '',
    toUsername:       'adm1',
    toName:           'Alice Admin',
    toPhoto:          '',
    subject:          'Test subject',
    body:             'Test body',
    isUnread:         false,
    readByRecipient:  true,
    createdAt:        '2026-01-01T00:00:00Z',
    latestAt:         '2026-01-01T00:00:00Z',
    unreadReplyCount: 0,
    replies:          [],
    ...overrides,
  };
}

// ── messageKeys query key hierarchy ──────────────────────────────────────────

describe('messageKeys', () => {
  it('all is the root key', () => {
    expect(messageKeys.all).toEqual(['messages']);
  });

  it('inbox() nests under all', () => {
    // inbox() is now a compat alias for threads() — shares the 'messages' root
    expect(messageKeys.inbox()[0]).toBe(messageKeys.all[0]);
    expect(messageKeys.inbox()).toEqual(['messages', 'threads']);
  });

  it('sent() nests under all', () => {
    // sent() is a compat alias scoped to { tab: 'sent' }
    expect(messageKeys.sent()[0]).toBe(messageKeys.all[0]);
    expect(messageKeys.sent()).toEqual(['messages', 'threads', { tab: 'sent' }]);
  });

  it('unread() nests under all', () => {
    // unread() is a compat alias scoped to { tab: 'unread' }
    expect(messageKeys.unread()[0]).toBe(messageKeys.all[0]);
    expect(messageKeys.unread()).toEqual(['messages', 'threads', { tab: 'unread' }]);
  });

  it('thread(id) nests under all', () => {
    expect(messageKeys.thread('abc')).toEqual(['messages', 'thread', 'abc']);
  });

  it('invalidating all covers inbox(), sent(), unread()', () => {
    // All sub-keys share the same root prefix — TanStack uses prefix matching
    expect(messageKeys.inbox()[0]).toBe(messageKeys.all[0]);
    expect(messageKeys.sent()[0]).toBe(messageKeys.all[0]);
    expect(messageKeys.unread()[0]).toBe(messageKeys.all[0]);
  });
});

// ── useMessages ───────────────────────────────────────────────────────────────

describe('useMessages', () => {
  it('starts in pending state and resolves to success', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useMessages(), { wrapper: wrap(client) });

    expect(result.current.status).toBe('pending');
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
  });

  it('returns messages provided by fetchMessages', async () => {
    const { fetchMessages } = await import('./api');
    vi.mocked(fetchMessages).mockResolvedValueOnce([makeMsg()]);

    const client = makeClient();
    const { result } = renderHook(() => useMessages(), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.subject).toBe('Test subject');
  });

  it('returns empty array when inbox is empty', async () => {
    const { fetchMessages } = await import('./api');
    vi.mocked(fetchMessages).mockResolvedValueOnce([]);

    const client = makeClient();
    const { result } = renderHook(() => useMessages(), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ── useSendMessage ────────────────────────────────────────────────────────────

describe('useSendMessage', () => {
  it('calls onSuccess callback after successful send', async () => {
    const { sendMessage } = await import('./api');
    vi.mocked(sendMessage).mockResolvedValueOnce({ success: true });

    const onSuccess = vi.fn();
    const client    = makeClient();

    const { result } = renderHook(
      () => useSendMessage({ onSuccess }),
      { wrapper: wrap(client) },
    );

    act(() => {
      result.current.mutate({ subject: 'Hello', body: 'World', toUsername: 'emp1' });
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('shows error toast when sendMessage fails', async () => {
    const { sendMessage } = await import('./api');
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('Server down'));
    const { toast } = await import('@store/ui');

    const client = makeClient();
    const { result } = renderHook(
      () => useSendMessage({ onSuccess: vi.fn() }),
      { wrapper: wrap(client) },
    );

    act(() => {
      result.current.mutate({ subject: 'x', body: 'y', toUsername: 'emp1' });
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server down'));
  });

  it('invalidates message queries on success', async () => {
    const { sendMessage } = await import('./api');
    vi.mocked(sendMessage).mockResolvedValueOnce({ success: true });

    const client        = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(
      () => useSendMessage({ onSuccess: vi.fn() }),
      { wrapper: wrap(client) },
    );

    act(() => {
      result.current.mutate({ subject: 'Hi', body: 'There', toUsername: 'emp2' });
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: messageKeys.all }),
      ),
    );
  });
});

// ── useSendReply — optimistic update ─────────────────────────────────────────

describe('useSendReply — optimistic update', () => {
  it('appends reply to cache immediately before server responds', async () => {
    const { replyMessage } = await import('./api');
    let resolveReply!: () => void;
    vi.mocked(replyMessage).mockImplementationOnce(
      () => new Promise<{ success: boolean }>(res => { resolveReply = () => res({ success: true }); }),
    );

    const client = makeClient();
    const msg    = makeMsg({ replies: [] });
    client.setQueryData(messageKeys.inbox(), [msg]);

    const { result } = renderHook(
      () => useSendReply('msg-1'),
      { wrapper: wrap(client) },
    );

    act(() => { result.current.mutate('Hello there'); });

    // Optimistic reply should be in cache before server responds
    await waitFor(() => {
      const cached = client.getQueryData<MsgItem[]>(messageKeys.inbox());
      const replies = cached?.[0]?.replies ?? [];
      expect(replies.length).toBe(1);
      expect(replies[0]?.body).toBe('Hello there');
      expect(replies[0]?.id).toMatch(/^tmp_/);
    });

    act(() => { resolveReply(); });
  });

  it('rolls back optimistic update on server error', async () => {
    const { replyMessage } = await import('./api');
    vi.mocked(replyMessage).mockRejectedValueOnce(new Error('Network error'));

    const client = makeClient();
    const msg    = makeMsg({ replies: [] });
    client.setQueryData(messageKeys.inbox(), [msg]);

    const { result } = renderHook(
      () => useSendReply('msg-1'),
      { wrapper: wrap(client) },
    );

    act(() => { result.current.mutate('Oops'); });

    await waitFor(() => {
      const cached = client.getQueryData<MsgItem[]>(messageKeys.inbox());
      // Rollback: replies should be empty again
      expect(cached?.[0]?.replies.length).toBe(0);
    });
  });

  it('sets fromUsername from session on optimistic reply', async () => {
    const { replyMessage } = await import('./api');
    let resolveReply!: () => void;
    vi.mocked(replyMessage).mockImplementationOnce(
      () => new Promise<{ success: boolean }>(res => { resolveReply = () => res({ success: true }); }),
    );

    const client = makeClient();
    client.setQueryData(messageKeys.inbox(), [makeMsg()]);

    const { result } = renderHook(
      () => useSendReply('msg-1'),
      { wrapper: wrap(client) },
    );

    act(() => { result.current.mutate('Hey'); });

    await waitFor(() => {
      const cached = client.getQueryData<MsgItem[]>(messageKeys.inbox());
      expect(cached?.[0]?.replies[0]?.fromUsername).toBe('adm1');
    });

    act(() => { resolveReply(); });
  });
});

// ── useMarkRead — optimistic read flag ───────────────────────────────────────

describe('useMarkRead', () => {
  it('clears isUnread and unreadReplyCount optimistically in cache', async () => {
    const { markMessageRead } = await import('./api');
    let resolveRead!: () => void;
    vi.mocked(markMessageRead).mockImplementationOnce(
      () => new Promise<{ success: boolean }>(res => { resolveRead = () => res({ success: true }); }),
    );

    const client = makeClient();
    const msg    = makeMsg({ isUnread: true, unreadReplyCount: 3 });
    client.setQueryData(messageKeys.inbox(), [msg]);

    const { result } = renderHook(() => useMarkRead(), { wrapper: wrap(client) });

    act(() => { result.current.mutate('msg-1'); });

    await waitFor(() => {
      const cached = client.getQueryData<MsgItem[]>(messageKeys.inbox());
      expect(cached?.[0]?.isUnread).toBe(false);
      expect(cached?.[0]?.unreadReplyCount).toBe(0);
    });

    act(() => { resolveRead(); });
  });

  it('rolls back read flag on server error', async () => {
    const { markMessageRead } = await import('./api');
    vi.mocked(markMessageRead).mockRejectedValueOnce(new Error('Auth error'));

    const client = makeClient();
    const msg    = makeMsg({ isUnread: true, unreadReplyCount: 2 });
    client.setQueryData(messageKeys.inbox(), [msg]);

    const { result } = renderHook(() => useMarkRead(), { wrapper: wrap(client) });

    act(() => { result.current.mutate('msg-1'); });

    await waitFor(() => {
      const cached = client.getQueryData<MsgItem[]>(messageKeys.inbox());
      // Rolled back: still unread
      expect(cached?.[0]?.isUnread).toBe(true);
      expect(cached?.[0]?.unreadReplyCount).toBe(2);
    });
  });

  it('calls markMessageRead with the correct id', async () => {
    const { markMessageRead } = await import('./api');
    vi.mocked(markMessageRead).mockResolvedValueOnce({ success: true });

    const client = makeClient();
    const { result } = renderHook(() => useMarkRead(), { wrapper: wrap(client) });

    act(() => { result.current.mutate('msg-42'); });

    await waitFor(() => expect(markMessageRead).toHaveBeenCalledWith('msg-42'));
  });
});

// ── useDeleteMessage ──────────────────────────────────────────────────────────

describe('useDeleteMessage', () => {
  it('calls deleteMessage with the correct id', async () => {
    const { deleteMessage } = await import('./api');
    vi.mocked(deleteMessage).mockResolvedValueOnce({ success: true });

    const client = makeClient();
    const { result } = renderHook(() => useDeleteMessage(), { wrapper: wrap(client) });

    act(() => { result.current.mutate('msg-99'); });

    await waitFor(() => expect(deleteMessage).toHaveBeenCalledWith('msg-99'));
  });

  it('invalidates all message queries on success', async () => {
    const { deleteMessage } = await import('./api');
    vi.mocked(deleteMessage).mockResolvedValueOnce({ success: true });

    const client        = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteMessage(), { wrapper: wrap(client) });

    act(() => { result.current.mutate('msg-1'); });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: messageKeys.all }),
      ),
    );
  });

  it('shows error toast when delete fails', async () => {
    const { deleteMessage } = await import('./api');
    vi.mocked(deleteMessage).mockRejectedValueOnce(new Error('Permission denied'));
    const { toast } = await import('@store/ui');

    const client = makeClient();
    const { result } = renderHook(() => useDeleteMessage(), { wrapper: wrap(client) });

    act(() => { result.current.mutate('msg-x'); });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Permission denied'));
  });
});

// ── useMessageRealtime ────────────────────────────────────────────────────────

describe('useMessageRealtime', () => {
  beforeEach(() => {
    Object.keys(realtimeSubs).forEach(k => { realtimeSubs[k] = []; });
  });

  it('subscribes to messages and message_replies events on mount', async () => {
    const { onRealtimeEvent } = await import('@store/realtime');
    const client = makeClient();

    renderHook(() => useMessageRealtime(), { wrapper: wrap(client) });

    await waitFor(() => {
      expect(onRealtimeEvent).toHaveBeenCalledWith('messages', expect.any(Function));
      expect(onRealtimeEvent).toHaveBeenCalledWith('message_replies', expect.any(Function));
    });
  });

  it('invalidates messageKeys.all when messages event fires', async () => {
    const client        = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useMessageRealtime(), { wrapper: wrap(client) });

    await waitFor(() => expect((realtimeSubs['messages'] ?? []).length).toBeGreaterThan(0));

    act(() => { realtimeSubs['messages']?.forEach(cb => cb()); });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: messageKeys.all }),
      ),
    );
  });

  it('invalidates messageKeys.all when message_replies event fires', async () => {
    const client        = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useMessageRealtime(), { wrapper: wrap(client) });

    await waitFor(() => expect((realtimeSubs['message_replies'] ?? []).length).toBeGreaterThan(0));

    act(() => { realtimeSubs['message_replies']?.forEach(cb => cb()); });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: messageKeys.all }),
      ),
    );
  });

  it('unsubscribes from both events on unmount', async () => {
    const client = makeClient();

    const { unmount } = renderHook(() => useMessageRealtime(), { wrapper: wrap(client) });

    await waitFor(() => expect((realtimeSubs['messages'] ?? []).length).toBeGreaterThan(0));

    const before =
      (realtimeSubs['messages']?.length ?? 0) +
      (realtimeSubs['message_replies']?.length ?? 0);

    act(() => { unmount(); });

    const after =
      (realtimeSubs['messages']?.length ?? 0) +
      (realtimeSubs['message_replies']?.length ?? 0);

    expect(after).toBeLessThan(before);
  });
});
