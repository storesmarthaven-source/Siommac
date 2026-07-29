import { can } from '@lib/permissions';

export interface EmployeeMasterAccess {
  createEmployee: boolean;
  importEmployees: boolean;
  startOnboarding: boolean;
  requestChange: boolean;
  /** May edit an employee record directly, without routing through a change request. */
  editEmployee: boolean;
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
  /** Readiness summary + controls. Statutory viewers see it implicitly. */
  viewReadiness: boolean;
  /** Coordinate a readiness blocker: remind, request information. HR-level. */
  followUpReadiness: boolean;
  /** Accept or return a specialist readiness result. Elevated; never hr_staff. */
  reviewReadiness: boolean;
  /** Masked bank/payroll context on the Employment tab — context only, no action. */
  viewPayrollContext: boolean;
  /** Read an employee's access assignments and their recorded scopes. */
  viewAccessAssignments: boolean;
  viewOffboarding: boolean;
  /** Non-technical account health only — never password/session/device controls. */
  viewAccountSecurity: boolean;
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
    editEmployee: has('hr.employees.update'),
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
    // `hr.employees.readiness.view` is the canonical key for the typed readiness
    // model; the older two stay in the OR so an actor who could already see
    // readiness does not silently lose it.
    viewReadiness: has('hr.employees.readiness.view')
      || has('hr.employees.payroll_readiness.view') || has('hr.employees.statutory.view'),
    followUpReadiness: has('hr.employees.readiness.follow_up'),
    reviewReadiness: has('hr.employees.readiness.review'),
    viewPayrollContext: has('hr.employees.payroll_readiness.view'),
    viewAccessAssignments: has('hr.employees.access_assignments.view'),
    viewOffboarding: has('hr.offboarding.view'),
    viewAccountSecurity: has('auth.security.view'),
  };
}

export function hasEmployeeCreationAction(access: EmployeeMasterAccess): boolean {
  return access.createEmployee || access.importEmployees || access.startOnboarding;
}

export function hasEmployeeRowAction(access: EmployeeMasterAccess): boolean {
  return access.editEmployee || access.requestChange || access.changeStatus
    || access.uploadDocument || access.startOffboarding;
}
