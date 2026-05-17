-- ============================================================
-- Siomac — Row Level Security Policies
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- AFTER setting SUPABASE_ANON_KEY in your Netlify environment.
--
-- These policies protect every table so that even if the anon
-- key is exposed, an attacker cannot read or modify data.
-- The Lambda's service-role key bypasses RLS — that key must
-- stay secret and be used only for privileged server operations.
-- ============================================================

-- ── Enable RLS on every table ─────────────────────────────────
ALTER TABLE app_users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_sites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_site_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_approvals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_replies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_rates       ENABLE ROW LEVEL SECURITY;

-- ── Drop existing policies (idempotent re-run) ────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ============================================================
-- DENY ALL by default — no policy = no access via anon key.
-- The service-role key is exempt from RLS entirely, so the
-- Lambda can still read/write everything it needs to.
-- The policies below are safety nets for the anon client
-- and any future direct-to-Supabase client calls.
-- ============================================================

-- ── settings — public read (company name, logo, work hours) ──
-- The frontend reads settings before login (logo, company name).
CREATE POLICY "settings_public_read"
  ON settings FOR SELECT
  USING (key IN ('companyName', 'companyLogoUrl', 'currency', 'workHours'));

-- ── All other tables: NO anon access ─────────────────────────
-- The Lambda (service-role) handles all authenticated access.
-- Anon key is only used for the public settings read above.
-- Add more policies here as you introduce direct client auth.

-- ============================================================
-- Storage bucket policies
-- Set these in Supabase Dashboard → Storage → [bucket] → Policies
-- OR via the SQL below (storage.objects table).
-- ============================================================

-- profile-photos: only service role can read/write
-- (signed URLs are generated server-side with service key)

-- attendance-photos: only service role can read/write

-- branding: public read (logo URL is embedded in the UI)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('branding', 'branding', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

-- Ensure profile-photos and attendance-photos are private
INSERT INTO storage.buckets (id, name, public)
  VALUES ('profile-photos', 'profile-photos', false)
  ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('attendance-photos', 'attendance-photos', false)
  ON CONFLICT (id) DO UPDATE SET public = false;

-- ============================================================
-- Environment variable checklist (Netlify Dashboard)
-- Settings → Environment Variables → Add variable
-- ============================================================
-- SUPABASE_URL              (already set)
-- SUPABASE_SERVICE_ROLE_KEY (already set — keep secret)
-- SUPABASE_ANON_KEY         ← ADD THIS (safe to expose, RLS enforced)
-- JWT_SECRET                (already set)
-- APP_TZ                    (already set or defaults to America/Port_of_Spain)
-- ALLOWED_ORIGINS           e.g. https://your-site.netlify.app
-- ============================================================
