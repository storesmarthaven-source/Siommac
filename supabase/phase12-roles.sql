-- ============================================================
-- Siomac — Phase 12: Custom roles (RBAC-as-data)
-- Run this in the Supabase SQL editor.
--
-- Roles become editable data. Two roles are permanent system roles:
--   • superadmin — hardcoded allow-all (bootstrap rail), non-deletable
--   • employee   — the universal baseline every user has, non-deletable
-- All other roles (admin, manager, and any you create like HSE Manager,
-- Finance Officer, …) are ordinary custom roles: editable and deletable.
--
-- app_users.role stays a TEXT role name (the role's identity), so every
-- existing `role = 'admin'` style check keeps working unchanged. A custom role
-- simply won't match the built-in names — it gets access via its permission
-- set (role_permissions) + module visibility (module_permissions).
-- ============================================================

-- ── 1. roles ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roles (
  name        text        PRIMARY KEY,                -- identity used by app_users.role
  label       text        NOT NULL,                   -- display name, e.g. "HSE Manager"
  description text        NOT NULL DEFAULT '',
  is_system   boolean     NOT NULL DEFAULT false,     -- superadmin / employee — built-in
  protected   boolean     NOT NULL DEFAULT false,     -- cannot be deleted / core perms stripped
  sort_order  int         NOT NULL DEFAULT 100,        -- stable ordering in the UI
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text        NOT NULL DEFAULT 'system',
  CONSTRAINT roles_name_format CHECK (name ~ '^[a-z][a-z0-9_]*$')
);

-- ── 2. role_permissions ──────────────────────────────────────
-- A role's DEFAULT capability grants (resource.action). Per-USER overrides live
-- in user_permissions (phase 8) and still take priority at resolve time.
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_name  text NOT NULL REFERENCES public.roles(name) ON DELETE CASCADE ON UPDATE CASCADE,
  permission text NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_name, permission),
  CONSTRAINT role_permissions_key_format CHECK (permission ~ '^[a-z_]+\.[a-z_]+$')
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions (role_name);

-- ── 3. Seed system + initial roles ───────────────────────────
INSERT INTO public.roles (name, label, description, is_system, protected, sort_order) VALUES
  ('superadmin', 'Superadmin', 'Full, unrestricted access. Permanent.',        true,  true,  0),
  ('employee',   'Employee',   'Baseline self-service every user has. Permanent.', true,  true,  10),
  ('admin',      'Admin',      'Organisation administrator.',                   false, false, 20),
  ('manager',    'Manager',    'Department / team manager.',                    false, false, 30)
ON CONFLICT (name) DO UPDATE
  SET label       = EXCLUDED.label,
      is_system   = EXCLUDED.is_system,
      protected   = public.roles.protected OR EXCLUDED.protected;  -- never un-protect on re-run

-- Role default permissions — mirrors the hardcoded ROLE_PERMISSIONS catalogue.
-- (superadmin is allow-all in code; its rows are seeded for completeness/UI.)
INSERT INTO public.role_permissions (role_name, permission) VALUES
  ('employee', 'attendance.view_own'),
  ('employee', 'leaves.view_own'),
  ('employee', 'leaves.submit'),
  ('employee', 'payroll.view_own'),
  ('employee', 'dashboard.view'),
  ('manager', 'attendance.view_own'),
  ('manager', 'attendance.view_all'),
  ('manager', 'attendance.export'),
  ('manager', 'leaves.view_own'),
  ('manager', 'leaves.submit'),
  ('manager', 'leaves.view_all'),
  ('manager', 'leaves.approve'),
  ('manager', 'payroll.view_own'),
  ('manager', 'employees.view'),
  ('manager', 'employees.view_detail'),
  ('manager', 'departments.view'),
  ('manager', 'sites.view'),
  ('manager', 'map.view'),
  ('manager', 'dashboard.view'),
  ('manager', 'reports.export'),
  ('admin', 'attendance.view_own'),
  ('admin', 'attendance.view_all'),
  ('admin', 'attendance.edit'),
  ('admin', 'attendance.export'),
  ('admin', 'leaves.view_own'),
  ('admin', 'leaves.submit'),
  ('admin', 'leaves.view_all'),
  ('admin', 'leaves.approve'),
  ('admin', 'leaves.delete'),
  ('admin', 'payroll.view_own'),
  ('admin', 'payroll.view_all'),
  ('admin', 'payroll.run'),
  ('admin', 'payroll.approve'),
  ('admin', 'payroll.export'),
  ('admin', 'hourly_rates.view'),
  ('admin', 'hourly_rates.edit'),
  ('admin', 'employees.view'),
  ('admin', 'employees.view_detail'),
  ('admin', 'employees.add'),
  ('admin', 'employees.edit'),
  ('admin', 'employees.delete'),
  ('admin', 'employees.view_pay'),
  ('admin', 'departments.view'),
  ('admin', 'departments.add'),
  ('admin', 'departments.edit'),
  ('admin', 'departments.delete'),
  ('admin', 'sites.view'),
  ('admin', 'sites.add'),
  ('admin', 'sites.edit'),
  ('admin', 'sites.delete'),
  ('admin', 'sites.assign_employees'),
  ('admin', 'map.view'),
  ('admin', 'dashboard.view'),
  ('admin', 'reports.export'),
  ('admin', 'settings.view'),
  ('admin', 'settings.edit'),
  ('admin', 'settings.statutory_rates'),
  ('superadmin', 'employees.view'),
  ('superadmin', 'employees.view_detail'),
  ('superadmin', 'employees.add'),
  ('superadmin', 'employees.edit'),
  ('superadmin', 'employees.delete'),
  ('superadmin', 'employees.view_pay'),
  ('superadmin', 'departments.view'),
  ('superadmin', 'departments.add'),
  ('superadmin', 'departments.edit'),
  ('superadmin', 'departments.delete'),
  ('superadmin', 'attendance.view_own'),
  ('superadmin', 'attendance.view_all'),
  ('superadmin', 'attendance.edit'),
  ('superadmin', 'attendance.export'),
  ('superadmin', 'leaves.view_own'),
  ('superadmin', 'leaves.submit'),
  ('superadmin', 'leaves.view_all'),
  ('superadmin', 'leaves.approve'),
  ('superadmin', 'leaves.delete'),
  ('superadmin', 'payroll.view_own'),
  ('superadmin', 'payroll.view_all'),
  ('superadmin', 'payroll.run'),
  ('superadmin', 'payroll.approve'),
  ('superadmin', 'payroll.export'),
  ('superadmin', 'hourly_rates.view'),
  ('superadmin', 'hourly_rates.edit'),
  ('superadmin', 'sites.view'),
  ('superadmin', 'sites.add'),
  ('superadmin', 'sites.edit'),
  ('superadmin', 'sites.delete'),
  ('superadmin', 'sites.assign_employees'),
  ('superadmin', 'map.view'),
  ('superadmin', 'dashboard.view'),
  ('superadmin', 'reports.export'),
  ('superadmin', 'settings.view'),
  ('superadmin', 'settings.edit'),
  ('superadmin', 'settings.statutory_rates'),
  ('superadmin', 'permissions.manage'),
  ('superadmin', 'sessions.manage'),
  ('superadmin', 'audit.view'),
  ('superadmin', 'roles.manage')
ON CONFLICT (role_name, permission) DO NOTHING;

-- ── 4. Lift the role CHECK constraints so any role name is valid ──
-- app_users.role: validated against the roles table (soft FK) instead of a
-- fixed list. We drop the hardcoded CHECK; a trigger enforces referential
-- integrity without blocking custom names.
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;

CREATE OR REPLACE FUNCTION public.app_users_role_exists()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = NEW.role) THEN
    RAISE EXCEPTION 'Unknown role: %', NEW.role;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS app_users_role_fk ON public.app_users;
CREATE TRIGGER app_users_role_fk
  BEFORE INSERT OR UPDATE OF role ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.app_users_role_exists();

-- module_permissions.role: allow any role (was admin/manager only) — Option B nav.
ALTER TABLE public.module_permissions DROP CONSTRAINT IF EXISTS module_permissions_role_check;

-- ── 5. RLS ───────────────────────────────────────────────────
ALTER TABLE public.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
-- Authenticated users may read (needed to resolve permissions at login/nav).
DROP POLICY IF EXISTS "roles_read" ON public.roles;
CREATE POLICY "roles_read" ON public.roles FOR SELECT USING (true);
DROP POLICY IF EXISTS "role_permissions_read" ON public.role_permissions;
CREATE POLICY "role_permissions_read" ON public.role_permissions FOR SELECT USING (true);
-- All writes go through the service-role backend (bypasses RLS).

-- ── 6. Verify ────────────────────────────────────────────────
SELECT r.name, r.is_system, r.protected, count(rp.permission) AS perms
FROM public.roles r
LEFT JOIN public.role_permissions rp ON rp.role_name = r.name
GROUP BY r.name, r.is_system, r.protected, r.sort_order
ORDER BY r.sort_order;
-- Expected: superadmin(sys,prot), employee(sys,prot), admin, manager with perm counts.
