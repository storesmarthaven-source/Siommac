-- ============================================================================
-- Messaging P0 — Atomic create-thread RPC (Track 1, migration 2/6)
-- Depends on: 20260919000300_messaging_p0_foundation.sql
--             20260919000320_messaging_send_message_tx.sql (append path)
--             20260919000360_messaging_direct_thread_reconciliation.sql (pair key)
-- Contract:   netlify/functions/lib/messaging/MESSAGING_P0_CONTRACT.md
-- Operator-applied; idempotent (create or replace). After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- Replaces the non-atomic createMessageThread in communications.ts.
-- Direct threads use GET-OR-CREATE semantics (one canonical thread per pair):
--   serialize on the sorted participant pair, reuse the canonical thread when one
--   exists (appending the supplied initial message + attachments to it via
--   messaging_send_message_tx), otherwise create it. Returns a `created` flag.
--   The mt_direct_pair_uidx partial unique index is the DB-level backstop.
-- Group/record/system threads are always created fresh.
-- ONE TRANSACTION; the TS wrapper handles post-commit notification delivery only.
-- ============================================================================

create or replace function public.messaging_create_thread_tx(
  p_thread_type         text,         -- 'direct'|'group'|'record'|'system'
  p_subject             text,         -- null OK for direct (derives from participant names in UI)
  p_source_module       text,         -- null for non-record threads
  p_source_entity_type  text,
  p_source_entity_id    text,
  p_created_by          text,         -- app_users.id (TEXT, not UUID)
  p_participant_ids     jsonb,        -- array of TEXT user IDs excluding creator
  p_body                text,         -- first post body; null allowed if attachment present
  p_priority            text,         -- 'normal'|'important'|'urgent'|'action_required'
  p_attachment_ids      jsonb,        -- ["uuid",...] — must be scan_status='clean' + uploaded_by=creator
  p_request_key         text,         -- client UUID for thread-level idempotency (null = no dedup)
  p_client_msg_key      text          -- client UUID for first-post idempotency (null = no dedup)
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
  v_pair_key      text;
  v_existing_id   uuid;
  v_send          jsonb;
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
    raise exception 'messaging_create_thread: created_by is required' using errcode = 'MG400';
  end if;
  if p_thread_type is null or p_thread_type not in ('direct','group','record','system') then
    raise exception 'messaging_create_thread: invalid thread_type %',
      coalesce(p_thread_type, '(null)') using errcode = 'MG400';
  end if;
  if p_body is null
     and coalesce(jsonb_array_length(p_attachment_ids), 0) = 0 then
    raise exception 'messaging_create_thread: body or at least one attachment is required'
      using errcode = 'MG400';
  end if;

  v_priority_safe := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  if v_priority_safe not in ('normal','important','urgent','action_required') then
    raise exception 'messaging_create_thread: invalid priority %', v_priority_safe using errcode = 'MG400';
  end if;

  -- Idempotency: request-key receipt wraps BOTH the reuse and the create paths.
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
      using errcode = 'MG404';
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
      array_to_string(v_missing, ', ') using errcode = 'MG404';
  end if;

  -- DIRECT: get-or-create. Serialize on the sorted pair so concurrent calls
  -- resolve to one thread; reuse the canonical thread if it exists (appending the
  -- initial message + attachments), otherwise fall through to the create path.
  if p_thread_type = 'direct' then
    if array_length(v_all_ids, 1) <> 2 then
      raise exception 'messaging_create_thread: direct thread requires exactly 2 participants'
        using errcode = 'MG400';
    end if;
    v_pair_key := least(v_all_ids[1], v_all_ids[2]) || '|' || greatest(v_all_ids[1], v_all_ids[2]);
    perform pg_advisory_xact_lock(hashtextextended('msg_direct:' || v_pair_key, 0));

    select id into v_existing_id
      from public.message_threads
     where thread_type = 'direct' and direct_pair_key = v_pair_key
     limit 1;

    if v_existing_id is not null then
      v_send := public.messaging_send_message_tx(
        v_existing_id, p_created_by, p_body, v_priority_safe,
        null, coalesce(p_attachment_ids, '[]'::jsonb), p_client_msg_key
      );
      v_result := jsonb_build_object(
        'threadId',             v_existing_id,
        'postId',               v_send->>'postId',
        'sequence',             (v_send->>'sequence')::bigint,
        'threadVersion',        (v_send->>'threadVersion')::bigint,
        'eventId',              v_send->>'eventId',
        'created',              false,
        'activeParticipantIds', coalesce(v_send->'activeParticipantIds', to_jsonb(v_all_ids))
      );
      if p_request_key is not null and btrim(p_request_key) <> '' then
        perform msg_internal._record_request(
          v_receipt_key, v_hash, 'create_thread',
          p_created_by, v_existing_id, (v_send->>'postId'), v_result
        );
      end if;
      return v_result;
    end if;
  end if;

  -- CREATE path (direct with no canonical thread yet, or group/record/system).
  v_att_count  := coalesce(jsonb_array_length(p_attachment_ids), 0);
  v_preview    := coalesce(left(p_body, 140), '');
  v_action_req := (v_priority_safe = 'action_required');

  insert into public.message_threads
    (thread_type, subject, source_module, source_entity_type, source_entity_id,
     created_by, created_at,
     last_post_at, last_post_preview,
     action_required, priority,
     next_message_sequence, version, direct_pair_key)
  values
    (p_thread_type, p_subject, p_source_module, p_source_entity_type, p_source_entity_id,
     p_created_by, v_now,
     v_now, v_preview,
     v_action_req, v_priority_safe,
     v_seq, v_version,
     case when p_thread_type = 'direct' then v_pair_key else null end)
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
        using errcode = 'MG404';
    end if;
    if v_att.uploaded_by is distinct from p_created_by then
      raise exception 'messaging_create_thread: attachment % is owned by a different user', v_att_id
        using errcode = 'MG403';
    end if;
    if v_att.post_id is not null then
      raise exception 'messaging_create_thread: attachment % is already linked to a post', v_att_id
        using errcode = 'MG409';
    end if;
    if coalesce(v_att.scan_status, 'pending') <> 'clean' then
      raise exception 'messaging_create_thread: attachment % scan_status=% (must be clean)',
        v_att_id, coalesce(v_att.scan_status, 'pending') using errcode = 'MG422';
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

  v_result := jsonb_build_object(
    'threadId',             v_thread_id,
    'postId',               v_post_id,
    'sequence',             v_seq,
    'threadVersion',        v_version,
    'eventId',              v_event_id,
    'created',              true,
    'activeParticipantIds', to_jsonb(v_all_ids)
  );

  if p_request_key is not null and btrim(p_request_key) <> '' then
    perform msg_internal._record_request(
      v_receipt_key, v_hash, 'create_thread',
      p_created_by, v_thread_id, v_post_id::text, v_result
    );
  end if;

  return v_result;
end
$fn$;

revoke all on function public.messaging_create_thread_tx(
  text, text, text, text, text, text, jsonb, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.messaging_create_thread_tx(
  text, text, text, text, text, text, jsonb, text, text, jsonb, text, text
) to service_role;
