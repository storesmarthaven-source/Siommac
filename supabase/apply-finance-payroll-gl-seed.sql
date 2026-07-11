-- ============================================================================
-- Seed: Finance Payroll GL — chart of accounts + default line→account mappings
-- Idempotent. Run once after migration 20260918000020. Lets GL posting work
-- out of the box; operators can re-map to their own chart later.
-- ============================================================================

-- ── Payroll GL accounts (skip if the code already exists) ────────────────────
insert into public.finance_gl_accounts (code, name, type, subtype, normal_balance)
values
  ('5000', 'Salaries & Wages Expense',          'expense',   'operating_expense', 'debit'),
  ('5010', 'Overtime Expense',                   'expense',   'operating_expense', 'debit'),
  ('5020', 'Allowances Expense',                 'expense',   'operating_expense', 'debit'),
  ('5030', 'Employer NIS Contribution Expense',  'expense',   'operating_expense', 'debit'),
  ('2100', 'Net Pay Clearing',                   'liability', 'current_liability', 'credit'),
  ('2110', 'PAYE Payable',                        'liability', 'current_liability', 'credit'),
  ('2120', 'NIS Employee Payable',               'liability', 'current_liability', 'credit'),
  ('2130', 'NIS Employer Payable',               'liability', 'current_liability', 'credit'),
  ('2140', 'Health Surcharge Payable',           'liability', 'current_liability', 'credit'),
  ('2150', 'Payroll Deductions Payable',         'liability', 'current_liability', 'credit')
on conflict (code) do nothing;

-- ── Default base mappings (skip if a base mapping for the key already exists) ─
insert into public.finance_payroll_gl_mappings (mapping_key, account_code)
select v.k, v.c
from (values
  ('salary_expense',           '5000'),
  ('overtime_expense',         '5010'),
  ('allowance_expense',        '5020'),
  ('employer_nis_expense',     '5030'),
  ('net_pay_clearing',         '2100'),
  ('paye_payable',             '2110'),
  ('nis_employee_payable',     '2120'),
  ('nis_employer_payable',     '2130'),
  ('health_surcharge_payable', '2140'),
  ('deductions_payable',       '2150')
) as v(k, c)
where not exists (
  select 1 from public.finance_payroll_gl_mappings m
  where m.mapping_key = v.k and m.component_id is null and m.department_id is null
);

-- After applying, run: NOTIFY pgrst, 'reload schema';
