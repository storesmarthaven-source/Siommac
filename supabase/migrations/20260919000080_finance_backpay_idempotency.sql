-- ============================================================================
-- Finance Payroll -- back-pay idempotency guard (audit remediation 2d)
-- ============================================================================
-- addBackPay inserted a taxable 'back_pay' pay_item into finance_payroll_run_inputs
-- with NO uniqueness guard, so a retry (or a double-click) posted the retro delta
-- TWICE -> the employee is paid the adjustment twice on recalculate. Worse, two
-- back-pay rows with different from_period ranges double-count the overlapping
-- prior periods.
--
-- Guard: at most ONE back-pay adjustment per (run_id, employee_id). A retry of the
-- same request now conflicts (the app returns the existing row = idempotent); a
-- genuinely different adjustment is rejected until the existing one is removed.
-- Partial index so only back-pay inputs are constrained -- base_pay / pay_item /
-- overtime / loan-deduction inputs are unaffected.
--
-- NOTE: if this fails with a unique-violation, the table already holds duplicate
-- back-pay rows from the pre-guard behaviour -- delete the extras (keep the
-- earliest per run+employee) before re-running. ASCII only + idempotent.
-- ============================================================================

create unique index if not exists finance_run_inputs_backpay_once
  on public.finance_payroll_run_inputs (run_id, employee_id)
  where component_code = 'back_pay';

-- After applying, run: NOTIFY pgrst, 'reload schema';
