/**
 * src/components/auth/TotpSetupPanel.tsx
 *
 * Phase 2 login redesign — first-time TOTP setup panel.
 * Steps:
 *   qr      — show QR code + manual entry code
 *   confirm — enter 6-digit code from authenticator to confirm
 *   backup  — display backup codes, copy, done
 *
 * @see docs/ARCHITECTURE.md §Authentication
 * @see docs/CODING_STANDARDS.md
 */

import { useState, useRef, useEffect } from 'preact/hooks';
import { useMutation } from '@tanstack/preact-query';
import { setup2faApi, confirm2faSetupApi, type LoginResult } from './api';
import { OtpInput, type OtpInputHandle } from './OtpInput';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  preAuthToken:   string;
  rememberMe:     boolean;
  setupMethods?:  string[];   // extension point for Phase 3 (webauthn mandatory setup)
  onSuccess:      (result: LoginResult) => void;
  onError:        (msg: string) => void;  // called if startSetup fails — go back to credentials
}

// ── Component ─────────────────────────────────────────────────────────────────

type SetupStep = 'qr' | 'confirm' | 'backup';

export function TotpSetupPanel({ preAuthToken, onSuccess, onError }: Props) {
  const [step,          setStep]          = useState<SetupStep>('qr');
  const [qrCode,        setQrCode]        = useState('');
  const [manualCode,    setManualCode]    = useState('');
  const [backupCodes,   setBackupCodes]   = useState<string[]>([]);
  const [error,         setError]         = useState<string | null>(null);
  const [copyLabel,     setCopyLabel]     = useState<'copy' | 'copied'>('copy');
  const [sessionResult, setSessionResult] = useState<LoginResult | null>(null);

  const setupOtpRef = useRef<OtpInputHandle | null>(null);

  // ── Start setup on mount ───────────────────────────────────────────────────

  const startSetupMut = useMutation({
    mutationFn: setup2faApi,
    onSuccess: (result) => {
      if (!result.success) {
        onError(result.message ?? 'Setup failed. Please log in again.');
        return;
      }
      const raw = result.manualCode ?? '';
      const formatted = raw.match(/.{1,4}/g)?.join(' ') ?? raw;
      setQrCode(result.qrCode ?? '');
      setManualCode(formatted);
      setStep('qr');
    },
    onError: (err: unknown) => {
      onError(err instanceof Error ? err.message : 'Setup failed. Please log in again.');
    },
  });

  useEffect(() => {
    startSetupMut.mutate({ preAuthToken });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Confirm setup ──────────────────────────────────────────────────────────

  const confirmSetupMut = useMutation({
    mutationFn: confirm2faSetupApi,
    onSuccess: (result) => {
      if (!result.success) {
        setError(result.message ?? 'Invalid code. Try again.');
        setupOtpRef.current?.clear();
        setupOtpRef.current?.focusFirst();
        return;
      }
      setBackupCodes(result.backupCodes ?? []);
      setSessionResult(result);
      setStep('backup');
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Confirmation failed.');
      setupOtpRef.current?.clear();
      setupOtpRef.current?.focusFirst();
    },
  });

  function handleQrNext() {
    setStep('confirm');
    setError(null);
    // Focus after DOM updates
    setTimeout(() => setupOtpRef.current?.focusFirst(), 50);
  }

  function submitSetupCode(code: string) {
    setError(null);
    confirmSetupMut.mutate({ preAuthToken, code });
  }

  function handleConfirmSubmit() {
    const code = setupOtpRef.current?.getValue() ?? '';
    if (code.length === 6) {
      submitSetupCode(code);
    } else {
      setError('Please enter all 6 digits.');
    }
  }

  async function handleCopyAll() {
    const text = backupCodes
      .map(c => `${c.slice(0, 4)}-${c.slice(4)}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyLabel('copied');
      setTimeout(() => setCopyLabel('copy'), 2500);
    } catch (_) { /* empty */ }
  }

  function handleDone() {
    if (sessionResult) onSuccess(sessionResult);
  }

  const confirmLoading = confirmSetupMut.isPending;

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div id="twoFaSetupPanel">

      {/* ── Step A: QR code ──────────────────────────────────────────────── */}
      <div id="setupStepQr" style={step === 'qr' ? undefined : 'display:none;'}>
        <div class="tfa-icon-row">
          <span class="tfa-shield-icon tfa-shield-warn">
            <i class="fas fa-mobile-alt" />
          </span>
        </div>
        <p class="tfa-desc">
          <strong>Two-Factor Authentication is required for your role.</strong>
          <br />
          Scan this QR code with Google Authenticator, Authy, or any TOTP app.
        </p>

        {startSetupMut.isPending && (
          <div style="text-align:center;padding:24px 0;color:var(--text-secondary,#536171);">
            <i class="fas fa-spinner fa-spin" style="font-size:1.5rem;" />
          </div>
        )}

        {!startSetupMut.isPending && qrCode && (
          <div id="setupQrWrapper" class="tfa-qr-wrapper">
            <img id="setupQrImg" src={qrCode} alt="QR Code" class="tfa-qr-img" />
          </div>
        )}

        {!startSetupMut.isPending && manualCode && (
          <>
            <p class="tfa-manual-label">Can't scan? Enter this code manually:</p>
            <div id="setupManualCode" class="tfa-manual-code">{manualCode}</div>
          </>
        )}

        <button
          id="setupQrNextBtn"
          type="button"
          class="login-cta-btn"
          style="margin-top:16px;"
          disabled={startSetupMut.isPending || !qrCode}
          onClick={handleQrNext}
        >
          <i class="fas fa-arrow-right" /> I've scanned it — Continue
        </button>
      </div>

      {/* ── Step B: Confirm with code ─────────────────────────────────────── */}
      <div id="setupStepConfirm" style={step === 'confirm' ? undefined : 'display:none;'}>
        <div class="tfa-icon-row">
          <span class="tfa-shield-icon">
            <i class="fas fa-shield-alt" />
          </span>
        </div>
        <p class="tfa-desc">
          Enter the 6-digit code from your authenticator app to confirm setup.
        </p>

        <OtpInput
          id="setupOtpRow"
          ref={setupOtpRef}
          onComplete={(code) => submitSetupCode(code)}
          disabled={confirmLoading}
          autoFocusFirst={step === 'confirm'}
        />

        <div
          id="setupErrorBanner"
          class="login-error-banner"
          style={error ? undefined : 'display:none;'}
        >
          {error ?? ''}
        </div>

        <button
          id="setupConfirmBtn"
          type="button"
          class="login-cta-btn"
          style="margin-top:8px;"
          disabled={confirmLoading}
          onClick={handleConfirmSubmit}
        >
          {confirmLoading ? (
            <><i class="fas fa-spinner fa-spin" /> Enabling…</>
          ) : (
            <><i class="fas fa-check-circle" /> Enable Two-Factor Auth</>
          )}
        </button>
      </div>

      {/* ── Step C: Backup codes ──────────────────────────────────────────── */}
      <div id="setupStepBackup" style={step === 'backup' ? undefined : 'display:none;'}>
        <div class="tfa-icon-row">
          <span class="tfa-shield-icon tfa-shield-ok">
            <i class="fas fa-check-circle" />
          </span>
        </div>
        <p class="tfa-desc">
          <strong>2FA enabled!</strong> Save these backup codes somewhere safe.
          <br />
          Each code can only be used <strong>once</strong>. You'll need them if you lose your phone.
        </p>

        <div id="setupBackupList" class="tfa-backup-list">
          {backupCodes.map((c, i) => (
            <code key={i}>{c.slice(0, 4)}-{c.slice(4)}</code>
          ))}
        </div>

        <button
          id="setupBackupCopy"
          type="button"
          class="tfa-text-btn"
          style="margin:8px auto;display:block;"
          onClick={() => void handleCopyAll()}
        >
          {copyLabel === 'copied' ? (
            <><i class="fas fa-check" /> Copied!</>
          ) : (
            <><i class="fas fa-copy" /> Copy all codes</>
          )}
        </button>

        <button
          id="setupDoneBtn"
          type="button"
          class="login-cta-btn"
          style="margin-top:8px;"
          onClick={handleDone}
        >
          <i class="fas fa-sign-in-alt" /> Continue to Dashboard
        </button>
      </div>

    </div>
  );
}
