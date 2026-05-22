-- =============================================================================
-- Siomac — RLS v2 (Supabase Auth)
--
-- Run AFTER migrate-to-supabase-auth.sql.
-- Replaces the old deny-all policies with real per-user scoping using auth.uid().
--
-- Strategy:
--   auth.uid() returns the uuid of the logged-in auth.users row.
--   We map it to app_users.id via the auth_id column:
--     get_my_app_user_id() → text ('USR-XXXXXXXX')
--
-- The Netlify backend uses the SERVICE ROLE key (bypasses RLS entirely).
-- These policies govern direct Supabase JS client calls from the frontend.
-- =============================================================================

-- ── Helper: map auth.uid() → app_users.id ────────────────────────────────────
-- Used by every RLS policy instead of repeating the subquery.
-- SECURITY DEFINER so it can read app_users even when the calling policy
-- would otherwise block it.

CREATE OR REPLACE FUNCTION public.get_my_app_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.app_users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- ── Helper: get role of the calling user ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.app_users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- ── Helper: get department_id of the calling user ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_department_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT department_id FROM public.app_users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- ── Drop all existing policies (idempotent re-run) ────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM   pg_policies
    WHERE  schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ── Enable RLS on every table ─────────────────────────────────────────────────
-- Core tables (always exist after schema.sql)
ALTER TABLE public.app_users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_sites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads            ENABLE ROW LEVEL SECURITY;

-- Migration-gated tables — only enable RLS if the table exists
DO $$
BEGIN
  -- add_project_site_employees migration
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_site_employees') THEN
    ALTER TABLE public.project_site_employees ENABLE ROW LEVEL SECURITY;
  END IF;
  -- add_payroll_approvals migration
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payroll_approvals') THEN
    ALTER TABLE public.payroll_approvals ENABLE ROW LEVEL SECURITY;
  END IF;
  -- messaging tables (Phase 2d)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
    ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message_replies') THEN
    ALTER TABLE public.message_replies ENABLE ROW LEVEL SECURITY;
  END IF;
  -- support ticket tables (Phase 2e)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_tickets') THEN
    ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_replies') THEN
    ALTER TABLE public.ticket_replies ENABLE ROW LEVEL SECURITY;
  END IF;
  -- notification tables (phase6-notifications.sql)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notification_preferences') THEN
    ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
  END IF;
  -- NOTE: hourly_rates is NOT a table — hourly rate data lives on app_users.hourly_rate column
END $$;

-- ── settings — public read for a small set of keys ───────────────────────────
CREATE POLICY "settings_public_read"
  ON public.settings FOR SELECT
  USING (key IN ('companyName', 'companyLogoUrl', 'currency', 'workHours'));

-- ── app_users ─────────────────────────────────────────────────────────────────
-- Everyone reads their own row; admin/manager read all.
CREATE POLICY "app_users_read_own"
  ON public.app_users FOR SELECT
  USING (auth_id = auth.uid());

CREATE POLICY "app_users_admin_read_all"
  ON public.app_users FOR SELECT
  USING (get_my_role() IN ('admin', 'manager'));

CREATE POLICY "app_users_update_own"
  ON public.app_users FOR UPDATE
  USING (auth_id = auth.uid());

-- ── departments — all authenticated users can read ───────────────────────────
CREATE POLICY "departments_auth_read"
  ON public.departments FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── project_sites — all authenticated users can read ─────────────────────────
CREATE POLICY "project_sites_auth_read"
  ON public.project_sites FOR SELECT
  USING (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_site_employees') THEN
    EXECUTE $p$ CREATE POLICY "project_site_employees_auth_read"
      ON public.project_site_employees FOR SELECT
      USING (auth.uid() IS NOT NULL) $p$;
  END IF;
END $$;

-- ── attendance ────────────────────────────────────────────────────────────────
-- Employees see own rows; managers see their department; admins see all.
CREATE POLICY "attendance_read_own"
  ON public.attendance FOR SELECT
  USING (user_id = get_my_app_user_id());

CREATE POLICY "attendance_manager_read_dept"
  ON public.attendance FOR SELECT
  USING (
    get_my_role() = 'manager'
    AND EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = attendance.user_id
        AND u.department_id = get_my_department_id()
    )
  );

CREATE POLICY "attendance_admin_read_all"
  ON public.attendance FOR SELECT
  USING (get_my_role() = 'admin');

-- ── leave_requests ────────────────────────────────────────────────────────────
CREATE POLICY "leave_read_own"
  ON public.leave_requests FOR SELECT
  USING (user_id = get_my_app_user_id());

CREATE POLICY "leave_manager_read_dept"
  ON public.leave_requests FOR SELECT
  USING (
    get_my_role() = 'manager'
    AND department_id = get_my_department_id()
  );

CREATE POLICY "leave_admin_read_all"
  ON public.leave_requests FOR SELECT
  USING (get_my_role() = 'admin');

-- ── messages — users see messages they sent or received ──────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
    EXECUTE $p$ CREATE POLICY "messages_read_own"
      ON public.messages FOR SELECT
      USING (
        from_user_id = get_my_app_user_id()
        OR to_user_id = get_my_app_user_id()
        OR to_user_id IS NULL
      ) $p$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message_replies') THEN
    EXECUTE $p$ CREATE POLICY "message_replies_read"
      ON public.message_replies FOR SELECT
      USING (auth.uid() IS NOT NULL) $p$;
  END IF;
END $$;

CREATE POLICY "message_reads_own"
  ON public.message_reads FOR SELECT
  USING (user_id = get_my_app_user_id());

-- ── support tickets ───────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_tickets') THEN
    EXECUTE $p$ CREATE POLICY "tickets_read_own"
      ON public.support_tickets FOR SELECT
      USING (from_user_id = get_my_app_user_id()) $p$;
    EXECUTE $p$ CREATE POLICY "tickets_admin_read_all"
      ON public.support_tickets FOR SELECT
      USING (get_my_role() IN ('admin', 'manager')) $p$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_replies') THEN
    EXECUTE $p$ CREATE POLICY "ticket_replies_read"
      ON public.ticket_replies FOR SELECT
      USING (auth.uid() IS NOT NULL) $p$;
  END IF;
END $$;

-- ── notifications ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    EXECUTE $p$ CREATE POLICY "notifications_read_own"
      ON public.notifications FOR SELECT
      USING (user_id = get_my_app_user_id()) $p$;
    EXECUTE $p$ CREATE POLICY "notifications_update_own"
      ON public.notifications FOR UPDATE
      USING (user_id = get_my_app_user_id()) $p$;
  END IF;
END $$;

-- ── notification_preferences ──────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notification_preferences') THEN
    EXECUTE $p$ CREATE POLICY "notif_prefs_read_own"
      ON public.notification_preferences FOR SELECT
      USING (user_id = get_my_app_user_id()) $p$;
    EXECUTE $p$ CREATE POLICY "notif_prefs_upsert_own"
      ON public.notification_preferences FOR INSERT
      WITH CHECK (user_id = get_my_app_user_id()) $p$;
    EXECUTE $p$ CREATE POLICY "notif_prefs_update_own"
      ON public.notification_preferences FOR UPDATE
      USING (user_id = get_my_app_user_id()) $p$;
  END IF;
END $$;

-- NOTE: hourly_rates is not a table — rate data lives on app_users.hourly_rate column.
-- No policy needed.

-- ── activity_logs — admin only ────────────────────────────────────────────────
CREATE POLICY "activity_logs_admin_read"
  ON public.activity_logs FOR SELECT
  USING (get_my_role() = 'admin');

-- ── payroll_approvals — admin/manager read ───────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payroll_approvals') THEN
    EXECUTE $p$ CREATE POLICY "payroll_approvals_admin_read"
      ON public.payroll_approvals FOR SELECT
      USING (get_my_role() IN ('admin', 'manager')) $p$;
    -- Employees read their own approved payslips
    EXECUTE $p$ CREATE POLICY "payroll_approvals_employee_read_own"
      ON public.payroll_approvals FOR SELECT
      USING (user_id = get_my_app_user_id() AND status = 'approved') $p$;
  END IF;
END $$;

-- ── Storage bucket policies ───────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('branding', 'branding', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('profile-photos', 'profile-photos', false)
  ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('attendance-photos', 'attendance-photos', false)
  ON CONFLICT (id) DO UPDATE SET public = false;
