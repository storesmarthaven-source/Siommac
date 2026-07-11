-- ============================================================================
-- Payslip Studio templates -- permission grants (Phase 1)
-- ============================================================================
-- Enforcement reads role_permissions (DB), so the new code keys need DB grants.
-- Grant the payslip-template view/manage keys to EVERY role that already holds
-- finance.payroll.run.manage (mirrors the code ROLE_PERMISSIONS). Idempotent.
-- ============================================================================

insert into public.role_permissions (role_name, permission)
select rp.role_name, v.perm
from public.role_permissions rp
cross join (values
  ('finance.payroll.templates.view'),
  ('finance.payroll.templates.manage')
) as v(perm)
where rp.permission = 'finance.payroll.run.manage'
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
