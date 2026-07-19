export const COMPLIANCE_ACCESS_GRANT_KEYS = [
  'communications.compliance_read',
  'communications.compliance_export',
] as const;

export type PermissionApprovalScope = 'all' | 'compliance';

export function resolvePermissionApprovalScope(
  canManagePermissions: boolean,
  canApproveCompliance: boolean,
): PermissionApprovalScope | null {
  if (canManagePermissions) return 'all';
  if (canApproveCompliance) return 'compliance';
  return null;
}

export function isComplianceAccessGrant(permissionKey: string): boolean {
  return (COMPLIANCE_ACCESS_GRANT_KEYS as readonly string[]).includes(permissionKey);
}

export function canReviewPermissionGrant(
  scope: PermissionApprovalScope,
  permissionKey: string,
): boolean {
  return scope === 'all' || isComplianceAccessGrant(permissionKey);
}

/**
 * The two capabilities that let a user sign off on a compliance access grant:
 * the scoped reviewer key and the full permission-management key. A holder of
 * either can approve a compliance_read/export request.
 */
export const COMPLIANCE_APPROVER_KEYS = [
  'communications.compliance_approve',
  'permissions.manage',
] as const;

/** One candidate reviewer with their resolved capability + account status. */
export interface ApproverCandidate {
  id: string;
  active: boolean;
  /** True if the resolver grants either COMPLIANCE_APPROVER_KEYS capability. */
  canApprove: boolean;
}

/**
 * Maker-checker eligibility filter. Given a pool of candidate reviewers (each with
 * their resolved capability + active flag), return the ids that may approve a
 * compliance access request, EXCLUDING those who cannot self-approve — the
 * requester and the grantee. An empty result means no independent approver exists,
 * so the request must be blocked (segregation of duties).
 *
 * Pure (no I/O): the caller resolves `canApprove` via the real permission resolver
 * so an explicit deny disqualifies a role-holder, then this applies the exclusion.
 */
export function selectEligibleApprovers(
  candidates: readonly ApproverCandidate[],
  excludeIds: readonly string[],
): string[] {
  const exclude = new Set(excludeIds);
  return candidates
    .filter(c => c.active && c.canApprove && !exclude.has(c.id))
    .map(c => c.id);
}
