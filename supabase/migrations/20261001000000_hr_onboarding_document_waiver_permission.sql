-- Dedicated evidence-waiver authority. Starting a case does not imply permission to
-- waive a requirement. The application independently checks this key when any launch
-- selection uses action = 'waive'.
insert into public.role_permissions (role_name, permission) values
  ('admin', 'hr.onboarding.documents.waive'),
  ('hr_manager', 'hr.onboarding.documents.waive')
on conflict do nothing;

-- Verification (expected exact roles: admin, hr_manager):
-- select role_name from public.role_permissions
-- where permission = 'hr.onboarding.documents.waive' order by role_name;
