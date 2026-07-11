-- ============================================================================
-- Grants for the Wave 7 statutory-forms permissions
-- ============================================================================
-- Enforcement reads role_permissions (DB). Grant the two new keys to every role
-- that already holds finance.payroll.run.manage (the finance managers/staff who
-- run payroll). Idempotent. ASCII.
-- ============================================================================

insert into public.role_permissions (role_name, permission)
select rp.role_name, v.perm
  from public.role_permissions rp
  cross join (values
    ('finance.payroll.statutory_forms.generate'),
    ('finance.payroll.statutory_forms.view')
  ) as v(perm)
 where rp.permission = 'finance.payroll.run.manage'
 on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
