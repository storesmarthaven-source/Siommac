-- ============================================================================
-- NIS Profile Permissions — HR capture + Finance verify (Phase 2.5)
-- ============================================================================
-- New keys (§9):
--   hr.employee.statutory.view    — HR can view the statutory profile section
--   hr.employee.statutory.capture — HR can create/update NIS profile data
--   finance.payroll.nis.view      — Finance can view pending NIS profiles
--   finance.payroll.nis.verify    — Finance Manager can verify a NIS profile
--   finance.payroll.nis.manage    — Finance Manager can manage NIS profiles
--
-- Grants (column is `permission`, NOT `permission_key`):
--   hr_staff, hr_manager  → hr.employee.statutory.{view,capture}
--   finance_staff         → finance.payroll.nis.view
--   finance_manager       → finance.payroll.nis.{view,verify,manage}
--   admin, superadmin     → ALL five keys
--
-- `on conflict (role_name, permission) do nothing` — idempotent.
-- Roles finance_staff/finance_manager were created in 20260802000000.
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- HR staff: capture NIS data for employees
  ('hr_staff',         'hr.employee.statutory.view'),
  ('hr_staff',         'hr.employee.statutory.capture'),

  -- HR manager: same capture keys (full HR set)
  ('hr_manager',       'hr.employee.statutory.view'),
  ('hr_manager',       'hr.employee.statutory.capture'),

  -- Finance staff: can review/view pending NIS profiles
  ('finance_staff',    'finance.payroll.nis.view'),

  -- Finance manager: full NIS verification lifecycle
  ('finance_manager',  'finance.payroll.nis.view'),
  ('finance_manager',  'finance.payroll.nis.verify'),
  ('finance_manager',  'finance.payroll.nis.manage'),

  -- Admin: all five keys
  ('admin',            'hr.employee.statutory.view'),
  ('admin',            'hr.employee.statutory.capture'),
  ('admin',            'finance.payroll.nis.view'),
  ('admin',            'finance.payroll.nis.verify'),
  ('admin',            'finance.payroll.nis.manage'),

  -- Superadmin: all five keys
  ('superadmin',       'hr.employee.statutory.view'),
  ('superadmin',       'hr.employee.statutory.capture'),
  ('superadmin',       'finance.payroll.nis.view'),
  ('superadmin',       'finance.payroll.nis.verify'),
  ('superadmin',       'finance.payroll.nis.manage')
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
