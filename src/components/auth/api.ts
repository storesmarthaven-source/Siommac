/**
 * src/components/auth/api.ts
 *
 * Auth API calls — all public (no JWT) except logout.
 * Uses the legacy action-dispatch path matching the vanilla `api()` convention.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { authPost, apiAction, apiPost } from '@lib/api';

// ── Response shapes ───────────────────────────────────────────────────────────

export interface LoginResult {
  success:           boolean;
  message?:          string;
  // Direct login
  token?:            string;
  refreshToken?:     string;
  userId?:           string | number;
  username?:         string;
  fullName?:         string;
  role?:             string;
  departmentId?:     string;
  position?:         string;
  department?:       string;
  colorScheme?:      string;
  layoutMode?:       string;
  companyName?:      string;
  companyLogoUrl?:   string;
  profileImage?:     string;
  rolePermissions?:  string[];
  permissionOverrides?: { user_id: string; permission: string; granted: boolean; set_by: string; set_at: string }[];
  sessionIdleTimeoutMs?: number;
  // 2FA branch
  requiresTwoFactor?: boolean;
  requiresSetup?:     boolean;
  preAuthToken?:      string;
  methods?:           string[]; // ['totp', 'webauthn']
  // Trusted device offer (B3a) — present when requiresTwoFactor is true
  trustedDeviceEligible?: boolean;
  trustedDevicePolicy?:   { enabled: boolean; maxDays: number };
  // TOTP setup
  qrCode?:            string;
  manualCode?:        string;
  // Backup codes
  backupCodes?:       string[];
  // Auth-method claims (present on successful full-session responses)
  amr?:               string[];
  authStrength?:      'password_only' | 'mfa' | 'passwordless_passkey';
}

// ── WebAuthn pre-auth response shapes ─────────────────────────────────────────

export interface WebAuthnOptionsResult {
  success: boolean;
  message?: string;
  options?: Record<string, unknown>;
}

export interface WebAuthnVerifyResult extends LoginResult {
  // WebAuthn verify for passwordless/second_factor returns the same full
  // session shape as a successful /login (buildSessionPayload output).
  // Fields are already declared in LoginResult above.
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

export async function loginApi(payload: {
  username: string;
  password: string;
}): Promise<LoginResult> {
  return authPost<LoginResult>('login', payload as unknown as Record<string, unknown>);
}

export async function verify2faApi(payload: {
  preAuthToken:   string;
  code:           string;
  rememberDevice?: boolean;
  deviceLabel?:    string;
}): Promise<LoginResult> {
  return authPost<LoginResult>('verify2fa', payload as unknown as Record<string, unknown>);
}

export async function setup2faApi(payload: {
  preAuthToken: string;
}): Promise<LoginResult> {
  return authPost<LoginResult>('setup2fa', payload as unknown as Record<string, unknown>);
}

export async function confirm2faSetupApi(payload: {
  preAuthToken: string;
  code:         string;
}): Promise<LoginResult> {
  return authPost<LoginResult>('confirm2faSetup', payload as unknown as Record<string, unknown>);
}

export async function logoutApi(payload: {
  userId?:  string | number;
  username: string;
}): Promise<void> {
  try {
    await apiAction('logout', payload as unknown as Record<string, unknown>);
  } catch { /* fire-and-forget */ }
}

// ── WebAuthn pre-auth (public, no JWT) ───────────────────────────────────────

/**
 * Fetch WebAuthn authentication options.
 * Pass username for second-factor (discoverable by username).
 * Omit username for passwordless (fully discoverable credential).
 */
export async function webauthnAuthOptions(username?: string): Promise<WebAuthnOptionsResult> {
  return authPost<WebAuthnOptionsResult>(
    'webauthn/auth/options',
    (username ? { username } : {}) as Record<string, unknown>,
  );
}

/**
 * Verify a WebAuthn assertion and exchange for a full session.
 * For flow='passwordless': no preAuthToken needed.
 * For flow='second_factor': pass the preAuthToken from the /login requiresTwoFactor response.
 * On success returns the same buildSessionPayload shape as /login.
 */
export async function webauthnAuthVerify(payload: {
  flow:            'passwordless' | 'second_factor';
  preAuthToken?:   string;
  response:        Record<string, unknown>;
  rememberDevice?: boolean;
  deviceLabel?:    string;
}): Promise<LoginResult> {
  return authPost<LoginResult>(
    'webauthn/auth/verify',
    payload as unknown as Record<string, unknown>,
  );
}

// ── WebAuthn post-login passkey setup (optional prompt) ───────────────────────
// The full session token exists but isn't in the session store yet, so these
// authenticate with an explicit bearer token via apiPost's `token` option.

/** Registration options for the post-login passkey prompt. */
export async function webauthnRegisterOptionsWithToken(token: string): Promise<WebAuthnOptionsResult> {
  return apiPost<WebAuthnOptionsResult>('webauthn/register/options', {}, { token, retryable: false });
}

/** Verify + persist the passkey from the post-login prompt. */
export async function webauthnRegisterVerifyWithToken(
  token: string,
  response: Record<string, unknown>,
): Promise<{ success: boolean; message?: string }> {
  return apiPost<{ success: boolean; message?: string }>('webauthn/register/verify', { response }, { token, retryable: false });
}

/** Dismiss the post-login passkey prompt (resets the 7-day cadence). */
export async function webauthnPromptDismissWithToken(token: string): Promise<{ success: boolean; message?: string }> {
  return apiPost<{ success: boolean; message?: string }>('webauthn/prompt/dismiss', {}, { token, retryable: false });
}

// ── WebAuthn pre-auth passkey registration (mandatory-MFA setup) ──────────────
// No session yet — the preAuthToken in the body authorises the call (public).

/** Pre-auth registration options (mandatory setup at login). */
export async function webauthnPreauthRegisterOptions(payload: { preAuthToken: string }): Promise<WebAuthnOptionsResult> {
  return authPost<WebAuthnOptionsResult>('webauthn/register/preauth/options', payload as unknown as Record<string, unknown>);
}

/** Pre-auth registration verify → issues a full session (same shape as /login). */
export async function webauthnPreauthRegisterVerify(payload: {
  preAuthToken: string;
  response: Record<string, unknown>;
  rememberDevice?: boolean;
  deviceLabel?: string;
}): Promise<LoginResult> {
  return authPost<LoginResult>('webauthn/register/preauth/verify', payload as unknown as Record<string, unknown>);
}
