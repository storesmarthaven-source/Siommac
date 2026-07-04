-- ============================================================================
-- HR Attendance & Timekeeping -- permissions (keys + DB grants)
-- ============================================================================
-- Keys: hr.attendance.{view,view_all,punch,correct}
--       hr.attendance.timesheets.{view,submit,approve}
--       hr.attendance.exceptions.{view,manage}
--       hr.attendance.compute.run
--       hr.attendance.policy.manage
--       hr.attendance.reports.{view,export}
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- employee: punch own time; view own records; submit own timesheet; view own exceptions
  ('employee',   'hr.attendance.view'),
  ('employee',   'hr.attendance.punch'),
  ('employee',   'hr.attendance.timesheets.view'),
  ('employee',   'hr.attendance.timesheets.submit'),
  ('employee',   'hr.attendance.exceptions.view'),

  -- manager: view all under dept; correct; approve timesheets; manage exceptions
  ('manager',    'hr.attendance.view'),
  ('manager',    'hr.attendance.view_all'),
  ('manager',    'hr.attendance.punch'),
  ('manager',    'hr.attendance.correct'),
  ('manager',    'hr.attendance.timesheets.view'),
  ('manager',    'hr.attendance.timesheets.submit'),
  ('manager',    'hr.attendance.timesheets.approve'),
  ('manager',    'hr.attendance.exceptions.view'),
  ('manager',    'hr.attendance.exceptions.manage'),
  ('manager',    'hr.attendance.reports.view'),

  -- hr_staff: view all; correct; manage exceptions; view reports
  ('hr_staff',   'hr.attendance.view'),
  ('hr_staff',   'hr.attendance.view_all'),
  ('hr_staff',   'hr.attendance.punch'),
  ('hr_staff',   'hr.attendance.correct'),
  ('hr_staff',   'hr.attendance.timesheets.view'),
  ('hr_staff',   'hr.attendance.timesheets.submit'),
  ('hr_staff',   'hr.attendance.timesheets.approve'),
  ('hr_staff',   'hr.attendance.exceptions.view'),
  ('hr_staff',   'hr.attendance.exceptions.manage'),
  ('hr_staff',   'hr.attendance.compute.run'),
  ('hr_staff',   'hr.attendance.reports.view'),
  ('hr_staff',   'hr.attendance.reports.export'),

  -- hr_manager: full attendance management including policy
  ('hr_manager', 'hr.attendance.view'),
  ('hr_manager', 'hr.attendance.view_all'),
  ('hr_manager', 'hr.attendance.punch'),
  ('hr_manager', 'hr.attendance.correct'),
  ('hr_manager', 'hr.attendance.timesheets.view'),
  ('hr_manager', 'hr.attendance.timesheets.submit'),
  ('hr_manager', 'hr.attendance.timesheets.approve'),
  ('hr_manager', 'hr.attendance.exceptions.view'),
  ('hr_manager', 'hr.attendance.exceptions.manage'),
  ('hr_manager', 'hr.attendance.compute.run'),
  ('hr_manager', 'hr.attendance.policy.manage'),
  ('hr_manager', 'hr.attendance.reports.view'),
  ('hr_manager', 'hr.attendance.reports.export'),

  -- admin: all
  ('admin',      'hr.attendance.view'),
  ('admin',      'hr.attendance.view_all'),
  ('admin',      'hr.attendance.punch'),
  ('admin',      'hr.attendance.correct'),
  ('admin',      'hr.attendance.timesheets.view'),
  ('admin',      'hr.attendance.timesheets.submit'),
  ('admin',      'hr.attendance.timesheets.approve'),
  ('admin',      'hr.attendance.exceptions.view'),
  ('admin',      'hr.attendance.exceptions.manage'),
  ('admin',      'hr.attendance.compute.run'),
  ('admin',      'hr.attendance.policy.manage'),
  ('admin',      'hr.attendance.reports.view'),
  ('admin',      'hr.attendance.reports.export'),

  -- superadmin: all
  ('superadmin', 'hr.attendance.view'),
  ('superadmin', 'hr.attendance.view_all'),
  ('superadmin', 'hr.attendance.punch'),
  ('superadmin', 'hr.attendance.correct'),
  ('superadmin', 'hr.attendance.timesheets.view'),
  ('superadmin', 'hr.attendance.timesheets.submit'),
  ('superadmin', 'hr.attendance.timesheets.approve'),
  ('superadmin', 'hr.attendance.exceptions.view'),
  ('superadmin', 'hr.attendance.exceptions.manage'),
  ('superadmin', 'hr.attendance.compute.run'),
  ('superadmin', 'hr.attendance.policy.manage'),
  ('superadmin', 'hr.attendance.reports.view'),
  ('superadmin', 'hr.attendance.reports.export')
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
