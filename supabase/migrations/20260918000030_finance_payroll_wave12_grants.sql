-- ============================================================================
-- Finance Payroll Wave 1/2 — permission grants
-- Enforcement reads role_permissions (DB), so new code keys need DB grants.
-- Grant the payslip-render/deliver + GL preview/post keys to EVERY role that
-- already has finance.payroll.run.manage (mirrors the code ROLE_PERMISSIONS).
-- Idempotent.
-- ============================================================================

insert into public.role_permissions (role_name, permission)
select rp.role_name, v.perm
from public.role_permissions rp
cross join (values
  ('finance.payroll.payslips.generate'),
  ('finance.payroll.payslips.distribute'),
  ('finance.payroll.gl.preview'),
  ('finance.payroll.gl.post')
) as v(perm)
where rp.permission = 'finance.payroll.run.manage'
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
