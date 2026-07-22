// types/payrollReports.ts
// ============================================================================
// SHARED, PURE contract for the Payroll Reports Center (F-12, Phase A).
// Imported by BOTH the Netlify route layer (validation) and the FE api wrapper /
// report form. ONE camelCase definition — no divergence. This is the ONLY file
// under types/ that carries runtime zod, by explicit design directive: the report
// param union must be validated identically on the server and used to build the
// UI form. It has NO server/env/Netlify/`src/api` imports (zod is a pure lib).
//
// Division of validation labour:
//   • zod validates STRUCTURE (types, enums, required/optional, format regex,
//     unknown-field rejection via .strict()) → a failure is HTTP 400.
//   • SEMANTIC rules (period span ≤ 24 months, nis scope/runId mutual-exclusion,
//     variance compareRunId ≠ runId, run eligibility, format matrix) are enforced
//     by the engine/route and return HTTP 422 (or 400 invalid_format) — NOT here,
//     so the exact contract codes are preserved (§5A/§5A2).
//
// Contract: docs/module-contracts/PAYROLL_REPORTS_DELIVERY_CONTRACT.md §5A/§5A2/§5B/§5C, §4A.
// ============================================================================

import { z } from 'zod';
import type { MoneyValue } from './payrollControlCenter';

export type { MoneyValue };

// ── Report keys (server-owned 9-key catalog) ────────────────────────────────
export const PAYROLL_REPORT_KEYS = [
  'payroll_register',
  'net_pay_summary',
  'payroll_cost_analysis',
  'gross_to_net_reconciliation',
  'variance_analysis',
  'overtime_allowance_analysis',
  'population_movements',
  'nis_exceptions',
  'export_audit_package',
] as const;
export type PayrollReportKey = (typeof PAYROLL_REPORT_KEYS)[number];

// ── Formats + the frozen format matrix (§5A) ────────────────────────────────
export type PreviewFormat = 'preview';
export type StandardFileFormat = 'xlsx' | 'csv' | 'pdf';
export type ZipFormat = 'zip';
export type ReportFormat = PreviewFormat | StandardFileFormat | ZipFormat;
/** Persisted artifact formats (preview is never persisted). */
export type ReportArtifactFormat = StandardFileFormat | ZipFormat;

/**
 * The exact frozen format matrix: the first eight reports support
 * preview|xlsx|csv|pdf; export_audit_package supports zip ONLY. Any other
 * combination is 400 invalid_format (validated before enqueue/preview, so it
 * produces no job/event/audit/Storage object).
 */
export const REPORT_FORMAT_MATRIX: Record<PayrollReportKey, readonly ReportFormat[]> = {
  payroll_register:            ['preview', 'xlsx', 'csv', 'pdf'],
  net_pay_summary:             ['preview', 'xlsx', 'csv', 'pdf'],
  payroll_cost_analysis:       ['preview', 'xlsx', 'csv', 'pdf'],
  gross_to_net_reconciliation: ['preview', 'xlsx', 'csv', 'pdf'],
  variance_analysis:           ['preview', 'xlsx', 'csv', 'pdf'],
  overtime_allowance_analysis: ['preview', 'xlsx', 'csv', 'pdf'],
  population_movements:        ['preview', 'xlsx', 'csv', 'pdf'],
  nis_exceptions:              ['preview', 'xlsx', 'csv', 'pdf'],
  export_audit_package:        ['zip'],
} as const;

export function isFormatAllowed(report: PayrollReportKey, format: ReportFormat): boolean {
  return REPORT_FORMAT_MATRIX[report].includes(format);
}

// ── Per-key request params (§5A2) — `params.report` is the SOLE discriminant ──
const uuid = z.string().uuid();
/** departments.id is the canonical TEXT key; app_users.id is TEXT. */
const textId = z.string().min(1);
/** YYYY-MM; to ≥ from and span ≤ 24 months are 422 checks in the engine. */
const Period = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}$/, 'from must be YYYY-MM'),
    to: z.string().regex(/^\d{4}-\d{2}$/, 'to must be YYYY-MM'),
  })
  .strict();
export type Period = z.infer<typeof Period>;

export const reportParamsSchema = z.discriminatedUnion('report', [
  z.object({
    report: z.literal('payroll_register'),
    runId: uuid,
    departmentId: textId.optional(),
    payGroupId: uuid.optional(),
  }).strict(),
  z.object({
    report: z.literal('net_pay_summary'),
    runId: uuid,
    groupBy: z.enum(['pay_group', 'department', 'cost_centre']).optional(),
  }).strict(),
  z.object({
    report: z.literal('payroll_cost_analysis'),
    period: Period,
    groupBy: z.enum(['department_cost_centre', 'pay_group']).optional(),
    include: z.enum(['gross_net_employer', 'gross_net']).optional(),
  }).strict(),
  z.object({
    report: z.literal('gross_to_net_reconciliation'),
    runId: uuid,
    // Phase A: 'outputs' only (run header totals vs SUM of run lines — exact,
    // zero-tolerance integrity check). 'gl' reconciliation is DEC-RPT-035 Phase-B
    // (needs the confirmed component→GL-account mapping + journal-per-run linkage;
    // not guessed). Field kept for forward-compat.
    compareAgainst: z.literal('outputs').optional(),
  }).strict(),
  z.object({
    report: z.literal('variance_analysis'),
    runId: uuid,
    compareRunId: uuid.optional(), // omit ⇒ prior released; if set, must ≠ runId (422)
  }).strict(),
  z.object({
    report: z.literal('overtime_allowance_analysis'),
    period: Period,
    groupBy: z.enum(['department', 'cost_centre', 'pay_group']).optional(),
    thresholdMode: z.enum(['all', 'exceptions']).optional(),
  }).strict(),
  z.object({
    report: z.literal('population_movements'),
    period: Period,
    // Phase A: hires/leavers/leave only. `transfers` is a Phase-B gap — there is
    // no first-class HR transfer source table yet, and deriving it from
    // department-change history is explicitly out of scope. Do NOT re-add
    // 'transfers' here until the HR transfer model exists.
    movementType: z.enum(['all', 'hires_leavers', 'leave']).optional(),
    evidenceStatus: z.enum(['all', 'missing', 'verified']).optional(),
  }).strict(),
  z.object({
    report: z.literal('nis_exceptions'),
    scope: z.enum(['run', 'all']),
    runId: uuid.optional(), // required iff scope='run'; forbidden iff 'all' (422)
    status: z.enum(['open', 'all']).optional(),
    ownerId: textId.optional(),
  }).strict(),
  z.object({
    report: z.literal('export_audit_package'),
    runId: uuid,
    include: z.enum(['full', 'exports', 'decisions']).optional(),
  }).strict(),
]);

/** The report param union — the UI form and the route zod share THIS definition. */
export type ReportParams = z.infer<typeof reportParamsSchema>;
/** Alias kept for the contract's naming (§5A2). */
export const reportDefinitions = reportParamsSchema;

export type InteractiveReportParams = Exclude<ReportParams, { report: 'export_audit_package' }>;
export type AuditPackageParams = Extract<ReportParams, { report: 'export_audit_package' }>;

/** Non-blank idempotency key, 8..128 chars (required for every file export). */
export const fileIdempotencyKey = z.string().min(8).max(128).refine(
  s => s.trim().length >= 8,
  'idempotency key must be non-blank (8..128 chars)',
);

// ── Server-derived record/output authorization (§5C) ─────────────────────────
export interface ReportPermissionRequirements {
  requiresViewAll: boolean; // employee-level rows or identifiers
  requiresExport: boolean;  // any downloadable file, including employee exports
}

/** Reports whose rows expose employee-level data/identifiers (need view_all). */
export const EMPLOYEE_LEVEL_REPORTS: ReadonlySet<PayrollReportKey> = new Set([
  'payroll_register',
  'net_pay_summary',
  'nis_exceptions',
  'population_movements',
]);

/**
 * The SERVER derives these from report + format; the client cannot supply them.
 * requiresExport ⇔ the output is a downloadable file (any non-preview format).
 * requiresViewAll ⇔ the report is employee-level (rows/identifiers per person).
 */
export function deriveReportRequirements(
  report: PayrollReportKey,
  format: ReportFormat,
): ReportPermissionRequirements {
  return {
    requiresViewAll: EMPLOYEE_LEVEL_REPORTS.has(report),
    requiresExport: format !== 'preview',
  };
}

// ── Frozen output contracts (§5B) ────────────────────────────────────────────
export interface ReportControlTotals {
  employees: number;
  gross: MoneyValue;
  deductions: MoneyValue;
  net: MoneyValue;
}

/** Unit-aware chart series so the FE can tell TTD from counts/hours/percent. */
export interface ChartSeries {
  label: string;
  unit: 'TTD' | 'count' | 'hours' | 'percent';
  points: { x: string; y: number }[];
}
export interface ReportChart {
  scopeId: string;
  series: ChartSeries[];
}

export interface RegisterRow {
  employeeId: string;
  employeeName: string;
  payGroup: string;
  gross: MoneyValue;
  paye: MoneyValue;
  nis: MoneyValue;
  other: MoneyValue;
  net: MoneyValue;
}
export interface NetPaySummaryRow {
  group: string;
  employees: number;
  gross: MoneyValue;
  deductions: MoneyValue;
  net: MoneyValue;
  readiness: 'ready' | 'held' | 'review';
}
export interface CostRow {
  department: string;
  costCentre: string;
  employees: number;
  gross: MoneyValue;
  employerCost: MoneyValue;
  vsPriorPct: number;
}
/** Variance money uses MoneyValue via a discriminated value (§5B / R5-4). */
export type VarianceValue =
  | { unit: 'money'; prior: MoneyValue; current: MoneyValue }
  | { unit: 'count' | 'hours' | 'percent'; prior: number; current: number };
export interface VarianceRow {
  measure: string;
  value: VarianceValue;
  changePct: number;
  driver: string;
  certified: boolean;
}
export interface OvertimeRow {
  department: string;
  employees: number;
  overtimeHours: number;
  overtimeCost: MoneyValue;
  allowanceCost: MoneyValue;
  controlStatus: 'approved' | 'threshold' | 'review';
}
export interface PopulationMovementRow {
  employeeId: string;
  employeeName: string;
  // Phase A: no 'transfer' — no first-class HR transfer source yet (Phase-B gap).
  movement: 'hire' | 'unpaid_leave' | 'leaver';
  effectiveDate: string;
  priorAssignment: string;
  currentAssignment: string;
  payrollImpact: string;
  evidence: string;
}
export interface NisExceptionRow {
  employeeId: string;
  employeeName: string;
  nisNumber: string | null;
  nisClass: string;
  profileStatus: 'unverified' | 'continuity_review';
  payrollImpact: string;
  owner: string;
}
/** Statutory reconciliation is EXACT: balanced iff every source difference.amount === 0. */
export interface ReconciliationSource {
  source: string;
  registerTotal: MoneyValue;
  summaryTotal: MoneyValue;
  difference: MoneyValue;
  matched: boolean; // difference.amount === 0
  evidenceRef: string;
}
export interface ReconciliationResult {
  scopeId: string;
  currency: 'TTD';
  balanced: boolean; // every source matched (zero tolerance, no policy)
  sources: ReconciliationSource[];
}

/** Completed interactive (preview) result — export_audit_package is queue-only. */
export type ReportCompletedData =
  | { report: 'payroll_register'; rows: RegisterRow[]; totals: ReportControlTotals }
  | { report: 'net_pay_summary'; rows: NetPaySummaryRow[]; totals: ReportControlTotals }
  | { report: 'payroll_cost_analysis'; rows: CostRow[]; chart: ReportChart; totals: ReportControlTotals }
  | { report: 'gross_to_net_reconciliation'; reconciliation: ReconciliationResult }
  | { report: 'variance_analysis'; rows: VarianceRow[]; chart: ReportChart }
  | { report: 'overtime_allowance_analysis'; rows: OvertimeRow[]; chart: ReportChart }
  | { report: 'population_movements'; rows: PopulationMovementRow[] }
  | { report: 'nis_exceptions'; rows: NisExceptionRow[] };

export type ReportRunResult =
  | { state: 'queued'; jobId: string }
  | ({ state: 'completed'; scopeId: string; generatedAt: string } & ReportCompletedData);

export interface ReportArtifactRow {
  id: string;
  reportKey: PayrollReportKey;
  scopeId: string;
  format: ReportArtifactFormat;
  byteSize: number;
  sha256: string;
  rowCount: number;
  retentionClass: string;
  retentionExpiresAt: string;
  requiresViewAll: boolean;
  requiresExport: boolean;
  status: 'ready' | 'purging' | 'purged';
  createdBy: string;
  createdAt: string;
}

/** State-discriminated job status (§5B / R6-6). */
export type ReportJobStatus =
  | { state: 'queued'; jobId: string; queuedAt: string }
  | { state: 'running'; jobId: string; startedAt: string; leaseExpiresAt: string }
  | { state: 'succeeded'; jobId: string; completedAt: string; artifact: ReportArtifactRow }
  | { state: 'failed'; jobId: string; failedAt: string; error: { code: string; message: string; retryable: boolean } };

// ── Catalog + KPI tiles ──────────────────────────────────────────────────────
export interface ReportCatalogEntry {
  key: PayrollReportKey;
  label: string;
  description: string;
  category: 'operational' | 'financial' | 'statutory' | 'workforce';
  /** Formats this caller may actually run (matrix ∩ caller's export permission). */
  supportedFormats: ReportFormat[];
  /** Parameter shape hint the UI form renders (period-based vs single-run vs scoped). */
  paramKind: 'single_run' | 'period' | 'two_run' | 'nis_scope';
  requiresViewAll: boolean; // employee-level report
  requiresExport: boolean;  // true when only file formats are offered (audit package)
}

/** Denied/inapplicable KPI tile → {value:null, available:false}; never a fake 0. */
export interface ReportKpiTile {
  value: number | null;
  available: boolean;
}
export interface ReportKpiTiles {
  availableReports: ReportKpiTile;
  generatedThisMonth: ReportKpiTile;
  nisExceptions: ReportKpiTile;
  materialVariances: ReportKpiTile; // Phase A: always {value:null, available:false}
  auditPackages: ReportKpiTile;
}

// ── Response envelopes (the exact shapes the FE consumes) ────────────────────
export interface ReportCatalogResponse {
  reports: ReportCatalogEntry[];
}
export interface PageResult<T> {
  rows: T[];
  nextCursor: string | null;
}
export type ReportHistoryResponse = PageResult<ReportArtifactRow>;
export interface ReportDownloadResponse {
  url: string;
  expiresAt: string; // server issue time + 120 seconds
}
