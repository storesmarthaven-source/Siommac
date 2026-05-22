-- =============================================================================
-- Phase 6 — Notification tables
--
-- Run AFTER migrate-to-supabase-auth.sql and rls-v2.sql.
-- Safe to re-run — all statements are idempotent.
--
-- Note: user_id is TEXT (matches app_users.id format 'USR-XXXXXXXX'),
--       NOT uuid. RLS uses get_my_app_user_id() from rls-v2.sql.
-- =============================================================================

-- ── notifications ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text    NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  type       text    NOT NULL,
  title      text    NOT NULL,
  body       text    NOT NULL DEFAULT '',
  is_read    boolean NOT NULL DEFAULT false,
  link       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx
  ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_id_is_read_idx
  ON public.notifications(user_id, is_read)
  WHERE is_read = false;

-- ── notification_preferences ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id  text    NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  type     text    NOT NULL,
  enabled  boolean NOT NULL DEFAULT true,
  in_app   boolean NOT NULL DEFAULT true,
  email    boolean NOT NULL DEFAULT false,
  whatsapp boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, type)
);

CREATE INDEX IF NOT EXISTS notif_prefs_user_id_idx
  ON public.notification_preferences(user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Policies are defined in rls-v2.sql using get_my_app_user_id().
-- Enable RLS here; the actual policies live in rls-v2.sql.

ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
