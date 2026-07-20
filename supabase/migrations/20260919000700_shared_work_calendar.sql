-- Shared Work Calendar (F-CAL) -- prerequisite to F-02 Pay-Policy-to-Run working_days proration.
-- Contract: docs/module-contracts/shared-work-calendar-delivery-contract.md (Rev 5).
--
-- Timestamp note: repo future-dates migrations (20260919xxxxxx); this slice depends on finance_pay_groups
-- (20260918) + app_events/hr_audit_log, so it is placed at the next slot after 20260919000600 rather than
-- the CLI real-clock date (which would misorder it before its deps).
--
-- Review round 2 fixes (all at source): validator grants to service_role; SQL-derived idempotency hash +
-- advisory lock + fully-qualified operation namespaces; actor+op-qualified event dedupe keys; whole-row
-- immutability (to_jsonb diff) incl. id/lock_version/created_*; child immutability checks BOTH old+new
-- parents; pg_trigger_depth REPLACED by an explicit maintenance-flag purge path; weekday input order is
-- preserved so the DB validator rejects noncanonical input; working_days requires published/in-window
-- versions; CHECK normalization scoped by named constraint; DB-enforced holiday jurisdiction/year/window;
-- assignment state guards; seed left DRAFT (not payroll-eligible) until movable holidays + verified
-- provenance are added.

create extension if not exists btree_gist;   -- repo-consistent (F-01 migs 170/600)
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Validator functions (IMMUTABLE; legal in CHECK). Must be executable by service_role (evaluated
--    during service_role DML) -- fix #1.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.work_calendar_valid_weekdays(p_days smallint[])
returns boolean language sql immutable set search_path = pg_catalog as $$
  select p_days is not null
     and array_ndims(p_days) = 1
     and cardinality(p_days) between 1 and 7
     and p_days <@ array[1,2,3,4,5,6,7]::smallint[]
     and p_days = (select array_agg(distinct d order by d) from unnest(p_days) as d)
$$;

create or replace function public.work_calendar_valid_fractions(p_days smallint[], p_fractions jsonb)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select p_fractions is not null
     and jsonb_typeof(p_fractions) = 'object'
     and not exists (
       select 1 from jsonb_each(p_fractions) as e(key, value)
       where case
         when e.key !~ '^[1-7]$' then true
         when e.key::smallint <> all(p_days) then true
         when jsonb_typeof(e.value) <> 'number' then true
         else (e.value #>> '{}')::numeric <= 0 or (e.value #>> '{}')::numeric >= 1
       end)
$$;

revoke all on function public.work_calendar_valid_weekdays(smallint[]) from public, anon, authenticated;
revoke all on function public.work_calendar_valid_fractions(smallint[], jsonb) from public, anon, authenticated;
grant execute on function public.work_calendar_valid_weekdays(smallint[]) to service_role;
grant execute on function public.work_calendar_valid_fractions(smallint[], jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Holiday sets
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.holiday_calendars (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  jurisdiction  text not null,
  created_by    text references public.app_users(id) on delete set null,
  lock_version  integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.holiday_calendar_versions (
  id                  uuid primary key default gen_random_uuid(),
  holiday_calendar_id uuid not null references public.holiday_calendars(id) on delete cascade,
  version_no          integer not null check (version_no > 0),
  status              text not null default 'draft' check (status in ('draft','published','superseded')),
  effective_from      date not null,
  effective_to        date,
  timezone            text not null default 'America/Port_of_Spain',
  canonical_checksum  text,
  provenance          text not null default 'user' check (provenance in ('user','system_seed')),
  published_by        text references public.app_users(id) on delete set null,
  published_at        timestamptz,
  superseded_at       timestamptz,
  lock_version        integer not null default 1,
  created_by          text references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (holiday_calendar_id, version_no),
  check (effective_to is null or effective_to >= effective_from),
  check (status not in ('published','superseded')
         or (canonical_checksum is not null and published_at is not null
             and (provenance = 'system_seed' or published_by is not null)))
);
create unique index if not exists holiday_calendar_one_published_idx
  on public.holiday_calendar_versions (holiday_calendar_id) where status = 'published';

create table if not exists public.holiday_dates (
  id                          uuid primary key default gen_random_uuid(),
  holiday_calendar_version_id uuid not null references public.holiday_calendar_versions(id) on delete cascade,
  holiday_date                date not null,
  observed_date               date,
  effective_date              date generated always as (coalesce(observed_date, holiday_date)) stored,
  day_fraction                numeric(3,2) not null default 1.0
                                constraint holiday_dates_day_fraction_ck check (day_fraction > 0 and day_fraction <= 1),
  year                        integer not null,
  jurisdiction                text not null,
  name_statutory              text not null,
  name_common                 text not null,
  holiday_type                text not null
                                constraint holiday_dates_type_ck check (holiday_type in ('statutory','proclaimed','movable')),
  source_reference            text not null,
  source_published_date       date not null,
  provenance_note             text not null,
  created_at                  timestamptz not null default now(),
  unique (holiday_calendar_version_id, holiday_date),
  unique (holiday_calendar_version_id, effective_date)
);
create index if not exists holiday_dates_version_effdate_idx
  on public.holiday_dates (holiday_calendar_version_id, effective_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Work calendars
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.work_calendars (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  created_by    text references public.app_users(id) on delete set null,
  lock_version  integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.work_calendar_versions (
  id                          uuid primary key default gen_random_uuid(),
  work_calendar_id            uuid not null references public.work_calendars(id) on delete cascade,
  version_no                  integer not null check (version_no > 0),
  status                      text not null default 'draft' check (status in ('draft','published','superseded')),
  effective_from              date not null,
  effective_to                date,
  timezone                    text not null default 'America/Port_of_Spain',
  working_weekdays            smallint[] not null,
  weekday_fractions           jsonb not null default '{}'::jsonb,
  holiday_calendar_version_id uuid not null references public.holiday_calendar_versions(id) on delete restrict,
  canonical_checksum          text,
  provenance                  text not null default 'user' check (provenance in ('user','system_seed')),
  published_by                text references public.app_users(id) on delete set null,
  published_at                timestamptz,
  superseded_at               timestamptz,
  lock_version                integer not null default 1,
  created_by                  text references public.app_users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (work_calendar_id, version_no),
  -- named so only these normalize to calendar.invalid_pattern (fix #10)
  constraint work_calendar_versions_weekdays_ck  check (work_calendar_valid_weekdays(working_weekdays)),
  constraint work_calendar_versions_fractions_ck check (work_calendar_valid_fractions(working_weekdays, weekday_fractions)),
  check (effective_to is null or effective_to >= effective_from),
  check (status not in ('published','superseded')
         or (canonical_checksum is not null and published_at is not null
             and (provenance = 'system_seed' or published_by is not null)))
);
create unique index if not exists work_calendar_one_published_idx
  on public.work_calendar_versions (work_calendar_id) where status = 'published';
create index if not exists work_calendar_versions_holiday_idx
  on public.work_calendar_versions (holiday_calendar_version_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Assignments (scope-specific; non-overlap over all non-cancelled windows)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.work_calendar_assignments (
  id                       uuid primary key default gen_random_uuid(),
  scope                    text not null check (scope in ('pay_group','organization')),
  pay_group_id             uuid references public.finance_pay_groups(id) on delete cascade,
  work_calendar_version_id uuid not null references public.work_calendar_versions(id) on delete restrict,
  effective_from           date not null,
  effective_to             date,
  status                   text not null default 'active' check (status in ('active','cancelled')),
  assigned_by              text not null references public.app_users(id),
  ended_by                 text references public.app_users(id) on delete set null,
  end_reason               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (scope = 'organization' or pay_group_id is not null),
  check (scope = 'pay_group' or pay_group_id is null),
  check (effective_to is null or effective_to >= effective_from),
  constraint work_calendar_assignments_pg_no_overlap exclude using gist (
    pay_group_id with =,
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') with &&
  ) where (scope = 'pay_group' and status = 'active'),
  constraint work_calendar_assignments_org_no_overlap exclude using gist (
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') with &&
  ) where (scope = 'organization' and status = 'active')
);
create index if not exists work_calendar_assignments_pg_idx
  on public.work_calendar_assignments (pay_group_id, status);
create index if not exists work_calendar_assignments_version_idx
  on public.work_calendar_assignments (work_calendar_version_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Command receipts (actor + fully-qualified-operation scoped idempotency)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.work_calendar_command_receipts (
  actor_id    text not null references public.app_users(id),
  operation   text not null,          -- fully-qualified, e.g. 'holiday_set.create_version' (fix #2)
  request_key text not null,
  target_id   text,
  input_hash  text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (actor_id, operation, request_key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. updated_at triggers (reuse platform public.set_updated_at)
-- ─────────────────────────────────────────────────────────────────────────────
create trigger holiday_calendars_touch          before update on public.holiday_calendars          for each row execute function public.set_updated_at();
create trigger holiday_calendar_versions_touch   before update on public.holiday_calendar_versions   for each row execute function public.set_updated_at();
create trigger work_calendars_touch              before update on public.work_calendars              for each row execute function public.set_updated_at();
create trigger work_calendar_versions_touch      before update on public.work_calendar_versions      for each row execute function public.set_updated_at();
create trigger work_calendar_assignments_touch   before update on public.work_calendar_assignments   for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Version immutability -- whole-row (to_jsonb) diff so id/lock_version/created_* cannot change on the
--    only permitted transition published->superseded (fix #4). One generic function for both tables.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.wc_version_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if OLD.status = 'draft' then return NEW; end if;
  if OLD.status = 'published' and NEW.status = 'superseded' and NEW.superseded_at is not null
     and (to_jsonb(OLD) - 'status' - 'superseded_at' - 'updated_at')
       = (to_jsonb(NEW) - 'status' - 'superseded_at' - 'updated_at') then
    return NEW;
  end if;
  raise exception 'calendar.version_immutable' using errcode = 'PR409';
end $$;

create trigger holiday_calendar_versions_immutable_trg
  before update on public.holiday_calendar_versions for each row execute function public.wc_version_immutable();
create trigger work_calendar_versions_immutable_trg
  before update on public.work_calendar_versions for each row execute function public.wc_version_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Holiday child guard (fixes #5,#6,#11): DB-enforced immutability of BOTH old+new parents, derived
--    jurisdiction/year, in-window validation. Maintenance-flag bypass (explicit reviewed purge path)
--    replaces pg_trigger_depth.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.holiday_dates_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare v_old_status text; v_ver public.holiday_calendar_versions%rowtype; v_jur text; v_win daterange;
begin
  -- maintenance bypass is DELETE-only (purge does not insert/update); INSERT/UPDATE are always validated (fix #1)
  if TG_OP = 'DELETE' and coalesce(current_setting('app.work_calendar_maintenance', true), '') = 'on' then
    return OLD;
  end if;

  if TG_OP in ('UPDATE','DELETE') then
    select status into v_old_status from public.holiday_calendar_versions where id = OLD.holiday_calendar_version_id;
    if v_old_status in ('published','superseded') then
      raise exception 'calendar.version_immutable' using errcode = 'PR409';
    end if;
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;

  -- INSERT/UPDATE: destination parent must be draft; derive + validate consistency
  select * into v_ver from public.holiday_calendar_versions where id = NEW.holiday_calendar_version_id;
  if v_ver.status in ('published','superseded') then
    raise exception 'calendar.version_immutable' using errcode = 'PR409';
  end if;
  select jurisdiction into v_jur from public.holiday_calendars where id = v_ver.holiday_calendar_id;
  NEW.jurisdiction := v_jur;
  NEW.year := extract(year from NEW.holiday_date)::int;
  v_win := daterange(v_ver.effective_from, coalesce(v_ver.effective_to + 1, 'infinity'::date), '[)');
  if not (v_win @> NEW.holiday_date and v_win @> coalesce(NEW.observed_date, NEW.holiday_date)) then
    raise exception 'calendar.holiday_out_of_window' using errcode = 'PR422';
  end if;
  return NEW;
end $$;

create trigger holiday_dates_guard_trg
  before insert or update or delete on public.holiday_dates for each row execute function public.holiday_dates_guard();

-- Published/superseded VERSION rows (and thus their cascade to holiday_dates) can only be deleted through
-- the reviewed maintenance/purge path -- direct or cascade deletes otherwise are blocked (fix #1).
create or replace function public.wc_version_delete_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if OLD.status in ('published','superseded')
     and coalesce(current_setting('app.work_calendar_maintenance', true), '') <> 'on' then
    raise exception 'calendar.version_immutable' using errcode = 'PR409';
  end if;
  return OLD;
end $$;
create trigger holiday_calendar_versions_delete_guard_trg
  before delete on public.holiday_calendar_versions for each row execute function public.wc_version_delete_guard();
create trigger work_calendar_versions_delete_guard_trg
  before delete on public.work_calendar_versions for each row execute function public.wc_version_delete_guard();

-- Jurisdiction feeds resolution + checksums; freeze it once any version is published/superseded so published
-- semantics cannot drift without a new version (fix #2).
create or replace function public.holiday_calendars_freeze()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if NEW.jurisdiction is distinct from OLD.jurisdiction
     and exists (select 1 from public.holiday_calendar_versions
                 where holiday_calendar_id = OLD.id and status in ('published','superseded')) then
    raise exception 'calendar.jurisdiction_frozen' using errcode = 'PR409';
  end if;
  return NEW;
end $$;
create trigger holiday_calendars_freeze_trg
  before update on public.holiday_calendars for each row execute function public.holiday_calendars_freeze();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS + grants (service-role only)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'holiday_calendars','holiday_calendar_versions','holiday_dates',
    'work_calendars','work_calendar_versions','work_calendar_assignments','work_calendar_command_receipts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Deterministic checksum manifests (Appendix B); sha256 is a pg_catalog builtin
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.work_calendar_holiday_checksum(p_version_id uuid)
returns text language sql stable set search_path = pg_catalog, public as $$
  select encode(sha256(convert_to((
    select jsonb_build_object(
      'effectiveFrom', v.effective_from, 'effectiveTo', v.effective_to, 'timezone', v.timezone,
      'jurisdiction', hc.jurisdiction,
      'holidays', coalesce((
        select jsonb_agg(jsonb_build_object(
          'holidayDate', d.holiday_date, 'observedDate', d.observed_date, 'effectiveDate', d.effective_date,
          'dayFraction', d.day_fraction, 'year', d.year, 'jurisdiction', d.jurisdiction,
          'nameStatutory', d.name_statutory, 'nameCommon', d.name_common, 'holidayType', d.holiday_type,
          'sourceReference', d.source_reference, 'sourcePublishedDate', d.source_published_date,
          'provenanceNote', d.provenance_note)
          order by d.effective_date, d.holiday_date, d.name_statutory)
        from public.holiday_dates d where d.holiday_calendar_version_id = v.id), '[]'::jsonb))
    from public.holiday_calendar_versions v
    join public.holiday_calendars hc on hc.id = v.holiday_calendar_id
    where v.id = p_version_id)::text, 'UTF8')), 'hex')
$$;

create or replace function public.work_calendar_version_checksum(p_version_id uuid)
returns text language sql stable set search_path = pg_catalog, public as $$
  select encode(sha256(convert_to((
    select jsonb_build_object(
      'effectiveFrom', v.effective_from, 'effectiveTo', v.effective_to, 'timezone', v.timezone,
      'workingWeekdays', to_jsonb(v.working_weekdays), 'weekdayFractions', v.weekday_fractions,
      'holidayCalendarVersionId', v.holiday_calendar_version_id,
      'holidayCalendarChecksum', hcv.canonical_checksum)
    from public.work_calendar_versions v
    join public.holiday_calendar_versions hcv on hcv.id = v.holiday_calendar_version_id
    where v.id = p_version_id)::text, 'UTF8')), 'hex')
$$;

revoke all on function public.work_calendar_holiday_checksum(uuid) from public, anon, authenticated;
revoke all on function public.work_calendar_version_checksum(uuid) from public, anon, authenticated;
grant execute on function public.work_calendar_holiday_checksum(uuid) to service_role;
grant execute on function public.work_calendar_version_checksum(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. STABLE working_days(version, start, end) -> {count, excluded[]}. Requires published/superseded work
--     + holiday versions and that the range fits BOTH windows (fix #8).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.work_calendar_working_days(p_version_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v_ver     public.work_calendar_versions%rowtype;
  v_hcv     public.holiday_calendar_versions%rowtype;
  v_range   daterange;
  v_count   numeric := 0;
  v_excl    jsonb := '[]'::jsonb;
  v_day     date;
  v_isodow  int;
  v_pattern numeric;
  v_holiday numeric;
  v_hname   text;
begin
  if p_start is null or p_end is null or p_start > p_end then
    raise exception 'calendar.invalid_period' using errcode = 'PR422';
  end if;
  v_range := daterange(p_start, p_end + 1, '[)');

  select * into v_ver from public.work_calendar_versions where id = p_version_id;
  if not found or v_ver.status not in ('published','superseded') then
    raise exception 'calendar.version_unpublished' using errcode = 'PR422'; end if;
  if not (daterange(v_ver.effective_from, coalesce(v_ver.effective_to + 1, 'infinity'::date), '[)') @> v_range) then
    raise exception 'calendar.version_period_uncovered' using errcode = 'PR422'; end if;

  select * into v_hcv from public.holiday_calendar_versions where id = v_ver.holiday_calendar_version_id;
  if not found or v_hcv.status not in ('published','superseded') then
    raise exception 'calendar.holiday_set_unpublished' using errcode = 'PR422'; end if;
  if not (daterange(v_hcv.effective_from, coalesce(v_hcv.effective_to + 1, 'infinity'::date), '[)') @> v_range) then
    raise exception 'calendar.version_period_uncovered' using errcode = 'PR422'; end if;

  for v_day in select g::date from generate_series(p_start, p_end, interval '1 day') g loop
    v_isodow := extract(isodow from v_day)::int;
    if v_ver.weekday_fractions ? v_isodow::text then
      v_pattern := (v_ver.weekday_fractions ->> v_isodow::text)::numeric;
    elsif v_isodow = any (v_ver.working_weekdays) then
      v_pattern := 1;
    else
      v_pattern := 0;
    end if;

    select day_fraction, name_common into v_holiday, v_hname
      from public.holiday_dates
      where holiday_calendar_version_id = v_ver.holiday_calendar_version_id and effective_date = v_day;
    if v_holiday is null then v_holiday := 0; v_hname := null; end if;

    v_count := v_count + greatest(0, v_pattern - v_holiday);

    if v_pattern = 0 then
      v_excl := v_excl || jsonb_build_object('date', v_day, 'reason', 'weekend', 'lostFraction', (1)::numeric::text);
    elsif v_pattern < 1 then
      v_excl := v_excl || jsonb_build_object('date', v_day, 'reason', 'partial', 'lostFraction', (1 - v_pattern)::text);
    end if;
    if v_holiday > 0 then
      v_excl := v_excl || jsonb_build_object('date', v_day, 'reason', 'holiday',
        'lostFraction', least(v_holiday, v_pattern)::text, 'holidayName', v_hname);
    end if;
  end loop;

  return jsonb_build_object('count', v_count::text, 'excluded', v_excl);
end $$;

revoke all on function public.work_calendar_working_days(uuid, date, date) from public, anon, authenticated;
grant execute on function public.work_calendar_working_days(uuid, date, date) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Resolution: whole-period, no silent fallback (§6)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.work_calendar_resolve(p_pay_group_id uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v_period    daterange;
  v_asg       public.work_calendar_assignments%rowtype;
  v_intersect int;
  v_scope     text;
  v_wcv       public.work_calendar_versions%rowtype;
  v_hcv       public.holiday_calendar_versions%rowtype;
  v_country   text;
  v_hc_jur    text;
begin
  if p_start is null or p_end is null or p_start > p_end then
    raise exception 'calendar.invalid_period' using errcode = 'PR422';
  end if;
  v_period := daterange(p_start, p_end + 1, '[)');

  select count(*) into v_intersect from public.work_calendar_assignments a
   where a.scope = 'pay_group' and a.pay_group_id = p_pay_group_id and a.status = 'active'
     and daterange(a.effective_from, coalesce(a.effective_to + 1, 'infinity'::date), '[)') && v_period;
  if v_intersect > 0 then
    select * into v_asg from public.work_calendar_assignments a
     where a.scope = 'pay_group' and a.pay_group_id = p_pay_group_id and a.status = 'active'
       and daterange(a.effective_from, coalesce(a.effective_to + 1, 'infinity'::date), '[)') @> v_period
     limit 1;
    if not found then raise exception 'calendar.split_period' using errcode = 'PR422'; end if;
    v_scope := 'pay_group';
  else
    select count(*) into v_intersect from public.work_calendar_assignments a
     where a.scope = 'organization' and a.status = 'active'
       and daterange(a.effective_from, coalesce(a.effective_to + 1, 'infinity'::date), '[)') && v_period;
    if v_intersect = 0 then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
    select * into v_asg from public.work_calendar_assignments a
     where a.scope = 'organization' and a.status = 'active'
       and daterange(a.effective_from, coalesce(a.effective_to + 1, 'infinity'::date), '[)') @> v_period
     limit 1;
    if not found then raise exception 'calendar.split_period' using errcode = 'PR422'; end if;
    v_scope := 'organization';
  end if;

  select * into v_wcv from public.work_calendar_versions where id = v_asg.work_calendar_version_id;
  if v_wcv.status not in ('published', 'superseded') then
    raise exception 'calendar.version_unpublished' using errcode = 'PR422'; end if;
  if not (daterange(v_wcv.effective_from, coalesce(v_wcv.effective_to + 1, 'infinity'::date), '[)') @> v_period) then
    raise exception 'calendar.version_period_uncovered' using errcode = 'PR422'; end if;

  select * into v_hcv from public.holiday_calendar_versions where id = v_wcv.holiday_calendar_version_id;
  if v_hcv.status not in ('published', 'superseded') then
    raise exception 'calendar.holiday_set_unpublished' using errcode = 'PR422'; end if;
  if not (daterange(v_hcv.effective_from, coalesce(v_hcv.effective_to + 1, 'infinity'::date), '[)') @> v_period) then
    raise exception 'calendar.version_period_uncovered' using errcode = 'PR422'; end if;

  select statutory_country into v_country from public.finance_pay_groups where id = p_pay_group_id;
  select jurisdiction into v_hc_jur from public.holiday_calendars where id = v_hcv.holiday_calendar_id;
  if v_country is distinct from v_hc_jur then
    raise exception 'calendar.jurisdiction_mismatch' using errcode = 'PR422'; end if;

  return jsonb_build_object(
    'workCalendarId', v_wcv.work_calendar_id, 'workCalendarVersionId', v_wcv.id,
    'workCalendarChecksum', v_wcv.canonical_checksum, 'holidayCalendarVersionId', v_hcv.id,
    'holidayCalendarChecksum', v_hcv.canonical_checksum,
    'resolutionPath', jsonb_build_object('scope', v_scope, 'assignmentId', v_asg.id));
end $$;

revoke all on function public.work_calendar_resolve(uuid, date, date) from public, anon, authenticated;
grant execute on function public.work_calendar_resolve(uuid, date, date) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Shared idempotency helper: advisory lock + SQL-derived hash + receipt (fix #2).
--     Returns the stored result if this (actor, op, request_key) already ran with the SAME derived hash;
--     raises payload_conflict on a different hash; returns NULL to signal "proceed".
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.wc_idempotency_gate(
  p_actor_id text, p_operation text, p_request_key text, p_payload jsonb, out o_hash text, out o_replay jsonb)
language plpgsql volatile set search_path = pg_catalog, public as $$
declare v_r public.work_calendar_command_receipts%rowtype;
begin
  o_hash := encode(sha256(convert_to(p_actor_id || '|' || p_operation || '|' || coalesce(p_payload::text,''), 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtext(p_operation || '|' || p_actor_id || '|' || p_request_key)::bigint);
  select * into v_r from public.work_calendar_command_receipts
    where actor_id = p_actor_id and operation = p_operation and request_key = p_request_key;
  if found then
    if v_r.input_hash = o_hash then o_replay := v_r.result; return; end if;
    raise exception 'command.payload_conflict' using errcode = 'PR409';
  end if;
  o_replay := null;
end $$;

revoke all on function public.wc_idempotency_gate(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.wc_idempotency_gate(text, text, text, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Assignment command RPC (assign / end_assignment / cancel_assignment) -- fix #12 state guards.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.work_calendar_assign_tx(
  p_actor_id text, p_command text, p_request_key text, p_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = pg_catalog, public as $$
declare
  v_op text := 'work_calendar_assignment.' || p_command;
  v_hash text; v_replay jsonb; v_result jsonb; v_event text; v_record text;
  v_prev jsonb := null; v_new jsonb;
  v_asg public.work_calendar_assignments%rowtype;
  v_wcv public.work_calendar_versions%rowtype;
  v_hcv public.holiday_calendar_versions%rowtype;
  v_win daterange;
begin
  if p_actor_id is null or not exists (select 1 from public.app_users where id = p_actor_id and status = 'active') then
    raise exception 'calendar.actor_invalid' using errcode = 'PR403';
  end if;
  select o_hash, o_replay into v_hash, v_replay from public.wc_idempotency_gate(p_actor_id, v_op, p_request_key, p_payload);
  if v_replay is not null then return v_replay; end if;

  if p_command = 'assign' then
    select * into v_wcv from public.work_calendar_versions where id = (p_payload->>'workCalendarVersionId')::uuid;
    if not found or v_wcv.status <> 'published' then raise exception 'calendar.version_unpublished' using errcode = 'PR422'; end if;
    select * into v_hcv from public.holiday_calendar_versions where id = v_wcv.holiday_calendar_version_id;
    v_win := daterange((p_payload->>'effectiveFrom')::date, coalesce((p_payload->>'effectiveTo')::date + 1, 'infinity'::date), '[)');
    if not (daterange(v_wcv.effective_from, coalesce(v_wcv.effective_to + 1, 'infinity'::date), '[)') @> v_win
        and daterange(v_hcv.effective_from, coalesce(v_hcv.effective_to + 1, 'infinity'::date), '[)') @> v_win) then
      raise exception 'calendar.assignment_window_uncovered' using errcode = 'PR422'; end if;
    begin
      insert into public.work_calendar_assignments
        (scope, pay_group_id, work_calendar_version_id, effective_from, effective_to, status, assigned_by)
        values (p_payload->>'scope', nullif(p_payload->>'payGroupId', '')::uuid,
                (p_payload->>'workCalendarVersionId')::uuid, (p_payload->>'effectiveFrom')::date,
                (p_payload->>'effectiveTo')::date, 'active', p_actor_id)
        returning * into v_asg;
    exception when exclusion_violation then raise exception 'calendar.assignment_overlap' using errcode = 'PR409';
    end;
    v_event := 'work_calendar.assigned';

  elsif p_command in ('end_assignment','cancel_assignment') then
    select * into v_asg from public.work_calendar_assignments where id = (p_payload->>'assignmentId')::uuid for update;
    if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
    if v_asg.status <> 'active' then raise exception 'calendar.assignment_not_active' using errcode = 'PR409'; end if;   -- fix #12
    v_prev := to_jsonb(v_asg);
    if p_command = 'end_assignment' then
      -- only an OPEN assignment can be ended, and the end date cannot precede the start (fix #4)
      if v_asg.effective_to is not null then raise exception 'calendar.assignment_not_active' using errcode = 'PR409'; end if;
      if (p_payload->>'effectiveTo')::date < v_asg.effective_from then raise exception 'calendar.invalid_period' using errcode = 'PR422'; end if;
      begin
        update public.work_calendar_assignments
          set effective_to = (p_payload->>'effectiveTo')::date, ended_by = p_actor_id, end_reason = p_payload->>'reason'
          where id = v_asg.id returning * into v_asg;
      exception when exclusion_violation then raise exception 'calendar.assignment_overlap' using errcode = 'PR409';
      end;
      v_event := 'work_calendar.assignment_ended';
    else
      update public.work_calendar_assignments
        set status = 'cancelled', ended_by = p_actor_id, end_reason = p_payload->>'reason'
        where id = v_asg.id returning * into v_asg;
      v_event := 'work_calendar.assignment_cancelled';
    end if;

  else
    raise exception 'calendar.unknown_command' using errcode = 'PR400';
  end if;

  v_record := v_asg.id::text; v_new := to_jsonb(v_asg);
  v_result := jsonb_build_object('assignment', to_jsonb(v_asg));

  insert into public.app_events(event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values (v_event, 'hr_work_calendar', 'work_calendar_assignment', v_record, p_actor_id, 'success', v_result,
            'hr.work_calendar:' || v_op || ':' || p_actor_id || ':' || p_request_key);   -- fix #3
  insert into public.hr_audit_log(submodule_key, record_id, actor_id, action, previous_state, new_state, reason)
    values ('hr.work_calendar', v_record, p_actor_id, v_op, v_prev, v_new, p_payload->>'reason');
  insert into public.work_calendar_command_receipts(actor_id, operation, request_key, target_id, input_hash, result)
    values (p_actor_id, v_op, p_request_key, v_record, v_hash, v_result);
  return v_result;
end $$;

revoke all on function public.work_calendar_assign_tx(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.work_calendar_assign_tx(text, text, text, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. Work-calendar version command RPC (create/copy/set_pattern/publish)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.work_calendar_command_tx(
  p_actor_id text, p_command text, p_request_key text, p_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = pg_catalog, public as $$
declare
  v_op text := 'work_calendar.' || p_command;
  v_hash text; v_replay jsonb; v_result jsonb; v_event text; v_record text; v_prev jsonb := null; v_new jsonb;
  v_cal public.work_calendars%rowtype; v_ver public.work_calendar_versions%rowtype;
  v_src public.work_calendar_versions%rowtype; v_hcv public.holiday_calendar_versions%rowtype;
  v_next int; v_checksum text; v_weekdays smallint[]; v_cname text;
begin
  if p_actor_id is null or not exists (select 1 from public.app_users where id = p_actor_id and status = 'active') then
    raise exception 'calendar.actor_invalid' using errcode = 'PR403';
  end if;
  select o_hash, o_replay into v_hash, v_replay from public.wc_idempotency_gate(p_actor_id, v_op, p_request_key, p_payload);
  if v_replay is not null then return v_replay; end if;

  -- preserve submitted order (fix #7): let the DB validator reject noncanonical/duplicate input
  v_weekdays := (select array_agg((x.val)::smallint order by x.ord)
                 from jsonb_array_elements_text(p_payload->'workingWeekdays') with ordinality as x(val, ord));

  begin
    if p_command = 'create_version' then
      if nullif(p_payload->>'calendarId', '') is not null then
        select * into v_cal from public.work_calendars where id = (p_payload->>'calendarId')::uuid for update;
        if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
      else
        insert into public.work_calendars(name, created_by) values (p_payload#>>'{calendar,name}', p_actor_id) returning * into v_cal;
      end if;
      select * into v_hcv from public.holiday_calendar_versions where id = (p_payload->>'holidayCalendarVersionId')::uuid;
      if not found or v_hcv.status <> 'published' then raise exception 'calendar.holiday_set_unpublished' using errcode = 'PR422'; end if;
      select coalesce(max(version_no), 0) + 1 into v_next from public.work_calendar_versions where work_calendar_id = v_cal.id;
      insert into public.work_calendar_versions
        (work_calendar_id, version_no, status, effective_from, effective_to, timezone, working_weekdays,
         weekday_fractions, holiday_calendar_version_id, provenance, created_by)
        values (v_cal.id, v_next, 'draft', (p_payload->>'effectiveFrom')::date, (p_payload->>'effectiveTo')::date,
                coalesce(p_payload->>'timezone', 'America/Port_of_Spain'), v_weekdays,
                coalesce(p_payload->'weekdayFractions', '{}'::jsonb), v_hcv.id, 'user', p_actor_id)
        returning * into v_ver;
      v_event := 'work_calendar.version_drafted';

    elsif p_command = 'copy_version' then
      select * into v_src from public.work_calendar_versions where id = (p_payload->>'sourceVersionId')::uuid;
      if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
      select * into v_cal from public.work_calendars where id = v_src.work_calendar_id for update;
      select coalesce(max(version_no), 0) + 1 into v_next from public.work_calendar_versions where work_calendar_id = v_cal.id;
      insert into public.work_calendar_versions
        (work_calendar_id, version_no, status, effective_from, effective_to, timezone, working_weekdays,
         weekday_fractions, holiday_calendar_version_id, provenance, created_by)
        values (v_cal.id, v_next, 'draft', (p_payload->>'effectiveFrom')::date, (p_payload->>'effectiveTo')::date,
                v_src.timezone, v_src.working_weekdays, v_src.weekday_fractions, v_src.holiday_calendar_version_id, 'user', p_actor_id)
        returning * into v_ver;
      v_event := 'work_calendar.version_drafted';

    elsif p_command = 'set_pattern' then
      select * into v_ver from public.work_calendar_versions where id = (p_payload->>'versionId')::uuid for update;
      if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
      if v_ver.status <> 'draft' then raise exception 'calendar.version_immutable' using errcode = 'PR409'; end if;
      if v_ver.lock_version <> (p_payload->>'expectedLockVersion')::int then raise exception 'stale_lock_version' using errcode = 'PR409'; end if;
      if nullif(p_payload->>'holidayCalendarVersionId', '') is not null then
        select * into v_hcv from public.holiday_calendar_versions where id = (p_payload->>'holidayCalendarVersionId')::uuid;
        if not found or v_hcv.status <> 'published' then raise exception 'calendar.holiday_set_unpublished' using errcode = 'PR422'; end if;
      end if;
      v_prev := to_jsonb(v_ver);
      update public.work_calendar_versions
        set working_weekdays = v_weekdays, weekday_fractions = coalesce(p_payload->'weekdayFractions', '{}'::jsonb),
            holiday_calendar_version_id = coalesce(nullif(p_payload->>'holidayCalendarVersionId', '')::uuid, holiday_calendar_version_id),
            lock_version = lock_version + 1
        where id = v_ver.id returning * into v_ver;
      v_event := 'work_calendar.pattern_changed';

    elsif p_command = 'publish_version' then
      select * into v_ver from public.work_calendar_versions where id = (p_payload->>'versionId')::uuid;
      if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
      select * into v_cal from public.work_calendars where id = v_ver.work_calendar_id for update;                    -- lock order 1
      if v_cal.lock_version <> (p_payload->>'expectedCalendarLockVersion')::int then raise exception 'stale_lock_version' using errcode = 'PR409'; end if;
      select * into v_ver from public.work_calendar_versions where id = v_ver.id for update;                          -- lock order 2
      if v_ver.status <> 'draft' then raise exception 'calendar.version_immutable' using errcode = 'PR409'; end if;
      if v_ver.lock_version <> (p_payload->>'expectedVersionLockVersion')::int then raise exception 'stale_lock_version' using errcode = 'PR409'; end if;
      perform 1 from public.holiday_calendar_versions where id = v_ver.holiday_calendar_version_id for share;         -- lock order 3
      select * into v_hcv from public.holiday_calendar_versions where id = v_ver.holiday_calendar_version_id;
      if v_hcv.status not in ('published', 'superseded') then raise exception 'calendar.holiday_set_unpublished' using errcode = 'PR422'; end if;
      v_checksum := public.work_calendar_version_checksum(v_ver.id);
      update public.work_calendar_versions set status = 'superseded', superseded_at = now()
        where work_calendar_id = v_cal.id and status = 'published';
      v_prev := to_jsonb(v_ver);
      update public.work_calendar_versions
        set status = 'published', canonical_checksum = v_checksum, published_by = p_actor_id, published_at = now(), lock_version = lock_version + 1
        where id = v_ver.id returning * into v_ver;
      update public.work_calendars set lock_version = lock_version + 1 where id = v_cal.id;
      v_event := 'work_calendar.version_published';

    else
      raise exception 'calendar.unknown_command' using errcode = 'PR400';
    end if;
  exception when check_violation then
    get stacked diagnostics v_cname = constraint_name;                                                                -- fix #10
    if v_cname in ('work_calendar_versions_weekdays_ck','work_calendar_versions_fractions_ck') then
      raise exception 'calendar.invalid_pattern' using errcode = 'PR422';
    end if;
    raise;
  end;

  if v_cal.id is null then select * into v_cal from public.work_calendars where id = v_ver.work_calendar_id; end if;
  v_record := v_ver.id::text; v_new := to_jsonb(v_ver);
  v_result := jsonb_build_object('calendar', to_jsonb(v_cal), 'version', to_jsonb(v_ver));

  insert into public.app_events(event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values (v_event, 'hr_work_calendar', 'work_calendar_version', v_record, p_actor_id, 'success', v_result,
            'hr.work_calendar:' || v_op || ':' || p_actor_id || ':' || p_request_key);
  insert into public.hr_audit_log(submodule_key, record_id, actor_id, action, previous_state, new_state, reason)
    values ('hr.work_calendar', v_record, p_actor_id, v_op, v_prev, v_new, p_payload->>'reason');
  insert into public.work_calendar_command_receipts(actor_id, operation, request_key, target_id, input_hash, result)
    values (p_actor_id, v_op, p_request_key, v_record, v_hash, v_result);
  return v_result;
end $$;

revoke all on function public.work_calendar_command_tx(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.work_calendar_command_tx(text, text, text, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. Holiday-set command RPC (create/copy/add/update/remove holiday/publish)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.holiday_set_command_tx(
  p_actor_id text, p_command text, p_request_key text, p_payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = pg_catalog, public as $$
declare
  v_op text := 'holiday_set.' || p_command;
  v_hash text; v_replay jsonb; v_result jsonb; v_event text; v_record text; v_entity text := 'holiday_calendar_version';
  v_prev jsonb := null; v_new jsonb := null;
  v_cal public.holiday_calendars%rowtype; v_ver public.holiday_calendar_versions%rowtype;
  v_src public.holiday_calendar_versions%rowtype; v_hol public.holiday_dates%rowtype;
  v_h jsonb; v_next int; v_checksum text; v_cname text;
begin
  if p_actor_id is null or not exists (select 1 from public.app_users where id = p_actor_id and status = 'active') then
    raise exception 'calendar.actor_invalid' using errcode = 'PR403';
  end if;
  select o_hash, o_replay into v_hash, v_replay from public.wc_idempotency_gate(p_actor_id, v_op, p_request_key, p_payload);
  if v_replay is not null then return v_replay; end if;

  begin
    if p_command = 'create_version' then
      if nullif(p_payload->>'calendarId', '') is not null then
        select * into v_cal from public.holiday_calendars where id = (p_payload->>'calendarId')::uuid for update;
        if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
      else
        insert into public.holiday_calendars(name, jurisdiction, created_by)
          values (p_payload#>>'{calendar,name}', p_payload#>>'{calendar,jurisdiction}', p_actor_id) returning * into v_cal;
      end if;
      select coalesce(max(version_no), 0) + 1 into v_next from public.holiday_calendar_versions where holiday_calendar_id = v_cal.id;
      insert into public.holiday_calendar_versions(holiday_calendar_id, version_no, status, effective_from, effective_to, timezone, provenance, created_by)
        values (v_cal.id, v_next, 'draft', (p_payload->>'effectiveFrom')::date, (p_payload->>'effectiveTo')::date,
                coalesce(p_payload->>'timezone', 'America/Port_of_Spain'), 'user', p_actor_id) returning * into v_ver;
      v_event := 'holiday_calendar.version_drafted';

    elsif p_command = 'copy_version' then
      select * into v_src from public.holiday_calendar_versions where id = (p_payload->>'sourceVersionId')::uuid;
      if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
      select * into v_cal from public.holiday_calendars where id = v_src.holiday_calendar_id for update;
      select coalesce(max(version_no), 0) + 1 into v_next from public.holiday_calendar_versions where holiday_calendar_id = v_cal.id;
      insert into public.holiday_calendar_versions(holiday_calendar_id, version_no, status, effective_from, effective_to, timezone, provenance, created_by)
        values (v_cal.id, v_next, 'draft', (p_payload->>'effectiveFrom')::date, (p_payload->>'effectiveTo')::date, v_src.timezone, 'user', p_actor_id)
        returning * into v_ver;
      insert into public.holiday_dates(holiday_calendar_version_id, holiday_date, observed_date, day_fraction, year, jurisdiction,
          name_statutory, name_common, holiday_type, source_reference, source_published_date, provenance_note)
        select v_ver.id, holiday_date, observed_date, day_fraction, year, jurisdiction, name_statutory, name_common,
               holiday_type, source_reference, source_published_date, provenance_note
        from public.holiday_dates where holiday_calendar_version_id = v_src.id;
      v_event := 'holiday_calendar.version_drafted';

    elsif p_command in ('add_holiday', 'update_holiday', 'remove_holiday') then
      select * into v_ver from public.holiday_calendar_versions where id = (p_payload->>'versionId')::uuid for update;
      if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
      if v_ver.status <> 'draft' then raise exception 'calendar.version_immutable' using errcode = 'PR409'; end if;
      if v_ver.lock_version <> (p_payload->>'expectedLockVersion')::int then raise exception 'stale_lock_version' using errcode = 'PR409'; end if;

      if p_command = 'remove_holiday' then
        delete from public.holiday_dates where id = (p_payload->>'holidayId')::uuid and holiday_calendar_version_id = v_ver.id returning * into v_hol;
        if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
        v_prev := to_jsonb(v_hol);
      else
        v_h := p_payload->'holiday';
        begin
          -- jurisdiction/year/window are DB-enforced by holiday_dates_guard (fix #11); pass raw, trigger derives.
          if p_command = 'add_holiday' then
            insert into public.holiday_dates(holiday_calendar_version_id, holiday_date, observed_date, day_fraction, year, jurisdiction,
                name_statutory, name_common, holiday_type, source_reference, source_published_date, provenance_note)
              values (v_ver.id, (v_h->>'holidayDate')::date, (v_h->>'observedDate')::date, coalesce((v_h->>'dayFraction')::numeric, 1.0),
                      0, '', v_h->>'nameStatutory', v_h->>'nameCommon', v_h->>'holidayType',
                      v_h->>'sourceReference', (v_h->>'sourcePublishedDate')::date, v_h->>'provenanceNote') returning * into v_hol;
          else
            update public.holiday_dates set holiday_date = (v_h->>'holidayDate')::date, observed_date = (v_h->>'observedDate')::date,
                   day_fraction = coalesce((v_h->>'dayFraction')::numeric, 1.0), name_statutory = v_h->>'nameStatutory',
                   name_common = v_h->>'nameCommon', holiday_type = v_h->>'holidayType', source_reference = v_h->>'sourceReference',
                   source_published_date = (v_h->>'sourcePublishedDate')::date, provenance_note = v_h->>'provenanceNote'
              where id = (p_payload->>'holidayId')::uuid and holiday_calendar_version_id = v_ver.id returning * into v_hol;
            if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
          end if;
        exception when unique_violation then raise exception 'calendar.holiday_exists' using errcode = 'PR409';
        end;
        v_new := to_jsonb(v_hol);
      end if;
      update public.holiday_calendar_versions set lock_version = lock_version + 1 where id = v_ver.id returning * into v_ver;
      v_event := 'holiday_calendar.holiday_changed'; v_entity := 'holiday_date'; v_record := v_hol.id::text;

    elsif p_command = 'publish_version' then
      select * into v_ver from public.holiday_calendar_versions where id = (p_payload->>'versionId')::uuid;
      if not found then raise exception 'calendar.unresolved' using errcode = 'PR422'; end if;
      select * into v_cal from public.holiday_calendars where id = v_ver.holiday_calendar_id for update;
      if v_cal.lock_version <> (p_payload->>'expectedCalendarLockVersion')::int then raise exception 'stale_lock_version' using errcode = 'PR409'; end if;
      select * into v_ver from public.holiday_calendar_versions where id = v_ver.id for update;
      if v_ver.status <> 'draft' then raise exception 'calendar.version_immutable' using errcode = 'PR409'; end if;
      if v_ver.lock_version <> (p_payload->>'expectedVersionLockVersion')::int then raise exception 'stale_lock_version' using errcode = 'PR409'; end if;
      if not exists (select 1 from public.holiday_dates where holiday_calendar_version_id = v_ver.id) then
        raise exception 'calendar.holiday_set_empty' using errcode = 'PR422';   -- no empty publish (fix)
      end if;
      v_checksum := public.work_calendar_holiday_checksum(v_ver.id);
      update public.holiday_calendar_versions set status = 'superseded', superseded_at = now()
        where holiday_calendar_id = v_cal.id and status = 'published';
      v_prev := to_jsonb(v_ver);
      update public.holiday_calendar_versions
        set status = 'published', canonical_checksum = v_checksum, published_by = p_actor_id, published_at = now(), lock_version = lock_version + 1
        where id = v_ver.id returning * into v_ver;
      update public.holiday_calendars set lock_version = lock_version + 1 where id = v_cal.id;
      v_event := 'holiday_calendar.version_published';

    else
      raise exception 'calendar.unknown_command' using errcode = 'PR400';
    end if;
  exception when check_violation then
    get stacked diagnostics v_cname = constraint_name;                                   -- fix #5: scope by name
    if v_cname in ('holiday_dates_day_fraction_ck','holiday_dates_type_ck') then
      raise exception 'calendar.invalid_holiday' using errcode = 'PR422';
    end if;
    raise;
  end;

  if v_record is null then v_record := v_ver.id::text; end if;
  if v_cal.id is null then select * into v_cal from public.holiday_calendars where id = v_ver.holiday_calendar_id; end if;
  if v_new is null then v_new := to_jsonb(v_ver); end if;
  v_result := jsonb_build_object('calendar', to_jsonb(v_cal), 'version', to_jsonb(v_ver))
              || (case when v_hol.id is not null then jsonb_build_object('holiday', to_jsonb(v_hol)) else '{}'::jsonb end);

  insert into public.app_events(event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values (v_event, 'hr_work_calendar', v_entity, v_record, p_actor_id, 'success', v_result,
            'hr.work_calendar:' || v_op || ':' || p_actor_id || ':' || p_request_key);
  insert into public.hr_audit_log(submodule_key, record_id, actor_id, action, previous_state, new_state, reason)
    values ('hr.work_calendar', v_record, p_actor_id, v_op, v_prev, v_new, p_payload->>'reason');
  insert into public.work_calendar_command_receipts(actor_id, operation, request_key, target_id, input_hash, result)
    values (p_actor_id, v_op, p_request_key, v_record, v_hash, v_result);
  return v_result;
end $$;

revoke all on function public.holiday_set_command_tx(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.holiday_set_command_tx(text, text, text, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. Maintenance purge RPC (explicit reviewed retention/cascade path -- replaces pg_trigger_depth, fix #6).
--     Sets the transaction-local maintenance flag so holiday_dates_guard permits cascade cleanup, then
--     deletes assignments -> work calendars -> holiday calendars in FK-safe order.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.work_calendar_purge_tx(p_work_calendar_ids uuid[] default null, p_holiday_calendar_ids uuid[] default null)
returns void language plpgsql volatile security invoker set search_path = pg_catalog, public as $$
begin
  perform set_config('app.work_calendar_maintenance', 'on', true);
  if p_work_calendar_ids is not null then
    delete from public.work_calendar_assignments a
      using public.work_calendar_versions v
      where a.work_calendar_version_id = v.id and v.work_calendar_id = any(p_work_calendar_ids);
    delete from public.work_calendars where id = any(p_work_calendar_ids);
  end if;
  if p_holiday_calendar_ids is not null then
    delete from public.holiday_calendars where id = any(p_holiday_calendar_ids);
  end if;
end $$;

revoke all on function public.work_calendar_purge_tx(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.work_calendar_purge_tx(uuid[], uuid[]) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. Seed: the national holiday-calendar PARENT SHELL ONLY -- a named T&T calendar with NO version.
--     An empty system_seed version must not exist (it could be published with a checksum over []), and no
--     holiday provenance is authoritatively known here. An admin creates the first version and populates it
--     with the verified official 2026 dataset (statutory + movable holidays, real source references and
--     publication dates) before publishing. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.holiday_calendars(name, jurisdiction)
  select 'Trinidad & Tobago National', 'TT'
  where not exists (select 1 from public.holiday_calendars where name = 'Trinidad & Tobago National' and jurisdiction = 'TT');
