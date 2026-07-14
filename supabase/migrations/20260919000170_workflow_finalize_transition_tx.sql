-- ============================================================================
-- Central Workflow Engine — fenced finalize + outbox complete/fail (finding #2)
-- Design: DECIDE_TX_DESIGN.md. Depends on 150 (schema) + 160 (decide/claim).
-- Operator-applied; idempotent. After applying: NOTIFY pgrst, 'reload schema';
--
-- These run AFTER the worker has done the TS-only side-effects (resolveNext /
-- assignee resolution for advance; the module source-transition RPC for terminal,
-- which wrote a workflow_source_receipts row). They commit the workflow-owned
-- writes atomically and are FENCED by the outbox lease_token so a reclaimed-then-
-- resumed worker can never clobber a newer worker's outcome.
--
-- workflow_finalize_transition_tx — advance (insert next tasks + set current step)
--   OR terminal (set completed/returned/rejected), clear the active_transition_id
--   gate, write the terminal audit + app_event + handoff-outbox intent, mark the
--   transition completed. Idempotent: re-entry on an already-completed transition
--   returns the stored event id without rewriting.
-- workflow_outbox_complete / workflow_outbox_fail — fenced queue transitions; fail
--   applies capped exponential backoff and dead-letters at max_attempts (leaving
--   the instance GATED for admin recovery — never auto-cleared).
-- ============================================================================

create or replace function public.workflow_finalize_transition_tx(
  p_transition_id uuid,
  p_lease_token   uuid,
  p_final_status  text,          -- in_progress (advance) | completed | returned | rejected
  p_next_step_key text  default null,
  p_new_tasks     jsonb default '[]'::jsonb,
  p_action        text  default 'workflow.completed',
  p_event_payload jsonb default '{}'::jsonb,
  p_handoffs      jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tr       public.workflow_transitions%rowtype;
  v_inst     public.workflow_instances%rowtype;
  v_ob       public.workflow_outbox%rowtype;
  v_event_id uuid;
  v_now      timestamptz := now();
  h          jsonb;
begin
  if p_final_status not in ('in_progress','completed','returned','rejected') then
    raise exception 'workflow_finalize: invalid final status %', p_final_status using errcode = 'WF400';
  end if;

  -- Read the transition (unlocked) to get the workflow id, then lock instance-first.
  select * into v_tr from public.workflow_transitions where id = p_transition_id;
  if not found then
    raise exception 'workflow_finalize: transition % not found', p_transition_id using errcode = 'WF404';
  end if;

  select * into v_inst from public.workflow_instances where id = v_tr.workflow_id for update;
  select * into v_tr   from public.workflow_transitions where id = p_transition_id for update;
  select * into v_ob   from public.workflow_outbox where transition_id = p_transition_id for update;

  -- Idempotent re-entry: transition already finalized → return the stored event id,
  -- no rewrite, no fence needed (this path performs no writes).
  if v_tr.status = 'completed' then
    return jsonb_build_object('eventId', v_tr.result->>'finalEventId', 'alreadyFinal', true);
  end if;

  -- Fence: only the worker holding the CURRENT lease may finalize a pending job.
  if v_ob.id is null or v_ob.status <> 'processing' or v_ob.lease_token is distinct from p_lease_token then
    raise exception 'workflow_finalize: stale or missing lease for transition %', p_transition_id using errcode = 'WF409';
  end if;

  if p_final_status = 'in_progress' then
    -- Advance: insert the resolved next-step tasks + move the current step pointer.
    insert into public.workflow_tasks
      (workflow_id, step_key, step_name, step_type, task_title, assigned_to, assigned_role,
       status, due_at, is_required, metadata)
    select v_tr.workflow_id, t.step_key, t.step_name, t.step_type,
           coalesce(t.task_title, t.step_name), t.assigned_to, t.assigned_role,
           'pending', t.due_at, coalesce(t.is_required, true), coalesce(t.metadata, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_new_tasks, '[]'::jsonb)) as t(
           step_key text, step_name text, step_type text, task_title text,
           assigned_to text, assigned_role text, due_at timestamptz, is_required boolean, metadata jsonb);

    update public.workflow_instances
       set current_step_key = p_next_step_key, status = 'in_progress', active_transition_id = null
     where id = v_tr.workflow_id;
  else
    -- Terminal: completed / returned / rejected.
    update public.workflow_instances
       set status = p_final_status,
           active_transition_id = null,
           completed_at = case when p_final_status in ('completed','rejected') then v_now else completed_at end,
           closed_at    = case when p_final_status in ('completed','rejected') then v_now else closed_at end
     where id = v_tr.workflow_id;
  end if;

  -- Terminal/advance audit + event (durable INTENT — not best-effort).
  insert into public.workflow_audit_log
    (workflow_id, module_key, source_record_id, actor_id, action, new_state, metadata)
  values
    (v_tr.workflow_id, v_inst.module_key, v_inst.source_record_id, v_tr.actor_id, p_action,
     jsonb_build_object('status', p_final_status), coalesce(p_event_payload, '{}'::jsonb));

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
     site_id, department_id, severity, payload, dedupe_key)
  values
    (p_action, 'workflow', 'workflow', coalesce(v_inst.workflow_no, v_tr.workflow_id::text), v_tr.actor_id,
     nullif(v_inst.site_id, ''), nullif(v_inst.department_id, ''),
     case when p_final_status = 'completed' then 'success'
          when p_final_status = 'rejected' then 'warning'
          when p_final_status = 'returned' then 'warning' else 'info' end,
     coalesce(p_event_payload, '{}'::jsonb) || jsonb_build_object('workflowId', v_tr.workflow_id, 'finalStatus', p_final_status),
     'wf.' || p_action || ':' || v_tr.workflow_id::text || ':' || p_transition_id::text)
  returning id into v_event_id;

  -- Durable cross-module handoff intent (delivery is async via the handoff bus).
  for h in select value from jsonb_array_elements(coalesce(p_handoffs, '[]'::jsonb)) loop
    insert into public.handoff_outbox
      (source_module, target_module, source_entity_type, source_entity_id, target_entity_type, payload, status, created_by)
    values
      (v_inst.module_key, h->>'target_module', coalesce(v_inst.workflow_type, 'workflow'),
       v_inst.source_record_id, null, coalesce(h->'payload', '{}'::jsonb), 'pending', v_tr.actor_id);
    insert into public.workflow_handoffs
      (workflow_id, from_module, to_module, source_record_id, trigger_event, action_key, status, payload, mapped_fields)
    values
      (v_tr.workflow_id, v_inst.module_key, h->>'target_module', v_inst.source_record_id,
       p_action, h->>'action', 'pending', coalesce(h->'payload', '{}'::jsonb), coalesce(h->'fieldMap', '{}'::jsonb));
  end loop;

  update public.workflow_transitions
     set status = 'completed', completed_at = v_now,
         result = coalesce(result, '{}'::jsonb) || jsonb_build_object('finalEventId', v_event_id, 'finalStatus', p_final_status)
   where id = p_transition_id;

  return jsonb_build_object('eventId', v_event_id, 'alreadyFinal', false);
end
$fn$;

-- ── workflow_outbox_complete — fenced: mark the delivery done (worker calls AFTER
--    notification delivery, so a notify failure retries instead of being lost) ──
create or replace function public.workflow_outbox_complete(
  p_transition_id uuid,
  p_lease_token   uuid
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_rows int;
begin
  update public.workflow_outbox
     set status = 'completed', processed_at = now()
   where transition_id = p_transition_id and lease_token = p_lease_token and status = 'processing';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'workflow_outbox_complete: stale or missing lease for transition %', p_transition_id using errcode = 'WF409';
  end if;
end
$fn$;

-- ── workflow_outbox_fail — fenced: capped exponential backoff, dead-letter at
--    max_attempts (instance stays GATED for admin recovery) ────────────────────
create or replace function public.workflow_outbox_fail(
  p_transition_id uuid,
  p_lease_token   uuid,
  p_error         text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ob      public.workflow_outbox%rowtype;
  v_dead    boolean := false;
  v_backoff interval;
begin
  select * into v_ob from public.workflow_outbox where transition_id = p_transition_id for update;
  if v_ob.id is null or v_ob.lease_token is distinct from p_lease_token or v_ob.status <> 'processing' then
    -- Stale worker (reclaimed) — ignore; the current lease-holder owns the outcome.
    raise exception 'workflow_outbox_fail: stale or missing lease for transition %', p_transition_id using errcode = 'WF409';
  end if;

  if v_ob.attempts >= v_ob.max_attempts then
    v_dead := true;
    update public.workflow_outbox
       set status = 'dead_letter', last_error = left(coalesce(p_error, ''), 2000), processed_at = now()
     where id = v_ob.id;
    update public.workflow_transitions set status = 'dead_letter' where id = p_transition_id;
    -- active_transition_id is intentionally NOT cleared: the instance stays gated
    -- until an admin replays or resolves the dead-lettered transition.
  else
    v_backoff := least(interval '1 minute' * power(2, v_ob.attempts), interval '1 hour');
    update public.workflow_outbox
       set status = 'pending', last_error = left(coalesce(p_error, ''), 2000),
           lease_token = null, lease_expires_at = null, next_attempt_at = now() + v_backoff
     where id = v_ob.id;
  end if;

  return jsonb_build_object('deadLetter', v_dead, 'attempts', v_ob.attempts, 'maxAttempts', v_ob.max_attempts);
end
$fn$;

revoke all    on function public.workflow_finalize_transition_tx(uuid, uuid, text, text, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.workflow_finalize_transition_tx(uuid, uuid, text, text, jsonb, text, jsonb, jsonb) to service_role;
revoke all    on function public.workflow_outbox_complete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workflow_outbox_complete(uuid, uuid) to service_role;
revoke all    on function public.workflow_outbox_fail(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.workflow_outbox_fail(uuid, uuid, text) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
