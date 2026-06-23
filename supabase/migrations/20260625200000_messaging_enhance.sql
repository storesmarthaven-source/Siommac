-- ============================================================================
-- Messaging enhance
-- Adds columns and indexes missing from the initial communications_core migration.
-- All additions are idempotent (add column if not exists / create index if not exists).
-- ============================================================================

-- ── message_threads: last_post tracking ──────────────────────────────────────

alter table public.message_threads
  add column if not exists last_post_at      timestamptz,
  add column if not exists last_post_preview text;

create index if not exists mt_last_post_at_idx
  on public.message_threads(last_post_at desc);

-- The source-lookup index was in the original migration but may not exist in all
-- environments — safe to re-declare as CREATE INDEX IF NOT EXISTS.
create index if not exists mt_source_lookup_idx
  on public.message_threads(source_module, source_entity_type, source_entity_id)
  where source_entity_id is not null;

-- ── message_posts: soft-delete + edit + attachment count ─────────────────────

alter table public.message_posts
  add column if not exists attachment_count integer      not null default 0,
  add column if not exists edited_at        timestamptz,
  add column if not exists deleted_at       timestamptz;

create index if not exists mp_thread_created_idx
  on public.message_posts(thread_id, created_at);

create index if not exists mp_author_idx
  on public.message_posts(author_user_id);

create index if not exists mp_body_fts_idx
  on public.message_posts using gin(to_tsvector('english', body));

-- ── message_participants: lifecycle columns ───────────────────────────────────

alter table public.message_participants
  add column if not exists joined_at   timestamptz not null default now(),
  add column if not exists removed_at  timestamptz;

-- The original migration created mp_user_idx on (user_id, archived_at).
-- We also want a fast lookup per user filtering removed_at.
create index if not exists mp_user_active_idx
  on public.message_participants(user_id, removed_at)
  where removed_at is null;

-- ── message_attachments ───────────────────────────────────────────────────────

create table if not exists public.message_attachments (
  id             uuid    primary key default gen_random_uuid(),
  post_id        uuid    not null references public.message_posts(id) on delete cascade,
  file_name      text    not null,
  file_path      text    not null,
  content_type   text,
  size_bytes     bigint,
  uploaded_by    text    references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists ma_post_idx
  on public.message_attachments(post_id);

alter table public.message_attachments enable row level security;
-- Service-role bypass only — no permissive anon/authenticated policy.
