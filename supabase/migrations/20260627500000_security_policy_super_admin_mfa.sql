-- ============================================================================
-- auth_security_policy: add require_mfa_for_super_admin
--
-- The MFA-mandatory decision (lib/securityPolicy.isMfaRequiredForRole) is now
-- policy-driven for ALL privileged roles. Superadmin was previously hard-required
-- in code; this adds the toggle (defaulting to true) so the policy controls it.
-- Idempotent.
-- ============================================================================

alter table public.auth_security_policy
  add column if not exists require_mfa_for_super_admin boolean not null default true;
