-- Seed the new `hse.capa.view` permission.
--
-- CAPA list/get were gated by requirePermission('hse.capa.manage'), which locked
-- out non-managers. That made the owner-scoping branch in capa/list (non-managers
-- see only the CAPAs they own) dead code. Splitting view from manage — mirroring
-- hse.incidents.view vs hse.incidents.manage — lets owners read their own CAPAs
-- while create/update stay on hse.capa.manage.
--
-- Granted to the same roles that hold hse.incidents.view (superadmin / admin /
-- manager / employee), per 20260621100002_erp_hse_core.sql. superadmin also
-- receives every key via loadRolePermissions()'s allow-all shortcut; the explicit
-- row is kept for parity with the incidents.view seed.
--
-- Idempotent: ON CONFLICT DO NOTHING. Safe to re-run; existing overrides kept.
-- NOTE: `NOTIFY pgrst, 'reload schema';` is applied manually by the operator.

insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.capa.view'),
  ('admin',      'hse.capa.view'),
  ('manager',    'hse.capa.view'),
  ('employee',   'hse.capa.view')
on conflict do nothing;
