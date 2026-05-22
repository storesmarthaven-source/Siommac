-- =============================================================================
-- Siomac — repair-auth-identities.sql
--
-- STATUS: Already applied automatically via Node.js Admin API script.
-- This file is kept as documentation of what was done and as a fallback
-- in case the auth.identities issue recurs.
--
-- Root cause:
--   link-existing-users.sql inserted rows into auth.users directly via SQL.
--   Supabase Auth also requires a row in auth.identities for every user.
--   Without it, ALL auth API calls return "Database error querying schema" (500).
--
-- Fix applied (2026-05-20):
--   - All 22 broken auth.users rows deleted via Admin API
--   - All 22 users recreated via Admin API (which auto-creates auth.identities)
--   - app_users.auth_id updated to new UUIDs
--   - Login verified OK for: admin, manager1, employee1, ervin (real email)
--
-- Default password for all accounts: ChangeMe123!
--
-- If you need to run this manually (e.g. after a schema reset), use the Node
-- script approach instead of raw SQL — the Admin API is the only safe way to
-- create Supabase Auth users because it handles identities, app_metadata,
-- and internal bookkeeping automatically.
--
-- Node.js script to re-run the fix:
--   node supabase/recreate-auth-users.js
-- =============================================================================

-- Verification query — run to confirm all users are correctly linked:

SELECT
  a.username,
  a.role,
  u.email,
  u.email_confirmed_at IS NOT NULL  AS email_confirmed,
  COUNT(i.id) > 0                   AS has_identity,
  a.auth_id = u.id                  AS id_matches
FROM public.app_users a
JOIN      auth.users      u ON u.id      = a.auth_id
LEFT JOIN auth.identities i ON i.user_id = u.id
GROUP BY a.username, a.role, u.email, u.email_confirmed_at, a.auth_id, u.id
ORDER BY a.role, a.username;
