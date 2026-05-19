-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — notifications table
--
-- PURPOSE:
--   Persistent, per-user notification store. Supabase Realtime fires on INSERT
--   so the frontend bell badge updates ≤ 2s after any triggering event.
--
-- NOTIFICATION TYPES (matches src/store/notifications.ts NotificationType):
--   attendance_late, attendance_absent, attendance_missed_checkout
--   leave_approved, leave_rejected, leave_pending
--   payroll_published
--   system_announcement
--   mention
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.notifications;
--
-- @see docs/ARCHITECTURE.md §10-Realtime
-- @see docs/PHASE_PLAN.md §Phase-2c
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type         TEXT         NOT NULL,
  title        TEXT         NOT NULL,
  body         TEXT         NOT NULL DEFAULT '',
  link         TEXT,                    -- optional deep-link section id or URL
  is_read      BOOLEAN      NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT notifications_type_check CHECK (
    type IN (
      'attendance_late', 'attendance_absent', 'attendance_missed_checkout',
      'leave_approved',  'leave_rejected',    'leave_pending',
      'payroll_published',
      'system_announcement',
      'mention'
    )
  )
);

COMMENT ON TABLE public.notifications IS
  'Per-user notification inbox. Rows inserted server-side; Realtime pushes to '
  'the frontend. Read state stored in this table (not localStorage).';

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Primary read pattern: all notifications for a user, newest first
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

-- Unread count query (very hot path — badge refresh on every Realtime event)
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, is_read)
  WHERE is_read = false;

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users see only their own notifications
CREATE POLICY "user_read_own_notifications"
  ON public.notifications
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can mark their own notifications as read
CREATE POLICY "user_update_own_notifications"
  ON public.notifications
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can delete (clear) their own notifications
CREATE POLICY "user_delete_own_notifications"
  ON public.notifications
  FOR DELETE
  USING (user_id = auth.uid());

-- Server (service role) can insert notifications for any user
-- (INSERT is handled by backend functions using SUPABASE_SERVICE_ROLE_KEY)
CREATE POLICY "service_insert_notifications"
  ON public.notifications
  FOR INSERT
  WITH CHECK (true);   -- service role bypasses RLS anyway; policy for clarity

-- ── notification_preferences table ───────────────────────────────────────────
-- Per-user, per-type opt-in/out. Checked by the backend before inserting.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id      UUID    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  -- Future Phase 2f: delivery channels
  in_app       BOOLEAN NOT NULL DEFAULT true,
  email        BOOLEAN NOT NULL DEFAULT false,
  whatsapp     BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id, type)
);

COMMENT ON TABLE public.notification_preferences IS
  'Per-user notification opt-in/out by type. Defaults to all enabled. '
  'email / whatsapp columns are Phase 2f delivery hooks.';

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_manage_own_preferences"
  ON public.notification_preferences
  FOR ALL
  USING (user_id = auth.uid());

-- ── Auto-cleanup: keep only last 90 days per user ─────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_cleanup_old_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE user_id = NEW.user_id
    AND created_at < now() - INTERVAL '90 days';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_old_notifications
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.fn_cleanup_old_notifications();
