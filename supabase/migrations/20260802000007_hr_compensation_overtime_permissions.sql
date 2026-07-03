-- ============================================================================
-- HR Compensation + Overtime — permission grants
-- ============================================================================
-- Per §9 of COMPENSATION_PAYROLL_PREP_IMPLEMENTATION_BRIEF.
-- Keys:
--   hr.compensation.{view,manage,approve,reports.view,reports.export}   (5 keys)
--   hr.overtime.{view,submit,approve,manage,reports.view,reports.export} (6 keys)
-- Total: 11 HR compensation/overtime keys (not counting hr.employee.statutory.*)
--
-- Grants:
--   employee      → hr.overtime.submit
--   manager       → hr.overtime.{view,approve,reports.view}
--   hr_staff      → hr.compensation.{view,manage} + hr.overtime.{view,manage,reports.view}
--   hr_manager    → ALL hr.compensation.* + hr.overtime.*
--   admin         → ALL
--   superadmin    → ALL (already allow-all by resolution order)
--   finance_staff → (no new HR grants; their existing keys unchanged)
--   finance_manager→ (no new HR grants)
--
-- NOTE: role_permissions column is `permission` (not permission_key).
-- ============================================================================

-- employee: can submit their own overtime
insert into public.role_permissions (role_name, permission) values
  ('employee', 'hr.overtime.submit')
on conflict (role_name, permission) do nothing;

-- manager: view + approve overtime + view OT reports for their team
insert into public.role_permissions (role_name, permission) values
  ('manager', 'hr.overtime.view'),
  ('manager', 'hr.overtime.approve'),
  ('manager', 'hr.overtime.reports.view')
on conflict (role_name, permission) do nothing;

-- hr_staff: manage compensation inputs + manage overtime (no approve on either)
insert into public.role_permissions (role_name, permission) values
  ('hr_staff', 'hr.compensation.view'),
  ('hr_staff', 'hr.compensation.manage'),
  ('hr_staff', 'hr.overtime.view'),
  ('hr_staff', 'hr.overtime.manage'),
  ('hr_staff', 'hr.overtime.reports.view')
on conflict (role_name, permission) do nothing;

-- hr_manager: ALL compensation + ALL overtime keys
insert into public.role_permissions (role_name, permission) values
  ('hr_manager', 'hr.compensation.view'),
  ('hr_manager', 'hr.compensation.manage'),
  ('hr_manager', 'hr.compensation.approve'),
  ('hr_manager', 'hr.compensation.reports.view'),
  ('hr_manager', 'hr.compensation.reports.export'),
  ('hr_manager', 'hr.overtime.view'),
  ('hr_manager', 'hr.overtime.submit'),
  ('hr_manager', 'hr.overtime.approve'),
  ('hr_manager', 'hr.overtime.manage'),
  ('hr_manager', 'hr.overtime.reports.view'),
  ('hr_manager', 'hr.overtime.reports.export')
on conflict (role_name, permission) do nothing;

-- admin: ALL compensation + ALL overtime keys
insert into public.role_permissions (role_name, permission) values
  ('admin', 'hr.compensation.view'),
  ('admin', 'hr.compensation.manage'),
  ('admin', 'hr.compensation.approve'),
  ('admin', 'hr.compensation.reports.view'),
  ('admin', 'hr.compensation.reports.export'),
  ('admin', 'hr.overtime.view'),
  ('admin', 'hr.overtime.submit'),
  ('admin', 'hr.overtime.approve'),
  ('admin', 'hr.overtime.manage'),
  ('admin', 'hr.overtime.reports.view'),
  ('admin', 'hr.overtime.reports.export')
on conflict (role_name, permission) do nothing;

-- superadmin: ALL compensation + ALL overtime keys
-- (superadmin is already allow-all by loadRolePermissions, but we seed the rows
--  so the drift-guard test can compare the catalogue against the DB)
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hr.compensation.view'),
  ('superadmin', 'hr.compensation.manage'),
  ('superadmin', 'hr.compensation.approve'),
  ('superadmin', 'hr.compensation.reports.view'),
  ('superadmin', 'hr.compensation.reports.export'),
  ('superadmin', 'hr.overtime.view'),
  ('superadmin', 'hr.overtime.submit'),
  ('superadmin', 'hr.overtime.approve'),
  ('superadmin', 'hr.overtime.manage'),
  ('superadmin', 'hr.overtime.reports.view'),
  ('superadmin', 'hr.overtime.reports.export')
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
