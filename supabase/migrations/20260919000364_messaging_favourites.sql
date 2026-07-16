-- ============================================================================
-- Messaging: per-user thread favourites (the last deferred hidden-feature
-- slice not gated on authenticated realtime).
-- Operator-applied; idempotent. After applying: NOTIFY pgrst, 'reload schema';
--   verify: select count(*)>0 from information_schema.tables
--            where table_name = 'message_thread_favourites';
-- ============================================================================
-- Favourites are PERSONAL UI state (like drafts): no workflow, no app_events,
-- no audit — a single-row toggle owned by the user, participant-gated at the
-- route. Cross-device persistence is the reason it lives in the DB.
-- ============================================================================

create table if not exists public.message_thread_favourites (
  user_id    text not null references public.app_users(id) on delete cascade,
  thread_id  uuid not null references public.message_threads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

create index if not exists mtf_thread_idx on public.message_thread_favourites(thread_id);

alter table public.message_thread_favourites enable row level security;
