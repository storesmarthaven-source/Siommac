import {
  COMPLIANCE_ACCESS_GRANT_KEYS,
  COMPLIANCE_APPROVER_KEYS,
  canReviewPermissionGrant,
  isComplianceAccessGrant,
  resolvePermissionApprovalScope,
  selectEligibleApprovers,
  type ApproverCandidate,
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

describe('compliance approver eligibility (maker-checker)', () => {
  it('exposes the two capabilities that confer approver rights', () => {
    expect(COMPLIANCE_APPROVER_KEYS).toEqual([
      'communications.compliance_approve',
      'permissions.manage',
    ]);
  });

  const cand = (id: string, over: Partial<ApproverCandidate> = {}): ApproverCandidate =>
    ({ id, active: true, canApprove: true, ...over });

  it('blocks when there is no candidate approver at all', () => {
    expect(selectEligibleApprovers([], ['requester', 'grantee'])).toEqual([]);
  });

  it('blocks when the requester is the only approver (cannot self-approve)', () => {
    const candidates = [cand('requester')];
    expect(selectEligibleApprovers(candidates, ['requester', 'grantee'])).toEqual([]);
  });

  it('blocks when the grantee is the only approver (cannot approve their own grant)', () => {
    const candidates = [cand('grantee')];
    expect(selectEligibleApprovers(candidates, ['requester', 'grantee'])).toEqual([]);
  });

  it('allows when a DIFFERENT active approver exists', () => {
    const candidates = [cand('requester'), cand('grantee'), cand('other')];
    expect(selectEligibleApprovers(candidates, ['requester', 'grantee'])).toEqual(['other']);
  });

  it('excludes inactive candidates and those the resolver denies', () => {
    const candidates = [
      cand('inactive', { active: false }),
      cand('denied', { canApprove: false }),
      cand('good'),
    ];
    expect(selectEligibleApprovers(candidates, ['requester', 'grantee'])).toEqual(['good']);
  });

  it('when requester and grantee are the same user, still requires an independent approver', () => {
    // Self-grant edge: exclude set collapses to one id; only "other" qualifies.
    expect(selectEligibleApprovers([cand('me'), cand('other')], ['me', 'me'])).toEqual(['other']);
  });
});
