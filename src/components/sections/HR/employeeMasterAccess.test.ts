import { describe, expect, it } from 'vitest';
import {
  hasEmployeeCreationAction,
  hasEmployeeRowAction,
  resolveEmployeeMasterAccess,
} from './employeeMasterAccess';

function permissions(...allowed: string[]): (permission: string) => boolean {
  const set = new Set(allowed);
  return permission => set.has(permission);
}

describe('Employee Master capability discoverability', () => {
  it('fails closed when no operation capability is present', () => {
    const access = resolveEmployeeMasterAccess(() => false);
    expect(Object.values(access).every(value => value === false)).toBe(true);
    expect(hasEmployeeCreationAction(access)).toBe(false);
    expect(hasEmployeeRowAction(access)).toBe(false);
  });

  it('maps creation controls to the capability enforced by each backend flow', () => {
    const access = resolveEmployeeMasterAccess(permissions(
      'hr.employees.create',
      'hr.employees.import.upload',
      'hr.onboarding.start',
    ));

    expect(access.createEmployee).toBe(true);
    expect(access.importEmployees).toBe(true);
    expect(access.startOnboarding).toBe(true);
    expect(hasEmployeeCreationAction(access)).toBe(true);
  });

  it('does not present direct contact editing to a request-only user', () => {
    const requestOnly = resolveEmployeeMasterAccess(permissions('hr.view'));
    expect(requestOnly.requestChange).toBe(true);
    expect(requestOnly.editContact).toBe(false);

    const directEditor = resolveEmployeeMasterAccess(permissions('hr.employees.update'));
    expect(directEditor.requestChange).toBe(false);
    expect(directEditor.editContact).toBe(true);
  });

  it('keeps document and statutory controls independently capability-gated', () => {
    const access = resolveEmployeeMasterAccess(permissions(
      'hr.employee_documents.view',
      'hr.employee_documents.download',
      'hr.employee_documents.archive',
      'hr.employees.statutory.view',
      'hr.audit.view',
    ));

    expect(access.viewDocuments).toBe(true);
    expect(access.downloadDocument).toBe(true);
    expect(access.archiveDocument).toBe(true);
    expect(access.uploadDocument).toBe(false);
    expect(access.verifyDocument).toBe(false);
    expect(access.viewStatutory).toBe(true);
    expect(access.editStatutory).toBe(false);
    expect(access.viewAudit).toBe(true);
    expect(access.viewTraining).toBe(false);
  });

  it('recognizes only actionable row mutations as row actions', () => {
    const viewOnly = resolveEmployeeMasterAccess(permissions('hr.employees.view'));
    expect(hasEmployeeRowAction(viewOnly)).toBe(false);

    const statusEditor = resolveEmployeeMasterAccess(permissions('hr.employees.status_change'));
    expect(hasEmployeeRowAction(statusEditor)).toBe(true);
  });
});
