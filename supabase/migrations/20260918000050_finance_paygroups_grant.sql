-- ============================================================================
-- Finance Payroll Wave 3b — grant paygroups.manage
-- Enforcement reads role_permissions (DB). Grant the new pay-group key to every
-- role that already has finance.payroll.run.manage. Idempotent.
-- ============================================================================

insert into public.role_permissions (role_name, permission)
select rp.role_name, 'finance.payroll.paygroups.manage'
from public.role_permissions rp
where rp.permission = 'finance.payroll.run.manage'
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
