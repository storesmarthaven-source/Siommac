-- ============================================================================
-- CONSOLIDATED apply — Finding #3 atomic workflow-submit RPC layer (thru A13/HSE)
-- ONE idempotent file = migrations 210 + 211 + 212 + 213 + 218, in order.
-- Apply in a PLAIN SQL Editor tab (NOT the AI Assistant). Then NOTIFY pgrst.
-- ============================================================================



-- ##### 20260919000210_workflow_creation_foundation.sql

-- ============================================================================
-- Atomic Workflow Creation — foundation schema (audit finding #3, migration 1/N)
-- Build plan: netlify/functions/lib/workflow/SUBMIT_TX_BUILD.md
-- Design rationale: netlify/functions/lib/workflow/SUBMIT_TX_DESIGN.md
-- ============================================================================
-- PURE SCHEMA (no functions) — the low-risk foundation the primitive + typed
-- wrappers build on. Operator-applied; idempotent. After applying:
--   NOTIFY pgrst, 'reload schema';
--
--   wf_internal (schema)            — private, NOT exposed via PostgREST; the
--                                     workflow-creation primitive + helpers live
--                                     here. service_role gets usage; per-function
--                                     execute grants land with those functions.
--   workflow_request_receipts       — client-request idempotency ledger. The
--                                     mutation RPCs claim (advisory lock) then
--                                     upsert a row keyed by request_key; a retry
--                                     with the same request_hash returns the
--                                     stored result (exactly-once across a lost
--                                     HTTP response). Replaces the ad-hoc
--                                     module_mutation_runs guard for start paths.
--   workflow_instances.supersedes_workflow_id — a resubmission links to the prior
--                                     (terminal) instance it superseded.
--
-- The notification-delivery durability track (retry columns + status expansion +
-- (notification_id,channel) unique + the scheduled worker) is a SEPARATE migration
-- with its own data-migration preflight — not bundled here.
-- ============================================================================

-- ── wf_internal private schema ────────────────────────────────────────────────
create schema if not exists wf_internal;
-- PostgREST exposes only `public` (+ configured schemas); wf_internal is therefore
-- unreachable via the API. service_role (backend only) may use it.
grant usage on schema wf_internal to service_role;
revoke usage on schema wf_internal from public;

-- ── workflow_request_receipts — request-key idempotency ledger ────────────────
create table if not exists wf_internal.workflow_request_receipts (
  request_key   text primary key,          -- org|actor|operation_family|client-key (built by the RPC)
  request_hash  text not null,             -- md5 over a canonical jsonb of all behaviorally-relevant inputs (computed in-RPC; md5 is a pg_catalog builtin — non-adversarial idempotency fingerprint, not a security primitive)
  operation     text not null,             -- submit | create_and_start | start_bound | start_template
  module_key    text not null,
  source_id     text,                      -- business/source record id (text — source ids vary)
  workflow_id   uuid references public.workflow_instances(id),
  result        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists workflow_request_receipts_wf_idx
  on wf_internal.workflow_request_receipts(workflow_id);
alter table wf_internal.workflow_request_receipts enable row level security;
-- No policies: service_role bypasses RLS; the private schema is off the API surface.
-- BUT RLS-bypass is not GRANT-bypass: the migration-211 helpers run SECURITY INVOKER (as
-- the calling `service_role`), and wf_internal is a NEW schema NOT covered by the standard
-- `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role`. Without explicit table privs
-- those helpers fail with "permission denied for table workflow_request_receipts". Grant
-- them here, and set default privileges so the 211+ helper tables inherit the grant.
grant select, insert, update, delete on wf_internal.workflow_request_receipts to service_role;
alter default privileges in schema wf_internal grant select, insert, update, delete on tables to service_role;
alter default privileges in schema wf_internal grant usage, select on sequences to service_role;

-- ── workflow_instances.supersedes_workflow_id ─────────────────────────────────
alter table public.workflow_instances
  add column if not exists supersedes_workflow_id uuid references public.workflow_instances(id);
create index if not exists workflow_instances_supersedes_idx
  on public.workflow_instances(supersedes_workflow_id) where supersedes_workflow_id is not null;

-- After applying:  NOTIFY pgrst, 'reload schema';
--
-- NEXT (migration 211): wf_internal._claim_request, _resolve_and_validate_assignee,
-- _enqueue_notification, _create_instance (the primitive). Then 212 + wiring: the
-- first vertical slice (payroll-run submit) proving the Shape-A pattern end-to-end.


-- ##### 20260919000211_workflow_creation_primitive.sql

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


-- ##### 20260919000212_workflow_submit_for_record_tx.sql

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


-- ##### 20260919000213_workflow_request_receipts_fk_on_delete.sql

-- ============================================================================
-- workflow_request_receipts.workflow_id FK → ON DELETE SET NULL (cleanup hygiene)
-- Follow-up to 20260919000210. Operator-applied; idempotent (drop-if-exists + add).
-- ============================================================================
-- The receipt's FK to workflow_instances was created with NO ON DELETE action, so a
-- receipt PINNED its workflow_instance alive — surfaced when the E2E orphan-sweeper
-- (and any legitimate instance deletion) hit workflow_request_receipts_workflow_id_fkey
-- and could not delete test workflow_instances (which then blocked app_user cleanup).
--
-- A receipt is an idempotency-ledger row whose stored `result` jsonb ALREADY carries
-- the workflowId; it can safely outlive the instance. So SET NULL — NOT CASCADE — we
-- keep the ledger row (a retry after the instance is gone still returns the stored
-- result), we just drop the hard reference. workflow_id is nullable (mig 210), so
-- SET NULL is valid.
--
-- (Not fixed here — separate, pre-existing sweeper FK blocks: workflow_transitions
--  .task_id → workflow_tasks (mig 150) and finance_pay_component_change_requests
--  .created_by → app_users. Those are their own cleanup-order concerns.)
-- ============================================================================

alter table wf_internal.workflow_request_receipts
  drop constraint if exists workflow_request_receipts_workflow_id_fkey;

alter table wf_internal.workflow_request_receipts
  add constraint workflow_request_receipts_workflow_id_fkey
    foreign key (workflow_id) references public.workflow_instances(id) on delete set null;

-- wf_internal is off the PostgREST API surface, so no schema reload is required, but
-- harmless to run:  NOTIFY pgrst, 'reload schema';


-- ##### 20260919000218_workflow_submit_tx_hse.sql

-- ============================================================================
-- Atomic Workflow Creation — Shape-A batch (HSE group): A11/A12/A13
-- (audit finding #3). Adds THREE branches to public.workflow_submit_for_record_tx:
--   hse_hazards (A11) · hse_risk_assessments (A12) · hse_jsa (A13).
-- create-or-replace with ALL 12 branches (payroll A1 + template A2 + remittance A3
-- + loan A4 + statutory/compensation/disbursements/expenses A6–A9 + these three).
-- Depends on 210/211/212 applied. Operator-applied; idempotent. After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================
-- HSE deltas vs the finance/HR branches (this migration generalises the side-effect
-- section to support them):
--   * Audit target is public.audit_logs (cols action/table_name/record_id/user_id/
--     changes), NOT hr_audit_log — a per-branch v_audit_target switch.
--   * The business app_event source_entity_id is the RECORD REF (e.g. HAZ-2026-0001),
--     not the uuid — HSE addresses records by ref end-to-end.
--   * audit action = the dotted event type (matches lib/appEvents.ts emitAppEvent,
--     which the inline handlers used) e.g. 'hse.hazard.submitted'.
--   * NO handoff. Notification is BROADCAST (event_rules) — delivered post-commit by
--     the TS caller via deliverEventNotifications(input, businessEventId); the RPC now
--     returns businessEventId so the notification links to the event row.
--   * Workflow priority is risk-derived; the caller passes it in p_business.priority
--     (RPC reads coalesce(p_business->>'priority','medium'); finance callers omit it).
--   * onStarted = under_review for all three (Option-B: the RPC writes under_review
--     directly; RA/JSA no longer pass through the transient 'submitted').
--   * First-step role = manager (verified present in public.roles).
--   * from-status gates: hazard = NOT IN (under_review,approved,archived);
--     risk_assessment/jsa = IN (draft,returned).
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
  v_rem           public.finance_remittances%rowtype;
  v_loan          public.finance_employee_loans%rowtype;
  v_stat          public.finance_statutory_versions%rowtype;
  v_comp          public.hr_employee_pay_items%rowtype;
  v_disb          public.finance_disbursements%rowtype;
  v_exp           public.finance_expense_claims%rowtype;
  v_haz           public.hse_hazards%rowtype;
  v_hra           public.hse_risk_assessments%rowtype;
  v_hjsa          public.hse_jsa%rowtype;
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
  v_biz_module    text;
  v_event_type    text;
  v_entity_type   text;
  v_audit_action  text;
  v_audit_target  text := 'hr_audit_log';   -- HSE branches override to 'audit_logs'
  v_priority      text;
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
  v_event_id      uuid;
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
  v_priority    := coalesce(nullif(p_business->>'priority', ''), 'medium');

  v_hash := md5((jsonb_build_object(
              'table', p_source_table, 'source', p_source_id, 'actor', p_actor_id,
              'binding', p_binding_id, 'business', p_business))::text);

  v_claim := wf_internal._claim_request(v_receipt_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return coalesce(nullif(v_claim->'result', 'null'::jsonb),
                    jsonb_build_object('workflowId', v_claim->>'workflowId', 'duplicate', true));
  end if;

  -- Static per-source-table branch.
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

  elsif p_source_table = 'finance_remittances' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_rem from public.finance_remittances where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: remittance % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_rem.status <> 'draft' then
      raise exception 'workflow_submit: remittance % is % (only draft can be submitted)', p_source_id, v_rem.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_remittances';
    v_workflow_type:= 'finance_remittance_approval';
    v_trigger      := 'finance.remittance.submitted';
    v_from_status  := v_rem.status;
    v_to_status    := 'submitted';
    v_owner        := v_rem.created_by;
    v_ref          := v_rem.remittance_no;
    v_prior_wf     := v_rem.workflow_id;
    v_biz_module   := 'finance_remittances';
    v_event_type   := 'finance.remittance.submitted';
    v_entity_type  := 'remittance';
    v_audit_action := 'remittance.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'remittanceNo', v_rem.remittance_no, 'authority', v_rem.authority,
                        'sourceType', 'remittance', 'submittedBy', p_actor_id);

  elsif p_source_table = 'finance_employee_loans' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_loan from public.finance_employee_loans where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: loan % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_loan.status not in ('draft', 'rejected') then
      raise exception 'workflow_submit: loan % is % (only draft/rejected can be submitted)', p_source_id, v_loan.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_loan';
    v_workflow_type:= 'finance_loan_approval';
    v_trigger      := 'finance.loan.submitted';
    v_from_status  := v_loan.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_loan.created_by;
    v_ref          := v_loan.reference;
    v_prior_wf     := v_loan.workflow_id;
    v_biz_module   := 'finance_loan';
    v_event_type   := 'finance.loan.submitted';
    v_entity_type  := 'employee_loan';
    v_audit_action := 'loan.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'reference', v_loan.reference, 'employeeId', v_loan.employee_id,
                        'sourceType', 'employee_loan', 'submittedBy', p_actor_id);

  elsif p_source_table = 'finance_statutory_versions' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_stat from public.finance_statutory_versions where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: statutory version % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_stat.status <> 'draft' then
      raise exception 'workflow_submit: statutory version % is % (only draft can be submitted)', p_source_id, v_stat.status using errcode = 'WF409';
    end if;
    v_ref          := 'SV-' || upper(left(p_source_id, 8));
    v_module_key   := 'finance_statutory';
    v_workflow_type:= 'finance_statutory_approval';
    v_trigger      := 'finance.statutory.version.submitted';
    v_from_status  := v_stat.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_stat.created_by;
    v_prior_wf     := v_stat.workflow_id;
    v_biz_module   := 'finance_statutory';
    v_event_type   := 'finance.statutory.version.submitted';
    v_entity_type  := 'statutory_version';
    v_audit_action := 'statutory_version.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'sourceType', 'statutory_version', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hr_employee_pay_items' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_comp from public.hr_employee_pay_items where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: pay item % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_comp.status <> 'draft' then
      raise exception 'workflow_submit: pay item % is % (only draft can be submitted)', p_source_id, v_comp.status using errcode = 'WF409';
    end if;
    v_ref          := coalesce(v_comp.item_no, 'PIT-' || upper(left(p_source_id, 8)));
    v_module_key   := 'hr_compensation';
    v_workflow_type:= 'hr_compensation_change_approval';
    v_trigger      := 'hr.compensation.item.submitted';
    v_from_status  := v_comp.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_comp.created_by;
    v_prior_wf     := v_comp.workflow_id;
    v_biz_module   := 'hr_compensation';
    v_event_type   := 'hr.compensation.item.submitted';
    v_entity_type  := 'pay_item';
    v_audit_action := 'pay_item.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'employeeId', v_comp.employee_id,
                        'sourceType', 'pay_item', 'submittedBy', p_actor_id);

  elsif p_source_table = 'finance_disbursements' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_disb from public.finance_disbursements where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: disbursement % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_disb.status <> 'draft' then
      raise exception 'workflow_submit: disbursement % is % (only draft can be submitted)', p_source_id, v_disb.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_disbursements';
    v_workflow_type:= 'finance_disbursement_approval';
    v_trigger      := 'finance.disbursement.submitted';
    v_from_status  := v_disb.status;
    v_to_status    := 'submitted';
    v_owner        := v_disb.created_by;
    v_ref          := v_disb.disbursement_no;
    v_prior_wf     := v_disb.workflow_id;
    v_biz_module   := 'finance_disbursements';
    v_event_type   := 'finance.disbursement.submitted';
    v_entity_type  := 'disbursement';
    v_audit_action := 'disbursement.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'disbursementNo', v_ref, 'sourceType', 'disbursement', 'submittedBy', p_actor_id);

  elsif p_source_table = 'finance_expense_claims' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_exp from public.finance_expense_claims where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: expense claim % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_exp.status <> 'draft' then
      raise exception 'workflow_submit: expense claim % is % (only draft can be submitted)', p_source_id, v_exp.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_expenses';
    v_workflow_type:= 'finance_expense_approval';
    v_trigger      := 'finance.expense.submitted';
    v_from_status  := v_exp.status;
    v_to_status    := 'submitted';
    v_owner        := v_exp.claimant_id;
    v_ref          := v_exp.claim_no;
    v_prior_wf     := v_exp.workflow_id;
    v_biz_module   := 'finance_expenses';
    v_event_type   := 'finance.expense.submitted';
    v_entity_type  := 'expense_claim';
    v_audit_action := 'expense.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'claimNo', v_ref, 'sourceType', 'expense_claim', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hse_hazards' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_haz from public.hse_hazards where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: hazard % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_haz.status in ('under_review', 'approved', 'archived') then
      raise exception 'workflow_submit: hazard % is % (cannot be submitted)', p_source_id, v_haz.status using errcode = 'WF409';
    end if;
    v_audit_target := 'audit_logs';
    v_module_key   := 'hse_hazards';
    v_workflow_type:= 'hazard_review';
    v_trigger      := 'hazard.submitted';
    v_from_status  := v_haz.status;
    v_to_status    := 'under_review';
    v_owner        := coalesce(v_haz.owner_user_id, p_actor_id);
    v_ref          := v_haz.ref;
    v_prior_wf     := v_haz.workflow_id;
    v_biz_module   := 'hse';
    v_event_type   := 'hse.hazard.submitted';
    v_entity_type  := 'hazard';
    v_audit_action := 'hse.hazard.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'title', v_haz.title, 'sourceType', 'hazard', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hse_risk_assessments' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_hra from public.hse_risk_assessments where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: risk assessment % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_hra.status not in ('draft', 'returned') then
      raise exception 'workflow_submit: risk assessment % is % (only draft/returned can be submitted)', p_source_id, v_hra.status using errcode = 'WF409';
    end if;
    v_audit_target := 'audit_logs';
    v_module_key   := 'hse_risk_assessments';
    v_workflow_type:= 'risk_assessment_review';
    v_trigger      := 'risk_assessment.submitted';
    v_from_status  := v_hra.status;
    v_to_status    := 'under_review';
    v_owner        := coalesce(v_hra.owner_user_id, p_actor_id);
    v_ref          := v_hra.ref;
    v_prior_wf     := v_hra.workflow_id;
    v_biz_module   := 'hse';
    v_event_type   := 'hse.risk_assessment.submitted';
    v_entity_type  := 'risk_assessment';
    v_audit_action := 'hse.risk_assessment.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'title', v_hra.title, 'sourceType', 'risk_assessment', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hse_jsa' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_hjsa from public.hse_jsa where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: jsa % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_hjsa.status not in ('draft', 'returned') then
      raise exception 'workflow_submit: jsa % is % (only draft/returned can be submitted)', p_source_id, v_hjsa.status using errcode = 'WF409';
    end if;
    v_audit_target := 'audit_logs';
    v_module_key   := 'hse_jsa';
    v_workflow_type:= 'jsa_review';
    v_trigger      := 'jsa.submitted';
    v_from_status  := v_hjsa.status;
    v_to_status    := 'under_review';
    v_owner        := coalesce(v_hjsa.owner_user_id, p_actor_id);
    v_ref          := v_hjsa.ref;
    v_prior_wf     := v_hjsa.workflow_id;
    v_biz_module   := 'hse';
    v_event_type   := 'hse.jsa.submitted';
    v_entity_type  := 'jsa';
    v_audit_action := 'hse.jsa.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'title', v_hjsa.title, 'sourceType', 'jsa', 'submittedBy', p_actor_id);

  else
    raise exception 'workflow_submit: unsupported source table %', p_source_table using errcode = 'WF400';
  end if;

  -- Supersede check (generic).
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

  -- Resolve first-step assignees (generic).
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

  -- Atomic creation.
  v_res := wf_internal._create_instance(
    p_binding_id, null, null, v_module_key, v_workflow_type, p_source_id, v_ref,
    v_trigger, p_actor_id, v_owner, null, null, v_priority,
    v_source_ctx, v_assignees, v_supersedes);
  v_wf_id := (v_res->>'workflowId')::uuid;

  -- Source transition (per-table columns).
  if p_source_table = 'finance_payroll_runs' then
    update public.finance_payroll_runs
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'payroll_payslip_templates' then
    update public.payroll_payslip_templates
       set status = v_to_status, workflow_id = v_wf_id, submitted_by = p_actor_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_remittances' then
    update public.finance_remittances
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_employee_loans' then
    update public.finance_employee_loans
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_statutory_versions' then
    update public.finance_statutory_versions
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'hr_employee_pay_items' then
    update public.hr_employee_pay_items
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_disbursements' then
    update public.finance_disbursements
       set status = v_to_status, workflow_id = v_wf_id,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('submittedAt', now())
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_expense_claims' then
    update public.finance_expense_claims
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'hse_hazards' then
    update public.hse_hazards
       set status = v_to_status, workflow_id = v_wf_id, updated_at = now()
     where id = p_source_id::uuid;
  elsif p_source_table = 'hse_risk_assessments' then
    update public.hse_risk_assessments
       set status = v_to_status, workflow_id = v_wf_id, updated_at = now()
     where id = p_source_id::uuid;
  elsif p_source_table = 'hse_jsa' then
    update public.hse_jsa
       set status = v_to_status, workflow_id = v_wf_id, updated_at = now()
     where id = p_source_id::uuid;
  end if;

  -- Business event + module audit (per-branch: HSE writes audit_logs with the REF as
  -- entity id; finance/HR write hr_audit_log with the uuid). v_event_id is returned so
  -- the caller can link the (post-commit, broadcast) notification to the event row.
  if v_audit_target = 'audit_logs' then
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_ref, p_actor_id, 'info',
       jsonb_build_object('title', p_business->>'title', 'note', p_business->>'note',
                          'workflowId', v_wf_id, 'fromStatus', v_from_status),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.audit_logs (action, table_name, record_id, user_id, changes, created_at)
    values
      (v_audit_action, v_entity_type, v_ref, p_actor_id,
       jsonb_build_object('fromStatus', v_from_status, 'toStatus', v_to_status,
                          'workflowId', v_wf_id, 'title', p_business->>'title'),
       now());
  else
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, p_source_id, p_actor_id, 'info',
       jsonb_build_object('ref', v_ref, 'workflowId', v_wf_id, 'fromStatus', v_from_status),
       v_event_type || ':' || p_source_id || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.hr_audit_log
      (submodule_key, record_id, actor_id, action, previous_state, new_state)
    values
      (v_biz_module, p_source_id, p_actor_id, v_audit_action,
       jsonb_build_object('status', v_from_status),
       jsonb_build_object('status', v_to_status, 'workflowId', v_wf_id));
  end if;

  -- Handoff intent (per-table). Only payroll runs hand off; all others none.
  if p_source_table = 'finance_payroll_runs' then
    insert into public.handoff_outbox
      (source_module, target_module, source_entity_type, source_entity_id, target_entity_type, payload, status, created_by)
    values
      (v_biz_module, v_biz_module, 'payroll_run', p_source_id, 'payroll_approval',
       jsonb_build_object('runNo', v_ref, 'periodMonth', v_period_month, 'workflowId', v_wf_id, 'submittedBy', p_actor_id),
       'pending', p_actor_id);
  end if;

  v_result := jsonb_build_object(
    'workflowId', v_wf_id, 'workflowNo', v_res->>'workflowNo',
    'status', v_to_status, 'fromStatus', v_from_status,
    'firstTasks', coalesce(v_res->'firstTasks', '[]'::jsonb),
    'supersededWorkflowId', v_supersedes,
    'businessEventId', v_event_id);

  perform wf_internal._record_request(v_receipt_key, v_hash, 'submit', v_module_key, p_source_id, v_wf_id, v_result);

  return v_result;
end
$fn$;

revoke all    on function public.workflow_submit_for_record_tx(text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.workflow_submit_for_record_tx(text, text, text, uuid, text, jsonb) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
