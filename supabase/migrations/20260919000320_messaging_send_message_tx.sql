-- ============================================================================
-- Messaging P0 — Atomic send-message RPC (Track 1, migration 3/6)
-- Depends on: 20260919000300, 20260919000310
-- Contract:   netlify/functions/lib/messaging/MESSAGING_P0_CONTRACT.md
-- Operator-applied; idempotent (create or replace). After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- Replaces the non-atomic postMessage in communications.ts.
-- ONE TRANSACTION: lock thread → validate membership → idempotency check →
--   validate reply target → lock+verify attachments → increment seq+version →
--   insert post → link attachments → update thread summary → delivery receipts →
--   outbox + app_event.
-- Post-commit: TS wrapper calls deliverEventNotifications + emitSignal.
-- ============================================================================

create or replace function public.messaging_send_message_tx(
  p_thread_id        uuid,
  p_actor_id         text,   -- app_users.id (TEXT)
  p_body             text,   -- null allowed if attachment present
  p_priority         text,   -- 'normal'|'important'|'urgent'|'action_required'
  p_reply_to_post_id uuid,   -- null = not a reply
  p_attachment_ids   jsonb,  -- ["uuid",...] — must be scan_status='clean' + uploaded_by=actor
  p_client_msg_key   text    -- client UUID for idempotency; null = no dedup
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_thread        public.message_threads%rowtype;
  v_part          public.message_participants%rowtype;
  v_existing_post public.message_posts%rowtype;
  v_att           public.message_attachments%rowtype;
  v_att_id        uuid;
  v_seq           bigint;
  v_version       bigint;
  v_post_id       uuid;
  v_event_id      uuid;
  v_now           timestamptz := now();
  v_preview       text;
  v_att_count     int;
  v_priority_safe text;
  v_active_ids    text[];
begin
  -- ── 0. Required inputs ─────────────────────────────────────────────────────
  if p_thread_id is null then
    raise exception 'messaging_send_message: thread_id is required' using errcode = 'MG400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'messaging_send_message: actor_id is required' using errcode = 'MG400';
  end if;
  v_att_count := coalesce(jsonb_array_length(p_attachment_ids), 0);
  if p_body is null and v_att_count = 0 then
    raise exception 'messaging_send_message: body or at least one attachment is required'
      using errcode = 'MG400';
  end if;
  v_priority_safe := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  if v_priority_safe not in ('normal','important','urgent','action_required') then
    raise exception 'messaging_send_message: invalid priority %', v_priority_safe using errcode = 'MG400';
  end if;

  -- ── 1. Lock thread row (serializes concurrent sends; prevents ABA races) ──
  select * into v_thread from public.message_threads where id = p_thread_id for update;
  if not found then
    raise exception 'messaging_send_message: thread % not found', p_thread_id
      using errcode = 'MG404';
  end if;

  -- ── 2. Idempotency: check for an existing post with this client key ────────
  -- The partial unique index on (thread_id, author_user_id, client_idempotency_key)
  -- also prevents duplicate inserts racing past this check.
  if p_client_msg_key is not null and btrim(p_client_msg_key) <> '' then
    select * into v_existing_post
      from public.message_posts
     where thread_id              = p_thread_id
       and author_user_id         = p_actor_id
       and client_idempotency_key = p_client_msg_key;
    if found then
      -- Return the stored result — idempotent re-delivery.
      return jsonb_build_object(
        'postId',         v_existing_post.id,
        'sequence',       v_existing_post.sequence,
        'threadVersion',  v_thread.version,
        'duplicate',      true
      );
    end if;
  end if;

  -- ── 3. Verify actor is an active participant ───────────────────────────────
  select * into v_part
    from public.message_participants
   where thread_id = p_thread_id and user_id = p_actor_id and removed_at is null;
  if not found then
    raise exception 'messaging_send_message: % is not an active participant in thread %',
      p_actor_id, p_thread_id using errcode = 'MG403';
  end if;

  -- ── 4. Validate reply target ───────────────────────────────────────────────
  if p_reply_to_post_id is not null then
    if not exists (
      select 1 from public.message_posts
       where id = p_reply_to_post_id and thread_id = p_thread_id
    ) then
      raise exception 'messaging_send_message: reply target % not found in thread %',
        p_reply_to_post_id, p_thread_id using errcode = 'MG404';
    end if;
  end if;

  -- ── 5. Lock + validate attachments before incrementing sequence ───────────
  for v_att_id in
    select (u::text)::uuid
      from jsonb_array_elements_text(coalesce(p_attachment_ids, '[]'::jsonb)) u
  loop
    select * into v_att from public.message_attachments where id = v_att_id for update;
    if not found then
      raise exception 'messaging_send_message: attachment % not found', v_att_id
        using errcode = 'MG404';
    end if;
    if v_att.uploaded_by is distinct from p_actor_id then
      raise exception 'messaging_send_message: attachment % is owned by a different user', v_att_id
        using errcode = 'MG403';
    end if;
    if v_att.post_id is not null then
      raise exception 'messaging_send_message: attachment % is already linked to a post', v_att_id
        using errcode = 'MG409';
    end if;
    if coalesce(v_att.scan_status, 'pending') <> 'clean' then
      raise exception 'messaging_send_message: attachment % scan_status=% (must be clean)',
        v_att_id, coalesce(v_att.scan_status, 'pending') using errcode = 'MG422';
    end if;
  end loop;

  -- ── 6. Atomically increment sequence + version ─────────────────────────────
  update public.message_threads
     set next_message_sequence = next_message_sequence + 1,
         version               = version + 1
   where id = p_thread_id
  returning next_message_sequence, version into v_seq, v_version;

  -- ── 7. Insert post ─────────────────────────────────────────────────────────
  insert into public.message_posts
    (thread_id, author_user_id, body, is_system, post_type, priority,
     attachment_count, reply_to_post_id,
     sequence, client_idempotency_key,
     created_at, delivery_status)
  values
    (p_thread_id, p_actor_id, p_body, false, 'message', v_priority_safe,
     v_att_count, p_reply_to_post_id,
     v_seq, nullif(btrim(coalesce(p_client_msg_key, '')), ''),
     v_now, 'sent')
  returning id into v_post_id;

  -- ── 8. Link attachments ────────────────────────────────────────────────────
  for v_att_id in
    select (u::text)::uuid
      from jsonb_array_elements_text(coalesce(p_attachment_ids, '[]'::jsonb)) u
  loop
    update public.message_attachments set post_id = v_post_id where id = v_att_id;
  end loop;

  -- ── 9. Update thread summary ───────────────────────────────────────────────
  v_preview := coalesce(
    left(p_body, 140),
    case when v_att_count > 0
         then v_att_count || ' attachment' || case when v_att_count > 1 then 's' else '' end
         else ''
    end,
    ''
  );
  update public.message_threads
     set last_post_at      = v_now,
         last_post_preview = v_preview,
         -- action_required is sticky: once set it stays (cleared explicitly by a route)
         action_required   = (v_priority_safe = 'action_required' or action_required)
   where id = p_thread_id;

  -- ── 10. Delivery receipts for all OTHER active participants ─────────────────
  -- Bounded by the current participant set (no unbounded IN-list). ON CONFLICT is safe
  -- because (post_id, user_id) is the PK of message_post_receipts.
  insert into public.message_post_receipts (post_id, user_id, delivered_at)
  select v_post_id, mp.user_id, v_now
    from public.message_participants mp
   where mp.thread_id  = p_thread_id
     and mp.user_id   <> p_actor_id
     and mp.removed_at is null
  on conflict (post_id, user_id) do nothing;

  -- ── 11. Fetch active participant IDs (for post-commit emitSignal) ──────────
  select array_agg(mp.user_id)
    into v_active_ids
    from public.message_participants mp
   where mp.thread_id  = p_thread_id
     and mp.removed_at is null;

  -- ── 12. Transactional outbox row ────────────────────────────────────────────
  insert into public.message_event_outbox
    (event_type, thread_id, actor_id, payload, created_at)
  values
    ('message.created', p_thread_id, p_actor_id,
     jsonb_build_object(
       'postId',         v_post_id,
       'sequence',       v_seq,
       'threadVersion',  v_version,
       'participantIds', to_jsonb(v_active_ids)
     ),
     v_now);

  -- ── 13. app_events row (in-txn intent; delivery post-commit by TS wrapper) ──
  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    ('communications.message.received', 'communications', 'message_thread', p_thread_id::text,
     p_actor_id, 'info',
     jsonb_build_object(
       'postId',        v_post_id,
       'sequence',      v_seq,
       'threadVersion', v_version
     ),
     -- Per-message dedupe: no de-duplication of the notification itself (each message is unique)
     'comms.msg.received:' || p_thread_id::text || ':' || v_post_id::text)
  returning id into v_event_id;

  return jsonb_build_object(
    'postId',             v_post_id,
    'sequence',           v_seq,
    'threadVersion',      v_version,
    'eventId',            v_event_id,
    'activeParticipantIds', to_jsonb(v_active_ids)
  );
end
$fn$;

-- Grant: service_role only.
revoke all on function public.messaging_send_message_tx(
  uuid, text, text, text, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.messaging_send_message_tx(
  uuid, text, text, text, uuid, jsonb, text
) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
