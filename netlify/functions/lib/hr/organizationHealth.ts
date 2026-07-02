// lib/hr/organizationHealth.ts — org data-quality checks (Phase A, read-only).
//
// Aggregated issues (one row per issue type, with a count) surfaced on the Org
// Structure page so gaps in the structure are visible without hunting.

import { sb } from '../db';
import type { OrgHealthIssue, OrgHealthSummary, OrgHealthSeverity, OrgHealthIssueType } from '../../../../types/hrOrganization';

interface DeptLite { id: string; name: string; is_active: boolean; manager_id: string | null; cost_center_id: string | null; }
interface PosLite { id: string; is_active: boolean; is_safety_critical: boolean; headcount_budget: number | null; department_id: string | null; }
interface UserLite { id: string; department_id: string | null; position_id: string | null; supervisor_id: string | null; status: string | null; role: string | null; }

function issue(
  issueType: OrgHealthIssueType, severity: OrgHealthSeverity, count: number,
  entityType: OrgHealthIssue['entityType'], title: string, description: string,
): OrgHealthIssue {
  return { id: issueType, severity, issueType, title, description, entityType, entityId: null, count };
}

export async function getOrgHealthSummary(): Promise<OrgHealthSummary> {
  const [{ data: depts }, { data: positions }, { data: ccs }, { data: users }] = await Promise.all([
    sb.from('departments').select('id, name, is_active, manager_id, cost_center_id'),
    sb.from('hr_positions').select('id, is_active, is_safety_critical, headcount_budget, department_id'),
    sb.from('finance_cost_centers').select('id, is_active'),
    sb.from('app_users').select('id, department_id, position_id, supervisor_id, status, role'),
  ]);
  const deptRows = (depts ?? []) as DeptLite[];
  const posRows = (positions ?? []) as PosLite[];
  const ccRows = (ccs ?? []) as { id: string; is_active: boolean }[];
  const staff = ((users ?? []) as UserLite[]).filter(u => u.role !== 'superadmin');
  const activeStaff = staff.filter(u => (u.status ?? 'active') === 'active');

  const incumbentByPos = new Map<string, number>();
  for (const u of staff) if (u.position_id) incumbentByPos.set(u.position_id, (incumbentByPos.get(u.position_id) ?? 0) + 1);
  const employeesByDept = new Map<string, number>();
  for (const u of activeStaff) if (u.department_id) employeesByDept.set(u.department_id, (employeesByDept.get(u.department_id) ?? 0) + 1);
  const positionsByDept = new Map<string, number>();
  for (const p of posRows) if (p.department_id) positionsByDept.set(p.department_id, (positionsByDept.get(p.department_id) ?? 0) + 1);
  const assignedCc = new Set<string>();
  for (const d of deptRows) if (d.cost_center_id) assignedCc.add(d.cost_center_id);

  const issues: OrgHealthIssue[] = [];
  const push = (i: OrgHealthIssue): void => { if (i.count > 0) issues.push(i); };

  // ── Critical ──
  push(issue('vacant_safety_critical_position', 'critical',
    posRows.filter(p => p.is_active !== false && p.is_safety_critical && (incumbentByPos.get(p.id) ?? 0) === 0).length,
    'position', 'Vacant safety-critical positions', 'Safety-critical positions with no incumbent.'));
  push(issue('inactive_unit_with_active_employees', 'critical',
    deptRows.filter(d => d.is_active === false && (employeesByDept.get(d.id) ?? 0) > 0).length,
    'org_unit', 'Inactive units with active employees', 'Deactivated org units that still have active employees assigned.'));

  // ── Warning ──
  push(issue('employee_without_supervisor', 'warning', activeStaff.filter(u => !u.supervisor_id).length,
    'employee', 'Employees without a supervisor', 'Active employees with no reporting line.'));
  push(issue('employee_without_department', 'warning', activeStaff.filter(u => !u.department_id).length,
    'employee', 'Employees without an org unit', 'Active employees not assigned to any department/unit.'));
  push(issue('employee_without_position', 'warning', activeStaff.filter(u => !u.position_id).length,
    'employee', 'Employees without a position', 'Active employees with no job position assigned.'));
  push(issue('department_without_manager', 'warning', deptRows.filter(d => d.is_active !== false && !d.manager_id).length,
    'org_unit', 'Units without a manager', 'Active org units with no manager assigned.'));
  push(issue('department_without_cost_center', 'warning', deptRows.filter(d => d.is_active !== false && !d.cost_center_id).length,
    'org_unit', 'Units without a cost centre', 'Active org units not linked to a cost centre.'));
  push(issue('position_over_budget', 'warning',
    posRows.filter(p => p.headcount_budget != null && (incumbentByPos.get(p.id) ?? 0) > p.headcount_budget).length,
    'position', 'Positions over headcount budget', 'Positions with more incumbents than their budgeted headcount.'));

  // ── Info ──
  push(issue('position_without_department', 'info', posRows.filter(p => !p.department_id).length,
    'position', 'Positions without an org unit', 'Positions not linked to any department/unit.'));
  push(issue('inactive_cost_center_assigned', 'info',
    ccRows.filter(c => c.is_active === false && assignedCc.has(c.id)).length,
    'cost_center', 'Inactive cost centres still assigned', 'Deactivated cost centres still linked to org units.'));

  return {
    criticalCount: issues.filter(i => i.severity === 'critical').length,
    warningCount: issues.filter(i => i.severity === 'warning').length,
    infoCount: issues.filter(i => i.severity === 'info').length,
    issues,
  };
}
