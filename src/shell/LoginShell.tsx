/**
 * src/shell/LoginShell.tsx
 *
 * Phase 2b — fully Preact-controlled login flow (replaces the headless
 * LoginPage.tsx controller + static panels). A small state machine composes the
 * self-contained auth panels:
 *
 *   credentials      → PasswordLoginPanel        (username/password + passkey)
 *   tfa-verify       → TwoFactorVerifyPanel      (TOTP / backup / passkey 2FA)
 *   tfa-setup        → TotpSetupPanel            (mandatory TOTP enrolment)
 *   passkey-required → PasskeyRequiredPrompt     (mandatory MFA: passkey or TOTP)
 *   passkey-prompt   → PasskeySetupPrompt        (optional post-login passkey)
 *
 * Each panel owns its own API calls; this shell only routes the LoginResult and
 * applies the final session via window.AttendanceSystem._completeLogin (the same
 * integration point the old controller used).
 *
 * @see docs/ARCHITECTURE.md §Authentication
 * @see docs/CODING_STANDARDS.md
 */

import { useState, useCallback } from 'preact/hooks';
import { startAuthentication } from '@simplewebauthn/browser';
import { PasswordLoginPanel } from '@components/auth/PasswordLoginPanel';
import { TwoFactorVerifyPanel } from '@components/auth/TwoFactorVerifyPanel';
import { TotpSetupPanel } from '@components/auth/TotpSetupPanel';
import { PasskeyRequiredPrompt } from '@components/auth/PasskeyRequiredPrompt';
import { PasskeySetupPrompt } from '@components/auth/PasskeySetupPrompt';
import { webauthnAuthOptions, webauthnAuthVerify, type LoginResult } from '@components/auth/api';

type Phase = 'credentials' | 'tfa-verify' | 'tfa-setup' | 'passkey-required' | 'passkey-prompt';

interface FlowCtx {
  preAuthToken:          string;
  methods:               string[];
  setupMethods:          string[];
  username:              string;
  rememberMe:            boolean;
  trustedDeviceEligible: boolean;
  trustedDevicePolicy:   { enabled: boolean; maxDays: number } | null;
  pendingResult:         LoginResult | null;
}

const EMPTY_CTX: FlowCtx = {
  preAuthToken: '', methods: [], setupMethods: [], username: '', rememberMe: false,
  trustedDeviceEligible: false, trustedDevicePolicy: null, pendingResult: null,
};

const webauthnSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential;

export default function LoginShell() {
  const [phase, setPhase] = useState<Phase>('credentials');
  const [ctx, setCtx]     = useState<FlowCtx>(EMPTY_CTX);
  const [banner, setBanner] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // ── Apply the final session (same integration point as the old controller) ──
  const complete = useCallback((result: LoginResult, username: string, rememberMe: boolean) => {
    try {
      if (rememberMe) localStorage.setItem('rememberedUser', username || (result.username ?? ''));
      else            localStorage.removeItem('rememberedUser');
    } catch { /* ignore storage errors */ }
    const sys = (window as unknown as Record<string, { _completeLogin?: (r: LoginResult) => void }>)['AttendanceSystem'];
    sys?._completeLogin?.(result);
    // Reset for the next sign-in (e.g. after logout → remount).
    setPhase('credentials');
    setCtx(EMPTY_CTX);
  }, []);

  // ── Route a success result: optional passkey prompt, else complete ──────────
  const routeComplete = useCallback((result: LoginResult, username: string, rememberMe: boolean) => {
    if (result.nextStep === 'passkey_prompt' && result.token && webauthnSupported()) {
      setCtx(c => ({ ...c, username, rememberMe, pendingResult: result }));
      setPhase('passkey-prompt');
      return;
    }
    complete(result, username, rememberMe);
  }, [complete]);

  // ── Credentials → next phase ────────────────────────────────────────────────
  const onCredentials = useCallback((result: LoginResult, username: string, rememberMe: boolean) => {
    setBanner(null);
    if (result.requiresTwoFactor) {
      setCtx({
        ...EMPTY_CTX, username, rememberMe,
        preAuthToken: result.preAuthToken ?? '',
        methods: result.methods ?? [],
        trustedDeviceEligible: result.trustedDeviceEligible ?? false,
        trustedDevicePolicy: result.trustedDevicePolicy ?? null,
      });
      setPhase('tfa-verify');
      return;
    }
    if (result.requiresSetup) {
      const setupMethods = result.setupMethods ?? [];
      setCtx({ ...EMPTY_CTX, username, rememberMe, preAuthToken: result.preAuthToken ?? '', setupMethods });
      setPhase(webauthnSupported() && setupMethods.includes('webauthn') ? 'passkey-required' : 'tfa-setup');
      return;
    }
    routeComplete(result, username, rememberMe);
  }, [routeComplete]);

  // ── Passwordless passkey sign-in (from the credentials panel) ───────────────
  const onPasskeyClick = useCallback(async () => {
    setBanner(null);
    setPasskeyBusy(true);
    try {
      const optRes = await webauthnAuthOptions();
      if (!optRes.success || !optRes.options) {
        setBanner(optRes.message ?? 'Could not start passkey sign-in.');
        return;
      }
      const assertion = await startAuthentication({
        optionsJSON: optRes.options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });
      const result = await webauthnAuthVerify({ flow: 'passwordless', response: assertion as unknown as Record<string, unknown> });
      if (!result.success) {
        setBanner(result.message ?? 'Passkey sign-in failed.');
        return;
      }
      routeComplete(result, result.username ?? '', false);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') return; // user cancelled
      setBanner(err instanceof Error ? err.message : 'Passkey sign-in failed.');
    } finally {
      setPasskeyBusy(false);
    }
  }, [routeComplete]);

  return (
    <div id="loginPage" class="login-container">
      <div class="login-split">

        {/* LEFT: Brand / Hero */}
        <div class="login-hero">
          <div class="login-hero-icon"><i class="fas fa-hard-hat" /></div>
          <h2 class="login-hero-title">Operations &amp;<br />Maintenance Excellence</h2>
          <p class="login-hero-desc">
            Real‑time workforce tracking, geofenced attendance, and operational intelligence for Siddim Integrated O&amp;M.
          </p>
          <div class="login-hero-stats">
            <span class="login-stat"><i class="fas fa-map-marker-alt" /> Geo-attendance</span>
            <span class="login-stat"><i class="fas fa-shield-alt" /> ISO 9001</span>
            <span class="login-stat"><i class="fas fa-chart-line" /> Live analytics</span>
          </div>
        </div>

        {/* RIGHT: Form side */}
        <div class="login-form-side">
          {phase !== 'passkey-prompt' && (
            <div class="login-brand-header">
              <img id="loginLogo" class="login-brand-logo" src="" alt="SIOMAC LTD." style="display:none;"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          )}

          <div class="login-form-body">
            {phase === 'credentials' && (
              <div class="login-form-title">
                <h3 id="loginTitle">Access Portal</h3>
                <p id="loginSubtitle">
                  Sign in to manage attendance, track project sites, handle leave requests, and access real-time workforce insights.
                </p>
              </div>
            )}

            {banner && <div class="login-error-banner" style={{ marginBottom: '12px' }}>{banner}</div>}
            {passkeyBusy && phase === 'credentials' && (
              <div class="login-error-banner" style={{ marginBottom: '12px', background: 'transparent', color: 'var(--text-secondary,#8896a4)' }}>
                <i class="fas fa-spinner fa-spin" style="margin-right:6px" /> Waiting for your passkey…
              </div>
            )}

            {phase === 'credentials' && (
              <PasswordLoginPanel onSuccess={onCredentials} onPasskeyClick={() => void onPasskeyClick()} />
            )}

            {phase === 'tfa-verify' && (
              <TwoFactorVerifyPanel
                preAuthToken={ctx.preAuthToken}
                methods={ctx.methods}
                username={ctx.username}
                rememberMe={ctx.rememberMe}
                trustedDeviceEligible={ctx.trustedDeviceEligible}
                trustedDevicePolicy={ctx.trustedDevicePolicy}
                onSuccess={(result) => routeComplete(result, ctx.username, ctx.rememberMe)}
                onBack={() => { setPhase('credentials'); setCtx(EMPTY_CTX); }}
              />
            )}

            {phase === 'tfa-setup' && (
              <TotpSetupPanel
                preAuthToken={ctx.preAuthToken}
                rememberMe={ctx.rememberMe}
                setupMethods={ctx.setupMethods}
                onSuccess={(result) => complete(result, ctx.username, ctx.rememberMe)}
                onError={(msg) => { setPhase('credentials'); setCtx(EMPTY_CTX); setBanner(msg); }}
              />
            )}

            {phase === 'passkey-required' && (
              <PasskeyRequiredPrompt
                preAuthToken={ctx.preAuthToken}
                setupMethods={ctx.setupMethods}
                onSessionReady={(result) => complete(result, ctx.username, ctx.rememberMe)}
                onChooseTotp={() => setPhase('tfa-setup')}
              />
            )}

            {phase === 'passkey-prompt' && ctx.pendingResult && (
              <PasskeySetupPrompt
                result={ctx.pendingResult}
                onDone={() => complete(ctx.pendingResult!, ctx.username, ctx.rememberMe)}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
