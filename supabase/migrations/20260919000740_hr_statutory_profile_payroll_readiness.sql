-- Migration: 20260919000740_hr_statutory_profile_payroll_readiness.sql
--
-- Extends hr_employee_statutory_profiles with payroll-readiness columns + nis_reg_status.
-- Backfills from legacy hr_employee_statutory.
-- PENDING OPERATOR ACTION — never self-apply.

alter table public.hr_employee_statutory_profiles
  add column if not exists nis_reg_status          text
    check (nis_reg_status in ('pending','registered','exempt','not_applicable')),
  add column if not exists nis_effective_date       date,
  add column if not exists bir_file_number          text,
  add column if not exists paye_applicable          boolean not null default true,
  add column if not exists td1_received             boolean not null default false,
  add column if not exists td1_effective_year       integer check (td1_effective_year is null or (td1_effective_year >= 2000 and td1_effective_year <= 2100)),
  add column if not exists hs_applicable            boolean not null default true,
  add column if not exists hs_exemption_reason      text,
  add column if not exists hs_effective_date        date,
  add column if not exists hs_verification_required boolean not null default false,
  add column if not exists payroll_ready_status     text not null default 'pending'
    check (payroll_ready_status in ('pending','ready','blocked')),
  add column if not exists missing_blockers         jsonb not null default '[]'::jsonb,
  add column if not exists finance_handoff_eligible boolean not null default false,
  add column if not exists verified_note            text;

create index if not exists hr_esp_payroll_ready_idx
  on public.hr_employee_statutory_profiles (payroll_ready_status);

-- Backfill from legacy table (employees with legacy row but no profile row)
insert into public.hr_employee_statutory_profiles (
  employee_id, jurisdiction, currency, nis_status, nis_reg_status,
  nis_number, payroll_ready_status, missing_blockers, finance_handoff_eligible, created_at
)
select
  s.employee_id, 'TT', 'TTD',
  'pending_verification',   -- Finance verification status
  s.nis_status,             -- HR registration status (legacy value maps directly)
  s.nis_number,
  'pending',
  '[]'::jsonb,
  false,
  now()
from public.hr_employee_statutory s
where not exists (
  select 1 from public.hr_employee_statutory_profiles p
  where p.employee_id = s.employee_id and p.jurisdiction = 'TT'
)
on conflict (employee_id, jurisdiction) do nothing;
