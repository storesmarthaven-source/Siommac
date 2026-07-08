-- ============================================================================
-- Finance Payroll — Run Scheduling Fields (Wave 2B §20 Gap 7)
-- Adds pay_group, pay_date, cut_off_date to finance_payroll_runs.
-- ============================================================================

alter table public.finance_payroll_runs
  add column if not exists pay_group     text,           -- e.g. 'general','executive','contract'
  add column if not exists pay_date      date,           -- date employees are paid
  add column if not exists cut_off_date  date;           -- changes after this date not included

comment on column public.finance_payroll_runs.pay_group    is 'Employee group label for this run (e.g. general, executive, contract). Free text; no FK.';
comment on column public.finance_payroll_runs.pay_date     is 'Actual date employees receive payment. May differ from period end.';
comment on column public.finance_payroll_runs.cut_off_date is 'Changes (overtime, pay items, etc.) after this date are excluded from the run.';
