-- ============================================================================
-- Slice 1 Part A: Drop over-broad authenticated-read policy on
-- message_thread_access_grants (defect #5).
--
-- The original migration 20260626000001_message_thread_access_grants.sql
-- created:
--   create policy "authenticated read msg access grants"
--     on public.message_thread_access_grants
--     for select using (auth.role() = 'authenticated');
--
-- This allowed ANY logged-in Supabase session to SELECT every compliance
-- grant row, leaking the identity of investigated users, case references,
-- and access windows to anyone with a Supabase anon key.
--
-- The correct model is service-role-only (already in practice: no browser
-- code reads this table; all reads go through the authenticated Netlify
-- backend which uses the service-role client and therefore bypasses RLS).
-- With RLS enabled and no SELECT policy, the default is DENY-ALL to
-- anon/authenticated. Service-role remains unaffected (bypasses RLS).
--
-- Idempotent (DROP IF EXISTS). After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

drop policy if exists "authenticated read msg access grants"
  on public.message_thread_access_grants;

-- RLS stays ENABLED (enabled in the original migration).
-- No replacement SELECT policy.
-- Result: anon/authenticated → deny all; service_role → full access (bypasses RLS).

notify pgrst, 'reload schema';
