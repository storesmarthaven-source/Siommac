-- HR Onboarding: one atomic launch boundary.
-- PENDING OPERATOR ACTION - apply only after the accompanying backend/E2E gate is green.

alter table public.hr_onboarding_cases
  add column if not exists package_id uuid references public.hr_onboarding_packages(id) on delete restrict,
  add column if not exists package_version_no integer,
  add column if not exists launch_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists launch_request_id uuid;

create unique index if not exists hr_onboarding_cases_launch_request_uidx
  on public.hr_onboarding_cases(launch_request_id)
  where launch_request_id is not null;

comment on column public.hr_onboarding_cases.launch_snapshot is
  'Immutable generated plan used at launch: package identity/version, tasks, handoffs, requirements, selected optional work and resolved ownership.';

create or replace function public.hr_onboarding_launch_tx(
  p_request_id uuid,
  p_actor_id text,
  p_case jsonb,
  p_tasks jsonb,
  p_handoffs jsonb,
  p_documents jsonb,
  p_actions jsonb,
  p_notifications jsonb,
  p_probation_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case_id uuid;
  v_case_no text;
  v_employee_id text;
  v_event_id uuid;
  v_row jsonb;
  v_task_count integer := 0;
  v_handoff_count integer := 0;
  v_document_count integer := 0;
  v_action_count integer := 0;
begin
  if p_request_id is null then raise exception 'request id is required' using errcode = '22023'; end if;

  -- Serialize the idempotency key before checking it. A concurrent retry waits
  -- for the first transaction and then returns its committed case.
  perform pg_advisory_xact_lock(hashtextextended('hr.onboarding.launch:' || p_request_id::text, 0));

  select c.id, c.case_no, c.employee_id
    into v_case_id, v_case_no, v_employee_id
  from public.hr_onboarding_cases c
  where c.launch_request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'caseId', v_case_id, 'caseNo', v_case_no,
      'taskCount', (select count(*) from public.hr_onboarding_tasks t where t.case_id = v_case_id),
      'handoffCount', (select count(*) from public.hr_onboarding_handoffs h where h.case_id = v_case_id),
      'documentRequestCount', (select count(*) from public.hr_onboarding_document_requests d where d.case_id = v_case_id),
      'idempotentReplay', true
    );
  end if;

  v_case_id := coalesce((p_case ->> 'id')::uuid, gen_random_uuid());
  v_case_no := nullif(p_case ->> 'caseNo', '');
  v_employee_id := nullif(p_case ->> 'employeeId', '');
  if v_case_no is null or v_employee_id is null then
    raise exception 'case number and employee id are required' using errcode = '22023';
  end if;

  -- The read-side duplicate check provides a friendly preview, but only this
  -- transaction can prevent two concurrent requests launching the same worker.
  perform pg_advisory_xact_lock(hashtextextended('hr.onboarding.employee:' || v_employee_id, 0));
  if exists (
    select 1 from public.hr_onboarding_cases c
    where c.employee_id = v_employee_id
      and c.status in ('draft','open','in_progress','blocked','paused','ready_for_activation')
  ) then
    raise exception 'employee already has an active onboarding case' using errcode = '23505';
  end if;

  insert into public.hr_onboarding_cases (
    id, case_no, employee_id, worker_type, package_key, package_id, package_version_no,
    launch_snapshot, launch_request_id, status, owner_id, due_at, started_by, reason,
    priority, target_start_date, launch_mode, case_owner, scheduled_launch_at, metadata
  ) values (
    v_case_id, v_case_no, v_employee_id, nullif(p_case ->> 'workerType', ''),
    p_case ->> 'packageKey', (p_case ->> 'packageId')::uuid,
    (p_case ->> 'packageVersionNo')::integer, coalesce(p_case -> 'launchSnapshot', '{}'::jsonb),
    p_request_id, 'in_progress', nullif(p_case ->> 'ownerId', ''), null,
    p_actor_id, nullif(p_case ->> 'reason', ''), nullif(p_case ->> 'priority', ''),
    nullif(p_case ->> 'targetStartDate', '')::date, 'Start now', null, null, '{}'::jsonb
  );

  for v_row in select value from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) loop
    insert into public.hr_onboarding_tasks (
      id, case_id, task_key, task_title, owner_role, assigned_to, module_key, status,
      due_at, is_blocking, requires_evidence, dependency_keys, sort_order, priority, metadata
    ) values (
      (v_row ->> 'id')::uuid, v_case_id, v_row ->> 'taskKey', v_row ->> 'taskTitle',
      nullif(v_row ->> 'ownerRole', ''), nullif(v_row ->> 'assignedTo', ''),
      nullif(v_row ->> 'moduleKey', ''), 'pending', nullif(v_row ->> 'dueAt', '')::timestamptz,
      coalesce((v_row ->> 'isBlocking')::boolean, false),
      coalesce((v_row ->> 'requiresEvidence')::boolean, false),
      coalesce(v_row -> 'dependencyKeys', '[]'::jsonb), coalesce((v_row ->> 'sortOrder')::integer, 0),
      nullif(v_row ->> 'priority', ''), coalesce(v_row -> 'metadata', '{}'::jsonb)
    );
    v_task_count := v_task_count + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_handoffs, '[]'::jsonb)) loop
    insert into public.hr_onboarding_handoffs (
      id, case_id, handoff_key, target_module, handoff_type, owner_id, status, due_at, payload
    ) values (
      (v_row ->> 'id')::uuid, v_case_id, v_row ->> 'handoffKey', v_row ->> 'targetModule',
      v_row ->> 'handoffType', nullif(v_row ->> 'ownerId', ''), 'pending',
      nullif(v_row ->> 'dueAt', '')::timestamptz, coalesce(v_row -> 'payload', '{}'::jsonb)
    );
    insert into public.handoff_outbox (
      source_module, target_module, source_entity_type, source_entity_id,
      target_entity_type, payload, status, created_by
    ) values (
      'hr', v_row ->> 'targetModule', 'onboarding_case', v_case_id::text,
      'onboarding_work', coalesce(v_row -> 'payload', '{}'::jsonb)
        || jsonb_build_object('caseId', v_case_id, 'caseNo', v_case_no, 'handoffId', v_row ->> 'id'),
      'pending', p_actor_id
    );
    insert into public.app_events (
      event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
      severity, payload, dedupe_key
    ) values (
      'onboarding.handoff.created', 'hr', 'onboarding_case', v_case_id::text, p_actor_id,
      'info', jsonb_build_object('handoffId', v_row ->> 'id', 'targetModule', v_row ->> 'targetModule', 'handoffType', v_row ->> 'handoffType'),
      'hr.onboarding.launch:' || p_request_id::text || ':handoff:' || (v_row ->> 'id')
    );
    v_handoff_count := v_handoff_count + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) loop
    insert into public.hr_onboarding_document_requests (
      id, case_id, requirement_id, employee_id, document_type, label, status,
      document_id, waiver_reason, waived_by, waived_at, is_required, blocks_onboarding,
      can_waive, requires_expiry, metadata, created_by
    ) values (
      (v_row ->> 'id')::uuid, v_case_id, nullif(v_row ->> 'requirementId', '')::uuid,
      v_employee_id, v_row ->> 'documentType', v_row ->> 'label', v_row ->> 'status',
      nullif(v_row ->> 'documentId', '')::uuid, nullif(v_row ->> 'waiverReason', ''),
      case when v_row ->> 'status' = 'waived' then p_actor_id else null end,
      case when v_row ->> 'status' = 'waived' then now() else null end,
      true, coalesce((v_row ->> 'blocksOnboarding')::boolean, false),
      coalesce((v_row ->> 'canWaive')::boolean, false), coalesce((v_row ->> 'requiresExpiry')::boolean, false),
      coalesce(v_row -> 'metadata', '{}'::jsonb), p_actor_id
    );
    if v_row ->> 'status' = 'waived' then
      insert into public.audit_logs(action, table_name, record_id, user_id, changes)
      values ('hr.onboarding.document_waived', 'hr_onboarding_document_requests', v_row ->> 'id', p_actor_id,
        jsonb_build_object('caseId', v_case_id, 'requirementId', v_row ->> 'requirementId', 'reason', v_row ->> 'waiverReason'));
      insert into public.hr_audit_log (
        employee_id, submodule_key, record_id, actor_id, action, new_state, reason
      ) values (
        v_employee_id, 'onboarding', v_row ->> 'id', p_actor_id,
        'hr.onboarding.document_waived',
        jsonb_build_object('caseId', v_case_id, 'requirementId', v_row ->> 'requirementId'),
        v_row ->> 'waiverReason'
      );
    end if;
    v_document_count := v_document_count + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) loop
    insert into public.hr_onboarding_case_actions (
      id, case_id, source_template_id, action_name, action_type, status,
      linked_task_id, linked_handoff_id, added_by, metadata
    ) values (
      (v_row ->> 'id')::uuid, v_case_id, nullif(v_row ->> 'sourceTemplateId', '')::uuid,
      v_row ->> 'actionName', v_row ->> 'actionType', coalesce(nullif(v_row ->> 'status', ''), 'open'),
      nullif(v_row ->> 'linkedTaskId', '')::uuid, nullif(v_row ->> 'linkedHandoffId', '')::uuid,
      p_actor_id, coalesce(v_row -> 'metadata', '{}'::jsonb)
    );
    v_action_count := v_action_count + 1;
  end loop;

  if p_probation_end_date is not null then
    update public.app_users set probation_end_date = p_probation_end_date where id = v_employee_id;
  end if;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
    severity, payload, dedupe_key
  ) values (
    'onboarding.started', 'hr', 'onboarding_case', v_case_id::text, p_actor_id, 'info',
    jsonb_build_object('caseNo', v_case_no, 'employeeId', v_employee_id,
      'packageKey', p_case ->> 'packageKey', 'packageId', p_case ->> 'packageId',
      'packageVersionNo', p_case ->> 'packageVersionNo', 'taskCount', v_task_count,
      'handoffCount', v_handoff_count, 'documentRequestCount', v_document_count,
      'actionCount', v_action_count, 'requestId', p_request_id),
    'hr.onboarding.launch:' || p_request_id::text
  ) returning id into v_event_id;

  insert into public.audit_logs(action, table_name, record_id, user_id, changes)
  values ('hr.onboarding.started', 'hr_onboarding_cases', v_case_id::text, p_actor_id,
    jsonb_build_object('caseNo', v_case_no, 'employeeId', v_employee_id,
      'packageKey', p_case ->> 'packageKey', 'packageVersionNo', p_case ->> 'packageVersionNo',
      'taskCount', v_task_count, 'handoffCount', v_handoff_count,
      'documentRequestCount', v_document_count, 'actionCount', v_action_count,
      'requestId', p_request_id));

  insert into public.hr_audit_log (
    employee_id, submodule_key, record_id, actor_id, action, new_state, reason
  ) values (
    v_employee_id, 'onboarding', v_case_id::text, p_actor_id,
    'hr.onboarding.started',
    jsonb_build_object(
      'caseNo', v_case_no, 'packageKey', p_case ->> 'packageKey',
      'packageId', p_case ->> 'packageId', 'packageVersionNo', p_case ->> 'packageVersionNo',
      'taskCount', v_task_count, 'handoffCount', v_handoff_count,
      'documentRequestCount', v_document_count, 'actionCount', v_action_count,
      'probationEndDate', p_probation_end_date, 'requestId', p_request_id
    ),
    nullif(p_case ->> 'reason', '')
  );

  for v_row in select value from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb)) loop
    insert into public.notifications (
      user_id, type, title, body, is_read, link, event_id, module, severity,
      source_type, source_id, action_route, metadata, dedupe_key,
      action_required, action_status, created_at
    ) values (
      v_row ->> 'userId', coalesce(nullif(v_row ->> 'type', ''), 'hr.onboarding.started'),
      v_row ->> 'title', coalesce(v_row ->> 'body', ''),
      false, nullif(v_row ->> 'actionRoute', ''), v_event_id, 'hr', 'info',
      'onboarding_case', v_case_id::text, nullif(v_row ->> 'actionRoute', ''), '{}'::jsonb,
      coalesce(nullif(v_row ->> 'dedupeKey', ''), (v_row ->> 'userId') || ':hr.onboarding.started:' || v_case_id::text),
      coalesce((v_row ->> 'actionRequired')::boolean, true),
      case when coalesce((v_row ->> 'actionRequired')::boolean, true) then 'pending' else 'none' end,
      now()
    ) on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end loop;

  return jsonb_build_object(
    'caseId', v_case_id, 'caseNo', v_case_no, 'taskCount', v_task_count,
    'handoffCount', v_handoff_count, 'documentRequestCount', v_document_count,
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.hr_onboarding_launch_tx(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, date)
  from public, anon, authenticated;
grant execute on function public.hr_onboarding_launch_tx(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, date)
  to service_role;

-- Verification (operator):
-- 1. Function is service-role only.
-- 2. launch_request_id is unique and a replay returns the original case.
-- 3. A forced invalid child row leaves no case, task, handoff, document, action,
--    event, audit, notification or outbox row for that request id.
