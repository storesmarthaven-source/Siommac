-- Grants for the Shared Work Calendar (F-CAL) permission keys. Operator-applied. Idempotent.
-- hr.work_calendar.view  -> read holiday sets, patterns, assignments, resolve preview.
-- hr.work_calendar.manage -> admin holiday/pattern/assignment commands + publish (segregation: managers/admins).
insert into public.role_permissions (role_name, permission) values
  ('hr_manager',      'hr.work_calendar.view'),
  ('hr_manager',      'hr.work_calendar.manage'),
  ('hr_staff',        'hr.work_calendar.view'),
  ('finance_manager', 'hr.work_calendar.view'),
  ('admin',           'hr.work_calendar.view'),
  ('admin',           'hr.work_calendar.manage'),
  ('superadmin',      'hr.work_calendar.view'),
  ('superadmin',      'hr.work_calendar.manage')
on conflict (role_name, permission) do nothing;
