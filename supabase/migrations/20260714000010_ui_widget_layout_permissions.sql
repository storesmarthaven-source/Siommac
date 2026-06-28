-- ============================================================================
-- UI dashboard boards + installable widget packages — RBAC grants
-- ============================================================================
-- New enforced keys (moved off requireUser/requireRole onto requirePermission):
--   ui.layout.manage            customize (save) a dashboard board layout
--   ui.layout.default.manage    set the org-wide default board layout (admin)
--   ui.widgets.packages.view    read installed widget packages — needed to RENDER any
--                               board with installed widgets, so granted broadly
--   ui.widgets.packages.manage  install / uninstall widget packages (org-wide, admin)
-- Catalogue entries live in netlify/functions/lib/permissions.ts + src/lib/permissions.ts
-- + src/lib/permissionMeta.ts. Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  -- view installed packages — every board-viewing role (else installed widgets can't render)
  ('superadmin','ui.widgets.packages.view'),('admin','ui.widgets.packages.view'),('hr_manager','ui.widgets.packages.view'),
  ('manager','ui.widgets.packages.view'),('employee','ui.widgets.packages.view'),
  -- customize a board layout — managers/admins (matches the UI Customize gate)
  ('superadmin','ui.layout.manage'),('admin','ui.layout.manage'),('hr_manager','ui.layout.manage'),('manager','ui.layout.manage'),
  -- set the org default layout — admins
  ('superadmin','ui.layout.default.manage'),('admin','ui.layout.default.manage'),
  -- install/uninstall widget packages — admins
  ('superadmin','ui.widgets.packages.manage'),('admin','ui.widgets.packages.manage')
on conflict do nothing;
