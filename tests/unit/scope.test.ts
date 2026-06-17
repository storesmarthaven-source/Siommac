/**
 * tests/unit/scope.test.ts — department data-scoping resolver (phase 13).
 *
 * loadRoleScope short-circuits the built-ins (superadmin/admin = 'all') without
 * a DB hit; everything else reads roles.scope. We mock `db` so we can exercise
 * the 'own' path (a department-bound role) as well as the org-wide built-ins.
 */

jest.mock('../../netlify/functions/lib/db', () => ({
  sb: { from: jest.fn() },
}));

import {
  deptScopeFilter,
  assertInScope,
  loadRoleScope,
  invalidateRoleScope,
} from '../../netlify/functions/lib/permissions';

const { sb } = jest.requireMock<{ sb: { from: jest.Mock } }>('../../netlify/functions/lib/db');

/** Make sb.from('roles').select('scope').eq('name', …).maybeSingle() resolve to `scope`. */
function mockRoleScope(scope: string | null) {
  sb.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: scope == null ? null : { scope }, error: null }),
      }),
    }),
  }));
}

beforeEach(() => {
  sb.from.mockReset();
  invalidateRoleScope(); // clear the module-level cache between cases
});

describe('loadRoleScope', () => {
  it('superadmin and admin are org-wide without a DB hit', async () => {
    expect(await loadRoleScope('superadmin')).toBe('all');
    expect(await loadRoleScope('admin')).toBe('all');
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('reads scope from the roles table for custom/built-in roles', async () => {
    mockRoleScope('all');
    expect(await loadRoleScope('finance_officer')).toBe('all');
  });

  it('defaults to own when the row is missing or scope is not "all"', async () => {
    mockRoleScope(null);
    expect(await loadRoleScope('hse_manager')).toBe('own');
    invalidateRoleScope();
    mockRoleScope('own');
    expect(await loadRoleScope('manager')).toBe('own');
  });
});

describe('deptScopeFilter', () => {
  it('superadmin is org-wide', async () => {
    expect(await deptScopeFilter({ role: 'superadmin', department_id: 'D1' })).toEqual({ all: true });
  });
  it('admin is org-wide', async () => {
    expect(await deptScopeFilter({ role: 'admin', department_id: null })).toEqual({ all: true });
  });
  it('a department-bound role is pinned to its own department', async () => {
    mockRoleScope('own');
    expect(await deptScopeFilter({ role: 'manager', department_id: 'D1' })).toEqual({ all: false, departmentId: 'D1' });
  });
  it('a scoped user with no department sees nothing (impossible id)', async () => {
    mockRoleScope('own');
    expect(await deptScopeFilter({ role: 'manager', department_id: null })).toEqual({ all: false, departmentId: '__none__' });
  });
});

describe('assertInScope', () => {
  it('org-wide caller may act on any department', async () => {
    await expect(assertInScope({ role: 'admin', department_id: 'D1' }, 'D2')).resolves.toBeUndefined();
  });
  it('unassigned target (null dept) is in scope for everyone', async () => {
    mockRoleScope('own');
    await expect(assertInScope({ role: 'manager', department_id: 'D1' }, null)).resolves.toBeUndefined();
  });
  it('scoped caller may act within their own department', async () => {
    mockRoleScope('own');
    await expect(assertInScope({ role: 'manager', department_id: 'D1' }, 'D1')).resolves.toBeUndefined();
  });
  it('scoped caller acting on another department is rejected (403)', async () => {
    mockRoleScope('own');
    await expect(assertInScope({ role: 'manager', department_id: 'D1' }, 'D2')).rejects.toMatchObject({ status: 403 });
  });
});
