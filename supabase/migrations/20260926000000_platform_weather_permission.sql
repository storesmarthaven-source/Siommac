-- Grant platform.weather.view to every role that carries the employee baseline.
--
-- `role_permissions` is the runtime source of truth for role→permission (the ROLE_PERMISSIONS
-- constant in src/lib/permissions.ts is the seed + the pure resolver's reference), so a new key
-- is INVISIBLE to non-superadmin users until it lands here. Mirrors the defaults added there.
--
-- Weather is public forecast data proxied server-side; the permission exists so the proxy
-- requires an authenticated, permissioned caller rather than to protect organisation records.
-- Hence: low risk, granted to everyone. Re-runnable.

insert into public.role_permissions (role_name, permission) values
  ('superadmin',      'platform.weather.view'),
  ('admin',           'platform.weather.view'),
  ('manager',         'platform.weather.view'),
  ('employee',        'platform.weather.view'),
  ('hr_staff',        'platform.weather.view'),
  ('hr_manager',      'platform.weather.view'),
  ('hse_staff',       'platform.weather.view'),
  ('finance_staff',   'platform.weather.view'),
  ('finance_manager', 'platform.weather.view')
on conflict do nothing;
