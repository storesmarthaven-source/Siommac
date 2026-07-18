-- ============================================================================
-- Messenger Compliance V1: transactional export lifecycle
-- Depends on 433/434 and the messaging idempotency helpers from 300.
--
-- Object bytes remain outside the database transaction. The backend follows:
-- request row -> one-statement DB snapshot -> render -> persist immutable
-- upload identity -> upload/verify object -> finalize. Storage is never touched
-- before its path and expected checksum are durably tracked.
-- ============================================================================

begin;

create or replace function public.message_compliance_export_request_tx(
  p_case_id          uuid,
  p_thread_id        uuid,
  p_actor_id         text,
  p_format           text,
  p_range_from       timestamptz,
  p_range_to         timestamptz,
  p_purpose          text,
  p_acknowledgement  boolean,
  p_idempotency_key  text,
  p_ip_hash          text,
  p_user_agent_hash  text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_case public.message_compliance_cases%rowtype;
  v_grant public.message_thread_access_grants%rowtype;
  v_now timestamptz := now();
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_export_id uuid;
  v_export_no text;
  v_event_id uuid;
begin
  if p_case_id is null or p_thread_id is null
     or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_export_request: case, conversation, and actor are required'
      using errcode = 'MG400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_export_request: idempotency key is required'
      using errcode = 'MG400';
  end if;
  if p_format not in ('pdf', 'json') then
    raise exception 'message_compliance_export_request: format must be pdf or json'
      using errcode = 'MG422';
  end if;
  if char_length(btrim(coalesce(p_purpose, ''))) not between 5 and 1000 then
    raise exception 'message_compliance_export_request: purpose is required'
      using errcode = 'MG422';
  end if;
  if not coalesce(p_acknowledgement, false) then
    raise exception 'message_compliance_export_request: acknowledgement is required'
      using errcode = 'MG422';
  end if;
  if (p_range_from is null) <> (p_range_to is null)
     or (p_range_from is not null and p_range_to < p_range_from) then
    raise exception 'message_compliance_export_request: invalid message range'
      using errcode = 'MG422';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) or not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_export'
  ) then
    raise exception 'message_compliance_export_request: active compliance read and export grants required'
      using errcode = 'MG403';
  end if;

  select *
    into v_case
    from public.message_compliance_cases
   where id = p_case_id
   for share;
  if not found then
    raise exception 'message_compliance_export_request: case not found'
      using errcode = 'MG404';
  end if;
  if v_case.status <> 'approved' or v_case.valid_until <= v_now then
    raise exception 'message_compliance_export_request: case is not active'
      using errcode = 'MG403';
  end if;

  select *
    into v_grant
    from public.message_thread_access_grants
   where case_id = p_case_id
     and thread_id = p_thread_id
     and user_id = p_actor_id
   for share;
  if not found
     or v_grant.revoked_at is not null
     or v_grant.expires_at <= v_now then
    raise exception 'message_compliance_export_request: active scoped grant required'
      using errcode = 'MG403';
  end if;

  v_request_key := p_actor_id || '|compliance.export_request|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'caseId', p_case_id,
    'threadId', p_thread_id,
    'actorId', p_actor_id,
    'format', p_format,
    'rangeFrom', p_range_from,
    'rangeTo', p_range_to,
    'purpose', btrim(p_purpose),
    'acknowledgement', p_acknowledgement
  )::text);
  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return (v_claim->'result') || jsonb_build_object('duplicate', true);
  end if;

  v_export_no := 'MCX-' || extract(year from v_now)::integer::text || '-'
    || lpad(public.increment_ref_counter(
      'MCX', extract(year from v_now)::integer
    )::text, 6, '0');

  insert into public.message_compliance_exports (
    export_no, case_id, grant_id, thread_id, requested_by, format,
    range_from, range_to, purpose
  ) values (
    v_export_no, v_case.id, v_grant.id, v_grant.thread_id, p_actor_id, p_format,
    p_range_from, p_range_to, btrim(p_purpose)
  )
  returning id into v_export_id;

  v_event_id := msg_internal._write_compliance_evidence(
    'export_requested',
    v_case.id,
    v_grant.id,
    v_grant.thread_id,
    p_actor_id,
    v_request_key,
    p_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'caseNo', v_case.case_no,
      'exportId', v_export_id,
      'exportNo', v_export_no,
      'format', p_format,
      'rangeFrom', p_range_from,
      'rangeTo', p_range_to
    ),
    'message_compliance_export',
    v_export_id::text,
    'warning'
  );

  perform msg_internal._record_request(
    v_request_key, v_hash, 'compliance.export_request', p_actor_id,
    v_grant.thread_id, v_export_id::text,
    jsonb_build_object(
      'exportId', v_export_id,
      'exportNo', v_export_no,
      'caseId', v_case.id,
      'caseNo', v_case.case_no,
      'grantId', v_grant.id,
      'threadId', v_grant.thread_id,
      'format', p_format,
      'rangeFrom', p_range_from,
      'rangeTo', p_range_to,
      'requestedAt', v_now,
      'status', 'requested',
      'eventId', v_event_id,
      'duplicate', false
    )
  );

  return jsonb_build_object(
    'exportId', v_export_id,
    'exportNo', v_export_no,
    'caseId', v_case.id,
    'caseNo', v_case.case_no,
    'grantId', v_grant.id,
    'threadId', v_grant.thread_id,
    'format', p_format,
    'rangeFrom', p_range_from,
    'rangeTo', p_range_to,
    'requestedAt', v_now,
    'status', 'requested',
    'eventId', v_event_id,
    'duplicate', false
  );
end
$fn$;

-- Build the complete artifact source in one database statement. The returned
-- generatedAt value is the actual MVCC snapshot boundary used by the query; it
-- is not backdated to the earlier export request.
create or replace function public.message_compliance_export_snapshot(
  p_export_id uuid,
  p_actor_id  text
) returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_snapshot jsonb;
begin
  if p_export_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_export_snapshot: export and actor are required'
      using errcode = 'MG400';
  end if;

  select jsonb_build_object(
    'case', jsonb_build_object(
      'id', c.id,
      'caseNo', c.case_no,
      'title', c.title,
      'caseType', c.case_type,
      'status', c.status,
      'requestedBy', jsonb_build_object(
        'id', requester.id,
        'displayName', coalesce(nullif(btrim(requester.full_name), ''), requester.username)
      )
    ),
    'thread', jsonb_build_object(
      'id', t.id,
      'threadId', t.id,
      'subject', t.subject,
      'threadType', t.thread_type,
      'sourceModule', t.source_module,
      'sourceEntityType', t.source_entity_type,
      'sourceEntityId', t.source_entity_id
    ),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', post_rows.id,
          'sequence', post_rows.sequence,
          'author', case
            when post_rows.author_user_id is null then null
            else jsonb_build_object(
              'id', post_rows.author_user_id,
              'displayName', post_rows.author_name
            )
          end,
          'body', case when post_rows.deleted_at is null then post_rows.body else null end,
          'isSystem', post_rows.is_system,
          'editedAt', post_rows.edited_at,
          'deletedAt', post_rows.deleted_at,
          'createdAt', post_rows.created_at,
          'attachments', post_rows.attachments
        )
        order by post_rows.created_at, post_rows.sequence asc nulls first, post_rows.id
      )
      from (
        select
          p.id,
          p.sequence,
          p.author_user_id,
          coalesce(nullif(btrim(author.full_name), ''), author.username) as author_name,
          p.body,
          p.is_system,
          p.edited_at,
          p.deleted_at,
          p.created_at,
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
          ), '[]'::jsonb) as attachments
        from public.message_posts p
        left join public.app_users author on author.id = p.author_user_id
        where p.thread_id = e.thread_id
          and (e.range_from is null or p.created_at >= e.range_from)
          and (e.range_to is null or p.created_at <= e.range_to)
        order by p.created_at, p.sequence asc nulls first, p.id
        limit 5001
      ) post_rows
    ), '[]'::jsonb),
    'purpose', e.purpose,
    'range', jsonb_build_object('from', e.range_from, 'to', e.range_to),
    'generatedAt', statement_timestamp()
  )
    into v_snapshot
    from public.message_compliance_exports e
    join public.message_compliance_cases c
      on c.id = e.case_id
     and c.status = 'approved'
     and c.valid_until > statement_timestamp()
    join public.message_thread_access_grants g
      on g.id = e.grant_id
     and g.case_id = e.case_id
     and g.thread_id = e.thread_id
     and g.user_id = p_actor_id
     and g.revoked_at is null
     and g.expires_at > statement_timestamp()
    join public.message_threads t on t.id = e.thread_id
    join public.app_users requester on requester.id = c.requested_by
   where e.id = p_export_id
     and e.requested_by = p_actor_id
     and e.status = 'requested'
     and msg_internal._has_active_compliance_permission(
       p_actor_id, 'communications.compliance_read'
     )
     and msg_internal._has_active_compliance_permission(
       p_actor_id, 'communications.compliance_export'
     );

  if not found then
    raise exception 'message_compliance_export_snapshot: active scoped export required'
      using errcode = 'MG403';
  end if;
  if jsonb_array_length(v_snapshot->'messages') > 5000 then
    raise exception 'message_compliance_export_snapshot: message range exceeds 5000'
      using errcode = 'MG422';
  end if;

  return v_snapshot;
end
$fn$;

-- Persist the immutable artifact identity before storage is touched. A crash
-- after this commit leaves a tracked upload that can be verified/finalized or
-- explicitly failed; it can never leave an unreferenced sensitive object.
create or replace function public.message_compliance_export_prepare_upload_tx(
  p_export_id          uuid,
  p_actor_id           text,
  p_message_count      integer,
  p_storage_path       text,
  p_file_size          bigint,
  p_sha256             text,
  p_serializer_version text,
  p_snapshot_at        timestamptz,
  p_idempotency_key    text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_export public.message_compliance_exports%rowtype;
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_expected_path text;
begin
  if p_export_id is null or p_actor_id is null or btrim(p_actor_id) = ''
     or p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_export_prepare_upload: export, actor, and key are required'
      using errcode = 'MG400';
  end if;
  if p_message_count is null or p_message_count < 0 or p_message_count > 5000
     or p_file_size is null or p_file_size < 1 or p_file_size > 20971520
     or p_sha256 is null or lower(p_sha256) !~ '^[0-9a-f]{64}$'
     or p_serializer_version <> 'messaging-compliance-v1'
     or p_snapshot_at is null then
    raise exception 'message_compliance_export_prepare_upload: invalid artifact metadata'
      using errcode = 'MG422';
  end if;

  select *
    into v_export
    from public.message_compliance_exports
   where id = p_export_id
   for update;
  if not found then
    raise exception 'message_compliance_export_prepare_upload: export not found'
      using errcode = 'MG404';
  end if;
  if v_export.requested_by <> p_actor_id then
    raise exception 'message_compliance_export_prepare_upload: actor does not own export'
      using errcode = 'MG403';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) or not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_export'
  ) or not exists (
    select 1
      from public.message_compliance_cases c
      join public.message_thread_access_grants g
        on g.case_id = c.id
       and g.id = v_export.grant_id
       and g.thread_id = v_export.thread_id
       and g.user_id = p_actor_id
       and g.revoked_at is null
       and g.expires_at > now()
     where c.id = v_export.case_id
       and c.status = 'approved'
       and c.valid_until > now()
  ) then
    raise exception 'message_compliance_export_prepare_upload: active scoped grant required'
      using errcode = 'MG403';
  end if;

  v_expected_path := 'case/' || v_export.case_id::text
    || '/thread/' || v_export.thread_id::text
    || '/' || v_export.id::text || '.' || v_export.format;
  if p_storage_path is distinct from v_expected_path then
    raise exception 'message_compliance_export_prepare_upload: storage path is invalid'
      using errcode = 'MG422';
  end if;

  v_request_key := p_actor_id || '|compliance.export_prepare_upload|'
    || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'exportId', p_export_id,
    'actorId', p_actor_id,
    'messageCount', p_message_count,
    'storagePath', p_storage_path,
    'fileSize', p_file_size,
    'sha256', lower(p_sha256),
    'serializerVersion', p_serializer_version,
    'snapshotAt', p_snapshot_at
  )::text);
  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return (v_claim->'result') || jsonb_build_object('duplicate', true);
  end if;
  if v_export.status <> 'requested' then
    raise exception 'message_compliance_export_prepare_upload: export is %', v_export.status
      using errcode = 'MG409';
  end if;

  update public.message_compliance_exports
     set status = 'uploading',
         message_count = p_message_count,
         storage_path = p_storage_path,
         file_size = p_file_size,
         sha256 = lower(p_sha256),
         serializer_version = p_serializer_version,
         snapshot_at = p_snapshot_at,
         upload_started_at = now()
   where id = v_export.id;

  perform msg_internal._record_request(
    v_request_key, v_hash, 'compliance.export_prepare_upload', p_actor_id,
    v_export.thread_id, v_export.id::text,
    jsonb_build_object(
      'exportId', v_export.id,
      'exportNo', v_export.export_no,
      'status', 'uploading',
      'messageCount', p_message_count,
      'storagePath', p_storage_path,
      'fileSize', p_file_size,
      'sha256', lower(p_sha256),
      'serializerVersion', p_serializer_version,
      'snapshotAt', p_snapshot_at,
      'uploadStartedAt', now(),
      'duplicate', false
    )
  );

  return jsonb_build_object(
    'exportId', v_export.id,
    'exportNo', v_export.export_no,
    'status', 'uploading',
    'messageCount', p_message_count,
    'storagePath', p_storage_path,
    'fileSize', p_file_size,
    'sha256', lower(p_sha256),
    'serializerVersion', p_serializer_version,
    'snapshotAt', p_snapshot_at,
    'uploadStartedAt', now(),
    'duplicate', false
  );
end
$fn$;

create or replace function public.message_compliance_export_finalize_tx(
  p_export_id         uuid,
  p_actor_id          text,
  p_message_count     integer,
  p_storage_path      text,
  p_file_size         bigint,
  p_sha256            text,
  p_serializer_version text,
  p_idempotency_key   text,
  p_ip_hash           text,
  p_user_agent_hash   text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_export public.message_compliance_exports%rowtype;
  v_case public.message_compliance_cases%rowtype;
  v_grant public.message_thread_access_grants%rowtype;
  v_now timestamptz := now();
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_event_id uuid;
  v_expected_path text;
begin
  if p_export_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_export_finalize: export and actor are required'
      using errcode = 'MG400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_export_finalize: idempotency key is required'
      using errcode = 'MG400';
  end if;
  if p_message_count is null or p_message_count < 0 or p_message_count > 5000 then
    raise exception 'message_compliance_export_finalize: message count must be 0-5000'
      using errcode = 'MG422';
  end if;
  if p_file_size is null or p_file_size < 1 or p_file_size > 20971520 then
    raise exception 'message_compliance_export_finalize: file size is invalid'
      using errcode = 'MG422';
  end if;
  if p_sha256 is null or lower(p_sha256) !~ '^[0-9a-f]{64}$' then
    raise exception 'message_compliance_export_finalize: SHA-256 is invalid'
      using errcode = 'MG422';
  end if;
  if p_serializer_version <> 'messaging-compliance-v1' then
    raise exception 'message_compliance_export_finalize: serializer version is invalid'
      using errcode = 'MG422';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) or not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_export'
  ) then
    raise exception 'message_compliance_export_finalize: active compliance read and export grants required'
      using errcode = 'MG403';
  end if;

  select *
    into v_export
    from public.message_compliance_exports
   where id = p_export_id
   for update;
  if not found then
    raise exception 'message_compliance_export_finalize: export not found'
      using errcode = 'MG404';
  end if;
  if v_export.requested_by <> p_actor_id then
    raise exception 'message_compliance_export_finalize: actor does not own export'
      using errcode = 'MG403';
  end if;

  select *
    into v_case
    from public.message_compliance_cases
   where id = v_export.case_id
   for share;
  if not found
     or v_case.status <> 'approved'
     or v_case.valid_until <= v_now then
    raise exception 'message_compliance_export_finalize: case is not active'
      using errcode = 'MG403';
  end if;

  select *
    into v_grant
    from public.message_thread_access_grants
   where id = v_export.grant_id
     and case_id = v_export.case_id
     and thread_id = v_export.thread_id
     and user_id = p_actor_id
   for share;
  if not found
     or v_grant.revoked_at is not null
     or v_grant.expires_at <= v_now then
    raise exception 'message_compliance_export_finalize: active scoped grant required'
      using errcode = 'MG403';
  end if;

  v_expected_path := 'case/' || v_export.case_id::text
    || '/thread/' || v_export.thread_id::text
    || '/' || v_export.id::text || '.' || v_export.format;
  if p_storage_path is distinct from v_expected_path then
    raise exception 'message_compliance_export_finalize: storage path is invalid'
      using errcode = 'MG422';
  end if;

  v_request_key := p_actor_id || '|compliance.export_finalize|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'exportId', p_export_id,
    'actorId', p_actor_id,
    'messageCount', p_message_count,
    'storagePath', p_storage_path,
    'fileSize', p_file_size,
    'sha256', lower(p_sha256),
    'serializerVersion', p_serializer_version
  )::text);
  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return (v_claim->'result') || jsonb_build_object('duplicate', true);
  end if;
  if v_export.status <> 'uploading' then
    raise exception 'message_compliance_export_finalize: export is %', v_export.status
      using errcode = 'MG409';
  end if;
  if p_message_count is distinct from v_export.message_count
     or p_storage_path is distinct from v_export.storage_path
     or p_file_size is distinct from v_export.file_size
     or lower(p_sha256) is distinct from v_export.sha256
     or p_serializer_version is distinct from v_export.serializer_version then
    raise exception 'message_compliance_export_finalize: artifact metadata changed after preparation'
      using errcode = 'MG409';
  end if;

  update public.message_compliance_exports
     set status = 'ready',
         generated_at = v_now,
         failure_code = null
   where id = v_export.id;

  v_event_id := msg_internal._write_compliance_evidence(
    'export_generated',
    v_case.id,
    v_grant.id,
    v_grant.thread_id,
    p_actor_id,
    v_request_key,
    p_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'caseNo', v_case.case_no,
      'exportId', v_export.id,
      'exportNo', v_export.export_no,
      'format', v_export.format,
      'messageCount', p_message_count,
      'fileSize', p_file_size,
      'sha256', lower(p_sha256),
      'snapshotAt', v_export.snapshot_at
    ),
    'message_compliance_export',
    v_export.id::text,
    'warning'
  );

  perform msg_internal._record_request(
    v_request_key, v_hash, 'compliance.export_finalize', p_actor_id,
    v_grant.thread_id, v_export.id::text,
    jsonb_build_object(
      'exportId', v_export.id,
      'exportNo', v_export.export_no,
      'status', 'ready',
      'messageCount', p_message_count,
      'fileSize', p_file_size,
      'sha256', lower(p_sha256),
      'snapshotAt', v_export.snapshot_at,
      'generatedAt', v_now,
      'eventId', v_event_id,
      'duplicate', false
    )
  );

  return jsonb_build_object(
    'exportId', v_export.id,
    'exportNo', v_export.export_no,
    'status', 'ready',
    'messageCount', p_message_count,
    'fileSize', p_file_size,
    'sha256', lower(p_sha256),
    'snapshotAt', v_export.snapshot_at,
    'generatedAt', v_now,
    'eventId', v_event_id,
    'duplicate', false
  );
end
$fn$;

-- Failure recording deliberately remains available after permission/grant
-- expiry: a requested row must never be stranded because an external storage
-- step failed while access was concurrently revoked.
create or replace function public.message_compliance_export_fail_tx(
  p_export_id        uuid,
  p_actor_id         text,
  p_failure_code     text,
  p_idempotency_key  text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_export public.message_compliance_exports%rowtype;
  v_now timestamptz := now();
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_event_id uuid;
begin
  if p_export_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_export_fail: export and actor are required'
      using errcode = 'MG400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_export_fail: idempotency key is required'
      using errcode = 'MG400';
  end if;
  if p_failure_code not in (
    'snapshot_failed',
    'render_failed',
    'prepare_failed',
    'storage_failed',
    'finalize_failed',
    'integrity_failed'
  ) then
    raise exception 'message_compliance_export_fail: invalid failure code'
      using errcode = 'MG422';
  end if;

  select *
    into v_export
    from public.message_compliance_exports
   where id = p_export_id
   for update;
  if not found then
    raise exception 'message_compliance_export_fail: export not found'
      using errcode = 'MG404';
  end if;
  if v_export.requested_by <> p_actor_id then
    raise exception 'message_compliance_export_fail: actor does not own export'
      using errcode = 'MG403';
  end if;

  v_request_key := p_actor_id || '|compliance.export_fail|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'exportId', p_export_id,
    'actorId', p_actor_id,
    'failureCode', p_failure_code
  )::text);
  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return (v_claim->'result') || jsonb_build_object('duplicate', true);
  end if;
  if v_export.status not in ('requested', 'uploading') then
    raise exception 'message_compliance_export_fail: export is %', v_export.status
      using errcode = 'MG409';
  end if;

  update public.message_compliance_exports
     set status = 'failed',
         failure_code = p_failure_code,
         generated_at = v_now
   where id = v_export.id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'communications.compliance.export_failed',
    'communications',
    'message_compliance_export',
    v_export.id::text,
    p_actor_id,
    'high',
    jsonb_build_object(
      'exportId', v_export.id,
      'exportNo', v_export.export_no,
      'caseId', v_export.case_id,
      'threadId', v_export.thread_id,
      'failureCode', p_failure_code
    ),
    'communications.compliance.export_failed:' || v_request_key
  )
  returning id into v_event_id;

  insert into public.audit_logs (
    action, table_name, record_id, user_id, changes
  ) values (
    'communications.compliance.export_failed',
    'message_compliance_export',
    v_export.id::text,
    p_actor_id,
    jsonb_build_object(
      'exportNo', v_export.export_no,
      'caseId', v_export.case_id,
      'threadId', v_export.thread_id,
      'failureCode', p_failure_code
    )
  );

  perform msg_internal._record_request(
    v_request_key, v_hash, 'compliance.export_fail', p_actor_id,
    v_export.thread_id, v_export.id::text,
    jsonb_build_object(
      'exportId', v_export.id,
      'exportNo', v_export.export_no,
      'status', 'failed',
      'failureCode', p_failure_code,
      'failedAt', v_now,
      'eventId', v_event_id,
      'duplicate', false
    )
  );

  return jsonb_build_object(
    'exportId', v_export.id,
    'exportNo', v_export.export_no,
    'status', 'failed',
    'failureCode', p_failure_code,
    'failedAt', v_now,
    'eventId', v_event_id,
    'duplicate', false
  );
end
$fn$;

-- Read-only internal authorization step used before the backend downloads and
-- independently re-hashes the private object.
create or replace function public.message_compliance_export_download_prepare(
  p_export_id uuid,
  p_actor_id  text
) returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_export public.message_compliance_exports%rowtype;
  v_case public.message_compliance_cases%rowtype;
  v_grant public.message_thread_access_grants%rowtype;
  v_now timestamptz := now();
begin
  if p_export_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_export_download_prepare: export and actor are required'
      using errcode = 'MG400';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) or not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_export'
  ) then
    raise exception 'message_compliance_export_download_prepare: active compliance read and export grants required'
      using errcode = 'MG403';
  end if;

  select *
    into v_export
    from public.message_compliance_exports
   where id = p_export_id;
  if not found then
    raise exception 'message_compliance_export_download_prepare: export not found'
      using errcode = 'MG404';
  end if;
  if v_export.requested_by <> p_actor_id then
    raise exception 'message_compliance_export_download_prepare: actor does not own export'
      using errcode = 'MG403';
  end if;
  if v_export.status <> 'ready' then
    raise exception 'message_compliance_export_download_prepare: export is %', v_export.status
      using errcode = 'MG409';
  end if;

  select *
    into v_case
    from public.message_compliance_cases
   where id = v_export.case_id;
  if not found
     or v_case.status <> 'approved'
     or v_case.valid_until <= v_now then
    raise exception 'message_compliance_export_download_prepare: case is not active'
      using errcode = 'MG403';
  end if;

  select *
    into v_grant
    from public.message_thread_access_grants
   where id = v_export.grant_id
     and case_id = v_export.case_id
     and thread_id = v_export.thread_id
     and user_id = p_actor_id;
  if not found
     or v_grant.revoked_at is not null
     or v_grant.expires_at <= v_now then
    raise exception 'message_compliance_export_download_prepare: active scoped grant required'
      using errcode = 'MG403';
  end if;

  return jsonb_build_object(
    'exportId', v_export.id,
    'exportNo', v_export.export_no,
    'caseId', v_export.case_id,
    'caseNo', v_case.case_no,
    'grantId', v_export.grant_id,
    'threadId', v_export.thread_id,
    'format', v_export.format,
    'storagePath', v_export.storage_path,
    'fileSize', v_export.file_size,
    'sha256', v_export.sha256,
    'serializerVersion', v_export.serializer_version,
    'generatedAt', v_export.generated_at
  );
end
$fn$;

create or replace function public.message_compliance_export_download_record_tx(
  p_export_id         uuid,
  p_actor_id          text,
  p_idempotency_key   text,
  p_ip_hash           text,
  p_user_agent_hash   text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
declare
  v_export public.message_compliance_exports%rowtype;
  v_case public.message_compliance_cases%rowtype;
  v_grant public.message_thread_access_grants%rowtype;
  v_now timestamptz := now();
  v_request_key text;
  v_hash text;
  v_claim jsonb;
  v_event_id uuid;
  v_duplicate boolean := false;
  v_disclosure_key text;
begin
  if p_export_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'message_compliance_export_download_record: export and actor are required'
      using errcode = 'MG400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'message_compliance_export_download_record: idempotency key is required'
      using errcode = 'MG400';
  end if;
  if not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_read'
  ) or not msg_internal._has_active_compliance_permission(
    p_actor_id, 'communications.compliance_export'
  ) then
    raise exception 'message_compliance_export_download_record: active compliance read and export grants required'
      using errcode = 'MG403';
  end if;

  select *
    into v_export
    from public.message_compliance_exports
   where id = p_export_id
   for share;
  if not found then
    raise exception 'message_compliance_export_download_record: export not found'
      using errcode = 'MG404';
  end if;
  if v_export.requested_by <> p_actor_id then
    raise exception 'message_compliance_export_download_record: actor does not own export'
      using errcode = 'MG403';
  end if;
  if v_export.status <> 'ready' then
    raise exception 'message_compliance_export_download_record: export is %', v_export.status
      using errcode = 'MG409';
  end if;

  select *
    into v_case
    from public.message_compliance_cases
   where id = v_export.case_id
   for share;
  if not found
     or v_case.status <> 'approved'
     or v_case.valid_until <= v_now then
    raise exception 'message_compliance_export_download_record: case is not active'
      using errcode = 'MG403';
  end if;

  select *
    into v_grant
    from public.message_thread_access_grants
   where id = v_export.grant_id
     and case_id = v_export.case_id
     and thread_id = v_export.thread_id
     and user_id = p_actor_id
   for share;
  if not found
     or v_grant.revoked_at is not null
     or v_grant.expires_at <= v_now then
    raise exception 'message_compliance_export_download_record: active scoped grant required'
      using errcode = 'MG403';
  end if;

  v_request_key := p_actor_id || '|compliance.export_download|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'exportId', p_export_id,
    'actorId', p_actor_id
  )::text);
  v_claim := msg_internal._claim_request(v_request_key, v_hash);
  v_duplicate := v_claim->>'status' = 'duplicate';
  v_disclosure_key := v_request_key || '|delivery|' || gen_random_uuid()::text;

  v_event_id := msg_internal._write_compliance_evidence(
    'export_downloaded',
    v_case.id,
    v_grant.id,
    v_grant.thread_id,
    p_actor_id,
    v_disclosure_key,
    p_ip_hash,
    p_user_agent_hash,
    jsonb_build_object(
      'caseNo', v_case.case_no,
      'exportId', v_export.id,
      'exportNo', v_export.export_no,
      'format', v_export.format,
      'fileSize', v_export.file_size,
      'sha256', v_export.sha256,
      'clientRequestKey', v_request_key,
      'idempotentReplay', v_duplicate
    ),
    'message_compliance_export',
    v_export.id::text,
    'warning'
  );

  if not v_duplicate then
    perform msg_internal._record_request(
      v_request_key, v_hash, 'compliance.export_download', p_actor_id,
      v_grant.thread_id, v_export.id::text,
      jsonb_build_object(
        'exportId', v_export.id,
        'exportNo', v_export.export_no,
        'caseId', v_case.id,
        'caseNo', v_case.case_no,
        'threadId', v_grant.thread_id,
        'downloadAuthorizedAt', v_now,
        'eventId', v_event_id,
        'duplicate', false
      )
    );
  end if;

  return jsonb_build_object(
    'exportId', v_export.id,
    'exportNo', v_export.export_no,
    'caseId', v_case.id,
    'caseNo', v_case.case_no,
    'threadId', v_grant.thread_id,
    'downloadAuthorizedAt', v_now,
    'eventId', v_event_id,
    'duplicate', v_duplicate
  );
end
$fn$;

revoke all on function public.message_compliance_export_request_tx(
  uuid, uuid, text, text, timestamptz, timestamptz, text, boolean,
  text, text, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_export_request_tx(
  uuid, uuid, text, text, timestamptz, timestamptz, text, boolean,
  text, text, text
) to service_role;

revoke all on function public.message_compliance_export_snapshot(uuid, text)
  from public, anon, authenticated;
grant execute on function public.message_compliance_export_snapshot(uuid, text)
  to service_role;

revoke all on function public.message_compliance_export_prepare_upload_tx(
  uuid, text, integer, text, bigint, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_export_prepare_upload_tx(
  uuid, text, integer, text, bigint, text, text, timestamptz, text
) to service_role;

revoke all on function public.message_compliance_export_finalize_tx(
  uuid, text, integer, text, bigint, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_export_finalize_tx(
  uuid, text, integer, text, bigint, text, text, text, text, text
) to service_role;

revoke all on function public.message_compliance_export_fail_tx(
  uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_export_fail_tx(
  uuid, text, text, text
) to service_role;

revoke all on function public.message_compliance_export_download_prepare(uuid, text)
  from public, anon, authenticated;
grant execute on function public.message_compliance_export_download_prepare(uuid, text)
  to service_role;

revoke all on function public.message_compliance_export_download_record_tx(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.message_compliance_export_download_record_tx(
  uuid, text, text, text, text
) to service_role;

commit;

notify pgrst, 'reload schema';
