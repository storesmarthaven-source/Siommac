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
import { notificationKeys, communicationKeys } from '@api/queryKeys';
import type { NotificationRow } from '@api/schemas/notification';

// ── State shape ───────────────────────────────────────────────────────────────

export interface NotificationState {
  /** Cached unread count — drives the bell badge. Updated optimistically. */
  unreadCount: number;

  /** Whether the notification panel is currently open */
  panelOpen:   boolean;

  /** ISO timestamp of the last realtime notification signal (debug / freshness) */
  lastRealtimeAt: string | null;

  /** Snapshot of the most recent notifications (mirrors TanStack Query cache) */
  items:       NotificationRow[];

  /** True while the initial fetch is in flight */
  loading:     boolean;

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Called when a new notification arrives via Realtime INSERT */
  onNewNotification: () => void;

  /**
   * Called when the panel is opened. Opening the panel is a *glance*, not a
   * review — it MUST NOT mark anything read. Reading happens explicitly (click
   * an item, open its record, or press "Mark all read").
   */
  onPanelOpen:       (userId?: string) => void;

  /** Called when the panel is closed */
  onPanelClose:      () => void;

  /** Reconcile the optimistic count with the authoritative summary value. */
  syncUnreadCount:   (count: number) => void;

  /** Hydrate the store from a fresh DB fetch */
  setItems:          (items: NotificationRow[], unreadCount: number) => void;

  /** Reset on logout */
  reset:             () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useNotificationStore = create<NotificationState>()((set) => ({
  unreadCount:    0,
  panelOpen:      false,
  lastRealtimeAt: null,
  items:          [],
  loading:        false,

  onNewNotification() {
    // Optimistic increment — the Realtime event fires before the refetch completes
    set((s) => ({ unreadCount: s.unreadCount + 1, lastRealtimeAt: new Date().toISOString() }));

    // Invalidate TanStack Query so the badge, list and summary all refresh.
    // The summary is the authoritative count; syncUnreadCount reconciles after.
    try {
      const qc = getQueryClient();
      void qc.invalidateQueries({ queryKey: communicationKeys.summary() });
      void qc.invalidateQueries({ queryKey: notificationKeys.mine() });
      void qc.invalidateQueries({ queryKey: notificationKeys.unread() });
    } catch (err) {
      logger.warn('[notifications] Could not invalidate query cache', { err });
    }
  },

  onPanelOpen() {
    // Glance only — opening the panel never marks notifications read.
    set({ panelOpen: true });
  },

  onPanelClose() {
    set({ panelOpen: false });
  },

  syncUnreadCount(count) {
    set({ unreadCount: count });
  },

  setItems(items, unreadCount) {
    set({ items, unreadCount, loading: false });
  },

  reset() {
    set({ unreadCount: 0, panelOpen: false, lastRealtimeAt: null, items: [], loading: false });
  },
}));
