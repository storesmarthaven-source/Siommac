-- ============================================================================
-- Finance roles — finance_staff + finance_manager
-- ============================================================================
-- The Compensation/Payroll build (docs/COMPENSATION_PAYROLL_PREP_
-- IMPLEMENTATION_BRIEF.md) introduces Finance-owned functions: pay-component
-- catalogue, statutory configuration (NIS/PAYE/Health Surcharge), NIS
-- verification, and payroll runs. Neither role exists yet in public.roles
-- (20260714000013 deliberately skipped Finance: "a role with nothing to grant
-- would be ceremony"). The finance permission catalogue lands with this
-- module, so the roles are created FIRST — role_permissions.role_name has an
-- implicit dependency on role existence, and grants to a non-existent role
-- would be silently orphaned.
--
-- IMPORTANT — roles/role_permissions are NOT hierarchical. loadRolePermissions
-- (netlify/functions/lib/permissions.ts) does a flat `where role_name = $1`;
-- a role's grant list must be a COMPLETE standalone set. Each role therefore
-- seeds the full `employee` baseline here; the finance module keys are added
-- in 20260802000006_compensation_payroll_permissions.sql (which also defines
-- the keys themselves).
--
--   finance_staff   — execution: payroll prep, statutory review, finance ops.
--                     Prepares but cannot approve/lock/export.
--   finance_manager — approval: statutory config approve/activate, payroll
--                     approve/lock/export, NIS verification.
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.roles (name, label, description, is_system) values
  ('finance_staff',   'Finance Staff',   'Finance execution: payroll prep, statutory review, finance ops.', true),
  ('finance_manager', 'Finance Manager', 'Finance approval: statutory config, payroll approve/lock/export.', true)
on conflict (name) do update
  set label = excluded.label,
      description = excluded.description,
      is_system = excluded.is_system;

-- Flat roles: seed the complete employee baseline into each. The finance
-- module keys are granted in 20260802000006 (after the keys exist).
insert into public.role_permissions (role_name, permission)
  select 'finance_staff', permission
  from public.role_permissions
  where role_name = 'employee'
on conflict do nothing;

insert into public.role_permissions (role_name, permission)
  select 'finance_manager', permission
  from public.role_permissions
  where role_name = 'employee'
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
