
create or replace function public.is_message_thread_participant(p_thread_id text, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.message_participants p
     where p.thread_id::text = p_thread_id
       and p.user_id         = p_user_id
       and p.removed_at is null
  );
$$;

revoke all    on function public.is_message_thread_participant(text, text) from public, anon;
grant execute on function public.is_message_thread_participant(text, text) to authenticated, service_role;

drop policy if exists "siomac presence read"  on realtime.messages;
create policy "siomac presence read" on realtime.messages
  for select to authenticated
  using (extension in ('presence', 'broadcast') and realtime.topic() = 'siomac:presence');

drop policy if exists "siomac presence write" on realtime.messages;
create policy "siomac presence write" on realtime.messages
  for insert to authenticated
  with check (extension in ('presence', 'broadcast') and realtime.topic() = 'siomac:presence');

drop policy if exists "siomac typing read" on realtime.messages;
create policy "siomac typing read" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() like 'siomac:typing:%'
    and public.is_message_thread_participant(
          split_part(realtime.topic(), ':', 3),
          (select auth.jwt()->>'sub'))
  );

drop policy if exists "siomac typing write" on realtime.messages;
create policy "siomac typing write" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and realtime.topic() like 'siomac:typing:%'
    and public.is_message_thread_participant(
          split_part(realtime.topic(), ':', 3),
          (select auth.jwt()->>'sub'))
  );
