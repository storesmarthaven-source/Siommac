/**
 * src/api/finance/expenses.ts
 *
 * Typed client + TanStack hooks for the Finance Expense Claims backend
 * (routes/financeExpenses.ts — POST `finance/expenses/*`). Wave 2B Aurora deepening.
 *
 * Lifecycle: draft → submitted → approved → reimbursed (also rejectable/cancellable).
 * SoD: claimant ≠ approver (enforced server-side).
 * actorId is derived server-side from auth — clients never send it.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// ── DTOs ──────────────────────────────────────────────────────────────────────

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

export interface ExpenseClaimDetail extends ExpenseClaim {
  lines: ExpenseCostEntry[];
  attachmentCount: number;
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

// ── Policy check DTOs ─────────────────────────────────────────────────────────

export type PolicyIssueType =
  | 'category_limit_exceeded'
  | 'missing_receipt'
  | 'date_window_exceeded'
  | 'invalid_cost_centre'
  | 'duplicate_candidate';

export interface PolicyIssue {
  type: PolicyIssueType;
  severity: 'warning' | 'error';
  message: string;
  lineId?: string;
}

export interface PolicyCheckResult {
  claimId: string;
  issues: PolicyIssue[];
  approvalRoute: { role: string; label: string } | null;
  canSubmit: boolean;
}

// ── Report DTOs ───────────────────────────────────────────────────────────────

export type ExpenseReportType = 'expense_claim_summary' | 'expense_policy_exceptions' | 'reimbursement_summary' | 'missing_receipts';

export interface ExpenseReportResult {
  report: string;
  generatedAt: string;
  rows: Record<string, unknown>[];
}

// ── Trend DTOs ────────────────────────────────────────────────────────────────

export interface ExpenseTrendPoint {
  month: string;
  amount: number;
  count: number;
}

// ── Input types ───────────────────────────────────────────────────────────────

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
  notes?: string;
  allocationLines: AllocationLine[];
  metadata?: Record<string, unknown>;
}

export interface MarkReimbursedArgs {
  id: string;
  reimbursedAt?: string;
  paymentMethod?: 'eft' | 'cheque' | 'cash' | 'wire' | 'other';
  reference?: string;
  paidAmount?: number;
  sourceDisbursement?: string;
  notes?: string;
}

// ── Core call helper ──────────────────────────────────────────────────────────

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

// ── API object ────────────────────────────────────────────────────────────────

export const financeExpensesApi = {
  list:    (a: { claimantId?: string; status?: ExpenseStatus; category?: string; search?: string; page?: number; pageSize?: number } = {}) =>
             call<{ data: ExpenseClaim[]; total: number }>('finance/expenses/list', a),
  get:     (a: { id: string })                   => call<ExpenseClaim>('finance/expenses/get', a),
  detail:  (a: { id: string })                   => call<ExpenseClaimDetail>('finance/expenses/detail', a),
  lines:   (a: { claimId: string })              => call<ExpenseCostEntry[]>('finance/expenses/lines/list', a),
  create:  (a: CreateExpenseClaimArgs)           => call<ExpenseClaim>('finance/expenses/create', a),
  submit:  (a: { id: string })                   => call<ExpenseClaim>('finance/expenses/submit', a),
  approve: (a: { id: string })                   => call<ExpenseClaim>('finance/expenses/approve', a),
  reject:  (a: { id: string; reason: string })   => call<ExpenseClaim>('finance/expenses/reject', a),
  markReimbursed: (a: MarkReimbursedArgs)        => call<ExpenseClaim>('finance/expenses/mark-reimbursed', a),
  cancel:  (a: { id: string; reason: string })   => call<ExpenseClaim>('finance/expenses/cancel', a),

  // Receipt upload
  receiptUploadUrl: (a: { fileName: string; mimeType: string }) =>
             call<{ uploadUrl: string; token: string; path: string; bucket: string }>('finance/expenses/receipt-upload-url', a),
  receiptCommit: (a: { claimId: string; path: string }) =>
             call<ExpenseClaim>('finance/expenses/receipt-commit', a),

  // Policy check
  policyCheck: (a: { id: string }) =>
             call<PolicyCheckResult>('finance/expenses/policy-check', a),

  // Reimbursement handoff (idempotent)
  handoffReimbursement: (a: { claimId: string; payrollRunId?: string }) =>
             call<{ bridgeId: string; handoffId: string; reusedExisting: boolean }>('finance/expenses/handoff/reimbursement', a),

  // Trend
  trend: () => call<ExpenseTrendPoint[]>('finance/expenses/trend'),

  // Reports
  runReport: (a: { report?: ExpenseReportType; claimantId?: string; status?: ExpenseStatus; category?: string; fiscalYear?: number } = {}) =>
             call<ExpenseReportResult>('finance/expenses/reports/run', a),
  listReport: (a: { claimantId?: string; status?: ExpenseStatus; category?: string } = {}) =>
                call<ExpenseReportRow[]>('finance/expenses/reports/list', a),
};

// ── Local query keys (module-scoped; orchestrator owns keys.ts) ───────────────

export const financeExpensesKeys = {
  list:    (o: object = {}) => ['finance', 'expenses', 'list', o] as const,
  single:  (id: string)     => ['finance', 'expenses', 'single', id] as const,
  detail:  (id: string)     => ['finance', 'expenses', 'detail', id] as const,
  lines:   (id: string)     => ['finance', 'expenses', 'lines', id] as const,
  report:  (o: object = {}) => ['finance', 'expenses', 'report', o] as const,
  trend:   ()               => ['finance', 'expenses', 'trend'] as const,
  policy:  (id: string)     => ['finance', 'expenses', 'policy', id] as const,
};

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useExpenseClaims(opts: {
  claimantId?: string;
  status?: ExpenseStatus;
  category?: string;
  search?: string;
  page?: number;
  pageSize?: number;
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

export function useExpenseClaimDetail(id: string | null) {
  return useQuery({
    queryKey: financeExpensesKeys.detail(id ?? ''),
    queryFn:  () => financeExpensesApi.detail({ id: id! }),
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

export function useExpenseTrend() {
  return useQuery({
    queryKey:  financeExpensesKeys.trend(),
    queryFn:   () => financeExpensesApi.trend(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useExpensePolicyCheck(id: string | null) {
  return useQuery({
    queryKey: financeExpensesKeys.policy(id ?? ''),
    queryFn:  () => financeExpensesApi.policyCheck({ id: id! }),
    enabled:  !!id,
  });
}

// ── Mutation hook (invalidates the whole finance-expenses subtree) ─────────────

export function useExpenseMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'expenses'] });
    },
  });
}
