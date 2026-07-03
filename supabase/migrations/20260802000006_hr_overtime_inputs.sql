-- ============================================================================
-- HR Overtime Inputs — hr_overtime_entries
-- ============================================================================
-- Per §6 of the COMPENSATION_PAYROLL_PREP_IMPLEMENTATION_BRIEF.
-- Employee submits own OT; manager/HR approve by scope.
-- Rejected OT never enters payroll; approved OT can.
-- Paid OT is immutable (once linked to an exported/locked payroll run).
-- overtime_no generated via nextRef prefix 'OVT'.
-- ============================================================================

create table if not exists public.hr_overtime_entries (
  id uuid primary key default gen_random_uuid(),
  overtime_no text unique,
  employee_id text not null references public.app_users(id) on delete cascade,
  work_date date not null,
  hours numeric(8,2) not null check (hours > 0),
  multiplier numeric(5,2) not null default 1.5 check (multiplier > 0),
  reason text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','paid','cancelled')),
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  payroll_run_id uuid,
  payroll_run_line_id uuid,
  approved_by text references public.app_users(id) on delete set null,
  approved_at timestamptz,
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_overtime_entries_employee_idx    on public.hr_overtime_entries(employee_id, work_date);
create index if not exists hr_overtime_entries_status_idx      on public.hr_overtime_entries(status);
create index if not exists hr_overtime_entries_payroll_run_idx on public.hr_overtime_entries(payroll_run_id);

alter table public.hr_overtime_entries enable row level security;
grant select, insert, update, delete on public.hr_overtime_entries to service_role;

drop trigger if exists trg_hr_overtime_entries_updated_at on public.hr_overtime_entries;
create trigger trg_hr_overtime_entries_updated_at
  before update on public.hr_overtime_entries
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';
