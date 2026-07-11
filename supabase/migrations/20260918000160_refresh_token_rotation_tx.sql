-- ============================================================================
-- Auth -- atomic refresh-token rotation + preserved auth-method claims (P1-9)
-- ============================================================================
-- rotateRefreshToken() previously did select, then delete, then insert as three
-- separate PostgREST calls with UNCHECKED errors: two concurrent refreshes
-- could both consume the same token (or leave a session with no valid
-- replacement), and the re-signed access token silently LOST the session's
-- MFA/step-up claims (amr / authStrength / mfaVerifiedAt).
--   - rotate_refresh_token_tx consumes the old token with a single atomic
--     DELETE ... RETURNING (exactly one concurrent caller wins), validates
--     expiry + user status, and issues the replacement in the same tx.
--   - The auth-method claims are STORED on the refresh row (stamped at login/
--     step-up) and carried across rotation, so refreshed access tokens keep
--     the session's real strength.
-- ASCII only + named dollar-quote tag. Idempotent / re-runnable.
-- NOTE: apply this BEFORE deploying the matching backend -- issueRefreshToken()
-- writes the new columns on every login.
-- ============================================================================

alter table public.refresh_tokens add column if not exists amr             jsonb;
alter table public.refresh_tokens add column if not exists auth_strength   text;
alter table public.refresh_tokens add column if not exists mfa_satisfied   boolean not null default false;
alter table public.refresh_tokens add column if not exists mfa_verified_at timestamptz;

create or replace function public.rotate_refresh_token_tx(
  p_old_hash    text,
  p_new_hash    text,
  p_ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $rotate_rt$
declare
  v_old  refresh_tokens%rowtype;
  v_user_status text;
begin
  -- Atomic consume: exactly ONE concurrent caller gets the row back.
  delete from refresh_tokens
   where token_hash = p_old_hash
   returning * into v_old;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_old.expires_at < now() then
    -- Expired token consumed (cleanup); no replacement issued.
    return jsonb_build_object('status', 'expired');
  end if;

  select status into v_user_status from app_users where id = v_old.user_id;
  if v_user_status is distinct from 'active' then
    return jsonb_build_object('status', 'user_inactive');
  end if;

  insert into refresh_tokens
    (user_id, token_hash, expires_at, user_agent, ip_address, last_seen_at,
     amr, auth_strength, mfa_satisfied, mfa_verified_at)
  values
    (v_old.user_id, p_new_hash, now() + make_interval(secs => p_ttl_seconds),
     v_old.user_agent, v_old.ip_address, now(),
     v_old.amr, v_old.auth_strength, v_old.mfa_satisfied, v_old.mfa_verified_at);

  return jsonb_build_object(
    'status',          'rotated',
    'user_id',         v_old.user_id,
    'amr',             v_old.amr,
    'auth_strength',   v_old.auth_strength,
    'mfa_satisfied',   v_old.mfa_satisfied,
    'mfa_verified_at', v_old.mfa_verified_at
  );
end;
$rotate_rt$;

revoke all on function public.rotate_refresh_token_tx(text, text, integer) from public, anon, authenticated;
grant execute on function public.rotate_refresh_token_tx(text, text, integer) to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
