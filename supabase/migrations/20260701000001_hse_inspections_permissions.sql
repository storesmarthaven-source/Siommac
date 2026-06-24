-- Seed the two NEW Inspections permission keys into role_permissions.
--   hse.inspections.create  — schedule/draft inspections
--   hse.inspections.review  — review/complete inspections, close/reopen findings
-- (hse.inspections.view + hse.inspections.manage were seeded earlier in
--  20260620000001_hse_workflow_permissions.sql and 20260621100002_erp_hse_core.sql.)
--
-- Mirrors the hse.ptw permission seed (20260625100000). ON CONFLICT DO NOTHING:
-- idempotent, safe to re-run; existing overrides kept.

insert into public.role_permissions (role_name, permission) values
  -- superadmin / admin: full
  ('superadmin', 'hse.inspections.create'),
  ('superadmin', 'hse.inspections.review'),
  ('admin',      'hse.inspections.create'),
  ('admin',      'hse.inspections.review'),

  -- manager: can create and review
  ('manager',    'hse.inspections.create'),
  ('manager',    'hse.inspections.review'),

  -- employee: can create/schedule + execute their assigned inspections (manage),
  -- but not the review/complete gate
  ('employee',   'hse.inspections.create')

on conflict do nothing;
