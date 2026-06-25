-- ============================================================================
-- HR employee-document permissions — DB role_permissions seed
-- ============================================================================
-- Mirrors the code catalogue for the 6 hr.employee_documents.* keys. Admin +
-- HR Manager get all; generic manager gets view + download only. Idempotent.
-- Run manually + NOTIFY pgrst.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.employee_documents.view'),('superadmin','hr.employee_documents.upload'),
  ('superadmin','hr.employee_documents.verify'),('superadmin','hr.employee_documents.archive'),
  ('superadmin','hr.employee_documents.download'),('superadmin','hr.employee_documents.sensitive_view'),
  ('admin','hr.employee_documents.view'),('admin','hr.employee_documents.upload'),
  ('admin','hr.employee_documents.verify'),('admin','hr.employee_documents.archive'),
  ('admin','hr.employee_documents.download'),('admin','hr.employee_documents.sensitive_view'),
  ('hr_manager','hr.employee_documents.view'),('hr_manager','hr.employee_documents.upload'),
  ('hr_manager','hr.employee_documents.verify'),('hr_manager','hr.employee_documents.archive'),
  ('hr_manager','hr.employee_documents.download'),('hr_manager','hr.employee_documents.sensitive_view'),
  ('manager','hr.employee_documents.view'),('manager','hr.employee_documents.download')
on conflict do nothing;
