-- ============================================================================
-- HR Requests — role_permissions grants
-- ============================================================================
-- Grants hr.requests.submit_own to all employee-baseline roles so every
-- employee can file their own requests. Grants hr.requests.manage to HR
-- staff/managers for triage and decision-making.
--
-- Role names match those used in 20260714000013_module_staff_roles.sql.
-- Column is role_name (not role) — AppendixItem 5 in the implementation brief.
--
-- After applying, run:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  -- self-service: every employee-baseline role can file their own requests
  ('employee',   'hr.requests.submit_own'),
  ('manager',    'hr.requests.submit_own'),
  ('supervisor', 'hr.requests.submit_own'),
  ('hr_staff',   'hr.requests.submit_own'),
  ('hr_manager', 'hr.requests.submit_own'),
  ('admin',      'hr.requests.submit_own'),
  ('superadmin', 'hr.requests.submit_own'),
  -- triage / decide / fulfill: HR oversight roles
  ('hr_staff',   'hr.requests.manage'),
  ('hr_manager', 'hr.requests.manage'),
  ('admin',      'hr.requests.manage'),
  ('superadmin', 'hr.requests.manage')
on conflict do nothing;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
