-- ============================================================================
-- HR Employee Master v36 — new permission grants
-- ============================================================================
-- Adds the v36 Employee Master keys to role_permissions, matching the existing
-- HR grant pattern (superadmin/admin/hr_manager = full; manager = view-only).
-- The keys are registered in the FE+BE catalogues (permissions.ts / permissionMeta.ts).
-- Idempotent. Run manually, then NOTIFY pgrst.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  -- View the register/profiles/stats — everyone who already has hr.view
  ('superadmin','hr.employees.view'),('admin','hr.employees.view'),('manager','hr.employees.view'),('hr_manager','hr.employees.view'),

  -- Create + sensitive statutory/payroll/contact — full HR roles only (managers stay view-only)
  ('superadmin','hr.employees.create'),('admin','hr.employees.create'),('hr_manager','hr.employees.create'),
  ('superadmin','hr.employees.update'),('admin','hr.employees.update'),('hr_manager','hr.employees.update'),
  ('superadmin','hr.employees.statutory.view'),('admin','hr.employees.statutory.view'),('hr_manager','hr.employees.statutory.view'),
  ('superadmin','hr.employees.statutory.update'),('admin','hr.employees.statutory.update'),('hr_manager','hr.employees.statutory.update'),
  ('superadmin','hr.employees.payroll_readiness.view'),('admin','hr.employees.payroll_readiness.view'),('hr_manager','hr.employees.payroll_readiness.view'),
  ('superadmin','hr.employees.restricted_contact.update'),('admin','hr.employees.restricted_contact.update'),('hr_manager','hr.employees.restricted_contact.update')
on conflict do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';
