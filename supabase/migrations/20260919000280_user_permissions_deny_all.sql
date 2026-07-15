-- ============================================================================
-- SECURITY: user_permissions deny-all to the browser (review finding #4)
-- ============================================================================
-- The phase-8 policy `user_permissions_read_own` used USING(true) — despite its name it let
-- ANYONE holding the anon key SELECT every row, enumerating all user ids and their sensitive
-- allow/deny permission exceptions (a reconnaissance + privilege-escalation aid).
--
-- The app authenticates with a custom Netlify JWT (NOT Supabase auth), so auth.uid() is null
-- in the browser Supabase client and a self-scoped RLS policy could not work anyway. Per-user
-- override loading now goes through the authenticated backend (/getMyPermissionOverrides —
-- service-role, scoped to the JWT actor), and writes/enumeration go through the gated
-- superadmin RBAC routes. The browser therefore needs NO readable policy at all.
--
-- Drop the permissive policy → RLS-on with no policy = deny-all to anon/authenticated;
-- service_role (backend) bypasses RLS and is unaffected. Idempotent.
-- After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

alter table public.user_permissions enable row level security;   -- ensure enabled
drop policy if exists "user_permissions_read_own" on public.user_permissions;

-- No replacement policy: the ONLY legitimate access path is the service-role backend.
-- Verify: with the ANON key, `select * from user_permissions limit 1` must now return ZERO
-- rows (previously it returned the whole table).
