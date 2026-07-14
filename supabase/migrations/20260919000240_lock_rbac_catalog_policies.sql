-- ============================================================================
-- SECURITY: remove permissive read policies on roles + role_permissions
-- ============================================================================
-- These two RBAC-catalogue tables have RLS ENABLED but carry a permissive SELECT
-- policy (added outside migrations — likely the dashboard) that lets the ANON key
-- read the entire role list + role→permission grants. Confirmed live: anon
-- `select * from role_permissions` returned the catalogue. That is information
-- disclosure of the whole authorization model. (Writes were already RLS-blocked.)
--
-- The backend reads these via the SERVICE-ROLE key (bypasses RLS) and the frontend
-- never queries them directly (grep-verified: no browser `from('roles')` /
-- `from('role_permissions')`), so they need NO policies. Dropping every policy
-- leaves RLS-on + deny-all for anon/authenticated.
--
-- NOTE: user_permissions is intentionally NOT touched here — the FE auth flow
-- (src/api/auth.ts) reads it via the browser client, so it needs a scoped
-- read-own policy, a separate follow-up (it is currently empty → low exposure).
-- Operator-applied; idempotent. After applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

do $$
declare p record;
begin
  for p in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public' and tablename in ('roles','role_permissions')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
    raise notice 'dropped policy % on public.%', p.policyname, p.tablename;
  end loop;

  -- Belt-and-suspenders: ensure RLS stays on (no policies ⇒ deny all non-service-role).
  alter table public.roles            enable row level security;
  alter table public.role_permissions enable row level security;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
-- Verify: anon `select * from role_permissions limit 1` must now return ZERO rows.
