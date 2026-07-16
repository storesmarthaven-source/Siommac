create or replace function public.messaging_create_thread_tx(
  p_thread_type         text,
  p_subject             text,
  p_source_module       text,
  p_source_entity_type  text,
  p_source_entity_id    text,
  p_created_by          text,
  p_participant_ids     jsonb,
  p_body                text,
  p_priority            text,
  p_attachment_ids      jsonb,
  p_request_key         text,
  p_client_msg_key      text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_hash          text;
  v_receipt_key   text;
  v_claim         jsonb;
  v_all_ids       text[];
  v_missing       text[];
  v_thread_id     uuid;
  v_seq           bigint  := 1;
  v_version       bigint  := 1;
  v_post_id       uuid;
  v_att_id        uuid;
  v_att           public.message_attachments%rowtype;
  v_event_id      uuid;
  v_now           timestamptz := now();
  v_preview       text;
  v_action_req    boolean;
  v_att_count     int;
  v_priority_safe text;
  v_result        jsonb;
begin
  if p_created_by is null or btrim(p_created_by) = '' then
    raise exception 'messaging_create_thread: created_by is required' using errcode = 'MSG400';
  end if;
  if p_thread_type is null or p_thread_type not in ('direct','group','record','system') then
    raise exception 'messaging_create_thread: invalid thread_type %',
      coalesce(p_thread_type, '(null)') using errcode = 'MSG400';
  end if;
  if p_body is null
     and coalesce(jsonb_array_length(p_attachment_ids), 0) = 0 then
    raise exception 'messaging_create_thread: body or at least one attachment is required'
      using errcode = 'MSG400';
  end if;

  v_priority_safe := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  if v_priority_safe not in ('normal','important','urgent','action_required') then
    raise exception 'messaging_create_thread: invalid priority %', v_priority_safe using errcode = 'MSG400';
  end if;

  if p_request_key is not null and btrim(p_request_key) <> '' then
    v_receipt_key := p_created_by || '|create_thread|' || p_request_key;
    v_hash := md5(
      (jsonb_build_object(
        'type',    p_thread_type,
        'subject', p_subject,
        'creator', p_created_by,
        'parts',   coalesce(p_participant_ids, '[]'::jsonb),
        'body',    p_body,
        'prio',    v_priority_safe
      ))::text
    );
    v_claim := msg_internal._claim_request(v_receipt_key, v_hash);
    if v_claim->>'status' = 'duplicate' then
      return coalesce(v_claim->'result', '{}'::jsonb);
    end if;
  end if;

  if not exists (select 1 from public.app_users where id = p_created_by and status = 'active') then
    raise exception 'messaging_create_thread: creator % is not an active user', p_created_by
      using errcode = 'MSG404';
  end if;

  select array(
    select distinct u
      from jsonb_array_elements_text(coalesce(p_participant_ids, '[]'::jsonb)) u
  ) into v_all_ids;

  if not (p_created_by = any(v_all_ids)) then
    v_all_ids := v_all_ids || array[p_created_by];
  end if;

  select array(
    select uid from unnest(v_all_ids) uid
     where not exists (
       select 1 from public.app_users where id = uid and status = 'active'
     )
  ) into v_missing;

  if array_length(v_missing, 1) is not null and array_length(v_missing, 1) > 0 then
    raise exception 'messaging_create_thread: unknown/inactive participants: %',
      array_to_string(v_missing, ', ') using errcode = 'MSG404';
  end if;

  if p_thread_type = 'direct' then
    if array_length(v_all_ids, 1) <> 2 then
      raise exception 'messaging_create_thread: direct thread requires exactly 2 participants'
        using errcode = 'MSG400';
    end if;
    if exists (
      select 1
        from public.message_threads t
        join public.message_participants mp1
          on mp1.thread_id = t.id and mp1.user_id = v_all_ids[1] and mp1.removed_at is null
        join public.message_participants mp2
          on mp2.thread_id = t.id and mp2.user_id = v_all_ids[2] and mp2.removed_at is null
       where t.thread_type = 'direct'
         and t.archived_at is null
         and (
           select count(*) from public.message_participants mp3
            where mp3.thread_id = t.id and mp3.removed_at is null
         ) = 2
    ) then
      raise exception 'messaging_create_thread: an active direct thread between these users already exists'
        using errcode = 'MSG409';
    end if;
  end if;

  v_att_count  := coalesce(jsonb_array_length(p_attachment_ids), 0);
  v_preview    := coalesce(left(p_body, 140), '');
  v_action_req := (v_priority_safe = 'action_required');

  insert into public.message_threads
    (thread_type, subject, source_module, source_entity_type, source_entity_id,
     created_by, created_at,
     last_post_at, last_post_preview,
     action_required, priority,
     next_message_sequence, version)
  values
    (p_thread_type, p_subject, p_source_module, p_source_entity_type, p_source_entity_id,
     p_created_by, v_now,
     v_now, v_preview,
     v_action_req, v_priority_safe,
     v_seq,
     v_version)
  returning id into v_thread_id;

  insert into public.message_participants (thread_id, user_id, role, joined_at)
  select
    v_thread_id,
    uid,
    case when uid = p_created_by then 'owner' else 'participant' end,
    v_now
  from unnest(v_all_ids) as uid
  on conflict (thread_id, user_id) do update
    set removed_at = null,
        joined_at  = excluded.joined_at,
        role       = excluded.role;

  insert into public.message_posts
    (thread_id, author_user_id, body, is_system, post_type, priority,
     attachment_count, sequence, client_idempotency_key,
     created_at, delivery_status)
  values
    (v_thread_id, p_created_by, p_body, false, 'message', v_priority_safe,
     v_att_count, v_seq, p_client_msg_key,
     v_now, 'sent')
  returning id into v_post_id;

  for v_att_id in
    select (u::text)::uuid
      from jsonb_array_elements_text(coalesce(p_attachment_ids, '[]'::jsonb)) u
  loop
    select * into v_att from public.message_attachments where id = v_att_id for update;
    if not found then
      raise exception 'messaging_create_thread: attachment % not found', v_att_id
        using errcode = 'MSG404';
    end if;
    if v_att.uploaded_by is distinct from p_created_by then
      raise exception 'messaging_create_thread: attachment % is owned by a different user', v_att_id
        using errcode = 'MSG403';
    end if;
    if v_att.post_id is not null then
      raise exception 'messaging_create_thread: attachment % is already linked to a post', v_att_id
        using errcode = 'MSG409';
    end if;
    if coalesce(v_att.scan_status, 'pending') <> 'clean' then
      raise exception 'messaging_create_thread: attachment % scan_status=% (must be clean)',
        v_att_id, coalesce(v_att.scan_status, 'pending') using errcode = 'MSG422';
    end if;
    update public.message_attachments set post_id = v_post_id where id = v_att_id;
  end loop;

  insert into public.message_event_outbox
    (event_type, thread_id, actor_id, payload, created_at)
  values
    ('thread.created', v_thread_id, p_created_by,
     jsonb_build_object(
       'threadId',       v_thread_id,
       'postId',         v_post_id,
       'sequence',       v_seq,
       'participantIds', to_jsonb(v_all_ids),
       'priority',       v_priority_safe
     ),
     v_now);

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    ('communications.thread.created', 'communications', 'message_thread', v_thread_id::text,
     p_created_by, 'info',
     jsonb_build_object(
       'threadId',       v_thread_id,
       'postId',         v_post_id,
       'threadType',     p_thread_type,
       'participantIds', to_jsonb(v_all_ids)
     ),
     'comms.thread.created:' || v_thread_id::text)
  returning id into v_event_id;

  if p_request_key is not null and btrim(p_request_key) <> '' then
    v_result := jsonb_build_object(
      'threadId',             v_thread_id,
      'postId',               v_post_id,
      'sequence',             v_seq,
      'threadVersion',        v_version,
      'eventId',              v_event_id,
      'activeParticipantIds', to_jsonb(v_all_ids)
    );
    perform msg_internal._record_request(
      v_receipt_key, v_hash, 'create_thread',
      p_created_by, v_thread_id, v_post_id::text, v_result
    );
    return v_result;
  end if;

  return jsonb_build_object(
    'threadId',             v_thread_id,
    'postId',               v_post_id,
    'sequence',             v_seq,
    'threadVersion',        v_version,
    'eventId',              v_event_id,
    'activeParticipantIds', to_jsonb(v_all_ids)
  );
end
$fn$;

revoke all on function public.messaging_create_thread_tx(
  text, text, text, text, text, text, jsonb, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.messaging_create_thread_tx(
  text, text, text, text, text, text, jsonb, text, text, jsonb, text, text
) to service_role;
