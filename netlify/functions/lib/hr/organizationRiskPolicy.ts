// lib/hr/organizationRiskPolicy.ts — classify an org change's risk (Phase B).
//
// Pure policy: given the action + which fields changed + the impact preview, return
// a risk level. requiresApproval() decides whether the change must route through the
// central workflow engine (high/critical) or may apply directly (low/medium).
//
// Impact-size thresholds apply ONLY to STRUCTURAL actions (move/archive/delete/retire)
// — a benign field edit (rename, re-assign cost centre) is NOT forced into approval
// just because the unit happens to contain many people.

import type { OrgChangeImpactSummary, OrgChangeRiskLevel, OrgEntityType, OrgChangeAction } from '../../../../types/hrOrganization';

export function classifyOrgChangeRisk(args: {
  entityType: OrgEntityType;
  action: OrgChangeAction;
  changedFields: string[];
  impact: OrgChangeImpactSummary;
}): OrgChangeRiskLevel {
  const { action, changedFields, impact } = args;
  const structural = action === 'move' || action === 'archive' || action === 'delete' || action === 'retire';

  if (impact.blockers.length > 0) return 'critical';
  if (action === 'delete') return 'critical';
  if (action === 'move') return 'high';

  // Field-driven (apply to plain updates too)
  if (changedFields.includes('headcountBudget')) return 'high';
  if (changedFields.includes('reportsToPositionId')) return 'high';

  // Impact-driven — structural actions only
  if (action === 'retire' && impact.affectedEmployees > 0) return 'high';
  if (structural && impact.affectedEmployees >= 25) return 'high';

  if (changedFields.includes('managerId') || changedFields.includes('costCenterId')) return 'medium';
  if (structural && impact.affectedEmployees > 0) return 'medium';

  return 'low';
}

/** High + critical route through the approval workflow; low + medium apply directly. */
export function requiresApproval(risk: OrgChangeRiskLevel): boolean {
  return risk === 'high' || risk === 'critical';
}
