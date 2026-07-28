-- ============================================================================
-- Employee Profile S2A step 3 — atomic access-assignment commands
-- ============================================================================
-- Granting an access assignment writes FOUR things that must land together:
--   1. the assignment row,
--   2. its explicit scope rows,
--   3. app_events,
--   4. hr_audit_log.
--
-- supabase-js issues a SEPARATE PostgREST call per statement, so the app layer
-- cannot wrap these in one transaction: a failure midway leaves an access grant
-- with no scopes and no audit trail — an access record that silently claims more
-- reach than was authorised. These commands therefore live in the database.
--
-- One correlation id threads the assignment, event and audit row.
--
-- Operator-applied. The schema reload is executed by the migration itself.
--
-- ⚠ Apply this file WHOLE. The trailing REVOKE is what stops these
--   SECURITY DEFINER functions being callable by anon/authenticated, and it is
--   exactly the tail the SQL editor has silently dropped before. Verify with
--   supabase/verify-20260928000002.sql after applying.
-- ============================================================================

-- ── grant ───────────────────────────────────────────────────────────────────
create or replace function public.hr_access_assignment_grant_tx(
  p_actor_id          text,
  p_employee_id       text,
  p_access_profile_id uuid,
  p_assignment_type   text,
  p_effective_from    date,
  p_scopes            jsonb,
  p_correlation_id    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
  v_scope         jsonb;
  v_profile_label text;
  v_scope_count   int := 0;
begin
  if p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'actor is required' using errcode = '22023';
  end if;
  if p_correlation_id is null or length(trim(p_correlation_id)) = 0 then
    raise exception 'correlation id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_scopes) <> 'array' or jsonb_array_length(p_scopes) = 0 then
    -- Fail closed: an assignment with no recorded scope would be an unbounded
    -- grant, and scope must never be inferred later from a role label.
    raise exception 'at least one scope is required' using errcode = '22023';
  end if;

  select label into v_profile_label
    from public.hr_access_profiles
   where id = p_access_profile_id and is_active;
  if v_profile_label is null then
    raise exception 'access profile not found or inactive' using errcode = 'P0002';
  end if;

  insert into public.hr_employee_access_assignments (
    employee_id, access_profile_id, assignment_type, status,
    effective_from, granted_by, granted_at
  ) values (
    p_employee_id, p_access_profile_id, coalesce(nullif(p_assignment_type, ''), 'profile'),
    'active', coalesce(p_effective_from, current_date), p_actor_id, now()
  )
  returning id into v_assignment_id;

  for v_scope in select * from jsonb_array_elements(p_scopes)
  loop
    insert into public.hr_employee_access_scopes (assignment_id, scope_type, scope_id)
    values (
      v_assignment_id,
      v_scope->>'scopeType',
      nullif(v_scope->>'scopeId', '')
    );
    v_scope_count := v_scope_count + 1;
  end loop;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'hr.employee.access_assignment.granted', 'hr', 'employee_access_assignment',
    v_assignment_id::text, p_actor_id, 'warning',
    jsonb_build_object(
      'employeeId', p_employee_id,
      'accessProfileId', p_access_profile_id,
      'accessProfileLabel', v_profile_label,
      'assignmentType', coalesce(nullif(p_assignment_type, ''), 'profile'),
      'scopeCount', v_scope_count,
      'correlationId', p_correlation_id
    ),
    p_correlation_id || ':access-granted'
  );

  insert into public.hr_audit_log (
    employee_id, submodule_key, record_id, actor_id, action, new_state, metadata
  ) values (
    p_employee_id, 'access_assignments', v_assignment_id::text, p_actor_id,
    'hr.employee.access_assignment.granted',
    jsonb_build_object(
      'accessProfileId', p_access_profile_id,
      'accessProfileLabel', v_profile_label,
      'status', 'active',
      'scopes', p_scopes
    ),
    jsonb_build_object('correlationId', p_correlation_id)
  );

  return jsonb_build_object(
    'assignmentId', v_assignment_id,
    'accessProfileLabel', v_profile_label,
    'scopeCount', v_scope_count,
    'correlationId', p_correlation_id
  );
end;
$$;

-- ── revoke ──────────────────────────────────────────────────────────────────
create or replace function public.hr_access_assignment_revoke_tx(
  p_actor_id       text,
  p_assignment_id  uuid,
  p_reason         text,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id text;
  v_status      text;
  v_profile_id  uuid;
begin
  if p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'actor is required' using errcode = '22023';
  end if;
  if p_correlation_id is null or length(trim(p_correlation_id)) = 0 then
    raise exception 'correlation id is required' using errcode = '22023';
  end if;

  select employee_id, status, access_profile_id
    into v_employee_id, v_status, v_profile_id
    from public.hr_employee_access_assignments
   where id = p_assignment_id
   for update;

  if v_employee_id is null then
    raise exception 'access assignment not found' using errcode = 'P0002';
  end if;
  if v_status = 'revoked' then
    -- State guard: revoking an already-revoked assignment must not emit a second
    -- event and audit row implying a fresh access change.
    raise exception 'access assignment is already revoked' using errcode = '22023';
  end if;

  update public.hr_employee_access_assignments
     set status       = 'revoked',
         revoked_by   = p_actor_id,
         revoked_at   = now(),
         effective_to = current_date
   where id = p_assignment_id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'hr.employee.access_assignment.revoked', 'hr', 'employee_access_assignment',
    p_assignment_id::text, p_actor_id, 'warning',
    jsonb_build_object(
      'employeeId', v_employee_id,
      'accessProfileId', v_profile_id,
      'reason', p_reason,
      'correlationId', p_correlation_id
    ),
    p_correlation_id || ':access-revoked'
  );

  insert into public.hr_audit_log (
    employee_id, submodule_key, record_id, actor_id, action,
    previous_state, new_state, metadata
  ) values (
    v_employee_id, 'access_assignments', p_assignment_id::text, p_actor_id,
    'hr.employee.access_assignment.revoked',
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'revoked', 'reason', p_reason),
    jsonb_build_object('correlationId', p_correlation_id)
  );

  return jsonb_build_object(
    'assignmentId', p_assignment_id,
    'employeeId', v_employee_id,
    'status', 'revoked',
    'correlationId', p_correlation_id
  );
end;
$$;

-- ── Lock the functions down ────────────────────────────────────────────────
-- SECURITY DEFINER functions must never be reachable by anon/authenticated.
-- If these REVOKEs are missing after an apply, the paste was truncated.
revoke all on function public.hr_access_assignment_grant_tx(text, text, uuid, text, date, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.hr_access_assignment_grant_tx(text, text, uuid, text, date, jsonb, text)
  to service_role;

revoke all on function public.hr_access_assignment_revoke_tx(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.hr_access_assignment_revoke_tx(text, uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';
