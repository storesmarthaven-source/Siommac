/**
 * types/payrollErrors.ts
 *
 * P0-5 (payroll certification): the ONE sanitized payroll API error envelope,
 * shared by the backend routes (financePayroll routeErr / zv) and the frontend
 * client (PayrollApiError in src/api/finance/payroll.ts).
 *
 * Contract rules:
 *  - `error.code` is a stable typed domain code (e.g. 'policy.missing',
 *    'calendar.split_period', 'validation.failed') — NEVER a SQLSTATE and never
 *    parsed out of display text by the UI. The UI switches on `error.code` only.
 *  - `correlationId` is generated per failing request and logged server-side so
 *    an operator can join UI reports to server logs. It carries no user data.
 *  - `retryable` marks transient faults (5xx / infrastructure); 4xx contract or
 *    state violations are not retryable.
 *  - The envelope keeps the legacy top-level `message` field so existing
 *    consumers (toasts, E2E suites asserting body.message) stay valid — the
 *    typed `error` object is the authoritative contract going forward.
 *  - Never include raw SQL, stack traces, secrets, or unbounded DB error text.
 */

export interface PayrollApiErrorBody {
  /** Stable typed domain code, dot-separated (e.g. 'policy.missing'). */
  code: string;
  /** Sanitized human-readable summary (safe to display). */
  message: string;
  /** Per-request id, also written to the server log line for this failure. */
  correlationId: string;
  /** Per-field validation messages keyed by the offending arg path. */
  fieldErrors?: Record<string, string>;
  /** True only for transient faults where an identical retry may succeed. */
  retryable: boolean;
  /** Small, sanitized structured context (ids, counts) — never secrets/SQL. */
  details?: Record<string, unknown>;
}

export interface PayrollApiErrorEnvelope {
  success: false;
  /** Legacy display/back-compat field — mirrors error.message. */
  message: string;
  error: PayrollApiErrorBody;
}

/** Generic fallback code when a thrown error carries no typed domain code. */
export const PAYROLL_ERROR_FALLBACK_CODE = 'payroll.error';
/** Code attached to Zod arg-validation failures (fieldErrors carry the detail). */
export const PAYROLL_VALIDATION_CODE = 'validation.failed';

/**
 * Lift a leading typed domain code out of an error message produced by the
 * payroll RPCs / libs (convention: messages start with `domain.sub_code: …` or
 * `domain.sub_code:qualifier …`). Returns null when the message doesn't lead
 * with a code — callers then use PAYROLL_ERROR_FALLBACK_CODE.
 */
export function extractPayrollErrorCode(message: string): string | null {
  const m = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)/.exec(message.trim());
  return m ? m[1]! : null;
}
