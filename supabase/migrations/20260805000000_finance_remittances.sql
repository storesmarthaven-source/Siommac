-- ============================================================================
-- Finance — Statutory Remittances & Filing (F1)
-- Tables: finance_remittances (header), finance_remittance_lines (per-employee)
-- Spec §F1 / Statutory Remittances & Filing
-- ============================================================================
-- This migration is OPERATOR-APPLIED only — DO NOT run from application code.
-- After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── finance_remittances (remittance header per authority per payroll run) ─────
create table if not exists public.finance_remittances (
  id                  uuid primary key default gen_random_uuid(),
  remittance_no       text unique not null,
  period_year         int not null check (period_year >= 2000 and period_year <= 2100),
  period_month        int not null check (period_month >= 1 and period_month <= 12),
  authority           text not null check (authority in ('paye_bir','nis_nibtt','health_surcharge')),
  payroll_run_id      uuid not null references public.finance_payroll_runs(id) on delete restrict,
  employee_portion    numeric(15,2) not null default 0,
  employer_portion    numeric(15,2) not null default 0,
  total_due           numeric(15,2) not null default 0,
  currency            text not null default 'TTD',
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','paid','filed','cancelled')),
  due_date            date not null,
  paid_date           date,
  filed_date          date,
  authority_reference text,           -- receipt / filing reference # from the authority
  workflow_id         uuid references public.workflow_instances(id) on delete set null,
  created_by          text references public.app_users(id) on delete set null,
  approved_by         text references public.app_users(id) on delete set null,
  cancelled_by        text references public.app_users(id) on delete set null,
  cancel_reason       text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists finance_remittances_run_idx
  on public.finance_remittances(payroll_run_id);
-- Cancelled records remain as immutable history. Only one active artifact may
-- exist for a run, authority and statutory period at a time.
create unique index if not exists finance_remittances_one_active_period_uidx
  on public.finance_remittances(
    payroll_run_id,
    authority,
    period_year,
    period_month
  )
  where status <> 'cancelled';
create index if not exists finance_remittances_status_idx
  on public.finance_remittances(status);
create index if not exists finance_remittances_period_idx
  on public.finance_remittances(period_year, period_month);
create index if not exists finance_remittances_authority_idx
  on public.finance_remittances(authority);
create index if not exists finance_remittances_workflow_idx
  on public.finance_remittances(workflow_id) where workflow_id is not null;

alter table public.finance_remittances enable row level security;
grant select, insert, update, delete on public.finance_remittances to service_role;

drop trigger if exists trg_finance_remittances_updated_at on public.finance_remittances;
create trigger trg_finance_remittances_updated_at
  before update on public.finance_remittances
  for each row execute function public.set_updated_at();

-- ── finance_remittance_lines (per-employee breakdown) ─────────────────────────
-- Each row = one employee's contribution to a given remittance.
-- Computed from finance_payroll_run_lines at create time and frozen.
create table if not exists public.finance_remittance_lines (
  id               uuid primary key default gen_random_uuid(),
  remittance_id    uuid not null references public.finance_remittances(id) on delete cascade,
  employee_id      text not null references public.app_users(id) on delete restrict,
  employee_portion numeric(12,2) not null default 0,
  employer_portion numeric(12,2) not null default 0,
  line_total       numeric(12,2) not null default 0,
  source_line_id   uuid references public.finance_payroll_run_lines(id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (remittance_id, employee_id)
);

create index if not exists finance_remittance_lines_remittance_idx
  on public.finance_remittance_lines(remittance_id);
create index if not exists finance_remittance_lines_employee_idx
  on public.finance_remittance_lines(employee_id);

alter table public.finance_remittance_lines enable row level security;
grant select, insert, update, delete on public.finance_remittance_lines to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
