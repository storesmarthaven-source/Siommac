
create or replace function public.auth_revoke_user_sessions_tx(
  p_target_user_id  text,
  p_actor_id        text,
  p_actor_username  text,
  p_idempotency_key uuid,
  p_ip              text default null,
  p_user_agent      text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_dedupe    text;
  v_existing  record;
  v_target    record;
  v_now       timestamptz := now();
  v_deleted   integer := 0;
begin
  if p_target_user_id is null or btrim(p_target_user_id) = '' then
    raise exception 'auth_revoke: targetUserId is required' using errcode = 'AU422';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = ''
     or p_actor_username is null or btrim(p_actor_username) = '' then
    raise exception 'auth_revoke: actor id and username are required' using errcode = 'AU422';
  end if;
  if p_idempotency_key is null then
    raise exception 'auth_revoke: idempotencyKey is required' using errcode = 'AU422';
  end if;
  if p_target_user_id = p_actor_id then
    raise exception 'auth_revoke: you cannot revoke your own active session' using errcode = 'AU422';
  end if;

  v_dedupe := 'auth.session.revoked:' || p_idempotency_key::text;

  select payload->>'targetUserId' as target, payload->>'revokedAt' as revoked_at,
         coalesce((payload->>'deletedTokens')::int, 0) as deleted_tokens
    into v_existing
    from public.app_events where dedupe_key = v_dedupe;
  if found then
    if v_existing.target is distinct from p_target_user_id then
      raise exception 'auth_revoke: idempotency key was already used for a different target' using errcode = 'AU409';
    end if;
    return jsonb_build_object('revokedAt', v_existing.revoked_at,
                              'deletedTokens', v_existing.deleted_tokens, 'replay', true);
  end if;

  select id, username into v_target from public.app_users
   where id = p_target_user_id for update;
  if not found then
    raise exception 'auth_revoke: target user % not found', p_target_user_id using errcode = 'AU404';
  end if;

  insert into public.session_revocations (user_id, revoked_at, revoked_by)
  values (p_target_user_id, v_now, p_actor_username)
  on conflict (user_id) do update
    set revoked_at = excluded.revoked_at, revoked_by = excluded.revoked_by;

  delete from public.refresh_tokens where user_id = p_target_user_id;
  get diagnostics v_deleted = row_count;

  begin
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id,
       actor_user_id, severity, payload, dedupe_key)
    values
      ('auth.session.revoked', 'auth', 'user', p_target_user_id,
       p_actor_id, 'warning',
       jsonb_build_object('targetUserId', p_target_user_id, 'targetUsername', v_target.username,
                          'revokedBy', p_actor_username, 'revokedAt', v_now,
                          'deletedTokens', v_deleted),
       v_dedupe);
  exception when unique_violation then
    raise exception 'auth_revoke: idempotency key was already used for a different target' using errcode = 'AU409';
  end;

  insert into public.activity_logs
    (user_id, username, action, entity, entity_id, details, ip_address, user_agent)
  values
    (p_actor_id, p_actor_username, 'session_revoke', 'user', p_target_user_id,
     format('forced logout of user %s (%s tokens purged); re-authentication (incl. 2FA) required',
            p_target_user_id, v_deleted),
     p_ip, p_user_agent);

  return jsonb_build_object('revokedAt', v_now, 'deletedTokens', v_deleted, 'replay', false);
end;
$fn$;

revoke all on function public.auth_revoke_user_sessions_tx(text, text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.auth_revoke_user_sessions_tx(text, text, text, uuid, text, text)
  to service_role;
