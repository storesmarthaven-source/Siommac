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

export function payrollRpcHttpError(
  error: PayrollRpcError,
): Error & { status?: number } {
  const status = error.code ? PAYROLL_SQLSTATE_HTTP[error.code] : undefined;
  const message = error.message.replace(/^finance_payroll_[a-z_]+:\s*/i, '');
  return Object.assign(new Error(message), status ? { status } : {});
}
