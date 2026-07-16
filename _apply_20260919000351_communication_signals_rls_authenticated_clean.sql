
drop policy if exists "realtime read communication_signals" on public.communication_signals;

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

revoke select on public.communication_signals from anon;
grant  select on public.communication_signals to authenticated;

alter table public.user_realtime_channels enable row level security;
drop policy if exists "own realtime channel" on public.user_realtime_channels;
create policy "own realtime channel"
  on public.user_realtime_channels
  for select
  to authenticated
  using (user_id = (auth.jwt() ->> 'sub'));
revoke select on public.user_realtime_channels from anon;
grant  select on public.user_realtime_channels to authenticated;

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
