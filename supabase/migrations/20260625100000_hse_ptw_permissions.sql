-- Seed PTW (Permit-to-Work) permission keys into role_permissions.
--
-- Permission key schema: hse.ptw.<action>
--   hse.ptw.view     — list/get permits, view stats, list permit types
--   hse.ptw.create   — create permits, save drafts, submit
--   hse.ptw.manage   — update, suspend, revalidate, request-extension, close, cancel, archive
--   hse.ptw.approve  — approve, reject, request-changes, approve/reject extension
--   hse.ptw.activate — activate a permit (post-approval gate)
--
-- Mirrors the hse.risk.approve pattern from 20260623300000_hse_risk_approve_permission.sql.
-- ON CONFLICT DO NOTHING: idempotent, safe to re-run; existing overrides kept.

insert into public.role_permissions (role_name, permission) values
  -- superadmin: full access
  ('superadmin', 'hse.ptw.view'),
  ('superadmin', 'hse.ptw.create'),
  ('superadmin', 'hse.ptw.manage'),
  ('superadmin', 'hse.ptw.approve'),
  ('superadmin', 'hse.ptw.activate'),

  -- admin: full access
  ('admin', 'hse.ptw.view'),
  ('admin', 'hse.ptw.create'),
  ('admin', 'hse.ptw.manage'),
  ('admin', 'hse.ptw.approve'),
  ('admin', 'hse.ptw.activate'),

  -- manager: can create, manage, approve and activate
  ('manager', 'hse.ptw.view'),
  ('manager', 'hse.ptw.create'),
  ('manager', 'hse.ptw.manage'),
  ('manager', 'hse.ptw.approve'),
  ('manager', 'hse.ptw.activate'),

  -- employee: view only + can create/submit their own permits
  ('employee', 'hse.ptw.view'),
  ('employee', 'hse.ptw.create')

on conflict do nothing;
