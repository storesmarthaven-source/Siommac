-- ============================================================================
-- Finance Payroll — Payslip delivery tracking (Wave 1, increment 2)
-- One row per delivery attempt of a payslip via a channel (email for now), so
-- Finance can see who was sent their payslip, resend, and audit failures.
-- Delivery is decoupled from render: a failed send never invalidates the run.
-- ============================================================================

create table if not exists public.finance_payslip_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  payslip_id         uuid not null references public.finance_payslips(id)      on delete cascade,
  run_id             uuid not null references public.finance_payroll_runs(id)  on delete cascade,
  employee_id        text not null references public.app_users(id)             on delete restrict,
  channel            text not null default 'email' check (channel in ('email')),
  recipient          text,                                   -- destination address as sent
  status             text not null default 'queued'
                       check (status in ('queued','sent','failed','skipped')),
  password_protected boolean not null default false,
  attempts           integer not null default 0,
  error              text,
  sent_at            timestamptz,
  created_by         text references public.app_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists finance_payslip_deliveries_run_idx      on public.finance_payslip_deliveries(run_id);
create index if not exists finance_payslip_deliveries_payslip_idx  on public.finance_payslip_deliveries(payslip_id);
create index if not exists finance_payslip_deliveries_employee_idx on public.finance_payslip_deliveries(employee_id);

alter table public.finance_payslip_deliveries enable row level security;
grant select, insert, update, delete on public.finance_payslip_deliveries to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
