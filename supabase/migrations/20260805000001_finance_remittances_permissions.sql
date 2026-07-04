-- ============================================================================
-- Finance Remittances — permissions (keys + DB grants)
-- ============================================================================
-- Keys:
--   finance.remittances.{view,manage,approve,reports.view,reports.export}
--
-- Column is `permission` (NOT permission_key).
-- Grants: finance_staff → view, manage
--         finance_manager → all including approve
--         admin, superadmin → all
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- finance_staff: can view and create/manage remittances (not approve)
  ('finance_staff',   'finance.remittances.view'),
  ('finance_staff',   'finance.remittances.manage'),

  -- finance_manager: full remittance lifecycle + reports
  ('finance_manager', 'finance.remittances.view'),
  ('finance_manager', 'finance.remittances.manage'),
  ('finance_manager', 'finance.remittances.approve'),
  ('finance_manager', 'finance.remittances.reports.view'),
  ('finance_manager', 'finance.remittances.reports.export'),

  -- admin: all remittance keys
  ('admin',           'finance.remittances.view'),
  ('admin',           'finance.remittances.manage'),
  ('admin',           'finance.remittances.approve'),
  ('admin',           'finance.remittances.reports.view'),
  ('admin',           'finance.remittances.reports.export'),

  -- superadmin: all remittance keys
  ('superadmin',      'finance.remittances.view'),
  ('superadmin',      'finance.remittances.manage'),
  ('superadmin',      'finance.remittances.approve'),
  ('superadmin',      'finance.remittances.reports.view'),
  ('superadmin',      'finance.remittances.reports.export')

on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
