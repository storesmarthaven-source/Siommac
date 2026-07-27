-- Migration: 20260919000741_hr_access_profiles.sql
--
-- Creates hr_access_profiles: a governed registry of employee access configurations.
-- The wizard resolves a system_role server-side from an approved profile ID — HR
-- never sends a raw role string to the API.
-- PENDING OPERATOR ACTION — never self-apply.

create table if not exists public.hr_access_profiles (
  id            uuid        primary key default gen_random_uuid(),
  code          text        unique not null,
  label         text        not null,
  system_role   text        not null,
  description   text,
  requires_mfa  boolean     not null default false,
  is_active     boolean     not null default true,
  sort_order    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

alter table public.hr_access_profiles enable row level security;

grant select, insert, update, delete
  on public.hr_access_profiles to service_role;

-- Seed: 8 standard access profiles
insert into public.hr_access_profiles (code, label, system_role, description, requires_mfa, is_active, sort_order) values
  ('employee',      'Employee',           'employee',     'Standard employee — ESS access only',              false, true, 10),
  ('supervisor',    'Supervisor',         'supervisor',   'Supervisor — can manage direct reports',           false, true, 20),
  ('manager',       'Manager',            'manager',      'Line manager — full team visibility',              false, true, 30),
  ('hse_staff',     'HSE Staff',          'hse_staff',    'HSE officer — HSE module write access',            false, true, 40),
  ('hr_staff',      'HR Staff',           'hr_staff',     'HR operations staff — employee records',           false, true, 50),
  ('hr_manager',    'HR Manager',         'hr_manager',   'HR manager — sensitive HR actions + approvals',    true,  true, 60),
  ('finance_staff', 'Finance Staff',      'finance_staff','Finance officer — finance module access',          false, true, 70),
  ('no_login',      'No System Login',    'employee',     'Record-only: no Auth account, no ESS access',     false, true, 80)
on conflict (code) do nothing;
