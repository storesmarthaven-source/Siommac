-- ============================================================================
-- HR Onboarding — add probation_days to hr_onboarding_packages (Phase 4.1)
-- ============================================================================
-- Adds an optional probation_days integer to hr_onboarding_packages so that
-- launching an onboarding case can automatically compute and persist the
-- worker's probation_end_date (= target_start_date + probation_days) on the
-- app_users row. NULL means "no probation period for this package" (e.g.
-- contractor packages where probation doesn't apply).
-- Default values below match common HR practice (90 days ≈ 3 months):
--   employee-type packages → 90 days
--   contractor_worker      → NULL (no statutory probation)
-- These are UPDATE-on-conflict safe because they only run when the value is
-- still NULL (idempotent: re-running is harmless after apply).
-- Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

alter table public.hr_onboarding_packages
  add column if not exists probation_days int null
    check (probation_days is null or probation_days > 0);

comment on column public.hr_onboarding_packages.probation_days is
  'When set, launching a case with this package persists '
  'probation_end_date = target_start_date + probation_days on app_users. '
  'NULL means the package carries no probation period (e.g. contractors).';

-- ── seed defaults (idempotent) ────────────────────────────────────────────────
-- Employee-type packages: 90-day probation by default.
update public.hr_onboarding_packages
   set probation_days = 90
 where package_key in ('standard_employee', 'safety_critical_employee', 'supervisor_manager', 'office_admin')
   and probation_days is null;

-- contractor_worker: no probation (NULL — already the column default; explicit
-- for clarity and idempotency).
update public.hr_onboarding_packages
   set probation_days = null
 where package_key = 'contractor_worker';

-- After applying:  NOTIFY pgrst, 'reload schema';
