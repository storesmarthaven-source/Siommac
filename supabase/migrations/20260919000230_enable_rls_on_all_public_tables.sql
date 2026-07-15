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
  v_exposed_realtime text;
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

  -- Fail CLOSED (review finding #5): a realtime table with RLS OFF is still exposed. It
  -- must NOT be blanket-enabled here (that would deny its anon realtime SELECT and break
  -- delivery) — it needs a SCOPED anon-read policy (20260628100000 pattern). Rather than
  -- finish "successfully" while a public table is left anon-reachable, ABORT: apply that
  -- policy migration first, then re-run this one. This migration therefore can never report
  -- success with an exposed table.
  select string_agg(c.relname, ', ' order by c.relname) into v_exposed_realtime
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    and c.relname = any(v_realtime);
  if v_exposed_realtime is not null then
    raise exception 'RLS-hardening ABORTED: realtime table(s) still exposed with RLS off: %. Apply their scoped anon-read policy first (20260628100000 pattern), then re-run this migration. Refusing to report success while a public table is anon-reachable.', v_exposed_realtime;
  end if;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
-- Verify: with the ANON key, `select * from role_permissions limit 1` must now
-- return ZERO rows (RLS on, no policy) instead of the catalogue.
