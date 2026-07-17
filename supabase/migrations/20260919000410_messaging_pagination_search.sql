-- 20260919000410_messaging_pagination_search.sql
-- Messenger hardening slice 2 (contract: docs/module-contracts/messenger-pagination-search.md)
--
--   1. messaging_list_threads_page — SQL keyset thread pages (activity DESC,
--      id DESC tiebreak). Tab filters (inbox/archived/sent/all) and
--      subject/preview search are SQL-side, so pages are exact-size — the old
--      JS post-filters could shrink a page to zero while rows remained.
--   2. messaging_search_posts_page — message-CONTENT search (ILIKE + trgm)
--      restricted to threads where the caller is an ACTIVE participant.
--   3. Supporting indexes: posts keyset + trgm on body.
--
-- SECURITY DEFINER, EXECUTE service_role-only: the backend passes the
-- authenticated user id from the JWT; clients never call these directly.

create extension if not exists pg_trgm;

-- Keyset support: newest-first walk within a thread.
create index if not exists message_posts_thread_created_id_idx
  on public.message_posts (thread_id, created_at desc, id desc);

-- Content search support.
create index if not exists message_posts_body_trgm_idx
  on public.message_posts using gin (body gin_trgm_ops);

-- Thread page ordering support.
create index if not exists message_threads_last_post_at_id_idx
  on public.message_threads (last_post_at desc, id desc);

-- ── 1. Thread pages ───────────────────────────────────────────────────────────
create or replace function public.messaging_list_threads_page(
  p_user_id   text,
  p_tab       text default 'inbox',
  p_search    text default null,
  p_limit     integer default 30,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  thread_id           uuid,
  thread_type         text,
  subject             text,
  last_post_at        timestamptz,
  last_post_preview   text,
  source_module       text,
  source_entity_type  text,
  source_entity_id    text,
  created_by          text,
  priority            text,
  action_required     boolean,
  participant_role    text,
  last_read_at        timestamptz,
  archived_at         timestamptz,
  notifications_muted boolean
)
language sql
security definer
set search_path = public
as $$
  select
    t.id, t.thread_type, t.subject, t.last_post_at, t.last_post_preview,
    t.source_module, t.source_entity_type, t.source_entity_id, t.created_by,
    t.priority, t.action_required,
    mp.role, mp.last_read_at, mp.archived_at, mp.notifications_muted
  from public.message_participants mp
  join public.message_threads t on t.id = mp.thread_id
  where mp.user_id = p_user_id
    and mp.removed_at is null
    and case p_tab
          when 'inbox'    then mp.archived_at is null
          when 'archived' then mp.archived_at is not null
          else true                       -- 'sent' | 'all'
        end
    and (p_tab <> 'sent' or exists (
          select 1 from public.message_posts sp
           where sp.thread_id = t.id
             and sp.author_user_id = p_user_id
             and sp.deleted_at is null))
    and (p_search is null or p_search = ''
         or t.subject ilike '%' || p_search || '%'
         or coalesce(t.last_post_preview, '') ilike '%' || p_search || '%')
    and (p_cursor_at is null
         or coalesce(t.last_post_at, 'epoch'::timestamptz) < p_cursor_at
         or (coalesce(t.last_post_at, 'epoch'::timestamptz) = p_cursor_at
             and t.id < p_cursor_id))
  order by coalesce(t.last_post_at, 'epoch'::timestamptz) desc, t.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.messaging_list_threads_page(text, text, text, integer, timestamptz, uuid) from public;
revoke all on function public.messaging_list_threads_page(text, text, text, integer, timestamptz, uuid) from anon;
revoke all on function public.messaging_list_threads_page(text, text, text, integer, timestamptz, uuid) from authenticated;
grant execute on function public.messaging_list_threads_page(text, text, text, integer, timestamptz, uuid) to service_role;

-- ── 2. Message-content search ─────────────────────────────────────────────────
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
    and length(coalesce(p_query, '')) >= 2
    and p.body ilike '%' || p_query || '%'
    and (p_cursor_at is null
         or p.created_at < p_cursor_at
         or (p.created_at = p_cursor_at and p.id < p_cursor_id))
  order by p.created_at desc, p.id desc
  limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.messaging_search_posts_page(text, text, integer, timestamptz, uuid) from public;
revoke all on function public.messaging_search_posts_page(text, text, integer, timestamptz, uuid) from anon;
revoke all on function public.messaging_search_posts_page(text, text, integer, timestamptz, uuid) from authenticated;
grant execute on function public.messaging_search_posts_page(text, text, integer, timestamptz, uuid) to service_role;
