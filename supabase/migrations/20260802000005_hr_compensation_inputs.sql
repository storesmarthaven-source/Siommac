-- ============================================================================
-- HR Compensation Inputs — hr_employee_pay_items
-- ============================================================================
-- Per §5 of the COMPENSATION_PAYROLL_PREP_IMPLEMENTATION_BRIEF.
-- HR-owned table for employee allowances / deductions.
-- References finance_pay_components (Finance-owned catalogue).
-- HR can only use ACTIVE Finance components — enforced in the service layer.
-- item_no generated via nextRef prefix 'PIT'.
-- Lifecycle: draft → pending_approval → active / rejected / retired
-- Retire-never-delete: items used in exported runs are immutable.
-- ============================================================================

create table if not exists public.hr_employee_pay_items (
  id uuid primary key default gen_random_uuid(),
  item_no text unique,
  employee_id text not null references public.app_users(id) on delete cascade,
  component_id uuid not null references public.finance_pay_components(id) on delete restrict,
  amount numeric(12,2),
  percent numeric(5,2),
  effective_from date not null,
  effective_to date,
  status text not null default 'draft' check (status in ('draft','pending_approval','active','rejected','retired')),
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  is_active boolean not null default false,
  note text,
  created_by text references public.app_users(id) on delete set null,
  approved_by text references public.app_users(id) on delete set null,
  approved_at timestamptz,
  retired_by text references public.app_users(id) on delete set null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_employee_pay_items_amount_or_percent_check
    check ((amount is not null and percent is null) or (amount is null and percent is not null)),
  constraint hr_employee_pay_items_effective_check
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists hr_employee_pay_items_employee_idx  on public.hr_employee_pay_items(employee_id, is_active);
create index if not exists hr_employee_pay_items_component_idx on public.hr_employee_pay_items(component_id);
create index if not exists hr_employee_pay_items_status_idx    on public.hr_employee_pay_items(status);

alter table public.hr_employee_pay_items enable row level security;
grant select, insert, update, delete on public.hr_employee_pay_items to service_role;

drop trigger if exists trg_hr_employee_pay_items_updated_at on public.hr_employee_pay_items;
create trigger trg_hr_employee_pay_items_updated_at
  before update on public.hr_employee_pay_items
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';
