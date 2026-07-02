/**
 * src/components/auth/PasskeySetupPrompt.tsx
 *
 * Phase 3 — OPTIONAL post-login passkey-setup interstitial.
 * Shown ONLY at sign-in, after any 2FA step, when a full session is returned
 * with nextStep === 'passkey_prompt' (the user has no passkey registered and the
 * 7-day prompt cadence allows it). Never appears mid-session — `/refresh` does
 * not emit the flag.
 *
 * The session store is NOT yet populated at this point — we hold result.token
 * explicitly and use the *WithToken fetchers to authenticate calls.
 *
 * Layout follows the approved "Introducing Passkeys" reference (centered card,
 * illustration, primary "Create a passkey" + secondary "Maybe later"), reworded
 * for Siomac and themed with brand tokens.
 *
 * @see docs/ARCHITECTURE.md §Authentication
 * @see docs/CODING_STANDARDS.md
 */

import { useState } from 'preact/hooks';
import { startRegistration } from '@simplewebauthn/browser';
import { PasskeyArtwork } from './PasskeyArtwork';
import {
  webauthnRegisterOptionsWithToken,
  webauthnRegisterVerifyWithToken,
  webauthnPromptDismissWithToken,
  type LoginResult,
} from './api';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  result: LoginResult;
  onDone: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PasskeySetupPrompt({ result, onDone }: Props) {
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const token = result.token ?? '';

  async function handleCreate() {
    setError(null);
    setLoading(true);
    try {
      // 1. Fetch registration options (explicit bearer token, store not yet set)
      const optRes = await webauthnRegisterOptionsWithToken(token);
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
          // User cancelled — stay on the prompt with a soft message
          setError('Passkey creation was cancelled. You can try again or skip for now.');
          return;
        }
        throw err;
      }

      // 3. Verify with server
      const verifyRes = await webauthnRegisterVerifyWithToken(
        token,
        regResponse as unknown as Record<string, unknown>,
      );

      if (!verifyRes.success) {
        setError(verifyRes.message ?? 'Passkey registration failed.');
        return;
      }

      // 4. Brief confirmation, then hand off
      setSucceeded(true);
      setTimeout(() => onDone(), 1400);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Passkey registration failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMaybeLater() {
    setLoading(true);
    try {
      // Fire-and-forget — reset the 7-day cadence; ignore errors
      await webauthnPromptDismissWithToken(token).catch(() => {/* ignore */});
    } finally {
      setLoading(false);
      onDone();
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────

  if (succeeded) {
    return (
      <div class="passkey-prompt">
        <div class="passkey-prompt-art-wrap">
          <span class="passkey-prompt-success-icon">
            <i class="fas fa-check-circle" />
          </span>
        </div>
        <h2 class="passkey-prompt-title">You're all set</h2>
        <p class="passkey-prompt-body">
          Your passkey is ready. Next time, sign in with your fingerprint,
          face unlock, or device PIN.
        </p>
      </div>
    );
  }

  // ── Main prompt ────────────────────────────────────────────────────────────

  return (
    <div class="passkey-prompt">
      <div class="passkey-prompt-eyebrow">Introducing Passkeys</div>

      <div class="passkey-prompt-art-wrap">
        <PasskeyArtwork />
      </div>

      <h2 class="passkey-prompt-title">Let&rsquo;s simplify your next sign-in</h2>

      <p class="passkey-prompt-body">
        Create a passkey to sign in with your fingerprint, face, or device PIN.
        Passkeys are more secure than passwords &mdash; and you can still use your
        password to access Siomac whenever you need to.
      </p>

      <p class="passkey-prompt-body passkey-prompt-hint">
        Select <span class="passkey-prompt-strong">Create a passkey</span>, then
        follow the prompt from your browser or device.
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
          onClick={() => void handleCreate()}
        >
          {loading ? (
            <>
              <i class="fas fa-spinner fa-spin" style="margin-right:8px" />
              Setting up&hellip;
            </>
          ) : (
            <>
              <i class="fas fa-fingerprint" style="margin-right:8px" />
              Create a passkey
            </>
          )}
        </button>

        <button
          type="button"
          class="passkey-prompt-btn passkey-prompt-btn-secondary"
          disabled={loading}
          onClick={() => void handleMaybeLater()}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
