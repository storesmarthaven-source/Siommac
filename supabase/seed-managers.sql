-- ============================================================================
-- Manager setup seed — populate the Roles page with proper managers.
-- ============================================================================
-- Idempotent (safe to re-run) + reviewable. OPERATOR-APPLIED — nothing here runs
-- automatically. Targets EXACT user IDs (from a read-only probe) so the
-- SUPERADMIN OWNER account (USR-9F174AB5, 'Ervin Baptiste'/superadmin) is NEVER
-- touched. Titles + the repurposed 'ervin'-duplicate identity are DEMO values —
-- swap them for real ones anytime, or let the person edit their own profile.
--
-- Photos: real photos are uploaded via the profile UI (presigned → public avatars
-- bucket). Here we only NULL the two broken legacy bare-filename values so those
-- users show clean initials until real photos are uploaded. Damani + Rylon are
-- already NULL (initials). All four land in the Management tier (manager role).
--
-- After applying: NOTIFY pgrst, 'reload schema';  (not strictly needed — data only)
-- ============================================================================

-- Damani Baptiste — employee → manager. Civil Engineer → Project Manager.
update public.app_users
   set role = 'manager',
       position = 'Project Manager'
 where id = 'USR-40397F16'
   and role <> 'superadmin';                 -- guard: never touch a superadmin

-- Darrell Browne — employee → manager. Petroleum Engineer → Site Manager.
-- Also clear the broken legacy photo (bare filename, not a real URL) → initials.
update public.app_users
   set role = 'manager',
       position = 'Site Manager',
       profile_image = null
 where id = 'USR-AF908865'
   and role <> 'superadmin';

-- Repurpose the DUPLICATE 'ervin' employee account (USR-983E7314, Developer) into
-- a different demo manager. This is NOT the superadmin owner (that is USR-9F174AB5).
-- DEMO identity — replace name/username/email with a real person when you have one.
update public.app_users
   set full_name = 'Kern Lewis',
       username = 'Kern',
       email = 'kernlewis@siomac.com',
       role = 'manager',
       position = 'Regional Manager',
       profile_image = null                  -- clear broken legacy photo → initials
 where id = 'USR-983E7314'
   and role <> 'superadmin';

-- Rylon Baptiste (USR-CADF0CB1) is ALREADY a manager (Operations Manager) — no change.
-- The 'manager' role already belongs to the Management tier (role_category = 'management'),
-- so all four appear under Management on the Roles page automatically.

-- Sanity check after applying (should show 4 managers with clean initials/titles):
--   select id, username, full_name, role, position, profile_image
--     from public.app_users
--    where id in ('USR-40397F16','USR-AF908865','USR-983E7314','USR-CADF0CB1');
