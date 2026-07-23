/**
 * Payroll lifecycle API contract tests (certification WP-1: P0-1 + P0-5).
 *
 * Asserts the EXACT outgoing payload of every state-advancing run command against
 * the backend Zod contracts in netlify/functions/routes/financePayroll.ts, and the
 * typed decoding of the sanitized error envelope (types/payrollErrors.ts).
 * A drift in either direction is a test failure here before it is an HTTP 400 in
 * production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiPost } = vi.hoisted(() => ({
  apiPost: vi.fn<(path: string, body: Record<string, unknown>) => Promise<unknown>>(),
}));
vi.mock('@lib/api', () => ({ apiPost }));

import { financePayrollApi, PayrollApiError } from './payroll';

const okWith = (data: unknown) => apiPost.mockResolvedValueOnce({ success: true, data });

beforeEach(() => { apiPost.mockReset(); });

describe('lifecycle command payload contracts (P0-1)', () => {
  it('lock-inputs sends { id, idempotencyKey }', async () => {
    okWith({});
    await financePayrollApi.lockInputs({ id: 'run-1', idempotencyKey: 'k-1' });
    expect(apiPost).toHaveBeenCalledWith('finance/payroll/runs/lock-inputs', { id: 'run-1', idempotencyKey: 'k-1' });
  });

  it('calculate sends { id, idempotencyKey }', async () => {
    okWith({});
    await financePayrollApi.calculate({ id: 'run-1', idempotencyKey: 'k-2' });
    expect(apiPost).toHaveBeenCalledWith('finance/payroll/runs/calculate', { id: 'run-1', idempotencyKey: 'k-2' });
  });

  it('submit sends { id, idempotencyKey }', async () => {
    okWith({});
    await financePayrollApi.submitRun({ id: 'run-1', idempotencyKey: 'k-3' });
    expect(apiPost).toHaveBeenCalledWith('finance/payroll/runs/submit', { id: 'run-1', idempotencyKey: 'k-3' });
  });

  it('lock sends { id, idempotencyKey }', async () => {
    okWith({});
    await financePayrollApi.lockRun({ id: 'run-1', idempotencyKey: 'k-4' });
    expect(apiPost).toHaveBeenCalledWith('finance/payroll/runs/lock', { id: 'run-1', idempotencyKey: 'k-4' });
  });

  it('reopen sends { id, reason, idempotencyKey } — reason is REQUIRED', async () => {
    okWith({});
    await financePayrollApi.reopenRun({ id: 'run-1', reason: 'correction needed', idempotencyKey: 'k-5' });
    expect(apiPost).toHaveBeenCalledWith('finance/payroll/runs/reopen', { id: 'run-1', reason: 'correction needed', idempotencyKey: 'k-5' });
  });

  it('export sends { id, idempotencyKey, format? } with the backend enum', async () => {
    okWith({});
    await financePayrollApi.exportRun({ id: 'run-1', idempotencyKey: 'k-6', format: 'csv' });
    expect(apiPost).toHaveBeenCalledWith('finance/payroll/runs/export', { id: 'run-1', idempotencyKey: 'k-6', format: 'csv' });
  });

  it('reject sends { id, reason }', async () => {
    okWith({});
    await financePayrollApi.rejectRun({ id: 'run-1', reason: 'totals unexplained' });
    expect(apiPost).toHaveBeenCalledWith('finance/payroll/runs/reject', { id: 'run-1', reason: 'totals unexplained' });
  });
});

describe('typed error decoding (P0-5)', () => {
  it('throws PayrollApiError carrying code/correlationId/fieldErrors/retryable from the envelope', async () => {
    apiPost.mockResolvedValueOnce({
      success: false,
      message: 'No active pay policy for this pay group and period',
      error: {
        code: 'policy.missing',
        message: 'No active pay policy for this pay group and period',
        correlationId: 'corr-123',
        fieldErrors: { payGroupId: 'No policy assignment covers the period' },
        retryable: false,
      },
    });
    const err = await financePayrollApi.getRun({ id: 'run-1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayrollApiError);
    const pe = err as PayrollApiError;
    expect(pe.code).toBe('policy.missing');
    expect(pe.correlationId).toBe('corr-123');
    expect(pe.fieldErrors).toEqual({ payGroupId: 'No policy assignment covers the period' });
    expect(pe.retryable).toBe(false);
    expect(pe.message).toBe('No active pay policy for this pay group and period');
  });

  it('legacy message-only failures decode to the fallback code with no correlation id', async () => {
    apiPost.mockResolvedValueOnce({ success: false, message: 'Internal error' });
    const err = await financePayrollApi.getRun({ id: 'run-1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayrollApiError);
    const pe = err as PayrollApiError;
    expect(pe.code).toBe('payroll.error');
    expect(pe.correlationId).toBeNull();
    expect(pe.retryable).toBe(false);
  });
});
