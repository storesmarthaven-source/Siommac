// ============================================================================
// HR Overtime Core — types, DTOs, and helpers
// ============================================================================
// Manages hr_overtime_entries. Employee submits own OT; manager/HR approve.
// Rejected OT never enters payroll. Approved OT can. Paid OT is immutable.
//
// Lifecycle: submitted → approved / rejected / cancelled / paid
// ============================================================================

export type OvertimeStatus = 'submitted' | 'approved' | 'rejected' | 'paid' | 'cancelled';

/**
 * Structured overtime classification. Mirrors finance_overtime_rules.event_type
 * (T&T norms). When set, the payroll rule engine resolves the authoritative
 * multiplier + minimum billable hours from the active rule at lock-inputs time;
 * the stored `multiplier` is only a fallback when no active rule matches the type.
 */
export type OvertimeType =
  | 'regular_overtime' | 'public_holiday' | 'rest_day' | 'callout' | 'night_shift';

export interface OvertimeEntryDto {
  id: string;
  overtimeNo: string | null;
  employeeId: string;
  workDate: string;
  hours: number;
  multiplier: number;
  otType: OvertimeType | null;
  reason: string | null;
  status: OvertimeStatus;
  workflowId: string | null;
  payrollRunId: string | null;
  payrollRunLineId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DbOvertimeRow {
  id: string;
  overtime_no: string | null;
  employee_id: string;
  work_date: string;
  hours: number;
  multiplier: number;
  ot_type: string | null;
  reason: string | null;
  status: string;
  workflow_id: string | null;
  payroll_run_id: string | null;
  payroll_run_line_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function toOvertimeDto(r: DbOvertimeRow): OvertimeEntryDto {
  return {
    id: r.id,
    overtimeNo: r.overtime_no,
    employeeId: r.employee_id,
    workDate: r.work_date,
    hours: Number(r.hours),
    multiplier: Number(r.multiplier),
    otType: (r.ot_type as OvertimeType | null) ?? null,
    reason: r.reason,
    status: r.status as OvertimeStatus,
    workflowId: r.workflow_id,
    payrollRunId: r.payroll_run_id,
    payrollRunLineId: r.payroll_run_line_id,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
