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
  assumed_average_weekly numeric(12,2),              -- NIBTT assumed average weekly earnings (contribution + benefit basis)
  employee_weekly numeric(12,2) not null,
  employer_weekly numeric(12,2) not null,
  class_z_weekly numeric(12,2),                       -- reduced weekly contribution for workers over pensionable age (employment-injury portion only)
  created_at timestamptz not null default now(),
  unique(statutory_version_id, class_no)
);

-- Additive columns for DBs where finance_nis_classes already exists (idempotent forward-fix).
alter table public.finance_nis_classes add column if not exists assumed_average_weekly numeric(12,2);
alter table public.finance_nis_classes add column if not exists class_z_weekly numeric(12,2);

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

-- NIS earnings classes I–XVI (weekly EE / ER contributions + assumed average
-- weekly earnings + Class Z), 16.2% schedule from the official NIBTT PDF.
insert into public.finance_nis_classes
  (statutory_version_id, class_no, weekly_min, weekly_max, assumed_average_weekly, employee_weekly, employer_weekly, class_z_weekly)
select v.id, c.class_no, c.weekly_min, c.weekly_max, c.assumed, c.employee_weekly, c.employer_weekly, c.classz
from public.finance_statutory_versions v
cross join (values
  ( 1,  200.00,  339.99,  270.00,  14.60,  29.20,  2.20),
  ( 2,  340.00,  449.99,  395.00,  21.30,  42.60,  3.20),
  ( 3,  450.00,  609.99,  530.00,  28.60,  57.20,  4.30),
  ( 4,  610.00,  759.99,  685.00,  37.00,  74.00,  5.56),
  ( 5,  760.00,  929.99,  845.00,  45.60,  91.20,  6.84),
  ( 6,  930.00, 1119.99, 1025.00,  55.40, 110.80,  8.32),
  ( 7, 1120.00, 1299.99, 1210.00,  65.30, 130.60,  9.80),
  ( 8, 1300.00, 1489.99, 1395.00,  75.30, 150.60, 11.30),
  ( 9, 1490.00, 1709.99, 1600.00,  86.40, 172.80, 12.96),
  (10, 1710.00, 1909.99, 1810.00,  97.70, 195.40, 14.66),
  (11, 1910.00, 2139.99, 2025.00, 109.40, 218.80, 16.42),
  (12, 2140.00, 2379.99, 2260.00, 122.00, 244.00, 18.30),
  (13, 2380.00, 2629.99, 2505.00, 135.30, 270.60, 20.30),
  (14, 2630.00, 2919.99, 2775.00, 149.90, 299.80, 22.49),
  (15, 2920.00, 3137.99, 3029.00, 163.60, 327.20, 24.55),
  (16, 3138.00, null,    3138.00, 169.50, 339.00, 25.43)
) as c(class_no, weekly_min, weekly_max, assumed, employee_weekly, employer_weekly, classz)
where v.effective_from = '2026-01-05' and v.jurisdiction = 'TT'
on conflict (statutory_version_id, class_no) do nothing;

-- Backfill assumed_average_weekly + class_z_weekly on rows seeded before these
-- columns existed (idempotent — only fills nulls, never clobbers manual edits).
update public.finance_nis_classes n
set assumed_average_weekly = coalesce(n.assumed_average_weekly, c.assumed),
    class_z_weekly         = coalesce(n.class_z_weekly, c.classz)
from public.finance_statutory_versions v
cross join (values
  ( 1, 270.00, 2.20), ( 2, 395.00, 3.20), ( 3, 530.00, 4.30), ( 4, 685.00, 5.56),
  ( 5, 845.00, 6.84), ( 6, 1025.00, 8.32), ( 7, 1210.00, 9.80), ( 8, 1395.00, 11.30),
  ( 9, 1600.00, 12.96), (10, 1810.00, 14.66), (11, 2025.00, 16.42), (12, 2260.00, 18.30),
  (13, 2505.00, 20.30), (14, 2775.00, 22.49), (15, 3029.00, 24.55), (16, 3138.00, 25.43)
) as c(class_no, assumed, classz)
where n.statutory_version_id = v.id and n.class_no = c.class_no
  and v.effective_from = '2026-01-05' and v.jurisdiction = 'TT'
  and (n.assumed_average_weekly is null or n.class_z_weekly is null);

-- After applying, run: NOTIFY pgrst, 'reload schema';
