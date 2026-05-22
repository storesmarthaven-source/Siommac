/**
 * src/components/sections/Messages/hooks.ts
 *
 * TanStack Query hooks for the Messages domain.
 *
 * REALTIME: the messages query is invalidated via onRealtimeEvent('messages')
 * and onRealtimeEvent('message_replies') — no polling. The legacy 5-second
 * setInterval in MessagesPanel.ts is completely replaced.
 *
 * OPTIMISTIC UPDATES: useSendReply appends the reply optimistically before
 * the server round-trip completes, giving instant bubble feedback.
 *
 * @see docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { useEffect }       from 'preact/hooks';
import { useSessionStore } from '@store/session';
import { toast }           from '@store/ui';
import { onRealtimeEvent } from '@store/realtime';
import { messageKeys }     from '@api/queryKeys';
import type { MsgItem }    from '@components/nav/types';
import {
  fetchMessages,
  sendMessage,
  replyMessage,
  markMessageRead,
  deleteMessage,
  fetchEmployeesForMsg,
} from './api';

// ── Realtime invalidation ─────────────────────────────────────────────────────

/**
 * Subscribe to Supabase realtime events for messages and message_replies.
 * Invalidates the TanStack Query cache on any change — no polling.
 * Call once from the MessagePanel root component.
 */
export function useMessageRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const unsub1 = onRealtimeEvent('messages', () => {
      void qc.invalidateQueries({ queryKey: messageKeys.all });
    });
    const unsub2 = onRealtimeEvent('message_replies', () => {
      void qc.invalidateQueries({ queryKey: messageKeys.all });
    });
    return () => { unsub1(); unsub2(); };
  // queryClient is stable — run once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function useMessages() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey:  messageKeys.inbox(),
    queryFn:   fetchMessages,
    staleTime: 30_000,
    enabled:   isAuthenticated,
  });
}

export function useEmployeesForMsg() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  const role            = useSessionStore(s => s.role);
  const isAdmin         = role === 'admin' || role === 'manager';
  return useQuery({
    queryKey:  ['messages', 'employees'],
    queryFn:   fetchEmployeesForMsg,
    staleTime: 5 * 60_000,   // 5 min — employee list rarely changes
    enabled:   isAuthenticated && isAdmin,
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function useSendMessage(opts: { onSuccess?: () => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendMessage,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messageKeys.all });
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to send message.');
    },
  });
}

export function useSendReply(messageId: string | number) {
  const qc       = useQueryClient();
  const username = useSessionStore(s => s.username) ?? '';
  const fullName = useSessionStore(s => s.fullName) ?? '';
  const photo    = useSessionStore(s => s.profileImage) ?? '';
  const listKey  = messageKeys.inbox();

  return useMutation({
    mutationFn: (body: string) => replyMessage({ messageId, body }),

    // Optimistic: append reply bubble immediately
    onMutate: async (body: string) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<MsgItem[]>(listKey);

      const optimistic: MsgItem['replies'][number] = {
        id:          'tmp_' + Date.now(),
        fromUsername: username,
        fromName:     fullName || username,
        fromPhoto:    photo,
        body,
        createdAt:   new Date().toISOString(),
      };

      qc.setQueryData<MsgItem[]>(listKey, old =>
        (old ?? []).map(m =>
          String(m.id) === String(messageId)
            ? { ...m, replies: [...m.replies, optimistic] }
            : m,
        ),
      );
      return { previous };
    },

    onError: (_err, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(listKey, ctx.previous);
      toast.error('Failed to send reply.');
    },

    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

export function useMarkRead() {
  const qc      = useQueryClient();
  const listKey = messageKeys.inbox();

  return useMutation({
    mutationFn: (id: string | number) => markMessageRead(id),

    // Optimistic: clear unread flags immediately in cache
    onMutate: async (id: string | number) => {
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData<MsgItem[]>(listKey);
      qc.setQueryData<MsgItem[]>(listKey, old =>
        (old ?? []).map(m =>
          String(m.id) === String(id)
            ? { ...m, isUnread: false, unreadReplyCount: 0 }
            : m,
        ),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(listKey, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => deleteMessage(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messageKeys.all });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete conversation.');
    },
  });
}
