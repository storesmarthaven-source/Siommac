-- =============================================================================
-- Siomac — Link existing app_users to Supabase Auth
--
-- ⚠️  DO NOT USE THIS SQL FILE TO CREATE auth.users ROWS DIRECTLY.
--
-- Inserting into auth.users via SQL skips the auth.identities table and
-- other internal Supabase bookkeeping, which causes ALL auth API calls to
-- return "Database error querying schema" (HTTP 500).
--
-- Instead, use the Node.js script which calls the Admin API:
--
--   node supabase/recreate-auth-users.js
--
-- The script:
--   1. Reads all app_users that have no auth_id (or need repair)
--   2. Creates each user via POST /auth/v1/admin/users  (handles identities)
--   3. Updates app_users.auth_id with the new Supabase UUID
--
-- This file is kept only as documentation and for the verification query below.
-- =============================================================================

-- ── Verification: run this in SQL Editor to confirm all users are linked ──────

SELECT
  a.username,
  a.role,
  a.auth_email,
  a.auth_id IS NOT NULL             AS auth_linked,
  u.email_confirmed_at IS NOT NULL  AS email_confirmed
FROM public.app_users a
LEFT JOIN auth.users u ON u.id = a.auth_id
ORDER BY a.role, a.username;
