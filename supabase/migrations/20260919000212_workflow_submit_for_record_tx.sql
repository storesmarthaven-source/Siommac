-- ============================================================================
-- Atomic Workflow Creation — Shape-A submit wrapper + assignee resolver (mig 3/N)
-- (audit finding #3). Build plan: netlify/functions/lib/workflow/SUBMIT_TX_BUILD.md
--   (step 3 — first vertical slice: the payroll-run submit).
-- Depends on 20260919000210 (schema) + 20260919000211 (_create_instance / _claim_request
--   / _record_request) which MUST be applied first.
-- Operator-applied; idempotent (create or replace). After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- This lands the FIRST public entry point + its resolver, proving the Shape-A
-- pattern end-to-end (the payroll-run strand fix). Later commits add the remaining
-- Shape-A branches (A2–A13) to the same CASE, and the Shape-B/C create-and-start RPCs.
--
--   wf_internal._resolve_and_validate_assignee(assignment, source_ctx, owner)
--       — turns a step's assignment rule into a resolved {userId}|{roleKey}, reading
--         dynamic types from the LOCKED source context (mirrors assigneeResolver.ts).
--         Raises WF422 if it resolves to nothing. The authoritative active-user /
--         known-role gate lives in _create_instance (single authority) — this is the
--         wrapper-side resolver that BUILDS the p_assignees map the primitive expects.
--         Payroll only exercises the static `role` branch; the dynamic branches are
--         here (faithful to the TS resolver) for the HR/HSE slices that use them.
--
--   public.workflow_submit_for_record_tx(source_table, source_id, actor, binding,
--                                        request_key, business)
--       — Shape A: lock the EXISTING source row, validate its legal from→status,
--         then create the workflow + transition the source IN ONE COMMIT. This is the
--         finding-#3 fix: today submitRun flips status→pending_approval, THEN starts
--         the workflow (accept-null strand F1), THEN stamps workflow_id unchecked (F2),
--         with a crash window between (F3). Here status + workflow_id + the whole
--         workflow are one atomic unit; a null/failed workflow rolls the source back.
--
-- SIDE-EFFECT OWNERSHIP (design §4): the primitive (_create_instance) owns the
-- workflow instance + tasks + workflow_audit_log + workflow.started/task.assigned
-- app_events. THIS wrapper owns, in the SAME txn: the source status+workflow_id
-- update, the business <module>.submitted app_event, the module audit (hr_audit_log),
-- and the handoff intent (handoff_outbox). Notification DELIVERY (finance-manager
-- "awaiting approval" + the task assignee) stays best-effort POST-commit in the TS
-- caller (deliverEventNotifications, reading the returned firstTasks) — delivery-only,
-- so it does NOT re-emit the app_events written here.
--
-- Idempotency: the TS caller supplies a stable request_key (retries reuse it); the
-- RPC computes request_hash server-side over the behaviorally-relevant inputs. A
-- retry with the same key+hash returns the stored result; a different hash is WF409.
--
-- Custom SQLSTATEs → HTTP: WF404 not-found · WF409 conflict · WF422 invalid · WF400 bad-request.
-- ============================================================================

-- ── wf_internal._resolve_and_validate_assignee ────────────────────────────────
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

  -- Mirrors netlify/functions/lib/workflow/assigneeResolver.ts resolveStepAssignee.
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
      -- The TS resolver's getPathValue traverses the FULL ModuleWorkflowContext (not
      -- just recordData), so a faithful port needs the wrapper to pass the whole
      -- context. No current slice uses dynamic_field — raise until one does, rather than
      -- ship a path resolution that silently differs from the engine.
      raise exception '_resolve_and_validate_assignee: dynamic_field assignment is not yet supported in SQL' using errcode = 'WF422';
    else
      raise exception '_resolve_and_validate_assignee: unknown assignment type %', v_type using errcode = 'WF422';
  end case;

  if v_user is null and v_role is null then
    raise exception '_resolve_and_validate_assignee: assignment type % did not resolve to a user or role', v_type using errcode = 'WF422';
  end if;

  -- Emit exactly one key (userId XOR roleKey) — _create_instance enforces the same and
  -- performs the authoritative active-user / known-role validation.
  return jsonb_strip_nulls(jsonb_build_object('userId', v_user, 'roleKey', v_role));
end
$fn$;

-- ── public.workflow_submit_for_record_tx ──────────────────────────────────────
create or replace function public.workflow_submit_for_record_tx(
  p_source_table text,
  p_source_id    text,
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
  v_run           public.finance_payroll_runs%rowtype;
  v_prior_module  text;
  v_prior_source  text;
  v_module_key    text;
  v_workflow_type text;
  v_trigger       text;
  v_from_status   text;
  v_to_status     text;
  v_owner         text;
  v_ref           text;
  v_period_month  text;
  v_source_ctx    jsonb;
  v_binding       public.module_workflow_bindings%rowtype;
  v_ver           public.workflow_template_versions%rowtype;
  v_min_seq       numeric;
  v_step          jsonb;
  v_assignees     jsonb := '{}'::jsonb;
  v_prior_wf      uuid;
  v_prior_status  text;
  v_supersedes    uuid;
  v_res           jsonb;
  v_wf_id         uuid;
  v_result        jsonb;
  c_terminal      constant text[] := array['completed','approved','returned','rejected','cancelled','closed'];
begin
  p_business := coalesce(p_business, '{}'::jsonb);
  if jsonb_typeof(p_business) <> 'object' then
    raise exception 'workflow_submit: business payload must be a JSON object' using errcode = 'WF400';
  end if;

  -- A retried business mutation MUST carry a stable idempotency key (unlike an explicit
  -- start). The receipt key is SCOPED by actor + operation + source table so two actors
  -- (or two operations) reusing the same client key never collide on the global ledger.
  if p_request_key is null or btrim(p_request_key) = '' then
    raise exception 'workflow_submit: request_key is required' using errcode = 'WF400';
  end if;
  v_receipt_key := coalesce(p_actor_id, '') || '|submit|' || coalesce(p_source_table, '') || '|' || p_request_key;

  -- Server-computed hash over a CANONICAL jsonb of the behaviorally-relevant inputs
  -- (never trust a caller hash; jsonb text is key-sorted so the hash is retry-stable).
  v_hash := md5((jsonb_build_object(
              'table', p_source_table, 'source', p_source_id, 'actor', p_actor_id,
              'binding', p_binding_id, 'business', p_business))::text);

  -- 1. Idempotency claim (advisory xact lock held to commit; a racing duplicate blocks
  --    then sees the receipt).
  v_claim := wf_internal._claim_request(v_receipt_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return coalesce(nullif(v_claim->'result', 'null'::jsonb),
                    jsonb_build_object('workflowId', v_claim->>'workflowId', 'duplicate', true));
  end if;

  -- 2. Static per-source-table branch: lock the source row, validate the legal
  --    from→status, and derive the instance fields from the LOCKED row. (Later
  --    commits add A2–A13 branches here.)
  if p_source_table = 'finance_payroll_runs' then
    -- Guard the uuid cast (a bad id would otherwise raise a raw 22P02/500 on direct
    -- service-role misuse — the route's Zod gate normally prevents it).
    if p_source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_run from public.finance_payroll_runs where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: payroll run % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_run.status not in ('calculated', 'returned') then
      raise exception 'workflow_submit: run % is % (only calculated/returned can be submitted)', p_source_id, v_run.status using errcode = 'WF409';
    end if;
    v_module_key    := 'finance_payroll';
    v_workflow_type := 'finance_payroll_approval';
    v_trigger       := 'finance.payroll.run.submitted';
    v_from_status   := v_run.status;
    v_to_status     := 'pending_approval';
    v_owner         := v_run.created_by;
    v_ref           := v_run.run_no;
    v_period_month  := v_run.period_month::text;
    v_prior_wf      := v_run.workflow_id;
    v_source_ctx    := p_business || jsonb_build_object(
                         'runNo', v_run.run_no, 'periodMonth', v_period_month,
                         'sourceType', 'payroll_run', 'submittedBy', p_actor_id);
  else
    raise exception 'workflow_submit: unsupported source table %', p_source_table using errcode = 'WF400';
  end if;

  -- 3. Supersede check: a resubmit is allowed only if the prior workflow is terminal AND
  --    actually belongs to THIS record (a dangling/corrupted workflow_id must never be
  --    recorded as the new instance's predecessor).
  if v_prior_wf is not null then
    select status, module_key, source_record_id
      into v_prior_status, v_prior_module, v_prior_source
      from public.workflow_instances where id = v_prior_wf;
    if v_prior_status is null then
      v_supersedes := null;                 -- dangling reference (row gone) → no predecessor
    else
      if v_prior_module is distinct from v_module_key or v_prior_source is distinct from p_source_id then
        raise exception 'workflow_submit: stored workflow % for record % belongs to a different record', v_prior_wf, p_source_id using errcode = 'WF409';
      end if;
      if not (v_prior_status = any (c_terminal)) then
        raise exception 'workflow_submit: record % already has an active workflow (%)', p_source_id, v_prior_status using errcode = 'WF409';
      end if;
      v_supersedes := v_prior_wf;
    end if;
  end if;

  -- 4. Resolve the first-step assignees from the binding's published version + the
  --    locked source context. SHARE-lock the bindings table so this read and the
  --    _create_instance re-read below see the same snapshot (it re-locks re-entrantly).
  lock table public.module_workflow_bindings in share mode;
  select * into v_binding from public.module_workflow_bindings where id = p_binding_id;
  if not found then
    raise exception 'workflow_submit: binding % not found', p_binding_id using errcode = 'WF404';
  end if;
  -- FOR SHARE on the version row: an admin re-publish (UPDATE of the definition) takes a
  -- conflicting row lock, so the definition we resolve assignees from here CANNOT change
  -- before _create_instance re-reads it — closing the assignee/version TOCTOU. (A brand-
  -- new published version for an unpinned binding is the deferred version-immutability
  -- item; the payroll binding is pinned, so this fully closes it.)
  if v_binding.template_version_id is not null then
    select * into v_ver from public.workflow_template_versions where id = v_binding.template_version_id for share;
  else
    select * into v_ver from public.workflow_template_versions
      where template_id = v_binding.template_id and version_status = 'published'
      order by version_no desc limit 1 for share;
  end if;
  if v_ver.id is null then
    raise exception 'workflow_submit: binding % has no published version', p_binding_id using errcode = 'WF422';
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

  -- 5. Atomic creation (primitive owns wf + tasks + wf audit + wf events; it re-loads
  --    and re-validates the binding/version under lock — single authority).
  v_res := wf_internal._create_instance(
    p_binding_id, null, null, v_module_key, v_workflow_type, p_source_id, v_ref,
    v_trigger, p_actor_id, v_owner, null, null, 'medium',
    v_source_ctx, v_assignees, v_supersedes);
  v_wf_id := (v_res->>'workflowId')::uuid;

  -- 6. Source transition — the strand fix: status + workflow_id in the SAME commit.
  update public.finance_payroll_runs
     set status = v_to_status, workflow_id = v_wf_id
   where id = p_source_id::uuid;

  -- 7. Business side effects (wrapper-owned; durable in-txn). NOT the workflow.* events
  --    the primitive already wrote.
  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
  values
    (v_trigger, v_module_key, 'payroll_run', p_source_id, p_actor_id, 'info',
     jsonb_build_object('runNo', v_ref, 'workflowId', v_wf_id, 'fromStatus', v_from_status),
     v_trigger || ':' || p_source_id || ':' || v_wf_id::text);

  insert into public.hr_audit_log
    (submodule_key, record_id, actor_id, action, previous_state, new_state)
  values
    (v_module_key, p_source_id, p_actor_id, 'payroll_run.submitted',
     jsonb_build_object('status', v_from_status),
     jsonb_build_object('status', v_to_status, 'workflowId', v_wf_id));

  insert into public.handoff_outbox
    (source_module, target_module, source_entity_type, source_entity_id, target_entity_type, payload, status, created_by)
  values
    (v_module_key, v_module_key, 'payroll_run', p_source_id, 'payroll_approval',
     jsonb_build_object('runNo', v_ref, 'periodMonth', v_period_month, 'workflowId', v_wf_id, 'submittedBy', p_actor_id),
     'pending', p_actor_id);

  -- 8. Result + receipt (idempotency: same key+hash retry returns v_result verbatim).
  v_result := jsonb_build_object(
    'workflowId', v_wf_id, 'workflowNo', v_res->>'workflowNo',
    'status', v_to_status, 'fromStatus', v_from_status,
    'firstTasks', coalesce(v_res->'firstTasks', '[]'::jsonb),
    'supersededWorkflowId', v_supersedes);

  perform wf_internal._record_request(v_receipt_key, v_hash, 'submit', v_module_key, p_source_id, v_wf_id, v_result);

  return v_result;
end
$fn$;

-- ── Grants ────────────────────────────────────────────────────────────────────
revoke all    on function wf_internal._resolve_and_validate_assignee(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function wf_internal._resolve_and_validate_assignee(jsonb, jsonb, text) to service_role;

revoke all    on function public.workflow_submit_for_record_tx(text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.workflow_submit_for_record_tx(text, text, text, uuid, text, jsonb) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
--
-- NEXT: wire finance/payrollRuns.submitRun to call this RPC (delete the status-flip →
-- startWorkflowForRecord → stamp dance), fan out the finance-manager + assignee
-- notifications post-RPC via deliverEventNotifications(firstTasks), and add the
-- payroll-submit E2E (no-strand, idempotent retry, concurrent 200/409, side-effects,
-- access control). Then the remaining Shape-A branches A2–A13.
