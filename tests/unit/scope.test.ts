/**
 * tests/unit/scope.test.ts — department data-scoping resolver (phase 13).
 *
 * loadRoleScope hits the DB for non-built-in roles; here we test the pure
 * resolution logic for the built-ins (superadmin/admin = all, others = own via
 * default) and the deptScopeFilter / assertInScope behaviour built on top.
 */

import { deptScopeFilter, assertInScope } from '../../netlify/functions/lib/permissions';

describe('deptScopeFilter — built-in roles', () => {
  it('superadmin is org-wide', async () => {
    expect(await deptScopeFilter({ role: 'superadmin', department_id: 'D1' })).toEqual({ all: true });
  });
  it('admin is org-wide', async () => {
    expect(await deptScopeFilter({ role: 'admin', department_id: null })).toEqual({ all: true });
  });
});

describe('assertInScope', () => {
  it('org-wide caller may act on any department', async () => {
    await expect(assertInScope({ role: 'admin', department_id: 'D1' }, 'D2')).resolves.toBeUndefined();
  });
  it('unassigned target (null dept) is in scope for everyone', async () => {
    await expect(assertInScope({ role: 'admin', department_id: 'D1' }, null)).resolves.toBeUndefined();
  });
});
