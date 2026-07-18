-- ============================================================================
-- Messenger Compliance V1: transactional cases, reads, revocation, and closure
-- Depends on 433 and messaging idempotency helpers from 300.
-- ============================================================================

begin;

-- One internal writer for the three evidence records required by every
-- compliance operation. Only safe metadata may be passed in p_details.
create or replace function msg_internal._write_compliance_evidence(
  p_event_type      text,
  p_case_id         uuid,
  p_grant_id        uuid,
  p_thread_id       uuid,
  p_actor_id        text,
  p_request_id      text,
  p_ip_hash         text,
  p_user_agent_hash text,
  p_details         jsonb,
  p_entity_type     text,
  p_entity_id       text,
  p_severity        text default 'warning'
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_event_id uuid;
  v_full_type text := 'communications.compliance.' || p_event_type;
begin
  if p_event_type not in (
    'case_requested', 'case_approved', 'case_rejected',
    'conversation_opened', 'page_read', 'grant_revoked',
    'export_requested', 'export_generated', 'export_downloaded',
    'case_closed'
  ) then
    raise exception 'compliance evidence: invalid event type'
      using errcode = 'MG422';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'compliance evidence: request id is required'
      using errcode = 'MG400';
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'compliance evidence: invalid IP hash'
      using errcode = 'MG422';
  end if;
  if p_user_agent_hash is not null and p_user_agent_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'compliance evidence: invalid user-agent hash'
      using errcode = 'MG422';
  end if;

  insert into public.message_compliance_access_events (
    case_id, grant_id, thread_id, actor_user_id, event_type, request_id,
    ip_hash, user_agent_hash, hash_key_version, details
  ) values (
    p_case_id, p_grant_id, p_thread_id, p_actor_id, p_event_type, p_request_id,
    p_ip_hash, p_user_agent_hash,
    case when p_ip_hash is not null or p_user_agent_hash is not null then 'v1' else null end,
    coalesce(p_details, '{}'::jsonb)
  );

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    v_full_type, 'communications', p_entity_type, p_entity_id,
    p_actor_id, p_severity, coalesce(p_details, '{}'::jsonb),
    v_full_type || ':' || p_request_id
  )
  returning id into v_event_id;

  insert into public.audit_logs (
    action, table_name, record_id, user_id, changes
  ) values (
    v_full_type, p_entity_type, p_entity_id, p_actor_id,
    coalesce(p_details, '{}'::jsonb)
  );

  return v_event_id;
end
$fn$;

revoke all on function msg_internal._write_compliance_evidence(
  text, uuid, uuid, uuid, text, text, text, text, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function msg_internal._write_compliance_evidence(
  text, uuid, uuid, uuid, text, text, text, text, jsonb, text, text, text
) to service_role;

-- Create a pending investigation case. This does not create access grants.
create or replace function public.message_compliance_case_request_tx(
  p_actor_id        text,
  p_title           text,
  p_case_type       text,
  p_reason          text,
  p_valid_until     timestamptz,
  p_threads         jsonb,
  p_idempotency_key text,
  p_ip_hash         text,
  p_user_agent_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_now timestamptz := now();
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_case_id uuid;
  v_case_no text;
  v_event_id uuid;
  v_thread jsonb;
  v_thread_id uuid;
  v_relevance text;
  v_canonical_threads jsonb;
  v_count integer;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_case_request: actor is required'
      using errcode = 'MG400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_case_request: idempotency key is required'
      using errcode = 'MG400';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) then
    raise exception 'message_compliance_case_request: active compliance-read grant required'
      using errcode = 'MG403';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 160 then
    raise exception 'message_compliance_case_request: title must be 3-160 characters'
      using errcode = 'MG422';
  end if;
  if p_case_type not in (
    'hr_investigation', 'safety_investigation', 'legal_request',
    'security_investigation', 'other_formal_investigation'
  ) then
    raise exception 'message_compliance_case_request: invalid case type'
      using errcode = 'MG422';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 2000 then
    raise exception 'message_compliance_case_request: reason must be 10-2000 characters'
      using errcode = 'MG422';
  end if;
  if p_valid_until is null
     or p_valid_until <= v_now
     or p_valid_until > v_now + interval '30 days' then
    raise exception 'message_compliance_case_request: validity must end within 30 days'
      using errcode = 'MG422';
  end if;
  if p_threads is null or jsonb_typeof(p_threads) <> 'array' then
    raise exception 'message_compliance_case_request: threads must be an array'
      using errcode = 'MG422';
  end if;

  v_count := jsonb_array_length(p_threads);
  if v_count < 1 or v_count > 20 then
    raise exception 'message_compliance_case_request: select 1-20 conversations'
      using errcode = 'MG422';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_threads) e(value)
    where jsonb_typeof(e.value) <> 'object'
       or nullif(btrim(e.value->>'threadId'), '') is null
       or btrim(e.value->>'threadId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or char_length(btrim(coalesce(e.value->>'relevanceNote', ''))) not between 5 and 1000
  ) then
    raise exception 'message_compliance_case_request: every conversation needs an id and relevance note'
      using errcode = 'MG422';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'threadId', x.thread_id,
      'relevanceNote', x.relevance_note
    )
    order by x.thread_id::text
  )
  into v_canonical_threads
  from (
    select
      btrim(e.value->>'threadId')::uuid as thread_id,
      btrim(e.value->>'relevanceNote') as relevance_note
    from jsonb_array_elements(p_threads) e(value)
  ) x;

  if (
    select count(distinct nullif(btrim(e.value->>'threadId'), '')::uuid)
    from jsonb_array_elements(p_threads) e(value)
  ) <> v_count then
    raise exception 'message_compliance_case_request: duplicate conversations are not allowed'
      using errcode = 'MG422';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_threads) e(value)
    where not exists (
      select 1
      from public.message_threads mt
      where mt.id = (e.value->>'threadId')::uuid
    )
  ) then
    raise exception 'message_compliance_case_request: one or more conversations do not exist'
      using errcode = 'MG404';
  end if;

  v_request_key := p_actor_id || '|compliance.case_request|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'actorId', p_actor_id,
    'title', btrim(p_title),
    'caseType', p_case_type,
    'reason', btrim(p_reason),
    'validUntil', p_valid_until,
    'threads', v_canonical_threads
  )::text);

  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return (v_claim->'result') || jsonb_build_object('duplicate', true);
  end if;

  v_case_no := 'CMP-' || extract(year from v_now)::integer::text || '-'
    || lpad(public.increment_ref_counter('CMP', extract(year from v_now)::integer)::text, 6, '0');

  insert into public.message_compliance_cases (
    case_no, title, case_type, reason, requested_by, valid_until
  ) values (
    v_case_no, btrim(p_title), p_case_type, btrim(p_reason),
    p_actor_id, p_valid_until
  )
  returning id into v_case_id;

  for v_thread in select value from jsonb_array_elements(p_threads)
  loop
    begin
      v_thread_id := (v_thread->>'threadId')::uuid;
    exception when invalid_text_representation then
      raise exception 'message_compliance_case_request: invalid conversation id'
        using errcode = 'MG422';
    end;
    v_relevance := btrim(v_thread->>'relevanceNote');
    insert into public.message_compliance_case_threads (
      case_id, thread_id, relevance_note, added_by
    ) values (
      v_case_id, v_thread_id, v_relevance, p_actor_id
    );
  end loop;

  v_event_id := msg_internal._write_compliance_evidence(
    'case_requested',
    v_case_id,
    null,
    null,
    p_actor_id,
    v_request_key,
    p_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'caseNo', v_case_no,
      'caseType', p_case_type,
      'conversationCount', v_count,
      'validUntil', p_valid_until
    ),
    'message_compliance_case',
    v_case_id::text,
    'warning'
  );

  perform msg_internal._record_request(
    v_request_key, v_hash, 'compliance.case_request', p_actor_id,
    null, v_case_id::text,
    jsonb_build_object(
      'caseId', v_case_id,
      'caseNo', v_case_no,
      'status', 'pending_approval',
      'eventId', v_event_id,
      'duplicate', false
    )
  );

  return jsonb_build_object(
    'caseId', v_case_id,
    'caseNo', v_case_no,
    'status', 'pending_approval',
    'eventId', v_event_id,
    'duplicate', false
  );
exception
  when invalid_text_representation then
    raise exception 'message_compliance_case_request: invalid conversation id'
      using errcode = 'MG422';
end
$fn$;

-- Approve or reject one pending case. Approval creates one scoped grant per
-- selected conversation for the requester, capped at seven days.
create or replace function public.message_compliance_case_decide_tx(
  p_case_id         uuid,
  p_actor_id        text,
  p_decision        text,
  p_reason          text,
  p_idempotency_key text,
  p_ip_hash         text,
  p_user_agent_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_case public.message_compliance_cases%rowtype;
  v_now timestamptz := now();
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_event_id uuid;
  v_grant_expiry timestamptz;
  v_grant_count integer := 0;
begin
  if p_case_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_case_decide: case and actor are required'
      using errcode = 'MG400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_case_decide: idempotency key is required'
      using errcode = 'MG400';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'message_compliance_case_decide: invalid decision'
      using errcode = 'MG422';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'message_compliance_case_decide: decision reason is required'
      using errcode = 'MG422';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) then
    raise exception 'message_compliance_case_decide: active compliance-read grant required'
      using errcode = 'MG403';
  end if;

  v_request_key := p_actor_id || '|compliance.case_decide|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'caseId', p_case_id,
    'actorId', p_actor_id,
    'decision', p_decision,
    'reason', btrim(p_reason)
  )::text);
  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return (v_claim->'result') || jsonb_build_object('duplicate', true);
  end if;

  select *
    into v_case
    from public.message_compliance_cases
   where id = p_case_id
   for update;
  if not found then
    raise exception 'message_compliance_case_decide: case not found'
      using errcode = 'MG404';
  end if;
  if v_case.status <> 'pending_approval' then
    raise exception 'message_compliance_case_decide: case is %', v_case.status
      using errcode = 'MG409';
  end if;
  if v_case.requested_by = p_actor_id then
    raise exception 'message_compliance_case_decide: requester cannot decide own case'
      using errcode = 'MG403';
  end if;
  if v_case.valid_until <= v_now then
    raise exception 'message_compliance_case_decide: requested validity has elapsed'
      using errcode = 'MG409';
  end if;
  if not exists (
    select 1
    from public.app_users
    where id = v_case.requested_by and status = 'active'
  ) then
    raise exception 'message_compliance_case_decide: requester is no longer active'
      using errcode = 'MG409';
  end if;
  if not exists (
    select 1
    from public.message_compliance_case_threads ct
    join public.message_threads mt on mt.id = ct.thread_id
    where ct.case_id = v_case.id
  ) then
    raise exception 'message_compliance_case_decide: case has no valid conversations'
      using errcode = 'MG409';
  end if;

  if p_decision = 'approve' then
    update public.message_compliance_cases
       set status = 'approved',
           approved_by = p_actor_id,
           approved_at = v_now,
           valid_from = v_now,
           decision_reason = btrim(p_reason)
     where id = v_case.id;

    v_grant_expiry := least(v_case.valid_until, v_now + interval '7 days');

    insert into public.message_thread_access_grants (
      case_id, case_thread_id, thread_id, user_id, granted_by,
      granted_at, expires_at
    )
    select
      ct.case_id, ct.id, ct.thread_id, v_case.requested_by, p_actor_id,
      v_now, v_grant_expiry
    from public.message_compliance_case_threads ct
    where ct.case_id = v_case.id;
    get diagnostics v_grant_count = row_count;
  else
    update public.message_compliance_cases
       set status = 'rejected',
           rejected_by = p_actor_id,
           rejected_at = v_now,
           decision_reason = btrim(p_reason)
     where id = v_case.id;
  end if;

  v_event_id := msg_internal._write_compliance_evidence(
    case when p_decision = 'approve' then 'case_approved' else 'case_rejected' end,
    v_case.id,
    null,
    null,
    p_actor_id,
    v_request_key,
    p_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'caseNo', v_case.case_no,
      'decision', p_decision,
      'grantCount', v_grant_count,
      'validUntil', v_case.valid_until
    ),
    'message_compliance_case',
    v_case.id::text,
    case when p_decision = 'approve' then 'success' else 'warning' end
  );

  perform msg_internal._record_request(
    v_request_key, v_hash, 'compliance.case_decide', p_actor_id,
    null, v_case.id::text,
    jsonb_build_object(
      'caseId', v_case.id,
      'caseNo', v_case.case_no,
      'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
      'grantCount', v_grant_count,
      'eventId', v_event_id,
      'duplicate', false
    )
  );

  return jsonb_build_object(
    'caseId', v_case.id,
    'caseNo', v_case.case_no,
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'grantCount', v_grant_count,
    'eventId', v_event_id,
    'duplicate', false
  );
end
$fn$;

-- Read one bounded message page and record the sensitive access atomically.
create or replace function public.message_compliance_thread_read_tx(
  p_case_id         uuid,
  p_thread_id       uuid,
  p_actor_id        text,
  p_limit           integer,
  p_cursor          text,
  p_idempotency_key text,
  p_ip_hash         text,
  p_user_agent_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_case public.message_compliance_cases%rowtype;
  v_grant public.message_thread_access_grants%rowtype;
  v_thread public.message_threads%rowtype;
  v_now timestamptz := now();
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_cursor_json jsonb;
  v_cursor_sequence bigint;
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
  v_messages jsonb;
  v_next_cursor text;
  v_event_type text;
  v_event_id uuid;
  v_duplicate boolean := false;
  v_page_hash text;
  v_recorded_page_hash text;
  v_disclosure_key text;
begin
  if p_case_id is null or p_thread_id is null
     or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_thread_read: case, conversation, and actor are required'
      using errcode = 'MG400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_thread_read: idempotency key is required'
      using errcode = 'MG400';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'message_compliance_thread_read: limit must be 1-100'
      using errcode = 'MG422';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) then
    raise exception 'message_compliance_thread_read: active compliance-read grant required'
      using errcode = 'MG403';
  end if;

  if p_cursor is not null and btrim(p_cursor) <> '' then
    begin
      v_cursor_json := convert_from(decode(p_cursor, 'base64'), 'utf8')::jsonb;
      v_cursor_sequence := (v_cursor_json->>'sequence')::bigint;
      v_cursor_created_at := (v_cursor_json->>'createdAt')::timestamptz;
      v_cursor_id := (v_cursor_json->>'id')::uuid;
      if v_cursor_sequence is null
         or v_cursor_created_at is null
         or v_cursor_id is null then
        raise exception 'message_compliance_thread_read: invalid cursor';
      end if;
    exception when others then
      raise exception 'message_compliance_thread_read: invalid cursor'
        using errcode = 'MG400';
    end;
  end if;

  select *
    into v_case
    from public.message_compliance_cases
   where id = p_case_id
   for share;
  if not found then
    raise exception 'message_compliance_thread_read: case not found'
      using errcode = 'MG404';
  end if;
  if v_case.status <> 'approved' or v_case.valid_until <= v_now then
    raise exception 'message_compliance_thread_read: case is not active'
      using errcode = 'MG403';
  end if;

  select *
    into v_grant
    from public.message_thread_access_grants
   where case_id = p_case_id
     and thread_id = p_thread_id
     and user_id = p_actor_id
   for update;
  if not found
     or v_grant.revoked_at is not null
     or v_grant.expires_at <= v_now then
    raise exception 'message_compliance_thread_read: active scoped grant required'
      using errcode = 'MG403';
  end if;

  select *
    into v_thread
    from public.message_threads
   where id = p_thread_id
   for share;
  if not found then
    raise exception 'message_compliance_thread_read: conversation not found'
      using errcode = 'MG404';
  end if;

  -- Authorization is deliberately revalidated before idempotency replay. A
  -- revoked or expired grant must never replay a previously-read message page.
  -- The receipt stores metadata only; message bodies are queried fresh below.
  v_request_key := p_actor_id || '|compliance.thread_read|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'caseId', p_case_id,
    'threadId', p_thread_id,
    'actorId', p_actor_id,
    'limit', p_limit,
    'cursor', nullif(btrim(coalesce(p_cursor, '')), '')
  )::text);
  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  v_duplicate := v_claim->>'status' = 'duplicate';
  if v_duplicate then
    v_event_id := nullif(v_claim->'result'->>'eventId', '')::uuid;
    v_recorded_page_hash := nullif(v_claim->'result'->>'pageHash', '');
  end if;

  with page_rows as (
    select
      p.id,
      coalesce(p.sequence, -1) as sort_sequence,
      p.sequence,
      p.author_user_id,
      case when p.deleted_at is null then p.body else null end as body,
      p.is_system,
      p.edited_at,
      p.deleted_at,
      p.created_at,
      coalesce(u.full_name, u.username) as author_name,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'fileName', a.file_name,
            'contentType', a.content_type,
            'sizeBytes', a.size_bytes,
            'attachmentType', a.attachment_type,
            'scanStatus', a.scan_status
          )
          order by a.created_at, a.id
        )
        from public.message_attachments a
        where a.post_id = p.id
      ), '[]'::jsonb) as attachments,
      row_number() over (
        order by coalesce(p.sequence, -1) desc, p.created_at desc, p.id desc
      ) as rn
    from public.message_posts p
    left join public.app_users u on u.id = p.author_user_id
    where p.thread_id = p_thread_id
      and (
        v_cursor_json is null
        or (coalesce(p.sequence, -1), p.created_at, p.id)
           < (v_cursor_sequence, v_cursor_created_at, v_cursor_id)
      )
    order by coalesce(p.sequence, -1) desc, p.created_at desc, p.id desc
    limit p_limit + 1
  ),
  visible_rows as (
    select * from page_rows where rn <= p_limit
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'sequence', r.sequence,
        'author', case
          when r.author_user_id is null then null
          else jsonb_build_object('id', r.author_user_id, 'displayName', r.author_name)
        end,
        'body', r.body,
        'isSystem', r.is_system,
        'editedAt', r.edited_at,
        'deletedAt', r.deleted_at,
        'createdAt', r.created_at,
        'attachments', r.attachments
      )
      order by r.sort_sequence desc, r.created_at desc, r.id desc
    ), '[]'::jsonb),
    case when (select count(*) from page_rows) > p_limit then
      (
        select encode(convert_to(jsonb_build_object(
          'sequence', cursor_row.sort_sequence,
          'createdAt', cursor_row.created_at,
          'id', cursor_row.id
        )::text, 'utf8'), 'base64')
        from page_rows cursor_row
        where cursor_row.rn = p_limit
      )
    else null end
  into v_messages, v_next_cursor
  from visible_rows r;

  v_page_hash := md5(jsonb_build_object(
    'messages', v_messages,
    'nextCursor', v_next_cursor
  )::text);

  if v_duplicate and v_page_hash is distinct from v_recorded_page_hash then
    raise exception 'message_compliance_thread_read: page changed since the original request'
      using errcode = 'MG409';
  end if;

  update public.message_thread_access_grants
     set last_accessed_at = v_now
   where id = v_grant.id;

  -- Idempotency still validates that a client key is not reused for different
  -- inputs, but every successful body disclosure receives its own evidence row.
  -- Reusing a key must never suppress the audit trail for another delivery.
  v_disclosure_key := v_request_key || '|delivery|' || gen_random_uuid()::text;
  v_event_type := case
    when p_cursor is null or btrim(p_cursor) = '' then 'conversation_opened'
    else 'page_read'
  end;
  v_event_id := msg_internal._write_compliance_evidence(
    v_event_type,
    v_case.id,
    v_grant.id,
    v_thread.id,
    p_actor_id,
    v_disclosure_key,
    p_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'caseNo', v_case.case_no,
      'messageCount', jsonb_array_length(v_messages),
      'hasNextPage', v_next_cursor is not null,
      'clientRequestKey', v_request_key,
      'idempotentReplay', v_duplicate
    ),
    'message_thread',
    v_thread.id::text,
    'warning'
  );

  if not v_duplicate then
    -- The receipt intentionally excludes message bodies. Exact retries recheck
    -- live authorization and re-query the bounded page. Each resulting delivery
    -- is nevertheless audited above.
    perform msg_internal._record_request(
      v_request_key, v_hash, 'compliance.thread_read', p_actor_id,
      v_thread.id, v_thread.id::text,
      jsonb_build_object(
        'caseId', v_case.id,
        'grantId', v_grant.id,
        'threadId', v_thread.id,
        'eventId', v_event_id,
        'pageHash', v_page_hash
      )
    );
  end if;

  return jsonb_build_object(
    'caseId', v_case.id,
    'caseNo', v_case.case_no,
    'caseTitle', v_case.title,
    'caseStatus', v_case.status,
    'caseValidUntil', v_case.valid_until,
    'grantId', v_grant.id,
    'grantExpiresAt', v_grant.expires_at,
    'threadId', v_thread.id,
    'threadSubject', v_thread.subject,
    'threadType', v_thread.thread_type,
    'sourceModule', v_thread.source_module,
    'sourceEntityType', v_thread.source_entity_type,
    'sourceEntityId', v_thread.source_entity_id,
    'messages', v_messages,
    'nextCursor', v_next_cursor,
    'eventId', v_event_id,
    'duplicate', v_duplicate
  );
end
$fn$;

-- Revoke one scoped grant. The route supplies p_step_up_verified from the
-- authenticated session; browser input never controls this value.
create or replace function public.message_compliance_grant_revoke_tx(
  p_grant_id        uuid,
  p_actor_id        text,
  p_reason          text,
  p_step_up_verified boolean,
  p_idempotency_key text,
  p_ip_hash         text,
  p_user_agent_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_case public.message_compliance_cases%rowtype;
  v_grant public.message_thread_access_grants%rowtype;
  v_case_id uuid;
  v_now timestamptz := now();
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_event_id uuid;
begin
  if p_grant_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_grant_revoke: grant and actor are required'
      using errcode = 'MG400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_grant_revoke: idempotency key is required'
      using errcode = 'MG400';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'message_compliance_grant_revoke: reason is required'
      using errcode = 'MG422';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) then
    raise exception 'message_compliance_grant_revoke: active compliance-read grant required'
      using errcode = 'MG403';
  end if;

  v_request_key := p_actor_id || '|compliance.grant_revoke|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'grantId', p_grant_id,
    'actorId', p_actor_id,
    'reason', btrim(p_reason)
  )::text);
  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return (v_claim->'result') || jsonb_build_object('duplicate', true);
  end if;

  select case_id
    into v_case_id
    from public.message_thread_access_grants
   where id = p_grant_id;
  if not found then
    raise exception 'message_compliance_grant_revoke: grant not found'
      using errcode = 'MG404';
  end if;

  select *
    into v_case
    from public.message_compliance_cases
   where id = v_case_id
   for update;

  select *
    into v_grant
    from public.message_thread_access_grants
   where id = p_grant_id
   for update;
  if not found then
    raise exception 'message_compliance_grant_revoke: grant not found'
      using errcode = 'MG404';
  end if;
  if v_grant.revoked_at is not null or v_grant.expires_at <= v_now then
    raise exception 'message_compliance_grant_revoke: grant is not active'
      using errcode = 'MG409';
  end if;
  if p_actor_id <> v_grant.user_id
     and p_actor_id is distinct from v_case.approved_by then
    raise exception 'message_compliance_grant_revoke: actor cannot revoke this grant'
      using errcode = 'MG403';
  end if;
  if p_actor_id <> v_grant.user_id and not coalesce(p_step_up_verified, false) then
    raise exception 'message_compliance_grant_revoke: fresh step-up required'
      using errcode = 'MG403';
  end if;

  update public.message_thread_access_grants
     set revoked_at = v_now,
         revoked_by = p_actor_id,
         revoke_reason = btrim(p_reason)
   where id = v_grant.id;

  v_event_id := msg_internal._write_compliance_evidence(
    'grant_revoked',
    v_case.id,
    v_grant.id,
    v_grant.thread_id,
    p_actor_id,
    v_request_key,
    p_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'caseNo', v_case.case_no,
      'granteeUserId', v_grant.user_id,
      'selfRevoked', p_actor_id = v_grant.user_id
    ),
    'message_thread_access_grant',
    v_grant.id::text,
    'warning'
  );

  perform msg_internal._record_request(
    v_request_key, v_hash, 'compliance.grant_revoke', p_actor_id,
    v_grant.thread_id, v_grant.id::text,
    jsonb_build_object(
      'grantId', v_grant.id,
      'caseId', v_case.id,
      'caseNo', v_case.case_no,
      'threadId', v_grant.thread_id,
      'granteeUserId', v_grant.user_id,
      'revokedAt', v_now,
      'eventId', v_event_id,
      'duplicate', false
    )
  );

  return jsonb_build_object(
    'grantId', v_grant.id,
    'caseId', v_case.id,
    'caseNo', v_case.case_no,
    'threadId', v_grant.thread_id,
    'granteeUserId', v_grant.user_id,
    'revokedAt', v_now,
    'eventId', v_event_id,
    'duplicate', false
  );
end
$fn$;

-- Close an approved case and revoke all remaining active grants atomically.
create or replace function public.message_compliance_case_close_tx(
  p_case_id         uuid,
  p_actor_id        text,
  p_reason          text,
  p_idempotency_key text,
  p_ip_hash         text,
  p_user_agent_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_case public.message_compliance_cases%rowtype;
  v_now timestamptz := now();
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_event_id uuid;
  v_revoked_count integer := 0;
begin
  if p_case_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_case_close: case and actor are required'
      using errcode = 'MG400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_case_close: idempotency key is required'
      using errcode = 'MG400';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'message_compliance_case_close: reason is required'
      using errcode = 'MG422';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) then
    raise exception 'message_compliance_case_close: active compliance-read grant required'
      using errcode = 'MG403';
  end if;

  v_request_key := p_actor_id || '|compliance.case_close|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'caseId', p_case_id,
    'actorId', p_actor_id,
    'reason', btrim(p_reason)
  )::text);
  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return (v_claim->'result') || jsonb_build_object('duplicate', true);
  end if;

  select *
    into v_case
    from public.message_compliance_cases
   where id = p_case_id
   for update;
  if not found then
    raise exception 'message_compliance_case_close: case not found'
      using errcode = 'MG404';
  end if;
  if v_case.status <> 'approved' then
    raise exception 'message_compliance_case_close: case is %', v_case.status
      using errcode = 'MG409';
  end if;
  if p_actor_id <> v_case.requested_by
     and p_actor_id is distinct from v_case.approved_by then
    raise exception 'message_compliance_case_close: actor cannot close this case'
      using errcode = 'MG403';
  end if;

  perform 1
    from public.message_thread_access_grants
   where case_id = v_case.id
     and revoked_at is null
   for update;

  update public.message_thread_access_grants
     set revoked_at = v_now,
         revoked_by = p_actor_id,
         revoke_reason = 'Case closed: ' || btrim(p_reason)
   where case_id = v_case.id
     and revoked_at is null;
  get diagnostics v_revoked_count = row_count;

  update public.message_compliance_cases
     set status = 'closed',
         closed_by = p_actor_id,
         closed_at = v_now,
         close_reason = btrim(p_reason)
   where id = v_case.id;

  v_event_id := msg_internal._write_compliance_evidence(
    'case_closed',
    v_case.id,
    null,
    null,
    p_actor_id,
    v_request_key,
    p_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'caseNo', v_case.case_no,
      'revokedGrantCount', v_revoked_count
    ),
    'message_compliance_case',
    v_case.id::text,
    'warning'
  );

  perform msg_internal._record_request(
    v_request_key, v_hash, 'compliance.case_close', p_actor_id,
    null, v_case.id::text,
    jsonb_build_object(
      'caseId', v_case.id,
      'caseNo', v_case.case_no,
      'status', 'closed',
      'revokedGrantCount', v_revoked_count,
      'closedAt', v_now,
      'eventId', v_event_id,
      'duplicate', false
    )
  );

  return jsonb_build_object(
    'caseId', v_case.id,
    'caseNo', v_case.case_no,
    'status', 'closed',
    'revokedGrantCount', v_revoked_count,
    'closedAt', v_now,
    'eventId', v_event_id,
    'duplicate', false
  );
end
$fn$;

-- Service-role-only RPC surface.
revoke all on function public.message_compliance_case_request_tx(
  text, text, text, text, timestamptz, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_case_request_tx(
  text, text, text, text, timestamptz, jsonb, text, text, text
) to service_role;

revoke all on function public.message_compliance_case_decide_tx(
  uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_case_decide_tx(
  uuid, text, text, text, text, text, text
) to service_role;

revoke all on function public.message_compliance_thread_read_tx(
  uuid, uuid, text, integer, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_thread_read_tx(
  uuid, uuid, text, integer, text, text, text, text
) to service_role;

revoke all on function public.message_compliance_grant_revoke_tx(
  uuid, text, text, boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_grant_revoke_tx(
  uuid, text, text, boolean, text, text, text
) to service_role;

revoke all on function public.message_compliance_case_close_tx(
  uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_case_close_tx(
  uuid, text, text, text, text, text
) to service_role;

commit;

notify pgrst, 'reload schema';
