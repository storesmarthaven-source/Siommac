/**
 * src/api/notifications.ts
 *
 * Typed API functions for the Notifications domain.
 *
 * ALL reads and writes go through the Netlify backend (routes/notify.ts) using
 * the custom JWT carried by apiPost. The browser must NOT read the notifications
 * table directly: app auth is custom JWT (not Supabase Auth), so a browser
 * Supabase client has no authenticated session and RLS auth.uid() cannot gate
 * it — a direct read could expose another user's notifications. The backend
 * scopes every query to the JWT actor's id.
 *
 * Supabase is still used for Realtime (the `notifications:user-…` channel in
 * src/store/notifications.ts) purely as a "something changed" signal to trigger
 * a refetch through these authenticated APIs — never to read protected data.
 *
 * @see docs/COMMUNICATIONS_BACKBONE.md
 */

import { apiPost }                       from '@lib/api';
import { logger }                        from '@lib/logger';
import { NotificationRowSchema,
         NotificationPreferenceSchema } from './schemas/notification';
import type {
  NotificationRow,
  NotificationPreferenceRow,
  UpdatePreferencePayload,
  SendNotificationPayload,
} from './schemas/notification';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max notifications to fetch per page (keeps response size predictable) */
const PAGE_SIZE = 50;

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetch the most recent notifications for the current user. The backend scopes
 * results to the JWT actor; the `userId` arg is retained for the call signature
 * but the server ignores it in favour of the authenticated identity.
 */
export async function getMyNotifications(
  _userId: string,
  signal?: AbortSignal,
): Promise<NotificationRow[]> {
  const res = await apiPost<{ success: boolean; data?: unknown[]; message?: string }>(
    'getMyNotifications', { limit: PAGE_SIZE }, { signal },
  );
  if (!res.success) {
    logger.error('[api/notifications] getMyNotifications failed', { message: res.message });
    throw new Error(res.message ?? 'Failed to load notifications.');
  }

  // Validate + filter malformed rows rather than crashing
  return (res.data ?? []).flatMap((row) => {
    const parsed = NotificationRowSchema.safeParse(row);
    if (!parsed.success) {
      logger.warn('[api/notifications] Malformed notification row skipped', {
        row, issues: parsed.error.issues,
      });
      return [];
    }
    return [parsed.data];
  });
}

/**
 * Count unread notifications for the current user.
 * Used to drive the bell badge — hot path on Realtime events.
 */
export async function getUnreadCount(_userId: string): Promise<number> {
  const res = await apiPost<{ success: boolean; data?: { count: number } }>(
    'getUnreadCount', {},
  );
  if (!res.success) {
    logger.error('[api/notifications] getUnreadCount failed');
    return 0;  // degrade gracefully — badge shows 0, not an error
  }
  return res.data?.count ?? 0;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Mark a single notification as read */
export async function markAsRead(notificationId: string): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'markNotificationRead', { notificationId },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to mark notification read.');
}

/** Mark all notifications as read for the current user */
export async function markAllAsRead(_userId: string): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'markAllNotificationsRead', {},
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to mark all read.');
}

/** Delete a single notification */
export async function deleteNotification(notificationId: string): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'deleteNotification', { notificationId },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to delete notification.');
}

/** Delete all notifications for the current user (clear all) */
export async function clearAllNotifications(_userId: string): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'clearAllNotifications', {},
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to clear notifications.');
}

/**
 * Send a notification. Backend checks preferences and uses the service role key.
 */
export async function sendNotification(payload: SendNotificationPayload): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'sendNotification', payload as unknown as Record<string, unknown>,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to send notification.');
}

// ── Preferences ───────────────────────────────────────────────────────────────

/**
 * Get all notification preferences for the current user.
 * Returns defaults (all enabled) for any type not in the DB.
 */
export async function getMyPreferences(
  _userId: string,
  signal?: AbortSignal,
): Promise<NotificationPreferenceRow[]> {
  const res = await apiPost<{ success: boolean; data?: unknown[] }>(
    'getMyPreferences', {}, { signal },
  );
  if (!res.success) {
    logger.error('[api/notifications] getMyPreferences failed');
    return [];  // degrade to defaults
  }
  return (res.data ?? []).flatMap((row) => {
    const parsed = NotificationPreferenceSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Update a single notification preference for the current user */
export async function updateMyPreference(
  _userId: string,
  payload: UpdatePreferencePayload,
): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'updateMyPreference', payload as unknown as Record<string, unknown>,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to update preference.');
}
