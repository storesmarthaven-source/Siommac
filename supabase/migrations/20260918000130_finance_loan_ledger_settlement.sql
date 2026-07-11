-- ============================================================================
-- Finance Payroll -- loan ledger: settlement entries (audit remediation P0-4)
-- ============================================================================
-- The finance_loan_deductions ledger is the SOURCE OF TRUTH for a loan's
-- balance, but settleLoan() previously set balance=0 WITHOUT a ledger row --
-- any recompute from the ledger would resurrect the balance and reactivate
-- the loan. Fix at the source: settlements become first-class ledger entries.
--   - run_id becomes nullable (a settlement is an external payment, not a run)
--   - entry_type distinguishes payroll deductions from settlements
--   - at most ONE settlement row per loan (it clears the full remaining balance)
--   - every non-settlement row must still reference its payroll run
-- ASCII only + idempotent / re-runnable.
-- ============================================================================

alter table public.finance_loan_deductions
  alter column run_id drop not null;

alter table public.finance_loan_deductions
  add column if not exists entry_type text not null default 'payroll_deduction';

-- entry_type value check (named + idempotent; supersedes any inline auto-name).
alter table public.finance_loan_deductions
  drop constraint if exists finance_loan_deductions_entry_type_check;
alter table public.finance_loan_deductions
  drop constraint if exists finance_loan_deductions_entry_type_chk;
alter table public.finance_loan_deductions
  add constraint finance_loan_deductions_entry_type_chk
  check (entry_type in ('payroll_deduction', 'settlement'));

-- One settlement per loan; payroll rows keep the existing unique(loan_id, run_id).
create unique index if not exists finance_loan_deductions_one_settlement
  on public.finance_loan_deductions(loan_id)
  where entry_type = 'settlement';

-- A payroll deduction without a run is meaningless -- enforce it.
alter table public.finance_loan_deductions
  drop constraint if exists finance_loan_deductions_run_required;
alter table public.finance_loan_deductions
  add constraint finance_loan_deductions_run_required
  check (entry_type = 'settlement' or run_id is not null);

-- After applying, run: NOTIFY pgrst, 'reload schema';
