-- ============================================================================
-- HR/Finance — Employee Statutory Profiles (NIS Continuity) — Phase 2.5
-- ============================================================================
-- Table: hr_employee_statutory_profiles
-- HR captures NIS continuity data when an employee joins from another company.
-- Finance verifies the profile (NIS status set to 'verified').
-- HR can NEVER set nis_status='verified'; only finance.payroll.nis.verify can.
--
-- unique(employee_id, jurisdiction) — one profile per employee per jurisdiction.
-- ============================================================================

create table if not exists public.hr_employee_statutory_profiles (
  id                              uuid primary key default gen_random_uuid(),
  employee_id                     text not null references public.app_users(id) on delete cascade,
  jurisdiction                    text not null default 'TT' check (jurisdiction in ('TT')),
  currency                        text not null default 'TTD' check (currency in ('TTD')),
  nis_number                      text,
  nis_status                      text not null default 'pending_verification'
                                    check (nis_status in ('pending_verification','verified','not_available','not_applicable','exempt')),
  nis_applicable                  boolean not null default true,
  previous_employer_name          text,
  previous_employer_end_date      date,
  opening_ytd_insurable_earnings  numeric(12,2) not null default 0,
  opening_ytd_nis_employee        numeric(12,2) not null default 0,
  opening_ytd_nis_employer        numeric(12,2) not null default 0,
  opening_balance_as_of           date,
  -- verification fields (only Finance may populate these)
  verified_by                     text references public.app_users(id) on delete set null,
  verified_at                     timestamptz,
  verification_note               text,
  -- workflow link (set when HR submits for Finance verification)
  workflow_id                     uuid references public.workflow_instances(id) on delete set null,
  -- audit fields
  created_by                      text references public.app_users(id) on delete set null,
  updated_by                      text references public.app_users(id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique(employee_id, jurisdiction)
);

create index if not exists hr_employee_statutory_profiles_employee_idx
  on public.hr_employee_statutory_profiles(employee_id);
create index if not exists hr_employee_statutory_profiles_nis_status_idx
  on public.hr_employee_statutory_profiles(nis_status);
create index if not exists hr_employee_statutory_profiles_jurisdiction_idx
  on public.hr_employee_statutory_profiles(jurisdiction, nis_status);

alter table public.hr_employee_statutory_profiles enable row level security;
grant select, insert, update, delete on public.hr_employee_statutory_profiles to service_role;

drop trigger if exists trg_hr_employee_statutory_profiles_updated_at
  on public.hr_employee_statutory_profiles;
create trigger trg_hr_employee_statutory_profiles_updated_at
  before update on public.hr_employee_statutory_profiles
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';
