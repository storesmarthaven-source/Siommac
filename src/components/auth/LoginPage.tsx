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
 * WebAuthn entry points (B2b):
 *   credentials: "Sign in with a passkey" → passwordless flow
 *   tfa-verify:  "Use a passkey instead"  → second_factor flow (gated on methods includes 'webauthn')
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { h, Fragment } from 'preact';
import { useEffect, useRef, useCallback } from 'preact/hooks';
import { useMutation } from '@tanstack/preact-query';
import { startAuthentication } from '@simplewebauthn/browser';
import {
  loginApi,
  verify2faApi,
  setup2faApi,
  confirm2faSetupApi,
  webauthnAuthOptions,
  webauthnAuthVerify,
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

/** Whether WebAuthn is available in this browser. */
function webauthnSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

// ── Passkey button injection helpers ─────────────────────────────────────────

const PASSKEY_BTN_ID = 'passkeyLoginBtn';
const PASSKEY_TFA_BTN_ID = 'passkeyTfaBtn';

function injectPasskeyLoginButton(onClick: () => void): () => void {
  if (!webauthnSupported()) return () => {};

  const loginForm = document.getElementById('loginForm');
  if (!loginForm) return () => {};

  // Avoid double-injection
  if (document.getElementById(PASSKEY_BTN_ID)) {
    const existing = document.getElementById(PASSKEY_BTN_ID);
    if (existing) {
      existing.onclick = onClick;
    }
    return () => {};
  }

  // Divider
  const divider = document.createElement('div');
  divider.id = 'passkeyDivider';
  divider.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:10px',
    'margin:16px 0 12px',
    'font-size:0.78rem',
    'color:var(--text-secondary,#8896a4)',
  ].join(';');
  divider.innerHTML = '<span style="flex:1;height:1px;background:var(--border-color,#dde3ea)"></span>'
    + '<span>or</span>'
    + '<span style="flex:1;height:1px;background:var(--border-color,#dde3ea)"></span>';

  // Button
  const btn = document.createElement('button');
  btn.id = PASSKEY_BTN_ID;
  btn.type = 'button';
  btn.style.cssText = [
    'width:100%',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'gap:8px',
    'padding:10px 16px',
    'border:1.5px solid var(--border-color,#dde3ea)',
    'border-radius:var(--radius-md,8px)',
    'background:var(--card-bg,#fff)',
    'color:var(--text-primary,#1a2433)',
    'font-size:0.875rem',
    'font-weight:500',
    'cursor:pointer',
    'transition:border-color 0.15s,box-shadow 0.15s',
  ].join(';');
  btn.innerHTML = '<i class="fas fa-fingerprint" style="font-size:1rem;color:var(--accent,#2563eb)"></i>'
    + ' Sign in with a passkey';
  btn.onmouseenter = () => { btn.style.borderColor = 'var(--accent,#2563eb)'; };
  btn.onmouseleave = () => { btn.style.borderColor = 'var(--border-color,#dde3ea)'; };
  btn.onclick = onClick;

  loginForm.appendChild(divider);
  loginForm.appendChild(btn);

  return () => {
    divider.remove();
    btn.remove();
  };
}

function injectPasskeyTfaButton(onClick: () => void): () => void {
  if (!webauthnSupported()) return () => {};

  const tfaPanel = document.getElementById('twoFaPanel');
  if (!tfaPanel) return () => {};
  if (document.getElementById(PASSKEY_TFA_BTN_ID)) {
    const existing = document.getElementById(PASSKEY_TFA_BTN_ID);
    if (existing) existing.onclick = onClick;
    return () => {};
  }

  const btn = document.createElement('button');
  btn.id = PASSKEY_TFA_BTN_ID;
  btn.type = 'button';
  btn.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:6px',
    'margin-top:10px',
    'background:none',
    'border:none',
    'color:var(--accent,#2563eb)',
    'font-size:0.82rem',
    'cursor:pointer',
    'padding:4px 0',
    'text-decoration:underline',
    'text-underline-offset:2px',
  ].join(';');
  btn.innerHTML = '<i class="fas fa-fingerprint"></i> Use a passkey instead';
  btn.onclick = onClick;

  // Insert after the tfaSubmitBtn (find its parent)
  const submitBtn = document.getElementById('tfaSubmitBtn');
  if (submitBtn?.parentElement) {
    submitBtn.parentElement.insertBefore(btn, submitBtn.nextSibling);
  } else {
    tfaPanel.appendChild(btn);
  }

  return () => { btn.remove(); };
}

// ── Trust-this-device checkbox injection ──────────────────────────────────────

const TRUST_CHECKBOX_ID = 'trustDeviceCheckbox';
const TRUST_ROW_ID      = 'trustDeviceRow';

/**
 * Inject a "Trust this device for N days" checkbox below the TFA submit button.
 * Only shown when trustedDeviceEligible && trustedDevicePolicy.enabled.
 * Returns: [cleanup, setVisible, readChecked]
 */
function injectTrustDeviceRow(
  maxDays:  number,
  onChange: (checked: boolean) => void,
): () => void {
  const tfaPanel = document.getElementById('twoFaPanel');
  if (!tfaPanel) return () => {};
  if (document.getElementById(TRUST_ROW_ID)) {
    return () => {};
  }

  const row = document.createElement('div');
  row.id = TRUST_ROW_ID;
  row.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'margin-top:14px',
    'padding:10px 12px',
    'background:var(--bg-subtle,#f5f7fb)',
    'border-radius:10px',
    'border:1px solid var(--border-color,#dde3ea)',
  ].join(';');

  const cb = document.createElement('input');
  cb.type    = 'checkbox';
  cb.id      = TRUST_CHECKBOX_ID;
  cb.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:var(--accent,#2563eb);flex-shrink:0';
  cb.onchange = () => onChange(cb.checked);

  const lbl = document.createElement('label');
  lbl.htmlFor = TRUST_CHECKBOX_ID;
  lbl.style.cssText = 'font-size:0.82rem;color:var(--text-secondary,#536171);cursor:pointer;line-height:1.4;margin:0';
  lbl.innerHTML = `<i class="fas fa-shield-check" style="color:var(--accent,#2563eb);margin-right:4px"></i>`
    + `Trust this device for <strong>${maxDays} day${maxDays !== 1 ? 's' : ''}</strong> — skip 2FA on future sign-ins`;

  row.appendChild(cb);
  row.appendChild(lbl);

  // Insert at bottom of tfaPanel
  tfaPanel.appendChild(row);

  return () => { row.remove(); };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  // B3b: ref holding the "inject trust row" callback so loginMut.onSuccess can call it
  // The callback is set by the useEffect after the panel DOM is ready.
  const injectTrustRowRef = useRef<(() => void) | null>(null);

  // Persisted 2FA state (preAuthToken, rememberMe, methods) — lives only in memory
  const tfaRef = useRef<{
    preAuthToken:          string | null;
    rememberMe:            boolean;
    methods:               string[];
    username:              string;
    // B3b: trusted device offer fields captured from /login response
    trustedDeviceEligible: boolean;
    trustedDevicePolicy:   { enabled: boolean; maxDays: number } | null;
    // B3b: current value of the "trust this device" checkbox
    rememberDevice:        boolean;
  }>({
    preAuthToken:          null,
    rememberMe:            false,
    methods:               [],
    username:              '',
    trustedDeviceEligible: false,
    trustedDevicePolicy:   null,
    rememberDevice:        false,
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

  function setPasskeyBtnLoading(id: string, loading: boolean) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn.dataset['originalHtml'] = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying…';
    } else if (btn.dataset['originalHtml']) {
      btn.innerHTML = btn.dataset['originalHtml'];
      delete btn.dataset['originalHtml'];
    }
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
        tfaRef.current.preAuthToken          = result.preAuthToken ?? null;
        tfaRef.current.methods               = result.methods ?? [];
        tfaRef.current.username              = (document.getElementById('username') as HTMLInputElement | null)?.value.trim() ?? '';
        const remEl = document.getElementById('rememberMe') as HTMLInputElement | null;
        tfaRef.current.rememberMe            = remEl?.checked ?? false;
        // B3b: capture trusted device policy from login response
        tfaRef.current.trustedDeviceEligible = result.trustedDeviceEligible ?? false;
        tfaRef.current.trustedDevicePolicy   = result.trustedDevicePolicy ?? null;
        tfaRef.current.rememberDevice        = false;
        // Show verify panel
        showPanel('tfa-verify');
        otpClear('tfaOtpRow');
        setErrorBanner('tfaErrorBanner', null);
        const bkSec = document.getElementById('tfaBackupSection');
        if (bkSec) bkSec.style.display = 'none';
        // B3b: inject trust-device row if eligible
        injectTrustRowRef.current?.();
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
        tfaRef.current = {
          preAuthToken:          null,
          rememberMe:            false,
          methods:               [],
          username:              '',
          trustedDeviceEligible: false,
          trustedDevicePolicy:   null,
          rememberDevice:        false,
        };
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

    // Reset 2FA memory (including B3b trusted device fields)
    tfaRef.current = {
      preAuthToken:          null,
      rememberMe:            false,
      methods:               [],
      username:              '',
      trustedDeviceEligible: false,
      trustedDevicePolicy:   null,
      rememberDevice:        false,
    };

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
  // rememberDevice is only honoured server-side for 6-digit TOTP codes (not backup codes)
  const submitTfaCode = useCallback((code: string, isBackupCode = false) => {
    const token = tfaRef.current.preAuthToken;
    if (!token) return;
    setErrorBanner('tfaErrorBanner', null);
    const rememberDevice = !isBackupCode && tfaRef.current.rememberDevice;
    const deviceLabel    = rememberDevice
      ? (navigator.userAgent.slice(0, 80) || undefined)
      : undefined;
    verifyMut.mutate({ preAuthToken: token, code, rememberDevice, deviceLabel });
  }, [verifyMut]);

  // Submit setup-confirm code
  const submitSetupConfirm = useCallback((code: string) => {
    const token = tfaRef.current.preAuthToken;
    if (!token) return;
    setErrorBanner('setupErrorBanner', null);
    confirmSetupMut.mutate({ preAuthToken: token, code });
  }, [confirmSetupMut]);

  // ── WebAuthn: passwordless login (credentials panel) ──────────────────────

  const handlePasskeyLogin = useCallback(async () => {
    setErrorBanner('loginErrorBanner', null);
    setPasskeyBtnLoading(PASSKEY_BTN_ID, true);
    try {
      // 1. Get authentication options (no username = fully discoverable)
      const optRes = await webauthnAuthOptions();
      if (!optRes.success || !optRes.options) {
        setErrorBanner('loginErrorBanner', optRes.message || 'Could not start passkey login.');
        return;
      }

      // 2. Browser ceremony
      const assertion = await startAuthentication({
        optionsJSON: optRes.options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });

      // 3. Verify with server — returns full session payload
      const result = await webauthnAuthVerify({
        flow:     'passwordless',
        response: assertion as unknown as Record<string, unknown>,
      });

      if (!result.success) {
        setErrorBanner('loginErrorBanner', result.message || 'Passkey verification failed.');
        return;
      }

      _completeLogin(result);
    } catch (err: unknown) {
      // User cancelled the browser dialog — show a soft, non-alarming message
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        // User dismissed — do nothing (stay on the page)
        return;
      }
      const msg = err instanceof Error ? err.message : 'Passkey sign-in failed.';
      setErrorBanner('loginErrorBanner', msg);
    } finally {
      setPasskeyBtnLoading(PASSKEY_BTN_ID, false);
    }
  }, [_completeLogin]);

  // ── WebAuthn: second-factor during TOTP panel ─────────────────────────────

  const handlePasskeyTfa = useCallback(async () => {
    const token    = tfaRef.current.preAuthToken;
    const username = tfaRef.current.username;
    if (!token) return;

    setErrorBanner('tfaErrorBanner', null);
    setPasskeyBtnLoading(PASSKEY_TFA_BTN_ID, true);
    try {
      // 1. Get authentication options — hint with username so the correct cred is returned
      const optRes = await webauthnAuthOptions(username || undefined);
      if (!optRes.success || !optRes.options) {
        setErrorBanner('tfaErrorBanner', optRes.message || 'Could not start passkey verification.');
        return;
      }

      // 2. Browser ceremony
      const assertion = await startAuthentication({
        optionsJSON: optRes.options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });

      // 3. Verify — returns full session payload
      // Pass rememberDevice if the checkbox is checked (B3b)
      const rememberDevice = tfaRef.current.rememberDevice;
      const deviceLabel    = rememberDevice
        ? (navigator.userAgent.slice(0, 80) || undefined)
        : undefined;
      const result = await webauthnAuthVerify({
        flow:           'second_factor',
        preAuthToken:   token,
        response:       assertion as unknown as Record<string, unknown>,
        rememberDevice,
        deviceLabel,
      });

      if (!result.success) {
        setErrorBanner('tfaErrorBanner', result.message || 'Passkey verification failed.');
        return;
      }

      _completeLogin(result);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        return;
      }
      const msg = err instanceof Error ? err.message : 'Passkey verification failed.';
      setErrorBanner('tfaErrorBanner', msg);
    } finally {
      setPasskeyBtnLoading(PASSKEY_TFA_BTN_ID, false);
    }
  }, []);

  // ── Wire DOM events ───────────────────────────────────────────────────────

  useEffect(() => {
    // Reset to credentials panel on every mount (handles logout → remount case)
    showPanel('credentials');
    showSetupStep('qr');

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

    // ── Inject passkey login button ─────────────────────────────────────────
    const removePasskeyLoginBtn = injectPasskeyLoginButton(handlePasskeyLogin);

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
      // B3b: hide trust-device row when backup section is showing (backup codes must not create a trust)
      const trustRow = document.getElementById(TRUST_ROW_ID);
      if (trustRow) trustRow.style.display = hidden ? 'none' : 'flex';
    }

    function handleTfaBackupSubmit() {
      const inp = document.getElementById('tfaBackupCode') as HTMLInputElement | null;
      const code = (inp?.value.trim().toUpperCase().replace(/-/g, '') ?? '');
      if (code.length < 6) {
        setErrorBanner('tfaErrorBanner', 'Please enter your backup code.');
        return;
      }
      // isBackupCode=true suppresses the rememberDevice flag (server also enforces this)
      submitTfaCode(code, true);
    }

    function handleTfaBack() {
      showPanel('credentials');
      tfaRef.current = {
        preAuthToken:          null,
        rememberMe:            false,
        methods:               [],
        username:              '',
        trustedDeviceEligible: false,
        trustedDevicePolicy:   null,
        rememberDevice:        false,
      };
    }

    const tfaSubmitBtn    = document.getElementById('tfaSubmitBtn');
    const tfaBackupToggle = document.getElementById('tfaBackupToggle');
    const tfaBackupSubmit = document.getElementById('tfaBackupSubmit');
    const tfaBackBtn      = document.getElementById('tfaBackBtn');

    tfaSubmitBtn?.addEventListener('click', handleTfaSubmitBtn);
    tfaBackupToggle?.addEventListener('click', handleTfaBackupToggle);
    tfaBackupSubmit?.addEventListener('click', handleTfaBackupSubmit);
    tfaBackBtn?.addEventListener('click', handleTfaBack);

    // ── Inject passkey TFA button (shown only when webauthn is in methods) ──
    // We inject it unconditionally; we gate visibility by checking methods at click time.
    // This avoids needing to know methods before the panel is shown.
    // The button is hidden until the tfa-verify panel is actually shown.
    const removePasskeyTfaBtn = injectPasskeyTfaButton(() => {
      // Only run if webauthn is in the methods list from the login response
      if (!tfaRef.current.methods.includes('webauthn')) return;
      void handlePasskeyTfa();
    });

    // ── Inject "Trust this device" checkbox (B3b) ───────────────────────────
    // We inject lazily when the tfa-verify panel is first shown (see loginMut.onSuccess).
    // We keep a reference to the cleanup fn so we can remove it on unmount.
    // The checkbox is hidden while the backup-code section is visible.
    let removeTrustRow: (() => void) | null = null;

    // Wire injectTrustRowRef so loginMut.onSuccess (outside useEffect) can trigger injection.
    injectTrustRowRef.current = () => {
      if (removeTrustRow) {
        // Already injected from a previous login attempt — reset checkbox and reshow
        const cb = document.getElementById(TRUST_CHECKBOX_ID) as HTMLInputElement | null;
        if (cb) cb.checked = false;
        tfaRef.current.rememberDevice = false;
        const row = document.getElementById(TRUST_ROW_ID);
        if (row) row.style.display = 'flex';
        return;
      }
      const { trustedDeviceEligible, trustedDevicePolicy } = tfaRef.current;
      if (!trustedDeviceEligible || !trustedDevicePolicy?.enabled) return;
      removeTrustRow = injectTrustDeviceRow(trustedDevicePolicy.maxDays, (checked) => {
        tfaRef.current.rememberDevice = checked;
      });
    };

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
      removePasskeyLoginBtn();
      removePasskeyTfaBtn();
      removeTrustRow?.();
      injectTrustRowRef.current = null;
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
