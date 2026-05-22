-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 7 — Superadmin role + Module permissions system
--
-- Run this in the Supabase SQL editor (once).
--
-- What this does:
--   1. Extends app_users.role CHECK constraint to include 'superadmin'
--   2. Creates module_permissions table — role × module enabled matrix
--   3. Seeds all modules as enabled for admin and manager
--   4. Creates RLS policies (server-side service-role bypasses RLS)
--   5. Creates activity_logs entries for audit trail
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend role CHECK constraint ──────────────────────────────────────────
-- Drop the old constraint and re-add with superadmin included.
ALTER TABLE public.app_users
  DROP CONSTRAINT IF EXISTS app_users_role_check;

ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('superadmin', 'admin', 'manager', 'employee'));

-- ── 2. Module permissions table ───────────────────────────────────────────────
-- One row per (module, role) pair. enabled = false hides that module's
-- nav sections from that role's sidebar.
CREATE TABLE IF NOT EXISTS public.module_permissions (
  module      TEXT        NOT NULL,
  role        TEXT        NOT NULL,
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT        NOT NULL DEFAULT 'system',  -- username of superadmin who last changed it

  CONSTRAINT module_permissions_pkey PRIMARY KEY (module, role),
  CONSTRAINT module_permissions_module_check
    CHECK (module IN ('employees', 'payroll', 'live_map', 'attendance', 'dashboard')),
  CONSTRAINT module_permissions_role_check
    CHECK (role IN ('admin', 'manager'))
  -- employee role is intentionally excluded — their sections are fixed
);

-- ── 3. Seed defaults — all modules enabled for admin and manager ──────────────
INSERT INTO public.module_permissions (module, role, enabled, updated_by) VALUES
  ('dashboard',  'admin',   true, 'system'),
  ('employees',  'admin',   true, 'system'),
  ('payroll',    'admin',   true, 'system'),
  ('live_map',   'admin',   true, 'system'),
  ('attendance', 'admin',   true, 'system'),
  ('dashboard',  'manager', true, 'system'),
  ('employees',  'manager', true, 'system'),
  ('payroll',    'manager', false, 'system'),  -- managers cannot see payroll by default
  ('live_map',   'manager', true, 'system'),
  ('attendance', 'manager', true, 'system')
ON CONFLICT (module, role) DO NOTHING;

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.module_permissions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read module permissions (needed at login to
-- build the sidebar). Service-role key bypasses RLS for writes.
CREATE POLICY "module_permissions_read"
  ON public.module_permissions
  FOR SELECT
  USING (true);

-- No direct writes via anon/user key — all writes go through the backend
-- using the service-role key which bypasses RLS.

-- ── 5. Index for fast role lookup ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_module_permissions_role
  ON public.module_permissions (role);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Next steps:
--   1. Run supabase/create-superadmin.sql to create your first superadmin user
--   2. Restart Netlify Dev — backend picks up the new route
--   3. Log in as superadmin to access the Modules management panel
