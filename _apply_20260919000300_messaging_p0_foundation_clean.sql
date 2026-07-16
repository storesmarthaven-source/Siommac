create schema if not exists msg_internal;
grant usage on schema msg_internal to service_role;
revoke usage on schema msg_internal from public;

alter table public.message_threads
  add column if not exists next_message_sequence bigint not null default 0,
  add column if not exists version               bigint not null default 0;

alter table public.message_posts
  add column if not exists sequence               bigint,
  add column if not exists client_idempotency_key text;

create unique index if not exists mp_client_idempotency_uidx
  on public.message_posts(thread_id, author_user_id, client_idempotency_key)
  where client_idempotency_key is not null;

create index if not exists mp_thread_sequence_idx
  on public.message_posts(thread_id, sequence desc)
  where sequence is not null;

alter table public.message_participants
  add column if not exists last_read_sequence bigint not null default 0;

create table if not exists public.message_upload_sessions (
  id                uuid        primary key default gen_random_uuid(),
  uploaded_by       text        not null references public.app_users(id) on delete cascade,
  thread_id         uuid        references public.message_threads(id) on delete set null,
  object_path       text        not null,
  expected_size     bigint,
  declared_mime     text,
  detected_mime     text,
  expected_checksum text,
  scan_status       text        not null default 'pending'
                                check (scan_status in ('pending','clean','blocked','failed')),
  upload_state      text        not null default 'pending'
                                check (upload_state in ('pending','uploaded','cancelled','expired')),
  expires_at        timestamptz not null default (now() + interval '2 hours'),
  created_at        timestamptz not null default now()
);

create index if not exists mus_uploader_idx on public.message_upload_sessions(uploaded_by, created_at desc);
create index if not exists mus_thread_idx   on public.message_upload_sessions(thread_id) where thread_id is not null;
create index if not exists mus_expiry_idx   on public.message_upload_sessions(expires_at) where upload_state = 'pending';

alter table public.message_upload_sessions enable row level security;

alter table public.message_attachments
  add column if not exists upload_session_id uuid
    references public.message_upload_sessions(id) on delete set null;

create index if not exists ma_session_idx
  on public.message_attachments(upload_session_id) where upload_session_id is not null;

create table if not exists public.message_event_outbox (
  id              uuid        primary key default gen_random_uuid(),
  event_type      text        not null,
  thread_id       uuid        not null references public.message_threads(id) on delete cascade,
  actor_id        text        not null,
  payload         jsonb       not null default '{}',
  status          text        not null default 'pending'
                              check (status in ('pending','processing','published','failed','dead_lettered')),
  attempts        int         not null default 0,
  max_attempts    int         not null default 5,
  lease_token     text,
  lease_expires_at timestamptz,
  created_at      timestamptz not null default now(),
  published_at    timestamptz
);

create index if not exists meo_pending_idx
  on public.message_event_outbox(created_at)
  where status in ('pending','failed');

create index if not exists meo_thread_idx
  on public.message_event_outbox(thread_id, created_at desc);

alter table public.message_event_outbox enable row level security;

create table if not exists msg_internal.message_request_receipts (
  request_key   text        primary key,
  request_hash  text        not null,
  operation     text        not null,
  actor_id      text        not null,
  thread_id     uuid,
  result_id     text,
  result        jsonb       not null default '{}',
  created_at    timestamptz not null default now()
);

grant select, insert, update on msg_internal.message_request_receipts to service_role;
alter default privileges in schema msg_internal grant select, insert, update, delete on tables to service_role;
alter default privileges in schema msg_internal grant usage, select on sequences to service_role;

create or replace function msg_internal._claim_request(
  p_request_key  text,
  p_request_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_row msg_internal.message_request_receipts%rowtype;
begin
  if p_request_key is null or btrim(p_request_key) = '' then
    return jsonb_build_object('status', 'proceed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 0));

  select * into v_row from msg_internal.message_request_receipts where request_key = p_request_key;
  if not found then
    return jsonb_build_object('status', 'proceed');
  end if;
  if v_row.request_hash is distinct from p_request_hash then
    raise exception '_claim_request: key % already used with a different payload', p_request_key using errcode = 'MSG409';
  end if;
  return jsonb_build_object('status', 'duplicate', 'result', v_row.result);
end
$fn$;

create or replace function msg_internal._record_request(
  p_request_key  text,
  p_request_hash text,
  p_operation    text,
  p_actor_id     text,
  p_thread_id    uuid,
  p_result_id    text,
  p_result       jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_row msg_internal.message_request_receipts%rowtype;
begin
  if p_request_key is null or btrim(p_request_key) = '' then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 0));

  select * into v_row from msg_internal.message_request_receipts where request_key = p_request_key;
  if found then
    if v_row.request_hash is distinct from p_request_hash
       or v_row.operation  is distinct from p_operation
       or v_row.actor_id   is distinct from p_actor_id then
      raise exception '_record_request: key % has a divergent receipt', p_request_key using errcode = 'MSG409';
    end if;
    return;
  end if;

  insert into msg_internal.message_request_receipts
    (request_key, request_hash, operation, actor_id, thread_id, result_id, result)
  values
    (p_request_key, p_request_hash, p_operation, p_actor_id, p_thread_id,
     p_result_id, coalesce(p_result, '{}'::jsonb));
end
$fn$;

revoke all on function msg_internal._claim_request(text, text)  from public, anon, authenticated;
grant execute on function msg_internal._claim_request(text, text)  to service_role;

revoke all on function msg_internal._record_request(text, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function msg_internal._record_request(text, text, text, text, uuid, text, jsonb) to service_role;
