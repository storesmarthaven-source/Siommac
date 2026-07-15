-- ============================================================================
-- ALL review-remediation migrations, in order, in one file (commit 6782fe05).
-- Run with psql (best) or paste into a PLAIN Supabase SQL Editor tab and Run.
-- Do NOT run through the Supabase AI Assistant — it truncates plpgsql functions
-- and appends bogus "ALTER TABLE v_inst ..." lines (unterminated dollar-quote error).
--   psql "postgresql://postgres:[PWD]@db.gaflqcwcrvnusnlghwej.supabase.co:5432/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/apply-review-migrations.sql
-- If step 3 (230) aborts naming a realtime table, that table is genuinely
-- exposed and needs a scoped anon-read policy before this can pass.
-- ============================================================================


-- ####################################################################
-- 20260628100000_communication_signals_realtime.sql
-- ####################################################################
-- ─────────────────────────────────────────────────────────────────────────────
-- Make the realtime "instant update" path actually work.
--
-- The FE (useRealtimeSignals) subscribes to postgres_changes on
-- communication_signals to refresh the unread badges + thread highlights the
-- moment a message/notification arrives. Supabase Realtime only delivers a row
-- change to a browser when BOTH are true:
--   1. the table is in the `supabase_realtime` publication, and
--   2. RLS lets the subscribing client (anon key) SELECT the row.
-- The original migration did neither (it only left a comment), so the browser
-- subscription connected but never received anything — badges/highlights only
-- refreshed on the 2-min poll. Signal rows carry NO business data or PII (just
-- channel_key, domain, created_at), so anon SELECT is safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Publish the table for Realtime (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'communication_signals'
  ) then
    alter publication supabase_realtime add table public.communication_signals;
  end if;
end $$;

-- 2. Allow the realtime client to read signal rows (no PII; required for delivery).
drop policy if exists "realtime read communication_signals" on public.communication_signals;
create policy "realtime read communication_signals"
  on public.communication_signals
  for select
  to anon, authenticated
  using (true);


-- ####################################################################
-- 20260919000160_workflow_decide_task_tx.sql
-- ####################################################################
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


-- ####################################################################
-- 20260919000210_workflow_creation_foundation.sql
-- ####################################################################
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
  request_hash  text not null,             -- sha256 over all behaviorally-relevant inputs (computed in-RPC)
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


-- ####################################################################
-- 20260919000230_enable_rls_on_all_public_tables.sql
-- ####################################################################
-- ============================================================================
-- SECURITY: enable RLS on every public table that lacks it
-- (Supabase Advisor: rls_disabled_in_public — CRITICAL)
-- ============================================================================
-- A public-schema table with RLS DISABLED is reachable by anyone holding the
-- project's anon key + URL (it's embedded in the frontend) — they can read/write
-- it directly, bypassing the authenticated Netlify JWT API entirely. Confirmed
-- live exposure: `roles` and `role_permissions` (the permission catalogue) were
-- anon-readable — a privilege-escalation vector.
--
-- Spec §3 requires RLS on EVERY table. All ERP data is accessed by the backend
-- via the SERVICE-ROLE key, which BYPASSES RLS — so enabling RLS with NO policies
-- denies the anon/authenticated direct-API path (closing the hole) while the
-- backend keeps working unchanged. Realtime-subscribed tables already have RLS +
-- their own scoped anon-read policies (postgres_changes delivery) and are skipped
-- here so this migration can never remove a needed realtime read path.
--
-- Definitive: loops over the LIVE catalog (relrowsecurity = false), so it fixes
-- exactly the offending tables regardless of which migration created them.
-- Idempotent (re-run enables nothing new). After applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

do $$
declare
  r record;
  v_exposed_realtime text;
  -- Tables the browser subscribes to via Supabase Realtime (postgres_changes).
  -- These need an anon/authenticated SELECT policy for delivery and already carry
  -- RLS + that policy; never blanket-deny them here.
  v_realtime constant text[] := array[
    'communication_signals','notifications','attendance','leave_requests',
    'settings','support_tickets','ticket_replies'
  ];
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'                    -- ordinary tables only
      and c.relrowsecurity = false           -- RLS currently OFF
      and not (c.relname = any(v_realtime))
    order by c.relname
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    raise notice 'RLS enabled on public.%', r.relname;
  end loop;

  -- Fail CLOSED (review finding #5): a realtime table with RLS OFF is still exposed. It
  -- must NOT be blanket-enabled here (that would deny its anon realtime SELECT and break
  -- delivery) — it needs a SCOPED anon-read policy (20260628100000 pattern). Rather than
  -- finish "successfully" while a public table is left anon-reachable, ABORT: apply that
  -- policy migration first, then re-run this one. This migration therefore can never report
  -- success with an exposed table.
  select string_agg(c.relname, ', ' order by c.relname) into v_exposed_realtime
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    and c.relname = any(v_realtime);
  if v_exposed_realtime is not null then
    raise exception 'RLS-hardening ABORTED: realtime table(s) still exposed with RLS off: %. Apply their scoped anon-read policy first (20260628100000 pattern), then re-run this migration. Refusing to report success while a public table is anon-reachable.', v_exposed_realtime;
  end if;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
-- Verify: with the ANON key, `select * from role_permissions limit 1` must now
-- return ZERO rows (RLS on, no policy) instead of the catalogue.


-- ####################################################################
-- 20260919000260_finance_pay_component_pending_create_unique.sql
-- ####################################################################
-- ============================================================================
-- Finance pay-components: prevent duplicate PENDING create requests (review #9)
-- ============================================================================
-- createPayComponent() prechecks for an existing pending CREATE change-request with the
-- same normalized code, but that is precheck-then-insert (TOCTOU): two concurrent
-- submissions both pass the check and insert duplicate pending creates, which then both try
-- to create the same component on approval. Enforce it at the DB with a PARTIAL UNIQUE index
-- over the normalized payload code, scoped to pending creates. (The component row itself is
-- separately uniquely constrained on `code` once approved.)
--
-- The normalization matches the app: input.code.toUpperCase().trim() → upper(btrim(...)).
-- Idempotent. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- Preflight: an existing duplicate pending-create pair would make CREATE UNIQUE INDEX fail
-- with a non-obvious error — surface it so the extras are cancelled first.
do $$
declare v_dupes text;
begin
  select string_agg(code, ', ') into v_dupes from (
    select upper(btrim(payload->>'code')) as code
    from public.finance_pay_component_change_requests
    where change_type = 'create' and status = 'pending_approval'
    group by upper(btrim(payload->>'code'))
    having count(*) > 1
  ) d;
  if v_dupes is not null then
    raise exception 'Cannot enforce pending-create uniqueness: duplicate pending create requests exist for code(s): %. Cancel the extras first, then re-run.', v_dupes;
  end if;
end $$;

create unique index if not exists finance_pay_component_pending_create_code_uidx
  on public.finance_pay_component_change_requests (upper(btrim(payload->>'code')))
  where change_type = 'create' and status = 'pending_approval';

-- After applying:  NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- 20260919000270_seed_employee_number_counter.sql
-- ####################################################################
-- ============================================================================
-- Seed the global EMP reference counter (review #11 — atomic employee numbers)
-- ============================================================================
-- nextEmployeeNumber() previously scanned every EMP-#### and returned max+1 in JS —
-- non-atomic: two concurrent creates read the same max and mint the SAME number. It now
-- uses the transactional increment_ref_counter RPC with a GLOBAL sequence (year sentinel 0,
-- because an employee number carries no year, unlike ORC-2026-#### refs).
--
-- Seed that counter to (current max numeric EMP-#### + 1) so the first atomic allocation
-- CONTINUES the existing sequence instead of restarting at EMP-0001 and colliding. Uses
-- greatest() on conflict so re-running never moves the counter backwards.
-- Idempotent. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.reference_counters (prefix, year, next_number)
select 'EMP', 0,
       coalesce(max((regexp_replace(employee_number, '^EMP-', ''))::int), 0) + 1
from public.app_users
where employee_number ~ '^EMP-\d+$'
on conflict (prefix, year)
  do update set next_number = greatest(public.reference_counters.next_number, excluded.next_number);

-- After applying:  NOTIFY pgrst, 'reload schema';


-- ####################################################################
-- 20260919000280_user_permissions_deny_all.sql
-- ####################################################################
-- ============================================================================
-- SECURITY: user_permissions deny-all to the browser (review finding #4)
-- ============================================================================
-- The phase-8 policy `user_permissions_read_own` used USING(true) — despite its name it let
-- ANYONE holding the anon key SELECT every row, enumerating all user ids and their sensitive
-- allow/deny permission exceptions (a reconnaissance + privilege-escalation aid).
--
-- The app authenticates with a custom Netlify JWT (NOT Supabase auth), so auth.uid() is null
-- in the browser Supabase client and a self-scoped RLS policy could not work anyway. Per-user
-- override loading now goes through the authenticated backend (/getMyPermissionOverrides —
-- service-role, scoped to the JWT actor), and writes/enumeration go through the gated
-- superadmin RBAC routes. The browser therefore needs NO readable policy at all.
--
-- Drop the permissive policy → RLS-on with no policy = deny-all to anon/authenticated;
-- service_role (backend) bypasses RLS and is unaffected. Idempotent.
-- After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

alter table public.user_permissions enable row level security;   -- ensure enabled
drop policy if exists "user_permissions_read_own" on public.user_permissions;

-- No replacement policy: the ONLY legitimate access path is the service-role backend.
-- Verify: with the ANON key, `select * from user_permissions limit 1` must now return ZERO
-- rows (previously it returned the whole table).


-- ####################################################################
-- 20260919000290_hr_position_hierarchy_serialization.sql
-- ####################################################################
-- ============================================================================
-- HR org: serialize position hierarchy changes + one active CR per position (review #7)
-- ============================================================================
-- The reports-to cycle check read the positions graph SEPARATELY from the eventual update,
-- so two concurrent approvals (e.g. A→B and B→A on different positions) could each pass the
-- check before either write landed, committing a cycle. And multiple ACTIVE change requests
-- for the same position could be overlaid in nondeterministic order. This migration closes
-- both: (1) a partial unique index enforcing ONE active change request per position, and
-- (2) a transactional RPC that takes an advisory lock so the cycle check + write are atomic
-- and hierarchy applies run one at a time.
-- Idempotent. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. One active change request per position ────────────────────────────────
-- Preflight: pre-existing duplicate active position CRs would make the index create fail.
do $$
declare v_dupes text;
begin
  select string_agg(entity_id::text, ', ') into v_dupes from (
    select entity_id
    from public.hr_org_change_requests
    where entity_type = 'position'
      and status in ('draft','pending_approval','approved','scheduled')
    group by entity_id having count(*) > 1
  ) d;
  if v_dupes is not null then
    raise exception 'Cannot enforce one-active-CR-per-position: multiple active change requests exist for position(s): %. Cancel the extras first, then re-run.', v_dupes;
  end if;
end $$;

create unique index if not exists hr_org_change_requests_one_active_per_position_uidx
  on public.hr_org_change_requests (entity_id)
  where entity_type = 'position'
    and status in ('draft','pending_approval','approved','scheduled');

-- ── 2. Serialized, cycle-safe reports-to apply ───────────────────────────────
create or replace function public.hr_position_apply_reports_to_tx(p_position_id uuid, p_reports_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor uuid;
  v_guard  int := 0;
begin
  -- Serialize ALL position hierarchy applies. Without this a TS-side cycle check followed by
  -- a separate UPDATE cannot serialize across PostgREST calls: two concurrent approvals each
  -- read the graph before the other's write lands, both pass, and a cycle is committed. A
  -- transaction-scoped advisory lock forces them to run one at a time so the later one sees
  -- the earlier write.
  perform pg_advisory_xact_lock(hashtext('hr_position_hierarchy'));

  if p_reports_to is not null then
    if p_reports_to = p_position_id then
      raise exception 'A position cannot report to itself.' using errcode = 'HR409';
    end if;
    -- Walk the committed reports-to chain up from the proposed parent (under the lock);
    -- reaching the position being updated means this change would close a cycle.
    v_cursor := p_reports_to;
    while v_cursor is not null loop
      v_guard := v_guard + 1;
      if v_guard > 100000 then
        raise exception 'reports-to chain exceeded the depth guard.' using errcode = 'HR409';
      end if;
      if v_cursor = p_position_id then
        raise exception 'This reports-to change would create a position hierarchy cycle.' using errcode = 'HR409';
      end if;
      select reports_to_position_id into v_cursor from public.hr_positions where id = v_cursor;
    end loop;
  end if;

  update public.hr_positions
     set reports_to_position_id = p_reports_to, updated_at = now()
   where id = p_position_id;
  if not found then
    raise exception 'Position % not found.', p_position_id using errcode = 'HR404';
  end if;
end $$;

revoke all on function public.hr_position_apply_reports_to_tx(uuid, uuid) from public;
revoke all on function public.hr_position_apply_reports_to_tx(uuid, uuid) from anon;
revoke all on function public.hr_position_apply_reports_to_tx(uuid, uuid) from authenticated;
grant execute on function public.hr_position_apply_reports_to_tx(uuid, uuid) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- Reload PostgREST schema cache after all of the above.
-- ============================================================================
NOTIFY pgrst, 'reload schema';
