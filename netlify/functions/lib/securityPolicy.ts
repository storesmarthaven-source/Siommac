// lib/securityPolicy.ts — Consolidated account-security policy constants
//
// Single source of truth for all security-policy knobs.  Other modules
// (trustedDevices, stepUp, auth routes) MUST import from here rather than
// maintaining their own constants.
//
// Non-secret fields are surfaced to the UI via POST /api/auth/security/policy.
// Secret / server-only values (PEPPER, keys) are never exposed.

// ── Roles that MUST satisfy MFA before any session is issued ─────────────────

/** Roles for which 2FA is mandatory at login. */
export const REQUIRE_MFA_ROLES: readonly string[] = ['admin', 'manager'];

/** Returns true if a role requires 2FA. */
export function requiresMfa(role: string): boolean {
  return REQUIRE_MFA_ROLES.includes(role);
}

// ── Trusted-device policy ─────────────────────────────────────────────────────

/**
 * Whether trusted-device bypass is enabled globally.
 * Overridable via TRUSTED_DEVICES_ENABLED=false env var.
 */
export const trustedDevicesEnabled: boolean =
  process.env.TRUSTED_DEVICES_ENABLED !== 'false';

/** TTL in days per role — how long a trusted-device bypass remains valid. */
export const trustedDeviceTtlByRole: Readonly<Record<string, number>> = {
  superadmin: 7,
  admin:      14,
  manager:    14,
  employee:   30,
};

/** Resolve the TTL for a role (falls back to 30 days for unknown roles). */
export function ttlDaysForRole(role: string): number {
  return trustedDeviceTtlByRole[role] ?? 30;
}

/** True unless the role is ineligible (currently all roles eligible when enabled). */
export function shouldOfferTrustedDevice(_role: string): boolean {
  return trustedDevicesEnabled;
}

// ── Passkey policy ────────────────────────────────────────────────────────────

/**
 * When true, a passkey alone (no password) counts as a full session for roles
 * where it is the enrolled factor (passwordless flow).
 */
export const allowPasswordlessPasskey: boolean =
  process.env.ALLOW_PASSWORDLESS_PASSKEY !== 'false';

/**
 * When true, a passkey can serve as the second factor in a password + passkey
 * ceremony.  Disabling this forces all 2FA through TOTP only.
 */
export const allowPasskeyAsSecondFactor: boolean =
  process.env.ALLOW_PASSKEY_SECOND_FACTOR !== 'false';

// ── Step-up policy ────────────────────────────────────────────────────────────

/**
 * How long (in minutes) a step-up verification remains valid before the user
 * must re-authenticate for another high-risk action.
 * Default: 10 minutes.  Overridable via STEP_UP_MAX_AGE_MINUTES env var.
 */
export const stepUpMaxAgeMinutes: number =
  Number(process.env.STEP_UP_MAX_AGE_MINUTES ?? 10) || 10;

// ── Public policy shape (returned to authenticated clients) ───────────────────

export interface PublicSecurityPolicy {
  trustedDevicesEnabled:    boolean;
  trustedDeviceTtlByRole:   Readonly<Record<string, number>>;
  requireMfaRoles:          readonly string[];
  allowPasswordlessPasskey: boolean;
  allowPasskeyAsSecondFactor: boolean;
  stepUpMaxAgeMinutes:      number;
}

/** Non-secret policy fields safe to return to an authenticated client. */
export function getPublicPolicy(): PublicSecurityPolicy {
  return {
    trustedDevicesEnabled,
    trustedDeviceTtlByRole,
    requireMfaRoles:          REQUIRE_MFA_ROLES,
    allowPasswordlessPasskey,
    allowPasskeyAsSecondFactor,
    stepUpMaxAgeMinutes,
  };
}
