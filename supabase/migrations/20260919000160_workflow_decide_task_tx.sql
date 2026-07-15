-- ============================================================================
-- Central Workflow Engine — atomic decision commit + fenced outbox claim
-- (enterprise-hardening finding #2). Design: DECIDE_TX_DESIGN.md.
-- Depends on 20260919000150 (transitions/outbox/receipts schema).
-- Operator-applied; idempotent (create or replace). After applying:
--   NOTIFY pgrst, 'reload schema';
--
-- workflow_decide_task_tx  — ONE atomic transaction: lock instance→task, resolve
--   authorization from canonical tables (NEVER trust the caller), re-validate the
--   decision requirements against the immutable template snapshot, record the
--   decision + audit + event, and enqueue exactly one transition (with a delivery
--   outbox job for advance/terminal). Semantic idempotency via input_hash: an
--   identical retry returns the original result; a different payload for a decided
--   task is a 409.
-- workflow_outbox_claim    — race-free claim (FOR UPDATE SKIP LOCKED) that stamps
--   a fencing lease_token + 5-min lease; the worker must present that token to
--   finalize/fail (see 20260919000170).
--
-- Custom SQLSTATEs → HTTP (mapped in TS): WF404 not-found(404) · WF403 not-
-- assigned(403) · WF409 conflict/already-decided(409) · WF400 requirement(400) ·
-- WF422 override-reason/SoD(422).
-- ============================================================================

create or replace function public.workflow_decide_task_tx(
  p_workflow_id     uuid,
  p_task_id         uuid,
  p_actor_id        text,
  p_decision        text,
  p_comment         text  default null,
  p_attachment_ids  jsonb default '[]'::jsonb,
  p_override_reason text  default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_inst          public.workflow_instances%rowtype;
  v_task          public.workflow_tasks%rowtype;
  v_role          text;
  v_is_elevated   boolean;
  v_is_assigned   boolean;
  v_is_override   boolean := false;
  v_snapshot      jsonb;
  v_step          jsonb;
  v_rules         jsonb;
  v_input_hash    text;
  v_existing      public.workflow_transitions%rowtype;
  v_kind          text;
  v_open_siblings int;
  v_transition_id uuid;
  v_event_id      uuid;
  v_now           timestamptz := now();
  v_result        jsonb;
begin
  if p_decision not in ('approved','returned','rejected') then
    raise exception 'workflow_decide: invalid decision %', p_decision using errcode = 'WF400';
  end if;

  -- 1. Lock the instance FIRST (serializes every command on this workflow).
  select * into v_inst from public.workflow_instances where id = p_workflow_id for update;
  if not found then
    raise exception 'workflow_decide: workflow % not found', p_workflow_id using errcode = 'WF404';
  end if;

  -- 2. Lock the task.
  select * into v_task from public.workflow_tasks where id = p_task_id for update;
  if not found then
    raise exception 'workflow_decide: task % not found', p_task_id using errcode = 'WF404';
  end if;
  if v_task.workflow_id <> p_workflow_id then
    raise exception 'workflow_decide: task % is not part of workflow %', p_task_id, p_workflow_id using errcode = 'WF409';
  end if;

  -- 3. Authorization resolved from canonical tables — never from the caller.
  select role into v_role from public.app_users where id = p_actor_id;
  if v_role is null then
    raise exception 'workflow_decide: actor % not found', p_actor_id using errcode = 'WF404';
  end if;
  -- Elevation = `workflow.instances.admin_override` ONLY (+ superadmin). `reassign`
  -- is a ROUTING power (managers/admins hold it to move a task to the right person)
  -- and MUST NOT grant authority to DECIDE a task you are not assigned — treating it
  -- as elevation is horizontal privilege escalation across payroll/HR/finance approvals
  -- (any manager could approve any pending workflow). Only admin_override bypasses the
  -- assignment check, and only with a mandatory reason (enforced in step 5).
  v_is_elevated := (v_role = 'superadmin')
    or coalesce(
         (select granted from public.user_permissions where user_id = p_actor_id and permission = 'workflow.instances.admin_override'),
         exists (select 1 from public.role_permissions where role_name = v_role and permission = 'workflow.instances.admin_override'));
  -- coalesce(...,false): a role-assigned task has assigned_to = NULL, and
  -- `NULL = actor` is NULL (not false) in three-valued logic — which would make the
  -- authorization IF fall through and admit an unassigned actor. Force it to false.
  v_is_assigned := coalesce(v_task.assigned_to = p_actor_id, false)
    or (v_task.assigned_role is not null and v_task.assigned_role = v_role);

  -- 3b. Idempotency: a decided task already has exactly one transition. Same
  -- input_hash ⇒ this is a retry of a lost response → return the stored result.
  -- Different payload ⇒ the task was already decided (by anyone) → 409.
  v_input_hash := md5(
    coalesce(p_workflow_id::text,'') || '|' || coalesce(p_task_id::text,'') || '|' ||
    coalesce(p_actor_id,'') || '|' || coalesce(p_decision,'') || '|' ||
    coalesce(p_comment,'') || '|' || coalesce(p_attachment_ids::text,'[]') || '|' ||
    coalesce(p_override_reason,''));
  select * into v_existing from public.workflow_transitions where task_id = p_task_id;
  if found then
    if v_existing.input_hash = v_input_hash then
      return coalesce(v_existing.result,
        jsonb_build_object('outcome','duplicate','transitionId',v_existing.id,'transitionKind',v_existing.kind));
    end if;
    raise exception 'workflow_decide: task % has already been decided', p_task_id using errcode = 'WF409';
  end if;

  -- 4. State guards (under lock).
  if v_task.status not in ('pending','open','in_progress') then
    raise exception 'workflow_decide: task % is already %', p_task_id, v_task.status using errcode = 'WF409';
  end if;
  if v_inst.status <> 'in_progress' then
    raise exception 'workflow_decide: workflow % is % (not in_progress)', p_workflow_id, v_inst.status using errcode = 'WF409';
  end if;
  if v_inst.active_transition_id is not null then
    raise exception 'workflow_decide: workflow % is mid-transition', p_workflow_id using errcode = 'WF409';
  end if;

  -- 5. Authorization decision + override rules.
  if not (v_is_assigned or v_is_elevated) then
    raise exception 'workflow_decide: this task is not assigned to you' using errcode = 'WF403';
  end if;
  -- An elevated (admin_override) actor deciding a task not assigned to them is an
  -- OVERRIDE — it demands a written justification (segregation-of-duties audit trail)
  -- and is flagged distinctly in the decision + audit metadata below. Now that
  -- elevation is admin_override-only (no longer the broadly-held `reassign`), a
  -- mandatory reason cannot break ordinary assigned-decide flows — only genuine
  -- superadmin/admin_override overrides must supply one.
  if (not v_is_assigned) and v_is_elevated then
    v_is_override := true;
    if p_override_reason is null or btrim(p_override_reason) = '' then
      raise exception 'workflow_decide: an override reason is required to decide a task that is not assigned to you'
        using errcode = 'WF422';
    end if;
  end if;

  -- 6. Decision-requirement re-validation vs the immutable template snapshot.
  --    (Attachment EXISTENCE/ownership is a documented follow-up — attachments are
  --     per-module with no canonical workflow-attachment table; here we enforce the
  --     requireAttachment count gate, which today has no server enforcement at all.)
  v_snapshot := coalesce(v_inst.template_snapshot, '{}'::jsonb);
  select value into v_step
    from jsonb_array_elements(coalesce(v_snapshot->'steps', '[]'::jsonb))
    where value->>'stepKey' = v_task.step_key
    limit 1;
  if v_step is null then
    raise exception 'workflow_decide: step % not in template snapshot', v_task.step_key using errcode = 'WF409';
  end if;
  v_rules := coalesce(v_step->'decisionRules', '{}'::jsonb);
  if p_decision = 'approved' and coalesce((v_rules->>'requireCommentOnApprove')::boolean, false)
     and (p_comment is null or length(trim(p_comment)) = 0) then
    raise exception 'workflow_decide: a comment is required to approve this task' using errcode = 'WF400';
  end if;
  if p_decision = 'returned' and coalesce((v_rules->>'requireCommentOnReturn')::boolean, false)
     and (p_comment is null or length(trim(p_comment)) = 0) then
    raise exception 'workflow_decide: a comment is required to return this task' using errcode = 'WF400';
  end if;
  if p_decision = 'rejected' and coalesce((v_rules->>'requireCommentOnReject')::boolean, false)
     and (p_comment is null or length(trim(p_comment)) = 0) then
    raise exception 'workflow_decide: a comment is required to reject this task' using errcode = 'WF400';
  end if;
  if coalesce((v_rules->>'requireAttachment')::boolean, false)
     and jsonb_array_length(coalesce(p_attachment_ids, '[]'::jsonb)) = 0 then
    raise exception 'workflow_decide: an attachment is required for this decision' using errcode = 'WF400';
  end if;

  -- 7. Record the decision + audit + event atomically.
  update public.workflow_tasks
     set status = p_decision, decision = p_decision, decision_comment = p_comment,
         completed_by = p_actor_id, completed_at = v_now, decided_at = v_now
   where id = p_task_id;

  insert into public.workflow_decisions
    (workflow_id, task_id, actor_id, decision, comment, attachment_ids, previous_status, new_status, metadata)
  values
    (p_workflow_id, p_task_id, p_actor_id, p_decision, p_comment, coalesce(p_attachment_ids, '[]'::jsonb),
     v_task.status, p_decision,
     case when v_is_override then jsonb_build_object('override', true, 'overrideReason', p_override_reason) else '{}'::jsonb end);

  insert into public.workflow_audit_log
    (workflow_id, task_id, module_key, source_record_id, actor_id, action, previous_state, new_state, reason, metadata)
  values
    (p_workflow_id, p_task_id, v_inst.module_key, v_inst.source_record_id, p_actor_id, 'workflow.task.' || p_decision,
     jsonb_build_object('status', v_task.status), jsonb_build_object('status', p_decision), p_comment,
     case when v_is_override then jsonb_build_object('override', true, 'overrideReason', p_override_reason) else '{}'::jsonb end);

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
     site_id, department_id, severity, payload, dedupe_key)
  values
    ('workflow.task.' || p_decision, v_inst.module_key, coalesce(v_inst.workflow_type, 'workflow'),
     coalesce(v_inst.workflow_no, p_workflow_id::text), p_actor_id,
     nullif(v_inst.site_id, ''), nullif(v_inst.department_id, ''),
     case when p_decision = 'approved' then 'success' else 'info' end,
     jsonb_build_object('taskId', p_task_id, 'workflowId', p_workflow_id, 'decision', p_decision, 'stepKey', v_task.step_key),
     'wf.task.' || p_decision || ':' || p_task_id::text)
  returning id into v_event_id;

  -- 8. Resolve the transition kind.
  if p_decision = 'approved' then
    select count(*) into v_open_siblings from public.workflow_tasks
      where workflow_id = p_workflow_id and step_key = v_task.step_key
        and id <> p_task_id and status in ('pending','open','in_progress');
    v_kind := case when v_open_siblings > 0 then 'record_only' else 'resolve_approved_step' end;
  elsif p_decision = 'returned' then
    v_kind := 'finalize_returned';
  else
    v_kind := 'finalize_rejected';
  end if;

  -- Terminal decisions atomically close every other open task in the workflow.
  if v_kind in ('finalize_returned','finalize_rejected') then
    update public.workflow_tasks set status = 'cancelled'
      where workflow_id = p_workflow_id and id <> p_task_id
        and status in ('pending','open','in_progress');
  end if;

  insert into public.workflow_transitions
    (workflow_id, task_id, kind, decision, actor_id, input_hash, status)
  values
    (p_workflow_id, p_task_id, v_kind, p_decision, p_actor_id, v_input_hash,
     case when v_kind = 'record_only' then 'completed' else 'pending' end)
  returning id into v_transition_id;

  -- Delivery-bearing transitions gate the instance + enqueue an outbox job.
  if v_kind <> 'record_only' then
    update public.workflow_instances set active_transition_id = v_transition_id where id = p_workflow_id;
    insert into public.workflow_outbox (transition_id) values (v_transition_id);
  end if;

  v_result := jsonb_build_object(
    'outcome', case when v_kind = 'record_only' then 'recorded_step_open' else 'transition_enqueued' end,
    'transitionId', v_transition_id, 'transitionKind', v_kind,
    'decisionEventId', v_event_id, 'isOverride', v_is_override, 'workflowStatus', v_inst.status);

  update public.workflow_transitions
     set result = v_result, completed_at = case when v_kind = 'record_only' then v_now else null end
   where id = v_transition_id;

  return v_result;
end
$fn$;

-- ── workflow_outbox_claim — race-free fenced claim ────────────────────────────
-- Claims pending jobs whose backoff has elapsed AND stale 'processing' jobs whose
-- lease has expired (crash recovery), stamping a fresh fencing lease_token. Every
-- subsequent write by the worker must present that token (see finalize/fail).
-- p_transition_id: when non-null, claim ONLY that transition's job — the in-request
-- happy path targets its OWN transition so a busy global queue can't starve it;
-- when null, batch-claim the oldest due jobs (the scheduled recovery worker).
drop function if exists public.workflow_outbox_claim(text, int);
create or replace function public.workflow_outbox_claim(
  p_worker_id     text,
  p_limit         int  default 10,
  p_transition_id uuid default null
) returns setof public.workflow_outbox
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  update public.workflow_outbox o
     set status = 'processing',
         locked_by = p_worker_id,
         lease_token = gen_random_uuid(),
         lease_expires_at = now() + interval '5 minutes',
         attempts = o.attempts + 1
   where o.id in (
     select c.id from public.workflow_outbox c
      where ((c.status = 'pending' and c.next_attempt_at <= now())
          or (c.status = 'processing' and c.lease_expires_at < now()))
        and (p_transition_id is null or c.transition_id = p_transition_id)
      order by c.created_at
      for update skip locked
      limit p_limit
   )
  returning o.*;
end
$fn$;

revoke all    on function public.workflow_decide_task_tx(uuid, uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.workflow_decide_task_tx(uuid, uuid, text, text, text, jsonb, text) to service_role;
revoke all    on function public.workflow_outbox_claim(text, int, uuid) from public, anon, authenticated;
grant execute on function public.workflow_outbox_claim(text, int, uuid) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
