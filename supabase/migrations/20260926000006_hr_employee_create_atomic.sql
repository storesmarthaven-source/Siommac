-- ============================================================================
-- Employee creation: authoritative employment status + atomic create command
-- ============================================================================
-- The authentication status on app_users must remain independent from the HR
-- lifecycle status.  A probationary or pending-start employee may still have a
-- valid account; conversely, an active employee record may intentionally have no
-- login.  The previous wizard wrote HR states into app_users.status, which is an
-- authentication gate.

alter table public.app_users
  add column if not exists employment_status text not null default 'active'
    check (employment_status in (
      'draft','pending_onboarding','active','probation',
      'on_leave','suspended','inactive','terminated','archived'
    ));

update public.app_users
set employment_status = status
where status in (
  'draft','pending_onboarding','active','probation',
  'on_leave','suspended','inactive','terminated','archived'
);

create index if not exists app_users_employment_status_idx
  on public.app_users (employment_status);

create or replace function public.hr_employee_create_tx(
  p_actor_id       text,
  p_identity       jsonb,
  p_employment     jsonb,
  p_assignment     jsonb,
  p_access         jsonb,
  p_statutory      jsonb,
  p_record_status  text,
  p_onboarding     jsonb,
  p_idempotency_key text,
  p_payload_hash   text,
  p_request_id     text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing        jsonb;
  v_existing_hash   text;
  v_employee_id     text;
  v_employee_no     text;
  v_start_date      date;
  v_nis_reg_status  text;
  v_readiness       text := 'ready';
  v_blockers        jsonb := '[]'::jsonb;
  v_event_id        uuid;
  v_case_id         uuid;
  v_case_no         text;
  v_package_key     text;
  v_result          jsonb;
begin
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'An idempotency key is required.';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'A valid request payload hash is required.';
  end if;

  -- Serialize retries for the same request. A failed transaction leaves no
  -- mutation-run row; a completed retry returns the original receipt.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  select result_payload, request_payload->>'payloadHash'
  into v_existing, v_existing_hash
  from public.module_mutation_runs
  where idempotency_key = p_idempotency_key
    and status = 'completed';

  if v_existing is not null then
    if v_existing_hash is distinct from p_payload_hash then
      raise exception using
        errcode = '22023',
        message = 'This request key was already used with different employee data.';
    end if;
    return v_existing;
  end if;

  insert into public.module_mutation_runs (
    idempotency_key, module, operation, entity_type, actor_user_id,
    status, stage, request_payload
  ) values (
    p_idempotency_key, 'hr', 'create', 'employee', p_actor_id,
    'started', 'started',
    jsonb_build_object(
      'requestId', p_request_id,
      'payloadHash', p_payload_hash,
      'username', p_identity->>'username',
      'prepareOnboarding', coalesce((p_onboarding->>'prepareOnboarding')::boolean, false)
    )
  );

  if coalesce(p_record_status, '') not in ('draft','pending_onboarding','active','probation') then
    raise exception using errcode = '22023', message = 'Invalid initial employment status.';
  end if;

  if nullif(trim(p_identity->>'employeeNumber'), '') is not null then
    v_employee_no := upper(trim(p_identity->>'employeeNumber'));
  else
    v_employee_no := 'EMP-' || lpad(public.increment_ref_counter('EMP', 0)::text, 4, '0');
  end if;

  v_start_date := coalesce(nullif(p_employment->>'startDate', '')::date, current_date);
  v_nis_reg_status := coalesce(nullif(p_statutory->>'nisStatus', ''), 'pending');

  if v_nis_reg_status = 'pending' then
    v_blockers := v_blockers || jsonb_build_array('NIS registration pending');
  elsif v_nis_reg_status = 'registered'
        and nullif(trim(p_statutory->>'nisNumber'), '') is null then
    v_blockers := v_blockers || jsonb_build_array('NIS number missing');
  end if;

  if coalesce((p_statutory->>'payeApplicable')::boolean, true) then
    if nullif(trim(p_statutory->>'birFileNumber'), '') is null then
      v_blockers := v_blockers || jsonb_build_array('BIR file number missing');
    end if;
    if not coalesce((p_statutory->>'td1Received')::boolean, false) then
      v_blockers := v_blockers || jsonb_build_array('TD1 not received');
    end if;
  end if;

  if coalesce((p_statutory->>'hsApplicable')::boolean, true)
     and coalesce((p_statutory->>'hsVerificationRequired')::boolean, false) then
    v_blockers := v_blockers || jsonb_build_array('Health surcharge verification pending');
  end if;

  if jsonb_array_length(v_blockers) > 0 then
    v_readiness := 'blocked';
  end if;

  insert into public.app_users (
    username, full_name, first_name, last_name, display_name,
    role, status, employment_status, auth_email,
    email, personal_email, phone, employee_number,
    date_of_birth, nationality, government_id,
    employment_type, contractor_flag, start_date, position,
    department_id, site_id, supervisor_id,
    probation_end_date, employee_grade, work_schedule
  ) values (
    trim(p_identity->>'username'),
    trim(p_identity->>'fullName'),
    nullif(trim(p_identity->>'firstName'), ''),
    nullif(trim(p_identity->>'lastName'), ''),
    nullif(trim(p_identity->>'preferredName'), ''),
    coalesce(nullif(trim(p_access->>'resolvedRole'), ''), 'employee'),
    'active',
    p_record_status,
    nullif(lower(trim(p_identity->>'email')), ''),
    nullif(lower(trim(p_identity->>'email')), ''),
    nullif(lower(trim(p_identity->>'personalEmail')), ''),
    nullif(trim(p_identity->>'phone'), ''),
    v_employee_no,
    nullif(p_identity->>'dateOfBirth', '')::date,
    nullif(trim(p_identity->>'nationality'), ''),
    nullif(trim(p_identity->>'governmentId'), ''),
    coalesce(nullif(p_employment->>'employmentType', ''), 'employee'),
    coalesce((p_employment->>'contractorFlag')::boolean, false),
    v_start_date,
    nullif(trim(p_employment->>'position'), ''),
    nullif(p_assignment->>'departmentId', ''),
    nullif(p_assignment->>'siteId', ''),
    nullif(p_assignment->>'supervisorId', ''),
    nullif(p_employment->>'probationEndDate', '')::date,
    nullif(trim(p_employment->>'employeeGrade'), ''),
    nullif(trim(p_employment->>'workSchedule'), '')
  )
  returning id into v_employee_id;

  if nullif(p_assignment->>'departmentId', '') is not null
     or nullif(p_assignment->>'siteId', '') is not null
     or nullif(p_assignment->>'supervisorId', '') is not null then
    insert into public.hr_employee_assignments (
      employee_id, department_id, site_id, supervisor_id,
      assignment_type, effective_from, is_current, created_by
    ) values (
      v_employee_id,
      nullif(p_assignment->>'departmentId', ''),
      nullif(p_assignment->>'siteId', ''),
      nullif(p_assignment->>'supervisorId', ''),
      'primary',
      coalesce(nullif(p_assignment->>'effectiveDate', '')::date, v_start_date),
      true,
      p_actor_id
    );
  end if;

  insert into public.hr_employee_statutory_profiles (
    employee_id, jurisdiction, currency,
    nis_status, nis_reg_status, nis_number, nis_applicable, nis_effective_date,
    bir_file_number, paye_applicable, td1_received, td1_effective_year,
    hs_applicable, hs_exemption_reason, hs_effective_date, hs_verification_required,
    payroll_ready_status, missing_blockers, finance_handoff_eligible,
    created_by, updated_by
  ) values (
    v_employee_id, 'TT', 'TTD',
    'pending_verification', v_nis_reg_status,
    nullif(trim(p_statutory->>'nisNumber'), ''),
    coalesce((p_statutory->>'nisApplicable')::boolean, true),
    nullif(p_statutory->>'nisEffectiveDate', '')::date,
    nullif(trim(p_statutory->>'birFileNumber'), ''),
    coalesce((p_statutory->>'payeApplicable')::boolean, true),
    coalesce((p_statutory->>'td1Received')::boolean, false),
    nullif(p_statutory->>'td1EffectiveYear', '')::integer,
    coalesce((p_statutory->>'hsApplicable')::boolean, true),
    nullif(trim(p_statutory->>'hsExemptionReason'), ''),
    nullif(p_statutory->>'hsEffectiveDate', '')::date,
    coalesce((p_statutory->>'hsVerificationRequired')::boolean, false),
    v_readiness, v_blockers, v_readiness = 'ready',
    p_actor_id, p_actor_id
  );

  insert into public.hr_employee_status_history (
    employee_id, previous_status, new_status, reason, effective_date, changed_by
  ) values (
    v_employee_id, null, p_record_status, 'Employee created', v_start_date, p_actor_id
  );

  insert into public.hr_audit_log (
    employee_id, submodule_key, record_id, actor_id, action, new_state, metadata
  ) values (
    v_employee_id, 'employees', v_employee_id, p_actor_id, 'hr.employee.created',
    jsonb_build_object(
      'employee_number', v_employee_no,
      'role', coalesce(nullif(trim(p_access->>'resolvedRole'), ''), 'employee'),
      'employmentStatus', p_record_status,
      'payrollReadiness', v_readiness
    ),
    jsonb_build_object('requestId', p_request_id)
  );

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, site_id, department_id, severity, payload, dedupe_key
  ) values (
    'hr.employee.created', 'hr', 'employee', v_employee_id,
    p_actor_id, nullif(p_assignment->>'siteId', ''), nullif(p_assignment->>'departmentId', ''),
    'info',
    jsonb_build_object(
      'employeeNumber', v_employee_no,
      'employmentStatus', p_record_status,
      'payrollReadiness', v_readiness,
      'requestId', p_request_id
    ),
    p_idempotency_key || ':employee-created'
  )
  returning id into v_event_id;

  insert into public.audit_logs (
    action, table_name, record_id, user_id, changes
  ) values (
    'hr.employee.created', 'app_users', v_employee_id, p_actor_id,
    jsonb_build_object(
      'employeeNumber', v_employee_no,
      'employmentStatus', p_record_status,
      'payrollReadiness', v_readiness,
      'requestId', p_request_id,
      'outcome', 'success'
    )
  );

  if coalesce((p_onboarding->>'prepareOnboarding')::boolean, false) then
    v_package_key := nullif(trim(p_onboarding->>'packageKey'), '');
    if v_package_key is null then
      raise exception using errcode = '22023', message = 'An onboarding package is required.';
    end if;

    v_case_no := 'ONB-' || extract(year from current_date)::int::text || '-' ||
      lpad(public.increment_ref_counter('ONB', extract(year from current_date)::int)::text, 4, '0');

    insert into public.hr_onboarding_cases (
      case_no, employee_id, worker_type, package_key, status,
      owner_id, started_by, target_start_date, launch_mode, metadata
    ) values (
      v_case_no, v_employee_id,
      coalesce(nullif(p_employment->>'employmentType', ''), 'employee'),
      v_package_key, 'draft',
      p_actor_id, p_actor_id, v_start_date, 'Scheduled',
      jsonb_build_object('preparedByEmployeeWizard', true, 'requestId', p_request_id)
    )
    returning id into v_case_id;

    insert into public.hr_audit_log (
      employee_id, submodule_key, record_id, actor_id, action, new_state, metadata
    ) values (
      v_employee_id, 'onboarding', v_case_id::text, p_actor_id,
      'hr.onboarding.draft_prepared',
      jsonb_build_object('caseNo', v_case_no, 'packageKey', v_package_key),
      jsonb_build_object('requestId', p_request_id)
    );

    insert into public.app_events (
      event_type, source_module, source_entity_type, source_entity_id,
      actor_user_id, severity, payload, dedupe_key
    ) values (
      'hr.onboarding.draft_prepared', 'hr', 'onboarding_case', v_case_id::text,
      p_actor_id, 'info',
      jsonb_build_object(
        'employeeId', v_employee_id, 'caseNo', v_case_no,
        'packageKey', v_package_key, 'requestId', p_request_id
      ),
      p_idempotency_key || ':onboarding-draft'
    );

    insert into public.audit_logs (
      action, table_name, record_id, user_id, changes
    ) values (
      'hr.onboarding.draft_prepared', 'hr_onboarding_cases', v_case_id::text,
      p_actor_id,
      jsonb_build_object(
        'employeeId', v_employee_id, 'caseNo', v_case_no,
        'packageKey', v_package_key, 'requestId', p_request_id,
        'outcome', 'success'
      )
    );
  end if;

  v_result := jsonb_build_object(
    'employee_id', v_employee_id,
    'employee_no', v_employee_no,
    'status', p_record_status,
    'payroll_readiness', v_readiness,
    'onboarding_case_id', v_case_id,
    'onboarding_case_no', v_case_no,
    'event_id', v_event_id
  );

  update public.module_mutation_runs
  set entity_id = v_employee_id,
      entity_ref = v_employee_no,
      status = 'completed',
      stage = 'completed',
      result_payload = v_result,
      updated_at = now()
  where idempotency_key = p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.hr_employee_create_tx(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.hr_employee_create_tx(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb, text, text, text
) to service_role;

notify pgrst, 'reload schema';
