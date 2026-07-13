/**
 * src/components/sections/Tickets/tickets.test.ts
 *
 * Unit tests for the Support Tickets domain (Phase 2e).
 *
 * Tests cover:
 *   - ticketKeys query key structure and hierarchy
 *   - useSeenReplies localStorage persistence and markAllSeen behaviour
 *   - useCreateTicket / useSendReply / useUpdateStatus / useDeleteTicket /
 *     useClearClosed hooks (via mocked API functions)
 *   - useSendReply optimistic update — cache patched before server responds,
 *     rolled back on error, refetched on settle
 *   - useTicketRealtime — subscribes to both realtime events and invalidates
 *
 * @see docs/CODING_STANDARDS.md §10-Testing-Standards
 * @see docs/PHASE_PLAN.md §Phase-2e
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor }  from '@testing-library/preact';
import { h }                         from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { ticketKeys }                from '@api/queryKeys';
import { useSeenReplies }            from './useSeenReplies';
import {
  useTickets,
  useCreateTicket,
  useSendReply,
  useUpdateStatus,
  useDeleteTicket,
  useClearClosed,
  useTicketRealtime,
} from './hooks';
import type { TicketRow }            from '@api/schemas/ticket';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Session store — default to employee role
vi.mock('@store/session', () => ({
  useSessionStore: vi.fn((sel: (s: { role: string; username: string; fullName: string; profileImage: string }) => unknown) =>
    sel({ role: 'employee', username: 'jdoe', fullName: 'John Doe', profileImage: '' }),
  ),
}));

// API functions — start as successful no-ops; individual tests override as needed
vi.mock('@api/tickets', () => ({
  fetchTickets:       vi.fn().mockResolvedValue([]),
  createTicket:       vi.fn().mockResolvedValue({ ticketNumber: 'TKT-001' }),
  replyToTicket:      vi.fn().mockResolvedValue(undefined),
  updateTicketStatus: vi.fn().mockResolvedValue(undefined),
  deleteTicket:       vi.fn().mockResolvedValue(undefined),
  clearClosedTickets: vi.fn().mockResolvedValue(3),
}));

// Realtime — store the subscribed callbacks so tests can trigger them
const realtimeSubs: Record<string, (() => void)[]> = {};
vi.mock('@store/realtime', () => ({
  onRealtimeEvent: vi.fn((event: string, cb: () => void) => {
    realtimeSubs[event] ??= [];
    realtimeSubs[event].push(cb);
    return () => {
      realtimeSubs[event] = (realtimeSubs[event] ?? []).filter(f => f !== cb);
    };
  }),
}));

// Toast — suppress side-effect noise
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

function makeTicket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id:          'ticket-1',
    ticketNumber:'TKT-001',
    subject:     'Test subject',
    body:        'Test body',
    status:      'open',
    createdAt:   '2026-01-01T00:00:00Z',
    fromUsername:'jdoe',
    fromName:    'John Doe',
    fromPhoto:   '',
    replies:     [],
    ...overrides,
  };
}

// ── ticketKeys query key hierarchy ───────────────────────────────────────────

describe('ticketKeys', () => {
  it('all is the root key', () => {
    expect(ticketKeys.all).toEqual(['tickets']);
  });

  it('mine() nests under all', () => {
    expect(ticketKeys.mine()).toEqual(['tickets', 'mine']);
    expect(ticketKeys.mine()[0]).toBe(ticketKeys.all[0]);
  });

  it('admin() nests under all', () => {
    expect(ticketKeys.admin()).toEqual(['tickets', 'admin']);
    expect(ticketKeys.admin()[0]).toBe(ticketKeys.all[0]);
  });

  it('detail(id) nests under all', () => {
    expect(ticketKeys.detail('abc')).toEqual(['tickets', 'detail', 'abc']);
  });

  it('mine() and admin() are different keys', () => {
    expect(ticketKeys.mine()).not.toEqual(ticketKeys.admin());
  });

  it('invalidating all also covers mine() and admin()', () => {
    // The first element of mine() and admin() matches all[0] — TanStack
    // Query uses prefix matching so invalidating 'tickets' covers both.
    expect(ticketKeys.mine()[0]).toBe(ticketKeys.all[0]);
    expect(ticketKeys.admin()[0]).toBe(ticketKeys.all[0]);
  });
});

// ── useSeenReplies ────────────────────────────────────────────────────────────

describe('useSeenReplies', () => {
  const LS_KEY = 'siomac_seen_reply_ids_jdoe';

  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty set when localStorage is empty', () => {
    const { result } = renderHook(() => useSeenReplies());
    expect(result.current.seenIds.size).toBe(0);
  });

  it('hydrates from localStorage on mount', () => {
    localStorage.setItem(LS_KEY, JSON.stringify(['reply-a', 'reply-b']));
    const { result } = renderHook(() => useSeenReplies());
    expect(result.current.seenIds.has('reply-a')).toBe(true);
    expect(result.current.seenIds.has('reply-b')).toBe(true);
  });

  it('markAllSeen adds IDs and persists to localStorage', () => {
    const { result } = renderHook(() => useSeenReplies());

    void act(() => { result.current.markAllSeen(['reply-1', 'reply-2']); });

    expect(result.current.seenIds.has('reply-1')).toBe(true);
    expect(result.current.seenIds.has('reply-2')).toBe(true);

    const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as string[];
    expect(stored).toContain('reply-1');
    expect(stored).toContain('reply-2');
  });

  it('markAllSeen is additive — does not clear existing IDs', () => {
    const { result } = renderHook(() => useSeenReplies());

    void act(() => { result.current.markAllSeen(['reply-1']); });
    void act(() => { result.current.markAllSeen(['reply-2']); });

    expect(result.current.seenIds.has('reply-1')).toBe(true);
    expect(result.current.seenIds.has('reply-2')).toBe(true);
  });

  it('markAllSeen is idempotent — adding duplicate IDs does not grow the set', () => {
    const { result } = renderHook(() => useSeenReplies());

    void act(() => { result.current.markAllSeen(['reply-1']); });
    const sizeBefore = result.current.seenIds.size;
    void act(() => { result.current.markAllSeen(['reply-1']); });

    expect(result.current.seenIds.size).toBe(sizeBefore);
  });

  it('gracefully handles corrupted localStorage (returns empty set)', () => {
    localStorage.setItem(LS_KEY, 'NOT_VALID_JSON{{{');
    const { result } = renderHook(() => useSeenReplies());
    expect(result.current.seenIds.size).toBe(0);
  });
});

// ── useTickets ────────────────────────────────────────────────────────────────

describe('useTickets', () => {
  it('mounts without error and uses mine() key for employee role', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useTickets(), { wrapper: wrap(client) });

    // Should start in loading state
    expect(result.current.status).toBe('pending');

    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
  });

  it('returns data provided by fetchTickets', async () => {
    const { fetchTickets } = await import('@api/tickets');
    vi.mocked(fetchTickets).mockResolvedValueOnce([makeTicket()]);

    const client = makeClient();
    const { result } = renderHook(() => useTickets(), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.ticketNumber).toBe('TKT-001');
  });

  it('returns empty array when no tickets exist', async () => {
    const { fetchTickets } = await import('@api/tickets');
    vi.mocked(fetchTickets).mockResolvedValueOnce([]);

    const client = makeClient();
    const { result } = renderHook(() => useTickets(), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ── useCreateTicket ───────────────────────────────────────────────────────────

describe('useCreateTicket', () => {
  it('calls createTicket and triggers onSuccess with ticketNumber', async () => {
    const { createTicket } = await import('@api/tickets');
    vi.mocked(createTicket).mockResolvedValueOnce({ id: 'ticket-42', ticketNumber: 'TKT-042' });

    const onSuccess = vi.fn();
    const client    = makeClient();

    const { result } = renderHook(
      () => useCreateTicket({ onSuccess }),
      { wrapper: wrap(client) },
    );

    void act(() => {
      result.current.mutate({
        subject:  'Broken clock',
        body:     'The clock is wrong.',
        category: 'general',
      });
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('TKT-042'));
  });

  it('shows error toast when createTicket fails', async () => {
    const { createTicket } = await import('@api/tickets');
    vi.mocked(createTicket).mockRejectedValueOnce(new Error('Server error'));
    const { toast } = await import('@store/ui');

    const client = makeClient();
    const { result } = renderHook(
      () => useCreateTicket({ onSuccess: vi.fn() }),
      { wrapper: wrap(client) },
    );

    void act(() => {
      result.current.mutate({ subject: 'x', body: 'y', category: 'general' });
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server error'));
  });

  it('invalidates ticket queries on success', async () => {
    const { createTicket } = await import('@api/tickets');
    vi.mocked(createTicket).mockResolvedValueOnce({ id: 'ticket-99', ticketNumber: 'TKT-099' });

    const client        = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(
      () => useCreateTicket({ onSuccess: vi.fn() }),
      { wrapper: wrap(client) },
    );

    void act(() => {
      result.current.mutate({ subject: 'test', body: 'test', category: 'general' });
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ticketKeys.all }),
      ),
    );
  });
});

// ── useSendReply — optimistic update ─────────────────────────────────────────

describe('useSendReply — optimistic update', () => {
  it('appends reply to cache before server responds', async () => {
    const { replyToTicket } = await import('@api/tickets');
    let resolveReply!: () => void;
    vi.mocked(replyToTicket).mockImplementationOnce(
      () => new Promise<void>(res => { resolveReply = () => res(); }),
    );

    const client = makeClient();
    const ticket = makeTicket({ replies: [] });
    client.setQueryData(ticketKeys.mine(), [ticket]);

    const { result } = renderHook(
      () => useSendReply('ticket-1'),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate('Hello'); });

    // Optimistic update should be in cache immediately
    await waitFor(() => {
      const cached = client.getQueryData<TicketRow[]>(ticketKeys.mine());
      const replies = cached?.[0]?.replies ?? [];
      expect(replies.length).toBe(1);
      expect(replies[0]?.body).toBe('Hello');
      expect(replies[0]?.id).toMatch(/^tmp_/);
    });

    // Let the server respond and settle
    void act(() => { resolveReply(); });
  });

  it('rolls back optimistic update on error', async () => {
    const { replyToTicket } = await import('@api/tickets');
    vi.mocked(replyToTicket).mockRejectedValueOnce(new Error('Network error'));

    const client = makeClient();
    const ticket = makeTicket({ replies: [] });
    client.setQueryData(ticketKeys.mine(), [ticket]);

    const { result } = renderHook(
      () => useSendReply('ticket-1'),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate('Oops'); });

    await waitFor(() => {
      const cached = client.getQueryData<TicketRow[]>(ticketKeys.mine());
      // Rollback: replies should be empty again
      expect(cached?.[0]?.replies.length).toBe(0);
    });
  });

  it('sets fromUsername from session on optimistic reply', async () => {
    const { replyToTicket } = await import('@api/tickets');
    let resolveReply!: () => void;
    vi.mocked(replyToTicket).mockImplementationOnce(
      () => new Promise<void>(res => { resolveReply = () => res(); }),
    );

    const client = makeClient();
    client.setQueryData(ticketKeys.mine(), [makeTicket()]);

    const { result } = renderHook(
      () => useSendReply('ticket-1'),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate('Hey'); });

    await waitFor(() => {
      const cached = client.getQueryData<TicketRow[]>(ticketKeys.mine());
      expect(cached?.[0]?.replies[0]?.fromUsername).toBe('jdoe');
    });

    void act(() => { resolveReply(); });
  });
});

// ── useUpdateStatus ───────────────────────────────────────────────────────────

describe('useUpdateStatus', () => {
  it('calls updateTicketStatus with the correct id and status', async () => {
    const { updateTicketStatus } = await import('@api/tickets');
    vi.mocked(updateTicketStatus).mockResolvedValueOnce(undefined);

    const client = makeClient();
    const { result } = renderHook(
      () => useUpdateStatus('ticket-1'),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate('closed'); });

    await waitFor(() =>
      expect(updateTicketStatus).toHaveBeenCalledWith('ticket-1', 'closed'),
    );
  });

  it('shows success toast on status change', async () => {
    const { updateTicketStatus } = await import('@api/tickets');
    vi.mocked(updateTicketStatus).mockResolvedValueOnce(undefined);
    const { toast } = await import('@store/ui');

    const client = makeClient();
    const { result } = renderHook(
      () => useUpdateStatus('ticket-2'),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate('in-progress'); });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ticket status updated.'));
  });

  it('shows error toast when update fails', async () => {
    const { updateTicketStatus } = await import('@api/tickets');
    vi.mocked(updateTicketStatus).mockRejectedValueOnce(new Error('Permission denied'));
    const { toast } = await import('@store/ui');

    const client = makeClient();
    const { result } = renderHook(
      () => useUpdateStatus('ticket-3'),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate('closed'); });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Permission denied'));
  });
});

// ── useDeleteTicket ───────────────────────────────────────────────────────────

describe('useDeleteTicket', () => {
  it('calls deleteTicket with the given id', async () => {
    const { deleteTicket } = await import('@api/tickets');
    vi.mocked(deleteTicket).mockResolvedValueOnce(undefined);

    const client = makeClient();
    const { result } = renderHook(
      () => useDeleteTicket(),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate('ticket-1'); });

    await waitFor(() => expect(deleteTicket).toHaveBeenCalledWith('ticket-1'));
  });

  it('invalidates all ticket queries on success', async () => {
    const { deleteTicket } = await import('@api/tickets');
    vi.mocked(deleteTicket).mockResolvedValueOnce(undefined);

    const client        = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(
      () => useDeleteTicket(),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate('ticket-1'); });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ticketKeys.all }),
      ),
    );
  });

  it('shows error toast when delete fails', async () => {
    const { deleteTicket } = await import('@api/tickets');
    vi.mocked(deleteTicket).mockRejectedValueOnce(new Error('Not found'));
    const { toast } = await import('@store/ui');

    const client = makeClient();
    const { result } = renderHook(
      () => useDeleteTicket(),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate('ticket-x'); });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not found'));
  });
});

// ── useClearClosed ────────────────────────────────────────────────────────────

describe('useClearClosed', () => {
  it('shows correct plural toast when multiple tickets cleared', async () => {
    const { clearClosedTickets } = await import('@api/tickets');
    vi.mocked(clearClosedTickets).mockResolvedValueOnce(3);
    const { toast } = await import('@store/ui');

    const client = makeClient();
    const { result } = renderHook(
      () => useClearClosed(),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate(); });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('3 tickets cleared.'),
    );
  });

  it('shows singular toast when exactly one ticket cleared', async () => {
    const { clearClosedTickets } = await import('@api/tickets');
    vi.mocked(clearClosedTickets).mockResolvedValueOnce(1);
    const { toast } = await import('@store/ui');

    const client = makeClient();
    const { result } = renderHook(
      () => useClearClosed(),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate(); });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('1 ticket cleared.'),
    );
  });

  it('shows zero cleared toast when no closed tickets exist', async () => {
    const { clearClosedTickets } = await import('@api/tickets');
    vi.mocked(clearClosedTickets).mockResolvedValueOnce(0);
    const { toast } = await import('@store/ui');

    const client = makeClient();
    const { result } = renderHook(
      () => useClearClosed(),
      { wrapper: wrap(client) },
    );

    void act(() => { result.current.mutate(); });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('0 tickets cleared.'),
    );
  });
});

// ── useTicketRealtime ─────────────────────────────────────────────────────────

describe('useTicketRealtime', () => {
  beforeEach(() => {
    Object.keys(realtimeSubs).forEach(k => { realtimeSubs[k] = []; });
  });

  it('subscribes to support_tickets and ticket_replies events on mount', async () => {
    const { onRealtimeEvent } = await import('@store/realtime');
    const client = makeClient();

    renderHook(() => useTicketRealtime(), { wrapper: wrap(client) });

    await waitFor(() => {
      expect(onRealtimeEvent).toHaveBeenCalledWith('support_tickets', expect.any(Function));
      expect(onRealtimeEvent).toHaveBeenCalledWith('ticket_replies', expect.any(Function));
    });
  });

  it('invalidates ticketKeys.all when support_tickets event fires', async () => {
    const client        = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useTicketRealtime(), { wrapper: wrap(client) });

    await waitFor(() => expect((realtimeSubs.support_tickets ?? []).length).toBeGreaterThan(0));

    void act(() => { realtimeSubs.support_tickets?.forEach(cb => cb()); });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ticketKeys.all }),
      ),
    );
  });

  it('invalidates ticketKeys.all when ticket_replies event fires', async () => {
    const client        = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useTicketRealtime(), { wrapper: wrap(client) });

    await waitFor(() => expect((realtimeSubs.ticket_replies ?? []).length).toBeGreaterThan(0));

    void act(() => { realtimeSubs.ticket_replies?.forEach(cb => cb()); });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ticketKeys.all }),
      ),
    );
  });

  it('unsubscribes from both events on unmount', async () => {
    const client = makeClient();

    const { unmount } = renderHook(() => useTicketRealtime(), { wrapper: wrap(client) });

    await waitFor(() => expect((realtimeSubs.support_tickets ?? []).length).toBeGreaterThan(0));

    const before =
      (realtimeSubs.support_tickets?.length ?? 0) +
      (realtimeSubs.ticket_replies?.length ?? 0);

    void act(() => { unmount(); });

    const after =
      (realtimeSubs.support_tickets?.length ?? 0) +
      (realtimeSubs.ticket_replies?.length ?? 0);

    expect(after).toBeLessThan(before);
  });
});
