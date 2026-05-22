-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2g — DB indexes for P95 query performance
--
-- Run in Supabase SQL Editor after deploying Phase 2g.
-- Safe to run multiple times — IF NOT EXISTS guards against duplicates.
--
-- Note: CONCURRENTLY is omitted — Supabase SQL Editor runs inside a transaction
--       block, and CONCURRENTLY cannot run inside a transaction.
--
-- Identified hot paths:
--   • attendance        — filtered by work_date range, username+date
--   • leave_requests    — filtered by status, user_id, date ranges
--   • message_replies   — looked up by parent message_id
--   • notifications     — filtered by user_id + is_read, ordered by created_at
--   • notification_preferences — looked up by user_id
--   • payroll_runs      — filtered by pay_period dates and status
--   • app_users         — looked up by username, department_id, auth_id
-- ─────────────────────────────────────────────────────────────────────────────

-- ── attendance ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_attendance_work_date
  ON public.attendance (work_date);

CREATE INDEX IF NOT EXISTS idx_attendance_username_work_date
  ON public.attendance (username, work_date);

-- ── leave_requests ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leave_requests_status
  ON public.leave_requests (status);

CREATE INDEX IF NOT EXISTS idx_leave_requests_user_id
  ON public.leave_requests (user_id);

CREATE INDEX IF NOT EXISTS idx_leave_requests_from_date
  ON public.leave_requests (from_date);

CREATE INDEX IF NOT EXISTS idx_leave_requests_to_date
  ON public.leave_requests (to_date);

CREATE INDEX IF NOT EXISTS idx_leave_requests_user_status
  ON public.leave_requests (user_id, status);

-- ── message_replies ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_message_replies_message_id
  ON public.message_replies (message_id);

-- ── notifications ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_is_read
  ON public.notifications (user_id, is_read)
  WHERE is_read = false;

-- ── notification_preferences ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id
  ON public.notification_preferences (user_id);

-- ── app_users ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_app_users_username
  ON public.app_users (username);

CREATE INDEX IF NOT EXISTS idx_app_users_department_id
  ON public.app_users (department_id);

-- auth_id lookup — used by requireUser on every authenticated request
CREATE INDEX IF NOT EXISTS idx_app_users_auth_id
  ON public.app_users (auth_id);
