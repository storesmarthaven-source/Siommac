-- ============================================================================
-- Finance Payroll — Phase 3 Stage 2 — Run Permissions (Spec §9)
-- Keys: finance.payroll.{view_own, view_all, run.manage, reports.view, reports.export}
-- Grants: employee, finance_staff, finance_manager, admin, superadmin
--
-- Stage 3 keys (approve, lock, export) are NOT added here.
-- ============================================================================

-- ── Catalogue the 5 payroll run keys in role_permissions ─────────────────────

-- employee → view_own (see own payslip line; full payslip gated in stage 3)
insert into public.role_permissions (role_name, permission) values
  ('employee', 'finance.payroll.view_own')
on conflict do nothing;

-- finance_staff → view_all + run.manage + reports.view
insert into public.role_permissions (role_name, permission)
  select 'finance_staff', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view'
  ]) as p
on conflict do nothing;

-- finance_manager → all five
insert into public.role_permissions (role_name, permission)
  select 'finance_manager', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export'
  ]) as p
on conflict do nothing;

-- admin → all five
insert into public.role_permissions (role_name, permission)
  select 'admin', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export'
  ]) as p
on conflict do nothing;

-- superadmin inherits everything via loadRolePermissions → PERMISSION_KEYS;
-- no rows needed but add for completeness so DB is authoritative
insert into public.role_permissions (role_name, permission)
  select 'superadmin', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export'
  ]) as p
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
