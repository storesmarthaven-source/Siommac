/**
 * src/components/auth/PasswordLoginPanel.tsx
 *
 * Phase 2 login redesign — credentials form panel (username + password).
 * Controlled Preact component; replaces the static #loginForm HTML driven
 * imperatively by LoginPage.tsx.
 *
 * Renders a low-emphasis "Use a passkey" link below the submit button when
 * WebAuthn is available in the browser.
 *
 * @see docs/ARCHITECTURE.md §Authentication
 * @see docs/CODING_STANDARDS.md
 */

import { useState, useEffect } from 'preact/hooks';
import { useMutation } from '@tanstack/preact-query';
import { loginApi, type LoginResult } from './api';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Called on a successful /login response (including requiresTwoFactor/requiresSetup branches). */
  onSuccess:      (result: LoginResult, username: string, rememberMe: boolean) => void;
  onPasskeyClick: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PasswordLoginPanel({ onSuccess, onPasskeyClick }: Props) {
  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [uError,     setUError]     = useState('');
  const [pError,     setPError]     = useState('');

  const passkeySupported =
    typeof window !== 'undefined' && !!window.PublicKeyCredential;

  // Pre-fill username from localStorage on mount
  useEffect(() => {
    try {
      const remembered = localStorage.getItem('rememberedUser');
      if (remembered) {
        setUsername(remembered);
        setRememberMe(true);
      }
    } catch (_) {}
  }, []);

  const loginMut = useMutation({
    mutationFn: loginApi,
    onSuccess: (result) => {
      if (!result.success) {
        setError(result.message ?? 'Invalid username or password.');
        setPassword('');
        return;
      }
      onSuccess(result, username.trim(), rememberMe);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
    },
  });

  function handleSubmit(e: Event) {
    e.preventDefault();
    setError(null);
    setUError('');
    setPError('');

    let valid = true;
    if (!username.trim() || username.trim().length < 3) {
      setUError('Username must be at least 3 characters');
      valid = false;
    }
    if (!password) {
      setPError('Password is required');
      valid = false;
    }
    if (!valid) return;

    loginMut.mutate({ username: username.trim(), password });
  }

  const isLoading = loginMut.isPending;

  return (
    <>
      <form id="loginForm" noValidate onSubmit={handleSubmit}>

        <div class="login-input-group">
          <input
            type="text"
            id="username"
            placeholder="Employee ID / Username"
            autoComplete="username"
            required
            value={username}
            class={uError ? 'is-invalid' : undefined}
            onInput={(e) => {
              setUsername((e.target as HTMLInputElement).value);
              if (uError) setUError('');
            }}
          />
          <div class="login-invalid" id="usernameError" style={uError ? undefined : 'display:none;'}>
            {uError || 'Please enter a valid username'}
          </div>
        </div>

        <div class="login-input-group">
          <input
            type="password"
            id="password"
            placeholder="Password"
            autoComplete="current-password"
            required
            value={password}
            class={pError ? 'is-invalid' : undefined}
            onInput={(e) => {
              setPassword((e.target as HTMLInputElement).value);
              if (pError) setPError('');
            }}
          />
          <div class="login-invalid" id="passwordError" style={pError ? undefined : 'display:none;'}>
            {pError || 'Please enter your password'}
          </div>
        </div>

        <div class="login-options-row">
          <label class="login-remember">
            <input
              type="checkbox"
              id="rememberMe"
              checked={rememberMe}
              onChange={(e) => setRememberMe((e.target as HTMLInputElement).checked)}
            />
            <span id="rememberMeLabel">Remember me</span>
          </label>
        </div>

        <div
          id="loginErrorBanner"
          class="login-error-banner"
          style={error ? undefined : 'display:none;'}
        >
          {error ?? ''}
        </div>

        <button
          type="submit"
          id="loginBtn"
          class="login-cta-btn"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <i class="fas fa-spinner fa-spin" style="margin-right:6px" />
              <span id="loginButton">Signing in…</span>
            </>
          ) : (
            <>
              <i class="fas fa-sign-in-alt" style="margin-right:6px" />
              <span id="loginButton">Sign in to Dashboard</span>
            </>
          )}
        </button>

        <div class="login-security-note">
          <i class="fas fa-fingerprint" />
          <span><strong>Encrypted Access · SIOMAC Internal Systems</strong></span>
          <i class="fas fa-shield-alt" />
        </div>

      </form>

      {/* Passkey alternative — rendered outside the form so it doesn't submit */}
      {passkeySupported && (
        <>
          <div
            id="passkeyDivider"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              margin: '16px 0 12px',
              fontSize: '0.78rem',
              color: 'var(--text-secondary, #8896a4)',
            }}
          >
            <span style="flex:1;height:1px;background:var(--border-color,#dde3ea)" />
            <span>or</span>
            <span style="flex:1;height:1px;background:var(--border-color,#dde3ea)" />
          </div>
          <button
            id="passkeyLoginBtn"
            type="button"
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 16px',
              border: '1.5px solid var(--border-color,#dde3ea)',
              borderRadius: 'var(--radius-md,8px)',
              background: 'var(--card-bg,#fff)',
              color: 'var(--text-primary,#1a2433)',
              fontSize: '0.875rem',
              fontWeight: '500',
              cursor: 'pointer',
            }}
            onClick={onPasskeyClick}
          >
            <i class="fas fa-fingerprint" style="font-size:1rem;color:var(--accent,#2563eb)" />
            Sign in with a passkey
          </button>
        </>
      )}
    </>
  );
}
