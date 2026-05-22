-- ============================================================
-- Siomac — Phase 4: TOTP Two-Factor Authentication
-- Run this in the Supabase SQL editor BEFORE deploying Phase 4.
--
-- Policy:
--   • admin / manager — 2FA is MANDATORY (enforced server-side)
--   • employee        — 2FA is OPTIONAL  (user can enrol / unenrol)
-- ============================================================

-- ── 1. Add 2FA columns to app_users ──────────────────────────
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS totp_secret       text        NULL,        -- AES-256-encrypted TOTP secret
  ADD COLUMN IF NOT EXISTS totp_enabled      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_enrolled_at  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS backup_codes      text[]      NULL;        -- bcrypt-hashed backup codes (array of 8)

-- ── 2. Pre-auth / setup challenge table ──────────────────────
-- Stores short-lived tokens issued AFTER password check but
-- BEFORE TOTP verification (or first-time setup). This token
-- grants zero application access — it only permits calling
-- /verify2fa or /setup2fa endpoints.
CREATE TABLE IF NOT EXISTS totp_challenges (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,  -- text, not uuid (app_users.id is 'USR-XXXXXXXX')
  token_hash    text        NOT NULL UNIQUE,   -- SHA-256 of the plaintext challenge token
  type          text        NOT NULL CHECK (type IN ('verify', 'setup')),
  attempt_count int         NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_totp_challenges_user_id    ON totp_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_totp_challenges_token_hash ON totp_challenges(token_hash);
CREATE INDEX IF NOT EXISTS idx_totp_challenges_expires_at ON totp_challenges(expires_at);

-- ── 3. Enable RLS on new table ────────────────────────────────
ALTER TABLE totp_challenges ENABLE ROW LEVEL SECURITY;
-- Default-deny: only the service-role Lambda can read/write.

-- ── 4. Scheduled cleanup (add manually in Dashboard) ─────────
-- Dashboard → Database → Scheduled jobs → New job
--
-- Job: Prune expired 2FA challenges (daily at 03:10 UTC)
--   Name:     prune_totp_challenges
--   Schedule: 10 3 * * *
--   SQL:      DELETE FROM totp_challenges WHERE expires_at < now();

-- ── 5. Verify ────────────────────────────────────────────────
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'app_users'
  AND column_name IN ('totp_secret', 'totp_enabled', 'totp_enrolled_at', 'backup_codes')
ORDER BY column_name;

SELECT table_name, row_security
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name   = 'totp_challenges';
-- Expected: row_security = 'ENABLED'
