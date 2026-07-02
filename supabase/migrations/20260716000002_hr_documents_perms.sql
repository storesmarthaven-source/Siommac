-- HR Documents — grant requirements.manage permission to oversight roles.
-- NOTE: column name is role_name (not role).

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.employee_documents.requirements.manage'),
  ('admin','hr.employee_documents.requirements.manage'),
  ('hr_manager','hr.employee_documents.requirements.manage')
on conflict do nothing;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
