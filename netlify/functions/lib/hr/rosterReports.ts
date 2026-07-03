/**
 * netlify/functions/lib/hr/rosterReports.ts
 *
 * Aggregate reporting queries for the Roster module:
 *  - getRosterStats: high-level KPI summary
 *  - getEmployeeHoursSummary: hours/shifts/off/leave per employee for a roster
 */

import { sb } from '../db';
import type { RosterStats, EmployeeHoursSummary } from '../../../../types/hrRoster';

export async function getRosterStats(filters: { siteId?: string; departmentId?: string } = {}): Promise<RosterStats> {
  let q = sb.from('hr_rosters').select('id, status, open_shift_count, assignment_count');
  if (filters.siteId)       q = q.eq('site_id', filters.siteId);
  if (filters.departmentId) q = q.eq('department_id', filters.departmentId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  const rows = (data ?? []) as { id: string; status: string; open_shift_count: number; assignment_count: number }[];
  const total      = rows.length;
  const published  = rows.filter(r => r.status === 'published').length;
  const draft      = rows.filter(r => r.status === 'draft').length;
  const openShifts = rows.reduce((s, r) => s + (r.open_shift_count ?? 0), 0);
  const totalAsgn  = rows.reduce((s, r) => s + (r.assignment_count ?? 0), 0);

  // Coverage % = fraction of assignments that are covered (not open slots)
  const covered = totalAsgn - openShifts;
  const coveragePct = totalAsgn > 0 ? Math.round((covered / totalAsgn) * 100) : 0;

  return { totalRosters: total, publishedRosters: published, draftRosters: draft, openShifts, coveragePct };
}

export async function getEmployeeHoursSummary(rosterId: string): Promise<EmployeeHoursSummary[]> {
  const { data, error } = await sb.from('hr_shift_assignments')
    .select('employee_id, kind, hours')
    .eq('roster_id', rosterId);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  const rows = (data ?? []) as { employee_id: string; kind: string; hours: number | null }[];
  const empMap = new Map<string, { totalHours: number; shiftCount: number; offDays: number; leaveDays: number }>();

  for (const r of rows) {
    const cur = empMap.get(r.employee_id) ?? { totalHours: 0, shiftCount: 0, offDays: 0, leaveDays: 0 };
    if (r.kind === 'shift') { cur.totalHours += Number(r.hours ?? 0); cur.shiftCount++; }
    else if (r.kind === 'off')   cur.offDays++;
    else if (r.kind === 'leave') cur.leaveDays++;
    empMap.set(r.employee_id, cur);
  }

  const empIds = Array.from(empMap.keys());
  let nameMap = new Map<string, string | null>();
  if (empIds.length) {
    const { data: emps } = await sb.from('app_users').select('id, full_name').in('id', empIds);
    nameMap = new Map(((emps ?? []) as { id: string; full_name: string | null }[]).map(e => [e.id, e.full_name]));
  }

  return empIds.map(id => {
    const m = empMap.get(id)!;
    return {
      employeeId:   id,
      employeeName: nameMap.get(id) ?? null,
      totalHours:   Math.round(m.totalHours * 100) / 100,
      shiftCount:   m.shiftCount,
      offDays:      m.offDays,
      leaveDays:    m.leaveDays,
    };
  }).sort((a, b) => (a.employeeName ?? '').localeCompare(b.employeeName ?? ''));
}
