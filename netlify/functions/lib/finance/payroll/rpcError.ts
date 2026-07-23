import { extractPayrollErrorCode } from '../../../../../types/payrollErrors';

const PAYROLL_SQLSTATE_HTTP: Record<string, number> = {
  PR400: 400,
  PR403: 403,
  PR404: 404,
  PR409: 409,
  PR422: 422,
};

export interface PayrollRpcError {
  code?: string | null;
  message: string;
}

/**
 * Map a payroll RPC failure to an HTTP-ready Error.
 *
 * P0-5: the RPC's custom SQLSTATE (PR4xx) maps ONLY to the HTTP status — it is
 * never surfaced as the domain code. The typed domain code (e.g.
 * 'policy.missing', 'run.invalid_state') is the leading token of the RPC's
 * message by convention; it is lifted onto `.code` so routeErr can emit it in
 * the typed error envelope instead of the UI parsing message text.
 */
export function payrollRpcHttpError(
  error: PayrollRpcError,
): Error & { status?: number; code?: string } {
  const status = error.code ? PAYROLL_SQLSTATE_HTTP[error.code] : undefined;
  const message = error.message.replace(/^finance_payroll_[a-z_]+:\s*/i, '');
  const domainCode = extractPayrollErrorCode(message);
  return Object.assign(
    new Error(message),
    status ? { status } : {},
    domainCode ? { code: domainCode } : {},
  );
}
