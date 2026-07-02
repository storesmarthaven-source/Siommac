-- ============================================================================
-- HR Onboarding — packages.manage permission (Package Manager)
-- ============================================================================
-- Package/task-template/handoff-template configuration is oversight-tier work
-- (org-wide policy), the same class as hr.onboarding.case.manage — granted to
-- the same trio every prior onboarding-management permission was granted to
-- (see 20260714000001_hr_onboarding_management_perms.sql): superadmin, admin,
-- hr_manager. Never generic `manager`, never `hr_staff` (the staff role split
-- in 20260714000013_module_staff_roles.sql is deliberately execution-only —
-- package config is policy oversight, not day-to-day case work).
-- Operator-applied; after applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.onboarding.packages.manage'),
  ('admin','hr.onboarding.packages.manage'),
  ('hr_manager','hr.onboarding.packages.manage')
on conflict do nothing;
