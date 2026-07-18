/**
 * Lightweight shared Finance picker data.
 *
 * Cost centres remain part of payroll, remittance, disbursement, and expense
 * allocation. Accounting-only GL, supplier, tax, and payment-term pickers were
 * retired with Accounts Payable and Budgeting.
 */

import { sb } from '../db';

export interface CostCentreOption {
  id: string;
  code: string;
  name: string;
  department?: string | null;
}

export async function listCostCentres(search?: string): Promise<CostCentreOption[]> {
  let query = sb
    .from('finance_cost_centers')
    .select('id, code, name, department_id')
    .eq('is_active', true)
    .order('code', { nullsFirst: false });

  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(50);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  return (data ?? []).map(row => ({
    id: row.id as string,
    code: (row.code ?? '') as string,
    name: row.name as string,
    department: (row.department_id ?? null) as string | null,
  }));
}
