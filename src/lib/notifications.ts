/**
 * src/lib/notifications.ts
 *
 * TanStack Query hooks and imperative helpers for the Notifications domain.
 *
 * PATTERN (per docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules):
 *   - useQuery for reads (cache + background refresh)
 *   - useMutation for writes (mark read, delete, clear)
 *   - onSuccess invalidates the relevant query keys
 *   - All hooks read userId from the session store — no prop-drilling
 *
 * REALTIME BRIDGE:
 *   Call `initNotificationsRealtime(userId)` after login. It subscribes to
 *   the user-scoped Supabase Realtime channel and calls
 *   `useNotificationStore.getState().onNewNotification()` on INSERT.
 *
 *   Call `teardownNotificationsRealtime()` on logout to clean up the channel.
 *
 * @see docs/ARCHITECTURE.md §10-Realtime
 * @see docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules
 * @see docs/PHASE_PLAN.md §Phase-2c
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
}                                  from '@tanstack/preact-query';
import { logger }                  from '@lib/logger';
import { supabase }                from '@lib/supabase';
import { useSessionStore }         from '@store/session';
import { useNotificationStore }    from '@store/notifications';
import { notificationKeys }        from '@api/queryKeys';
import {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
  getMyPreferences,
  updateMyPreference,
}                                  from '@api/notifications';
import type { UpdatePreferencePayload } from '@api/schemas/notification';
import { resetToastSessionClock } from '@components/realtime/notificationToasts';

// ── Realtime channel handle ───────────────────────────────────────────────────

let _notifChannel: ReturnType<typeof supabase.channel> | null = null;

/**
 * Subscribe to the user-scoped `notifications` Realtime channel.
 * Call once after login. Idempotent — safe to call multiple times.
 *
 * NOTE: `public.notifications` is NOT in the Supabase realtime publication, so this
 * postgres_changes subscription does not currently fire. The live badge + the
 * compliance toast are driven off the WORKING communication_signals(domain=
 * 'notifications') signal in useRealtimeSignals instead. This subscription is kept
 * (harmless) for the day the table is published; it must NOT be the toast source.
 */
export function initNotificationsRealtime(userId: string): void {
  if (_notifChannel) return;   // already subscribed

  // Session start for the toast engine's no-backfill guard (ignores signals older
  // than this epoch), so a reconnect can't replay old notifications as toasts.
  resetToastSessionClock();

  _notifChannel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        logger.info('[notifications] Realtime INSERT', { id: (payload.new as { id?: string }).id });
        useNotificationStore.getState().onNewNotification();
      },
    )
    .subscribe((status) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- status is a Supabase REALTIME_SUBSCRIBE_STATES enum; String() avoids no-unsafe-enum-comparison
      const s = String(status);
      if (s === 'SUBSCRIBED') {
        logger.info('[notifications] Realtime channel subscribed', { userId });
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        logger.warn('[notifications] Realtime channel error', { status: s, userId });
      }
    });
}

/**
 * Tear down the Realtime subscription. Call on logout.
 */
export async function teardownNotificationsRealtime(): Promise<void> {
  if (!_notifChannel) return;
  try {
    await supabase.removeChannel(_notifChannel);
    _notifChannel = null;
    logger.info('[notifications] Realtime channel removed');
  } catch (err) {
    logger.warn('[notifications] Error removing Realtime channel', { err });
    _notifChannel = null;
  }
}

// ── Query hooks ───────────────────────────────────────────────────────────────

/**
 * Fetch the current user's notification list.
 * Stale after 30s — Realtime keeps it fresher for most cases.
 */
export function useMyNotifications() {
  const userId = useSessionStore((s) => s.userId);

  return useQuery({
    queryKey: notificationKeys.mine(),
    queryFn:  ({ signal }) => getMyNotifications(userId!, signal),
    enabled:  !!userId,
    staleTime: 30_000,
  });
}

/**
 * Fetch the current user's unread count.
 * Very short staleTime — this drives the bell badge.
 */
export function useUnreadCount() {
  const userId = useSessionStore((s) => s.userId);

  return useQuery({
    queryKey: notificationKeys.unread(),
    queryFn:  () => getUnreadCount(userId!),
    enabled:  !!userId,
    staleTime: 10_000,
    refetchInterval: 60_000,   // poll fallback if Realtime disconnects
  });
}

/**
 * Fetch the current user's notification preferences.
 */
export function useMyNotificationPreferences() {
  const userId = useSessionStore((s) => s.userId);

  return useQuery({
    queryKey: [...notificationKeys.mine(), 'preferences'],
    queryFn:  ({ signal }) => getMyPreferences(userId!, signal),
    enabled:  !!userId,
    staleTime: 5 * 60_000,   // preferences change infrequently
  });
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.mine() });
      void qc.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
    onError: (err: Error) => {
      logger.error('[notifications] markAsRead failed', { err });
    },
  });
}

export function useMarkAllAsRead() {
  const qc     = useQueryClient();
  const userId = useSessionStore((s) => s.userId);

  return useMutation({
    mutationFn: () => markAllAsRead(userId!),
    onSuccess: () => {
      useNotificationStore.setState({ unreadCount: 0 });
      void qc.invalidateQueries({ queryKey: notificationKeys.mine() });
      void qc.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
    onError: (err: Error) => {
      logger.error('[notifications] markAllAsRead failed', { err });
    },
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.mine() });
      void qc.invalidateQueries({ queryKey: notificationKeys.unread() });
    },
    onError: (err: Error) => {
      logger.error('[notifications] deleteNotification failed', { err });
    },
  });
}

export function useClearAllNotifications() {
  const qc     = useQueryClient();
  const userId = useSessionStore((s) => s.userId);

  return useMutation({
    mutationFn: () => clearAllNotifications(userId!),
    onSuccess: () => {
      useNotificationStore.setState({ unreadCount: 0 });
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
    onError: (err: Error) => {
      logger.error('[notifications] clearAllNotifications failed', { err });
    },
  });
}

export function useUpdateNotificationPreference() {
  const qc     = useQueryClient();
  const userId = useSessionStore((s) => s.userId);

  return useMutation({
    mutationFn: (payload: UpdatePreferencePayload) =>
      updateMyPreference(userId!, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...notificationKeys.mine(), 'preferences'] });
    },
    onError: (err: Error) => {
      logger.error('[notifications] updateMyPreference failed', { err });
    },
  });
}
