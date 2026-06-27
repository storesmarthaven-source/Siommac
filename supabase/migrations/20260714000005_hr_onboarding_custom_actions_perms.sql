-- ============================================================================
-- HR Onboarding — Custom Onboarding Actions permission grants (Phase 5)
-- ============================================================================
-- 8 enforced keys for template management + case-level custom actions. Granted to
-- superadmin / admin / hr_manager (same roles as the other onboarding manage keys).
-- Catalogue entries: netlify/functions/lib/permissions.ts + src/lib/permissions.ts
-- + src/lib/permissionMeta.ts. Operator-applied; after applying: NOTIFY pgrst.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.onboarding.custom_actions.view'),         ('admin','hr.onboarding.custom_actions.view'),         ('hr_manager','hr.onboarding.custom_actions.view'),
  ('superadmin','hr.onboarding.custom_actions.create'),       ('admin','hr.onboarding.custom_actions.create'),       ('hr_manager','hr.onboarding.custom_actions.create'),
  ('superadmin','hr.onboarding.custom_actions.update'),       ('admin','hr.onboarding.custom_actions.update'),       ('hr_manager','hr.onboarding.custom_actions.update'),
  ('superadmin','hr.onboarding.custom_actions.retire'),       ('admin','hr.onboarding.custom_actions.retire'),       ('hr_manager','hr.onboarding.custom_actions.retire'),
  ('superadmin','hr.onboarding.custom_actions.case_add'),     ('admin','hr.onboarding.custom_actions.case_add'),     ('hr_manager','hr.onboarding.custom_actions.case_add'),
  ('superadmin','hr.onboarding.custom_actions.case_update'),  ('admin','hr.onboarding.custom_actions.case_update'),  ('hr_manager','hr.onboarding.custom_actions.case_update'),
  ('superadmin','hr.onboarding.custom_actions.case_complete'),('admin','hr.onboarding.custom_actions.case_complete'),('hr_manager','hr.onboarding.custom_actions.case_complete'),
  ('superadmin','hr.onboarding.custom_actions.case_cancel'),  ('admin','hr.onboarding.custom_actions.case_cancel'),  ('hr_manager','hr.onboarding.custom_actions.case_cancel')
on conflict do nothing;
