-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 7b — Per-manager module permissions
--
-- Run this in the Supabase SQL editor AFTER phase7-superadmin.sql.
--
-- What this does:
--   1. Creates manager_module_permissions table — user_id × module matrix
--      Each row represents a module explicitly enabled/disabled for ONE manager.
--      Absence of a row = use the role-level default from module_permissions.
--   2. RLS: authenticated users can read; all writes go through service-role.
--   3. Index for fast user_id lookup.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Per-manager module permissions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manager_module_permissions (
  user_id     TEXT        NOT NULL,   -- app_users.id (USR-XXXXXXXX)
  module      TEXT        NOT NULL,
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT        NOT NULL DEFAULT 'system',

  CONSTRAINT manager_module_permissions_pkey PRIMARY KEY (user_id, module),
  CONSTRAINT manager_module_permissions_module_check
    CHECK (module IN ('employees', 'payroll', 'live_map', 'attendance', 'dashboard')),
  CONSTRAINT manager_module_permissions_user_fk
    FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE
);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.manager_module_permissions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (needed at login to build the sidebar).
CREATE POLICY "manager_module_permissions_read"
  ON public.manager_module_permissions
  FOR SELECT
  USING (true);

-- ── 3. Index ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mgr_module_perms_user_id
  ON public.manager_module_permissions (user_id);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Next: restart Netlify Dev — backend picks up new routes automatically.
-- Managers without rows in this table inherit role-level defaults.
