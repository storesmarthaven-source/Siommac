-- ── Trusted Devices — MFA bypass via remembered browser ────────────────────────
-- Phase B3a: auth_trusted_devices + auth_user_security_state
--
-- A trusted device is issued ONLY after a successful TOTP or passkey 2nd-factor
-- (never after backup-code or password-only). It lets a previously-MFA-verified
-- browser skip the 2nd factor for a limited time (TTL varies by role).
--
-- Security design:
--   • The raw deviceId and deviceSecret are NEVER stored — only HMAC-SHA256 hashes
--   • The cookie value carries a signature so the server can verify tampering
--   • The security_stamp ties every trusted-device row to the user's factor state;
--     rotating the stamp (on factor change) atomically invalidates all devices
--   • revoked_at / revoke_reason support explicit, auditable revocation

-- ── auth_trusted_devices ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_trusted_devices (
  id                   text        PRIMARY KEY,                    -- 'TD-<uuid>'
  user_id              text        NOT NULL
                                   REFERENCES app_users(id) ON DELETE CASCADE,
  device_id_hash       text        NOT NULL UNIQUE,               -- HMAC of raw deviceId
  device_secret_hash   text        NOT NULL,                      -- HMAC of raw deviceSecret
  label                text,                                       -- user-visible name
  browser_name         text,                                       -- best-effort parse
  os_name              text,
  device_type          text,
  user_agent_hash      text,                                       -- HMAC of full UA string
  first_ip             text,                                       -- text, not inet
  last_ip              text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_used_at         timestamptz,
  trusted_until        timestamptz NOT NULL,
  created_with_method  text        NOT NULL
                                   CHECK (created_with_method IN ('totp', 'webauthn')),
  security_stamp       text        NOT NULL,                      -- snapshot at creation
  revoked_at           timestamptz,
  revoked_by           text,
  revoke_reason        text,
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_id       ON auth_trusted_devices (user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_device_id_hash ON auth_trusted_devices (device_id_hash);

-- RLS
ALTER TABLE auth_trusted_devices ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own rows
CREATE POLICY "auth_td_select_own" ON auth_trusted_devices
  FOR SELECT
  USING (auth.uid()::text = user_id);

-- Service role handles all writes (no client-side mutations)
CREATE POLICY "auth_td_service_all" ON auth_trusted_devices
  FOR ALL
  USING (auth.role() = 'service_role');

-- ── auth_user_security_state ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_user_security_state (
  user_id                   text        PRIMARY KEY
                                        REFERENCES app_users(id) ON DELETE CASCADE,
  security_stamp            text        NOT NULL,
  password_changed_at       timestamptz,
  strong_factor_changed_at  timestamptz,
  trusted_devices_revoked_at timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE auth_user_security_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_uss_select_own" ON auth_user_security_state
  FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "auth_uss_service_all" ON auth_user_security_state
  FOR ALL
  USING (auth.role() = 'service_role');

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_auth_user_security_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_uss_updated_at ON auth_user_security_state;
CREATE TRIGGER trg_auth_uss_updated_at
  BEFORE UPDATE ON auth_user_security_state
  FOR EACH ROW EXECUTE FUNCTION update_auth_user_security_state_updated_at();
