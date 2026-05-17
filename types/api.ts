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
  companyLogoUrl?: string;
  companyName?:    string;
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
  healthSurcharge: number;
  totalDeductions: number;
  netPay:          number;
}
