-- F-02 Pay-Policy-to-Run Integration — RPC extensions (Rev 4.1 contract §1/§5/§8). Companion to mig 710.
-- Method: migration 421 (20260919000421_finance_payroll_execution_commands.sql) is the REPOSITORY-CANONICAL
-- baseline for create/lock/calc — it is the last committed migration that (re)defines these three functions and
-- nothing in supabase/migrations redefines them after it. Each modified function here was produced by taking the
-- verbatim 421 source text as the baseline, applying a surgical edit, and proving the delta with a
-- baseline-vs-modified diff (`.f02-baseline/*.{baseline,modified}.sql`). This is a source-of-truth diff against
-- the repo migration text; it is NOT equivalent to `pg_get_functiondef` against a live database. BEFORE applying
-- 711 to any SHARED database, compare that database's live function definitions (`pg_get_functiondef`) for
-- create/lock/calc against 421 to detect manual/out-of-band drift; only apply once they match. This tranche now
-- ships ALL THREE functions (create_run_tx + lock_inputs_tx + calculation_start_tx). No F-CAL / F-01 object is
-- created or altered (read-only calls only).
--
-- create_run_tx: every new run is pay-group-scoped (policy.pay_group_required, no bypass); resolves + PINS the
-- whole-period active policy assignment+version (policy.missing/ambiguous); for a working_days policy resolves
-- the work calendar (work_calendar_resolve), locks the resolved assignment FOR SHARE + revalidates (TOCTOU
-- close), computes+pins the period denominator (F-02 raises calendar.zero_working_days on '0'), pins 5 cols +
-- calendar_resolution; enriches the creation event + audit.
-- lock_inputs_tx: writes exactly ONE policy-evidence manifest per snapshot (SE-PPR-002); for a working_days run,
-- writes exactly ONE per-employee calendar-evidence row (SE-PPR-004, one work_calendar_working_days numerator
-- call per salaried employee) AND freezes that employee's base pay = round2(fullPeriodBase * numerator /
-- denominator) into the snapshot. The working_days proration math lives ONLY here (the TS calc pipeline sums
-- these frozen amounts; computeRunLine owns statutory math only). Enriches the inputs_locked event with the
-- evidence checksum. (Source/costing-rule ENFORCEMENT — FL-PPR-003/004 — + conflict outcomes are a later slice.)
-- calculation_start_tx: validates the pinned policy + calendar evidence belongs to the CURRENT snapshot and folds
-- the pin identity into the idempotency hash. It performs NO money math and never re-resolves the calendar.

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
  -- min() has no uuid aggregate; min(id::text)::uuid picks the single matching
  -- version deterministically (only consumed when v_policy_match = 1).
  select count(*), min(v.id::text)::uuid, min(v.canonical_checksum)
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

-- ══════════════════════════════════════════════════════════════════════════
-- finance_payroll_lock_inputs_tx — 421 baseline + F-02 surgical edit.
-- Adds: SE-PPR-002 policy-evidence manifest (1/snapshot), SE-PPR-004 per-employee
-- working_days calendar evidence (1/salaried emp), frozen working_days base pay,
-- inputs_locked event enrichment. Diff: .f02-baseline/lock_inputs_tx.{baseline,modified}.sql
-- ══════════════════════════════════════════════════════════════════════════
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
  -- F-02 policy + calendar evidence (SE-PPR-002 / SE-PPR-004)
  v_policy_version   public.finance_pay_policy_versions%rowtype;
  v_manifest         jsonb;
  v_policy_evidence_id uuid;
  v_evidence_checksum  text;
  -- F-02 R4 (Option B): source/costing enforcement + immutable conflict evidence.
  -- Blocking outcomes fail-closed here at lock; block_employee_calculation and
  -- review/correction conflicts are persisted in the snapshot source_summary and
  -- materialized into control findings at calculation (real calc version).
  v_enriched_summary   jsonb;
  v_source_conflicts   jsonb := '[]'::jsonb;
  v_excluded_employees jsonb := '[]'::jsonb;
  v_missing_source     text;
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
  -- v_checksum is computed AFTER R4 enforcement, over the source_summary enriched
  -- with the derived conflict/exclusion evidence (see below). The request hash
  -- stays keyed to the client-supplied command (original p_source_summary).
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

  -- ── F-02 R4: enforce the pinned policy's source + costing rules against the
  -- per-employee source presence carried in each base_pay line's metadata.sources.
  -- That presence is derived server-side from the canonical inputs (the lock route
  -- builds p_inputs; the caller cannot supply it), so it cannot be fabricated and
  -- cannot drift from the locked inputs. Blocking outcomes fail-closed HERE; the
  -- non-blocking conflicts + block_employee_calculation exclusions are recorded as
  -- immutable lock evidence and materialized into findings at calc. Runs whose
  -- pinned policy defines no source/costing rules (incl. legacy fixtures) no-op. ──
  if v_run.pay_policy_required then
    -- Carrier integrity: one base_pay line per distinct employee; only supported keys.
    if (select count(*) from jsonb_array_elements(p_inputs) e where e->>'source_type' = 'base_pay')
       <> (select count(distinct e->>'employee_id') from jsonb_array_elements(p_inputs) e
            where e->>'source_type' = 'base_pay') then
      raise exception 'finance_payroll_lock_inputs: duplicate base_pay line for an employee'
        using errcode = 'PR422';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(p_inputs) e
        cross join lateral jsonb_object_keys(coalesce(e->'metadata'->'sources', '{}'::jsonb)) as k
       where e->>'source_type' = 'base_pay'
         and k not in ('approved_time','approved_compensation','approved_leave',
                       'statutory_profile','payment_destination','cost_centre')
    ) then
      raise exception 'finance_payroll_lock_inputs: unsupported source-presence key in base_pay metadata'
        using errcode = 'PR422';
    end if;

    -- (a) block_input_lock: fail the whole lock if ANY included employee lacks a
    -- required source. Typed failure: policy.source_missing:<source_type>.
    select r.source_type
      into v_missing_source
      from public.finance_pay_policy_source_rules r
     where r.policy_version_id = v_run.pay_policy_version_id
       and r.required
       and r.conflict_outcome = 'block_input_lock'
       and exists (
         select 1 from jsonb_array_elements(p_inputs) e
          where e->>'source_type' = 'base_pay'
            and coalesce((e->'metadata'->'sources'->>r.source_type)::boolean, false) = false
       )
     order by r.source_type
     limit 1;
    if v_missing_source is not null then
      raise exception 'policy.source_missing:%', v_missing_source using errcode = 'PR422';
    end if;

    -- (b) cost-centre costing rule: applies to EVERY included employee.
    if exists (
      select 1 from public.finance_pay_policy_costing_rules cr
       where cr.policy_version_id = v_run.pay_policy_version_id
         and cr.required and cr.dimension = 'cost_centre'
    ) and exists (
      select 1 from jsonb_array_elements(p_inputs) e
       where e->>'source_type' = 'base_pay'
         and nullif(e->'metadata'->'sources'->>'cost_centre', '') is null
    ) then
      raise exception 'policy.cost_centre_missing' using errcode = 'PR422';
    end if;

    -- (c) non-blocking conflicts → immutable lock evidence (materialized at calc).
    select coalesce(jsonb_agg(jsonb_build_object(
             'employeeId',      c.employee_id,
             'sourceType',      c.source_type,
             'conflictOutcome', c.conflict_outcome,
             'reasonCode',      'source_missing'
           ) order by c.employee_id, c.source_type), '[]'::jsonb)
      into v_source_conflicts
      from (
        select distinct (e->>'employee_id') as employee_id, r.source_type, r.conflict_outcome
          from jsonb_array_elements(p_inputs) e
          join public.finance_pay_policy_source_rules r
            on r.policy_version_id = v_run.pay_policy_version_id
           and r.required
           and r.conflict_outcome in
               ('block_employee_calculation','create_review_finding','create_correction_candidate')
         where e->>'source_type' = 'base_pay'
           and coalesce((e->'metadata'->'sources'->>r.source_type)::boolean, false) = false
      ) c;

    v_excluded_employees := (
      select coalesce(jsonb_agg(distinct jsonb_build_object(
               'employeeId', elem->>'employeeId',
               'reasonCode', 'block_employee_calculation'
             )), '[]'::jsonb)
        from jsonb_array_elements(v_source_conflicts) as elem
       where elem->>'conflictOutcome' = 'block_employee_calculation'
    );
  end if;

  -- Immutable lock evidence: fold the derived conflicts + exclusions into the
  -- snapshot source_summary, then checksum the enriched evidence.
  v_enriched_summary := coalesce(p_source_summary, '{}'::jsonb) || jsonb_build_object(
    'sourcePolicyEnforced', v_run.pay_policy_required,
    'sourceConflicts',      v_source_conflicts,
    'excludedEmployees',    v_excluded_employees
  );
  v_checksum := md5(jsonb_build_object(
    'inputs', p_inputs,
    'employeeCount', p_employee_count,
    'sourceSummary', v_enriched_summary
  )::text);

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
    v_enriched_summary,
    p_actor_id,
    now()
  )
  returning * into v_snapshot;

  -- ── F-02 (SE-PPR-004): per-employee working_days calendar evidence ──────────
  -- Only for a calendar-pinned (working_days) run. Exactly ONE row per DISTINCT
  -- salaried base_pay employee in the snapshot. The employment-clamped numerator
  -- is computed from the run's PINNED work-calendar version (never re-resolved):
  -- work_calendar_working_days(pinnedVersion, clampFrom, clampTo). Clamp is the
  -- INCLUSIVE employment window (app_users.start_date/end_date; null ⇒ period
  -- bound). An empty window (clampFrom > clampTo) ⇒ numerator 0 with no F-CAL
  -- call. The denominator is the period-level value pinned at create. This runs
  -- exactly N F-CAL calls (one per working_days employee) — no N² fan-out.
  if v_run.work_calendar_version_id is not null then
    insert into public.finance_payroll_run_calendar_evidence (
      input_snapshot_id,
      run_id,
      employee_id,
      work_calendar_version_id,
      holiday_calendar_checksum,
      period_denominator,
      numerator,
      clamp_from,
      clamp_to,
      excluded
    )
    select
      v_snapshot.id,
      p_run_id,
      e.employee_id,
      v_run.work_calendar_version_id,
      v_run.holiday_calendar_checksum,
      (v_run.calendar_resolution->>'periodDenominator')::numeric,
      coalesce((wd.result->>'count')::numeric, 0),
      e.clamp_from,
      e.clamp_to,
      coalesce(wd.result->'excluded', '[]'::jsonb)
    from (
      select distinct
        (elem->>'employee_id') as employee_id,
        greatest(v_run.period_start, coalesce(u.start_date, v_run.period_start)) as clamp_from,
        least(v_run.period_end, coalesce(u.end_date, v_run.period_end))          as clamp_to
      from jsonb_array_elements(p_inputs) as elem
      join public.app_users u on u.id = (elem->>'employee_id')
      where elem->>'source_type' = 'base_pay'
        and elem->'metadata'->>'pay_basis' = 'salary'
    ) e
    left join lateral (
      select case
               when e.clamp_from > e.clamp_to then null
               else public.work_calendar_working_days(
                 v_run.work_calendar_version_id, e.clamp_from, e.clamp_to)
             end as result
    ) wd on true;
  end if;

  delete from public.finance_payroll_run_inputs
   where run_id = p_run_id;

  -- ── Snapshot the input lines. F-02: for a working_days run, FREEZE the
  -- salaried base_pay amount from the per-employee calendar evidence written
  -- above — base = round2(fullPeriodBase * numerator / denominator) — and stamp
  -- the derivation into metadata. All non-base_pay / non-salaried / non-working_
  -- days lines pass through unchanged. The proration math lives ONLY here (the TS
  -- calculation pipeline sums these frozen amounts; computeRunLine owns statutory
  -- math and does no proration). The row_checksum is computed from the FINAL
  -- (possibly prorated) amount + metadata so evidence integrity holds. ──────────
  with prepared as (
    select
      payload.input_row_no::integer as input_row_no,
      i.employee_id,
      i.source_type,
      i.source_id,
      i.component_code,
      i.label,
      i.quantity,
      i.rate,
      case
        when ce.employee_id is not null
          then round(i.amount * ce.numerator / ce.period_denominator, 2)
        else i.amount
      end as amount,
      case
        when ce.employee_id is not null
          then coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
                 'proration',              'working_days',
                 'workingDaysNumerator',   ce.numerator,
                 'workingDaysDenominator', ce.period_denominator,
                 'clampFrom',              ce.clamp_from,
                 'clampTo',                ce.clamp_to,
                 'workCalendarVersionId',  ce.work_calendar_version_id,
                 'fullPeriodBase',         i.amount
               )
        else coalesce(i.metadata, '{}'::jsonb)
      end as metadata
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
    )
    left join public.finance_payroll_run_calendar_evidence ce
      on ce.input_snapshot_id = v_snapshot.id
     and ce.employee_id = i.employee_id
     and i.source_type = 'base_pay'
     and (i.metadata->>'pay_basis') = 'salary'
  )
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
    prepared.input_row_no,
    prepared.employee_id,
    prepared.source_type,
    prepared.source_id,
    prepared.component_code,
    prepared.label,
    prepared.amount,
    prepared.quantity,
    prepared.rate,
    prepared.metadata,
    md5(jsonb_build_object(
      'employeeId', prepared.employee_id,
      'sourceType', prepared.source_type,
      'sourceId', prepared.source_id,
      'componentCode', prepared.component_code,
      'label', prepared.label,
      'amount', prepared.amount,
      'quantity', prepared.quantity,
      'rate', prepared.rate,
      'metadata', prepared.metadata
    )::text)
  from prepared;

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

  -- ── F-02 (SE-PPR-002): exactly ONE policy-evidence manifest per snapshot ─────
  -- Written for every policy-pinned run (pay_policy_required = true). The manifest
  -- is a display-resolved projection of the run's PINNED policy version — its
  -- components, source rules, costing rules, and statutory settings. The evidence
  -- checksum is the pinned canonical policy checksum. Legacy runs (required=false,
  -- no pin) write no manifest. NOTE: this writes the policy EVIDENCE; source/
  -- costing-rule ENFORCEMENT (FL-PPR-003/004) + conflict outcomes are a later
  -- slice (the payrollPayPolicyRun suite) and are not enforced here.
  if v_run.pay_policy_required then
    select *
      into v_policy_version
      from public.finance_pay_policy_versions
     where id = v_run.pay_policy_version_id;
    if not found then
      raise exception 'finance_payroll_lock_inputs: pinned pay policy version % was not found',
        v_run.pay_policy_version_id using errcode = 'PR404';
    end if;

    v_manifest := jsonb_build_object(
      'policyId',        v_policy_version.policy_id,
      'policyVersionId', v_policy_version.id,
      'versionNo',       v_policy_version.version_no,
      'effectiveFrom',   v_policy_version.effective_from,
      'effectiveTo',     v_policy_version.effective_to,
      'components', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'componentId',       pc.component_id,
                 'componentCode',     fc.code,
                 'calculationBasis',  pc.calculation_basis,
                 'rateSource',        pc.rate_source,
                 'eligibilitySource', pc.eligibility_source,
                 'ruleParameters',    pc.rule_parameters,
                 'isRequired',        pc.is_required,
                 'sortOrder',         pc.sort_order
               ) order by pc.sort_order, fc.code)
          from public.finance_pay_policy_components pc
          join public.finance_pay_components fc on fc.id = pc.component_id
         where pc.policy_version_id = v_policy_version.id
      ), '[]'::jsonb),
      'sourceRules', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sourceType',        sr.source_type,
                 'ownerRole',         sr.owner_role,
                 'required',          sr.required,
                 'reconciliationKey', sr.reconciliation_key,
                 'cutoffPolicy',      sr.cutoff_policy,
                 'lateInputPolicy',   sr.late_input_policy,
                 'conflictSeverity',  sr.conflict_severity,
                 'conflictOutcome',   sr.conflict_outcome
               ) order by sr.source_type)
          from public.finance_pay_policy_source_rules sr
         where sr.policy_version_id = v_policy_version.id
      ), '[]'::jsonb),
      'costingRules', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'dimension',        cr.dimension,
                 'resolutionSource', cr.resolution_source,
                 'required',         cr.required,
                 'missingOutcome',   cr.missing_outcome
               ) order by cr.dimension)
          from public.finance_pay_policy_costing_rules cr
         where cr.policy_version_id = v_policy_version.id
      ), '[]'::jsonb),
      'statutory', jsonb_build_object(
        'statutoryBinding',   v_policy_version.statutory_binding,
        'paymentDestination', v_policy_version.payment_destination,
        'missingBankOutcome', v_policy_version.missing_bank_outcome,
        'currency',           v_policy_version.currency,
        'dayBoundary',        v_policy_version.day_boundary
      )
    );

    insert into public.finance_payroll_run_policy_evidence (
      input_snapshot_id,
      run_id,
      policy_version_id,
      checksum,
      manifest
    ) values (
      v_snapshot.id,
      p_run_id,
      v_policy_version.id,
      v_run.pay_policy_checksum,
      v_manifest
    )
    returning id, checksum into v_policy_evidence_id, v_evidence_checksum;
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
      'checksum', v_checksum,
      -- F-02: evidence enrichment (no new event — same 'inputs_locked')
      'policyEvidenceId', v_policy_evidence_id,
      'evidenceChecksum', v_evidence_checksum
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
      'checksum', v_checksum,
      'policyEvidenceId', v_policy_evidence_id,
      'evidenceChecksum', v_evidence_checksum
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

-- ══════════════════════════════════════════════════════════════════════════
-- finance_payroll_calculation_start_tx — 421 baseline + F-02 surgical edit.
-- Adds: R13 consume-time evidence-belongs-to-snapshot validation (no money math,
-- no re-resolution) + pinned policy/calendar identity folded into the idempotency
-- hash. Diff: .f02-baseline/calculation_start_tx.{baseline,modified}.sql
-- ══════════════════════════════════════════════════════════════════════════
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
  -- F-02: consume-time evidence integrity (R13 — validate, never re-resolve)
  v_policy_evidence_count   integer;
  v_calendar_evidence_count integer;
  v_expected_calendar_count integer;
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

  -- ── F-02 (R13, DEC-PPR-010): validate that the PINNED policy + work-calendar
  -- evidence belongs to the CURRENT snapshot before calculation consumes it. This
  -- is a validation only — the working_days base pay was already frozen into the
  -- snapshot at lock (finance_payroll_lock_inputs_tx). No money math is performed
  -- here and the pinned calendar is never re-resolved; a later calendar change
  -- cannot alter a pinned run. Legacy runs (pay_policy_required=false, no pin) are
  -- historical and skip this check. ───────────────────────────────────────────
  if v_run.pay_policy_required then
    select count(*)
      into v_policy_evidence_count
      from public.finance_payroll_run_policy_evidence
     where input_snapshot_id = v_run.current_input_snapshot_id
       and policy_version_id = v_run.pay_policy_version_id
       and checksum = v_run.pay_policy_checksum;
    if v_policy_evidence_count <> 1 then
      raise exception
        'finance_payroll_calculation_start: pinned policy evidence for the current snapshot is missing or stale'
        using errcode = 'PR409';
    end if;

    if v_run.work_calendar_version_id is not null then
      -- Integrity: every calendar-evidence row on this snapshot must reference the
      -- pinned work-calendar version (no foreign-version rows).
      if exists (
        select 1
          from public.finance_payroll_run_calendar_evidence
         where input_snapshot_id = v_run.current_input_snapshot_id
           and work_calendar_version_id is distinct from v_run.work_calendar_version_id
      ) then
        raise exception
          'finance_payroll_calculation_start: calendar evidence references a version other than the pinned one'
          using errcode = 'PR409';
      end if;
      -- Completeness: exactly one evidence row per DISTINCT salaried base_pay
      -- employee in the current snapshot (the working_days population).
      select count(*)
        into v_calendar_evidence_count
        from public.finance_payroll_run_calendar_evidence
       where input_snapshot_id = v_run.current_input_snapshot_id;
      select count(distinct employee_id)
        into v_expected_calendar_count
        from public.finance_payroll_input_snapshot_lines
       where input_snapshot_id = v_run.current_input_snapshot_id
         and source_type = 'base_pay'
         and (metadata->>'pay_basis') = 'salary';
      if v_calendar_evidence_count <> v_expected_calendar_count then
        raise exception
          'finance_payroll_calculation_start: work-calendar evidence is incomplete for the current snapshot'
          using errcode = 'PR409';
      end if;
    end if;
  end if;

  v_scoped_key := p_actor_id || '|payroll.calculate|' || btrim(p_idempotency_key);
  -- F-02: fold the pinned policy + work-calendar identity into the idempotency
  -- integrity hash so a replay is bound to the same pinned snapshot inputs.
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor_id,
    'inputSnapshotId', v_run.current_input_snapshot_id,
    'statutoryVersionId', v_run.statutory_version_id,
    'payPolicyVersionId', v_run.pay_policy_version_id,
    'payPolicyChecksum', v_run.pay_policy_checksum,
    'workCalendarVersionId', v_run.work_calendar_version_id
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

-- ══════════════════════════════════════════════════════════════════════════
-- finance_payroll_calculation_publish_tx — 421 baseline + F-02 R4 surgical edit.
-- Materializes the persisted non-blocking source conflicts (immutable snapshot
-- source_summary evidence) into control findings ATOMIC with the real calculation
-- version + its calculated event/audit (idempotent per calc version + employee +
-- rule; succeeded-attempt replay returns early → no duplicate findings/events).
-- Diff: .f02-baseline/calculation_publish_tx.{baseline,modified}.sql
-- ══════════════════════════════════════════════════════════════════════════
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
  -- F-02 R4: materialize the persisted non-blocking source conflicts (from the
  -- the snapshot immutable source_summary evidence) as control findings, ATOMIC with
  -- this calculation version + its event/audit. Exclusions were already consumed
  -- upstream (excluded employees are absent from p_lines); here we only report the
  -- persisted counts. A succeeded-attempt replay returns early above, so retries
  -- never duplicate findings or events.
  v_source_conflict_count integer := 0;
  v_excluded_count        integer := 0;
  v_excluded_ids          text[] := '{}';   -- R4 block_employee_calculation employees (no calc line)
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
  -- F-02 R4: block_employee_calculation employees are frozen in the snapshot
  -- source_summary and receive NO calculation line, so the population + count
  -- checks below net them out of the snapshot side (empty array ⇒ no-op for
  -- legacy runs without exclusions).
  select coalesce(array_agg(distinct e->>'employeeId'), '{}')
    into v_excluded_ids
    from public.finance_payroll_input_snapshots s
    cross join lateral jsonb_array_elements(
      coalesce(s.source_summary->'excludedEmployees', '[]'::jsonb)) as e
   where s.id = v_attempt.input_snapshot_id
     and nullif(e->>'employeeId', '') is not null;

  if exists (
    (
      select distinct s.employee_id
        from public.finance_payroll_input_snapshot_lines s
       where s.input_snapshot_id = v_attempt.input_snapshot_id
         and s.employee_id <> all(v_excluded_ids)
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
         and s.employee_id <> all(v_excluded_ids)
    )
  ) then
    raise exception 'finance_payroll_calculation_publish: calculated employee population does not match the frozen input snapshot'
      using errcode = 'PR422';
  end if;
  if (
    select count(distinct s.employee_id)
      from public.finance_payroll_input_snapshot_lines s
     where s.input_snapshot_id = v_attempt.input_snapshot_id
       and s.employee_id <> all(v_excluded_ids)
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

  -- ── F-02 R4: persisted source conflicts → findings (idempotent per calc version
  -- + employee + rule; source_id is text, so a deterministic "<employee>:<rule>"
  -- key is compatible). create_review_finding / create_correction_candidate only;
  -- block_input_lock already failed the lock, block_employee_calculation already
  -- excluded the employee from p_lines. ────────────────────────────────────────
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
    v_run.id,
    v_version.id,
    'policy_source_conflict',
    (c->>'employeeId') || ':' || (c->>'sourceType'),
    c->>'conflictOutcome',
    'input',
    'warning',
    'open',
    case when c->>'conflictOutcome' = 'create_correction_candidate'
         then 'Pay-policy correction candidate: ' || (c->>'sourceType')
         else 'Pay-policy review finding: ' || (c->>'sourceType') end,
    'Required pay-policy source "' || (c->>'sourceType') ||
      '" was missing for this employee at input lock (' ||
      coalesce(c->>'reasonCode', 'source_missing') || ').',
    c->>'employeeId'
  from public.finance_payroll_input_snapshots s
  cross join lateral jsonb_array_elements(
    coalesce(s.source_summary->'sourceConflicts', '[]'::jsonb)
  ) as c
  where s.id = v_attempt.input_snapshot_id
    and (c->>'conflictOutcome') in ('create_review_finding','create_correction_candidate')
  on conflict (calculation_version_id, source_type, source_id) do nothing;
  get diagnostics v_source_conflict_count = row_count;

  select coalesce(jsonb_array_length(s.source_summary->'excludedEmployees'), 0)
    into v_excluded_count
    from public.finance_payroll_input_snapshots s
   where s.id = v_attempt.input_snapshot_id;

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
      'findingCount', v_finding_count,
      'sourceConflictFindingCount', v_source_conflict_count,
      'excludedEmployeeCount', v_excluded_count
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
      'findingCount', v_finding_count,
      'sourceConflictFindingCount', v_source_conflict_count,
      'excludedEmployeeCount', v_excluded_count
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
