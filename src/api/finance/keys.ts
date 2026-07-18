/**
 * src/api/finance/keys.ts
 *
 * Single source of TanStack Query cache-key truth for the Finance module.
 * Every hook and mutation in src/api/finance/* uses these factories.
 * Every invalidation targets one of these shapes — no ad-hoc ['finance',…] literals.
 *
 * Key hierarchy:
 *   ['finance', 'overview', ...]            — Finance Overview dashboard
 *   ['finance', 'ap', 'vendors', ...]       — AP vendor register + detail
 *   ['finance', 'ap', 'bills', ...]         — AP bills list + detail
 *   ['finance', 'ap', 'payments', ...]      — AP payments register
 *   ['finance', 'ap', 'kpis']              — AP KPI aggregates
 *   ['finance', 'ap', 'aging']             — AP aging buckets
 *   ['finance', 'ap', 'trend']             — AP monthly trend
 *   ['finance', 'ap', 'payment-runs', ...] — AP payment runs
 *   ['finance', 'ap', 'duplicate-risks']   — AP duplicate risk queue
 *   ['finance', 'pickers', ...]            — Finance picker lists (GL / cost-centre / tax / terms)
 */

import type { ApBillFilters } from './accountsPayable';

export const financeQueryKeys = {
  // ── Broad base keys for bulk invalidation ────────────────────────────────────
  /** Invalidates ALL Finance data (overview + AP). */
  base:                   () => ['finance'] as const,
  /** Invalidates all AP sub-keys (vendors / bills / payments / kpis / etc.). */
  apBase:                 () => ['finance', 'ap'] as const,
  /** Invalidates all Overview sub-keys. */
  overviewBase:           () => ['finance', 'overview'] as const,

  // ── Finance Overview ──────────────────────────────────────────────────────────
  overview:               () => ['finance', 'overview'] as const,
  overviewData:           () => ['finance', 'overview', 'data'] as const,
  overviewKpiDrilldown:   (kpiType: string, period?: string) =>
                            ['finance', 'overview', 'kpi-drilldown', kpiType, period ?? 'mtd'] as const,
  overviewApprovalsQueue: (filters?: Record<string, unknown>) =>
                            ['finance', 'overview', 'approvals', filters ?? {}] as const,
  overviewExport:         () => ['finance', 'overview', 'export'] as const,

  // ── AP Vendors ───────────────────────────────────────────────────────────────
  apVendors:              (filters?: Record<string, unknown>) =>
                            ['finance', 'ap', 'vendors', filters ?? {}] as const,
  apVendor:               (id: string) => ['finance', 'ap', 'vendor', id] as const,
  apVendorBills:          (vendorId: string) => ['finance', 'ap', 'vendor', vendorId, 'bills'] as const,
  apVendorPayments:       (vendorId: string) => ['finance', 'ap', 'vendor', vendorId, 'payments'] as const,

  // ── AP Bills ─────────────────────────────────────────────────────────────────
  apBills:                (filters?: ApBillFilters) =>
                            ['finance', 'ap', 'bills', filters ?? {}] as const,
  apBill:                 (id: string) => ['finance', 'ap', 'bill', id] as const,
  apBillAttachments:      (billId: string) => ['finance', 'ap', 'bill', billId, 'attachments'] as const,
  apBillComments:         (billId: string) => ['finance', 'ap', 'bill', billId, 'comments'] as const,

  // ── AP Payments ──────────────────────────────────────────────────────────────
  apPayments:             (filters?: Record<string, unknown>) =>
                            ['finance', 'ap', 'payments', filters ?? {}] as const,

  // ── AP Aggregates ────────────────────────────────────────────────────────────
  apKpis:                 () => ['finance', 'ap', 'kpis'] as const,
  apAging:                () => ['finance', 'ap', 'aging'] as const,
  apTrend:                () => ['finance', 'ap', 'trend'] as const,

  // ── AP Payment Runs ──────────────────────────────────────────────────────────
  apPaymentRuns:          (filters?: Record<string, unknown>) =>
                            ['finance', 'ap', 'payment-runs', filters ?? {}] as const,
  apPaymentRun:           (id: string) => ['finance', 'ap', 'payment-run', id] as const,

  // ── AP Duplicate Risks ───────────────────────────────────────────────────────
  apDuplicateRisks:       () => ['finance', 'ap', 'duplicate-risks'] as const,

  // ── Finance Pickers (GL-account / cost-centre / tax-code / payment-terms / vendor) ─
  pickers:                () => ['finance', 'pickers'] as const,
  pickerGlAccounts:       (search?: string) => ['finance', 'pickers', 'gl-accounts', search ?? ''] as const,
  pickerCostCentres:      (search?: string) => ['finance', 'pickers', 'cost-centres', search ?? ''] as const,
  pickerTaxCodes:         () => ['finance', 'pickers', 'tax-codes'] as const,
  pickerPaymentTerms:     () => ['finance', 'pickers', 'payment-terms'] as const,
  pickerVendors:          (search?: string) => ['finance', 'pickers', 'vendors', search ?? ''] as const,

  // ── Finance 2B Lookup Pickers ─────────────────────────────────────────────
  pickerEmployees:         (search?: string) =>
                             ['finance', 'pickers', 'employees', search ?? ''] as const,
  pickerApprovedRuns:      (search?: string) =>
                             ['finance', 'pickers', 'approved-runs', search ?? ''] as const,
  pickerAuthorities:       () => ['finance', 'pickers', 'authorities'] as const,
  pickerBudgetCategories:  (search?: string) =>
                             ['finance', 'pickers', 'budget-categories', search ?? ''] as const,

  // ── Finance 2B Lookup — employee name resolver ────────────────────────────
  /** Key is sorted, comma-joined id list so the same set always hits the same cache entry. */
  lookupEmployeeNames:     (sortedIds: readonly string[]) =>
                             ['finance', 'lookups', 'employee-names', sortedIds.join(',')] as const,

  // ── Finance 2B Module roots — Remittances ─────────────────────────────────
  remittancesBase:         () => ['finance', 'remittances'] as const,
  remittances:             (filters?: Record<string, unknown>) =>
                             ['finance', 'remittances', 'list', filters ?? {}] as const,
  remittance:              (id: string) => ['finance', 'remittances', id] as const,
  remittanceLines:         (id: string) => ['finance', 'remittances', id, 'lines'] as const,
  remittanceAttachments:   (id: string) => ['finance', 'remittances', id, 'attachments'] as const,

  // ── Finance 2B Module roots — Disbursements ───────────────────────────────
  disbursementsBase:       () => ['finance', 'disbursements'] as const,
  disbursements:           (filters?: Record<string, unknown>) =>
                             ['finance', 'disbursements', 'list', filters ?? {}] as const,
  disbursement:            (id: string) => ['finance', 'disbursements', id] as const,
  disbursementLines:       (id: string) => ['finance', 'disbursements', id, 'lines'] as const,
  disbursementAttachments: (id: string) => ['finance', 'disbursements', id, 'attachments'] as const,

  // ── Finance 2B Module roots — Expenses ────────────────────────────────────
  expensesBase:            () => ['finance', 'expenses'] as const,
  expenses:                (filters?: Record<string, unknown>) =>
                             ['finance', 'expenses', 'list', filters ?? {}] as const,
  expense:                 (id: string) => ['finance', 'expenses', id] as const,
  expenseLines:            (id: string) => ['finance', 'expenses', id, 'lines'] as const,
  expenseAttachments:      (id: string) => ['finance', 'expenses', id, 'attachments'] as const,

  // ── Finance 2B Module roots — Budgets ─────────────────────────────────────
  budgetsBase:             () => ['finance', 'budgets'] as const,
  budgets:                 (filters?: Record<string, unknown>) =>
                             ['finance', 'budgets', 'list', filters ?? {}] as const,
  budget:                  (id: string) => ['finance', 'budgets', id] as const,
  budgetVariance:          (fiscalYear?: number) =>
                             ['finance', 'budgets', 'variance', fiscalYear ?? 'all'] as const,
  budgetAttachments:       (id: string) => ['finance', 'budgets', id, 'attachments'] as const,

  // ── Finance 2B Module roots — Payroll (extends existing ap-adjacent keys) ─
  payrollRunsBase:         () => ['finance', 'payroll', 'runs'] as const,
  payrollRuns:             (filters?: Record<string, unknown>) =>
                             ['finance', 'payroll', 'runs', 'list', filters ?? {}] as const,
  payrollRun:              (id: string) => ['finance', 'payroll', 'runs', id] as const,
  payrollRunLines:         (id: string) => ['finance', 'payroll', 'runs', id, 'lines'] as const,
  payrollRunWarnings:      (id: string) => ['finance', 'payroll', 'runs', id, 'warnings'] as const,
  payrollRunInputs:        (id: string) => ['finance', 'payroll', 'runs', id, 'inputs'] as const,
  payrollPayslips:         (runId: string) =>
                             ['finance', 'payroll', 'runs', runId, 'payslips'] as const,
  payrollExports:          (runId: string) =>
                             ['finance', 'payroll', 'runs', runId, 'exports'] as const,
  payrollAttachments:      (runId: string) =>
                             ['finance', 'payroll', 'runs', runId, 'attachments'] as const,

  // ── Finance 2B Module roots — Statutory ───────────────────────────────────
  statutoryBase:           () => ['finance', 'statutory'] as const,
  statutoryVersions:       (filters?: Record<string, unknown>) =>
                             ['finance', 'statutory', 'versions', filters ?? {}] as const,
  statutoryVersion:        (id: string) => ['finance', 'statutory', 'versions', id] as const,
  nisClasses:              (versionId: string) =>
                             ['finance', 'statutory', 'versions', versionId, 'nis-classes'] as const,

  // ── Finance 2B Bridges (cross-module bridge mutations) ───────────────────
  // Bridges are mutations so they don't have their own query cache.
  // These keys are used for cache invalidation after bridge creation.
  bridgeDisbursement:      (runId: string) =>
                             ['finance', 'bridges', 'disbursement', runId] as const,
  bridgeRemittance:        (runId: string, authority: string) =>
                             ['finance', 'bridges', 'remittance', runId, authority] as const,
  bridgeReimbursement:     (claimId: string) =>
                             ['finance', 'bridges', 'reimbursement', claimId] as const,
} as const;
