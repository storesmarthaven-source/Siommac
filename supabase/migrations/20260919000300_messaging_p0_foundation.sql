-- ============================================================================
-- Messaging P0 Hardening — Foundation Schema (Track 1, migration 1/6)
-- Contract: netlify/functions/lib/messaging/MESSAGING_P0_CONTRACT.md
-- Operator-applied; idempotent (IF NOT EXISTS / DO $$ guards). After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- Adds to EXISTING messaging tables (NO new thread/post/participant tables):
--   message_threads     +next_message_sequence, +version
--   message_posts       +sequence, +client_idempotency_key
--   message_participants +last_read_sequence
--   message_attachments +upload_session_id (FK deferred below)
--
-- New tables:
--   msg_internal.message_request_receipts — idempotency ledger (mirrors wf_internal)
--   public.message_event_outbox           — durable transactional outbox
--   public.message_upload_sessions        — upload lifecycle / quarantine
--
-- Helper functions:
--   msg_internal._claim_request(key, hash) → jsonb  {status:'proceed'|'duplicate',...}
--   msg_internal._record_request(...)      → void
-- ============================================================================

-- ── msg_internal private schema ───────────────────────────────────────────────
-- Mirrors wf_internal: not exposed via PostgREST; service_role only.
create schema if not exists msg_internal;
grant usage on schema msg_internal to service_role;
revoke usage on schema msg_internal from public;

-- ── message_threads: monotonic sequence counter + version ─────────────────────
-- next_message_sequence: the NEXT sequence number to assign. After the first post,
--   this is 1. Incremented atomically in the send_message RPC.
-- version: bumped on every structural change (post, pin, membership).

alter table public.message_threads
  add column if not exists next_message_sequence bigint not null default 0,
  add column if not exists version               bigint not null default 0;

-- ── message_posts: per-thread monotonic sequence + client idempotency key ─────
-- sequence: NULL for legacy posts (no backfill); always set by the send RPC.
-- client_idempotency_key: client-generated UUID preventing duplicate sends.
-- Partial unique index: only rows WITH a key are deduplicated (legacy nulls ignored).

alter table public.message_posts
  add column if not exists sequence               bigint,
  add column if not exists client_idempotency_key text;

create unique index if not exists mp_client_idempotency_uidx
  on public.message_posts(thread_id, author_user_id, client_idempotency_key)
  where client_idempotency_key is not null;

-- Index for sequence-based pagination (replaces timestamp-only cursor).
create index if not exists mp_thread_sequence_idx
  on public.message_posts(thread_id, sequence desc)
  where sequence is not null;

-- ── message_participants: read cursor ─────────────────────────────────────────
-- last_read_sequence: monotonic read cursor. Drives unread counts. Replaces
--   timestamp-based last_read_at for new reads (last_read_at kept for legacy
--   compatibility; both are updated by messaging_mark_read_tx).

alter table public.message_participants
  add column if not exists last_read_sequence bigint not null default 0;

-- ── message_upload_sessions ───────────────────────────────────────────────────
-- Tracks the upload lifecycle from client-request → quarantine → scan → clean.
-- The send/create RPCs verify: uploaded_by = actor, scan_status = 'clean',
-- upload_state = 'uploaded', post_id IS NULL (not yet linked).
-- upload_session_id on message_attachments links an attachment to its session.

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
-- Service-role only: browser never reads upload sessions directly.

-- ── message_attachments: upload_session_id FK ─────────────────────────────────
-- Links an attachment to its upload session. Nullable (legacy attachments have none).

alter table public.message_attachments
  add column if not exists upload_session_id uuid
    references public.message_upload_sessions(id) on delete set null;

create index if not exists ma_session_idx
  on public.message_attachments(upload_session_id) where upload_session_id is not null;

-- ── message_event_outbox ──────────────────────────────────────────────────────
-- Durable transactional outbox: rows are inserted in the SAME transaction as the
-- business row, guaranteeing at-least-once delivery even if the process crashes
-- before the post-commit notification fires. A future outbox worker (mirrors
-- workflow-outbox-worker.ts) claims FOR UPDATE SKIP LOCKED, delivers, and marks
-- published. Until that worker ships the existing emitSignal/emitAppEvent path
-- remains the primary delivery mechanism; the outbox provides the audit trail.

create table if not exists public.message_event_outbox (
  id              uuid        primary key default gen_random_uuid(),
  event_type      text        not null,   -- 'thread.created' | 'message.created' | 'participant.added' | etc.
  thread_id       uuid        not null references public.message_threads(id) on delete cascade,
  actor_id        text        not null,   -- app_users.id (TEXT)
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
-- Service-role only; no browser access.

-- ── msg_internal.message_request_receipts ────────────────────────────────────
-- Idempotency ledger for messaging RPCs. Mirrors wf_internal.workflow_request_receipts.
-- Keys: actor_id + '|create_thread|' + client_uuid
-- On duplicate request_key with same hash → return stored result.
-- On duplicate with different hash → MG409.

create table if not exists msg_internal.message_request_receipts (
  request_key   text        primary key,
  request_hash  text        not null,
  operation     text        not null,   -- 'create_thread' | 'send_message' | etc.
  actor_id      text        not null,
  thread_id     uuid,                   -- the thread created/touched
  result_id     text,                   -- post_id or thread_id (text) for the created record
  result        jsonb       not null default '{}',
  created_at    timestamptz not null default now()
);

-- Explicit grants: SECURITY INVOKER functions run as service_role but the private
-- schema requires an explicit table grant (not covered by the public GRANT ALL).
grant select, insert, update on msg_internal.message_request_receipts to service_role;
alter default privileges in schema msg_internal grant select, insert, update, delete on tables to service_role;
alter default privileges in schema msg_internal grant usage, select on sequences to service_role;

-- ── msg_internal._claim_request ───────────────────────────────────────────────
-- Serializes concurrent duplicates on the same key (advisory xact-lock).
-- Returns {status:'proceed'} or {status:'duplicate', result:{...}}.
-- A same-key / different-hash call raises MG409.
-- An empty/null key always returns 'proceed' (legacy callers with no idempotency key).

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

  -- Advisory xact-lock: held to commit so a racing duplicate blocks and then sees
  -- the receipt. 64-bit key (hashtextextended) avoids unrelated-key collisions.
  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 0));

  select * into v_row from msg_internal.message_request_receipts where request_key = p_request_key;
  if not found then
    return jsonb_build_object('status', 'proceed');
  end if;
  if v_row.request_hash is distinct from p_request_hash then
    raise exception '_claim_request: key % already used with a different payload', p_request_key using errcode = 'MG409';
  end if;
  return jsonb_build_object('status', 'duplicate', 'result', v_row.result);
end
$fn$;

-- ── msg_internal._record_request ─────────────────────────────────────────────
-- Writes the receipt on success (same txn as the business insert).
-- Idempotent only when every identity field is identical; divergence raises MG409.

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
      raise exception '_record_request: key % has a divergent receipt', p_request_key using errcode = 'MG409';
    end if;
    return;   -- identical → idempotent no-op
  end if;

  insert into msg_internal.message_request_receipts
    (request_key, request_hash, operation, actor_id, thread_id, result_id, result)
  values
    (p_request_key, p_request_hash, p_operation, p_actor_id, p_thread_id,
     p_result_id, coalesce(p_result, '{}'::jsonb));
end
$fn$;

-- ── Grants — service_role only ────────────────────────────────────────────────
revoke all on function msg_internal._claim_request(text, text)  from public, anon, authenticated;
grant execute on function msg_internal._claim_request(text, text)  to service_role;

revoke all on function msg_internal._record_request(text, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function msg_internal._record_request(text, text, text, text, uuid, text, jsonb) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
