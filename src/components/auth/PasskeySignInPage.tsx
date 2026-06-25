/**
 * src/components/auth/PasskeySignInPage.tsx
 *
 * Phase 2 login redesign — passwordless passkey sign-in panel.
 * Shown when the user clicks "Sign in with a passkey" on the credentials panel.
 * This is a SEPARATE screen from the passkey-as-2nd-factor flow in TwoFactorVerifyPanel.
 *
 * @see docs/ARCHITECTURE.md §Authentication
 * @see docs/CODING_STANDARDS.md
 */

import { useState } from 'preact/hooks';
import { startAuthentication } from '@simplewebauthn/browser';
import { PasskeyArtwork } from './PasskeyArtwork';
import { webauthnAuthOptions, webauthnAuthVerify, type LoginResult } from './api';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onSuccess:       (result: LoginResult) => void;
  onPasswordClick: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PasskeySignInPage({ onSuccess, onPasswordClick }: Props) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleContinue() {
    setError(null);
    setLoading(true);
    try {
      // 1. Fetch authentication options (no username = fully discoverable credential)
      const optRes = await webauthnAuthOptions();
      if (!optRes.success || !optRes.options) {
        setError(optRes.message ?? 'Could not start passkey login.');
        return;
      }

      // 2. Browser ceremony
      const assertion = await startAuthentication({
        optionsJSON: optRes.options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });

      // 3. Verify with server
      const result = await webauthnAuthVerify({
        flow:     'passwordless',
        response: assertion as unknown as Record<string, unknown>,
      });

      if (!result.success) {
        setError(result.message ?? 'Passkey verification failed.');
        return;
      }

      onSuccess(result);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        // User cancelled the browser dialog — stay on the page, no error
        return;
      }
      setError(err instanceof Error ? err.message : 'Passkey sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="passkey-prompt">
      <div class="passkey-prompt-eyebrow">Passwordless Sign-In</div>

      <div class="passkey-prompt-art-wrap">
        <PasskeyArtwork />
      </div>

      <h2 class="passkey-prompt-title">Sign in with a passkey</h2>

      <p class="passkey-prompt-body">
        Use your device&rsquo;s fingerprint, face unlock, device PIN, or security
        key to sign in securely &mdash; no password to type.
      </p>

      {error && (
        <div class="login-error-banner" style="margin:0;">
          {error}
        </div>
      )}

      <div class="passkey-prompt-actions">
        <button
          type="button"
          class="passkey-prompt-btn passkey-prompt-btn-primary"
          disabled={loading}
          onClick={() => void handleContinue()}
        >
          {loading ? (
            <>
              <i class="fas fa-spinner fa-spin" style="margin-right:8px" />
              Verifying&hellip;
            </>
          ) : (
            <>
              <i class="fas fa-fingerprint" style="margin-right:8px" />
              Continue with passkey
            </>
          )}
        </button>

        <button
          type="button"
          class="passkey-prompt-btn passkey-prompt-btn-secondary"
          disabled={loading}
          onClick={onPasswordClick}
        >
          <i class="fas fa-arrow-left" style="margin-right:8px" /> Use password instead
        </button>
      </div>
    </div>
  );
}
