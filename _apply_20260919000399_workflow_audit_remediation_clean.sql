
create or replace function wf_internal._create_instance(
  p_binding_id             uuid,
  p_template_id            uuid,
  p_template_version_id    uuid,
  p_module_key             text,
  p_workflow_type          text,
  p_source_record_id       text,
  p_source_record_ref      text,
  p_trigger_event          text,
  p_requested_by           text,
  p_owner_id               text,
  p_site_id                text,
  p_department_id          text,
  p_priority               text,
  p_source_snapshot        jsonb,
  p_assignees              jsonb,
  p_supersedes_workflow_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_binding          public.module_workflow_bindings%rowtype;
  v_ver              public.workflow_template_versions%rowtype;
  v_def              jsonb;
  v_template_id      uuid;
  v_tpl_module       text;
  v_version_id       uuid;
  v_min_seq          numeric;
  v_current_step_key text;
  v_year             int;
  v_wf_id            uuid;
  v_no               text;
  v_step             jsonb;
  v_step_key         text;
  v_step_name        text;
  v_step_type        text;
  v_assign_type      text;
  v_assignee         jsonb;
  v_assign_user      text;
  v_assign_role      text;
  v_due              timestamptz;
  v_task_id          uuid;
  v_task_count       int   := 0;
  v_first_tasks      jsonb := '[]'::jsonb;
begin
  p_assignees := coalesce(p_assignees, '{}'::jsonb);

  if p_module_key is null or btrim(p_module_key) = ''
     or p_workflow_type is null or btrim(p_workflow_type) = ''
     or p_source_record_id is null or btrim(p_source_record_id) = '' then
    raise exception '_create_instance: module_key, workflow_type and source_record_id are required' using errcode = 'WF422';
  end if;

  if p_binding_id is not null then
    if p_template_id is not null or p_template_version_id is not null then
      raise exception '_create_instance: bound start must not also pass template/version args' using errcode = 'WF422';
    end if;

    lock table public.module_workflow_bindings in share mode;

    select * into v_binding from public.module_workflow_bindings where id = p_binding_id for share;
    if not found then
      raise exception '_create_instance: binding % not found', p_binding_id using errcode = 'WF404';
    end if;
    if not v_binding.is_active then
      raise exception '_create_instance: binding % is no longer active', p_binding_id using errcode = 'WF409';
    end if;

    if v_binding.module_key is distinct from p_module_key
       or v_binding.workflow_type is distinct from p_workflow_type
       or v_binding.trigger_event is distinct from p_trigger_event then
      raise exception '_create_instance: binding % does not match this operation (%/%/%)',
        p_binding_id, p_module_key, p_workflow_type, p_trigger_event using errcode = 'WF409';
    end if;

    if not coalesce(
           v_binding.scope_type = 'global'
        or v_binding.scope_type = 'role'
        or (v_binding.scope_type = 'site'       and v_binding.scope_id is not null and v_binding.scope_id = nullif(p_site_id, ''))
        or (v_binding.scope_type = 'department' and v_binding.scope_id is not null and v_binding.scope_id = nullif(p_department_id, '')),
        false) then
      raise exception '_create_instance: binding % scope does not apply to this record', p_binding_id using errcode = 'WF409';
    end if;

    if exists (
      select 1 from public.module_workflow_bindings b
       where b.module_key = p_module_key and b.workflow_type = p_workflow_type
         and b.trigger_event = p_trigger_event and b.is_active and b.id <> v_binding.id
         and coalesce(case when jsonb_typeof(b.conditions->'conditions') = 'array'
                           then jsonb_array_length(b.conditions->'conditions') else 0 end, 0) = 0
         and ( b.scope_type = 'global'
            or (b.scope_type = 'site'       and b.scope_id is not null and b.scope_id = nullif(p_site_id, ''))
            or (b.scope_type = 'department' and b.scope_id is not null and b.scope_id = nullif(p_department_id, '')) )
         and ( (case b.scope_type when 'site' then 1 when 'department' then 2 when 'role' then 3 else 4 end)
                < (case v_binding.scope_type when 'site' then 1 when 'department' then 2 when 'role' then 3 else 4 end)
            or ( (case b.scope_type when 'site' then 1 when 'department' then 2 when 'role' then 3 else 4 end)
                 = (case v_binding.scope_type when 'site' then 1 when 'department' then 2 when 'role' then 3 else 4 end)
                 and b.priority < v_binding.priority ) )
    ) then
      raise exception '_create_instance: a more specific active binding now outranks binding % — re-select', p_binding_id using errcode = 'WF409';
    end if;

    if v_binding.template_version_id is not null then
      select * into v_ver from public.workflow_template_versions
        where id = v_binding.template_version_id for share;
    else
      select * into v_ver from public.workflow_template_versions
        where template_id = v_binding.template_id and version_status = 'published'
        order by version_no desc limit 1 for share;
    end if;
    if v_ver.id is not null and v_ver.template_id <> v_binding.template_id then
      raise exception '_create_instance: binding % version % belongs to a different template', p_binding_id, v_ver.id using errcode = 'WF409';
    end if;
  else
    if p_template_version_id is null then
      raise exception '_create_instance: explicit start requires a template version' using errcode = 'WF422';
    end if;
    select * into v_ver from public.workflow_template_versions where id = p_template_version_id for share;
  end if;

  if v_ver.id is null then
    raise exception '_create_instance: no template version resolved' using errcode = 'WF404';
  end if;
  if v_ver.version_status <> 'published' then
    raise exception '_create_instance: template version % is % (not published)', v_ver.id, v_ver.version_status using errcode = 'WF409';
  end if;
  if p_binding_id is null and p_template_id is not null and v_ver.template_id <> p_template_id then
    raise exception '_create_instance: version % does not belong to template %', v_ver.id, p_template_id using errcode = 'WF422';
  end if;

  v_template_id := v_ver.template_id;
  v_version_id  := v_ver.id;
  v_def         := coalesce(v_ver.definition, '{}'::jsonb);

  select module_key into v_tpl_module from public.workflow_templates where id = v_template_id for share;
  if not found then
    raise exception '_create_instance: template % not found', v_template_id using errcode = 'WF404';
  end if;
  if v_tpl_module is distinct from p_module_key then
    raise exception '_create_instance: template % is for module % not %', v_template_id, v_tpl_module, p_module_key using errcode = 'WF409';
  end if;

  select min((s.value->>'sequenceNo')::numeric) into v_min_seq
    from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) s;
  if v_min_seq is null then
    raise exception '_create_instance: template version % has no steps', v_version_id using errcode = 'WF422';
  end if;

  if (select count(*) from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) s
        where (s.value->>'sequenceNo')::numeric = v_min_seq)
     <> (select count(distinct s.value->>'stepKey') from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) s
        where (s.value->>'sequenceNo')::numeric = v_min_seq) then
    raise exception '_create_instance: template version % has duplicate first-step keys', v_version_id using errcode = 'WF422';
  end if;

  select s.value->>'stepKey' into v_current_step_key
    from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) with ordinality s(value, ord)
   where (s.value->>'sequenceNo')::numeric = v_min_seq
   order by s.ord limit 1;

  if exists (
    select 1 from jsonb_object_keys(p_assignees) as k(assignee_key)
     where k.assignee_key not in (
       select s.value->>'stepKey' from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) s
        where (s.value->>'sequenceNo')::numeric = v_min_seq)
  ) then
    raise exception '_create_instance: assignees contain a key that is not a first step' using errcode = 'WF422';
  end if;

  v_year  := extract(year from now())::int;
  v_wf_id := gen_random_uuid();
  v_no    := 'WF-' || v_year || '-' || lpad(public.increment_ref_counter('WF', v_year)::text, 4, '0');

  begin
    insert into public.workflow_instances
      (id, workflow_no, template_id, template_version_id, module_key, workflow_type,
       source_record_id, source_record_ref, status, current_step_key, priority,
       site_id, department_id, requested_by, owner_id, started_at,
       template_snapshot, source_snapshot, metadata, supersedes_workflow_id)
    values
      (v_wf_id, v_no, v_template_id, v_version_id, p_module_key, p_workflow_type,
       p_source_record_id, p_source_record_ref, 'in_progress', v_current_step_key,
       case when p_priority is null or p_priority = 'normal' then 'medium' else p_priority end,
       nullif(p_site_id, ''), nullif(p_department_id, ''), p_requested_by, p_owner_id, now(),
       v_def, coalesce(p_source_snapshot, '{}'::jsonb),
       jsonb_build_object('bindingId', p_binding_id, 'triggerEvent', p_trigger_event),
       p_supersedes_workflow_id);
  exception
    when unique_violation then
      raise exception '_create_instance: an active workflow already exists for this source record (module=%, type=%, source=%)',
        p_module_key, p_workflow_type, p_source_record_id using errcode = 'WF409';
  end;

  for v_step in
    select s.value from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) with ordinality s(value, ord)
     where (s.value->>'sequenceNo')::numeric = v_min_seq
     order by s.ord
  loop
    v_step_key    := v_step->>'stepKey';
    v_step_name   := v_step->>'stepName';
    v_step_type   := coalesce(v_step->>'stepType', '');
    v_assign_type := coalesce(v_step->'assignment'->>'type', '');
    v_assignee    := p_assignees -> v_step_key;
    v_assign_user := nullif(v_assignee->>'userId', '');
    v_assign_role := nullif(v_assignee->>'roleKey', '');

    if v_step_type not in ('review','approval','verification','acknowledgement','assignment','handoff','automation','closeout') then
      raise exception '_create_instance: step % has an unknown stepType %', v_step_key, coalesce(nullif(v_step_type, ''), '(missing)') using errcode = 'WF422';
    end if;
    if v_assign_type not in ('fixed_user','role','supervisor','department_manager','site_manager','hse_manager','document_owner','permit_area_owner','record_owner','requester_manager','dynamic_field') then
      raise exception '_create_instance: step % has an unknown assignment type %', v_step_key, v_assign_type using errcode = 'WF422';
    end if;
    if v_step ? 'dueDurationHours' and jsonb_typeof(v_step->'dueDurationHours') not in ('number','null') then
      raise exception '_create_instance: step % dueDurationHours must be a number', v_step_key using errcode = 'WF422';
    end if;
    if v_step ? 'required' and jsonb_typeof(v_step->'required') not in ('boolean','null') then
      raise exception '_create_instance: step % required must be a boolean', v_step_key using errcode = 'WF422';
    end if;

    if v_assign_type = 'role'
       and v_assign_role is not null
       and v_assign_role is distinct from (v_step->'assignment'->>'value') then
      raise exception '_create_instance: step % role assignee % does not match the template role %',
        v_step_key, v_assign_role, v_step->'assignment'->>'value' using errcode = 'WF422';
    end if;
    if v_assign_type = 'fixed_user'
       and v_assign_user is not null
       and v_assign_user is distinct from (v_step->'assignment'->>'value') then
      raise exception '_create_instance: step % fixed assignee % does not match the template user',
        v_step_key, v_assign_user using errcode = 'WF422';
    end if;
    if v_assign_type = 'role' then
      if v_assign_role is null then
        raise exception '_create_instance: role-assignment step % must resolve to a role', v_step_key using errcode = 'WF422';
      end if;
      if v_assign_user is not null then
        raise exception '_create_instance: role-assignment step % must not also carry a user', v_step_key using errcode = 'WF422';
      end if;
    else
      if v_assign_user is null and v_assign_type = 'fixed_user' then
        raise exception '_create_instance: fixed_user step % must resolve to a user', v_step_key using errcode = 'WF422';
      end if;
      if v_assign_role is not null then
        raise exception '_create_instance: user-assignment step % must not also carry a role', v_step_key using errcode = 'WF422';
      end if;
    end if;
    if v_assign_user is not null
       and not exists (select 1 from public.app_users where id = v_assign_user and status = 'active') then
      raise exception '_create_instance: assignee % for step % is not an active user', v_assign_user, v_step_key using errcode = 'WF422';
    end if;
    if v_assign_role is not null
       and not exists (select 1 from public.roles where name = v_assign_role) then
      raise exception '_create_instance: role % for step % is not a known role', v_assign_role, v_step_key using errcode = 'WF422';
    end if;
    if coalesce((v_step->'assignment'->>'enforceSegregation')::boolean, false)
       and v_assign_user is not null and v_assign_user = p_requested_by then
      raise exception '_create_instance: step % assignee cannot be the requester (segregation of duties)', v_step_key using errcode = 'WF422';
    end if;

    v_due := case
               when jsonb_typeof(v_step->'dueDurationHours') = 'number' and (v_step->>'dueDurationHours')::numeric <> 0
               then now() + ((v_step->>'dueDurationHours')::numeric) * interval '1 hour'
               else null
             end;

    insert into public.workflow_tasks
      (workflow_id, step_key, step_name, step_type, task_title, assigned_to, assigned_role,
       status, due_at, is_required, metadata)
    values
      (v_wf_id, v_step_key, v_step_name, v_step_type, v_step_name, v_assign_user, v_assign_role,
       'pending', v_due, coalesce((v_step->>'required')::boolean, true),
       jsonb_build_object('assignmentType', v_assign_type))
    returning id into v_task_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
       site_id, department_id, severity, payload, dedupe_key)
    values
      ('workflow.task.assigned', 'workflow', 'workflow',
       coalesce(v_no, v_wf_id::text), p_requested_by,
       nullif(p_site_id, ''), nullif(p_department_id, ''), 'info',
       jsonb_build_object('workflowId', v_wf_id, 'workflowNo', v_no, 'taskId', v_task_id,
                          'stepKey', v_step_key, 'stepName', v_step_name,
                          'assignedTo', v_assign_user, 'assignedRole', v_assign_role,
                          'moduleKey', p_module_key, 'sourceRecordId', p_source_record_id,
                          'sourceRecordRef', p_source_record_ref),
       'wf.task.assigned:' || v_task_id::text);

    v_task_count  := v_task_count + 1;
    v_first_tasks := v_first_tasks || jsonb_build_object(
      'taskId', v_task_id, 'stepKey', v_step_key, 'stepName', v_step_name,
      'assignedTo', v_assign_user, 'assignedRole', v_assign_role);
  end loop;

  insert into public.workflow_audit_log
    (workflow_id, module_key, source_record_id, actor_id, action, new_state, metadata)
  values
    (v_wf_id, p_module_key, p_source_record_id, p_requested_by, 'workflow.started',
     jsonb_build_object('status', 'in_progress'),
     jsonb_build_object('bindingId', p_binding_id, 'triggerEvent', p_trigger_event, 'firstTaskCount', v_task_count));

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
     site_id, department_id, severity, payload, dedupe_key)
  values
    ('workflow.started', 'workflow', 'workflow',
     coalesce(v_no, v_wf_id::text), p_requested_by,
     nullif(p_site_id, ''), nullif(p_department_id, ''), 'info',
     jsonb_build_object('workflowId', v_wf_id, 'workflowNo', v_no, 'moduleKey', p_module_key,
                        'workflowType', p_workflow_type, 'sourceRecordId', p_source_record_id,
                        'sourceRecordRef', p_source_record_ref, 'triggerEvent', p_trigger_event),
     'wf.workflow.started:' || v_wf_id::text);

  return jsonb_build_object(
    'workflowId', v_wf_id, 'workflowNo', v_no,
    'currentStepKey', v_current_step_key, 'firstTasks', v_first_tasks);
end
$fn$;

revoke all    on function wf_internal._create_instance(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function wf_internal._create_instance(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, uuid) to service_role;

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
  v_site          text := null;
  v_dept          text := null;
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
  elsif p_source_table = 'hr_org_change_requests' then
    if (p_business->>'entityType') is null or btrim(p_business->>'entityType') = '' then
      raise exception 'workflow_create_and_start: entityType is required' using errcode = 'WF400';
    end if;
    if (p_business->>'action') is null or btrim(p_business->>'action') = '' then
      raise exception 'workflow_create_and_start: action is required' using errcode = 'WF400';
    end if;
    v_ref := 'ORC-' || extract(year from now())::int::text || '-' ||
             lpad(public.increment_ref_counter('ORC', extract(year from now())::int)::text, 4, '0');
    insert into public.hr_org_change_requests
      (change_no, entity_type, entity_id, action, risk_level, status, effective_from,
       reason, old_state, new_state, impact_summary, requested_by, requested_at)
    values
      (v_ref, p_business->>'entityType', nullif(p_business->>'entityId', ''), p_business->>'action',
       coalesce(nullif(p_business->>'riskLevel', ''), 'low'), 'pending_approval',
       coalesce((p_business->>'effectiveFrom')::timestamptz, now()),
       nullif(p_business->>'reason', ''),
       coalesce(p_business->'oldState', '{}'::jsonb), coalesce(p_business->'newState', '{}'::jsonb),
       coalesce(p_business->'impactSummary', '{}'::jsonb), p_actor_id, now())
    returning id into v_new_id;
    v_module_key    := 'hr_org_structure';
    v_workflow_type := 'hr_org_change_approval';
    v_trigger       := 'hr.org.' || (p_business->>'entityType') || '.' || (p_business->>'action');
    v_owner         := p_actor_id;
    v_event_type    := 'org.change.requested';
    v_entity_type   := 'org_change_request';
    v_biz_module    := 'hr';
    v_audit_action  := 'hr.org_change.requested';
    v_source_ctx    := jsonb_build_object(
                         'entityType', p_business->>'entityType', 'entityId', p_business->>'entityId',
                         'action', p_business->>'action', 'riskLevel', p_business->>'riskLevel');
  elsif p_source_table = 'finance_pay_component_change_requests' then
    if (p_business->>'changeType') is null or (p_business->>'changeType') not in ('create', 'update', 'retire') then
      raise exception 'workflow_create_and_start: changeType must be create, update or retire' using errcode = 'WF400';
    end if;
    if (p_business->>'code') is null or btrim(p_business->>'code') = '' then
      raise exception 'workflow_create_and_start: code is required' using errcode = 'WF400';
    end if;
    begin
      insert into public.finance_pay_component_change_requests
        (change_type, component_id, payload, status, created_by)
      values
        (p_business->>'changeType', nullif(p_business->>'componentId', '')::uuid,
         coalesce(p_business->'payload', '{}'::jsonb), 'pending_approval', p_actor_id)
      returning id into v_new_id;
    exception when unique_violation then
      raise exception 'workflow_create_and_start: a create request for this pay component code is already pending approval' using errcode = 'WF409';
    end;
    v_ref := 'PC-' || (p_business->>'code');
    v_module_key    := 'finance_pay_components';
    v_workflow_type := 'finance_pay_component_approval';
    v_trigger       := 'finance.payroll.component.change_submitted';
    v_owner         := p_actor_id;
    v_event_type    := 'finance.payroll.component.change_submitted';
    v_entity_type   := 'pay_component_cr';
    v_biz_module    := 'finance_payroll_components';
    v_audit_action  := 'pay_component_cr.' || (p_business->>'changeType') || '_submitted';
    v_source_ctx    := jsonb_build_object(
                         'changeType', p_business->>'changeType', 'componentId', p_business->>'componentId',
                         'code', p_business->>'code');
  elsif p_source_table = 'hr_employee_change_requests' then
    if (p_business->>'employeeId') is null or btrim(p_business->>'employeeId') = '' then
      raise exception 'workflow_create_and_start: employeeId is required' using errcode = 'WF400';
    end if;
    if (p_business->>'changeType') is null or btrim(p_business->>'changeType') = '' then
      raise exception 'workflow_create_and_start: changeType is required' using errcode = 'WF400';
    end if;
    v_ref := 'HRC-' || extract(year from now())::int::text || '-' ||
             lpad(public.increment_ref_counter('HRC', extract(year from now())::int)::text, 4, '0');
    insert into public.hr_employee_change_requests
      (change_no, employee_id, change_type, requested_by, previous_value, requested_value, status, metadata)
    values
      (v_ref, p_business->>'employeeId', p_business->>'changeType', p_actor_id,
       coalesce(p_business->'previousValue', '{}'::jsonb),
       coalesce(p_business->'requestedValue', '{}'::jsonb),
       'in_review',
       jsonb_build_object('reason', p_business->>'reason'))
    returning id into v_new_id;
    v_module_key    := 'hr_employee_master';
    v_workflow_type := 'hr_change_approval';
    v_trigger       := 'hr.employee.' || (p_business->>'changeType');
    v_owner         := coalesce(nullif(p_business->>'employeeId', ''), p_actor_id);
    v_event_type    := 'hr.employee.change_requested';
    v_entity_type   := 'employee_change';
    v_biz_module    := 'hr';
    v_audit_action  := 'hr.employee.change_requested';
    v_source_ctx    := jsonb_build_object(
                         'employeeId', p_business->>'employeeId',
                         'changeType', p_business->>'changeType');
    elsif p_source_table = 'hse_incidents' then
    if (p_business->>'title') is null or btrim(p_business->>'title') = '' then
      raise exception 'workflow_create_and_start: incident title is required' using errcode = 'WF400';
    end if;
    if (p_business->>'incidentDate') is null or btrim(p_business->>'incidentDate') = '' then
      raise exception 'workflow_create_and_start: incidentDate is required' using errcode = 'WF400';
    end if;
    if (p_business->>'incidentType') is null or btrim(p_business->>'incidentType') = '' then
      raise exception 'workflow_create_and_start: incidentType is required' using errcode = 'WF400';
    end if;
    if (p_business->>'severity') is null or btrim(p_business->>'severity') = '' then
      raise exception 'workflow_create_and_start: severity is required' using errcode = 'WF400';
    end if;
    v_ref := 'INC-' || extract(year from now())::int || '-' ||
             lpad(public.increment_ref_counter('INC', extract(year from now())::int)::text, 4, '0');
    insert into public.hse_incidents
      (ref, title, description, incident_date, reported_by, site_id, department_id,
       location_text, incident_type, severity, status, immediate_action, regulatory_class,
       osh_classification, injury_type, body_part, lost_days, return_to_work,
       osh_notification_due, osh_written_due, recordable, lost_time, metadata)
    values
      (v_ref, p_business->>'title', coalesce(p_business->>'description', ''),
       (p_business->>'incidentDate')::timestamptz, p_actor_id,
       nullif(p_business->>'siteId', ''), nullif(p_business->>'departmentId', ''),
       nullif(p_business->>'locationText', ''),
       p_business->>'incidentType', p_business->>'severity', 'triage',
       nullif(p_business->>'immediateAction', ''), nullif(p_business->>'regulatoryClass', ''),
       nullif(p_business->>'oshClassification', ''), nullif(p_business->>'injuryType', ''),
       nullif(p_business->>'bodyPart', ''), coalesce((p_business->>'lostDays')::int, 0),
       (nullif(p_business->>'returnToWork', ''))::date,
       (nullif(p_business->>'oshNotificationDue', ''))::timestamptz,
       (nullif(p_business->>'oshWrittenDue', ''))::timestamptz,
       coalesce((p_business->>'recordable')::boolean, false),
       coalesce((p_business->>'lostTime')::boolean, false),
       coalesce(p_business->'metadata', '{}'::jsonb))
    returning id into v_new_id;

    insert into public.hse_incident_people
      (incident_id, person_type, user_id, full_name, role_or_company, injury_description)
    select v_new_id, x->>'personType', nullif(x->>'userId', ''), x->>'fullName',
           nullif(x->>'roleOrCompany', ''), nullif(x->>'injuryDescription', '')
      from jsonb_array_elements(coalesce(p_business->'people', '[]'::jsonb)) x;

    v_site := nullif(p_business->>'siteId', '');
    v_dept := nullif(p_business->>'departmentId', '');
    v_module_key    := 'hse_incidents';
    v_workflow_type := 'incident_investigation';
    v_trigger       := 'incident.reported';
    v_owner         := p_actor_id;
    v_event_type    := 'hse.incident.submitted';
    v_entity_type   := 'incident';
    v_biz_module    := 'hse';
    v_audit_action  := 'hse.incident.submitted';
    v_source_ctx    := jsonb_build_object(
                         'severity',     p_business->>'severity',
                         'incidentType', p_business->>'incidentType',
                         'lostTime',     coalesce((p_business->>'lostTime')::boolean, false),
                         'siteId',       p_business->>'siteId');
  elsif p_source_table = 'hse_capa_actions' then
    if (p_business->>'title') is null or btrim(p_business->>'title') = '' then
      raise exception 'workflow_create_and_start: capa title is required' using errcode = 'WF400';
    end if;
    if (p_business->>'sourceType') is null or btrim(p_business->>'sourceType') = '' then
      raise exception 'workflow_create_and_start: sourceType is required' using errcode = 'WF400';
    end if;
    if (p_business->>'ownerUserId') is null or btrim(p_business->>'ownerUserId') = '' then
      raise exception 'workflow_create_and_start: ownerUserId is required' using errcode = 'WF400';
    end if;
    v_ref := 'CAPA-' || extract(year from now())::int || '-' ||
             lpad(public.increment_ref_counter('CAPA', extract(year from now())::int)::text, 4, '0');
    insert into public.hse_capa_actions
      (ref, source_type, source_id, title, description, owner_user_id, priority,
       status, due_at, created_by, metadata)
    values
      (v_ref, p_business->>'sourceType', p_business->>'sourceId',
       p_business->>'title', coalesce(p_business->>'description', ''),
       p_business->>'ownerUserId',
       coalesce(nullif(p_business->>'priority', ''), 'medium'),
       'open', (nullif(p_business->>'dueAt', ''))::timestamptz, p_actor_id,
       coalesce(p_business->'metadata', '{}'::jsonb))
    returning id into v_new_id;

    v_module_key    := 'hse_capa';
    v_workflow_type := 'capa_closure';
    v_trigger       := 'capa.created';
    v_owner         := p_business->>'ownerUserId';
    v_event_type    := 'hse.capa.assigned';
    v_entity_type   := 'capa';
    v_biz_module    := 'hse';
    v_audit_action  := 'hse.capa.assigned';
    v_source_ctx    := jsonb_build_object(
                         'ownerUserId', p_business->>'ownerUserId',
                         'sourceType',  p_business->>'sourceType',
                         'sourceId',    p_business->>'sourceId',
                         'priority',    coalesce(nullif(p_business->>'priority', ''), 'medium'));
  elsif p_source_table = 'hse_hazards' then
    if (p_business->>'title') is null or btrim(p_business->>'title') = '' then
      raise exception 'workflow_create_and_start: hazard title is required' using errcode = 'WF400';
    end if;
    if (p_business->>'category') is null or btrim(p_business->>'category') = '' then
      raise exception 'workflow_create_and_start: category is required' using errcode = 'WF400';
    end if;
    if coalesce((p_business->>'initialLikelihood')::int, 0) not between 1 and 5
       or coalesce((p_business->>'initialSeverity')::int, 0) not between 1 and 5 then
      raise exception 'workflow_create_and_start: initial likelihood/severity must be 1-5' using errcode = 'WF422';
    end if;
    if (p_business->>'ownerUserId') is null or btrim(p_business->>'ownerUserId') = '' then
      raise exception 'workflow_create_and_start: ownerUserId is required' using errcode = 'WF400';
    end if;
    v_ref := 'HAZ-' || extract(year from now())::int || '-' ||
             lpad(public.increment_ref_counter('HAZ', extract(year from now())::int)::text, 4, '0');
    insert into public.hse_hazards
      (ref, title, description, category, site_id, department_id, location_text,
       owner_user_id, initial_likelihood, initial_severity, residual_likelihood,
       residual_severity, risk_level, status, review_due_at, created_by)
    values
      (v_ref, p_business->>'title', coalesce(p_business->>'description', ''),
       p_business->>'category',
       nullif(p_business->>'siteId', ''), nullif(p_business->>'departmentId', ''),
       nullif(p_business->>'locationText', ''),
       p_business->>'ownerUserId',
       (p_business->>'initialLikelihood')::int, (p_business->>'initialSeverity')::int,
       (nullif(p_business->>'residualLikelihood', ''))::int,
       (nullif(p_business->>'residualSeverity', ''))::int,
       p_business->>'riskLevel', 'assessment_required',
       (nullif(p_business->>'reviewDueAt', ''))::timestamptz, p_actor_id)
    returning id into v_new_id;

    insert into public.hse_controls
      (source_type, source_id, hazard_id, description, control_type, owner_user_id,
       due_at, status, created_by)
    select 'hazard', v_new_id::text, v_new_id, x->>'description',
           coalesce(nullif(x->>'controlType', ''), 'administrative'),
           coalesce(nullif(x->>'ownerUserId', ''), p_actor_id),
           (nullif(x->>'dueAt', ''))::timestamptz, 'planned', p_actor_id
      from jsonb_array_elements(coalesce(p_business->'controls', '[]'::jsonb)) x;

    v_site := nullif(p_business->>'siteId', '');
    v_dept := nullif(p_business->>'departmentId', '');
    v_module_key    := 'hse_hazards';
    v_workflow_type := 'hazard_review';
    v_trigger       := 'hazard.registered';
    v_owner         := p_business->>'ownerUserId';
    v_event_type    := 'hse.hazard.registered';
    v_entity_type   := 'hazard';
    v_biz_module    := 'hse';
    v_audit_action  := 'hse.hazard.registered';
    v_source_ctx    := jsonb_build_object(
                         'category',  p_business->>'category',
                         'riskLevel', p_business->>'riskLevel',
                         'score',     coalesce((p_business->>'initialLikelihood')::int, 0)
                                      * coalesce((p_business->>'initialSeverity')::int, 0));
  else
    raise exception 'workflow_create_and_start: unsupported source table %', p_source_table using errcode = 'WF400';
  end if;

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
    v_trigger, p_actor_id, v_owner, v_site, v_dept, v_priority,
    v_source_ctx, v_assignees, null);
  v_wf_id := (v_res->>'workflowId')::uuid;

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
  elsif p_source_table = 'hr_org_change_requests' then
    update public.hr_org_change_requests set workflow_id = v_wf_id, updated_at = now() where id = v_new_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_new_id::text, p_actor_id,
       case when p_business->>'riskLevel' = 'critical' then 'warning' else 'info' end,
       jsonb_build_object('entityType', p_business->>'entityType', 'entityId', p_business->>'entityId',
                          'action', p_business->>'action', 'riskLevel', p_business->>'riskLevel', 'workflowId', v_wf_id),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.hr_audit_log
      (submodule_key, record_id, actor_id, action, previous_state, new_state)
    values
      ('organization', v_new_id::text, p_actor_id, v_audit_action, null,
       jsonb_build_object('changeNo', v_ref, 'entityType', p_business->>'entityType',
                          'entityId', p_business->>'entityId', 'action', p_business->>'action',
                          'riskLevel', p_business->>'riskLevel', 'workflowId', v_wf_id));
  elsif p_source_table = 'finance_pay_component_change_requests' then
    update public.finance_pay_component_change_requests set workflow_id = v_wf_id where id = v_new_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_new_id::text, p_actor_id, 'info',
       jsonb_build_object('changeType', p_business->>'changeType', 'componentId', p_business->>'componentId',
                          'ref', v_ref, 'workflowId', v_wf_id),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.hr_audit_log
      (submodule_key, record_id, actor_id, action, previous_state, new_state)
    values
      ('finance_payroll_components', v_new_id::text, p_actor_id, v_audit_action, null,
       jsonb_build_object('changeType', p_business->>'changeType', 'componentId', p_business->>'componentId',
                          'ref', v_ref, 'workflowId', v_wf_id));
  elsif p_source_table = 'hr_employee_change_requests' then
    update public.hr_employee_change_requests set workflow_id = v_wf_id where id = v_new_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_new_id::text, p_actor_id, 'info',
       jsonb_build_object('changeNo', v_ref, 'employeeId', p_business->>'employeeId',
                          'changeType', p_business->>'changeType', 'workflowId', v_wf_id),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.hr_audit_log
      (submodule_key, record_id, actor_id, action, previous_state, new_state)
    values
      ('employees', v_new_id::text, p_actor_id, v_audit_action, null,
       jsonb_build_object('changeNo', v_ref, 'changeType', p_business->>'changeType',
                          'requestedValue', p_business->'requestedValue', 'workflowId', v_wf_id));
  elsif p_source_table = 'hse_incidents' then
    update public.hse_incidents set workflow_id = v_wf_id, updated_at = now() where id = v_new_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_new_id::text, p_actor_id,
       case when p_business->>'severity' = 'critical' then 'critical'
            when p_business->>'severity' = 'high' then 'high' else 'info' end,
       jsonb_build_object('title', p_business->>'title', 'severity', p_business->>'severity',
                          'lostTime', coalesce((p_business->>'lostTime')::boolean, false),
                          'entityRef', v_ref, 'operation', 'create', 'workflowId', v_wf_id),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.audit_logs (action, table_name, record_id, user_id, changes, created_at)
    values
      (v_audit_action, v_entity_type, v_ref, p_actor_id,
       jsonb_build_object('status', 'triage', 'workflowId', v_wf_id,
                          'title', p_business->>'title', 'severity', p_business->>'severity'),
       now());
  elsif p_source_table = 'hse_capa_actions' then
    update public.hse_capa_actions set workflow_id = v_wf_id, updated_at = now() where id = v_new_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_new_id::text, p_actor_id,
       case when p_business->>'priority' = 'critical' then 'critical' else 'info' end,
       jsonb_build_object('ownerUserId', p_business->>'ownerUserId',
                          'priority', coalesce(nullif(p_business->>'priority', ''), 'medium'),
                          'entityRef', v_ref, 'operation', 'create', 'workflowId', v_wf_id),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.audit_logs (action, table_name, record_id, user_id, changes, created_at)
    values
      (v_audit_action, v_entity_type, v_ref, p_actor_id,
       jsonb_build_object('status', 'open', 'workflowId', v_wf_id,
                          'title', p_business->>'title', 'ownerUserId', p_business->>'ownerUserId'),
       now());
  elsif p_source_table = 'hse_hazards' then
    update public.hse_hazards set workflow_id = v_wf_id, updated_at = now() where id = v_new_id;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_new_id::text, p_actor_id,
       case when p_business->>'riskLevel' = 'critical' then 'critical'
            when p_business->>'riskLevel' = 'high' then 'high' else 'info' end,
       jsonb_build_object('title', p_business->>'title', 'category', p_business->>'category',
                          'riskLevel', p_business->>'riskLevel',
                          'score', coalesce((p_business->>'initialLikelihood')::int, 0)
                                   * coalesce((p_business->>'initialSeverity')::int, 0),
                          'entityRef', v_ref, 'operation', 'create', 'workflowId', v_wf_id),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.audit_logs (action, table_name, record_id, user_id, changes, created_at)
    values
      (v_audit_action, v_entity_type, v_ref, p_actor_id,
       jsonb_build_object('status', 'assessment_required', 'workflowId', v_wf_id,
                          'title', p_business->>'title', 'riskLevel', p_business->>'riskLevel'),
       now());
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

update public.workflow_tasks t
   set status = 'cancelled'
 where t.status in ('pending', 'open', 'in_progress')
   and exists (
     select 1 from public.workflow_instances w
      where w.id = t.workflow_id
        and w.status in ('completed','approved','returned','rejected','cancelled','closed'));

grant select, insert, update, delete on public.message_post_reactions    to service_role;
grant select, insert, update, delete on public.message_thread_favourites to service_role;
