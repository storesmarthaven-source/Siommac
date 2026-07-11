-- ============================================================================
-- Finance Payroll — Employee loans & salary advances (Wave 5)
-- ============================================================================
-- Fixed-installment loans/advances with an optional FLAT interest amount.
--   total_repayable = principal + interest_amount
--   a fixed installment_amount is deducted each pay cycle until the balance clears
--   (last installment = min(installment_amount, balance)).
-- The finance_loan_deductions ledger is the SOURCE OF TRUTH for the balance:
--   balance = total_repayable − Σ(ledger.amount). One ledger row per (loan, run)
--   (unique) makes lock/recalc idempotent; reopening a run deletes its ledger rows
--   and restores the balance.
-- Maker-checker: draft → pending_approval → active (via the central workflow, SoD
-- enforced server-side) → settled/cancelled. Loans only deduct while 'active'.
-- Single-tenant: NO organization_id. app_users.id is TEXT.
-- ============================================================================

create table if not exists public.finance_employee_loans (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique,
  employee_id        text not null references public.app_users(id) on delete restrict,
  loan_type          text not null check (loan_type in ('loan','advance')),
  principal          numeric(12,2) not null check (principal > 0),
  interest_amount    numeric(12,2) not null default 0 check (interest_amount >= 0),  -- flat total interest
  total_repayable    numeric(12,2) not null check (total_repayable > 0),             -- principal + interest_amount
  installment_amount numeric(12,2) not null check (installment_amount > 0),
  balance            numeric(12,2) not null check (balance >= 0),                    -- outstanding (cached; ledger is truth)
  start_period       date,                                                           -- first pay-period month to deduct from (null = as soon as active)
  status             text not null default 'draft'
                       check (status in ('draft','pending_approval','active','settled','cancelled','rejected')),
  reason             text,
  notes              text,
  workflow_id        uuid,
  created_by         text references public.app_users(id) on delete set null,
  approved_by        text references public.app_users(id) on delete set null,
  approved_at        timestamptz,
  settled_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists finance_employee_loans_employee_idx on public.finance_employee_loans(employee_id, status);
create index if not exists finance_employee_loans_status_idx   on public.finance_employee_loans(status);
alter table public.finance_employee_loans enable row level security;
grant select, insert, update, delete on public.finance_employee_loans to service_role;

create trigger trg_finance_employee_loans_updated_at
  before update on public.finance_employee_loans
  for each row execute function public.set_updated_at();

-- Per-run deduction ledger — SOURCE OF TRUTH for the outstanding balance.
create table if not exists public.finance_loan_deductions (
  id            uuid primary key default gen_random_uuid(),
  loan_id       uuid not null references public.finance_employee_loans(id) on delete cascade,
  run_id        uuid not null references public.finance_payroll_runs(id) on delete cascade,
  amount        numeric(12,2) not null check (amount > 0),
  balance_after numeric(12,2) not null,
  created_at    timestamptz not null default now(),
  unique(loan_id, run_id)
);
create index if not exists finance_loan_deductions_loan_idx on public.finance_loan_deductions(loan_id);
create index if not exists finance_loan_deductions_run_idx  on public.finance_loan_deductions(run_id);
alter table public.finance_loan_deductions enable row level security;
grant select, insert, update, delete on public.finance_loan_deductions to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
