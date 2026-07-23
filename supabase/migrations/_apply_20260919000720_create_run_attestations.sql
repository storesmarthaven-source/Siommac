-- ═══════════════════════════════════════════════════════════════════════════
-- OPERATOR APPLY (rev 2) — P0-4 creation attestations (certification WP-3).
-- Re-applies the corrected canonical create-RPC source from migration
-- 20260919000720_finance_payroll_run_metadata.sql (p_attestations added).
--
-- Rev 2: the first apply's fixed 20-arg DROP left a LEGACY overload behind
-- (the DB carried two signatures from the mig-711 → mig-720 lineage) and the
-- =1 verification correctly aborted the transaction. This revision DYNAMICALLY
-- drops EVERY existing overload of finance_payroll_create_run_tx (introspected
-- from pg_proc) before creating the corrected one, so exactly one remains
-- regardless of signature history. Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1. Drop EVERY existing overload, whatever its historical signature.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = 'finance_payroll_create_run_tx'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

-- 2. Corrected canonical source (verbatim from 20260919000720; idempotent DDL).
-- ══════════════════════════════════════════════════════════════════════════
-- Slice 1 — Create-Run wizard run metadata.
-- Adds reason code (+ lookup), payroll owner, extra operational cut-offs,
-- release window and internal description to a payroll run, and extends
-- finance_payroll_create_run_tx (mig 711) to accept + persist them.
--
-- The RPC is reproduced in full via CREATE OR REPLACE (the correct way to evolve
-- a function). The 7 new params are APPENDED (all default null → positional
-- back-compat), folded into the idempotency hash, validated, and inserted. The
-- policy/calendar pin blocks are unchanged.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Reason-code lookup ─────────────────────────────────────────────────────
create table if not exists public.finance_payroll_reason_codes (
  code        text primary key,
  label       text not null,
  run_type    text check (run_type is null or run_type in ('scheduled','off_cycle','correction','final_pay')),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.finance_payroll_reason_codes enable row level security;
drop policy if exists finance_payroll_reason_codes_read on public.finance_payroll_reason_codes;
create policy finance_payroll_reason_codes_read
  on public.finance_payroll_reason_codes for select using (true);

insert into public.finance_payroll_reason_codes (code, label, run_type, sort_order) values
  ('regular_scheduled', 'Regular scheduled payroll', 'scheduled',  10),
  ('supplementary',     'Supplementary earnings',    'off_cycle',  20),
  ('bonus_run',         'Bonus / incentive run',     'off_cycle',  25),
  ('correction',        'Correction',                'correction', 30),
  ('final_settlement',  'Final pay settlement',      'final_pay',  40)
on conflict (code) do update
  set label = excluded.label, run_type = excluded.run_type, sort_order = excluded.sort_order;

-- ── 2. Run metadata columns ───────────────────────────────────────────────────
alter table public.finance_payroll_runs
  add column if not exists payroll_owner_id     text references public.app_users(id) on delete set null,
  add column if not exists reason_code          text references public.finance_payroll_reason_codes(code),
  add column if not exists ot_cutoff_at         timestamptz,
  add column if not exists approval_deadline_at timestamptz,
  add column if not exists funding_date         date,
  add column if not exists release_window       text,
  add column if not exists internal_description text;

-- ── 3. Extend the create RPC (full body; additions marked "-- Slice 1") ──────
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
  p_cut_off_date         date default null,
  -- Slice 1 run metadata (appended, all optional)
  p_reason_code          text default null,
  p_payroll_owner_id     text default null,
  p_ot_cutoff_at         timestamptz default null,
  p_approval_deadline_at timestamptz default null,
  p_funding_date         date default null,
  p_release_window       text default null,
  p_internal_description text default null,
  -- P0-4 creation governance attestations (REQUIRED; default only for signature
  -- stability — a null/invalid object is rejected before any row is written)
  p_attestations         jsonb default null
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
  v_owner           text;   -- Slice 1: payroll owner (defaults to the actor)
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
  v_owner    := coalesce(nullif(btrim(p_payroll_owner_id), ''), p_actor_id);  -- Slice 1

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

  -- P0-4: all three creation attestations must be literally true, with NO other
  -- keys (exact-object equality). Rejected BEFORE any run/receipt/event/audit
  -- write. The leading token after the prefix is the typed error code.
  if p_attestations is null
     or p_attestations <> jsonb_build_object(
          'purposeScopeAndDatesReviewed',     true,
          'preflightLimitationsAcknowledged', true,
          'separationOfDutiesAcknowledged',   true) then
    raise exception 'finance_payroll_create: attestations.invalid: all three creation attestations must be true (purposeScopeAndDatesReviewed, preflightLimitationsAcknowledged, separationOfDutiesAcknowledged)'
      using errcode = 'PR422';
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
    'cutOffDate', p_cut_off_date,
    -- Slice 1: metadata is part of the command identity
    'reasonCode', p_reason_code,
    'payrollOwnerId', v_owner,
    'otCutoffAt', p_ot_cutoff_at,
    'approvalDeadlineAt', p_approval_deadline_at,
    'fundingDate', p_funding_date,
    'releaseWindow', p_release_window,
    'internalDescription', p_internal_description,
    -- P0-4: the canonical attestation object is part of the command identity
    -- (jsonb normalizes key order, and validation above pins the exact shape).
    'attestations', p_attestations
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

  -- Slice 1: validate run metadata (owner active; reason code applies to this run type)
  if not exists (select 1 from public.app_users where id = v_owner and status = 'active') then
    raise exception 'finance_payroll_create: payroll owner is not an active user'
      using errcode = 'PR422';
  end if;
  if p_reason_code is not null and not exists (
    select 1 from public.finance_payroll_reason_codes rc
     where rc.code = p_reason_code and rc.active
       and (rc.run_type is null or rc.run_type = p_run_type)
  ) then
    raise exception 'finance_payroll_create: reason code % is not valid for run type %', p_reason_code, p_run_type
      using errcode = 'PR422';
  end if;
  if p_approval_deadline_at is not null and p_ot_cutoff_at is not null
     and p_approval_deadline_at < p_ot_cutoff_at then
    raise exception 'finance_payroll_create: approval deadline cannot precede the overtime cut-off'
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
    raise exception 'policy.missing' using errcode = 'PR422';
  end if;

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
      -- Slice 1 run metadata
      payroll_owner_id, reason_code, ot_cutoff_at, approval_deadline_at,
      funding_date, release_window, internal_description,
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
      v_owner, p_reason_code, p_ot_cutoff_at, p_approval_deadline_at,
      p_funding_date, p_release_window, nullif(btrim(p_internal_description), ''),
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
      'payrollOwnerId', v_run.payroll_owner_id,
      'reasonCode', v_run.reason_code,
      'payPolicyVersionId', v_run.pay_policy_version_id,
      'payPolicyChecksum', v_run.pay_policy_checksum,
      'workCalendarVersionId', v_run.work_calendar_version_id,
      'workCalendarChecksum', v_run.work_calendar_checksum,
      -- P0-4: governance evidence — actor/time come from this event row itself.
      'attestations', p_attestations
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
      'payrollOwnerId', v_run.payroll_owner_id,
      'reasonCode', v_run.reason_code,
      'statutoryVersionId', v_run.statutory_version_id,
      'payPolicyVersionId', v_run.pay_policy_version_id,
      'workCalendarVersionId', v_run.work_calendar_version_id,
      -- P0-4: governance evidence (actor_id/created_at are the audit row's own).
      'attestations', p_attestations
    )
  );

  return to_jsonb(v_run) || jsonb_build_object('duplicate', false);
end
$fn$;

-- 3. Verify exactly ONE overload remains (fails the transaction otherwise).
do $$
declare v_count integer;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'finance_payroll_create_run_tx';
  if v_count <> 1 then
    raise exception 'expected exactly 1 finance_payroll_create_run_tx overload, found %', v_count;
  end if;
end $$;

-- 4. Harden grants: server-only execution (the one remaining 21-arg signature).
revoke all on function public.finance_payroll_create_run_tx(
  text, text, text, date, date, uuid, integer, uuid, text, numeric, uuid,
  date, date, text, text, timestamptz, timestamptz, date, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_create_run_tx(
  text, text, text, date, date, uuid, integer, uuid, text, numeric, uuid,
  date, date, text, text, timestamptz, timestamptz, date, text, text, jsonb)
  to service_role;

commit;

-- 5. Reload the PostgREST schema cache.
notify pgrst, 'reload schema';
