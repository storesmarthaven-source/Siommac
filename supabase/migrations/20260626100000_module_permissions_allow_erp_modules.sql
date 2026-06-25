-- ============================================================================
-- module_permissions: broaden the stale module CHECK to cover ERP modules
--
-- The original constraint (supabase/phase7-superadmin.sql) only allowed the
-- first-generation modules:
--   CHECK (module IN ('employees','payroll','live_map','attendance','dashboard'))
-- It predates HSE and the rest of the ERP, so seeding module visibility for
-- 'hse' (and 'hr'/'finance'/'operations') fails with
--   23514 module_permissions_module_check.
--
-- This widens the allow-list to the current module set. Idempotent and safe to
-- re-run. (The role CHECK was already dropped in phase12-roles.sql.)
-- ============================================================================

alter table public.module_permissions
  drop constraint if exists module_permissions_module_check;

alter table public.module_permissions
  add constraint module_permissions_module_check
  check (module in (
    'employees', 'payroll', 'live_map', 'attendance', 'dashboard',
    'hse', 'hr', 'finance', 'operations'
  ));
