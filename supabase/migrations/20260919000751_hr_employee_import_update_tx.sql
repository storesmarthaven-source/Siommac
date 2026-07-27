-- ============================================================================
-- 20260919000751_hr_employee_import_update_tx.sql
--
-- Employee Import — transactional bulk-update command (audit 2026-07-26, P0-5).
--
-- The import UPDATE path corrupted canonical employee history:
--   • it patched app_users.position / department_id / supervisor_id DIRECTLY, so an
--     assignment change left no effective-dated hr_employee_assignments row;
--   • it wrote statutory data to the LEGACY hr_employee_statutory table while the
--     create path writes the canonical hr_employee_statutory_profiles, so create and
--     update produced different records for the same domain;
--   • it wrote no status history and no previous-state audit;
--   • each write was a separate PostgREST call, so a mid-row failure left the employee
--     partly updated while the row was reported failed.
--
-- This is the update sibling of hr_employee_create_tx: ONE transaction covering the
-- employee patch, the effective-dated assignment change, the canonical statutory
-- profile, the status history and the HR audit row. Either all of it commits or none
-- of it does — no compensation, no partial row.
--
-- The patch is ALLOWLISTED inside the function: only the columns named here can be
-- written, so a future mapping change cannot reach app_users.role (privilege
-- escalation, P0-1) or any other sensitive column.
-- ============================================================================

create or replace function public.hr_employee_import_update_tx(
  p_actor_id    text,
  p_employee_id text,
  p_patch       jsonb,      -- allowlisted employee columns (camelCase keys)
  p_assignment  jsonb,      -- departmentId / siteId / supervisorId (nullable members)
  p_statutory   jsonb,      -- canonical statutory profile patch (snake_case columns)
  p_readiness   jsonb,      -- { status, blockers[], financeEligible } computed by the caller
  p_row_no      integer,
  p_batch_no    text,
  p_request_id  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev            record;
  v_new_dept        text;
  v_new_site        text;
  v_new_supervisor  text;
  v_assignment_changed boolean := false;
  v_prev_state      jsonb;
  v_new_state       jsonb;
  v_today           date := current_date;
begin
  if p_employee_id is null or length(trim(p_employee_id)) = 0 then
    raise exception 'employee id is required' using errcode = '22023';
  end if;

  -- Lock the target row for the duration of the transaction so two concurrent
  -- commits cannot interleave assignment history for the same employee.
  select id, position, department_id, site_id, supervisor_id, email, phone,
         employment_type, employment_status
    into v_prev
    from public.app_users
   where id = p_employee_id
     for update;

  if not found then
    raise exception 'employee % not found', p_employee_id using errcode = 'P0002';
  end if;

  v_prev_state := to_jsonb(v_prev);

  -- ── 1. Employee patch — ALLOWLISTED columns only ──────────────────────────
  update public.app_users set
    position        = coalesce(nullif(p_patch->>'position', ''),       position),
    email           = coalesce(nullif(p_patch->>'email', ''),          email),
    phone           = coalesce(nullif(p_patch->>'phone', ''),          phone),
    employment_type = coalesce(nullif(p_patch->>'employmentType', ''), employment_type),
    department_id   = coalesce(nullif(p_assignment->>'departmentId', ''), department_id),
    site_id         = coalesce(nullif(p_assignment->>'siteId', ''),       site_id),
    supervisor_id   = coalesce(nullif(p_assignment->>'supervisorId', ''), supervisor_id),
    updated_at      = now()
  where id = p_employee_id;

  select department_id, site_id, supervisor_id
    into v_new_dept, v_new_site, v_new_supervisor
    from public.app_users where id = p_employee_id;

  v_assignment_changed :=
       v_new_dept       is distinct from v_prev.department_id
    or v_new_site       is distinct from v_prev.site_id
    or v_new_supervisor is distinct from v_prev.supervisor_id;

  -- ── 2. Effective-dated assignment ─────────────────────────────────────────
  -- An assignment change closes the current row and opens a new one, exactly as the
  -- interactive transfer path does. Without this, import silently rewrote history.
  if v_assignment_changed then
    update public.hr_employee_assignments
       set is_current = false, effective_to = v_today
     where employee_id = p_employee_id and is_current;

    insert into public.hr_employee_assignments (
      employee_id, department_id, site_id, supervisor_id,
      assignment_type, effective_from, is_current, created_by
    ) values (
      p_employee_id, v_new_dept, v_new_site, v_new_supervisor,
      'primary', v_today, true, p_actor_id
    );
  end if;

  -- ── 3. Canonical statutory profile (never the legacy table) ───────────────
  if p_statutory is not null and p_statutory <> '{}'::jsonb then
    insert into public.hr_employee_statutory_profiles as t (
      employee_id, nis_number, nis_reg_status, nis_effective_date,
      bir_file_number, paye_applicable, td1_received, td1_effective_year,
      hs_applicable, hs_exemption_reason, hs_effective_date, hs_verification_required,
      payroll_ready_status, missing_blockers, finance_handoff_eligible,
      created_by, updated_by
    ) values (
      p_employee_id,
      nullif(p_statutory->>'nis_number', ''),
      coalesce(nullif(p_statutory->>'nis_reg_status', ''), 'pending'),
      nullif(p_statutory->>'nis_effective_date', '')::date,
      nullif(p_statutory->>'bir_file_number', ''),
      coalesce((p_statutory->>'paye_applicable')::boolean, true),
      coalesce((p_statutory->>'td1_received')::boolean, false),
      nullif(p_statutory->>'td1_effective_year', '')::integer,
      coalesce((p_statutory->>'hs_applicable')::boolean, true),
      nullif(p_statutory->>'hs_exemption_reason', ''),
      nullif(p_statutory->>'hs_effective_date', '')::date,
      coalesce((p_statutory->>'hs_verification_required')::boolean, false),
      coalesce(nullif(p_readiness->>'status', ''), 'pending'),
      coalesce(p_readiness->'blockers', '[]'::jsonb),
      coalesce((p_readiness->>'financeEligible')::boolean, false),
      p_actor_id, p_actor_id
    )
    on conflict (employee_id) do update set
      nis_number               = coalesce(nullif(p_statutory->>'nis_number', ''),        t.nis_number),
      nis_reg_status           = coalesce(nullif(p_statutory->>'nis_reg_status', ''),    t.nis_reg_status),
      nis_effective_date       = coalesce(nullif(p_statutory->>'nis_effective_date','')::date, t.nis_effective_date),
      bir_file_number          = coalesce(nullif(p_statutory->>'bir_file_number', ''),   t.bir_file_number),
      paye_applicable          = coalesce((p_statutory->>'paye_applicable')::boolean,    t.paye_applicable),
      td1_received             = coalesce((p_statutory->>'td1_received')::boolean,       t.td1_received),
      td1_effective_year       = coalesce(nullif(p_statutory->>'td1_effective_year','')::integer, t.td1_effective_year),
      hs_applicable            = coalesce((p_statutory->>'hs_applicable')::boolean,      t.hs_applicable),
      hs_exemption_reason      = coalesce(nullif(p_statutory->>'hs_exemption_reason',''),t.hs_exemption_reason),
      hs_effective_date        = coalesce(nullif(p_statutory->>'hs_effective_date','')::date, t.hs_effective_date),
      hs_verification_required = coalesce((p_statutory->>'hs_verification_required')::boolean, t.hs_verification_required),
      payroll_ready_status     = coalesce(nullif(p_readiness->>'status', ''),            t.payroll_ready_status),
      missing_blockers         = coalesce(p_readiness->'blockers',                       t.missing_blockers),
      finance_handoff_eligible = coalesce((p_readiness->>'financeEligible')::boolean,    t.finance_handoff_eligible),
      updated_by               = p_actor_id,
      updated_at               = now();
  end if;

  select to_jsonb(a) into v_new_state
    from (select id, position, department_id, site_id, supervisor_id, email, phone,
                 employment_type, employment_status
            from public.app_users where id = p_employee_id) a;

  -- ── 4. HR audit — inside the same transaction, with previous AND new state ─
  insert into public.hr_audit_log (
    employee_id, submodule_key, record_id, actor_id, action,
    previous_state, new_state, reason
  ) values (
    p_employee_id, 'import', p_employee_id, p_actor_id, 'hr.import.row_updated',
    v_prev_state,
    v_new_state || jsonb_build_object(
      'assignmentChanged', v_assignment_changed,
      'batchNo', p_batch_no, 'rowNo', p_row_no, 'requestId', p_request_id
    ),
    format('Bulk import %s row %s', coalesce(p_batch_no, '?'), p_row_no)
  );

  return jsonb_build_object(
    'employeeId',        p_employee_id,
    'assignmentChanged', v_assignment_changed
  );
end;
$$;

revoke all on function public.hr_employee_import_update_tx(
  text, text, jsonb, jsonb, jsonb, jsonb, integer, text, text
) from public, anon, authenticated;
