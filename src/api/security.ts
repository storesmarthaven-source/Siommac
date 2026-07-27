/**
 * src/api/security.ts
 *
 * TanStack Query hooks for the authenticated security self-service APIs.
 * All routes require a valid session JWT (handled by apiPost).
 *
 * TOTP endpoints — all POST /api/auth/2fa/*:
 *   /status               → current enrollment state
 *   /setup                → generate secret + QR code (pending, not yet enabled)
 *   /confirm              → verify first TOTP code → enable + return backup codes (once)
 *   /disable              → verify current code → disable (blocked for mandatory roles)
 *   /backup-codes/regenerate → verify current code → regenerate + return codes (once)
 *
 * WebAuthn / Passkey endpoints — all POST /api/webauthn/*:
 *   /register/options     → start credential registration ceremony
 *   /register/verify      → complete registration + persist credential
 *   /credentials/list     → list saved passkeys
 *   /credentials/rename   → rename a passkey
 *   /credentials/delete   → delete a passkey (last-factor guard)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { startRegistration } from '@simplewebauthn/browser';

// ── Response types ─────────────────────────────────────────────────────────────

export interface TotpStatusResponse {
  success:              boolean;
  enabled:              boolean;
  enrolledAt:           string | null;
  hasBackupCodes:       boolean;
  backupCodesRemaining: number;
  mandatory:            boolean;
}

export interface TotpSetupResponse {
  success:    boolean;
  qrDataUrl:  string;
  secret:     string;
  otpauthUrl: string;
}

export interface TotpConfirmResponse {
  success:     boolean;
  backupCodes: string[];   // shown once — never stored in plaintext
}

export interface TotpDisableResponse {
  success: boolean;
  code?:   'last_factor';
  message?: string;
}

export interface TotpRegenResponse {
  success:     boolean;
  backupCodes: string[];   // shown once
}

// ── WebAuthn / Passkey response types ─────────────────────────────────────────

export interface PasskeyCredential {
  id:           string;
  label:        string;
  deviceType:   string;
  backedUp:     boolean;
  createdAt:    string;
  lastUsedAt:   string | null;
  transports:   string[];
}

export interface PasskeyListResponse {
  success:     boolean;
  credentials: PasskeyCredential[];
}

export interface PasskeyRegisterOptionsResponse {
  success: boolean;
  options: Record<string, unknown>;
}

export interface PasskeyRegisterVerifyResponse {
  success:    boolean;
  credential: PasskeyCredential;
  message?:   string;
}

export interface PasskeyMutateResponse {
  success:  boolean;
  message?: string;
  code?:    string;
}

// ── Trusted device response types ─────────────────────────────────────────────

export interface TrustedDevice {
  id:           string;
  label:        string | null;
  browserName:  string | null;
  osName:       string | null;
  deviceType:   string | null;
  createdAt:    string;
  lastUsedAt:   string | null;
  trustedUntil: string;
  method:       string;
  currentDevice: boolean;
}

export interface TrustedDevicesListResponse {
  success: boolean;
  devices: TrustedDevice[];
}

export interface TrustedDeviceMutateResponse {
  success:  boolean;
  message?: string;
  code?:    string;
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const securityKeys = {
  all:           ['security']                           as const,
  totp:          () => ['security', 'totp']             as const,
  passkeys:      () => ['security', 'passkeys']         as const,
  trustedDevices: () => ['security', 'trusted-devices'] as const,
} as const;

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Fetch current TOTP enrollment state.
 * Enabled only when the user is authenticated (token is handled by apiPost/apiFetch).
 */
export function useTotpStatus(enabled = true) {
  return useQuery({
    queryKey: securityKeys.totp(),
    queryFn:  () => apiPost<TotpStatusResponse>('auth/2fa/status', {}),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Initiate TOTP setup — generates a new secret and returns QR code data.
 * Call before showing the setup modal.
 */
export function useStartTotpSetup() {
  return useMutation({
    mutationFn: () => apiPost<TotpSetupResponse>('auth/2fa/setup', {}),
  });
}

/**
 * Confirm TOTP setup by submitting the first valid 6-digit code.
 * On success: 2FA is enabled and backup codes are returned (once).
 */
export function useConfirmTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiPost<TotpConfirmResponse>('auth/2fa/confirm', { code }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: securityKeys.totp() });
    },
  });
}

/**
 * Disable TOTP by providing a current TOTP code or backup code.
 * Mandatory-role users will get a 400 with code: 'last_factor'.
 */
export function useDisableTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiPost<TotpDisableResponse>('auth/2fa/disable', { code }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: securityKeys.totp() });
    },
  });
}

/**
 * Regenerate backup codes — requires current TOTP code (or remaining backup code).
 * New codes returned once; old codes are invalidated immediately.
 */
export function useRegenerateBackupCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiPost<TotpRegenResponse>('auth/2fa/backup-codes/regenerate', { code }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: securityKeys.totp() });
    },
  });
}

// ── WebAuthn / Passkey hooks ──────────────────────────────────────────────────

/**
 * List all registered passkeys for the current user.
 */
export function usePasskeys(enabled = true) {
  return useQuery({
    queryKey: securityKeys.passkeys(),
    queryFn:  () => apiPost<PasskeyListResponse>('webauthn/credentials/list', {}),
    enabled,
    staleTime: 30_000,
    select: (data) => data.credentials,
  });
}

/**
 * Register a new passkey.
 * Runs the full ceremony: fetch options → startRegistration (browser) → verify.
 * Pass an optional label to name the passkey.
 */
export function useRegisterPasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (label?: string) => {
      // 1. Get registration options from server
      const optionsRes = await apiPost<PasskeyRegisterOptionsResponse>(
        'webauthn/register/options',
        {},
      );
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: server may omit options on unexpected error despite the type
      if (!optionsRes.success || !optionsRes.options) {
        throw new Error('Failed to get registration options');
      }

      // 2. Run browser ceremony
      const registrationResponse = await startRegistration({
        optionsJSON: optionsRes.options as unknown as Parameters<typeof startRegistration>[0]['optionsJSON'],
      });

      // 3. Verify with server
      return apiPost<PasskeyRegisterVerifyResponse>('webauthn/register/verify', {
        response: registrationResponse,
        ...(label ? { label } : {}),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: securityKeys.passkeys() });
      void qc.invalidateQueries({ queryKey: securityKeys.totp() });
    },
  });
}

/**
 * Rename a saved passkey.
 */
export function useRenamePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { credentialId: string; label: string }) =>
      apiPost<PasskeyMutateResponse>('webauthn/credentials/rename', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: securityKeys.passkeys() });
    },
  });
}

/**
 * Delete a saved passkey.
 * If this is the user's last strong factor, the server returns 400 with
 * code: 'last_factor'. Surface that message to the user — do not swallow it.
 */
export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (credentialId: string) =>
      apiPost<PasskeyMutateResponse>('webauthn/credentials/delete', { credentialId }),
    onSuccess: (data) => {
      if (data.success) {
        void qc.invalidateQueries({ queryKey: securityKeys.passkeys() });
        void qc.invalidateQueries({ queryKey: securityKeys.totp() });
      }
    },
  });
}

// ── Trusted devices hooks ─────────────────────────────────────────────────────

/**
 * List trusted devices for the current user.
 * The server marks the current request's device with currentDevice: true.
 */
export function useTrustedDevices(enabled = true) {
  return useQuery({
    queryKey: securityKeys.trustedDevices(),
    queryFn:  () => apiPost<TrustedDevicesListResponse>('auth/trusted-devices/list', {}),
    enabled,
    staleTime: 30_000,
    select: (data) => data.devices,
  });
}

/**
 * Revoke a single trusted device by ID.
 * Invalidates the trusted-devices list on success.
 */
export function useRevokeTrustedDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trustedDeviceId: string) =>
      apiPost<TrustedDeviceMutateResponse>('auth/trusted-devices/revoke', { trustedDeviceId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: securityKeys.trustedDevices() });
    },
  });
}

/**
 * Revoke ALL trusted devices for the current user and rotate the security stamp.
 * This forces re-verification of MFA on next login everywhere.
 */
export function useRevokeAllTrustedDevices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<TrustedDeviceMutateResponse>('auth/trusted-devices/revoke-all', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: securityKeys.trustedDevices() });
    },
  });
}

// ── Admin security response types ─────────────────────────────────────────────

export interface AdminUserSecurityStatusResponse {
  success:            boolean;
  totpEnabled:        boolean;
  passkeyCount:       number;
  trustedDeviceCount: number;
  mfaMandatory:       boolean;
  lastSeenAt:         string | null;
  message?:           string;
}

export interface AdminRevokeMutateResponse {
  success:  boolean;
  message?: string;
  code?:    string;
}

// ── Admin security query keys ─────────────────────────────────────────────────

export const adminSecurityKeys = {
  userStatus: (userId: string) => ['admin', 'security', 'user', userId] as const,
} as const;

// ── Admin hooks ───────────────────────────────────────────────────────────────

/** Fetch security posture for a given user (admin view). */
export function useAdminUserSecurityStatus(userId: string, enabled = true) {
  return useQuery({
    queryKey: adminSecurityKeys.userStatus(userId),
    queryFn:  () => apiPost<AdminUserSecurityStatusResponse>(
      'admin/security/users/status',
      { userId },
    ),
    enabled: enabled && !!userId,
    staleTime: 30_000,
  });
}

/** Revoke all passkeys for a given user (admin action — requires step-up, handled at call site). */
export function useAdminRevokeUserPasskeys() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiPost<AdminRevokeMutateResponse>(
        'admin/security/users/passkeys/revoke-all',
        { userId },
      ),
    onSuccess: (_data, userId) => {
      void qc.invalidateQueries({ queryKey: adminSecurityKeys.userStatus(userId) });
    },
  });
}

/** Revoke all trusted devices for a given user (admin action — requires step-up, handled at call site). */
export function useAdminRevokeUserTrustedDevices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiPost<AdminRevokeMutateResponse>(
        'admin/security/users/trusted-devices/revoke-all',
        { userId },
      ),
    onSuccess: (_data, userId) => {
      void qc.invalidateQueries({ queryKey: adminSecurityKeys.userStatus(userId) });
    },
  });
}

// ── Organisation security policy (superadmin editor) ──────────────────────────
//
// Read:   POST /api/auth/security/policy           (any authenticated user)
// Update: POST /api/admin/security/policy/update   (auth.security.manage_policy + step-up)
//
// NOTE: the backend update route is a v1 stub — it validates and returns
// { success:false, code:'not_implemented' } until a persistent settings store
// exists. SecurityPolicyTab handles that code/message gracefully.

/** Non-secret policy fields returned by the read route (mirrors getPublicPolicy). */
export interface PublicSecurityPolicy {
  trustedDevicesEnabled:      boolean;
  trustedDeviceTtlByRole:     Record<string, number>;
  requireMfaRoles:            string[];
  allowPasswordlessPasskey:   boolean;
  allowPasskeyAsSecondFactor: boolean;
  stepUpMaxAgeMinutes:        number;
}
export interface SecurityPolicyResponse { success: boolean; policy?: PublicSecurityPolicy; message?: string }

/** Flat form payload from SecurityPolicyTab; mapped to the backend's nested schema below. */
export interface SecurityPolicyUpdatePayload {
  trustedDevicesEnabled:       boolean;
  trustedDeviceDefaultDays:    number;
  trustedDeviceAdminDays:      number;
  trustedDeviceSuperAdminDays: number;
  requireMfaForSuperAdmin:     boolean;
  requireMfaForAdmin:          boolean;
  requireMfaForManager:        boolean;
  allowPasswordlessPasskey:    boolean;
  allowPasskeyAsSecondFactor:  boolean;
  stepUpMaxAgeMinutes:         number;
}
export interface SecurityPolicyUpdateResponse { success: boolean; code?: string; message?: string }

export function useSecurityPolicy(enabled = true) {
  return useQuery({
    queryKey: ['security', 'policy'] as const,
    queryFn:  () => apiPost<SecurityPolicyResponse>('auth/security/policy', {}),
    enabled,
    staleTime: 30_000,
  });
}

/** Update the org policy. Maps the flat form to the backend's nested schema. */
export function useUpdateSecurityPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: SecurityPolicyUpdatePayload) => {
      const requireMfaRoles = [
        ...(p.requireMfaForSuperAdmin ? ['superadmin'] : []),
        ...(p.requireMfaForAdmin      ? ['admin']      : []),
        ...(p.requireMfaForManager    ? ['manager']    : []),
      ];
      return apiPost<SecurityPolicyUpdateResponse>('admin/security/policy/update', {
        trustedDevicesEnabled:    p.trustedDevicesEnabled,
        trustedDeviceTtlByRole: {
          employee:   p.trustedDeviceDefaultDays,
          manager:    p.trustedDeviceAdminDays,
          admin:      p.trustedDeviceAdminDays,
          superadmin: p.trustedDeviceSuperAdminDays,
        },
        requireMfaRoles,
        allowPasswordlessPasskey:   p.allowPasswordlessPasskey,
        allowPasskeyAsSecondFactor: p.allowPasskeyAsSecondFactor,
        stepUpMaxAgeMinutes:        p.stepUpMaxAgeMinutes,
      }, { retryable: false });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['security', 'policy'] }); },
  });
}
