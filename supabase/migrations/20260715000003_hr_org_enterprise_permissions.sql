-- ============================================================================
-- HR Organization Structure (Phase B) — enterprise permission grants
-- ============================================================================
-- hr.organization.delete           — the guarded hard-delete of an org unit
-- hr.organization.override_approval — override/expedite a high-risk org change
-- Both are also catalogued in src/lib/permissions.ts + netlify .../permissions.ts
-- + permissionMeta.ts (the drift-guard requires it). Run manually, then:
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.organization.delete'),('admin','hr.organization.delete'),
  ('superadmin','hr.organization.override_approval')
on conflict do nothing;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
