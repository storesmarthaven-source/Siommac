
create or replace function public.hse_incident_create_tx(
  p_actor_id    text,
  p_binding_id  uuid,
  p_request_key text,
  p_business    jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_receipt_key text;
  v_hash        text;
  v_claim       jsonb;
  v_result      jsonb;
  v_record_id   uuid;
  v_ref         text;
  v_workflow_id uuid;
  v_event_id    uuid;
  v_handoff_id  uuid;
  v_handoff_ids jsonb := '[]'::jsonb;
  v_person      jsonb;
begin
  p_business := coalesce(p_business, '{}'::jsonb);
  if jsonb_typeof(p_business) <> 'object' then
    raise exception 'hse_incident_create: business payload must be an object' using errcode = 'WF400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = ''
     or p_request_key is null or btrim(p_request_key) = '' then
    raise exception 'hse_incident_create: actor_id and request_key are required' using errcode = 'WF400';
  end if;
  if not exists (select 1 from public.app_users where id = p_actor_id and status = 'active') then
    raise exception 'hse_incident_create: actor is not active' using errcode = 'WF403';
  end if;

  if nullif(btrim(p_business->>'title'), '') is null
     or nullif(btrim(p_business->>'incidentDate'), '') is null
     or nullif(btrim(p_business->>'incidentType'), '') is null
     or nullif(btrim(p_business->>'severity'), '') is null then
    raise exception 'hse_incident_create: title, incidentDate, incidentType and severity are required' using errcode = 'WF400';
  end if;
  if p_business->>'severity' not in ('minor','moderate','high','critical') then
    raise exception 'hse_incident_create: invalid severity' using errcode = 'WF422';
  end if;
  if p_business ? 'metadata'
     and jsonb_typeof(p_business->'metadata') not in ('object', 'null') then
    raise exception 'hse_incident_create: metadata must be an object or null' using errcode = 'WF422';
  end if;
  if p_business ? 'people'
     and jsonb_typeof(p_business->'people') not in ('array', 'null') then
    raise exception 'hse_incident_create: people must be an array or null' using errcode = 'WF422';
  end if;

  p_business := jsonb_set(
    p_business,
    '{metadata}',
    case when jsonb_typeof(p_business->'metadata') = 'object'
         then p_business->'metadata' else '{}'::jsonb end || jsonb_build_object(
      'costImpact', coalesce((p_business->>'costImpact')::boolean, false),
      'equipmentDamage', coalesce((p_business->>'equipmentDamage')::boolean, false)),
    true);
  p_business := jsonb_set(
    p_business,
    '{people}',
    case when jsonb_typeof(p_business->'people') = 'array'
         then p_business->'people' else '[]'::jsonb end,
    true);

  v_receipt_key := p_actor_id || '|hse_incident_create|' || btrim(p_request_key);
  v_hash := md5((jsonb_build_object(
    'actor', p_actor_id, 'business', p_business))::text);
  v_claim := wf_internal._claim_request(v_receipt_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return coalesce(v_claim->'result', '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;

  if p_binding_id is not null then
    v_result := public.workflow_create_and_start_tx(
      'hse_incidents', p_actor_id, p_binding_id,
      btrim(p_request_key) || ':workflow', p_business);
    v_record_id := (v_result->>'recordId')::uuid;
    v_ref := v_result->>'ref';
    v_workflow_id := nullif(v_result->>'workflowId', '')::uuid;
    v_event_id := nullif(v_result->>'eventId', '')::uuid;
  else
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
       nullif(p_business->>'locationText', ''), p_business->>'incidentType',
       p_business->>'severity', 'open', nullif(p_business->>'immediateAction', ''),
       nullif(p_business->>'regulatoryClass', ''), nullif(p_business->>'oshClassification', ''),
       nullif(p_business->>'injuryType', ''), nullif(p_business->>'bodyPart', ''),
       coalesce((p_business->>'lostDays')::int, 0),
       nullif(p_business->>'returnToWork', '')::date,
       nullif(p_business->>'oshNotificationDue', '')::timestamptz,
       nullif(p_business->>'oshWrittenDue', '')::timestamptz,
       coalesce((p_business->>'recordable')::boolean, false),
       coalesce((p_business->>'lostTime')::boolean, false),
       coalesce(p_business->'metadata', '{}'::jsonb) || jsonb_build_object(
         'costImpact', coalesce((p_business->>'costImpact')::boolean, false),
         'equipmentDamage', coalesce((p_business->>'equipmentDamage')::boolean, false)))
    returning id into v_record_id;

    for v_person in select value from jsonb_array_elements(coalesce(p_business->'people', '[]'::jsonb))
    loop
      insert into public.hse_incident_people
        (incident_id, person_type, user_id, full_name, role_or_company, injury_description)
      values
        (v_record_id, v_person->>'personType', nullif(v_person->>'userId', ''),
         v_person->>'fullName', nullif(v_person->>'roleOrCompany', ''),
         nullif(v_person->>'injuryDescription', ''));
    end loop;

    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
       site_id, department_id, severity, payload, dedupe_key)
    values
      ('hse.incident.submitted', 'hse', 'incident', v_record_id::text, p_actor_id,
       nullif(p_business->>'siteId', ''), nullif(p_business->>'departmentId', ''),
       case when p_business->>'severity' = 'critical' then 'critical'
            when p_business->>'severity' = 'high' then 'high' else 'info' end,
       jsonb_build_object('title', p_business->>'title', 'severity', p_business->>'severity',
                          'lostTime', coalesce((p_business->>'lostTime')::boolean, false),
                          'entityRef', v_ref, 'operation', 'create'),
       'hse.incident.submitted:' || v_record_id::text)
    returning id into v_event_id;

    insert into public.audit_logs
      (action, table_name, record_id, user_id, changes, created_at)
    values
      ('hse.incident.submitted', 'incident', v_ref, p_actor_id,
       jsonb_build_object('status', 'open', 'title', p_business->>'title',
                          'severity', p_business->>'severity'), now());

    v_result := jsonb_build_object(
      'recordId', v_record_id, 'ref', v_ref, 'workflowId', null,
      'workflowNo', null, 'eventId', v_event_id, 'firstTasks', '[]'::jsonb);
  end if;

  if coalesce((p_business->>'lostTime')::boolean, false) then
    insert into public.handoff_outbox
      (source_module, target_module, source_entity_type, source_entity_id,
       target_entity_type, payload, status, created_by)
    values
      ('hse', 'hr', 'incident', v_record_id::text, 'lost_time_incident',
       jsonb_build_object(
         'reason', 'lost_time_incident', 'severity', p_business->>'severity',
         'incidentType', p_business->>'incidentType',
         'employeeId', (select x->>'userId' from jsonb_array_elements(coalesce(p_business->'people','[]'::jsonb)) x where x->>'personType' = 'injured' limit 1),
         'lostDays', coalesce((p_business->>'lostDays')::int, 0),
         'title', p_business->>'title', 'sourceRef', v_ref, 'sourceEventId', v_event_id),
       'pending', p_actor_id)
    returning id into v_handoff_id;
    v_handoff_ids := v_handoff_ids || jsonb_build_array(v_handoff_id);
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
       severity, payload, dedupe_key)
    values
      ('handoff.created', 'hse', 'incident', v_record_id::text, p_actor_id, 'info',
       jsonb_build_object('targetModule', 'hr', 'handoffId', v_handoff_id),
       'handoff.created:' || v_handoff_id::text);
  end if;

  if coalesce((p_business->>'costImpact')::boolean, false) then
    insert into public.handoff_outbox
      (source_module, target_module, source_entity_type, source_entity_id,
       target_entity_type, payload, status, created_by)
    values
      ('hse', 'finance', 'incident', v_record_id::text, 'incident_cost_impact',
       jsonb_build_object('reason', 'incident_cost_impact', 'severity', p_business->>'severity',
                          'incidentType', p_business->>'incidentType', 'title', p_business->>'title',
                          'siteId', p_business->>'siteId', 'sourceRef', v_ref, 'sourceEventId', v_event_id),
       'pending', p_actor_id)
    returning id into v_handoff_id;
    v_handoff_ids := v_handoff_ids || jsonb_build_array(v_handoff_id);
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
       severity, payload, dedupe_key)
    values
      ('handoff.created', 'hse', 'incident', v_record_id::text, p_actor_id, 'info',
       jsonb_build_object('targetModule', 'finance', 'handoffId', v_handoff_id),
       'handoff.created:' || v_handoff_id::text);
  end if;

  if coalesce((p_business->>'equipmentDamage')::boolean, false) then
    insert into public.handoff_outbox
      (source_module, target_module, source_entity_type, source_entity_id,
       target_entity_type, payload, status, created_by)
    values
      ('hse', 'operations', 'incident', v_record_id::text, 'equipment_damage',
       jsonb_build_object('reason', 'equipment_damage', 'severity', p_business->>'severity',
                          'incidentType', p_business->>'incidentType',
                          'title', 'Equipment inspection: ' || (p_business->>'title'),
                          'description', 'Equipment damage reported in incident. Immediate inspection and repair assessment required.',
                          'siteId', p_business->>'siteId',
                          'priority', case when p_business->>'severity' = 'critical' then 'critical' else 'medium' end,
                          'sourceRef', v_ref, 'sourceEventId', v_event_id),
       'pending', p_actor_id)
    returning id into v_handoff_id;
    v_handoff_ids := v_handoff_ids || jsonb_build_array(v_handoff_id);
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
       severity, payload, dedupe_key)
    values
      ('handoff.created', 'hse', 'incident', v_record_id::text, p_actor_id, 'info',
       jsonb_build_object('targetModule', 'operations', 'handoffId', v_handoff_id),
       'handoff.created:' || v_handoff_id::text);
  end if;

  v_result := v_result || jsonb_build_object('handoffIds', v_handoff_ids, 'duplicate', false);
  perform wf_internal._record_request(
    v_receipt_key, v_hash, 'hse_incident_create', 'hse_incidents',
    v_record_id::text, v_workflow_id, v_result);
  return v_result;
end
$fn$;

revoke all on function public.hse_incident_create_tx(text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.hse_incident_create_tx(text, uuid, text, jsonb)
  to service_role;

notify pgrst, 'reload schema';
