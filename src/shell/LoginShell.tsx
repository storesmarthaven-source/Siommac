/**
 * src/shell/LoginShell.tsx
 *
 * Login screen with three panels (shown/hidden by attSystem.ts):
 *   1. #loginForm        — username + password
 *   2. #twoFaPanel       — TOTP 6-digit verification
 *   3. #twoFaSetupPanel  — first-time 2FA setup (QR → confirm → backup codes)
 *
 * IDs are preserved exactly as in assets/partials/app-shell.html.
 * The #rememberMe checkbox is read by attSystem.ts _completeLogin() to
 * determine session persistence — do not rename or remove it.
 *
 * Phase 2b: This shell will be replaced by a fully Preact-controlled login flow
 * with state in @store/session and form submission via @lib/auth.signIn().
 *
 * @see docs/SHELL_STRUCTURE.md §LoginShell
 * @see docs/ARCHITECTURE.md §Authentication
 * @see docs/CODING_STANDARDS.md
 */

export default function LoginShell() {
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
          <div class="login-brand-header">
            <img
              id="loginLogo"
              class="login-brand-logo"
              src=""
              alt="SIOMAC LTD."
              style="display:none;"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>

          <div class="login-form-body">
            <div class="login-form-title">
              <h3 id="loginTitle">Access Portal</h3>
              <p id="loginSubtitle">
                Sign in to manage attendance, track project sites, handle leave requests, and access real-time workforce insights.
              </p>
            </div>

            {/* ── Panel 1: Username + Password ───────────────────────────── */}
            <form id="loginForm" noValidate>
              <div class="login-input-group">
                <input
                  type="text"
                  id="username"
                  placeholder="Employee ID / Username"
                  autoComplete="username"
                  required
                />
                <div class="login-invalid" id="usernameError">Please enter a valid username</div>
              </div>
              <div class="login-input-group">
                <input
                  type="password"
                  id="password"
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                />
                <div class="login-invalid" id="passwordError">Please enter your password</div>
              </div>

              <div class="login-options-row">
                <label class="login-remember">
                  <input type="checkbox" id="rememberMe" />
                  <span id="rememberMeLabel">Remember me</span>
                </label>
              </div>

              <div id="loginErrorBanner" class="login-error-banner" style="display:none;" />

              <button type="submit" id="loginBtn" class="login-cta-btn">
                <i class="fas fa-sign-in-alt" />
                <span id="loginButton">Sign in to Dashboard</span>
              </button>

              <div class="login-security-note">
                <i class="fas fa-fingerprint" />
                <span><strong>Encrypted Access · SIOMAC Internal Systems</strong></span>
                <i class="fas fa-shield-alt" />
              </div>
            </form>

            {/* ── Panel 2: TOTP verification ─────────────────────────────── */}
            <div id="twoFaPanel" style="display:none;">
              <div class="tfa-icon-row">
                <span class="tfa-shield-icon"><i class="fas fa-shield-alt" /></span>
              </div>
              <p class="tfa-desc">Enter the 6-digit code from your authenticator app, or use a backup code.</p>

              <div class="tfa-otp-row" id="tfaOtpRow">
                <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="0" autoComplete="one-time-code" />
                <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="1" />
                <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="2" />
                <span class="tfa-otp-sep">·</span>
                <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="3" />
                <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="4" />
                <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="5" />
              </div>

              <div id="tfaErrorBanner" class="login-error-banner" style="display:none;" />

              <button id="tfaSubmitBtn" class="login-cta-btn" style="margin-top:8px;">
                <i class="fas fa-lock-open" /> Verify
              </button>

              <div class="tfa-backup-row">
                <button type="button" id="tfaBackupToggle" class="tfa-text-btn">Use a backup code instead</button>
              </div>
              <div id="tfaBackupSection" style="display:none;margin-top:8px;">
                <input
                  id="tfaBackupCode"
                  type="text"
                  class="tfa-backup-input"
                  placeholder="XXXXXXXX"
                  maxLength={8}
                  autoComplete="off"
                />
                <button id="tfaBackupSubmit" class="login-cta-btn" style="margin-top:6px;">
                  <i class="fas fa-key" /> Use Backup Code
                </button>
              </div>

              <div class="tfa-back-row">
                <button type="button" id="tfaBackBtn" class="tfa-text-btn">
                  <i class="fas fa-arrow-left" /> Back to login
                </button>
              </div>
            </div>

            {/* ── Panel 3: First-time 2FA setup ──────────────────────────── */}
            <div id="twoFaSetupPanel" style="display:none;">

              {/* Step A: Show QR code */}
              <div id="setupStepQr">
                <div class="tfa-icon-row">
                  <span class="tfa-shield-icon tfa-shield-warn"><i class="fas fa-mobile-alt" /></span>
                </div>
                <p class="tfa-desc">
                  <strong>Two-Factor Authentication is required for your role.</strong><br />
                  Scan this QR code with Google Authenticator, Authy, or any TOTP app.
                </p>
                <div id="setupQrWrapper" class="tfa-qr-wrapper">
                  <img id="setupQrImg" src="" alt="QR Code" class="tfa-qr-img" />
                </div>
                <p class="tfa-manual-label">Can't scan? Enter this code manually:</p>
                <div id="setupManualCode" class="tfa-manual-code" />
                <button id="setupQrNextBtn" class="login-cta-btn" style="margin-top:16px;">
                  <i class="fas fa-arrow-right" /> I've scanned it — Continue
                </button>
              </div>

              {/* Step B: Confirm with code */}
              <div id="setupStepConfirm" style="display:none;">
                <div class="tfa-icon-row">
                  <span class="tfa-shield-icon"><i class="fas fa-shield-alt" /></span>
                </div>
                <p class="tfa-desc">Enter the 6-digit code from your authenticator app to confirm setup.</p>
                <div class="tfa-otp-row" id="setupOtpRow">
                  <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="0" autoComplete="one-time-code" />
                  <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="1" />
                  <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="2" />
                  <span class="tfa-otp-sep">·</span>
                  <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="3" />
                  <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="4" />
                  <input class="tfa-otp-digit" type="text" inputMode="numeric" maxLength={1} data-idx="5" />
                </div>
                <div id="setupErrorBanner" class="login-error-banner" style="display:none;" />
                <button id="setupConfirmBtn" class="login-cta-btn" style="margin-top:8px;">
                  <i class="fas fa-check-circle" /> Enable Two-Factor Auth
                </button>
              </div>

              {/* Step C: Backup codes */}
              <div id="setupStepBackup" style="display:none;">
                <div class="tfa-icon-row">
                  <span class="tfa-shield-icon tfa-shield-ok"><i class="fas fa-check-circle" /></span>
                </div>
                <p class="tfa-desc">
                  <strong>2FA enabled!</strong> Save these backup codes somewhere safe.<br />
                  Each code can only be used <strong>once</strong>. You'll need them if you lose your phone.
                </p>
                <div id="setupBackupList" class="tfa-backup-list" />
                <button id="setupBackupCopy" class="tfa-text-btn" style="margin:8px auto;display:block;">
                  <i class="fas fa-copy" /> Copy all codes
                </button>
                <button id="setupDoneBtn" class="login-cta-btn" style="margin-top:8px;">
                  <i class="fas fa-sign-in-alt" /> Continue to Dashboard
                </button>
              </div>

            </div>{/* /#twoFaSetupPanel */}

          </div>{/* /.login-form-body */}
        </div>

      </div>
    </div>
  );
}
