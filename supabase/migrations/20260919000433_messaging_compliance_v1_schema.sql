-- ============================================================================
-- Messenger Compliance V1: schema, dated critical grants, and storage
--
-- Browser clients have no direct access to these records. Authenticated Netlify
-- routes use the service-role client and transactional RPCs added by 434/435.
-- app_users.id is TEXT.
-- ============================================================================

begin;

-- Expired maker-checker requests must leave the pending set so they do not
-- permanently block a replacement request through the partial unique indexes.
alter table public.permission_grant_approvals
  drop constraint if exists permission_grant_approvals_status_check;
alter table public.permission_grant_approvals
  add constraint permission_grant_approvals_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired'));

-- Critical compliance permissions are per-user, time-bounded, revocable grants.
-- Non-critical overrides keep their existing timeless behavior.
alter table public.user_permissions
  add column if not exists valid_from        timestamptz,
  add column if not exists valid_until       timestamptz,
  add column if not exists approved_by       text references public.app_users(id) on delete set null,
  add column if not exists approval_id       text references public.permission_grant_approvals(id) on delete set null,
  add column if not exists revoked_at        timestamptz,
  add column if not exists revoked_by        text references public.app_users(id) on delete set null,
  add column if not exists revocation_reason text;

alter table public.permission_grant_approvals
  add column if not exists grant_valid_from  timestamptz,
  add column if not exists grant_valid_until timestamptz;

alter table public.user_permissions
  drop constraint if exists user_permissions_validity_check;
alter table public.user_permissions
  add constraint user_permissions_validity_check
  check (valid_until is null or (valid_from is not null and valid_until > valid_from));

alter table public.permission_grant_approvals
  drop constraint if exists pga_grant_validity_check;
alter table public.permission_grant_approvals
  add constraint pga_grant_validity_check
  check (
    grant_valid_until is null
    or (grant_valid_from is not null and grant_valid_until > grant_valid_from)
  );

create index if not exists user_permissions_active_validity_idx
  on public.user_permissions (user_id, permission, valid_until)
  where granted and revoked_at is null;

-- Existing undated compliance grants deliberately become inactive. They cannot
-- be trusted as V1 grants because no approved validity window exists.
update public.user_permissions
   set revoked_at = coalesce(revoked_at, now()),
       revocation_reason = coalesce(revocation_reason, 'Superseded by dated compliance grants')
 where permission in (
   'communications.compliance_read',
   'communications.compliance_export'
 )
   and (valid_from is null or valid_until is null);

-- Compliance authority is always per-user and dated. Remove any historical
-- role grants so no DB-backed role cache can restore these critical keys.
delete from public.role_permissions
 where permission in (
   'communications.compliance_read',
   'communications.compliance_export'
 );

-- Active critical permission predicate shared by all compliance RPCs.
create or replace function msg_internal._has_active_compliance_permission(
  p_actor_id text,
  p_permission text
) returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public, msg_internal
as $fn$
  select
    p_permission in (
      'communications.compliance_read',
      'communications.compliance_export'
    )
    and exists (
      select 1
        from public.app_users u
        join public.user_permissions up on up.user_id = u.id
       where u.id = p_actor_id
         and u.status = 'active'
         and up.permission = p_permission
         and up.granted = true
         and up.revoked_at is null
         and up.valid_from is not null
         and up.valid_from <= now()
         and up.valid_until is not null
         and up.valid_until > now()
    )
$fn$;

revoke all on function msg_internal._has_active_compliance_permission(text, text)
  from public, anon, authenticated;
grant execute on function msg_internal._has_active_compliance_permission(text, text)
  to service_role;

-- Apply an approved critical permission request with its validity dates in the
-- same transaction as the approval state change. Compliance keys are per-user;
-- role grants are rejected so a role name can never confer sensitive access.
create or replace function public.approve_permission_grant_tx(
  p_approval_id      text,
  p_checker_id       text,
  p_checker_username text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_row public.permission_grant_approvals%rowtype;
  v_now timestamptz := now();
  v_is_compliance boolean;
  v_effective_valid_from timestamptz;
  v_event_id uuid;
  v_target_status text;
  v_expired_approval_id text;
begin
  select *
    into v_row
    from public.permission_grant_approvals
   where id = p_approval_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('status', 'not_pending', 'current', v_row.status);
  end if;
  if v_row.expires_at <= v_now then
    update public.permission_grant_approvals
       set status = 'expired',
           decided_at = v_now,
           decision_reason = 'Approval request expired before a decision.'
     where id = v_row.id;
    insert into public.app_events (
      event_type, source_module, source_entity_type, source_entity_id,
      actor_user_id, severity, payload, dedupe_key
    ) values (
      'iam.permission.grant_expired', 'platform', 'permission_grant_approval',
      v_row.id, p_checker_id, 'warning',
      jsonb_build_object('permissionKey', v_row.permission_key),
      'iam.permission.grant_expired:' || v_row.id
    );
    insert into public.audit_logs (
      action, table_name, record_id, user_id, changes
    ) values (
      'iam.permission.grant_expired', 'permission_grant_approval',
      v_row.id, p_checker_id,
      jsonb_build_object('permissionKey', v_row.permission_key)
    );
    return jsonb_build_object('status', 'expired');
  end if;
  if v_row.requested_by = p_checker_id then
    return jsonb_build_object('status', 'self_approval');
  end if;

  v_is_compliance := v_row.permission_key in (
    'communications.compliance_read',
    'communications.compliance_export'
  );

  if v_is_compliance then
    if v_row.request_type <> 'user_override' or v_row.target_user_id is null then
      return jsonb_build_object('status', 'invalid_compliance_target');
    end if;
    if v_row.effect <> 'allow' then
      return jsonb_build_object('status', 'invalid_compliance_effect');
    end if;
    if v_row.grant_valid_from is null
       or v_row.grant_valid_until is null
       or v_row.grant_valid_until <= v_now
       or v_row.grant_valid_until > v_row.grant_valid_from + interval '90 days' then
      return jsonb_build_object('status', 'invalid_validity');
    end if;
    select status
      into v_target_status
      from public.app_users
     where id = v_row.target_user_id
     for update;
    if not found or v_target_status <> 'active' then
      update public.permission_grant_approvals
         set status = 'rejected',
             decided_by = p_checker_id,
             decided_at = v_now,
             decision_reason = 'Target user is not active.'
       where id = v_row.id;
      insert into public.app_events (
        event_type, source_module, source_entity_type, source_entity_id,
        actor_user_id, severity, payload, dedupe_key
      ) values (
        'iam.permission.grant_rejected', 'platform', 'permission_grant_approval',
        v_row.id, p_checker_id, 'warning',
        jsonb_build_object(
          'permissionKey', v_row.permission_key,
          'targetUserId', v_row.target_user_id,
          'reason', 'target_inactive'
        ),
        'iam.permission.grant_rejected:' || v_row.id
      );
      insert into public.audit_logs (
        action, table_name, record_id, user_id, changes
      ) values (
        'iam.permission.grant_rejected', 'permission_grant_approval',
        v_row.id, p_checker_id,
        jsonb_build_object(
          'permissionKey', v_row.permission_key,
          'targetUserId', v_row.target_user_id,
          'reason', 'target_inactive'
        )
      );
      return jsonb_build_object('status', 'target_inactive');
    end if;
    v_effective_valid_from := greatest(v_row.grant_valid_from, v_now);
  end if;

  if v_row.request_type = 'role_permission' then
    if v_row.effect = 'allow' then
      insert into public.role_permissions (role_name, permission)
      values (v_row.target_role, v_row.permission_key)
      on conflict (role_name, permission) do nothing;
    else
      delete from public.role_permissions
       where role_name = v_row.target_role
         and permission = v_row.permission_key;
    end if;
  else
    insert into public.user_permissions (
      user_id, permission, granted, set_by, set_at,
      valid_from, valid_until, approved_by, approval_id,
      revoked_at, revoked_by, revocation_reason
    ) values (
      v_row.target_user_id,
      v_row.permission_key,
      (v_row.effect = 'allow'),
      p_checker_username,
      v_now,
      case when v_is_compliance then v_effective_valid_from else null end,
      case when v_is_compliance then v_row.grant_valid_until else null end,
      case when v_is_compliance then p_checker_id else null end,
      case when v_is_compliance then v_row.id else null end,
      null, null, null
    )
    on conflict (user_id, permission) do update
      set granted          = excluded.granted,
          set_by           = excluded.set_by,
          set_at           = excluded.set_at,
          valid_from       = excluded.valid_from,
          valid_until      = excluded.valid_until,
          approved_by      = excluded.approved_by,
          approval_id      = excluded.approval_id,
          revoked_at       = null,
          revoked_by       = null,
          revocation_reason = null;
  end if;

  update public.permission_grant_approvals
     set status = 'approved',
         decided_by = p_checker_id,
         decided_at = v_now,
         applied_at = v_now
   where id = p_approval_id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'iam.permission.grant_approved',
    'platform',
    'permission_grant_approval',
    v_row.id,
    p_checker_id,
    'warning',
    jsonb_build_object(
      'permissionKey', v_row.permission_key,
      'requestType', v_row.request_type,
      'target', coalesce(v_row.target_user_id, v_row.target_role),
      'requestedBy', v_row.requested_by,
      'grantValidFrom', case when v_is_compliance then v_effective_valid_from else null end,
      'grantValidUntil', case when v_is_compliance then v_row.grant_valid_until else null end
    ),
    'iam.permission.grant_approved:' || v_row.id
  )
  returning id into v_event_id;

  insert into public.audit_logs (
    action, table_name, record_id, user_id, changes
  ) values (
    'iam.permission.grant_approved',
    'permission_grant_approval',
    v_row.id,
    p_checker_id,
    jsonb_build_object(
      'permissionKey', v_row.permission_key,
      'requestType', v_row.request_type,
      'target', coalesce(v_row.target_user_id, v_row.target_role),
      'requestedBy', v_row.requested_by,
      'grantValidFrom', case when v_is_compliance then v_effective_valid_from else null end,
      'grantValidUntil', case when v_is_compliance then v_row.grant_valid_until else null end
    )
  );

  return jsonb_build_object(
    'status', 'applied',
    'request_type', v_row.request_type,
    'target_role', v_row.target_role,
    'target_user_id', v_row.target_user_id,
    'permission_key', v_row.permission_key,
    'effect', v_row.effect,
    'requested_by', v_row.requested_by,
    'grant_valid_from', case when v_is_compliance then v_effective_valid_from else null end,
    'grant_valid_until', case when v_is_compliance then v_row.grant_valid_until else null end,
    'event_id', v_event_id
  );
end
$fn$;

revoke all on function public.approve_permission_grant_tx(text, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_permission_grant_tx(text, text, text)
  to service_role;

-- Reject and cancel keep approval state, app_events, and audit evidence in one
-- transaction. These replace the older state-only RPCs.
create or replace function public.reject_permission_grant_tx(
  p_approval_id text,
  p_checker_id  text,
  p_reason      text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_row public.permission_grant_approvals%rowtype;
  v_now timestamptz := now();
  v_event_id uuid;
begin
  select *
    into v_row
    from public.permission_grant_approvals
   where id = p_approval_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('status', 'not_pending', 'current', v_row.status);
  end if;
  if v_row.requested_by = p_checker_id then
    return jsonb_build_object('status', 'self_approval');
  end if;

  update public.permission_grant_approvals
     set status = 'rejected',
         decided_by = p_checker_id,
         decided_at = v_now,
         decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = v_row.id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'iam.permission.grant_rejected',
    'platform',
    'permission_grant_approval',
    v_row.id,
    p_checker_id,
    'info',
    jsonb_build_object(
      'permissionKey', v_row.permission_key,
      'requestType', v_row.request_type,
      'target', coalesce(v_row.target_user_id, v_row.target_role),
      'requestedBy', v_row.requested_by,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    ),
    'iam.permission.grant_rejected:' || v_row.id
  )
  returning id into v_event_id;

  insert into public.audit_logs (
    action, table_name, record_id, user_id, changes
  ) values (
    'iam.permission.grant_rejected',
    'permission_grant_approval',
    v_row.id,
    p_checker_id,
    jsonb_build_object(
      'permissionKey', v_row.permission_key,
      'requestType', v_row.request_type,
      'target', coalesce(v_row.target_user_id, v_row.target_role),
      'requestedBy', v_row.requested_by,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  return jsonb_build_object(
    'status', 'rejected',
    'permission_key', v_row.permission_key,
    'requested_by', v_row.requested_by,
    'event_id', v_event_id
  );
end
$fn$;

create or replace function public.cancel_permission_grant_tx(
  p_approval_id text,
  p_actor_id    text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_row public.permission_grant_approvals%rowtype;
  v_now timestamptz := now();
  v_event_id uuid;
begin
  select *
    into v_row
    from public.permission_grant_approvals
   where id = p_approval_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('status', 'not_pending', 'current', v_row.status);
  end if;
  if v_row.requested_by <> p_actor_id then
    return jsonb_build_object('status', 'not_requester');
  end if;

  update public.permission_grant_approvals
     set status = 'cancelled',
         decided_by = p_actor_id,
         decided_at = v_now
   where id = v_row.id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'iam.permission.grant_cancelled',
    'platform',
    'permission_grant_approval',
    v_row.id,
    p_actor_id,
    'info',
    jsonb_build_object(
      'permissionKey', v_row.permission_key,
      'requestType', v_row.request_type,
      'target', coalesce(v_row.target_user_id, v_row.target_role)
    ),
    'iam.permission.grant_cancelled:' || v_row.id
  )
  returning id into v_event_id;

  insert into public.audit_logs (
    action, table_name, record_id, user_id, changes
  ) values (
    'iam.permission.grant_cancelled',
    'permission_grant_approval',
    v_row.id,
    p_actor_id,
    jsonb_build_object(
      'permissionKey', v_row.permission_key,
      'requestType', v_row.request_type,
      'target', coalesce(v_row.target_user_id, v_row.target_role)
    )
  );

  return jsonb_build_object(
    'status', 'cancelled',
    'permission_key', v_row.permission_key,
    'event_id', v_event_id
  );
end
$fn$;

revoke all on function public.reject_permission_grant_tx(text, text, text)
  from public, anon, authenticated;
grant execute on function public.reject_permission_grant_tx(text, text, text)
  to service_role;
revoke all on function public.cancel_permission_grant_tx(text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_permission_grant_tx(text, text)
  to service_role;

-- Request a dated per-user compliance grant with its immutable event and audit
-- evidence. The partial pending-approval index remains the concurrency arbiter.
create or replace function public.request_compliance_permission_grant_tx(
  p_request_id       text,
  p_actor_id         text,
  p_target_user_id   text,
  p_permission_key   text,
  p_reason           text,
  p_grant_valid_from timestamptz,
  p_grant_valid_until timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_now timestamptz := now();
  v_event_id uuid;
  v_constraint_name text;
begin
  if p_request_id is null or btrim(p_request_id) = ''
     or p_actor_id is null or btrim(p_actor_id) = ''
     or p_target_user_id is null or btrim(p_target_user_id) = '' then
    raise exception 'request_compliance_permission_grant: request, actor, and target are required'
      using errcode = 'MG400';
  end if;
  if p_permission_key not in (
    'communications.compliance_read',
    'communications.compliance_export'
  ) then
    raise exception 'request_compliance_permission_grant: invalid permission'
      using errcode = 'MG422';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'request_compliance_permission_grant: reason must be 5-500 characters'
      using errcode = 'MG422';
  end if;
  if p_grant_valid_from is null
     or p_grant_valid_until is null
     or p_grant_valid_from < v_now - interval '5 minutes'
     or p_grant_valid_from > v_now + interval '30 days'
     or p_grant_valid_until <= greatest(p_grant_valid_from, v_now)
     or p_grant_valid_until > p_grant_valid_from + interval '90 days' then
    raise exception 'request_compliance_permission_grant: invalid validity window'
      using errcode = 'MG422';
  end if;
  if not exists (
    select 1 from public.app_users where id = p_actor_id and status = 'active'
  ) then
    raise exception 'request_compliance_permission_grant: actor is not active'
      using errcode = 'MG403';
  end if;
  if not exists (
    select 1 from public.app_users where id = p_target_user_id and status = 'active'
  ) then
    raise exception 'request_compliance_permission_grant: target is not active'
      using errcode = 'MG422';
  end if;

  update public.permission_grant_approvals
     set status = 'expired',
         decided_at = v_now,
         decision_reason = 'Approval request expired before replacement.'
   where request_type = 'user_override'
     and target_user_id = p_target_user_id
     and permission_key = p_permission_key
     and status = 'pending'
     and expires_at <= v_now
  returning id into v_expired_approval_id;

  if v_expired_approval_id is not null then
    insert into public.app_events (
      event_type, source_module, source_entity_type, source_entity_id,
      actor_user_id, severity, payload, dedupe_key
    ) values (
      'iam.permission.grant_expired', 'platform', 'permission_grant_approval',
      v_expired_approval_id, p_actor_id, 'warning',
      jsonb_build_object(
        'permissionKey', p_permission_key,
        'targetUserId', p_target_user_id
      ),
      'iam.permission.grant_expired:' || v_expired_approval_id
    );
    insert into public.audit_logs (
      action, table_name, record_id, user_id, changes
    ) values (
      'iam.permission.grant_expired', 'permission_grant_approval',
      v_expired_approval_id, p_actor_id,
      jsonb_build_object(
        'permissionKey', p_permission_key,
        'targetUserId', p_target_user_id
      )
    );
  end if;

  begin
    insert into public.permission_grant_approvals (
      id, request_type, target_user_id, target_role, permission_key, effect,
      reason, status, requested_by, expires_at,
      grant_valid_from, grant_valid_until
    ) values (
      p_request_id, 'user_override', p_target_user_id, null, p_permission_key,
      'allow', btrim(p_reason), 'pending', p_actor_id,
      v_now + interval '7 days', p_grant_valid_from, p_grant_valid_until
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'pga_uniq_pending_user' then
      return jsonb_build_object('status', 'already_pending');
    end if;
    raise;
  end;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'iam.permission.grant_requested',
    'platform',
    'permission_grant_approval',
    p_request_id,
    p_actor_id,
    'warning',
    jsonb_build_object(
      'permissionKey', p_permission_key,
      'requestType', 'user_override',
      'targetUserId', p_target_user_id,
      'grantValidFrom', p_grant_valid_from,
      'grantValidUntil', p_grant_valid_until
    ),
    'iam.permission.grant_requested:' || p_request_id
  )
  returning id into v_event_id;

  insert into public.audit_logs (
    action, table_name, record_id, user_id, changes
  ) values (
    'iam.permission.grant_requested',
    'permission_grant_approval',
    p_request_id,
    p_actor_id,
    jsonb_build_object(
      'permissionKey', p_permission_key,
      'requestType', 'user_override',
      'targetUserId', p_target_user_id,
      'grantValidFrom', p_grant_valid_from,
      'grantValidUntil', p_grant_valid_until
    )
  );

  return jsonb_build_object(
    'status', 'requested',
    'approval_id', p_request_id,
    'event_id', v_event_id
  );
end
$fn$;

revoke all on function public.request_compliance_permission_grant_tx(
  text, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.request_compliance_permission_grant_tx(
  text, text, text, text, text, timestamptz, timestamptz
) to service_role;

-- Manual revocation preserves the dated grant row as evidence. Explicit deny
-- rows are not grants and are deleted when cleared.
create or replace function public.revoke_compliance_permission_grant_tx(
  p_actor_id       text,
  p_target_user_id text,
  p_permission_key text,
  p_reason         text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_row public.user_permissions%rowtype;
  v_now timestamptz := now();
  v_event_id uuid;
begin
  if p_actor_id is null or btrim(p_actor_id) = ''
     or p_target_user_id is null or btrim(p_target_user_id) = '' then
    raise exception 'revoke_compliance_permission_grant: actor and target are required'
      using errcode = 'MG400';
  end if;
  if p_permission_key not in (
    'communications.compliance_read',
    'communications.compliance_export'
  ) then
    raise exception 'revoke_compliance_permission_grant: invalid permission'
      using errcode = 'MG422';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'revoke_compliance_permission_grant: reason must be 5-500 characters'
      using errcode = 'MG422';
  end if;

  select *
    into v_row
    from public.user_permissions
   where user_id = p_target_user_id
     and permission = p_permission_key
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if not v_row.granted then
    delete from public.user_permissions
     where user_id = p_target_user_id and permission = p_permission_key;

    insert into public.app_events (
      event_type, source_module, source_entity_type, source_entity_id,
      actor_user_id, severity, payload, dedupe_key
    ) values (
      'iam.permission.override_cleared',
      'platform',
      'user_permission',
      p_target_user_id || ':' || p_permission_key,
      p_actor_id,
      'warning',
      jsonb_build_object(
        'permissionKey', p_permission_key,
        'targetUserId', p_target_user_id,
        'clearedEffect', 'deny'
      ),
      'iam.permission.override_cleared:' || p_target_user_id || ':'
        || p_permission_key || ':' || v_now::text
    )
    returning id into v_event_id;

    insert into public.audit_logs (
      action, table_name, record_id, user_id, changes
    ) values (
      'iam.permission.override_cleared',
      'user_permission',
      p_target_user_id || ':' || p_permission_key,
      p_actor_id,
      jsonb_build_object(
        'permissionKey', p_permission_key,
        'targetUserId', p_target_user_id,
        'clearedEffect', 'deny'
      )
    );

    return jsonb_build_object(
      'status', 'deny_cleared',
      'event_id', v_event_id
    );
  end if;
  if v_row.revoked_at is not null then
    return jsonb_build_object('status', 'already_revoked');
  end if;

  update public.user_permissions
     set revoked_at = v_now,
         revoked_by = p_actor_id,
         revocation_reason = btrim(p_reason),
         set_by = p_actor_id,
         set_at = v_now
   where user_id = p_target_user_id
     and permission = p_permission_key;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'iam.permission.grant_revoked',
    'platform',
    'user_permission',
    p_target_user_id || ':' || p_permission_key,
    p_actor_id,
    'high',
    jsonb_build_object(
      'permissionKey', p_permission_key,
      'targetUserId', p_target_user_id,
      'revokedAt', v_now
    ),
    'iam.permission.grant_revoked:' || p_target_user_id || ':' || p_permission_key
      || ':' || v_now::text
  )
  returning id into v_event_id;

  insert into public.audit_logs (
    action, table_name, record_id, user_id, changes
  ) values (
    'iam.permission.grant_revoked',
    'user_permission',
    p_target_user_id || ':' || p_permission_key,
    p_actor_id,
    jsonb_build_object(
      'permissionKey', p_permission_key,
      'targetUserId', p_target_user_id,
      'reason', btrim(p_reason),
      'revokedAt', v_now
    )
  );

  return jsonb_build_object(
    'status', 'revoked',
    'revoked_at', v_now,
    'event_id', v_event_id
  );
end
$fn$;

revoke all on function public.revoke_compliance_permission_grant_tx(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.revoke_compliance_permission_grant_tx(
  text, text, text, text
) to service_role;

-- Investigation cases.
create table public.message_compliance_cases (
  id              uuid primary key default gen_random_uuid(),
  case_no         text not null unique,
  title           text not null,
  case_type       text not null check (case_type in (
    'hr_investigation',
    'safety_investigation',
    'legal_request',
    'security_investigation',
    'other_formal_investigation'
  )),
  reason          text not null,
  status          text not null default 'pending_approval' check (status in (
    'pending_approval', 'approved', 'rejected', 'closed'
  )),
  requested_by    text not null references public.app_users(id),
  requested_at    timestamptz not null default now(),
  approved_by     text references public.app_users(id),
  approved_at     timestamptz,
  rejected_by     text references public.app_users(id),
  rejected_at     timestamptz,
  decision_reason text,
  valid_from      timestamptz,
  valid_until     timestamptz not null,
  closed_by       text references public.app_users(id),
  closed_at       timestamptz,
  close_reason    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint message_compliance_cases_title_check
    check (char_length(btrim(title)) between 3 and 160),
  constraint message_compliance_cases_reason_check
    check (char_length(btrim(reason)) between 10 and 2000),
  constraint message_compliance_cases_validity_check
    check (
      valid_until > requested_at
      and valid_until <= requested_at + interval '30 days'
    ),
  constraint message_compliance_cases_decision_shape_check
    check (
      (status = 'pending_approval'
        and approved_by is null and approved_at is null
        and rejected_by is null and rejected_at is null
        and closed_by is null and closed_at is null)
      or
      (status = 'approved'
        and approved_by is not null and approved_at is not null
        and approved_by <> requested_by
        and valid_from is not null
        and rejected_by is null and rejected_at is null
        and closed_by is null and closed_at is null)
      or
      (status = 'rejected'
        and rejected_by is not null and rejected_at is not null
        and approved_by is null and approved_at is null
        and closed_by is null and closed_at is null)
      or
      (status = 'closed'
        and closed_by is not null and closed_at is not null)
    )
);

create index message_compliance_cases_status_expiry_idx
  on public.message_compliance_cases (status, valid_until);
create index message_compliance_cases_requester_idx
  on public.message_compliance_cases (requested_by, created_at desc);
create index message_compliance_cases_approver_idx
  on public.message_compliance_cases (approved_by, approved_at desc);

create trigger trg_message_compliance_cases_updated_at
  before update on public.message_compliance_cases
  for each row execute function public.set_updated_at();

-- Explicitly selected conversations. No message content is copied here.
create table public.message_compliance_case_threads (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.message_compliance_cases(id),
  thread_id      uuid not null references public.message_threads(id),
  relevance_note text not null,
  added_by       text not null references public.app_users(id),
  created_at     timestamptz not null default now(),
  constraint message_compliance_case_threads_relevance_check
    check (char_length(btrim(relevance_note)) between 5 and 1000),
  constraint message_compliance_case_threads_case_thread_key
    unique (case_id, thread_id),
  constraint message_compliance_case_threads_identity_key
    unique (id, case_id, thread_id)
);

create index message_compliance_case_threads_thread_idx
  on public.message_compliance_case_threads (thread_id, case_id);

-- Legacy self-grants cannot be promoted into approved-case grants because they
-- have no maker-checker case provenance. Remove them before hardening the table.
delete from public.message_thread_access_grants;

drop index if exists public.idx_msg_access_grants_lookup;
drop index if exists public.idx_msg_access_grants_user;

alter table public.message_thread_access_grants
  drop column if exists reason,
  drop column if exists case_ref,
  drop column if exists notes,
  drop column if exists exported_at,
  add column case_id         uuid not null references public.message_compliance_cases(id),
  add column case_thread_id  uuid not null,
  add column granted_by      text not null references public.app_users(id),
  add column revoked_by      text references public.app_users(id),
  add column revoke_reason   text,
  add column last_accessed_at timestamptz;

alter table public.message_thread_access_grants
  add constraint message_thread_access_grants_case_thread_fk
  foreign key (case_thread_id, case_id, thread_id)
  references public.message_compliance_case_threads (id, case_id, thread_id);

alter table public.message_thread_access_grants
  add constraint message_thread_access_grants_expiry_check
  check (expires_at > granted_at and expires_at <= granted_at + interval '7 days'),
  add constraint message_thread_access_grants_revoke_shape_check
  check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or
    (revoked_at is not null and revoked_by is not null
      and char_length(btrim(revoke_reason)) between 5 and 1000)
  ),
  add constraint message_thread_access_grants_scope_key
  unique (case_id, thread_id, user_id),
  add constraint message_thread_access_grants_identity_key
  unique (id, case_id, thread_id);

create index message_thread_access_grants_active_idx
  on public.message_thread_access_grants (user_id, thread_id, expires_at)
  where revoked_at is null;
create index message_thread_access_grants_case_idx
  on public.message_thread_access_grants (case_id, granted_at desc);

-- Immutable evidence. thread_id is nullable for case-level events; read/export
-- events always populate it through their transactional RPC.
create table public.message_compliance_access_events (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.message_compliance_cases(id),
  grant_id        uuid,
  thread_id       uuid,
  actor_user_id   text not null references public.app_users(id),
  event_type      text not null check (event_type in (
    'case_requested',
    'case_approved',
    'case_rejected',
    'conversation_opened',
    'page_read',
    'grant_revoked',
    'export_requested',
    'export_generated',
    'export_downloaded',
    'case_closed'
  )),
  occurred_at     timestamptz not null default now(),
  request_id      text not null,
  ip_hash         text,
  user_agent_hash text,
  hash_key_version text,
  details         jsonb not null default '{}'::jsonb,
  constraint message_compliance_access_events_request_key
    unique (event_type, request_id),
  constraint message_compliance_access_events_grant_scope_fk
    foreign key (grant_id, case_id, thread_id)
    references public.message_thread_access_grants (id, case_id, thread_id),
  constraint message_compliance_access_events_shape_check
    check (
      (
        event_type in (
          'case_requested', 'case_approved', 'case_rejected', 'case_closed'
        )
        and grant_id is null
        and thread_id is null
      )
      or
      (
        event_type in (
          'conversation_opened', 'page_read', 'grant_revoked',
          'export_requested', 'export_generated', 'export_downloaded'
        )
        and grant_id is not null
        and thread_id is not null
      )
    ),
  constraint message_compliance_access_events_hash_shape_check
    check (
      (ip_hash is null and user_agent_hash is null and hash_key_version is null)
      or
      ((ip_hash is not null or user_agent_hash is not null)
        and hash_key_version ~ '^[A-Za-z0-9._-]{1,32}$')
    )
);

create index message_compliance_access_events_case_idx
  on public.message_compliance_access_events (case_id, occurred_at desc);
create index message_compliance_access_events_actor_idx
  on public.message_compliance_access_events (actor_user_id, occurred_at desc);
create index message_compliance_access_events_thread_idx
  on public.message_compliance_access_events (thread_id, occurred_at desc)
  where thread_id is not null;

create or replace function public.block_compliance_access_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  raise exception 'message_compliance_access_events is append-only'
    using errcode = 'MG403';
end
$fn$;

create trigger trg_message_compliance_access_events_immutable
  before update or delete on public.message_compliance_access_events
  for each row execute function public.block_compliance_access_event_mutation();

-- Durable metadata for generated evidence artifacts.
create table public.message_compliance_exports (
  id                 uuid primary key default gen_random_uuid(),
  export_no          text not null unique,
  case_id            uuid not null references public.message_compliance_cases(id),
  grant_id           uuid not null,
  thread_id          uuid not null,
  requested_by       text not null references public.app_users(id),
  format             text not null check (format in ('pdf', 'json')),
  range_from         timestamptz,
  range_to           timestamptz,
  purpose            text not null,
  status             text not null default 'requested' check (status in (
    'requested', 'uploading', 'ready', 'failed'
  )),
  message_count      integer,
  storage_path       text,
  file_size          bigint,
  sha256             text,
  serializer_version text,
  snapshot_at        timestamptz,
  upload_started_at  timestamptz,
  requested_at       timestamptz not null default now(),
  generated_at       timestamptz,
  failure_code       text,
  constraint message_compliance_exports_grant_scope_fk
    foreign key (grant_id, case_id, thread_id)
    references public.message_thread_access_grants (id, case_id, thread_id),
  constraint message_compliance_exports_range_check
    check (range_to is null or (range_from is not null and range_to >= range_from)),
  constraint message_compliance_exports_purpose_check
    check (char_length(btrim(purpose)) between 5 and 1000),
  constraint message_compliance_exports_ready_shape_check
    check (
      (status = 'requested'
        and message_count is null and storage_path is null and file_size is null
        and sha256 is null and serializer_version is null and snapshot_at is null
        and upload_started_at is null
        and generated_at is null
        and failure_code is null)
      or
      (status = 'uploading'
        and message_count between 0 and 5000
        and storage_path is not null and file_size > 0
        and sha256 ~ '^[0-9a-f]{64}$'
        and serializer_version is not null and snapshot_at is not null
        and upload_started_at is not null
        and generated_at is null and failure_code is null)
      or
      (status = 'ready'
        and message_count between 0 and 5000
        and storage_path is not null and file_size > 0
        and sha256 ~ '^[0-9a-f]{64}$'
        and serializer_version is not null and snapshot_at is not null
        and upload_started_at is not null
        and generated_at is not null
        and failure_code is null)
      or
      (status = 'failed'
        and failure_code is not null and generated_at is not null
        and (
          (message_count is null and storage_path is null and file_size is null
            and sha256 is null and serializer_version is null and snapshot_at is null
            and upload_started_at is null)
          or
          (message_count between 0 and 5000
            and storage_path is not null and file_size > 0
            and sha256 ~ '^[0-9a-f]{64}$'
            and serializer_version is not null and snapshot_at is not null
            and upload_started_at is not null)
        ))
    )
);

create index message_compliance_exports_case_idx
  on public.message_compliance_exports (case_id, requested_at desc);
create index message_compliance_exports_requester_idx
  on public.message_compliance_exports (requested_by, requested_at desc);

create or replace function public.guard_compliance_export_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'message_compliance_exports cannot be deleted'
      using errcode = 'MG403';
  end if;
  if old.status in ('ready', 'failed') then
    raise exception 'completed message compliance exports are immutable'
      using errcode = 'MG409';
  end if;
  if old.status = 'uploading' and new.status not in ('ready', 'failed') then
    raise exception 'uploading message compliance exports can only complete or fail'
      using errcode = 'MG409';
  end if;
  if old.status = 'requested' and new.status not in ('uploading', 'failed') then
    raise exception 'requested message compliance exports must prepare upload before completion'
      using errcode = 'MG409';
  end if;
  if new.id is distinct from old.id
     or new.export_no is distinct from old.export_no
     or new.case_id is distinct from old.case_id
     or new.grant_id is distinct from old.grant_id
     or new.thread_id is distinct from old.thread_id
     or new.requested_by is distinct from old.requested_by
     or new.format is distinct from old.format
     or new.range_from is distinct from old.range_from
     or new.range_to is distinct from old.range_to
     or new.purpose is distinct from old.purpose
     or new.requested_at is distinct from old.requested_at then
    raise exception 'message compliance export request identity is immutable'
      using errcode = 'MG409';
  end if;
  if old.status = 'uploading' and (
    new.message_count is distinct from old.message_count
    or new.storage_path is distinct from old.storage_path
    or new.file_size is distinct from old.file_size
    or new.sha256 is distinct from old.sha256
    or new.serializer_version is distinct from old.serializer_version
    or new.snapshot_at is distinct from old.snapshot_at
    or new.upload_started_at is distinct from old.upload_started_at
  ) then
    raise exception 'message compliance export artifact identity is immutable'
      using errcode = 'MG409';
  end if;
  return new;
end
$fn$;

create trigger trg_message_compliance_exports_guard
  before update or delete on public.message_compliance_exports
  for each row execute function public.guard_compliance_export_mutation();

-- Private object storage. Objects are written/read only by backend service-role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-compliance-exports',
  'message-compliance-exports',
  false,
  20971520,
  array['application/pdf', 'application/json']::text[]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Deny browser access to all compliance data. Backend service_role bypasses RLS.
alter table public.message_compliance_cases enable row level security;
alter table public.message_compliance_case_threads enable row level security;
alter table public.message_thread_access_grants enable row level security;
alter table public.message_compliance_access_events enable row level security;
alter table public.message_compliance_exports enable row level security;

drop policy if exists "authenticated read msg access grants"
  on public.message_thread_access_grants;

revoke all on table public.message_compliance_cases from public, anon, authenticated;
revoke all on table public.message_compliance_case_threads from public, anon, authenticated;
revoke all on table public.message_thread_access_grants from public, anon, authenticated;
revoke all on table public.message_compliance_access_events from public, anon, authenticated;
revoke all on table public.message_compliance_exports from public, anon, authenticated;

grant select, insert, update, delete on table public.message_compliance_cases to service_role;
grant select, insert, update, delete on table public.message_compliance_case_threads to service_role;
grant select, insert, update, delete on table public.message_thread_access_grants to service_role;
grant select, insert on table public.message_compliance_access_events to service_role;
grant select, insert, update on table public.message_compliance_exports to service_role;

commit;

notify pgrst, 'reload schema';
