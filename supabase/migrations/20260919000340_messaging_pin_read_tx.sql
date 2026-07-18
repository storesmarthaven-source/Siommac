-- ============================================================================
-- Messaging P0 — Atomic pin/unpin + mark-read RPCs (Track 1, migration 5/6)
-- Depends on: 20260919000300–330
-- Contract:   netlify/functions/lib/messaging/MESSAGING_P0_CONTRACT.md
-- Operator-applied; idempotent (create or replace). After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- messaging_pin_tx:
--   Explicit action ('pin'|'unpin'), not toggle. Accepts p_expected_version
--   (If-Match) for optimistic concurrency — 409 if current version differs.
--   Pin: inserts new message_pins row (no unpinned_at).
--   Unpin: sets unpinned_at/unpinned_by on the most recent active pin.
--   Both bump thread.version.
--
-- messaging_mark_read_tx:
--   Monotonic read cursor: last_read_sequence = greatest(current, requested).
--   Set-based receipt update bounded by p_up_to_sequence.
--   Returns { lastReadSequence }.
-- ============================================================================

-- ── messaging_pin_tx ──────────────────────────────────────────────────────────

drop function if exists public.messaging_pin_tx(text, uuid, text, uuid, text, text, text, bigint);

create or replace function public.messaging_pin_tx(
  p_action           text,    -- 'pin' | 'unpin'
  p_pin_id           uuid,    -- required for unpin; null for pin
  p_thread_id        uuid,    -- required for pin; derived from p_pin_id for unpin
  p_actor_id         text,
  p_post_id          uuid,    -- null for a thread-level pin
  p_pin_type         text,    -- 'thread' | 'post'
  p_visibility       text,    -- 'thread' | 'personal'
  p_note             text,    -- optional note
  p_expected_version bigint   -- null = skip concurrency check; non-null = If-Match
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_thread              public.message_threads%rowtype;
  v_pin                 public.message_pins%rowtype;
  v_effective_thread_id uuid;
  v_part_role           text;
  v_actor_role          text;
  v_can_pin             boolean := false;
  v_can_unpin_any       boolean := false;
  v_pin_id              uuid;
  v_version             bigint;
  v_event_id            uuid;
  v_now                 timestamptz := now();
  v_pinner_name         text;
  v_post_preview        jsonb;
  v_pin_dto             jsonb;
begin
  -- ── 0. Input validation ────────────────────────────────────────────────────
  if p_action not in ('pin', 'unpin') then
    raise exception 'messaging_pin: action must be pin or unpin, got %', p_action using errcode = 'MG400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'messaging_pin: actor_id is required' using errcode = 'MG400';
  end if;

  if p_action = 'pin' then
    if p_thread_id is null then
      raise exception 'messaging_pin: thread_id is required for pin' using errcode = 'MG400';
    end if;
    if p_pin_id is not null then
      raise exception 'messaging_pin: pin_id must be null for pin' using errcode = 'MG400';
    end if;
    if coalesce(p_pin_type, '') not in ('thread', 'post') then
      raise exception 'messaging_pin: pin_type must be thread or post' using errcode = 'MG400';
    end if;
    if coalesce(p_visibility, '') not in ('thread', 'personal') then
      raise exception 'messaging_pin: visibility must be thread or personal' using errcode = 'MG400';
    end if;
    if p_pin_type = 'post' and p_post_id is null then
      raise exception 'messaging_pin: post_id is required for post pin_type' using errcode = 'MG400';
    end if;
    v_effective_thread_id := p_thread_id;
  else
    if p_pin_id is null then
      raise exception 'messaging_pin: pin_id is required for unpin' using errcode = 'MG400';
    end if;
    select *
      into v_pin
      from public.message_pins
     where id = p_pin_id
       and unpinned_at is null;
    if not found then
      raise exception 'messaging_pin: active pin % not found', p_pin_id using errcode = 'MG404';
    end if;
    v_effective_thread_id := v_pin.thread_id;
  end if;

  -- ── 1. Lock thread ─────────────────────────────────────────────────────────
  select *
    into v_thread
    from public.message_threads
   where id = v_effective_thread_id
   for update;
  if not found then
    raise exception 'messaging_pin: thread % not found', v_effective_thread_id using errcode = 'MG404';
  end if;

  -- ── 2. Optimistic concurrency check ───────────────────────────────────────
  if p_expected_version is not null and v_thread.version <> p_expected_version then
    raise exception 'messaging_pin: thread version conflict (expected %, current %)',
      p_expected_version, v_thread.version using errcode = 'MG409';
  end if;

  -- ── 3. Verify actor is an active participant ───────────────────────────────
  select role into v_part_role
    from public.message_participants
   where thread_id = v_effective_thread_id and user_id = p_actor_id and removed_at is null;
  if not found then
    raise exception 'messaging_pin: % is not an active participant', p_actor_id using errcode = 'MG403';
  end if;

  select role
    into v_actor_role
    from public.app_users
   where id = p_actor_id
     and status = 'active';
  if not found then
    raise exception 'messaging_pin: actor % is not active', p_actor_id using errcode = 'MG403';
  end if;

  if p_action = 'pin' then
    v_can_pin := coalesce(
      (
        select up.granted
          from public.user_permissions up
         where up.user_id = p_actor_id
           and up.permission = case
             when p_visibility = 'thread' then 'communications.messages.pin_thread'
             else 'communications.messages.pin_own'
           end
      ),
      v_actor_role = 'superadmin'
        or exists (
          select 1
            from public.role_permissions rp
           where rp.role_name = v_actor_role
             and rp.permission = case
               when p_visibility = 'thread' then 'communications.messages.pin_thread'
               else 'communications.messages.pin_own'
             end
        ),
      false
    );
    if not v_can_pin then
      raise exception 'messaging_pin: actor % cannot create a % pin', p_actor_id, p_visibility
        using errcode = 'MG403';
    end if;
  end if;

  -- ── 4. Validate post target (if post pin) ─────────────────────────────────
  if p_action = 'pin' and p_pin_type = 'post' then
    if not exists (
      select 1 from public.message_posts
       where id = p_post_id and thread_id = v_effective_thread_id and deleted_at is null
    ) then
      raise exception 'messaging_pin: post % not found in thread %', p_post_id, v_effective_thread_id
        using errcode = 'MG404';
    end if;
  end if;

  -- ── 5. Execute pin/unpin ───────────────────────────────────────────────────
  if p_action = 'pin' then
    -- Insert new pin (idempotent guard: if an active pin for the same post+visibility
    -- already exists, raise 409 — caller should unpin first).
    if exists (
      select 1 from public.message_pins
       where thread_id = v_effective_thread_id
         and (p_post_id is null and post_id is null or post_id = p_post_id)
         and visibility  = p_visibility
         and pinned_by   = p_actor_id
         and unpinned_at is null
    ) then
      raise exception 'messaging_pin: an active pin for this post+visibility already exists'
        using errcode = 'MG409';
    end if;

    insert into public.message_pins
      (thread_id, post_id, pin_type, visibility, pinned_by, pinned_at, note)
    values
      (v_effective_thread_id, p_post_id, p_pin_type, p_visibility, p_actor_id, v_now, p_note)
    returning id into v_pin_id;

    select *
      into v_pin
      from public.message_pins
     where id = v_pin_id;

  else
    -- Re-read and lock the exact active pin after locking the thread. This
    -- preserves thread-first lock order and prevents a TOCTOU unpin.
    select *
      into v_pin
      from public.message_pins
     where id = p_pin_id
       and thread_id = v_effective_thread_id
       and unpinned_at is null
     for update;
    if not found then
      raise exception 'messaging_pin: active pin % not found', p_pin_id using errcode = 'MG404';
    end if;

    v_can_unpin_any := coalesce(
      (
        select up.granted
          from public.user_permissions up
         where up.user_id = p_actor_id
           and up.permission = 'communications.messages.unpin_any'
      ),
      v_actor_role = 'superadmin'
        or exists (
          select 1
            from public.role_permissions rp
           where rp.role_name = v_actor_role
             and rp.permission = 'communications.messages.unpin_any'
        ),
      false
    );

    if v_pin.pinned_by = p_actor_id then
      if not coalesce(
        (
          select up.granted
            from public.user_permissions up
           where up.user_id = p_actor_id
             and up.permission = 'communications.messages.unpin_own'
        ),
        v_actor_role = 'superadmin'
          or exists (
            select 1
              from public.role_permissions rp
             where rp.role_name = v_actor_role
               and rp.permission = 'communications.messages.unpin_own'
          ),
        false
      ) then
        raise exception 'messaging_pin: actor % cannot unpin own pins', p_actor_id using errcode = 'MG403';
      end if;
    elsif v_part_role <> 'owner' and not v_can_unpin_any then
      raise exception 'messaging_pin: actor % cannot unpin pin %', p_actor_id, p_pin_id
        using errcode = 'MG403';
    end if;

    update public.message_pins
       set unpinned_at = v_now,
           unpinned_by = p_actor_id
     where id = p_pin_id
       and unpinned_at is null
    returning id into v_pin_id;

    if not found then
      raise exception 'messaging_pin: active pin % changed during unpin', p_pin_id using errcode = 'MG409';
    end if;
  end if;

  -- ── 6. Bump thread version ─────────────────────────────────────────────────
  update public.message_threads
     set version = version + 1
   where id = v_effective_thread_id
  returning version into v_version;

  -- ── 7. app_event ──────────────────────────────────────────────────────────
  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    (case when p_action = 'pin' then 'communications.message_pinned'
          else 'communications.message_unpinned' end,
     'communications', 'message_thread', v_effective_thread_id::text,
     p_actor_id, 'info',
     jsonb_build_object(
       'pinId', v_pin_id, 'postId', v_pin.post_id, 'threadVersion', v_version,
       'pinType', v_pin.pin_type, 'visibility', v_pin.visibility
     ),
     null)
  returning id into v_event_id;

  if p_action = 'pin' then
    select coalesce(au.full_name, au.email, 'Someone')
      into v_pinner_name
      from public.app_users au
     where au.id = v_pin.pinned_by;

    if v_pin.post_id is not null then
      select jsonb_build_object(
               'body', mp.body,
               'authorName', coalesce(author.full_name, author.email),
               'createdAt', mp.created_at
             )
        into v_post_preview
        from public.message_posts mp
        left join public.app_users author on author.id = mp.author_user_id
       where mp.id = v_pin.post_id;
    end if;

    v_pin_dto := jsonb_build_object(
      'id', v_pin.id,
      'threadId', v_pin.thread_id,
      'postId', v_pin.post_id,
      'pinType', v_pin.pin_type,
      'visibility', v_pin.visibility,
      'pinnedBy', jsonb_build_object(
        'userId', v_pin.pinned_by,
        'displayName', coalesce(v_pinner_name, 'Someone')
      ),
      'pinnedAt', v_pin.pinned_at,
      'note', v_pin.note,
      'postPreview', v_post_preview
    );
  end if;

  return jsonb_build_object(
    'pinId',         v_pin_id,
    'action',        p_action,
    'threadId',      v_effective_thread_id,
    'visibility',    v_pin.visibility,
    'threadVersion', v_version,
    'eventId',       v_event_id,
    'pin',           v_pin_dto
  );
end
$fn$;

-- ── messaging_mark_read_tx ────────────────────────────────────────────────────

create or replace function public.messaging_mark_read_tx(
  p_thread_id      uuid,
  p_actor_id       text,
  p_up_to_sequence bigint   -- monotonic; ignored if lower than current
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_now              timestamptz := now();
  v_current_seq      bigint;
  v_new_seq          bigint;
begin
  -- ── 0. Required inputs ─────────────────────────────────────────────────────
  if p_thread_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'messaging_mark_read: thread_id and actor_id are required'
      using errcode = 'MG400';
  end if;
  if p_up_to_sequence is null or p_up_to_sequence < 0 then
    raise exception 'messaging_mark_read: up_to_sequence must be >= 0' using errcode = 'MG400';
  end if;

  -- ── 1. Verify participant membership ──────────────────────────────────────
  if not exists (
    select 1 from public.message_participants
     where thread_id = p_thread_id and user_id = p_actor_id and removed_at is null
  ) then
    raise exception 'messaging_mark_read: % is not an active participant', p_actor_id
      using errcode = 'MG403';
  end if;

  -- ── 2. Read current cursor (for monotonic guard) ──────────────────────────
  select last_read_sequence into v_current_seq
    from public.message_participants
   where thread_id = p_thread_id and user_id = p_actor_id;

  v_new_seq := greatest(coalesce(v_current_seq, 0), p_up_to_sequence);

  -- ── 3. Update both cursors (sequence + legacy timestamp) ──────────────────
  update public.message_participants
     set last_read_sequence = v_new_seq,
         last_read_at       = v_now    -- kept for backward compat with existing list queries
   where thread_id = p_thread_id and user_id = p_actor_id;

  -- ── 4. Set-based receipt update (bounded by sequence — no unbounded IN-list) ─
  -- Only marks posts UP TO the cursor as read for this user; avoids the
  -- O(all-posts) scan in the old markThreadRead implementation.
  update public.message_post_receipts mpr
     set read_at = v_now
    from public.message_posts mp
   where mpr.post_id  = mp.id
     and mp.thread_id = p_thread_id
     and mpr.user_id  = p_actor_id
     and mpr.read_at  is null
     and (mp.sequence is null or mp.sequence <= v_new_seq);

  return jsonb_build_object('lastReadSequence', v_new_seq);
end
$fn$;

-- ── Grants ─────────────────────────────────────────────────────────────────────
revoke all on function public.messaging_pin_tx(text, uuid, uuid, text, uuid, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.messaging_pin_tx(text, uuid, uuid, text, uuid, text, text, text, bigint)
  to service_role;

revoke all on function public.messaging_mark_read_tx(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.messaging_mark_read_tx(uuid, text, bigint)
  to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
