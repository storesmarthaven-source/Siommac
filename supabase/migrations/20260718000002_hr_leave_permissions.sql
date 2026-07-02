-- ============================================================================
-- HR Leave & Absence — role_permissions grants
-- ============================================================================
-- hr.leave.* permissions granted by role_name. The role_permissions table is
-- (role_name, permission) — there is NO `granted` column. Idempotent.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  -- employee: own leave only
  ('employee', 'hr.leave.view'),
  ('employee', 'hr.leave.submit'),
  ('employee', 'hr.leave.cancel_own'),
  ('employee', 'hr.leave.balances.view'),
  ('employee', 'hr.leave.calendar.view'),
  -- manager: dept-scoped view + approve
  ('manager',  'hr.leave.view'),
  ('manager',  'hr.leave.view_all'),
  ('manager',  'hr.leave.submit'),
  ('manager',  'hr.leave.cancel_own'),
  ('manager',  'hr.leave.approve'),
  ('manager',  'hr.leave.balances.view'),
  ('manager',  'hr.leave.calendar.view'),
  ('manager',  'hr.leave.reports.view'),
  -- hr_staff: execution tier (no types.manage / balances.adjust / accruals.run / reports.export)
  ('hr_staff', 'hr.leave.view'),
  ('hr_staff', 'hr.leave.view_all'),
  ('hr_staff', 'hr.leave.submit'),
  ('hr_staff', 'hr.leave.cancel_own'),
  ('hr_staff', 'hr.leave.approve'),
  ('hr_staff', 'hr.leave.manage'),
  ('hr_staff', 'hr.leave.balances.view'),
  ('hr_staff', 'hr.leave.calendar.view'),
  ('hr_staff', 'hr.leave.reports.view'),
  -- hr_manager: all leave capabilities
  ('hr_manager', 'hr.leave.view'),
  ('hr_manager', 'hr.leave.view_all'),
  ('hr_manager', 'hr.leave.submit'),
  ('hr_manager', 'hr.leave.cancel_own'),
  ('hr_manager', 'hr.leave.approve'),
  ('hr_manager', 'hr.leave.manage'),
  ('hr_manager', 'hr.leave.types.manage'),
  ('hr_manager', 'hr.leave.balances.view'),
  ('hr_manager', 'hr.leave.balances.adjust'),
  ('hr_manager', 'hr.leave.accruals.run'),
  ('hr_manager', 'hr.leave.calendar.view'),
  ('hr_manager', 'hr.leave.reports.view'),
  ('hr_manager', 'hr.leave.reports.export'),
  -- admin + superadmin: all
  ('admin', 'hr.leave.view'),('admin', 'hr.leave.view_all'),('admin', 'hr.leave.submit'),
  ('admin', 'hr.leave.cancel_own'),('admin', 'hr.leave.approve'),('admin', 'hr.leave.manage'),
  ('admin', 'hr.leave.types.manage'),('admin', 'hr.leave.balances.view'),('admin', 'hr.leave.balances.adjust'),
  ('admin', 'hr.leave.accruals.run'),('admin', 'hr.leave.calendar.view'),('admin', 'hr.leave.reports.view'),
  ('admin', 'hr.leave.reports.export'),
  ('superadmin', 'hr.leave.view'),('superadmin', 'hr.leave.view_all'),('superadmin', 'hr.leave.submit'),
  ('superadmin', 'hr.leave.cancel_own'),('superadmin', 'hr.leave.approve'),('superadmin', 'hr.leave.manage'),
  ('superadmin', 'hr.leave.types.manage'),('superadmin', 'hr.leave.balances.view'),('superadmin', 'hr.leave.balances.adjust'),
  ('superadmin', 'hr.leave.accruals.run'),('superadmin', 'hr.leave.calendar.view'),('superadmin', 'hr.leave.reports.view'),
  ('superadmin', 'hr.leave.reports.export')
on conflict do nothing;

-- After applying: NOTIFY pgrst, 'reload schema';
