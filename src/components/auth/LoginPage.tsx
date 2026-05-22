/**
 * src/components/auth/LoginPage.tsx
 *
 * Headless controller — mounts into a hidden <div>, drives the existing
 * login/2FA HTML panels in app-shell.html via DOM writes and event listeners.
 *
 * Auth state machine:
 *   credentials → tfa-verify   (server: requiresTwoFactor)
 *   credentials → tfa-setup-qr (server: requiresSetup)
 *   tfa-setup-qr → tfa-setup-confirm
 *   tfa-setup-confirm → tfa-backup
 *   any success → calls props.onLoginSuccess(result)
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { h, Fragment } from 'preact';
import { useEffect, useRef, useCallback } from 'preact/hooks';
import { useMutation } from '@tanstack/preact-query';
import {
  loginApi,
  verify2faApi,
  setup2faApi,
  confirm2faSetupApi,
  type LoginResult,
} from './api';
import { otpValue, otpClear, wireOtpRow } from './OtpInput';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LoginPageProps {
  onLoginSuccess: (result: LoginResult) => void;
}

// ── Panel helpers (DOM only, no state) ───────────────────────────────────────

function showPanel(show: 'credentials' | 'tfa-verify' | 'tfa-setup') {
  const loginForm  = document.getElementById('loginForm');
  const tfaPanel   = document.getElementById('twoFaPanel');
  const setupPanel = document.getElementById('twoFaSetupPanel');
  if (loginForm)  loginForm.style.display  = show === 'credentials' ? '' : 'none';
  if (tfaPanel)   tfaPanel.style.display   = show === 'tfa-verify'  ? '' : 'none';
  if (setupPanel) setupPanel.style.display = show === 'tfa-setup'   ? '' : 'none';
}

function showSetupStep(step: 'qr' | 'confirm' | 'backup') {
  const qr      = document.getElementById('setupStepQr');
  const confirm = document.getElementById('setupStepConfirm');
  const backup  = document.getElementById('setupStepBackup');
  if (qr)      qr.style.display      = step === 'qr'      ? '' : 'none';
  if (confirm) confirm.style.display = step === 'confirm' ? '' : 'none';
  if (backup)  backup.style.display  = step === 'backup'  ? '' : 'none';
}

function setErrorBanner(id: string, msg: string | null) {
  const el = document.getElementById(id);
  if (!el) return;
  if (msg) { el.textContent = msg; el.style.display = 'flex'; }
  else     { el.style.display = 'none'; el.textContent = ''; }
}

function focusFirst(rowId: string) {
  const first = document.querySelector<HTMLElement>(`#${rowId} .tfa-otp-digit`);
  if (first) first.focus();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  // Persisted 2FA state (preAuthToken, rememberMe) — lives only in memory
  const tfaRef = useRef<{ preAuthToken: string | null; rememberMe: boolean }>({
    preAuthToken: null,
    rememberMe:   false,
  });

  // ── Button loading helpers ─────────────────────────────────────────────────

  function setLoginBtnLoading(loading: boolean) {
    const btn  = document.getElementById('loginBtn') as HTMLButtonElement | null;
    const span = document.getElementById('loginButton');
    if (!btn) return;
    btn.disabled = loading;
    if (span) span.innerHTML = loading
      ? '<i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>Signing in…'
      : '<i class="fas fa-sign-in-alt" style="margin-right:6px"></i>Sign in to Dashboard';
  }

  function setTfaBtnLoading(loading: boolean) {
    const btn = document.getElementById('tfaSubmitBtn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
      ? '<i class="fas fa-spinner fa-spin"></i> Verifying…'
      : '<i class="fas fa-lock-open"></i> Verify';
  }

  function setSetupBtnLoading(loading: boolean) {
    const btn = document.getElementById('setupConfirmBtn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
      ? '<i class="fas fa-spinner fa-spin"></i> Enabling…'
      : '<i class="fas fa-check-circle"></i> Enable Two-Factor Auth';
  }

  // ── login mutation ────────────────────────────────────────────────────────

  const loginMut = useMutation({
    mutationFn: loginApi,
    onMutate: () => setLoginBtnLoading(true),
    onSettled: () => setLoginBtnLoading(false),
    onSuccess: (result) => {
      if (!result.success) {
        const msg = result.message || 'Invalid username or password.';
        setErrorBanner('loginErrorBanner', msg);
        const uEl = document.getElementById('username') as HTMLInputElement | null;
        const pEl = document.getElementById('password') as HTMLInputElement | null;
        if (uEl) uEl.classList.add('is-invalid');
        if (pEl) { pEl.classList.add('is-invalid'); pEl.value = ''; pEl.focus(); }
        return;
      }

      if (result.requiresTwoFactor) {
        tfaRef.current.preAuthToken = result.preAuthToken ?? null;
        const remEl = document.getElementById('rememberMe') as HTMLInputElement | null;
        tfaRef.current.rememberMe   = remEl?.checked ?? false;
        // Show verify panel
        showPanel('tfa-verify');
        otpClear('tfaOtpRow');
        setErrorBanner('tfaErrorBanner', null);
        const bkSec = document.getElementById('tfaBackupSection');
        if (bkSec) bkSec.style.display = 'none';
        focusFirst('tfaOtpRow');
        return;
      }

      if (result.requiresSetup) {
        tfaRef.current.preAuthToken = result.preAuthToken ?? null;
        const remEl = document.getElementById('rememberMe') as HTMLInputElement | null;
        tfaRef.current.rememberMe   = remEl?.checked ?? false;
        startSetupMut.mutate({ preAuthToken: tfaRef.current.preAuthToken! });
        return;
      }

      // Direct login — no 2FA
      _completeLogin(result);
    },
  });

  // ── verify-2fa mutation ───────────────────────────────────────────────────

  const verifyMut = useMutation({
    mutationFn: verify2faApi,
    onMutate: () => setTfaBtnLoading(true),
    onSettled: () => setTfaBtnLoading(false),
    onSuccess: (result) => {
      if (!result.success) {
        setErrorBanner('tfaErrorBanner', result.message || 'Invalid code. Try again.');
        otpClear('tfaOtpRow');
        focusFirst('tfaOtpRow');
        return;
      }
      _completeLogin(result);
    },
  });

  // ── setup-2fa mutation (fetch QR) ─────────────────────────────────────────

  const startSetupMut = useMutation({
    mutationFn: setup2faApi,
    onSuccess: (result) => {
      if (!result.success) {
        setErrorBanner('loginErrorBanner', result.message || 'Setup failed. Please log in again.');
        showPanel('credentials');
        tfaRef.current = { preAuthToken: null, rememberMe: false };
        return;
      }
      // Populate QR panel
      const qrImg = document.getElementById('setupQrImg') as HTMLImageElement | null;
      if (qrImg) qrImg.src = result.qrCode || '';
      const manEl = document.getElementById('setupManualCode');
      if (manEl) {
        const raw = result.manualCode || '';
        manEl.textContent = raw.match(/.{1,4}/g)?.join(' ') || raw;
      }
      showPanel('tfa-setup');
      showSetupStep('qr');
    },
  });

  // ── confirm-setup mutation ────────────────────────────────────────────────

  const confirmSetupMut = useMutation({
    mutationFn: confirm2faSetupApi,
    onMutate: () => setSetupBtnLoading(true),
    onSettled: () => setSetupBtnLoading(false),
    onSuccess: (result) => {
      if (!result.success) {
        setErrorBanner('setupErrorBanner', result.message || 'Invalid code. Try again.');
        otpClear('setupOtpRow');
        focusFirst('setupOtpRow');
        return;
      }
      // Show backup codes
      _showBackupCodes(result.backupCodes || [], result);
    },
  });

  // ── Internal helpers ──────────────────────────────────────────────────────

  const _completeLogin = useCallback((result: LoginResult) => {
    // Store rememberMe preference
    const remEl = document.getElementById('rememberMe') as HTMLInputElement | null;
    const rememberMe = tfaRef.current.rememberMe || (remEl?.checked ?? false);
    if (rememberMe) {
      try { localStorage.setItem('rememberedUser', result.username ?? ''); } catch (_) {}
    } else {
      try { localStorage.removeItem('rememberedUser'); } catch (_) {}
    }

    // Reset 2FA memory
    tfaRef.current = { preAuthToken: null, rememberMe: false };

    onLoginSuccess(result);
  }, [onLoginSuccess]);

  const _showBackupCodes = useCallback((codes: string[], sessionResult: LoginResult) => {
    showPanel('tfa-setup');
    showSetupStep('backup');

    const list = document.getElementById('setupBackupList');
    if (list) {
      list.innerHTML = codes
        .map(c => `<code>${c.slice(0, 4)}-${c.slice(4)}</code>`)
        .join('');
    }

    const copyBtn = document.getElementById('setupBackupCopy');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard
          .writeText(codes.map(c => `${c.slice(0, 4)}-${c.slice(4)}`).join('\n'))
          .then(() => { copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!'; })
          .catch(() => {});
      };
    }

    const doneBtn = document.getElementById('setupDoneBtn');
    if (doneBtn) {
      doneBtn.onclick = () => _completeLogin(sessionResult);
    }
  }, [_completeLogin]);

  // Submit TOTP verify (also used for backup code path)
  const submitTfaCode = useCallback((code: string) => {
    const token = tfaRef.current.preAuthToken;
    if (!token) return;
    setErrorBanner('tfaErrorBanner', null);
    verifyMut.mutate({ preAuthToken: token, code });
  }, [verifyMut]);

  // Submit setup-confirm code
  const submitSetupConfirm = useCallback((code: string) => {
    const token = tfaRef.current.preAuthToken;
    if (!token) return;
    setErrorBanner('setupErrorBanner', null);
    confirmSetupMut.mutate({ preAuthToken: token, code });
  }, [confirmSetupMut]);

  // ── Wire DOM events ───────────────────────────────────────────────────────

  useEffect(() => {
    // ── Login form ──────────────────────────────────────────────────────────
    function handleLoginSubmit(e: Event) {
      e.preventDefault();
      const uEl = document.getElementById('username') as HTMLInputElement | null;
      const pEl = document.getElementById('password') as HTMLInputElement | null;

      const username = uEl?.value.trim() ?? '';
      const password = pEl?.value ?? '';

      // Clear previous errors
      uEl?.classList.remove('is-invalid');
      pEl?.classList.remove('is-invalid');
      setErrorBanner('loginErrorBanner', null);

      let valid = true;
      if (!username || username.length < 3) {
        uEl?.classList.add('is-invalid');
        const eEl = document.getElementById('usernameError');
        if (eEl) eEl.textContent = 'Username must be at least 3 characters';
        valid = false;
      }
      if (!password) {
        pEl?.classList.add('is-invalid');
        const eEl = document.getElementById('passwordError');
        if (eEl) eEl.textContent = 'Password is required';
        valid = false;
      }
      if (!valid) return;

      loginMut.mutate({ username, password });
    }

    const loginForm = document.getElementById('loginForm');
    loginForm?.addEventListener('submit', handleLoginSubmit);

    // ── TFA verify panel ────────────────────────────────────────────────────
    const unwireVerify = wireOtpRow('tfaOtpRow', () => {
      const code = otpValue('tfaOtpRow');
      if (code.length === 6) submitTfaCode(code);
    });

    function handleTfaSubmitBtn() {
      const code = otpValue('tfaOtpRow');
      if (code.length === 6) {
        submitTfaCode(code);
      } else {
        setErrorBanner('tfaErrorBanner', 'Please enter all 6 digits.');
      }
    }

    function handleTfaBackupToggle() {
      const sec = document.getElementById('tfaBackupSection');
      if (!sec) return;
      const hidden = sec.style.display === 'none' || sec.style.display === '';
      sec.style.display = hidden ? '' : 'none';
      if (hidden) {
        const inp = document.getElementById('tfaBackupCode');
        if (inp) (inp as HTMLInputElement).focus();
      }
    }

    function handleTfaBackupSubmit() {
      const inp = document.getElementById('tfaBackupCode') as HTMLInputElement | null;
      const code = (inp?.value.trim().toUpperCase().replace(/-/g, '') ?? '');
      if (code.length < 6) {
        setErrorBanner('tfaErrorBanner', 'Please enter your backup code.');
        return;
      }
      submitTfaCode(code);
    }

    function handleTfaBack() {
      showPanel('credentials');
      tfaRef.current = { preAuthToken: null, rememberMe: false };
    }

    const tfaSubmitBtn    = document.getElementById('tfaSubmitBtn');
    const tfaBackupToggle = document.getElementById('tfaBackupToggle');
    const tfaBackupSubmit = document.getElementById('tfaBackupSubmit');
    const tfaBackBtn      = document.getElementById('tfaBackBtn');

    tfaSubmitBtn?.addEventListener('click', handleTfaSubmitBtn);
    tfaBackupToggle?.addEventListener('click', handleTfaBackupToggle);
    tfaBackupSubmit?.addEventListener('click', handleTfaBackupSubmit);
    tfaBackBtn?.addEventListener('click', handleTfaBack);

    // ── TFA setup panel ─────────────────────────────────────────────────────
    function handleSetupQrNext() {
      showSetupStep('confirm');
      otpClear('setupOtpRow');
      setErrorBanner('setupErrorBanner', null);
      focusFirst('setupOtpRow');
    }

    const unwireSetupOtp = wireOtpRow('setupOtpRow', () => {
      const code = otpValue('setupOtpRow');
      if (code.length === 6) submitSetupConfirm(code);
    });

    function handleSetupConfirmBtn() {
      const code = otpValue('setupOtpRow');
      if (code.length === 6) {
        submitSetupConfirm(code);
      } else {
        setErrorBanner('setupErrorBanner', 'Please enter all 6 digits.');
      }
    }

    const setupQrNextBtn  = document.getElementById('setupQrNextBtn');
    const setupConfirmBtn = document.getElementById('setupConfirmBtn');

    setupQrNextBtn?.addEventListener('click', handleSetupQrNext);
    setupConfirmBtn?.addEventListener('click', handleSetupConfirmBtn);

    // ── Remembered username pre-fill ────────────────────────────────────────
    try {
      const remembered = localStorage.getItem('rememberedUser');
      if (remembered) {
        const uEl = document.getElementById('username') as HTMLInputElement | null;
        const remEl = document.getElementById('rememberMe') as HTMLInputElement | null;
        if (uEl)   uEl.value     = remembered;
        if (remEl) remEl.checked = true;
      }
    } catch (_) {}

    return () => {
      loginForm?.removeEventListener('submit', handleLoginSubmit);
      unwireVerify();
      unwireSetupOtp();
      tfaSubmitBtn?.removeEventListener('click', handleTfaSubmitBtn);
      tfaBackupToggle?.removeEventListener('click', handleTfaBackupToggle);
      tfaBackupSubmit?.removeEventListener('click', handleTfaBackupSubmit);
      tfaBackBtn?.removeEventListener('click', handleTfaBack);
      setupQrNextBtn?.removeEventListener('click', handleSetupQrNext);
      setupConfirmBtn?.removeEventListener('click', handleSetupConfirmBtn);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing to render — fully headless
  return h(Fragment, null);
}
