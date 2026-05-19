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

import { authPost, apiAction } from '@lib/api';

// ── Response shapes ───────────────────────────────────────────────────────────

export interface LoginResult {
  success:           boolean;
  message?:          string;
  // Direct login
  token?:            string;
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
  // 2FA branch
  requiresTwoFactor?: boolean;
  requiresSetup?:     boolean;
  preAuthToken?:      string;
  // TOTP setup
  qrCode?:            string;
  manualCode?:        string;
  // Backup codes
  backupCodes?:       string[];
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

export async function loginApi(payload: {
  username: string;
  password: string;
}): Promise<LoginResult> {
  return authPost<LoginResult>('login', payload as unknown as Record<string, unknown>);
}

export async function verify2faApi(payload: {
  preAuthToken: string;
  code:         string;
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
