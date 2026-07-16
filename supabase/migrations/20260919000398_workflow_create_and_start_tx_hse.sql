-- ============================================================================
-- Finding #3 Shape B (create-and-start) — shared RPC: hr_overtime_entries + hr_requests + hr_leave_requests + hr_org_change_requests + finance_pay_component_change_requests + hr_employee_change_requests + hse_incidents + hse_capa_actions + hse_hazards (slice D1)
-- Depends on: 20260919000211 (_create_instance), 212+ (_resolve_and_validate_assignee),
--             210 (receipt ledger + _claim_request/_record_request).
-- Operator-applied; idempotent (create or replace). After applying:
--   NOTIFY pgrst, 'reload schema';
--   verify: select position('hse_incidents' in prosrc)>0
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
