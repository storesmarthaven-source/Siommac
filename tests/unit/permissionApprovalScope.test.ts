import {
  COMPLIANCE_ACCESS_GRANT_KEYS,
  canReviewPermissionGrant,
  isComplianceAccessGrant,
  resolvePermissionApprovalScope,
} from '../../netlify/functions/lib/permissionApprovalScope';

describe('permission approval scope', () => {
  it('resolves full queue access when the actor can manage permissions', () => {
    expect(resolvePermissionApprovalScope(true, false)).toBe('all');
    expect(resolvePermissionApprovalScope(true, true)).toBe('all');
  });

  it('resolves compliance-only access for designated compliance approvers', () => {
    expect(resolvePermissionApprovalScope(false, true)).toBe('compliance');
  });

  it('denies actors without either review capability', () => {
    expect(resolvePermissionApprovalScope(false, false)).toBeNull();
  });

  it('recognizes only compliance read/export grants as compliance approval targets', () => {
    expect(COMPLIANCE_ACCESS_GRANT_KEYS).toEqual([
      'communications.compliance_read',
      'communications.compliance_export',
    ]);
    expect(isComplianceAccessGrant('communications.compliance_read')).toBe(true);
    expect(isComplianceAccessGrant('communications.compliance_export')).toBe(true);
    expect(isComplianceAccessGrant('communications.compliance_approve')).toBe(false);
    expect(isComplianceAccessGrant('permissions.manage')).toBe(false);
  });

  it('keeps compliance-only reviewers out of the general critical queue', () => {
    expect(canReviewPermissionGrant('all', 'permissions.manage')).toBe(true);
    expect(canReviewPermissionGrant('all', 'communications.compliance_read')).toBe(true);
    expect(canReviewPermissionGrant('compliance', 'communications.compliance_read')).toBe(true);
    expect(canReviewPermissionGrant('compliance', 'communications.compliance_export')).toBe(true);
    expect(canReviewPermissionGrant('compliance', 'permissions.manage')).toBe(false);
    expect(canReviewPermissionGrant('compliance', 'communications.admin')).toBe(false);
  });
});
