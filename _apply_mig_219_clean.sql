create or replace function wf_internal._resolve_and_validate_assignee(
  p_assignment jsonb,
  p_source_ctx jsonb,
  p_owner_id   text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_type text := coalesce(p_assignment->>'type', '');
  v_val  text := nullif(p_assignment->>'value', '');
  v_user text;
  v_role text;
begin
  p_source_ctx := coalesce(p_source_ctx, '{}'::jsonb);

  case v_type
    when 'fixed_user'         then v_user := v_val;
    when 'role'               then v_role := v_val;
    when 'supervisor'         then v_user := nullif(p_source_ctx->>'supervisorId', '');
    when 'department_manager' then v_user := nullif(p_source_ctx->>'departmentManagerId', '');
    when 'site_manager'       then v_user := nullif(p_source_ctx->>'siteManagerId', '');
    when 'hse_manager'        then v_user := nullif(p_source_ctx->>'hseManagerId', '');
    when 'document_owner'     then v_user := nullif(p_source_ctx->>'ownerId', '');
    when 'permit_area_owner'  then v_user := nullif(p_source_ctx->>'areaOwnerId', '');
    when 'record_owner'       then v_user := nullif(p_owner_id, '');
    when 'requester_manager'  then v_user := nullif(p_source_ctx->>'requesterManagerId', '');
    when 'dynamic_field'      then
      raise exception '_resolve_and_validate_assignee: dynamic_field assignment is not yet supported in SQL' using errcode = 'WF422';
    else
      raise exception '_resolve_and_validate_assignee: unknown assignment type %', v_type using errcode = 'WF422';
  end case;

  if v_user is null and v_role is null then
    if v_type in ('supervisor','department_manager','site_manager','hse_manager','document_owner','permit_area_owner','record_owner','requester_manager') then
      return '{}'::jsonb;
    end if;
    raise exception '_resolve_and_validate_assignee: assignment type % did not resolve to a user or role', v_type using errcode = 'WF422';
  end if;

  return jsonb_strip_nulls(jsonb_build_object('userId', v_user, 'roleKey', v_role));
end
$fn$;

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

revoke all    on function wf_internal._resolve_and_validate_assignee(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function wf_internal._resolve_and_validate_assignee(jsonb, jsonb, text) to service_role;
revoke all    on function wf_internal._create_instance(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function wf_internal._create_instance(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, uuid) to service_role;
