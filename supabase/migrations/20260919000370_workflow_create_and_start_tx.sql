-- ============================================================================
-- Finding #3 Shape B (create-and-start) — shared RPC, slice B1: hr_overtime_entries
-- Depends on: 20260919000211 (_create_instance), 212+ (_resolve_and_validate_assignee),
--             210 (receipt ledger + _claim_request/_record_request).
-- Operator-applied; idempotent (create or replace). After applying:
--   NOTIFY pgrst, 'reload schema';
--   verify: select position('hr_overtime_entries' in prosrc)>0
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
