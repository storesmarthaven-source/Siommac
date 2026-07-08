/**
 * src/api/finance/budgets.ts
 *
 * Typed client + TanStack hooks for Finance Budgeting & Budget-vs-Actual (F5).
 * Routes: POST finance/budgets/{list,get,upsert,delete,variance,
 *           bulk-upsert,copy-last-year,line-actuals,actuals,
 *           reports/list,reports/run}
 * Envelope: body.args (apiPost wrapper). actorId derived server-side from JWT.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface BudgetLine {
  id: string;
  costCenterId: string;
  costCenterName: string | null;
  fiscalYear: number;
  category: string;
  label: string | null;
  notes: string | null;
  budgeted: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  currency: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
  period: string | null;
  ownerId: string | null;
}

export interface BudgetApprovalTask {
  id: string;
  stepKey: string;
  stepName: string | null;
  status: string;
  assignedTo: string | null;
  assignedRole: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface BudgetAuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  previousState: unknown;
  newState: unknown;
  reason: string | null;
  createdAt: string;
}

export interface BudgetVarianceRow {
  costCenterId: string;
  costCenterName: string | null;
  category: string;
  fiscalYear: number;
  budgeted: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  currency: string;
}

export interface BudgetReportCatalogRow {
  key: string;
  label: string;
  description: string;
}

export interface CostEntryRow {
  id: string;
  ref: string | null;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  periodYear: number | null;
}

export interface BudgetActualsResult {
  budgetLine: BudgetLine;
  entries: CostEntryRow[];
  totalActual: number;
  byMonth: { month: number; amount: number }[];
}

export interface BulkUpsertResult {
  count: number;
  ids: string[];
  overBudgetCount: number;
}

export interface CopyLastYearResult {
  copied: number;
  skipped: number;
  ids: string[];
}

// Wizard / dialog form types
export interface UpsertBudgetLineArgs {
  costCenterId: string;
  fiscalYear: number;
  category: string;
  label?: string | null;
  notes?: string | null;
  budgeted: number;
  currency?: 'TTD';
}

export interface BulkBudgetLineArg {
  costCenterId: string;
  fiscalYear: number;
  category: string;
  label?: string | null;
  notes?: string | null;
  budgeted: number;
  currency?: 'TTD';
  /** Fiscal period within the year — e.g. 'Q1', 'Jan', 'H1'. Null = full-year. */
  period?: string | null;
  /** Budget owner user ID (app_users.id TEXT). */
  ownerId?: string | null;
}

export interface CopyLastYearArgs {
  sourceFiscalYear: number;
  targetFiscalYear: number;
  costCenterId?: string | null;
  category?: string | null;
  adjustmentPct?: number;
  roundingRule?: 'none' | 'hundred' | 'thousand';
}

// ── Internal call helper ───────────────────────────────────────────────────────

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

// ── API surface ───────────────────────────────────────────────────────────────

export interface BudgetAttachmentDto {
  id: string;
  fileName: string;
  fileSize: number | null;
  contentType: string | null;
  storagePath: string;
  uploadedBy: string | null;
  createdAt: string;
}

export const financeBudgetsApi = {
  list:        (a: { costCenterId?: string; fiscalYear?: number; category?: string } = {}) =>
                 call<BudgetLine[]>('finance/budgets/list', a),
  get:         (a: { id: string }) => call<BudgetLine>('finance/budgets/get', a),
  upsert:      (a: UpsertBudgetLineArgs) => call<BudgetLine>('finance/budgets/upsert', a),
  delete:      (a: { id: string }) => call<{ id: string }>('finance/budgets/delete', a),
  bulkUpsert:  (a: { lines: BulkBudgetLineArg[] }) => call<BulkUpsertResult>('finance/budgets/bulk-upsert', a),
  copyLastYear:(a: CopyLastYearArgs) => call<CopyLastYearResult>('finance/budgets/copy-last-year', a),
  variance:    (a: { fiscalYear: number; costCenterId?: string }) =>
                 call<BudgetVarianceRow[]>('finance/budgets/variance', a),
  lineActuals: (a: { id: string }) => call<BudgetActualsResult>('finance/budgets/line-actuals', a),
  actuals:     (a: { fiscalYear: number; costCenterId?: string }) =>
                 call<CostEntryRow[]>('finance/budgets/actuals', a),
  listReports: () => call<BudgetReportCatalogRow[]>('finance/budgets/reports/list'),
  runReport:   (a: { reportKey: string; fiscalYear?: number; costCenterId?: string }) =>
                 call<BudgetLine[] | BudgetVarianceRow[] | CostEntryRow[]>('finance/budgets/reports/run', a),
  // Approvals (workflow tasks for a budget line)
  approvals:   (a: { id: string }) => call<BudgetApprovalTask[]>('finance/budgets/approvals', a),
  // Audit log entries for a budget line
  auditLog:    (a: { id: string }) => call<BudgetAuditEntry[]>('finance/budgets/audit-log', a),
  // Budget-specific attachment routes
  attachments: {
    uploadUrl: (a: { budgetLineId: string; fileName: string; mimeType: string }) =>
      call<{ uploadUrl: string; token: string; path: string; bucket: string }>('finance/budgets/attachments/upload-url', a),
    complete: (a: { budgetLineId: string; fileName: string; storagePath: string; mimeType?: string; fileSize?: number }) =>
      call<BudgetAttachmentDto>('finance/budgets/attachments/complete', a),
    list: (a: { budgetLineId: string }) =>
      call<BudgetAttachmentDto[]>('finance/budgets/attachments/list', a),
    signedUrl: (a: { storagePath: string }) =>
      call<{ signedUrl: string }>('finance/budgets/attachments/signed-url', a),
    delete: (a: { id: string; budgetLineId: string }) =>
      call<{ id: string }>('finance/budgets/attachments/delete', a),
  },
};

// ── Local query-key factory ───────────────────────────────────────────────────
// Keys NOT yet in src/api/finance/keys.ts are defined here locally.
// Report them to the orchestrator for central registration.

export const financeBudgetsKeys = {
  // Already present (mirrors keys.ts patterns)
  list:          (o: object = {}) => ['finance', 'budgets', 'list', o] as const,
  line:          (id: string)     => ['finance', 'budgets', 'line', id] as const,
  variance:      (o: object)      => ['finance', 'budgets', 'variance', o] as const,
  reports:       ()               => ['finance', 'budgets', 'reports'] as const,
  // New (report to orchestrator for keys.ts registration)
  lineActuals:   (id: string)     => ['finance', 'budgets', id, 'actuals'] as const,
  actuals:       (o: object)      => ['finance', 'budgets', 'actuals', o] as const,
  approvals:     (id: string)     => ['finance', 'budgets', id, 'approvals'] as const,
  auditLog:      (id: string)     => ['finance', 'budgets', id, 'audit-log'] as const,
  attachments:   (id: string)     => ['finance', 'budgets', id, 'attachments'] as const,
};

// ── Queries ───────────────────────────────────────────────────────────────────

export function useBudgets(opts: { costCenterId?: string; fiscalYear?: number; category?: string } = {}) {
  return useQuery({
    queryKey: financeBudgetsKeys.list(opts),
    queryFn:  () => financeBudgetsApi.list(opts),
  });
}

export function useBudgetDetail(id: string | null) {
  return useQuery({
    queryKey: financeBudgetsKeys.line(id ?? ''),
    queryFn:  () => financeBudgetsApi.get({ id: id! }),
    enabled:  !!id,
  });
}

export function useBudgetVariance(fiscalYear: number, costCenterId?: string) {
  return useQuery({
    queryKey: financeBudgetsKeys.variance({ fiscalYear, costCenterId }),
    queryFn:  () => financeBudgetsApi.variance({ fiscalYear, costCenterId }),
  });
}

export function useBudgetLineActuals(id: string | null) {
  return useQuery({
    queryKey: financeBudgetsKeys.lineActuals(id ?? ''),
    queryFn:  () => financeBudgetsApi.lineActuals({ id: id! }),
    enabled:  !!id,
  });
}

export function useBudgetActuals(fiscalYear: number, costCenterId?: string) {
  return useQuery({
    queryKey: financeBudgetsKeys.actuals({ fiscalYear, costCenterId }),
    queryFn:  () => financeBudgetsApi.actuals({ fiscalYear, costCenterId }),
  });
}

export function useBudgetReports() {
  return useQuery({
    queryKey: financeBudgetsKeys.reports(),
    queryFn:  () => financeBudgetsApi.listReports(),
  });
}

export function useBudgetLineApprovals(id: string | null) {
  return useQuery({
    queryKey: financeBudgetsKeys.approvals(id ?? ''),
    queryFn:  () => financeBudgetsApi.approvals({ id: id! }),
    enabled:  !!id,
  });
}

export function useBudgetLineAuditLog(id: string | null) {
  return useQuery({
    queryKey: financeBudgetsKeys.auditLog(id ?? ''),
    queryFn:  () => financeBudgetsApi.auditLog({ id: id! }),
    enabled:  !!id,
  });
}

export function useBudgetLineAttachments(id: string | null, enabled = true) {
  return useQuery({
    queryKey: financeBudgetsKeys.attachments(id ?? ''),
    queryFn:  () => financeBudgetsApi.attachments.list({ budgetLineId: id! }),
    enabled:  enabled && !!id,
    staleTime: 60_000,
  });
}

// ── Mutation factory ──────────────────────────────────────────────────────────

export function useBudgetMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['finance', 'budgets'] }); },
  });
}
