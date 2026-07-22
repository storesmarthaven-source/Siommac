// types/payrollPayslipBatches.ts
// SHARED contract for the Payslip Batches register (spec §15.5, F-10). Imported by BOTH the
// Netlify route (validation) and the FE api client. ONE camelCase contract.
//
// There is NO separate "batch" entity: a payslip batch IS a locked payroll run's payslip set
// (one governed batch per locked source + template snapshot). So `id` = the run id and
// `reference` = the run_no; counts are aggregated from finance_payslips (generated = row exists,
// rendered = file_path set) and finance_payslip_deliveries (delivered = latest 'sent', failed =
// latest 'failed'). No fabricated batch numbers.
//
// Endpoints in this slice (all POST, behind requirePermission finance.payroll.view_all):
//   finance/payroll/payslip-batches/list   — the batch register (page + tab counts + aggregates)

export type PayslipBatchLifecycle = 'scheduled' | 'active' | 'attention' | 'completed';
export type PayslipBatchTab = 'all' | 'active' | 'attention' | 'scheduled' | 'completed';

/** Per-batch payslip counts, all derived from the run's payslips + deliveries. */
export interface PayslipBatchCounts {
  generated: number;   // payslip rows for the run
  rendered: number;    // payslips with a rendered PDF (file_path set)
  delivered: number;   // payslips whose latest delivery is 'sent'
  failed: number;      // payslips whose latest delivery is 'failed' (and not later sent)
}

export interface PayslipBatchListItem {
  /** The run id — a batch is a locked run's payslip set (no separate batch entity). */
  id: string;
  /** The run_no — used as the batch reference. */
  reference: string;
  runState: string;
  payGroup: { id: string | null; name: string | null };
  payDate: string | null;
  /** The pinned render template for the run (name + approval status), resolved — never a raw id. */
  template: { id: string | null; name: string | null; status: string | null };
  counts: PayslipBatchCounts;
  lifecycle: PayslipBatchLifecycle;
  lifecycleLabel: string;
  owner: { id: string | null; name: string | null };
  createdAt: string;
  updatedAt: string;
}

/** Register-scoped KPI aggregates over the FULL filtered set (not just the page). */
export interface PayslipBatchAggregates {
  activeBatches: number;   // lifecycle in (scheduled, active, attention)
  rendered: number;        // Σ rendered
  delivered: number;       // Σ delivered
  failed: number;          // Σ failed
}

export interface PayslipBatchListRequest {
  limit?: number;          // 1..100, default 25 (offset paging)
  offset?: number;         // default 0
  tab?: PayslipBatchTab;
  search?: string;         // run_no or pay group (ilike)
  periodFrom?: string;     // YYYY-MM-DD inclusive (period_end >= from)
  periodTo?: string;       // YYYY-MM-DD inclusive (period_start <= to)
  payGroupIds?: string[];
}

export interface PayslipBatchListResult {
  items: PayslipBatchListItem[];
  total: number;
  tabCounts: Record<PayslipBatchTab, number>;
  aggregates: PayslipBatchAggregates;
  asOf: string;
}
