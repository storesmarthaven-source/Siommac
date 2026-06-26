-- ============================================================================
-- HR Onboarding — intake/trigger fields (v36 §10 "Worker & Trigger")
-- Adds the controlled-start metadata the Start Onboarding wizard collects.
-- Non-destructive; hr_onboarding_cases already has RLS + service_role grants.
-- Operator-applied. After applying, NOTIFY pgrst.
-- ============================================================================

alter table public.hr_onboarding_cases
  add column if not exists reason            text,
  add column if not exists priority          text,
  add column if not exists target_start_date date,
  add column if not exists launch_mode       text,
  add column if not exists case_owner        text;
