/**
 * src/api/security.ts
 *
 * TanStack Query hooks for the authenticated TOTP self-service API.
 * All routes require a valid session JWT (handled by apiPost).
 *
 * Backend endpoints — all POST /api/auth/2fa/*:
 *   /status               → current enrollment state
 *   /setup                → generate secret + QR code (pending, not yet enabled)
 *   /confirm              → verify first TOTP code → enable + return backup codes (once)
 *   /disable              → verify current code → disable (blocked for mandatory roles)
 *   /backup-codes/regenerate → verify current code → regenerate + return codes (once)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

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

// ── Query keys ────────────────────────────────────────────────────────────────

export const securityKeys = {
  all:    ['security']                   as const,
  totp:   () => ['security', 'totp']    as const,
} as const;

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Fetch current TOTP enrollment state.
 * Enabled only when the user is authenticated (token is handled by apiPost/apiFetch).
 */
export function useTotpStatus(enabled = true) {
  return useQuery({
    queryKey: securityKeys.totp(),
    queryFn:  () => apiPost<TotpStatusResponse>('/api/auth/2fa/status', {}),
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
    mutationFn: () => apiPost<TotpSetupResponse>('/api/auth/2fa/setup', {}),
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
      apiPost<TotpConfirmResponse>('/api/auth/2fa/confirm', { code }),
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
      apiPost<TotpDisableResponse>('/api/auth/2fa/disable', { code }),
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
      apiPost<TotpRegenResponse>('/api/auth/2fa/backup-codes/regenerate', { code }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: securityKeys.totp() });
    },
  });
}
