// ── Siomac API Types ─────────────────────────────────────────────────────────
// Request / response shapes for the legacy action-dispatch protocol and typed
// route payloads. Frontend and future React code can import from here.

/** Every API response has at minimum { success: boolean } */
export interface ApiResponse {
  success: boolean;
  message?: string;
}

export interface ApiOk<T = unknown> extends ApiResponse {
  success: true;
  data?: T;
}

export interface ApiError extends ApiResponse {
  success: false;
  message: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface LoginResponse extends ApiResponse {
  // ── Full session (2FA complete or not required) ──────────────────────────
  token?:          string;   // short-lived access token (15 min)
  refreshToken?:   string;   // long-lived refresh token (7 days, rotating)
  userId?:         string;
  username?:       string;
  fullName?:       string;
  role?:           string;
  departmentId?:   string;
  position?:       string;
  colorScheme?:    string;
  layoutMode?:     string;
  profileImage?:   string;
  profileImageVersion?: number;
  companyLogoUrl?: string;
  companyName?:    string;
  permissionOverrides?: { user_id: string; permission: string; granted: boolean; set_by: string; set_at: string }[];
  rolePermissions?: string[];
  isEmployee?: boolean;
  sessionIdleTimeoutMs?: number;  // resolved per-role idle window (ms)
  // ── 2FA intermediate states ──────────────────────────────────────────────
  requiresTwoFactor?: boolean;  // enrolled, must enter TOTP code or use passkey
  requiresSetup?:     boolean;  // mandatory role, not yet enrolled
  preAuthToken?:      string;   // short-lived, grants only /verify2fa or /setup2fa
  methods?:           string[]; // ['totp', 'webauthn'] — which factors are available
  // ── Mandatory MFA setup hints (returned when requiresSetup is true) ─────
  setupMethods?: string[];      // ['webauthn','totp'] — methods available for initial setup
  reason?:       string;        // 'mandatory_mfa' — why setup is required
  // ── Post-login passkey prompt (returned on full session when !hasPasskey) ─
  hasPasskey?:   boolean;       // true when the user has ≥1 registered passkey
  nextStep?:     'passkey_prompt'; // signals the UI to show the setup nudge
  passkeyRequired?: false;      // always false for the optional prompt case
  // ── Auth-method claims (present on full session responses) ───────────────
  /** Authentication Method References — mirrors JWT amr claim */
  amr?:           string[];
  /** Coarse strength classification for the session */
  authStrength?:  'password_only' | 'mfa' | 'passwordless_passkey' | 'trusted_device';
  // ── Trusted device hints (returned on requiresTwoFactor) ────────────────
  /** True if the UI should offer a "remember this device" checkbox */
  trustedDeviceEligible?: boolean;
  /** Policy info for the checkbox label (e.g. max TTL days) */
  trustedDevicePolicy?: { enabled: boolean; maxDays: number };
}

export interface Setup2faResponse extends ApiResponse {
  qrCode?:      string;   // data:image/png;base64,...
  manualCode?:  string;   // base32 secret for manual entry
  backupCodes?: string[]; // plaintext, shown ONCE at enrolment
}

export interface Verify2faResponse extends ApiResponse {
  // On success, same full session fields as LoginResponse
  token?:          string;
  refreshToken?:   string;
  userId?:         string;
  username?:       string;
  fullName?:       string;
  role?:           string;
  departmentId?:   string;
  position?:       string;
  colorScheme?:    string;
  layoutMode?:     string;
  profileImage?:   string;
  profileImageVersion?: number;
  companyLogoUrl?: string;
  companyName?:    string;
  permissionOverrides?: { user_id: string; permission: string; granted: boolean; set_by: string; set_at: string }[];
  rolePermissions?: string[];
  isEmployee?: boolean;
  sessionIdleTimeoutMs?: number;
  // ── Auth-method claims (present on full session responses) ───────────────
  amr?:           string[];
  authStrength?:  'password_only' | 'mfa' | 'passwordless_passkey' | 'trusted_device';
}

export interface TwoFactorStatusResponse extends ApiResponse {
  enabled?:      boolean;
  enrolledAt?:   string | null;
  mandatory?:    boolean;
  codesRemaining?: number;
}

// ── JWT payload (decoded) ─────────────────────────────────────────────────────
export interface JwtPayload {
  sub:          string;   // user id
  username:     string;
  role:         string;
  departmentId: string;
  jti:          string;   // unique token id — used for revocation checks
  iat:          number;
  exp:          number;
  // ── Auth-method claims (Phase B2a) ────────────────────────────────────────
  /** Authentication Method References — e.g. ['pwd'], ['pwd','otp'], ['pwd','webauthn'], ['webauthn'] */
  amr:           string[];
  /** True when the session has satisfied the MFA requirement for the user's role. */
  mfaSatisfied:  boolean;
  /** ISO timestamp when the second factor was verified (absent for password-only sessions). */
  mfaVerifiedAt?: string;
  /** Coarse strength classification for the session. */
  authStrength:  'password_only' | 'mfa' | 'passwordless_passkey' | 'trusted_device';
}

// ── Hono context variables ─────────────────────────────────────────────────────
// These are set by middleware and available via c.get(key).
export interface HonoVariables {
  body:     Record<string, unknown>;
  auth:     JwtPayload | null;
  clientIp: string;
}

// ── Rate limit result ─────────────────────────────────────────────────────────
export interface RateLimitResult {
  ok:          boolean;
  retryAfter?: number;   // seconds until the window resets (only when ok=false)
}

// ── Payroll calculation ───────────────────────────────────────────────────────
export interface Payslip {
  grossPay:        number;
  paye:            number;
  nis:             number;
  nisEmployer:     number;   // employer NIS cost (10.8% NIBTT 2026) — not deducted from employee
  healthSurcharge: number;
  totalDeductions: number;
  netPay:          number;
}
