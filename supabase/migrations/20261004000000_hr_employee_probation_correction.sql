-- HR Employee Probation Correction — the ONE sanctioned way to change
-- app_users.probation_end_date after an onboarding launch has set it.
--
-- Why this exists: the launch (20260804024501) writes probation_end_date as a side effect of
-- creating a case. Before that migration recorded a pre-image, a case could not be reversed —
-- an operator cleaning up had no authoritative prior value and would have to GUESS. Guessing at
-- a real employee's employment terms is not acceptable, and neither is a cleanup script writing
-- the field directly with no actor, no reason and no audit row.
--
-- So corrections get their own governed, transactional, fully-audited command. It is
-- deliberately NOT part of the generic employee-update path: this field carries employment
-- consequences (confirmation date, notice terms), so it takes its own high-risk permission and
-- a mandatory reason rather than riding along with a routine profile edit.

create or replace function public.hr_employee_probation_correct_tx(
  p_actor_id text,
  p_employee_id text,
  p_probation_end_date date,   -- null CLEARS the date; the caller states this explicitly
  p_reason text,
  p_correlation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev date;
  v_found boolean := false;
  v_event_id uuid;
  v_changed boolean := false;
begin
  if p_actor_id is null or p_actor_id = '' then
    raise exception 'actor is required' using errcode = '22023';
  end if;
  if p_employee_id is null or p_employee_id = '' then
    raise exception 'employee id is required' using errcode = '22023';
  end if;
  -- A correction without a stated reason is exactly the untraceable edit this command exists
  -- to replace, so the reason is enforced HERE and not only in the API layer.
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;

  -- Lock and read the pre-image in the same transaction as the write, so the recorded
  -- `previous` cannot drift and two concurrent corrections cannot interleave.
  select u.probation_end_date into v_prev
  from public.app_users u where u.id = p_employee_id for update;
  v_found := found;
  if not v_found then
    raise exception 'employee % does not exist', p_employee_id using errcode = '23503';
  end if;

  v_changed := p_probation_end_date is distinct from v_prev;

  -- A no-op correction still writes its audit trail: "HR reviewed this and confirmed the
  -- current value" is an auditable decision, and silently dropping it would make the trail
  -- look like the review never happened.
  if v_changed then
    update public.app_users set probation_end_date = p_probation_end_date where id = p_employee_id;
  end if;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
    severity, payload, dedupe_key
  ) values (
    'hr.employee.probation_corrected', 'hr', 'employee', p_employee_id, p_actor_id,
    case when v_changed then 'warning' else 'info' end,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'previousProbationEndDate', v_prev,
      'newProbationEndDate', p_probation_end_date,
      'changed', v_changed,
      'reason', p_reason,
      'correlationId', p_correlation_id),
    case when p_correlation_id is null then null
         else 'hr.employee.probation_correct:' || p_correlation_id::text end
  ) returning id into v_event_id;

  insert into public.audit_logs(action, table_name, record_id, user_id, changes)
  values ('hr.employee.probation_corrected', 'app_users', p_employee_id, p_actor_id,
    jsonb_build_object(
      'probationEndDate', jsonb_build_object(
        'previous', v_prev, 'new', p_probation_end_date, 'changed', v_changed),
      'reason', p_reason, 'correlationId', p_correlation_id));

  insert into public.hr_audit_log (
    employee_id, submodule_key, record_id, actor_id, action, previous_state, new_state, reason
  ) values (
    p_employee_id, 'employees', p_employee_id, p_actor_id,
    'hr.employee.probation_corrected',
    jsonb_build_object('probationEndDate', v_prev),
    jsonb_build_object('probationEndDate', p_probation_end_date, 'changed', v_changed),
    p_reason
  );

  return jsonb_build_object(
    'employeeId', p_employee_id,
    'previousProbationEndDate', v_prev,
    'probationEndDate', p_probation_end_date,
    'changed', v_changed,
    'eventId', v_event_id
  );
end;
$$;

revoke all on function public.hr_employee_probation_correct_tx(text, text, date, text, uuid)
  from public, anon, authenticated;
grant execute on function public.hr_employee_probation_correct_tx(text, text, date, text, uuid)
  to service_role;

-- The key is DEAD until it is granted in role_permissions — requirePermission resolves a role's
-- capabilities from this TABLE, not from the static catalogues. Shipped in the same migration.
insert into public.role_permissions (role_name, permission) values
  ('admin', 'hr.employee.probation.correct'),
  ('hr_manager', 'hr.employee.probation.correct')
on conflict do nothing;

-- Verification (operator):
-- 1. select has_function_privilege('anon',
--      'public.hr_employee_probation_correct_tx(text,text,date,text,uuid)', 'execute');  -- false
-- 2. select role_name from public.role_permissions
--    where permission = 'hr.employee.probation.correct' order by role_name;  -- admin, hr_manager
-- 3. A correction writes exactly one app_events + one audit_logs + one hr_audit_log row, and
--    hr_audit_log.previous_state carries the pre-image.
-- Apply with psql or the Supabase CLI — NOT the dashboard SQL editor (it has been observed to
-- truncate function bodies and silently drop the trailing REVOKE).
