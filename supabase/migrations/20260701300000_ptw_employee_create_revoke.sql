-- Reconcile PTW permissions to the code catalogue (the documented source of
-- truth — src/lib/permissions.ts ROLE_PERMISSIONS). Permit creation is
-- supervisor+ (manager/admin/superadmin); employees may VIEW permits and raise
-- inspections, but not create permits.
--
-- 20260625100000_hse_ptw_permissions.sql erroneously granted
-- ('employee','hse.ptw.create'); requirePermission() reads role_permissions, so
-- employees could create permits at runtime. Remove the stray grant.
-- Idempotent: a no-op once removed.

delete from public.role_permissions
where role_name = 'employee' and permission = 'hse.ptw.create';
