-- ============================================================================
-- Messaging — internal notes must never affect another participant's unread /
-- last-post-by (thread-list RPC fix).
--
-- Depends on: 20260919000439 (messaging_list_threads_page), 20260919000441
-- (message_posts.is_internal). Operator-applied; idempotent (create or replace).
-- After applying:  NOTIFY pgrst, 'reload schema';
--
-- Author-only internal notes (is_internal = true) are visible ONLY to their
-- author. The thread-list page RPC computed unread_count from every non-authored,
-- non-deleted post after last_read_at — WITHOUT excluding internal notes — so an
-- internal note by one participant incorrectly bumped every OTHER participant's
-- unread count (E2E: "internal note marked the thread unread for B"). The
-- last-post-by subquery had the same leak (an internal note could surface as a
-- non-author's last-post author). Both are now internal-note-aware:
--   unread:       exclude is_internal posts outright (they're always by another
--                 author here, and are invisible to non-authors).
--   last_post_by: show an internal note only to its own author.
-- Everything else in the function is byte-for-byte the 20260919000439 definition.
-- ============================================================================

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
  notifications_muted boolean,
  unread_count        integer,
  has_attachments     boolean,
  failed_send_count   integer,
  last_post_by        text,
  authored_by_me      boolean
)
language sql
security definer
set search_path = public
as $$
  with page as (
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
            else true
          end
      and (p_tab <> 'sent' or exists (
            select 1
            from public.message_posts sp
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
    limit least(greatest(p_limit, 1), 100)
  )
  select
    pg.id, pg.thread_type, pg.subject, pg.last_post_at, pg.last_post_preview,
    pg.source_module, pg.source_entity_type, pg.source_entity_id, pg.created_by,
    pg.priority, pg.action_required,
    pg.role, pg.last_read_at, pg.archived_at, pg.notifications_muted,
    (
      select count(*)::integer
      from public.message_posts up
      where up.thread_id = pg.id
        and up.deleted_at is null
        and up.author_user_id is distinct from p_user_id
        and not up.is_internal                      -- author-only internal notes never mark others unread
        and up.created_at > coalesce(pg.last_read_at, 'epoch'::timestamptz)
    ),
    exists (
      select 1 from public.message_posts ap
      where ap.thread_id = pg.id
        and ap.deleted_at is null
        and ap.attachment_count > 0
    ),
    (
      select count(*)::integer
      from public.message_posts fp
      where fp.thread_id = pg.id
        and fp.author_user_id = p_user_id
        and fp.deleted_at is null
        and fp.delivery_status = 'failed'
    ),
    (
      select lp.author_user_id
      from public.message_posts lp
      where lp.thread_id = pg.id and lp.deleted_at is null
        and (not lp.is_internal or lp.author_user_id = p_user_id)   -- internal note is last-post only for its author
      order by lp.created_at desc, lp.id desc
      limit 1
    ),
    exists (
      select 1 from public.message_posts op
      where op.thread_id = pg.id
        and op.author_user_id = p_user_id
        and op.deleted_at is null
    )
  from page pg
  order by coalesce(pg.last_post_at, 'epoch'::timestamptz) desc, pg.id desc;
$$;

revoke all on function public.messaging_list_threads_page(
  text, text, text, integer, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.messaging_list_threads_page(
  text, text, text, integer, timestamptz, uuid
) to service_role;

notify pgrst, 'reload schema';
