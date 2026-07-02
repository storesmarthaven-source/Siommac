// lib/hr/organizationImpact.ts — read-only impact preview (Phase A).
//
// Surfaces what a move/archive/delete/retire would touch BEFORE the user commits.
// Phase A only informs the UI (no approval routing yet). Offboarding tables may not
// exist in every environment, so cross-module counts are queried defensively.

import { sb } from '../db';
import type { OrgChangeImpactSummary, PreviewOrgChangeArgs } from '../../../../types/hrOrganization';

function empty(): OrgChangeImpactSummary {
  return {
    affectedEmployees: 0, affectedPositions: 0, affectedChildUnits: 0,
    affectedOnboardingCases: 0, affectedOffboardingCases: 0, affectedPendingTransfers: 0,
    affectedFinanceReferences: 0, warnings: [], blockers: [],
  };
}

async function countActiveCases(table: string, employeeIds: string[]): Promise<number> {
  if (!employeeIds.length) return 0;
  try {
    const { count } = await sb.from(table).select('id', { count: 'exact', head: true })
      .in('employee_id', employeeIds).not('status', 'in', '(completed,cancelled)');
    return count ?? 0;
  } catch { return 0; }               // table may not exist in this environment yet
}

/** Collect a unit's id + all descendant ids from the flat departments list. */
function subtreeIds(units: Array<{ id: string; parent_id: string | null }>, rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const u of units) if (u.parent_id) childrenOf.set(u.parent_id, [...(childrenOf.get(u.parent_id) ?? []), u.id]);
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    out.push(id);
    for (const c of childrenOf.get(id) ?? []) stack.push(c);
  }
  return out;
}

export async function previewOrgChangeImpact(args: PreviewOrgChangeArgs): Promise<OrgChangeImpactSummary> {
  const summary = empty();

  if (args.entityType === 'org_unit') {
    const { data: units } = await sb.from('departments').select('id, parent_id');
    const ids = subtreeIds((units ?? []) as { id: string; parent_id: string | null }[], args.entityId);
    summary.affectedChildUnits = Math.max(0, ids.length - 1);

    const { data: emps } = await sb.from('app_users').select('id').in('department_id', ids);
    const empIds = ((emps ?? []) as { id: string }[]).map(e => e.id);
    summary.affectedEmployees = empIds.length;

    const { count: posCount } = await sb.from('hr_positions').select('id', { count: 'exact', head: true }).in('department_id', ids);
    summary.affectedPositions = posCount ?? 0;

    summary.affectedOnboardingCases = await countActiveCases('hr_onboarding_cases', empIds);
    summary.affectedOffboardingCases = await countActiveCases('hr_offboarding_cases', empIds);

    if (empIds.length) {
      try {
        const { count } = await sb.from('hr_employee_change_requests').select('id', { count: 'exact', head: true })
          .in('employee_id', empIds).in('status', ['submitted', 'in_review']);
        summary.affectedPendingTransfers = count ?? 0;
      } catch { /* ignore */ }
    }

    if (args.action === 'delete') {
      if (summary.affectedChildUnits > 0) summary.blockers.push(`${summary.affectedChildUnits} child unit(s) must be moved or removed first.`);
      if (summary.affectedEmployees > 0) summary.blockers.push(`${summary.affectedEmployees} employee(s) are assigned to this unit or its sub-units.`);
      if (summary.affectedPositions > 0) summary.blockers.push(`${summary.affectedPositions} position(s) are linked to this unit or its sub-units.`);
    } else if (args.action === 'archive') {
      if (summary.affectedEmployees > 0) summary.warnings.push(`${summary.affectedEmployees} active employee(s) remain in this unit.`);
      if (summary.affectedChildUnits > 0) summary.warnings.push(`${summary.affectedChildUnits} sub-unit(s) will remain under an inactive parent.`);
    } else if (args.action === 'move') {
      if (summary.affectedChildUnits > 0) summary.warnings.push(`${summary.affectedChildUnits} sub-unit(s) move with this unit.`);
    }
    return summary;
  }

  if (args.entityType === 'position') {
    const { count } = await sb.from('app_users').select('id', { count: 'exact', head: true }).eq('position_id', args.entityId);
    summary.affectedEmployees = count ?? 0;
    if (args.action === 'retire' && summary.affectedEmployees > 0) {
      summary.warnings.push(`${summary.affectedEmployees} incumbent(s) currently hold this position; retiring blocks new assignments but keeps existing ones.`);
    }
    return summary;
  }

  // cost_center
  const { count: unitCount } = await sb.from('departments').select('id', { count: 'exact', head: true }).eq('cost_center_id', args.entityId);
  summary.affectedChildUnits = unitCount ?? 0;
  try {
    const { count } = await sb.from('finance_cost_entries').select('id', { count: 'exact', head: true }).eq('cost_center_id', args.entityId);
    summary.affectedFinanceReferences = count ?? 0;
  } catch { /* table may be skeleton-only */ }
  if (args.action === 'retire' && summary.affectedChildUnits > 0) {
    summary.warnings.push(`${summary.affectedChildUnits} org unit(s) are linked to this cost centre; retiring hides it from pickers but keeps existing links.`);
  }
  return summary;
}
