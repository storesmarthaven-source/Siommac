-- ============================================================================
-- HR Roster Scheduling — permissions (keys + DB grants)
-- ============================================================================
-- Keys catalogued here (ALSO reported to the main session for the four TS
-- catalogues that the main session owns):
--   hr.roster.view             — see rosters for their scope
--   hr.roster.view_own         — employee self-view of own published shifts
--   hr.roster.manage           — create/edit/assign/generate
--   hr.roster.publish          — lock + notify assignees
--   hr.roster.templates.manage — shift templates + rotation patterns + coverage
--
-- Column is `permission` (NOT permission_key — that column does not exist).
-- Only roles that exist in public.roles:
--   employee, manager, hr_staff, hr_manager, admin, superadmin
-- (finance_staff, finance_manager, hse_staff are valid roles but don't need
-- roster grants at this time.)
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- employee: self-view of own published shifts only
  ('employee',    'hr.roster.view_own'),

  -- manager: manage rosters + publish + view for their scope
  ('manager',     'hr.roster.view'),
  ('manager',     'hr.roster.manage'),
  ('manager',     'hr.roster.publish'),
  ('manager',     'hr.roster.templates.manage'),

  -- hr_staff: manage + view; NOT publish or templates
  ('hr_staff',    'hr.roster.view'),
  ('hr_staff',    'hr.roster.manage'),

  -- hr_manager: full roster authority
  ('hr_manager',  'hr.roster.view'),
  ('hr_manager',  'hr.roster.view_own'),
  ('hr_manager',  'hr.roster.manage'),
  ('hr_manager',  'hr.roster.publish'),
  ('hr_manager',  'hr.roster.templates.manage'),

  -- admin: all roster keys
  ('admin',       'hr.roster.view'),
  ('admin',       'hr.roster.view_own'),
  ('admin',       'hr.roster.manage'),
  ('admin',       'hr.roster.publish'),
  ('admin',       'hr.roster.templates.manage'),

  -- superadmin: all roster keys
  ('superadmin',  'hr.roster.view'),
  ('superadmin',  'hr.roster.view_own'),
  ('superadmin',  'hr.roster.manage'),
  ('superadmin',  'hr.roster.publish'),
  ('superadmin',  'hr.roster.templates.manage')

on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
