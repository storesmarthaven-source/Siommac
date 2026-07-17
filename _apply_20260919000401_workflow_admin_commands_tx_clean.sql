
create or replace function public.workflow_publish_template_version_tx(
  p_version_id uuid,
  p_actor_id   text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_target   public.workflow_template_versions%rowtype;
  v_template public.workflow_templates%rowtype;
  v_event_id uuid;
begin
  if p_version_id is null or p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'workflow_publish: version_id and actor_id are required' using errcode = 'WF422';
  end if;
  if not exists (select 1 from public.app_users where id = p_actor_id and status = 'active') then
    raise exception 'workflow_publish: actor is not an active user' using errcode = 'WF403';
  end if;

  select * into v_target from public.workflow_template_versions where id = p_version_id;
  if not found then
    raise exception 'workflow_publish: version % not found', p_version_id using errcode = 'WF404';
  end if;
  select * into v_template from public.workflow_templates
   where id = v_target.template_id for update;
  if not found then
    raise exception 'workflow_publish: template % not found', v_target.template_id using errcode = 'WF404';
  end if;
  perform 1 from public.workflow_template_versions
   where template_id = v_template.id order by id for update;
  select * into v_target from public.workflow_template_versions where id = p_version_id;
  if not found then
    raise exception 'workflow_publish: version % disappeared while locking', p_version_id using errcode = 'WF409';
  end if;
  if v_target.template_id is distinct from v_template.id then
    raise exception 'workflow_publish: version % changed template while locking', p_version_id using errcode = 'WF409';
  end if;

  if v_target.version_status = 'published'
     and v_template.current_version = v_target.version_no
     and v_template.status = 'active' then
    return jsonb_build_object(
      'versionId', v_target.id, 'versionNo', v_target.version_no,
      'templateId', v_template.id, 'duplicate', true);
  end if;
  if v_target.version_status <> 'draft' then
    raise exception 'workflow_publish: version % is % (only draft versions may be published)',
      v_target.id, v_target.version_status using errcode = 'WF409';
  end if;

  update public.workflow_template_versions
     set version_status = 'archived'
   where template_id = v_template.id
     and version_status = 'published'
     and id <> v_target.id;

  update public.workflow_template_versions
     set version_status = 'published', published_by = p_actor_id, published_at = now()
   where id = v_target.id;

  update public.workflow_templates
     set current_version = v_target.version_no, status = 'active', is_active = true,
         updated_by = p_actor_id, updated_at = now()
   where id = v_template.id;

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    ('workflow.template.version_published', 'workflow', 'workflow_template_version',
     v_target.id::text, p_actor_id, 'info',
     jsonb_build_object('templateId', v_template.id, 'templateKey', v_template.template_key,
                        'versionId', v_target.id, 'versionNo', v_target.version_no),
     'wf.template.version_published:' || v_target.id::text)
  returning id into v_event_id;

  insert into public.audit_logs
    (action, table_name, record_id, user_id, changes, created_at)
  values
    ('workflow.template.version_published', 'workflow_template_versions',
     v_target.id::text, p_actor_id,
     jsonb_build_object('templateId', v_template.id, 'versionNo', v_target.version_no,
                        'status', 'published'), now());

  return jsonb_build_object(
    'versionId', v_target.id, 'versionNo', v_target.version_no,
    'templateId', v_template.id, 'eventId', v_event_id, 'duplicate', false);
end
$fn$;

create or replace function public.workflow_admin_command_tx(
  p_command        text,
  p_workflow_id    uuid,
  p_task_id        uuid,
  p_actor_id       text,
  p_target_user_id text,
  p_reason         text,
  p_request_key    text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_inst       public.workflow_instances%rowtype;
  v_task       public.workflow_tasks%rowtype;
  v_task_wf_id uuid;
  v_input_hash text;
  v_dedupe_key text;
  v_existing   public.app_events%rowtype;
  v_event_id   uuid;
  v_transition_id uuid;
  v_result     jsonb;
  v_can_delegate boolean;
  v_actor_role text;
  v_is_assigned boolean;
begin
  p_command := lower(btrim(coalesce(p_command, '')));
  if p_command not in ('cancel', 'delegate', 'reassign') then
    raise exception 'workflow_command: unsupported command %', p_command using errcode = 'WF422';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = ''
     or p_reason is null or btrim(p_reason) = ''
     or p_request_key is null or btrim(p_request_key) = '' then
    raise exception 'workflow_command: actor_id, reason and request_key are required' using errcode = 'WF422';
  end if;
  select role into v_actor_role
    from public.app_users where id = p_actor_id and status = 'active';
  if not found then
    raise exception 'workflow_command: actor is not an active user' using errcode = 'WF403';
  end if;

  v_input_hash := md5((jsonb_build_object(
    'command', p_command, 'workflowId', p_workflow_id, 'taskId', p_task_id,
    'actorId', p_actor_id, 'targetUserId', p_target_user_id, 'reason', p_reason))::text);
  v_dedupe_key := 'wf.command:' || p_actor_id || ':' || btrim(p_request_key);
  perform pg_advisory_xact_lock(hashtextextended(v_dedupe_key, 0));
  select * into v_existing from public.app_events where dedupe_key = v_dedupe_key;
  if found then
    if v_existing.payload->>'inputHash' is distinct from v_input_hash then
      raise exception 'workflow_command: request key was already used for a different command' using errcode = 'WF409';
    end if;
    return coalesce(v_existing.payload->'result', '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;

  if p_command = 'cancel' then
    if p_workflow_id is null then
      raise exception 'workflow_command: workflow_id is required for cancel' using errcode = 'WF422';
    end if;
    select * into v_inst from public.workflow_instances where id = p_workflow_id for update;
    if not found then
      raise exception 'workflow_command: workflow % not found', p_workflow_id using errcode = 'WF404';
    end if;
    if v_inst.active_transition_id is not null then
      raise exception 'workflow_command: workflow % is mid-transition', p_workflow_id using errcode = 'WF409';
    end if;
    if v_inst.status <> 'in_progress' then
      raise exception 'workflow_command: workflow % is already %', p_workflow_id, v_inst.status using errcode = 'WF409';
    end if;

    insert into public.workflow_transitions
      (workflow_id, task_id, kind, decision, actor_id, input_hash, status, result)
    values
      (v_inst.id, null, 'cancel', 'cancelled', p_actor_id, v_input_hash, 'pending',
       jsonb_build_object('reason', p_reason, 'requestKey', p_request_key))
    returning id into v_transition_id;

    insert into public.workflow_outbox (transition_id) values (v_transition_id);
    update public.workflow_instances
       set active_transition_id = v_transition_id
     where id = v_inst.id;

    insert into public.workflow_decisions
      (workflow_id, task_id, actor_id, decision, comment, previous_status, new_status, metadata)
    values
      (v_inst.id, null, p_actor_id, 'cancelled', p_reason, v_inst.status, v_inst.status,
       jsonb_build_object('requestKey', p_request_key, 'transitionId', v_transition_id));
    insert into public.workflow_audit_log
      (workflow_id, module_key, source_record_id, actor_id, action, previous_state, new_state, reason)
    values
      (v_inst.id, v_inst.module_key, v_inst.source_record_id, p_actor_id, 'workflow.cancel_requested',
       jsonb_build_object('status', v_inst.status),
       jsonb_build_object('status', v_inst.status, 'activeTransitionId', v_transition_id), p_reason);

    v_result := jsonb_build_object(
      'workflowId', v_inst.id, 'status', v_inst.status,
      'moduleKey', v_inst.module_key, 'workflowType', v_inst.workflow_type,
      'sourceRecordId', v_inst.source_record_id, 'transitionId', v_transition_id,
      'pendingTransition', true, 'duplicate', false);
  else
    if p_task_id is null or p_target_user_id is null or btrim(p_target_user_id) = '' then
      raise exception 'workflow_command: task_id and target_user_id are required' using errcode = 'WF422';
    end if;
    select workflow_id into v_task_wf_id from public.workflow_tasks where id = p_task_id;
    if not found then
      raise exception 'workflow_command: task % not found', p_task_id using errcode = 'WF404';
    end if;
    select * into v_inst from public.workflow_instances where id = v_task_wf_id for update;
    select * into v_task from public.workflow_tasks where id = p_task_id for update;
    if not found or v_task.workflow_id is distinct from v_inst.id then
      raise exception 'workflow_command: task % changed while locking', p_task_id using errcode = 'WF409';
    end if;
    if v_inst.active_transition_id is not null then
      raise exception 'workflow_command: workflow % is mid-transition', v_inst.id using errcode = 'WF409';
    end if;
    if v_inst.status <> 'in_progress'
       or v_task.status not in ('pending','open','in_progress','delegated','reassigned') then
      raise exception 'workflow_command: task % is not open for action', p_task_id using errcode = 'WF409';
    end if;
    if not exists (select 1 from public.app_users where id = p_target_user_id and status = 'active') then
      raise exception 'workflow_command: target user % is not active', p_target_user_id using errcode = 'WF422';
    end if;

    if p_command = 'delegate' then
      v_is_assigned := coalesce(v_task.assigned_to = p_actor_id, false)
        or (v_task.assigned_role is not null and v_task.assigned_role = v_actor_role);
      if not v_is_assigned then
        raise exception 'workflow_command: only the current assignee may delegate task %', p_task_id using errcode = 'WF403';
      end if;
      select coalesce((s.value->'decisionRules'->>'canDelegate')::boolean, false)
        into v_can_delegate
        from jsonb_array_elements(coalesce(v_inst.template_snapshot->'steps', '[]'::jsonb)) s
       where s.value->>'stepKey' = v_task.step_key
       limit 1;
      if not coalesce(v_can_delegate, false) then
        raise exception 'workflow_command: task % cannot be delegated', p_task_id using errcode = 'WF403';
      end if;
      update public.workflow_tasks
         set assigned_to = p_target_user_id, assigned_role = null,
             delegated_to = p_target_user_id
       where id = v_task.id;
    else
      update public.workflow_tasks
         set assigned_to = p_target_user_id, assigned_role = null,
             delegated_to = null
       where id = v_task.id;
    end if;

    insert into public.workflow_audit_log
      (workflow_id, task_id, module_key, source_record_id, actor_id, action,
       previous_state, new_state, reason)
    values
      (v_inst.id, v_task.id, v_inst.module_key, v_inst.source_record_id, p_actor_id,
       'workflow.task.' || case when p_command = 'delegate' then 'delegated' else 'reassigned' end,
       jsonb_build_object('assignedTo', v_task.assigned_to, 'assignedRole', v_task.assigned_role, 'status', v_task.status),
       jsonb_build_object('assignedTo', p_target_user_id, 'assignedRole', null, 'status', v_task.status), p_reason);

    v_result := jsonb_build_object(
      'workflowId', v_inst.id, 'taskId', v_task.id, 'status', v_task.status,
      'assignedTo', p_target_user_id, 'duplicate', false);
  end if;

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, site_id, department_id, severity, payload, dedupe_key)
  values
    ('workflow.' || case when p_command = 'cancel' then 'cancel_requested' else 'task.' ||
       case when p_command = 'delegate' then 'delegated' else 'reassigned' end end,
     'workflow', 'workflow', coalesce(v_inst.workflow_no, v_inst.id::text),
     p_actor_id, nullif(v_inst.site_id, ''), nullif(v_inst.department_id, ''),
     case when p_command = 'cancel' then 'warning' else 'info' end,
      jsonb_build_object('inputHash', v_input_hash, 'command', p_command,
                         'workflowId', v_inst.id, 'moduleKey', v_inst.module_key,
                         'sourceRecordId', v_inst.source_record_id,
                         'reason', p_reason, 'targetUserId', p_target_user_id,
                        'result', v_result),
     v_dedupe_key)
  returning id into v_event_id;

  return v_result || jsonb_build_object('eventId', v_event_id);
end
$fn$;

create or replace function public.workflow_finalize_cancel_tx(
  p_transition_id uuid,
  p_lease_token   uuid,
  p_source_result jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_tr       public.workflow_transitions%rowtype;
  v_inst     public.workflow_instances%rowtype;
  v_ob       public.workflow_outbox%rowtype;
  v_event_id uuid;
  v_now      timestamptz := now();
begin
  select * into v_tr from public.workflow_transitions where id = p_transition_id;
  if not found then
    raise exception 'workflow_cancel_finalize: transition % not found', p_transition_id using errcode = 'WF404';
  end if;

  select * into v_inst from public.workflow_instances where id = v_tr.workflow_id for update;
  if not found then
    raise exception 'workflow_cancel_finalize: workflow for transition % not found', p_transition_id using errcode = 'WF404';
  end if;
  select * into v_tr from public.workflow_transitions where id = p_transition_id for update;
  select * into v_ob from public.workflow_outbox where transition_id = p_transition_id for update;

  if v_tr.status = 'completed' then
    return jsonb_build_object('eventId', v_tr.result->>'finalEventId', 'alreadyFinal', true);
  end if;
  if v_tr.kind <> 'cancel' or v_tr.decision <> 'cancelled' then
    raise exception 'workflow_cancel_finalize: transition % is not a cancellation', p_transition_id using errcode = 'WF409';
  end if;
  if v_inst.active_transition_id is distinct from p_transition_id then
    raise exception 'workflow_cancel_finalize: transition % does not own the workflow gate', p_transition_id using errcode = 'WF409';
  end if;
  if v_ob.id is null or v_ob.status <> 'processing'
     or v_ob.lease_token is distinct from p_lease_token then
    raise exception 'workflow_cancel_finalize: stale or missing lease for transition %', p_transition_id using errcode = 'WF409';
  end if;

  update public.workflow_tasks
     set status = 'cancelled'
   where workflow_id = v_inst.id
     and status in ('pending','open','in_progress','delegated','reassigned','overdue');
  update public.workflow_instances
     set status = 'cancelled', active_transition_id = null,
         cancelled_at = v_now, closed_at = v_now
   where id = v_inst.id;

  insert into public.workflow_audit_log
    (workflow_id, module_key, source_record_id, actor_id, action,
     previous_state, new_state, reason, metadata)
  values
    (v_inst.id, v_inst.module_key, v_inst.source_record_id, v_tr.actor_id,
     'workflow.cancelled', jsonb_build_object('status', v_inst.status),
     jsonb_build_object('status', 'cancelled'), v_tr.result->>'reason',
     jsonb_build_object('transitionId', v_tr.id, 'sourceResult', coalesce(p_source_result, '{}'::jsonb)));

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, site_id, department_id, severity, payload, dedupe_key)
  values
    ('workflow.cancelled', 'workflow', 'workflow',
     coalesce(v_inst.workflow_no, v_inst.id::text), v_tr.actor_id,
     nullif(v_inst.site_id, ''), nullif(v_inst.department_id, ''), 'warning',
     jsonb_build_object('workflowId', v_inst.id, 'moduleKey', v_inst.module_key,
                        'workflowType', v_inst.workflow_type,
                        'sourceRecordId', v_inst.source_record_id,
                        'reason', v_tr.result->>'reason', 'transitionId', v_tr.id),
     'wf.workflow.cancelled:' || v_inst.id::text || ':' || v_tr.id::text)
  returning id into v_event_id;

  update public.workflow_transitions
     set status = 'completed', completed_at = v_now,
         result = coalesce(result, '{}'::jsonb) ||
                  jsonb_build_object('finalEventId', v_event_id,
                                     'finalStatus', 'cancelled',
                                     'sourceResult', coalesce(p_source_result, '{}'::jsonb))
   where id = v_tr.id;

  return jsonb_build_object('eventId', v_event_id, 'alreadyFinal', false);
end
$fn$;

revoke all on function public.workflow_publish_template_version_tx(uuid, text)
  from public, anon, authenticated;
grant execute on function public.workflow_publish_template_version_tx(uuid, text)
  to service_role;

revoke all on function public.workflow_admin_command_tx(text, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.workflow_admin_command_tx(text, uuid, uuid, text, text, text, text)
  to service_role;
revoke all on function public.workflow_finalize_cancel_tx(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.workflow_finalize_cancel_tx(uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
