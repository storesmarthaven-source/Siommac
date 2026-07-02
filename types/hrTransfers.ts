/**
 * types/hrTransfers.ts
 *
 * Shared camelCase DTO for HR Transfers & Promotions. Imported by both the
 * backend route (routes/hr.ts) and the frontend API client (src/api/hr/transfers.ts).
 * No per-endpoint mappers — one contract, one definition.
 */

/** The bundle of fields that can be changed in a transfer/promotion request. */
export interface TransferPromotionValue {
  departmentId?:  string | null;
  siteId?:        string | null;
  positionId?:    string | null;
  supervisorId?:  string | null;
  role?:          string | null;
  monthlySalary?: number | null;
  hourlyRate?:    number | null;
  /** Required — the date the change takes effect (YYYY-MM-DD). */
  effectiveDate:  string;
  reason?:        string | null;
}

export type TransferStatus =
  | 'submitted'
  | 'in_review'
  | 'returned'
  | 'applied'
  | 'rejected'
  | 'cancelled';

/** A transfer/promotion change request row (as returned by /transfers/list). */
export interface TransferRequestRow {
  id:              string;
  changeNo:        string;
  employeeId:      string;
  employeeName:    string | null;
  requestedBy:     string;
  requestedByName: string | null;
  status:          TransferStatus;
  effectiveDate:   string | null;
  previousValue:   TransferPromotionValue | Record<string, unknown>;
  requestedValue:  TransferPromotionValue;
  reason:          string | null;
  requestedAt:     string;
  decidedAt:       string | null;
  appliedAt:       string | null;
  workflowId:      string | null;
}

/** Args for the /transfers/request endpoint. */
export interface SubmitTransferArgs extends TransferPromotionValue {
  employeeId: string;
}

/** Result of a successful submit. */
export interface SubmitTransferResult {
  id:        string;
  changeNo:  string;
}

/** Args for decide (approve/reject/return). */
export interface DecideTransferArgs {
  requestId: string;
  decision:  'approve' | 'reject' | 'return';
  comment?:  string;
}

/** Result of a decide action. */
export interface DecideTransferResult {
  requestId: string;
  status:    string;
}
