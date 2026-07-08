/**
 * src/api/finance/bridges.ts
 *
 * TanStack Query mutation hooks for Finance Wave 2B cross-module bridges.
 * Wraps POST /api/finance/bridges/* (routes/financeBridges.ts).
 *
 * All bridges are idempotent — calling them twice for the same inputs returns
 * the existing record with `reusedExisting: true` rather than creating a duplicate.
 *
 * Mutations:
 *   useCreateDisbursementFromRun  — approved payroll run → disbursement draft
 *   useCreateRemittanceFromRun    — (approved run, authority) → remittance draft
 *   useCreateReimbursementHandoff — approved expense claim → payroll reimbursement handoff
 */

import { useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { financeQueryKeys } from './keys';

// ── DTO types (mirror backend bridges.ts / remittances.ts / disbursements.ts) ─

export type RemittanceAuthority = 'paye_bir' | 'nis_nibtt' | 'health_surcharge';

export interface DisbursementBridgeData {
  disbursement:   Record<string, unknown>;
  reusedExisting: boolean;
}

export interface RemittanceBridgeData {
  remittance:     Record<string, unknown>;
  reusedExisting: boolean;
}

export interface ReimbursementBridgeData {
  bridgeId:       string;
  handoffId:      string;
  reusedExisting: boolean;
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function post<T>(
  path: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(path, args);
  if (!res.success) throw new Error((res as { message?: string }).message ?? 'Request failed');
  return res.data;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Create a draft disbursement from an approved payroll run.
 *
 * Idempotent: a second call for the same run returns the existing disbursement
 * with `reusedExisting: true`.
 *
 * Invalidates:
 *   - disbursementsBase (disbursements register)
 *   - payrollRun detail (run now has a linked disbursement)
 */
export function useCreateDisbursementFromRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      payrollRunId: string;
      metadata?:    Record<string, unknown>;
    }) => post<DisbursementBridgeData>('finance/bridges/create-disbursement', vars),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: financeQueryKeys.disbursementsBase() });
      void qc.invalidateQueries({ queryKey: financeQueryKeys.payrollRun(vars.payrollRunId) });
    },
  });
}

/**
 * Create a draft remittance from an approved payroll run for a specific authority.
 *
 * Idempotent: a second call for the same (run, authority) pair returns the existing
 * remittance with `reusedExisting: true`.
 *
 * Invalidates:
 *   - remittancesBase (remittances register)
 *   - payrollRun detail
 */
export function useCreateRemittanceFromRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      payrollRunId: string;
      authority:    RemittanceAuthority;
      dueDate?:     string | null;
      metadata?:    Record<string, unknown>;
    }) => post<RemittanceBridgeData>('finance/bridges/create-remittance', vars),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: financeQueryKeys.remittancesBase() });
      void qc.invalidateQueries({ queryKey: financeQueryKeys.payrollRun(vars.payrollRunId) });
    },
  });
}

/**
 * Create a cross-module handoff from an approved expense claim to Finance Payroll
 * for reimbursement processing. Returns `bridgeId`, `handoffId`, and `reusedExisting`.
 *
 * Idempotent: a second call for the same claim returns the existing bridge row with
 * `reusedExisting: true` (no duplicate handoff is created).
 *
 * Invalidates:
 *   - expense detail (claim now has a linked reimbursement handoff)
 */
export function useCreateReimbursementHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      expenseClaimId: string;
      payrollRunId?:  string | null;
    }) => post<ReimbursementBridgeData>('finance/bridges/create-reimbursement', vars),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: financeQueryKeys.expense(vars.expenseClaimId) });
    },
  });
}
