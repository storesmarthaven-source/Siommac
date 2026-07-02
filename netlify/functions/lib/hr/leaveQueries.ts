// lib/hr/leaveQueries.ts — HR Leave read queries

import { sb } from '../db';
import type {
  LeaveRequest, LeaveBalance, LeaveCalendarEntry, LeaveStats,
  LeaveListArgs, LeaveListResult, CalendarArgs,
} from '../../../../types/hrLeave';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

function mapRequest(r: Record<string, unknown>): LeaveRequest {
  return {
    id:           r.id as string,
    caseNo:       r.case_no as string,
    employeeId:   r.employee_id as string,
    leaveTypeId:  r.leave_type_id as string,
    leaveType:    r.hr_leave_types
      ? {
          code:  (r.hr_leave_types as Record<string, unknown>).code as string,
          label: (r.hr_leave_types as Record<string, unknown>).label as string,
          color: ((r.hr_leave_types as Record<string, unknown>).color as string | null) ?? null,
          unit:  (r.hr_leave_types as Record<string, unknown>).unit as 'days' | 'hours',
        }
      : undefined,
    fromDate:     r.from_date as string,
    toDate:       r.to_date as string,
    unit:         r.unit as 'days' | 'hours',
    days:         r.days != null ? Number(r.days) : null,
    hours:        r.hours != null ? Number(r.hours) : null,
    halfDay:      r.half_day as boolean,
    reason:       (r.reason as string | null) ?? null,
    status:       r.status as LeaveRequest['status'],
    workflowId:   (r.workflow_id as string | null) ?? null,
    departmentId: (r.department_id as string | null) ?? null,
    reviewedBy:   (r.reviewed_by as string | null) ?? null,
    reviewedAt:   (r.reviewed_at as string | null) ?? null,
    reviewNotes:  (r.review_notes as string | null) ?? null,
    appliedAt:    (r.applied_at as string | null) ?? null,
    cancelledBy:  (r.cancelled_by as string | null) ?? null,
    cancelledAt:  (r.cancelled_at as string | null) ?? null,
    metadata:     (r.metadata as Record<string, unknown> | null) ?? null,
    createdAt:    r.created_at as string,
    updatedAt:    (r.updated_at as string | null) ?? null,
    employeeName: r.app_users
      ? ((r.app_users as Record<string, unknown>).full_name as string | undefined) ?? undefined
      : undefined,
  };
}

function mapBalance(r: Record<string, unknown>): LeaveBalance {
  const accrued    = Number(r.accrued ?? 0);
  const taken      = Number(r.taken ?? 0);
  const pending    = Number(r.pending ?? 0);
  const adjustment = Number(r.adjustment ?? 0);
  return {
    id:           r.id as string,
    employeeId:   r.employee_id as string,
    leaveTypeId:  r.leave_type_id as string,
    leaveType:    r.hr_leave_types
      ? {
          code:  (r.hr_leave_types as Record<string, unknown>).code as string,
          label: (r.hr_leave_types as Record<string, unknown>).label as string,
          color: ((r.hr_leave_types as Record<string, unknown>).color as string | null) ?? null,
          unit:  (r.hr_leave_types as Record<string, unknown>).unit as 'days' | 'hours',
        }
      : undefined,
    year:         Number(r.year),
    entitled:     Number(r.entitled ?? 0),
    accrued,
    taken,
    pending,
    adjustment,
    available:    accrued + adjustment - taken - pending,
    createdAt:    r.created_at as string,
    updatedAt:    (r.updated_at as string | null) ?? null,
  };
}

const SEL = '*, hr_leave_types(code, label, color, unit), app_users!employee_id(full_name)';

export async function listMyLeaveRequests(employeeId: string, args: LeaveListArgs): Promise<LeaveListResult> {
  const page = Math.max(1, args.page ?? 1);
  const ps   = Math.min(100, Math.max(1, args.pageSize ?? 25));
  const off  = (page - 1) * ps;
  let q = sb.from('hr_leave_requests').select(SEL, { count: 'exact' })
    .eq('employee_id', employeeId).order('created_at', { ascending: false }).range(off, off + ps - 1);
  if (args.statuses?.length) q = q.in('status', args.statuses);
  if (args.fromDate)         q = q.gte('from_date', args.fromDate);
  if (args.toDate)           q = q.lte('to_date', args.toDate);
  if (args.leaveTypeId)      q = q.eq('leave_type_id', args.leaveTypeId);
  const { data, error, count } = await q;
  if (error) throw err(500, `Failed to list leave requests: ${error.message}`);
  return { rows: (data ?? []).map(r => mapRequest(r as Record<string, unknown>)), total: count ?? 0, page, pageSize: ps };
}

export async function listTeamLeaveRequests(
  _actorId: string, _role: string, departmentId: string | null, args: LeaveListArgs,
): Promise<LeaveListResult> {
  const page = Math.max(1, args.page ?? 1);
  const ps   = Math.min(100, Math.max(1, args.pageSize ?? 25));
  const off  = (page - 1) * ps;
  let q = sb.from('hr_leave_requests').select(SEL, { count: 'exact' })
    .order('created_at', { ascending: false }).range(off, off + ps - 1);
  if (departmentId)          q = q.eq('department_id', departmentId);
  if (args.employeeId)       q = q.eq('employee_id', args.employeeId);
  if (args.statuses?.length) q = q.in('status', args.statuses);
  if (args.fromDate)         q = q.gte('from_date', args.fromDate);
  if (args.toDate)           q = q.lte('to_date', args.toDate);
  if (args.leaveTypeId)      q = q.eq('leave_type_id', args.leaveTypeId);
  const { data, error, count } = await q;
  if (error) throw err(500, `Failed to list team leave requests: ${error.message}`);
  return { rows: (data ?? []).map(r => mapRequest(r as Record<string, unknown>)), total: count ?? 0, page, pageSize: ps };
}

export async function listAllLeaveRequests(args: LeaveListArgs): Promise<LeaveListResult> {
  const page = Math.max(1, args.page ?? 1);
  const ps   = Math.min(100, Math.max(1, args.pageSize ?? 25));
  const off  = (page - 1) * ps;
  let q = sb.from('hr_leave_requests').select(SEL, { count: 'exact' })
    .order('created_at', { ascending: false }).range(off, off + ps - 1);
  if (args.employeeId)       q = q.eq('employee_id', args.employeeId);
  if (args.departmentId)     q = q.eq('department_id', args.departmentId);
  if (args.statuses?.length) q = q.in('status', args.statuses);
  if (args.fromDate)         q = q.gte('from_date', args.fromDate);
  if (args.toDate)           q = q.lte('to_date', args.toDate);
  if (args.leaveTypeId)      q = q.eq('leave_type_id', args.leaveTypeId);
  const { data, error, count } = await q;
  if (error) throw err(500, `Failed to list leave requests: ${error.message}`);
  return { rows: (data ?? []).map(r => mapRequest(r as Record<string, unknown>)), total: count ?? 0, page, pageSize: ps };
}

export async function getLeaveRequest(id: string): Promise<LeaveRequest> {
  const { data, error } = await sb.from('hr_leave_requests').select(SEL).eq('id', id).maybeSingle();
  if (error) throw err(500, `Failed to get leave request: ${error.message}`);
  if (!data) throw err(404, 'Leave request not found.');
  return mapRequest(data as Record<string, unknown>);
}

export async function getLeaveBalance(employeeId: string, leaveTypeId: string, year: number): Promise<LeaveBalance | null> {
  const { data, error } = await sb.from('hr_leave_balances')
    .select('*, hr_leave_types(code, label, color, unit)')
    .eq('employee_id', employeeId).eq('leave_type_id', leaveTypeId).eq('year', year).maybeSingle();
  if (error) throw err(500, `Failed to get leave balance: ${error.message}`);
  if (!data) return null;
  return mapBalance(data as Record<string, unknown>);
}

export async function getAllBalancesForEmployee(employeeId: string, year: number): Promise<LeaveBalance[]> {
  const { data, error } = await sb.from('hr_leave_balances')
    .select('*, hr_leave_types(code, label, color, unit)')
    .eq('employee_id', employeeId).eq('year', year).order('leave_type_id');
  if (error) throw err(500, `Failed to get leave balances: ${error.message}`);
  return (data ?? []).map(r => mapBalance(r as Record<string, unknown>));
}

export async function getCalendar(args: CalendarArgs): Promise<LeaveCalendarEntry[]> {
  let q = sb.from('hr_leave_requests')
    .select('id, employee_id, from_date, to_date, days, status, hr_leave_types(code, label, color), app_users!employee_id(full_name)')
    .in('status', ['pending_approval', 'approved'])
    .lte('from_date', args.toDate)
    .gte('to_date', args.fromDate)
    .order('from_date');
  if (args.departmentId) q = q.eq('department_id', args.departmentId);
  const { data, error } = await q;
  if (error) throw err(500, `Failed to get calendar: ${error.message}`);
  return (data ?? []).map(r => {
    const row  = r as Record<string, unknown>;
    const lt   = (row.hr_leave_types as Record<string, unknown> | null) ?? {};
    const user = (row.app_users as Record<string, unknown> | null) ?? {};
    return {
      requestId:      row.id as string,
      employeeId:     row.employee_id as string,
      employeeName:   (user.full_name as string | undefined) ?? 'Unknown',
      leaveTypeCode:  (lt.code as string | undefined) ?? '',
      leaveTypeLabel: (lt.label as string | undefined) ?? '',
      color:          (lt.color as string | null) ?? null,
      fromDate:       row.from_date as string,
      toDate:         row.to_date as string,
      days:           row.days != null ? Number(row.days) : null,
      status:         row.status as LeaveCalendarEntry['status'],
    };
  });
}

export async function getLeaveStats(actorId: string, role: string, departmentId: string | null): Promise<LeaveStats> {
  const year    = new Date().getFullYear();
  const yearStr = String(year);
  const { count: myPending } = await sb.from('hr_leave_requests')
    .select('*', { count: 'exact', head: true }).eq('employee_id', actorId).eq('status', 'pending_approval');
  const { count: myApproved } = await sb.from('hr_leave_requests')
    .select('*', { count: 'exact', head: true }).eq('employee_id', actorId).eq('status', 'approved')
    .gte('from_date', `${yearStr}-01-01`).lte('from_date', `${yearStr}-12-31`);
  const { data: daysRows } = await sb.from('hr_leave_requests').select('days')
    .eq('employee_id', actorId).eq('status', 'approved')
    .gte('from_date', `${yearStr}-01-01`).lte('from_date', `${yearStr}-12-31`);
  const totalDaysThisYear = (daysRows ?? []).reduce((a, r) => a + Number((r as Record<string, unknown>).days ?? 0), 0);
  let teamPending = 0; let pendingApprovals = 0;
  if (['manager', 'admin', 'superadmin', 'hr_manager'].includes(role)) {
    let q = sb.from('hr_leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending_approval');
    if (role === 'manager' && departmentId) q = q.eq('department_id', departmentId);
    const { count } = await q;
    teamPending = count ?? 0; pendingApprovals = count ?? 0;
  }
  return { myPending: myPending ?? 0, myApproved: myApproved ?? 0, teamPending, totalDaysThisYear, pendingApprovals };
}
