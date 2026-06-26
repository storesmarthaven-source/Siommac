-- ============================================================================
-- HR Employee Master — Create-wizard Access + Onboarding-requirement fields (v36)
--
-- The v36 Create wizard's Access/Role step (Permission Profile, Self-Service
-- Profile, Require MFA) and Onboarding Requirements step (the policy/training/
-- IT/badge/medical toggles) — recorded on app_users so the form persists them.
-- Enforcement (RBAC profile, MFA enrollment, handoff generation) is layered on
-- later by those subsystems; this stores the captured intent. Non-destructive.
-- Operator-applied. After applying, NOTIFY pgrst.
-- ============================================================================

alter table public.app_users
  add column if not exists permission_profile      text,
  add column if not exists self_service_profile    text,
  add column if not exists require_mfa             boolean default false,
  add column if not exists onboarding_requirements jsonb   default '{}'::jsonb;

comment on column public.app_users.permission_profile      is 'Access permission profile (HR Create wizard).';
comment on column public.app_users.self_service_profile    is 'Self-service profile (HR Create wizard).';
comment on column public.app_users.require_mfa             is 'Captured intent to require MFA/passkey enrollment (HR Create wizard).';
comment on column public.app_users.onboarding_requirements is 'Captured onboarding requirement toggles (HR Create wizard).';
