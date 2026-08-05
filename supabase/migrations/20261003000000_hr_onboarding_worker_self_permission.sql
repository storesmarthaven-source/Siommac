-- PENDING OPERATOR ACTION — do not self-apply.
-- Worker Onboarding is a self-scoped authenticated surface. Every recognised app role
-- may open its own projection; the route still binds all data to the JWT actor id.
insert into public.role_permissions (role_name, permission)
select role_name, 'hr.onboarding.self.view'
from (values
  ('employee'), ('manager'), ('admin'), ('superadmin'),
  ('hr_staff'), ('hr_manager'), ('hse_staff'), ('finance_staff'), ('finance_manager')
) as roles(role_name)
on conflict do nothing;

-- Verification 1: all recognised roles have the self-view key (expected: 9).
select count(*) as granted_roles
from public.role_permissions
where permission = 'hr.onboarding.self.view'
  and role_name in ('employee','manager','admin','superadmin','hr_staff','hr_manager','hse_staff','finance_staff','finance_manager');

-- Verification 2: self-service roles do not receive internal onboarding scope.
select role_name, permission
from public.role_permissions
where permission in ('hr.onboarding.view_team','hr.onboarding.view_all')
  and role_name in ('employee','hse_staff','finance_staff','finance_manager');
