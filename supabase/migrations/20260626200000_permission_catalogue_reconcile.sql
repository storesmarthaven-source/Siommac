-- Migration: 20260626200000_permission_catalogue_reconcile.sql
--
-- Backfills the permission keys that Phase A1 RBAC reconciliation added to the
-- catalogue (PERMISSION_KEYS in both src/lib/permissions.ts and
-- netlify/functions/lib/permissions.ts).
--
-- Keys added (11 new, 2 dead keys removed):
--   ADDED:
--     hse.ptw.view, hse.ptw.create, hse.ptw.approve, hse.ptw.activate, hse.ptw.manage
--     hse.capa.manage
--     hse.incidents.create
--     hse.investigations.manage
--     hse.risk.approve
--     tickets.manage
--     workflow.view
--   REMOVED (dead — no route ever enforced them; replaced by hse.ptw.*):
--     hse.permits.view, hse.permits.manage
--
-- Role grant intent (mirrors ROLE_PERMISSIONS seed):
--   employee   → hse.ptw.view, workflow.view
--   manager    → all 11 new keys
--   admin      → all 11 new keys
--   superadmin → receives all permissions via loadRolePermissions() shortcut (new Set(PERMISSION_KEYS))
--                so no explicit rows needed for superadmin
--
-- All inserts are idempotent (ON CONFLICT DO NOTHING).
-- Dead keys (hse.permits.view / hse.permits.manage) are deleted so the DB
-- reflects the current catalogue exactly.

-- ── Remove dead permit keys ────────────────────────────────────────────────────
DELETE FROM role_permissions
WHERE permission IN ('hse.permits.view', 'hse.permits.manage');

-- ── employee: view-only PTW + workflow.view ────────────────────────────────────
INSERT INTO role_permissions (role_name, permission) VALUES
  ('employee', 'hse.ptw.view'),
  ('employee', 'workflow.view')
ON CONFLICT DO NOTHING;

-- ── manager: all 11 new keys ──────────────────────────────────────────────────
INSERT INTO role_permissions (role_name, permission) VALUES
  ('manager', 'hse.ptw.view'),
  ('manager', 'hse.ptw.create'),
  ('manager', 'hse.ptw.approve'),
  ('manager', 'hse.ptw.activate'),
  ('manager', 'hse.ptw.manage'),
  ('manager', 'hse.capa.manage'),
  ('manager', 'hse.incidents.create'),
  ('manager', 'hse.investigations.manage'),
  ('manager', 'hse.risk.approve'),
  ('manager', 'tickets.manage'),
  ('manager', 'workflow.view')
ON CONFLICT DO NOTHING;

-- ── admin: all 11 new keys ────────────────────────────────────────────────────
INSERT INTO role_permissions (role_name, permission) VALUES
  ('admin', 'hse.ptw.view'),
  ('admin', 'hse.ptw.create'),
  ('admin', 'hse.ptw.approve'),
  ('admin', 'hse.ptw.activate'),
  ('admin', 'hse.ptw.manage'),
  ('admin', 'hse.capa.manage'),
  ('admin', 'hse.incidents.create'),
  ('admin', 'hse.investigations.manage'),
  ('admin', 'hse.risk.approve'),
  ('admin', 'tickets.manage'),
  ('admin', 'workflow.view')
ON CONFLICT DO NOTHING;
