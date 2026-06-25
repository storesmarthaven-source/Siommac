-- ─────────────────────────────────────────────────────────────────────────────
-- Make the realtime "instant update" path actually work.
--
-- The FE (useRealtimeSignals) subscribes to postgres_changes on
-- communication_signals to refresh the unread badges + thread highlights the
-- moment a message/notification arrives. Supabase Realtime only delivers a row
-- change to a browser when BOTH are true:
--   1. the table is in the `supabase_realtime` publication, and
--   2. RLS lets the subscribing client (anon key) SELECT the row.
-- The original migration did neither (it only left a comment), so the browser
-- subscription connected but never received anything — badges/highlights only
-- refreshed on the 2-min poll. Signal rows carry NO business data or PII (just
-- channel_key, domain, created_at), so anon SELECT is safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Publish the table for Realtime (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'communication_signals'
  ) then
    alter publication supabase_realtime add table public.communication_signals;
  end if;
end $$;

-- 2. Allow the realtime client to read signal rows (no PII; required for delivery).
drop policy if exists "realtime read communication_signals" on public.communication_signals;
create policy "realtime read communication_signals"
  on public.communication_signals
  for select
  to anon, authenticated
  using (true);
