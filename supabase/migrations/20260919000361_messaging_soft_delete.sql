-- ============================================================================
-- Messaging: message soft-delete (P0 delete decision — Track 2 prerequisite)
-- Depends on: 20260919000300_messaging_p0_foundation.sql (version, outbox)
-- Operator-applied; idempotent. After applying: NOTIFY pgrst, 'reload schema';
--   verify: select position('messaging_delete_message_tx' in proname)>=0
--             from pg_proc where proname='messaging_delete_message_tx';  -- expect a row
-- ============================================================================
-- Rules (MESSAGING_P0_CONTRACT): 15-minute window for own posts; a moderation
-- delete (communications.messages.delete_any, resolved by the TS caller into
-- p_is_moderator) requires a reason + audit event; blocked under legal hold and on
-- system threads / system-generated posts. Editing stays DISABLED (delete-only).
-- Soft-delete only: the row is retained with deleted_at/deleted_by for audit.
-- ============================================================================

alter table public.message_posts
  add column if not exists deleted_by text references public.app_users(id) on delete set null;

-- Legal-hold flag on threads. The mechanism to SET it is a later (P2) retention
-- control; this column + the delete guard exist now so the invariant is real and
-- forward-compatible (nothing sets it true yet, but a held thread cannot be edited away).
alter table public.message_threads
  add column if not exists legal_hold boolean not null default false;

create or replace function public.messaging_delete_message_tx(
  p_post_id      uuid,
  p_actor_id     text,
  p_reason       text,     -- required for a moderation delete; null/empty for own delete
  p_is_moderator boolean   -- caller-resolved: actor holds communications.messages.delete_any
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_post           public.message_posts%rowtype;
  v_thread         public.message_threads%rowtype;
  v_now            timestamptz := now();
  v_version        bigint;
  v_is_participant boolean;
  v_is_author      boolean;
  v_by_moderator   boolean := false;
begin
  if p_post_id is null then
    raise exception 'messaging_delete: post_id is required' using errcode = 'MG400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'messaging_delete: actor_id is required' using errcode = 'MG400';
  end if;

  select * into v_post from public.message_posts where id = p_post_id for update;
  if not found then
    raise exception 'messaging_delete: post % not found', p_post_id using errcode = 'MG404';
  end if;

  -- Idempotent: an already soft-deleted post returns its current state (no re-write, no dup event).
  if v_post.deleted_at is not null then
    return jsonb_build_object('postId', v_post.id, 'deletedAt', v_post.deleted_at, 'alreadyDeleted', true);
  end if;

  -- System-generated posts are an immutable audit trail; never deletable.
  if coalesce(v_post.is_system, false) or coalesce(v_post.post_type, '') = 'system_event' then
    raise exception 'messaging_delete: system messages cannot be deleted' using errcode = 'MG403';
  end if;

  select * into v_thread from public.message_threads where id = v_post.thread_id for update;
  if not found then
    raise exception 'messaging_delete: thread % not found', v_post.thread_id using errcode = 'MG404';
  end if;
  if coalesce(v_thread.legal_hold, false) then
    raise exception 'messaging_delete: this thread is under legal hold' using errcode = 'MG403';
  end if;
  if v_thread.thread_type = 'system' then
    raise exception 'messaging_delete: system threads are controlled records' using errcode = 'MG403';
  end if;

  v_is_author := (v_post.author_user_id is not distinct from p_actor_id);
  v_is_participant := exists (
    select 1 from public.message_participants
     where thread_id = v_thread.id and user_id = p_actor_id and removed_at is null);

  -- Authorization: a moderator (with a reason) OR the author within the 15-minute window.
  if p_is_moderator then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'messaging_delete: a reason is required for a moderation delete' using errcode = 'MG400';
    end if;
    v_by_moderator := true;
  elsif v_is_author then
    if not v_is_participant then
      raise exception 'messaging_delete: % is not an active participant', p_actor_id using errcode = 'MG403';
    end if;
    if v_post.created_at < v_now - interval '15 minutes' then
      raise exception 'messaging_delete: the 15-minute delete window has passed' using errcode = 'MG403';
    end if;
  else
    raise exception 'messaging_delete: % may only delete their own recent messages', p_actor_id using errcode = 'MG403';
  end if;

  update public.message_posts
     set deleted_at = v_now, deleted_by = p_actor_id
   where id = p_post_id;

  update public.message_threads
     set version = version + 1
   where id = v_thread.id
  returning version into v_version;

  insert into public.message_event_outbox
    (event_type, thread_id, actor_id, payload, created_at)
  values
    ('message.deleted', v_thread.id, p_actor_id,
     jsonb_build_object('postId', p_post_id, 'threadVersion', v_version, 'byModerator', v_by_moderator),
     v_now);

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    ('communications.message.deleted', 'communications', 'message_thread', v_thread.id::text,
     p_actor_id, 'info',
     jsonb_build_object('postId', p_post_id, 'threadVersion', v_version,
                        'byModerator', v_by_moderator, 'reason', nullif(btrim(coalesce(p_reason, '')), '')),
     null);

  return jsonb_build_object('postId', p_post_id, 'deletedAt', v_now,
                            'threadVersion', v_version, 'byModerator', v_by_moderator);
end
$fn$;

revoke all on function public.messaging_delete_message_tx(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.messaging_delete_message_tx(uuid, text, text, boolean)
  to service_role;
