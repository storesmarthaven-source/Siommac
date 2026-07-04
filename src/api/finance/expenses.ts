/**
 * src/api/finance/expenses.ts
 *
 * Typed client + TanStack hooks for the Finance Expense Claims backend
 * (routes/financeExpenses.ts -- POST `finance/expenses/*`).
 *
 * Lifecycle: draft -> submitted -> approved -> reimbursed (also rejectable/cancellable).
 * SoD: claimant != approver (enforced server-side).
 * actorId is derived server-side from auth -- clients never send it.
 *
 * call<T> throws on success:false; callers surface errors via @lib/dialog or toast.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// -- DTOs (mirror the backend lib return shapes exactly) ----------------------

export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'reimbursed' | 'cancelled';

export type ExpenseCategory =
  | 'travel' | 'accommodation' | 'meals' | 'equipment'
  | 'supplies' | 'professional_fees' | 'utilities' | 'other';

export interface ExpenseClaim {
  id: string;
  claimNo: string;
  claimantId: string;
  title: string;
  expenseDate: string;
  category: string;
  totalAmount: number;
  currency: string;
  status: ExpenseStatus;
  receiptPath: string | null;
  reimbursable: boolean;
  reimbursedAt: string | null;
  approvedBy: string | null;
  createdBy: string | null;
  cancelReason: string | null;
  rejectReason: string | null;
  workflowId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCostEntry {
  id: string;
  ref: string;
  costCenterId: string | null;
  amount: number;
  currency: string;
  description: string | null;
  expenseClaimId: string | null;
  createdAt: string;
}

export interface ExpenseReportRow {
  id: string;
  claimNo: string;
  claimantId: string;
  title: string;
  expenseDate: string;
  category: string;
  totalAmount: number;
  currency: string;
  status: string;
  reimbursable: boolean;
  reimbursedAt: string | null;
  createdAt: string;
}

// -- Create input types ------------------------------------------------------

export interface AllocationLine {
  costCenterId: string;
  amount: number;
  description?: string;
}

export interface CreateExpenseClaimArgs {
  claimantId: string;
  title: string;
  expenseDate: string;
  category: ExpenseCategory;
  totalAmount: number;
  currency?: string;
  receiptPath?: string | null;
  reimbursable?: boolean;
  allocationLines: AllocationLine[];
  metadata?: Record<string, unknown>;
}

// -- Core call helper ---------------------------------------------------------

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

// -- API object ---------------------------------------------------------------

export const financeExpensesApi = {
  list:    (a: { claimantId?: string; status?: ExpenseStatus; category?: string } = {}) =>
             call<ExpenseClaim[]>('finance/expenses/list', a),
  get:     (a: { id: string })                   => call<ExpenseClaim>('finance/expenses/get', a),
  lines:   (a: { claimId: string })              => call<ExpenseCostEntry[]>('finance/expenses/lines/list', a),
  create:  (a: CreateExpenseClaimArgs)           => call<ExpenseClaim>('finance/expenses/create', a),
  submit:  (a: { id: string })                   => call<ExpenseClaim>('finance/expenses/submit', a),
  approve: (a: { id: string })                   => call<ExpenseClaim>('finance/expenses/approve', a),
  reject:  (a: { id: string; reason: string })   => call<ExpenseClaim>('finance/expenses/reject', a),
  markReimbursed: (a: { id: string; reimbursedAt?: string }) =>
             call<ExpenseClaim>('finance/expenses/mark-reimbursed', a),
  cancel:  (a: { id: string; reason: string })   => call<ExpenseClaim>('finance/expenses/cancel', a),

  // Receipt upload
  receiptUploadUrl: (a: { fileName: string; mimeType: string }) =>
             call<{ uploadUrl: string; token: string; path: string; bucket: string }>('finance/expenses/receipt-upload-url', a),
  receiptCommit: (a: { claimId: string; path: string }) =>
             call<ExpenseClaim>('finance/expenses/receipt-commit', a),

  // Reports
  listReport: (a: { claimantId?: string; status?: ExpenseStatus; category?: string } = {}) =>
                call<ExpenseReportRow[]>('finance/expenses/reports/list', a),
};

// -- Query keys ---------------------------------------------------------------

export const financeExpensesKeys = {
  list:   (o: object = {}) => ['finance', 'expenses', 'list', o] as const,
  single: (id: string)     => ['finance', 'expenses', 'single', id] as const,
  lines:  (id: string)     => ['finance', 'expenses', 'lines', id] as const,
  report: (o: object = {}) => ['finance', 'expenses', 'report', o] as const,
};

// -- Query hooks --------------------------------------------------------------

export function useExpenseClaims(opts: {
  claimantId?: string;
  status?: ExpenseStatus;
  category?: string;
} = {}) {
  return useQuery({
    queryKey: financeExpensesKeys.list(opts),
    queryFn:  () => financeExpensesApi.list(opts),
  });
}

export function useExpenseClaim(id: string | null) {
  return useQuery({
    queryKey: financeExpensesKeys.single(id ?? ''),
    queryFn:  () => financeExpensesApi.get({ id: id! }),
    enabled:  !!id,
  });
}

export function useExpenseLines(claimId: string | null) {
  return useQuery({
    queryKey: financeExpensesKeys.lines(claimId ?? ''),
    queryFn:  () => financeExpensesApi.lines({ claimId: claimId! }),
    enabled:  !!claimId,
  });
}

export function useExpensesReport(opts: {
  claimantId?: string;
  status?: ExpenseStatus;
  category?: string;
} = {}) {
  return useQuery({
    queryKey: financeExpensesKeys.report(opts),
    queryFn:  () => financeExpensesApi.listReport(opts),
  });
}

// -- Mutation hook (invalidates the whole finance-expenses subtree) -----------

export function useExpenseMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'expenses'] });
    },
  });
}
