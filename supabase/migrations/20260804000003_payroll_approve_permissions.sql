-- ============================================================================
-- Finance Payroll — Phase 3 Stage 3 — Approve / Lock / Export Permissions
-- Keys: finance.payroll.{approve, lock, export}
-- Grants: finance_manager, admin, superadmin (NOT finance_staff — SoD)
-- Spec §9 / §10
-- ============================================================================

-- ── Catalogue the 3 stage-3 keys for role_permissions ────────────────────────

-- finance_manager → approve + lock + export (SoD: finance_staff does NOT get these)
insert into public.role_permissions (role_name, permission)
  select 'finance_manager', p from unnest(array[
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export'
  ]) as p
on conflict do nothing;

-- admin → approve + lock + export
insert into public.role_permissions (role_name, permission)
  select 'admin', p from unnest(array[
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export'
  ]) as p
on conflict do nothing;

-- superadmin inherits everything via loadRolePermissions → PERMISSION_KEYS;
-- add for DB completeness
insert into public.role_permissions (role_name, permission)
  select 'superadmin', p from unnest(array[
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export'
  ]) as p
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
