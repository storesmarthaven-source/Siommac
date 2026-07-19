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
import { toast } from '@ui/toast';

// ── Realtime channel handle ───────────────────────────────────────────────────

let _notifChannel: ReturnType<typeof supabase.channel> | null = null;

/** The realtime `notifications` row shape we read for the targeted toast. */
interface NotificationRow {
  id?: string;
  type?: string;
  title?: string;
  body?: string;
  action_route?: string;
}

/** Compliance access notification types that warrant a live rich toast. */
const COMPLIANCE_TOAST_TYPES = new Set<string>([
  'iam.permission.compliance_grant_requested',
  'communications.compliance.access_granted',
  'communications.compliance.access_revoked',
]);

/**
 * Show a targeted rich toast for a compliance access notification (and ONLY those).
 * The Open action deep-links to the notification's section (Approvals for a
 * request, Messages for grant/revoke). Cosmetic — the backend routes enforce access.
 */
function fireComplianceAccessToast(n: NotificationRow): void {
  if (!n.type || !COMPLIANCE_TOAST_TYPES.has(n.type)) return;
  const variant = n.type === 'communications.compliance.access_revoked' ? 'warning' as const
    : n.type === 'communications.compliance.access_granted' ? 'success' as const
    : 'info' as const;
  const route = n.action_route;
  const nav = (window as unknown as { Nav?: { showSection?: (id: string) => void } }).Nav;
  toast.action({
    variant,
    title: n.title ?? 'Compliance access',
    description: n.body ?? undefined,
    statusLabel: 'Compliance',
    actions: [
      { label: 'Dismiss', dismissOnClick: true },
      ...(route?.startsWith('s-')
        ? [{ label: 'Open', onClick: () => nav?.showSection?.(route), dismissOnClick: true }]
        : []),
    ],
  });
}

/**
 * Subscribe to the user-scoped `notifications` Realtime channel.
 * Call once after login. Idempotent — safe to call multiple times.
 *
 * On INSERT → calls onNewNotification() which:
 *   1. Increments unread count optimistically
 *   2. Invalidates TanStack Query cache
 */
export function initNotificationsRealtime(userId: string): void {
  if (_notifChannel) return;   // already subscribed

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
        const row = payload.new as NotificationRow;
        logger.info('[notifications] Realtime INSERT', { id: row.id });
        useNotificationStore.getState().onNewNotification();
        // Targeted: ONLY compliance access notifications get a live rich toast
        // (grant/revoke to the grantee, request to approvers). Every other
        // notification type stays bubble-only — no global toast.
        fireComplianceAccessToast(row);
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
