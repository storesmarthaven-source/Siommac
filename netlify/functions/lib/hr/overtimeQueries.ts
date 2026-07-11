// ============================================================================
// HR Overtime Queries — read-side for hr_overtime_entries
// ============================================================================

import { sb } from '../db';
import { toOvertimeDto, type OvertimeEntryDto, type DbOvertimeRow } from './overtimeCore';
export type { OvertimeEntryDto, DbOvertimeRow } from './overtimeCore';

export interface ListOvertimeOpts {
  employeeId?: string;
  status?: string;
  workDateFrom?: string;
  workDateTo?: string;
  payrollRunId?: string;
}

export async function listOvertimeEntries(opts: ListOvertimeOpts = {}): Promise<OvertimeEntryDto[]> {
  let q = sb.from('hr_overtime_entries').select('*')
    .order('work_date', { ascending: false });
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.workDateFrom) q = q.gte('work_date', opts.workDateFrom);
  if (opts.workDateTo) q = q.lte('work_date', opts.workDateTo);
  if (opts.payrollRunId) q = q.eq('payroll_run_id', opts.payrollRunId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listOvertimeEntries: ' + error.message), { status: 500 });
  return ((data ?? []) as DbOvertimeRow[]).map(toOvertimeDto);
}

export async function getOvertimeEntry(id: string): Promise<OvertimeEntryDto | null> {
  const { data, error } = await sb.from('hr_overtime_entries')
    .select('*').eq('id', id).maybeSingle<DbOvertimeRow>();
  if (error) throw Object.assign(new Error('getOvertimeEntry: ' + error.message), { status: 500 });
  return data ? toOvertimeDto(data) : null;
}

/** Report: all OT entries with basic fields for the overtime register. */
export interface OvertimeReportRow {
  id: string;
  overtimeNo: string | null;
  employeeId: string;
  workDate: string;
  hours: number;
  multiplier: number;
  otType: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export async function listOvertimeReport(opts: { employeeId?: string; status?: string } = {}): Promise<OvertimeReportRow[]> {
  let q = sb.from('hr_overtime_entries')
    .select('id, overtime_no, employee_id, work_date, hours, multiplier, ot_type, status, approved_by, approved_at, created_at')
    .order('work_date', { ascending: false });
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listOvertimeReport: ' + error.message), { status: 500 });
  return ((data ?? []) as { id: string; overtime_no: string | null; employee_id: string; work_date: string; hours: number; multiplier: number; ot_type: string | null; status: string; approved_by: string | null; approved_at: string | null; created_at: string }[]).map(r => ({
    id: r.id,
    overtimeNo: r.overtime_no,
    employeeId: r.employee_id,
    workDate: r.work_date,
    hours: Number(r.hours),
    multiplier: Number(r.multiplier),
    otType: r.ot_type,
    status: r.status,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    createdAt: r.created_at,
  }));
}
