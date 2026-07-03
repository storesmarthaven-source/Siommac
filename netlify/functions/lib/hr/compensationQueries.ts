// ============================================================================
// HR Compensation Queries — read-side for hr_employee_pay_items
// ============================================================================

import { sb } from '../db';
import { toPayItemDto, type PayItemDto, type DbPayItemRow } from './compensationCore';
export type { PayItemDto, DbPayItemRow } from './compensationCore';

export interface ListPayItemsOpts {
  employeeId?: string;
  status?: string;
  activeOnly?: boolean;
  componentId?: string;
}

export async function listPayItems(opts: ListPayItemsOpts = {}): Promise<PayItemDto[]> {
  let q = sb.from('hr_employee_pay_items').select('*')
    .order('created_at', { ascending: false });
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.activeOnly) q = q.eq('is_active', true);
  if (opts.componentId) q = q.eq('component_id', opts.componentId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listPayItems: ' + error.message), { status: 500 });
  return ((data ?? []) as DbPayItemRow[]).map(toPayItemDto);
}

export async function getPayItem(id: string): Promise<PayItemDto | null> {
  const { data, error } = await sb.from('hr_employee_pay_items')
    .select('*').eq('id', id).maybeSingle<DbPayItemRow>();
  if (error) throw Object.assign(new Error('getPayItem: ' + error.message), { status: 500 });
  return data ? toPayItemDto(data) : null;
}

/** Report: all pay items with basic fields for the compensation register. */
export interface PayItemReportRow {
  id: string;
  itemNo: string | null;
  employeeId: string;
  componentId: string;
  amount: number | null;
  percent: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  isActive: boolean;
  createdAt: string;
}

export async function listPayItemsReport(opts: { employeeId?: string; status?: string } = {}): Promise<PayItemReportRow[]> {
  let q = sb.from('hr_employee_pay_items')
    .select('id, item_no, employee_id, component_id, amount, percent, effective_from, effective_to, status, is_active, created_at')
    .order('created_at', { ascending: false });
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listPayItemsReport: ' + error.message), { status: 500 });
  return ((data ?? []) as { id: string; item_no: string | null; employee_id: string; component_id: string; amount: number | null; percent: number | null; effective_from: string; effective_to: string | null; status: string; is_active: boolean; created_at: string }[]).map(r => ({
    id: r.id,
    itemNo: r.item_no,
    employeeId: r.employee_id,
    componentId: r.component_id,
    amount: r.amount !== null ? Number(r.amount) : null,
    percent: r.percent !== null ? Number(r.percent) : null,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    status: r.status,
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
}
