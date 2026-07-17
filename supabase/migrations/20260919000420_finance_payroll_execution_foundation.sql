-- ============================================================================
-- Finance payroll execution foundation
-- ============================================================================
-- Forward upgrade for databases that already applied the original payroll
-- migrations. The original source migration is corrected as well; this file
-- upgrades existing installations instead of leaving the old monthly identity
-- or destructive calculation model in place.
-- ============================================================================

-- Run identity and lifecycle.
alter table public.finance_payroll_runs
  add column if not exists run_type text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists sequence_no integer,
  add column if not exists source_run_id uuid,
  add column if not exists released_by text,
  add column if not exists released_at timestamptz,
  add column if not exists creation_request_key text,
  add column if not exists creation_request_hash text;

-- Remove the old global monthly uniqueness constraint without assuming its name.
do $migration$
declare
  v_constraint text;
begin
  select c.conname
    into v_constraint
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
   where c.conrelid = 'public.finance_payroll_runs'::regclass
     and c.contype = 'u'
     and array_length(c.conkey, 1) = 1
     and a.attname = 'period_month'
   limit 1;

  if v_constraint is not null then
    execute format(
      'alter table public.finance_payroll_runs drop constraint %I',
      v_constraint
    );
  end if;
end
$migration$;

update public.finance_payroll_runs
   set run_type = coalesce(run_type, 'scheduled'),
       period_start = coalesce(period_start, period_month),
       period_end = coalesce(
         period_end,
         case pay_frequency
           when 'weekly' then period_month + 6
           when 'fortnightly' then period_month + 13
           when 'bi_weekly' then period_month + 13
           when 'semi_monthly' then
             case
               when extract(day from period_month) <= 15
                 then date_trunc('month', period_month)::date + 14
               else (date_trunc('month', period_month) + interval '1 month - 1 day')::date
             end
           else (date_trunc('month', period_month) + interval '1 month - 1 day')::date
         end
       ),
       sequence_no = coalesce(sequence_no, 1);

alter table public.finance_payroll_runs
  alter column run_type set default 'scheduled',
  alter column run_type set not null,
  alter column period_start set not null,
  alter column period_end set not null,
  alter column sequence_no set default 1,
  alter column sequence_no set not null;

-- Replace the original status constraint with the execution lifecycle.
do $migration$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any(c.conkey)
     where c.conrelid = 'public.finance_payroll_runs'::regclass
       and c.contype = 'c'
       and array_length(c.conkey, 1) = 1
       and a.attname = 'status'
  loop
    execute format(
      'alter table public.finance_payroll_runs drop constraint %I',
      v_constraint
    );
  end loop;
end
$migration$;

alter table public.finance_payroll_runs
  add constraint finance_payroll_runs_status_ck
    check (status in (
      'draft','input_locked','calculation_failed','calculated',
      'pending_approval','returned','approved','locked',
      'released','exported','cancelled'
    ));

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_run_type_ck'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_run_type_ck
      check (run_type in ('scheduled','off_cycle','correction','final_pay'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_period_order_ck'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_period_order_ck
      check (period_end >= period_start);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_sequence_ck'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_sequence_ck
      check (sequence_no > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_scheduled_sequence_ck'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_scheduled_sequence_ck
      check (run_type <> 'scheduled' or sequence_no = 1);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_source_fk'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_source_fk
      foreign key (source_run_id)
      references public.finance_payroll_runs(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_source_policy_ck'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_source_policy_ck
      check (
        (run_type = 'correction' and source_run_id is not null)
        or (run_type <> 'correction' and source_run_id is null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_source_not_self_ck'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_source_not_self_ck
      check (source_run_id is null or source_run_id <> id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_creation_receipt_ck'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_creation_receipt_ck
      check (
        (creation_request_key is null and creation_request_hash is null)
        or (creation_request_key is not null and creation_request_hash is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_released_by_fk'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_released_by_fk
      foreign key (released_by)
      references public.app_users(id)
      on delete set null;
  end if;
end
$migration$;

alter table public.finance_payroll_runs
  drop constraint if exists finance_payroll_runs_reporting_month_ck;

update public.finance_payroll_runs
   set pay_date = coalesce(pay_date, period_end),
       period_month = date_trunc('month', coalesce(pay_date, period_end))::date;

alter table public.finance_payroll_runs
  alter column pay_date set not null,
  add constraint finance_payroll_runs_reporting_month_ck
    check (period_month = date_trunc('month', pay_date)::date);

create unique index if not exists finance_payroll_runs_creation_request_uidx
  on public.finance_payroll_runs(creation_request_key)
  where creation_request_key is not null;

create unique index if not exists finance_payroll_runs_scheduled_key
  on public.finance_payroll_runs(
    coalesce(pay_group_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_start,
    period_end,
    run_type
  )
  where run_type = 'scheduled' and status <> 'cancelled';

create unique index if not exists finance_payroll_runs_sequence_key
  on public.finance_payroll_runs(
    coalesce(pay_group_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_start,
    period_end,
    run_type,
    sequence_no
  )
  where run_type <> 'scheduled' and status <> 'cancelled';

create index if not exists finance_payroll_runs_status_pay_date_idx
  on public.finance_payroll_runs(status, pay_date);
create index if not exists finance_payroll_runs_group_period_idx
  on public.finance_payroll_runs(pay_group_id, period_start, period_end);
create index if not exists finance_payroll_runs_source_idx
  on public.finance_payroll_runs(source_run_id)
  where source_run_id is not null;

-- Preserve cancelled downstream artifacts as history while allowing a
-- corrected payroll release to create one replacement active artifact.
alter table public.finance_disbursements
  drop constraint if exists finance_disbursements_payroll_run_id_key;
create unique index if not exists finance_disbursements_one_active_run_uidx
  on public.finance_disbursements(payroll_run_id)
  where status <> 'cancelled';

alter table public.finance_remittances
  drop constraint if exists finance_remittances_run_authority_period_uq;
create unique index if not exists finance_remittances_one_active_period_uidx
  on public.finance_remittances(
    payroll_run_id,
    authority,
    period_year,
    period_month
  )
  where status <> 'cancelled';

-- Durable input snapshots. finance_payroll_run_inputs remains the current
-- projection used by the calculation engine and is stamped with its snapshot.
create table if not exists public.finance_payroll_input_snapshots (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.finance_payroll_runs(id) on delete cascade,
  snapshot_no     integer not null check (snapshot_no > 0),
  checksum        text not null,
  employee_count  integer not null check (employee_count >= 0),
  input_count     integer not null check (input_count >= 0),
  source_summary  jsonb not null default '{}'::jsonb,
  locked_by       text references public.app_users(id) on delete set null,
  locked_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique(run_id, snapshot_no)
);
create index if not exists finance_payroll_input_snapshots_run_idx
  on public.finance_payroll_input_snapshots(run_id, snapshot_no desc);
alter table public.finance_payroll_input_snapshots enable row level security;
grant select, insert, update, delete on public.finance_payroll_input_snapshots to service_role;

-- Full immutable input evidence for each snapshot. The run_inputs table remains
-- the mutable current projection used by the calculator; these rows preserve
-- every source input needed to reconstruct and audit an earlier calculation.
create table if not exists public.finance_payroll_input_snapshot_lines (
  id                 uuid primary key default gen_random_uuid(),
  input_snapshot_id  uuid not null references public.finance_payroll_input_snapshots(id) on delete cascade,
  run_id             uuid not null references public.finance_payroll_runs(id) on delete cascade,
  input_row_no       integer not null check (input_row_no > 0),
  employee_id        text not null references public.app_users(id) on delete restrict,
  source_type        text not null check (source_type in ('base_pay','pay_item','overtime','timesheet')),
  source_id          text,
  component_code     text,
  label              text,
  amount             numeric(12,2),
  quantity           numeric(12,4),
  rate               numeric(12,4),
  metadata           jsonb not null default '{}'::jsonb,
  row_checksum       text not null,
  created_at         timestamptz not null default now(),
  unique(input_snapshot_id, input_row_no)
);
create index if not exists finance_payroll_input_snapshot_lines_run_idx
  on public.finance_payroll_input_snapshot_lines(run_id, input_snapshot_id);
create index if not exists finance_payroll_input_snapshot_lines_employee_idx
  on public.finance_payroll_input_snapshot_lines(input_snapshot_id, employee_id);
alter table public.finance_payroll_input_snapshot_lines enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_input_snapshot_lines
  to service_role;

create table if not exists public.finance_payroll_input_lock_receipts (
  request_key   text primary key,
  request_hash  text not null,
  run_id        uuid not null
                  references public.finance_payroll_runs(id) on delete cascade,
  actor_id      text not null
                  references public.app_users(id) on delete restrict,
  snapshot_id   uuid not null
                  references public.finance_payroll_input_snapshots(id) on delete cascade,
  result        jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists finance_payroll_input_lock_receipts_run_idx
  on public.finance_payroll_input_lock_receipts(run_id, created_at desc);
alter table public.finance_payroll_input_lock_receipts enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_input_lock_receipts
  to service_role;

alter table public.finance_payroll_runs
  add column if not exists current_input_snapshot_id uuid;
alter table public.finance_payroll_run_inputs
  add column if not exists input_snapshot_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_input_snapshot_fk'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_input_snapshot_fk
      foreign key (current_input_snapshot_id)
      references public.finance_payroll_input_snapshots(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_run_inputs'::regclass
       and conname = 'finance_payroll_run_inputs_snapshot_fk'
  ) then
    alter table public.finance_payroll_run_inputs
      add constraint finance_payroll_run_inputs_snapshot_fk
      foreign key (input_snapshot_id)
      references public.finance_payroll_input_snapshots(id)
      on delete restrict;
  end if;
end
$migration$;

create index if not exists finance_payroll_run_inputs_snapshot_idx
  on public.finance_payroll_run_inputs(input_snapshot_id);

-- Calculation attempts survive failures. A run can have only one active
-- attempt, while retries of the same command key return that attempt.
create table if not exists public.finance_payroll_calculation_attempts (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.finance_payroll_runs(id) on delete cascade,
  input_snapshot_id  uuid not null references public.finance_payroll_input_snapshots(id) on delete restrict,
  attempt_no         integer not null check (attempt_no > 0),
  idempotency_key    text not null,
  request_hash       text not null,
  status             text not null
                     check (status in ('running','succeeded','failed','cancelled')),
  progress           integer not null default 0 check (progress between 0 and 100),
  stage              text not null default 'starting',
  correlation_id     uuid not null default gen_random_uuid(),
  error_code         text,
  error_message      text,
  technical_detail   text,
  created_by         text references public.app_users(id) on delete set null,
  started_at         timestamptz not null default now(),
  lease_expires_at   timestamptz not null default (now() + interval '15 minutes'),
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique(run_id, attempt_no),
  unique(run_id, idempotency_key)
);
create unique index if not exists finance_payroll_calculation_attempt_active_uidx
  on public.finance_payroll_calculation_attempts(run_id)
  where status = 'running';
create index if not exists finance_payroll_calculation_attempts_run_idx
  on public.finance_payroll_calculation_attempts(run_id, attempt_no desc);
alter table public.finance_payroll_calculation_attempts enable row level security;
grant select, insert, update, delete on public.finance_payroll_calculation_attempts to service_role;

-- Immutable published calculation versions and their line evidence.
create table if not exists public.finance_payroll_calculation_versions (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references public.finance_payroll_runs(id) on delete cascade,
  attempt_id            uuid references public.finance_payroll_calculation_attempts(id) on delete restrict,
  input_snapshot_id     uuid not null references public.finance_payroll_input_snapshots(id) on delete restrict,
  version_no            integer not null check (version_no > 0),
  checksum              text not null,
  employee_count        integer not null check (employee_count >= 0),
  gross_total           numeric(14,2) not null,
  deduction_total       numeric(14,2) not null,
  net_total             numeric(14,2) not null,
  nis_employer_total    numeric(14,2) not null,
  statutory_version_id  uuid not null references public.finance_statutory_versions(id) on delete restrict,
  published_by          text references public.app_users(id) on delete set null,
  published_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique(run_id, version_no),
  unique(attempt_id)
);
create index if not exists finance_payroll_calculation_versions_run_idx
  on public.finance_payroll_calculation_versions(run_id, version_no desc);
alter table public.finance_payroll_calculation_versions enable row level security;
grant select, insert, update, delete on public.finance_payroll_calculation_versions to service_role;

create table if not exists public.finance_payroll_calculation_version_lines (
  id                          uuid primary key default gen_random_uuid(),
  calculation_version_id      uuid not null references public.finance_payroll_calculation_versions(id) on delete cascade,
  run_id                      uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id                 text not null references public.app_users(id) on delete restrict,
  base                        numeric(12,2) not null default 0,
  taxable_gross               numeric(12,2) not null default 0,
  gross                       numeric(12,2) not null default 0,
  nis_employee                numeric(12,2) not null default 0,
  nis_employer                numeric(12,2) not null default 0,
  health_surcharge            numeric(12,2) not null default 0,
  chargeable_income           numeric(12,2) not null default 0,
  paye                        numeric(12,2) not null default 0,
  voluntary_deductions        numeric(12,2) not null default 0,
  net                         numeric(12,2) not null default 0,
  breakdown                   jsonb not null default '{}'::jsonb,
  department_id               text,
  cost_center_id              uuid references public.finance_cost_centers(id) on delete set null,
  nis_number_masked           text,
  nis_status                  text,
  nis_class_no                integer,
  opening_ytd_nis_employee    numeric(12,2) not null default 0,
  opening_ytd_nis_employer    numeric(12,2) not null default 0,
  created_at                  timestamptz not null default now(),
  unique(calculation_version_id, employee_id)
);
create index if not exists finance_payroll_version_lines_run_idx
  on public.finance_payroll_calculation_version_lines(run_id, calculation_version_id);
create index if not exists finance_payroll_version_lines_employee_idx
  on public.finance_payroll_calculation_version_lines(employee_id, calculation_version_id);
alter table public.finance_payroll_calculation_version_lines enable row level security;
grant select, insert, update, delete on public.finance_payroll_calculation_version_lines to service_role;

alter table public.finance_payroll_runs
  add column if not exists current_calculation_version_id uuid;
alter table public.finance_payroll_run_lines
  add column if not exists calculation_version_id uuid;
alter table public.finance_payroll_run_warnings
  add column if not exists calculation_version_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_calculation_version_fk'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_calculation_version_fk
      foreign key (current_calculation_version_id)
      references public.finance_payroll_calculation_versions(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_run_lines'::regclass
       and conname = 'finance_payroll_run_lines_version_fk'
  ) then
    alter table public.finance_payroll_run_lines
      add constraint finance_payroll_run_lines_version_fk
      foreign key (calculation_version_id)
      references public.finance_payroll_calculation_versions(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_run_warnings'::regclass
       and conname = 'finance_payroll_run_warnings_version_fk'
  ) then
    alter table public.finance_payroll_run_warnings
      add constraint finance_payroll_run_warnings_version_fk
      foreign key (calculation_version_id)
      references public.finance_payroll_calculation_versions(id)
      on delete restrict;
  end if;
end
$migration$;

create index if not exists finance_payroll_run_lines_version_idx
  on public.finance_payroll_run_lines(calculation_version_id);
create index if not exists finance_payroll_run_warnings_version_idx
  on public.finance_payroll_run_warnings(calculation_version_id);

-- Normalize operational control findings. Raw warnings remain calculation
-- evidence; findings own assignment, state, resolution and waiver evidence.
create table if not exists public.finance_payroll_control_findings (
  id                       uuid primary key default gen_random_uuid(),
  run_id                   uuid not null references public.finance_payroll_runs(id) on delete cascade,
  calculation_version_id   uuid not null references public.finance_payroll_calculation_versions(id) on delete cascade,
  source_type              text not null,
  source_id                text not null,
  finding_type             text not null,
  domain                   text not null
                           check (domain in (
                             'population','input','statutory','payment',
                             'accounting','variance','funding','release'
                           )),
  severity                 text not null
                           check (severity in ('info','warning','blocker')),
  state                    text not null default 'open'
                           check (state in ('open','in_progress','resolved','waived')),
  title                    text not null,
  detail                   text not null,
  employee_id              text references public.app_users(id) on delete set null,
  assignee_id              text references public.app_users(id) on delete set null,
  due_at                   timestamptz,
  version                  integer not null default 1 check (version > 0),
  resolution_note          text,
  resolution_evidence      jsonb,
  resolved_by              text references public.app_users(id) on delete set null,
  resolved_at              timestamptz,
  waiver_reason            text,
  waived_by                text references public.app_users(id) on delete set null,
  waived_at                timestamptz,
  waiver_expires_at        timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique(calculation_version_id, source_type, source_id),
  constraint finance_payroll_findings_blocker_waiver_ck
    check (not (severity = 'blocker' and state = 'waived')),
  constraint finance_payroll_findings_resolution_ck
    check (
      (state = 'resolved' and resolved_by is not null and resolved_at is not null and resolution_note is not null)
      or state <> 'resolved'
    ),
  constraint finance_payroll_findings_waiver_ck
    check (
      (state = 'waived' and waived_by is not null and waived_at is not null and waiver_reason is not null)
      or state <> 'waived'
    )
);
create index if not exists finance_payroll_findings_run_state_idx
  on public.finance_payroll_control_findings(run_id, state, severity);
create index if not exists finance_payroll_findings_assignee_idx
  on public.finance_payroll_control_findings(assignee_id, state, due_at);
create index if not exists finance_payroll_findings_version_idx
  on public.finance_payroll_control_findings(calculation_version_id);
alter table public.finance_payroll_control_findings enable row level security;
grant select, insert, update, delete on public.finance_payroll_control_findings to service_role;
drop trigger if exists trg_finance_payroll_findings_updated_at
  on public.finance_payroll_control_findings;
create trigger trg_finance_payroll_findings_updated_at
  before update on public.finance_payroll_control_findings
  for each row execute function public.set_updated_at();

-- Payroll certification and release controls. A certification is immutable
-- evidence for one published calculation version. Funding confirmations and
-- release certificates are likewise append-only.
-- The legacy bank-account table documented one active primary per employee but
-- did not enforce it. Preserve every account while deterministically retaining
-- the most recently maintained primary before adding the invariant.
with ranked_primaries as (
  select
    id,
    row_number() over (
      partition by employee_id
      order by updated_at desc nulls last, created_at desc, id desc
    ) as primary_rank
  from public.finance_employee_bank_accounts
  where is_active = true
    and is_primary = true
),
duplicates as (
  select id
  from ranked_primaries
  where primary_rank > 1
)
update public.finance_employee_bank_accounts b
   set is_primary = false,
       metadata = coalesce(b.metadata, '{}'::jsonb) || jsonb_build_object(
         'primaryNormalization', jsonb_build_object(
           'migration', '20260919000420',
           'normalizedAt', now(),
           'reason', 'duplicate_active_primary'
         )
       )
  from duplicates d
 where b.id = d.id;

create unique index if not exists finance_employee_bank_accounts_one_active_primary_uidx
  on public.finance_employee_bank_accounts(employee_id)
  where is_active = true and is_primary = true;

alter table public.finance_disbursement_lines
  add column if not exists bank_name_snapshot text,
  add column if not exists branch_snapshot text,
  add column if not exists account_type_snapshot text,
  add column if not exists account_number_snapshot text,
  add column if not exists account_number_masked_snapshot text,
  add column if not exists transit_number_snapshot text,
  add column if not exists routing_snapshot_checksum text;

do $migration$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.finance_disbursement_lines'::regclass
       and conname = 'finance_disbursement_lines_account_type_snapshot_ck'
  ) then
    alter table public.finance_disbursement_lines
      add constraint finance_disbursement_lines_account_type_snapshot_ck
      check (
        account_type_snapshot is null
        or account_type_snapshot in ('savings','chequing')
      );
  end if;
end
$migration$;

create table if not exists public.finance_payroll_certifications (
  id                      uuid primary key default gen_random_uuid(),
  run_id                  uuid not null references public.finance_payroll_runs(id) on delete restrict,
  calculation_version_id  uuid not null references public.finance_payroll_calculation_versions(id) on delete restrict,
  input_snapshot_id       uuid not null references public.finance_payroll_input_snapshots(id) on delete restrict,
  certification_no        integer not null check (certification_no > 0),
  certification_type      text not null default 'processor'
                          check (certification_type in ('processor')),
  evidence                jsonb not null,
  state_checksum          text not null,
  checksum                text not null,
  supersedes_id           uuid references public.finance_payroll_certifications(id) on delete restrict,
  certified_by            text not null references public.app_users(id) on delete restrict,
  certified_at            timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  unique(run_id, calculation_version_id, certification_type, certification_no),
  constraint finance_payroll_certifications_evidence_object_ck
    check (jsonb_typeof(evidence) = 'object')
);
create index if not exists finance_payroll_certifications_run_idx
  on public.finance_payroll_certifications(run_id, certified_at desc);
create index if not exists finance_payroll_certifications_version_idx
  on public.finance_payroll_certifications(calculation_version_id, certified_at desc);
alter table public.finance_payroll_certifications enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_certifications
  to service_role;

create table if not exists public.finance_payroll_funding_confirmations (
  id                      uuid primary key default gen_random_uuid(),
  run_id                  uuid not null references public.finance_payroll_runs(id) on delete restrict,
  calculation_version_id  uuid not null references public.finance_payroll_calculation_versions(id) on delete restrict,
  confirmation_no         integer not null check (confirmation_no > 0),
  confirmed_amount        numeric(14,2) not null check (confirmed_amount >= 0),
  currency                text not null default 'TTD' check (currency = 'TTD'),
  confirmation_reference  text not null,
  account_reference       text,
  evidence                jsonb not null default '{}'::jsonb,
  checksum                text not null,
  supersedes_id           uuid references public.finance_payroll_funding_confirmations(id) on delete restrict,
  confirmed_by            text not null references public.app_users(id) on delete restrict,
  confirmed_at            timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  unique(run_id, calculation_version_id, confirmation_no),
  constraint finance_payroll_funding_evidence_object_ck
    check (jsonb_typeof(evidence) = 'object')
);
create index if not exists finance_payroll_funding_run_idx
  on public.finance_payroll_funding_confirmations(run_id, confirmed_at desc);
alter table public.finance_payroll_funding_confirmations enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_funding_confirmations
  to service_role;

create table if not exists public.finance_payroll_release_certificates (
  id                       uuid primary key default gen_random_uuid(),
  run_id                   uuid not null references public.finance_payroll_runs(id) on delete restrict,
  calculation_version_id   uuid not null references public.finance_payroll_calculation_versions(id) on delete restrict,
  certification_id         uuid not null references public.finance_payroll_certifications(id) on delete restrict,
  funding_confirmation_id  uuid not null references public.finance_payroll_funding_confirmations(id) on delete restrict,
  gl_journal_id            uuid not null references public.finance_gl_journals(id) on delete restrict,
  disbursement_id           uuid not null references public.finance_disbursements(id) on delete restrict,
  control_totals           jsonb not null,
  payslip_manifest         jsonb not null,
  artifact_checksums       jsonb not null,
  checksum                 text not null,
  released_by              text not null references public.app_users(id) on delete restrict,
  released_at              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  unique(run_id),
  unique(calculation_version_id),
  constraint finance_payroll_release_control_totals_object_ck
    check (jsonb_typeof(control_totals) = 'object'),
  constraint finance_payroll_release_payslip_manifest_object_ck
    check (jsonb_typeof(payslip_manifest) = 'object'),
  constraint finance_payroll_release_artifact_checksums_object_ck
    check (jsonb_typeof(artifact_checksums) = 'object')
);
create index if not exists finance_payroll_release_certificates_released_idx
  on public.finance_payroll_release_certificates(released_at desc);
alter table public.finance_payroll_release_certificates enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_release_certificates
  to service_role;

create table if not exists public.finance_payroll_release_remittances (
  release_certificate_id  uuid not null references public.finance_payroll_release_certificates(id) on delete cascade,
  remittance_id           uuid not null references public.finance_remittances(id) on delete restrict,
  authority               text not null
                           check (authority in ('paye_bir','nis_nibtt','health_surcharge')),
  period_year             integer not null
                           check (period_year between 2000 and 2100),
  period_month            integer not null
                           check (period_month between 1 and 12),
  created_at              timestamptz not null default now(),
  primary key (release_certificate_id, remittance_id),
  unique(release_certificate_id, authority, period_year, period_month)
);
alter table public.finance_payroll_release_remittances enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_release_remittances
  to service_role;

create table if not exists public.finance_payroll_release_command_receipts (
  id             uuid primary key default gen_random_uuid(),
  request_key    text not null unique,
  request_hash   text not null,
  run_id         uuid not null references public.finance_payroll_runs(id) on delete restrict,
  actor_id       text references public.app_users(id) on delete set null,
  command        text not null
                 check (command in ('certify','confirm_funding','release')),
  result         jsonb not null,
  created_at     timestamptz not null default now()
);
create index if not exists finance_payroll_release_receipts_run_idx
  on public.finance_payroll_release_command_receipts(run_id, created_at desc);
alter table public.finance_payroll_release_command_receipts enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_release_command_receipts
  to service_role;

alter table public.finance_payroll_runs
  add column if not exists approval_certification_id uuid,
  add column if not exists release_certificate_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_approval_certification_fk'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_approval_certification_fk
      foreign key (approval_certification_id)
      references public.finance_payroll_certifications(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_payroll_runs'::regclass
       and conname = 'finance_payroll_runs_release_certificate_fk'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_release_certificate_fk
      foreign key (release_certificate_id)
      references public.finance_payroll_release_certificates(id)
      on delete restrict;
  end if;
end
$migration$;

create index if not exists finance_payroll_runs_approval_certification_idx
  on public.finance_payroll_runs(approval_certification_id)
  where approval_certification_id is not null;
create unique index if not exists finance_payroll_runs_release_certificate_uidx
  on public.finance_payroll_runs(release_certificate_id)
  where release_certificate_id is not null;

-- A payroll period can cross an NIBTT contribution-month boundary. Preserve
-- one immutable remittance per statutory period instead of collapsing NIS into
-- the run's reporting month.
do $migration$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.finance_remittances'::regclass
       and c.contype = 'u'
       and (
         select array_agg(a.attname order by k.ordinality)
           from unnest(c.conkey) with ordinality as k(attnum, ordinality)
           join pg_attribute a
             on a.attrelid = c.conrelid
            and a.attnum = k.attnum
       ) = array['payroll_run_id','authority']::name[]
  loop
    execute format(
      'alter table public.finance_remittances drop constraint %I',
      v_constraint
    );
  end loop;
end
$migration$;

update public.finance_remittances
   set due_date = case authority
     when 'nis_nibtt' then
       (make_date(period_year, period_month, 1) + interval '1 month - 1 day')::date
     else
       (make_date(period_year, period_month, 1) + interval '1 month 14 days')::date
   end
 where due_date is null;

alter table public.finance_remittances
  alter column due_date set not null;

-- Canonical, deterministic certification state. Certification, submission and
-- lock all call this function so those boundaries cannot drift.
create or replace function public.finance_payroll_certification_state(
  p_run_id uuid,
  p_calculation_version_id uuid
) returns jsonb
language plpgsql
security invoker
stable
set search_path = public
as $fn$
declare
  v_run                       public.finance_payroll_runs%rowtype;
  v_version                   public.finance_payroll_calculation_versions%rowtype;
  v_snapshot                  public.finance_payroll_input_snapshots%rowtype;
  v_line_count                integer;
  v_gross_total               numeric(14,2);
  v_deduction_total           numeric(14,2);
  v_net_total                 numeric(14,2);
  v_nis_employer_total        numeric(14,2);
  v_salary_total              numeric(14,2);
  v_overtime_total            numeric(14,2);
  v_allowance_total           numeric(14,2);
  v_paye_total                numeric(14,2);
  v_nis_employee_total        numeric(14,2);
  v_health_total              numeric(14,2);
  v_voluntary_total           numeric(14,2);
  v_negative_net_count        integer;
  v_unresolved_blockers       integer;
  v_open_warnings             integer;
  v_running_attempts          integer;
  v_missing_bank_accounts     integer;
  v_duplicate_bank_accounts   integer;
  v_missing_gl_mappings       integer;
  v_population_matches        boolean;
  v_findings_checksum         text;
  v_bank_checksum             text;
  v_gl_checksum               text;
  v_state                     jsonb;
  v_ready                     boolean;
begin
  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id;
  if not found then
    raise exception 'finance_payroll_certification: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;

  select *
    into v_version
    from public.finance_payroll_calculation_versions
   where id = p_calculation_version_id
     and run_id = p_run_id;
  if not found then
    raise exception 'finance_payroll_certification: calculation version is not part of the run'
      using errcode = 'PR422';
  end if;

  select *
    into v_snapshot
    from public.finance_payroll_input_snapshots
   where id = v_version.input_snapshot_id
     and run_id = p_run_id;
  if not found then
    raise exception 'finance_payroll_certification: calculation input snapshot was not found'
      using errcode = 'PR422';
  end if;

  select
    count(*)::integer,
    coalesce(sum(l.gross), 0)::numeric(14,2),
    coalesce(sum(
      l.nis_employee + l.health_surcharge + l.paye + l.voluntary_deductions
    ), 0)::numeric(14,2),
    coalesce(sum(l.net), 0)::numeric(14,2),
    coalesce(sum(l.nis_employer), 0)::numeric(14,2),
    coalesce(sum(l.base), 0)::numeric(14,2),
    coalesce(sum(
      case
        when jsonb_typeof(l.breakdown->'approvedOtAmount') = 'number'
          then (l.breakdown->>'approvedOtAmount')::numeric
        else 0
      end
    ), 0)::numeric(14,2),
    coalesce(sum(
      case
        when jsonb_typeof(l.breakdown->'taxableAllowances') = 'number'
          then (l.breakdown->>'taxableAllowances')::numeric
        else 0
      end
      +
      case
        when jsonb_typeof(l.breakdown->'nonTaxableAllowances') = 'number'
          then (l.breakdown->>'nonTaxableAllowances')::numeric
        else 0
      end
    ), 0)::numeric(14,2),
    coalesce(sum(l.paye), 0)::numeric(14,2),
    coalesce(sum(l.nis_employee), 0)::numeric(14,2),
    coalesce(sum(l.health_surcharge), 0)::numeric(14,2),
    coalesce(sum(l.voluntary_deductions), 0)::numeric(14,2),
    count(*) filter (where l.net < 0)::integer
    into
      v_line_count,
      v_gross_total,
      v_deduction_total,
      v_net_total,
      v_nis_employer_total,
      v_salary_total,
      v_overtime_total,
      v_allowance_total,
      v_paye_total,
      v_nis_employee_total,
      v_health_total,
      v_voluntary_total,
      v_negative_net_count
    from public.finance_payroll_calculation_version_lines l
   where l.calculation_version_id = v_version.id;

  select
    not exists (
      (
        select distinct s.employee_id
          from public.finance_payroll_input_snapshot_lines s
         where s.input_snapshot_id = v_snapshot.id
        except
        select distinct l.employee_id
          from public.finance_payroll_calculation_version_lines l
         where l.calculation_version_id = v_version.id
      )
      union all
      (
        select distinct l.employee_id
          from public.finance_payroll_calculation_version_lines l
         where l.calculation_version_id = v_version.id
        except
        select distinct s.employee_id
          from public.finance_payroll_input_snapshot_lines s
         where s.input_snapshot_id = v_snapshot.id
      )
    )
    and (
      select count(distinct s.employee_id)
        from public.finance_payroll_input_snapshot_lines s
       where s.input_snapshot_id = v_snapshot.id
    ) = v_snapshot.employee_count
    into v_population_matches;

  select
    count(*) filter (
      where f.severity = 'blocker' and f.state <> 'resolved'
    )::integer,
    count(*) filter (
      where f.severity = 'warning' and f.state in ('open','in_progress')
    )::integer,
    md5(coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'severity', f.severity,
          'state', f.state,
          'version', f.version,
          'updatedAt', f.updated_at
        )
        order by f.id
      )::text,
      '[]'
    ))
    into v_unresolved_blockers, v_open_warnings, v_findings_checksum
    from public.finance_payroll_control_findings f
   where f.calculation_version_id = v_version.id;

  select count(*)::integer
    into v_running_attempts
    from public.finance_payroll_calculation_attempts a
   where a.run_id = p_run_id
     and a.status = 'running';

  select
    count(*) filter (where bank_count = 0)::integer,
    count(*) filter (where bank_count > 1)::integer,
    md5(coalesce(
      jsonb_agg(
        jsonb_build_object(
          'employeeId', employee_id,
          'accounts', account_state
        )
        order by employee_id
      )::text,
      '[]'
    ))
    into
      v_missing_bank_accounts,
      v_duplicate_bank_accounts,
      v_bank_checksum
    from (
      select
        l.employee_id,
        count(b.id)::integer as bank_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', b.id,
              'masked', b.account_number_masked,
              'updatedAt', b.updated_at
            )
            order by b.id
          ) filter (where b.id is not null),
          '[]'::jsonb
        ) as account_state
      from public.finance_payroll_calculation_version_lines l
      left join public.finance_employee_bank_accounts b
        on b.employee_id = l.employee_id
       and b.is_primary = true
       and b.is_active = true
      where l.calculation_version_id = v_version.id
      group by l.employee_id
    ) bank_state;

  with required(mapping_key, amount) as (
    values
      ('salary_expense', v_salary_total),
      ('overtime_expense', v_overtime_total),
      ('allowance_expense', v_allowance_total),
      ('employer_nis_expense', v_nis_employer_total),
      ('paye_payable', v_paye_total),
      ('nis_employee_payable', v_nis_employee_total),
      ('nis_employer_payable', v_nis_employer_total),
      ('health_surcharge_payable', v_health_total),
      ('deductions_payable', v_voluntary_total),
      ('net_pay_clearing', v_net_total)
  ),
  mapping_state as (
    select
      r.mapping_key,
      r.amount,
      m.id as mapping_id,
      m.account_code,
      m.updated_at as mapping_updated_at,
      a.id as account_id,
      a.is_active as account_active,
      a.updated_at as account_updated_at
    from required r
    left join public.finance_payroll_gl_mappings m
      on m.mapping_key = r.mapping_key
     and m.component_id is null
     and m.department_id is null
     and m.active = true
    left join public.finance_gl_accounts a
      on a.code = m.account_code
     and a.is_active = true
    where r.amount > 0
  )
  select
    count(*) filter (
      where mapping_id is null or account_id is null or account_active is distinct from true
    )::integer,
    md5(coalesce(
      jsonb_agg(
        jsonb_build_object(
          'mappingKey', mapping_key,
          'amount', amount,
          'accountCode', account_code,
          'mappingUpdatedAt', mapping_updated_at,
          'accountUpdatedAt', account_updated_at
        )
        order by mapping_key
      )::text,
      '[]'
    ))
    into v_missing_gl_mappings, v_gl_checksum
    from mapping_state;

  -- Certification proves the calculation package is internally coherent.
  -- Bank-account and GL-mapping state is included in the signed checksum for
  -- visibility/staleness detection, but is enforced by release preflight after
  -- lock, when payslips and the posted journal can exist.
  v_ready :=
    v_run.current_calculation_version_id = v_version.id
    and v_run.current_input_snapshot_id = v_version.input_snapshot_id
    and v_run.statutory_version_id = v_version.statutory_version_id
    and v_population_matches
    and v_line_count = v_version.employee_count
    and v_line_count = v_run.employee_count
    and v_gross_total = v_version.gross_total
    and v_gross_total = v_run.gross_total
    and v_deduction_total = v_version.deduction_total
    and v_deduction_total = v_run.deduction_total
    and v_net_total = v_version.net_total
    and v_net_total = v_run.net_total
    and v_nis_employer_total = v_version.nis_employer_total
    and v_nis_employer_total = v_run.nis_employer_total
    and v_negative_net_count = 0
    and v_unresolved_blockers = 0
    and v_running_attempts = 0;

  v_state := jsonb_build_object(
    'runId', v_run.id,
    'runStatus', v_run.status,
    'calculationVersionId', v_version.id,
    'calculationVersionNo', v_version.version_no,
    'calculationChecksum', v_version.checksum,
    'inputSnapshotId', v_snapshot.id,
    'inputSnapshotNo', v_snapshot.snapshot_no,
    'inputChecksum', v_snapshot.checksum,
    'statutoryVersionId', v_version.statutory_version_id,
    'currentCalculationMatches', v_run.current_calculation_version_id = v_version.id,
    'currentSnapshotMatches', v_run.current_input_snapshot_id = v_version.input_snapshot_id,
    'statutoryVersionMatches', v_run.statutory_version_id = v_version.statutory_version_id,
    'populationMatchesInputSnapshot', v_population_matches,
    'employeeCount', v_line_count,
    'grossTotal', v_gross_total,
    'deductionTotal', v_deduction_total,
    'netTotal', v_net_total,
    'nisEmployerTotal', v_nis_employer_total,
    'totalsMatch',
      v_line_count = v_version.employee_count
      and v_line_count = v_run.employee_count
      and v_population_matches
      and v_gross_total = v_version.gross_total
      and v_gross_total = v_run.gross_total
      and v_deduction_total = v_version.deduction_total
      and v_deduction_total = v_run.deduction_total
      and v_net_total = v_version.net_total
      and v_net_total = v_run.net_total
      and v_nis_employer_total = v_version.nis_employer_total
      and v_nis_employer_total = v_run.nis_employer_total,
    'negativeNetCount', v_negative_net_count,
    'unresolvedBlockerCount', v_unresolved_blockers,
    'openWarningCount', v_open_warnings,
    'runningAttemptCount', v_running_attempts,
    'missingBankAccountCount', v_missing_bank_accounts,
    'duplicateBankAccountCount', v_duplicate_bank_accounts,
    'missingGlMappingCount', v_missing_gl_mappings,
    'findingsChecksum', v_findings_checksum,
    'bankAccountChecksum', v_bank_checksum,
    'glMappingChecksum', v_gl_checksum
  );

  return v_state || jsonb_build_object(
    'ready', v_ready,
    -- Bank accounts and GL mappings are release-readiness inputs. They remain
    -- visible in the state response but do not invalidate a processor
    -- certification made before those downstream artifacts are prepared.
    'stateChecksum', md5((
      v_state
        - 'missingBankAccountCount'
        - 'duplicateBankAccountCount'
        - 'missingGlMappingCount'
        - 'bankAccountChecksum'
        - 'glMappingChecksum'
    )::text)
  );
end
$fn$;

revoke all on function public.finance_payroll_certification_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_certification_state(uuid, uuid)
  to service_role;

-- Backfill one durable snapshot and one immutable version for existing current
-- payroll evidence. Fresh databases have no rows here, so these are no-ops.
insert into public.finance_payroll_input_snapshots (
  run_id,
  snapshot_no,
  checksum,
  employee_count,
  input_count,
  source_summary,
  locked_by,
  locked_at
)
select
  r.id,
  1,
  'legacy-' || md5(r.id::text || ':' || count(i.id)::text),
  count(distinct i.employee_id)::integer,
  count(i.id)::integer,
  jsonb_build_object('migration', '20260919000420'),
  r.input_locked_by,
  coalesce(r.input_locked_at, r.updated_at, r.created_at)
from public.finance_payroll_runs r
join public.finance_payroll_run_inputs i on i.run_id = r.id
where r.current_input_snapshot_id is null
group by r.id, r.input_locked_by, r.input_locked_at, r.updated_at, r.created_at
on conflict (run_id, snapshot_no) do nothing;

update public.finance_payroll_run_inputs i
   set input_snapshot_id = s.id
  from public.finance_payroll_input_snapshots s
 where s.run_id = i.run_id
   and s.snapshot_no = 1
   and i.input_snapshot_id is null;

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
  row_checksum,
  created_at
)
select
  i.input_snapshot_id,
  i.run_id,
  row_number() over (
    partition by i.input_snapshot_id
    order by i.employee_id, i.source_type, i.source_id nulls first,
      i.component_code nulls first, i.id
  )::integer,
  i.employee_id,
  i.source_type,
  i.source_id,
  i.component_code,
  i.label,
  i.amount,
  i.quantity,
  i.rate,
  i.metadata,
  md5(jsonb_build_object(
    'employeeId', i.employee_id,
    'sourceType', i.source_type,
    'sourceId', i.source_id,
    'componentCode', i.component_code,
    'label', i.label,
    'amount', i.amount,
    'quantity', i.quantity,
    'rate', i.rate,
    'metadata', i.metadata
  )::text),
  i.created_at
from public.finance_payroll_run_inputs i
where i.input_snapshot_id is not null
on conflict (input_snapshot_id, input_row_no) do nothing;

update public.finance_payroll_runs r
   set current_input_snapshot_id = s.id
  from public.finance_payroll_input_snapshots s
 where s.run_id = r.id
   and s.snapshot_no = 1
   and r.current_input_snapshot_id is null;

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
  published_by,
  published_at
)
select
  r.id,
  null,
  r.current_input_snapshot_id,
  1,
  'legacy-' || md5(
    r.id::text || ':' || r.gross_total::text || ':' || r.net_total::text
  ),
  r.employee_count,
  r.gross_total,
  r.deduction_total,
  r.net_total,
  r.nis_employer_total,
  r.statutory_version_id,
  coalesce(r.approved_by, r.created_by),
  coalesce(r.updated_at, r.created_at)
from public.finance_payroll_runs r
where r.current_input_snapshot_id is not null
  and r.current_calculation_version_id is null
  and (
    exists (
      select 1
        from public.finance_payroll_run_lines l
       where l.run_id = r.id
    )
    or r.status in (
      'calculated','pending_approval','returned','approved',
      'locked','released','exported'
    )
  )
on conflict (run_id, version_no) do nothing;

update public.finance_payroll_run_lines l
   set calculation_version_id = v.id
  from public.finance_payroll_calculation_versions v
 where v.run_id = l.run_id
   and v.version_no = 1
   and l.calculation_version_id is null;

update public.finance_payroll_run_warnings w
   set calculation_version_id = v.id
  from public.finance_payroll_calculation_versions v
 where v.run_id = w.run_id
   and v.version_no = 1
   and w.calculation_version_id is null;

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
  opening_ytd_nis_employer,
  created_at
)
select
  l.calculation_version_id,
  l.run_id,
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
  l.breakdown,
  l.department_id,
  l.cost_center_id,
  l.nis_number_masked,
  l.nis_status,
  l.nis_class_no,
  l.opening_ytd_nis_employee,
  l.opening_ytd_nis_employer,
  l.created_at
from public.finance_payroll_run_lines l
where l.calculation_version_id is not null
on conflict (calculation_version_id, employee_id) do nothing;

update public.finance_payroll_runs r
   set current_calculation_version_id = v.id
  from public.finance_payroll_calculation_versions v
 where v.run_id = r.id
   and v.version_no = 1
   and r.current_calculation_version_id is null;

-- Preserve valid in-flight approvals during the forward upgrade. The migration
-- refuses to manufacture evidence for an incoherent run; operators receive the
-- exact run identifier and must repair it before applying this migration.
do $migration$
declare
  v_run    public.finance_payroll_runs%rowtype;
  v_state  jsonb;
  v_actor  text;
  v_cert   public.finance_payroll_certifications%rowtype;
begin
  for v_run in
    select *
      from public.finance_payroll_runs
     where status in (
       'pending_approval','approved','locked','released','exported'
     )
       and current_calculation_version_id is not null
       and approval_certification_id is null
     order by created_at, id
     for update
  loop
    v_actor := coalesce(v_run.approved_by, v_run.created_by);
    if v_actor is null then
      raise exception
        'finance payroll upgrade: run % (%) has no actor for certification backfill',
        v_run.run_no, v_run.id;
    end if;

    v_state := public.finance_payroll_certification_state(
      v_run.id,
      v_run.current_calculation_version_id
    );
    if coalesce((v_state->>'ready')::boolean, false) is not true then
      raise exception
        'finance payroll upgrade: run % (%) is not internally coherent: %',
        v_run.run_no, v_run.id, v_state;
    end if;

    insert into public.finance_payroll_certifications (
      run_id,
      calculation_version_id,
      input_snapshot_id,
      certification_no,
      certification_type,
      evidence,
      state_checksum,
      checksum,
      certified_by,
      certified_at
    )
    values (
      v_run.id,
      v_run.current_calculation_version_id,
      v_run.current_input_snapshot_id,
      1,
      'processor',
      jsonb_build_object(
        'migration', '20260919000420',
        'legacyStatus', v_run.status,
        'state', v_state
      ),
      v_state->>'stateChecksum',
      md5(jsonb_build_object(
        'runId', v_run.id,
        'calculationVersionId', v_run.current_calculation_version_id,
        'inputSnapshotId', v_run.current_input_snapshot_id,
        'stateChecksum', v_state->>'stateChecksum',
        'migration', '20260919000420'
      )::text),
      v_actor,
      coalesce(v_run.updated_at, v_run.created_at, now())
    )
    returning * into v_cert;

    update public.finance_payroll_runs
       set approval_certification_id = v_cert.id
     where id = v_run.id;
  end loop;
end
$migration$;

-- Published payroll evidence is append-only. Retention deletion remains a
-- privileged maintenance operation; ordinary application commands cannot
-- rewrite evidence after publication.
create or replace function public.finance_payroll_reject_evidence_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  raise exception 'finance payroll evidence table % is append-only', tg_table_name
    using errcode = 'PR409';
end
$fn$;

drop trigger if exists trg_finance_payroll_input_snapshots_immutable
  on public.finance_payroll_input_snapshots;
create trigger trg_finance_payroll_input_snapshots_immutable
  before update on public.finance_payroll_input_snapshots
  for each row execute function public.finance_payroll_reject_evidence_update();

drop trigger if exists trg_finance_payroll_input_snapshot_lines_immutable
  on public.finance_payroll_input_snapshot_lines;
create trigger trg_finance_payroll_input_snapshot_lines_immutable
  before update on public.finance_payroll_input_snapshot_lines
  for each row execute function public.finance_payroll_reject_evidence_update();

drop trigger if exists trg_finance_payroll_input_lock_receipts_immutable
  on public.finance_payroll_input_lock_receipts;
create trigger trg_finance_payroll_input_lock_receipts_immutable
  before update on public.finance_payroll_input_lock_receipts
  for each row execute function public.finance_payroll_reject_evidence_update();

drop trigger if exists trg_finance_payroll_calculation_versions_immutable
  on public.finance_payroll_calculation_versions;
create trigger trg_finance_payroll_calculation_versions_immutable
  before update on public.finance_payroll_calculation_versions
  for each row execute function public.finance_payroll_reject_evidence_update();

drop trigger if exists trg_finance_payroll_calculation_version_lines_immutable
  on public.finance_payroll_calculation_version_lines;
create trigger trg_finance_payroll_calculation_version_lines_immutable
  before update on public.finance_payroll_calculation_version_lines
  for each row execute function public.finance_payroll_reject_evidence_update();

drop trigger if exists trg_finance_payroll_certifications_immutable
  on public.finance_payroll_certifications;
create trigger trg_finance_payroll_certifications_immutable
  before update on public.finance_payroll_certifications
  for each row execute function public.finance_payroll_reject_evidence_update();

drop trigger if exists trg_finance_payroll_funding_confirmations_immutable
  on public.finance_payroll_funding_confirmations;
create trigger trg_finance_payroll_funding_confirmations_immutable
  before update on public.finance_payroll_funding_confirmations
  for each row execute function public.finance_payroll_reject_evidence_update();

drop trigger if exists trg_finance_payroll_release_certificates_immutable
  on public.finance_payroll_release_certificates;
create trigger trg_finance_payroll_release_certificates_immutable
  before update on public.finance_payroll_release_certificates
  for each row execute function public.finance_payroll_reject_evidence_update();

drop trigger if exists trg_finance_payroll_release_remittances_immutable
  on public.finance_payroll_release_remittances;
create trigger trg_finance_payroll_release_remittances_immutable
  before update on public.finance_payroll_release_remittances
  for each row execute function public.finance_payroll_reject_evidence_update();

comment on column public.finance_payroll_runs.period_month is
  'Payment/deduction month derived from pay_date. Not a payroll-run business identity.';
comment on column public.finance_payroll_runs.current_input_snapshot_id is
  'The immutable input snapshot used by the next/current calculation.';
comment on column public.finance_payroll_runs.current_calculation_version_id is
  'The current immutable published calculation version.';

-- PostgREST schema cache is refreshed by the operator after migration apply.
