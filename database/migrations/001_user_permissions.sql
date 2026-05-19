-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001 — user_permissions table
--
-- PURPOSE:
--   Stores per-user permission overrides for the RBAC system.
--   Each row either grants or revokes a specific permission for one user,
--   taking precedence over the role defaults in src/lib/permissions.ts.
--
-- USAGE:
--   Apply via Supabase SQL editor or the CLI:
--     supabase db push
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.user_permissions;
--
-- @see docs/ARCHITECTURE.md §9-Authentication-&-Session
-- @see docs/PHASE_PLAN.md §Phase-2b
-- @see docs/SECURITY.md §3-RBAC
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id    UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  permission TEXT         NOT NULL,
  granted    BOOLEAN      NOT NULL DEFAULT true,
  set_by     TEXT         NOT NULL,   -- username of superadmin who set this
  set_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id, permission),
  CONSTRAINT user_permissions_key_format CHECK (
    permission ~ '^[a-z_]+\.[a-z_]+$'
  )
);

COMMENT ON TABLE public.user_permissions IS
  'Per-user RBAC overrides. Rows here take precedence over role defaults. '
  'Managed only by superadmins via the permissions.manage capability.';

COMMENT ON COLUMN public.user_permissions.granted IS
  'true = permission explicitly granted (even if role default denies it). '
  'false = permission explicitly revoked (even if role default grants it).';

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Fast lookup by user_id — the primary use case (load all overrides for one user)
CREATE INDEX IF NOT EXISTS user_permissions_user_idx
  ON public.user_permissions (user_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Superadmins can read all overrides
CREATE POLICY "superadmin_read_all_permissions"
  ON public.user_permissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role = 'superadmin'
        AND status = 'active'
    )
  );

-- Users can read their own overrides (needed for the frontend can() check)
CREATE POLICY "user_read_own_permissions"
  ON public.user_permissions
  FOR SELECT
  USING (user_id = auth.uid());

-- Only superadmins can insert / update / delete overrides
CREATE POLICY "superadmin_manage_permissions"
  ON public.user_permissions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role = 'superadmin'
        AND status = 'active'
    )
  );

-- ── Audit trigger (optional — recommended for enterprise compliance) ───────────

CREATE OR REPLACE FUNCTION public.fn_permission_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.activity_logs (
    user_id, username, action, entity, entity_id, details, created_at
  )
  SELECT
    NEW.user_id,
    NEW.set_by,
    TG_OP,
    'user_permissions',
    NEW.user_id::text,
    json_build_object(
      'permission', NEW.permission,
      'granted',    NEW.granted
    )::text,
    now()
  ;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_permission_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_permission_audit();
