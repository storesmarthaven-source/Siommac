-- ============================================================================
-- Preserve pre-existing login behaviour as isMfaRequiredForRole becomes DB-driven.
--
-- Historically superadmin was NOT MFA-gated at login (static REQUIRE_MFA_ROLES =
-- {admin, manager}; superadmin excluded). The auth_security_policy row, however,
-- seeds require_mfa_for_super_admin = true. Now that lib/securityPolicy reads this
-- row, leaving it true would newly force superadmin through the 2FA step. Align the
-- untouched seed to the historical behaviour so wiring is a true no-op; a superadmin
-- can enable it deliberately later via POST /api/admin/security/policy/update.
--
-- Guarded on updated_by IS NULL so a deliberate prior policy change is never clobbered.
-- Operator-applied. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

update public.auth_security_policy
   set require_mfa_for_super_admin = false
 where id = 'default'
   and updated_by is null;
