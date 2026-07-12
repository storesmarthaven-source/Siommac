-- ============================================================================
-- Payslip Template Approval -- permission grants
-- ============================================================================
-- Adds the new finance.payroll.templates.approve key to DB role_permissions for
-- all roles that already hold finance.payroll.templates.manage PLUS the admin
-- and superadmin roles. Idempotent.
--
-- Operator steps: apply after 20260919000110, then NOTIFY pgrst, 'reload schema'.
-- ============================================================================

-- Grant to roles that hold finance.payroll.templates.manage (finance_staff,
-- finance_manager, admin, superadmin) but only if they also hold
-- finance.statutory.approve (manager/admin -- SoD requires a senior role).
-- In practice: finance_manager and admin/superadmin are the approvers.

insert into public.role_permissions (role_name, permission)
select rp.role_name, 'finance.payroll.templates.approve'
from public.role_permissions rp
where rp.permission = 'finance.statutory.approve'
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
