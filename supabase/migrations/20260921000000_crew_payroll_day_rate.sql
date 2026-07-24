-- ═══════════════════════════════════════════════════════════════════════════
-- Crew Payroll — CP7b: the per_qualifying_day earnings basis (spec §14.4/§14.5).
-- ═══════════════════════════════════════════════════════════════════════════
-- Locked decision (user, 2026-07-24): rate source = employee_contract ONLY — the
-- crew assignment's canonical hr_contracts record (compensation_period='daily',
-- TTD). NO policy rate-band table, NO contract override, NO dormant rate fields.
-- The policy governs HOW to calculate; the employee contract governs WHAT rate.
--
-- Adding a calculation basis is engine code + tests, not a data-only change —
-- this migration lands in the SAME slice as the lock/calc engine that honors it.

-- ── 1. Component allowlists: + per_qualifying_day / crew_movement ─────────────
alter table public.finance_pay_policy_components
  drop constraint if exists finance_pay_policy_components_calculation_basis_check;
alter table public.finance_pay_policy_components
  add constraint finance_pay_policy_components_calculation_basis_check
  check (calculation_basis in ('salary_period','approved_hours','per_qualifying_day'));

alter table public.finance_pay_policy_components
  drop constraint if exists finance_pay_policy_components_eligibility_source_check;
alter table public.finance_pay_policy_components
  add constraint finance_pay_policy_components_eligibility_source_check
  check (eligibility_source in ('effective_employment','approved_compensation','approved_time','crew_movement'));

-- Combined basis/eligibility/parameters arms (the original inline table check is
-- auto-named <table>_check). The new arm PINS rate_source='employee_contract' —
-- the only rate source the crew day-rate engine implements.
alter table public.finance_pay_policy_components
  drop constraint if exists finance_pay_policy_components_check;
alter table public.finance_pay_policy_components
  add constraint finance_pay_policy_components_check
  check (
    (calculation_basis = 'salary_period'
      and eligibility_source in ('effective_employment','approved_compensation')
      and rule_parameters ? 'proration'
      and rule_parameters->>'proration' in ('calendar_days','working_days'))
    or
    (calculation_basis = 'approved_hours'
      and eligibility_source = 'approved_time'
      and rule_parameters = '{}'::jsonb)
    or
    (calculation_basis = 'per_qualifying_day'
      and eligibility_source = 'crew_movement'
      and rate_source = 'employee_contract'
      and rule_parameters = '{}'::jsonb)
  );

-- ── 2. Run input source types: + crew_day_rate ────────────────────────────────
-- One frozen input row per (employee, assignment) allocation; amount = the
-- contract day rate × attributed qualifying days, computed and frozen at lock.
alter table public.finance_payroll_run_inputs
  drop constraint if exists finance_payroll_run_inputs_source_type_check;
alter table public.finance_payroll_run_inputs
  add constraint finance_payroll_run_inputs_source_type_check
  check (source_type in ('base_pay','pay_item','overtime','timesheet','crew_day_rate'));

alter table public.finance_payroll_input_snapshot_lines
  drop constraint if exists finance_payroll_input_snapshot_lines_source_type_check;
alter table public.finance_payroll_input_snapshot_lines
  add constraint finance_payroll_input_snapshot_lines_source_type_check
  check (source_type in ('base_pay','pay_item','overtime','timesheet','crew_day_rate'));
