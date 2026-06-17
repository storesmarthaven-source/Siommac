/**
 * src/store/notifications.ts
 *
 * Zustand store for notification state: unread count and in-memory list.
 *
 * RESPONSIBILITY (per docs/CODING_STANDARDS.md §7-State-Management-Rules):
 *   - Holds derived UI state ONLY (unread count, loading flag, list snapshot)
 *   - Server state lives in TanStack Query — this store is a Realtime-update
 *     bridge that triggers Query invalidations rather than duplicating the cache
 *
 * REALTIME INTEGRATION (per docs/ARCHITECTURE.md §10-Realtime):
 *   The `notificationsRealtimeChannel` in src/store/realtime.ts fires
 *   `onRealtimeEvent('notifications', ...)` on INSERT. That callback calls
 *   `useNotificationStore.getState().onNewNotification()` which:
 *     1. Increments the unread count optimistically (instant badge update)
 *     2. Invalidates the TanStack Query cache (triggers a refetch)
 *
 * USAGE:
 *   const unread = useNotificationStore((s) => s.unreadCount);
 *   const { onPanelOpen } = useNotificationStore.getState();
 *
 * @see docs/ARCHITECTURE.md §10-Realtime
 * @see docs/CODING_STANDARDS.md §7-State-Management-Rules
 * @see docs/PHASE_PLAN.md §Phase-2c
 */

import { create }          from 'zustand';
import { logger }          from '@lib/logger';
import { getQueryClient }  from '@lib/queryClient';
import { notificationKeys } from '@api/queryKeys';
import type { NotificationRow } from '@api/schemas/notification';

// ── State shape ───────────────────────────────────────────────────────────────

export interface NotificationState {
  /** Cached unread count — drives the bell badge. Updated optimistically. */
  unreadCount: number;

  /** Whether the notification panel is currently open */
  panelOpen:   boolean;

  /** Snapshot of the most recent notifications (mirrors TanStack Query cache) */
  items:       NotificationRow[];

  /** True while the initial fetch is in flight */
  loading:     boolean;

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Called when a new notification arrives via Realtime INSERT */
  onNewNotification: () => void;

  /** Called when the panel is opened — resets unread count in store + DB */
  onPanelOpen:       (userId: string) => void;

  /** Called when the panel is closed */
  onPanelClose:      () => void;

  /** Hydrate the store from a fresh DB fetch */
  setItems:          (items: NotificationRow[], unreadCount: number) => void;

  /** Reset on logout */
  reset:             () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useNotificationStore = create<NotificationState>()((set) => ({
  unreadCount: 0,
  panelOpen:   false,
  items:       [],
  loading:     false,

  onNewNotification() {
    // Optimistic increment — the Realtime event fires before the refetch completes
    set((s) => ({ unreadCount: s.unreadCount + 1 }));

    // Invalidate TanStack Query so the panel list refreshes automatically
    try {
      void getQueryClient().invalidateQueries({ queryKey: notificationKeys.mine() });
      void getQueryClient().invalidateQueries({ queryKey: notificationKeys.unread() });
    } catch (err) {
      logger.warn('[notifications] Could not invalidate query cache', { err });
    }
  },

  onPanelOpen(userId) {
    set({ panelOpen: true });

    // Mark all as read in DB (fire-and-forget — badge resets immediately in UI)
    import('@api/notifications').then(({ markAllAsRead }) => {
      void markAllAsRead(userId).then(() => {
        set({ unreadCount: 0 });
        // Invalidate so the panel re-fetches with is_read: true on all items
        try {
              void getQueryClient().invalidateQueries({ queryKey: notificationKeys.mine() });
          void getQueryClient().invalidateQueries({ queryKey: notificationKeys.unread() });
        } catch { /* ignore */ }
      }).catch((err: unknown) => {
        logger.warn('[notifications] markAllAsRead failed', { err });
      });
    }).catch(() => { /* ignore */ });
  },

  onPanelClose() {
    set({ panelOpen: false });
  },

  setItems(items, unreadCount) {
    set({ items, unreadCount, loading: false });
  },

  reset() {
    set({ unreadCount: 0, panelOpen: false, items: [], loading: false });
  },
}));
