-- Migration: add payroll_approvals table
-- Run in Supabase SQL Editor

create table if not exists public.payroll_approvals (
  id          text primary key default ('PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id     text not null references public.app_users(id) on delete cascade,
  username    text not null,
  date_from   date not null,
  date_to     date not null,
  pay_cycle   text not null default 'monthly',
  pay_basis   text not null default 'salary',
  gross_pay           numeric(12,2) not null default 0,
  nis                 numeric(12,2) not null default 0,
  health_surcharge    numeric(12,2) not null default 0,
  paye                numeric(12,2) not null default 0,
  total_deductions    numeric(12,2) not null default 0,
  net_pay             numeric(12,2) not null default 0,
  hours_worked        numeric(8,2)  not null default 0,
  days_worked         integer       not null default 0,
  hourly_rate         numeric(12,2) not null default 0,
  monthly_salary      numeric(12,2) not null default 0,
  department          text          not null default '',
  position            text          not null default '',
  approved_by         text          not null default 'admin',
  approved_at         timestamptz   not null default now(),
  status              text          not null default 'approved' check (status in ('approved', 'voided')),
  created_at          timestamptz   not null default now(),

  -- Prevent duplicate payslips for same employee + period + cycle
  unique (user_id, date_from, date_to, pay_cycle)
);

-- Enable RLS
alter table public.payroll_approvals enable row level security;

-- Admins and managers can do everything
create policy "Admin/Manager full access" on public.payroll_approvals
  for all using (
    exists (
      select 1 from public.app_users
      where username = current_setting('request.jwt.claims', true)::json->>'username'
        and role in ('admin', 'manager')
    )
  );

-- Employees can only read their own approved payslips
create policy "Employee read own payslips" on public.payroll_approvals
  for select using (
    user_id = (
      select id from public.app_users
      where username = current_setting('request.jwt.claims', true)::json->>'username'
    )
    and status = 'approved'
  );
