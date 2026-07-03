-- ============================================================================
-- Finance pay-component catalogue — finance_pay_components (+ seed)
-- ============================================================================
-- Finance-owned catalogue of earning/deduction components. HR compensation
-- inputs (hr_employee_pay_items, Phase 2) may only reference ACTIVE components
-- from this table — HR can never create or edit a component.
--
--   kind                 'earning' | 'deduction'
--   is_statutory         statutory deductions (NIS/PAYE/Health Surcharge) are
--                        system-computed by the payroll calculators, never
--                        attached manually as pay items
--   is_taxable           earnings only: included in taxable gross
--   reduces_chargeable   deductions only: approved pre-tax items (e.g.
--                        pension) subtracted before PAYE
--
-- Per docs/COMPENSATION_PAYROLL_PREP_IMPLEMENTATION_BRIEF.md §4.1.
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.finance_pay_components (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  kind text not null check (kind in ('earning','deduction')),
  is_statutory boolean not null default false,
  is_taxable boolean not null default true,
  reduces_chargeable boolean not null default false,
  gl_account_code text,
  cost_allocation_required boolean not null default false,
  is_active boolean not null default true,
  created_by text references public.app_users(id) on delete set null,
  updated_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_pay_components_active_idx on public.finance_pay_components(is_active);
create index if not exists finance_pay_components_kind_idx   on public.finance_pay_components(kind);

alter table public.finance_pay_components enable row level security;
grant select, insert, update, delete on public.finance_pay_components to service_role;

drop trigger if exists trg_finance_pay_components_updated_at on public.finance_pay_components;
create trigger trg_finance_pay_components_updated_at
  before update on public.finance_pay_components
  for each row execute function public.set_updated_at();

-- ── Seed: standard TT component set ─────────────────────────────────────────
-- Statutory deductions are non-taxable system components; pension reduces
-- chargeable income (approved pre-tax) per the brief.
insert into public.finance_pay_components
  (code, name, kind, is_statutory, is_taxable, reduces_chargeable) values
  ('basic',             'Basic Pay',          'earning',   false, true,  false),
  ('housing_allowance', 'Housing Allowance',  'earning',   false, true,  false),
  ('travel_allowance',  'Travel Allowance',   'earning',   false, true,  false),
  ('meal_allowance',    'Meal Allowance',     'earning',   false, true,  false),
  ('overtime',          'Overtime',           'earning',   false, true,  false),
  ('nis_employee',      'NIS (Employee)',     'deduction', true,  false, false),
  ('paye',              'PAYE',               'deduction', true,  false, false),
  ('health_surcharge',  'Health Surcharge',   'deduction', true,  false, false),
  ('loan',              'Loan Repayment',     'deduction', false, false, false),
  ('union_dues',        'Union Dues',         'deduction', false, false, false),
  ('salary_advance',    'Salary Advance',     'deduction', false, false, false),
  ('pension',           'Pension',            'deduction', false, false, true)
on conflict (code) do update
  set name = excluded.name,
      kind = excluded.kind,
      is_statutory = excluded.is_statutory,
      is_taxable = excluded.is_taxable,
      reduces_chargeable = excluded.reduces_chargeable;

-- After applying, run: NOTIFY pgrst, 'reload schema';
