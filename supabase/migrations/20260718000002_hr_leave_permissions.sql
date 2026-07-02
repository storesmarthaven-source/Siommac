-- ============================================================================
-- HR Leave & Absence — role_permissions grants
-- ============================================================================
-- hr.leave.* permissions — grant to roles by role_name.
-- Idempotent (on conflict do nothing).
-- ============================================================================

insert into public.role_permissions (role_name, permission, granted)
values
  -- employee: own leave only
  ('employee', 'hr.leave.view',           true),
  ('employee', 'hr.leave.submit',         true),
  ('employee', 'hr.leave.cancel_own',     true),
  ('employee', 'hr.leave.balances.view',  true),
  ('employee', 'hr.leave.calendar.view',  true),
  -- manager: dept-scoped view + approve
  ('manager',  'hr.leave.view',           true),
  ('manager',  'hr.leave.view_all',       true),
  ('manager',  'hr.leave.submit',         true),
  ('manager',  'hr.leave.cancel_own',     true),
  ('manager',  'hr.leave.approve',        true),
  ('manager',  'hr.leave.balances.view',  true),
  ('manager',  'hr.leave.calendar.view',  true),
  ('manager',  'hr.leave.reports.view',   true),
  -- hr_manager: all leave capabilities
  ('hr_manager', 'hr.leave.view',              true),
  ('hr_manager', 'hr.leave.view_all',          true),
  ('hr_manager', 'hr.leave.submit',            true),
  ('hr_manager', 'hr.leave.cancel_own',        true),
  ('hr_manager', 'hr.leave.approve',           true),
  ('hr_manager', 'hr.leave.manage',            true),
  ('hr_manager', 'hr.leave.types.manage',      true),
  ('hr_manager', 'hr.leave.balances.view',     true),
  ('hr_manager', 'hr.leave.balances.adjust',   true),
  ('hr_manager', 'hr.leave.accruals.run',      true),
  ('hr_manager', 'hr.leave.calendar.view',     true),
  ('hr_manager', 'hr.leave.reports.view',      true),
  ('hr_manager', 'hr.leave.reports.export',    true),
  -- admin: all
  ('admin', 'hr.leave.view',              true),
  ('admin', 'hr.leave.view_all',          true),
  ('admin', 'hr.leave.submit',            true),
  ('admin', 'hr.leave.cancel_own',        true),
  ('admin', 'hr.leave.approve',           true),
  ('admin', 'hr.leave.manage',            true),
  ('admin', 'hr.leave.types.manage',      true),
  ('admin', 'hr.leave.balances.view',     true),
  ('admin', 'hr.leave.balances.adjust',   true),
  ('admin', 'hr.leave.accruals.run',      true),
  ('admin', 'hr.leave.calendar.view',     true),
  ('admin', 'hr.leave.reports.view',      true),
  ('admin', 'hr.leave.reports.export',    true)
on conflict (role_name, permission) do nothing;

-- After applying: NOTIFY pgrst, 'reload schema';
