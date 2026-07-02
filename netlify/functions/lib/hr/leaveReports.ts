// lib/hr/leaveReports.ts — HR Leave reports: list / run / export

import { sb }           from '../db';
import { writeHrAudit } from './employeeCore';
import type { LeaveReportArgs } from '../../../../types/hrLeave';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

export interface LeaveReportDefinition {
  reportKey:   string;
  label:       string;
  description: string;
  columns:     string[];
}

export function listLeaveReports(): LeaveReportDefinition[] {
  return [
    { reportKey: 'leave_utilization',    label: 'Leave Utilization',      description: 'Days taken vs entitled per employee.',             columns: ['employee', 'leaveType', 'entitled', 'taken', 'pending', 'available'] },
    { reportKey: 'leave_balance_summary',label: 'Balance Summary',        description: 'Current balances for all employees and types.',    columns: ['employee', 'leaveType', 'year', 'accrued', 'taken', 'pending', 'adjustment', 'available'] },
    { reportKey: 'pending_approvals',    label: 'Pending Approvals',      description: 'All leave requests awaiting approval.',            columns: ['caseNo', 'employee', 'leaveType', 'fromDate', 'toDate', 'days', 'appliedAt'] },
    { reportKey: 'leave_by_type',        label: 'Leave by Type',          description: 'Aggregated leave days grouped by leave type.',     columns: ['leaveType', 'requests', 'totalDays', 'employees'] },
    { reportKey: 'overdue_approvals',    label: 'Overdue Approvals',      description: 'Pending requests older than 48 hours.',           columns: ['caseNo', 'employee', 'leaveType', 'fromDate', 'appliedAt', 'hoursWaiting'] },
  ];
}

export async function runLeaveReport(args: LeaveReportArgs): Promise<{ rows: unknown[]; total: number }> {
  const page = Math.max(1, args.page ?? 1);
  const ps   = Math.min(500, Math.max(1, args.pageSize ?? 100));

  switch (args.reportKey) {

    case 'pending_approvals': {
      let q = sb.from('hr_leave_requests')
        .select('case_no, employee_id, leave_type_id, from_date, to_date, days, applied_at, app_users!employee_id(full_name), hr_leave_types(label)', { count: 'exact' })
        .eq('status', 'pending_approval')
        .order('applied_at');
      if (args.departmentId) q = q.eq('department_id', args.departmentId);
      if (args.dateFrom)     q = q.gte('applied_at', args.dateFrom);
      if (args.dateTo)       q = q.lte('applied_at', args.dateTo);
      const { data, error, count } = await q.range((page - 1) * ps, page * ps - 1);
      if (error) throw err(500, `Report query failed: ${error.message}`);
      return { rows: data ?? [], total: count ?? 0 };
    }

    case 'leave_balance_summary': {
      let q = sb.from('hr_leave_balances')
        .select('employee_id, year, entitled, accrued, taken, pending, adjustment, app_users!employee_id(full_name), hr_leave_types(label, unit)', { count: 'exact' })
        .order('employee_id');
      if (args.dateFrom) q = q.gte('year', Number(args.dateFrom.slice(0, 4)));
      if (args.dateTo)   q = q.lte('year', Number(args.dateTo.slice(0, 4)));
      const { data, error, count } = await q.range((page - 1) * ps, page * ps - 1);
      if (error) throw err(500, `Report query failed: ${error.message}`);
      return {
        rows: (data ?? []).map(r => {
          const row = r as Record<string, unknown>;
          const accrued = Number(row.accrued ?? 0), taken = Number(row.taken ?? 0),
                pending = Number(row.pending ?? 0), adj = Number(row.adjustment ?? 0);
          return { ...row, available: accrued + adj - taken - pending };
        }),
        total: count ?? 0,
      };
    }

    case 'overdue_approvals': {
      const cutoff = new Date(Date.now() - 48 * 3_600_000).toISOString();
      let q = sb.from('hr_leave_requests')
        .select('case_no, employee_id, leave_type_id, from_date, applied_at, app_users!employee_id(full_name), hr_leave_types(label)', { count: 'exact' })
        .eq('status', 'pending_approval')
        .lte('applied_at', cutoff)
        .order('applied_at');
      if (args.departmentId) q = q.eq('department_id', args.departmentId);
      const { data, error, count } = await q.range((page - 1) * ps, page * ps - 1);
      if (error) throw err(500, `Report query failed: ${error.message}`);
      return {
        rows: (data ?? []).map(r => {
          const row = r as Record<string, unknown>;
          const hours = Math.floor((Date.now() - new Date(row.applied_at as string).getTime()) / 3_600_000);
          return { ...row, hoursWaiting: hours };
        }),
        total: count ?? 0,
      };
    }

    default: {
      let q = sb.from('hr_leave_requests')
        .select('*, hr_leave_types(label), app_users!employee_id(full_name)', { count: 'exact' })
        .order('created_at', { ascending: false });
      if (args.dateFrom)     q = q.gte('from_date', args.dateFrom);
      if (args.dateTo)       q = q.lte('to_date', args.dateTo);
      if (args.departmentId) q = q.eq('department_id', args.departmentId);
      const { data, error, count } = await q.range((page - 1) * ps, page * ps - 1);
      if (error) throw err(500, `Report query failed: ${error.message}`);
      return { rows: data ?? [], total: count ?? 0 };
    }
  }
}

export async function exportLeaveReport(actorId: string, args: LeaveReportArgs): Promise<{ rows: unknown[]; total: number }> {
  await writeHrAudit({
    submoduleKey: 'leave', actorId, action: 'hr.leave.report.exported',
    newState: { reportKey: args.reportKey, dateFrom: args.dateFrom, dateTo: args.dateTo, departmentId: args.departmentId },
  });
  return runLeaveReport({ ...args, pageSize: 5000, page: 1 });
}
