-- ============================================================================
-- Finance Payroll Runs Register (spec §15.2) — grant run_views.manage_team
-- Companion grant for 20260919000440_finance_payroll_run_views.sql.
--
-- Team-scope saved views are a payroll-MANAGER capability (publish/edit/delete a
-- shared filter view), deliberately NOT reusing finance.payroll.run.manage —
-- which finance_staff also holds — so staff keep least-privilege (personal views
-- only). We therefore key the grant off finance.payroll.approve, which is held
-- only by payroll approvers (finance_manager + superadmin), never finance_staff.
-- Idempotent.
-- ============================================================================

insert into public.role_permissions (role_name, permission)
select rp.role_name, 'finance.payroll.run_views.manage_team'
from public.role_permissions rp
where rp.permission = 'finance.payroll.approve'
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
