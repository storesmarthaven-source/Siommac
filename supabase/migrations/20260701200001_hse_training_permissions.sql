-- Seed the new Training verify-gate permission key into role_permissions.
--   hse.training.verify — approve / reject / revoke worker certificates
-- (hse.training.view + hse.training.manage were seeded earlier in
--  20260620000001_hse_workflow_permissions.sql / 20260621100002_erp_hse_core.sql.)
--
-- Mirrors the inspections permission seed. ON CONFLICT DO NOTHING: idempotent.

insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.training.verify'),
  ('admin',      'hse.training.verify'),
  ('manager',    'hse.training.verify')
on conflict do nothing;
