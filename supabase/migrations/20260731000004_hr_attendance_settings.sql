-- ============================================================================
-- HR Attendance & Timekeeping -- settings catalog defaults
-- ============================================================================
-- Seeds app_setting_catalog rows for the hrAttendance manifest.
-- The application resolveSettingValue resolves these defaults; admins can
-- override via the Settings UI.
-- ============================================================================

insert into public.app_setting_catalog
  (setting_key, module_key, label, description, data_type, default_value,
   is_active, scope, user_override_allowed, role_override_allowed,
   site_override_allowed, department_override_allowed, module_override_allowed,
   requires_permission)
values
  ('hr_attendance.enabled',                  'hr_attendance', 'Attendance Module Enabled',
   'Master switch for the HR Attendance & Timekeeping module.',
   'boolean', 'true', true, '["global"]'::jsonb, false, false, false, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.shift_start',              'hr_attendance', 'Shift Start Time',
   'Default shift start time in HH:MM (24-hour). Used by computeDay to calculate lateness.',
   'string', '"08:00"', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.grace_minutes',            'hr_attendance', 'Grace Period (minutes)',
   'Minutes after shift_start within which a punch-in is NOT flagged as late.',
   'number', '5', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.standard_day_minutes',     'hr_attendance', 'Standard Day (minutes)',
   'Full-day worked-minutes threshold. Records below this (and above short_hours) may flag short_hours.',
   'number', '480', true, '["global"]'::jsonb, false, false, false, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.overtime_threshold_minutes','hr_attendance', 'Overtime Threshold (minutes)',
   'Worked minutes above which time is counted as overtime.',
   'number', '480', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.rounding_minutes',         'hr_attendance', 'Punch Rounding (minutes)',
   'Round punch times to the nearest N minutes. Set 0 to disable rounding.',
   'number', '0', true, '["global"]'::jsonb, false, false, false, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.workweek',                 'hr_attendance', 'Workweek Days',
   'JSON array of workday numbers (0=Sun ... 6=Sat). Default Mon-Fri.',
   'string', '"[1,2,3,4,5]"', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.geofence_radius_m',        'hr_attendance', 'Geofence Radius (metres)',
   'Maximum distance in metres from site centre for a punch to be within the geofence.',
   'number', '100', true, '["global","site"]'::jsonb, false, false, true, false, false, 'hr.attendance.policy.manage'),

  ('hr_attendance.pay_period',               'hr_attendance', 'Pay Period',
   'Period for timesheet roll-up: weekly, biweekly, or monthly.',
   'string', '"biweekly"', true, '["global"]'::jsonb, false, false, false, false, false, 'hr.attendance.policy.manage')

on conflict (setting_key) do update
  set label                      = excluded.label,
      description                = excluded.description,
      default_value              = excluded.default_value,
      is_active                  = excluded.is_active,
      requires_permission        = excluded.requires_permission;

-- After applying, run: NOTIFY pgrst, 'reload schema';
