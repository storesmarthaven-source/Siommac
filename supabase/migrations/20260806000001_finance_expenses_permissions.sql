-- ============================================================================
-- Finance Expenses — permissions (keys + DB grants)
-- ============================================================================
-- Keys:
--   finance.expenses.{view,submit,manage,approve,reports.view,reports.export}
--
-- Column is `permission` (NOT permission_key).
-- Grants:
--   employee     → submit (own claims only — self-scope enforced server-side)
--   finance_staff → view, manage
--   finance_manager → all including approve
--   admin, superadmin → all
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- employee: can submit their own expense claims
  ('employee',       'finance.expenses.submit'),

  -- finance_staff: can view all claims and manage (create, edit, cancel)
  ('finance_staff',  'finance.expenses.view'),
  ('finance_staff',  'finance.expenses.submit'),
  ('finance_staff',  'finance.expenses.manage'),

  -- finance_manager: full lifecycle including approve + reports
  ('finance_manager','finance.expenses.view'),
  ('finance_manager','finance.expenses.submit'),
  ('finance_manager','finance.expenses.manage'),
  ('finance_manager','finance.expenses.approve'),
  ('finance_manager','finance.expenses.reports.view'),
  ('finance_manager','finance.expenses.reports.export'),

  -- admin: all expense keys
  ('admin',          'finance.expenses.view'),
  ('admin',          'finance.expenses.submit'),
  ('admin',          'finance.expenses.manage'),
  ('admin',          'finance.expenses.approve'),
  ('admin',          'finance.expenses.reports.view'),
  ('admin',          'finance.expenses.reports.export'),

  -- superadmin: all expense keys
  ('superadmin',     'finance.expenses.view'),
  ('superadmin',     'finance.expenses.submit'),
  ('superadmin',     'finance.expenses.manage'),
  ('superadmin',     'finance.expenses.approve'),
  ('superadmin',     'finance.expenses.reports.view'),
  ('superadmin',     'finance.expenses.reports.export')

on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
