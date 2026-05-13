-- Add Trinidad & Tobago payroll fields to employee profiles
alter table public.app_users
  add column if not exists pay_cycle               text    default 'monthly'  check (pay_cycle in ('daily','weekly','fortnightly','monthly')),
  add column if not exists pay_basis               text    default 'salary'   check (pay_basis in ('hourly','salary')),
  add column if not exists hourly_rate             numeric(12,2) default 0,
  add column if not exists monthly_salary          numeric(12,2) default 0,
  add column if not exists standard_hours_per_day  numeric(4,2)  default 8,
  add column if not exists nis_applicable          boolean default true,
  add column if not exists health_surcharge_applicable boolean default true,
  add column if not exists tax_resident            boolean default true;
