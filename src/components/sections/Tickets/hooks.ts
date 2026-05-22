/**
 * src/components/sections/Tickets/hooks.ts
 *
 * TanStack Query hooks for the Support Tickets domain.
 *
 * REALTIME: The ticket list query is invalidated automatically via
 * onRealtimeEvent('support_tickets') and onRealtimeEvent('ticket_replies')
 * in src/store/realtime.ts — no polling needed.
 *
 * OPTIMISTIC UPDATES: useSendReply appends the reply to the cache immediately
 * before the server round-trip completes, giving instant UI feedback.
 *
 * @see docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { useEffect }         from 'preact/hooks';
import { useSessionStore }   from '@store/session';
import { toast }             from '@store/ui';
import { onRealtimeEvent }   from '@store/realtime';
import { ticketKeys }        from '@api/queryKeys';
import {
  fetchTickets,
  createTicket,
  replyToTicket,
  updateTicketStatus,
  deleteTicket,
  clearClosedTickets,
} from '@api/tickets';
import type { TicketRow, CreateTicketPayload } from '@api/schemas/ticket';

// ── Realtime invalidation ─────────────────────────────────────────────────────

/**
 * Subscribe to Supabase realtime events for support_tickets and ticket_replies.
 * Invalidates the TanStack Query cache whenever a change arrives — no polling.
 * Call this once from TicketPanel (the root of the tickets UI tree).
 */
export function useTicketRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const unsub1 = onRealtimeEvent('support_tickets', () => {
      void qc.invalidateQueries({ queryKey: ticketKeys.all });
    });
    const unsub2 = onRealtimeEvent('ticket_replies', () => {
      void qc.invalidateQueries({ queryKey: ticketKeys.all });
    });
    return () => { unsub1(); unsub2(); };
  // queryClient is stable — only run once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function useTickets() {
  const role            = useSessionStore(s => s.role);
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey:  role === 'admin' || role === 'manager'
      ? ticketKeys.admin()
      : ticketKeys.mine(),
    queryFn:   fetchTickets,
    staleTime: 30_000,
    enabled:   isAuthenticated && !!role,
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function useCreateTicket(opts: { onSuccess?: (ticketNumber: string) => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTicketPayload) => createTicket(payload),
    onSuccess: ({ ticketNumber }) => {
      void qc.invalidateQueries({ queryKey: ticketKeys.all });
      opts.onSuccess?.(ticketNumber);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create ticket.');
    },
  });
}

export function useSendReply(ticketId: string) {
  const qc       = useQueryClient();
  const username = useSessionStore(s => s.username) ?? '';
  const fullName = useSessionStore(s => s.fullName) ?? '';
  const photo    = useSessionStore(s => s.profileImage) ?? '';
  const role     = useSessionStore(s => s.role);
  const listKey  = role === 'admin' || role === 'manager'
    ? ticketKeys.admin()
    : ticketKeys.mine();

  return useMutation({
    mutationFn: (body: string) => replyToTicket(ticketId, body),

    // Optimistic: append reply immediately so the bubble appears before the server responds
    onMutate: async (body: string) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<TicketRow[]>(listKey);

      const optimistic: TicketRow['replies'][number] = {
        id:           'tmp_' + Date.now(),
        fromUsername: username,
        fromName:     fullName || username,
        fromPhoto:    photo,
        body,
        createdAt:    new Date().toISOString(),
      };

      qc.setQueryData<TicketRow[]>(listKey, old =>
        (old ?? []).map(t =>
          t.id === ticketId
            ? { ...t, replies: [...t.replies, optimistic] }
            : t,
        ),
      );
      return { previous };
    },

    onError: (_err, _body, ctx) => {
      // Roll back the optimistic update
      if (ctx?.previous) qc.setQueryData(listKey, ctx.previous);
      toast.error('Failed to send reply.');
    },

    onSettled: () => {
      // Always re-fetch to get the real server ID replacing the 'tmp_' one
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

export function useUpdateStatus(ticketId: string) {
  const qc      = useQueryClient();
  const role    = useSessionStore(s => s.role);
  const listKey = role === 'admin' || role === 'manager'
    ? ticketKeys.admin()
    : ticketKeys.mine();

  return useMutation({
    mutationFn: (status: string) => updateTicketStatus(ticketId, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listKey });
      toast.success('Ticket status updated.');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update status.');
    },
  });
}

export function useDeleteTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTicket(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ticketKeys.all });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete ticket.');
    },
  });
}

export function useClearClosed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: clearClosedTickets,
    onSuccess: (count: number) => {
      void qc.invalidateQueries({ queryKey: ticketKeys.all });
      toast.success(`${count} ticket${count !== 1 ? 's' : ''} cleared.`);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to clear tickets.');
    },
  });
}
