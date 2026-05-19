/**
 * src/api/notifications.ts
 *
 * Typed Supabase API functions for the Notifications domain.
 *
 * READ queries go direct to Supabase (RLS ensures users see only their own).
 * WRITE (send) goes through the Netlify backend so it can:
 *   - Check per-user preferences before inserting
 *   - Fan out to email / WhatsApp in Phase 2f
 *   - Use the service role key (not exposed to the frontend)
 *
 * @see docs/ARCHITECTURE.md §10-Realtime
 * @see docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules
 * @see docs/PHASE_PLAN.md §Phase-2c
 */

import { supabase }                     from '@lib/supabase';
import { logger }                       from '@lib/logger';
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
 * Fetch the most recent notifications for the current user.
 * Results are ordered newest-first and capped at PAGE_SIZE.
 */
export async function getMyNotifications(
  userId: string,
  signal?: AbortSignal,
): Promise<NotificationRow[]> {
  let query = supabase
    .from('notifications')
    .select('id, user_id, type, title, body, is_read, link, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/notifications] getMyNotifications failed', { userId, error });
    throw new Error(error.message);
  }

  // Validate + filter malformed rows rather than crashing
  return (data ?? []).flatMap((row) => {
    const parsed = NotificationRowSchema.safeParse(row);
    if (!parsed.success) {
      logger.warn('[api/notifications] Malformed notification row skipped', {
        row,
        issues: parsed.error.issues,
      });
      return [];
    }
    return [parsed.data];
  });
}

/**
 * Count unread notifications for the current user.
 * Used to drive the bell badge — very hot path on Realtime events.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) {
    logger.error('[api/notifications] getUnreadCount failed', { userId, error });
    return 0;  // degrade gracefully — badge shows 0, not an error
  }

  return count ?? 0;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Mark a single notification as read */
export async function markAsRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);

  if (error) {
    logger.error('[api/notifications] markAsRead failed', { notificationId, error });
    throw new Error(error.message);
  }
}

/** Mark all notifications as read for the current user */
export async function markAllAsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) {
    logger.error('[api/notifications] markAllAsRead failed', { userId, error });
    throw new Error(error.message);
  }
}

/** Delete a single notification */
export async function deleteNotification(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', notificationId);

  if (error) {
    logger.error('[api/notifications] deleteNotification failed', { notificationId, error });
    throw new Error(error.message);
  }
}

/** Delete all notifications for the current user (clear all) */
export async function clearAllNotifications(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('user_id', userId);

  if (error) {
    logger.error('[api/notifications] clearAllNotifications failed', { userId, error });
    throw new Error(error.message);
  }
}

/**
 * Send a notification. Delegates to the Netlify backend so the service role
 * key is never exposed to the frontend and preferences are checked server-side.
 */
export async function sendNotification(payload: SendNotificationPayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'sendNotification',
    payload as unknown as Record<string, unknown>,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to send notification.');
}

// ── Preferences ───────────────────────────────────────────────────────────────

/**
 * Get all notification preferences for the current user.
 * Returns defaults (all enabled) for any type not in the DB.
 */
export async function getMyPreferences(
  userId: string,
  signal?: AbortSignal,
): Promise<NotificationPreferenceRow[]> {
  let query = supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId);

  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/notifications] getMyPreferences failed', { userId, error });
    return [];  // degrade to defaults
  }

  return (data ?? []).flatMap((row) => {
    const parsed = NotificationPreferenceSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Update a single notification preference for the current user */
export async function updateMyPreference(
  userId:  string,
  payload: UpdatePreferencePayload,
): Promise<void> {
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      { user_id: userId, ...payload },
      { onConflict: 'user_id,type' },
    );

  if (error) {
    logger.error('[api/notifications] updateMyPreference failed', { userId, payload, error });
    throw new Error(error.message);
  }
}
