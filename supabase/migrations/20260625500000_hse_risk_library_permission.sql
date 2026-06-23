-- Grant the new hse.risk.library.manage permission to the roles that curate the
-- master hazard / control libraries. Matches the ROLE_PERMISSIONS defaults in
-- src/lib/permissions.ts (manager / admin / superadmin). Re-runnable.

insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.risk.library.manage'),
  ('admin',      'hse.risk.library.manage'),
  ('manager',    'hse.risk.library.manage')
on conflict do nothing;
