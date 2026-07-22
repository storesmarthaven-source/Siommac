-- 20260919000730_manager_payslip_view_own_grant.sql
-- F-11 My Payslips is employee self-service for ALL staff. The 'manager' role could
-- see the (relocated, top-level) nav item but lacked the finance.payroll.view_own
-- permission the route enforces, so a manager would hit 403 on their own payslips.
-- Grant it (self-scope is enforced server-side, so this only ever exposes the
-- actor's OWN payslips). employee / finance_staff / finance_manager / admin already
-- hold it; superadmin is allow-all. Idempotent.

insert into public.role_permissions (role_name, permission) values
  ('manager', 'finance.payroll.view_own')
on conflict do nothing;
