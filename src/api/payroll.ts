/**
 * src/api/payroll.ts
 *
 * Typed Supabase API functions for the Payroll and Hourly Rates domains.
 *
 * @see docs/ARCHITECTURE.md §API-Layer
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { supabase }            from '@lib/supabase';
import { logger }              from '@lib/logger';
import type {
  SetHourlyRatePayload,
  CreatePayrollRunPayload,
} from './schemas/payroll';

// ── Payroll Runs ──────────────────────────────────────────────────────────────

/** List all payroll runs (admin) */
export async function listPayrollRuns(signal?: AbortSignal) {
  const query = supabase
    .from('payroll_runs')
    .select('*')
    .order('period_start', { ascending: false });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/payroll] listPayrollRuns failed', { error });
    throw new Error(error.message);
  }

  return data ?? [];
}

/** Get entries for a specific payroll run */
export async function getPayrollEntries(runId: string, signal?: AbortSignal) {
  const query = supabase
    .from('payroll_entries')
    .select('*')
    .eq('payroll_run_id', runId)
    .order('username', { ascending: true });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/payroll] getPayrollEntries failed', { runId, error });
    throw new Error(error.message);
  }

  return data ?? [];
}

/** Get the current employee's payslip history */
export async function getMyPayslips(username: string, signal?: AbortSignal) {
  const query = supabase
    .from('payroll_entries')
    .select(`
      *,
      payroll_runs!payroll_entries_payroll_run_id_fkey(period_start, period_end, status)
    `)
    .eq('username', username)
    .order('created_at', { ascending: false });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/payroll] getMyPayslips failed', { username, error });
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function createPayrollRun(payload: CreatePayrollRunPayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'createPayrollRun',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to create payroll run.');
}

export async function approvePayrollRun(runId: string): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'approvePayrollRun',
    { id: runId },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to approve payroll run.');
}

// ── Hourly Rates ──────────────────────────────────────────────────────────────

/** List all hourly rate history for an employee */
export async function getHourlyRateHistory(username: string, signal?: AbortSignal) {
  const query = supabase
    .from('hourly_rates')
    .select('*')
    .eq('username', username)
    .order('effective_date', { ascending: false });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/payroll] getHourlyRateHistory failed', { username, error });
    throw new Error(error.message);
  }

  return data ?? [];
}

/** List all employees with their current hourly rate (admin) */
export async function listAllHourlyRates(signal?: AbortSignal) {
  const query = supabase
    .from('hourly_rates')
    .select('*')
    .order('username', { ascending: true })
    .order('effective_date', { ascending: false });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/payroll] listAllHourlyRates failed', { error });
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function setHourlyRate(payload: SetHourlyRatePayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'setHourlyRate',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to set hourly rate.');
}
