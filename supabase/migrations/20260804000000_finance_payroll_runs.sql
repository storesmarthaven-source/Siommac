-- ============================================================================
-- Finance Payroll — Phase 3 Stage 2
-- Tables: finance_payroll_runs, finance_payroll_run_inputs,
--         finance_payroll_run_lines, finance_payroll_run_warnings
-- Spec §8.1 / §8.2 / §8.3 / §8.6
-- ============================================================================

-- ── finance_payroll_runs (§8.1) ───────────────────────────────────────────────
create table if not exists public.finance_payroll_runs (
  id                    uuid primary key default gen_random_uuid(),
  run_no                text unique not null,
  period_month          date unique not null,
  pay_frequency         text not null default 'monthly',
  status                text not null default 'draft' check (status in (
                          'draft','input_locked','calculated','pending_approval',
                          'returned','approved','locked','exported','cancelled')),
  statutory_version_id  uuid not null references public.finance_statutory_versions(id) on delete restrict,
  weeks_in_period       numeric(6,3) not null default 4.333,
  employee_count        int not null default 0,
  gross_total           numeric(14,2) not null default 0,
  deduction_total       numeric(14,2) not null default 0,
  net_total             numeric(14,2) not null default 0,
  nis_employer_total    numeric(14,2) not null default 0,
  workflow_id           uuid references public.workflow_instances(id) on delete set null,
  input_locked_by       text references public.app_users(id) on delete set null,
  input_locked_at       timestamptz,
  created_by            text references public.app_users(id) on delete set null,
  approved_by           text references public.app_users(id) on delete set null,
  locked_by             text references public.app_users(id) on delete set null,
  locked_at             timestamptz,
  reopened_by           text references public.app_users(id) on delete set null,
  reopened_at           timestamptz,
  reopen_reason         text,
  exported_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists finance_payroll_runs_period_idx   on public.finance_payroll_runs(period_month);
create index if not exists finance_payroll_runs_status_idx   on public.finance_payroll_runs(status);
create index if not exists finance_payroll_runs_workflow_idx  on public.finance_payroll_runs(workflow_id)
  where workflow_id is not null;
alter table public.finance_payroll_runs enable row level security;
grant select, insert, update, delete on public.finance_payroll_runs to service_role;
drop trigger if exists trg_finance_payroll_runs_updated_at on public.finance_payroll_runs;
create trigger trg_finance_payroll_runs_updated_at
  before update on public.finance_payroll_runs
  for each row execute function public.set_updated_at();

-- ── finance_payroll_run_inputs (§8.2) ─────────────────────────────────────────
-- Frozen snapshot of HR inputs (base pay, pay items, OT, timesheets) at lock time.
-- Immutable after creation; no updated_at needed.
create table if not exists public.finance_payroll_run_inputs (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id    text not null references public.app_users(id) on delete restrict,
  source_type    text not null check (source_type in ('base_pay','pay_item','overtime','timesheet')),
  source_id      text,
  component_code text,
  label          text,
  amount         numeric(12,2),
  quantity       numeric(12,4),
  rate           numeric(12,4),
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists finance_payroll_run_inputs_run_idx      on public.finance_payroll_run_inputs(run_id);
create index if not exists finance_payroll_run_inputs_employee_idx on public.finance_payroll_run_inputs(employee_id);
alter table public.finance_payroll_run_inputs enable row level security;
grant select, insert, update, delete on public.finance_payroll_run_inputs to service_role;

-- ── finance_payroll_run_lines (§8.3) ──────────────────────────────────────────
-- Calculated results per employee per run, including NIS continuity snapshot.
create table if not exists public.finance_payroll_run_lines (
  id                          uuid primary key default gen_random_uuid(),
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
  -- NIS continuity snapshot (immutable audit of what was used at run time)
  nis_number_masked           text,
  nis_status                  text,
  nis_class_no                int,
  opening_ytd_nis_employee    numeric(12,2) not null default 0,
  opening_ytd_nis_employer    numeric(12,2) not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique(run_id, employee_id)
);
create index if not exists finance_payroll_run_lines_run_idx         on public.finance_payroll_run_lines(run_id);
create index if not exists finance_payroll_run_lines_employee_idx    on public.finance_payroll_run_lines(employee_id);
create index if not exists finance_payroll_run_lines_cost_center_idx on public.finance_payroll_run_lines(cost_center_id);
alter table public.finance_payroll_run_lines enable row level security;
grant select, insert, update, delete on public.finance_payroll_run_lines to service_role;
drop trigger if exists trg_finance_payroll_run_lines_updated_at on public.finance_payroll_run_lines;
create trigger trg_finance_payroll_run_lines_updated_at
  before update on public.finance_payroll_run_lines
  for each row execute function public.set_updated_at();

-- ── finance_payroll_run_warnings (§8.6) ───────────────────────────────────────
-- NIS + input exceptions emitted during calculate, gated by policy settings.
-- Warning types: missing_nis_number, nis_pending_verification, nis_not_applicable,
--                nis_class_not_found, previous_employer_data_missing, opening_balance_missing.
create table if not exists public.finance_payroll_run_warnings (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  employee_id    text references public.app_users(id) on delete cascade,
  warning_type   text not null,
  severity       text not null default 'warning' check (severity in ('info','warning','blocker')),
  message        text not null,
  metadata       jsonb not null default '{}'::jsonb,
  resolved       boolean not null default false,
  resolved_by    text references public.app_users(id) on delete set null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists finance_payroll_run_warnings_run_idx      on public.finance_payroll_run_warnings(run_id);
create index if not exists finance_payroll_run_warnings_employee_idx on public.finance_payroll_run_warnings(employee_id);
alter table public.finance_payroll_run_warnings enable row level security;
grant select, insert, update, delete on public.finance_payroll_run_warnings to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
