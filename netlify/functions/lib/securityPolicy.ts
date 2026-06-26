// lib/securityPolicy.ts — Consolidated account-security policy.
//
// The MFA-mandatory policy is DB-backed (auth_security_policy, one 'default' row),
// editable by superadmins via POST /api/admin/security/policy/update. Reads are
// cached briefly and fall back to the compile-time defaults below if the row is
// unreachable, so a DB outage NEVER breaks login or step-up. The remaining knobs
// (trusted-device TTLs, passkey flags, step-up window) are env-controlled.
//
// Non-secret fields are surfaced to the UI via POST /api/auth/security/policy.
// Secret / server-only values (PEPPER, keys) are never exposed.

import { sb } from './db';

// ── Roles that MUST satisfy MFA before any session is issued ─────────────────

/** Compile-time fallback for the MFA-mandatory roles (used only if the DB policy
 *  row is unreachable). Mirrors the historical static behaviour. */
export const REQUIRE_MFA_ROLES: readonly string[] = ['admin', 'manager'];

/** Returns true if a role is in the static fallback set. */
export function requiresMfa(role: string): boolean {
  return REQUIRE_MFA_ROLES.includes(role);
}

// ── DB-backed MFA policy (cached, with static fallback) ───────────────────────

interface MfaPolicy { admin: boolean; manager: boolean; superadmin: boolean }

/** Static fallback — derived from REQUIRE_MFA_ROLES so there's one source. */
const MFA_FALLBACK: MfaPolicy = {
  admin:      requiresMfa('admin'),
  manager:    requiresMfa('manager'),
  superadmin: requiresMfa('superadmin'),
};

let _mfaCache: { value: MfaPolicy; expiresAt: number } | null = null;
const MFA_CACHE_TTL_MS = 30_000;

/** Load the DB-backed MFA policy (cached ~30s; falls back to the static defaults
 *  on any error so a DB hiccup can never block login). */
export async function loadMfaPolicy(): Promise<MfaPolicy> {
  const now = Date.now();
  if (_mfaCache && _mfaCache.expiresAt > now) return _mfaCache.value;
  try {
    const { data, error } = await sb
      .from('auth_security_policy')
      .select('require_mfa_for_admin, require_mfa_for_manager, require_mfa_for_super_admin')
      .eq('id', 'default')
      .maybeSingle<{ require_mfa_for_admin: boolean; require_mfa_for_manager: boolean; require_mfa_for_super_admin: boolean }>();
    if (error || !data) throw error ?? new Error('auth_security_policy default row missing');
    const value: MfaPolicy = {
      admin:      data.require_mfa_for_admin,
      manager:    data.require_mfa_for_manager,
      superadmin: data.require_mfa_for_super_admin,
    };
    _mfaCache = { value, expiresAt: now + MFA_CACHE_TTL_MS };
    return value;
  } catch (e) {
    console.warn('[securityPolicy] loadMfaPolicy fell back to static defaults:', e instanceof Error ? e.message : e);
    return MFA_FALLBACK;
  }
}

/** Clear the cached MFA policy — call right after a policy update so the change
 *  takes effect on the next login without waiting out the TTL. */
export function invalidatePolicyCache(): void { _mfaCache = null; }

/**
 * Policy check used by the auth routes (login / 2FA setup). DB-backed via
 * loadMfaPolicy(); unknown roles never require MFA.
 */
export async function isMfaRequiredForRole(role: string): Promise<boolean> {
  const p = await loadMfaPolicy();
  if (role === 'admin')      return p.admin;
  if (role === 'manager')    return p.manager;
  if (role === 'superadmin') return p.superadmin;
  return false;
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

/** Non-secret policy fields safe to return to an authenticated client. The MFA
 *  roles reflect the live DB policy; the remaining knobs are env-controlled. */
export async function getPublicPolicy(): Promise<PublicSecurityPolicy> {
  const mfa = await loadMfaPolicy();
  const requireMfaRoles = (['admin', 'manager', 'superadmin'] as const).filter(r => mfa[r]);
  return {
    trustedDevicesEnabled,
    trustedDeviceTtlByRole,
    requireMfaRoles,
    allowPasswordlessPasskey,
    allowPasskeyAsSecondFactor,
    stepUpMaxAgeMinutes,
  };
}
