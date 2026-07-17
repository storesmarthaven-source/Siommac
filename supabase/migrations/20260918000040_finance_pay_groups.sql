-- ============================================================================
-- Finance Payroll — Pay groups + membership (Wave 3b)
-- A pay group defines a frequency (+ pay-day / cutoff defaults). Employees are
-- assigned to a group (effective-dated). A payroll run scoped to a pay group
-- takes the group's frequency and only populates that group's members.
-- Single-tenant: NO organization_id. app_users.id is TEXT.
-- ============================================================================

create table if not exists public.finance_pay_groups (
  id                          uuid primary key default gen_random_uuid(),
  code                        text not null unique,
  name                        text not null,
  frequency                   text not null
                                check (frequency in ('weekly','fortnightly','semi_monthly','monthly')),
  default_pay_day             integer,        -- day-of-month (monthly/semi) or 0-6 weekday (weekly/fortnightly)
  default_cutoff_offset_days  integer not null default 0,
  statutory_country           text not null default 'TT',
  active                      boolean not null default true,
  created_by                  text references public.app_users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
alter table public.finance_pay_groups enable row level security;
grant select, insert, update, delete on public.finance_pay_groups to service_role;

create table if not exists public.finance_employee_pay_group_assignments (
  employee_id    text not null references public.app_users(id) on delete cascade,
  pay_group_id   uuid not null references public.finance_pay_groups(id) on delete cascade,
  effective_from date not null,
  effective_to   date,
  created_by     text references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (employee_id, pay_group_id, effective_from)
);
create index if not exists fepga_group_idx    on public.finance_employee_pay_group_assignments(pay_group_id);
create index if not exists fepga_employee_idx on public.finance_employee_pay_group_assignments(employee_id);
alter table public.finance_employee_pay_group_assignments enable row level security;
grant select, insert, update, delete on public.finance_employee_pay_group_assignments to service_role;

-- Link a run to its pay group (null = all active employees, legacy behaviour).
alter table public.finance_payroll_runs
  add column if not exists pay_group_id uuid references public.finance_pay_groups(id) on delete set null;

-- Payroll-run identity. The zero UUID gives unscoped runs an intentional key;
-- PostgreSQL otherwise treats null pay_group_id values as all distinct.
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

create index if not exists finance_payroll_runs_group_period_idx
  on public.finance_payroll_runs(pay_group_id, period_start, period_end);

-- After applying, run: NOTIFY pgrst, 'reload schema';
