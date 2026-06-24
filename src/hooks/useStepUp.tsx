/**
 * src/hooks/useStepUp.tsx
 *
 * Step-up authentication — prompts the user to re-verify their identity
 * before a sensitive action is allowed.
 *
 * Exports:
 *   StepUpProvider  — mounts once in AppShell, hosts the dialog
 *   useStepUp()     — returns { ensureStepUp }; call it anywhere inside the tree
 *   withStepUp()    — helper to auto-retry an apiPost call after step-up
 */

import { type VNode, createContext }      from 'preact';
import { useContext, useRef, useState, useCallback } from 'preact/hooks';
import { apiPost }                        from '@lib/api';
import { useSessionStore }                from '@store/session';
import { startAuthentication }            from '@simplewebauthn/browser';
import { toast }                          from '@store';
import { Modal }                          from '@components/shared';
import { Spinner }                        from '@components/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepUpOptions {
  success:       boolean;
  totpAvailable: boolean;
  webauthn:      Record<string, unknown> | null;
}

interface StepUpVerifyResponse {
  success: boolean;
  token?:  string;
  message?: string;
}

// ── Context ───────────────────────────────────────────────────────────────────

type ResolveFn = (verified: boolean) => void;

interface StepUpCtx {
  ensureStepUp: () => Promise<boolean>;
}

const StepUpContext = createContext<StepUpCtx | null>(null);

// ── Provider + Dialog ─────────────────────────────────────────────────────────

export function StepUpProvider({ children }: { children: VNode | VNode[] }): VNode {
  const [open, setOpen]           = useState(false);
  const [options, setOptions]     = useState<StepUpOptions | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [totpCode, setTotpCode]   = useState('');
  const resolveRef                = useRef<ResolveFn | null>(null);

  const ensureStepUp = useCallback((): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setTotpCode('');
      setError(null);
      setOptions(null);
      setOpen(true);

      // Fetch available methods
      apiPost<StepUpOptions>('auth/step-up/options', {}).then((res) => {
        if (res.success) {
          setOptions(res);
        } else {
          setError('Could not load verification options. Please try again.');
        }
      }).catch(() => {
        setError('Network error loading verification options.');
      });
    });
  }, []);

  const handleResolve = useCallback((ok: boolean) => {
    setOpen(false);
    setOptions(null);
    setTotpCode('');
    setError(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }, []);

  const applyToken = useCallback((token: string) => {
    const s = useSessionStore.getState();
    s.refreshTokens(token, s.refreshToken ?? '', s.expiresAt ?? Date.now() + 15 * 60 * 1000);
  }, []);

  const handleTotpVerify = useCallback(async () => {
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setError('Enter a 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await apiPost<StepUpVerifyResponse>('auth/step-up/verify', {
      method: 'totp',
      code:   totpCode.trim(),
    });
    setLoading(false);
    if (res.success && res.token) {
      applyToken(res.token);
      handleResolve(true);
    } else {
      setError(res.message ?? 'Invalid code. Please try again.');
    }
  }, [totpCode, applyToken, handleResolve]);

  const handleWebAuthn = useCallback(async () => {
    if (!options?.webauthn) return;
    setLoading(true);
    setError(null);
    try {
      const authResponse = await startAuthentication({
        optionsJSON: options.webauthn as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });
      const res = await apiPost<StepUpVerifyResponse>('auth/step-up/verify', {
        method:   'webauthn',
        response: authResponse as unknown as Record<string, unknown>,
      });
      if (res.success && res.token) {
        applyToken(res.token);
        handleResolve(true);
      } else {
        setError(res.message ?? 'Passkey verification failed. Try again.');
      }
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        setError(null); // user cancelled — don't show error
      } else {
        setError(err instanceof Error ? err.message : 'Passkey verification failed.');
      }
    } finally {
      setLoading(false);
    }
  }, [options, applyToken, handleResolve]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && options?.totpAvailable) {
      void handleTotpVerify();
    }
  }, [handleTotpVerify, options]);

  const optionsLoading = open && !options && !error;

  const footer = (
    <>
      <button
        type="button"
        onClick={() => handleResolve(false)}
        disabled={loading}
        style={{
          padding: '8px 20px', background: '#f3f4f6', color: '#374151',
          border: '1px solid #d1d5db', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '14px', fontWeight: '500',
        }}
      >
        Cancel
      </button>
      {options?.totpAvailable && (
        <button
          type="button"
          onClick={() => void handleTotpVerify()}
          disabled={loading || !/^\d{6}$/.test(totpCode.trim())}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 20px', background: loading ? '#9ca3af' : 'var(--siomac-navy, #1e3a5f)',
            color: '#fff', border: 'none', borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500',
            minWidth: '90px', justifyContent: 'center',
          }}
        >
          {loading ? <Spinner size={14} color="#fff" label="Verifying…" /> : 'Verify'}
        </button>
      )}
    </>
  );

  return (
    <StepUpContext.Provider value={{ ensureStepUp }}>
      {children}
      <Modal
        open={open}
        onClose={loading ? () => {} : () => handleResolve(false)}
        closeOnBackdrop={!loading}
        closeOnEscape={!loading}
        size="sm"
        footer={footer}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%',
              background: 'rgba(30,58,95,0.1)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <i class="fas fa-shield-halved" style={{ fontSize: '18px', color: 'var(--siomac-navy, #1e3a5f)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary, #111)' }}>
                Confirm it's you
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary, #6b7280)', marginTop: '2px' }}>
                This action requires a fresh verification.
              </div>
            </div>
          </div>

          {/* Loading options */}
          {optionsLoading && (
            <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-secondary)' }}>
              <i class="fas fa-spinner fa-spin" style={{ marginRight: 8 }} />
              Loading verification options…
            </div>
          )}

          {/* Error loading options */}
          {error && !options && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b', fontSize: '13px' }}>
              <i class="fas fa-circle-exclamation" style={{ marginRight: 6 }} />{error}
            </div>
          )}

          {/* TOTP input */}
          {options?.totpAvailable && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #111)' }}>
                <i class="fas fa-mobile-screen-button" style={{ marginRight: 6, color: 'var(--siomac-navy, #1e3a5f)' }} />
                Authenticator code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={totpCode}
                onInput={(e) => setTotpCode((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
                onKeyDown={handleKeyDown}
                placeholder="000000"
                disabled={loading}
                style={{
                  padding: '9px 12px', border: '1px solid var(--border, #d1d5db)',
                  borderRadius: '6px', fontSize: '20px', letterSpacing: '4px',
                  textAlign: 'center', width: '100%', boxSizing: 'border-box',
                  fontFamily: 'monospace', outline: 'none',
                  background: loading ? '#f9fafb' : '#fff',
                }}
                autoFocus
              />
              <div style={{ fontSize: '12px', color: 'var(--text-secondary, #6b7280)' }}>
                Enter the 6-digit code from your authenticator app.
              </div>
            </div>
          )}

          {/* OR divider + passkey */}
          {options?.totpAvailable && options?.webauthn && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--border, #e5e7eb)' }} />
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #6b7280)', flexShrink: 0 }}>or</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--border, #e5e7eb)' }} />
            </div>
          )}

          {options?.webauthn && (
            <button
              type="button"
              onClick={() => void handleWebAuthn()}
              disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '9px 16px', border: '1.5px solid var(--border, #d1d5db)',
                borderRadius: '6px', background: loading ? '#f9fafb' : '#fff',
                cursor: loading ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 500,
                color: 'var(--text-primary, #111)',
              }}
            >
              <i class="fas fa-fingerprint" style={{ fontSize: '16px', color: 'var(--siomac-navy, #1e3a5f)' }} />
              Use a passkey
            </button>
          )}

          {/* Passkey-only (no TOTP) */}
          {options && !options.totpAvailable && !options.webauthn && (
            <div style={{ padding: '10px 14px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '6px', color: '#92400e', fontSize: '13px' }}>
              <i class="fas fa-circle-info" style={{ marginRight: 6 }} />
              No verification method available. Please set up an authenticator app or passkey in Security settings.
            </div>
          )}

          {/* Verify error */}
          {error && options && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b', fontSize: '13px' }}>
              <i class="fas fa-circle-exclamation" style={{ marginRight: 6 }} />{error}
            </div>
          )}
        </div>
      </Modal>
    </StepUpContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useStepUp(): StepUpCtx {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp must be used inside <StepUpProvider>');
  return ctx;
}

// ── withStepUp helper ─────────────────────────────────────────────────────────

/**
 * Wraps an async function so that if the response has code:'step_up_required',
 * it opens the step-up dialog, and retries once on success.
 *
 * Usage:
 *   const wrapped = withStepUp(ensureStepUp, () => apiPost(...));
 *   const result  = await wrapped();
 */
export function withStepUp<T extends { success: boolean; code?: string }>(
  ensureStepUp: () => Promise<boolean>,
  fn: () => Promise<T>,
): () => Promise<T> {
  return async (): Promise<T> => {
    const res = await fn();
    if (!res.success && res.code === 'step_up_required') {
      const verified = await ensureStepUp();
      if (!verified) return res; // user cancelled — return the original response
      return fn();               // retry once with fresh token
    }
    return res;
  };
}
