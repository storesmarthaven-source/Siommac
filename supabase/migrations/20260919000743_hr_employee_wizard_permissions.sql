-- Migration: 20260919000743_hr_employee_wizard_permissions.sql
--
-- Grants new permission keys introduced for the employee creation wizard v2:
--   hr.access_profiles.view  — list hr_access_profiles (wizard step 5 picker)
--   hr.employees.wizard.draft — save/get/delete wizard drafts
--
-- These keys are added to the catalogues in code; WITHOUT these role_permissions rows
-- every call 403s even for hr_manager (requirePermission reads the DB, not the static
-- catalogue). Superadmin is allow-all and is unaffected; all other roles need the grant.
-- PENDING OPERATOR ACTION — never self-apply.

insert into public.role_permissions (role, permission_key)
values
  -- hr.access_profiles.view
  ('superadmin',  'hr.access_profiles.view'),
  ('admin',       'hr.access_profiles.view'),
  ('hr_manager',  'hr.access_profiles.view'),
  ('hr_staff',    'hr.access_profiles.view'),
  -- hr.employees.wizard.draft
  ('superadmin',  'hr.employees.wizard.draft'),
  ('admin',       'hr.employees.wizard.draft'),
  ('hr_manager',  'hr.employees.wizard.draft'),
  ('hr_staff',    'hr.employees.wizard.draft')
on conflict do nothing;
