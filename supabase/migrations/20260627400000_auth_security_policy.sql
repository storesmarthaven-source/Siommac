-- Migration: auth_security_policy — DB-backed security policy store
-- Replaces the env-var-only config with a single persistent row that
-- superadmins can update via the Console (POST /api/admin/security/policy/update).
-- The backend still falls back to the compile-time defaults if this table is
-- unreachable, so a DB outage NEVER breaks login or step-up.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_security_policy (
  id                             text      PRIMARY KEY DEFAULT 'default',
  trusted_devices_enabled        boolean   NOT NULL DEFAULT true,
  trusted_device_default_days    int       NOT NULL DEFAULT 30,
  trusted_device_admin_days      int       NOT NULL DEFAULT 14,
  trusted_device_super_admin_days int      NOT NULL DEFAULT 7,
  require_mfa_for_admin          boolean   NOT NULL DEFAULT true,
  require_mfa_for_manager        boolean   NOT NULL DEFAULT true,
  allow_passkey_passwordless     boolean   NOT NULL DEFAULT true,
  allow_passkey_as_second_factor boolean   NOT NULL DEFAULT true,
  step_up_max_age_minutes        int       NOT NULL DEFAULT 10,
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  updated_by                     text,

  -- Single-row guard: only one row (id='default') may ever exist.
  CONSTRAINT auth_security_policy_singleton CHECK (id = 'default')
);

-- ── Seed the default row ──────────────────────────────────────────────────────

INSERT INTO auth_security_policy (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE auth_security_policy ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read the policy (drives UI behaviour and step-up dialog).
CREATE POLICY "auth_security_policy_authenticated_read"
  ON auth_security_policy
  FOR SELECT
  TO authenticated
  USING (true);

-- Only the service role (used by Netlify Functions) may write.
-- No direct browser writes are permitted.
CREATE POLICY "auth_security_policy_service_write"
  ON auth_security_policy
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
