/**
 * types/hrLeave.ts
 *
 * Shared camelCase DTOs for the HR Leave & Absence module.
 * Imported by both backend (netlify/functions/lib/hr/leave*.ts) and
 * frontend (src/api/hr/leave.ts, src/components/sections/HR/LeaveOverview.tsx).
 */

// ── Enums / union types ──────────────────────────────────────────────────────

export type LeaveStatus    = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled';
export type LeaveUnit      = 'days' | 'hours';
export type AccrualCadence = 'none' | 'monthly' | 'annual';
export type AccrualKind    = 'accrual' | 'deduction' | 'release' | 'adjustment' | 'pending_reserve';
export type AppliesScope   = 'all' | 'role' | 'employment_type' | 'department';

// ── Core entity DTOs ─────────────────────────────────────────────────────────

export interface LeaveType {
  id:                 string;
  code:               string;
  label:              string;
  paid:               boolean;
  unit:               LeaveUnit;
  requiresAttachment: boolean;
  requiresApproval:   boolean;
  accrualRate:        number | null;
  accrualCadence:     AccrualCadence;
  maxCarryover:       number | null;
  appliesToScope:     AppliesScope;
  appliesToValue:     string | null;
  color:              string | null;
  isActive:           boolean;
  createdAt:          string;
  updatedAt:          string | null;
}

export interface LeaveRequest {
  id:           string;
  caseNo:       string;
  employeeId:   string;
  leaveTypeId:  string;
  leaveType?:   Pick<LeaveType, 'code' | 'label' | 'color' | 'unit'>;
  fromDate:     string;
  toDate:       string;
  unit:         LeaveUnit;
  days:         number | null;
  hours:        number | null;
  halfDay:      boolean;
  reason:       string | null;
  status:       LeaveStatus;
  workflowId:   string | null;
  departmentId: string | null;
  reviewedBy:   string | null;
  reviewedAt:   string | null;
  reviewNotes:  string | null;
  appliedAt:    string | null;
  cancelledBy:  string | null;
  cancelledAt:  string | null;
  metadata:     Record<string, unknown> | null;
  createdAt:    string;
  updatedAt:    string | null;
  // joined fields
  employeeName?: string;
}

export interface LeaveBalance {
  id:           string;
  employeeId:   string;
  leaveTypeId:  string;
  leaveType?:   Pick<LeaveType, 'code' | 'label' | 'color' | 'unit'>;
  year:         number;
  entitled:     number;
  accrued:      number;
  taken:        number;
  pending:      number;
  adjustment:   number;
  available:    number; // computed: accrued + adjustment - taken - pending
  createdAt:    string;
  updatedAt:    string | null;
}

export interface LeaveAccrual {
  id:              string;
  employeeId:      string;
  leaveTypeId:     string;
  year:            number;
  delta:           number;
  kind:            AccrualKind;
  idempotencyKey:  string;
  sourceRequestId: string | null;
  note:            string | null;
  createdBy:       string | null;
  createdAt:       string;
}

export interface LeaveAttachment {
  id:         string;
  requestId:  string;
  filePath:   string;
  fileName:   string;
  mimeType:   string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

// ── Composite / view types ───────────────────────────────────────────────────

export interface LeaveCalendarEntry {
  requestId:      string;
  employeeId:     string;
  employeeName:   string;
  leaveTypeCode:  string;
  leaveTypeLabel: string;
  color:          string | null;
  fromDate:       string;
  toDate:         string;
  days:           number | null;
  status:         LeaveStatus;
}

export interface LeaveStats {
  myPending:        number;
  myApproved:       number;
  teamPending:      number;
  totalDaysThisYear: number;
  pendingApprovals: number;
}

export interface LeaveListResult {
  rows:  LeaveRequest[];
  total: number;
  page:  number;
  pageSize: number;
}

// ── Mutation arg types ───────────────────────────────────────────────────────

export interface SubmitLeaveRequestArgs {
  employeeId:   string;
  leaveTypeId:  string;
  fromDate:     string;
  toDate:       string;
  unit?:        LeaveUnit;
  days?:        number | null;
  hours?:       number | null;
  halfDay?:     boolean;
  reason?:      string | null;
  departmentId?: string | null;
  /** Required when an approval binding exists (atomic create-and-start idempotency). */
  idempotencyKey?: string;
}

export interface UpdateLeaveRequestArgs {
  requestId:  string;
  reason?:    string | null;
  fromDate?:  string;
  toDate?:    string;
  days?:      number | null;
  hours?:     number | null;
}

export interface CancelLeaveRequestArgs {
  requestId: string;
  reason?:   string | null;
}

export interface ApproveLeaveArgs {
  requestId:    string;
  reviewNotes?: string | null;
}

export interface RejectLeaveArgs {
  requestId:   string;
  reviewNotes: string;
}

export interface AdjustBalanceArgs {
  employeeId:   string;
  leaveTypeId:  string;
  year:         number;
  delta:        number;
  reason:       string;
}

// ── Query arg types ──────────────────────────────────────────────────────────

export interface LeaveListArgs {
  employeeId?:  string;
  departmentId?: string;
  statuses?:    LeaveStatus[];
  fromDate?:    string;
  toDate?:      string;
  leaveTypeId?: string;
  page?:        number;
  pageSize?:    number;
}

export interface CalendarArgs {
  fromDate:     string;
  toDate:       string;
  departmentId?: string;
}

export interface RunAccrualsArgs {
  period:       string; // e.g. '2026-07' for monthly, '2026' for annual
  leaveTypeId?: string;
}

export interface LeaveReportArgs {
  reportKey:     string;
  dateFrom?:     string;
  dateTo?:       string;
  departmentId?: string;
  page?:         number;
  pageSize?:     number;
}

// ── Submit result ────────────────────────────────────────────────────────────

export interface SubmitLeaveResult {
  requestId: string;
  caseNo:    string;
  status:    LeaveStatus;
}
