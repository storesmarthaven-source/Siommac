
create schema if not exists msg_internal;

create or replace function msg_internal.is_message_thread_participant(p_thread_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.message_participants p
     where p.thread_id::text = p_thread_id
       and p.user_id = (select auth.jwt()->>'sub')
       and p.removed_at is null
  );
$$;

revoke all on schema msg_internal from public, anon;
grant usage on schema msg_internal to authenticated, service_role;
revoke all on function msg_internal.is_message_thread_participant(text) from public, anon;
grant execute on function msg_internal.is_message_thread_participant(text) to authenticated, service_role;

drop policy if exists "siomac typing read" on realtime.messages;
create policy "siomac typing read" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() like 'siomac:typing:%'
    and split_part(realtime.topic(), ':', 4) = ''
    and msg_internal.is_message_thread_participant(split_part(realtime.topic(), ':', 3))
  );

drop policy if exists "siomac typing write" on realtime.messages;
create policy "siomac typing write" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and realtime.topic() like 'siomac:typing:%'
    and split_part(realtime.topic(), ':', 4) = ''
    and msg_internal.is_message_thread_participant(split_part(realtime.topic(), ':', 3))
  );

drop function if exists public.is_message_thread_participant(text, text);

notify pgrst, 'reload schema';
