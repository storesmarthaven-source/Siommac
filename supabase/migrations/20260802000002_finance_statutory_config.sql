-- ============================================================================
-- Finance statutory configuration — finance_statutory_versions + finance_nis_classes
-- ============================================================================
-- Effective-dated statutory schedule for Trinidad & Tobago (TTD): PAYE bands,
-- Health Surcharge bands, NIS monthly ceiling, and the 16-class NIS earnings
-- table. The payroll calculators (Phase 3) read ONLY from these tables — rates
-- are NEVER hardcoded in TS — and each run stamps the statutory_version_id it
-- used. Lifecycle: draft → pending_approval → approved → active → retired.
-- Exactly one active version per jurisdiction; creator ≠ final approver.
--
-- Per docs/COMPENSATION_PAYROLL_PREP_IMPLEMENTATION_BRIEF.md §4.2.
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.finance_statutory_versions (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  label text not null,
  jurisdiction text not null default 'TT' check (jurisdiction in ('TT')),
  currency text not null default 'TTD' check (currency in ('TTD')),
  -- PAYE (annual figures as published; calculator derives the monthly slice):
  paye_personal_allowance numeric(12,2) not null,   -- annual personal allowance
  paye_band1_ceiling numeric(12,2) not null,         -- annual chargeable ceiling for band 1
  paye_band1_rate numeric(8,4) not null,             -- e.g. 0.2500
  paye_band2_rate numeric(8,4) not null,             -- e.g. 0.3000
  -- Health Surcharge (weekly amounts; threshold is monthly income):
  hs_monthly_threshold numeric(12,2) not null,       -- monthly income boundary between low/high
  hs_weekly_high numeric(12,2) not null,             -- weekly HS when income > threshold
  hs_weekly_low numeric(12,2) not null,              -- weekly HS when income <= threshold
  -- NIS:
  nis_monthly_ceiling numeric(12,2),                 -- max insurable monthly earnings
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','active','retired')),
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  is_active boolean not null default false,
  created_by text references public.app_users(id) on delete set null,
  approved_by text references public.app_users(id) on delete set null,
  activated_by text references public.app_users(id) on delete set null,
  activated_at timestamptz,
  retired_by text references public.app_users(id) on delete set null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(effective_from, jurisdiction)
);

create index if not exists finance_statutory_versions_effective_idx on public.finance_statutory_versions(effective_from desc);
create index if not exists finance_statutory_versions_status_idx    on public.finance_statutory_versions(status);
create index if not exists finance_statutory_versions_active_idx    on public.finance_statutory_versions(is_active);

alter table public.finance_statutory_versions enable row level security;
grant select, insert, update, delete on public.finance_statutory_versions to service_role;

drop trigger if exists trg_finance_statutory_versions_updated_at on public.finance_statutory_versions;
create trigger trg_finance_statutory_versions_updated_at
  before update on public.finance_statutory_versions
  for each row execute function public.set_updated_at();

create table if not exists public.finance_nis_classes (
  id uuid primary key default gen_random_uuid(),
  statutory_version_id uuid not null references public.finance_statutory_versions(id) on delete cascade,
  class_no int not null,
  weekly_min numeric(12,2) not null,
  weekly_max numeric(12,2),                           -- null for the open-ended top class
  employee_weekly numeric(12,2) not null,
  employer_weekly numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique(statutory_version_id, class_no)
);

create index if not exists finance_nis_classes_version_idx on public.finance_nis_classes(statutory_version_id);
create index if not exists finance_nis_classes_range_idx   on public.finance_nis_classes(statutory_version_id, weekly_min, weekly_max);

alter table public.finance_nis_classes enable row level security;
grant select, insert, update, delete on public.finance_nis_classes to service_role;

-- ── Seed: official TT statutory schedule effective 05 January 2026 ───────────
-- Sources (verified):
--   NIS 16-class table + 16.2% rate — NIBTT "Earnings Classes and Contributions
--     from 05 January 2026" (official PDF), max insurable earnings TT$13,600/mo.
--   PAYE — personal allowance TT$90,000/yr; 25% on chargeable ≤ TT$1,000,000,
--     30% above (PwC TT tax summary).
--   Health Surcharge — TT$8.25/wk for monthly income > TT$469.99, else TT$4.80/wk
--     (PwC TT tax summary / BIR).
-- NOTE: the NIBTT schedule is marked "subject to all legislative approvals".
-- Seeded as the active baseline so payroll resolves a version out of the box;
-- Finance may supersede it via the approval UI. -- VERIFY vs NIBTT/BIR before live payroll.
insert into public.finance_statutory_versions
  (effective_from, label, jurisdiction, currency,
   paye_personal_allowance, paye_band1_ceiling, paye_band1_rate, paye_band2_rate,
   hs_monthly_threshold, hs_weekly_high, hs_weekly_low, nis_monthly_ceiling,
   status, is_active, activated_at)
values
  ('2026-01-05', 'TT Statutory Schedule — 05 Jan 2026 (NIS 16.2%)', 'TT', 'TTD',
   90000.00, 1000000.00, 0.2500, 0.3000,
   469.99, 8.25, 4.80, 13600.00,
   'active', true, '2026-01-05T00:00:00Z')
on conflict (effective_from, jurisdiction) do nothing;

-- NIS earnings classes I–XVI (weekly EE / ER contributions), 16.2% schedule.
insert into public.finance_nis_classes
  (statutory_version_id, class_no, weekly_min, weekly_max, employee_weekly, employer_weekly)
select v.id, c.class_no, c.weekly_min, c.weekly_max, c.employee_weekly, c.employer_weekly
from public.finance_statutory_versions v
cross join (values
  ( 1,  200.00,  339.99,  14.60,  29.20),
  ( 2,  340.00,  449.99,  21.30,  42.60),
  ( 3,  450.00,  609.99,  28.60,  57.20),
  ( 4,  610.00,  759.99,  37.00,  74.00),
  ( 5,  760.00,  929.99,  45.60,  91.20),
  ( 6,  930.00, 1119.99,  55.40, 110.80),
  ( 7, 1120.00, 1299.99,  65.30, 130.60),
  ( 8, 1300.00, 1489.99,  75.30, 150.60),
  ( 9, 1490.00, 1709.99,  86.40, 172.80),
  (10, 1710.00, 1909.99,  97.70, 195.40),
  (11, 1910.00, 2139.99, 109.40, 218.80),
  (12, 2140.00, 2379.99, 122.00, 244.00),
  (13, 2380.00, 2629.99, 135.30, 270.60),
  (14, 2630.00, 2919.99, 149.90, 299.80),
  (15, 2920.00, 3137.99, 163.60, 327.20),
  (16, 3138.00, null,    169.50, 339.00)
) as c(class_no, weekly_min, weekly_max, employee_weekly, employer_weekly)
where v.effective_from = '2026-01-05' and v.jurisdiction = 'TT'
on conflict (statutory_version_id, class_no) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
