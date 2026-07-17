-- ============================================================================
-- Finance payroll atomic lock and reopen commands
-- ============================================================================
-- Owns the run transition, loan ledger/cache updates, business events, audit,
-- and the payslip-generation handoff in one transaction. Notification delivery
-- remains the engine-wide post-commit event-delivery concern.
-- ============================================================================

create table if not exists public.finance_payroll_lifecycle_command_receipts (
  id             uuid primary key default gen_random_uuid(),
  request_key    text not null unique,
  request_hash   text not null,
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  actor_id       text references public.app_users(id) on delete set null,
  command        text not null check (command in ('lock','reopen')),
  result         jsonb not null,
  created_at     timestamptz not null default now()
);
create index if not exists finance_payroll_lifecycle_receipts_run_idx
  on public.finance_payroll_lifecycle_command_receipts(run_id, created_at desc);
alter table public.finance_payroll_lifecycle_command_receipts enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_lifecycle_command_receipts
  to service_role;

create or replace function public.finance_payroll_lock_run_tx(
  p_run_id          uuid,
  p_actor_id        text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_request_key      text;
  v_hash             text;
  v_receipt          public.finance_payroll_lifecycle_command_receipts%rowtype;
  v_run              public.finance_payroll_runs%rowtype;
  v_version          public.finance_payroll_calculation_versions%rowtype;
  v_cert             public.finance_payroll_certifications%rowtype;
  v_cert_state       jsonb;
  v_event_id         uuid;
  v_handoff_id       uuid;
  v_result           jsonb;
  v_loan_input       record;
  v_loan             public.finance_employee_loans%rowtype;
  v_deduction_id     uuid;
  v_paid             numeric;
  v_balance          numeric;
  v_loan_count       integer := 0;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_lock: actor is required' using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_lock: actor is not an active user'
      using errcode = 'PR403';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_lock: idempotency key is required'
      using errcode = 'PR400';
  end if;

  v_request_key := p_actor_id || '|payroll_run.lock|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor_id
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_lifecycle_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_lock: idempotency key was already used for a different command'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'finance_payroll_lock: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;
  if v_run.status <> 'approved' then
    raise exception 'finance_payroll_lock: run % is % (only approved can be locked)',
      p_run_id, v_run.status
      using errcode = 'PR422';
  end if;
  if v_run.current_input_snapshot_id is null
     or v_run.current_calculation_version_id is null then
    raise exception 'finance_payroll_lock: the approved run has no current input snapshot or calculation version'
      using errcode = 'PR409';
  end if;

  select *
    into v_version
    from public.finance_payroll_calculation_versions
   where id = v_run.current_calculation_version_id
     and run_id = v_run.id
   for share;
  if not found then
    raise exception 'finance_payroll_lock: the current calculation version does not belong to the run'
      using errcode = 'PR409';
  end if;
  if v_version.input_snapshot_id is distinct from v_run.current_input_snapshot_id then
    raise exception 'finance_payroll_lock: the current calculation does not use the current input snapshot'
      using errcode = 'PR409';
  end if;
  if v_version.statutory_version_id is distinct from v_run.statutory_version_id then
    raise exception 'finance_payroll_lock: the current calculation uses a different statutory version'
      using errcode = 'PR409';
  end if;
  if v_version.employee_count is distinct from v_run.employee_count
     or v_version.gross_total is distinct from v_run.gross_total
     or v_version.deduction_total is distinct from v_run.deduction_total
     or v_version.net_total is distinct from v_run.net_total
     or v_version.nis_employer_total is distinct from v_run.nis_employer_total then
    raise exception 'finance_payroll_lock: the run totals do not match the current calculation version'
      using errcode = 'PR409';
  end if;
  if exists (
    select 1
      from public.finance_payroll_run_inputs i
     where i.run_id = v_run.id
       and i.input_snapshot_id is distinct from v_run.current_input_snapshot_id
  ) then
    raise exception 'finance_payroll_lock: the input projection is not on the current snapshot'
      using errcode = 'PR409';
  end if;
  if exists (
    select 1
      from public.finance_payroll_run_lines l
     where l.run_id = v_run.id
       and l.calculation_version_id is distinct from v_run.current_calculation_version_id
  ) then
    raise exception 'finance_payroll_lock: the line projection is not on the current calculation version'
      using errcode = 'PR409';
  end if;
  if (
    select count(*)
      from public.finance_payroll_run_lines l
     where l.run_id = v_run.id
       and l.calculation_version_id = v_run.current_calculation_version_id
  ) <> v_version.employee_count then
    raise exception 'finance_payroll_lock: the current line projection is incomplete'
      using errcode = 'PR409';
  end if;
  if exists (
    select 1
      from public.finance_payroll_calculation_attempts a
     where a.run_id = v_run.id
       and a.status = 'running'
  ) then
    raise exception 'finance_payroll_lock: a calculation attempt is still running'
      using errcode = 'PR409';
  end if;
  if exists (
    select 1
      from public.finance_payroll_control_findings f
     where f.run_id = v_run.id
       and f.calculation_version_id = v_run.current_calculation_version_id
       and f.severity = 'blocker'
       and f.state in ('open','in_progress')
  ) then
    raise exception 'finance_payroll_lock: unresolved blockers remain on the current calculation'
      using errcode = 'PR422';
  end if;
  if v_run.approval_certification_id is null then
    raise exception 'finance_payroll_lock: the approved run has no certification package'
      using errcode = 'PR409';
  end if;
  select *
    into v_cert
    from public.finance_payroll_certifications c
   where c.id = v_run.approval_certification_id
     and c.run_id = v_run.id
     and c.calculation_version_id = v_run.current_calculation_version_id
   for share;
  if not found then
    raise exception 'finance_payroll_lock: the approval certification does not match the current calculation'
      using errcode = 'PR409';
  end if;
  v_cert_state := public.finance_payroll_certification_state(
    v_run.id,
    v_run.current_calculation_version_id
  );
  if coalesce((v_cert_state->>'ready')::boolean, false) is not true
     or v_cert.state_checksum is distinct from v_cert_state->>'stateChecksum' then
    raise exception 'finance_payroll_lock: the approval certification is stale; return and recertify the run'
      using errcode = 'PR409';
  end if;

  if exists (
    select 1
      from public.finance_payroll_run_inputs i
     where i.run_id = v_run.id
       and i.input_snapshot_id = v_run.current_input_snapshot_id
       and i.metadata @> '{"loan":true}'::jsonb
       and (
         nullif(btrim(i.metadata->>'loan_id'), '') is null
         or (i.metadata->>'loan_id') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       )
  ) then
    raise exception 'finance_payroll_lock: a loan input has no valid loan identifier'
      using errcode = 'PR409';
  end if;

  for v_loan_input in
    select
      (i.metadata->>'loan_id')::uuid as loan_id,
      round(sum(i.amount)::numeric, 2) as amount
    from public.finance_payroll_run_inputs i
    where i.run_id = v_run.id
      and i.input_snapshot_id = v_run.current_input_snapshot_id
      and i.metadata @> '{"loan":true}'::jsonb
      and nullif(btrim(i.metadata->>'loan_id'), '') is not null
    group by (i.metadata->>'loan_id')::uuid
    order by (i.metadata->>'loan_id')::uuid
  loop
    if coalesce(v_loan_input.amount, 0) <= 0 then
      raise exception 'finance_payroll_lock: loan % has a non-positive deduction',
        v_loan_input.loan_id
        using errcode = 'PR409';
    end if;

    select *
      into v_loan
      from public.finance_employee_loans
     where id = v_loan_input.loan_id
     for update;
    if not found then
      raise exception 'finance_payroll_lock: loan % was not found', v_loan_input.loan_id
        using errcode = 'PR409';
    end if;
    if v_loan.status <> 'active' then
      raise exception 'finance_payroll_lock: loan % is no longer active; recalculate the run',
        v_loan.id
        using errcode = 'PR409';
    end if;
    if v_loan_input.amount > v_loan.balance + 0.005 then
      raise exception 'finance_payroll_lock: loan % balance changed; recalculate the run',
        v_loan.id
        using errcode = 'PR409';
    end if;

    insert into public.finance_loan_deductions (
      loan_id,
      run_id,
      amount,
      balance_after,
      entry_type
    )
    values (
      v_loan.id,
      v_run.id,
      v_loan_input.amount,
      0,
      'payroll_deduction'
    )
    on conflict (loan_id, run_id) do nothing
    returning id into v_deduction_id;
    if v_deduction_id is null then
      raise exception 'finance_payroll_lock: loan % already has a ledger row for an unlocked run',
        v_loan.id
        using errcode = 'PR409';
    end if;

    select coalesce(sum(d.amount), 0)
      into v_paid
      from public.finance_loan_deductions d
     where d.loan_id = v_loan.id;
    v_balance := greatest(0, round(v_loan.total_repayable - v_paid, 2));

    update public.finance_employee_loans
       set balance = v_balance,
           status = case
             when v_balance <= 0 and status = 'active' then 'settled'
             when v_balance > 0 and status = 'settled' then 'active'
             else status
           end,
           settled_at = case
             when v_balance <= 0 and status = 'active' then now()
             when v_balance > 0 and status = 'settled' then null
             else settled_at
           end
     where id = v_loan.id;

    update public.finance_loan_deductions
       set balance_after = v_balance
     where id = v_deduction_id;

    insert into public.app_events (
      event_type,
      source_module,
      source_entity_type,
      source_entity_id,
      actor_user_id,
      severity,
      payload,
      dedupe_key
    )
    values (
      'finance.loan.deduction_recorded',
      'finance_loan',
      'employee_loan',
      v_loan.id::text,
      p_actor_id,
      'info',
      jsonb_build_object(
        'runId', v_run.id,
        'amount', v_loan_input.amount,
        'balanceAfter', v_balance
      ),
      'finance.loan.deduction_recorded:' || v_deduction_id::text
    );

    insert into public.hr_audit_log (
      submodule_key,
      record_id,
      actor_id,
      action,
      previous_state,
      new_state
    )
    values (
      'finance_loan',
      v_loan.id::text,
      p_actor_id,
      'finance.loan.deduction_recorded',
      jsonb_build_object('balance', v_loan.balance, 'status', v_loan.status),
      jsonb_build_object(
        'balance', v_balance,
        'runId', v_run.id,
        'deductionId', v_deduction_id
      )
    );

    v_loan_count := v_loan_count + 1;
  end loop;

  update public.finance_payroll_runs
     set status = 'locked',
         locked_by = p_actor_id,
         locked_at = now()
   where id = v_run.id
  returning * into v_run;

  insert into public.app_events (
    event_type,
    source_module,
    source_entity_type,
    source_entity_id,
    actor_user_id,
    severity,
    payload,
    dedupe_key
  )
  values (
    'finance.payroll.run.locked',
    'finance_payroll',
    'payroll_run',
    v_run.id::text,
    p_actor_id,
    'success',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'calculationVersionId', v_run.current_calculation_version_id,
      'lockedAt', v_run.locked_at,
      'loanDeductionCount', v_loan_count
    ),
    'finance.payroll.run.locked:' || v_run.id::text || ':' ||
      v_run.current_calculation_version_id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state
  )
  values (
    'finance_payroll',
    v_run.id::text,
    p_actor_id,
    'payroll_run.locked',
    jsonb_build_object('status', 'approved'),
    jsonb_build_object(
      'status', 'locked',
      'lockedAt', v_run.locked_at,
      'calculationVersionId', v_run.current_calculation_version_id
    )
  );

  insert into public.handoff_outbox (
    source_module,
    target_module,
    source_entity_type,
    source_entity_id,
    target_entity_type,
    target_entity_id,
    payload,
    status,
    created_by
  )
  values (
    'finance_payroll',
    'finance_payroll',
    'payroll_run',
    v_run.id::text,
    'payslip_generation',
    v_run.id::text,
    jsonb_build_object(
      'runId', v_run.id,
      'runNo', v_run.run_no,
      'calculationVersionId', v_run.current_calculation_version_id,
      'lockedAt', v_run.locked_at,
      'eventId', v_event_id
    ),
    'pending',
    p_actor_id
  )
  returning id into v_handoff_id;

  v_result := jsonb_build_object(
    'run', to_jsonb(v_run),
    'eventId', v_event_id,
    'handoffId', v_handoff_id,
    'loanDeductionCount', v_loan_count,
    'duplicate', false
  );

  insert into public.finance_payroll_lifecycle_command_receipts (
    request_key,
    request_hash,
    run_id,
    actor_id,
    command,
    result
  )
  values (
    v_request_key,
    v_hash,
    v_run.id,
    p_actor_id,
    'lock',
    v_result
  );

  return v_result;
end
$fn$;

create or replace function public.finance_payroll_reopen_run_tx(
  p_run_id          uuid,
  p_actor_id        text,
  p_reason          text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_request_key       text;
  v_hash              text;
  v_receipt           public.finance_payroll_lifecycle_command_receipts%rowtype;
  v_run               public.finance_payroll_runs%rowtype;
  v_previous          jsonb;
  v_event_id          uuid;
  v_result            jsonb;
  v_loan_id           uuid;
  v_loan              public.finance_employee_loans%rowtype;
  v_paid              numeric;
  v_balance           numeric;
  v_reversed_count    integer := 0;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_reopen: actor is required' using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_reopen: actor is not an active user'
      using errcode = 'PR403';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_reopen: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'finance_payroll_reopen: reason is required'
      using errcode = 'PR422';
  end if;

  v_request_key := p_actor_id || '|payroll_run.reopen|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor_id,
    'reason', btrim(p_reason)
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_lifecycle_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_reopen: idempotency key was already used for a different command'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'finance_payroll_reopen: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;
  if v_run.status in ('released','exported') then
    raise exception 'finance_payroll_reopen: released or exported runs require a correction run'
      using errcode = 'PR422';
  end if;
  if v_run.status <> 'locked' then
    raise exception 'finance_payroll_reopen: run % is % (only locked can be reopened)',
      p_run_id, v_run.status
      using errcode = 'PR422';
  end if;
  if exists (
    select 1
      from public.finance_payroll_calculation_attempts a
     where a.run_id = v_run.id
       and a.status = 'running'
  ) then
    raise exception 'finance_payroll_reopen: a calculation attempt is still running'
      using errcode = 'PR409';
  end if;
  if v_run.gl_journal_id is not null then
    raise exception 'finance_payroll_reopen: reverse the posted GL journal before reopening'
      using errcode = 'PR422';
  end if;
  if exists (
    select 1 from public.finance_payslips p where p.run_id = v_run.id
  ) then
    raise exception 'finance_payroll_reopen: generated payslips prevent reopening; use a correction run'
      using errcode = 'PR422';
  end if;
  if exists (
    select 1 from public.finance_payroll_exports e where e.run_id = v_run.id
  ) then
    raise exception 'finance_payroll_reopen: exported artifacts prevent reopening; use a correction run'
      using errcode = 'PR422';
  end if;
  if exists (
    select 1
      from public.finance_disbursements d
     where d.payroll_run_id = v_run.id
       and d.status <> 'cancelled'
  ) then
    raise exception 'finance_payroll_reopen: an active bank disbursement prevents reopening'
      using errcode = 'PR422';
  end if;
  if exists (
    select 1
      from public.finance_remittances r
     where r.payroll_run_id = v_run.id
       and r.status <> 'cancelled'
  ) then
    raise exception 'finance_payroll_reopen: an active statutory remittance prevents reopening'
      using errcode = 'PR422';
  end if;

  v_previous := jsonb_build_object(
    'status', v_run.status,
    'workflowId', v_run.workflow_id,
    'inputSnapshotId', v_run.current_input_snapshot_id,
    'calculationVersionId', v_run.current_calculation_version_id,
    'lockedBy', v_run.locked_by,
    'lockedAt', v_run.locked_at
  );

  for v_loan_id in
    select distinct d.loan_id
      from public.finance_loan_deductions d
     where d.run_id = v_run.id
       and d.entry_type = 'payroll_deduction'
     order by d.loan_id
  loop
    select *
      into v_loan
      from public.finance_employee_loans
     where id = v_loan_id
     for update;
    if not found then
      raise exception 'finance_payroll_reopen: loan % was not found', v_loan_id
        using errcode = 'PR409';
    end if;

    delete from public.finance_loan_deductions
     where loan_id = v_loan.id
       and run_id = v_run.id
       and entry_type = 'payroll_deduction';

    select coalesce(sum(d.amount), 0)
      into v_paid
      from public.finance_loan_deductions d
     where d.loan_id = v_loan.id;
    v_balance := greatest(0, round(v_loan.total_repayable - v_paid, 2));

    update public.finance_employee_loans
       set balance = v_balance,
           status = case
             when v_balance <= 0 and status = 'active' then 'settled'
             when v_balance > 0 and status = 'settled' then 'active'
             else status
           end,
           settled_at = case
             when v_balance <= 0 and status = 'active' then now()
             when v_balance > 0 and status = 'settled' then null
             else settled_at
           end
     where id = v_loan.id;

    insert into public.app_events (
      event_type,
      source_module,
      source_entity_type,
      source_entity_id,
      actor_user_id,
      severity,
      payload,
      dedupe_key
    )
    values (
      'finance.loan.deduction_reversed',
      'finance_loan',
      'employee_loan',
      v_loan.id::text,
      p_actor_id,
      'warning',
      jsonb_build_object('runId', v_run.id, 'balanceAfter', v_balance),
      'finance.loan.deduction_reversed:' || v_run.id::text || ':' || v_loan.id::text
        || ':' || coalesce(v_previous->>'calculationVersionId', 'none')
    );

    insert into public.hr_audit_log (
      submodule_key,
      record_id,
      actor_id,
      action,
      previous_state,
      new_state,
      reason
    )
    values (
      'finance_loan',
      v_loan.id::text,
      p_actor_id,
      'finance.loan.deduction_reversed',
      jsonb_build_object('balance', v_loan.balance, 'status', v_loan.status),
      jsonb_build_object('balance', v_balance, 'runId', v_run.id),
      btrim(p_reason)
    );

    v_reversed_count := v_reversed_count + 1;
  end loop;

  delete from public.finance_payroll_run_warnings where run_id = v_run.id;
  delete from public.finance_payroll_run_lines where run_id = v_run.id;
  delete from public.finance_payroll_run_inputs where run_id = v_run.id;

  update public.finance_payroll_runs
     set status = 'draft',
         workflow_id = null,
         current_input_snapshot_id = null,
         current_calculation_version_id = null,
         approval_certification_id = null,
         release_certificate_id = null,
         input_locked_by = null,
         input_locked_at = null,
         approved_by = null,
         locked_by = null,
         locked_at = null,
         released_by = null,
         released_at = null,
         reopened_by = p_actor_id,
         reopened_at = now(),
         reopen_reason = btrim(p_reason),
         gross_total = 0,
         deduction_total = 0,
         net_total = 0,
         nis_employer_total = 0,
         employee_count = 0
   where id = v_run.id
  returning * into v_run;

  insert into public.app_events (
    event_type,
    source_module,
    source_entity_type,
    source_entity_id,
    actor_user_id,
    severity,
    payload,
    dedupe_key
  )
  values (
    'finance.payroll.run.reopened',
    'finance_payroll',
    'payroll_run',
    v_run.id::text,
    p_actor_id,
    'warning',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'reason', btrim(p_reason),
      'reopenedAt', v_run.reopened_at,
      'preservedCalculationVersionId', v_previous->>'calculationVersionId',
      'reversedLoanCount', v_reversed_count
    ),
    'finance.payroll.run.reopened:' || v_run.id::text || ':' ||
      coalesce(v_previous->>'calculationVersionId', 'none')
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state,
    reason
  )
  values (
    'finance_payroll',
    v_run.id::text,
    p_actor_id,
    'payroll_run.reopened',
    v_previous,
    jsonb_build_object(
      'status', 'draft',
      'reopenedAt', v_run.reopened_at,
      'preservedCalculationVersionId', v_previous->>'calculationVersionId'
    ),
    btrim(p_reason)
  );

  v_result := jsonb_build_object(
    'run', to_jsonb(v_run),
    'eventId', v_event_id,
    'reversedLoanCount', v_reversed_count,
    'duplicate', false
  );

  insert into public.finance_payroll_lifecycle_command_receipts (
    request_key,
    request_hash,
    run_id,
    actor_id,
    command,
    result
  )
  values (
    v_request_key,
    v_hash,
    v_run.id,
    p_actor_id,
    'reopen',
    v_result
  );

  return v_result;
end
$fn$;

revoke all on function public.finance_payroll_lock_run_tx(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.finance_payroll_reopen_run_tx(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_lock_run_tx(uuid, text, text)
  to service_role;
grant execute on function public.finance_payroll_reopen_run_tx(uuid, text, text, text)
  to service_role;
