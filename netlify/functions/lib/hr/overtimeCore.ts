// ============================================================================
// HR Overtime Core — types, DTOs, and helpers
// ============================================================================
// Manages hr_overtime_entries. Employee submits own OT; manager/HR approve.
// Rejected OT never enters payroll. Approved OT can. Paid OT is immutable.
//
// Lifecycle: submitted → approved / rejected / cancelled / paid
// ============================================================================

export type OvertimeStatus = 'submitted' | 'approved' | 'rejected' | 'paid' | 'cancelled';

export interface OvertimeEntryDto {
  id: string;
  overtimeNo: string | null;
  employeeId: string;
  workDate: string;
  hours: number;
  multiplier: number;
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
