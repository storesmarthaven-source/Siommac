-- ============================================================
-- Siomac — Phase 10: Active session visibility + remote revoke
-- Run this in the Supabase SQL editor.
--
-- Adds device/context columns to refresh_tokens so a superadmin can see who is
-- logged in and from where, plus a per-user "revocation epoch" so revoking a
-- session forces an immediate logout (access tokens issued before the epoch are
-- rejected) and the user must re-authenticate (fresh 2FA at next login).
-- ============================================================

-- ── 1. Device/context columns on refresh_tokens ──────────────
ALTER TABLE public.refresh_tokens
  ADD COLUMN IF NOT EXISTS user_agent   text        NULL,
  ADD COLUMN IF NOT EXISTS ip_address   text        NULL,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

-- ── 2. Per-user revocation epoch ─────────────────────────────
-- One row per user. Any access token with iat < revoked_at is rejected.
CREATE TABLE IF NOT EXISTS public.session_revocations (
  user_id    text        PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  revoked_by text        NOT NULL DEFAULT 'system'   -- username of the superadmin
);

ALTER TABLE public.session_revocations ENABLE ROW LEVEL SECURITY;
-- Default-deny: only the service-role backend reads/writes this table.

-- ── 3. Verify ────────────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'session_revocations';
-- Expected: 1 row
