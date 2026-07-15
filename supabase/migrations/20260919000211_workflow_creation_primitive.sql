-- ============================================================================
-- Atomic Workflow Creation — the primitive + idempotency-ledger helpers
-- (audit finding #3, migration 2/N). Build plan:
--   netlify/functions/lib/workflow/SUBMIT_TX_BUILD.md   (step 2)
-- Design rationale:
--   netlify/functions/lib/workflow/SUBMIT_TX_DESIGN.md  (§2a, §3)
-- Depends on 20260919000210 (wf_internal schema + workflow_request_receipts +
-- workflow_instances.supersedes_workflow_id) which MUST be applied first.
-- Operator-applied; idempotent (create or replace). After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- This migration lands the CORE of the atomic-creation package:
--
--   wf_internal._create_instance   — the private, single-authority primitive that
--       creates a workflow instance + its first task(s) + the workflow-owned audit
--       and app_events, ATOMICALLY, from the authoritative published template
--       version. It NEVER trusts a caller-supplied snapshot: it reloads and
--       re-validates the binding/version IN-TXN (the finding-#3 P0 race), loads the
--       immutable definition from the version row, derives the first step(s), and
--       validates each RESOLVED assignee. Returns { workflowId, workflowNo,
--       currentStepKey, firstTasks } — firstTasks lets the wrapper fan out
--       "action required" notification delivery without re-querying.
--
--   wf_internal._claim_request     — request-key idempotency claim (advisory
--   wf_internal._record_request       xact-lock + receipt ledger). Together they
--       give every mutation wrapper the exactly-once guarantee that
--       module_mutation_runs gives today, but INSIDE the creation transaction.
--
-- Hardened after an adversarial codex review (2026-07-15, two rounds): binding
-- re-validation asserts operation-match + version-ownership + scope-applicability +
-- not-out-ranked (P0 wrong-workflow race); assignees are exactly-one-form and
-- consistent with the step's assignment KIND (P1 authority-broadening); explicit
-- template args are rejected in bound mode instead of silently dropped (accept-and-
-- drop); duplicate first-step keys are rejected and durations are numeric (P1);
-- workflow events keep the canonical `source_module = 'workflow'` provenance (P1);
-- the receipt ledger no longer swallows a divergent-receipt conflict (P1); the
-- advisory key is 64-bit (P2). Round 2 closed the three-valued-logic holes those
-- guards introduced: required scalar inputs are validated up front; operation-match
-- uses IS DISTINCT FROM; scope-applicability is coalesce(...,false) + non-null
-- scope_id; the outranking probe guards jsonb_array_length with jsonb_typeof. Round 3
-- closed the outranking CONCURRENCY race self-containedly: a SHARE-MODE lock on
-- module_workflow_bindings serializes creation against binding writes (which take a
-- conflicting ROW EXCLUSIVE) while letting concurrent creations run in parallel.
-- Round 4 added: the resolved TEMPLATE must belong to this operation's module, read
-- FOR SHARE so a concurrent module repoint can't slip through (a binding pointing at
-- another module's template would run the wrong process — P0); and each first step's
-- stepType / assignment-type / dueDurationHours / required shape is validated against
-- the vocabulary (NULL-safe — stepType is coalesced so a missing value still raises),
-- since workflow_tasks.step_type has NO CHECK and an unknown value would otherwise be
-- silently persisted (P1). _record_request now compares every identity field
-- (hash/workflow/operation/module/source), not just hash+workflow (P1).
--
-- SIDE-EFFECT OWNERSHIP (design §4 — no duplicate events):
--   • The PRIMITIVE owns: workflow_instances + workflow_tasks + workflow_audit_log
--     (workflow.started) + app_events (workflow.started + one workflow.task.assigned
--     per first task).  These are the DURABLE, in-txn intent.
--   • The typed WRAPPER (migration 212+) owns, in the same txn: the source
--     status/insert, the business <module>.submitted/.created event, module audit
--     (hr_audit_log), and any handoff/ticket/thread intent.
--   • Notification DELIVERY (role→user expansion + the "action required" rows) is
--     best-effort AFTER the RPC returns, via the wrapper's TS reading `firstTasks`
--     (the engine's established buildEventRow / deliverEventNotifications pattern —
--     app_events commit in-txn, delivery is post-commit; see appEvents.ts). The
--     wrapper MUST use a delivery-ONLY path (it must NOT re-emit the workflow.started
--     / workflow.task.assigned app_events the primitive already wrote, or they
--     double). Making the in-app notification INTENT durable in-txn (a transactional
--     notification outbox + delivery worker) is an ENGINE-WIDE gap — the decide (160)
--     and finalize (170) RPCs deliver notifications post-commit too — tracked as the
--     separate notification-durability migration (SUBMIT_TX_DESIGN §8), deliberately
--     NOT fixed here (fixing it for creation alone would diverge from the engine).
--
-- DELIBERATELY NOT IN THIS MIGRATION (each lands with its first real caller so it
-- is exercised by an E2E instead of built speculatively):
--   • wf_internal._resolve_and_validate_assignee — the wrapper-side resolver that
--     turns an assignment rule + the LOCKED source row into {userId|roleKey}. It is
--     built with the first vertical slice (payroll-run submit, migration 212) where
--     the real assignment types are known; the primitive here independently
--     VALIDATES whatever the wrapper resolves (defense-in-depth single authority).
--     NOTE: the primitive has NO production caller until 212, so this deferral leaves
--     no unguarded path live.
--   • wf_internal._enqueue_notification — the notification-durability track above.
--   • Full binding RE-SELECTION parity (condition operators + role-scope via
--     actorRoleIds) — P1 hardening #8. The in-txn guards below close the cheap,
--     always-verifiable holes; conditional / role-scoped candidates still trust the
--     caller's selection.
--   • Deterministic tiebreak for equal scope+priority bindings: the unique key allows
--     multiple same-priority globals (nullable scope_id ⇒ multiple NULLs), so both the
--     resolver and this guard's strict-priority compare are ambiguous for that config.
--     A binding-config uniqueness/hygiene fix, not a primitive change — tracked.
--
-- Custom SQLSTATEs → HTTP (mapped by rpcHttpError in service.ts):
--   WF404 not-found · WF409 conflict/config-changed · WF422 invalid input.
-- ============================================================================

-- ── wf_internal._create_instance — the atomic creation primitive ──────────────
create or replace function wf_internal._create_instance(
  p_binding_id             uuid,
  p_template_id            uuid,
  p_template_version_id    uuid,
  p_module_key             text,
  p_workflow_type          text,
  p_source_record_id       text,
  p_source_record_ref      text,
  p_trigger_event          text,
  p_requested_by           text,
  p_owner_id               text,
  p_site_id                text,
  p_department_id          text,
  p_priority               text,
  p_source_snapshot        jsonb,
  p_assignees              jsonb,
  p_supersedes_workflow_id uuid default null
) returns jsonb
language plpgsql
security invoker            -- runs as the calling service_role; no privilege elevation
set search_path = public    -- wf_internal.* referenced fully-qualified below
as $fn$
declare
  v_binding          public.module_workflow_bindings%rowtype;
  v_ver              public.workflow_template_versions%rowtype;
  v_def              jsonb;
  v_template_id      uuid;
  v_tpl_module       text;
  v_version_id       uuid;
  v_min_seq          numeric;
  v_current_step_key text;
  v_year             int;
  v_wf_id            uuid;
  v_no               text;
  v_step             jsonb;
  v_step_key         text;
  v_step_name        text;
  v_step_type        text;
  v_assign_type      text;
  v_assignee         jsonb;
  v_assign_user      text;
  v_assign_role      text;
  v_due              timestamptz;
  v_task_id          uuid;
  v_task_count       int   := 0;
  v_first_tasks      jsonb := '[]'::jsonb;
begin
  p_assignees := coalesce(p_assignees, '{}'::jsonb);

  -- 0. Required scalar inputs — surface a clean WF422 instead of a raw NOT-NULL (23502)
  --    downstream, and so the NULL-safe operation guards below have real values.
  if p_module_key is null or btrim(p_module_key) = ''
     or p_workflow_type is null or btrim(p_workflow_type) = ''
     or p_source_record_id is null or btrim(p_source_record_id) = '' then
    raise exception '_create_instance: module_key, workflow_type and source_record_id are required' using errcode = 'WF422';
  end if;

  -- 1. Config reload + re-validate IN-TXN (the finding-#3 P0 race). We NEVER trust a
  --    caller-supplied snapshot or version — we reload the authoritative row(s) under
  --    a share lock and load the immutable definition from the published version.
  if p_binding_id is not null then
    -- Bound start. The caller (TS selectWorkflowBinding) picked the winning binding
    -- from the source context; we re-validate it under lock. Explicit template args
    -- are meaningless for a bound start — REJECT them rather than silently drop
    -- (no accept-and-drop): a bound start is identified by the binding alone.
    if p_template_id is not null or p_template_version_id is not null then
      raise exception '_create_instance: bound start must not also pass template/version args' using errcode = 'WF422';
    end if;

    -- Serialize this creation against concurrent binding administration so the
    -- outranking probe below sees a snapshot no binding write can invalidate before
    -- commit. SHARE MODE is compatible with other creations' SHARE (concurrent
    -- creations still run in parallel) but conflicts with the ROW EXCLUSIVE that any
    -- binding INSERT/UPDATE/DELETE takes automatically — so it closes the race WITHOUT
    -- modifying binding CRUD. Binding changes are rare admin ops ⇒ negligible
    -- contention. Lock order is source-row (wrapper) → this table → instance/tasks;
    -- binding admin touches only this table, so no cycle.
    lock table public.module_workflow_bindings in share mode;

    select * into v_binding from public.module_workflow_bindings where id = p_binding_id for share;
    if not found then
      raise exception '_create_instance: binding % not found', p_binding_id using errcode = 'WF404';
    end if;
    if not v_binding.is_active then
      raise exception '_create_instance: binding % is no longer active', p_binding_id using errcode = 'WF409';
    end if;

    -- The binding must be FOR this operation (a caller passing a binding for a
    -- different module/type/trigger is a bug, not a silent accept). IS DISTINCT FROM
    -- is NULL-safe — plain <> would evaluate to NULL (not raise) on a NULL arg.
    if v_binding.module_key is distinct from p_module_key
       or v_binding.workflow_type is distinct from p_workflow_type
       or v_binding.trigger_event is distinct from p_trigger_event then
      raise exception '_create_instance: binding % does not match this operation (%/%/%)',
        p_binding_id, p_module_key, p_workflow_type, p_trigger_event using errcode = 'WF409';
    end if;

    -- The binding's own scope must APPLY to this record's context. (role scope needs
    -- actorRoleIds we do not carry here → accepted; global/site/department verified.)
    -- coalesce(...,false) forces three-valued logic to a boolean: a site/department
    -- binding with a NULL scope_id (or a NULL context id) makes the predicate NULL,
    -- and IF NOT (NULL) would NOT raise — so such a binding would slip through.
    if not coalesce(
           v_binding.scope_type = 'global'
        or v_binding.scope_type = 'role'
        or (v_binding.scope_type = 'site'       and v_binding.scope_id is not null and v_binding.scope_id = nullif(p_site_id, ''))
        or (v_binding.scope_type = 'department' and v_binding.scope_id is not null and v_binding.scope_id = nullif(p_department_id, '')),
        false) then
      raise exception '_create_instance: binding % scope does not apply to this record', p_binding_id using errcode = 'WF409';
    end if;

    -- And no MORE-SPECIFIC unconditional binding may outrank the supplied one — this
    -- catches a stale caller selection (admin activated a more-specific binding; the
    -- caller's TS selection used a stale read). The SHARE lock above means no binding
    -- write can commit between this probe and ours, so a concurrently-activated
    -- binding cannot slip past it either. Scope order site<department<role<global,
    -- then lowest priority number (per bindingResolver). Conditional / role-scoped
    -- candidates need the deferred full-eval parity (condition operators / actorRoleIds
    -- — P1 hardening #8) and are excluded here; those cases still trust the caller's
    -- selection. jsonb_typeof guards jsonb_array_length (it THROWS on a JSON
    -- null / non-array; the TS resolver treats those as an empty condition list).
    if exists (
      select 1 from public.module_workflow_bindings b
       where b.module_key = p_module_key and b.workflow_type = p_workflow_type
         and b.trigger_event = p_trigger_event and b.is_active and b.id <> v_binding.id
         and coalesce(case when jsonb_typeof(b.conditions->'conditions') = 'array'
                           then jsonb_array_length(b.conditions->'conditions') else 0 end, 0) = 0
         and ( b.scope_type = 'global'
            or (b.scope_type = 'site'       and b.scope_id is not null and b.scope_id = nullif(p_site_id, ''))
            or (b.scope_type = 'department' and b.scope_id is not null and b.scope_id = nullif(p_department_id, '')) )
         and ( (case b.scope_type when 'site' then 1 when 'department' then 2 when 'role' then 3 else 4 end)
                < (case v_binding.scope_type when 'site' then 1 when 'department' then 2 when 'role' then 3 else 4 end)
            or ( (case b.scope_type when 'site' then 1 when 'department' then 2 when 'role' then 3 else 4 end)
                 = (case v_binding.scope_type when 'site' then 1 when 'department' then 2 when 'role' then 3 else 4 end)
                 and b.priority < v_binding.priority ) )
    ) then
      raise exception '_create_instance: a more specific active binding now outranks binding % — re-select', p_binding_id using errcode = 'WF409';
    end if;

    if v_binding.template_version_id is not null then
      -- Binding pins an explicit version.
      select * into v_ver from public.workflow_template_versions
        where id = v_binding.template_version_id for share;
    else
      -- Binding tracks the newest published version (mirrors resolveDefinition).
      select * into v_ver from public.workflow_template_versions
        where template_id = v_binding.template_id and version_status = 'published'
        order by version_no desc limit 1 for share;
    end if;
    -- A pinned version MUST belong to the binding's template.
    if v_ver.id is not null and v_ver.template_id <> v_binding.template_id then
      raise exception '_create_instance: binding % version % belongs to a different template', p_binding_id, v_ver.id using errcode = 'WF409';
    end if;
  else
    -- Explicit start: no binding — the version is supplied and validated directly.
    if p_template_version_id is null then
      raise exception '_create_instance: explicit start requires a template version' using errcode = 'WF422';
    end if;
    select * into v_ver from public.workflow_template_versions where id = p_template_version_id for share;
  end if;

  if v_ver.id is null then
    raise exception '_create_instance: no template version resolved' using errcode = 'WF404';
  end if;
  if v_ver.version_status <> 'published' then
    raise exception '_create_instance: template version % is % (not published)', v_ver.id, v_ver.version_status using errcode = 'WF409';
  end if;
  -- For an explicit start with a stated template, the version must belong to it.
  if p_binding_id is null and p_template_id is not null and v_ver.template_id <> p_template_id then
    raise exception '_create_instance: version % does not belong to template %', v_ver.id, p_template_id using errcode = 'WF422';
  end if;

  v_template_id := v_ver.template_id;   -- authoritative (from the locked version row)
  v_version_id  := v_ver.id;
  v_def         := coalesce(v_ver.definition, '{}'::jsonb);

  -- The resolved TEMPLATE must belong to this operation's MODULE. A binding (or an
  -- explicit template) whose template is another module's would run the wrong process
  -- entirely — e.g. a payroll submit driving an HR template. (workflow_type can be
  -- legitimately reused across a module's bindings, so only module identity is asserted.)
  -- FOR SHARE: hold the template row so a concurrent admin cannot repoint its module
  -- between this read and our commit (matches the binding/version reload discipline).
  select module_key into v_tpl_module from public.workflow_templates where id = v_template_id for share;
  if not found then
    raise exception '_create_instance: template % not found', v_template_id using errcode = 'WF404';
  end if;
  if v_tpl_module is distinct from p_module_key then
    raise exception '_create_instance: template % is for module % not %', v_template_id, v_tpl_module, p_module_key using errcode = 'WF409';
  end if;

  -- 2. Derive the first step(s) — all steps sharing the lowest sequenceNo (parallel).
  --    Mirrors transitions.firstSteps(). sequenceNo/dueDurationHours are cast as
  --    NUMERIC (JS numbers may be fractional; an ::int cast would crash on 1.5).
  select min((s.value->>'sequenceNo')::numeric) into v_min_seq
    from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) s;
  if v_min_seq is null then
    raise exception '_create_instance: template version % has no steps', v_version_id using errcode = 'WF422';
  end if;

  -- Reject duplicate first-step keys (validateDefinition rejects them at publish; this
  -- is the in-DB backstop — duplicate keys would create duplicate tasks sharing one
  -- assignee entry). Published-version immutability is tracked as P1 hardening #9.
  if (select count(*) from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) s
        where (s.value->>'sequenceNo')::numeric = v_min_seq)
     <> (select count(distinct s.value->>'stepKey') from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) s
        where (s.value->>'sequenceNo')::numeric = v_min_seq) then
    raise exception '_create_instance: template version % has duplicate first-step keys', v_version_id using errcode = 'WF422';
  end if;

  -- current_step_key = the first (array-order) step at the lowest sequence (mirrors
  -- starts[0].stepKey in instantiateWorkflow).
  select s.value->>'stepKey' into v_current_step_key
    from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) with ordinality s(value, ord)
   where (s.value->>'sequenceNo')::numeric = v_min_seq
   order by s.ord limit 1;

  -- Reject a p_assignees key that is not a first-step key (a wrapper passing a
  -- later-step assignee is a bug — fail loudly rather than silently drop it).
  if exists (
    select 1 from jsonb_object_keys(p_assignees) as k(assignee_key)
     where k.assignee_key not in (
       select s.value->>'stepKey' from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) s
        where (s.value->>'sequenceNo')::numeric = v_min_seq)
  ) then
    raise exception '_create_instance: assignees contain a key that is not a first step' using errcode = 'WF422';
  end if;

  -- 3. Allocate the id + human ref atomically (WF-YYYY-NNNN, 4-digit, matching nextRef).
  v_year  := extract(year from now())::int;
  v_wf_id := gen_random_uuid();
  v_no    := 'WF-' || v_year || '-' || lpad(public.increment_ref_counter('WF', v_year)::text, 4, '0');

  -- 4. Insert the instance (all derived columns; supersedes link if a resubmit).
  insert into public.workflow_instances
    (id, workflow_no, template_id, template_version_id, module_key, workflow_type,
     source_record_id, source_record_ref, status, current_step_key, priority,
     site_id, department_id, requested_by, owner_id, started_at,
     template_snapshot, source_snapshot, metadata, supersedes_workflow_id)
  values
    (v_wf_id, v_no, v_template_id, v_version_id, p_module_key, p_workflow_type,
     p_source_record_id, p_source_record_ref, 'in_progress', v_current_step_key,
     case when p_priority is null or p_priority = 'normal' then 'medium' else p_priority end,
     nullif(p_site_id, ''), nullif(p_department_id, ''), p_requested_by, p_owner_id, now(),
     v_def, coalesce(p_source_snapshot, '{}'::jsonb),
     jsonb_build_object('bindingId', p_binding_id, 'triggerEvent', p_trigger_event),
     p_supersedes_workflow_id);

  -- 5. Insert the first task(s) FROM THE SNAPSHOT + the caller's RESOLVED assignee,
  --    validating each. Emit one workflow.task.assigned app_event per task.
  for v_step in
    select s.value from jsonb_array_elements(coalesce(v_def->'steps', '[]'::jsonb)) with ordinality s(value, ord)
     where (s.value->>'sequenceNo')::numeric = v_min_seq
     order by s.ord
  loop
    v_step_key    := v_step->>'stepKey';
    v_step_name   := v_step->>'stepName';
    v_step_type   := coalesce(v_step->>'stepType', '');   -- '' (never NULL) so the NOT IN guard below raises
    v_assign_type := coalesce(v_step->'assignment'->>'type', '');
    v_assignee    := p_assignees -> v_step_key;
    v_assign_user := nullif(v_assignee->>'userId', '');
    v_assign_role := nullif(v_assignee->>'roleKey', '');

    -- Enum/shape guards on the published snapshot. validateDefinition is incomplete
    -- (it does not enforce the stepType/assignment-type vocabularies, nor the numeric/
    -- boolean shape of dueDurationHours/required) and published versions are not yet
    -- immutable — so surface a clean WF422 for a malformed published snapshot. NOTE
    -- workflow_tasks.step_type has NO CHECK (only workflow_template_steps does), so an
    -- unknown stepType would be SILENTLY PERSISTED as bad data; a missing one would hit
    -- NOT NULL (23502); a non-numeric dueDurationHours would raise 22P02. Vocabularies
    -- mirror definitionTypes (WorkflowStepType / WorkflowAssignmentType).
    if v_step_type not in ('review','approval','verification','acknowledgement','assignment','handoff','automation','closeout') then
      raise exception '_create_instance: step % has an unknown stepType %', v_step_key, coalesce(nullif(v_step_type, ''), '(missing)') using errcode = 'WF422';
    end if;
    if v_assign_type not in ('fixed_user','role','supervisor','department_manager','site_manager','hse_manager','document_owner','permit_area_owner','record_owner','requester_manager','dynamic_field') then
      raise exception '_create_instance: step % has an unknown assignment type %', v_step_key, v_assign_type using errcode = 'WF422';
    end if;
    if v_step ? 'dueDurationHours' and jsonb_typeof(v_step->'dueDurationHours') not in ('number','null') then
      raise exception '_create_instance: step % dueDurationHours must be a number', v_step_key using errcode = 'WF422';
    end if;
    if v_step ? 'required' and jsonb_typeof(v_step->'required') not in ('boolean','null') then
      raise exception '_create_instance: step % required must be a boolean', v_step_key using errcode = 'WF422';
    end if;

    -- Exactly ONE assignee form, consistent with the step's assignment KIND. A task
    -- carrying BOTH a user and a role would broaden decision authority: the decide RPC
    -- authorizes assigned_to = actor OR assigned_role = actor-role, so a CFO-only
    -- approval also tagged roleKey 'manager' would let every manager approve it.
    if v_assign_type = 'role' then
      if v_assign_role is null then
        raise exception '_create_instance: role-assignment step % must resolve to a role', v_step_key using errcode = 'WF422';
      end if;
      if v_assign_user is not null then
        raise exception '_create_instance: role-assignment step % must not also carry a user', v_step_key using errcode = 'WF422';
      end if;
    else
      if v_assign_user is null then
        raise exception '_create_instance: step % must resolve to a user', v_step_key using errcode = 'WF422';
      end if;
      if v_assign_role is not null then
        raise exception '_create_instance: user-assignment step % must not also carry a role', v_step_key using errcode = 'WF422';
      end if;
    end if;
    if v_assign_user is not null
       and not exists (select 1 from public.app_users where id = v_assign_user and status = 'active') then
      raise exception '_create_instance: assignee % for step % is not an active user', v_assign_user, v_step_key using errcode = 'WF422';
    end if;
    if v_assign_role is not null
       and not exists (select 1 from public.roles where name = v_assign_role) then
      raise exception '_create_instance: role % for step % is not a known role', v_assign_role, v_step_key using errcode = 'WF422';
    end if;
    -- Segregation of duties — OPT-IN per step (assignment.enforceSegregation = true).
    -- Sensitive modules (payroll/finance) ALSO enforce creator≠approver in their own
    -- transition RPCs; this is the generic engine-level backstop, off by default so it
    -- can never break a legitimate self-acknowledgement step.
    if coalesce((v_step->'assignment'->>'enforceSegregation')::boolean, false)
       and v_assign_user is not null and v_assign_user = p_requested_by then
      raise exception '_create_instance: step % assignee cannot be the requester (segregation of duties)', v_step_key using errcode = 'WF422';
    end if;

    -- Duration: NUMERIC (fractional hours ok); any non-zero value produces a due_at
    -- (matches addHoursIso — negative => an already-overdue timestamp), absent/0 => none.
    -- Guarded by jsonb_typeof='number' (validated above) so the cast can never raise.
    v_due := case
               when jsonb_typeof(v_step->'dueDurationHours') = 'number' and (v_step->>'dueDurationHours')::numeric <> 0
               then now() + ((v_step->>'dueDurationHours')::numeric) * interval '1 hour'
               else null
             end;

    insert into public.workflow_tasks
      (workflow_id, step_key, step_name, step_type, task_title, assigned_to, assigned_role,
       status, due_at, is_required, metadata)
    values
      (v_wf_id, v_step_key, v_step_name, v_step_type, v_step_name, v_assign_user, v_assign_role,
       'pending', v_due, coalesce((v_step->>'required')::boolean, true),
       jsonb_build_object('assignmentType', v_assign_type))
    returning id into v_task_id;

    -- Canonical workflow-event provenance: source_module='workflow', entity='workflow'
    -- (matches emitWf + workflow_finalize_transition_tx). The owning module is in the
    -- payload — feeds/reports filter workflow events on source_module='workflow'.
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
       site_id, department_id, severity, payload, dedupe_key)
    values
      ('workflow.task.assigned', 'workflow', 'workflow',
       coalesce(v_no, v_wf_id::text), p_requested_by,
       nullif(p_site_id, ''), nullif(p_department_id, ''), 'info',
       jsonb_build_object('workflowId', v_wf_id, 'workflowNo', v_no, 'taskId', v_task_id,
                          'stepKey', v_step_key, 'stepName', v_step_name,
                          'assignedTo', v_assign_user, 'assignedRole', v_assign_role,
                          'moduleKey', p_module_key, 'sourceRecordId', p_source_record_id,
                          'sourceRecordRef', p_source_record_ref),
       'wf.task.assigned:' || v_task_id::text);

    v_task_count  := v_task_count + 1;
    v_first_tasks := v_first_tasks || jsonb_build_object(
      'taskId', v_task_id, 'stepKey', v_step_key, 'stepName', v_step_name,
      'assignedTo', v_assign_user, 'assignedRole', v_assign_role);
  end loop;

  -- 6. Workflow-owned audit + started event (durable in-txn intent).
  insert into public.workflow_audit_log
    (workflow_id, module_key, source_record_id, actor_id, action, new_state, metadata)
  values
    (v_wf_id, p_module_key, p_source_record_id, p_requested_by, 'workflow.started',
     jsonb_build_object('status', 'in_progress'),
     jsonb_build_object('bindingId', p_binding_id, 'triggerEvent', p_trigger_event, 'firstTaskCount', v_task_count));

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id, actor_user_id,
     site_id, department_id, severity, payload, dedupe_key)
  values
    ('workflow.started', 'workflow', 'workflow',
     coalesce(v_no, v_wf_id::text), p_requested_by,
     nullif(p_site_id, ''), nullif(p_department_id, ''), 'info',
     jsonb_build_object('workflowId', v_wf_id, 'workflowNo', v_no, 'moduleKey', p_module_key,
                        'workflowType', p_workflow_type, 'sourceRecordId', p_source_record_id,
                        'sourceRecordRef', p_source_record_ref, 'triggerEvent', p_trigger_event),
     'wf.workflow.started:' || v_wf_id::text);

  return jsonb_build_object(
    'workflowId', v_wf_id, 'workflowNo', v_no,
    'currentStepKey', v_current_step_key, 'firstTasks', v_first_tasks);
end
$fn$;

-- ── wf_internal._claim_request — request-key idempotency claim ─────────────────
-- Serializes concurrent duplicates on the same key (pg_advisory_XACT_lock is held
-- to commit, so a racing duplicate blocks until this txn commits and then sees the
-- receipt) and returns the stored result on a same-key/same-hash retry. A same-key/
-- different-hash call is a client bug → WF409. A null/blank key → 'proceed' (explicit
-- starts are not retried mutations of a business record and carry no receipt).
-- 64-bit advisory key (hashtextextended) to keep unrelated keys from colliding.
create or replace function wf_internal._claim_request(
  p_request_key  text,
  p_request_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare v_row wf_internal.workflow_request_receipts%rowtype;
begin
  if p_request_key is null or btrim(p_request_key) = '' then
    return jsonb_build_object('status', 'proceed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 0));

  select * into v_row from wf_internal.workflow_request_receipts where request_key = p_request_key;
  if not found then
    return jsonb_build_object('status', 'proceed');
  end if;
  if v_row.request_hash is distinct from p_request_hash then
    raise exception '_claim_request: request key % already used with a different payload', p_request_key using errcode = 'WF409';
  end if;
  return jsonb_build_object('status', 'duplicate', 'workflowId', v_row.workflow_id, 'result', v_row.result);
end
$fn$;

-- ── wf_internal._record_request — write the receipt on success (same txn) ──────
-- Called by the wrapper AFTER _create_instance, before commit. A correct caller
-- already holds the advisory lock from _claim_request; we re-acquire it defensively
-- (same-txn re-acquire is a no-op) so a caller that recorded WITHOUT claiming still
-- can't race. A pre-existing receipt is idempotent ONLY if identical — a divergent
-- receipt for the same key is surfaced as WF409, never silently dropped.
create or replace function wf_internal._record_request(
  p_request_key  text,
  p_request_hash text,
  p_operation    text,
  p_module_key   text,
  p_source_id    text,
  p_workflow_id  uuid,
  p_result       jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare v_row wf_internal.workflow_request_receipts%rowtype;
begin
  if p_request_key is null or btrim(p_request_key) = '' then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 0));

  select * into v_row from wf_internal.workflow_request_receipts where request_key = p_request_key;
  if found then
    -- Idempotent ONLY if every identity-bearing field is identical; any divergence for
    -- the same key is a caller bug we surface, never silently drop (no swallowed errors).
    if v_row.request_hash is distinct from p_request_hash
       or v_row.workflow_id is distinct from p_workflow_id
       or v_row.operation   is distinct from p_operation
       or v_row.module_key  is distinct from p_module_key
       or v_row.source_id   is distinct from p_source_id then
      raise exception '_record_request: request key % already has a different receipt', p_request_key using errcode = 'WF409';
    end if;
    return;   -- identical receipt already present → idempotent no-op
  end if;

  insert into wf_internal.workflow_request_receipts
    (request_key, request_hash, operation, module_key, source_id, workflow_id, result)
  values
    (p_request_key, p_request_hash, p_operation, p_module_key, p_source_id, p_workflow_id, coalesce(p_result, '{}'::jsonb));
end
$fn$;

-- ── Grants — service_role only (backend). SECURITY INVOKER functions still default
--    to PUBLIC execute, and although wf_internal usage is revoked from public
--    (migration 210), we revoke execute explicitly for defense-in-depth. ──────────
revoke all on function wf_internal._create_instance(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, uuid
) from public, anon, authenticated;
grant execute on function wf_internal._create_instance(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, uuid
) to service_role;

revoke all    on function wf_internal._claim_request(text, text) from public, anon, authenticated;
grant execute on function wf_internal._claim_request(text, text) to service_role;

revoke all    on function wf_internal._record_request(text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function wf_internal._record_request(text, text, text, text, text, uuid, jsonb) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
--
-- NEXT (migration 212 + wire): public.workflow_submit_for_record_tx with the
-- payroll-run branch + wf_internal._resolve_and_validate_assignee, wired into
-- finance/payrollRuns.submitRun (delete the legacy status-then-start dance), proving
-- the Shape-A pattern end-to-end (idempotency + no-strand + notification delivery).
