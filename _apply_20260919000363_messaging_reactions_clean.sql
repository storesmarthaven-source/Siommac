
create table if not exists public.message_post_reactions (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.message_posts(id) on delete cascade,
  user_id    text not null references public.app_users(id) on delete cascade,
  emoji      text not null check (btrim(emoji) <> '' and char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  unique (post_id, user_id, emoji)
);

create index if not exists mpr_post_idx on public.message_post_reactions(post_id);

alter table public.message_post_reactions enable row level security;

create or replace function public.messaging_toggle_reaction_tx(
  p_post_id  uuid,
  p_actor_id text,
  p_emoji    text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_post     public.message_posts%rowtype;
  v_thread   public.message_threads%rowtype;
  v_now      timestamptz := now();
  v_version  bigint;
  v_emoji    text;
  v_existing uuid;
  v_action   text;
  v_count    int;
begin
  if p_post_id is null then
    raise exception 'messaging_reaction: post_id is required' using errcode = 'MG400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'messaging_reaction: actor_id is required' using errcode = 'MG400';
  end if;
  v_emoji := btrim(coalesce(p_emoji, ''));
  if v_emoji = '' or char_length(v_emoji) > 16 then
    raise exception 'messaging_reaction: a 1-16 character emoji is required' using errcode = 'MG400';
  end if;

  select * into v_post from public.message_posts where id = p_post_id for update;
  if not found then
    raise exception 'messaging_reaction: post % not found', p_post_id using errcode = 'MG404';
  end if;
  if v_post.deleted_at is not null then
    raise exception 'messaging_reaction: deleted messages cannot be reacted to' using errcode = 'MG403';
  end if;
  if coalesce(v_post.is_system, false) or coalesce(v_post.post_type, '') = 'system_event' then
    raise exception 'messaging_reaction: system messages cannot be reacted to' using errcode = 'MG403';
  end if;

  select * into v_thread from public.message_threads where id = v_post.thread_id for update;
  if not found then
    raise exception 'messaging_reaction: thread % not found', v_post.thread_id using errcode = 'MG404';
  end if;
  if coalesce(v_thread.legal_hold, false) then
    raise exception 'messaging_reaction: this thread is under legal hold' using errcode = 'MG403';
  end if;
  if v_thread.thread_type = 'system' then
    raise exception 'messaging_reaction: system threads are controlled records' using errcode = 'MG403';
  end if;

  if not exists (
    select 1 from public.message_participants
     where thread_id = v_thread.id and user_id = p_actor_id and removed_at is null) then
    raise exception 'messaging_reaction: % is not an active participant', p_actor_id using errcode = 'MG403';
  end if;

  select id into v_existing from public.message_post_reactions
   where post_id = p_post_id and user_id = p_actor_id and emoji = v_emoji;

  if v_existing is not null then
    delete from public.message_post_reactions where id = v_existing;
    v_action := 'removed';
  else
    insert into public.message_post_reactions (post_id, user_id, emoji)
    values (p_post_id, p_actor_id, v_emoji);
    v_action := 'added';
  end if;

  select count(*) into v_count from public.message_post_reactions
   where post_id = p_post_id and emoji = v_emoji;

  update public.message_threads
     set version = version + 1
   where id = v_thread.id
  returning version into v_version;

  insert into public.message_event_outbox
    (event_type, thread_id, actor_id, payload, created_at)
  values
    ('message.reaction', v_thread.id, p_actor_id,
     jsonb_build_object('postId', p_post_id, 'emoji', v_emoji, 'action', v_action,
                        'count', v_count, 'threadVersion', v_version),
     v_now);

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    ('communications.message.reaction', 'communications', 'message_thread', v_thread.id::text,
     p_actor_id, 'info',
     jsonb_build_object('postId', p_post_id, 'emoji', v_emoji, 'action', v_action,
                        'threadVersion', v_version),
     null);

  return jsonb_build_object('postId', p_post_id, 'emoji', v_emoji, 'action', v_action,
                            'count', v_count, 'threadVersion', v_version);
end
$fn$;

revoke all on function public.messaging_toggle_reaction_tx(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.messaging_toggle_reaction_tx(uuid, text, text)
  to service_role;
