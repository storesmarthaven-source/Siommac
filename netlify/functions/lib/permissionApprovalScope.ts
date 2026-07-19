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
