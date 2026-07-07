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
} as const;
