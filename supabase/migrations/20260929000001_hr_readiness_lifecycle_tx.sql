-- ============================================================================
-- Employee Profile — atomic readiness work-item lifecycle
-- ============================================================================
-- docs/EMPLOYEE_READINESS_COLLABORATION_NOTE.md §"Mutation Contract" requires
-- every readiness transition to atomically:
--   1. update the control instance;
--   2. record the state transition;
--   3. recalculate employee readiness;
--   4. emit the application event;
--   5. write the audit record;
--   6. create or complete workflow tasks;
--   7. notify affected participants;
--   8. create a handoff when another module owns the work.
--
-- supabase-js issues a SEPARATE PostgREST call per statement, so the app layer
-- cannot wrap these in one transaction. A failure midway would leave a control
-- flipped to `ready` with no audit row, or a work item routed to Payroll with no
-- notification and no handoff — work that looks assigned and reaches nobody.
-- The lifecycle therefore lives in the database, as ONE commit path.
--
-- ONE CORRELATION ID threads the work item, transition, event, both audit trails,
-- the workflow instance, the notifications and the handoff.
--
-- WORKFLOW REUSE — NOT A SECOND TASK SYSTEM:
-- this function does NOT insert workflow_tasks itself. It calls the canonical
-- primitive `public.workflow_start_instance_tx`, which owns workflow_instances,
-- workflow_tasks, workflow_audit_log and the workflow app_events. Readiness
-- supplies only the template version, the source reference and the assignee.
--
-- WHY TWO TEMPLATES:
-- `wf_internal._create_instance` requires the assignee form to match the step's
-- assignment KIND, and rejects a task carrying both a user and a role (that
-- would broaden decision authority — see its own comment). Readiness ownership
-- is configurable as EITHER a role or a specific user, so the two cases need two
-- published definitions. Same engine, same workflow_type, two assignment kinds.
--
-- OWNERSHIP IS RESOLVED BEFORE THIS FUNCTION IS CALLED.
-- `lib/hr/readinessOwnership.ts` fails closed as `owner_required` when no valid
-- owner exists; by the time we are here an owner is proven to exist and to hold
-- the required capability. This function still refuses a blank owner, so the
-- guarantee cannot be lost by a future caller.
--
-- Operator-applied. The schema reload is executed by the migration itself.
--
-- ⚠ Apply this file WHOLE. The trailing REVOKE is what stops this SECURITY
--   DEFINER function being callable by anon/authenticated, and it is exactly the
--   tail the Supabase SQL editor has silently dropped before. Verify with
--   scripts/sql/verify_20260929000001_hr_readiness_lifecycle_tx.sql and
--   scripts/verify-hr-readiness-lifecycle.mjs after applying.
-- ============================================================================

-- ── 1. Readiness review workflow templates ─────────────────────────────────
-- Seeded idempotently. `workflow_type` is identical for both so every readiness
-- workflow is queryable as one type regardless of how ownership is configured.

do $seed$
declare
  v_template_id uuid;
  v_definition  jsonb;
begin
  -- ── role-owned variant ──
  select id into v_template_id from public.workflow_templates where template_key = 'hr_readiness_review_role';
  if v_template_id is null then
    insert into public.workflow_templates (template_key, name, description, module_key, workflow_type, status, is_active, current_version, definition)
    values ('hr_readiness_review_role', 'Employee Readiness Review (Role Owner)',
            'Resolves a blocking employee readiness control routed to an owning role.',
            'hr_employee_master', 'hr_readiness_review', 'active', true, 1, '{}'::jsonb)
    returning id into v_template_id;
  end if;

  v_definition := jsonb_build_object(
    'schemaVersion', 1,
    'steps', jsonb_build_array(jsonb_build_object(
      'stepKey', 'readiness_resolution',
      'stepName', 'Readiness Resolution',
      'stepType', 'verification',
      'sequenceNo', 1,
      'required', true,
      'assignment', jsonb_build_object('type', 'role', 'value', ''),
      'dueDurationHours', 72,
      'decisionRules', jsonb_build_object(
        'canApprove', true, 'canReject', false, 'canReturn', true, 'canDelegate', false,
        'requireAttachment', false, 'requireCommentOnApprove', false,
        'requireCommentOnReturn', true, 'requireCommentOnReject', true)
    )),
    'transitions', '[]'::jsonb,
    'handoffs', '[]'::jsonb,
    'notifications', '[]'::jsonb,
    'sourceStatusMap', '{}'::jsonb,
    'settings', jsonb_build_object(
      'allowReject', false, 'allowReturn', true, 'allowDelegate', false,
      'allowAdminOverride', true, 'requireAuditAllTransitions', true)
  );

  if not exists (select 1 from public.workflow_template_versions
                  where template_id = v_template_id and version_no = 1) then
    insert into public.workflow_template_versions
      (template_id, version_no, version_status, definition, change_summary, published_at)
    values (v_template_id, 1, 'published', v_definition,
            'Initial readiness resolution definition (role-owned).', now());
  else
    update public.workflow_template_versions
       set definition = v_definition, version_status = 'published'
     where template_id = v_template_id and version_no = 1;
  end if;

  -- ── user-owned variant ──
  select id into v_template_id from public.workflow_templates where template_key = 'hr_readiness_review_user';
  if v_template_id is null then
    insert into public.workflow_templates (template_key, name, description, module_key, workflow_type, status, is_active, current_version, definition)
    values ('hr_readiness_review_user', 'Employee Readiness Review (Named Owner)',
            'Resolves a blocking employee readiness control routed to a named owner.',
            'hr_employee_master', 'hr_readiness_review', 'active', true, 1, '{}'::jsonb)
    returning id into v_template_id;
  end if;

  v_definition := jsonb_set(v_definition, '{steps,0,assignment}',
                            jsonb_build_object('type', 'fixed_user', 'value', ''));

  if not exists (select 1 from public.workflow_template_versions
                  where template_id = v_template_id and version_no = 1) then
    insert into public.workflow_template_versions
      (template_id, version_no, version_status, definition, change_summary, published_at)
    values (v_template_id, 1, 'published', v_definition,
            'Initial readiness resolution definition (named owner).', now());
  else
    update public.workflow_template_versions
       set definition = v_definition, version_status = 'published'
     where template_id = v_template_id and version_no = 1;
  end if;
end
$seed$;

-- ── 2. Readiness coverage recalculation ────────────────────────────────────
-- Shared by the lifecycle command and by the read path, so the gauge and the
-- transaction can never disagree about what "ready" means.
--
-- Counts EVERY active blocking control, not just the ones with an instance row:
-- a control the employee has never been evaluated against is NOT ready, and
-- counting only existing instances would report 100% for an employee with no
-- readiness record at all.

create or replace function public.hr_readiness_recalculate(p_employee_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with active_controls as (
    select c.id, c.domain
      from public.hr_readiness_controls c
     where c.is_active and c.is_blocking
  ),
  states as (
    select ac.id, ac.domain,
           coalesce(i.state, 'open') as state
      from active_controls ac
      left join public.hr_readiness_control_instances i
             on i.control_id = ac.id and i.employee_id = p_employee_id
  )
  select jsonb_build_object(
    'totalControls', (select count(*) from states),
    'readyControls', (select count(*) from states where state in ('ready','exception_approved','not_applicable')),
    'percent', case when (select count(*) from states) = 0 then 100
                    else round(100.0 * (select count(*) from states where state in ('ready','exception_approved','not_applicable'))
                                     / (select count(*) from states))::int end,
    'blockedDomains', coalesce((
      select jsonb_agg(distinct domain order by domain)
        from states where state not in ('ready','exception_approved','not_applicable')), '[]'::jsonb),
    'unresolvedWorkItems', (
      select count(*) from public.hr_readiness_work_items w
       where w.employee_id = p_employee_id
         and w.status not in ('ready','exception_approved','not_applicable'))
  );
$$;

revoke all on function public.hr_readiness_recalculate(text) from public, anon, authenticated;
grant execute on function public.hr_readiness_recalculate(text) to service_role;

-- ── 3. The atomic lifecycle command ────────────────────────────────────────

create or replace function public.hr_readiness_work_item_transition_tx(
  p_actor_id            text,
  p_employee_id         text,
  p_control_key         text,
  p_work_item_id        uuid,
  p_action              text,
  p_to_status           text,
  p_owner_type          text,
  p_owner_id            text,
  p_owner_label         text,
  p_recipient_ids       jsonb,
  p_responsible_team    text,
  p_severity            text,
  p_due_date            date,
  p_decision            text,
  p_decision_reason     text,
  p_note                text,
  p_template_version_id uuid,
  p_handoff             jsonb,
  p_correlation_id      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_control      public.hr_readiness_controls%rowtype;
  v_item         public.hr_readiness_work_items%rowtype;
  v_instance_id  uuid;
  v_from_status  text;
  v_percent      int;
  v_coverage     jsonb;
  v_event_id     uuid;
  v_workflow     jsonb;
  v_workflow_id  uuid;
  v_recipient    text;
  v_notify_count int := 0;
  v_handoff_id   uuid;
  v_employee_name text;
  v_satisfied    constant text[] := array['ready','exception_approved','not_applicable'];
begin
  -- ── guards ───────────────────────────────────────────────────────────────
  if p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'actor is required' using errcode = '22023';
  end if;
  if p_correlation_id is null or length(trim(p_correlation_id)) = 0 then
    raise exception 'correlation id is required' using errcode = '22023';
  end if;
  if p_to_status is null or p_to_status not in
     ('open','assigned','waiting_for_information','submitted_for_review','in_review','ready','exception_approved','not_applicable') then
    raise exception 'unknown readiness status %', coalesce(p_to_status, '(null)') using errcode = '22023';
  end if;
  -- Re-assert fail-closed ownership. The resolver already refused an
  -- unconfigured domain; this stops a future caller from losing that guarantee.
  if p_owner_type is null or p_owner_type not in ('role','user') or p_owner_id is null or length(trim(p_owner_id)) = 0 then
    raise exception 'a resolved readiness owner is required' using errcode = '22023';
  end if;

  select * into v_control from public.hr_readiness_controls where control_key = p_control_key and is_active;
  if v_control.id is null then
    raise exception 'readiness control % not found or inactive', coalesce(p_control_key, '(null)') using errcode = 'P0002';
  end if;

  select coalesce(nullif(trim(coalesce(display_name, '')), ''), nullif(trim(coalesce(full_name, '')), ''), username, id)
    into v_employee_name
    from public.app_users where id = p_employee_id;
  if v_employee_name is null then
    raise exception 'employee % not found', coalesce(p_employee_id, '(null)') using errcode = 'P0002';
  end if;

  -- ── 1. control instance ──────────────────────────────────────────────────
  v_percent := case when p_to_status = any(v_satisfied) then 100 else 0 end;

  insert into public.hr_readiness_control_instances (employee_id, control_id, state, percent, evaluated_at)
  values (p_employee_id, v_control.id, p_to_status, v_percent, now())
  on conflict (employee_id, control_id) do update
    set state = excluded.state, percent = excluded.percent, evaluated_at = excluded.evaluated_at
  returning id into v_instance_id;

  -- ── 2. work item + state transition ──────────────────────────────────────
  if p_work_item_id is not null then
    select * into v_item from public.hr_readiness_work_items where id = p_work_item_id for update;
    if v_item.id is null then
      raise exception 'readiness work item not found' using errcode = 'P0002';
    end if;
    if v_item.status = any(v_satisfied) then
      -- State guard: a resolved work item must not be transitioned again, which
      -- would emit a second event/audit implying fresh work.
      raise exception 'readiness work item is already resolved' using errcode = '22023';
    end if;
    v_from_status := v_item.status;

    update public.hr_readiness_work_items
       set status           = p_to_status,
           severity         = coalesce(nullif(p_severity, ''), severity),
           due_date         = coalesce(p_due_date, due_date),
           owner_id         = case when p_owner_type = 'user' then p_owner_id else owner_id end,
           responsible_team = coalesce(nullif(p_responsible_team, ''), responsible_team),
           reviewer_id      = case when p_decision is not null then p_actor_id else reviewer_id end,
           decision         = coalesce(p_decision, decision),
           decision_reason  = coalesce(nullif(p_decision_reason, ''), decision_reason),
           resolved_at      = case when p_to_status = any(v_satisfied) then now() else null end
     where id = p_work_item_id
    returning * into v_item;
  else
    v_from_status := null;
    insert into public.hr_readiness_work_items (
      employee_id, control_id, instance_id, owner_id, responsible_team, status, severity,
      due_date, reviewer_id, decision, decision_reason, correlation_id, created_by,
      resolved_at
    ) values (
      p_employee_id, v_control.id, v_instance_id,
      case when p_owner_type = 'user' then p_owner_id else null end,
      nullif(p_responsible_team, ''), p_to_status, coalesce(nullif(p_severity, ''), 'warning'),
      p_due_date,
      case when p_decision is not null then p_actor_id else null end,
      p_decision, nullif(p_decision_reason, ''), p_correlation_id, p_actor_id,
      case when p_to_status = any(v_satisfied) then now() else null end
    )
    returning * into v_item;
  end if;

  insert into public.hr_readiness_work_item_transitions
    (work_item_id, from_status, to_status, actor_id, note, correlation_id)
  values (v_item.id, v_from_status, p_to_status, p_actor_id, nullif(p_note, ''), p_correlation_id);

  -- ── 3. recalculate readiness ─────────────────────────────────────────────
  v_coverage := public.hr_readiness_recalculate(p_employee_id);

  -- ── 6. workflow task via the CANONICAL engine ────────────────────────────
  -- Done before the event so the emitted payload can carry the workflow id.
  -- Only when work is being routed OUT (not on a terminal resolution) and the
  -- item does not already have a workflow.
  v_workflow_id := v_item.workflow_id;
  if v_workflow_id is null
     and p_template_version_id is not null
     and not (p_to_status = any(v_satisfied)) then
    v_workflow := public.workflow_start_instance_tx(
      p_template_version_id => p_template_version_id,
      p_module_key          => 'hr_employee_master',
      p_workflow_type       => 'hr_readiness_review',
      p_source_record_id    => v_item.id::text,
      p_source_record_ref   => v_control.control_key || ' · ' || v_employee_name,
      p_trigger_event       => 'hr.readiness.work_item.routed',
      p_requested_by        => p_actor_id,
      p_owner_id            => case when p_owner_type = 'user' then p_owner_id else null end,
      p_priority            => case when coalesce(p_severity, 'warning') = 'critical' then 'high' else 'medium' end,
      p_source_snapshot     => jsonb_build_object(
                                 'employeeId', p_employee_id,
                                 'controlKey', v_control.control_key,
                                 'domain', v_control.domain,
                                 'resolutionType', v_control.resolution_type,
                                 'correlationId', p_correlation_id),
      p_assignees           => jsonb_build_object('readiness_resolution',
                                 case when p_owner_type = 'role'
                                      then jsonb_build_object('roleKey', p_owner_id)
                                      else jsonb_build_object('userId', p_owner_id) end),
      -- Derived from CONTENT, so a genuine retry of the same transition dedupes
      -- while a real second transition does not.
      p_request_key         => 'hr-readiness:' || p_correlation_id
    );
    v_workflow_id := nullif(v_workflow->>'workflowId', '')::uuid;
    update public.hr_readiness_work_items set workflow_id = v_workflow_id where id = v_item.id;
  end if;

  -- ── 4. application event ─────────────────────────────────────────────────
  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'hr.employee.readiness.' || p_action, 'hr', 'employee_readiness_work_item', v_item.id::text,
    p_actor_id,
    case when coalesce(p_severity, 'warning') = 'critical' then 'critical' else 'warning' end,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'controlKey', v_control.control_key,
      'domain', v_control.domain,
      'resolutionType', v_control.resolution_type,
      'action', p_action,
      'fromStatus', v_from_status,
      'toStatus', p_to_status,
      'ownerType', p_owner_type,
      'ownerLabel', p_owner_label,
      'decision', p_decision,
      'workflowId', v_workflow_id,
      'coverage', v_coverage,
      'correlationId', p_correlation_id
    ),
    p_correlation_id || ':readiness-' || p_action
  )
  returning id into v_event_id;

  -- ── 5a. canonical platform audit ─────────────────────────────────────────
  -- A SQL-side app_events insert bypasses emitAppEvent(), which is what normally
  -- writes audit_logs — so this command must write it itself.
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values (
    'hr.employee.readiness.' || p_action, 'hr_readiness_work_items', v_item.id::text, p_actor_id,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'controlKey', v_control.control_key,
      'domain', v_control.domain,
      'fromStatus', v_from_status,
      'toStatus', p_to_status,
      'decision', p_decision,
      'decisionReason', nullif(p_decision_reason, ''),
      'ownerType', p_owner_type,
      'ownerId', p_owner_id,
      'workflowId', v_workflow_id,
      'coverage', v_coverage,
      'correlationId', p_correlation_id
    )
  );

  -- ── 5b. HR module audit ──────────────────────────────────────────────────
  insert into public.hr_audit_log (
    employee_id, submodule_key, record_id, actor_id, action, previous_state, new_state, metadata
  ) values (
    p_employee_id, 'readiness', v_item.id::text, p_actor_id,
    'hr.employee.readiness.' || p_action,
    jsonb_build_object('status', v_from_status),
    jsonb_build_object('status', p_to_status, 'controlKey', v_control.control_key,
                       'decision', p_decision, 'ownerLabel', p_owner_label),
    jsonb_build_object('correlationId', p_correlation_id, 'workflowId', v_workflow_id)
  );

  -- ── 7. notify affected participants ──────────────────────────────────────
  -- dedupe_key is derived from the correlation id and the recipient, so a retry
  -- of the same transition cannot double-notify.
  if jsonb_typeof(p_recipient_ids) = 'array' then
    for v_recipient in select jsonb_array_elements_text(p_recipient_ids)
    loop
      if v_recipient is null or length(trim(v_recipient)) = 0 then continue; end if;
      insert into public.notifications (
        user_id, type, title, body, module, severity, source_type, source_id,
        action_route, action_required, event_id, dedupe_key, metadata
      ) values (
        v_recipient,
        'hr.readiness.work_item',
        v_control.label || ' — ' || v_employee_name,
        case
          when p_to_status = any(v_satisfied) then v_control.label || ' is now resolved for ' || v_employee_name || '.'
          when p_action = 'send_reminder' then 'Reminder: ' || v_control.label || ' for ' || v_employee_name || ' is still outstanding.'
          else v_control.label || ' for ' || v_employee_name || ' needs attention.'
        end,
        'hr', case when coalesce(p_severity, 'warning') = 'critical' then 'critical' else 'warning' end,
        'employee_readiness_work_item', v_item.id::text,
        '/hr/employees/' || p_employee_id || '?tab=readiness',
        not (p_to_status = any(v_satisfied)),
        v_event_id,
        p_correlation_id || ':' || v_recipient,
        jsonb_build_object('controlKey', v_control.control_key, 'domain', v_control.domain,
                           'workItemId', v_item.id, 'correlationId', p_correlation_id)
      )
      on conflict do nothing;
      v_notify_count := v_notify_count + 1;
    end loop;
  end if;

  -- ── 8. handoff when another module owns the work ─────────────────────────
  if p_handoff is not null and jsonb_typeof(p_handoff) = 'object'
     and coalesce(p_handoff->>'targetModule', '') <> '' then
    insert into public.handoff_outbox (
      source_module, target_module, source_entity_type, source_entity_id,
      target_entity_type, payload, status, created_by
    ) values (
      'hr', p_handoff->>'targetModule', 'employee_readiness_work_item', v_item.id::text,
      nullif(p_handoff->>'targetEntityType', ''),
      jsonb_build_object(
        'employeeId', p_employee_id,
        'employeeName', v_employee_name,
        'controlKey', v_control.control_key,
        'domain', v_control.domain,
        'resolutionType', v_control.resolution_type,
        'workItemId', v_item.id,
        'status', p_to_status,
        'dueDate', p_due_date,
        'ownerType', p_owner_type,
        'ownerId', p_owner_id,
        'correlationId', p_correlation_id
      ) || coalesce(p_handoff->'payload', '{}'::jsonb),
      'pending', p_actor_id
    )
    returning id into v_handoff_id;
  end if;

  return jsonb_build_object(
    'workItemId',    v_item.id,
    'instanceId',    v_instance_id,
    'employeeId',    p_employee_id,
    'controlKey',    v_control.control_key,
    'domain',        v_control.domain,
    'fromStatus',    v_from_status,
    'status',        p_to_status,
    'workflowId',    v_workflow_id,
    'eventId',       v_event_id,
    'handoffId',     v_handoff_id,
    'notified',      v_notify_count,
    'coverage',      v_coverage,
    'correlationId', p_correlation_id
  );
end;
$$;

-- ── 4. Lock the function down ──────────────────────────────────────────────
-- SECURITY DEFINER must never be reachable by anon/authenticated. If these
-- REVOKEs are missing after an apply, the paste was truncated.
revoke all on function public.hr_readiness_work_item_transition_tx(
  text, text, text, uuid, text, text, text, text, text, jsonb, text, text, date, text, text, text, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.hr_readiness_work_item_transition_tx(
  text, text, text, uuid, text, text, text, text, text, jsonb, text, text, date, text, text, text, uuid, jsonb, text
) to service_role;

notify pgrst, 'reload schema';
