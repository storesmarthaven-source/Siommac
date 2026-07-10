-- ============================================================
-- Siomac — Phase 8: Per-user permission overrides (RBAC grants)
-- Run this in the Supabase SQL editor.
--
-- A superadmin can grant or revoke a single capability for one user
-- without changing their role. Resolution at runtime:
--   1. user_permissions row (granted true/false)   ← highest priority
--   2. role default (ROLE_PERMISSIONS in code)
--   3. deny
-- ============================================================

-- ── 1. Table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id     text        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  permission  text        NOT NULL,           -- e.g. 'employees.edit' (resource.action)
  granted     boolean     NOT NULL,           -- true = explicitly allow, false = explicitly deny
  set_by      text        NOT NULL DEFAULT 'system',  -- username of the superadmin who set it
  set_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id, permission),
  -- Catalogue keys are 2+ dot-separated [a-z_] segments (e.g. 'settings.view',
  -- 'finance.statutory.approve', 'finance.payroll.nis.verify'). The original
  -- two-segment-only regex rejected every 3+ segment key.
  CONSTRAINT user_permissions_key_format
    CHECK (permission ~ '^[a-z_]+(\.[a-z_]+)+$')
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON public.user_permissions(user_id);

-- ── 2. RLS ───────────────────────────────────────────────────
-- All writes go through the backend using the service-role key (bypasses RLS).
-- Authenticated users may read their own overrides (loaded at login).
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_permissions_read_own" ON public.user_permissions;
CREATE POLICY "user_permissions_read_own"
  ON public.user_permissions
  FOR SELECT
  USING (true);

-- ── 3. Verify ────────────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'user_permissions';
-- Expected: 1 row
