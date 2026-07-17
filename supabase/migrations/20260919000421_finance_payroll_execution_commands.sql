-- ============================================================================
-- Finance payroll execution commands
-- ============================================================================
-- Atomic run creation, input snapshot publication, calculation-attempt start,
-- immutable calculation-version publication and durable failure recording.
-- All functions are service-role only and SECURITY INVOKER.
-- ============================================================================

create or replace function public.finance_payroll_create_run_tx(
  p_actor_id             text,
  p_request_key          text,
  p_run_type             text,
  p_period_start         date,
  p_period_end           date,
  p_statutory_version_id uuid,
  p_sequence_no          integer default 1,
  p_source_run_id        uuid default null,
  p_pay_frequency        text default null,
  p_weeks_in_period      numeric default null,
  p_pay_group_id         uuid default null,
  p_pay_date             date default null,
  p_cut_off_date         date default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_scoped_key      text;
  v_hash            text;
  v_existing        public.finance_payroll_runs%rowtype;
  v_group           public.finance_pay_groups%rowtype;
  v_source          public.finance_payroll_runs%rowtype;
  v_statutory       public.finance_statutory_versions%rowtype;
  v_frequency       text;
  v_weeks           numeric;
  v_pay_date        date;
  v_period_month    date;
  v_ref_seq         integer;
  v_run_no          text;
  v_run             public.finance_payroll_runs%rowtype;
begin
  v_pay_date := coalesce(p_pay_date, p_period_end);

  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_create: actor is required' using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_create: actor is not an active user'
      using errcode = 'PR403';
  end if;
  if p_request_key is null or btrim(p_request_key) = '' then
    raise exception 'finance_payroll_create: idempotency key is required' using errcode = 'PR400';
  end if;

  v_scoped_key := p_actor_id || '|payroll_run.create|' || btrim(p_request_key);
  v_hash := md5(jsonb_build_object(
    'actorId', p_actor_id,
    'runType', p_run_type,
    'periodStart', p_period_start,
    'periodEnd', p_period_end,
    'statutoryVersionId', p_statutory_version_id,
    'sequenceNo', p_sequence_no,
    'sourceRunId', p_source_run_id,
    'payFrequency', p_pay_frequency,
    'weeksInPeriod', p_weeks_in_period,
    'payGroupId', p_pay_group_id,
    'payDate', v_pay_date,
    'cutOffDate', p_cut_off_date
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_scoped_key, 0));
  select *
    into v_existing
    from public.finance_payroll_runs
   where creation_request_key = v_scoped_key;
  if found then
    if v_existing.creation_request_hash is distinct from v_hash then
      raise exception 'finance_payroll_create: idempotency key was already used for a different command'
        using errcode = 'PR409';
    end if;
    return to_jsonb(v_existing) || jsonb_build_object('duplicate', true);
  end if;

  if p_run_type not in ('scheduled','off_cycle','correction','final_pay') then
    raise exception 'finance_payroll_create: unsupported run type %', p_run_type
      using errcode = 'PR422';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'finance_payroll_create: a valid period start and end are required'
      using errcode = 'PR422';
  end if;
  if coalesce(p_sequence_no, 0) <= 0 then
    raise exception 'finance_payroll_create: sequence number must be greater than zero'
      using errcode = 'PR422';
  end if;
  if p_run_type = 'scheduled' and p_sequence_no <> 1 then
    raise exception 'finance_payroll_create: scheduled runs always use sequence 1'
      using errcode = 'PR422';
  end if;
  if v_pay_date < p_period_start then
    raise exception 'finance_payroll_create: pay date cannot be before the pay period'
      using errcode = 'PR422';
  end if;
  if p_cut_off_date is not null and p_cut_off_date > v_pay_date then
    raise exception 'finance_payroll_create: cutoff date cannot be after the pay date'
      using errcode = 'PR422';
  end if;

  select *
    into v_statutory
    from public.finance_statutory_versions
   where id = p_statutory_version_id
   for share;
  if not found then
    raise exception 'finance_payroll_create: statutory version % was not found', p_statutory_version_id
      using errcode = 'PR404';
  end if;
  if v_statutory.jurisdiction <> 'TT'
     or not v_statutory.is_active
     or v_statutory.status <> 'active'
     or v_statutory.effective_from > p_period_end then
    raise exception 'finance_payroll_create: statutory version is not active and applicable to this period'
      using errcode = 'PR422';
  end if;

  if p_pay_group_id is not null then
    select *
      into v_group
      from public.finance_pay_groups
     where id = p_pay_group_id
     for share;
    if not found then
      raise exception 'finance_payroll_create: pay group % was not found', p_pay_group_id
        using errcode = 'PR404';
    end if;
    if not v_group.active then
      raise exception 'finance_payroll_create: pay group % is inactive', v_group.code
        using errcode = 'PR422';
    end if;
    if p_pay_frequency is not null and p_pay_frequency <> v_group.frequency then
      raise exception 'finance_payroll_create: pay frequency must match pay group %', v_group.code
        using errcode = 'PR422';
    end if;
    v_frequency := v_group.frequency;
  else
    if p_pay_frequency is null then
      raise exception 'finance_payroll_create: pay frequency is required for an unscoped run'
        using errcode = 'PR422';
    end if;
    v_frequency := p_pay_frequency;
  end if;

  if v_frequency not in ('weekly','fortnightly','semi_monthly','monthly') then
    raise exception 'finance_payroll_create: unsupported pay frequency %', v_frequency
      using errcode = 'PR422';
  end if;

  if p_run_type = 'correction' then
    if p_source_run_id is null then
      raise exception 'finance_payroll_create: correction runs require a released source run'
        using errcode = 'PR422';
    end if;
    select *
      into v_source
      from public.finance_payroll_runs
     where id = p_source_run_id
     for share;
    if not found then
      raise exception 'finance_payroll_create: source run % was not found', p_source_run_id
        using errcode = 'PR404';
    end if;
    if v_source.status <> 'released' then
      raise exception 'finance_payroll_create: correction source run must be released'
        using errcode = 'PR422';
    end if;
    if v_source.pay_group_id is distinct from p_pay_group_id then
      raise exception 'finance_payroll_create: correction run must use the source run pay group'
        using errcode = 'PR422';
    end if;
  elsif p_source_run_id is not null then
    raise exception 'finance_payroll_create: only correction runs accept a source run'
      using errcode = 'PR422';
  end if;

  -- NIBTT contributions are weekly and monthly/fortnightly contribution counts
  -- follow the actual Mondays in the covered period. A short off-cycle period
  -- with no Monday still represents part of one contribution week.
  select greatest(
    1,
    count(*) filter (where extract(isodow from day_value) = 1)
  )::numeric
    into v_weeks
    from generate_series(
      p_period_start::timestamp,
      p_period_end::timestamp,
      interval '1 day'
    ) as day_value;
  if p_weeks_in_period is not null
     and abs(p_weeks_in_period - v_weeks) > 0.000001 then
    raise exception
      'finance_payroll_create: weeks in period must equal the % NIS contribution week(s) in the selected dates',
      v_weeks using errcode = 'PR422';
  end if;

  v_period_month := date_trunc('month', v_pay_date)::date;
  v_ref_seq := public.increment_ref_counter(
    'PAY',
    extract(year from current_date)::integer
  );
  v_run_no := 'PAY-' || extract(year from current_date)::integer::text || '-' ||
    lpad(v_ref_seq::text, greatest(4, length(v_ref_seq::text)), '0');

  begin
    insert into public.finance_payroll_runs (
      run_no,
      period_month,
      run_type,
      period_start,
      period_end,
      sequence_no,
      source_run_id,
      pay_frequency,
      status,
      statutory_version_id,
      weeks_in_period,
      pay_group,
      pay_group_id,
      pay_date,
      cut_off_date,
      created_by,
      creation_request_key,
      creation_request_hash
    ) values (
      v_run_no,
      v_period_month,
      p_run_type,
      p_period_start,
      p_period_end,
      p_sequence_no,
      p_source_run_id,
      v_frequency,
      'draft',
      p_statutory_version_id,
      v_weeks,
      case when p_pay_group_id is null then null else v_group.code end,
      p_pay_group_id,
      v_pay_date,
      p_cut_off_date,
      p_actor_id,
      v_scoped_key,
      v_hash
    )
    returning * into v_run;
  exception
    when unique_violation then
      raise exception 'finance_payroll_create: a non-cancelled run already exists for this pay group, period, type and sequence'
        using errcode = 'PR409';
  end;

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
    'finance.payroll.run.created',
    'finance_payroll',
    'payroll_run',
    v_run.id::text,
    p_actor_id,
    'info',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'runType', v_run.run_type,
      'periodStart', v_run.period_start,
      'periodEnd', v_run.period_end,
      'payGroupId', v_run.pay_group_id
    ),
    'finance.payroll.run.created:' || v_run.id::text
  );

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state
  ) values (
    'finance_payroll',
    v_run.id::text,
    p_actor_id,
    'payroll_run.created',
    null,
    jsonb_build_object(
      'status', v_run.status,
      'runNo', v_run.run_no,
      'runType', v_run.run_type,
      'periodStart', v_run.period_start,
      'periodEnd', v_run.period_end,
      'statutoryVersionId', v_run.statutory_version_id
    )
  );

  return to_jsonb(v_run) || jsonb_build_object('duplicate', false);
end
$fn$;

drop function if exists public.finance_payroll_lock_inputs_tx(
  uuid, text, jsonb, integer, jsonb
);

create or replace function public.finance_payroll_lock_inputs_tx(
  p_run_id         uuid,
  p_actor_id       text,
  p_idempotency_key text,
  p_inputs         jsonb,
  p_employee_count integer,
  p_source_summary jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_run          public.finance_payroll_runs%rowtype;
  v_snapshot     public.finance_payroll_input_snapshots%rowtype;
  v_snapshot_no  integer;
  v_input_count  integer;
  v_checksum     text;
  v_request_key  text;
  v_request_hash text;
  v_receipt      public.finance_payroll_input_lock_receipts%rowtype;
  v_event_id     uuid;
  v_result       jsonb;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_lock_inputs: actor is required' using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_lock_inputs: actor is not an active user'
      using errcode = 'PR403';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_lock_inputs: idempotency key is required'
      using errcode = 'PR400';
  end if;
  v_request_key :=
    p_actor_id || '|payroll_run.lock_inputs|' || btrim(p_idempotency_key);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_input_lock_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.run_id is distinct from p_run_id then
      raise exception
        'finance_payroll_lock_inputs: idempotency key was already used for a different run'
        using errcode = 'PR409';
    end if;
    -- Once the first command commits, retries must replay the durable receipt
    -- without re-reading mutable employee, pay-item, overtime, or loan sources.
    if p_inputs is null
       and p_employee_count is null
       and p_source_summary is null then
      return v_receipt.result || jsonb_build_object('duplicate', true);
    end if;
    if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' then
      raise exception 'finance_payroll_lock_inputs: inputs must be a JSON array'
        using errcode = 'PR400';
    end if;
    if p_source_summary is null
       or jsonb_typeof(p_source_summary) <> 'object' then
      raise exception
        'finance_payroll_lock_inputs: source summary must be a JSON object'
        using errcode = 'PR400';
    end if;
    if p_employee_count is null then
      raise exception 'finance_payroll_lock_inputs: employee count is required'
        using errcode = 'PR400';
    end if;
    v_request_hash := md5(jsonb_build_object(
      'runId', p_run_id,
      'actorId', p_actor_id,
      'inputs', p_inputs,
      'employeeCount', p_employee_count,
      'sourceSummary', p_source_summary
    )::text);
    if v_receipt.request_hash is distinct from v_request_hash then
      raise exception
        'finance_payroll_lock_inputs: idempotency key was already used for different inputs'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  if p_inputs is null
     and p_employee_count is null
     and p_source_summary is null then
    raise exception
      'finance_payroll_lock_inputs: no completed command exists for this idempotency key'
      using errcode = 'PR409';
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' then
    raise exception 'finance_payroll_lock_inputs: inputs must be a JSON array'
      using errcode = 'PR400';
  end if;
  if p_source_summary is null or jsonb_typeof(p_source_summary) <> 'object' then
    raise exception 'finance_payroll_lock_inputs: source summary must be a JSON object'
      using errcode = 'PR400';
  end if;
  if p_employee_count is null then
    raise exception 'finance_payroll_lock_inputs: employee count is required'
      using errcode = 'PR400';
  end if;
  v_checksum := md5(jsonb_build_object(
    'inputs', p_inputs,
    'employeeCount', p_employee_count,
    'sourceSummary', p_source_summary
  )::text);
  v_request_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor_id,
    'inputs', p_inputs,
    'employeeCount', p_employee_count,
    'sourceSummary', p_source_summary
  )::text);

  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'finance_payroll_lock_inputs: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;

  if v_run.status <> 'draft' then
    raise exception
      'finance_payroll_lock_inputs: run % is % (only draft can lock inputs; replay the original idempotency key)',
      p_run_id, v_run.status using errcode = 'PR409';
  end if;

  v_input_count := jsonb_array_length(p_inputs);
  if v_input_count = 0 or p_employee_count <= 0 then
    raise exception 'finance_payroll_lock_inputs: at least one employee input is required'
      using errcode = 'PR422';
  end if;

  select coalesce(max(snapshot_no), 0) + 1
    into v_snapshot_no
    from public.finance_payroll_input_snapshots
   where run_id = p_run_id;

  insert into public.finance_payroll_input_snapshots (
    run_id,
    snapshot_no,
    checksum,
    employee_count,
    input_count,
    source_summary,
    locked_by,
    locked_at
  ) values (
    p_run_id,
    v_snapshot_no,
    v_checksum,
    p_employee_count,
    v_input_count,
    coalesce(p_source_summary, '{}'::jsonb),
    p_actor_id,
    now()
  )
  returning * into v_snapshot;

  delete from public.finance_payroll_run_inputs
   where run_id = p_run_id;

  insert into public.finance_payroll_input_snapshot_lines (
    input_snapshot_id,
    run_id,
    input_row_no,
    employee_id,
    source_type,
    source_id,
    component_code,
    label,
    amount,
    quantity,
    rate,
    metadata,
    row_checksum
  )
  select
    v_snapshot.id,
    p_run_id,
    payload.input_row_no::integer,
    i.employee_id,
    i.source_type,
    i.source_id,
    i.component_code,
    i.label,
    i.amount,
    i.quantity,
    i.rate,
    coalesce(i.metadata, '{}'::jsonb),
    md5(jsonb_build_object(
      'employeeId', i.employee_id,
      'sourceType', i.source_type,
      'sourceId', i.source_id,
      'componentCode', i.component_code,
      'label', i.label,
      'amount', i.amount,
      'quantity', i.quantity,
      'rate', i.rate,
      'metadata', coalesce(i.metadata, '{}'::jsonb)
    )::text)
  from jsonb_array_elements(p_inputs) with ordinality
       as payload(value, input_row_no)
  cross join lateral jsonb_to_record(payload.value) as i(
    employee_id text,
    source_type text,
    source_id text,
    component_code text,
    label text,
    amount numeric,
    quantity numeric,
    rate numeric,
    metadata jsonb
  );

  insert into public.finance_payroll_run_inputs (
    run_id,
    input_snapshot_id,
    employee_id,
    source_type,
    source_id,
    component_code,
    label,
    amount,
    quantity,
    rate,
    metadata
  )
  select
    s.run_id,
    s.input_snapshot_id,
    s.employee_id,
    s.source_type,
    s.source_id,
    s.component_code,
    s.label,
    s.amount,
    s.quantity,
    s.rate,
    s.metadata
  from public.finance_payroll_input_snapshot_lines s
  where s.input_snapshot_id = v_snapshot.id
  order by s.input_row_no;

  if (
    select count(distinct employee_id)
      from public.finance_payroll_input_snapshot_lines
     where input_snapshot_id = v_snapshot.id
  ) <> p_employee_count then
    raise exception 'finance_payroll_lock_inputs: employee count does not match the input payload'
      using errcode = 'PR422';
  end if;

  update public.finance_payroll_runs
     set status = 'input_locked',
         current_input_snapshot_id = v_snapshot.id,
         employee_count = p_employee_count,
         input_locked_by = p_actor_id,
         input_locked_at = v_snapshot.locked_at
   where id = p_run_id
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
  ) values (
    'finance.payroll.run.inputs_locked',
    'finance_payroll',
    'payroll_run',
    p_run_id::text,
    p_actor_id,
    'info',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'snapshotId', v_snapshot.id,
      'employeeCount', p_employee_count,
      'inputCount', v_input_count,
      'checksum', v_checksum
    ),
    'finance.payroll.run.inputs_locked:' || v_snapshot.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state
  ) values (
    'finance_payroll',
    p_run_id::text,
    p_actor_id,
    'payroll_run.inputs_locked',
    jsonb_build_object('status', 'draft'),
    jsonb_build_object(
      'status', 'input_locked',
      'snapshotId', v_snapshot.id,
      'employeeCount', p_employee_count,
      'inputCount', v_input_count,
      'checksum', v_checksum
    )
  );

  v_result := jsonb_build_object(
    'run', to_jsonb(v_run),
    'snapshotId', v_snapshot.id,
    'eventId', v_event_id,
    'duplicate', false
  );

  insert into public.finance_payroll_input_lock_receipts (
    request_key,
    request_hash,
    run_id,
    actor_id,
    snapshot_id,
    result
  )
  values (
    v_request_key,
    v_request_hash,
    v_run.id,
    p_actor_id,
    v_snapshot.id,
    v_result
  );

  return v_result;
end
$fn$;

create or replace function public.finance_payroll_calculation_start_tx(
  p_run_id          uuid,
  p_actor_id        text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_run                 public.finance_payroll_runs%rowtype;
  v_attempt             public.finance_payroll_calculation_attempts%rowtype;
  v_interrupted_attempt public.finance_payroll_calculation_attempts%rowtype;
  v_scoped_key          text;
  v_hash                text;
  v_attempt_no          integer;
  v_event_id            uuid;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_calculation_start: actor is required'
      using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_calculation_start: actor is not an active user'
      using errcode = 'PR403';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_calculation_start: idempotency key is required'
      using errcode = 'PR400';
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'finance_payroll_calculation_start: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;
  if v_run.status not in ('input_locked','calculation_failed','calculated','returned') then
    raise exception 'finance_payroll_calculation_start: run % is % and cannot be calculated',
      p_run_id, v_run.status using errcode = 'PR409';
  end if;
  if v_run.current_input_snapshot_id is null then
    raise exception 'finance_payroll_calculation_start: run has no current input snapshot'
      using errcode = 'PR422';
  end if;

  v_scoped_key := p_actor_id || '|payroll.calculate|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor_id,
    'inputSnapshotId', v_run.current_input_snapshot_id,
    'statutoryVersionId', v_run.statutory_version_id
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_scoped_key, 0));
  select *
    into v_attempt
    from public.finance_payroll_calculation_attempts
   where run_id = p_run_id
     and idempotency_key = v_scoped_key;
  if found then
    if v_attempt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_calculation_start: idempotency key was already used for different inputs'
        using errcode = 'PR409';
    end if;
    if v_attempt.status = 'running' and v_attempt.lease_expires_at <= now() then
      update public.finance_payroll_calculation_attempts
         set stage = 'restarting',
             lease_expires_at = now() + interval '15 minutes'
       where id = v_attempt.id
      returning * into v_attempt;

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
        'finance.payroll.calculation.resumed',
        'finance_payroll',
        'payroll_calculation_attempt',
        v_attempt.id::text,
        p_actor_id,
        'info',
        jsonb_build_object(
          'runId', p_run_id,
          'runNo', v_run.run_no,
          'attemptNo', v_attempt.attempt_no,
          'correlationId', v_attempt.correlation_id,
          'leaseExpiresAt', v_attempt.lease_expires_at
        ),
        'finance.payroll.calculation.resumed:' ||
          v_attempt.id::text || ':' || v_attempt.lease_expires_at::text
      )
      returning id into v_event_id;

      insert into public.hr_audit_log (
        submodule_key,
        record_id,
        actor_id,
        action,
        previous_state,
        new_state
      ) values (
        'finance_payroll',
        p_run_id::text,
        p_actor_id,
        'payroll_calculation.resumed',
        jsonb_build_object('attemptId', v_attempt.id, 'status', 'running'),
        jsonb_build_object(
          'attemptId', v_attempt.id,
          'status', 'running',
          'stage', v_attempt.stage,
          'leaseExpiresAt', v_attempt.lease_expires_at
        )
      );

      return jsonb_build_object(
        'attempt', to_jsonb(v_attempt),
        'eventId', v_event_id,
        'duplicate', false,
        'resumed', true
      );
    end if;
    return jsonb_build_object(
      'attempt', to_jsonb(v_attempt),
      'duplicate', true,
      'resumed', false
    );
  end if;

  update public.finance_payroll_calculation_attempts
     set status = 'failed',
         stage = 'failed',
         error_code = 'PROCESS_INTERRUPTED',
         error_message = 'The calculation worker stopped before publishing a result.',
         completed_at = now()
   where run_id = p_run_id
     and status = 'running'
     and lease_expires_at <= now()
  returning * into v_interrupted_attempt;

  if found then
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
      'finance.payroll.calculation.interrupted',
      'finance_payroll',
      'payroll_calculation_attempt',
      v_interrupted_attempt.id::text,
      p_actor_id,
      'warning',
      jsonb_build_object(
        'runId', p_run_id,
        'runNo', v_run.run_no,
        'attemptNo', v_interrupted_attempt.attempt_no,
        'correlationId', v_interrupted_attempt.correlation_id,
        'errorCode', v_interrupted_attempt.error_code
      ),
      'finance.payroll.calculation.interrupted:' || v_interrupted_attempt.id::text
    );

    insert into public.hr_audit_log (
      submodule_key,
      record_id,
      actor_id,
      action,
      previous_state,
      new_state,
      reason
    ) values (
      'finance_payroll',
      p_run_id::text,
      p_actor_id,
      'payroll_calculation.interrupted',
      jsonb_build_object(
        'attemptId', v_interrupted_attempt.id,
        'status', 'running'
      ),
      jsonb_build_object(
        'attemptId', v_interrupted_attempt.id,
        'status', 'failed',
        'stage', 'failed',
        'errorCode', v_interrupted_attempt.error_code
      ),
      v_interrupted_attempt.error_message
    );
  end if;

  if exists (
    select 1
      from public.finance_payroll_calculation_attempts
     where run_id = p_run_id
       and status = 'running'
  ) then
    raise exception 'finance_payroll_calculation_start: another calculation is already running'
      using errcode = 'PR409';
  end if;

  select coalesce(max(attempt_no), 0) + 1
    into v_attempt_no
    from public.finance_payroll_calculation_attempts
   where run_id = p_run_id;

  insert into public.finance_payroll_calculation_attempts (
    run_id,
    input_snapshot_id,
    attempt_no,
    idempotency_key,
    request_hash,
    status,
    progress,
    stage,
    lease_expires_at,
    created_by
  ) values (
    p_run_id,
    v_run.current_input_snapshot_id,
    v_attempt_no,
    v_scoped_key,
    v_hash,
    'running',
    0,
    'loading_inputs',
    now() + interval '15 minutes',
    p_actor_id
  )
  returning * into v_attempt;

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
    'finance.payroll.calculation.started',
    'finance_payroll',
    'payroll_calculation_attempt',
    v_attempt.id::text,
    p_actor_id,
    'info',
    jsonb_build_object(
      'runId', p_run_id,
      'runNo', v_run.run_no,
      'attemptNo', v_attempt.attempt_no,
      'correlationId', v_attempt.correlation_id,
      'inputSnapshotId', v_attempt.input_snapshot_id
    ),
    'finance.payroll.calculation.started:' || v_attempt.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state
  ) values (
    'finance_payroll',
    p_run_id::text,
    p_actor_id,
    'payroll_calculation.started',
    jsonb_build_object('status', v_run.status),
    jsonb_build_object(
      'attemptId', v_attempt.id,
      'attemptNo', v_attempt.attempt_no,
      'correlationId', v_attempt.correlation_id,
      'inputSnapshotId', v_attempt.input_snapshot_id
    )
  );

  return jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'eventId', v_event_id,
    'duplicate', false
  );
end
$fn$;

create or replace function public.finance_payroll_calculation_publish_tx(
  p_attempt_id      uuid,
  p_actor_id        text,
  p_lines           jsonb,
  p_warnings        jsonb,
  p_totals          jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_attempt        public.finance_payroll_calculation_attempts%rowtype;
  v_run            public.finance_payroll_runs%rowtype;
  v_version        public.finance_payroll_calculation_versions%rowtype;
  v_version_no     integer;
  v_from_status    text;
  v_event_id       uuid;
  v_finding_count  integer;
  v_result_checksum text;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_calculation_publish: actor is required'
      using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_calculation_publish: actor is not an active user'
      using errcode = 'PR403';
  end if;
  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or (p_warnings is not null and jsonb_typeof(p_warnings) <> 'array')
     or p_totals is null
     or jsonb_typeof(p_totals) <> 'object' then
    raise exception 'finance_payroll_calculation_publish: lines, warnings and totals have invalid shapes'
      using errcode = 'PR400';
  end if;
  v_result_checksum := md5(jsonb_build_object(
    'lines', p_lines,
    'warnings', coalesce(p_warnings, '[]'::jsonb),
    'totals', p_totals
  )::text);

  select *
    into v_attempt
    from public.finance_payroll_calculation_attempts
   where id = p_attempt_id;
  if not found then
    raise exception 'finance_payroll_calculation_publish: attempt % was not found', p_attempt_id
      using errcode = 'PR404';
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = v_attempt.run_id
   for update;
  if not found then
    raise exception 'finance_payroll_calculation_publish: run % was not found', v_attempt.run_id
      using errcode = 'PR404';
  end if;

  select *
    into v_attempt
    from public.finance_payroll_calculation_attempts
   where id = p_attempt_id
   for update;

  if v_attempt.status = 'succeeded' then
    select *
      into v_version
      from public.finance_payroll_calculation_versions
     where attempt_id = p_attempt_id;
    if v_version.checksum is distinct from v_result_checksum then
      raise exception 'finance_payroll_calculation_publish: succeeded attempt was replayed with different results'
        using errcode = 'PR409';
    end if;
    return jsonb_build_object(
      'run', to_jsonb(v_run),
      'attempt', to_jsonb(v_attempt),
      'version', to_jsonb(v_version),
      'duplicate', true
    );
  end if;
  if v_attempt.status <> 'running' then
    raise exception 'finance_payroll_calculation_publish: attempt % is % and cannot publish',
      p_attempt_id, v_attempt.status using errcode = 'PR409';
  end if;
  if v_run.status not in ('input_locked','calculation_failed','calculated','returned') then
    raise exception 'finance_payroll_calculation_publish: run % is % and cannot publish',
      v_run.id, v_run.status using errcode = 'PR409';
  end if;
  if v_run.current_input_snapshot_id is distinct from v_attempt.input_snapshot_id then
    raise exception 'finance_payroll_calculation_publish: the run input snapshot changed during calculation'
      using errcode = 'PR409';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'finance_payroll_calculation_publish: no calculated lines were supplied'
      using errcode = 'PR422';
  end if;
  if (p_totals->>'employeeCount')::integer <> jsonb_array_length(p_lines) then
    raise exception 'finance_payroll_calculation_publish: employee count does not match line count'
      using errcode = 'PR422';
  end if;
  if (
    select count(distinct l.employee_id)
      from jsonb_to_recordset(p_lines) as l(employee_id text)
  ) <> jsonb_array_length(p_lines) then
    raise exception 'finance_payroll_calculation_publish: every line requires one unique employee'
      using errcode = 'PR422';
  end if;
  if exists (
    (
      select distinct s.employee_id
        from public.finance_payroll_input_snapshot_lines s
       where s.input_snapshot_id = v_attempt.input_snapshot_id
      except
      select distinct l.employee_id
        from jsonb_to_recordset(p_lines) as l(employee_id text)
    )
    union all
    (
      select distinct l.employee_id
        from jsonb_to_recordset(p_lines) as l(employee_id text)
      except
      select distinct s.employee_id
        from public.finance_payroll_input_snapshot_lines s
       where s.input_snapshot_id = v_attempt.input_snapshot_id
    )
  ) then
    raise exception 'finance_payroll_calculation_publish: calculated employee population does not match the frozen input snapshot'
      using errcode = 'PR422';
  end if;
  if (
    select count(distinct s.employee_id)
      from public.finance_payroll_input_snapshot_lines s
     where s.input_snapshot_id = v_attempt.input_snapshot_id
  ) is distinct from (p_totals->>'employeeCount')::integer then
    raise exception 'finance_payroll_calculation_publish: frozen input employee count does not match calculation totals'
      using errcode = 'PR422';
  end if;

  v_from_status := v_run.status;

  select coalesce(max(version_no), 0) + 1
    into v_version_no
    from public.finance_payroll_calculation_versions
   where run_id = v_run.id;

  insert into public.finance_payroll_calculation_versions (
    run_id,
    attempt_id,
    input_snapshot_id,
    version_no,
    checksum,
    employee_count,
    gross_total,
    deduction_total,
    net_total,
    nis_employer_total,
    statutory_version_id,
    published_by
  ) values (
    v_run.id,
    v_attempt.id,
    v_attempt.input_snapshot_id,
    v_version_no,
    v_result_checksum,
    (p_totals->>'employeeCount')::integer,
    (p_totals->>'grossTotal')::numeric,
    (p_totals->>'deductionTotal')::numeric,
    (p_totals->>'netTotal')::numeric,
    (p_totals->>'nisEmployerTotal')::numeric,
    v_run.statutory_version_id,
    p_actor_id
  )
  returning * into v_version;

  delete from public.finance_payroll_run_lines
   where run_id = v_run.id;
  delete from public.finance_payroll_run_warnings
   where run_id = v_run.id;

  insert into public.finance_payroll_run_lines (
    run_id,
    calculation_version_id,
    employee_id,
    base,
    taxable_gross,
    gross,
    nis_employee,
    nis_employer,
    health_surcharge,
    chargeable_income,
    paye,
    voluntary_deductions,
    net,
    breakdown,
    department_id,
    cost_center_id,
    nis_number_masked,
    nis_status,
    nis_class_no,
    opening_ytd_nis_employee,
    opening_ytd_nis_employer
  )
  select
    v_run.id,
    v_version.id,
    l.employee_id,
    l.base,
    l.taxable_gross,
    l.gross,
    l.nis_employee,
    l.nis_employer,
    l.health_surcharge,
    l.chargeable_income,
    l.paye,
    l.voluntary_deductions,
    l.net,
    coalesce(l.breakdown, '{}'::jsonb),
    l.department_id,
    l.cost_center_id,
    l.nis_number_masked,
    l.nis_status,
    l.nis_class_no,
    coalesce(l.opening_ytd_nis_employee, 0),
    coalesce(l.opening_ytd_nis_employer, 0)
  from jsonb_to_recordset(p_lines) as l(
    employee_id text,
    base numeric,
    taxable_gross numeric,
    gross numeric,
    nis_employee numeric,
    nis_employer numeric,
    health_surcharge numeric,
    chargeable_income numeric,
    paye numeric,
    voluntary_deductions numeric,
    net numeric,
    breakdown jsonb,
    department_id text,
    cost_center_id uuid,
    nis_number_masked text,
    nis_status text,
    nis_class_no integer,
    opening_ytd_nis_employee numeric,
    opening_ytd_nis_employer numeric
  );

  insert into public.finance_payroll_calculation_version_lines (
    calculation_version_id,
    run_id,
    employee_id,
    base,
    taxable_gross,
    gross,
    nis_employee,
    nis_employer,
    health_surcharge,
    chargeable_income,
    paye,
    voluntary_deductions,
    net,
    breakdown,
    department_id,
    cost_center_id,
    nis_number_masked,
    nis_status,
    nis_class_no,
    opening_ytd_nis_employee,
    opening_ytd_nis_employer
  )
  select
    calculation_version_id,
    run_id,
    employee_id,
    base,
    taxable_gross,
    gross,
    nis_employee,
    nis_employer,
    health_surcharge,
    chargeable_income,
    paye,
    voluntary_deductions,
    net,
    breakdown,
    department_id,
    cost_center_id,
    nis_number_masked,
    nis_status,
    nis_class_no,
    opening_ytd_nis_employee,
    opening_ytd_nis_employer
  from public.finance_payroll_run_lines
  where run_id = v_run.id;

  insert into public.finance_payroll_run_warnings (
    id,
    run_id,
    calculation_version_id,
    employee_id,
    warning_type,
    severity,
    message,
    metadata
  )
  select
    coalesce(w.id, gen_random_uuid()),
    v_run.id,
    v_version.id,
    w.employee_id,
    w.warning_type,
    coalesce(w.severity, 'warning'),
    w.message,
    coalesce(w.metadata, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_warnings, '[]'::jsonb)) as w(
    id uuid,
    employee_id text,
    warning_type text,
    severity text,
    message text,
    metadata jsonb
  );

  insert into public.finance_payroll_control_findings (
    run_id,
    calculation_version_id,
    source_type,
    source_id,
    finding_type,
    domain,
    severity,
    state,
    title,
    detail,
    employee_id
  )
  select
    w.run_id,
    w.calculation_version_id,
    'calculation_warning',
    w.id::text,
    w.warning_type,
    case
      when w.warning_type like '%nis%' or w.warning_type like '%statutory%'
        then 'statutory'
      when w.warning_type like '%timesheet%' or w.warning_type like '%input%'
        then 'input'
      when w.warning_type like '%bank%' or w.warning_type like '%payment%'
        then 'payment'
      else 'input'
    end,
    w.severity,
    'open',
    initcap(replace(w.warning_type, '_', ' ')),
    w.message,
    w.employee_id
  from public.finance_payroll_run_warnings w
  where w.calculation_version_id = v_version.id;

  get diagnostics v_finding_count = row_count;

  update public.finance_payroll_calculation_attempts
     set status = 'succeeded',
         progress = 100,
         stage = 'published',
         completed_at = now(),
         error_code = null,
         error_message = null,
         technical_detail = null
   where id = v_attempt.id
  returning * into v_attempt;

  update public.finance_payroll_runs
     set status = 'calculated',
         current_calculation_version_id = v_version.id,
         approval_certification_id = null,
         employee_count = v_version.employee_count,
         gross_total = v_version.gross_total,
         deduction_total = v_version.deduction_total,
         net_total = v_version.net_total,
         nis_employer_total = v_version.nis_employer_total
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
  ) values (
    'finance.payroll.run.calculated',
    'finance_payroll',
    'payroll_run',
    v_run.id::text,
    p_actor_id,
    case
      when exists (
        select 1
          from public.finance_payroll_control_findings
         where calculation_version_id = v_version.id
           and severity = 'blocker'
      ) then 'warning'
      else 'success'
    end,
    jsonb_build_object(
      'runNo', v_run.run_no,
      'attemptId', v_attempt.id,
      'versionId', v_version.id,
      'versionNo', v_version.version_no,
      'employeeCount', v_version.employee_count,
      'grossTotal', v_version.gross_total,
      'netTotal', v_version.net_total,
      'findingCount', v_finding_count
    ),
    'finance.payroll.run.calculated:' || v_version.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state
  ) values (
    'finance_payroll',
    v_run.id::text,
    p_actor_id,
    'payroll_run.calculated',
    jsonb_build_object('status', v_from_status, 'attemptId', v_attempt.id),
    jsonb_build_object(
      'status', 'calculated',
      'attemptId', v_attempt.id,
      'versionId', v_version.id,
      'versionNo', v_version.version_no,
      'employeeCount', v_version.employee_count,
      'grossTotal', v_version.gross_total,
      'netTotal', v_version.net_total,
      'findingCount', v_finding_count
    )
  );

  return jsonb_build_object(
    'run', to_jsonb(v_run),
    'attempt', to_jsonb(v_attempt),
    'version', to_jsonb(v_version),
    'eventId', v_event_id,
    'findingCount', v_finding_count,
    'duplicate', false
  );
end
$fn$;

create or replace function public.finance_payroll_calculation_fail_tx(
  p_attempt_id      uuid,
  p_actor_id        text,
  p_error_code      text,
  p_error_message   text,
  p_technical_detail text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_attempt    public.finance_payroll_calculation_attempts%rowtype;
  v_run        public.finance_payroll_runs%rowtype;
  v_from_state text;
  v_event_id   uuid;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_calculation_fail: actor is required'
      using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_calculation_fail: actor is not an active user'
      using errcode = 'PR403';
  end if;
  if p_error_code is null or btrim(p_error_code) = ''
     or p_error_message is null or btrim(p_error_message) = '' then
    raise exception 'finance_payroll_calculation_fail: error code and sanitized message are required'
      using errcode = 'PR400';
  end if;

  select *
    into v_attempt
    from public.finance_payroll_calculation_attempts
   where id = p_attempt_id;
  if not found then
    raise exception 'finance_payroll_calculation_fail: attempt % was not found', p_attempt_id
      using errcode = 'PR404';
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = v_attempt.run_id
   for update;
  if not found then
    raise exception 'finance_payroll_calculation_fail: run % was not found', v_attempt.run_id
      using errcode = 'PR404';
  end if;

  select *
    into v_attempt
    from public.finance_payroll_calculation_attempts
   where id = p_attempt_id
   for update;

  if v_attempt.status = 'failed' then
    return jsonb_build_object(
      'run', to_jsonb(v_run),
      'attempt', to_jsonb(v_attempt),
      'duplicate', true
    );
  end if;
  if v_attempt.status <> 'running' then
    raise exception 'finance_payroll_calculation_fail: attempt % is % and cannot fail',
      p_attempt_id, v_attempt.status using errcode = 'PR409';
  end if;
  if v_run.status not in ('input_locked','calculation_failed','calculated','returned') then
    raise exception 'finance_payroll_calculation_fail: run % moved to % while calculation was running',
      v_run.id, v_run.status using errcode = 'PR409';
  end if;

  v_from_state := v_run.status;

  update public.finance_payroll_calculation_attempts
     set status = 'failed',
         stage = 'failed',
         completed_at = now(),
         error_code = left(btrim(p_error_code), 100),
         error_message = left(btrim(p_error_message), 500),
         technical_detail = case
           when p_technical_detail is null then null
           else left(p_technical_detail, 4000)
         end
   where id = v_attempt.id
  returning * into v_attempt;

  update public.finance_payroll_runs
     set status = 'calculation_failed'
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
  ) values (
    'finance.payroll.calculation.failed',
    'finance_payroll',
    'payroll_calculation_attempt',
    v_attempt.id::text,
    p_actor_id,
    'warning',
    jsonb_build_object(
      'runId', v_run.id,
      'runNo', v_run.run_no,
      'attemptNo', v_attempt.attempt_no,
      'correlationId', v_attempt.correlation_id,
      'errorCode', v_attempt.error_code
    ),
    'finance.payroll.calculation.failed:' || v_attempt.id::text
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
  ) values (
    'finance_payroll',
    v_run.id::text,
    p_actor_id,
    'payroll_calculation.failed',
    jsonb_build_object('status', v_from_state, 'attemptId', v_attempt.id),
    jsonb_build_object(
      'status', 'calculation_failed',
      'attemptId', v_attempt.id,
      'attemptNo', v_attempt.attempt_no,
      'correlationId', v_attempt.correlation_id,
      'errorCode', v_attempt.error_code
    ),
    v_attempt.error_message
  );

  return jsonb_build_object(
    'run', to_jsonb(v_run),
    'attempt', to_jsonb(v_attempt),
    'eventId', v_event_id,
    'duplicate', false
  );
end
$fn$;

revoke all on function public.finance_payroll_create_run_tx(
  text, text, text, date, date, uuid, integer, uuid, text, numeric, uuid, date, date
) from public, anon, authenticated;
grant execute on function public.finance_payroll_create_run_tx(
  text, text, text, date, date, uuid, integer, uuid, text, numeric, uuid, date, date
) to service_role;

revoke all on function public.finance_payroll_lock_inputs_tx(
  uuid, text, text, jsonb, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.finance_payroll_lock_inputs_tx(
  uuid, text, text, jsonb, integer, jsonb
) to service_role;

revoke all on function public.finance_payroll_calculation_start_tx(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.finance_payroll_calculation_start_tx(
  uuid, text, text
) to service_role;

revoke all on function public.finance_payroll_calculation_publish_tx(
  uuid, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.finance_payroll_calculation_publish_tx(
  uuid, text, jsonb, jsonb, jsonb
) to service_role;

revoke all on function public.finance_payroll_calculation_fail_tx(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finance_payroll_calculation_fail_tx(
  uuid, text, text, text, text
) to service_role;

-- PostgREST schema cache is refreshed by the operator after migration apply.
