/**
 * src/components/auth/TwoFactorVerifyPanel.tsx
 *
 * Phase 2 login redesign — TOTP verification panel.
 * Handles:
 *   - 6-digit TOTP code entry (via <OtpInput>)
 *   - Backup code fallback
 *   - Trust-this-device checkbox (gated on policy)
 *   - Passkey as 2nd factor (gated on methods)
 *   - Back → credentials
 *
 * @see docs/ARCHITECTURE.md §Authentication
 * @see docs/CODING_STANDARDS.md
 */

import { useState, useRef } from 'preact/hooks';
import { useMutation } from '@tanstack/preact-query';
import { startAuthentication } from '@simplewebauthn/browser';
import { verify2faApi, webauthnAuthOptions, webauthnAuthVerify, type LoginResult } from './api';
import { OtpInput, type OtpInputHandle } from './OtpInput';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  preAuthToken:          string;
  methods:               string[];
  username:              string;
  rememberMe:            boolean;
  trustedDeviceEligible: boolean;
  trustedDevicePolicy:   { enabled: boolean; maxDays: number } | null;
  onSuccess:             (result: LoginResult) => void;
  onBack:                () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TwoFactorVerifyPanel({
  preAuthToken,
  methods,
  username,
  trustedDeviceEligible,
  trustedDevicePolicy,
  onSuccess,
  onBack,
}: Props) {
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [backupMode,     setBackupMode]     = useState(false);
  const [backupCode,     setBackupCode]     = useState('');
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const otpRef = useRef<OtpInputHandle | null>(null);

  const showWebauthn    = methods.includes('webauthn');
  const showTrustDevice =
    trustedDeviceEligible &&
    (trustedDevicePolicy?.enabled ?? false) &&
    !backupMode;

  // ── verify mutation ────────────────────────────────────────────────────────

  const verifyMut = useMutation({
    mutationFn: verify2faApi,
    onSuccess: (result) => {
      if (!result.success) {
        setError(result.message ?? 'Invalid code. Try again.');
        otpRef.current?.clear();
        otpRef.current?.focusFirst();
        return;
      }
      onSuccess(result);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Verification failed.');
      otpRef.current?.clear();
      otpRef.current?.focusFirst();
    },
  });

  // ── submit TOTP code ───────────────────────────────────────────────────────

  function submitTfaCode(code: string, isBackupCode = false) {
    setError(null);
    const rd          = !isBackupCode && rememberDevice;
    const deviceLabel = rd ? (navigator.userAgent.slice(0, 80) || undefined) : undefined;
    verifyMut.mutate({ preAuthToken, code, rememberDevice: rd, deviceLabel });
  }

  // ── backup code submit ─────────────────────────────────────────────────────

  function handleBackupSubmit() {
    const code = backupCode.trim().toUpperCase().replace(/-/g, '');
    if (code.length < 6) {
      setError('Please enter your backup code.');
      return;
    }
    submitTfaCode(code, true);
  }

  // ── backup toggle ──────────────────────────────────────────────────────────

  function toggleBackup() {
    const next = !backupMode;
    setBackupMode(next);
    setError(null);
    if (next) {
      // Entering backup mode — reset trust device
      setRememberDevice(false);
      setBackupCode('');
    } else {
      // Returning to OTP mode — focus first digit
      setTimeout(() => otpRef.current?.focusFirst(), 50);
    }
  }

  // ── passkey 2nd factor ─────────────────────────────────────────────────────

  async function handlePasskeyTfa() {
    setError(null);
    setPasskeyLoading(true);
    try {
      const optRes = await webauthnAuthOptions(username || undefined);
      if (!optRes.success || !optRes.options) {
        setError(optRes.message ?? 'Could not start passkey verification.');
        return;
      }

      const assertion = await startAuthentication({
        optionsJSON: optRes.options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });

      const deviceLabel = rememberDevice ? (navigator.userAgent.slice(0, 80) || undefined) : undefined;
      const result = await webauthnAuthVerify({
        flow:          'second_factor',
        preAuthToken,
        response:      assertion as unknown as Record<string, unknown>,
        rememberDevice,
        deviceLabel,
      });

      if (!result.success) {
        setError(result.message ?? 'Passkey verification failed.');
        return;
      }

      onSuccess(result);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Passkey verification failed.');
    } finally {
      setPasskeyLoading(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  const isLoading = verifyMut.isPending;
  const maxDays   = trustedDevicePolicy?.maxDays ?? 30;

  return (
    <div id="twoFaPanel">
      <div class="tfa-icon-row">
        <span class="tfa-shield-icon">
          <i class="fas fa-shield-alt" />
        </span>
      </div>

      <p class="tfa-desc">
        Enter the 6-digit code from your authenticator app, or use a backup code.
      </p>

      {!backupMode && (
        <OtpInput
          id="tfaOtpRow"
          ref={otpRef}
          onComplete={(code) => submitTfaCode(code)}
          disabled={isLoading}
          autoFocusFirst
        />
      )}

      <div
        id="tfaErrorBanner"
        class="login-error-banner"
        style={error ? undefined : 'display:none;'}
      >
        {error ?? ''}
      </div>

      {!backupMode && (
        <button
          id="tfaSubmitBtn"
          type="button"
          class="login-cta-btn"
          style="margin-top:8px;"
          disabled={isLoading}
          onClick={() => {
            const code = otpRef.current?.getValue() ?? '';
            if (code.length === 6) {
              submitTfaCode(code);
            } else {
              setError('Please enter all 6 digits.');
            }
          }}
        >
          {isLoading ? (
            <><i class="fas fa-spinner fa-spin" /> Verifying…</>
          ) : (
            <><i class="fas fa-lock-open" /> Verify</>
          )}
        </button>
      )}

      {/* Passkey 2nd-factor link */}
      {showWebauthn && !backupMode && (
        <button
          id="passkeyTfaBtn"
          type="button"
          class="tfa-text-btn"
          style="display:flex;align-items:center;gap:6px;margin-top:10px;text-decoration:underline;text-underline-offset:2px;"
          disabled={passkeyLoading || isLoading}
          onClick={() => void handlePasskeyTfa()}
        >
          {passkeyLoading ? (
            <><i class="fas fa-spinner fa-spin" /> Verifying…</>
          ) : (
            <><i class="fas fa-fingerprint" /> Use a passkey instead</>
          )}
        </button>
      )}

      {/* Trust this device */}
      {showTrustDevice && (
        <div
          id="trustDeviceRow"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '14px',
            padding: '10px 12px',
            background: 'var(--bg-subtle,#f5f7fb)',
            borderRadius: '10px',
            border: '1px solid var(--border-color,#dde3ea)',
          }}
        >
          <input
            type="checkbox"
            id="trustDeviceCheckbox"
            checked={rememberDevice}
            style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent,#2563eb);flex-shrink:0;"
            onChange={(e) => setRememberDevice((e.target as HTMLInputElement).checked)}
          />
          <label
            for="trustDeviceCheckbox"
            style="font-size:0.82rem;color:var(--text-secondary,#536171);cursor:pointer;line-height:1.4;margin:0;"
          >
            <i class="fas fa-shield-halved" style="color:var(--accent,#2563eb);margin-right:4px;" />
            Trust this device for{' '}
            <strong>{maxDays} day{maxDays !== 1 ? 's' : ''}</strong>{' '}
            — skip 2FA on future sign-ins
          </label>
        </div>
      )}

      {/* Backup code toggle */}
      <div class="tfa-backup-row">
        <button
          type="button"
          id="tfaBackupToggle"
          class="tfa-text-btn"
          onClick={toggleBackup}
        >
          {backupMode ? 'Use authenticator code instead' : 'Use a backup code instead'}
        </button>
      </div>

      {backupMode && (
        <div id="tfaBackupSection" style="margin-top:8px;">
          <input
            id="tfaBackupCode"
            type="text"
            class="tfa-backup-input"
            placeholder="XXXXXXXX"
            maxLength={8}
            autoComplete="off"
            value={backupCode}
            onInput={(e) => setBackupCode((e.target as HTMLInputElement).value)}
          />
          <button
            id="tfaBackupSubmit"
            type="button"
            class="login-cta-btn"
            style="margin-top:6px;"
            disabled={isLoading}
            onClick={handleBackupSubmit}
          >
            {isLoading ? (
              <><i class="fas fa-spinner fa-spin" /> Verifying…</>
            ) : (
              <><i class="fas fa-key" /> Use Backup Code</>
            )}
          </button>
        </div>
      )}

      <div class="tfa-back-row">
        <button
          type="button"
          id="tfaBackBtn"
          class="tfa-text-btn"
          onClick={onBack}
        >
          <i class="fas fa-arrow-left" /> Back to login
        </button>
      </div>
    </div>
  );
}
