/**
 * Canonical TanStack Query cache keys for active Finance capabilities.
 * Accounts Payable, Budgeting, and the retired combined Finance Overview have
 * no cache-key surface.
 */

export const financeQueryKeys = {
  // ── Broad base keys for bulk invalidation ────────────────────────────────────
  /** Invalidates ALL Finance data. */
  base:                   () => ['finance'] as const,
  // Shared Finance pickers
  pickers:                () => ['finance', 'pickers'] as const,
  pickerCostCentres:      (search?: string) => ['finance', 'pickers', 'cost-centres', search ?? ''] as const,

  // Finance lookup pickers
  pickerEmployees:         (search?: string) =>
                             ['finance', 'pickers', 'employees', search ?? ''] as const,
  pickerApprovedRuns:      (search?: string) =>
                             ['finance', 'pickers', 'approved-runs', search ?? ''] as const,
  pickerAuthorities:       () => ['finance', 'pickers', 'authorities'] as const,
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
