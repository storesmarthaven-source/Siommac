-- ============================================================================
-- HR Onboarding — reports permissions (Phase 6)
-- ============================================================================
-- Onboarding Reports workspace (9 analytics/compliance reports + CSV export).
--   reports.view   — run/view reports (analytics; low risk).
--   reports.export — CSV export (data egress; audited, medium risk).
-- View goes to the same trio + hr_staff (they run the operational queue and need
-- the analytics). Export is the more sensitive egress action and stays with the
-- oversight tier (superadmin/admin/hr_manager) — NOT hr_staff.
-- Operator-applied; after applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.onboarding.reports.view'),
  ('admin','hr.onboarding.reports.view'),
  ('hr_manager','hr.onboarding.reports.view'),
  ('hr_staff','hr.onboarding.reports.view'),
  ('superadmin','hr.onboarding.reports.export'),
  ('admin','hr.onboarding.reports.export'),
  ('hr_manager','hr.onboarding.reports.export')
on conflict do nothing;
