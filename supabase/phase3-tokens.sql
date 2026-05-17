-- ============================================================
-- Siomac — Phase 3: Refresh Token Rotation + Token Revocation
-- Run this in the Supabase SQL editor BEFORE deploying Phase 3.
-- ============================================================

-- ── 1. Refresh tokens table ───────────────────────────────────
-- Stores hashed refresh tokens. Only the SHA-256 hash is stored;
-- the plaintext is never persisted. One row per active session.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,   -- SHA-256 of the plaintext token
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- Auto-delete expired rows (requires pg_cron extension or manual cleanup)
-- Alternative: add a cron job in Supabase Dashboard → Database → Scheduled jobs:
--   DELETE FROM refresh_tokens WHERE expires_at < now();  -- run daily

-- ── 2. Token revocations table ────────────────────────────────
-- Stores JTI values of access tokens that have been explicitly
-- revoked (via logout). Rows can be pruned once revoked_until passes.
-- Access tokens are 15 min; rows can safely be deleted after that.
CREATE TABLE IF NOT EXISTS token_revocations (
  jti           text        PRIMARY KEY,       -- JWT ID claim (uuid)
  revoked_until timestamptz NOT NULL,          -- matches access token exp
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_revocations_until ON token_revocations(revoked_until);

-- Auto-cleanup: delete expired revocations (safe once the token has expired)
-- Add to Supabase scheduled jobs (daily):
--   DELETE FROM token_revocations WHERE revoked_until < now();

-- ── 3. Enable RLS on new tables ───────────────────────────────
ALTER TABLE refresh_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_revocations ENABLE ROW LEVEL SECURITY;

-- Default-deny: only the service-role Lambda can read/write these tables.
-- No anon or user-scoped policies needed.

-- ── 4. Supabase scheduled jobs (add manually in Dashboard) ───
-- Dashboard → Database → Scheduled jobs → New job
--
-- Job 1: Prune expired refresh tokens (daily at 03:00 UTC)
--   Name:     prune_refresh_tokens
--   Schedule: 0 3 * * *
--   SQL:      DELETE FROM refresh_tokens WHERE expires_at < now();
--
-- Job 2: Prune expired token revocations (daily at 03:05 UTC)
--   Name:     prune_token_revocations
--   Schedule: 5 3 * * *
--   SQL:      DELETE FROM token_revocations WHERE revoked_until < now();

-- ── 5. Verify ────────────────────────────────────────────────
SELECT table_name, row_security
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('refresh_tokens', 'token_revocations');
-- Expected: both rows show row_security = 'ENABLED'
