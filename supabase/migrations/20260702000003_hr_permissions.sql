-- ============================================================================
-- HR permissions — DB role_permissions seed + the "HR Manager" custom role
-- ============================================================================
-- Mirrors the code catalogue (src/lib/permissions.ts ROLE_PERMISSIONS) for the
-- built-in roles, and seeds a dedicated HR Manager role so HR staff get full HR
-- without over-granting every generic line manager. Idempotent. Run manually +
-- NOTIFY pgrst.
-- ============================================================================

-- ── Built-in roles (mirror code defaults) ─────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  -- superadmin: everything (bypasses at runtime, listed for the matrix)
  ('superadmin','hr.view'),('superadmin','hr.dashboard.view'),('superadmin','hr.audit.view'),
  ('superadmin','hr.settings.view'),('superadmin','hr.settings.manage'),
  ('superadmin','hr.employees.status_change'),('superadmin','hr.employees.transfer'),
  ('superadmin','hr.employees.role_change'),('superadmin','hr.employees.supervisor_change'),
  ('superadmin','hr.employees.sensitive_view'),
  ('superadmin','hr.organization.view'),('superadmin','hr.organization.manage'),
  ('superadmin','hr.positions.view'),('superadmin','hr.positions.manage'),
  -- admin: full people management
  ('admin','hr.view'),('admin','hr.dashboard.view'),('admin','hr.audit.view'),
  ('admin','hr.settings.view'),('admin','hr.settings.manage'),
  ('admin','hr.employees.status_change'),('admin','hr.employees.transfer'),
  ('admin','hr.employees.role_change'),('admin','hr.employees.supervisor_change'),
  ('admin','hr.employees.sensitive_view'),
  ('admin','hr.organization.view'),('admin','hr.organization.manage'),
  ('admin','hr.positions.view'),('admin','hr.positions.manage'),
  -- manager: view-only (generic line managers must not get HR change powers)
  ('manager','hr.view'),('manager','hr.dashboard.view'),
  ('manager','hr.organization.view'),('manager','hr.positions.view')
on conflict do nothing;

-- ── HR Manager custom role ────────────────────────────────────────────────────
insert into public.roles (name, label, description, is_system, protected, sort_order)
values ('hr_manager', 'HR Manager', 'Full HR people management without platform admin rights.', false, false, 45)
on conflict (name) do nothing;

insert into public.role_permissions (role_name, permission) values
  -- base + dashboard
  ('hr_manager','dashboard.view'),
  -- full HR
  ('hr_manager','hr.view'),('hr_manager','hr.dashboard.view'),('hr_manager','hr.audit.view'),
  ('hr_manager','hr.settings.view'),('hr_manager','hr.settings.manage'),
  ('hr_manager','hr.employees.status_change'),('hr_manager','hr.employees.transfer'),
  ('hr_manager','hr.employees.role_change'),('hr_manager','hr.employees.supervisor_change'),
  ('hr_manager','hr.employees.sensitive_view'),
  ('hr_manager','hr.organization.view'),('hr_manager','hr.organization.manage'),
  ('hr_manager','hr.positions.view'),('hr_manager','hr.positions.manage'),
  -- employee master CRUD (reuses the existing employees.* keys)
  ('hr_manager','employees.view'),('hr_manager','employees.view_detail'),
  ('hr_manager','employees.add'),('hr_manager','employees.edit'),
  ('hr_manager','employees.delete'),('hr_manager','employees.view_pay')
on conflict do nothing;
