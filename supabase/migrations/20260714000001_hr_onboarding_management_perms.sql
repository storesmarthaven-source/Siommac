-- ============================================================================
-- HR Onboarding — management-module permission grants (Phase 3)
-- ============================================================================
-- New enforced keys: case.manage (add task / pause-resume / reassign owner / mark
-- ready / blocker resolve-escalate-waive), complete (close a case), audit.view
-- (case Audit tab). Granted to the same roles as the existing onboarding manage
-- keys (superadmin / admin / hr_manager). Catalogue entries live in
-- netlify/functions/lib/permissions.ts + src/lib/permissions.ts + permissionMeta.ts.
-- Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.onboarding.case.manage'),('admin','hr.onboarding.case.manage'),('hr_manager','hr.onboarding.case.manage'),
  ('superadmin','hr.onboarding.complete'),   ('admin','hr.onboarding.complete'),   ('hr_manager','hr.onboarding.complete'),
  ('superadmin','hr.onboarding.audit.view'), ('admin','hr.onboarding.audit.view'), ('hr_manager','hr.onboarding.audit.view')
on conflict do nothing;
