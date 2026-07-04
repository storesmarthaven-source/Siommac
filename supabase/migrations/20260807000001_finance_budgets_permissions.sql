-- ============================================================================
-- Finance Budgeting — permissions grant migration
-- ============================================================================
-- Keys: finance.budgets.{view,manage,reports.view,reports.export}
--
-- Column is `permission` (NOT permission_key).
-- Grants:
--   finance_staff   → view only
--   finance_manager → all four keys
--   admin           → all four keys
--   superadmin      → all four keys
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- finance_staff: view budgets and reports
  ('finance_staff',  'finance.budgets.view'),

  -- finance_manager: full lifecycle including manage + reports
  ('finance_manager','finance.budgets.view'),
  ('finance_manager','finance.budgets.manage'),
  ('finance_manager','finance.budgets.reports.view'),
  ('finance_manager','finance.budgets.reports.export'),

  -- admin: all budget keys
  ('admin',          'finance.budgets.view'),
  ('admin',          'finance.budgets.manage'),
  ('admin',          'finance.budgets.reports.view'),
  ('admin',          'finance.budgets.reports.export'),

  -- superadmin: all budget keys
  ('superadmin',     'finance.budgets.view'),
  ('superadmin',     'finance.budgets.manage'),
  ('superadmin',     'finance.budgets.reports.view'),
  ('superadmin',     'finance.budgets.reports.export')

on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
