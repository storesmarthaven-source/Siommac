-- ============================================================================
-- Finance Budgeting — permissions grant migration
-- ============================================================================
-- Keys: finance.budgets.{view,manage,reports.view,reports.export,
--                        bulkUpsert,copyLastYear,
--                        attachments.upload,attachments.delete}
--
-- Column is `permission` (NOT permission_key).
-- Grants:
--   finance_staff   → view only
--   finance_manager → all keys
--   admin           → all keys
--   superadmin      → all keys
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- finance_staff: view budgets and reports
  ('finance_staff',  'finance.budgets.view'),
  ('finance_staff',  'finance.budgets.reports.view'),

  -- finance_manager: full lifecycle including manage + reports + bulk + copy + attachments
  ('finance_manager','finance.budgets.view'),
  ('finance_manager','finance.budgets.manage'),
  ('finance_manager','finance.budgets.reports.view'),
  ('finance_manager','finance.budgets.reports.export'),
  ('finance_manager','finance.budgets.bulkUpsert'),
  ('finance_manager','finance.budgets.copyLastYear'),
  ('finance_manager','finance.budgets.attachments.upload'),
  ('finance_manager','finance.budgets.attachments.delete'),

  -- admin: all budget keys
  ('admin',          'finance.budgets.view'),
  ('admin',          'finance.budgets.manage'),
  ('admin',          'finance.budgets.reports.view'),
  ('admin',          'finance.budgets.reports.export'),
  ('admin',          'finance.budgets.bulkUpsert'),
  ('admin',          'finance.budgets.copyLastYear'),
  ('admin',          'finance.budgets.attachments.upload'),
  ('admin',          'finance.budgets.attachments.delete'),

  -- superadmin: all budget keys
  ('superadmin',     'finance.budgets.view'),
  ('superadmin',     'finance.budgets.manage'),
  ('superadmin',     'finance.budgets.reports.view'),
  ('superadmin',     'finance.budgets.reports.export'),
  ('superadmin',     'finance.budgets.bulkUpsert'),
  ('superadmin',     'finance.budgets.copyLastYear'),
  ('superadmin',     'finance.budgets.attachments.upload'),
  ('superadmin',     'finance.budgets.attachments.delete')

on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
