-- ============================================================================
-- Atomic Workflow Creation — Shape-A slice A2: payslip-template submit
-- (audit finding #3). Extends public.workflow_submit_for_record_tx (mig 212) with
-- the `payroll_payslip_templates` branch. `create or replace` — the full function
-- with BOTH branches (finance_payroll_runs A1 + payroll_payslip_templates A2).
-- Depends on 210/211/212 applied. Operator-applied; idempotent. After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- Refactor vs 212: the per-table branch now also owns its BUSINESS side-effect
-- descriptors (event type, business module, source entity type, audit action) and
-- its source-UPDATE columns + handoff, because A2 differs from A1:
--   • module_key   finance_payroll_templates (A2) vs finance_payroll (A1)   [workflow]
--   • biz module   finance_payroll (both — event source_module + hr_audit submodule)
--   • from→to      draft|changes_requested→pending_approval (A2) vs calculated|returned (A1)
--   • source UPDATE A2 also sets submitted_by; A1 does not
--   • handoff      A1 → payroll_approval; A2 → NONE
--   • first step   A2 role=superadmin; A1 role=finance_manager
-- Ownership unchanged (SUBMIT_SLICE_A1_CONTRACT.md): primitive owns wf+tasks+wf
-- events+audit; wrapper owns source status/workflow_id + business event + hr_audit +
-- (per-table) handoff; TS owns notification delivery.
-- ============================================================================

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
  v_tmpl          public.payroll_payslip_templates%rowtype;
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
  v_biz_module    text;    -- business event source_module + hr_audit submodule_key
  v_event_type    text;    -- business <module>.submitted event type
  v_entity_type   text;    -- business source_entity_type
  v_audit_action  text;    -- hr_audit_log action
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
  c_uuid_re       constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  p_business := coalesce(p_business, '{}'::jsonb);
  if jsonb_typeof(p_business) <> 'object' then
    raise exception 'workflow_submit: business payload must be a JSON object' using errcode = 'WF400';
  end if;

  if p_request_key is null or btrim(p_request_key) = '' then
    raise exception 'workflow_submit: request_key is required' using errcode = 'WF400';
  end if;
  v_receipt_key := coalesce(p_actor_id, '') || '|submit|' || coalesce(p_source_table, '') || '|' || p_request_key;

  v_hash := md5((jsonb_build_object(
              'table', p_source_table, 'source', p_source_id, 'actor', p_actor_id,
              'binding', p_binding_id, 'business', p_business))::text);

  -- 1. Idempotency claim.
  v_claim := wf_internal._claim_request(v_receipt_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return coalesce(nullif(v_claim->'result', 'null'::jsonb),
                    jsonb_build_object('workflowId', v_claim->>'workflowId', 'duplicate', true));
  end if;

  -- 2. Static per-source-table branch: lock the source, validate the legal from→status,
  --    derive the instance fields AND the business side-effect descriptors.
  if p_source_table = 'finance_payroll_runs' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_run from public.finance_payroll_runs where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: payroll run % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_run.status not in ('calculated', 'returned') then
      raise exception 'workflow_submit: run % is % (only calculated/returned can be submitted)', p_source_id, v_run.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_payroll';
    v_workflow_type:= 'finance_payroll_approval';
    v_trigger      := 'finance.payroll.run.submitted';
    v_from_status  := v_run.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_run.created_by;
    v_ref          := v_run.run_no;
    v_period_month := v_run.period_month::text;
    v_prior_wf     := v_run.workflow_id;
    v_biz_module   := 'finance_payroll';
    v_event_type   := 'finance.payroll.run.submitted';
    v_entity_type  := 'payroll_run';
    v_audit_action := 'payroll_run.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'runNo', v_run.run_no, 'periodMonth', v_period_month,
                        'sourceType', 'payroll_run', 'submittedBy', p_actor_id);

  elsif p_source_table = 'payroll_payslip_templates' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_tmpl from public.payroll_payslip_templates where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: payslip template % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_tmpl.status not in ('draft', 'changes_requested') then
      raise exception 'workflow_submit: template % is % (only draft/changes_requested can be submitted)', p_source_id, v_tmpl.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_payroll_templates';
    v_workflow_type:= 'payslip_template_approval';
    v_trigger      := 'finance.payroll.template.submitted';
    v_from_status  := v_tmpl.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_tmpl.created_by;
    v_ref          := v_tmpl.name;
    v_prior_wf     := v_tmpl.workflow_id;
    v_biz_module   := 'finance_payroll';
    v_event_type   := 'finance.payroll.payslip_template.submitted';
    v_entity_type  := 'payslip_template';
    v_audit_action := 'payslip_template.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'templateName', v_tmpl.name, 'version', v_tmpl.version,
                        'sourceType', 'payslip_template', 'submittedBy', p_actor_id);

  else
    raise exception 'workflow_submit: unsupported source table %', p_source_table using errcode = 'WF400';
  end if;

  -- 3. Supersede check (generic): a prior workflow must be terminal AND belong to THIS record.
  if v_prior_wf is not null then
    select status, module_key, source_record_id
      into v_prior_status, v_prior_module, v_prior_source
      from public.workflow_instances where id = v_prior_wf;
    if v_prior_status is null then
      v_supersedes := null;
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

  -- 4. Resolve first-step assignees (generic) — SHARE-lock bindings so the version we
  --    resolve from can't change before _create_instance re-reads it.
  lock table public.module_workflow_bindings in share mode;
  select * into v_binding from public.module_workflow_bindings where id = p_binding_id;
  if not found then
    raise exception 'workflow_submit: binding % not found', p_binding_id using errcode = 'WF404';
  end if;
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

  -- 5. Atomic creation (primitive owns wf + tasks + wf audit + wf events).
  v_res := wf_internal._create_instance(
    p_binding_id, null, null, v_module_key, v_workflow_type, p_source_id, v_ref,
    v_trigger, p_actor_id, v_owner, null, null, 'medium',
    v_source_ctx, v_assignees, v_supersedes);
  v_wf_id := (v_res->>'workflowId')::uuid;

  -- 6. Source transition (per-table columns) — the strand fix: status + workflow_id
  --    (+ submitted_by for templates) in the SAME commit.
  if p_source_table = 'finance_payroll_runs' then
    update public.finance_payroll_runs
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'payroll_payslip_templates' then
    update public.payroll_payslip_templates
       set status = v_to_status, workflow_id = v_wf_id, submitted_by = p_actor_id
     where id = p_source_id::uuid;
  end if;

  -- 7. Business event + module audit (generic, per-table descriptors). NOT the
  --    workflow.* events the primitive already wrote.
  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
  values
    (v_event_type, v_biz_module, v_entity_type, p_source_id, p_actor_id, 'info',
     jsonb_build_object('ref', v_ref, 'workflowId', v_wf_id, 'fromStatus', v_from_status),
     v_event_type || ':' || p_source_id || ':' || v_wf_id::text);

  insert into public.hr_audit_log
    (submodule_key, record_id, actor_id, action, previous_state, new_state)
  values
    (v_biz_module, p_source_id, p_actor_id, v_audit_action,
     jsonb_build_object('status', v_from_status),
     jsonb_build_object('status', v_to_status, 'workflowId', v_wf_id));

  -- 8. Handoff intent (per-table). Payroll → payroll_approval; template → none.
  if p_source_table = 'finance_payroll_runs' then
    insert into public.handoff_outbox
      (source_module, target_module, source_entity_type, source_entity_id, target_entity_type, payload, status, created_by)
    values
      (v_biz_module, v_biz_module, 'payroll_run', p_source_id, 'payroll_approval',
       jsonb_build_object('runNo', v_ref, 'periodMonth', v_period_month, 'workflowId', v_wf_id, 'submittedBy', p_actor_id),
       'pending', p_actor_id);
  end if;

  -- 9. Result + receipt.
  v_result := jsonb_build_object(
    'workflowId', v_wf_id, 'workflowNo', v_res->>'workflowNo',
    'status', v_to_status, 'fromStatus', v_from_status,
    'firstTasks', coalesce(v_res->'firstTasks', '[]'::jsonb),
    'supersededWorkflowId', v_supersedes);

  perform wf_internal._record_request(v_receipt_key, v_hash, 'submit', v_module_key, p_source_id, v_wf_id, v_result);

  return v_result;
end
$fn$;

revoke all    on function public.workflow_submit_for_record_tx(text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.workflow_submit_for_record_tx(text, text, text, uuid, text, jsonb) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
