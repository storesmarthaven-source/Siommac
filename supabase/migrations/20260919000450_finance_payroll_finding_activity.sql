-- ============================================================================
-- Payroll Exceptions & Approvals (§15.3)
--   1. finance_payroll_finding_activity — append-only per-finding activity/comment log.
--   2. finance_payroll_finding_command_tx — SUPERSEDES 20260919000422's definition:
--      adds the `escalate` command (merged into the assign branch) and writes one
--      activity row per state-changing command (assign/escalate/resolve/waive/reopen).
--   3. finance_payroll_finding_comment_tx — NEW sibling RPC for `comment`. Comments are
--      non-state-change annotations allowed on FROZEN (submitted) runs, so they must NOT
--      pass through the command RPC's post-submission freeze; no version bump.
-- No new permission keys: escalate reuses finance.payroll.finding.assign (DEC-EXC-007),
-- comment gates finance.payroll.view_all at the route.
-- ============================================================================

-- ── 1. Append-only activity / comment log ──────────────────────────────────
create table if not exists public.finance_payroll_finding_activity (
  id             uuid primary key default gen_random_uuid(),
  finding_id     uuid not null references public.finance_payroll_control_findings(id) on delete cascade,
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  actor_id       text references public.app_users(id) on delete set null,
  activity_type  text not null
                 check (activity_type in ('created','assign','escalate','comment','resolve','waive','reopen')),
  body           text,
  from_state     text,
  to_state       text,
  metadata       jsonb,
  finding_version integer,
  created_at     timestamptz not null default now()
);

create index if not exists finance_payroll_finding_activity_finding_idx
  on public.finance_payroll_finding_activity(finding_id, created_at desc);
create index if not exists finance_payroll_finding_activity_run_idx
  on public.finance_payroll_finding_activity(run_id);

alter table public.finance_payroll_finding_activity enable row level security;
revoke all on public.finance_payroll_finding_activity from public, anon, authenticated;
-- Append-only is enforced by the GRANT, not a BEFORE UPDATE trigger (deliberate).
-- service_role gets SELECT/INSERT/DELETE only (no UPDATE), so the application can never
-- overwrite a row. Crucially, this lets the `actor_id ON DELETE SET NULL` referential
-- action proceed when a user is deleted (a system cascade is not subject to column grants),
-- avoiding the evidence-table FK trap where a BEFORE UPDATE immutability trigger blocks the
-- SET NULL and makes user deletion fail (the finance_payroll_calculation_versions lesson).
-- DELETE stays available for retention / sweeper cleanup; rows also cascade from finding/run.
grant select, insert, delete on public.finance_payroll_finding_activity to service_role;

comment on table public.finance_payroll_finding_activity is
  'Append-only activity + comment feed for payroll control findings (spec §15.3). One row per '
  'assign/escalate/comment/resolve/waive/reopen; backs the finding-detail activity feed.';

-- ── 2. Command RPC (supersedes 20260919000422): + escalate, + activity write ──
create or replace function public.finance_payroll_finding_command_tx(
  p_finding_id        uuid,
  p_actor_id          text,
  p_expected_version  integer,
  p_command           text,
  p_idempotency_key   text,
  p_assignee_id       text default null,
  p_note              text default null,
  p_evidence          jsonb default null,
  p_waiver_expires_at timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_request_key   text;
  v_hash          text;
  v_receipt       public.finance_payroll_finding_command_receipts%rowtype;
  v_finding       public.finance_payroll_control_findings%rowtype;
  v_run           public.finance_payroll_runs%rowtype;
  v_run_id        uuid;
  v_previous      jsonb;
  v_event_id      uuid;
  v_result        jsonb;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_finding: actor is required' using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_finding: actor is not an active user'
      using errcode = 'PR403';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_finding: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if p_command not in ('assign','escalate','resolve','waive','reopen') then
    raise exception 'finance_payroll_finding: unsupported command %', p_command
      using errcode = 'PR400';
  end if;
  if coalesce(p_expected_version, 0) <= 0 then
    raise exception 'finance_payroll_finding: expected version is required'
      using errcode = 'PR400';
  end if;
  if p_evidence is not null and jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'finance_payroll_finding: evidence must be a JSON object'
      using errcode = 'PR400';
  end if;

  v_request_key := p_actor_id || '|payroll_finding.' || p_command || '|' ||
    btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'findingId', p_finding_id,
    'actorId', p_actor_id,
    'expectedVersion', p_expected_version,
    'command', p_command,
    'assigneeId', p_assignee_id,
    'note', nullif(btrim(coalesce(p_note, '')), ''),
    'evidence', p_evidence,
    'waiverExpiresAt', p_waiver_expires_at
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_finding_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_finding: idempotency key was already used for a different command'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  -- All payroll lifecycle commands lock the run first. Following the same lock
  -- order serializes finding changes against submission and avoids a cycle
  -- where a blocker can be reopened while the run is being submitted.
  select run_id
    into v_run_id
    from public.finance_payroll_control_findings
   where id = p_finding_id;
  if not found then
    raise exception 'finance_payroll_finding: finding % was not found', p_finding_id
      using errcode = 'PR404';
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = v_run_id
   for update;
  if not found then
    raise exception 'finance_payroll_finding: payroll run % was not found', v_run_id
      using errcode = 'PR404';
  end if;

  select *
    into v_finding
    from public.finance_payroll_control_findings
   where id = p_finding_id
     and run_id = v_run.id
   for update;
  if not found then
    raise exception 'finance_payroll_finding: finding % changed while acquiring its run lock',
      p_finding_id using errcode = 'PR409';
  end if;
  if v_finding.version <> p_expected_version then
    raise exception 'finance_payroll_finding: stale version; current version is %',
      v_finding.version using errcode = 'PR409';
  end if;
  if v_run.status in (
    'pending_approval','approved','locked','released','exported'
  ) then
    raise exception 'finance_payroll_finding: findings are frozen after submission; return or reopen the run first'
      using errcode = 'PR409';
  end if;

  v_previous := jsonb_build_object(
    'state', v_finding.state,
    'version', v_finding.version,
    'assigneeId', v_finding.assignee_id,
    'resolvedBy', v_finding.resolved_by,
    'resolvedAt', v_finding.resolved_at,
    'waivedBy', v_finding.waived_by,
    'waivedAt', v_finding.waived_at
  );

  if p_command in ('assign','escalate') then
    -- escalate is a reassignment: same effect as assign (owner + in_progress + version bump),
    -- distinguished only by the event/audit/activity label and its own permission at the route.
    if v_finding.state not in ('open','in_progress') then
      raise exception 'finance_payroll_finding: only open findings can be assigned or escalated'
        using errcode = 'PR409';
    end if;
    if p_assignee_id is null or btrim(p_assignee_id) = '' then
      raise exception 'finance_payroll_finding: assignee is required'
        using errcode = 'PR422';
    end if;
    if not exists (
      select 1
        from public.app_users
       where id = p_assignee_id
         and status = 'active'
    ) then
      raise exception 'finance_payroll_finding: assignee is not an active user'
        using errcode = 'PR422';
    end if;

    update public.finance_payroll_control_findings
       set assignee_id = p_assignee_id,
           state = 'in_progress',
           version = version + 1
     where id = p_finding_id
    returning * into v_finding;

  elsif p_command = 'resolve' then
    if v_finding.state not in ('open','in_progress') then
      raise exception 'finance_payroll_finding: only open findings can be resolved'
        using errcode = 'PR409';
    end if;
    if p_note is null or btrim(p_note) = '' then
      raise exception 'finance_payroll_finding: a resolution note is required'
        using errcode = 'PR422';
    end if;
    if p_evidence is null or p_evidence = '{}'::jsonb then
      raise exception 'finance_payroll_finding: resolution evidence is required'
        using errcode = 'PR422';
    end if;

    update public.finance_payroll_control_findings
       set state = 'resolved',
           resolution_note = btrim(p_note),
           resolution_evidence = p_evidence,
           resolved_by = p_actor_id,
           resolved_at = now(),
           waiver_reason = null,
           waived_by = null,
           waived_at = null,
           waiver_expires_at = null,
           version = version + 1
     where id = p_finding_id
    returning * into v_finding;

  elsif p_command = 'waive' then
    if v_finding.state not in ('open','in_progress') then
      raise exception 'finance_payroll_finding: only open findings can be waived'
        using errcode = 'PR409';
    end if;
    if v_finding.severity = 'blocker' then
      raise exception 'finance_payroll_finding: blockers cannot be waived'
        using errcode = 'PR422';
    end if;
    if p_note is null or btrim(p_note) = '' then
      raise exception 'finance_payroll_finding: a waiver reason is required'
        using errcode = 'PR422';
    end if;
    if p_waiver_expires_at is not null and p_waiver_expires_at <= now() then
      raise exception 'finance_payroll_finding: waiver expiry must be in the future'
        using errcode = 'PR422';
    end if;

    update public.finance_payroll_control_findings
       set state = 'waived',
           waiver_reason = btrim(p_note),
           waived_by = p_actor_id,
           waived_at = now(),
           waiver_expires_at = p_waiver_expires_at,
           resolution_note = null,
           resolution_evidence = null,
           resolved_by = null,
           resolved_at = null,
           version = version + 1
     where id = p_finding_id
    returning * into v_finding;

  else
    if v_finding.state not in ('resolved','waived') then
      raise exception 'finance_payroll_finding: only resolved or waived findings can be reopened'
        using errcode = 'PR409';
    end if;
    if p_note is null or btrim(p_note) = '' then
      raise exception 'finance_payroll_finding: a reopen reason is required'
        using errcode = 'PR422';
    end if;

    update public.finance_payroll_control_findings
       set state = 'open',
           resolution_note = null,
           resolution_evidence = null,
           resolved_by = null,
           resolved_at = null,
           waiver_reason = null,
           waived_by = null,
           waived_at = null,
           waiver_expires_at = null,
           version = version + 1
     where id = p_finding_id
    returning * into v_finding;
  end if;

  -- Keep the raw engine-warning projection aligned for existing consumers while
  -- the normalized finding remains the authoritative operational control.
  if v_finding.source_type = 'calculation_warning'
     and v_finding.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    if p_command in ('resolve','waive') then
      update public.finance_payroll_run_warnings
         set resolved = true,
             resolved_by = p_actor_id,
             resolved_at = now(),
             metadata = metadata || jsonb_build_object(
               'controlFindingId', v_finding.id,
               'controlFindingState', v_finding.state,
               'controlFindingVersion', v_finding.version
             )
       where id = v_finding.source_id::uuid
         and calculation_version_id = v_finding.calculation_version_id;
    elsif p_command = 'reopen' then
      update public.finance_payroll_run_warnings
         set resolved = false,
             resolved_by = null,
             resolved_at = null,
             metadata = metadata || jsonb_build_object(
               'controlFindingId', v_finding.id,
               'controlFindingState', v_finding.state,
               'controlFindingVersion', v_finding.version
             )
       where id = v_finding.source_id::uuid
         and calculation_version_id = v_finding.calculation_version_id;
    end if;
  end if;

  insert into public.app_events (
    event_type,
    source_module,
    source_entity_type,
    source_entity_id,
    actor_user_id,
    severity,
    payload,
    dedupe_key
  ) values (
    'finance.payroll.finding.' || p_command,
    'finance_payroll',
    'payroll_control_finding',
    v_finding.id::text,
    p_actor_id,
    case v_finding.severity
      when 'blocker' then 'high'
      when 'warning' then 'warning'
      else 'info'
    end,
    jsonb_build_object(
      'runId', v_finding.run_id,
      'calculationVersionId', v_finding.calculation_version_id,
      'findingType', v_finding.finding_type,
      'state', v_finding.state,
      'version', v_finding.version,
      'assigneeId', v_finding.assignee_id,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    ),
    'finance.payroll.finding.' || p_command || ':' || v_finding.id::text ||
      ':' || v_finding.version::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    employee_id,
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state,
    reason
  ) values (
    v_finding.employee_id,
    'finance_payroll',
    v_finding.id::text,
    p_actor_id,
    'payroll_finding.' || p_command,
    v_previous,
    jsonb_build_object(
      'state', v_finding.state,
      'version', v_finding.version,
      'assigneeId', v_finding.assignee_id,
      'resolvedBy', v_finding.resolved_by,
      'resolvedAt', v_finding.resolved_at,
      'waivedBy', v_finding.waived_by,
      'waivedAt', v_finding.waived_at
    ),
    nullif(btrim(coalesce(p_note, '')), '')
  );

  -- §15.3 activity feed: one append-only row per state-changing command.
  insert into public.finance_payroll_finding_activity (
    finding_id, run_id, actor_id, activity_type, body,
    from_state, to_state, metadata, finding_version
  ) values (
    v_finding.id,
    v_finding.run_id,
    p_actor_id,
    p_command,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_previous->>'state',
    v_finding.state,
    jsonb_build_object(
      'assigneeId', v_finding.assignee_id,
      'previousAssigneeId', v_previous->>'assigneeId',
      'eventId', v_event_id
    ),
    v_finding.version
  );

  v_result := jsonb_build_object(
    'finding', to_jsonb(v_finding),
    'eventId', v_event_id,
    'duplicate', false
  );

  insert into public.finance_payroll_finding_command_receipts (
    request_key,
    request_hash,
    finding_id,
    actor_id,
    command,
    result
  ) values (
    v_request_key,
    v_hash,
    v_finding.id,
    p_actor_id,
    p_command,
    v_result
  );

  return v_result;
end
$fn$;

-- ── 3. Comment RPC (NEW): append-only annotation, no state change, no freeze ──
create or replace function public.finance_payroll_finding_comment_tx(
  p_finding_id      uuid,
  p_actor_id        text,
  p_idempotency_key text,
  p_body            text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_request_key text;
  v_hash        text;
  v_receipt     public.finance_payroll_finding_command_receipts%rowtype;
  v_finding     public.finance_payroll_control_findings%rowtype;
  v_activity_id uuid;
  v_event_id    uuid;
  v_result      jsonb;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_finding: actor is required' using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_finding: actor is not an active user' using errcode = 'PR403';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_finding: idempotency key is required' using errcode = 'PR400';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'finance_payroll_finding: a comment body is required' using errcode = 'PR422';
  end if;
  if length(btrim(p_body)) > 4000 then
    raise exception 'finance_payroll_finding: comment exceeds 4000 characters' using errcode = 'PR422';
  end if;

  v_request_key := p_actor_id || '|payroll_finding.comment|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'findingId', p_finding_id, 'actorId', p_actor_id, 'body', btrim(p_body)
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_finding_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_finding: idempotency key was already used for a different comment'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  -- Comment is a non-state-change annotation: it does NOT lock/freeze the run and is
  -- allowed on submitted/pending-approval runs so reviewers can annotate during triage.
  select *
    into v_finding
    from public.finance_payroll_control_findings
   where id = p_finding_id;
  if not found then
    raise exception 'finance_payroll_finding: finding % was not found', p_finding_id
      using errcode = 'PR404';
  end if;

  insert into public.finance_payroll_finding_activity (
    finding_id, run_id, actor_id, activity_type, body, finding_version, metadata
  ) values (
    v_finding.id, v_finding.run_id, p_actor_id, 'comment', btrim(p_body), v_finding.version,
    jsonb_build_object('findingType', v_finding.finding_type, 'state', v_finding.state)
  ) returning id into v_activity_id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'finance.payroll.finding.comment', 'finance_payroll', 'payroll_control_finding', v_finding.id::text,
    p_actor_id, 'info',
    jsonb_build_object(
      'runId', v_finding.run_id, 'activityId', v_activity_id,
      'state', v_finding.state, 'version', v_finding.version
    ),
    'finance.payroll.finding.comment:' || v_activity_id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    employee_id, submodule_key, record_id, actor_id, action, previous_state, new_state, reason
  ) values (
    v_finding.employee_id, 'finance_payroll', v_finding.id::text, p_actor_id, 'payroll_finding.comment',
    null,
    jsonb_build_object('activityId', v_activity_id, 'state', v_finding.state, 'version', v_finding.version),
    btrim(p_body)
  );

  v_result := jsonb_build_object(
    'finding', to_jsonb(v_finding),
    'activityId', v_activity_id,
    'eventId', v_event_id,
    'duplicate', false
  );

  insert into public.finance_payroll_finding_command_receipts (
    request_key, request_hash, finding_id, actor_id, command, result
  ) values (v_request_key, v_hash, v_finding.id, p_actor_id, 'comment', v_result);

  return v_result;
end
$fn$;

-- ── 4. Grants (re-issued for both functions) ────────────────────────────────
revoke all on function public.finance_payroll_finding_command_tx(
  uuid, text, integer, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.finance_payroll_finding_command_tx(
  uuid, text, integer, text, text, text, text, jsonb, timestamptz
) to service_role;

revoke all on function public.finance_payroll_finding_comment_tx(
  uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.finance_payroll_finding_comment_tx(
  uuid, text, text, text
) to service_role;

-- No new role_permissions: escalate reuses finance.payroll.finding.assign (already granted
-- in 20260919000422); comment gates finance.payroll.view_all at the route (DEC-EXC-007).
-- PostgREST schema cache is refreshed by the operator after migration apply.
