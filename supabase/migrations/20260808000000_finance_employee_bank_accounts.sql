-- ============================================================================
-- Finance — Employee Bank Accounts (F2 prerequisite)
-- Table: finance_employee_bank_accounts
-- Spec §F2 / Payroll Bank Disbursement
-- ============================================================================
-- Minimal bank-details capture: each employee may have one or more bank
-- accounts; exactly one may be primary per employee (is_primary = true).
-- The full account_number is stored; only account_number_masked is returned
-- in DTOs — NEVER the full number to the frontend.
-- ============================================================================
-- This migration is OPERATOR-APPLIED only — DO NOT run from application code.
-- After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.finance_employee_bank_accounts (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           text not null references public.app_users(id) on delete restrict,
  bank_name             text not null,
  branch                text,
  account_type          text not null check (account_type in ('savings','chequing')),
  account_number        text not null,            -- stored; NEVER returned in DTOs
  account_number_masked text not null,            -- e.g. "****1234" — returned in DTOs
  is_primary            boolean not null default true,
  is_active             boolean not null default true,
  created_by            text references public.app_users(id) on delete set null,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists fin_bank_accts_employee_idx
  on public.finance_employee_bank_accounts(employee_id);
create index if not exists fin_bank_accts_employee_primary_idx
  on public.finance_employee_bank_accounts(employee_id, is_primary)
  where is_active = true;

alter table public.finance_employee_bank_accounts enable row level security;
grant select, insert, update, delete on public.finance_employee_bank_accounts to service_role;

drop trigger if exists trg_fin_bank_accts_updated_at on public.finance_employee_bank_accounts;
create trigger trg_fin_bank_accts_updated_at
  before update on public.finance_employee_bank_accounts
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';
