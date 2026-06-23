-- Migration: 20260627200000_auth_security_permissions
-- Phase B4a — Account Security permission keys
--
-- Adds the four new auth.security.* / auth.passkeys.* / auth.trusted_devices.*
-- permission keys to the role_permissions table for the appropriate roles.
--
-- Resolution order in the app:
--   superadmin → all keys (no rows needed — loadRolePermissions short-circuits)
--   admin      → all four keys
--   manager    → auth.security.view only
--   employee   → no auth security keys

-- ── admin ──────────────────────────────────────────────────────────────────────
insert into role_permissions (role_name, permission)
values
  ('admin', 'auth.security.view'),
  ('admin', 'auth.security.manage_policy'),
  ('admin', 'auth.passkeys.admin_revoke'),
  ('admin', 'auth.trusted_devices.admin_revoke')
on conflict (role_name, permission) do nothing;

-- ── manager ───────────────────────────────────────────────────────────────────
insert into role_permissions (role_name, permission)
values
  ('manager', 'auth.security.view')
on conflict (role_name, permission) do nothing;
