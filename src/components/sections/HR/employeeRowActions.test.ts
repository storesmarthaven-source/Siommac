import { describe, expect, it } from 'vitest';
import { resolveEmployeeMasterAccess, type EmployeeMasterAccess } from './employeeMasterAccess';
import { canStartOffboarding, employeeRowActions } from './employeeRowActions';

const ALL_ALLOWED = resolveEmployeeMasterAccess(() => true);
const access = (overrides: Partial<EmployeeMasterAccess> = {}): EmployeeMasterAccess =>
  ({ ...ALL_ALLOWED, ...overrides });
const employee = (status = 'active', offboardingActive = false) => ({ status, offboardingActive });
const labels = (...args: Parameters<typeof employeeRowActions>) =>
  employeeRowActions(...args).map(action => action.label);

describe('Employee register row actions', () => {
  it('orders the menu: profile, edit, document, status, then the lifecycle action', () => {
    expect(labels(employee(), access())).toEqual([
      'View Profile',
      'Edit Contact Details',
      'Upload HR Document',
      'Update Employment Status',
      'Start Offboarding',
    ]);
  });

  it('separates the lifecycle action and marks only it as dangerous', () => {
    const actions = employeeRowActions(employee(), access());
    const offboard = actions.find(a => a.label === 'Start Offboarding');
    expect(offboard?.danger).toBe(true);
    expect(offboard?.separatorBefore).toBe(true);
    expect(actions.filter(a => a.danger)).toHaveLength(1);
    expect(actions.filter(a => a.separatorBefore)).toHaveLength(1);
  });

  it('offers edit OR request, never both', () => {
    // A user who can edit the record directly should not also be pushed down the
    // change-request path — that would create approval work for nothing.
    expect(labels(employee(), access({ editEmployee: true, requestChange: true })))
      .toContain('Edit Contact Details');
    expect(labels(employee(), access({ editEmployee: true, requestChange: true })))
      .not.toContain('Request Change');

    expect(labels(employee(), access({ editEmployee: false, requestChange: true })))
      .toContain('Request Change');
    expect(labels(employee(), access({ editEmployee: false, requestChange: false })))
      .toEqual(['View Profile', 'Upload HR Document', 'Update Employment Status', 'Start Offboarding']);
  });

  it('hides every action the caller lacks the capability for', () => {
    expect(labels(employee(), access({
      editEmployee: false, requestChange: false, uploadDocument: false,
      changeStatus: false, startOffboarding: false,
    }))).toEqual(['View Profile']);
  });
});

describe('Start Offboarding is employee-state aware', () => {
  it('is offered only for employees currently on staff', () => {
    for (const status of ['active', 'probation', 'on_leave', 'suspended']) {
      expect(canStartOffboarding(employee(status)), status).toBe(true);
    }
  });

  it('is withheld from employees who have left or have not started', () => {
    for (const status of ['inactive', 'terminated', 'archived', 'draft', 'pending_onboarding']) {
      expect(canStartOffboarding(employee(status)), status).toBe(false);
      expect(labels(employee(status), access())).not.toContain('Start Offboarding');
    }
  });

  it('is withheld while an offboarding case is already open', () => {
    expect(canStartOffboarding(employee('active', true))).toBe(false);
    const actions = employeeRowActions(employee('active', true), access());
    expect(actions.map(a => a.label)).not.toContain('Start Offboarding');
    // With the lifecycle action gone, no stray separator is left dangling.
    expect(actions.some(a => a.separatorBefore)).toBe(false);
  });

  it('matches status case-insensitively', () => {
    expect(canStartOffboarding(employee('ACTIVE'))).toBe(true);
    expect(canStartOffboarding(employee('Terminated'))).toBe(false);
  });
});
