-- ============================================================================
-- Messaging — Author-only Internal Notes (standalone slice)
-- Depends on: 20260919000300 (foundation), 320 (send), 410 (search), 435 (compliance)
-- Operator-applied; idempotent (create or replace / add column if not exists).
-- After applying:  NOTIFY pgrst, 'reload schema';
--
-- Internal notes live in message_posts (is_internal = true). They are visible
-- ONLY to their author. They do NOT bump next_message_sequence/version, do NOT
-- touch last_post_at/last_post_preview/action_required, create NO receipts,
-- NO outbox delivery, NO participant notifications, and emit NO realtime signal
-- to other participants. Read-security is enforced at EVERY post read path
-- (this migration redefines the two column-referencing SQL functions; the lib
-- direct queries are filtered in communications.ts / messagingRich.ts).
-- ============================================================================

-- ── 1. Schema ────────────────────────────────────────────────────────────────
alter table public.message_posts
  add column if not exists is_internal boolean not null default false;

create index if not exists message_posts_internal_author_idx
  on public.message_posts(thread_id, author_user_id, created_at desc)
  where is_internal;

-- ── 2. Write path: messaging_add_internal_note_tx ────────────────────────────
-- Side-effect-free by design: only inserts the note + writes app_events/audit_logs.
create or replace function public.messaging_add_internal_note_tx(
  p_thread_id      uuid,
  p_actor_id       text,
  p_body           text,
  p_client_msg_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_thread   public.message_threads%rowtype;
  v_existing public.message_posts%rowtype;
  v_post_id  uuid;
  v_event_id uuid;
  v_now      timestamptz := now();
  v_body     text;
begin
  -- ── 0. Required inputs ─────────────────────────────────────────────────────
  if p_thread_id is null then
    raise exception 'messaging_add_internal_note: thread_id is required' using errcode = 'MG400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'messaging_add_internal_note: actor_id is required' using errcode = 'MG400';
  end if;
  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is null then
    raise exception 'messaging_add_internal_note: a note body is required' using errcode = 'MG400';
  end if;

  -- ── 1. Lock/read the thread ────────────────────────────────────────────────
  select * into v_thread from public.message_threads where id = p_thread_id for update;
  if not found then
    raise exception 'messaging_add_internal_note: thread % not found', p_thread_id using errcode = 'MG404';
  end if;

  -- ── 2. Idempotency (shared thread/author/client-key ledger) ────────────────
  if p_client_msg_key is not null and btrim(p_client_msg_key) <> '' then
    select * into v_existing
      from public.message_posts
     where thread_id              = p_thread_id
       and author_user_id         = p_actor_id
       and client_idempotency_key = p_client_msg_key;
    if found then
      return jsonb_build_object(
        'postId',       v_existing.id,
        'threadId',     v_existing.thread_id,
        'authorUserId', v_existing.author_user_id,
        'body',         v_existing.body,
        'createdAt',    v_existing.created_at,
        'isInternal',   v_existing.is_internal,
        'duplicate',    true
      );
    end if;
  end if;

  -- ── 3. Actor must be an active participant ─────────────────────────────────
  if not exists (
    select 1 from public.message_participants
     where thread_id = p_thread_id and user_id = p_actor_id and removed_at is null
  ) then
    raise exception 'messaging_add_internal_note: % is not an active participant in thread %',
      p_actor_id, p_thread_id using errcode = 'MG403';
  end if;

  -- ── 4. Insert the note — NO sequence/version bump, NO summary/receipts/outbox ─
  insert into public.message_posts
    (thread_id, author_user_id, body, is_internal, is_system, post_type, priority,
     attachment_count, reply_to_post_id, sequence, client_idempotency_key,
     created_at, delivery_status)
  values
    (p_thread_id, p_actor_id, v_body, true, false, 'message', 'normal',
     0, null, null, nullif(btrim(coalesce(p_client_msg_key, '')), ''),
     v_now, null)
  returning id into v_post_id;

  -- ── 5. Audit trail (author-scoped; NOT a participant notification) ─────────
  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    ('communications.message.internal_note_added', 'communications', 'message_thread', p_thread_id::text,
     p_actor_id, 'info',
     jsonb_build_object('postId', v_post_id, 'threadId', p_thread_id, 'isInternal', true),
     'comms.msg.internal_note:' || p_thread_id::text || ':' || v_post_id::text)
  returning id into v_event_id;

  insert into public.audit_logs
    (action, table_name, record_id, user_id, changes, created_at)
  values
    ('communications.message.internal_note', 'message_posts', v_post_id::text, p_actor_id,
     jsonb_build_object('threadId', p_thread_id, 'postId', v_post_id, 'isInternal', true),
     v_now);

  return jsonb_build_object(
    'postId',       v_post_id,
    'threadId',     p_thread_id,
    'authorUserId', p_actor_id,
    'body',         v_body,
    'createdAt',    v_now,
    'isInternal',   true,
    'eventId',      v_event_id,
    'duplicate',    false
  );
end
$fn$;

revoke all on function public.messaging_add_internal_note_tx(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.messaging_add_internal_note_tx(uuid, text, text, text)
  to service_role;

-- ── 3. Read security: message-content search excludes internal notes ─────────
-- (except the author's own). Redefined here because it now references is_internal.
create or replace function public.messaging_search_posts_page(
  p_user_id   text,
  p_query     text,
  p_limit     integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  post_id        uuid,
  thread_id      uuid,
  subject        text,
  snippet        text,
  author_user_id text,
  created_at     timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    p.id, p.thread_id, t.subject,
    left(p.body, 160), p.author_user_id, p.created_at
  from public.message_posts p
  join public.message_participants mp
    on mp.thread_id = p.thread_id
   and mp.user_id = p_user_id
   and mp.removed_at is null
  join public.message_threads t on t.id = p.thread_id
  where p.deleted_at is null
    and p.is_system = false
    and (not p.is_internal or p.author_user_id = p_user_id)   -- author-only internal notes
    and length(coalesce(p_query, '')) >= 2
    and p.body ilike '%' || p_query || '%'
    and (p_cursor_at is null
         or p.created_at < p_cursor_at
         or (p.created_at = p_cursor_at and p.id < p_cursor_id))
  order by p.created_at desc, p.id desc
  limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.messaging_search_posts_page(text, text, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.messaging_search_posts_page(text, text, integer, timestamptz, uuid)
  to service_role;

-- ── 4. Read security: compliance export excludes internal notes entirely ─────
-- Redefined here because the post subquery now references is_internal.
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
          and not p.is_internal              -- internal notes are excluded from compliance exports
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

notify pgrst, 'reload schema';
