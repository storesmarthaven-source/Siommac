-- ============================================================================
-- Messaging audit finding #5 — authenticated realtime for communication_signals
-- SUPERSEDES the held migration 20260919000350 (never applied): that version
-- required an authenticated realtime connection that did not exist yet, and its
-- policy used auth.uid() whose UUID cast explodes on TEXT app_users ids.
--
-- PREREQUISITES (RUNBOOK_REALTIME_AUTH.md — do NOT apply before these):
--   1. SUPABASE_JWT_SECRET configured in the server env (dashboard JWT secret).
--   2. Server + frontend deployed with the realtime-token flow
--      (lib/realtimeAuth.ts + summary realtimeToken + useRealtimeSignals setAuth).
--   3. node scripts/verify-realtime-auth.mjs phase A green.
-- After applying: NOTIFY pgrst, 'reload schema'; re-run the verify script
-- (phase A green + phase B anon-denied green).
-- ============================================================================

-- 1. Drop the permissive read-for-everyone policy (from 20260628100000).
drop policy if exists "realtime read communication_signals" on public.communication_signals;

-- 2. Authenticated, ownership-scoped read. The realtime JWT carries the TEXT
--    app user id in sub (auth.jwt()->>'sub' — NEVER auth.uid(), whose ::uuid
--    cast fails on ids like USR-001). A user may read only signal rows for
--    channel keys currently issued to them.
create policy "realtime read own communication_signals"
  on public.communication_signals
  for select
  to authenticated
  using (
    channel_key in (
      select urc.channel_key
        from public.user_realtime_channels urc
       where urc.user_id = (auth.jwt() ->> 'sub')
         and urc.expires_at > now()
    )
  );

-- 3. Table grants must match: authenticated may select (rows filtered by the
--    policy above); anon loses read entirely.
revoke select on public.communication_signals from anon;
grant  select on public.communication_signals to authenticated;

-- 4. The policy subquery runs as the realtime reader — allow it to see ONLY
--    its own channel rows on user_realtime_channels.
alter table public.user_realtime_channels enable row level security;
drop policy if exists "own realtime channel" on public.user_realtime_channels;
create policy "own realtime channel"
  on public.user_realtime_channels
  for select
  to authenticated
  using (user_id = (auth.jwt() ->> 'sub'));
revoke select on public.user_realtime_channels from anon;
grant  select on public.user_realtime_channels to authenticated;

-- 5. Keep the table in the realtime publication (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname    = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'communication_signals'
  ) then
    alter publication supabase_realtime add table public.communication_signals;
  end if;
end $$;
