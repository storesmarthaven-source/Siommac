import { can } from '@lib/permissions';

export interface EmployeeMasterAccess {
  createEmployee: boolean;
  importEmployees: boolean;
  startOnboarding: boolean;
  requestChange: boolean;
  editContact: boolean;
  changeStatus: boolean;
  startOffboarding: boolean;
  viewDocuments: boolean;
  uploadDocument: boolean;
  downloadDocument: boolean;
  verifyDocument: boolean;
  archiveDocument: boolean;
  viewStatutory: boolean;
  editStatutory: boolean;
  viewTraining: boolean;
  viewOnboarding: boolean;
  viewAudit: boolean;
}

type PermissionCheck = (permission: string) => boolean;

/**
 * Employee Master controls mirror the capability enforced by their backend
 * operation. This keeps discoverability honest without replacing server-side
 * authorization, which remains authoritative.
 */
export function resolveEmployeeMasterAccess(has: PermissionCheck = can): EmployeeMasterAccess {
  return {
    createEmployee: has('hr.employees.create'),
    importEmployees: has('hr.employees.import.upload'),
    startOnboarding: has('hr.onboarding.start'),
    requestChange: has('hr.view'),
    editContact: has('hr.employees.update') || has('hr.employees.restricted_contact.update'),
    changeStatus: has('hr.employees.status_change'),
    startOffboarding: has('hr.offboarding.start'),
    viewDocuments: has('hr.employee_documents.view'),
    uploadDocument: has('hr.employee_documents.upload'),
    downloadDocument: has('hr.employee_documents.download'),
    verifyDocument: has('hr.employee_documents.verify'),
    archiveDocument: has('hr.employee_documents.archive'),
    viewStatutory: has('hr.employees.statutory.view'),
    editStatutory: has('hr.employees.statutory.update'),
    viewTraining: has('hr.view'),
    viewOnboarding: has('hr.onboarding.view'),
    viewAudit: has('hr.audit.view'),
  };
}

export function hasEmployeeCreationAction(access: EmployeeMasterAccess): boolean {
  return access.createEmployee || access.importEmployees || access.startOnboarding;
}

export function hasEmployeeRowAction(access: EmployeeMasterAccess): boolean {
  return access.requestChange || access.changeStatus || access.uploadDocument || access.startOffboarding;
}
