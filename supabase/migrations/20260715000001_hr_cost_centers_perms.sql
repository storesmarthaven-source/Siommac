-- ============================================================================
-- HR Organization Structure (Phase A) — cost-centre permission grants
-- ============================================================================
-- Dedicated cost-centre keys (financial reference data). Org-unit + positions
-- reuse the existing hr.organization.* / hr.positions.* keys. Mirrors the code
-- catalogue (src/lib/permissions.ts) for the DB matrix. Run manually, then:
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.cost_centers.view'),('superadmin','hr.cost_centers.manage'),
  ('admin','hr.cost_centers.view'),('admin','hr.cost_centers.manage'),
  ('hr_manager','hr.cost_centers.view'),('hr_manager','hr.cost_centers.manage'),
  ('manager','hr.cost_centers.view'),
  -- HR execution tier: read-only org visibility to do their job (no manage)
  ('hr_staff','hr.cost_centers.view'),
  ('hr_staff','hr.organization.view'),
  ('hr_staff','hr.positions.view')
on conflict do nothing;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
