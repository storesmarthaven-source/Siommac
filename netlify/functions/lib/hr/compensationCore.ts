// ============================================================================
// HR Compensation Core — types, DTOs, and helpers
// ============================================================================
// Manages hr_employee_pay_items. HR-owned; only active Finance components may
// be used. Retire-never-delete. Approval-gated via central workflow engine.
//
// Lifecycle: draft → pending_approval → active / rejected / retired
// ============================================================================

export type PayItemStatus = 'draft' | 'pending_approval' | 'active' | 'rejected' | 'retired';

export interface PayItemDto {
  id: string;
  itemNo: string | null;
  employeeId: string;
  componentId: string;
  amount: number | null;
  percent: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: PayItemStatus;
  workflowId: string | null;
  isActive: boolean;
  note: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DbPayItemRow {
  id: string;
  item_no: string | null;
  employee_id: string;
  component_id: string;
  amount: number | null;
  percent: number | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  workflow_id: string | null;
  is_active: boolean;
  note: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  retired_by: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toPayItemDto(r: DbPayItemRow): PayItemDto {
  return {
    id: r.id,
    itemNo: r.item_no,
    employeeId: r.employee_id,
    componentId: r.component_id,
    amount: r.amount !== null ? Number(r.amount) : null,
    percent: r.percent !== null ? Number(r.percent) : null,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    status: r.status as PayItemStatus,
    workflowId: r.workflow_id,
    isActive: r.is_active,
    note: r.note,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    retiredBy: r.retired_by,
    retiredAt: r.retired_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
