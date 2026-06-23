/**
 * src/store/notifications.ts
 *
 * Notification UI bridge (Zustand). This is NOT a server-state store — the
 * notification list lives entirely in TanStack Query. The store holds only the
 * small pieces of derived UI state that need to update faster than a refetch:
 * the optimistic unread count and the panel-open flag.
 *
 * RESPONSIBILITY:
 *   - Optimistic unread count (instant badge bump on a realtime INSERT)
 *   - Panel open/closed flag
 *   - Triggers TanStack Query invalidations on realtime events (summary, list,
 *     unread) so the authoritative data refetches
 *   - Reconciles the optimistic count back to the summary's value
 *
 * It deliberately does NOT mirror the notification list and does NOT mark
 * anything read on its own. Reading is always explicit.
 *
 * USAGE:
 *   const unread = useNotificationStore((s) => s.unreadCount);
 *   const { onPanelOpen } = useNotificationStore.getState();
 *
 * @see docs/ARCHITECTURE.md §10-Realtime
 */

import { create }          from 'zustand';
import { logger }          from '@lib/logger';
import { getQueryClient }  from '@lib/queryClient';
import { notificationKeys, communicationKeys } from '@api/queryKeys';

// ── State shape ───────────────────────────────────────────────────────────────

export interface NotificationState {
  /** Cached unread count — drives the bell badge. Updated optimistically. */
  unreadCount: number;

  /** Whether the notification panel is currently open */
  panelOpen:   boolean;

  /** ISO timestamp of the last realtime notification signal (debug / freshness) */
  lastRealtimeAt: string | null;

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

  /** Reset on logout */
  reset:             () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useNotificationStore = create<NotificationState>()((set) => ({
  unreadCount:    0,
  panelOpen:      false,
  lastRealtimeAt: null,

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

  reset() {
    set({ unreadCount: 0, panelOpen: false, lastRealtimeAt: null });
  },
}));
