-- ============================================================================
-- Finding #3 Shape B (create-and-start) — shared RPC: hr_overtime_entries + hr_requests + hr_leave_requests
-- Depends on: 20260919000211 (_create_instance), 212+ (_resolve_and_validate_assignee),
--             210 (receipt ledger + _claim_request/_record_request).
-- Operator-applied; idempotent (create or replace). After applying:
--   NOTIFY pgrst, 'reload schema';
--   verify: select position('hr_leave_requests' in prosrc)>0
--             from pg_proc where proname='workflow_create_and_start_tx';  -- expect t
-- ============================================================================
-- Shape B = INSERT the business row AND start its workflow in ONE transaction
-- (the Shape-A submit RPC's analogue for create-and-start callers). Fixes the
-- insert -> startWorkflowForRecord -> compensating-delete strand band-aid.
-- One shared fn, per-table branch; one migration per added branch.
-- ============================================================================

create or replace function public.workflow_create_and_start_tx(
  p_source_table text,
  p_actor_id     text,
  p_binding_id   uuid,
  p_request_key  text,
  p_business     jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_hash          text;
  v_receipt_key   text;
  v_claim         jsonb;
  v_new_id        uuid;
  v_module_key    text;
  v_workflow_type text;
  v_trigger       text;
  v_ref           text;
  v_owner         text;
  v_event_type    text;
  v_entity_type   text;
  v_biz_module    text;
  v_audit_action  text;
  v_priority      text;
  v_source_ctx    jsonb;
  v_binding       public.module_workflow_bindings%rowtype;
  v_ver           public.workflow_template_versions%rowtype;
  v_min_seq       numeric;
  v_step          jsonb;
  v_assignees     jsonb := '{}'::jsonb;
  v_res           jsonb;
  v_wf_id         uuid;
  v_event_id      uuid;
  v_result        jsonb;
  v_leave_days    numeric;
  v_leave_year    int;
begin
  p_business := coalesce(p_business, '{}'::jsonb);
  if jsonb_typeof(p_business) <> 'object' then
    raise exception 'workflow_create_and_start: business payload must be a JSON object' using errcode = 'WF400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'workflow_create_and_start: actor_id is required' using errcode = 'WF400';
  end if;
  if p_request_key is null or btrim(p_request_key) = '' then
    raise exception 'workflow_create_and_start: request_key is required' using errcode = 'WF400';
  end if;
  if p_binding_id is null then
    raise exception 'workflow_create_and_start: binding_id is required' using errcode = 'WF422';
  end if;

  v_receipt_key := coalesce(p_actor_id, '') || '|create_and_start|' || coalesce(p_source_table, '') || '|' || p_request_key;
  v_priority    := coalesce(nullif(p_business->>'priority', ''), 'medium');
  v_hash := md5((jsonb_build_object(
              'table', p_source_table, 'actor', p_actor_id,
              'binding', p_binding_id, 'business', p_business))::text);

  v_claim := wf_internal._claim_request(v_receipt_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return coalesce(nullif(v_claim->'result', 'null'::jsonb),
                    jsonb_build_object('workflowId', v_claim->>'workflowId', 'duplicate', true));
  end if;

  -- ── Per-table INSERT branch ──
  if p_source_table = 'hr_overtime_entries' then
    if coalesce((p_business->>'hours')::numeric, 0) <= 0 then
      raise exception 'workflow_create_and_start: overtime hours must be positive' using errcode = 'WF422';
    end if;
    if (p_business->>'employeeId') is null or btrim(p_business->>'employeeId') = '' then
      raise exception 'workflow_create_and_start: employeeId is required' using errcode = 'WF400';
    end if;
    insert into public.hr_overtime_entries
      (employee_id, work_date, hours, multiplier, ot_type, reason, status, created_by)
    values
      (p_business->>'employeeId', (p_business->>'workDate')::date,
       (p_business->>'hours')::numeric, coalesce((p_business->>'multiplier')::numeric, 1.5),
       nullif(p_business->>'otType', ''), nullif(p_business->>'reason', ''),
       'submitted', p_actor_id)
    returning id, coalesce(overtime_no, 'OVT-' || upper(left(id::text, 8)))
      into v_new_id, v_ref;
    v_module_key    := 'hr_overtime';
    v_workflow_type := 'hr_overtime_approval';
    v_trigger       := 'hr.overtime.submitted';
    v_owner         := coalesce(nullif(p_business->>'employeeId', ''), p_actor_id);
    v_event_type    := 'hr.overtime.submitted';
    v_entity_type   := 'overtime_entry';
    v_biz_module    := 'hr_overtime';
    v_audit_action  := 'overtime.submitted';
    v_source_ctx    := jsonb_build_object(
                         'employeeId', p_business->>'employeeId',
                         'workDate',   p_business->>'workDate',
                         'hours',      p_business->>'hours',
                         'multiplier', coalesce(p_business->>'multiplier', '1.5'),
                         'otType',     p_business->>'otType');
  elsif p_source_table = 'hr_requests' then
    if (p_business->>'employeeId') is null or btrim(p_business->>'employeeId') = '' then
      raise exception 'workflow_create_and_start: employeeId is required' using errcode = 'WF400';
    end if;
    if (p_business->>'title') is null or btrim(p_business->>'title') = '' then
      raise exception 'workflow_create_and_start: title is required' using errcode = 'WF400';
    end if;
    v_ref := 'REQ-' || extract(year from now())::int::text || '-' ||
             lpad(public.increment_ref_counter('REQ', extract(year from now())::int)::text, 4, '0');
    insert into public.hr_requests
      (request_no, employee_id, request_type, title, details, status, priority, requested_by)
    values
      (v_ref, p_business->>'employeeId', p_business->>'requestType', p_business->>'title',
       coalesce(p_business->'details', '{}'::jsonb), 'in_review',
       coalesce(nullif(p_business->>'priority', ''), 'normal'), p_actor_id)
    returning id into v_new_id;
    v_module_key    := 'hr_requests';
    v_workflow_type := 'hr_request_approval';
    v_trigger       := 'hr.request.submitted';
    v_owner         := coalesce(nullif(p_business->>'employeeId', ''), p_actor_id);
    v_event_type    := 'hr.request.submitted';
    v_entity_type   := 'hr_request';
    v_biz_module    := 'hr';
    v_audit_action  := 'hr.request.submitted';
    v_source_ctx    := jsonb_build_object(
                         'employeeId', p_business->>'employeeId', 'requestType', p_business->>'requestType',
                         'title', p_business->>'title');
  elsif p_source_table = 'hr_leave_requests' then
    if (p_business->>'employeeId') is null or btrim(p_business->>'employeeId') = '' then
      raise exception 'workflow_create_and_start: employeeId is required' using errcode = 'WF400';
    end if;
    if (p_business->>'leaveTypeId') is null or btrim(p_business->>'leaveTypeId') = '' then
      raise exception 'workflow_create_and_start: leaveTypeId is required' using errcode = 'WF400';
    end if;
    if (p_business->>'fromDate') is null or (p_business->>'toDate') is null then
      raise exception 'workflow_create_and_start: fromDate and toDate are required' using errcode = 'WF400';
    end if;
    v_leave_days := nullif(p_business->>'days', '')::numeric;
    v_leave_year := extract(year from (p_business->>'fromDate')::date)::int;
    v_ref := 'LVR-' || extract(year from now())::int::text || '-' ||
             lpad(public.increment_ref_counter('LVR', extract(year from now())::int)::text, 4, '0');
    insert into public.hr_leave_requests
      (case_no, employee_id, leave_type_id, from_date, to_date, unit, days, hours, half_day,
       reason, status, department_id, applied_at)
    values
      (v_ref, p_business->>'employeeId', (p_business->>'leaveTypeId')::uuid,
       (p_business->>'fromDate')::date, (p_business->>'toDate')::date,
       coalesce(nullif(p_business->>'unit', ''), 'days'),
       v_leave_days, nullif(p_business->>'hours', '')::numeric,
       coalesce((p_business->>'halfDay')::boolean, false),
       nullif(p_business->>'reason', ''), 'pending_approval',
       nullif(p_business->>'departmentId', ''), now())
    returning id into v_new_id;

    -- Satellite: pending_reserve ledger row + materialized balance recompute, atomic
    -- with the request insert (idempotency_key unique keeps a retry from doubling it).
    if v_leave_days is not null then
      insert into public.hr_leave_accruals
        (employee_id, leave_type_id, year, delta, kind, idempotency_key, source_request_id, created_by)
      values
        (p_business->>'employeeId', (p_business->>'leaveTypeId')::uuid, v_leave_year,
         - v_leave_days, 'pending_reserve', 'hr.leave.pending:' || v_new_id::text, v_new_id, p_actor_id);

      insert into public.hr_leave_balances
        (employee_id, leave_type_id, year, entitled, accrued, taken, pending, adjustment)
      select p_business->>'employeeId', (p_business->>'leaveTypeId')::uuid, v_leave_year, 0,
             coalesce(sum(delta) filter (where kind = 'accrual'), 0),
             greatest(0, coalesce(sum(abs(delta)) filter (where kind = 'deduction'), 0)
                         - coalesce(sum(delta) filter (where kind = 'release'), 0)),
             coalesce(sum(abs(delta)) filter (where kind = 'pending_reserve'), 0),
             coalesce(sum(delta) filter (where kind = 'adjustment'), 0)
        from public.hr_leave_accruals
       where employee_id = p_business->>'employeeId'
         and leave_type_id = (p_business->>'leaveTypeId')::uuid
         and year = v_leave_year
      on conflict (employee_id, leave_type_id, year) do update set
        entitled = 0, accrued = excluded.accrued, taken = excluded.taken,
        pending = excluded.pending, adjustment = excluded.adjustment;
    end if;

    v_module_key    := 'hr_leave';
    v_workflow_type := 'hr_leave_approval';
    v_trigger       := 'hr.leave.requested';
    v_owner         := coalesce(nullif(p_business->>'employeeId', ''), p_actor_id);
    v_event_type    := 'hr.leave.submitted';
    v_entity_type   := 'leave_request';
    v_biz_module    := 'hr';
    v_audit_action  := 'hr.leave.submitted';
    v_source_ctx    := jsonb_build_object(
                         'employeeId', p_business->>'employeeId', 'leaveTypeId', p_business->>'leaveTypeId',
                         'days', p_business->>'days', 'fromDate', p_business->>'fromDate',
                         'toDate', p_business->>'toDate');
  else
    raise exception 'workflow_create_and_start: unsupported source table %', p_source_table using errcode = 'WF400';
  end if;

  -- ── Shared: reload binding + version, derive first-step assignees, create instance ──
  lock table public.module_workflow_bindings in share mode;
  select * into v_binding from public.module_workflow_bindings where id = p_binding_id;
  if not found then
    raise exception 'workflow_create_and_start: binding % not found', p_binding_id using errcode = 'WF404';
  end if;
  if v_binding.module_key is distinct from v_module_key
     or v_binding.workflow_type is distinct from v_workflow_type then
    raise exception 'workflow_create_and_start: binding % does not match %/%',
      p_binding_id, v_module_key, v_workflow_type using errcode = 'WF422';
  end if;
  if v_binding.template_version_id is not null then
    select * into v_ver from public.workflow_template_versions where id = v_binding.template_version_id for share;
  else
    select * into v_ver from public.workflow_template_versions
      where template_id = v_binding.template_id and version_status = 'published'
      order by version_no desc limit 1 for share;
  end if;
  if v_ver.id is null then
    raise exception 'workflow_create_and_start: binding % has no published version', p_binding_id using errcode = 'WF422';
  end if;

  select min((s.value->>'sequenceNo')::numeric) into v_min_seq
    from jsonb_array_elements(coalesce(v_ver.definition->'steps', '[]'::jsonb)) s;
  for v_step in
    select s.value from jsonb_array_elements(coalesce(v_ver.definition->'steps', '[]'::jsonb)) s
     where (s.value->>'sequenceNo')::numeric = v_min_seq
  loop
    v_assignees := v_assignees || jsonb_build_object(
      v_step->>'stepKey',
      wf_internal._resolve_and_validate_assignee(v_step->'assignment', v_source_ctx, v_owner));
  end loop;

  v_res := wf_internal._create_instance(
    p_binding_id, null, null, v_module_key, v_workflow_type, v_new_id::text, v_ref,
    v_trigger, p_actor_id, v_owner, null, null, v_priority,
    v_source_ctx, v_assignees, null);
  v_wf_id := (v_res->>'workflowId')::uuid;

  -- ── Link workflow + business event + module audit (per-table) ──
  if p_source_table = 'hr_overtime_entries' then
    update public.hr_overtime_entries set workflow_id = v_wf_id where id = v_new_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_new_id::text, p_actor_id, 'info',
       jsonb_build_object('employeeId', p_business->>'employeeId', 'workDate', p_business->>'workDate',
                          'hours', p_business->>'hours', 'otType', p_business->>'otType', 'workflowId', v_wf_id),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.hr_audit_log
      (submodule_key, record_id, actor_id, action, previous_state, new_state)
    values
      (v_biz_module, v_new_id::text, p_actor_id, v_audit_action,
       null,
       jsonb_build_object('status', 'submitted', 'employeeId', p_business->>'employeeId',
                          'workDate', p_business->>'workDate', 'hours', p_business->>'hours', 'workflowId', v_wf_id));
  elsif p_source_table = 'hr_requests' then
    update public.hr_requests set workflow_id = v_wf_id where id = v_new_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_new_id::text, p_actor_id, 'info',
       jsonb_build_object('requestNo', v_ref, 'employeeId', p_business->>'employeeId',
                          'requestType', p_business->>'requestType', 'title', p_business->>'title', 'workflowId', v_wf_id),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.hr_audit_log
      (submodule_key, record_id, actor_id, action, previous_state, new_state)
    values
      ('requests', v_new_id::text, p_actor_id, v_audit_action, null,
       jsonb_build_object('requestNo', v_ref, 'requestType', p_business->>'requestType',
                          'title', p_business->>'title', 'workflowId', v_wf_id));
  elsif p_source_table = 'hr_leave_requests' then
    update public.hr_leave_requests set workflow_id = v_wf_id where id = v_new_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_new_id::text, p_actor_id, 'info',
       jsonb_build_object('caseNo', v_ref, 'employeeId', p_business->>'employeeId',
                          'leaveTypeId', p_business->>'leaveTypeId', 'days', p_business->>'days',
                          'fromDate', p_business->>'fromDate', 'toDate', p_business->>'toDate', 'workflowId', v_wf_id),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.hr_audit_log
      (submodule_key, record_id, actor_id, action, previous_state, new_state)
    values
      ('leave', v_new_id::text, p_actor_id, v_audit_action, null,
       jsonb_build_object('caseNo', v_ref, 'status', 'pending_approval',
                          'leaveTypeId', p_business->>'leaveTypeId', 'workflowId', v_wf_id));
  end if;

  v_result := jsonb_build_object(
    'recordId',   v_new_id,
    'ref',        v_ref,
    'workflowId', v_wf_id,
    'workflowNo', v_res->>'workflowNo',
    'eventId',    v_event_id,
    'firstTasks', coalesce(v_res->'firstTasks', '[]'::jsonb));

  perform wf_internal._record_request(v_receipt_key, v_hash, 'create_and_start', v_module_key, v_new_id::text, v_wf_id, v_result);

  return v_result;
end
$fn$;

revoke all on function public.workflow_create_and_start_tx(text, text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.workflow_create_and_start_tx(text, text, uuid, text, jsonb)
  to service_role;
