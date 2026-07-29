-- ============================================================================
-- Employee Profile — atomic employment assignment command
-- ============================================================================
-- Opening a new assignment period is TWO writes: close the outgoing period and
-- insert the incoming one. supabase-js issues a separate PostgREST call per
-- statement, so the existing app-layer sequence can fail between them and leave
-- the employee with NO current assignment at all — an employee who, as far as
-- every downstream reader is concerned, is not assigned to anything. That is
-- strictly worse than the edit simply failing.
--
-- FIRST ASSIGNMENT IS THE NORMAL CASE HERE, NOT AN EDGE CASE.
-- `hr_employee_assignments` is empty for every existing employee in this build,
-- so "Edit Employee" will almost always be CREATING the first effective period
-- rather than superseding one. The command therefore treats "no current period"
-- as a supported starting state, not an error: it simply has nothing to close.
--
-- CARRY-FORWARD: a posting change does not renegotiate employment terms. Any
-- condition the caller does not supply (weekly_hours, fte, notice_period_days)
-- is carried from the outgoing period, so a transfer cannot silently erase
-- contracted working time. Passing an explicit NULL is indistinguishable from
-- omission in jsonb, so conditions arrive as a jsonb object and presence is
-- tested with `?` — allowing a value to be deliberately CLEARED.
--
-- One correlation id threads the assignment, event and both audit trails.
--
-- Operator-applied. The schema reload is executed by the migration itself.
--
-- ⚠ Apply this file WHOLE. The trailing REVOKE is what stops this SECURITY
--   DEFINER function being callable by anon/authenticated, and it is exactly the
--   tail the Supabase SQL editor has silently dropped before. This file also
--   declares a %rowtype variable, which that editor has been seen to mis-parse:
--   apply with psql or the Supabase CLI, not the SQL editor.
--   Verify with scripts/verify-hr-employee-assignment-tx.mjs.
-- ============================================================================

create or replace function public.hr_employee_assignment_apply_tx(
  p_actor_id       text,
  p_employee_id    text,
  p_position_id    uuid,
  p_department_id  text,
  p_site_id        text,
  p_supervisor_id  text,
  p_effective_from date,
  p_conditions     jsonb,
  p_reason         text,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current      public.hr_employee_assignments%rowtype;
  v_new_id       uuid;
  v_effective    date;
  v_weekly       numeric(5,2);
  v_fte          numeric(4,3);
  v_notice       integer;
  v_is_first     boolean;
  v_employee     text;
begin
  if p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'actor is required' using errcode = '22023';
  end if;
  if p_correlation_id is null or length(trim(p_correlation_id)) = 0 then
    raise exception 'correlation id is required' using errcode = '22023';
  end if;

  select coalesce(nullif(trim(coalesce(display_name, '')), ''), nullif(trim(coalesce(full_name, '')), ''), username, id)
    into v_employee from public.app_users where id = p_employee_id;
  if v_employee is null then
    raise exception 'employee % not found', coalesce(p_employee_id, '(null)') using errcode = 'P0002';
  end if;

  v_effective := coalesce(p_effective_from, current_date);
  p_conditions := coalesce(p_conditions, '{}'::jsonb);

  -- Lock the outgoing period so two concurrent edits cannot both open a new one.
  select * into v_current
    from public.hr_employee_assignments
   where employee_id = p_employee_id and is_current
   order by effective_from desc
   limit 1
   for update;

  v_is_first := v_current.id is null;

  if not v_is_first and v_effective < v_current.effective_from then
    -- An effective date before the period being superseded would produce
    -- overlapping history that no reader could order correctly.
    raise exception 'effective date % precedes the current assignment period starting %',
      v_effective, v_current.effective_from using errcode = '22023';
  end if;

  -- Carry forward every condition the caller did not explicitly supply.
  v_weekly := case when p_conditions ? 'weeklyHours'
                   then nullif(p_conditions->>'weeklyHours', '')::numeric(5,2)
                   else v_current.weekly_hours end;
  v_fte    := case when p_conditions ? 'fte'
                   then nullif(p_conditions->>'fte', '')::numeric(4,3)
                   else v_current.fte end;
  v_notice := case when p_conditions ? 'noticePeriodDays'
                   then nullif(p_conditions->>'noticePeriodDays', '')::integer
                   else v_current.notice_period_days end;

  if not v_is_first then
    update public.hr_employee_assignments
       set is_current = false,
           effective_to = greatest(v_effective - 1, effective_from)
     where id = v_current.id;
  end if;

  insert into public.hr_employee_assignments (
    employee_id, position_id, department_id, site_id, supervisor_id,
    assignment_type, effective_from, is_current, created_by,
    weekly_hours, fte, notice_period_days
  ) values (
    p_employee_id,
    coalesce(p_position_id, v_current.position_id),
    coalesce(p_department_id, v_current.department_id),
    coalesce(p_site_id, v_current.site_id),
    coalesce(p_supervisor_id, v_current.supervisor_id),
    'primary', v_effective, true, p_actor_id,
    v_weekly, v_fte, v_notice
  )
  returning id into v_new_id;

  -- Keep the denormalised employee row in step with the new period.
  update public.app_users
     set department_id = coalesce(p_department_id, department_id),
         site_id       = coalesce(p_site_id, site_id),
         supervisor_id = coalesce(p_supervisor_id, supervisor_id),
         updated_at    = now()
   where id = p_employee_id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    case when v_is_first then 'hr.employee.assignment.created' else 'hr.employee.assignment.superseded' end,
    'hr', 'employee_assignment', v_new_id::text, p_actor_id, 'info',
    jsonb_build_object(
      'employeeId', p_employee_id, 'assignmentId', v_new_id,
      'isFirstAssignment', v_is_first,
      'supersededAssignmentId', v_current.id,
      'effectiveFrom', v_effective,
      'weeklyHours', v_weekly, 'fte', v_fte, 'noticePeriodDays', v_notice,
      'correlationId', p_correlation_id
    ),
    p_correlation_id || ':assignment'
  );

  -- A SQL-side app_events insert bypasses emitAppEvent(), which is what normally
  -- writes audit_logs — so this command writes it itself.
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values (
    case when v_is_first then 'hr.employee.assignment.created' else 'hr.employee.assignment.superseded' end,
    'hr_employee_assignments', v_new_id::text, p_actor_id,
    jsonb_build_object(
      'employeeId', p_employee_id, 'isFirstAssignment', v_is_first,
      'previous', case when v_is_first then null else jsonb_build_object(
        'assignmentId', v_current.id, 'effectiveFrom', v_current.effective_from,
        'positionId', v_current.position_id, 'departmentId', v_current.department_id,
        'siteId', v_current.site_id, 'supervisorId', v_current.supervisor_id,
        'weeklyHours', v_current.weekly_hours, 'fte', v_current.fte,
        'noticePeriodDays', v_current.notice_period_days) end,
      'next', jsonb_build_object(
        'assignmentId', v_new_id, 'effectiveFrom', v_effective,
        'positionId', coalesce(p_position_id, v_current.position_id),
        'departmentId', coalesce(p_department_id, v_current.department_id),
        'siteId', coalesce(p_site_id, v_current.site_id),
        'supervisorId', coalesce(p_supervisor_id, v_current.supervisor_id),
        'weeklyHours', v_weekly, 'fte', v_fte, 'noticePeriodDays', v_notice),
      'reason', nullif(p_reason, ''),
      'correlationId', p_correlation_id
    )
  );

  insert into public.hr_audit_log (
    employee_id, submodule_key, record_id, actor_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    p_employee_id, 'assignments', v_new_id::text, p_actor_id,
    case when v_is_first then 'hr.employee.assignment.created' else 'hr.employee.assignment.superseded' end,
    case when v_is_first then null else jsonb_build_object(
      'effectiveFrom', v_current.effective_from, 'weeklyHours', v_current.weekly_hours,
      'fte', v_current.fte, 'noticePeriodDays', v_current.notice_period_days) end,
    jsonb_build_object('effectiveFrom', v_effective, 'weeklyHours', v_weekly,
                       'fte', v_fte, 'noticePeriodDays', v_notice),
    nullif(p_reason, ''),
    jsonb_build_object('correlationId', p_correlation_id, 'isFirstAssignment', v_is_first)
  );

  return jsonb_build_object(
    'assignmentId', v_new_id,
    'employeeId', p_employee_id,
    'isFirstAssignment', v_is_first,
    'supersededAssignmentId', v_current.id,
    'effectiveFrom', v_effective,
    'weeklyHours', v_weekly,
    'fte', v_fte,
    'noticePeriodDays', v_notice,
    'correlationId', p_correlation_id
  );
end;
$$;

revoke all on function public.hr_employee_assignment_apply_tx(
  text, text, uuid, text, text, text, date, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.hr_employee_assignment_apply_tx(
  text, text, uuid, text, text, text, date, jsonb, text, text
) to service_role;

notify pgrst, 'reload schema';
