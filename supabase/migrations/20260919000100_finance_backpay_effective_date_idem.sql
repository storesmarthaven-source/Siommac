-- ============================================================================
-- Finance Payroll -- back-pay content-keyed idempotency (audit P2-a rebuild)
-- ============================================================================
-- The prior one-per-run-per-employee guard (migration 080) wrongly blocked
-- DISTINCT legitimate back-pay adjustments for the same employee/run that
-- cover different effective periods or different corrected bases.
--
-- Replacement model: content-keyed idempotency. A deterministic key is
-- derived from the adjustment's content (from_period + effective_date +
-- corrected_base) and stored in metadata.back_pay_idem_key. Two adjustments
-- with different content keys are allowed to coexist (e.g. two corrections
-- for different effective dates); an identical retry dedupes cleanly.
--
-- The partial index only covers rows with the key set, so legacy back-pay
-- rows without the key remain unconstrained.
-- ASCII only + idempotent.
-- ============================================================================

-- Remove the old one-per-run guard (applied in migration 080)
drop index if exists public.finance_run_inputs_backpay_once;

-- Content-keyed guard: (run, employee, idem_key) must be unique
create unique index if not exists finance_run_inputs_backpay_idem
  on public.finance_payroll_run_inputs (run_id, employee_id, (metadata->>'back_pay_idem_key'))
  where component_code = 'back_pay'
    and metadata->>'back_pay_idem_key' is not null;

-- After applying, run: NOTIFY pgrst, 'reload schema';
