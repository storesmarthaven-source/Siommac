/**
 * Regression coverage for rapid employee switching.
 *
 * The contract requires that a late response for a previously selected employee
 * can NEVER be rendered under the newly selected employee's name. Two independent
 * guards are proven here:
 *
 *   1. the employee id is part of the query key, so responses are cached per
 *      employee and a switch cannot read another employee's entry;
 *   2. `assertShellMatches` rejects a payload whose identity does not match the
 *      requested id, as a hard backstop against a mis-routed or replayed response.
 */
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/preact-query';
import { assertShellMatches } from '../../src/api/hr/employeeProfile';
import { hrEmployeeKeys } from '../../src/api/queryKeys';
import type { EmployeeProfileShell } from '../../types/hrEmployeeProfile';

function shellFor(employeeId: string): EmployeeProfileShell {
  return {
    identity: {
      employeeId, employeeNo: null, displayName: `Employee ${employeeId}`,
      profileImageUrl: null, employmentStatus: 'active', accountStatus: 'active',
      position: null, departmentName: null, siteName: null,
    },
    employment: {
      employmentBasis: null, workArrangement: null, startDate: null,
      tenureMonths: null, supervisorName: null, payGroupName: null,
    },
    readiness: null, attentionPreview: [], attentionTotal: 0, tabIndicators: [],
    contact: null, accountHealth: null, recentActivity: [],
    capabilities: {
      viewStatutory: false, viewReadiness: false, viewDocuments: false, viewAudit: false,
      viewOnboarding: false, viewOffboarding: false, viewAccountSecurity: false,
    },
  };
}

describe('stale employee-switch protection', () => {
  it('scopes every shell query key to its employee id', () => {
    const a = hrEmployeeKeys.profileShell('EMP-A');
    const b = hrEmployeeKeys.profileShell('EMP-B');
    expect(a).not.toEqual(b);
    expect(a.at(-1)).toBe('EMP-A');
    expect(b.at(-1)).toBe('EMP-B');
  });

  it('never serves employee A\'s cached shell for employee B', () => {
    const qc = new QueryClient();
    qc.setQueryData(hrEmployeeKeys.profileShell('EMP-A'), shellFor('EMP-A'));

    expect(qc.getQueryData(hrEmployeeKeys.profileShell('EMP-B'))).toBeUndefined();
    expect(qc.getQueryData<EmployeeProfileShell>(hrEmployeeKeys.profileShell('EMP-A'))!
      .identity.employeeId).toBe('EMP-A');
  });

  it('rejects a late response that arrives after the selection moved on', () => {
    // EMP-A's request resolves while EMP-B is selected — must be refused, not rendered.
    expect(() => assertShellMatches(shellFor('EMP-A'), 'EMP-B'))
      .toThrow(/received EMP-A while EMP-B is selected/);
  });

  it('accepts a response that matches the active selection', () => {
    expect(() => assertShellMatches(shellFor('EMP-B'), 'EMP-B')).not.toThrow();
  });

  it('survives a rapid switch sequence without cross-contamination', () => {
    const qc = new QueryClient();
    const ids = ['EMP-A', 'EMP-B', 'EMP-C', 'EMP-D'];
    // Responses land out of order, as they would under fast row clicking.
    for (const id of [...ids].reverse()) qc.setQueryData(hrEmployeeKeys.profileShell(id), shellFor(id));
    for (const id of ids) {
      const cached = qc.getQueryData<EmployeeProfileShell>(hrEmployeeKeys.profileShell(id));
      expect(cached?.identity.employeeId).toBe(id);
      expect(() => assertShellMatches(cached!, id)).not.toThrow();
    }
  });

  it('does not assert when no employee is selected', () => {
    expect(() => assertShellMatches(shellFor('EMP-A'), null)).not.toThrow();
  });
});
