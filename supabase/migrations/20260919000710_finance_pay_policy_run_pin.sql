-- F-02 Pay-Policy-to-Run Integration — schema foundation (Rev 4.1 contract §6).
-- Adds the immutable POLICY + WORK-CALENDAR pins to finance_payroll_runs, the one-per-snapshot policy
-- evidence manifest, and the one-per-working_days-employee calendar evidence. The create/lock/calc RPC
-- extensions (which populate these) ship in the companion migration 20260919000711. No F-CAL / F-01 object
-- is altered here; F-CAL tables are referenced read-only via FK. Idempotent, fix-at-source, no back-fill.

-- ── §6a) Policy pin columns on finance_payroll_runs ───────────────────────────
-- Store ONLY the version id (policy id derived from the version); mirror statutory_version_id's
-- `on delete restrict` immutable-pin precedent. pay_policy_required discriminates legacy rows.
alter table public.finance_payroll_runs
  add column if not exists pay_policy_version_id uuid,
  add column if not exists pay_policy_checksum   text,
  add column if not exists pay_policy_required    boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'finance_payroll_runs_pay_policy_version_fk') then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_pay_policy_version_fk
      foreign key (pay_policy_version_id) references public.finance_pay_policy_versions(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'finance_payroll_runs_pay_policy_checksum_ck') then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_pay_policy_checksum_ck
      check (pay_policy_checksum is null or pay_policy_checksum ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'finance_payroll_runs_pay_policy_required_ck') then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_pay_policy_required_ck
      check (pay_policy_required = false
             or (pay_policy_version_id is not null and pay_policy_checksum is not null));
  end if;
end $$;

-- Existing rows stay legacy (required=false/null); every NEW run created via the RPC sets required=true.
alter table public.finance_payroll_runs alter column pay_policy_required set default true;
create index if not exists finance_payroll_runs_pay_policy_version_idx
  on public.finance_payroll_runs (pay_policy_version_id);

-- ── §6a2) Work-calendar pin columns (nullable; set only for a working_days policy) ─
-- All-or-nothing: a run is either calendar-pinned (all five set) or not (all null); never half-pinned.
alter table public.finance_payroll_runs
  add column if not exists work_calendar_version_id    uuid,
  add column if not exists holiday_calendar_version_id uuid,
  add column if not exists work_calendar_checksum      text,
  add column if not exists holiday_calendar_checksum   text,
  add column if not exists calendar_resolution         jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'finance_payroll_runs_work_calendar_version_fk') then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_work_calendar_version_fk
      foreign key (work_calendar_version_id) references public.work_calendar_versions(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'finance_payroll_runs_holiday_calendar_version_fk') then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_holiday_calendar_version_fk
      foreign key (holiday_calendar_version_id) references public.holiday_calendar_versions(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'finance_payroll_runs_work_calendar_checksum_ck') then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_work_calendar_checksum_ck
      check (work_calendar_checksum is null or work_calendar_checksum ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'finance_payroll_runs_holiday_calendar_checksum_ck') then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_holiday_calendar_checksum_ck
      check (holiday_calendar_checksum is null or holiday_calendar_checksum ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'finance_payroll_runs_calendar_all_or_nothing_ck') then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_calendar_all_or_nothing_ck
      check (
        (work_calendar_version_id is null and holiday_calendar_version_id is null
         and work_calendar_checksum is null and holiday_calendar_checksum is null
         and calendar_resolution is null)
        or
        (work_calendar_version_id is not null and holiday_calendar_version_id is not null
         and work_calendar_checksum is not null and holiday_calendar_checksum is not null
         and calendar_resolution is not null)
      );
  end if;
end $$;

create index if not exists finance_payroll_runs_work_calendar_version_idx
  on public.finance_payroll_runs (work_calendar_version_id);

-- ── §6c) Resolution index for the policy assignment lookup ────────────────────
create index if not exists finance_pay_group_policy_assignments_resolve_idx
  on public.finance_pay_group_policy_assignments (pay_group_id, status, effective_from, effective_to);

-- ── §6b) Policy evidence manifest — exactly ONE row per input_snapshot ─────────
create table if not exists public.finance_payroll_run_policy_evidence (
  id                 uuid primary key default gen_random_uuid(),
  input_snapshot_id  uuid not null unique references public.finance_payroll_input_snapshots(id) on delete cascade,
  run_id             uuid not null references public.finance_payroll_runs(id) on delete cascade,
  policy_version_id  uuid not null references public.finance_pay_policy_versions(id) on delete restrict,
  checksum           text not null check (checksum ~ '^[0-9a-f]{64}$'),
  manifest           jsonb not null,
  created_at         timestamptz not null default now()
);
create index if not exists finance_payroll_run_policy_evidence_run_idx
  on public.finance_payroll_run_policy_evidence (run_id);

-- ── §6e) Per-employee calendar evidence — ONE row per working_days employee per snapshot ─
create table if not exists public.finance_payroll_run_calendar_evidence (
  id                        uuid primary key default gen_random_uuid(),
  input_snapshot_id         uuid not null references public.finance_payroll_input_snapshots(id) on delete cascade,
  run_id                    uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id               text not null references public.app_users(id),
  work_calendar_version_id  uuid not null references public.work_calendar_versions(id) on delete restrict,
  holiday_calendar_checksum text not null check (holiday_calendar_checksum ~ '^[0-9a-f]{64}$'),
  period_denominator        numeric not null check (period_denominator > 0),
  numerator                 numeric not null check (numerator >= 0),
  clamp_from                date,
  clamp_to                  date,
  excluded                  jsonb not null default '[]'::jsonb,
  created_at                timestamptz not null default now(),
  unique (input_snapshot_id, employee_id),
  check (numerator <= period_denominator)
);
create index if not exists finance_payroll_run_calendar_evidence_run_idx
  on public.finance_payroll_run_calendar_evidence (run_id);

-- ── Immutability (mirror the run-evidence pattern): before-update raises; DELETE cascades for retention/E2E ─
create or replace function public.finance_payroll_run_evidence_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'evidence rows are immutable' using errcode = 'PR409';
end $$;
revoke all on function public.finance_payroll_run_evidence_immutable() from public, anon, authenticated;

drop trigger if exists trg_finance_payroll_run_policy_evidence_immutable
  on public.finance_payroll_run_policy_evidence;
create trigger trg_finance_payroll_run_policy_evidence_immutable
  before update on public.finance_payroll_run_policy_evidence
  for each row execute function public.finance_payroll_run_evidence_immutable();

drop trigger if exists trg_finance_payroll_run_calendar_evidence_immutable
  on public.finance_payroll_run_calendar_evidence;
create trigger trg_finance_payroll_run_calendar_evidence_immutable
  before update on public.finance_payroll_run_calendar_evidence
  for each row execute function public.finance_payroll_run_evidence_immutable();

-- ── RLS + service-role-only writes ────────────────────────────────────────────
alter table public.finance_payroll_run_policy_evidence   enable row level security;
alter table public.finance_payroll_run_calendar_evidence enable row level security;
revoke all on table public.finance_payroll_run_policy_evidence   from anon, authenticated;
revoke all on table public.finance_payroll_run_calendar_evidence from anon, authenticated;
grant select, insert, update, delete on table public.finance_payroll_run_policy_evidence   to service_role;
grant select, insert, update, delete on table public.finance_payroll_run_calendar_evidence to service_role;
