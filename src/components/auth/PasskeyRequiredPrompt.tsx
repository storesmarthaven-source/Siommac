/**
 * src/components/auth/PasskeyRequiredPrompt.tsx
 *
 * Phase 3 — MANDATORY setup choice interstitial.
 * Shown when a login returns requiresSetup + reason === 'mandatory_mfa'.
 * The user must choose one path — there is no "Maybe later".
 *
 * Paths:
 *   [Create a passkey]          → webauthnPreauthRegister{Options,Verify}
 *                                  → onSessionReady(result) → _completeLogin
 *   [Set up authenticator app]  → onChooseTotp() → totp-setup state (existing panel)
 *
 * @see docs/ARCHITECTURE.md §Authentication
 * @see docs/CODING_STANDARDS.md
 */

import { useState } from 'preact/hooks';
import { startRegistration } from '@simplewebauthn/browser';
import {
  webauthnPreauthRegisterOptions,
  webauthnPreauthRegisterVerify,
  type LoginResult,
} from './api';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  preAuthToken:   string;
  setupMethods?:  string[];   // ['webauthn', 'totp'] — omitting a key hides that button
  onSessionReady: (result: LoginResult) => void;
  onChooseTotp:   () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PasskeyRequiredPrompt({
  preAuthToken,
  setupMethods,
  onSessionReady,
  onChooseTotp,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // If setupMethods is present, only show a button if the method is included.
  // Default (setupMethods absent) shows both buttons.
  const showPasskey = !setupMethods || setupMethods.includes('webauthn');
  const showTotp    = !setupMethods || setupMethods.includes('totp');

  async function handleCreatePasskey() {
    setError(null);
    setLoading(true);
    try {
      // 1. Pre-auth registration options
      const optRes = await webauthnPreauthRegisterOptions({ preAuthToken });
      if (!optRes.success || !optRes.options) {
        setError(optRes.message ?? 'Could not start passkey registration.');
        return;
      }

      // 2. Browser ceremony
      let regResponse: Awaited<ReturnType<typeof startRegistration>>;
      try {
        regResponse = await startRegistration({
          optionsJSON: optRes.options as unknown as Parameters<typeof startRegistration>[0]['optionsJSON'],
        });
      } catch (err: unknown) {
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'AbortError') {
          setError('Passkey creation was cancelled. Please try again.');
          return;
        }
        throw err;
      }

      // 3. Verify + exchange for full session
      const result = await webauthnPreauthRegisterVerify({
        preAuthToken,
        response: regResponse as unknown as Record<string, unknown>,
      });

      if (!result.success) {
        setError(result.message ?? 'Passkey registration failed.');
        return;
      }

      onSessionReady(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Passkey registration failed.');
    } finally {
      setLoading(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div class="tfa-passkey-panel">
      <div class="tfa-icon-row">
        <span class="tfa-shield-icon tfa-shield-warn">
          <i class="fas fa-shield-alt" />
        </span>
      </div>

      <h3 class="tfa-passkey-heading" style="font-size:1.1rem;font-weight:600;margin:0 0 6px;color:var(--text-primary,#1a2433);text-align:center;">
        Secure your account
      </h3>

      <p class="tfa-desc" style="text-align:center;margin-bottom:20px;">
        Your role requires a strong sign-in method before continuing.
      </p>

      {error && (
        <div class="login-error-banner" style="margin-bottom:12px;">
          {error}
        </div>
      )}

      {showPasskey && (
        <button
          type="button"
          class="login-cta-btn"
          disabled={loading}
          onClick={() => void handleCreatePasskey()}
          style="margin-bottom:10px;"
        >
          {loading ? (
            <>
              <i class="fas fa-spinner fa-spin" style="margin-right:6px" />
              Setting up…
            </>
          ) : (
            <>
              <i class="fas fa-fingerprint" style="margin-right:6px" />
              Create a passkey
            </>
          )}
        </button>
      )}

      {showTotp && (
        <button
          type="button"
          class="login-cta-btn login-cta-btn--secondary"
          disabled={loading}
          onClick={onChooseTotp}
        >
          <i class="fas fa-mobile-alt" style="margin-right:6px" />
          Set up authenticator app
        </button>
      )}
    </div>
  );
}
