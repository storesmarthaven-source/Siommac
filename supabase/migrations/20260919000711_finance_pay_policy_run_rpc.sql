-- F-02 Pay-Policy-to-Run Integration — RPC extensions (Rev 4.1 contract §1/§5/§8). Companion to mig 710.
-- Built from the LIVE function definitions (mig 421 = authoritative baseline; nothing redefines these after)
-- via programmatic extract + surgical edit + baseline-vs-modified diff (NOT hand transcription). This tranche
-- ships create_run_tx; lock_inputs_tx + calculation_start_tx (per-employee working-days evidence + consume)
-- follow in the same file once diff-verified. No F-CAL / F-01 object is created or altered (read-only calls).
--
-- create_run_tx: every new run is pay-group-scoped (policy.pay_group_required, no bypass); resolves + PINS the
-- whole-period active policy assignment+version (policy.missing/ambiguous); for a working_days policy resolves
-- the work calendar (work_calendar_resolve), locks the resolved assignment FOR SHARE + revalidates (TOCTOU
-- close), computes+pins the period denominator (F-02 raises calendar.zero_working_days on '0'), pins 5 cols +
-- calendar_resolution; enriches the creation event + audit.

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
  -- F-02 policy pin
  v_policy_version_id  uuid;
  v_policy_checksum    text;
  v_policy_match       integer;
  v_has_working_days   boolean := false;
  -- F-02 calendar pin
  v_cal             jsonb;
  v_wc_version_id   uuid;
  v_hc_version_id   uuid;
  v_wc_checksum     text;
  v_hc_checksum     text;
  v_asg_id          uuid;
  v_asg             public.work_calendar_assignments%rowtype;
  v_period          daterange;
  v_wd              jsonb;
  v_denominator     numeric;
  v_cal_resolution  jsonb := null;
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

  -- F-02 (DEC-PPR-021): every new production run is pay-group-scoped; no runtime bypass.
  if p_pay_group_id is null then
    raise exception 'policy.pay_group_required' using errcode = 'PR422';
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
    -- unreachable: the pay_group_required guard above rejects unscoped runs (no bypass).
    raise exception 'policy.pay_group_required' using errcode = 'PR422';
  end if;

  if v_frequency not in ('weekly','fortnightly','semi_monthly','monthly') then
    raise exception 'finance_payroll_create: unsupported pay frequency %', v_frequency
      using errcode = 'PR422';
  end if;

  -- ── F-02 policy resolution + pin (whole-period coverage of assignment AND version) ──
  v_period := daterange(p_period_start, p_period_end + 1, '[)');
  select count(*), min(v.id), min(v.canonical_checksum)
    into v_policy_match, v_policy_version_id, v_policy_checksum
    from public.finance_pay_group_policy_assignments a
    join public.finance_pay_policy_versions v on v.id = a.policy_version_id
   where a.pay_group_id = p_pay_group_id
     and a.status = 'active'
     and v.status = 'active'
     and daterange(a.effective_from, coalesce(a.effective_to + 1, 'infinity'::date), '[)') @> v_period
     and daterange(v.effective_from, coalesce(v.effective_to + 1, 'infinity'::date), '[)') @> v_period;
  if v_policy_match = 0 then
    raise exception 'policy.missing' using errcode = 'PR422';
  elsif v_policy_match > 1 then
    raise exception 'policy.ambiguous' using errcode = 'PR409';
  end if;
  if v_policy_checksum is null then
    raise exception 'policy.missing' using errcode = 'PR422';  -- version never activated / no checksum
  end if;

  -- Does the pinned policy bind any working_days component?
  v_has_working_days := exists (
    select 1 from public.finance_pay_policy_components pc
     where pc.policy_version_id = v_policy_version_id
       and pc.rule_parameters->>'proration' = 'working_days'
  );

  -- ── F-02 calendar resolution + pin (working_days only) ──
  if v_has_working_days then
    v_cal := public.work_calendar_resolve(p_pay_group_id, p_period_start, p_period_end);
    v_wc_version_id := (v_cal->>'workCalendarVersionId')::uuid;
    v_hc_version_id := (v_cal->>'holidayCalendarVersionId')::uuid;
    v_wc_checksum   := v_cal->>'workCalendarChecksum';
    v_hc_checksum   := v_cal->>'holidayCalendarChecksum';
    v_asg_id        := (v_cal#>>'{resolutionPath,assignmentId}')::uuid;

    -- Close the resolve->insert TOCTOU: lock the resolved assignment FOR SHARE + revalidate.
    select * into v_asg
      from public.work_calendar_assignments
     where id = v_asg_id
     for share;
    if not found or v_asg.status <> 'active'
       or not (daterange(v_asg.effective_from, coalesce(v_asg.effective_to + 1, 'infinity'::date), '[)') @> v_period) then
      raise exception 'calendar.unresolved' using errcode = 'PR422';
    end if;
    if v_asg.work_calendar_version_id is distinct from v_wc_version_id then
      raise exception 'calendar.split_period' using errcode = 'PR422';
    end if;

    -- Period denominator; F-02 OWNS the zero check (work_calendar_working_days returns '0', never raises).
    v_wd := public.work_calendar_working_days(v_wc_version_id, p_period_start, p_period_end);
    v_denominator := (v_wd->>'count')::numeric;
    if v_denominator is null or v_denominator <= 0 then
      raise exception 'calendar.zero_working_days' using errcode = 'PR422';
    end if;

    v_cal_resolution := jsonb_build_object(
      'payGroupId', p_pay_group_id,
      'periodStart', p_period_start,
      'periodEnd', p_period_end,
      'scope', v_cal#>>'{resolutionPath,scope}',
      'assignmentId', v_asg_id,
      'periodDenominator', v_denominator::text,
      'periodExcluded', coalesce(v_wd->'excluded', '[]'::jsonb)
    );
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
      creation_request_hash,
      -- F-02 policy pin
      pay_policy_version_id, pay_policy_checksum, pay_policy_required,
      -- F-02 calendar pin (null for a non-working_days policy)
      work_calendar_version_id, holiday_calendar_version_id, work_calendar_checksum,
      holiday_calendar_checksum, calendar_resolution
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
      v_hash,
      v_policy_version_id, v_policy_checksum, true,
      v_wc_version_id, v_hc_version_id, v_wc_checksum, v_hc_checksum, v_cal_resolution
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
      'payGroupId', v_run.pay_group_id,
      'payPolicyVersionId', v_run.pay_policy_version_id,
      'payPolicyChecksum', v_run.pay_policy_checksum,
      'workCalendarVersionId', v_run.work_calendar_version_id,
      'workCalendarChecksum', v_run.work_calendar_checksum
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
      'statutoryVersionId', v_run.statutory_version_id,
      'payPolicyVersionId', v_run.pay_policy_version_id,
      'workCalendarVersionId', v_run.work_calendar_version_id
    )
  );

  return to_jsonb(v_run) || jsonb_build_object('duplicate', false);
end
$fn$;
