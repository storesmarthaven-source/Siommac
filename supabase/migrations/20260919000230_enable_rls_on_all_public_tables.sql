-- ============================================================================
-- SECURITY: enable RLS on every public table that lacks it
-- (Supabase Advisor: rls_disabled_in_public — CRITICAL)
-- ============================================================================
-- A public-schema table with RLS DISABLED is reachable by anyone holding the
-- project's anon key + URL (it's embedded in the frontend) — they can read/write
-- it directly, bypassing the authenticated Netlify JWT API entirely. Confirmed
-- live exposure: `roles` and `role_permissions` (the permission catalogue) were
-- anon-readable — a privilege-escalation vector.
--
-- Spec §3 requires RLS on EVERY table. All ERP data is accessed by the backend
-- via the SERVICE-ROLE key, which BYPASSES RLS — so enabling RLS with NO policies
-- denies the anon/authenticated direct-API path (closing the hole) while the
-- backend keeps working unchanged. Realtime-subscribed tables already have RLS +
-- their own scoped anon-read policies (postgres_changes delivery) and are skipped
-- here so this migration can never remove a needed realtime read path.
--
-- Definitive: loops over the LIVE catalog (relrowsecurity = false), so it fixes
-- exactly the offending tables regardless of which migration created them.
-- Idempotent (re-run enables nothing new). After applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

do $$
declare
  r record;
  -- Tables the browser subscribes to via Supabase Realtime (postgres_changes).
  -- These need an anon/authenticated SELECT policy for delivery and already carry
  -- RLS + that policy; never blanket-deny them here.
  v_realtime constant text[] := array[
    'communication_signals','notifications','attendance','leave_requests',
    'settings','support_tickets','ticket_replies'
  ];
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'                    -- ordinary tables only
      and c.relrowsecurity = false           -- RLS currently OFF
      and not (c.relname = any(v_realtime))
    order by c.relname
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    raise notice 'RLS enabled on public.%', r.relname;
  end loop;

  -- Safety net: if any realtime table is ALSO exposed (RLS off) it is a real hole
  -- too, but it needs a scoped anon-read policy — surface it rather than silently
  -- leaving it, so it gets a proper policy (do NOT blanket-enable without one).
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
      and c.relname = any(v_realtime)
  loop
    raise warning 'REALTIME table public.% has RLS disabled — needs an anon SELECT policy (see 20260628100000 pattern), NOT handled by this migration', r.relname;
  end loop;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
-- Verify: with the ANON key, `select * from role_permissions limit 1` must now
-- return ZERO rows (RLS on, no policy) instead of the catalogue.
