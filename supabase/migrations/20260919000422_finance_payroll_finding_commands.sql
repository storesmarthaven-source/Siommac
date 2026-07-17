-- ============================================================================
-- Finance payroll control-finding commands and submission invariants
-- ============================================================================

create table if not exists public.finance_payroll_finding_command_receipts (
  id               uuid primary key default gen_random_uuid(),
  request_key      text not null unique,
  request_hash     text not null,
  finding_id       uuid not null references public.finance_payroll_control_findings(id) on delete cascade,
  actor_id         text references public.app_users(id) on delete set null,
  command          text not null,
  result           jsonb not null,
  created_at       timestamptz not null default now()
);
create index if not exists finance_payroll_finding_receipts_finding_idx
  on public.finance_payroll_finding_command_receipts(finding_id, created_at desc);
alter table public.finance_payroll_finding_command_receipts enable row level security;
grant select, insert, update, delete on public.finance_payroll_finding_command_receipts to service_role;

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
  if p_command not in ('assign','resolve','waive','reopen') then
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

  if p_command = 'assign' then
    if v_finding.state not in ('open','in_progress') then
      raise exception 'finance_payroll_finding: only open findings can be assigned'
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

-- The invariant belongs at the database transition boundary. It therefore also
-- protects service-role scripts and future callers, not only the current Hono
-- submit route.
create or replace function public.finance_payroll_guard_submission()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_cert   public.finance_payroll_certifications%rowtype;
  v_state  jsonb;
begin
  if new.status = 'pending_approval'
     and old.status is distinct from 'pending_approval' then
    if old.status not in ('calculated','returned') then
      raise exception 'finance_payroll_submit: run % cannot transition from % to pending approval',
        new.id, old.status using errcode = 'PR409';
    end if;
    if new.current_calculation_version_id is null then
      raise exception 'finance_payroll_submit: a current calculation version is required'
        using errcode = 'PR422';
    end if;

    if exists (
      select 1
        from public.finance_payroll_calculation_attempts a
       where a.run_id = new.id
         and a.status = 'running'
    ) then
      raise exception 'finance_payroll_submit: calculation is still running'
        using errcode = 'PR409';
    end if;

    if exists (
      select 1
        from public.finance_payroll_control_findings f
       where f.run_id = new.id
         and f.calculation_version_id = new.current_calculation_version_id
         and f.severity = 'blocker'
         and f.state <> 'resolved'
    ) then
      raise exception 'finance_payroll_submit: unresolved blockers must be resolved before submission'
        using errcode = 'PR422';
    end if;

    select *
      into v_cert
      from public.finance_payroll_certifications c
     where c.run_id = new.id
       and c.calculation_version_id = new.current_calculation_version_id
       and c.certification_type = 'processor'
     order by c.certified_at desc, c.certification_no desc
     limit 1
     for share;
    if not found then
      raise exception 'finance_payroll_submit: certify the current calculation before submission'
        using errcode = 'PR422';
    end if;

    v_state := public.finance_payroll_certification_state(
      new.id,
      new.current_calculation_version_id
    );
    if coalesce((v_state->>'ready')::boolean, false) is not true
       or v_cert.state_checksum is distinct from v_state->>'stateChecksum' then
      raise exception 'finance_payroll_submit: certification is stale; review and certify the current controls again'
        using errcode = 'PR409';
    end if;
    if old.status = 'returned'
       and v_cert.certified_at <= old.updated_at then
      raise exception 'finance_payroll_submit: a returned run must be recertified before resubmission'
        using errcode = 'PR422';
    end if;

    new.approval_certification_id := v_cert.id;
  end if;

  return new;
end
$fn$;

drop trigger if exists trg_finance_payroll_guard_submission
  on public.finance_payroll_runs;
create trigger trg_finance_payroll_guard_submission
  before update of status on public.finance_payroll_runs
  for each row execute function public.finance_payroll_guard_submission();

revoke all on function public.finance_payroll_finding_command_tx(
  uuid, text, integer, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.finance_payroll_finding_command_tx(
  uuid, text, integer, text, text, text, text, jsonb, timestamptz
) to service_role;

revoke all on function public.finance_payroll_guard_submission()
  from public, anon, authenticated;

-- Granular finding permissions. Existing payroll-run managers receive
-- assign/resolve/reopen; existing payroll approvers receive waiver authority.
insert into public.role_permissions (role_name, permission)
select rp.role_name, p.permission
from public.role_permissions rp
cross join (
  values
    ('finance.payroll.finding.assign'),
    ('finance.payroll.finding.resolve'),
    ('finance.payroll.finding.reopen')
) as p(permission)
where rp.permission = 'finance.payroll.run.manage'
on conflict (role_name, permission) do nothing;

insert into public.role_permissions (role_name, permission)
select rp.role_name, 'finance.payroll.finding.waive'
from public.role_permissions rp
where rp.permission = 'finance.payroll.approve'
on conflict (role_name, permission) do nothing;

-- PostgREST schema cache is refreshed by the operator after migration apply.
