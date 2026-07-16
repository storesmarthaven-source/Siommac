create or replace function public.messaging_add_participants_tx(
  p_thread_id  uuid,
  p_actor_id   text,
  p_user_ids   jsonb,
  p_actor_role text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_thread      public.message_threads%rowtype;
  v_actor_part  public.message_participants%rowtype;
  v_can_manage  boolean := false;
  v_uid         text;
  v_to_add      text[];
  v_added       text[];
  v_now         timestamptz := now();
  v_active_ids  text[];
  v_event_id    uuid;
  v_actor_name  text;
  v_added_names text;
  v_post_id     uuid;
begin
  if p_thread_id is null then
    raise exception 'messaging_add_participants: thread_id is required' using errcode = 'MSG400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'messaging_add_participants: actor_id is required' using errcode = 'MSG400';
  end if;

  select * into v_thread from public.message_threads where id = p_thread_id for update;
  if not found then
    raise exception 'messaging_add_participants: thread % not found', p_thread_id
      using errcode = 'MSG404';
  end if;

  if v_thread.thread_type = 'direct' then
    raise exception 'messaging_add_participants: direct message participants cannot be modified'
      using errcode = 'MSG409';
  end if;

  select * into v_actor_part
    from public.message_participants
   where thread_id = p_thread_id and user_id = p_actor_id and removed_at is null;

  v_can_manage := (v_actor_part.role = 'owner');

  if not v_can_manage then
    v_can_manage := exists (
      select 1 from public.user_permissions
       where user_id = p_actor_id and permission_key = 'communications.admin'
         and is_granted = true
    );
  end if;

  if not v_can_manage then
    raise exception 'messaging_add_participants: % is not allowed to add participants (must be owner or admin)',
      p_actor_id using errcode = 'MSG403';
  end if;

  select array(
    select distinct uid
      from jsonb_array_elements_text(coalesce(p_user_ids, '[]'::jsonb)) uid
     where uid <> p_actor_id
  ) into v_to_add;

  declare
    v_missing text[];
  begin
    select array(
      select uid from unnest(v_to_add) uid
       where not exists (select 1 from public.app_users where id = uid and status = 'active')
    ) into v_missing;
    if array_length(v_missing, 1) is not null and array_length(v_missing, 1) > 0 then
      raise exception 'messaging_add_participants: unknown/inactive users: %',
        array_to_string(v_missing, ', ') using errcode = 'MSG404';
    end if;
  end;

  v_added := '{}'::text[];
  foreach v_uid in array coalesce(v_to_add, '{}'::text[])
  loop
    insert into public.message_participants (thread_id, user_id, role, joined_at)
    values (p_thread_id, v_uid, 'participant', v_now)
    on conflict (thread_id, user_id) do update
      set removed_at = null,
          joined_at  = case when message_participants.removed_at is not null then v_now
                            else message_participants.joined_at end,
          role       = case when message_participants.role = 'owner' then 'owner'
                            else 'participant' end;
    v_added := v_added || v_uid;
  end loop;

  if array_length(v_added, 1) is null or array_length(v_added, 1) = 0 then
    select array_agg(user_id) into v_active_ids
      from public.message_participants
     where thread_id = p_thread_id and removed_at is null;
    return jsonb_build_object('addedUserIds', '[]'::jsonb, 'activeParticipantIds', to_jsonb(v_active_ids));
  end if;

  select coalesce(full_name, email, 'Someone') into v_actor_name
    from public.app_users where id = p_actor_id;

  select string_agg(coalesce(full_name, email, u.id), ', ')
    into v_added_names
    from public.app_users u
   where u.id = any(v_added);

  insert into public.message_posts
    (thread_id, author_user_id, body, is_system, post_type,
     system_event_type, system_event_payload, created_at)
  values
    (p_thread_id, null,
     v_actor_name || ' added ' || v_added_names || ' to the conversation.',
     true, 'system_event', 'participant_added',
     jsonb_build_object(
       'actorUserId',   p_actor_id,
       'actorName',     v_actor_name,
       'addedUserIds',  to_jsonb(v_added),
       'addedUserName', v_added_names
     ),
     v_now)
  returning id into v_post_id;

  select array_agg(user_id) into v_active_ids
    from public.message_participants
   where thread_id = p_thread_id and removed_at is null;

  insert into public.message_event_outbox
    (event_type, thread_id, actor_id, payload, created_at)
  values
    ('participant.added', p_thread_id, p_actor_id,
     jsonb_build_object('addedUserIds', to_jsonb(v_added), 'participantIds', to_jsonb(v_active_ids)),
     v_now);

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    ('communications.participant.added', 'communications', 'message_thread', p_thread_id::text,
     p_actor_id, 'info',
     jsonb_build_object('addedUserIds', to_jsonb(v_added), 'threadId', p_thread_id),
     null)
  returning id into v_event_id;

  return jsonb_build_object(
    'addedUserIds',         to_jsonb(v_added),
    'activeParticipantIds', to_jsonb(v_active_ids),
    'eventId',              v_event_id
  );
end
$fn$;

create or replace function public.messaging_remove_participant_tx(
  p_thread_id      uuid,
  p_actor_id       text,
  p_target_user_id text,
  p_actor_role     text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_thread      public.message_threads%rowtype;
  v_actor_part  public.message_participants%rowtype;
  v_target_part public.message_participants%rowtype;
  v_can_manage  boolean := false;
  v_left        boolean;
  v_now         timestamptz := now();
  v_remaining   text[];
  v_actor_name  text;
  v_target_name text;
  v_event_id    uuid;
begin
  if p_thread_id is null then
    raise exception 'messaging_remove_participant: thread_id is required' using errcode = 'MSG400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'messaging_remove_participant: actor_id is required' using errcode = 'MSG400';
  end if;
  if p_target_user_id is null or btrim(p_target_user_id) = '' then
    raise exception 'messaging_remove_participant: target_user_id is required' using errcode = 'MSG400';
  end if;

  select * into v_thread from public.message_threads where id = p_thread_id for update;
  if not found then
    raise exception 'messaging_remove_participant: thread % not found', p_thread_id
      using errcode = 'MSG404';
  end if;

  if v_thread.thread_type = 'direct' then
    raise exception 'messaging_remove_participant: direct message participants cannot be modified'
      using errcode = 'MSG409';
  end if;

  select * into v_target_part
    from public.message_participants
   where thread_id = p_thread_id and user_id = p_target_user_id;

  if not found or v_target_part.removed_at is not null then
    return jsonb_build_object('left', false, 'alreadyRemoved', true);
  end if;

  v_left := (p_actor_id = p_target_user_id);

  if not v_left then
    select * into v_actor_part
      from public.message_participants
     where thread_id = p_thread_id and user_id = p_actor_id and removed_at is null;

    v_can_manage := (v_actor_part.role = 'owner');
    if not v_can_manage then
      v_can_manage := exists (
        select 1 from public.user_permissions
         where user_id = p_actor_id and permission_key = 'communications.admin'
           and is_granted = true
      );
    end if;
    if not v_can_manage then
      raise exception 'messaging_remove_participant: % cannot remove %',
        p_actor_id, p_target_user_id using errcode = 'MSG403';
    end if;
  end if;

  if v_target_part.role = 'owner' then
    if (
      select count(*) from public.message_participants
       where thread_id = p_thread_id and removed_at is null and role = 'owner'
         and user_id <> p_target_user_id
    ) = 0 then
      raise exception 'messaging_remove_participant: cannot remove the last active owner of thread %',
        p_thread_id using errcode = 'MSG409';
    end if;
  end if;

  update public.message_participants
     set removed_at = v_now
   where thread_id = p_thread_id and user_id = p_target_user_id;

  select coalesce(full_name, email, 'Someone') into v_actor_name
    from public.app_users where id = p_actor_id;
  select coalesce(full_name, email, 'a member') into v_target_name
    from public.app_users where id = p_target_user_id;

  insert into public.message_posts
    (thread_id, author_user_id, body, is_system, post_type,
     system_event_type, system_event_payload, created_at)
  values
    (p_thread_id, null,
     case when v_left
          then v_target_name || ' left the conversation.'
          else v_actor_name  || ' removed ' || v_target_name || ' from the conversation.'
     end,
     true, 'system_event',
     case when v_left then 'participant_left'::text else 'participant_removed'::text end,
     case when v_left
          then jsonb_build_object('userId', p_target_user_id, 'userName', v_target_name)
          else jsonb_build_object(
            'actorUserId', p_actor_id, 'actorName', v_actor_name,
            'removedUserId', p_target_user_id, 'removedUserName', v_target_name
          )
     end,
     v_now);

  select array_agg(user_id) into v_remaining
    from public.message_participants
   where thread_id = p_thread_id and removed_at is null;

  insert into public.message_event_outbox
    (event_type, thread_id, actor_id, payload, created_at)
  values
    (case when v_left then 'participant.left' else 'participant.removed' end,
     p_thread_id, p_actor_id,
     jsonb_build_object('removedUserId', p_target_user_id, 'remainingIds', to_jsonb(v_remaining)),
     v_now);

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    (case when v_left then 'communications.participant.left'
          else 'communications.participant.removed' end,
     'communications', 'message_thread', p_thread_id::text,
     p_actor_id, 'info',
     jsonb_build_object('removedUserId', p_target_user_id, 'threadId', p_thread_id),
     null)
  returning id into v_event_id;

  return jsonb_build_object(
    'left',                 v_left,
    'removedUserId',        p_target_user_id,
    'remainingParticipantIds', to_jsonb(v_remaining),
    'eventId',              v_event_id
  );
end
$fn$;

revoke all on function public.messaging_add_participants_tx(uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.messaging_add_participants_tx(uuid, text, jsonb, text)
  to service_role;

revoke all on function public.messaging_remove_participant_tx(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.messaging_remove_participant_tx(uuid, text, text, text)
  to service_role;
